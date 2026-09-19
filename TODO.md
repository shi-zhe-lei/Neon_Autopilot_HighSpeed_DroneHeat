# TODO / 下一步计划

## UNITY-WIN-001 · Windows + Codex → Unity

| Field / 字段 | Value / 内容 |
| :--- | :--- |
| Status / 状态 | Planned / 已记录，迁移尚未开始 |
| Reminder | pending |
| Updated / 更新日期 | 2026-09-20 |
| Next action / 下一步 | 在目标 Windows 电脑上完成 M0 环境盘点 / Inventory the target Windows machine |
| Guide / 教程 | [Windows 环境与 Unity 迁移教程](docs/UNITY_WINDOWS_MIGRATION.md) |
| Browser baseline / 浏览器基线 | `13089d1`；开始迁移时重新记录实际基线 / Record the actual baseline again when starting |

**目标 / Goal：** 在 Windows 上由 Codex 辅助，将现有 Three.js 浏览器游戏逐阶段迁移为可构建、可运行、可验证的 Unity 项目。保留浏览器版作为行为对照，先完成 Windows 桌面版本，再决定其他发布平台。

**当前实况 / Current evidence：** 目前只完成备忘和教程。尚未在目标 Windows 电脑盘点环境，未创建 Unity 工程，未验证 Unity 编译、测试或 Windows Player。下列未完成项不能由文档检查替代。

### 已准备 / Prepared

- [x] 项目级下次会话提醒写入 [AGENTS.md](AGENTS.md) / Repository session reminder recorded.
- [x] 环境教程、迁移顺序、验收条件和接续提示词写入文档 / Setup guide, milestones, gates and continuation prompt documented.

### M0 · 目标机器与工具 / Target machine and tools

- [ ] 确认 Windows 版本、CPU 架构、GPU/驱动、内存、可用磁盘，以及实际 Git 工作目录 / Inventory OS, architecture, GPU, RAM, disk and checkout.
- [ ] 在 Windows 原生环境打开本仓库，确认 Codex 已读取根目录 AGENTS.md 和本 TODO / Open this repository in native Windows Codex and verify instruction loading.
- [ ] 核对 Git 状态、远程和现有用户名/邮箱；保留身份配置 / Check Git state and preserve the configured identity.
- [ ] 列出已安装与缺失工具；按执行当天的官方支持范围确定 Unity 精确版本、渲染管线及 Windows 构建后端 / Record installed tools and choose the exact Editor, pipeline and build backend.
- [ ] 完成已授权的软件准备、Unity 登录/许可激活及编辑器模块检查 / Complete authorized setup, licensing and module checks.
- [ ] 安装满足项目要求的受支持 Node.js LTS，执行浏览器版基线检查与 Windows 启动检查 / Verify the browser baseline with supported Node.js LTS and the Windows launcher.

### M1 · 工程与环境闭环 / Project and environment proof

- [ ] 在迁移分支创建 `unity/NeonAutopilot/`，使用 Universal 3D / URP 模板 / Create the Unity project on a migration branch.
- [ ] 提交精确 Editor 版本、包锁、Assets 及配对 .meta；配置 Unity 忽略规则与双语 README / Track versions, assets, metadata and bilingual documentation.
- [ ] 调整浏览器检查工具的扫描边界，避免把 Unity 工程和缓存纳入 Node 检查，再验证浏览器基线 / Keep Unity files outside the browser verification scope and recheck the baseline.
- [ ] 创建空场景与有意义的 C# 冒烟测试，确认脚本编译、EditMode/PlayMode 测试和编辑器运行 / Verify compilation, tests and Editor Play mode.
- [ ] 构建并实际运行 Windows x64 Player，检查 Player 日志；记录所用 Mono 或 IL2CPP 后端 / Build and run a native Windows Player and inspect its log.

**环境就绪条件 / Environment-ready gate：** M0 和 M1 均有真实证据后，才进入玩法迁移。

### M2 · 最小可玩驾驶 / Playable driving slice

