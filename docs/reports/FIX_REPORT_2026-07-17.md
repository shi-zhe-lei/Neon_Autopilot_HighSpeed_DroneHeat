# Neon 宇宙飞船审计修复报告 / Neon Spaceship Audit Remediation Report

- 修复日期 / Remediation date: `2026-07-17`
- 原始审计 / Source audit: [AUDIT_REPORT_2026-07-16.md](../audits/AUDIT_REPORT_2026-07-16.md)
- 修复对象 / Target: `Neon_Autopilot_HighSpeed_DroneHeat`
- 生产入口 / Production entry: `Neon_Autopilot_HighSpeed_DroneHeat.html`
- 当前首方 JS/CSS 代次 / Current first-party JS/CSS generation: `23-speed-perception-117`

## 1. 结论 / Conclusion

本轮已落地原审计列出的 `6` 组 P1 代码修复，并对 P2 的确定性重放、只读诊断、动态预测、门户物理、热路径、性能门禁分离、响应式、辅助输入、输入生命周期、全屏和音频路径进行了修订。本报告只按各项列出的 Node、静态或浏览器证据判定对应范围；当前机器上的真实 WebGL 尺寸矩阵和 `3` 个 seed 的正常起步 `300m/s` 长跑已完成，但 P1-02 的完整生产 helper/pool/出生帧/提交清理集成、屏幕阅读器、原生 `200%` 缩放、最低浏览器矩阵和 Chrome allocation profile 仍未验证。修复没有加入锁血、碰撞旁路、速度直写、传送、额外抓地力或降低障碍密度；自动领航仍只通过玩家可用的数字转向、起跳和刹车输入控制飞船。

Code changes for all six P1 release blockers have been implemented, together with P2 revisions for deterministic replay, read-only diagnostics, dynamic prediction, portal physics, hot paths, benchmark isolation, responsive layout, assistive input, lifecycle cleanup, fullscreen behavior, and deferred audio loading. Each status below applies only to its cited Node, static, or browser evidence. The real-WebGL viewport matrix and normal-start `300m/s` runs across three seeds are complete on this host; full P1-02 production helper/pool/birth-frame/commit-cleanup integration, screen readers, native `200%` zoom, the minimum-browser matrix, and a Chrome allocation profile remain unverified. No life lock, collision bypass, direct speed assignment, teleport, extra grip, or obstacle-density reduction was introduced; the autopilot still acts only through player-equivalent steering, jump, and brake inputs.

最终发布判断 / Final release decision: `CONDITIONAL PASS / 条件通过`。当前代码、确定性门禁、In-app 尺寸矩阵、Chrome Full HD 和三 seed 公平长跑通过；完成上述生产集成与跨浏览器/辅助技术/分配剖析前，不应标记为无条件正式发布。 / Code, deterministic gates, the In-app matrix, Chrome Full HD, and three-seed fair runs pass; do not mark an unconditional production release until the remaining integration, cross-browser/AT, and allocation-profile evidence is complete.

## 2. 原审计逐项实现与证据边界 / Source-audit implementation and evidence boundaries

下表的 `PASS` 只表示引用的证据范围通过，不会扩展成第 3 节未记录的浏览器、辅助技术、性能或长跑结论。 / A `PASS` below applies only to its cited evidence scope and does not extend to browser, assistive-technology, performance, or long-run conclusions not recorded in section 3.

### P1 发布阻断项 / Release blockers

