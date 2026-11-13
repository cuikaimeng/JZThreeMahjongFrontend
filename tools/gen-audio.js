/**
 * 生成小游戏自带的占位音频资源（16-bit PCM WAV / 单声道 22050Hz）。
 *
 * 用法：node tools/gen-audio.js
 * 说明：全部由程序合成，无第三方版权素材；上线前用同名文件覆盖即可替换为正式素材。
 *       生成脚本位于 tools/，已被 project.config.json 的 packOptions.ignore 排除，不会进上传包。
 */
const fs = require('fs');
const path = require('path');

const SR = 22050;
const TAU = Math.PI * 2;
const ROOT = path.resolve(__dirname, '..', 'audio');
const BGM_DIR = path.join(ROOT, 'bgm');
const SFX_DIR = path.join(ROOT, 'effect');
fs.mkdirSync(BGM_DIR, { recursive: true });
fs.mkdirSync(SFX_DIR, { recursive: true });

const NOTE = {
  C3: 130.81, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.50,
};

function writeWav(file, data) {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

/** 单个音符/音块：正弦、三角或方波 + 泛音 + 指数衰减包络 */
function addTone(out, start, dur, freq, amp, opt = {}) {
  const { decay = 8, type = 'sine', attack = 0.008 } = opt;
  const s0 = Math.max(0, Math.floor(start * SR));
  const len = Math.min(Math.floor(dur * SR), out.length - s0);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-decay * t) * Math.min(1, t / attack);
    const p = TAU * freq * t;
    let w = Math.sin(p);
    if (type === 'tri') w = (2 / Math.PI) * Math.asin(Math.sin(p));
    else if (type === 'square') w = Math.sign(Math.sin(p)) * 0.55;
    const harm = type === 'sine' ? 0.22 * Math.sin(p * 2) + 0.08 * Math.sin(p * 3) : 0;
    out[s0 + i] += amp * e * (w + harm);
  }
}

/** 确定性噪声（用于牌面撞击、骰子、发牌摩擦） */
function addNoise(out, start, dur, amp, opt = {}) {
  const { decay = 35, seed = 12345 } = opt;
  const s0 = Math.max(0, Math.floor(start * SR));
  const len = Math.min(Math.floor(dur * SR), out.length - s0);
  let x = seed >>> 0;
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const r = (x / 0xffffffff) * 2 - 1;
    const t = i / SR;
    out[s0 + i] += amp * r * Math.exp(-decay * t) * Math.min(1, t / 0.002);
  }
}

function finish(out, file, opt = {}) {
  const { peak = 0.72, fadeSec = 0.12, loop = false } = opt;
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  const gain = max > 0 ? peak / max : 1;
  const fadeLen = Math.floor(fadeSec * SR);
  for (let i = 0; i < out.length; i++) {
    let v = out[i] * gain;
    if (!loop && i < fadeLen) v *= i / fadeLen;
    if (!loop && i > out.length - fadeLen) v *= (out.length - i) / fadeLen;
    out[i] = v;
  }
  return writeWav(file, out);
}

function buf(sec) {
  return new Float32Array(Math.round(sec * SR));
}

/* ---------------- 背景音乐：五声音阶循环，首尾淡入淡出便于无缝 loop ---------------- */

const LOBBY_SEQ = [
  ['C5', 0.75], ['A4', 0.75], ['G4', 0.75], ['E4', 0.75],
  ['G4', 0.75], ['A4', 0.75], ['C5', 1.5],
  ['D5', 0.75], ['C5', 0.75], ['A4', 0.75], ['G4', 0.75],
  ['E4', 0.75], ['G4', 0.75], ['A4', 1.5],
];

const GAME_SEQ = [
  ['E5', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 0.5], ['G4', 0.5], ['A4', 0.5], ['C5', 1],
  ['D5', 0.5], ['E5', 0.5], ['G5', 0.5], ['E5', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 1],
  ['G4', 0.5], ['A4', 0.5], ['C5', 1],
  ['D5', 0.5], ['C5', 0.5], ['A4', 1],
];

