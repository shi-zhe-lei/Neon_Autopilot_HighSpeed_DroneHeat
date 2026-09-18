# V23 宇宙飞船整改计划

- 日期：2026-07-16
- 原则：先修公平和质量门禁，再做性能、可访问性和文档清理
- 本文件只提出方案；本次审计未修改游戏代码

## 阶段 A：发布阻断项

### A1. 固定时间步和 swept collision

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js`
- 新增建议：`Neon_Autopilot_V23_HighSpeed_DroneHeat.gameplay-core.test.js`

修改：

1. 将渲染 dt 与物理 dt 分离。
2. 使用固定物理步或路线空间 swept AABB。
3. 障碍、拾取、顶棚和门户提交消费相同的时间区间。
4. 支持 edge 接缝前后两个路线区间。

验收：

- 120/60/30/22Hz 下同 seed 的伤害和拾取一致。
- 300m/s、45ms 单帧不能穿过最小障碍。
- moving obstacle 使用相对速度扫掠。
- 不增加锁血或碰撞宽容开关。

### A2. 修复岔路障碍压力守恒

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js`

修改：

1. 岔路未提交前，traffic group 覆盖全部可达支路。
2. 提交时原子保留选中支路副本。
3. 全局密度改为当前可达 traffic group 计数。
4. 路线评分不得因默认 PathPlan 提前绑定获得空路奖励。

验收：

- 左右支路生成压力误差小于 3%。
- 50–100 个 seed 中领航左右选择不产生系统性空路。
- wrong-route 实体不占用当前支路 dynamic cap。

### A3. 保留生成 timer 余量

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js`

修改：

- `timer = cooldown` 改为保留 overshoot 的累加方式。
- 必要时有上限地补齐多次生成。
- 生成 RNG 绑定固定模拟时间，而不是渲染帧数。

验收：

- 16.67/33.33/45ms 下 120 秒生成总数误差小于 1%。
- 实际压力与发布诊断一致。

### A4. 修复 road shell 和 bridge support

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.track.test.js`

修改：

1. 消除 `cloverleaf-road-shell-batch` 的 672 条开放边。
2. 保留“连接端无内部横截面端盖”合同，但组合壳体必须闭合。
3. 为 straight-fork-left/right 补足 runtime support。
4. 最大连续桥墩间距恢复到 `≤104.01m`。

验收：

- road shell boundary edges=0。
- non-manifold=0。
- straight fork 四个方向最大支撑间距均通过。
- 视觉人工检查无漏面、裂缝和悬空长段。