| ID | 修复 / Remediation | 证据 / Evidence | 状态 / Status |
|---|---|---|---|
| P1-01 | 在路线空间加入相对运动 swept AABB；障碍、拾取、移动障碍和 edge 接缝消费同一前后帧区间。玩法热路径使用无临时对象的标量接口，详细诊断 API 继续保留。 / Added route-space relative-motion swept AABB for hazards, pickups, moving hazards, and edge seams. Gameplay uses the allocation-free scalar API while retaining the detailed diagnostic API. | 固定 seed 的纯 Node PathPlan 重放在 `120/60/30/22Hz` 与 `45ms` 得到相同 `7` 个 damage ID、`7` 个 pickup ID；其中 `6` 个 moving hazard，`hazard-6` 跨真实 edge seam；另执行 `2_000` 组 API 差分。 | PASS |
| P1-02 | 未提交直道岔路按共享 `trafficGroupId` 镜像全部可达支路，提交时原子保留选中副本；密度和 dynamic cap 按当前路径可达组计数。 / Uncommitted straight forks mirror every reachable branch under one traffic group, then atomically retain the selected copy; density and dynamic caps count current-path reachable groups. | `gameplay-core.test.js` 以 deterministic topology/count model 在 `100` seeds 中构造 `347` 个逻辑 traffic groups；左右当前路径计数均为 `347`、模型误差为 `0%`，并验证提交后每组一份及 wrong-route dynamic 不占当前路径 cap。`dynamic-branch-expansion.test.js` 另覆盖 Track approach→branch transition 和生产源码静态连线/池化断言；它没有完整执行生产 helper、真实池/数组、生成帧碰撞或 commit cleanup。 / The `347` groups are a deterministic topology/count model, while the transition suite adds Track and source-static coverage; this is not a full production helper/pool/birth-frame/commit integration run. | MODEL PASS / INTEGRATION PENDING |
| P1-03 | 三个生成计时器保留 overshoot，并在持久的 `120Hz` gameplay lattice 上按模拟到期顺序处理；每个到期事件都使用由 `runSeed + global event ordinal + channel` 派生的独立随机流，事件内条件抽样不会移动后续事件的 root。 / All three timers retain overshoot on a persistent `120Hz` gameplay lattice; each due event receives an isolated stream derived from `runSeed + global event ordinal + channel`, so conditional draws cannot shift later event roots. | `gameplay-core.test.js` 验证常量速率的事件顺序与 timer；`spawn-cadence.test.js` 在 `120/60/30/22Hz` 与 `45ms` 下比较加速生产标量策略的 channel/event-root 顺序、timers、value integral 和积分距离。该证据不声称依赖实时实体/路线状态的最终对象布局也完全不变。 / Tests lock event-root order, timers, the integrated value, and fixed-lattice distance, not identical final object layouts. | EVENT-LATTICE PASS |
| P1-04 | 道路组合壳体封闭连接边界并为岔路补足 runtime support，同时保留“连接端不生成内部端盖”的跨组件合同。 / Closed the composed road shell and filled straight-fork runtime supports while preserving the no-internal-connected-cap contract. | boundary edges=`0`，non-manifold=`0`，抑制内部端盖=`56`；最大连续支撑间距=`51.429m ≤ 104.01m`。 | PASS |
| P1-05 | 图块诊断分成 active tile、resident pool 和 per-tile invariants；crossing/span/cap/lens 不再把驻留总和与单图块常量混用。 / Split tile diagnostics into active-tile, resident-pool, and per-tile invariant scopes; crossing/span/cap/lens checks no longer compare pool totals with per-tile constants. | `cloverleaf-tiles.js`, main runtime, `layout-test.html`；发布每活动图块 `20` crossings、`16` spans、`16` aprons、`14` lenses、`2` vertical separations。 | PASS |
| P1-06 | 本地锁定 Three.js r160；安全存储拒绝降级；renderer/compile/首帧、运行时未捕获错误和 `webglcontextlost` 统一进入可聚焦恢复页，停止 RAF、输入和音频权威。 / Pinned local Three.js r160; made storage denial non-fatal; routed renderer/compile/first-frame, uncaught runtime errors, and `webglcontextlost` through one focusable recovery surface that stops RAF, input, and audio authority. | `errors/startup.js`, main runtime, startup/runtime tests；错误只展示一次并保留重新加载入口。 | PASS |

### P2 中优先级项 / Medium-priority findings

