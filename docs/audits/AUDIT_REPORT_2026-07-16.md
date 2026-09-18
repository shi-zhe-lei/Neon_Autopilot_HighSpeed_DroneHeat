# V23 宇宙飞船游戏彻底审计报告

- 审计日期：2026-07-16
- 审计对象：`Neon_Autopilot_V23_HighSpeed_DroneHeat`
- 最新入口：`Neon_Autopilot_V23_HighSpeed_DroneHeat.html`
- 主运行时：`Neon_Autopilot_V23_HighSpeed_DroneHeat.js`
- 审计方式：静态代码审计、Node 回归、重复稳定性测试、Chrome 硬件 WebGL 布局矩阵、故障注入、真实交互、300m/s 长跑
- 代码修改：无；本次只新增审计报告和证据截图

## 1. 最终结论

当前版本可以正常运行，并已在最新版代码上从正常 `32m/s` 起步、使用自动领航、真实生命与碰撞规则达到 `307.54m/s`（约 `1,107km/h`）。因此“可达到 300m/s”这一目标通过。

但当前版本仍不建议作为“全部质量门禁通过”的正式发布版，原因如下：

1. 高速碰撞采用帧末离散 AABB，300m/s 时存在穿透障碍和漏拾取风险。
2. 直道岔路生成的障碍会提前绑定默认路线，可能让领航选择较空支路，并让不可达障碍继续占用密度上限。
3. 生成计时器丢弃超时余量，低帧率设备的实际障碍压力低于公开诊断值。
4. 道路壳体仍有 `672` 条开放边，直道岔路桥墩最大间距 `150.171m`，超过 `104.01m` 合同。
5. 图块池诊断聚合遗漏关键字段并混用“单图块”和“驻留池”语义，导致浏览器验收无法正确判断 crossing、span、端盖和 junction lens。
6. 存储拒绝、CDN 失败和 WebGL 不可用时均会未捕获异常，开始页仍显示但按钮不可工作。
7. 六种浏览器夹具全部为 FAIL；本轮共执行 `622` 条断言，`581` 条通过、`41` 条失败。

严重度统计：

- P0：0
- P1：6 组
- P2：12 组
- P3：文档、兼容性和覆盖缺口若干

## 2. 已验证通过

### 2.1 300m/s 公平长跑

测试条件：

- Chrome 150
- Apple M4，ANGLE Metal Renderer
- `1280×720`
- `quality=high`
- `seed=2303`
- `cloverleafMove=straight`
- 正常 `32m/s` 起步
- 自动领航开启
- 不锁血、不改速度、不改障碍、不跳过碰撞

结果：

- `80.1s` 达到 `307.53992m/s`
- HUD 约 `1,107km/h`
- 距离 `13,556.69m`
- 生命 `3`
- `20` 次路线切换
- 路线提交最大 `0.1ms`
- 路线 fallback `0`
- 路线准备缺失 `0`
- 路线连续性错误 `0`
- ramp protection 违规 `0`
- Long Tasks `0`
- 控制台无应用错误

证据：[AUDIT_2026-07-16_300MS_PROOF.png](../evidence/AUDIT_2026-07-16_300MS_PROOF.png)

### 2.2 静态与 Node 回归

- 15 个 JavaScript 文件全部通过 `node --check`。
- `audio.test.js`：通过。
- `ship.test.js`：通过。
- `track.test.js`：首轮通过。
- `cloverleaf-map.test.js`：通过。
- 串行 `node --test`：4/4 通过。
- Track 合同覆盖 12 个 movement、20 个 crossing、16 个 physical span、72 次 32/150/300m/s 动力学和 50km itinerary。
- Map 覆盖 `640×360`、`400×225`、`240×135`、`160×108`，260 移动帧无静态拓扑重建。

### 2.3 浏览器中已通过的主要功能

- 启动卡和玩法详情对话框。
- 四个 ARIA tab、方向键、Home/End、正反向焦点圈、焦点恢复。
- 自动领航、手动油门、暂停/恢复、视角切换。
- 路线图、路线连续性、地图原子提交和场景同源坐标。
- 12 向立交、地上/山体/地下三类道路合同。
- 隧道净空、障碍和拾取物立交清空合同。
- 地貌世界坐标、云层漂移、暂停冻结和恢复。
- 环境飞船非碰撞和路线隔离。
- 公平压力静态参数仍为 `5.592063 / 2.750041 / 6`。
- 真实点击后音频上下文只创建一次，10/10 资源加载，错误 `0`。

