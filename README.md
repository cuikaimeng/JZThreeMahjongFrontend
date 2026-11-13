# 前端 · 微信小游戏

纯 Canvas 2D 的**微信小游戏**（不是小程序页面，没有 wxml）。入口 `game.js`，`game.json` 锁定竖屏；`js/main.js` 管理场景、触摸路由与逐帧渲染。

## 运行

| 方式 | 步骤 |
|---|---|
| 微信开发者工具 | 导入本目录（`project.config.json` 已配置 `compileType: game`、AppID、`urlCheck:false`）→ 勾选「不校验合法域名」→ 编译 |
| 浏览器预览 | 先启动后端（`:3000`），再 `cd frontend && node tools/dev-server.js`，打开 `http://localhost:8790/preview/index.html` |

预览页 `preview/index.html` 用 `window.wx` shim 模拟小游戏 API：`wx.request` / `wx.connectSocket` 真实连接后端，其余为浏览器适配（触摸、存储、Toast、剪贴板、`createImage`、分享等）。**它不是数据源 mock**，联机走真实后端；加 `?env=prod` 可让预览页连生产 https/wss。

## 开发 / 生产两套环境

地址定义在 `js/net/env.js`，业务代码仍从 `js/net/config.js` 取 `API_BASE` / `WS_URL`：

| 环境 | API_BASE | WS_URL |
|---|---|---|
| DEV（开发者工具、浏览器预览） | `http://localhost:3000` | `ws://localhost:3000/ws` |
| PROD（体验版 / 正式版） | `https://<PROD_DOMAIN>` | `wss://<PROD_DOMAIN>/ws` |

切换规则（`ENV_OVERRIDE='auto'` 时）：启动参数 `?env=dev|prod` > 微信 `envVersion`（`develop` → DEV，`trial` / `release` → PROD）> 默认 DEV。把 `ENV_OVERRIDE` 改成 `'prod'` 可在开发者工具里连生产服务器联调。

部署前把 `js/net/env.js` 顶部的 `PROD_DOMAIN` 改成已备案域名，并在微信公众平台配置 `request` / `socket` / `downloadFile`（微信头像 CDN）合法域名；开发者工具本地联调仍需勾选「不校验合法域名」。

## 目录结构

```
frontend/
├── game.js / game.json          入口（竖屏）、预加载牌面后 new Main()
├── project.config.json          开发者工具项目配置（AppID、编译选项）
├── project.private.config.json  个人本地配置
├── js/
│   ├── main.js                  场景管理、联机初始化、战绩加载、分享进房
│   ├── render.js                Canvas 创建、缩放与竖/软件横屏坐标变换
│   ├── audio/audioManager.js    BGM / 音效 / 设置开关 / 前后台生命周期
│   ├── fx/effects.js            胡牌特效（视觉 + 番型播报人声 + 光效音）
│   ├── net/                     config / api(REST) / ws(长连接) / share(分享)
│   ├── user/                    userInfo(当前用户)、wxProfile(微信授权)
│   ├── ui/                      draw(通用绘制)、tileFace(牌面 PNG 绘制与矢量回退)
│   ├── lobby/ create/ join/     大厅、建房配置、房号密码输入
│   ├── room/                    等待开局
│   ├── game/                    对局页（含结算详情面板）、gameRules、handCheck
│   ├── result/                 单机结算页（在线结算不走此页）
│   ├── history/                战绩列表、牌谱详情、historyAdapter(后端数据适配)
│   │   └── historyData.js      离线设计稿示例，当前无页面引用
│   └── rules/ settings/         规则页（规则/番型双 Tab）、设置页
├── assets/images/               35 张牌面 PNG（万/筒/条 1-9、字牌、牌背）
├── audio/                       bgm/（2 首）+ voice/（43 条人声）+ effect/（19 个合成音）
├── preview/index.html           浏览器预览 + wx API shim（含音频 shim）
└── tools/                       dev-server.js、gen-audio.js（合成音）、gen-voice.js（报牌人声）
```

## 场景（10 个，均由 `main.js` 注册与切换）

`lobby` 大厅 · `rules` 规则 · `history` 战绩列表 · `detail` 牌谱详情 · `settings` 设置 · `create` 建房 · `join` 加入 · `room` 等待开局 · `game` 对局 · `result` 单机结算。

场景通过回调与 `main.js` 通信（如 `onButton` / `onEnterRoom` / `onJoin` / `onOpenDetail` / `onInvite`），触摸事件由 `main.bindTouch()` 统一换算坐标后分发到当前场景。

## 音频系统（第二阶段）

`js/audio/audioManager.js` 是唯一的音频入口，基于 `wx.createInnerAudioContext()`；环境不支持音频 API 或资源缺失时静默降级，不影响对局逻辑。

**资源分三类**（统一为 16-bit PCM WAV / 22050Hz 单声道，合计约 2.6 MB）：

