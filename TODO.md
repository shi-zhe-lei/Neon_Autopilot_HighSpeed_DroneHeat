# TODO / 下一步计划

## UNITY-WIN-001 · Windows + Codex → Unity

| Field / 字段 | Value / 内容 |
| :--- | :--- |
| Status / 状态 | M0 in progress / 工具已盘点，当前 Unity 编译受 Windows 应用控制策略阻止 |
| Reminder | pending |
| Updated / 更新日期 | 2026-09-30 |
| Next action / 下一步 | 处理 Bee.DotNet.dll 的应用控制拦截后重跑编译检查，并补齐 C# 工具集成 / Resolve the application-control block on Bee.DotNet.dll, recheck compilation and prepare C# editor integration |
| Guide / 教程 | [Windows 环境与 Unity 迁移教程](docs/UNITY_WINDOWS_MIGRATION.md) |
| Browser baseline / 浏览器基线 | 候选 `9abe72f66776d20bfb8005376f210adf48b5025e`；Windows 检查尚未全通过 / Candidate baseline; Windows checks are not all passing |

**目标 / Goal：** 在 Windows 上由 Codex 辅助，将现有 Three.js 浏览器游戏逐阶段迁移为可构建、可运行、可验证的 Unity 项目。保留浏览器版作为行为对照，先完成 Windows 桌面版本，再决定其他发布平台。

**当前实况 / Current evidence：** 2026-09-30 全程使用系统命令复查，无鼠标或界面自动操作。Hub 已更新为 3.22.0，Editor 6000.6.3f1 当前安装于本地系统程序目录，Unity Personal 许可更新成功。独立教程恢复工程在 2026-09-25 的创建及脚本编译已成功（退出码 0）；但今天用当前 Editor 再次批处理打开时，Windows 代码完整性策略阻止加载 `Bee.DotNet.dll`（`0x800711C7`，事件 3033/3077），编译检查以 1 退出。Windows x64 Mono 与 WebGL 模块文件存在，IL2CPP 模块及外部 C# 工具链尚不齐备。尚无本仓库迁移工程、Unity 测试或 Windows Player 构建运行证据。浏览器基线仍为 9 月 25 日的 464 通过、3 失败，本次未重跑。 / Command-only recheck, without UI automation: Hub 3.22.0 and Editor 6000.6.3f1 are installed; Unity Personal licensing succeeds. The separate tutorial recovery project compiled successfully on September 25, but today's batch reopen failed because Code Integrity blocked Bee.DotNet.dll. Mono and WebGL module files exist; IL2CPP and external C# tooling remain incomplete. Repository migration, Unity tests, Player validation and browser baseline acceptance remain pending.

### 已准备 / Prepared

- [x] 项目级下次会话提醒写入 [AGENTS.md](AGENTS.md) / Repository session reminder recorded.
- [x] 环境教程、迁移顺序、验收条件和接续提示词写入文档 / Setup guide, milestones, gates and continuation prompt documented.

### M0 · 目标机器与工具 / Target machine and tools

