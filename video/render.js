// 把 index.html 里的动画逐帧渲染成 MP4。
//
//   node render.js                 完整导出 out/146天.mp4
//   node render.js stills 5 47 120 只导出这几秒的截图到 out/stills/
//   node render.js audio           只生成 out/soundtrack.wav
//
// 需要：Playwright 自带的 Chromium、系统里的 ffmpeg。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const TL = require('./src/timeline.js');
const { writeSoundtrack } = require('./src/audio.js');

const OUT = path.join(__dirname, 'out');
const PAGE = 'file://' + path.join(__dirname, 'index.html') + '?render';

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: TL.W, height: TL.H } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(PAGE);
  await page.evaluate(() => window.ready);
  return page;
}

async function grab(page, t) {
  const b64 = await page.evaluate((tt) => {
    window.drawAt(tt);
    return document.getElementById('c').toDataURL('image/png').split(',')[1];
  }, t);
  return Buffer.from(b64, 'base64');
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ stdio: ['ignore', 'inherit', 'inherit'] }, opts));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

async function stills(times) {
  const dir = path.join(OUT, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await openPage(browser);
  for (const t of times) {
    const file = path.join(dir, `t${String(t).padStart(6, '0')}.png`);
    fs.writeFileSync(file, await grab(page, t));
    console.log(file);
  }
  await browser.close();
}

// 一个 worker 负责一段连续的帧，直接喂给自己的 ffmpeg
async function renderSegment(index, from, to, file) {
  const browser = await chromium.launch();
  const page = await openPage(browser);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(TL.FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(TL.FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c)))));
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    const png = await grab(page, f / TL.FPS);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - from) % 300 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`[段 ${index}] ${f - from}/${to - from} 帧，${el.toFixed(0)} 秒`);
    }
  }
  ff.stdin.end();
  await done;
  await browser.close();
}

async function full() {
  fs.mkdirSync(OUT, { recursive: true });
  const wav = path.join(OUT, 'soundtrack.wav');
  console.log('合成声音…');
  writeSoundtrack(wav);

  const total = Math.ceil(TL.DURATION * TL.FPS);
  const workers = Math.max(1, Math.min(4, os.cpus().length));
  const per = Math.ceil(total / workers);
  const segs = [];
  for (let i = 0; i < workers; i++) {
    const from = i * per;
    const to = Math.min(total, from + per);
    if (from < to) segs.push({ i, from, to, file: path.join(OUT, `seg${i}.mp4`) });
  }
  console.log(`渲染 ${total} 帧（${workers} 路并行）…`);
  await Promise.all(segs.map((s) => renderSegment(s.i, s.from, s.to, s.file)));

  const list = path.join(OUT, 'segments.txt');
  fs.writeFileSync(list, segs.map((s) => `file '${s.file}'`).join('\n') + '\n');
  const video = path.join(OUT, 'video.mp4');
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  const mp4 = path.join(OUT, '146天.mp4');
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart',
    '-metadata', 'title=146 天', mp4]);
  segs.forEach((s) => fs.unlinkSync(s.file));
  fs.unlinkSync(list);
  fs.unlinkSync(video);
  console.log('完成：' + mp4);
}

(async () => {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'stills') await stills(rest.map(Number));
  else if (mode === 'audio') { fs.mkdirSync(OUT, { recursive: true }); writeSoundtrack(path.join(OUT, 'soundtrack.wav')); }
  else await full();
})().catch((e) => { console.error(e); process.exit(1); });
