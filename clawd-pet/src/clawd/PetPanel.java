package clawd;

import javax.swing.JPanel;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Polygon;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.geom.Area;
import java.awt.geom.RoundRectangle2D;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 画小 Clawd 和它头顶的用量气泡。
 * 展开时显示完整面板；收起时只显示最吃紧那项额度的小胶囊。
 */
final class PetPanel extends JPanel {
    static final int WIDTH = 280;

    private static final int PX = 7;          // 一个像素块的边长
    private static final int PET_AREA = 92;   // 底部留给 Clawd 的高度
    private static final int CARD_X = 8;
    private static final int CARD_TOP = 6;
    private static final int PAD = 12;
    private static final int TAIL = 9;
    private static final int PILL_H = 26;

    private static final Color CLAWD = new Color(0xD97757);
    private static final Color EYE = new Color(0x1F1E1D);
    private static final Color INK = new Color(0x1F1E1D);
    private static final Color MUTED = new Color(0x73726C);
    private static final Color CARD = new Color(250, 249, 245, 248);
    private static final Color BORDER = new Color(0, 0, 0, 34);
    private static final Color TRACK = new Color(0xE6E3D8);
    private static final Color GREEN = new Color(0x6B8E4E);
    private static final Color ORANGE = new Color(0xD97757);
    private static final Color RED = new Color(0xC0453A);
    private static final Color SWEAT = new Color(0x7FB8E6);

    private static final Font F_TITLE = new Font(Font.DIALOG, Font.BOLD, 13);
    private static final Font F_TEXT = new Font(Font.DIALOG, Font.PLAIN, 12);
    private static final Font F_BOLD = new Font(Font.DIALOG, Font.BOLD, 12);
    private static final Font F_SMALL = new Font(Font.DIALOG, Font.PLAIN, 11);
    private static final Font F_ZZZ = new Font(Font.MONOSPACED, Font.BOLD, 15);

    /** Clawd 的身体，16×7 像素；第 4 行是两只小手。 */
    private static final String[] BODY = {
            "..############..",
            "..############..",
            "..############..",
            "..############..",
            "################",
            "..############..",
            "..############..",
    };
    private static final int[] LEGS = {3, 5, 10, 12};
    private static final int EYE_L = 4;
    private static final int EYE_R = 11;

    private enum Mood { NORMAL, SWEAT, TIRED, SLEEP }

    private final ZoneId zone = ZoneId.systemDefault();
    private Usage.Remote remote;
    private String remoteError;
    private boolean fetching;
    private Usage.Local local;
    private boolean expanded = true;
    private boolean hover;
    private long frame;
    private long blinkUntil;
    private long nextBlink = 20;

    PetPanel() {
        setOpaque(false);
    }

    // ---------- 状态 ----------

    void setRemote(Usage.Remote r) {
        remote = r;
        remoteError = null;
        fetching = false;
        repaint();
    }

    void setRemoteError(String message) {
        remoteError = message;
        fetching = false;
        repaint();
    }

    void setFetching(boolean f) {
        fetching = f;
        repaint();
    }

    void setLocal(Usage.Local l) {
        local = l;
        repaint();
    }

    Usage.Remote remote() {
        return remote;
    }

    boolean isExpanded() {
        return expanded;
    }

    void setExpanded(boolean e) {
        expanded = e;
        repaint();
    }

    void setHover(boolean h) {
        hover = h;
    }

    /** 动画时钟，每 100ms 调一次。 */
    void tick() {
        frame++;
        if (frame >= nextBlink) {
            blinkUntil = frame + 2;
            nextBlink = frame + 25 + ThreadLocalRandom.current().nextInt(35);
        }
        repaint();
    }

    int preferredHeight() {
        int top = expanded ? CARD_TOP + cardContent(null) + TAIL : CARD_TOP + PILL_H + 4;
        return top + PET_AREA;
    }

    /** 点这里会展开 / 收起。 */
    Rectangle petBounds() {
        int x = (WIDTH - 16 * PX) / 2;
        return new Rectangle(x - 6, getHeight() - PET_AREA, 16 * PX + 12, PET_AREA);
    }

    // ---------- 绘制 ----------

    @Override
    protected void paintComponent(Graphics g0) {
        Graphics2D g = (Graphics2D) g0.create();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        int h = getHeight();
        if (expanded) {
            paintCard(g, h);
        } else {
            paintPill(g);
        }
        paintPet(g, h);
        g.dispose();
    }

