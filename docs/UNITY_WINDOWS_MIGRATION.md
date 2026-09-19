# Windows + Codex → Unity 迁移备忘与教程

Windows setup and Unity migration handbook

> **当前状态 / Status：规划文档，尚未实施迁移。** 目标 Windows 环境、Unity 编译与 Player 均待实机验证。本文的命令是后续执行模板，不代表已经运行成功。
>
> 官方资料核对日期 / Sources checked: **2026-09-20**。执行当天重新确认工具支持范围；工程建立后以提交的精确版本为准。

[TODO 与执行记录](../TODO.md) · [Codex 项目规则](../AGENTS.md) · [浏览器版首页](../README.md)

## 导航 / Contents

1. [下次如何开始](#start)
2. [M0：Windows 环境准备](#setup)
3. [M1：建立 Unity 工程并验证环境](#project)
4. [M2–M4：按项目模块迁移](#mapping)
5. [验证、证据与常见问题](#verification)
6. [M5：提交与交付](#delivery)
7. [English walkthrough](#english)
8. [官方资料入口](#sources)

<a name="start"></a>

## 1. 下次如何开始 / Start the next session

### 把整个仓库带到 Windows

在选定的 Windows 本地工作目录中运行：

```powershell
git clone https://github.com/shi-zhe-lei/Neon_Autopilot_HighSpeed_DroneHeat.git
Set-Location .\Neon_Autopilot_HighSpeed_DroneHeat
git status --short --branch
git remote -v
```

已有有效检出时，先检查分支和未提交内容，再决定是否更新。此仓库曾清理历史中的机器路径与内网地址；清理前的旧副本应保留未提交工作后重新克隆，避免把旧历史合并回来。选择本地磁盘上的开发目录，避免把 Unity 缓存放进云盘同步目录。

在 Windows 桌面应用中把**仓库根目录**添加为项目，并使用 Codex 编码功能。优先选择 Windows native agent / PowerShell，使 Codex 和 Unity Editor 使用同一套本机路径。官方入口及名称以 [OpenAI Windows 文档](https://learn.chatgpt.com/docs/windows/windows-app) 为准。

### 提醒如何延续

根目录 [AGENTS.md](../AGENTS.md) 要求下次会话读取 [TODO.md](../TODO.md)，并在 `Reminder: pending` 时提醒当前未完成阶段。Codex 在会话启动时读取项目指令；更新文件后，应在正确项目目录启动新会话。此机制随 Git 同步，仅作用于打开本仓库的会话。[指令发现规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

可直接使用 TODO 底部的接续提示词。若未看到提醒，先让 Codex 列出已加载的指令文件，检查工作目录及 `AGENTS.override.md` 是否覆盖了项目规则。

**职责：** Codex 负责盘点、解释安装项、按授权修改工程、执行可用检查和整理证据；用户负责账号登录、许可选择、系统确认及只能亲自完成的操作。若当前 Codex 没有桌面操作工具，按菜单指引完成界面步骤，再把错误或截图交给它继续分析。

<a name="setup"></a>

## 2. M0：Windows 环境准备 / Prepare the Windows host

### 先盘点，再确定安装项

以下为 PowerShell 只读检查。完整输出保留本机；公开文档只记录必要的系统版本、工具版本及硬件概况。

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture
Get-CimInstance Win32_Processor | Select-Object Name
Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free
Get-Command git, node -ErrorAction SilentlyContinue | Select-Object Name, Source
git --version
git config --get user.name
git config --get user.email
```

核对现有 Git 身份即可，**保留用户名和邮箱**。Unity Hub 和 Editor 不一定在 PATH 中：从 Hub 的安装列表确认精确版本与 `Unity.exe` 位置。找不到命令不能直接判断软件未安装。

| 项目 | 安装/确认内容 | 通过条件 |
| :--- | :--- | :--- |
| Windows 与硬件 | 核对 OS、x64/Arm64、GPU 驱动、内存及磁盘；按目标 Editor 的系统要求判断 | 能明确选择受支持的 Editor 与构建目标 |
| Git | 原生 Windows Git 与目标仓库访问权限 | 能读取仓库，工作区状态可解释 |
| Codex | 官方 Windows 桌面入口，打开本仓库，确认 agent 使用的环境 | 能读取 AGENTS、TODO，运行工作目录中的只读命令 |
| Unity Hub | 安装 Hub、登录账号、激活适合自己的许可 | Hub 能启动选定 Editor，许可状态正常 |
| Unity Editor | 建议以受支持的 Unity 6 LTS 为迁移起点，确认完整补丁版本 | Editor 可启动，模块与所选构建后端一致 |
| C# 开发工具 | 支持该 Unity 版本的 Visual Studio，或已经验证的其他编辑器 | C# 代码补全、编译错误定位和调试可用 |
| Windows 构建链 | 明确 Windows x64 与 Mono/IL2CPP；IL2CPP 另核对 Hub 模块、MSVC 和 Windows SDK | 实际构建成功，不能只按安装列表勾选 |
| Node.js | 使用执行当天受支持、且满足仓库 `20+` 下限的 LTS | `node --version` 与浏览器版检查通过 |

截至资料核对日，Unity 官方列出 **Unity 6.3 LTS**。这是本文建议的起点；开始时确认其最新受支持补丁，写入执行记录。若后续仓库已有 Unity 工程，优先读取 `ProjectSettings/ProjectVersion.txt` 并安装匹配版本，升级另做评估。[Unity 版本支持](https://unity.com/releases/unity-6/support)

Windows on Arm 需要检查原生工具和包的支持情况。本文首个交付目标建议为 Windows x64；实际目标由机器情况确定。IL2CPP 所需 C++ 工具和 SDK 以选定 Editor 的要求为准。[Unity 系统与构建要求](https://docs.unity3d.com/6000.3/Documentation/Manual/system-requirements.html)

### 安装与配置顺序

1. 列出已有工具与缺失项，按本次用户授权执行安装。Git 和 Node 的安装方式可参考 OpenAI Windows 文档；Unity 使用 [Unity Hub 官方入口](https://unity.com/download)。
2. 在 Hub 安装选定 Editor。若选择 IL2CPP，核对 Windows Build Support (IL2CPP)；其他模块仅按实际目标添加。
3. 使用 Visual Studio 时，在 Installer 中添加 **Game development with Unity**；需要 IL2CPP 时补齐所需 C++ 工具和 Windows SDK。然后在 Unity 的 **Edit → Preferences → External Tools** 选择已安装的脚本编辑器。[Microsoft 配置说明](https://learn.microsoft.com/en-us/visualstudio/gamedev/unity/get-started/getting-started-with-visual-studio-tools-for-unity)
4. 完成 PATH 相关安装后重开终端或 Codex，再检查版本。单独安装 .NET SDK 或看到代码补全，都不能替代 Unity 实际编译验证。
5. 记录 Editor 精确版本、渲染管线、包版本、构建目标和后端。真实安装路径只用于本机命令，公开记录使用环境变量或占位符。

### 先建立浏览器版对照

从仓库根目录执行：

```powershell
node --version
node tools/verify-node.mjs
.\Start-Neon-Windows.cmd
```

分别记录 Node 检查结果与浏览器实机结果。Node 通过后，仍需观察浏览器中的起步、转向、换挡、P 领航、暂停、声音和立交场景。启动窗口关闭即停止本地服务。具体入口见 [服务说明](../server/README.md)，画面检查见 [测试说明](../tests/README.md)。

M0 只说明工具准备情况；**M1 的编译、测试与 Windows Player 都通过后，环境才算就绪。**

<a name="project"></a>

## 3. M1：建立工程并验证环境 / Establish the Unity project

### 工程位置与创建方式

开始迁移实现时，先检查当前分支。首次可创建 `codex/unity-windows-migration`；已存在时先检查再切换。浏览器版文件保留在现有位置。

在 Unity Hub 选择 **Projects → New project → Universal 3D**，创建 `unity/NeonAutopilot/`。该模板预配置 URP；本文选用它作为首个迁移方案。[Unity URP 模板说明](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/creating-a-new-project-with-urp.html)

以下是**计划结构，当前尚未创建**：

```text
unity/NeonAutopilot/
  Assets/Neon/
    Scenes/
    Scripts/Core/
    Scripts/Runtime/
    Scripts/Presentation/
    Scripts/errors/
    Art/
    Audio/
    Tests/EditMode/
    Tests/PlayMode/
  Packages/manifest.json
  Packages/packages-lock.json
  ProjectSettings/ProjectVersion.txt
  README.md
```

由 Unity 创建工程和资源，再由 Codex 在需要时增加 C#、程序集定义与测试。先读取模板实际生成的包版本；不要凭空写一个 manifest，也不要把 JS 文件改成 `.cs` 当作迁移。

### Git 与资源设置

- 提交 `Assets/`、资源配对的 `.meta`、`Packages/`、`ProjectSettings/` 和双语 README。使用文本序列化；保留资源 GUID，移动资源时一并移动 `.meta`。[Unity 资源元数据](https://docs.unity3d.com/6000.3/Documentation/Manual/AssetMetadata.html)
- 在建立工程时添加仅针对 Unity 工程的忽略规则。当前根 `.gitignore` 尚未包含这些规则，不能直接把整个生成目录加入暂存区。
- 建立工程时同步处理浏览器检查边界：[verify-node.mjs](../tools/verify-node.mjs) 当前递归扫描仓库中的 JS，仅跳过 `.git` 与 `node_modules`。Git 忽略规则不会改变这段扫描；届时应让浏览器检查排除 Unity 工程与生成缓存，并重新验证原浏览器版。
- 创建场景、Prefab 和材质优先使用 Editor 或可重复执行的 Editor 脚本；手工编辑序列化内容时必须确认 GUID 引用和导入结果。

可据实际工程位置加入以下忽略片段；**不要忽略 `.meta` 或 `ProjectSettings/`**：

```gitignore
# Generated Unity caches and local editor state; keep Assets and their .meta files.
/unity/NeonAutopilot/[Ll]ibrary/
/unity/NeonAutopilot/[Tt]emp/
/unity/NeonAutopilot/[Oo]bj/
/unity/NeonAutopilot/[Ll]ogs/
/unity/NeonAutopilot/[Uu]ser[Ss]ettings/
/unity/NeonAutopilot/[Bb]uild/
/unity/NeonAutopilot/[Bb]uilds/
/unity/NeonAutopilot/.vs/
/unity/NeonAutopilot/*.csproj
/unity/NeonAutopilot/*.sln
/unity/NeonAutopilot/*.slnx
```

正式加入规则后，用 `git status --short` 和 `git check-ignore -v <candidate>` 检查缓存是否排除、源码与 `.meta` 是否仍可跟踪。构建产物、测试 XML 和原始日志建议放到仓库外；公开证据先去除个人路径及许可信息。

### 环境验收闭环

1. 建立一个带相机、地面、灯光和可辨识物体的 `Bootstrap` 场景，保存到 `Assets/Neon/Scenes/`。
2. 添加一个有实际断言的 EditMode 测试，以及加载场景并验证对象行为的 PlayMode 测试；确认各自测试程序集可被 Test Runner 发现。
3. 等待导入和 C# 编译完成，检查 Console，进入 Play 模式确认输入与画面响应。
4. 在当前 Unity 版本的 **File → Build Profiles** 中选择 Windows、确认架构与后端、加入实际保存的场景，再构建并运行 Player。菜单名称变化时查该版本手册。
5. 检查运行程序及其 Player 日志；携带完整生成目录验证运行，包括 `.exe`、`UnityPlayer.dll` 和数据目录。[Windows 构建说明](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/windows/standalone-binaries)
6. 将版本、命令、测试数量、退出码和本机证据位置记入 TODO。只有这组证据完成，才能勾选 M1。

Mono 与 IL2CPP 分别验收；切换后端后重新构建与运行。首个空场景闭环完成后，再开始移植驾驶规则。

<a name="mapping"></a>

## 4. M2–M4：按模块迁移 / Port modules in stages

现有游戏通过 `window.Neon*` 连接 JS 模块，并使用 DOM、Canvas、Three.js 与 Web Audio。Unity 版本需要重建运行时和呈现层；已有参数、算法、测试案例与合法使用的素材可作为迁移输入。[现有源码合同](../src/README.md)

| 当前来源 / Source | Unity 迁移方向 / Target | 重点验收 / Acceptance |
| :--- | :--- | :--- |
| [config](../src/config/README.md) | 只读 C# 配置或 ScriptableObject / Read-only configuration | 六境参数、画质档位、米与秒单位；配置不持有局内可变状态 |
| [gameplay](../src/gameplay/README.md) | 不依赖场景对象的 C# 核心 / Pure C# core | 转向、动力、三挡、制动、怠速、碰撞、计时和评级边界 |
| [navigation](../src/navigation/README.md) | 路网与路径模型、程序化 Mesh / Graphs, paths and meshes | PathPlan、道路采样、立交/隧道、出口与落点一致 |
| [runtime](../src/runtime/README.md) | 唯一模拟调度器 / One simulation coordinator | 单一状态写入者、事件顺序、暂停与恢复、资源生命周期 |
| [entities](../src/entities/README.md) | 船体/障碍/烛光模型与对象池 / Entities and pools | 外观包络、碰撞和收集规则；保留成长状态来源 |
| [weather](../src/weather/README.md) + [world](../src/world/README.md) | 天气状态、地表、分块场景 / Weather and streamed scenery | 桥下遮蔽与隧道分类、状态切换、长航程资源回收 |
| [rendering](../src/rendering/README.md) | URP 材质、Shader、灯光与后处理 / URP presentation | 实景对照、阴影与隧道受光、各画质档位、性能预算 |
| [audio](../src/audio/README%281%29.md) | AudioSource、AudioMixer 与事件路由 / Audio routing | 音乐切换、RPM、隧道效果；不由音效反写物理 |
| [ui](../src/ui/README.md) + [styles](../styles/README.md) | 选定 Unity UI 方案并迁移双语资源 / Unity UI and localization | HUD、地图、菜单、焦点、缩放与不同 DPI |
| [tests](../tests/README.md) | C# EditMode / PlayMode 与共享样例 / Tests and fixtures | 复用行为案例；浏览器专属检查继续在浏览器执行 |

### M2：先做一段能驾驶的航程

1. 明确坐标适配、朝向、网格绕序和法线；以小场景证明左右、前进、转弯与坡度方向一致。建议保持 `1 Unity unit = 1m`，速度内部用 `m/s`，HUD 再换算 `km/h`。
2. 先移植纯玩法函数，建立输入和只读结果快照。C# 模拟核心负责速度、挡位与接触状态，画面、声音和 HUD 读取同一份快照。
3. 从当前 JS 核心导出固定种子、初始状态和输入序列样例，再与 C# 结果比较。记录容差及原因，避免用视觉相似代替动力验证。
4. 时间推进先对照 `consumeBoundedElapsedTime` 与现有测试。若采用 Unity 固定步长，明确累计器、子步、暂停、后台恢复及事件顺序；避免重复积分或丢失可见时间。
5. 初期使用明确的运动/碰撞所有权。若采用自定义运动，Unity 物理不能再对同一状态重复施加动力和重力；若决定改用 PhysX，必须记录行为变化并重新验收。
6. 完成直路、飞船、追尾相机与基本输入。覆盖 A/D、W/S、SPACE、Q/E、T、M、P 的实际合同，具体阈值以当前源码和测试为准。

**M2 验收：** 能手动行驶、完全制动、正确换挡与跳跃；暂停不推进模拟；速度/RPM/HUD 来自同一状态；相同输入在不同帧率下满足记录的误差范围。

### M3：再接入真实立交和领航

- 先移植 `TrackGraph → PathPlan / routeCursor → DecisionGuidance` 的状态链，再生成 Mesh 和地图。
- 路面、顶棚和落点判断对照 `sampleEdge()` 及连续碰撞合同；实景必须包含上层桥面、匝道、下穿段和隧道。
- 领航与手动控制共用推进、转向和制动接口。按当前测试检查出口选择、障碍、停车和恢复，避免新增第二套运动规则。
- 验证图块生命周期、长航程内存和渲染对象数量。记录世界坐标精度策略，必要时将累计距离与局部显示坐标分开。

**M3 验收：** 画面道路、碰撞道路、地图与导航一致；高速进洞、跳台离坡、顶棚接触和真实道路落地有测试及运行证据。

### M4：完成呈现与体验

- 将程序化几何迁移到 Unity Mesh 或重新制作资源；当前仓库的船体和场景并非一套可以直接拖入 Unity 的完整模型包。
- 逐项重建 URP 材质、天气、隧道光照、相机、音频和 UI。选定一套主要 UI 实现方式，先完成输入、文本与布局，再完善视觉效果。
- 按实际窗口和 DPI 检查 HUD，尤其是左上身份/声音/曲库区域、最小字体、按钮尺寸及不同语言。使用立交场景截图做迁移对照。
- 导入音频时携带 [作者、来源与署名记录](../assets/audio/README%281%29.md)。调整 Unity 导入设置后，在原生 Player 检查音量、循环、切曲与环境效果。

**M4 验收：** 可完成一局完整航程，六境与天气状态正确，音频和中英文 UI 可用；已接受的视觉差异写入记录。

<a name="verification"></a>

## 5. 验证与证据 / Verification and evidence

### Unity 测试命令模板

在测试程序集已建立、至少包含真实测试后使用。先关闭打开同一工程的 Editor，避免项目锁。编辑器路径从 Hub 获取；安装版本必须与工程匹配。

以下示例把结果放在本机应用数据目录，并等待 Unity 进程结束。`Start-Process` 的路径参数显式加引号以支持空格。测试参数以实际安装的 Test Framework 版本为准；示例参考 [Unity Test Framework CLI](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html)。

```powershell
$neonUnityExe = Read-Host 'Paste the Unity.exe path shown by Unity Hub'
if (-not (Test-Path -LiteralPath $neonUnityExe -PathType Leaf)) {
    throw 'Unity.exe was not found at the supplied path.'
}
$neonUnityProject = (Resolve-Path '.\unity\NeonAutopilot' -ErrorAction Stop).Path
$neonEvidenceDir = Join-Path $env:LOCALAPPDATA 'NeonAutopilot\MigrationEvidence'
New-Item -ItemType Directory -Force -Path $neonEvidenceDir -ErrorAction Stop | Out-Null

foreach ($neonMode in @('EditMode', 'PlayMode')) {
    $neonRunId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $neonResult = Join-Path $neonEvidenceDir ($neonMode + '-' + $neonRunId + '.xml')
    $neonLog = Join-Path $neonEvidenceDir ($neonMode + '-' + $neonRunId + '.log')
    # Quoted argument values survive Start-Process joining them on Windows.
    $neonArgs = @(
        '-batchmode', '-runTests',
        '-projectPath', ('"' + $neonUnityProject + '"'),
        '-testPlatform', $neonMode,
        '-testResults', ('"' + $neonResult + '"'),
        '-logFile', ('"' + $neonLog + '"')
    )
    $neonProcess = Start-Process -FilePath $neonUnityExe -ArgumentList $neonArgs -Wait -PassThru -ErrorAction Stop
    if ($neonProcess.ExitCode -ne 0) {
        throw "Unity $neonMode exited with code $($neonProcess.ExitCode). Inspect the local log."
    }
    if (-not (Test-Path -LiteralPath $neonResult)) {
        throw "Unity $neonMode produced no test result."
    }
    # A malformed result must never reuse the previous test mode's passing XML.
    $neonResults = $null
    [xml]$neonResults = Get-Content -LiteralPath $neonResult -Raw -ErrorAction Stop
    if ([int]$neonResults.'test-run'.total -le 0 -or $neonResults.'test-run'.result -ne 'Passed') {
        throw "Unity $neonMode did not report a non-empty passing test run."
    }
}
```

测试命令由 Test Runner 控制退出，模板不追加 `-quit`。命令成功、退出码为零、XML 有实际测试且结果通过需要同时成立；渲染、输入手感和音频仍须单独在 Editor/Player 验证。

### 每阶段保留什么

| 证据 | 必须说明 |
| :--- | :--- |
| 环境 | OS/架构、GPU/驱动、Editor 精确版本、关键包、构建后端 |
| 自动检查 | 执行命令、测试数量、退出码、结果 XML/日志的位置 |
| 运行检查 | Editor 与 Windows Player 分别是否启动、场景/输入/音频结果 |
| 对照 | 浏览器基线 SHA、Unity SHA、输入/种子/画质条件、差异与容差 |
| 性能 | 实际硬件、窗口分辨率、画质、帧时间与内存观察；未测则写未测 |
| 提交 | 本阶段文件、已知问题、完成的 TODO、提交与远程 SHA |

### 常见阻碍

| 现象 | 下一步 |
| :--- | :--- |
| Codex 找不到 Unity.exe | 从 Hub 确认安装位置和版本；核对 agent 是否运行在 Windows 原生环境 |
| 项目升级或包解析异常 | 比对 ProjectVersion、manifest 与包锁；先保存证据，按确认的版本修复 |
| C# IDE 能打开但 Unity 编译失败 | 以 Editor Console 和日志定位编译错误；检查程序集引用与包依赖 |
| IL2CPP 构建失败 | 检查对应构建模块、C++ 工具、SDK 与完整构建日志 |
| 测试为零、XML 缺失或项目被锁 | 检查测试程序集、Editor 进程和 Test Framework 版本；保持该项未完成 |
| 进入 Player 后黑屏、粉色材质或无输入 | 检查场景列表、URP 配置、Shader、相机及输入资源引用 |
| 机器用户名或安装路径出现在日志中 | 完整日志留在本机，提交前输出经脱敏的摘要 |

<a name="delivery"></a>

## 6. M5：提交与交付 / Commit and deliver

每个能验证的小阶段独立提交即可，例如工程骨架、玩法核心、立交导航、呈现层、验收文档。每次提交带上本阶段 TODO 更新，保留可运行的检查点。

推送前检查：

```powershell
git status --short --branch
git diff --check
git diff --stat
```

随后只暂存本阶段已检查的具体文件，再检查暂存差异。确认 `.meta` 与资源配对、包锁与 Editor 版本入库，缓存/原始日志/许可文件未入库。按当前用户授权提交和推送；本教程本身不是未来所有远程操作的授权。

```powershell
git diff --cached --check
git diff --cached --stat
git diff --cached
```

使用 [AGENTS.md](../AGENTS.md) 的简短提交格式。已存在的用户名、邮箱和 remote 保持原样。首次推送迁移分支时设置其上游；后续普通推送沿用该上游，遇到远程前进先检查差异。迁移工作正常追加提交，不需要再次重写主分支历史。

推送后比较实际分支的本地/远程 SHA，并记录工作区状态。M5 最终验收还需从干净检出重建和运行 Windows Player，确认工程不依赖本机缓存或硬编码路径。

<a name="english"></a>

## 7. English walkthrough

**This document is a plan. No Windows inventory, Unity compilation, Unity test run or native Player validation has been completed by writing it.** Track the actual work in [TODO.md](../TODO.md).

1. **Open the repository.** Clone it onto a Windows development drive and open the Git root in Codex. Prefer the native Windows agent and PowerShell for this workflow. Ask Codex to read AGENTS, TODO and this guide. The reminder applies to sessions in this repository; use the continuation prompt if it is not loaded.
2. **Inventory before installation.** Use the read-only PowerShell checks above. Identify OS/CPU architecture, GPU/driver, memory, disk, Git and installed tools. Read the current Git identity and preserve it. Keep raw output and personal paths local.
3. **Choose and record versions.** This plan proposes a supported Unity 6 LTS and URP; the checked release family is 6.3 LTS. Recheck support before a first install. Once a project exists, honor its exact Editor version and package lock. Account login and license activation remain user actions.
4. **Prepare tools.** Use Unity Hub and a compatible C# editor. Visual Studio's Unity workload provides the integration; an IL2CPP target also needs its build module, C++ tools and Windows SDK. Use a supported Node.js LTS satisfying the browser project's `20+` requirement to run its baseline checks.
5. **Create the project when requested.** Use a migration branch and Hub's Universal 3D template at `unity/NeonAutopilot/`. The structure above is proposed, not already implemented. Track Assets with their metadata, Packages, ProjectSettings and bilingual documentation. Exclude generated caches and local output. Update the browser verifier's recursive scan to exclude the Unity tree; Git ignore rules alone do not change that scan.
6. **Prove the environment.** Create a small scene and real EditMode/PlayMode tests. Verify compilation, Editor Play mode, and a native Windows Player built with the recorded architecture/backend. M0 and M1 need actual evidence before gameplay work starts.
7. **Port the driving slice.** Keep one authoritative simulation state, explicit coordinates/units, and timing rules. Compare pure C# behavior with fixtures generated from the JS baseline. Add one road, craft, camera and controls before full-world presentation.
8. **Port roads and navigation.** Preserve topology, PathPlan, sampled road surfaces, swept contact, real landing support and bounded residency. Autopilot, the map and visible roads must consume the same route state.
9. **Rebuild presentation.** Port procedural geometry and rebuild URP materials, weather, audio and bilingual UI. Test the compact HUD and interchange views. Keep resource attribution with imported assets and document accepted differences.
10. **Verify and deliver incrementally.** The shared PowerShell test template waits for Unity and requires a non-empty passing XML result. Visual and Player checks remain separate. Commit only reviewed files, update TODO, push according to the current request, and verify the remote SHA. Finish with a clean-checkout build and run.

<a name="sources"></a>

## 8. 官方资料入口 / Official reference entry points

执行时从以下入口核对当前支持范围、版本和实际菜单，不把本文的核对日期当成永久有效的环境保证。

- [OpenAI：Windows 桌面入口与原生工作流](https://learn.chatgpt.com/docs/windows/windows-app)
- [OpenAI：AGENTS.md 指令发现](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Unity：Hub 下载](https://unity.com/download)
- [Unity：Unity 6 版本支持](https://unity.com/releases/unity-6/support)
- [Unity：6.3 系统要求](https://docs.unity3d.com/6000.3/Documentation/Manual/system-requirements.html)
- [Unity：Universal 3D / URP 工程模板](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/creating-a-new-project-with-urp.html)
- [Unity：资源元数据与 .meta](https://docs.unity3d.com/6000.3/Documentation/Manual/AssetMetadata.html)
- [Unity：Test Framework 命令行参数](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html)
- [Unity：Windows 构建设置与产物](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/windows/standalone-binaries)
- [Microsoft：Visual Studio Tools for Unity](https://learn.microsoft.com/en-us/visualstudio/gamedev/unity/get-started/getting-started-with-visual-studio-tools-for-unity)
