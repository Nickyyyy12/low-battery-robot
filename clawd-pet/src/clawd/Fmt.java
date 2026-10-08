package clawd;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

/** 数字和时间的中文格式化。 */
final class Fmt {
    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter MD_HM = DateTimeFormatter.ofPattern("M月d日 HH:mm");
    private static final String[] WEEKDAYS = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};

    private Fmt() {
    }

    /** 1234 → 1.2K，1234567 → 1.23M */
    static String tokens(long n) {
        if (n < 1_000) {
            return Long.toString(n);
        }
        if (n < 1_000_000) {
            return trim(String.format(Locale.ROOT, "%.1f", n / 1e3)) + "K";
        }
        if (n < 1_000_000_000) {
            return trim(String.format(Locale.ROOT, "%.2f", n / 1e6)) + "M";
        }
        return trim(String.format(Locale.ROOT, "%.2f", n / 1e9)) + "B";
    }

    static String percent(double p) {
        return Math.round(p) + "%";
    }

    /** 距离重置还有多久：45分钟 / 2小时13分 / 3天4小时 */
    static String countdown(Instant target, Instant now) {
        long secs = Duration.between(now, target).getSeconds();
        if (secs <= 0) {
            return "即将重置";
        }
        long mins = (secs + 59) / 60;
        if (mins < 60) {
            return mins + "分钟";
        }
        if (mins < 24 * 60) {
            return mins / 60 + "小时" + (mins % 60 == 0 ? "" : mins % 60 + "分");
        }
        long hours = mins / 60;
        return hours / 24 + "天" + (hours % 24 == 0 ? "" : hours % 24 + "小时");
    }

    /** 重置的具体时刻：今天 18:00 / 明天 09:00 / 周三 08:00 / 10月12日 08:00 */
    static String clock(Instant t, ZoneId zone) {
        ZonedDateTime z = t.atZone(zone);
        LocalDate today = LocalDate.now(zone);
        long days = ChronoUnit.DAYS.between(today, z.toLocalDate());
        if (days == 0) {
            return "今天 " + HM.format(z);
        }
        if (days == 1) {
            return "明天 " + HM.format(z);
        }
        if (days > 1 && days < 7) {
            return WEEKDAYS[z.getDayOfWeek().getValue() - 1] + " " + HM.format(z);
        }
        return MD_HM.format(z);
    }

    static String time(Instant t, ZoneId zone) {
        return HM.format(t.atZone(zone));
    }

    private static String trim(String s) {
        if (s.contains(".")) {
            s = s.replaceAll("0+$", "").replaceAll("\\.$", "");
        }
        return s;
    }
}