- [x] 确认 Windows 版本、CPU 架构、GPU/驱动、内存、可用磁盘，以及实际 Git 工作目录 / Inventory OS, architecture, GPU, RAM, disk and checkout.
- [x] 在 Windows 原生环境打开本仓库，确认 Codex 已读取根目录 AGENTS.md 和本 TODO / Open this repository in native Windows Codex and verify instruction loading.
- [x] 核对 Git 状态、远程和现有用户名/邮箱；保留身份配置 / Check Git state and preserve the configured identity.
- [x] 列出已安装与缺失工具；按执行当天的官方支持范围确定 Unity 精确版本、渲染管线及 Windows 构建后端 / Record installed tools and choose the exact Editor, pipeline and build backend.
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
| 2026-09-25 | M0 inventory / 实机盘点 | Windows 11 x64 10.0.26200; i7-11800H; RAM 15.7 GiB; RTX 3070 Laptop driver 32.0.16.1714; Intel UHD driver 32.0.101.7088; NVMe SSD | 本地卷剩余约 174.5 / 183.9 GiB；当前检出位于 NAS UNC；原生 Windows 会话已读取项目规则 / Native Windows inventory complete; local SSD recommended for the future Unity checkout | Hub / Editor setup |
| 2026-09-25 | M0 tools / 工具与版本方案 | Git 2.55.0.windows.5; Node v24.19.0 (session runtime); VS Code 1.139.0; selected Editor 6000.3.25f1, URP, Windows x64 Mono | 初始 main 工作区干净，HEAD `9abe72f66776d20bfb8005376f210adf48b5025e`；已核对并保留 Git 身份及远程；初始盘点未发现 Hub、Editor、Visual Studio 或 .NET SDK；VS Code Unity 扩展待准备 / Identity and remote preserved; selected Editor is not yet installed | 完成 Hub、许可和 Editor；C# 工具集成待验证 / Finish setup and verify C# tooling |
| 2026-09-25 | M0 browser baseline / 浏览器基线检查 | Node v24.19.0; `node tools/verify-node.mjs` | 入口与 JS 语法检查完成，51 个测试文件的执行阶段报告无法定位 UNC 文件并以 1 退出；未执行 Windows 启动与画面验证。原始日志仅保留 `<local evidence>` / Entry and syntax checks completed; test discovery on UNC failed, exit 1; Windows launcher and visual checks pending | 在本地检出重试并验证 Windows 启动 / Retry from a local checkout and verify launch |
| 2026-09-25 | M0 mapped-drive retry / 临时盘符复查 | Node v24.19.0; same verifier; 467 tests, 464 pass, 3 fail; exit 1 | 临时 `pushd` 映射后可执行测试，结束后 `popd` 清理。LAN HTTP 的入口与音频 Range 检查返回 404；obstacles 测试的 URL `.pathname` 被当作 Windows 文件路径，导致模块找不到。未修改源码；日志留在 `<local evidence>` / Discovery succeeded; two LAN HTTP assertions and one module-resolution test failed; source unchanged | 后续处理 Windows 路径兼容性及 HTTP 失败，再验证完整基线 / Resolve Windows path and HTTP failures before baseline acceptance |
| 2026-09-25 | M0 Hub installation / Hub 安装 | Unity Hub 3.21.3, MSIX package 3.21.3.65535 | 官方分发包经校验安装，安装退出码 0；已确认包注册及 Hub 窗口。此前用户按 Esc 停止桌面操作 / Verified installer, exit 0, registered package and Hub window observed | 核对后续 Editor 与许可 / Verify Editor and licensing |
| 2026-09-25 | M0 tutorial-template recovery / 入门模板路径修复 | Editor 6000.6.3f1 (45d8eee7de74); `com.unity.template.get-started` 4.0.1 | 有效模板位于 Hub 的 MSIX 隔离缓存。首次复制虽通过校验，但也被重定向到 Codex 隔离目录，因此没有修好 Hub 创建。338,499,573-byte 模板的 650 项归档、包身份及 SHA-256 均有效；本机证据见 `<local evidence>` / The first verified copy was itself redirected into the Codex package cache and did not fix Hub creation; the template archive was valid | 改用普通本地磁盘目录验证 / Verify outside redirected AppData |
| 2026-09-25 | M0 recovery-project result / 恢复工程结果（9 月 30 日补查日志） | Editor 6000.6.3f1; URP 17.6.0; template 4.0.1 | 模板与独立教程工程置于普通本地磁盘目录后，创建、包解析及脚本编译成功；日志明确退出码 0，存在 66 个脚本程序集。此为仓库外教程工程，不计作迁移工程或 Player 验收 / A separate local-disk tutorial project was created and compiled successfully, exit 0; this is not the repository migration or Player acceptance | 继续验证当前安装 / Recheck the current installation |
| 2026-09-30 | M0 environment recheck / 环境复查 | Hub 3.22.0 (MSIX 3.22.0.65535); Editor 6000.6.3f1; embedded .NET SDK 8.0.318; Git 2.55.0.windows.5; Node v24.19.0; VS Code 1.139.0 | Windows 11 x64、15.7 GiB RAM、RTX 3070 Laptop；本地卷剩余约 157.5 / 182.0 GiB。当前无 Editor 运行后启动一次隐藏批处理检查，Personal 许可成功；编译被 `Bee.DotNet.dll` 代码完整性事件 3033/3077 阻止，退出码 1。Unity.exe 签名有效；未更改安全设置 / License update succeeded, but compilation was blocked by Code Integrity, exit 1; no security settings changed | 处理拦截后重新验证 / Resolve the block and revalidate |
| 2026-09-30 | M0 modules and tooling / 模块与开发工具 | Windows x64 Mono + WebGL files present; IL2CPP absent; standalone .NET SDK absent | 未检测到 Visual Studio Installer、Windows SDK 或默认 VS Code 的 C#/Unity 扩展。Unity 内置 SDK 存在，外部 SDK 缺失不是本次已确认的编译拦截原因。Unity 测试、图形模式与 Player 均未执行；本次未使用界面自动化 / External IDE integration remains incomplete; the embedded compiler exists. No tests, graphics-mode check or Player run was performed; no UI automation used | 补齐所选开发工具，并保持 M0/M1 未验收 / Prepare the selected tooling; M0/M1 remain unaccepted |

安装方案来源（2026-09-25 核对） / Setup references checked on 2026-09-25: [Unity 6 support](https://unity.com/releases/unity-6/support), [Editor 6000.3.25f1](https://unity.com/releases/editor/whats-new/6000.3.25f1), [Unity system requirements](https://docs.unity3d.com/6000.3/Documentation/Manual/system-requirements.html), [Node.js release schedule](https://github.com/nodejs/Release). 首次 Windows 闭环采用 Mono；若改用 IL2CPP，另补构建模块、C++ 工具与 Windows SDK 并重新验证。 / Start with Mono; IL2CPP requires its module and native toolchain plus separate build validation.

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