    private void paintCard(Graphics2D g, int h) {
        int cardH = cardContent(null);
        int w = WIDTH - 2 * CARD_X;
        int bottom = CARD_TOP + cardH;
        int cx = WIDTH / 2;
        Area bubble = new Area(new RoundRectangle2D.Float(CARD_X, CARD_TOP, w, cardH, 16, 16));
        bubble.add(new Area(new Polygon(
                new int[]{cx - 9, cx + 9, cx},
                new int[]{bottom - 1, bottom - 1, bottom + TAIL - 1}, 3)));

        g.setColor(new Color(0, 0, 0, 28));
        g.translate(0, 2);
        g.fill(bubble);
        g.translate(0, -2);
        g.setColor(CARD);
        g.fill(bubble);
        g.setColor(BORDER);
        g.setStroke(new BasicStroke(1f));
        g.draw(bubble);

        cardContent(g);
    }

    /** 画面板里的内容并返回内容高度；g 为 null 时只量尺寸。 */
    private int cardContent(Graphics2D g) {
        int x0 = CARD_X + PAD;
        int x1 = WIDTH - CARD_X - PAD;
        Instant now = Instant.now();
        int y = CARD_TOP + PAD;

        // 标题行
        text(g, F_TITLE, INK, "Claude 用量", x0, y + 13);
        String status = fetching ? "刷新中…"
                : remote != null ? "更新于 " + Fmt.time(remote.fetchedAt(), zone) : "";
        textRight(g, F_SMALL, MUTED, status, x1, y + 13);
        y += 22;

        // 订阅额度
        if (remote != null) {
            if (remote.limits().isEmpty()) {
                text(g, F_SMALL, MUTED, "这个账号暂时没有额度数据", x0, y + 13);
                y += 18;
            }
            for (Usage.Limit l : remote.limits()) {
                y += 4;
                text(g, F_TEXT, INK, l.label(), x0, y + 12);
                textRight(g, F_BOLD, levelColor(l.percent()), Fmt.percent(l.percent()), x1, y + 12);
                y += 17;
                if (g != null) {
                    drawBar(g, x0, y, x1 - x0, l.percent());
                }
                y += 6;
                if (l.resetsAt() != null) {
                    String reset = Fmt.countdown(l.resetsAt(), now) + "后重置 · " + Fmt.clock(l.resetsAt(), zone);
                    text(g, F_SMALL, MUTED, reset, x0, y + 13);
                    y += 17;
                } else {
                    y += 4;
                }
            }
        } else if (remoteError == null) {
            text(g, F_SMALL, MUTED, "正在读取额度…", x0, y + 13);
            y += 18;
        }
        if (remoteError != null) {
            y += 2;
            for (String line : wrap(remoteError, F_SMALL, x1 - x0)) {
                text(g, F_SMALL, RED, line, x0, y + 12);
                y += 15;
            }
        }

        // 分隔线
        y += 6;
        if (g != null) {
            g.setColor(TRACK);
            g.drawLine(x0, y, x1, y);
        }
        y += 6;

        // 今日本地 token
        if (local == null) {
            text(g, F_SMALL, MUTED, "正在统计今日本地用量…", x0, y + 13);
            y += 18;
        } else if (!local.found()) {
            text(g, F_SMALL, MUTED, "今日本地：没找到 Claude Code 记录", x0, y + 13);
            y += 18;
        } else {
            text(g, F_TEXT, INK, "今日 Token（" + local.messages() + " 条回复）", x0, y + 13);
            textRight(g, F_BOLD, INK, Fmt.tokens(local.total()), x1, y + 13);
            y += 19;
            text(g, F_SMALL, MUTED, "输入 " + Fmt.tokens(local.input())
                    + " · 输出 " + Fmt.tokens(local.output())
                    + " · 缓存 " + Fmt.tokens(local.cacheRead() + local.cacheWrite()), x0, y + 12);
            y += 16;
            if (!local.byModel().isEmpty()) {
                StringBuilder sb = new StringBuilder();
                int n = 0;
                for (Map.Entry<String, Long> e : local.byModel().entrySet()) {
                    if (n++ == 3) {
                        break;
                    }
                    if (sb.length() > 0) {
                        sb.append(" · ");
                    }
                    sb.append(e.getKey()).append(' ').append(Fmt.tokens(e.getValue()));
                }
                text(g, F_SMALL, MUTED, sb.toString(), x0, y + 12);
                y += 16;
            }
        }
        y += PAD - 4;
        return y - CARD_TOP;
    }