| ID | 关闭方式 / Closure | 状态 / Status |
|---|---|---|
| P2-01 | 每局按 `runSeed` 重建 gameplay RNG，预览与效果使用独立流；重开同 seed 不继承上一局消费位置。 / Rebuild gameplay RNG from `runSeed` each run and isolate preview/effect entropy. | PASS |
| P2-02 | 删除生产 `NeonDiagnostics.state`；公开面冻结，只在 `modelDebug=1` 提供不含速度/生命/无敌等权威写入口的窄测试钩子。 / Removed the live production state export; the public facade is frozen and debug hooks cannot mutate speed, lives, invulnerability, or other physics authority. | PASS |
| P2-03 | 真实障碍更新与预测共用 lateral-drift 积分合同。 / Real obstacle motion and prediction share the same lateral-drift integration contract. | PASS |
| P2-04 | 门户扫掠使用本帧输入、加速度和半隐式横向步进，不再只按旧位置线性外推。 / Portal sweeping includes current input, acceleration, and the shared semi-implicit lateral step. | PASS |
| P2-05 | 同帧 emergency/planner/guardian 共享一次感知；完整规划以 `30Hz` 为 target/cap，保留 cadence overshoot，但在持续 `45ms` 慢帧下每帧最多执行一次（约 `22.2Hz`）；rollout 使用有界预分配 TypedArray scratch，飞船颜色、路线指示、HUD CSS 和碰撞热路径复用 scratch/缓存。 / Emergency, planner, and guardian share one perception per frame; full planning targets and caps at `30Hz`, but sustained `45ms` slow frames can run only once per frame (about `22.2Hz`); rollouts use bounded preallocated TypedArray scratch, and other hot paths reuse scratch or cached values. Runtime/source tests cover cadence and overwrite safety, but a Chrome allocation profile has not been executed. | CODE PASS / BROWSER EVIDENCE IN §3 / ALLOCATION PROFILE PENDING |
| P2-06 | 逻辑判定改用合成单调时钟/工作量上限，音频 deadline/cooldown/suspend 也由注入式 fake scheduler 精确推进；普通 Node 测试中的 wall-clock 只允许输出 data-only 观测，正式 P50/P95 位于非门禁 benchmark。道路预热以 `4ms` 外层/`2ms` 子构建预算切开 shell 创建、indexed merge、lens 站点审计、runtime support 与 variant 初始化；只允许显式 cursorized merge/lens 微步骤在 `1.25ms` 内短批处理。浏览器夹具在暂停路线权威时轮询当前 recovery 的两个候选驻留，随后清空帧窗口、恢复玩法并收满 `240` 个可见玩法帧；未来图块的正常 idle 分片仍留在样本中。同时发布 DPR、backing-buffer 像素与画质预算，原 `FPS/P95/max/Long Tasks` 阈值均未降低。 / Logic gates use synthetic clocks or work bounds. Road warming separates the `4ms` outer callback from a `2ms` child budget and makes shell creation, indexed merging, lens audits, runtime supports, and variant initialization resumable; only explicit cursorized merge/lens microsteps may batch within `1.25ms`. The browser fixture freezes route authority until both current recovery variants are resident, resets diagnostics, resumes play, and collects `240` visible gameplay frames while normal future-tile slicing remains measured; no frame threshold was lowered. | NODE PASS / BROWSER RESULT IN §3 |
| P2-07 | 覆盖 `320×568`、`360×640`、`390×844`、`844×390` 和 `720×460-debug`；控制区、输入追踪和单一 compass ownership 使用独立安全带。 / Added explicit small-screen and debug fixtures with separate safe bands for controls, input tracking, and single compass ownership. | PASS |
| P2-08 | 全部按钮有名称和 `type=button`；按住控制使用 pointer capture，并为键盘/辅助技术提供等价且有界的激活与释放。 / All buttons are named and explicitly typed; hold controls use pointer capture with bounded keyboard/assistive equivalents. | PASS |
| P2-09 | 手册恢复缩放、文本选择和可见焦点；暂停/结束使用 live 状态与焦点交接；reduced-motion 关闭尾迹、speed streak、动态 FOV、震动、漂浮和非必要脉冲。静态 `accessibility-smoke.test.js` 核对手册辅助文字不低于 `11px`、对比度不低于 `4.5:1`，以及矮横屏规则不低于 `10px`；第 3 节的真实浏览器尺寸矩阵覆盖窄视口重排，但原生 `200%` 缩放和辅助技术结果仍必须单独记录。 / Restored guide zoom, selection, visible focus, live/focus handoff, and reduced-motion settling. Static checks cover `11px`/`4.5:1` auxiliary-text contracts and a `10px` short-landscape floor; the real-browser matrix in section 3 covers narrow reflow, while native 200% zoom and assistive-technology results remain separate. | STATIC + VIEWPORT PASS / ZOOM + AT PENDING |
| P2-10 | `P/C/O/Escape/R` 统一忽略 `event.repeat`。 / One-shot shortcuts ignore key repeat. | PASS |
| P2-11 | `releaseAllInputs()` 覆盖 pause、game over、reset、blur、hidden、pagehide 和 pointercancel；页面隐藏自动暂停。 / Unified input release covers every lifecycle boundary and hidden pages auto-pause. | PASS |
| P2-12 | 全屏优先信任 `fullscreenEnabled` 并显示拒绝提示；音频只在开始、主动开声或真实驾驶输入后分配/加载，打开手册不会下载资源。 / Fullscreen honors `fullscreenEnabled` and exposes rejection; audio allocates only after explicit play/audio/drive intent, not when opening the guide. | PASS |

