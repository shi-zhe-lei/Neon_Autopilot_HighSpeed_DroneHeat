# Audio / 音频

## 中文

本模块拥有主题曲清单、节奏包、事件音效、连续环境声和原生媒体播放控制。资源 URL 仍相对根入口解析为 `assets/audio/`；音频失败只能降级，不能阻止游戏或改写速度、天气、路线、碰撞、生命与玩法随机数。

`Neon-music-library-4` 是十二首本地无人声配乐的不可变语义合同。`TRACKS_BY_REALM` 与 `TRACK_IDS_BY_REALM` 继续作为分组权威，但每境两首现在是按境内进度排序的叙事章节，而不是可互换的同类背景：晨岛“孤独苏醒 → 勇气初翔”、云野“好奇漫游 → 伙伴嬉游”、雨林“雨幕寻灯 → 失落后的道歉与成长”、霞谷“技巧竞翔 → 旅程高潮”、禁阁“记忆回望 → 智慧静默升阶”、伊甸“恐惧朝圣与牺牲 → 慈悲释放与重生”。“随境”只在当前境内依章节或自然结束轮播，“顺序”“漫游”“自选”继续覆盖完整曲库，自选才永久循环单曲。每首必须记录境界、章节、叙事作用、来源和许可，允许值为 `CC0-1.0` 与 `CC-BY-3.0`；两首署名曲是 `Happy flutes` / Tomasz Kucza（Magnesus）和 `Death Is Just Another Path` / Otto Halmén。

`Neon-music-rhythm-4` 为十二首哈希锁定母带离线派生 `12Hz` 五频段包，并保存 EBU R128 测量；所有母带统一在约 `-20 LUFS`。`Neon-music-player-8` 保留两副原生媒体 deck、`1_600ms` 等功率淡化和 HTTP(S)/`file://` 共用传输，按境界施加晨岛 `-2dB`、云野 `-1dB`、雨林 `-2dB`、霞谷 `0dB`、禁阁 `-3dB`、伊甸 `-1dB` 的呈现增益，并以只读 `semantic` / `loudness` 诊断公开当前章节和响度链。暂停或起飞前试听复用正式飞行增益；`modelDebug=1` 读取玩家已有模式/曲目作为初态，但写入为 no-op，试听变更不会污染正式偏好。五根节奏条按原生 `currentTime` 读取离线包，不捕获或改道可听音乐；自动合同通过不代表玩家已经签收实际听感。

`Neon-effect-assets-1` 把现有九个 OGG 的原始字节内联为静态传输。`file://` 不再因 `fetch` 被拦而改用合成音；HTTP(S) 请求绑定发布代号，传输失败或成功响应无法解码时才用同字节内联。两条路径都进入同一 Web Audio 解码、增益、速率和效果总线。

`Neon-audio-13` 定义二十九个语义事件。恢复上下文或解码期间，每个冷却组最多延迟一个语义，TTL 为 `1_000ms`；隐藏、禁用、重开、暂停、继续和结束会清空旧意图并停止已启动或排期的瞬态声，两份精确 OGG 都失败才允许合成。只读诊断另公开瞬态数量、取消计数与原因。未知事件抛出 `RangeError`。

可信的 `Q / E / T` 键盘换挡与桌面、触控变速箱按钮都属于玩法音频解锁面；变速箱可以作为玩家首次交互，不会出现模式已切换但音频上下文仍未解锁的分叉。

`jump` 事件只属于玩家或领航明确触发的 SPACE 起飞。实体跳台坡唇失去支撑发布独立的 `jump-platform-release` 轨迹事件，不消费 `phaseJump3.ogg`，也不合成起飞提示；连续推进、气流和随后真实落地的接触声负责描述自然腾空过程。未落在真实道路上的坠毁只复用正式结束事件，不叠加调试专用声或第二次起飞声。

连续推进声使用 `authoritative-core-drive-v5`：核心与谐波的音高读取 `coreRpm`/`coreSpool`，响度读取 `coreSpool`/`thrustNormalized`，高挡负载只读取运行时已解析的传动负载包，不再从车速猜发动机状态。`rpmMix` 继续以 `1,800–12,000 RPM` 基础区间归一化，但上限由完整 `15,000 RPM` 成长区间推导为约 `1.294`，因此权威转速随烛光提高时，音高与滤波仍会继续响应而不会在旧上限削平。相同核心与负载状态在不同速度下必须产生相同发动机目标；速度只控制带限气流及既有地表接触层。旧 `throttle` 字段仅作为未发布核心字段时的失效安全过渡，不会覆盖已发布的权威核心值。

