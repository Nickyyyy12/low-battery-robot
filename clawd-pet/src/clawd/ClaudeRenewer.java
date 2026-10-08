package clawd;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * 登录令牌过期时，在后台运行一次 claude -p 发一句很短的话，由 Claude Code 自己完成续期。
 * 桌宠本身从不改写登录信息；代价是每次续期会用掉极少的额度。
 */
final class ClaudeRenewer {
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase().contains("win");
    private static final String PROMPT = "Reply with just: ok";
    private static Path cachedExe;

    private ClaudeRenewer() {
    }

    /** 成功返回 null，失败返回原因。 */
    static String renew() {
        Path exe = findClaude();
        if (exe == null) {
            return "没找到 claude 命令";
        }
        // 固定在一个空目录里运行，不会读到你项目里的 CLAUDE.md
        Path work = Path.of(System.getProperty("user.home"), ".clawd-pet", "renew");
        try {
            Files.createDirectories(work);
            Path log = work.resolve("last-run.txt");
            int code = run(exe, work, log, true);
            if (code != 0) {
                code = run(exe, work, log, false); // 有的账号选不了 haiku，换默认模型再试
            }
            return code == 0 ? null : "claude 运行失败：" + lastLine(log);
        } catch (IOException e) {
            return "无法运行 claude：" + e.getMessage();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "被中断";
        }
    }

    private static int run(Path exe, Path work, Path log, boolean cheapModel) throws IOException, InterruptedException {
        List<String> cmd = new ArrayList<>();
        String name = exe.getFileName().toString().toLowerCase();
        if (WINDOWS && (name.endsWith(".cmd") || name.endsWith(".bat"))) {
            cmd.add("cmd.exe");
            cmd.add("/c");
        }
        cmd.add(exe.toString());
        cmd.add("-p");
        if (cheapModel) {
            cmd.add("--model");
            cmd.add("haiku");
        }
        cmd.add(PROMPT);

        ProcessBuilder pb = new ProcessBuilder(cmd)
                .directory(work.toFile())
                .redirectErrorStream(true)
                .redirectOutput(log.toFile())
                .redirectInput(ProcessBuilder.Redirect.from(new File(WINDOWS ? "NUL" : "/dev/null")));
        // 双击启动时 PATH 往往很短，补上 claude 所在目录，npm 安装的版本才能找到 node
        Map<String, String> env = pb.environment();
        String pathKey = env.keySet().stream().filter(k -> k.equalsIgnoreCase("PATH")).findFirst().orElse("PATH");
        List<String> extra = new ArrayList<>();
        extra.add(exe.getParent().toString());
        if (!WINDOWS) {
            extra.add("/opt/homebrew/bin");
            extra.add("/usr/local/bin");
        }
        String old = env.getOrDefault(pathKey, "");
        env.put(pathKey, String.join(File.pathSeparator, extra) + (old.isEmpty() ? "" : File.pathSeparator + old));

        Process p = pb.start();
        if (!p.waitFor(2, TimeUnit.MINUTES)) {
            p.destroyForcibly();
            return -1;
        }
        return p.exitValue();
    }

    static synchronized Path findClaude() {
        if (cachedExe != null && Files.isRegularFile(cachedExe)) {
            return cachedExe;
        }
        String home = System.getProperty("user.home");
        Set<String> dirs = new LinkedHashSet<>();
        String path = System.getenv("PATH");
        if (path != null) {
            for (String d : path.split(File.pathSeparator)) {
                if (!d.isBlank()) {
                    dirs.add(d);
                }
            }
        }
        dirs.add(home + "/.local/bin");
        dirs.add(home + "/.claude/local");
        if (WINDOWS) {
            String appData = System.getenv("APPDATA");
            if (appData != null) {
                dirs.add(appData + "\\npm");
            }
        } else {
            dirs.add("/opt/homebrew/bin");
            dirs.add("/usr/local/bin");
            dirs.add(home + "/.npm-global/bin");
            dirs.add(home + "/.volta/bin");
            dirs.add(home + "/.bun/bin");
        }
        String[] names = WINDOWS ? new String[]{"claude.exe", "claude.cmd"} : new String[]{"claude"};
        for (String d : dirs) {
            for (String n : names) {
                Path p = Path.of(d, n);
                if (Files.isRegularFile(p) && (WINDOWS || Files.isExecutable(p))) {
                    return cachedExe = p;
                }
            }
        }
        return WINDOWS ? null : (cachedExe = askLoginShell());
    }

    /** 最后一招：让用户自己的 shell 告诉我们 claude 在哪（比如用 nvm 装的）。 */
    private static Path askLoginShell() {
        String shell = System.getenv("SHELL");
        if (shell == null || shell.isBlank()) {
            shell = Files.isExecutable(Path.of("/bin/zsh")) ? "/bin/zsh" : "/bin/bash";
        }
        try {
            Process p = new ProcessBuilder(shell, "-ilc", "command -v claude")
                    .redirectErrorStream(true)
                    .redirectInput(ProcessBuilder.Redirect.from(new File("/dev/null")))
                    .start();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (!p.waitFor(10, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return null;
            }
            String[] lines = out.trim().split("\\R");
            for (int i = lines.length - 1; i >= 0; i--) {
                Path candidate = Path.of(lines[i].trim());
                if (lines[i].trim().startsWith("/") && Files.isExecutable(candidate)) {
                    return candidate;
                }
            }
        } catch (IOException | RuntimeException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return null;
    }

    private static String lastLine(Path log) {
        try {
            List<String> lines = Files.readAllLines(log, StandardCharsets.UTF_8);
            for (int i = lines.size() - 1; i >= 0; i--) {
                String l = lines.get(i).trim();
                if (!l.isEmpty()) {
                    return l.length() > 80 ? l.substring(0, 80) + "…" : l;
                }
            }
        } catch (IOException | RuntimeException ignored) {
            // 没有输出
        }
        return "没有输出";
    }
}