### P3 文档、测试和清理 / Documentation, test, and cleanup

- 根目录、runner、模块、错误分类、vendor 与音频 README 均保留中英双语合同。 / Root, runner, module, error, vendor, and audio READMEs retain bilingual contracts.
- `node verify-node.mjs` 统一校验加载顺序、本地依赖、生产入口与布局夹具的首方 JS/CSS 缓存代次、全部 JavaScript 语法和串行 Node 测试；benchmark 只做语法检查。 / The unified verifier checks entry order, local dependencies, first-party JS/CSS generations in both production and layout-fixture entries, all JavaScript syntax, and serial Node tests; benchmarks are syntax-only in the gate.
- `.DS_Store` 已从 runner 范围清零，`.gitignore` 递归排除后续生成。 / `.DS_Store` is removed throughout runner scope and recursively ignored.
- 最低浏览器基线和实测覆盖已分开记录，避免把单一 Chrome 结果冒充跨浏览器结论。 / Minimum-browser targets are documented separately from measured coverage.

仍保留的非阻断覆盖债务：`world.js` 与 `modeling.js` 尚无各自独立的直接单元测试，布局夹具仍含少量为真实动画阶段服务的有界等待；这些项目不代表本轮已观察到的生产故障。 / Non-blocking coverage debt remains: `world.js` and `modeling.js` do not yet have dedicated direct unit suites, and the layout fixture retains a few bounded waits for real animation phases. These are coverage limitations, not observed production failures in this remediation.

## 3. 验证结果 / Verification results

### 3.1 确定性 Node 门禁 / Deterministic Node gate

```text
[verify-node] PASS: entry order, 23-speed-perception-117 local cache contract, local Three.js, 31 JavaScript files, 14 serial Node tests; 2 benchmark syntax-checked, not executed
TAP: 46 tests, 46 pass, 0 fail, 0 skipped, 0 todo
```

完整 `.test.js` 套件连续复跑 / Consecutive full-suite reruns:

```text
PASS 20/20 — twenty fresh `node verify-node.mjs` processes exited `0`.
```

道路/图块关键几何合同 / Key road and tile geometry contracts:

- road shell boundary edges: `0`
- non-manifold edges: `0`
- suppressed connected caps: `56`
- straight-fork maximum support gap: `51.429m` (`≤104.01m`)
- per active tile: `20` crossings / `16` physical spans / `16` aprons / `14` lenses / `2` vertical separations

### 3.2 非门禁性能观测 / Non-gating performance observations

Track benchmark / 道路构建 benchmark:

```text
Host: Node 20.19.0 / V8 11.3.244.8-node.26 / Darwin 25.5 arm64 / Apple M4 / 10 logical CPUs / 16 GiB
Config: 5 warmups, 20 samples, mobile profile, 4ms reference slice
totalBuildMs: min 146.424 / P50 148.429 / P95 161.363 / max 180.640
maximumSliceMs: min 2.403 / P50 2.441 / P95 2.927 / max 3.338
stepCount: min 1_164 / P50 1_164 / P95 1_167 / max 1_172
sliceOverruns: total 0 / maximum per run 0
```

Map benchmark / 地图 benchmark:

```text
Host/config: same host; 5 warmups, 20 samples, deterministic no-raster Canvas2D
sampleWallMs: min 117.683 / P50 119.797 / P95 140.640 / max 140.645
moving 640x360 draw P95: P50 0.030ms / P95 0.038ms / 0 over 3ms reference
steady 640x360: 0.031ms / 0.035ms / 0 over 3ms
steady 400x225: 0.029ms / 0.032ms / 0 over 3ms
steady 240x135: 0.029ms / 0.034ms / 0 over 2ms
steady 160x108: 0.029ms / 0.070ms / 0 over 2ms
```

