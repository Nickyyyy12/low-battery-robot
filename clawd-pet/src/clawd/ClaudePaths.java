package clawd;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Claude Code 在本机存放配置和日志的位置。 */
final class ClaudePaths {
    private ClaudePaths() {
    }

    static List<Path> configDirs() {
        List<Path> dirs = new ArrayList<>();
        String custom = System.getenv("CLAUDE_CONFIG_DIR");
        if (custom != null && !custom.isBlank()) {
            for (String part : custom.split(",")) {
                if (!part.isBlank()) {
                    dirs.add(Path.of(part.trim()));
                }
            }
        }
        Path home = Path.of(System.getProperty("user.home"));
        dirs.add(home.resolve(".claude"));
        dirs.add(home.resolve(".config").resolve("claude"));
        return dirs;
    }
}
