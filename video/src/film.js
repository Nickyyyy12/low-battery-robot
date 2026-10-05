// 《146 天》画面。renderFrame(ctx, t) 只依赖时间 t，可以从任意一帧开始画，
// 所以渲染时可以拆成几段并行。
(function () {
  const TL = window.Timeline;
  const { W, H, S, OPEN, LOOP, MATH, JD, SPLIT, SAME, NOW, DAYS, HOURS_PER_DAY, START, DEADLINE } = TL;

  const C = {
    bg: '#060708',
    white: '#F2F2EF',
    soft: '#C3C7CC',
    gray: '#7C828A',
    dim: '#4E535A',
    faint: '#202327',
    red: '#FF3B30',
    redDim: '#B3463E',
    amber: '#FFB547',
    amberDim: '#B98A45',
  };
  const SANS = '"Noto Sans SC", sans-serif';
  const MONO = '"JetBrains Mono", monospace';

  // ---------- 小工具 ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (u) => 1 - Math.pow(1 - u, 3);
  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  function rnd(a, b = 0) {
    let t = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + 0x9e3779b9) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss(a, b) {
    const u = Math.max(1e-6, rnd(a, b));
    const v = rnd(a, b + 7777);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (o) => `${o.y}.${pad2(o.m)}.${pad2(o.d)}`;
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function mixColor(a, b, u) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (p, s) => (p >> s) & 255;
    const r = Math.round(lerp(ch(pa, 16), ch(pb, 16), u));
    const g = Math.round(lerp(ch(pa, 8), ch(pb, 8), u));
    const bl = Math.round(lerp(ch(pa, 0), ch(pb, 0), u));
    return `rgb(${r},${g},${bl})`;
  }

  function font(size, weight, mono) {
    return `${weight} ${size}px ${mono ? MONO : SANS}`;
  }

  // 画一行字。o: size, weight, mono, color, alpha, align, scale, glow, spacing
  function text(ctx, str, x, y, o = {}) {
    const a = o.alpha == null ? 1 : o.alpha;
    if (a <= 0.002) return;
    ctx.save();
    ctx.font = font(o.size || 64, o.weight || 700, o.mono);
    ctx.fillStyle = o.color || C.white;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.globalAlpha *= a;
    if (o.spacing) ctx.letterSpacing = o.spacing + 'px';
    if (o.glow) { ctx.shadowColor = o.glowColor || o.color || C.white; ctx.shadowBlur = o.glow; }
    if (o.scale && o.scale !== 1) {
      ctx.translate(x, y);
      ctx.scale(o.scale, o.scale);
      ctx.fillText(str, 0, 0);
    } else {
      ctx.fillText(str, x, y);
    }
    ctx.restore();
  }

  // 多段不同颜色/字体的字拼成一行。parts: [str, color, {size, weight, mono}?]
  function rich(ctx, parts, x, y, o = {}) {
    const a = o.alpha == null ? 1 : o.alpha;
    if (a <= 0.002) return 0;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.globalAlpha *= a;
    const fonts = parts.map((p) => {
      const f = Object.assign({ size: o.size || 48, weight: o.weight || 700, mono: false }, p[2] || {});
      return font(f.size, f.weight, f.mono);
    });
    const widths = parts.map((p, i) => { ctx.font = fonts[i]; return ctx.measureText(p[0]).width; });
    const total = widths.reduce((s, w) => s + w, 0);
    const align = o.align || 'center';
    let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
    const sc = o.scale || 1;
    if (sc !== 1) {
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      ctx.translate(-x, -y);
    }
    if (o.glow) ctx.shadowBlur = o.glow;
    parts.forEach((p, i) => {
      ctx.font = fonts[i];
      ctx.fillStyle = p[1];
      if (o.glow) ctx.shadowColor = p[1];
      ctx.fillText(p[0], cx, y + (o.dy || 0));
      cx += widths[i];
    });
    ctx.restore();
    return total;
  }

  // 入场 / 出场
  function appear(t, tin, tout, o = {}) {
    const inD = o.inD == null ? 0.45 : o.inD;
    const outD = o.outD == null ? 0.35 : o.outD;
    if (t < tin) return null;
    if (tout != null && t > tout + outD) return null;
    let a = 1, dy = 0, s = 1;
    if (o.kind === 'slam') {
      const q = clamp((t - tin) / 0.16);
      a = clamp(q * 1.8);
      s = lerp(1.32, 1, easeOut(q));
    } else if (o.kind !== 'cut') {
      const e = easeOut(clamp((t - tin) / inD));
      a = e;
      dy = (1 - e) * (o.rise == null ? 22 : o.rise);
    }
    if (tout != null && t > tout) a *= 1 - clamp((t - tout) / outD);
    return { a, dy, s };
  }
  function show(ctx, t, str, x, y, tin, tout, o = {}) {
    const st = appear(t, tin, tout, o);
    if (!st) return;
    text(ctx, str, x, y + st.dy, Object.assign({}, o, { alpha: (o.alpha == null ? 1 : o.alpha) * st.a, scale: st.s }));
  }
  function showRich(ctx, t, parts, x, y, tin, tout, o = {}) {
    const st = appear(t, tin, tout, o);
    if (!st) return;
    rich(ctx, parts, x, y + st.dy, Object.assign({}, o, { alpha: (o.alpha == null ? 1 : o.alpha) * st.a, scale: st.s }));
  }

  // 数字 + 单位（数字用等宽字体，单位用中文字体，基线对齐）
  function numberUnit(ctx, num, unit, cx, cy, o) {
    const a = o.alpha == null ? 1 : o.alpha;
    if (a <= 0.002) return;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(o.size, 800, true);
    const nw = ctx.measureText(num).width;
    ctx.font = font(o.unitSize, 900, false);
    const uw = unit ? ctx.measureText(unit).width : 0;
    const gap = unit ? o.size * 0.08 : 0;
    const total = nw + gap + uw;
    const base = cy + o.size * 0.36;
    ctx.translate(cx, cy);
    const sc = o.scale || 1;
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    if (o.glow) { ctx.shadowBlur = o.glow; ctx.shadowColor = o.color; }
    let x = cx - total / 2;
    ctx.textAlign = 'left';
    ctx.font = font(o.size, 800, true);
    ctx.fillStyle = o.color;
    ctx.fillText(num, x, base);
    if (unit) {
      ctx.font = font(o.unitSize, 900, false);
      ctx.fillStyle = o.unitColor || o.color;
      ctx.fillText(unit, x + nw + gap, base);
    }
    ctx.restore();
  }

  // 「明天再开始」的故障效果
  function glitchText(ctx, str, x, y, o, seed, amount) {
    if (amount > 0.01) {
      const dx = 4 + 14 * amount;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      text(ctx, str, x + dx * (rnd(seed, 1) - 0.3), y, Object.assign({}, o, { color: 'rgba(255,40,60,0.75)' }));
      text(ctx, str, x - dx * (rnd(seed, 2) - 0.3), y + 2, Object.assign({}, o, { color: 'rgba(60,200,255,0.45)' }));
      ctx.restore();
    }
    text(ctx, str, x, y, o);
    if (amount > 0.01) {
      const h = o.size;
      for (let i = 0; i < 3; i++) {
        const by = y - h * 0.6 + rnd(seed, 10 + i) * h * 1.2;
        const bh = 4 + rnd(seed, 20 + i) * 16;
        const off = (rnd(seed, 30 + i) - 0.5) * 70 * amount;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, by, W, bh);
        ctx.clip();
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, by, W, bh);
        text(ctx, str, x + off, y, o);
        ctx.restore();
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function checkMark(ctx, x, y, size, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.22, y + size * 0.52);
    ctx.lineTo(x + size * 0.43, y + size * 0.72);
    ctx.lineTo(x + size * 0.8, y + size * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- 预计算 ----------
  let ash = null; // 开场那句话碎成的灰
  let dust = null; // 每一次「明天」落下的灰
  const grain = [];
  const OPEN_QUOTE = '「我现在什么都不会。」';
  const Q_SIZE = 76;
  const Q_Y = 520;

  function buildAsh() {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = 200;
    const c = cv.getContext('2d');
    c.font = font(Q_SIZE, 400, false);
    const qw = c.measureText(OPEN_QUOTE).width;
    const x0 = W / 2 - qw / 2;
    c.fillStyle = '#fff';
    c.textBaseline = 'middle';
    c.fillText(OPEN_QUOTE, x0, 100);
    const img = c.getImageData(0, 0, W, 200).data;
    const xs = [], ys = [];
    const step = 2;
    for (let y = 0; y < 200; y += step) {
      for (let x = Math.floor(x0) - 4; x < x0 + qw + 4; x += step) {
        if (img[(y * W + x) * 4 + 3] > 110) { xs.push(x); ys.push(y - 100 + Q_Y); }
      }
    }
    const n = xs.length;
    ash = { n, x0, qw, x: Float32Array.from(xs), y: Float32Array.from(ys), vx: new Float32Array(n), vy: new Float32Array(n), ph: new Float32Array(n), life: new Float32Array(n), delay: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      ash.vx[i] = 30 + (rnd(i, 1) - 0.4) * 110;
      ash.vy[i] = -10 - rnd(i, 2) * 70;
      ash.ph[i] = rnd(i, 3) * Math.PI * 2;
      ash.life[i] = 2.2 + rnd(i, 4) * 3.2;
      ash.delay[i] = ((xs[i] - x0) / qw) * 0.22;
    }
  }

  function buildDust() {
    const per = 150;
    const n = LOOP.mingtian.length * per;
    const binW = 6;
    const bins = new Float32Array(Math.ceil(W / binW) + 2);
    dust = { n, x0: new Float32Array(n), y0: new Float32Array(n), x1: new Float32Array(n), y1: new Float32Array(n), t0: new Float32Array(n), dur: new Float32Array(n), size: new Float32Array(n), shade: new Float32Array(n) };
    let i = 0;
    LOOP.mingtian.forEach((mt, k) => {
      for (let j = 0; j < per; j++, i++) {
        const x0 = W / 2 + (rnd(i, 1) - 0.5) * 520;
        const y0 = 500 + (rnd(i, 2) - 0.5) * 80;
        const x1 = clamp(x0 + gauss(i, 3) * 420, 10, W - 10);
        const size = 2 + rnd(i, 4) * 2.6;
        const b = Math.floor(x1 / binW);
        const y1 = H - 26 - bins[b] - size;
        bins[b] += size * 1.2;
        bins[b - 1] += size * 0.5;
        bins[b + 1] += size * 0.5;
        dust.x0[i] = x0; dust.y0[i] = y0; dust.x1[i] = x1; dust.y1[i] = y1;
        dust.t0[i] = S.loop + mt + rnd(i, 5) * 0.12;
        dust.dur[i] = 0.75 + rnd(i, 6) * 0.9;
        dust.size[i] = size;
        dust.shade[i] = rnd(i, 7);
      }
    });
  }

  function buildGrain() {
    for (let g = 0; g < 4; g++) {
      const cv = document.createElement('canvas');
      cv.width = 960;
      cv.height = 540;
      const c = cv.getContext('2d');
      const im = c.createImageData(960, 540);
      for (let p = 0; p < 960 * 540; p++) {
        const v = Math.floor(rnd(p, g + 100) * 255);
        im.data[p * 4] = v; im.data[p * 4 + 1] = v; im.data[p * 4 + 2] = v; im.data[p * 4 + 3] = 255;
      }
      c.putImageData(im, 0, 0);
      grain.push(cv);
    }
  }

  // 所有会出现在画面上的字，用来提前加载字体子集
  function corpus() {
    const strs = [];
    (function walk(v) {
      if (typeof v === 'string') strs.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    })(TL);
    strs.push(OPEN_QUOTE, '所以呢？你打算什么时候开始「会」？第天「明天再开始」×',
      '你不是在等状态。你是在等一个可以不开始的理由。',
      '你说，你想在明年三月拿到 offer。浙江 / 西安 · 互联网大厂 · Java 后端 · 月薪 20K 今天是年月日。',
      '天小时减掉睡觉、上课、吃饭、通勤、发呆……你每天真正能给它的：从「什么都不会」到大厂 offer。够吗？不一定。但 0 小时，一定不够。',
      '这是你想要的那个岗位。它不关心你迷不迷茫。它只要这 7 条：你现在能勾几条？你问「学这个有什么用」——每一条，三月的面试官都会当面问你。你说「不知道下一步学什么」——现在知道了：从第 1 条开始。',
      '明天再开始的你今天就开始的你「明天」×已投入月',
      '三月。春招开了。7 条要求，你一条也勾不上。然后你对自己说：「明年三月再说吧。」三月。你坐在面试官对面。「说一下 HashMap 的底层原理。」你差点笑出来——你学的第一个就是它。offer · Java 后端 · 20K',
      '你总觉得，明天的自己会更想学。不会的。明天的你，跟今天一样累，一样怕难，一样想再等等。这两个你，今天还是同一个人。分开他们的，只有今天。',
      '关掉这个视频。打开 IDEA。现在。今天 · 3 小时ArrayList + HashMap就用你写过的 Robot 类：用 ArrayList 装下一支机器人队伍，用 HashMap 按名字一下找到 Nicky。顺手 1 道题：LeetCode 第 1 题「两数之和」——它也用 HashMap。距离还有秒明天不会来。三月会。',
      '0123456789,.:/×−+= ');
    return Array.from(new Set(strs.join(''))).join('');
  }

  async function init() {
    const all = corpus();
    const loads = [];
    for (const w of [400, 700, 900]) loads.push(document.fonts.load(font(40, w, false), all));
    for (const w of [500, 800]) loads.push(document.fonts.load(font(40, w, true), '0123456789,.:/×−+= ArrayList HashMap'));
    await Promise.all(loads);
    await document.fonts.ready;
    buildAsh();
    buildDust();
    buildGrain();
  }

  // ---------- 全局：抖动、闪白 ----------
  function shake(t) {
    let x = 0, y = 0;
    for (const h of TL.hits) {
      const dt = t - h.t;
      if (dt < 0 || dt > 1.2) continue;
      const amp = h.shake * Math.exp(-dt * 7);
      const f = Math.floor(t * 60);
      x += amp * (rnd(f, 11) * 2 - 1);
      y += amp * (rnd(f, 12) * 2 - 1);
    }
    return [x, y];
  }
  function flash(t) {
    let f = 0;
    for (const h of TL.hits) {
      const dt = t - h.t;
      if (dt < 0) continue;
      f += h.flash * Math.exp(-dt * 12);
    }
    return Math.min(f, 0.35);
  }

  // ======================================================================
  // 第 1 幕：冷开场
  // ======================================================================
  function drawOpen(ctx, t) {
    const s = t - S.open;
    const n = s < OPEN.typeStart ? 0 : Math.min(OPEN_QUOTE.length, Math.floor((s - OPEN.typeStart) / OPEN.typeStep) + 1);
    const x0 = ash.x0;

    if (s < OPEN.shatter) {
      const shown = OPEN_QUOTE.slice(0, n);
      text(ctx, shown, x0, Q_Y, { size: Q_SIZE, weight: 400, color: '#D4D7DB', align: 'left' });
      ctx.font = font(Q_SIZE, 400, false);
      const cx = x0 + ctx.measureText(shown).width + 6;
      const typing = s >= OPEN.typeStart && s < OPEN.typeStart + OPEN_QUOTE.length * OPEN.typeStep;
      if (typing || Math.floor(s * 1.8) % 2 === 0) {
        ctx.fillStyle = C.white;
        ctx.fillRect(cx, Q_Y - Q_SIZE * 0.52, 5, Q_SIZE * 1.02);
      }
    }

    // 一道光把字切开
    const ls = OPEN.shatter - 0.22;
    if (s >= ls && s < OPEN.shatter + 0.35) {
      const u = seg(s, ls, OPEN.shatter + 0.1);
      const lx = lerp(x0 - 200, x0 + ash.qw + 200, easeInOut(u));
      const fade = 1 - seg(s, OPEN.shatter + 0.1, OPEN.shatter + 0.35);
      ctx.save();
      ctx.globalAlpha = fade;
      const g = ctx.createLinearGradient(lx - 260, 0, lx + 40, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - 260, Q_Y - 3, 300, 6);
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx - 30, Q_Y - 2, 40, 4);
      ctx.restore();
      if (s < OPEN.shatter) {
        // 光还没扫到的部分仍然是字
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx, 0, W, H);
        ctx.clip();
        text(ctx, OPEN_QUOTE, x0, Q_Y, { size: Q_SIZE, weight: 400, color: '#D4D7DB', align: 'left' });
        ctx.restore();
      }
    }

    // 灰
    if (s >= ls) {
      ctx.save();
      for (let i = 0; i < ash.n; i++) {
        const lit = ls + ash.delay[i];
        if (s < lit) continue;
        const dt = s - lit;
        const life = ash.life[i];
        if (dt > life) continue;
        const k = dt / life;
        const x = ash.x[i] + ash.vx[i] * dt + Math.sin(dt * 1.7 + ash.ph[i]) * 14 * k;
        const y = ash.y[i] + ash.vy[i] * dt + 0.5 * 46 * dt * dt;
        const a = (1 - k) * (dt < 0.25 ? 1 : 0.85);
        const v = Math.round(lerp(225, 90, Math.min(1, k * 1.6)));
        ctx.fillStyle = `rgba(${v},${v},${v + 3},${a})`;
        const sz = 2 * (1 - k * 0.5);
        ctx.fillRect(x, y, sz, sz);
      }
      ctx.restore();
    }

    show(ctx, s, '所以呢？', W / 2, 430, OPEN.shatter + 0.05, OPEN.len - 0.6, { size: 150, weight: 900, kind: 'slam', outD: 0.5 });
    show(ctx, s, '你打算什么时候开始「会」？', W / 2, 620, OPEN.when, OPEN.len - 0.6, { size: 66, weight: 700, color: C.soft, outD: 0.5 });
  }

  // ======================================================================
  // 第 2 幕：「明天」循环
  // ======================================================================
  function drawLoop(ctx, t) {
    const s = t - S.loop;
    const endFade = 1 - seg(s, LOOP.len - 0.6, LOOP.len);

    // 落下来的灰
    const fr = S.loop + LOOP.freeze;
    const sl = S.loop + LOOP.slam;
    const pc = t < fr ? t : t < sl ? fr : fr + (t - sl) * 3.5;
    ctx.save();
    ctx.globalAlpha = endFade;
    for (let i = 0; i < dust.n; i++) {
      if (pc < dust.t0[i]) continue;
      const u = Math.min(1, (pc - dust.t0[i]) / dust.dur[i]);
      let x, y;
      if (u >= 1) { x = dust.x1[i]; y = dust.y1[i]; }
      else {
        x = lerp(dust.x0[i], dust.x1[i], easeOut(u));
        y = lerp(dust.y0[i], dust.y1[i], u * u);
      }
      const v = Math.round(lerp(70, 110, dust.shade[i]) + (u < 1 ? 50 : 0));
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
      ctx.fillRect(x, y, dust.size[i], dust.size[i]);
    }
    ctx.restore();

    // 计数
    let k = 0;
    while (k + 1 < LOOP.cycleStarts.length && LOOP.cycleStarts[k + 1] <= s) k++;
    const frozen = s >= LOOP.freeze;
    const nM = LOOP.mingtian.filter((m) => m <= s).length;
    const cAlpha = (frozen ? 0.45 : 1) * endFade * seg(s, 0, 0.4);
    rich(ctx, [['第 ', C.gray], [String(k + 1), C.white, { mono: true, weight: 800, size: 46 }], [' 天', C.gray]], 110, 100, { size: 38, weight: 700, align: 'left', alpha: cAlpha });
    if (nM > 0) {
      rich(ctx, [['「明天再开始」× ', C.redDim], [String(nM), C.red, { mono: true, weight: 800, size: 46 }]], W - 110, 100, { size: 38, weight: 700, align: 'right', alpha: cAlpha });
    }

    if (!frozen) {
      const cs = LOOP.cycleStarts[k];
      const mt = LOOP.mingtian[k];
      if (s >= mt) {
        const age = s - mt;
        const amount = age < 0.2 ? 1 - age / 0.2 * 0.6 : 0.12 * (Math.floor(s * 30) % 3 === 0 ? 1 : 0);
        glitchText(ctx, '明天再开始。', W / 2, 500, { size: 96, weight: 900, color: C.red }, Math.floor(s * 30) + k * 31, amount);
      } else {
        const each = (mt - cs) / 8;
        const i = Math.min(7, Math.floor((s - cs) / each));
        const age = s - cs - i * each;
        const fast = each < 0.3;
        text(ctx, LOOP.phrases[i], W / 2, 500, {
          size: fast ? 70 : 80, weight: 700, color: fast ? C.soft : C.white,
          alpha: fast ? 0.8 : clamp(age / 0.1),
        });
      }
    }

    show(ctx, s, '你不是在等状态。', W / 2, 430, LOOP.line1, LOOP.len - 0.6, { size: 104, weight: 900, outD: 0.5 });
    show(ctx, s, '你是在等一个可以不开始的理由。', W / 2, 600, LOOP.slam, LOOP.len - 0.6, { size: 90, weight: 900, color: C.red, kind: 'slam', outD: 0.5 });
  }

  // ======================================================================
  // 第 3 幕：算账
  // ======================================================================
  function mathValue(s) {
    if (s < MATH.roll[1]) return lerp(DAYS, DAYS * 24, easeOut(seg(s, MATH.roll[0], MATH.roll[1])));
    let cur = DAYS * 24;
    let val = cur;
    MATH.subs.forEach((sub, i) => {
      const ts = MATH.subStart + i * MATH.subStep;
      if (s >= ts) {
        const from = cur;
        cur -= sub.v;
        val = lerp(from, cur, easeOut(seg(s, ts, ts + 0.45)));
      }
    });
    return val;
  }

  function drawMath(ctx, t) {
    const s = t - S.math;

    show(ctx, s, '你说，你想在明年三月拿到 offer。', W / 2, 380, MATH.say, MATH.clear, { size: 62, weight: 700 });

    // 目标卡片
    const card = appear(s, MATH.card, MATH.clear);
    if (card) {
      const parts = [['浙江 / 西安', C.amber], ['  ·  ', C.amberDim], ['互联网大厂', C.amber], ['  ·  ', C.amberDim], ['Java 后端', C.amber], ['  ·  ', C.amberDim], ['月薪 20K', C.amber]];
      ctx.save();
      ctx.globalAlpha = card.a;
      ctx.font = font(42, 700, false);
      const w = parts.reduce((acc, p) => acc + ctx.measureText(p[0]).width, 0) + 100;
      roundRect(ctx, W / 2 - w / 2, 530 - 52 + card.dy, w, 104, 12);
      ctx.fillStyle = 'rgba(255,181,71,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,181,71,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      rich(ctx, parts, W / 2, 530 + card.dy, { size: 42, weight: 700, alpha: card.a });
    }
    show(ctx, s, `今天是 ${START.y} 年 ${START.m} 月 ${START.d} 日。`, W / 2, 690, MATH.today, MATH.clear, { size: 50, weight: 400, color: C.soft });

    // 146 天
    const big = appear(s, MATH.big, MATH.toHours, { kind: 'slam', outD: 0.3 });
    if (big) numberUnit(ctx, String(DAYS), '天', W / 2, 540, { size: 400, unitSize: 120, color: C.white, alpha: big.a, scale: big.s });

    // 主数字：小时
    const toCenter = easeInOut(seg(s, MATH.back, MATH.back + 0.6));
    const toRight = easeInOut(seg(s, MATH.move, MATH.move + 0.6));
    const cx = lerp(lerp(W / 2, 1290, toRight), W / 2, toCenter);
    const main = appear(s, MATH.roll[0], MATH.clear2, { kind: 'cut' });
    if (main) {
      const col = mixColor(C.white, C.amber, toCenter);
      const fadeIn = seg(s, MATH.roll[0], MATH.roll[0] + 0.2);
      numberUnit(ctx, String(Math.round(mathValue(s))), '小时', cx, 560, { size: 280, unitSize: 96, color: col, alpha: main.a * fadeIn, glow: toCenter > 0 ? 30 * toCenter : 0 });
    }
    const f1 = appear(s, MATH.toHours + 0.2, MATH.back);
    if (f1) text(ctx, `${DAYS} × 24 =`, cx, 360 + f1.dy, { size: 56, weight: 500, mono: true, color: C.gray, alpha: f1.a });
    const f2 = appear(s, MATH.back + 0.2, MATH.clear2);
    if (f2) text(ctx, `${DAYS} × ${HOURS_PER_DAY} =`, cx, 360 + f2.dy, { size: 56, weight: 500, mono: true, color: C.gray, alpha: f2.a });

    // 一项项减掉
    show(ctx, s, '减掉睡觉、上课、吃饭、通勤、发呆……', 170, 300, MATH.move, MATH.back, { size: 42, weight: 700, color: C.soft, align: 'left' });
    MATH.subs.forEach((sub, i) => {
      const st = appear(s, MATH.subStart + i * MATH.subStep, MATH.back, { inD: 0.3, rise: 14 });
      if (!st) return;
      text(ctx, '−' + sub.v, 440, 410 + i * 80 + st.dy, { size: 50, weight: 800, mono: true, color: C.redDim, align: 'right', alpha: st.a });
      text(ctx, sub.label, 470, 410 + i * 80 + st.dy, { size: 40, weight: 700, color: C.soft, align: 'left', alpha: st.a });
    });

    showRich(ctx, s, [['你每天真正能给它的：', C.soft], [`${HOURS_PER_DAY} 小时`, C.amber]], W / 2, 230, MATH.give, MATH.clear2, { size: 54, weight: 700 });

    showRich(ctx, s, [[`${TL.HOURS} 小时`, C.amber], ['，从「什么都不会」到大厂 offer。', C.white]], W / 2, 420, MATH.l1, MATH.clear3, { size: 56, weight: 700 });
    show(ctx, s, '够吗？', W / 2, 550, MATH.l2, MATH.clear3, { size: 96, weight: 900 });
    show(ctx, s, '不一定。', W / 2, 680, MATH.l3, MATH.clear3, { size: 54, weight: 400, color: C.gray });
    show(ctx, s, '但 0 小时，一定不够。', W / 2, 540, MATH.slam, MATH.len - 0.5, { size: 124, weight: 900, color: C.red, kind: 'slam', outD: 0.5 });
  }

  // ======================================================================
  // 第 4 幕：那张清单
  // ======================================================================
  function drawJD(ctx, t) {
    const s = t - S.jd;
    const endFade = 1 - seg(s, JD.out, JD.len);

    show(ctx, s, '这是你想要的那个岗位。', W / 2, 118, JD.l1, JD.headOut, { size: 54, weight: 700 });
    show(ctx, s, '它不关心你迷不迷茫。它只要这 7 条：', W / 2, 192, JD.l2, JD.headOut, { size: 44, weight: 400, color: C.soft });

    // 卡片
    if (s >= JD.card) {
      const dim = lerp(1, 0.3, seg(s, JD.dim, JD.dim + 0.5));
      const cardA = lerp(dim, 0.6, seg(s, JD.q2b, JD.q2b + 0.5)) * endFade;
      const x = 400, y = 268, w = 1120, h = 690;
      const p = easeInOut(seg(s, JD.card, JD.card + 0.7));
      const per = 2 * (w + h);
      ctx.save();
      ctx.globalAlpha = cardA;
      roundRect(ctx, x, y, w, h, 16);
      ctx.fillStyle = `rgba(255,255,255,${0.03 * p})`;
      ctx.fill();
      ctx.setLineDash([per * p, per]);
      ctx.strokeStyle = 'rgba(242,242,239,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      const hA = seg(s, JD.card + 0.4, JD.card + 0.8) * cardA;
      text(ctx, JD.title, x + 50, 322, { size: 40, weight: 900, align: 'left', alpha: hA });
      text(ctx, JD.place, x + w - 50, 322, { size: 34, weight: 700, color: C.amber, align: 'right', alpha: hA });
      ctx.save();
      ctx.globalAlpha = hA;
      ctx.fillStyle = 'rgba(242,242,239,0.18)';
      ctx.fillRect(x + 50, 372, w - 100, 2);
      ctx.restore();

      JD.items.forEach((item, i) => {
        const st = appear(s, JD.row0 + i * JD.rowStep, null, { inD: 0.3, rise: 10 });
        if (!st) return;
        const ry = 432 + i * 74 + st.dy;
        const hl = i === 0 ? seg(s, JD.q2b, JD.q2b + 0.4) : 0;
        const rowA = st.a * lerp(cardA, endFade, hl);
        // 格子
        let stroke = C.gray;
        let fill = null;
        if (s >= JD.zero) {
          const z = s - JD.zero;
          const pulse = z < 1.0 ? 0.5 + 0.5 * Math.cos(z * Math.PI * 6) : 0;
          stroke = z < 1.0 ? C.red : C.redDim;
          fill = `rgba(255,59,48,${0.45 * pulse})`;
        }
        if (hl > 0) { stroke = mixColor(C.redDim, C.amber, hl); fill = `rgba(255,181,71,${0.18 * hl})`; }
        ctx.save();
        ctx.globalAlpha = rowA;
        if (hl > 0) { ctx.shadowColor = C.amber; ctx.shadowBlur = 24 * hl * (0.7 + 0.3 * Math.sin(s * 5)); }
        roundRect(ctx, x + 50, ry - 18, 36, 36, 6);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
        text(ctx, String(i + 1), x + 68, ry + 1, { size: 18, weight: 800, mono: true, color: stroke, alpha: rowA });
        text(ctx, item, x + 112, ry, { size: 34, weight: 700, align: 'left', color: hl > 0 ? mixColor(C.white, C.amber, hl) : C.white, alpha: rowA });
      });
    }

    show(ctx, s, '你现在能勾几条？', W / 2, 165, JD.ask, JD.zero - 0.06, { size: 62, weight: 900, outD: 0.06 });
    show(ctx, s, '0 / 7', W / 2, 160, JD.zero, JD.dim - 0.4, { size: 140, weight: 800, mono: true, color: C.red, kind: 'slam', outD: 0.4 });

    show(ctx, s, '你问「学这个有什么用」——', W / 2, 112, JD.q1a, JD.q1out, { size: 48, weight: 700, color: C.soft });
    show(ctx, s, '每一条，三月的面试官都会当面问你。', W / 2, 188, JD.q1b, JD.q1out, { size: 54, weight: 900 });
    show(ctx, s, '你说「不知道下一步学什么」——', W / 2, 112, JD.q2a, JD.out, { size: 48, weight: 700, color: C.soft, outD: 0.5 });
    show(ctx, s, '现在知道了：从第 1 条开始。', W / 2, 188, JD.q2b, JD.out, { size: 54, weight: 900, color: C.amber, outD: 0.5 });
  }

  // ======================================================================
  // 第 5 幕：两条时间线
  // ======================================================================
  const MONTH_NAMES = ['10 月', '11 月', '12 月', '1 月', '2 月'];
  const LX = W / 4;
  const RX = (W * 3) / 4;

  function drawLabels(ctx, a, lx, rx) {
    text(ctx, '明天再开始的你', lx, 300, { size: 52, weight: 900, color: '#8A9097', alpha: a });
    text(ctx, '今天就开始的你', rx, 300, { size: 52, weight: 900, color: C.amber, alpha: a });
  }

  function drawSplit(ctx, t) {
    const s = t - S.split;
    const dRaw = SPLIT.dayAt(s);
    const day = Math.min(DAYS, Math.floor(dRaw + 1e-6));
    const prog = dRaw / DAYS;
    const uiA = 1 - seg(s, SPLIT.fadeUI, SPLIT.fadeUI + 0.6);
    const outA = 1 - seg(s, SPLIT.out, SPLIT.len);
    const pt = Math.min(s, SPLIT.zero) + Math.max(0, s - SPLIT.zero - 1.5);
    const resultsL = seg(s, SPLIT.left[0] - 0.3, SPLIT.left[0] + 0.2);
    const resultsR = seg(s, SPLIT.right[0] - 0.4, SPLIT.right[0] + 0.2);

    // 两边的底色
    const tint = seg(s, 0.6, 1.6) * outA;
    ctx.save();
    ctx.globalAlpha = tint;
    ctx.fillStyle = 'rgba(150,160,170,0.035)';
    ctx.fillRect(0, 0, W / 2, H);
    const warm = 0.04 + 0.13 * Math.min(prog, 1);
    const g = ctx.createRadialGradient(RX, H + 80, 50, RX, H + 80, 1100);
    g.addColorStop(0, `rgba(255,170,60,${warm})`);
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(W / 2, 0, W / 2, H);
    ctx.restore();

    // 左：往下掉的灰；右：往上升的光
    ctx.save();
    ctx.globalAlpha = tint;
    for (let i = 0; i < 80; i++) {
      const x = 30 + rnd(i, 41) * (W / 2 - 60);
      const sp = 18 + rnd(i, 42) * 34;
      const y = (rnd(i, 43) * H + pt * sp) % H;
      ctx.fillStyle = `rgba(120,126,134,${0.18 + 0.25 * rnd(i, 44)})`;
      ctx.fillRect(x, y, 2, 2);
    }
    const nSpark = 30 + Math.floor(130 * Math.min(prog, 1));
    for (let i = 0; i < nSpark; i++) {
      const x = W / 2 + 30 + rnd(i, 51) * (W / 2 - 60);
      const sp = 40 + rnd(i, 52) * 80;
      const y = H - ((rnd(i, 53) * H + pt * sp) % H);
      const a = (0.25 + 0.5 * rnd(i, 54)) * Math.min(1, y / 300);
      ctx.fillStyle = `rgba(255,190,90,${a})`;
      const sz = 1.5 + rnd(i, 55) * 2;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.restore();

    // 中线
    const lineP = easeInOut(seg(s, 0, 1.2));
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(242,242,239,0.55)';
    ctx.fillRect(W / 2 - 1, H / 2 - (H / 2) * lineP, 2, H * lineP);
    ctx.restore();

    drawLabels(ctx, seg(s, 1.0, 1.6), LX, RX);

    // 日期和倒计时
    const bA = seg(s, 0.8, 1.4) * outA;
    if (bA > 0) {
      ctx.save();
      ctx.globalAlpha = bA;
      roundRect(ctx, W / 2 - 190, 58, 380, 184, 14);
      ctx.fillStyle = C.bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(242,242,239,0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      text(ctx, fmtDate(TL.dateAfter(day)), W / 2, 104, { size: 36, weight: 500, mono: true, color: C.soft, alpha: bA });
      const zs = s >= SPLIT.zero ? lerp(1.5, 1, easeOut(seg(s, SPLIT.zero, SPLIT.zero + 0.2))) : 1;
      numberUnit(ctx, String(DAYS - day), '天', W / 2, 180, { size: 100, unitSize: 36, color: C.red, alpha: bA, scale: zs, glow: s >= SPLIT.zero ? 30 : 0 });
    }

    // 计数
    const cA = seg(s, 1.6, 2.2) * uiA;
    rich(ctx, [['「明天」× ', C.redDim], [String(day), C.red, { mono: true, weight: 800, size: 42 }]], LX, 370, { size: 34, weight: 700, alpha: cA });
    rich(ctx, [['已投入 ', C.amberDim], [String(day * HOURS_PER_DAY), C.amber, { mono: true, weight: 800, size: 42 }], [' 小时', C.amberDim]], RX, 370, { size: 34, weight: 700, alpha: cA });

    // 清单
    SPLIT.short.forEach((name, i) => {
      const rA = seg(s, 2.0 + i * 0.06, 2.4 + i * 0.06) * uiA;
      if (rA <= 0) return;
      const y = 448 + i * 50;
      // 左：永远是空的
      ctx.save();
      ctx.globalAlpha = rA;
      roundRect(ctx, LX - 312, y - 13, 26, 26, 5);
      ctx.strokeStyle = '#41464C';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      text(ctx, name, LX - 270, y, { size: 30, weight: 700, color: '#50565D', align: 'left', alpha: rA });
      // 右：一条条点亮
      const [a, b] = SPLIT.progress[i];
      const p = clamp((dRaw - a) / (b - a));
      const bx = RX - 312;
      ctx.save();
      ctx.globalAlpha = rA;
      if (p > 0) {
        ctx.save();
        roundRect(ctx, bx, y - 13, 26, 26, 5);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,181,71,0.92)';
        ctx.fillRect(bx, y + 13 - 26 * p, 26, 26 * p);
        ctx.restore();
      }
      roundRect(ctx, bx, y - 13, 26, 26, 5);
      ctx.strokeStyle = p > 0 ? C.amber : '#5A5F66';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      if (p >= 1) {
        checkMark(ctx, bx, y - 13, 26, '#1A1206', 3.4);
        const tc = SPLIT.timeOfDay(b);
        const z = s - tc;
        if (z >= 0 && z < 0.9) {
          ctx.save();
          ctx.globalAlpha = rA * (1 - z / 0.9);
          ctx.strokeStyle = C.amber;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(bx + 13, y, 16 + z * 60, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      const col = p >= 1 ? C.white : p > 0 ? C.amber : '#5A5F66';
      text(ctx, name, RX - 270, y, { size: 30, weight: 700, color: col, align: 'left', alpha: rA, glow: p > 0 && p < 1 ? 14 : 0 });
    });

    // 每个月一句话
    let m = 0;
    while (m + 1 < SPLIT.months.length && SPLIT.months[m + 1].from <= dRaw) m++;
    if (s >= SPLIT.run[0]) {
      const tm = m === 0 ? SPLIT.run[0] : SPLIT.timeOfDay(SPLIT.months[m].from);
      const mA = seg(s, tm, tm + 0.35) * uiA;
      const dy = (1 - easeOut(seg(s, tm, tm + 0.35))) * 14;
      rich(ctx, [[MONTH_NAMES[m] + '　', C.gray], [SPLIT.months[m].left, C.soft]], LX, 842 + dy, { size: 34, weight: 700, alpha: mA });
      rich(ctx, [[MONTH_NAMES[m] + '　', C.amberDim], [SPLIT.months[m].right, C.amber]], RX, 842 + dy, { size: 32, weight: 700, alpha: mA });
    }

    // 146 个格子
    const gA = seg(s, 1.8, 2.4) * outA;
    if (gA > 0) {
      const cell = 18, gap = 5, rows = 5;
      const gw = Math.ceil(DAYS / rows) * (cell + gap) - gap;
      for (const side of [0, 1]) {
        const x0 = (side ? RX : LX) - gw / 2;
        const y0 = 908;
        ctx.save();
        ctx.globalAlpha = gA * (side ? 1 - 0.5 * resultsL * (1 - resultsR) : 1 - 0.5 * resultsR);
        for (let k = 0; k < DAYS; k++) {
          const cx = x0 + Math.floor(k / rows) * (cell + gap);
          const cy = y0 + (k % rows) * (cell + gap);
          if (k < day) {
            if (side) {
              const b = 0.55 + 0.45 * rnd(k, 9);
              ctx.fillStyle = `rgba(255,181,71,${b})`;
            } else {
              ctx.fillStyle = '#383C42';
            }
          } else {
            ctx.fillStyle = '#15171A';
          }
          ctx.fillRect(cx, cy, cell, cell);
        }
        ctx.restore();
      }
    }

    // 三月：两种结局
    const dimL = 0.6 * resultsR;
    const dimR = 0.6 * resultsL * (1 - resultsR);
    ctx.save();
    if (dimR > 0) { ctx.fillStyle = `rgba(6,7,8,${dimR})`; ctx.fillRect(W / 2 + 1, 250, W / 2, 620); }
    if (dimL > 0) { ctx.fillStyle = `rgba(6,7,8,${dimL})`; ctx.fillRect(0, 250, W / 2 - 1, 620); }
    ctx.restore();

    const lOut = SPLIT.out;
    const la = 1 - 0.55 * resultsR;
    show(ctx, s, '三月。春招开了。', LX, 470, SPLIT.left[0], lOut, { size: 44, weight: 700, alpha: la, outD: 0.8 });
    show(ctx, s, '7 条要求，你一条也勾不上。', LX, 548, SPLIT.left[1], lOut, { size: 44, weight: 700, alpha: la, outD: 0.8 });
    show(ctx, s, '然后你对自己说：', LX, 626, SPLIT.left[2], lOut, { size: 44, weight: 700, color: C.soft, alpha: la, outD: 0.8 });
    show(ctx, s, '「明年三月再说吧。」', LX, 730, SPLIT.left[3], lOut, { size: 62, weight: 900, color: C.red, alpha: la, outD: 0.8 });

    show(ctx, s, '三月。你坐在面试官对面。', RX, 440, SPLIT.right[0], lOut, { size: 44, weight: 700, outD: 0.8 });
    show(ctx, s, '「说一下 HashMap 的底层原理。」', RX, 516, SPLIT.right[1], lOut, { size: 40, weight: 700, color: C.soft, outD: 0.8 });
    show(ctx, s, '你差点笑出来——', RX, 592, SPLIT.right[2], lOut, { size: 44, weight: 700, outD: 0.8 });
    show(ctx, s, `${START.m} 月 ${START.d} 日，你学的第一个就是它。`, RX, 664, SPLIT.right[3], lOut, { size: 44, weight: 700, outD: 0.8 });
    showRich(ctx, s, [['offer', C.amber, { mono: true, weight: 800 }], ['  ·  ', C.amberDim], ['Java 后端', C.amber], ['  ·  ', C.amberDim], ['20K', C.amber, { mono: true, weight: 800 }]], RX, 776, SPLIT.right[4], lOut, { size: 64, weight: 900, glow: 28, outD: 0.8, inD: 0.8 });
  }

  // ======================================================================
  // 第 6 幕：同一个人
  // ======================================================================
  function drawSame(ctx, t) {
    const s = t - S.same;
    const p = easeInOut(seg(s, SAME.conv[0] + 0.1, SAME.conv[1] - 0.2));
    if (p < 1) {
      drawLabels(ctx, 1 - p, lerp(LX, W / 2 - 120, p), lerp(RX, W / 2 + 120, p));
      const half = (H / 2) * (1 - p);
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(242,242,239,0.55)';
      ctx.fillRect(W / 2 - 1, H / 2 - half, 2, half * 2);
      ctx.restore();
    }
    // 收拢成一个光点
    const dotA = seg(s, 1.2, 1.8) * (1 - seg(s, 2.0, 2.8)) + seg(s, SAME.line, SAME.line + 0.6) * (1 - seg(s, SAME.out, SAME.out + 0.8));
    const lineY = s < SAME.line ? H / 2 : 566;
    if (dotA > 0) {
      ctx.save();
      ctx.globalAlpha = dotA;
      const half = 640 * easeOut(seg(s, SAME.line, SAME.line + 1.4));
      if (half > 1) {
        const g = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
        g.addColorStop(0, 'rgba(242,242,239,0)');
        g.addColorStop(0.5, 'rgba(242,242,239,0.6)');
        g.addColorStop(1, 'rgba(242,242,239,0)');
        ctx.fillStyle = g;
        ctx.fillRect(W / 2 - half, lineY - 1, half * 2, 2);
      }
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 34;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(W / 2, lineY, 5 + 1.2 * Math.sin(s * 3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    show(ctx, s, '你总觉得，明天的自己会更想学。', W / 2, 470, SAME.a, SAME.aOut, { size: 58, weight: 700 });
    show(ctx, s, '不会的。', W / 2, 430, SAME.b, SAME.bcOut, { size: 70, weight: 900 });
    show(ctx, s, '明天的你，跟今天一样累，一样怕难，一样想再等等。', W / 2, 545, SAME.c, SAME.bcOut, { size: 48, weight: 400, color: C.soft, inD: 0.7 });
    show(ctx, s, '这两个你，今天还是同一个人。', W / 2, 440, SAME.d, SAME.out, { size: 58, weight: 700, outD: 0.8 });
    show(ctx, s, '分开他们的，只有今天。', W / 2, 700, SAME.e, SAME.out, { size: 84, weight: 900, inD: 0.9, outD: 0.8 });
  }

  // ======================================================================
  // 第 7 幕：现在
  // ======================================================================
  function drawNow(ctx, t) {
    const s = t - S.now;
    show(ctx, s, '关掉这个视频。', W / 2, 540, NOW.h1, NOW.h1out, { size: 130, weight: 900, kind: 'slam', outD: 0.06 });
    show(ctx, s, '打开 IDEA。', W / 2, 540, NOW.h2, NOW.h2out, { size: 130, weight: 900, kind: 'slam', outD: 0.06 });
    show(ctx, s, '现在。', W / 2, 540, NOW.h3, NOW.h3out, { size: 300, weight: 900, color: C.red, kind: 'slam', outD: 0.4 });

    // 今天的任务
    const card = appear(s, NOW.card, NOW.cardOut, { inD: 0.7, outD: 0.6 });
    if (card) {
      const x = 310, y = 214 + card.dy, w = 1300, h = 430;
      ctx.save();
      ctx.globalAlpha = card.a;
      roundRect(ctx, x, y, w, h, 16);
      ctx.fillStyle = 'rgba(255,181,71,0.045)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,181,71,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      const lx = x + 70;
      rich(ctx, [['今天 · ', C.amber], [`${HOURS_PER_DAY} 小时`, C.amber]], lx, y + 70, { size: 36, weight: 700, align: 'left', alpha: card.a });
      text(ctx, 'ArrayList + HashMap', lx, y + 168, { size: 86, weight: 800, mono: true, align: 'left', alpha: card.a });
      text(ctx, '就用你写过的 Robot 类：用 ArrayList 装下一支机器人队伍，', lx, y + 268, { size: 34, weight: 400, color: C.soft, align: 'left', alpha: card.a });
      text(ctx, '用 HashMap 按名字一下找到 Nicky。', lx, y + 318, { size: 34, weight: 400, color: C.soft, align: 'left', alpha: card.a });
      text(ctx, '顺手 1 道题：LeetCode 第 1 题「两数之和」——它也用 HashMap。', lx, y + 382, { size: 30, weight: 400, color: C.gray, align: 'left', alpha: card.a });
    }

    const secs = TL.SECONDS - Math.max(0, Math.floor(s - NOW.count));
    const cd = appear(s, NOW.count, NOW.cardOut, { inD: 0.6, outD: 0.6 });
    if (cd) {
      rich(ctx, [['距离 ', C.soft], [fmtDate(DEADLINE), C.white, { mono: true, weight: 500 }], [' 还有 ', C.soft], [String(DAYS), C.red, { mono: true, weight: 800 }], [' 天', C.red]], W / 2, 742 + cd.dy, { size: 40, weight: 700, alpha: cd.a });
      rich(ctx, [[fmtInt(secs), C.red, { mono: true, weight: 800, size: 78 }], [' 秒', C.soft]], W / 2, 842 + cd.dy, { size: 40, weight: 700, alpha: cd.a });
    }

    show(ctx, s, '明天不会来。', W / 2, 470, NOW.f1, NOW.fade[0], { size: 124, weight: 900, inD: 0.9, outD: NOW.fade[1] - NOW.fade[0] });
    show(ctx, s, '三月会。', W / 2, 650, NOW.f2, NOW.fade[0], { size: 124, weight: 900, color: C.red, inD: 0.9, outD: NOW.fade[1] - NOW.fade[0] });
    const tailA = seg(s, NOW.f1, NOW.f1 + 1) * (1 - seg(s, NOW.fade[0], NOW.fade[1]));
    rich(ctx, [[fmtInt(secs), C.gray, { mono: true, weight: 500 }], [' 秒', C.dim]], W / 2, 990, { size: 30, weight: 400, alpha: tailA * 0.8 });
  }

  // ======================================================================
  function post(ctx, t) {
    // 颗粒
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.028;
    ctx.drawImage(grain[Math.floor(t * 24) % grain.length], 0, 0, W, H);
    ctx.restore();
    // 暗角
    const v = ctx.createRadialGradient(W / 2, H / 2, 380, W / 2, H / 2, 1150);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    // 闪白
    const f = flash(t);
    if (f > 0.003) {
      ctx.fillStyle = `rgba(255,250,245,${f})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function renderFrame(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const [sx, sy] = shake(t);
    ctx.save();
    ctx.translate(sx, sy);
    if (t < S.loop) drawOpen(ctx, t);
    else if (t < S.math) drawLoop(ctx, t);
    else if (t < S.jd) drawMath(ctx, t);
    else if (t < S.split) drawJD(ctx, t);
    else if (t < S.same) drawSplit(ctx, t);
    else if (t < S.now) drawSame(ctx, t);
    else drawNow(ctx, t);
    ctx.restore();
    post(ctx, t);
  }

  window.Film = { init, renderFrame };
})();