这些数字只描述本机当前负载，不参与逻辑 PASS/FAIL，也不能替代 WebGL 帧性能。 / These numbers describe this host under its current load. They neither gate logic correctness nor replace WebGL frame measurements.

### 3.3 浏览器尺寸矩阵 / Browser viewport matrix

In-app Browser 的 `8/8` 个尺寸全部通过；每个生产尺寸收满 `240` 个恢复后的可见玩法帧，`FPS=60`、Long Tasks=`0`、拓扑错误=`0`、当前 recovery candidates=`2`、云层审计 `≥4.58s`。 / All `8/8` In-app Browser sizes passed after collecting 240 resumed visible-play frames per production fixture; every case held `FPS=60`, zero Long Tasks, zero topology errors, two prepared current recovery candidates, and at least 4.58 seconds of cloud audit.

| Case | Assertions | Frame P95 / max | Map P95 | Backing buffer / budget |
|---|---:|---:|---:|---:|
| `1024x768` | 115/115 | 16.8 / 18.6ms | 0.8ms | 786_432 / 5_200_000 |
| `1440x900` | 115/115 | 16.8 / 18.7ms | 0.7ms | 1_296_000 / 5_200_000 |
| `1920x1080` | 115/115 | 16.8 / 18.6ms | 0.7ms | 2_073_600 / 5_200_000 |
| `320x568` | 116/116 | 16.8 / 19.2ms | 0.7ms | 181_760 / 2_400_000 |
| `360x640` | 116/116 | 16.8 / 18.5ms | 0.8ms | 230_400 / 2_400_000 |
| `390x844` | 116/116 | 16.8 / 18.4ms | 0.7ms | 329_160 / 2_400_000 |
| `844x390` | 116/116 | 16.8 / 18.7ms | 0.7ms | 329_160 / 2_400_000 |
| `720x460-debug` | 111/111 | 16.8 / 18.6ms | 0.8ms | 331_200 / 5_200_000 |

Chrome `1920x1080` 通过 `115/115`：`FPS=60`、frame P95/max=`18.1/19.0ms`、Long Tasks=`0`、最大预热子步骤=`2.9ms`、buffer=`2_073_600/5_200_000`、项目控制台错误=`0`。Chrome `1024x768` 三轮分别为 `115/115`（P95 `17.9ms`、warm `2.6ms`）、`115/115`（`18.2ms`、`3.9ms`）和 `114/115`（`18.3ms`、`3.2ms`）；第三轮唯一失败是 sustained-frame-budget 比 `18.2ms` 阈值高 `0.1ms`，Long Tasks 仍为 `0`，因此 warm-slice gate 为 `3/3`，严格整夹具为 `2/3`。这被记录为宿主/帧边界波动，不被抹成全绿。 / Chrome Full HD passed. At 1024x768 the warm-slice gate passed 3/3, while the strict full fixture passed 2/3 because one run reached an 18.3ms frame P95 against the 18.2ms threshold; this host/frame-edge variance remains explicit.

In-app 自动化层报告的单个 `MutationObserver` 错误来自宿主注入；项目源码不创建该 observer，同一 Chrome 夹具及三次生产长跑均为 `0` 项目控制台错误。 / The one In-app `MutationObserver` error is host-injected; project source does not create that observer, while the Chrome fixture and all three production long runs reported zero project console errors.

### 3.4 300m/s 公平实跑 / Fair 300m/s live run

三次运行均从生产默认 `32m/s` 正常开始，使用 `autostart=1&auto=1`，未写入速度、生命或无敌状态。 / All runs used the production `32m/s` start with `autostart=1&auto=1` and no speed, life, or invulnerability mutation.

| Seed | Gameplay | Final speed | Distance | Lives | FPS / P95 / max | Route transitions / max commit |
|---:|---:|---:|---:|---:|---:|---:|
| 2303 | 73.427s | 300.2m/s (1_081km/h) | 11_740m | 3 | 60 / 17.1 / 22.1ms | 18 / 0.2ms |
| 2304 | 79.395s | 327.9m/s (1_181km/h) | 13_787m | 3 | 60 / 16.8 / 18.6ms | 20 / 0.2ms |
| 2305 | 79.399s | 329.0m/s (1_184km/h) | 13_852m | 3 | 60 / 16.8 / 18.7ms | 20 / 0.3ms |

