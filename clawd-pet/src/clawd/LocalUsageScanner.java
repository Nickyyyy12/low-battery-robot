package clawd;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 统计「今天」本机 Claude Code 消耗的 token。
 * 数据来自 ~/.claude/projects 下的会话日志（*.jsonl），只读、不上传。
 * 每个文件按修改时间缓存，没变化的文件不会重复解析。
 */
final class LocalUsageScanner {
    private record Tokens(String model, long input, long output, long cacheWrite, long cacheRead) {
    }

    private record FileCache(long mtime, long size, Map<String, Tokens> items) {
    }

    private final Map<Path, FileCache> cache = new HashMap<>();
    private LocalDate cacheDay;

    Usage.Local scan() {
        ZoneId zone = ZoneId.systemDefault();
        LocalDate today = LocalDate.now(zone);
        if (!today.equals(cacheDay)) {
            cache.clear();
            cacheDay = today;
        }
        long startOfDay = today.atStartOfDay(zone).toInstant().toEpochMilli();

        boolean found = false;
        Set<Path> seen = new HashSet<>();
        // 同一条消息可能出现在多个文件里（例如续接的会话），按消息 id 去重
        Map<String, Tokens> all = new HashMap<>();
        for (Path dir : ClaudePaths.configDirs()) {
            Path projects = dir.resolve("projects");
            if (!Files.isDirectory(projects)) {
                continue;
            }
            found = true;
            for (Path file : jsonlFiles(projects)) {
                try {
                    long mtime = Files.getLastModifiedTime(file).toMillis();
                    if (mtime < startOfDay) {
                        continue; // 今天没动过的文件不可能有今天的记录
                    }
                    long size = Files.size(file);
                    seen.add(file);
                    FileCache fc = cache.get(file);
                    if (fc == null || fc.mtime() != mtime || fc.size() != size) {
                        fc = new FileCache(mtime, size, parseFile(file, today, zone));
                        cache.put(file, fc);
                    }
                    all.putAll(fc.items());
                } catch (IOException | UncheckedIOException ignored) {
                    // 文件正在被写或没权限，下次再读
                }
            }
        }
        cache.keySet().retainAll(seen);

        long in = 0, out = 0, cw = 0, cr = 0;
        Map<String, Long> byModel = new HashMap<>();
        for (Tokens t : all.values()) {
            in += t.input();
            out += t.output();
            cw += t.cacheWrite();
            cr += t.cacheRead();
            long sum = t.input() + t.output() + t.cacheWrite() + t.cacheRead();
            byModel.merge(modelFamily(t.model()), sum, Long::sum);
        }
        Map<String, Long> sorted = new LinkedHashMap<>();
        byModel.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .forEach(e -> sorted.put(e.getKey(), e.getValue()));
        return new Usage.Local(found, in, out, cw, cr, all.size(), sorted);
    }

    private static List<Path> jsonlFiles(Path projects) {
        List<Path> files = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(projects, 5)) {
            walk.filter(p -> p.getFileName().toString().endsWith(".jsonl") && Files.isRegularFile(p))
                    .forEach(files::add);
        } catch (IOException | UncheckedIOException ignored) {
            // 能读多少算多少
        }
        return files;
    }

    private static Map<String, Tokens> parseFile(Path file, LocalDate today, ZoneId zone) throws IOException {
        Map<String, Tokens> items = new HashMap<>();
        try (BufferedReader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String line;
            int lineNo = 0;
            while ((line = r.readLine()) != null) {
                lineNo++;
                if (!line.contains("\"usage\"")) {
                    continue; // 先粗筛，绝大多数行不用真的解析
                }
                Map<String, Object> entry;
                try {
                    entry = Json.obj(Json.parse(line));
                } catch (IllegalArgumentException e) {
                    continue; // 可能是正在写入的半行
                }
                Map<String, Object> msg = Json.obj(entry, "message");
                Map<String, Object> usage = Json.obj(msg, "usage");
                String ts = Json.str(entry, "timestamp");
                if (usage == null || ts == null) {
                    continue;
                }
                try {
                    if (!Instant.parse(ts).atZone(zone).toLocalDate().equals(today)) {
                        continue;
                    }
                } catch (RuntimeException e) {
                    continue;
                }
                String model = Json.str(msg, "model");
                if ("<synthetic>".equals(model)) {
                    continue; // 本地生成的占位消息，不算用量
                }
                String id = Json.str(msg, "id");
                String key = id != null ? id + ":" + Json.str(entry, "requestId") : file + "#" + lineNo;
                // 流式输出会把同一条消息写好几行，后面的数字更完整，直接覆盖
                items.put(key, new Tokens(model,
                        Json.lng(usage, "input_tokens"),
                        Json.lng(usage, "output_tokens"),
                        Json.lng(usage, "cache_creation_input_tokens"),
                        Json.lng(usage, "cache_read_input_tokens")));
            }
        }
        return items;
    }

    /** claude-opus-4-1-20250805 → Opus；认不出的原样返回。 */
    static String modelFamily(String model) {
        if (model == null || model.isBlank()) {
            return "其他";
        }
        String[] parts = model.split("-");
        if (!parts[0].equals("claude")) {
            return model;
        }
        for (int k = 1; k < parts.length; k++) { // 兼容 claude-3-5-sonnet 这种老命名
            if (!parts[k].isEmpty() && Character.isLetter(parts[k].charAt(0))) {
                return Character.toUpperCase(parts[k].charAt(0)) + parts[k].substring(1);
            }
        }
        return model;
    }
}