function makeBgm(seq, opt = {}) {
  const { beat = 1, bright = false, bass = ['C3', 'A3', 'F3', 'G3'] } = opt;
  const total = seq.reduce((s, n) => s + n[1], 0) * beat;
  const out = buf(total);
  let t = 0;
  seq.forEach(([name, beats], i) => {
    const dur = beats * beat;
    addTone(out, t, Math.min(dur * 1.5, 1.6), NOTE[name], bright ? 0.30 : 0.24, {
      type: bright ? 'tri' : 'sine',
      decay: bright ? 4.2 : 3.0,
    });
    addTone(out, t, Math.min(dur * 1.2, 1.2), NOTE[name] / 2, 0.07, { decay: 2.2 });
    if (bright && i % 2 === 0) addNoise(out, t, 0.05, 0.035, { decay: 90, seed: 700 + i });
    t += dur;
  });
  // 每两拍一个低音铺底
  for (let k = 0; k * 2 * beat < total; k++) {
    addTone(out, k * 2 * beat, 2 * beat, NOTE[bass[k % bass.length]], 0.13, { decay: 1.1 });
  }
  return out;
}

/* ---------------- 音效 ---------------- */

function sfxClick() {
  const out = buf(0.09);
  addTone(out, 0, 0.09, 1180, 0.55, { decay: 55 });
  addNoise(out, 0, 0.03, 0.18, { decay: 120, seed: 11 });
  return out;
}
function sfxHint() {
  const out = buf(0.18);
  addTone(out, 0, 0.16, 880, 0.45, { decay: 18 });
  addTone(out, 0.06, 0.12, 1320, 0.30, { decay: 20 });
  return out;
}
function sfxDeal() {
  const out = buf(0.16);
  addNoise(out, 0, 0.13, 0.55, { decay: 34, seed: 22 });
  addTone(out, 0, 0.09, 190, 0.25, { type: 'tri', decay: 30 });
  return out;
}
function sfxDice() {
  const out = buf(0.55);
  for (let i = 0; i < 6; i++) {
    const t = i * 0.075 + (i % 2) * 0.012;
    addNoise(out, t, 0.05, 0.42, { decay: 95, seed: 30 + i * 7 });
    addTone(out, t, 0.05, 420 + i * 35, 0.18, { decay: 60 });
  }
  return out;
}
function sfxDiscard(freq) {
  const out = buf(0.22);
  addTone(out, 0, 0.19, freq, 0.62, { type: 'tri', decay: 24 });
  addTone(out, 0, 0.12, freq * 2.7, 0.18, { decay: 40 });
  addNoise(out, 0, 0.045, 0.42, { decay: 105, seed: Math.round(freq) });
  return out;
}
function sfxPeng() {
  const out = buf(0.42);
  addTone(out, 0, 0.2, NOTE.G4, 0.45, { decay: 12 });
  addTone(out, 0.11, 0.3, NOTE.C5, 0.52, { decay: 8 });
  addNoise(out, 0, 0.05, 0.30, { decay: 90, seed: 44 });
  return out;
}
function sfxGang() {
  const out = buf(0.55);
  [0, 0.11, 0.22].forEach((t, i) => {
    addTone(out, t, 0.24, 165 + i * 18, 0.52, { type: 'tri', decay: 15 });
    addNoise(out, t, 0.05, 0.34, { decay: 95, seed: 55 + i });
  });
  addTone(out, 0.33, 0.22, NOTE.E5, 0.25, { decay: 12 });
  return out;
}
function sfxListen() {
  const out = buf(0.7);
  addTone(out, 0, 0.7, 1046, 0.42, { decay: 5.5 });
  addTone(out, 0, 0.7, 1568, 0.20, { decay: 7 });
  addTone(out, 0, 0.7, 2093, 0.10, { decay: 9 });
  return out;
}
function sfxHu() {
  const out = buf(1.25);
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
    addTone(out, i * 0.11, 0.5, f, 0.42, { type: 'tri', decay: 4.5 });
  });
  addTone(out, 0.46, 0.75, NOTE.C4, 0.22, { decay: 2.5 });
  addTone(out, 0.46, 0.75, NOTE.G4, 0.18, { decay: 2.8 });
  addNoise(out, 0.46, 0.12, 0.12, { decay: 40, seed: 66 });
  return out;
}
function sfxDraw() {
  const out = buf(0.75);
  addTone(out, 0, 0.35, NOTE.A4, 0.38, { decay: 7 });
  addTone(out, 0.2, 0.5, NOTE.E4, 0.42, { decay: 5 });
  return out;
}
function sfxStart() {
  const out = buf(0.6);
  [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => {
    addTone(out, i * 0.1, 0.3, f, 0.40, { decay: 7 });
  });
  return out;
}
function sfxEnd() {
  const out = buf(1.0);
  [NOTE.C4, NOTE.E4, NOTE.G4].forEach((f) => {
    addTone(out, 0.12, 0.85, f, 0.24, { decay: 2.6 });
  });
  addTone(out, 0, 0.2, NOTE.C5, 0.28, { decay: 9 });
  return out;
}

