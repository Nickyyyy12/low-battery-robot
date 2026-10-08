package clawd;

import javax.swing.JCheckBoxMenuItem;
import javax.swing.JMenuItem;
import javax.swing.JPopupMenu;
import javax.swing.JWindow;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.UnsupportedLookAndFeelException;
import java.awt.Color;
import java.awt.Cursor;
import java.awt.GraphicsEnvironment;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.prefs.Preferences;

/**
 * 小 Clawd 桌宠：常驻桌面，显示 Claude 各项额度、重置时间和今日 token 用量。
 *
 * <ul>
 *   <li>左键点 Clawd：展开 / 收起面板</li>
 *   <li>按住拖动：移动位置（会记住）</li>
 *   <li>右键：刷新、置顶、退出</li>
 * </ul>
 *
 * 启动参数 --demo 使用假数据预览外观。
 */
public final class ClawdPet {
    private static final long REMOTE_EVERY_SEC = 300; // 额度接口有频率限制，5 分钟一次足够
    private static final long LOCAL_EVERY_SEC = 60;
    private static final long RENEW_GAP_MS = 30 * 60_000; // 自动续期失败后，至少隔半小时再试

    private final boolean demo;
    private final JWindow window = new JWindow();
    private final PetPanel panel = new PetPanel();
    private final UsageClient client = new UsageClient();
    private final LocalUsageScanner scanner = new LocalUsageScanner();
    private final Preferences prefs = Preferences.userNodeForPackage(ClawdPet.class);
    private final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "clawd-io");
        t.setDaemon(true);
        return t;
    });
    private volatile long lastRemoteFetch;
    private volatile boolean retrySoon;
    private volatile long lastRenewAttempt;
    private volatile String lastRenewFailure;
    private volatile boolean renewDidNotHelp; // 续期后还是读不到令牌，就别再浪费额度反复续期
    private volatile boolean autoRenew = prefs.getBoolean("autoRenew", true);

    private ClawdPet(boolean demo) {
        this.demo = demo;
    }

    public static void main(String[] args) {
        System.setProperty("java.net.useSystemProxies", "true");
        System.setProperty("apple.awt.UIElement", "true"); // macOS 上不在程序坞显示图标
        if (GraphicsEnvironment.isHeadless()) {
            System.err.println("桌宠需要图形界面，当前环境没有显示器。");
            System.exit(1);
        }
        boolean demo = Arrays.asList(args).contains("--demo");
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()); // 菜单用系统原生外观
        } catch (ReflectiveOperationException | UnsupportedLookAndFeelException ignored) {
            // 用默认外观
        }
        JPopupMenu.setDefaultLightWeightPopupEnabled(false);
        SwingUtilities.invokeLater(() -> new ClawdPet(demo).start());
    }

    private void start() {
        removeOldSavedToken();
        panel.setExpanded(prefs.getBoolean("expanded", true));
        window.setBackground(new Color(0, 0, 0, 0));
        window.setContentPane(panel);
        window.setAlwaysOnTop(prefs.getBoolean("alwaysOnTop", true));
        window.setSize(PetPanel.WIDTH, panel.preferredHeight());
        window.setLocation(initialLocation());
        installMouse();

        new Timer(100, e -> {
            panel.tick();
            autoRefresh();
        }).start();

        if (demo) {
            panel.setRemote(demoRemote());
            panel.setLocal(demoLocal());
            fitHeight();
        } else {
            io.scheduleWithFixedDelay(this::loadRemote, 0, REMOTE_EVERY_SEC, TimeUnit.SECONDS);
            io.scheduleWithFixedDelay(this::loadLocal, 0, LOCAL_EVERY_SEC, TimeUnit.SECONDS);
        }
        window.setVisible(true);
    }

    // ---------- 数据加载（后台线程） ----------

    private void loadRemote() {
        lastRemoteFetch = System.currentTimeMillis();
        SwingUtilities.invokeLater(() -> panel.setFetching(true));
        try {
            Usage.Remote r = fetchRenewingIfNeeded();
            retrySoon = false;
            renewDidNotHelp = false;
            lastRenewFailure = null;
            SwingUtilities.invokeLater(() -> {
                panel.setRemote(r);
                fitHeight();
            });
        } catch (UsageClient.UsageException e) {
            retrySoon = e.retrySoon;
            SwingUtilities.invokeLater(() -> {
                panel.setRemoteError(e.getMessage()); // 保留上一次的数据，只多显示一行错误
                fitHeight();
            });
        } catch (RuntimeException e) {
            SwingUtilities.invokeLater(() -> {
                panel.setRemoteError("出错了：" + e);
                fitHeight();
            });
        }
    }

    /** 令牌过期时先在后台运行一次 claude 让它续期，再查一次。 */
    private Usage.Remote fetchRenewingIfNeeded() throws UsageClient.UsageException {
        try {
            return client.fetch();
        } catch (UsageClient.UsageException e) {
            long now = System.currentTimeMillis();
            if (!e.needsRenew || !autoRenew) {
                throw e;
            }
            if (renewDidNotHelp || now - lastRenewAttempt < RENEW_GAP_MS) {
                if (lastRenewFailure != null) { // 让失败原因一直显示，直到下次重试
                    throw new UsageClient.UsageException(lastRenewFailure, true);
                }
                throw e;
            }
            lastRenewAttempt = now;
            SwingUtilities.invokeLater(() -> {
                panel.setRemoteError("登录过期了，Clawd 正在后台运行 claude 帮你续期…");
                panel.setFetching(true);
                fitHeight();
            });
            String failure = ClaudeRenewer.renew();
            if (failure != null) {
                lastRenewFailure = "自动续期失败（" + failure + "）。" + e.getMessage();
                throw new UsageClient.UsageException(lastRenewFailure, true);
            }
            lastRenewFailure = null;
            loadLocal();
            try {
                return client.fetch();
            } catch (UsageClient.UsageException again) {
                if (again.needsRenew) {
                    renewDidNotHelp = true;
                    lastRenewFailure = "已在后台运行 claude 续期，但还是登录不上。"
                            + "请在终端运行 claude，输入 /login 重新登录，Clawd 会自动恢复";
                    throw new UsageClient.UsageException(lastRenewFailure, true);
                }
                throw again;
            }
        }
    }

    /** 旧版本「设置长期令牌」存下的令牌查不了额度，删掉免得留在磁盘上。 */
    private static void removeOldSavedToken() {
        try {
            Files.deleteIfExists(Path.of(System.getProperty("user.home"), ".clawd-pet", "token"));
        } catch (IOException ignored) {
            // 删不掉也不影响使用
        }
    }

    private void loadLocal() {
        try {
            Usage.Local l = scanner.scan();
            SwingUtilities.invokeLater(() -> {
                panel.setLocal(l);
                fitHeight();
            });
        } catch (RuntimeException e) {
            // 本地统计失败不影响额度显示
        }
    }

    private void refreshNow() {
        if (!demo) {
            io.execute(this::loadRemote);
            io.execute(this::loadLocal);
        }
    }

    /**
     * 两种情况不等 5 分钟的常规刷新：
     * 令牌过期等用户处理一下就能好的错误，每分钟重试；某项额度到了重置时间，过半分钟拉一次新数据。
     */
    private void autoRefresh() {
        if (demo) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastRemoteFetch <= 60_000) {
            return;
        }
        boolean due = retrySoon;
        Usage.Remote r = panel.remote();
        Instant reset = r == null ? null : r.nextReset();
        if (reset != null) {
            Instant after = reset.plusSeconds(30);
            due |= Instant.now().isAfter(after) && lastRemoteFetch < after.toEpochMilli();
        }
        if (due) {
            lastRemoteFetch = now;
            io.execute(this::loadRemote);
        }
    }

    // ---------- 窗口 ----------

    /** 内容高度变化时，保持 Clawd 脚下的位置不动，面板往上长。 */
    private void fitHeight() {
        int h = panel.preferredHeight();
        Rectangle b = window.getBounds();
        if (b.height != h) {
            window.setBounds(b.x, b.y + b.height - h, PetPanel.WIDTH, h);
            window.validate();
        }
        panel.repaint();
    }

    private Point initialLocation() {
        Rectangle screen = GraphicsEnvironment.getLocalGraphicsEnvironment().getMaximumWindowBounds();
        int x = prefs.getInt("x", Integer.MIN_VALUE);
        int bottom = prefs.getInt("bottom", Integer.MIN_VALUE);
        int h = window.getHeight();
        if (x != Integer.MIN_VALUE && onAnyScreen(x, bottom)) {
            return new Point(x, bottom - h);
        }
        return new Point(screen.x + screen.width - PetPanel.WIDTH - 24, screen.y + screen.height - h - 12);
    }

    private static boolean onAnyScreen(int x, int bottom) {
        for (var device : GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices()) {
            Rectangle r = device.getDefaultConfiguration().getBounds();
            if (r.contains(x + PetPanel.WIDTH / 2, bottom - 40)) {
                return true;
            }
        }
        return false;
    }

    private void savePosition() {
        prefs.putInt("x", window.getX());
        prefs.putInt("bottom", window.getY() + window.getHeight());
    }

    private void installMouse() {
        JPopupMenu menu = buildMenu();
        MouseAdapter m = new MouseAdapter() {
            private Point pressScreen;
            private Point pressWindow;
            private boolean dragged;

            @Override
            public void mousePressed(MouseEvent e) {
                if (e.isPopupTrigger()) {
                    menu.show(panel, e.getX(), e.getY());
                    return;
                }
                pressScreen = e.getLocationOnScreen();
                pressWindow = window.getLocation();
                dragged = false;
            }

            @Override
            public void mouseDragged(MouseEvent e) {
                if (pressScreen == null || !SwingUtilities.isLeftMouseButton(e)) {
                    return;
                }
                Point p = e.getLocationOnScreen();
                int dx = p.x - pressScreen.x;
                int dy = p.y - pressScreen.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) {
                    dragged = true;
                }
                if (dragged) {
                    window.setLocation(pressWindow.x + dx, pressWindow.y + dy);
                }
            }

            @Override
            public void mouseReleased(MouseEvent e) {
                if (e.isPopupTrigger()) {
                    menu.show(panel, e.getX(), e.getY());
                    return;
                }
                if (dragged) {
                    savePosition();
                } else if (SwingUtilities.isLeftMouseButton(e)) {
                    if (panel.petBounds().contains(e.getPoint())) {
                        toggleExpanded();
                    } else if (e.getClickCount() >= 2) {
                        refreshNow(); // 双击面板刷新
                    }
                }
                pressScreen = null;
                dragged = false;
            }

            @Override
            public void mouseMoved(MouseEvent e) {
                boolean onPet = panel.petBounds().contains(e.getPoint());
                panel.setHover(onPet);
                panel.setCursor(Cursor.getPredefinedCursor(onPet ? Cursor.HAND_CURSOR : Cursor.DEFAULT_CURSOR));
            }

            @Override
            public void mouseExited(MouseEvent e) {
                panel.setHover(false);
            }
        };
        panel.addMouseListener(m);
        panel.addMouseMotionListener(m);
    }

    private JPopupMenu buildMenu() {
        JPopupMenu menu = new JPopupMenu();
        JMenuItem refresh = new JMenuItem("立即刷新");
        refresh.addActionListener(e -> refreshNow());
        JMenuItem toggle = new JMenuItem("展开 / 收起面板");
        toggle.addActionListener(e -> toggleExpanded());
        JCheckBoxMenuItem onTop = new JCheckBoxMenuItem("始终置顶", window.isAlwaysOnTop());
        onTop.addActionListener(e -> {
            window.setAlwaysOnTop(onTop.isSelected());
            prefs.putBoolean("alwaysOnTop", onTop.isSelected());
        });
        JCheckBoxMenuItem renew = new JCheckBoxMenuItem("登录过期时自动续期", autoRenew);
        renew.addActionListener(e -> {
            autoRenew = renew.isSelected();
            prefs.putBoolean("autoRenew", autoRenew);
            if (autoRenew) {
                lastRenewAttempt = 0;
                renewDidNotHelp = false;
                refreshNow();
            }
        });
        JMenuItem quit = new JMenuItem("退出");
        quit.addActionListener(e -> {
            savePosition();
            System.exit(0);
        });
        menu.add(refresh);
        menu.add(toggle);
        menu.add(onTop);
        menu.add(renew);
        menu.addSeparator();
        menu.add(quit);
        return menu;
    }

    private void toggleExpanded() {
        panel.setExpanded(!panel.isExpanded());
        prefs.putBoolean("expanded", panel.isExpanded());
        fitHeight();
        savePosition();
    }

    // ---------- 预览用的假数据 ----------

    private static Usage.Remote demoRemote() {
        Instant now = Instant.now();
        return new Usage.Remote(List.of(
                new Usage.Limit("five_hour", "5 小时会话", "5h", 37, now.plus(Duration.ofMinutes(133))),
                new Usage.Limit("seven_day", "每周 · 全部模型", "本周", 62, now.plus(Duration.ofHours(77))),
                new Usage.Limit("seven_day_sonnet", "每周 · Sonnet", "Sonnet", 18, now.plus(Duration.ofHours(77)))
        ), now);
    }

    private static Usage.Local demoLocal() {
        Map<String, Long> byModel = new LinkedHashMap<>();
        byModel.put("Opus", 1_420_000L);
        byModel.put("Haiku", 250_400L);
        return new Usage.Local(true, 18_400, 342_000, 96_000, 1_214_000, 86, byModel);
    }
}
