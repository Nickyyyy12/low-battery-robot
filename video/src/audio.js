// 《146 天》的声音：全部用代码合成（秒针、心跳、低频、重击、故障噪音、拨弦、和弦），
// 时间点全部来自 timeline.js，和画面严格对齐。输出 48kHz 16-bit 立体声 WAV。
const fs = require('fs');
const TL = require('./timeline.js');

const SR = 48000;
const { S, OPEN, LOOP, MATH, JD, SPLIT, SAME, NOW, DAYS } = TL;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createMix(seconds) {
  const n = Math.ceil(seconds * SR);
  return {
    n,
    L: new Float32Array(n), R: new Float32Array(n), // 干声
    vL: new Float32Array(n), vR: new Float32Array(n), // 送混响
  };
}

// 把一个单声道发声器写进总线。gen(i, x) 返回第 i 个采样（x = 秒）。
function add(mix, t0, dur, gen, o = {}) {
  const gain = o.gain == null ? 1 : o.gain;
  const pan = o.pan || 0; // -1 左 .. 1 右
  const send = o.send || 0;
  const gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2 * gain;
  const gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2 * gain;
  const start = Math.max(0, Math.floor(t0 * SR));
  const end = Math.min(mix.n, Math.floor((t0 + dur) * SR));
  for (let i = start; i < end; i++) {
    const x = i / SR - t0;
    const v = gen(i - start, x);
    mix.L[i] += v * gl;
    mix.R[i] += v * gr;
    if (send) { mix.vL[i] += v * gl * send; mix.vR[i] += v * gr * send; }
  }
}

// ---------- 发声器 ----------
function tick(mix, t, accent, seed, level = 1) {
  const r = rng(seed);
  const f = accent ? 3400 : 2700;
  let prev = 0;
  add(mix, t, 0.06, (i, x) => {
    const n = r() * 2 - 1;
    const hp = n - prev; prev = n;
    return hp * Math.exp(-x / 0.0022) * 0.55 + Math.sin(2 * Math.PI * f * x) * Math.exp(-x / 0.007) * 0.35 +
      Math.sin(2 * Math.PI * 900 * x) * Math.exp(-x / 0.012) * 0.12;
  }, { gain: (accent ? 0.42 : 0.32) * level, pan: accent ? 0.12 : -0.12, send: 0.08 });
}

function thump(mix, t, f0, f1, decay, amp) {
  let ph = 0;
  add(mix, t, decay * 6, (i, x) => {
    const f = f1 + (f0 - f1) * Math.exp(-x / 0.05);
    ph += 2 * Math.PI * f / SR;
    const env = Math.min(1, x / 0.004) * Math.exp(-x / decay);
    return Math.tanh(Math.sin(ph) * env * 1.6) * amp;
  }, { send: 0.04 });
}

function heartbeat(mix, t) {
  thump(mix, t, 95, 48, 0.085, 0.42);
  thump(mix, t + 0.17, 85, 52, 0.07, 0.28);
}

function hit(mix, t, k, seed) {
  const r = rng(seed);
  let ph = 0, ph2 = 0, lp = 0, prev = 0;
  add(mix, t, 4.0, (i, x) => {
    const f = 26 + 52 * Math.exp(-x / 0.18);
    ph += 2 * Math.PI * f / SR;
    ph2 += 2 * Math.PI * 110 / SR;
    const sub = Math.sin(ph) * Math.min(1, x / 0.003) * Math.exp(-x / 0.75);
    const body = Math.sin(ph2) * Math.exp(-x / 0.12) * 0.35;
    const n = r() * 2 - 1;
    lp += (n - lp) * 0.06;
    const noise = lp * Math.exp(-x / 0.16) * 1.6;
    const crack = (n - prev) * Math.exp(-x / 0.012) * 0.35; prev = n;
    return Math.tanh((sub * 1.25 + body + noise + crack) * 1.4) * k * 0.95;
  }, { send: 0.3 });
}

