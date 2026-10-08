package clawd;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 读取 Claude 订阅额度。
 * 复用本机 Claude Code 的登录令牌，请求它的 /usage 命令背后用的同一个接口。
 */
final class UsageClient {
    private static final URI USAGE_URI = URI.create("https://api.anthropic.com/api/oauth/usage");
    private static final List<String> ORDER =
            List.of("five_hour", "seven_day", "seven_day_sonnet", "seven_day_opus", "seven_day_oauth_apps");

    /** 给用户看的错误信息。 */
    static final class UsageException extends Exception {
        /** 用户处理一下就能好的问题（如令牌过期），桌宠会每分钟重试一次。 */
        final boolean retrySoon;
        /** 登录令牌过期了，需要让 Claude Code 续期。 */
        final boolean needsRenew;

        UsageException(String message) {
            this(message, false, false);
        }

        UsageException(String message, boolean retrySoon) {
            this(message, retrySoon, false);
        }

        UsageException(String message, boolean retrySoon, boolean needsRenew) {
            super(message);
            this.retrySoon = retrySoon;
            this.needsRenew = needsRenew;
        }
    }

    private static final String RENEW_HINT = "在本机终端运行一次 claude 并随便发一句话即可续期，Clawd 一分钟内会自动恢复";

    private final HttpClient http;