| 目录 | 内容 | 生成方式 |
|---|---|---|
| `audio/bgm/` | `lobby.wav`、`game.wav` 两首循环曲 | `node tools/gen-audio.js`（程序合成占位） |
| `audio/voice/` | 34 张牌的普通话报牌 + 碰/杠/听/胡 4 条动作语音 + 5 条番型播报，共 43 条 | `node tools/gen-voice.js`（macOS 系统中文 TTS） |
| `audio/effect/` | 摇骰、发牌、点击、流局、开局/结束等提示音，以及 4 种胡牌特效音（`fx_rise` / `fx_dragon` / `fx_chime` / `fx_burst`），共 19 个 | `node tools/gen-audio.js` |

上线时用同名文件覆盖即可替换为有商用授权的正式配音 / BGM，无需改代码；若改用 mp3，调整 `audioManager.js` 顶部的 `BGM_SRC` 与 `resolveSfx()` 里的路径后缀即可。`effect/` 中出牌与碰杠听胡的合成版已由人声替代，文件保留作备用占位，可按需删除。

**BGM**：`main.js` 的渲染循环检测场景变化并调用 `audio.setScene()`，仅 `game` 场景播对局曲，其余场景播大厅曲，均循环播放。iOS 需用户手势才能起播，故首次触摸时调用 `audio.unlock()`；切后台 / 音频中断自动暂停，回前台恢复。

**音效**：对局服务端事件统一在 `gameScene.onNetEvent()` 入口交给 `audio.onGameEvent()` 分发：

| 事件 | 音效 |
|---|---|
| `dice` | 摇骰 |
| `deal` / `draw` | 发牌 / 摸牌（摸牌音量减半） |
| `discard` | 普通话报牌（如 `3m` →「三万」、`1s` →「一条」）；报听扣牌为暗牌，只播通用提示音、不报牌名 |
| `action`（`peng` / `gang` / `angang` / `bugang` 等） | 人声「碰」/「杠」 |
| `listen` | 人声「听牌」 |
| `settle` | 有赢家由胡牌特效播放番型播报人声 + 光效音 + 震动，流局播合成收束音 |
| `offer`（可胡） | 提示音 |
| `gameStart` / `matchOver` | 开局 / 全场结束 |

大厅按钮、设置页行、对局动作按钮另有点击音。音效由 8 个 `InnerAudioContext` 轮询复用，避免每次播放都新建实例。

**报牌人声**：`tools/gen-voice.js` 调用 macOS 的 `say` + `afconvert` 生成语音，自动挑 `zh_CN` 语音（默认 `Tingting`，可用 `JZ_VOICE=Sandy node tools/gen-voice.js` 换声线），并做音量归一化与首尾静音裁剪。牌面编码与文件一一对应：`t2m.wav`=二万、`t1s.wav`=一条、`tE.wav`=东风、`tC.wav`=红中；动作为 `act_peng` / `act_gang` / `act_listen` / `act_hu`。要改读法（如把「红中」改成「中」），改脚本里的 `HONOR` / `ACTIONS` 文本后重跑即可；生成的 WAV 已随代码包发布，真机运行时不依赖 `say`。该脚本只需在 macOS 开发机运行一次。

**设置联动**：设置页「音乐 / 音效 / 震动」继续沿用 `set_music` / `set_sound` / `set_vib` 三个本地键；切换时通过 `audio.syncFromSettings()` 即时生效——关音乐立刻停 BGM，关音效立刻静音，关震动不再触发 `wx.vibrateShort`。

**浏览器预览**：`preview/index.html` 的 wx shim 用 HTML5 `Audio` 模拟 `createInnerAudioContext`，并把包内路径 `audio/` 映射为 `../audio/`；`tools/dev-server.js` 已为 `.wav` 配置正确 MIME，预览页同样可听。

## 胡牌特效（视觉 + 音效组合）

`js/fx/effects.js` 把画面特效和声音打包成一套，由 `gameScene.onSettle()` 在有赢家时调用 `fx.playWin()` 触发，绘制在结算面板之上，约 2.9 秒自动淡出；不参与触摸命中，不影响点「准备」。新一局开始或离开对局页时自动 `stop()`。

`handName`（后端 `scoring.js` 给出，多个番型同时命中时取优先级最高的名称）决定用哪一套：

| 牌型 | 画面 | 声音 |
|---|---|---|
| 十三幺 | 13 道星光从四周汇聚中心 + 开场白闪 + 星点环绕 | 爆发音 + 播报「十三幺」 |
| 豪七对 | 24 道金色放射光线 + 粒子爆发 + 轻微画面震动 | 爆发音 + 播报「豪七对」 |
| 清一色 | 同色光柱横向扫过 + 大量上浮光点 | 上行扫光音 + 播报「清一色」 |
| 一条龙 | S 形光带 + 9 个光点依次点亮 + 流动尾迹 | 九音上行 + 播报「一条龙」 |
| 七小对 | 7 对牌卡成对飞散 + 三层环形涟漪 | 星光铃 + 播报「七小对」 |
| 平胡 / 对对胡 | 轻量金光横幅 + 少量上浮光点 | 播报「胡牌」 |

