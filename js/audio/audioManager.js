/**
 * 统一音频管理：大厅 / 对局 BGM、报牌与动作人声、设置开关、前后台与音频中断。
 *
 * - BGM：大厅与其他页面用 lobby.wav，对局页用 game.wav，循环播放，切换场景自动换曲。
 * - 人声：出牌按牌面播报普通话（如「二万」「一条」），碰 / 杠 / 听 / 胡也用语音，
 *         资源在 audio/voice/，由 tools/gen-voice.js 生成。
 * - 音效：8 个 InnerAudioContext 轮询复用；摇骰、发牌、按钮等非语音提示仍用合成音。
 * - 开关：与设置页共用 set_music / set_sound / set_vib，关掉音乐立即停 BGM，关掉音效立即静音。
 * - 容错：环境不支持音频 API 或资源缺失时静默降级，不影响对局逻辑。
 */

const KEYS = { music: 'set_music', sound: 'set_sound', vib: 'set_vib' };
const BGM_SRC = { lobby: 'audio/bgm/lobby.wav', game: 'audio/bgm/game.wav' };
const BGM_VOLUME = 0.45;
const POOL_SIZE = 8;
const DEFAULT_SFX_VOLUME = 0.9;
const EFFECT_DIR = 'audio/effect';
const VOICE_DIR = 'audio/voice';

/** 牌面编码：1-9 万/筒/条 + 东南西北中发白，与 tools/gen-voice.js 产物一一对应 */
const TILE_RE = /^([1-9][mps]|[ESWNCFP])$/;

/** 动作语音 + 胡牌特效的番型播报 */
const VOICE_SFX = {
  peng: 'act_peng',
  gang: 'act_gang',
  listen: 'act_listen',
  hu: 'act_hu',
  qys: 'fan_qys',
  ytl: 'fan_ytl',
  qxd: 'fan_7d',
  h7d: 'fan_h7d',
  ssy: 'fan_ssy',
};

/** 事件名 → 合成音效名（非语音部分） */
const SFX_FILES = {
  click: 'click',
  hint: 'hint',
  deal: 'deal',
  dice: 'dice',
  draw: 'draw',
  start: 'start',
  end: 'end',
};

function readBool(key) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined ? true : !!v;
  } catch (e) {
    return true;
  }
}

function saveBool(key, value) {
  try {
    wx.setStorageSync(key, !!value);
  } catch (e) { /* 存储不可用时仅本次会话生效 */ }
}

function wxAvailable() {
  return typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function';
}

/** 解析资源：出牌按牌面取对应人声，碰/杠/听/胡取动作人声，其余取合成音效 */
function resolveSfx(name, opts) {
  const volume = opts.volume == null ? DEFAULT_SFX_VOLUME : opts.volume;
  if (name === 'discard') {
    const tile = String(opts.tile || '');
    if (TILE_RE.test(tile)) {
      return { src: `${VOICE_DIR}/t${tile}.wav`, rate: 1, volume };
    }
    // 未知牌型兜底，避免静音
    return { src: `${EFFECT_DIR}/discard_z.wav`, rate: 1, volume };
  }
  if (VOICE_SFX[name]) {
    return { src: `${VOICE_DIR}/${VOICE_SFX[name]}.wav`, rate: 1, volume };
  }
  return {
    src: `${EFFECT_DIR}/${SFX_FILES[name] || name}.wav`,
    rate: opts.rate == null ? 1 : opts.rate,
    volume,
  };
}

class AudioManager {
  constructor() {
    this.enabled = { music: true, sound: true, vib: true };
    this.sceneBgm = 'lobby';
    this.unlocked = false;
    this.paused = false;
    this.bgm = {};
    this.playing = {};
    this.pool = [];
    this.poolIdx = 0;
    this.inited = false;
  }

  /** 从本地设置初始化，并注册生命周期（可重复调用，幂等） */
  init() {
    if (this.inited) return;
    this.inited = true;
    this.enabled = {
      music: readBool(KEYS.music),
      sound: readBool(KEYS.sound),
      vib: readBool(KEYS.vib),
    };
    if (typeof wx === 'undefined') return;
    if (typeof wx.onHide === 'function') wx.onHide(() => this.pause());
    if (typeof wx.onShow === 'function') wx.onShow(() => this.resume());
    if (typeof wx.onAudioInterruptionBegin === 'function') {
      wx.onAudioInterruptionBegin(() => this.pause());
    }
    if (typeof wx.onAudioInterruptionEnd === 'function') {
      wx.onAudioInterruptionEnd(() => this.resume());
    }
  }

  getEnabled() {
    return { ...this.enabled };
  }

  /** 设置页初始化时把已有开关状态同步过来 */
  syncFromSettings(toggles) {
    if (!toggles) return;
    if (typeof toggles.music === 'boolean') this.enabled.music = toggles.music;
    if (typeof toggles.sound === 'boolean') this.enabled.sound = toggles.sound;
    if (typeof toggles.vib === 'boolean') this.enabled.vib = toggles.vib;
    this._applyBgm();
  }