速度专属混音使用真实 `0–160km/h` 道路范围：静止时无气流底噪，气流从 `50km/h` 渐入并在 `160km/h` 达到完整强度，积水/积雪接触纹理在 `120km/h` 达到参考强度。只读诊断同步公开 `50 / 120 / 160km/h` 三个边界；这些阈值只改变呈现，不会向推进核心或速度状态回写。

近雷、中雷、远雷由确定性滤波噪声和低频体合成，并在视觉主闪上升沿轮换触发；共享 `4_500ms` 冷却阻止回闪双响。雨、风/雪、冰雹和沙尘复用一份持久确定性噪声源。原始 `0–1` 雨量通过 `raw-intensity-three-band-with-tunnel-transmission` 在轻雨细节、中雨雨幕与暴雨低频体三条固定户外带通分支间连续交叉淡化；大于 `1` 的响度指数压低小雨。普通高架主路不属于封闭隧道，户外雨声保持完整；山体廊道和地下隧道另由一条低通传导分支分别保留户外雨量的 `18% / 10%`，因此洞内雨声会变暗、变远但不会消失，洞口也不会把暴雨误分成亮而薄的小雨。雨层总增益不超过 `0.0115`，雨与风不超过 `0.022`，全部连续天气层不超过 `0.032`。诊断公开原始雨量、户外直达/隧道传导增益、隧道类型、档位、三层增益及最终天气余量。积水、雪和雪泥继续使用固定接触分支；每帧 `update()` 只自动化既有 `AudioParam`，不创建节点或事件风暴。

资源完整性测试还要求九个内联载荷与交付 OGG 逐字节相等、`file://` 零 `fetch`，并覆盖恢复/解码竞态、TTL 和生命周期清理。

连续推进声仍只消费运行时已解析的 `coreSpool / coreRpm / thrustNormalized`。贴地1挡零踏板蠕行会作为很小的真实交付推力出现在共享 `1,800 RPM` 怠速包中；S、换挡、腾空或2/3挡断开后该分量为零。松油门后的核心声继续随权威 spool/RPM 自然回落，飞船层的 `exhaustEnergyNormalized` 余焰只作呈现，不反向放大音量或物理。

高挡低速负载复用 `authoritative-core-drive-v5` 的持久推进节点，不增加提示音、蜂鸣或新音源。运行时必须显式发布 `gearTorqueAvailability / gearLuggingSeverity / gearLoadNormalized / gearLugging / gearStalled`；其中 `gearLoadNormalized` 已由油门门控，字段缺失时严格取零，避免仅有警告或松油门滑行误发重载声。满负载最多把核心基频降低 `22%`、谐波比降低 `0.12`、低通截止降低 `52%`（不低于 `820Hz`），同时压低谐波并轻度提高共振；只读诊断公开完整输入和 `luggingAudioMix`。该混音只改变已有 `AudioParam` 目标，不创建节点、不发事件，也不写回推进物理。

## English

This module owns the score catalog, rhythm packets, event effects, continuous ambience, and native-media transport. Asset URLs remain document-relative to root `assets/audio/`. Audio failure is fail-soft and can never block play or write speed, weather, routing, collision, lives, or gameplay RNG.

Continuous propulsion audio still consumes only runtime-resolved `coreSpool / coreRpm / thrustNormalized`. Grounded zero-pedal Gear-1 creep appears as a small real delivered-thrust component in the shared `1,800 RPM` idle packet; S, a shift, airborne motion, or Gears 2/3 removes it. Core sound decays with authoritative spool/RPM after release, while ship-only `exhaustEnergyNormalized` afterglow cannot feed back into volume or physics.

Tall-gear low-speed load reuses the persistent `authoritative-core-drive-v5` propulsion nodes and creates no cue, buzzer, or new source. Runtime must explicitly publish `gearTorqueAvailability / gearLuggingSeverity / gearLoadNormalized / gearLugging / gearStalled`; `gearLoadNormalized` is throttle-gated and missing data strictly resolves to zero, preventing a warning-only state or throttle-off coast from producing strain. Full load can lower the core fundamental by up to `22%`, reduce the harmonic ratio by `0.12`, and close the low-pass by up to `52%` with an `820Hz` floor, while reducing harmonic level and mildly raising resonance. Read-only diagnostics expose the complete packet and `luggingAudioMix`. The mix only retargets existing `AudioParam` values, allocates no nodes, dispatches no event, and never writes propulsion physics.