全部三轮：Long Tasks=`0`、拓扑错误=`0`、fallback=`0`、preparation miss=`0`、fatal=`false`、项目控制台错误=`0`；seed `2304/2305` 的 route-continuity 与 ramp-violation 均为 `0`，300m/s obstacle/traffic pressure=`5.592_063/2.750_041`、最大动态障碍=`6`。 / Across all three: zero Long Tasks, topology errors, fallbacks, preparation misses, fatal stops, or project console errors. Seeds 2304/2305 additionally reported zero route-continuity and ramp violations, pressure `5.592_063/2.750_041`, and a six-hazard dynamic cap.

公平性检查 / Fairness checks:

- normal start speed: `32m/s`
- obstacle pressure at 300m/s: `≥5.592`
- traffic pressure at 300m/s: `≥2.750`
- dynamic hazard cap at 300m/s: `6`
- no life lock, collision bypass, speed write, teleport, extra grip, or obstacle reduction

## 4. 主要修改文件 / Principal changed files

- `Neon_Autopilot_HighSpeed_DroneHeat.js`: gameplay fairness, deterministic runs, planner/input lifecycle, diagnostics, reduced motion, fatal stop, renderer handling.
- `Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js`: swept collision, spawn-timer, branch-traffic, and portal-physics pure contracts.
- `Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf.js`: closed road-shell boundaries, resumable indexed merging, lens audits, and runtime-support planning.
- `Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-tiles.js`: bounded outer/child warm budgets, resumable variant initialization, support continuity, atomic reveal, and scoped tile diagnostics.
- `Neon_Autopilot_HighSpeed_DroneHeat.ship.js`: complete reduced-motion speed/ship cues.
- `Neon_Autopilot_HighSpeed_DroneHeat.audio.js` / `fullscreen.js`: explicit-intent loading and capability/error semantics.
- `errors/startup.js` / `vendor/three-0.160.0.min.js`: categorized recovery boundary and pinned renderer dependency.
- `Neon_Autopilot_HighSpeed_DroneHeat.html` / `.css` / `.layout-test.html`: cache contract, responsive layout, accessibility, and runtime fixtures.
- `*.test.js`, `*.benchmark.mjs`, `verify-node.mjs`: deterministic regression and isolated performance observation.
- Root, runner, module, error, vendor, and audio `README.md`; runner `WORKLOG.md`: bilingual contracts and handoff.

## 5. 发布与回归要求 / Release and regression requirements

1. 修改首方 JS/CSS 后必须同步更新生产入口与布局夹具的 cache key，并运行 `node verify-node.mjs`；音频媒体由独立 manifest/cache policy 管理。 / Any first-party JS/CSS change must update the production-entry and layout-fixture cache keys and run the unified verifier; audio media uses its separate manifest/cache policy.
2. 性能回归必须同时报告设备、浏览器、viewport、质量档、P50/P95 和 Long Tasks；不得把 Node Canvas benchmark 当作 WebGL 帧预算。 / Performance reports must include host, browser, viewport, quality, percentiles, and Long Tasks; Node Canvas timing is not a WebGL frame budget.
3. 任何领航改动必须继续从 `32m/s` 正常起步，并保持碰撞、生命、障碍压力和玩家等价输入合同。 / Autopilot changes must retain the normal 32m/s start, collisions, lives, obstacle pressure, and player-equivalent input contract.
4. 若修改道路宽度、高程、横坡、壳体或支撑布局，必须重跑 Node 几何合同和真实浏览器视觉检查。 / Road width, elevation, banking, shell, or support changes require both Node geometry contracts and real-browser visual inspection.
5. 无条件发布前补齐 P1-02 生产集成、Chrome allocation profile、原生 `200%` 缩放、屏幕阅读器及最低浏览器矩阵，并复核 Chrome `1024x768` 的 P95 边界波动。 / Before unconditional release, complete the P1-02 production integration, Chrome allocation profile, native 200% zoom, screen-reader and minimum-browser matrices, and recheck the Chrome 1024x768 P95 edge variance.
