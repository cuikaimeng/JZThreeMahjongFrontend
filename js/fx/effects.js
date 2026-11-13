/**
 * 胡牌特效：视觉 + 音效组合。
 *
 * 每种特殊牌型对应一套独立的画面风格、番型播报人声和光效音：
 *   十三幺 → 十三道星光汇聚（爆发音）
 *   豪七对 → 金色放射爆发 + 轻微画面震动（爆发音）
 *   清一色 → 同色光柱扫过 + 上浮光点（上行扫光音）
 *   一条龙 → S 形光带九点依次点亮（九音上行）
 *   七小对 → 七对牌卡飞散 + 环形涟漪（星光铃）
 *   普通胡 → 轻量金光横幅 +「胡牌」人声
 *
 * 特效由 gameScene.onSettle() 触发，绘制在结算面板之上，约 2.9 秒后自动淡出；
 * 不参与触摸命中，不影响结算操作。人声/光效音走 audioManager，受设置页「音效」开关控制。
 */
import audio from '../audio/audioManager.js';
import { roundRect, spacedText } from '../ui/draw.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const TAU = Math.PI * 2;
const DURATION = 2900;

const PRESETS = {
  ssy: { label: '十三幺', color: '#d9b3ff', accent: '#fff3d0', style: 'star', voice: 'ssy', sfx: 'fx_burst' },
  h7d: { label: '豪七对', color: '#ffd27a', accent: '#fff3d0', style: 'burst', voice: 'h7d', sfx: 'fx_burst' },
  qys: { label: '清一色', color: '#7ee2b8', accent: '#eafff5', style: 'sweep', voice: 'qys', sfx: 'fx_rise' },
  ytl: { label: '一条龙', color: '#79d8ff', accent: '#e9f8ff', style: 'dragon', voice: 'ytl', sfx: 'fx_dragon' },
  qxd: { label: '七小对', color: '#ffb8cf', accent: '#fff0f5', style: 'pairs', voice: 'qxd', sfx: 'fx_chime' },
  normal: { label: '胡牌', color: '#e8c37a', accent: '#fff8e6', style: 'normal', voice: 'hu', sfx: null },
};

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0xffffffff;
  };
}

function easeOut(x) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
}

/** 后端 handName → 特效预设（命中多个番型时后端会给出优先级最高的名称） */
function presetFor(handName) {
  const n = String(handName || '');
  if (n.includes('十三幺')) return 'ssy';
  if (n.includes('豪七对')) return 'h7d';
  if (n.includes('清一色')) return 'qys';
  if (n.includes('一条龙')) return 'ytl';
  if (n.includes('七小对')) return 'qxd';
  return 'normal';
}

function buildParticles(style, seed) {
  const rnd = rng(seed);
  const list = [];
  if (style === 'sweep') {
    for (let i = 0; i < 70; i++) {
      list.push({ x: rnd(), y: rnd(), speed: 0.4 + rnd() * 0.9, size: 1.5 + rnd() * 3.5, phase: rnd() * TAU });
    }
  } else if (style === 'burst') {
    for (let i = 0; i < 90; i++) {
      list.push({ a: rnd() * TAU, speed: 0.25 + rnd() * 0.75, size: 1.5 + rnd() * 4, phase: rnd() });
    }
  } else if (style === 'star') {
    for (let i = 0; i < 60; i++) {
      list.push({ a: rnd() * TAU, r: 0.2 + rnd() * 0.8, size: 1 + rnd() * 3, phase: rnd() * TAU });
    }
  } else if (style === 'dragon') {
    for (let i = 0; i < 45; i++) {
      list.push({ u: rnd(), off: (rnd() - 0.5) * 0.08, size: 1 + rnd() * 3, phase: rnd() * TAU });
    }
  } else if (style === 'pairs') {
    for (let i = 0; i < 14; i++) {
      list.push({
        a: (i / 14) * TAU + (rnd() - 0.5) * 0.15,
        dist: 0.25 + rnd() * 0.45,
        rot: (rnd() - 0.5) * 1.2,
        spin: (rnd() - 0.5) * 3,
      });
    }
  } else {
    for (let i = 0; i < 24; i++) {
      list.push({ x: rnd(), y: rnd(), speed: 0.3 + rnd() * 0.6, size: 1 + rnd() * 3, phase: rnd() * TAU });
    }
  }
  return list;
}