/* ---------------- 胡牌特效专用音 ---------------- */

/** 清一色：上行扫光 */
function sfxFxRise() {
  const out = buf(0.95);
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
    addTone(out, i * 0.09, 0.65, f, 0.34, { type: 'tri', decay: 3.2 });
  });
  addNoise(out, 0, 0.18, 0.10, { decay: 30, seed: 81 });
  return out;
}

/** 一条龙：九音连贯上行 */
function sfxFxDragon() {
  const out = buf(1.15);
  [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5].forEach((f, i) => {
    addTone(out, i * 0.085, 0.45, f, 0.30, { decay: 4.6 });
  });
  return out;
}

/** 七小对：星光铃 */
function sfxFxChime() {
  const out = buf(0.95);
  [0, 0.14, 0.28].forEach((t, i) => {
    addTone(out, t, 0.62, 1318 + i * 220, 0.30, { decay: 5.5 });
    addTone(out, t, 0.62, 1975 + i * 260, 0.14, { decay: 7 });
  });
  return out;
}

/** 豪七对 / 十三幺：低频爆发 + 明亮和弦 */
function sfxFxBurst() {
  const out = buf(1.05);
  addTone(out, 0, 0.55, 110, 0.55, { type: 'tri', decay: 7 });
  addNoise(out, 0, 0.22, 0.42, { decay: 22, seed: 99 });
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
    addTone(out, 0.1 + i * 0.05, 0.8, f, 0.26, { decay: 3.4 });
  });
  return out;
}

/* ---------------- 输出 ---------------- */

const files = [];
function emit(dir, name, data, opt) {
  const size = finish(data, path.join(dir, `${name}.wav`), opt);
  files.push({ name, size });
}

emit(BGM_DIR, 'lobby', makeBgm(LOBBY_SEQ, { beat: 1, bright: false }), { peak: 0.62, fadeSec: 0.18, loop: true });
emit(BGM_DIR, 'game', makeBgm(GAME_SEQ, { beat: 1, bright: true, bass: ['C3', 'G3', 'A3', 'F3'] }), { peak: 0.60, fadeSec: 0.18, loop: true });

emit(SFX_DIR, 'click', sfxClick());
emit(SFX_DIR, 'hint', sfxHint());
emit(SFX_DIR, 'deal', sfxDeal());
emit(SFX_DIR, 'dice', sfxDice());
emit(SFX_DIR, 'discard_m', sfxDiscard(200));
emit(SFX_DIR, 'discard_p', sfxDiscard(248));
emit(SFX_DIR, 'discard_s', sfxDiscard(296));
emit(SFX_DIR, 'discard_z', sfxDiscard(164));
emit(SFX_DIR, 'peng', sfxPeng());
emit(SFX_DIR, 'gang', sfxGang());
emit(SFX_DIR, 'listen', sfxListen());
emit(SFX_DIR, 'hu', sfxHu());
emit(SFX_DIR, 'draw', sfxDraw());
emit(SFX_DIR, 'start', sfxStart());
emit(SFX_DIR, 'end', sfxEnd());
emit(SFX_DIR, 'fx_rise', sfxFxRise());
emit(SFX_DIR, 'fx_dragon', sfxFxDragon());
emit(SFX_DIR, 'fx_chime', sfxFxChime());
emit(SFX_DIR, 'fx_burst', sfxFxBurst());

const total = files.reduce((s, f) => s + f.size, 0);
files.forEach((f) => console.log(`  ${f.name.padEnd(12)} ${(f.size / 1024).toFixed(1)} KB`));
console.log(`共 ${files.length} 个音频文件，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
