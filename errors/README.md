# Runtime error boundaries / 运行时错误边界

## 中文

本目录负责启动、依赖、图形环境、持久化访问与小地图呈现错误分类。`startup.js` 必须先于 Three.js 和主运行时加载；它提供可聚焦的恢复界面，以及不会阻断本局游戏的安全存储读写。`readString()` 为界面语言等字符串偏好提供同一安全边界：存储被拒绝时返回调用方默认值，仅放弃跨页面恢复。

`startup.js` 也解析入口内嵌的有界更新租约。有效租约以高于唯一初始加载层的优先级显示非致命更新对话框并隔离后台；只有模块、世界、首段 current/next 道路、所选画质着色器编译/链接诊断、首帧和动画循环均通过后才启用“仍要游玩”。加载层只报告这些真实阶段，不显示伪百分比或估算剩余时间。缺失、无效、过期或超过 `6h` 的租约按稳定版处理，避免静态页面被永久锁住。

更新与恢复文案在双语模块尚未加载时先使用完整中文回退，同时把稳定 `data-i18n` 键与参数写入现有节点；双语模块随后可按 URL、持久化选择或玩家切换原位重绘。版本详情只展示本地化的“版本标记/调试模式”，内部 `release-marker` 等状态值不得泄露到中文界面。

初始化阶段的未捕获错误直接进入恢复界面。主运行时完成权威状态创建后，通过 `registerFatalHandler()` 接管同一边界：处理器必须先停止 RAF、输入和音频更新，再显示一次恢复页；处理器返回 `false` 或自身抛错时，启动模块回退到直接展示，不能吞掉致命错误。对向落地的就绪握手把“落地区暂不可见”作为本次采用的普通拒绝，并用 `stableEdgeId / stableUntilEdgeS` 阻止玩家越过尚未原子发布的道路、双腿门架支撑和诊断；这类可等待状态不是启动错误。相反，`prepareOpposingRecoveryPathPlan()` 抛出的拓扑错误、空计划不变量和路线解析器不变量必须保留原始错误向上传播，既不能缓存为空路，也不能包装成暂未就绪。主循环最外层以 `runtime-frame-failure` 标记真正逸出的帧异常，而不是误报 `startup-failure`；`startup.js` 保留浏览器实际提供的 `filename / line / column / stack`，并过滤无意义的 `0 / 0`。捕获阶段会把 `<script>` 资源失败分类为 `script-resource-load-failed` 并记录其 URL；Windows Edge 的直接 `file://` 外部脚本若被来源隔离净化，则明确分类为 `file-script-opaque-error` 并提示改用回环 HTTP 启动器，不再把包装器行号冒充根因。

`minimap.js` 定义 `NeonMinimapRecoverableError`，并用 `code`、`phase` 与 `recoverable=true` 区分仅影响一帧的缓冲分配、绘制和最终复制故障。路线、场景坐标或版本合同产生的 `TypeError` 不得包装成可恢复错误。运行时保留上一张完整地图并在下一 RAF 重试；一次成功会清零连续失败计数，连续第三次失败必须交给既有致命边界，不能静默吞错或无限循环。

致命恢复始终高于更新提示和启动加载层：它会原子关闭两者、结束加载层的忙碌状态、禁用并移除继续处理器，使尚未发布的开始页保持 `hidden + inert`，把其余兄弟设为 inert，并把焦点圈闭在重新加载。普通入口继续更新版后才原子发布已经启用的开始按钮与开始页且不解锁音频；显式 `autostart=1` 会在确认后直接提交启动，不短暂显示开始页，并让加载层保留到首个玩法帧成功。测试用 `modelDebug=1&updateNotice=1` 仅用于覆盖该分支。

## English

This directory owns startup, dependency, rendering, persistence, and minimap-presentation error categories. `startup.js` must load before Three.js and the main runtime; it provides a focusable recovery surface and safe storage access that cannot block the current run. `readString()` gives string preferences such as the UI language the same boundary: denied storage returns the caller's fallback and only forfeits cross-page restoration.

`startup.js` also parses the bounded inline update lease. A valid lease opens the nonfatal update dialog above the sole initial loading surface and isolates the background. Continue Playing becomes available only after modules, world setup, both opening current/next roads, selected-quality shader compile/link diagnostics, the first frame, and the animation loop succeed. The loader reports only those real stages and exposes no fabricated percentage or estimated remaining time. Missing, invalid, expired, or longer-than-`6h` leases are treated as stable so a static page cannot remain locked forever.

Update and recovery copy starts with complete Chinese fallbacks before the i18n module loads while attaching stable `data-i18n` keys and parameters to the existing nodes. The i18n module can then redraw those nodes in place from a URL override, persisted choice, or player toggle. Release details expose localized “Release marker/Debug mode” labels; internal values such as `release-marker` must not leak into the Chinese UI.

Uncaught initialization failures go directly to recovery. Once authoritative runtime state exists, main registers the same boundary through `registerFatalHandler()`: the handler must stop RAF, input, and audio updates before showing one recovery surface. Returning `false` or throwing from that handler falls back to direct startup recovery; fatal errors must not be swallowed. The opposing-landing readiness handshake treats a temporarily invisible landing surface as an ordinary rejection of that adoption and uses `stableEdgeId / stableUntilEdgeS` to stop the player before road geometry, both portal-bent support legs, and diagnostics publish atomically; this waitable state is not a startup error. In contrast, a topology error thrown by `prepareOpposingRecoveryPathPlan()`, its null-plan invariant, or a route-resolver invariant must preserve and propagate the original error rather than cache an empty road or wrap it as not-ready. The outermost main-loop boundary labels a truly escaping frame exception `runtime-frame-failure` instead of misreporting `startup-failure`. `startup.js` retains browser-supplied `filename / line / column / stack` and filters meaningless `0 / 0`. Capture-phase `<script>` resource failures become `script-resource-load-failed` with their URL. A direct Windows Edge `file://` fault sanitized by origin isolation becomes `file-script-opaque-error` with loopback-launcher guidance, rather than misattributing the wrapper line as root cause.

`minimap.js` defines `NeonMinimapRecoverableError`; its `code`, `phase`, and `recoverable=true` fields identify buffer-allocation, frame-paint, and final-copy faults that affect only one map frame. Route, scene-coordinate, and version-contract `TypeError`s must not be wrapped as recoverable. Runtime retains the last complete map and retries on the next RAF, clears the consecutive count after one success, and hands the third consecutive failure to the existing fatal boundary instead of swallowing or looping forever.

Fatal recovery always outranks both the update notice and startup loader: it atomically closes both, clears the loader's busy state, disables Continue, unregisters its continuation, keeps the unpublished launch surface `hidden + inert`, makes every sibling inert, and traps focus on Reload. A normal update continuation atomically publishes an already-enabled Start surface without unlocking audio. Explicit `autostart=1` commits launch directly after confirmation without flashing Start and retains the loader until the first gameplay frame succeeds. `modelDebug=1&updateNotice=1` exists only to exercise this branch in fixtures.