function dot(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBackdrop(ctx, w, h, color, t) {
  const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.75);
  g.addColorStop(0, rgba(color, 0.2 * (1 - t * 0.4)));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawSweep(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  const sx = (t * 1.7 - 0.35) * w;
  const lg = ctx.createLinearGradient(sx - 70 * k, 0, sx + 70 * k, 0);
  lg.addColorStop(0, rgba(color, 0));
  lg.addColorStop(0.5, rgba(color, 0.24));
  lg.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = lg;
  ctx.fillRect(sx - 70 * k, 0, 140 * k, h);
  st.particles.forEach((q) => {
    const y = ((q.y - t * q.speed) % 1 + 1) % 1 * h;
    const x = q.x * w + Math.sin(t * 4 + q.phase) * 6 * k;
    dot(ctx, x, y, q.size * k, rgba(accent, 0.8));
  });
}

function drawBurst(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  const cx = w / 2;
  const cy = h * 0.42;
  ctx.lineWidth = 2 * k;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const r0 = t * w * 0.12;
    const r1 = r0 + w * 0.46 * (1 - t * 0.45);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.strokeStyle = rgba(color, 0.32 * (1 - t));
    ctx.stroke();
  }
  st.particles.forEach((q) => {
    const r = t * q.speed * Math.max(w, h) * 0.78;
    dot(ctx, cx + Math.cos(q.a) * r, cy + Math.sin(q.a) * r, q.size * k, rgba(accent, 0.85 * (1 - t * 0.6)));
  });
}

function drawStar(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  const cx = w / 2;
  const cy = h * 0.42;
  if (t < 0.24) {
    ctx.fillStyle = `rgba(255,255,255,${(0.24 - t) / 0.24 * 0.45})`;
    ctx.fillRect(0, 0, w, h);
  }
  const outer = Math.max(w, h) * (1.1 - t * 0.85);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * TAU;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.lineTo(cx, cy);
    ctx.lineWidth = 2.5 * k;
    ctx.strokeStyle = rgba(color, 0.42 * (1 - t * 0.5));
    ctx.stroke();
  }
  st.particles.forEach((q) => {
    const a = q.a + t * 0.85;
    const r = q.r * Math.max(w, h) * 0.46 * (1 - t * 0.3);
    dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, q.size * k, rgba(accent, 0.8));
  });
}

function dragonPoint(u, w, h) {
  return { x: w * (0.06 + 0.88 * u), y: h * 0.42 + Math.sin(u * TAU * 1.4) * h * 0.13 };
}

function drawDragon(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const p = dragonPoint(i / 60, w, h);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.lineWidth = 3 * k;
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    if (t * 1.5 < i / 9) break;
    const p = dragonPoint(i / 8, w, h);
    dot(ctx, p.x, p.y, 7 * k, rgba(accent, 0.95));
    dot(ctx, p.x, p.y, 3.5 * k, '#ffffff');
  }
  st.particles.forEach((q) => {
    const u = (q.u + t * 0.35) % 1;
    const p = dragonPoint(u, w, h);
    dot(ctx, p.x, p.y + q.off * h, q.size * k, rgba(accent, 0.7));
  });
}

function drawPairs(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  const cx = w / 2;
  const cy = h * 0.42;
  for (let i = 0; i < 3; i++) {
    const rt = t * 1.3 - i * 0.22;
    if (rt <= 0 || rt >= 1) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, rt * Math.max(w, h) * 0.62, 0, TAU);
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = rgba(color, (1 - rt) * 0.4);
    ctx.stroke();
  }
  st.particles.forEach((q) => {
    const r = t * q.dist * Math.max(w, h) * 0.7;
    ctx.save();
    ctx.translate(cx + Math.cos(q.a) * r, cy + Math.sin(q.a) * r);
    ctx.rotate(q.rot + t * q.spin);
    roundRect(ctx, -8 * k, -11 * k, 16 * k, 22 * k, 3 * k);
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.fill();
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.stroke();
    ctx.restore();
  });
}