## 3. P1 高优先级问题

### P1-01 高速碰撞存在帧穿透

位置：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:1365-1372`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:6987-6995`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:7030-7041`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:10128-10142`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.ship.js:1116`

现状：

- 障碍和拾取只在每帧末比较一次 AABB。
- 300m/s、60Hz 时每帧前进 `5m`。
- 最小障碍与飞船的纵向接触区约 `4m`，小于单帧位移。
- 主循环允许 `dt` 最大 `45ms`，对应 `13.5m` 位移，足以跨过所有障碍尺寸。

影响：

- 障碍可能从飞船前方直接跳到后方，未命中任何一个帧末采样点。
- 拾取物也可能漏收集。
- 结果依赖帧率和相位，低性能设备反而更容易漏碰撞。
- 这会削弱“真实碰撞、不作弊”的公平合同。

修改建议：

- 在路线空间实现 swept AABB，比较前一帧到当前帧的相对纵向区间。
- 或使用固定物理步长和子步，保证单步位移小于最小接触区。
- 补充 120/60/30/22Hz 和 `45ms` 的同 seed 碰撞一致性测试。
- 同时覆盖相邻 edge 接缝和移动障碍相对速度。

### P1-02 直道岔路可能系统性降低选中支路障碍压力

位置：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:1277-1288`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:1345-1416`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:4403-4456`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:4536-4576`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:6886-6907`

现状：

- 图路线实体生成时只绑定当前 `PathPlan`。
- 未提交直道岔路时，默认计划包含左支。
- 300m/s 下，距岔口约 `984.454m` 时生成范围为约 `948–1,236m`；代码路径推导约 `87.5%` 的新障碍会提前绑定默认左支。
- 领航评分随后可能选择较空的右支。
- 改道后，左支障碍不再参与碰撞，但仍参与全局密度和动态障碍数量统计。

影响：

- 领航可通过路线选择获得低于设计值的真实障碍压力。
- 不可达障碍继续占用 `maxDynamic` 和密度限制，抑制当前支路生成。
- 静态诊断显示压力不变，但玩家实际承受的压力下降。

修改建议：

- 岔路未提交前，为所有可达支路生成共享 `trafficGroupId` 的镜像实体。
- 提交时原子保留选中支路副本，释放其他副本。
- 密度和动态数量必须按“当前可达 traffic group”计数，而不是按全局实体计数。
- 新增左右支路压力守恒测试和 50–100 个 seed 的统计测试。

### P1-03 实际障碍压力低于公开诊断，并随帧率变化

位置：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:6892-6911`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:8981-8986`

现状：

- timer 到期后直接赋值为 cooldown，负余量被丢弃。
- 诊断使用连续公式 `scale / cooldown`。
- 300m/s 公开障碍压力为 `5.592063/s`。
- 在 `45ms` 步进下，稳态期望约为 `4.81–4.83/s`，低约 `13.6–13.9%`。
- 60Hz 下偏差较小，但 30Hz 和长帧会扩大难度漂移。

影响：

- 低性能设备得到更低障碍密度。
- 同 seed 的 RNG 消耗顺序随帧率变化。
- 公开公平诊断并不代表实际生成频率。

修改建议：

- 到期后使用 `timer += cooldown` 保留超时余量。
- 必要时用有上限的 `while (timer <= 0)` 补齐事件。
- 最好将生成与物理统一到固定时间步。
- 断言 16.67/33.33/45ms 下单位模拟时间生成数一致。

### P1-04 道路壳体未闭合，直道岔路存在超合同桥墩间距

