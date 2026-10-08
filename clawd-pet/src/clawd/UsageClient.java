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
                // 认不出的是内部代号（如 iguana_necktie），标成「其他额度」，括号里保留原名方便对照
                return key.startsWith("seven_day_") ? "每周 · " + key.substring(10)
                        : "其他额度（" + key.replace('_', ' ') + "）";
        }
    }

    private static String shortLabel(String key) {
        switch (key) {
            case "five_hour": return "5h";
            case "seven_day": return "本周";
            case "seven_day_sonnet": return "Sonnet";
            case "seven_day_opus": return "Opus";
            default: return key.startsWith("seven_day_") ? key.substring(10) : "其他";
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
        List<String> checked = new ArrayList<>(); // 找不到时告诉用户都查了哪里
        for (Path dir : ClaudePaths.configDirs()) {
            Path file = dir.resolve(".credentials.json");
            String where = shortPath(file);
            if (!Files.isRegularFile(file)) {
                checked.add(where + " 不存在");
                continue;
            }
            try {
                String token = tokenFromCredentials(Files.readString(file, StandardCharsets.UTF_8));
                if (token != null) {
                    return token;
                }
                expired = true;
            } catch (IOException e) {
                checked.add(where + " 读不了");
            } catch (IllegalArgumentException e) {
                checked.add(where + " " + e.getMessage());
            }
        }
        if (System.getProperty("os.name", "").toLowerCase().contains("mac")) {
            String[] result = new String[1];
            int code = readMacKeychain(result);
            if (result[0] != null) {
                try {
                    String token = tokenFromCredentials(result[0]);
                    if (token != null) {
                        return token;
                    }
                    expired = true;
                } catch (IllegalArgumentException e) {
                    checked.add("钥匙串条目" + e.getMessage());
                }
            } else {
                checked.add(code == 44 ? "钥匙串里没有 Claude Code 条目" : "钥匙串读取失败（代码 " + code + "）");
            }
        }
        if (expired) {
            throw new UsageException("本机登录令牌已过期：" + RENEW_HINT, true, true);
        }
        String env = System.getenv("CLAUDE_CODE_OAUTH_TOKEN");
        if (env != null && !env.isBlank()) {
            checked.add("环境变量 CLAUDE_CODE_OAUTH_TOKEN 是长期令牌，查不了额度");
        }
        throw new UsageException("没找到 Claude Code 登录信息：请在本机终端运行 claude，输入 /login 用 Claude 账号登录。"
                + "（" + String.join("；", checked) + "）", true);
    }

    private static String shortPath(Path p) {
        String home = System.getProperty("user.home");
        String s = p.toString();
        return s.startsWith(home) ? "~" + s.substring(home.length()) : s;
    }

    /**
     * 返回可用的 accessToken；已过期返回 null；
     * 读不出来时抛 IllegalArgumentException，消息说明原因（只含字段名，不含任何令牌内容）。
     */
    private static String tokenFromCredentials(String json) {
        Map<String, Object> root;
        try {
            root = Json.obj(Json.parse(json));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("不是有效的 JSON（" + (json.isBlank() ? "文件是空的" : "格式读不懂") + "）");
        }
        if (root == null) {
            throw new IllegalArgumentException("内容格式不对");
        }
        Map<String, Object> oauth = Json.obj(root, "claudeAiOauth");
        if (oauth == null) {
            throw new IllegalArgumentException("里没有账号登录信息（只有："
                    + (root.isEmpty() ? "空" : String.join("、", root.keySet())) + "）");
        }
        Object raw = oauth.get("accessToken");
        if (!(raw instanceof String) || ((String) raw).isBlank()) {
            if (raw == null || raw instanceof String) {
                if (oauth.get("refreshToken") != null) {
                    return null; // 访问令牌是空的但还有续期令牌：当作过期，交给 Claude Code 续期
                }
                throw new IllegalArgumentException("里的登录令牌是空的");
            }
            throw new IllegalArgumentException("里的 accessToken 不是文本（是" + typeName(raw) + "），可能被加密保存了");
        }
        if (expiresAt(oauth) < System.currentTimeMillis()) {
            return null;
        }
        return (String) raw;
    }

    /** expiresAt 一般是毫秒数字，也兼容写成字符串的情况；没有就当作不过期。 */
    private static double expiresAt(Map<String, Object> oauth) {
        Object v = oauth.get("expiresAt");
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        if (v instanceof String) {
            String str = ((String) v).trim();
            try {
                return Double.parseDouble(str);
            } catch (NumberFormatException e) {
                Instant t = parseTime(str);
                if (t != null) {
                    return t.toEpochMilli();
                }
            }
        }
        return Double.MAX_VALUE;
    }

    private static String typeName(Object v) {
        if (v instanceof Map) {
            return "对象";
        }
        if (v instanceof List) {
            return "数组";
        }
        return v instanceof Number ? "数字" : v instanceof Boolean ? "布尔值" : v.getClass().getSimpleName();
    }

    /** 读到的内容放进 out[0]，返回 security 命令的退出码（44 表示没有这个条目）。 */
    private static int readMacKeychain(String[] out) {
        try {
            Process p = new ProcessBuilder("security", "find-generic-password", "-s", "Claude Code-credentials", "-w")
                    .redirectError(ProcessBuilder.Redirect.DISCARD)
                    .start();
            String text = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (!p.waitFor(5, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return -1;
            }
            if (p.exitValue() == 0 && !text.isEmpty()) {
                out[0] = text;
            }
            return p.exitValue();
        } catch (IOException e) {
            return -1;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return -1;
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