function drawNormal(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  st.particles.forEach((q) => {
    const y = ((q.y - t * q.speed) % 1 + 1) % 1 * h;
    const x = q.x * w + Math.sin(t * 3 + q.phase) * 5 * k;
    dot(ctx, x, y, q.size * k, rgba(accent, 0.55 * (1 - t * 0.4)));
  });
  ctx.fillStyle = rgba(color, 0.05);
  ctx.fillRect(0, 0, w, h);
}

const DRAWERS = {
  sweep: drawSweep,
  burst: drawBurst,
  star: drawStar,
  dragon: drawDragon,
  pairs: drawPairs,
  normal: drawNormal,
};

function drawBanner(ctx, st, w, h, k, t) {
  const { color, accent } = st.preset;
  const cy = h * 0.28;
  const scale = 0.82 + 0.18 * easeOut(t / 0.18);
  const bw = Math.min(w - 40 * k, 320 * k);
  const bh = 84 * k;
  ctx.save();
  ctx.translate(w / 2, cy);
  ctx.scale(scale, scale);
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 16 * k);
  const bg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
  bg.addColorStop(0, rgba(color, 0));
  bg.addColorStop(0.5, rgba(color, 0.26));
  bg.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.35);
  ctx.lineWidth = 1 * k;
  ctx.stroke();
  spacedText(ctx, st.title, 0, 4 * k, {
    font: `700 ${Math.round(34 * k)}px ${SANS}`,
    fill: accent,
    spacing: 5 * k,
  });
  spacedText(ctx, st.subtitle, 0, 28 * k, {
    font: `${Math.round(11 * k)}px ${SANS}`,
    fill: rgba(color, 0.95),
    spacing: 1.5 * k,
  });
  ctx.restore();
}

class Effects {
  constructor() {
    this.current = null;
  }

  get active() {
    return !!this.current;
  }

  /** 启动一套特效（视觉 + 音效同时触发） */
  play(id, opts = {}) {
    const preset = PRESETS[id] || PRESETS.normal;
    const state = {
      id,
      preset,
      start: Date.now(),
      particles: buildParticles(preset.style, (Date.now() ^ (Math.random() * 1e9)) >>> 0),
      title: opts.title || preset.label,
      subtitle: opts.subtitle || '',
    };
    this.current = state;

    if (preset.sfx) audio.playSfx(preset.sfx, { volume: 0.7 });
    if (preset.voice) {
      const voice = preset.voice;
      setTimeout(() => {
        if (this.current === state) audio.playSfx(voice, { volume: 0.95 });
      }, id === 'normal' ? 0 : 280);
    }
    if (id !== 'normal') audio.vibrate('heavy');
  }

  /** 结算事件入口：按 handName 选择番型特效 */
  playWin(info = {}) {
    const id = presetFor(info.handName);
    const preset = PRESETS[id];
    const mult = Number(info.fanTotal || info.multiplier || 1);
    const tags = [];
    if (mult > 1) tags.push(`×${mult} 番`);
    if (info.zimo) tags.push('自摸');
    if (info.robGang) tags.push('抢杠胡');
    if (info.winner) tags.push(`${info.winner} 胡牌`);
    this.play(id, {
      title: info.handName || preset.label,
      subtitle: tags.length ? tags.join(' · ') : '好 牌',
    });
  }

  stop() {
    this.current = null;
  }

  /** 每帧绘制；由 gameScene.render() 在结算面板之后调用 */
  render(ctx, w, h, k = 1) {
    const st = this.current;
    if (!st) return;
    const t = (Date.now() - st.start) / DURATION;
    if (t >= 1) {
      this.current = null;
      return;
    }
    const alpha = t < 0.1 ? t / 0.1 : t > 0.72 ? (1 - t) / 0.28 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (st.preset.style === 'burst') {
      const shake = (1 - t) * 4 * k;
      ctx.translate(Math.sin(t * 60) * shake, Math.cos(t * 47) * shake * 0.6);
    }
    drawBackdrop(ctx, w, h, st.preset.color, t);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const draw = DRAWERS[st.preset.style] || drawNormal;
    draw(ctx, st, w, h, k, t);
    ctx.restore();
    drawBanner(ctx, st, w, h, k, t);
    ctx.restore();
  }
}

const fx = new Effects();
export default fx;