    private void paintPill(Graphics2D g) {
        Usage.Limit l = remote == null ? null : remote.tightest();
        String main;
        String sub;
        Color color;
        if (l != null) {
            main = l.shortLabel() + " " + Fmt.percent(l.percent());
            sub = l.resetsAt() == null ? "" : " · " + Fmt.countdown(l.resetsAt(), Instant.now()) + "后重置";
            color = levelColor(l.percent());
        } else if (remoteError != null) {
            main = "读取失败";
            sub = " · 点我看详情";
            color = RED;
        } else {
            main = "加载中…";
            sub = "";
            color = MUTED;
        }
        FontMetrics fmMain = getFontMetrics(F_BOLD);
        FontMetrics fmSub = getFontMetrics(F_SMALL);
        int battW = l != null ? 22 : 0;
        int w = 12 + battW + fmMain.stringWidth(main) + fmSub.stringWidth(sub) + 12;
        int x = (WIDTH - w) / 2;
        int y = CARD_TOP;

        g.setColor(new Color(0, 0, 0, 28));
        g.fillRoundRect(x, y + 2, w, PILL_H, PILL_H, PILL_H);
        g.setColor(CARD);
        g.fillRoundRect(x, y, w, PILL_H, PILL_H, PILL_H);
        g.setColor(BORDER);
        g.drawRoundRect(x, y, w, PILL_H, PILL_H, PILL_H);

        int cx = x + 12;
        if (l != null) {
            drawBattery(g, cx, y + 8, 100 - l.percent(), color);
            cx += battW;
        }
        int base = y + 17;
        text(g, F_BOLD, color, main, cx, base);
        text(g, F_SMALL, MUTED, sub, cx + fmMain.stringWidth(main), base);
    }

    /** 电池图标：剩余额度越少电越少。 */
    private static void drawBattery(Graphics2D g, int x, int y, double remain, Color color) {
        int w = 16;
        int h = 10;
        g.setColor(MUTED);
        g.drawRoundRect(x, y, w, h, 3, 3);
        g.fillRect(x + w + 1, y + 3, 2, h - 5);
        int fill = (int) Math.round((w - 3) * Math.max(0, Math.min(100, remain)) / 100.0);
        g.setColor(color);
        g.fillRect(x + 2, y + 2, fill, h - 3);
    }

    private void paintPet(Graphics2D g, int h) {
        Mood mood = mood();
        int ground = h - 10;
        int left = (WIDTH - 16 * PX) / 2;
        boolean sleep = mood == Mood.SLEEP;
        int bob = (int) ((frame / (sleep ? 12 : 6)) % 2);
        int top = ground - 9 * PX + bob * PX;

        // 影子
        g.setColor(new Color(0, 0, 0, 40));
        g.fillOval(left + PX, ground - 4, 14 * PX, 8);

        // 腿：身体往下一沉腿就变短；鼠标放上去会原地踏步
        g.setColor(CLAWD);
        int legTop = top + BODY.length * PX;
        for (int k = 0; k < LEGS.length; k++) {
            int lift = hover && !sleep && (k % 2 == (frame / 3) % 2) ? PX / 2 : 0;
            g.fillRect(left + LEGS[k] * PX, legTop, PX, ground - lift - legTop);
        }

        // 身体
        boolean wave = hover && !sleep;
        boolean armUp = wave && (frame / 3) % 2 == 0;
        for (int r = 0; r < BODY.length; r++) {
            for (int c = 0; c < 16; c++) {
                if (BODY[r].charAt(c) != '#') {
                    continue;
                }
                if (armUp && r == 4 && c >= 14) {
                    continue; // 右手举起来打招呼
                }
                g.fillRect(left + c * PX, top + r * PX, PX, PX);
            }
        }
        if (armUp) {
            g.fillRect(left + 14 * PX, top + 3 * PX, 2 * PX, PX);
            g.fillRect(left + 15 * PX, top + 2 * PX, PX, PX);
        }

        // 眼睛
        g.setColor(EYE);
        boolean blink = frame < blinkUntil;
        if (sleep) {
            g.fillRect(left + (EYE_L - 1) * PX, top + 2 * PX + PX / 2, 2 * PX, PX / 2);
            g.fillRect(left + EYE_R * PX, top + 2 * PX + PX / 2, 2 * PX, PX / 2);
        } else if (blink || mood == Mood.TIRED) {
            g.fillRect(left + EYE_L * PX, top + 2 * PX, PX, PX);
            g.fillRect(left + EYE_R * PX, top + 2 * PX, PX, PX);
        } else {
            g.fillRect(left + EYE_L * PX, top + PX, PX, 2 * PX);
            g.fillRect(left + EYE_R * PX, top + PX, PX, 2 * PX);
        }

        // 心情特效
        if (mood == Mood.SWEAT || mood == Mood.TIRED) {
            int drop = (int) (frame % 16);
            int dx = left + PX / 2;
            int dy = top - PX + Math.min(drop, 10) * 2;
            g.setColor(SWEAT);
            g.fillRect(dx + PX / 2, dy, PX / 2, PX / 2);
            g.fillRect(dx, dy + PX / 2, PX, PX);
        }
        if (sleep) {
            for (int k = 0; k < 3; k++) {
                double t = ((frame + k * 10) % 30) / 30.0;
                outlined(g, F_ZZZ, "z", left + 15 * PX + (int) (t * 14), top - (int) (t * 24), (int) (255 * (1 - t)));
            }
        } else if (remote == null && remoteError != null) {
            outlined(g, new Font(Font.DIALOG, Font.BOLD, 18), "?", left + 15 * PX, top - 2, 255);
        }
    }