- [ ] 明确坐标转换、米/秒单位、随机种子、时间推进及唯一玩法状态写入者 / Define coordinate, unit, seed, timing and state-ownership contracts.
- [ ] 移植纯 C# 动力、转向、三挡换挡、制动、怠速、跳跃、碰撞与暂停规则 / Port the pure driving and collision rules.
- [ ] 完成一条直路、一艘飞船、追尾镜头、键盘输入与基础速度 HUD / Deliver one road, one craft, input, camera and speed HUD.
- [ ] 用相同输入序列比较 JS 与 C#，覆盖不同帧率和边界状态 / Compare both implementations using matching inputs and edge cases.

### M3 · 立交、道路与领航 / Interchanges, roads and autopilot

- [ ] 移植路网、PathPlan、道路采样、桥梁/匝道/隧道及图块驻留回收 / Port topology, sampling, structures and bounded residency.
- [ ] 验证高速连续碰撞、隧道顶棚、跳台与真实道路落地 / Verify swept contact, ceilings, ramps and supported landings.
- [ ] 移植领航、地图与出口指引，保持它们读取同一份路线状态 / Port autopilot and navigation from one route authority.

### M4 · 画面、声音与界面 / Presentation, audio and UI

- [ ] 移植六境、天气、地表、船体成长、烛光和障碍 / Port realms, weather, surfaces, growth and entities.
- [ ] 重建 URP 材质/光影、音频路由和相机；记录与浏览器基线的差异 / Rebuild rendering, audio and cameras with documented differences.
- [ ] 重建中英文 HUD、菜单、暂停与结算；检查小窗口和不同 DPI / Rebuild bilingual UI and validate desktop layouts.
- [ ] 保留所用资源的来源与署名 / Retain asset provenance and attribution.

### M5 · 验收与交付 / Acceptance and delivery

- [ ] Unity 测试、Windows Player 和浏览器对照验收均通过；记录实际硬件和性能结果 / Pass tests, native execution and comparison checks with measured performance.
- [ ] 从干净检出重建，确认缺少 Library 等缓存仍可恢复工程 / Rebuild from a clean checkout without generated caches.
- [ ] 更新教程、差异清单与模块 README；检查暂存区无缓存、构建产物、机器路径或许可数据 / Update documentation and inspect staged content.
- [ ] 按当次授权分阶段 commit/push，记录最终 SHA、远程一致性及剩余问题 / Commit and push authorized milestones, then verify synchronization.
- [ ] 用户确认迁移验收后，将本任务状态和 Reminder 改为 `done` / Mark completion after acceptance.

### 执行记录 / Execution record

只补充实际运行结果；软件已安装、编辑器可打开、测试通过和 Player 可运行分别记录。公开记录使用相对路径或 `<local evidence>`，完整机器路径和原始日志留在本机。

Record actual outcomes separately. Keep private paths and raw logs local; public evidence should be sanitized.

| Date / 日期 | Stage / 阶段 | Actual versions / 实际版本 | Evidence and result / 证据与结果 | Next step / 下一步 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-09-20 | Planning / 计划 | Windows / Unity: not checked | 备忘与教程已建立；Windows 验证未执行 / Documentation only | M0 |

### 下次直接发给 Codex / Next-session prompt

```text
读取 AGENTS.md、TODO.md 和 docs/UNITY_WINDOWS_MIGRATION.md。
继续 UNITY-WIN-001，从第一个未完成阶段开始。
先确认目标 Windows 环境和 Git 状态，给我已安装/缺失工具清单与安装方案。
保留当前 Git 用户名和邮箱，实际路径和版本从这台电脑读取。
环境就绪需要有编译、测试和 Windows Player 运行证据。
按我本次授权准备环境、推进迁移和提交；每阶段更新 TODO，未验证的项目保持未完成。
```

English: Read the project instructions, TODO and guide; resume the first incomplete stage. Inventory the Windows host and Git state, preserve the existing identity, then follow the current session's authorization. Update this checklist with real compilation, test and Windows Player evidence.

提醒只在打开此仓库的 Codex 会话中生效。`pending` 表示继续提醒；用户明确关闭时设为 `off`；验收完成后设为 `done`。如果没有自动提醒，直接使用上面的提示词。

The reminder belongs to this repository. Use `pending`, `off`, or `done` as described above; the prompt is the fallback when instruction discovery does not load the file.
