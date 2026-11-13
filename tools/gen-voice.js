/**
 * 用 macOS 系统中文 TTS 生成「报牌 / 动作」人声资源。
 *
 * 用法：node tools/gen-voice.js          （自动挑 zh_CN 语音，默认 Tingting）
 *       JZ_VOICE=Sandy node tools/gen-voice.js   （换一个系统语音）
 *
 * 产物：audio/voice/ 下的 43 个 WAV（16-bit PCM / 单声道 22050Hz）
 *   - t1m.wav ~ t9s.wav、tE/tS/tW/tN/tC/tF/tP.wav：34 张牌的普通话读法
 *   - act_peng / act_gang / act_listen / act_hu：碰、杠、听、胡
 * 生成后自动归一化音量并裁掉首尾静音；仅需在本机生成一次，文件随代码包发布，
 * 微信小游戏运行时不依赖 say / afconvert。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') {
  console.error('该脚本依赖 macOS 的 say / afconvert，仅用于开发机生成语音资源。');
  process.exit(1);
}

const SR = 22050;
const OUT_DIR = path.resolve(__dirname, '..', 'audio', 'voice');
fs.mkdirSync(OUT_DIR, { recursive: true });

const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT = { m: '万', p: '筒', s: '条' };
const HONOR = {
  E: '东风', S: '南风', W: '西风', N: '北风',
  C: '红中', F: '发财', P: '白板',
};
const ACTIONS = {
  act_peng: '碰',
  act_gang: '杠',
  act_listen: '听牌',
  act_hu: '胡牌',
  // 胡牌特效的番型播报（与 effects.js 的 PRESETS 对应）
  fan_qys: '清一色',
  fan_ytl: '一条龙',
  fan_7d: '七小对',
  fan_h7d: '豪七对',
  fan_ssy: '十三幺',
};

/** 挑一个可用的普通话语音 */
function pickVoice() {
  if (process.env.JZ_VOICE) return process.env.JZ_VOICE;
  const list = execFileSync('say', ['-v', '?'], { encoding: 'utf8' });
  const zh = list.split('\n').filter((l) => /\bzh_CN\b/.test(l));
  const preferred = zh.find((l) => /^Tingting\b/.test(l.trim())) || zh[0];
  if (!preferred) {
    throw new Error('系统未安装 zh_CN 语音，请在「系统设置 → 辅助功能 → 朗读内容 → 系统声音」中添加中文语音');
  }
  return preferred.trim().split(/\s{2,}/)[0].trim();
}

/** 解析 afconvert 产出的 PCM WAV，返回 [-1,1] 样本 */
function readWav(buf) {
  let off = 12;
  let data = null;
  let bits = 16;
  let channels = 1;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      bits = buf.readUInt16LE(body + 14);
    }
    if (id === 'data') {
      data = buf.slice(body, body + size);
      break;
    }
    off = body + size + (size % 2);
  }
  if (!data || bits !== 16) throw new Error('afconvert 输出的不是 16-bit PCM WAV');
  const stride = channels * 2;
  const n = Math.floor(data.length / stride);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE(i * stride + c * 2);
    out[i] = sum / channels / 32768;
  }
  return out;
}

function writeWav(file, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
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
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

/** 归一化 → 裁静音 → 首尾淡化，让报牌干净利落 */
function processSamples(src) {
  let max = 0;
  for (let i = 0; i < src.length; i++) max = Math.max(max, Math.abs(src[i]));
  const gain = max > 0 ? 0.88 / max : 1;
  const normalized = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) normalized[i] = src[i] * gain;

  const threshold = 0.02;
  const pad = Math.floor(SR * 0.04);
  let start = 0;
  let end = normalized.length - 1;
  while (start < normalized.length && Math.abs(normalized[start]) < threshold) start++;
  while (end > start && Math.abs(normalized[end]) < threshold) end--;
  start = Math.max(0, start - pad);
  end = Math.min(normalized.length - 1, end + pad);
  const out = normalized.slice(start, end + 1);

  const fade = Math.min(Math.floor(SR * 0.008), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

function synth(voice, text, dest) {
  const tag = `jz_voice_${process.pid}_${Math.random().toString(36).slice(2)}`;
  const aiff = path.join(os.tmpdir(), `${tag}.aiff`);
  const wav = path.join(os.tmpdir(), `${tag}.wav`);
  try {
    execFileSync('say', ['-v', voice, '-o', aiff, text], { stdio: 'ignore' });
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', aiff, wav], { stdio: 'ignore' });
    const samples = processSamples(readWav(fs.readFileSync(wav)));
    return writeWav(dest, samples);
  } finally {
    [aiff, wav].forEach((f) => {
      try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
    });
  }
}

const tasks = [];
for (const suit of ['m', 'p', 's']) {
  for (let n = 1; n <= 9; n++) tasks.push({ file: `t${n}${suit}`, text: `${NUM[n]}${SUIT[suit]}` });
}
Object.keys(HONOR).forEach((k) => tasks.push({ file: `t${k}`, text: HONOR[k] }));
Object.keys(ACTIONS).forEach((k) => tasks.push({ file: k, text: ACTIONS[k] }));

const voice = pickVoice();
console.log(`语音：${voice}（可用 JZ_VOICE 环境变量更换）`);
let total = 0;
tasks.forEach((t) => {
  const size = synth(voice, t.text, path.join(OUT_DIR, `${t.file}.wav`));
  total += size;
});
console.log(`已生成 ${tasks.length} 个人声文件 → audio/voice/，合计 ${(total / 1024).toFixed(0)} KB`);
console.log('示例：t2m=二万、t1s=一条、tE=东风、act_peng=碰、act_hu=胡牌');