function glitch(mix, t, seed) {
  const r = rng(seed);
  const dur = 0.11 + r() * 0.06;
  let f = 300 + r() * 1400, ph = 0, hold = 0;
  const pan = r() * 1.2 - 0.6;
  add(mix, t, dur, (i, x) => {
    if (i % 600 === 0) f = 200 + r() * 1800;
    ph += 2 * Math.PI * f / SR;
    if (i % 6 === 0) hold = Math.sign(Math.sin(ph)) * 0.6 + (r() * 2 - 1) * 0.5;
    const env = Math.min(1, x / 0.004) * (1 - x / dur);
    return hold * env;
  }, { gain: 0.12, pan });
}

function typing(mix, t, seed) {
  const r = rng(seed);
  let lp = 0, prev = 0;
  add(mix, t, 0.05, (i, x) => {
    const n = r() * 2 - 1;
    lp += (n - lp) * 0.35;
    const bp = lp - prev; prev = lp;
    return bp * Math.exp(-x / 0.008) * 2.2 + Math.sin(2 * Math.PI * 180 * x) * Math.exp(-x / 0.01) * 0.3;
  }, { gain: 0.35, pan: (r() - 0.5) * 0.3, send: 0.05 });
}

function blip(mix, t, f, gain) {
  add(mix, t, 0.5, (i, x) => {
    const env = Math.min(1, x / 0.004) * Math.exp(-x / 0.09);
    return (Math.sin(2 * Math.PI * f * x) + 0.25 * Math.sin(4 * Math.PI * f * x)) * env;
  }, { gain, send: 0.25 });
}

function buzz(mix, t, dur) {
  let lp = 0;
  add(mix, t, dur, (i, x) => {
    const sq = Math.sign(Math.sin(2 * Math.PI * 98 * x));
    lp += (sq - lp) * 0.08;
    const env = Math.min(1, x / 0.005) * Math.min(1, (dur - x) / 0.02);
    return lp * env;
  }, { gain: 0.22, send: 0.1 });
}

function pluck(mix, t, f, gain, seed) {
  const r = rng(seed);
  const len = Math.round(SR / f);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) buf[i] = r() * 2 - 1;
  let idx = 0;
  add(mix, t, 2.8, (i, x) => {
    const a = buf[idx];
    const b = buf[(idx + 1) % len];
    buf[idx] = (a + b) * 0.5 * 0.9965;
    idx = (idx + 1) % len;
    return a * Math.min(1, x / 0.002);
  }, { gain, send: 0.45, pan: 0.35 });
}

// 低频持续音：两组失谐锯齿波（加法合成），音高可以缓慢上升
function drone(mix, t0, t1, f0, f1, a0, a1, o = {}) {
  const dur = t1 - t0;
  const harmonics = 10;
  const ph = [0, 0, 0];
  const det = [1, 1.004, 0.9965];
  const fadeIn = o.fadeIn == null ? 1.5 : o.fadeIn;
  const fadeOut = o.fadeOut == null ? 0.01 : o.fadeOut;
  add(mix, t0, dur, (i, x) => {
    const u = x / dur;
    const f = f0 * Math.pow(f1 / f0, u);
    const amp = a0 + (a1 - a0) * u * u;
    let v = 0;
    for (let o2 = 0; o2 < 3; o2++) {
      ph[o2] += 2 * Math.PI * f * det[o2] / SR;
      for (let h = 1; h <= harmonics; h++) v += Math.sin(ph[o2] * h) / (h * h * 0.6 + 0.4);
    }
    const env = Math.min(1, x / fadeIn) * Math.min(1, (dur - x) / fadeOut);
    const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.35 * x);
    return v * 0.13 * amp * env * trem;
  }, { send: 0.15, gain: o.gain || 1 });
}

function pad(mix, t0, dur, freqs, gain, o = {}) {
  const att = o.attack || 1.2;
  const rel = o.release || 1.6;
  freqs.forEach((f, k) => {
    const det = 1 + (k % 2 ? 0.0025 : -0.002);
    add(mix, t0, dur + rel, (i, x) => {
      const env = Math.min(1, x / att) * (x > dur ? Math.max(0, 1 - (x - dur) / rel) : 1);
      const w = 2 * Math.PI * f * det * x;
      return (Math.sin(w) + 0.28 * Math.sin(2 * w) + 0.1 * Math.sin(3 * w)) * env;
    }, { gain: gain / freqs.length, send: 0.5, pan: (k / (freqs.length - 1 || 1) - 0.5) * 0.6 });
  });
}