横幅显示番型名与副标题（`×N 番` / 自摸 / 抢杠胡 / 赢家），配色随番型变化；粒子用 `globalCompositeOperation = 'lighter'` 叠加发光。音效仍走 `audioManager`，因此设置页「音效」「震动」开关对特效同样生效，关掉音效后只保留画面。

**扩展**：新增场景特效只需在 `PRESETS` 里加一项（画面 style 对应 `DRAWERS` 中的绘制函数、声音对应 voice / sfx 名），再在对应事件里调用 `fx.play(id, { title, subtitle })`，并用两个 `gen-*.js` 脚本补同名 WAV 即可。目前触发点只有胡牌结算，也可按需扩展到自摸、杠上开花、全场结束等。

## 网络层

- `net/api.js`：`wx.request` 封装（自动带 Bearer、401 清会话），提供 `login` / `ensureLogin` / `updateProfile` / `createRoom` / `joinRoom` / `getRoom` / `getHistory` / `getHistoryDetail` / `getLoginLogs` / `getGameLogs` 等接口；token 与用户缓存在 `wx.setStorageSync`
- `net/ws.js`：`Net` 单例，连接后立即发 `auth`，`authOk` 后 flush 待发队列；断线重连（最多 5 次、递增延迟）并自动 `rejoin`
- `net/share.js`：构造 / 解析分享参数 `roomCode=xxxxxx[&pwd=xxxx]`，注册 `wx.onShareAppMessage`、调起 `wx.shareAppMessage`
- `main.js` 订阅 `roomState / gameStart / dice / dealer / dealStep / deal / turn / draw / discard / offer / action / listen / settle / roundEnd / nextReady / matchOver / gameResume` 等事件并转交给 `gameScene.onNetEvent()`

## 微信能力

| 能力 | 实现 |
|---|---|
| 账号 | `wx.login` 取 code → `POST /api/auth/login`；后端配置 AppID/Secret 后换 openid，否则游客登录 |
| 头像昵称 | `user/wxProfile.js`：已授权时静默取；点击大厅用户卡时 `wx.getUserProfile`，不支持则降级 `wx.createUserInfoButton`；成功后 `PUT /api/users/me` 落库 |
| 分享进房 | 房间「＋邀请好友加入」与右上角转发菜单均带房号（密码房带 `pwd`）；好友点击后从 `wx.getLaunchOptionsSync().query`（冷启动）或 `wx.onShow`（热启动）解析，自动登录 → `/api/rooms/join` → WS join → 直接进房；3 秒内重复触发去重 |
| 降级 | 不支持分享时复制房号；微信返回匿名资料（「微信用户」+ 空头像）时保持游客身份并提示 |

## 真实数据 vs 离线演示

**真实后端数据**：大厅用户资料、房间状态与房号密码、对局全过程、战绩列表/牌谱详情（`/api/history`，含结算快照）、登录日志与对局日志接口。战绩页有 loading / 空数据 / 失败点击重试状态，触底分页加载 20 条。规则页为静态知识内容（规则 / 番型双 Tab，番型示例用真实牌面绘制）。

**仍为本地演示数据**（仅联机不可用时生效，或标注为设计稿）：

- `game/gameScene.js` 的固定演示牌面 / 模拟本局结果菜单
- `room/roomScene.js` 的定时模拟好友加入与随机昵称
- `result/resultScene.js` 的默认结算数据（在线结算走对局页内的 `drawHuDetail` 面板，不进入此页）
- `history/historyData.js` 示例战绩（无页面引用）
- 建房页「留4垛 / 摸完」「去风牌」开关仅作为展示，后端目前固定留 7 垛、不去风牌

## 预览调试参数与句柄

`preview/index.html?…` 支持：

| 参数 | 作用 |
|---|---|
| `wxAuthorized=1` | 模拟已授权，启动时静默拿微信资料 |
| `wxNick=…` / `wxAvatar=…` | 自定义模拟昵称 / 头像 URL |
| `wxProfileMode=button` | 强制 `getUserProfile` 失败，走原生授权按钮降级路径 |
| `roomCode=<6位>&pwd=<4位>` | 模拟好友点击分享卡片冷启动进房 |

浏览器控制台可用：`GameGlobal.__scenes`（主类与各场景）、`GameGlobal.__net`（WS 客户端）、`window.__wxTest`（`lastShare`、`getShare()`、`fireShow(query)`、`tapProfileButton()`、`profileCalls`）、`window.__setOrientation(w,h)`。

## 上线前检查

1. `js/net/config.js` 换成 https / wss 并在小程序后台配置合法域名
2. `backend/.env` 配好 `WX_APPID` / `WX_SECRET`，否则登录仍是游客模式
3. 后台 CORS 当前为 `Allow-Origin: *` 的开发配置，需收紧
4. `audio/` 内 BGM 与提示音为程序合成占位素材、人声由 macOS 系统 TTS 生成；正式上线前建议替换为有商用授权的配音与音乐（同名覆盖即可）。当前音频约 2.6 MB、上传包约 3.2 MB（主包上限 4 MB），继续加资源前建议先把 WAV 转 mp3
