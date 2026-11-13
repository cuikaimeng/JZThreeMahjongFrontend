/**
 * 把 audio/ 下的 WAV 转成 MP3（16-bit PCM WAV → MPEG Layer III，单声道）。
 *
 * 首次使用：npm install --prefix tools
 * 用法：node tools/wav-to-mp3.mjs [--keep-wav] [--bitrate 64]
 *   --keep-wav  转换后保留 WAV（默认在全部转换成功后删除 WAV，减小上传包）
 *   --bitrate   短音效/人声默认 64 kbps，BGM 默认 96 kbps（--bitrate 可覆盖全局）
 *
 * 两阶段执行：先生成全部 mp3，任一失败即中止并保留原 WAV；全部成功后才删除 WAV。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp3Encoder } from '@breezystack/lamejs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.resolve(HERE, '..', 'audio');
const KEEP_WAV = process.argv.includes('--keep-wav');
const argIndex = process.argv.indexOf('--bitrate');
const GLOBAL_BITRATE = argIndex >= 0 ? Number(process.argv[argIndex + 1]) : 0;

function readWav(buf) {
  let off = 12;
  let data = null;
  let bits = 16;
  let channels = 1;
  let rate = 22050;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    }
    if (id === 'data') {
      data = buf.slice(body, body + size);
      break;
    }
    off = body + size + (size % 2);
  }
  if (!data || bits !== 16) throw new Error('仅支持 16-bit PCM WAV');
  const stride = channels * 2;
  const n = Math.floor(data.length / stride);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE(i * stride + c * 2);
    pcm[i] = Math.round(sum / channels);
  }
  return { pcm, rate };
}

function encodeMp3(pcm, rate, kbps) {
  const encoder = new Mp3Encoder(1, rate, kbps);
  const chunks = [];
  const BLOCK = 1152;
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, Math.min(i + BLOCK, pcm.length)));
    if (buf.length) chunks.push(Buffer.from(buf));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return entry.name.toLowerCase().endsWith('.wav') ? [p] : [];
  });
}

const files = walk(AUDIO_DIR);
if (!files.length) {
  console.log('没有找到 WAV 文件（可能已转换过）。');
  process.exit(0);
}

const results = [];
for (const file of files) {
  const src = fs.readFileSync(file);
  const { pcm, rate } = readWav(src);
  const isBgm = file.includes(`${path.sep}bgm${path.sep}`);
  const kbps = GLOBAL_BITRATE || (isBgm ? 96 : 64);
  const mp3 = encodeMp3(pcm, rate, kbps);
  const out = file.replace(/\.wav$/i, '.mp3');
  fs.writeFileSync(out, mp3);
  results.push({ file, out, before: src.length, after: mp3.length });
}

const before = results.reduce((s, r) => s + r.before, 0);
const after = results.reduce((s, r) => s + r.after, 0);
console.log(`已转换 ${results.length} 个文件：${(before / 1024 / 1024).toFixed(2)} MB → ${(after / 1024 / 1024).toFixed(2)} MB（${(after / before * 100).toFixed(1)}%）`);

if (KEEP_WAV) {
  console.log('已保留 WAV（--keep-wav）');
} else {
  results.forEach((r) => fs.unlinkSync(r.file));
  console.log('已删除原 WAV 文件');
}
