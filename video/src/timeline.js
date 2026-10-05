// 《146 天》时间轴：画面（film.js）和音效（audio.js）共用这一份时间表。
// 所有时间单位都是秒。每一幕内部用相对时间，S 里记录每一幕的绝对起点。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 1920;
  const H = 1080;
  const FPS = 30;

  // ---- 关键日期（按观看者所在地的日期） ----
  const START = { y: 2026, m: 10, d: 6 };
  const DEADLINE = { y: 2027, m: 3, d: 1 };
  const HOURS_PER_DAY = 3;
  const utc = (o) => Date.UTC(o.y, o.m - 1, o.d);
  const DAYS = Math.round((utc(DEADLINE) - utc(START)) / 86400000); // 146
  const HOURS = DAYS * HOURS_PER_DAY; // 438
  const SECONDS = DAYS * 86400; // 12,614,400

  function dateAfter(days) {
    const dt = new Date(utc(START) + days * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function dayIndexOf(o) {
    return Math.round((utc(o) - utc(START)) / 86400000);
  }

  // ---- 每一幕 ----
  const OPEN = { typeStart: 1.6, typeStep: 0.2, shatter: 5.3, when: 8.2, len: 12 };

  // 「明天」循环：37 个越来越短的日子
  const LOOP_DAYS = 37;
  const cycles = [8.0, 4.0, 2.4, 1.6, 1.2, 0.95, 0.8];
  {
    let d = 0.62;
    const r = Math.pow(0.2 / 0.62, 1 / (LOOP_DAYS - cycles.length - 1));
    while (cycles.length < LOOP_DAYS) { cycles.push(d); d *= r; }
  }
  const cycleStarts = [];
  const mingtian = []; // 每一次「明天再开始」出现的相对时间
  {
    let acc = 0;
    cycles.forEach((D, k) => {
      cycleStarts.push(acc);
      const lastFrac = k === 0 ? 0.2 : D > 2 ? 0.28 : 0.45;
      mingtian.push(acc + D * (1 - lastFrac));
      acc += D;
    });
  }
  const loopRun = cycles.reduce((a, b) => a + b, 0);
  const LOOP = {
    phrases: ['打开 IDEA。', '看了二十分钟教程。', '好难。', '好无聊。', '学这个到底有什么用？',
      '下一步该学什么？不知道。', '换个教程，从头再看。', '今天状态不好。', '明天再开始。'],
    cycles, cycleStarts, mingtian,
    freeze: loopRun,
    line1: loopRun + 0.3,
    slam: loopRun + 2.5,
    len: loopRun + 6.4,
  };

  const MATH = {
    say: 0.6, card: 2.6, today: 4.8, clear: 6.8, big: 7.3,
    toHours: 9.0, roll: [9.3, 10.5], move: 11.2, subStart: 11.8, subStep: 1.1,
    subs: [
      { label: '睡觉', v: 8 * DAYS },
      { label: '上课和作业', v: 6 * DAYS },
      { label: '吃饭洗漱', v: 2.5 * DAYS },
      { label: '通勤', v: 1.5 * DAYS },
      { label: '发呆和其他', v: 3 * DAYS },
    ],
    back: 17.6, give: 18.0, clear2: 20.6,
    l1: 21.0, l2: 23.2, l3: 25.6, clear3: 27.0, slam: 27.4, len: 30.9,
  };

  const JD = {
    title: 'Java 后端开发工程师 · 校招',
    place: '浙江 / 西安 · 20K',
    items: [
      '扎实的 Java 基础，熟悉集合、多线程与并发',
      '理解 JVM 内存模型与垃圾回收',
      '熟悉 MySQL：索引、事务、SQL 调优',
      '熟悉 Redis 及缓存常见问题',
      '熟悉 Spring Boot / MyBatis 等主流框架',
      '有完整的后端项目经验',
      '扎实的数据结构与算法基础',
    ],
    l1: 0.3, l2: 2.0, card: 3.4, row0: 4.2, rowStep: 0.75, headOut: 9.6,
    ask: 10.0, zero: 11.6, dim: 14.0, q1a: 14.2, q1b: 15.4, q1out: 18.4,
    q2a: 18.8, q2b: 20.0, out: 23.4, len: 24.0,
  };

  // 两条时间线：146 天在 36 秒里跑完，越跑越快
  const SPLIT = {
    run: [2.5, 38.5], exp: 1.15,
    short: ['Java 基础 · 集合 · 并发', 'JVM', 'MySQL', 'Redis', 'Spring Boot / MyBatis', '完整的后端项目', '数据结构与算法'],
    // 右边每一条要求在第几天开始、第几天完成（按 146 天排的，换日期时等比例缩放）
    progress: [[0, 40], [40, 56], [56, 72], [72, 87], [87, 105], [100, 138], [0, 142]]
      .map(([a, b]) => [a * DAYS / 146, b * DAYS / 146]),
    months: [
      { from: 0, left: '「等下周一，从头开始。」', right: '在学：Java 基础、ArrayList、HashMap' },
      { from: dayIndexOf({ y: 2026, m: 11, d: 1 }), left: '「先考完试再说。」', right: '在学：多线程与并发、JVM' },
      { from: dayIndexOf({ y: 2026, m: 12, d: 1 }), left: '「刚放假，先休息几天。」', right: '在学：MySQL、Redis' },
      { from: dayIndexOf({ y: 2027, m: 1, d: 1 }), left: '「过完年再好好学。」', right: '在学：Spring Boot、MyBatis、开始做项目' },
      { from: dayIndexOf({ y: 2027, m: 2, d: 1 }), left: '「……好像来不及了。」', right: '在学：做完项目、刷完 Hot 100、写简历' },
    ],
    zero: 38.5, fadeUI: 40.5,
    left: [41.2, 42.6, 44.2, 45.6],
    right: [48.8, 50.4, 52.2, 53.6, 55.6],
    out: 59.6, len: 60.5,
  };
  SPLIT.dayAt = (s) => {
    const u = Math.min(1, Math.max(0, (s - SPLIT.run[0]) / (SPLIT.run[1] - SPLIT.run[0])));
    return DAYS * Math.pow(u, SPLIT.exp);
  };
  SPLIT.timeOfDay = (d) => SPLIT.run[0] + (SPLIT.run[1] - SPLIT.run[0]) * Math.pow(d / DAYS, 1 / SPLIT.exp);

  const SAME = { conv: [0, 2.0], a: 2.4, aOut: 5.4, b: 5.8, c: 7.2, bcOut: 11.4, line: 11.6, d: 12.0, e: 14.6, out: 18.4, len: 19.6 };

  const NOW = {
    h1: 0.8, h1out: 2.4, h2: 2.6, h2out: 4.2, h3: 4.4, h3out: 6.6,
    card: 7.4, tick0: 7.6, count: 9.6, cardOut: 17.0, f1: 18.0, f2: 19.6, fade: [25.0, 26.5], len: 28,
  };

  const S = {};
  S.open = 0;
  S.loop = S.open + OPEN.len;
  S.math = S.loop + LOOP.len;
  S.jd = S.math + MATH.len;
  S.split = S.jd + JD.len;
  S.same = S.split + SPLIT.len;
  S.now = S.same + SAME.len;
  const DURATION = S.now + NOW.len;

  // 重击：画面抖动 + 闪白，音效同一时刻一声低频重击
  const hits = [
    { t: S.open + OPEN.shatter, shake: 6, flash: 0.14, k: 0.7 },
    { t: S.loop + LOOP.slam, shake: 10, flash: 0.1, k: 0.9 },
    { t: S.math + MATH.big, shake: 8, flash: 0.1, k: 0.85 },
    { t: S.math + MATH.slam, shake: 10, flash: 0.14, k: 1.0 },
    { t: S.jd + JD.zero, shake: 7, flash: 0.08, k: 0.75 },
    { t: S.split + SPLIT.zero, shake: 14, flash: 0.22, k: 1.25 },
    { t: S.now + NOW.h1, shake: 7, flash: 0.06, k: 0.8 },
    { t: S.now + NOW.h2, shake: 7, flash: 0.06, k: 0.85 },
    { t: S.now + NOW.h3, shake: 16, flash: 0.18, k: 1.3 },
  ];

  return {
    W, H, FPS, START, DEADLINE, DAYS, HOURS, HOURS_PER_DAY, SECONDS,
    dateAfter, OPEN, LOOP, MATH, JD, SPLIT, SAME, NOW, S, DURATION, hits,
  };
});
