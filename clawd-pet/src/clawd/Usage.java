package clawd;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 桌宠要展示的各类用量数据。 */
final class Usage {
    private Usage() {
    }

    /** 一种额度：比如「5 小时会话」「每周 · 全部模型」。percent 为 0~100。 */
    record Limit(String key, String label, String shortLabel, double percent, Instant resetsAt) {
    }

    /** 订阅额度（来自 Claude 账号）。 */
    record Remote(List<Limit> limits, Instant fetchedAt) {
        /** 最吃紧的那一项，收起状态下显示它。 */
        Limit tightest() {
            Limit best = null;
            for (Limit l : limits) {
                if (best == null || l.percent() > best.percent()) {
                    best = l;
                }
            }
            return best;
        }

        Instant nextReset() {
            Instant next = null;
            for (Limit l : limits) {
                if (l.resetsAt() != null && (next == null || l.resetsAt().isBefore(next))) {
                    next = l.resetsAt();
                }
            }
            return next;
        }
    }

    /** 今天本机 Claude Code 的 token 消耗（来自本地日志）。byModel 按用量从大到小。 */
    record Local(boolean found, long input, long output, long cacheWrite, long cacheRead,
                 int messages, Map<String, Long> byModel) {
        long total() {
            return input + output + cacheWrite + cacheRead;
        }
    }
}