位置：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.layout-test.html:1567-1607`

浏览器实测：

- `cloverleaf-road-shell-batch`
  - 顶点：`51,632`
  - 三角形：`102,472`
  - boundary edges：`672`
  - non-manifold：`0`
  - `isClosed=false`
- 桥墩基础、数量和接地均正常。
- 最大连续间距：`150.171m`
- 基准 spacing：`52m`
- 验收上限：`104.01m`
- 复现 edge：
  - `straight-fork-left-west`
  - warm tile 中也出现 `straight-fork-left-east`

影响：

- 道路批次违反闭合拓扑合同，存在漏面、裂缝或背面可见风险。
- 直道岔路局部可能呈现长距离悬空。

修改建议：

- 区分“连接端不加内部端盖”和“组合道路批次必须闭合”两个合同。
- 对共享接缝焊接或生成连续过渡壳体。
- 在 straight-fork-left/right 的 runtime support layout 中补足桥墩。
- 将最大间距 edge、站点和覆盖来源完整发布到诊断。

### P1-05 图块池诊断聚合失真，浏览器质量门禁无法可信工作

位置：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js:1165-1237`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js:1475-1535`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:9515-9535`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.layout-test.html:1611-1659`

现状：

- `getDiagnostics()` 遍历所有 resident records。
- 未初始化或累计以下字段：
  - `crossingCount`
  - `physicalSpanCount`
  - `suppressedConnectedCapCount`
  - `junctionLongPairCount`
  - `junctionLensCount`
  - lens 覆盖、垂直分离等字段
- 主程序使用 `?? 0` 发布后，这些值永远显示为 `0`。
- apron 等字段却按所有驻留图块求和，浏览器夹具仍硬编码单图块的 `16/14/14`。
- 实测 apron candidates 从 `36` 增长到 pool=3 时的 `54`。

影响：

- crossing/span/cap/lens 浏览器失败主要是诊断聚合错误，不能直接证明视觉实现缺失。
- 同时也不能利用浏览器夹具证明这些结构正确。
- release gate 长期保持红色，真实回归可能被噪声掩盖。

修改建议：

- 明确定义三类指标：
  - per-active-tile
  - resident-pool aggregate
  - per-tile invariant/min/max
- 关键结构合同建议按每个 active tile 独立发布数组。
- 修复字段累计后再调整 layout 断言，禁止用全池总和比较单图块常量。

### P1-06 核心依赖和启动故障没有用户可见错误边界

位置：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.html:243`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:457`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:1898-1904`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js:6357-6363`

故障注入结果：

1. `localStorage.getItem` 抛 `SecurityError`
   - 无 canvas
   - 无 diagnostics
   - 未捕获 page error
   - 开始按钮仍显示，但没有事件监听
2. 屏蔽 `cdn.jsdelivr.net`
   - `THREE` 未定义
   - `Three.js load failed`
   - 无 canvas
3. 禁用 WebGL
   - `Error creating WebGL context`
   - 无 canvas
   - 未显示兼容性说明或重试按钮

补充风险：

- Three.js 使用外部 CDN，未配置 SRI、CSP 或本地 fallback。
- `localStorage.setItem` 在游戏结束 UI 显示之前执行，写入异常可能阻止重开界面出现。

修改建议：

- 将锁定版本的 Three.js 随游戏本地分发。
- 若保留 CDN，增加 SRI、`crossorigin`、CSP 和本地 fallback。
- 抽取安全存储包装，校验最高分为有限非负数。
- 将 renderer 创建、首次 compile 和模块合同检查放入统一启动错误边界。
- 显示可聚焦的错误说明、兼容性提示和“重试”按钮。

## 4. P2 中优先级问题

### P2-01 seed 不能稳定重放同一局

- gameplay RNG 只在页面加载时创建一次。
- 非 autostart 预览会先消耗 RNG。
- 按 R 重开继续使用旧 RNG 流。
- 同 seed 的手动开始、autostart 和重开不是同一关卡。

建议：每局按 `runSeed` 重建 gameplay RNG；预览使用独立 RNG；诊断发布 seed 和 run index。

### P2-02 生产页面无条件导出可写权威状态

- `window.NeonV23Diagnostics.state` 直接指向 live state。
- 控制台可修改 speed、lives、invincibleTimer。
- 这削弱“no-cheat 证明”的可信度。

建议：只在 `modelDebug=1` 导出冻结快照；测试钩子必须窄化，禁止写物理权威字段。

### P2-03 动态障碍预测和真实运动模型不一致

- 预测包含 `lateralDrift * timeAhead`。
- 实际更新总是调用 `predictedObstacleLateral(obj, 0)`。
- drift 实际永远不发生，最大预测偏差约 `0.288m`。

建议：真实积分 drift，或从预测模型删除 drift，并增加逐步模拟一致性测试。

### P2-04 门户提交帧忽略当前 A/D 加速度

- 路线提交发生在本帧玩家横向物理更新之前。
- 只用旧 lateral 和 velocity 线性外推。
- 300m/s、45ms 时最大遗漏横移约 `0.2205m`。
- 左右岔路以 lateral=0 为边界，可能误选。

建议：固定子步内推进到门户时刻再提交，或使用本帧最终输入和加速度做扫掠。

### P2-05 高速领航热路径分配量过大

- 300m/s 桌面基础约 111 个候选、79 步。
- 单次 plan 至少创建 333 个数组并写入 26,529 个数值。
- 危险时会追加 survival 第二轮。
- 同一帧 emergency、plan、guardian 会重复感知障碍。
- `updateZone()` 每帧还创建多份 `THREE.Color` 并重复写固定 CSS 变量。

建议：复用 TypedArray/scratch、缓存同帧 perception、降低 planner 频率并插值、颜色和 HUD 使用 dirty update。

### P2-06 严格帧预算未通过，性能断言本身也不稳定

Chrome Metal 本轮：

- FPS 约 `69.9–71.5`
- frame P95 约 `19.4–26.3ms`
- map P95 约 `0.9–1.2ms`
- Long Tasks `0`

所有尺寸均因 `frameP95Ms > 18.2` 失败。该结果来自 Chrome headless Metal，不能替代实体显示器手工观测，但足以说明当前自动化门禁未通过。

`track.test.js` 的 4ms 实时时钟断言也存在抖动：

- 隔离重复 5 次：4 通过、1 失败。
- 浏览器负载下重复 5 次：1 通过、4 失败。
- 观测最大约 `28.397ms`。

建议：

- 把逻辑分片正确性与机器性能 benchmark 分开。
- 逻辑测试使用可控时钟或工作量上限。
- benchmark 预热、多次取分位数，并标记测试机器基线。

### P2-07 响应式布局仍有三个明确问题

1. `844×390`
   - `.hud-wing.hud-navigation` bottom=`397.75px`
   - 视口高 `390px`
   - 页面 scrollHeight=`398px`
2. `320×568` 和 `360×640`
   - 页面本身无滚动溢出
   - key tracker 与触控 controls 垂直重叠约 `22px`
   - 320px 截图中实时输入条遮住中间跳跃按钮
3. `720×460-debug`
   - debug map 放大后按 map 逻辑归为 external desktop compass
   - CSS 仅在 `min-width:921px` 且 `min-height:561px` 显示 desktop compass
   - 结果是地图不画罗盘，DOM 罗盘也隐藏

证据：[AUDIT_2026-07-16_320X568_OVERLAP.png](../evidence/AUDIT_2026-07-16_320X568_OVERLAP.png)

### P2-08 移动按钮的辅助技术激活不完整

- 左、跳、右按钮没有 `aria-label`。
- 按住类按钮只监听 pointerdown/up。
- `leftBtn.click()` 和 `jumpBtn.click()` 不会触发驾驶动作。
- VoiceOver 双击或键盘 Enter 的原生 click 语义无法完成操作。

建议：补充名称；跳跃支持 click；按住类按钮增加键盘/辅助技术 fallback 和 pointer capture。

### P2-09 页面级 touch-action 和焦点样式不利于可访问性

- `html/body` 全局 `touch-action:none` 和 `user-select:none`，玩法手册无法双指缩放或选择文字。
- `guide-panel` 可聚焦但 `outline:0`，无替代 `:focus-visible`。
- 暂停和结束状态没有可靠的 live region 和焦点交接。
- 10px 辅助文字存在低对比度风险。

建议：只在画布和驾驶按钮禁用手势；为内容区允许 `pinch-zoom`；恢复可见焦点；结束时聚焦重开按钮。

### P2-10 一次性快捷键未过滤 key repeat

- P、C、O、Escape、R 会响应重复 keydown。
- 实测一个 `repeat=true` 的 KeyP 事件即可开启领航。

建议：所有 toggle/reset 命令统一忽略 `event.repeat`。

### P2-11 生命周期没有统一释放输入

- blur 会清按键，但 visibilitychange 只取消自由视角。
- 页面隐藏时未自动暂停，也未统一释放 pointer/触控输入。

建议：抽取 `releaseAllInputs()`，在 blur、hidden、pagehide、pause、game over、pointercancel 中复用，并在 hidden 时自动暂停。

### P2-12 全屏能力检测和音频加载时机不准确

全屏：

- 实测 `document.fullscreenEnabled=false` 且方法存在时，模块仍报告 `supported=true`，按钮保持可用。
- Permissions Policy 拒绝后只写 dataset 和 console，没有用户可见提示。

音频：

- 仅打开玩法详情、游戏仍未开始时，真实点击已经创建 AudioContext 并加载 10/10 音频资源。
- 背景音乐约 5MB，并被完整获取和解码。

建议：

- 标准能力布尔值存在时优先信任它。
- 监听 fullscreen error 并向用户提示。
- 音频只在开始游戏、主动开声或实际驾驶输入时加载；背景音乐考虑流式媒体接入 Web Audio 总线。

## 5. P3 和文档覆盖问题

- README 加载顺序遗漏 `fullscreen`，实际为 `audio → fullscreen → main`。
- README 缺少全屏失败语义和回归说明。
- `assets/audio/README.md` 声称总是解码 10 个文件，但 `file://` 模式会跳过音乐 Web Audio 解码并使用媒体元素。
- WORKLOG 最新条目日期为 2026-07-15，但多个核心文件在 2026-07-16 有新修改，交接日志未覆盖最新版变更。
- 项目没有 `package.json` 或统一测试命令。
- Node 覆盖率报告未加载 main、world、modeling、fullscreen，整体 `75.03%` 容易产生误导。
- `main.js`、`world.js`、`modeling.js`、`fullscreen.js` 缺少直接 Node 回归。
- 布局夹具大量依赖固定等待时间，如 `5.2s/360ms/1,100ms`，应改为 readiness 条件。
- `prefers-reduced-motion` 只覆盖地图 CSS 过渡，未覆盖主场景、光流、漂浮和相机动画。
- 游戏目录和 assets 中仍有 `.DS_Store`。
- Three.js r160 旧式 `build/three.min.js` 已产生弃用警告。
- 未定义最低浏览器能力基线。

