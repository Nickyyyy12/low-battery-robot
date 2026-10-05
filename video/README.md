# 146 天

一支约 3 分 30 秒的视频动画，画面和声音全部由 JS 生成。分镜见 `storyboard/146天-分镜脚本.pdf`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `src/timeline.js` | 时间轴和所有数字（日期、天数、小时数、每一幕的时间点），画面和声音共用 |
| `src/film.js` | 画面：`renderFrame(ctx, t)` 只依赖时间 `t`，可以从任意一帧开始画 |
| `src/audio.js` | 声音：秒针、心跳、低频、重击、故障噪音、拨弦、和弦，输出 WAV |
| `index.html` | 浏览器预览（空格暂停，← → 快退/快进） |
| `render.js` | 用 Chromium 逐帧渲染，交给 ffmpeg 编码成 MP4 |

## 导出

需要 Node.js、Playwright（自带 Chromium）和 ffmpeg。

```bash
npm install
node render.js                  # 完整导出 out/146天.mp4
node render.js stills 5 47 120  # 只导出这几秒的截图到 out/stills/
node render.js audio            # 只生成 out/soundtrack.wav
```

## 换一天重新导出

视频里的"今天"、倒计时、小时数都从 `src/timeline.js` 顶部的两个日期算出来：

```js
const START = { y: 2026, m: 10, d: 6 };   // 看视频的那一天
const DEADLINE = { y: 2027, m: 3, d: 1 }; // 截止日期
```

改完重新运行 `node render.js` 即可。每个月那一行字（「先考完试再说」等）是按 10 月开始写的，所以 `START` 只适合在 10 月内往后挪。