    UsageClient() {
        HttpClient.Builder b = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10));
        ProxySelector proxy = proxyFromEnv();
        if (proxy != null) {
            b.proxy(proxy);
        }
        http = b.build();
    }

    Usage.Remote fetch() throws UsageException {
        String token = findToken();
        HttpRequest req = HttpRequest.newBuilder(USAGE_URI)
                .timeout(Duration.ofSeconds(20))
                .header("Authorization", "Bearer " + token)
                .header("anthropic-beta", "oauth-2025-04-20")
                .header("Accept", "application/json")
                .header("User-Agent", "clawd-pet/1.0")
                .GET()
                .build();
        HttpResponse<String> resp;
        try {
            resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UsageException("网络连接失败：" + e.getClass().getSimpleName()
                    + "（如需代理，可设置 HTTPS_PROXY 环境变量）", true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UsageException("请求被中断");
        }
        switch (resp.statusCode()) {
            case 200:
                return parse(resp.body());
            case 401:
                throw new UsageException("登录令牌被拒绝：" + RENEW_HINT + "（仍不行就在 claude 里 /login 重新登录）", true, true);
            case 403:
                throw new UsageException("没有权限：需要用 Pro / Max 订阅账号登录 Claude Code");
            case 429:
                throw new UsageException("查询太频繁，稍后会自动重试");
            default:
                throw new UsageException("接口返回 HTTP " + resp.statusCode());
        }
    }

    static Usage.Remote parse(String body) throws UsageException {
        Map<String, Object> root;
        try {
            root = Json.obj(Json.parse(body));
        } catch (IllegalArgumentException e) {
            root = null;
        }
        if (root == null) {
            throw new UsageException("接口返回的内容看不懂");
        }
        List<Usage.Limit> limits = new ArrayList<>();
        for (Map.Entry<String, Object> e : root.entrySet()) {
            String key = e.getKey();
            Map<String, Object> v = Json.obj(e.getValue());
            Double pct = Json.num(v, "utilization");
            if (pct == null) {
                continue; // 没开通的额度会是 null
            }
            if (key.equals("extra_usage")) {
                if (Boolean.TRUE.equals(v.get("is_enabled"))) {
                    limits.add(new Usage.Limit(key, "额外用量（按量计费）", "额外", pct, null));
                }
                continue;
            }
            limits.add(new Usage.Limit(key, label(key), shortLabel(key), pct, parseTime(Json.str(v, "resets_at"))));
        }
        limits.sort(Comparator.comparingInt(l -> {
            int idx = ORDER.indexOf(l.key());
            return idx < 0 ? ORDER.size() : idx;
        }));
        return new Usage.Remote(limits, Instant.now());
    }

    private static String label(String key) {
        switch (key) {
            case "five_hour": return "5 小时会话";
            case "seven_day": return "每周 · 全部模型";
            case "seven_day_sonnet": return "每周 · Sonnet";
            case "seven_day_opus": return "每周 · Opus";
            case "seven_day_oauth_apps": return "每周 · 第三方应用";
            default:
                // 将来接口新增的额度也照样显示，例如 seven_day_xxx → 每周 · xxx
                return key.startsWith("seven_day_") ? "每周 · " + key.substring(10) : key.replace('_', ' ');
        }
    }

    private static String shortLabel(String key) {
        switch (key) {
            case "five_hour": return "5h";
            case "seven_day": return "本周";
            case "seven_day_sonnet": return "Sonnet";
            case "seven_day_opus": return "Opus";
            default: return key.startsWith("seven_day_") ? key.substring(10) : key;
        }
    }

    private static Instant parseTime(String s) {
        if (s == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (RuntimeException e) {
            try {
                return Instant.parse(s);
            } catch (RuntimeException ignored) {
                return null;
            }
        }
    }

    // ---------- 登录令牌 ----------

    /**
     * 依次尝试：~/.claude/.credentials.json → macOS 钥匙串。
     * 不读 CLAUDE_CODE_OAUTH_TOKEN：那通常是 claude setup-token 生成的长期令牌，没有查询额度的权限。
     */
    static String findToken() throws UsageException {
        boolean expired = false;
        for (Path dir : ClaudePaths.configDirs()) {
            Path file = dir.resolve(".credentials.json");
            if (!Files.isRegularFile(file)) {
                continue;
            }
            try {
                String token = tokenFromCredentials(Files.readString(file, StandardCharsets.UTF_8));
                if (token != null) {
                    return token;
                }
                expired = true;
            } catch (IOException | IllegalArgumentException ignored) {
                // 换下一个位置试试
            }
        }
        if (System.getProperty("os.name", "").toLowerCase().contains("mac")) {
            String json = readMacKeychain();
            if (json != null) {
                try {
                    String token = tokenFromCredentials(json);
                    if (token != null) {
                        return token;
                    }
                    expired = true;
                } catch (IllegalArgumentException ignored) {
                    // 当作没找到
                }
            }
        }
        if (expired) {
            throw new UsageException("本机登录令牌已过期：" + RENEW_HINT, true, true);
        }
        throw new UsageException("没找到 Claude Code 登录信息：请先在本机终端运行 claude 并登录", true);
    }

    /** 返回可用的 accessToken；已过期返回 null；格式不对抛 IllegalArgumentException。 */
    private static String tokenFromCredentials(String json) {
        Map<String, Object> oauth = Json.obj(Json.obj(Json.parse(json)), "claudeAiOauth");
        String token = Json.str(oauth, "accessToken");
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("没有 accessToken");
        }
        Double expiresAt = Json.num(oauth, "expiresAt");
        if (expiresAt != null && expiresAt < System.currentTimeMillis()) {
            return null;
        }
        return token;
    }

    private static String readMacKeychain() {
        try {
            Process p = new ProcessBuilder("security", "find-generic-password", "-s", "Claude Code-credentials", "-w")
                    .redirectErrorStream(false)
                    .start();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (!p.waitFor(5, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return null;
            }
            return p.exitValue() == 0 && !out.isEmpty() ? out : null;
        } catch (IOException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    /** 支持 HTTPS_PROXY=http://127.0.0.1:7890 这类写法；没设置就用系统代理。 */
    private static ProxySelector proxyFromEnv() {
        for (String name : new String[]{"HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"}) {
            String v = System.getenv(name);
            if (v == null || v.isBlank()) {
                continue;
            }
            try {
                URI u = URI.create(v.contains("://") ? v.trim() : "http://" + v.trim());
                if (u.getHost() != null && u.getScheme().startsWith("http")) {
                    int port = u.getPort() > 0 ? u.getPort() : 80;
                    return ProxySelector.of(new InetSocketAddress(u.getHost(), port));
                }
            } catch (IllegalArgumentException ignored) {
                // 格式不对就忽略
            }
        }
        return null;
    }
}