  setMusicEnabled(value) {
    this.enabled.music = !!value;
    saveBool(KEYS.music, this.enabled.music);
    this._applyBgm();
  }

  setSfxEnabled(value) {
    this.enabled.sound = !!value;
    saveBool(KEYS.sound, this.enabled.sound);
  }

  setVibrateEnabled(value) {
    this.enabled.vib = !!value;
    saveBool(KEYS.vib, this.enabled.vib);
  }

  /** 首次触摸后调用：iOS 需要用户手势才允许播放 */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this._applyBgm();
  }

  /** 场景名 → BGM（仅对局页用对局曲） */
  setScene(name) {
    const id = name === 'game' ? 'game' : 'lobby';
    if (id === this.sceneBgm) return;
    this.sceneBgm = id;
    this._applyBgm();
  }

  pause() {
    this.paused = true;
    this._applyBgm();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._applyBgm();
  }

  vibrate(type = 'light') {
    if (!this.enabled.vib || typeof wx === 'undefined') return;
    try {
      if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type });
    } catch (e) { /* 部分环境不支持震动 */ }
  }

  /** 播放音效 / 报牌人声；name 为 discard 时传 { tile }，如 3m → 语音「三万」 */
  playSfx(name, opts = {}) {
    if (!this.enabled.sound || this.paused || !wxAvailable()) return;
    const { src, rate, volume } = resolveSfx(name, opts);
    const slot = this._slot();
    if (!slot) return;
    const c = slot;
    try {
      c.stop();
      c.volume = volume;
      try { c.playbackRate = rate; } catch (e) { /* 低版本基础库不支持变速 */ }
      c.src = src;
      c.play();
    } catch (e) { /* 音频异常不影响游戏 */ }
  }

  /**
   * 对局事件 → 音效。集中在这里映射，避免散落在各 onXXX 里。
   * 服务端事件名见 main.js bindNet() 的订阅列表。
   */
  onGameEvent(type, d = {}) {
    switch (type) {
      case 'dice':
        this.playSfx('dice');
        break;
      case 'deal':
        this.playSfx('deal');
        break;
      case 'draw':
        this.playSfx('deal', { volume: 0.5 });
        break;
      case 'discard':
        // 报听扣牌是暗牌（牌河背面朝上），不播牌名，避免语音泄露牌面
        if (d.faceDown) this.playSfx('click');
        else this.playSfx('discard', { tile: d.tile });
        break;
      case 'action':
        if (d.type === 'peng') this.playSfx('peng');
        else if (d.type === 'gang' || d.type === 'angang' || d.type === 'bugang' || d.type === 'diangang') {
          this.playSfx('gang');
        }
        break;
      case 'listen':
        this.playSfx('listen');
        break;
      case 'settle':
        // 胡牌的人声 / 光效音 / 震动由 fx（胡牌特效）统一播放，这里只处理流局
        if (!d.winnerSeat) this.playSfx('draw');
        break;
      case 'offer':
        if (Array.isArray(d.actions) && d.actions.includes('hu')) this.playSfx('hint');
        break;
      case 'gameStart':
        this.playSfx('start');
        break;
      case 'matchOver':
        this.playSfx('end');
        break;
      default:
        break;
    }
  }

  /* ---------------- 内部 ---------------- */

  _slot() {
    if (!wxAvailable()) return null;
    const i = this.poolIdx;
    this.poolIdx = (this.poolIdx + 1) % POOL_SIZE;
    if (this.pool[i]) return this.pool[i];
    try {
      const c = wx.createInnerAudioContext();
      c.loop = false;
      if (typeof c.onError === 'function') c.onError(() => {});
      this.pool[i] = c;
      return c;
    } catch (e) {
      return null;
    }
  }

  _bgmCtx(id) {
    if (this.bgm[id]) return this.bgm[id];
    if (!wxAvailable()) return null;
    try {
      const c = wx.createInnerAudioContext();
      c.src = BGM_SRC[id];
      c.loop = true;
      c.volume = BGM_VOLUME;
      if (typeof c.onError === 'function') c.onError(() => {});
      this.bgm[id] = c;
      return c;
    } catch (e) {
      return null;
    }
  }

  _applyBgm() {
    const want = this.enabled.music && this.unlocked && !this.paused ? this.sceneBgm : null;
    Object.keys(BGM_SRC).forEach((id) => {
      const isWanted = id === want;
      if (isWanted && !this.playing[id]) {
        const c = this._bgmCtx(id);
        if (!c) return;
        try {
          c.stop();
          c.play();
          this.playing[id] = true;
        } catch (e) { /* 资源缺失时静默 */ }
      } else if (!isWanted && this.playing[id]) {
        const c = this.bgm[id];
        if (c) {
          try { c.stop(); } catch (e) { /* ignore */ }
        }
        this.playing[id] = false;
      }
    });
  }
}

const audio = new AudioManager();
export default audio;