`Neon-music-library-4` is the immutable semantic contract for twelve local instrumental scores. `TRACKS_BY_REALM` and `TRACK_IDS_BY_REALM` remain the grouping authority, but each realm's pair is now an ordered in-realm narrative rather than interchangeable background music: Dawn “solitary awakening → courageous first flight,” Prairie “curious roaming → companionship and play,” Rainforest “seeking shelter → apology and growth after loss,” Valley “skilled flight → journey crescendo,” Vault “memory and reflection → wise silent ascent,” and Eden “fearful pilgrimage and sacrifice → compassionate release and rebirth.” Adaptive advances or rotates only inside the current realm; Sequential, Shuffle, and Manual still cover the full catalog, and only Manual loops one score forever. Every record must carry realm, chapter, narrative role, provenance, and a license from the `CC0-1.0` / `CC-BY-3.0` allowlist. The attributed scores are `Happy flutes` by Tomasz Kucza (Magnesus) and `Death Is Just Another Path` by Otto Halmén.

`Neon-music-rhythm-4` stores `12Hz` five-band packets and EBU R128 measurements for twelve hash-pinned masters. `Neon-music-player-8` retains two decks, a `1_600ms` equal-power crossfade, realm gains, and read-only diagnostics. Preview reuses production flight gain. For parity, `modelDebug=1` reads the player's existing mode/track as its initial state, but writes are no-ops, so auditions cannot contaminate formal preferences. Automated contracts are not player listening sign-off.

`Neon-effect-assets-1` embeds the unchanged bytes of the existing nine OGG effects. `file://` no longer changes to synthesis when `fetch` is blocked; versioned HTTP(S) requests use the same inline bytes after transport failure or an undecodable successful response. Both paths use the same Web Audio decode, gain, rate, and effects bus.

`Neon-audio-13` declares twenty-nine semantic events. During context resume or decode, at most one cue per cooldown group is deferred for `1_000ms`; hiding, disabling, reset, pause, resume, and game over clear stale intent and stop active or scheduled transients. Synthesis requires both exact OGG copies to fail. Read-only diagnostics also expose transient count, cancellation count, and reason. Unknown names throw `RangeError`.

Trusted `Q / E / T` transmission keys and both desktop and touch transmission buttons are gameplay audio-unlock surfaces. Transmission can therefore be the player's first interaction without changing mode while leaving the audio context locked.

The `jump` event belongs only to a deliberate player or autopilot SPACE launch. Loss of support at a physical jump-platform lip publishes a separate `jump-platform-release` track event, consumes neither `phaseJump3.ogg` nor its synthesized launch fallback, and is conveyed by continuous propulsion/airflow followed by physical landing contact. An off-road crash reuses the production game-over event without a debug-only cue or second launch sound.

Continuous propulsion uses `authoritative-core-drive-v5`: core and harmonic pitch consume `coreRpm`/`coreSpool`, level consumes `coreSpool`/`thrustNormalized`, and tall-gear strain consumes only runtime's resolved drivetrain-load packet rather than inferring engine state from speed. `rpmMix` remains normalized against the `1,800–12,000 RPM` base range, while its approximately `1.294` ceiling is derived from the complete `15,000 RPM` growth range, so pitch and filtering continue responding instead of flattening at the former ceiling. Identical core and load state must produce identical engine targets at different speeds; speed controls only band-limited airflow and existing surface-contact layers. Legacy `throttle` is a fail-soft bridge only when no core fields are published and cannot override authoritative core values.

Vehicle-speed-only mixing uses the physical `0–160km/h` road range. Rest has no airflow noise floor, airflow fades in from `50km/h` and reaches full strength at `160km/h`, while water/snow contact texture reaches its reference strength at `120km/h`. Read-only diagnostics expose all three `50 / 120 / 160km/h` boundaries. These thresholds are presentation-only and never write back into propulsion or speed state.

Near, mid, and far thunder are synthesized from deterministic filtered noise and low-frequency bodies, then rotated on the visible main-flash rising edge. A shared `4_500ms` cooldown rejects return-stroke doubling. Rain, wind/snow, hail, and dust reuse one persistent deterministic noise source. Raw `0–1` rainfall uses `raw-intensity-three-band-with-tunnel-transmission` across fixed outdoor light-detail, steady-curtain, and low downpour-body branches. A greater-than-one loudness exponent suppresses weak rain. An ordinary elevated main road is not a sealed tunnel and retains full outdoor rain; mountain galleries and underground tunnels use a separate low-pass return at `18% / 10%` of outdoor rainfall, so rain becomes darker and more distant but never disappears. Rain alone, rain plus wind, and all continuous weather sums remain capped at `0.0115 / 0.022 / 0.032`; diagnostics expose raw intensity, direct/tunnel gains, tunnel kind, tier, branch gains, and final headroom. Water, snow, and slush retain fixed contact branches. Each `update()` automates existing `AudioParam` targets only and cannot allocate per-frame nodes or dispatch event storms.

Integrity tests also require all nine inline payloads to be byte-identical to delivered OGG files, zero fetches under `file://`, and bounded resume/decode races, TTL, and lifecycle cleanup.