function whoosh(mix, t0, dur, seed) {
  const r = rng(seed);
  let lp = 0;
  add(mix, t0, dur, (i, x) => {
    const u = x / dur;
    const c = 0.01 + 0.25 * u * u;
    lp += ((r() * 2 - 1) - lp) * c;
    return lp * Math.sin(Math.PI * u) * 1.4;
  }, { gain: 0.35, send: 0.3 });
}

// ---------- 混响（Schroeder） ----------
function reverb(input, delays, apDelays, fb) {
  const n = input.length;
  const out = new Float32Array(n);
  for (const d of delays) {
    const buf = new Float32Array(d);
    let idx = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const y = buf[idx];
      lp = y * 0.65 + lp * 0.35;
      buf[idx] = input[i] + lp * fb;
      idx = (idx + 1) % d;
      out[i] += y * 0.25;
    }
  }
  for (const d of apDelays) {
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[idx];
      const y = -out[i] * 0.5 + b;
      buf[idx] = out[i] + b * 0.5;
      idx = (idx + 1) % d;
      out[i] = y;
    }
  }
  return out;
}

// ---------- 编排 ----------
function compose() {
  const mix = createMix(TL.DURATION + 0.5);
  let seed = 1;

  // 第 1 幕
  for (let i = 0; i < 10; i++) typing(mix, S.open + OPEN.typeStart + i * OPEN.typeStep, seed++);
  hit(mix, TL.hits[0].t, TL.hits[0].k, seed++);
  for (let x = OPEN.when, n = 0; x < OPEN.len; x += 1, n++) tick(mix, S.open + x, n % 2 === 0, seed++);

  // 第 2 幕：秒针越来越快，每个「明天」一声故障噪音
  {
    const a = S.loop, b = S.loop + LOOP.freeze;
    let x = a, n = 0;
    while (x < b) {
      tick(mix, x, n % 2 === 0, seed++);
      const u = (x - a) / (b - a);
      x += 1 / (1 + 3 * Math.pow(u, 1.3));
      n++;
    }
    LOOP.mingtian.forEach((m) => glitch(mix, S.loop + m, seed++));
    drone(mix, a, b, 41, 58, 0.15, 1.0, { fadeIn: 3 });
    hit(mix, TL.hits[1].t, TL.hits[1].k, seed++);
  }

  // 第 3 幕：心跳
  {
    let x = MATH.say;
    while (x < MATH.slam - 0.3) {
      heartbeat(mix, S.math + x);
      x += x < MATH.subStart - 0.3 ? 0.95 : x < MATH.back ? 0.68 : 0.88;
    }
    hit(mix, TL.hits[2].t, TL.hits[2].k, seed++);
    MATH.subs.forEach((_, i) => thump(mix, S.math + MATH.subStart + i * MATH.subStep, 120, 70, 0.12, 0.35));
    drone(mix, S.math + MATH.give, S.math + MATH.l2, 55, 55, 0.25, 0.1, { fadeIn: 1.2, fadeOut: 1.5, gain: 0.6 });
    hit(mix, TL.hits[3].t, TL.hits[3].k, seed++);
  }

  // 第 4 幕
  {
    drone(mix, S.jd + JD.l1, S.jd + JD.zero, 49, 49, 0.3, 0.65, { fadeIn: 2, fadeOut: 0.05, gain: 1.0 });
    JD.items.forEach((_, i) => blip(mix, S.jd + JD.row0 + i * JD.rowStep, 1046, 0.16));
    hit(mix, TL.hits[4].t, TL.hits[4].k, seed++);
    [0, 0.33, 0.66].forEach((d) => buzz(mix, S.jd + JD.zero + d, 0.16));
    drone(mix, S.jd + JD.dim, S.jd + JD.len, 49, 49, 0.3, 0.2, { fadeIn: 1.5, fadeOut: 0.8, gain: 0.6 });
    blip(mix, S.jd + JD.q2b, 1318.5, 0.14);
  }

  // 第 5 幕：一天一下秒针，越来越快；右边每完成一条，一声拨弦
  {
    whoosh(mix, S.split, 1.3, seed++);
    for (let d = 1; d <= DAYS; d++) tick(mix, S.split + SPLIT.timeOfDay(d), d % 2 === 0, seed++);
    drone(mix, S.split + SPLIT.run[0] - 1, S.split + SPLIT.zero, 41, 82, 0.2, 1.2, { fadeIn: 3 });
    const notes = [440, 493.88, 554.37, 659.25, 739.99, 880, 987.77];
    const order = SPLIT.progress.map((p, i) => ({ i, end: p[1] })).sort((a, b) => a.end - b.end);
    order.forEach((o, k) => pluck(mix, S.split + SPLIT.timeOfDay(o.end), notes[k], 0.5, seed++));
    hit(mix, TL.hits[5].t, TL.hits[5].k, seed++);
    // 左边的三月：闷闷的低音
    thump(mix, S.split + SPLIT.left[0], 70, 44, 0.9, 0.4);
    pad(mix, S.split + SPLIT.left[3], 2.6, [55, 65.41, 82.41], 0.16, { attack: 0.3, release: 2.5 });
    // 右边的三月：暖色长音
    pad(mix, S.split + SPLIT.right[0], 3.2, [220, 277.18, 329.63], 0.11, { attack: 1.5, release: 1.8 });
    pad(mix, S.split + SPLIT.right[4] - 0.2, 4.2, [220, 277.18, 329.63, 440, 554.37], 0.2, { attack: 1.2, release: 2.5 });
  }

  // 第 6 幕：很轻的和弦
  {
    const t0 = S.same + 1.0;
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [130.81, 196, 261.63, 329.63], [196, 246.94, 293.66]];
    chords.forEach((c, k) => pad(mix, t0 + k * 4.4, 4.4, c, 0.085, { attack: 1.3, release: 2.0 }));
  }

  // 第 7 幕
  {
    hit(mix, TL.hits[6].t, TL.hits[6].k, seed++);
    hit(mix, TL.hits[7].t, TL.hits[7].k, seed++);
    hit(mix, TL.hits[8].t, TL.hits[8].k, seed++);
    for (let x = NOW.tick0, n = 0; x < NOW.fade[1]; x += 1, n++) {
      const fade = x > NOW.fade[0] ? 1 - (x - NOW.fade[0]) / (NOW.fade[1] - NOW.fade[0]) : 1;
      if (fade > 0.05) tick(mix, S.now + x, n % 2 === 0, seed++, 1.6 * fade);
    }
    pad(mix, S.now + NOW.f2, NOW.fade[1] - NOW.f2, [110, 164.81, 220, 329.63], 0.17, { attack: 0.8, release: 2.0 });
  }

  // 混响 + 母带
  const wL = reverb(mix.vL, [1687, 1601, 1867, 1949], [556, 179], 0.83);
  const wR = reverb(mix.vR, [1733, 1663, 1811, 2027], [579, 191], 0.83);
  const L = new Float32Array(mix.n), R = new Float32Array(mix.n);
  let peak = 0, dcl = 0, dcr = 0, pl = 0, pr = 0;
  for (let i = 0; i < mix.n; i++) {
    let l = mix.L[i] + wL[i] * 0.55;
    let r = mix.R[i] + wR[i] * 0.55;
    // 去直流
    dcl = l - pl + 0.9995 * dcl; pl = l; l = dcl;
    dcr = r - pr + 0.9995 * dcr; pr = r; r = dcr;
    l = Math.tanh(l * 1.5);
    r = Math.tanh(r * 1.5);
    L[i] = l; R[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const norm = 0.7 / (peak || 1);
  for (let i = 0; i < mix.n; i++) { L[i] *= norm; R[i] *= norm; }
  return { L, R };
}

function writeSoundtrack(file) {
  const { L, R } = compose();
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

module.exports = { writeSoundtrack };