## 6. 已排除或未发现的问题

- 未发现领航直接写速度。
- 未发现锁血。
- 未发现碰撞 bypass 开关。
- 未发现领航额外抓地力。
- 暂停会停止距离、生成和主要物理更新。
- 重置会清理路线准备、实体、按键和主要瞬态状态。
- 尾迹、事件日志和图块池均有上限，未发现明显无界数组增长。
- 音频错误不会回写速度、路线、碰撞或生命。
- 地图静态缓存、路线断口、箭头误差和地图绘制预算均表现良好。

## 7. 发布建议

当前建议状态：`有条件不通过 / Conditional Fail`

发布前至少完成：

1. swept collision 或固定物理子步。
2. 岔路障碍压力守恒和 timer 余量修复。
3. road shell 开放边和 `150.171m` 桥墩间距修复。
4. 图块池诊断聚合语义修复，使六尺寸夹具能可信判定。
5. localStorage/CDN/WebGL 统一错误边界。
6. 844×390、320/360 小屏和 debug compass 修复。
7. 增加主循环、碰撞、生成、seed 和失败路径自动化测试。

完成以上项目后，应重新执行：

- 15 个 JS 语法检查
- 4 个现有 Node 回归
- 新增 gameplay-core 回归
- 6 个现有浏览器尺寸
- 320×568、360×640、200% 缩放
- 至少 3 个 seed 的 300m/s 长跑
- 断网、存储拒绝、WebGL/context loss、全屏拒绝和真实音频测试

## English summary

The latest V23 build can fairly accelerate from the normal 32m/s start to more than 300m/s, but it is not release-ready under its own quality contracts. The main blockers are frame-discrete high-speed collision tunneling, route-dependent obstacle-pressure loss, frame-rate-dependent spawn pressure, an open road-shell batch, an excessive straight-fork support gap, broken tile-pool diagnostics, and missing startup error boundaries. No gameplay code was changed during this audit.