### A5. 重建图块池诊断语义

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.layout-test.html`

修改：

1. 补齐 crossing/span/cap/lens 全部字段。
2. 分开发布 active、resident、per-tile invariant。
3. 每个 active tile 发布独立结构记录。
4. layout test 不再用 resident 总和比较单图块常量。

验收：

- 20 crossings / 16 spans 正确发布。
- 每个标准图块 16 apron / 14 lens / 2 vertical。
- suppressed connected caps 正确发布。
- pool 从 2 增长到 3 不改变 per-tile 断言。

### A6. 增加统一启动错误边界

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.html`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.fullscreen.js`
- README

修改：

1. Three.js 本地分发。
2. 安全 localStorage 读写。
3. renderer/compile/module contract 统一 try/catch。
4. 显示可聚焦的错误页和重试按钮。
5. 全屏、音频和非核心功能失败不得阻止游戏启动。

验收：

- 断网、CDN 屏蔽、存储拒绝、WebGL 禁用均显示明确说明。
- 不出现“按钮可见但无事件监听”的假启动页。
- localStorage 写失败后仍出现游戏结束和重开界面。

## 阶段 B：响应式、输入和可访问性

### B1. 修复 844×390 和 320/360 控制区

涉及文件：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.css`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.layout-test.html`

修改：

- 844×390 导航翼减少至少 8px。
- 320/360 竖屏将 key tracker 移出 controls。
- 为 320×568、360×640 增加生产夹具。

验收：

- 页面 scrollWidth/scrollHeight 等于视口。
- key tracker 与五个触控按钮零重叠。
- 最小触控目标仍不低于 44px。

### B2. 修复 debug compass ownership

修改：

- compass ownership 基于实际 viewport 能力，而不是放大后的 map width。
- debug 模式必须明确选择 DOM compass 或 map compass。

验收：

- 720×460-debug 始终恰好一个可见罗盘。

### B3. 完善移动按钮语义

修改：

- 为 left/jump/right 添加 aria-label。
- jump 支持 click。
- 按住类控制支持键盘和辅助技术 fallback。
- 使用 pointer capture，统一释放。

验收：

- VoiceOver/TalkBack 双击可操作。
- Enter/Space 不产生粘滞输入。

### B4. 统一输入生命周期

修改：

- 新增 `releaseAllInputs(reason)`。
- blur、visibility hidden、pagehide、pause、game over、pointercancel 统一调用。
- 页面隐藏自动暂停。
- P/C/O/Escape/R 忽略 repeat。

验收：

- 切换标签、锁屏、来电、失焦后无残留油门/刹车/转向。
- 长按快捷键只触发一次。

### B5. 可访问性和减少动态效果

修改：

- 手册允许 pinch-zoom 和文本选择。
- guide-panel 增加 focus-visible。
- 暂停和结束使用 live region 与焦点交接。
- 提高 10px 辅助文字对比度。
- reduced-motion 关闭漂浮、震动、光流和非必要回正。

验收：

- 200% 缩放无内容丢失。
- 键盘焦点始终可见。
- 屏幕阅读器能宣布暂停和结束。

## 阶段 C：性能、资源和测试体系

### C1. 降低领航热路径分配

修改：

- perception 每帧只计算一次。
- rollout 使用预分配 TypedArray。
- planner 降频运行，渲染帧插值控制。
- Color 和 HUD CSS 使用缓存与 dirty write。

验收：

- Chrome Performance 中 planner 每帧临时分配显著下降。
- 生产尺寸 frame P95 达到项目门槛。
- 不降低障碍、视距和路线正确性。

### C2. 分离逻辑测试和性能 benchmark

修改：

- 4ms 分片逻辑测试使用可控时钟或工作量预算。
- 单独建立机器 benchmark。
- benchmark 预热并重复取 P50/P95。

验收：

- 普通 Node 回归重复 20 次无随机失败。
- benchmark 报告环境和分位数，不阻断逻辑正确性测试。

### C3. 新增主循环自动化

建议测试文件：

- `gameplay-core.test.js`
- `gameplay-browser.test.js`
- `startup-failure.test.js`
- `accessibility-smoke.test.js`

最低覆盖：

- swept collision
- 生成 timer
- 支路压力
- damage/lives/game over/restart
- seed replay
- pause/visibility/input release
- 300m/s 多 seed 长跑
- localStorage 拒绝
- CDN/Three 失败
- WebGL/context lost
- fullscreen success/denial
- 真实可信音频
- 320/360/390/844/1024/1440/1920

### C4. 音频加载优化

修改：

- 打开玩法详情不加载完整音频。
- 开始游戏、主动开声或首次驾驶输入再加载。
- 背景音乐使用流式 media element 接入总线。

验收：

- guide-only 状态 assetsLoaded=0。
- 开始后音频仍 10/10，无重复 AudioContext。

### C5. 文档和部署清理

修改：

- README 加载顺序加入 fullscreen。
- 更新 fullscreen、错误边界、浏览器基线和测试命令。
- 修正 file:// 音乐解码说明。
- 补写 2026-07-16 WORKLOG。
- 删除 `.DS_Store`，加入忽略规则。
- 迁移 Three.js ES Module 或本地锁定构建。

## 推荐执行顺序

1. A1 高速碰撞
2. A2/A3 障碍压力
3. A4 道路壳体和支撑
4. A5 诊断聚合
5. A6 启动错误边界
6. B1/B2 响应式
7. B3/B4/B5 输入和可访问性
8. C1 性能
9. C2/C3 测试体系
10. C4/C5 资源和文档

## 完成定义

只有同时满足以下条件才建议标记正式通过：

- 所有 P1 已修复。
- 六个现有浏览器 case 全部 PASS。
- 320×568 和 360×640 全部 PASS。
- Node 回归连续 20 次无随机失败。
- 至少 3 个 seed 在正常规则下达到 300m/s。
- 30/60/120Hz 碰撞和生成结果一致。
- 断网、存储拒绝和 WebGL 失败有用户可见恢复路径。
- VoiceOver/TalkBack 和键盘操作通过。