    /** 白字黑边，在深色、浅色桌面上都看得清。 */
    private static void outlined(Graphics2D g, Font f, String s, int x, int y, int alpha) {
        g.setFont(f);
        g.setColor(new Color(0, 0, 0, alpha * 3 / 5));
        g.drawString(s, x + 1, y + 1);
        g.drawString(s, x - 1, y + 1);
        g.setColor(new Color(255, 255, 255, alpha));
        g.drawString(s, x, y);
    }

    /** 额度用得越多，Clawd 越累；用光了就睡觉（没电了）。 */
    private Mood mood() {
        if (remote == null) {
            return Mood.NORMAL;
        }
        double max = 0;
        for (Usage.Limit l : remote.limits()) {
            if (!l.key().equals("extra_usage")) {
                max = Math.max(max, l.percent());
            }
        }
        if (max >= 100) {
            return Mood.SLEEP;
        }
        if (max >= 90) {
            return Mood.TIRED;
        }
        return max >= 70 ? Mood.SWEAT : Mood.NORMAL;
    }

    private static Color levelColor(double pct) {
        return pct >= 80 ? RED : pct >= 50 ? ORANGE : GREEN;
    }

    private static void drawBar(Graphics2D g, int x, int y, int w, double pct) {
        g.setColor(TRACK);
        g.fillRoundRect(x, y, w, 6, 6, 6);
        int fill = (int) Math.round(w * Math.max(0, Math.min(100, pct)) / 100.0);
        if (fill > 0) {
            g.setColor(levelColor(pct));
            g.fillRoundRect(x, y, Math.max(fill, 6), 6, 6, 6);
        }
    }

    private void text(Graphics2D g, Font f, Color c, String s, int x, int baseline) {
        if (g == null || s.isEmpty()) {
            return;
        }
        g.setFont(f);
        g.setColor(c);
        g.drawString(s, x, baseline);
    }

    private void textRight(Graphics2D g, Font f, Color c, String s, int right, int baseline) {
        text(g, f, c, s, right - getFontMetrics(f).stringWidth(s), baseline);
    }

    /** 按宽度折行（中文没有空格，所以按字符折）。 */
    private List<String> wrap(String s, Font f, int maxW) {
        FontMetrics fm = getFontMetrics(f);
        List<String> lines = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (int k = 0; k < s.length(); k++) {
            char ch = s.charAt(k);
            if (cur.length() > 0 && fm.stringWidth(cur.toString() + ch) > maxW) {
                lines.add(cur.toString());
                cur.setLength(0);
            }
            cur.append(ch);
        }
        if (cur.length() > 0) {
            lines.add(cur.toString());
        }
        return lines;
    }
}
