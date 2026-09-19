# Project guidance / 项目协作规则

## Next-session reminder / 下次会话提醒

- At the start of each new Codex session in this repository, read [TODO.md](TODO.md). If `UNITY-WIN-001` has `Reminder: pending`, briefly remind the user once that the Windows Unity migration is awaiting its next unchecked step. Read the [migration guide](docs/UNITY_WINDOWS_MIGRATION.md) before working on it.
- 每次在本仓库开始新的 Codex 会话时，先读取 TODO。迁移提醒为 `pending` 时，简短提醒一次当前未完成阶段；本次会话内不要重复催促，也不要打断用户正在要求的其他工作。
- On Windows, start an authorized environment-preparation task with the guide's read-only inventory, then explain the missing tools and next steps. On other systems, keep Windows verification pending. A reminder is not authorization to install software, create a Unity project, or start the port.
- 在 Windows 上接到环境准备任务后，先只读盘点，再按用户授权协助安装和验证。账号登录、许可激活及需要本人操作的界面由用户完成；当前会话已有的明确授权无需重复索取。
- Record actual progress and evidence in TODO. Mark a gate complete only after its checks have run on the required platform. Change the reminder to `done` when the migration is accepted, or to `off` if the user explicitly disables it.
- 每个阶段结束后更新 TODO 的完成项、实际版本、验证结果和下一步。用户本次要求优先；不能把文档中的示例结果当成执行证据。

## Scope and continuity / 范围与延续

- The current product is the browser game. The planned Unity project lives under `unity/NeonAutopilot/`; that directory is not evidence that a working port exists.
- 当前浏览器版继续作为行为和画面对照；只有用户要求迁移实现时才创建 Unity 项目。先保留玩法合同，再逐阶段迁移呈现。
- Preserve the existing Git user name and email. Do not change identity, remotes, repository visibility, or rewrite history unless explicitly requested.
- 保留现有 Git 用户名、邮箱和远程设置；公开文档使用相对路径、环境变量或通用示例，不记录个人机器路径、真实内网地址、密钥或许可文件。
- Make code changes only when requested. Remote mutations require explicit user authorization; describe their targets and scope before execution. Read-only inspection is permitted.
- 代码修改遵循当前用户指令；远程写操作先说明具体目标与范围，并确认已有明确授权。只读检查可直接进行。

## Implementation and verification / 实现与验证

- Verify tools on the actual host. Server-side Node checks, Windows Editor execution, Unity tests, visual inspection, and native Player builds are separate evidence.
- 按实际环境确认工具；Node 测试不能证明 Unity 编译、Windows 运行或画面已通过。项目根目录与新增模块均维护中英文 README。
- Keep comments focused on intent, contracts, edge cases and ownership. Document public and complex functions; allow unexpected errors to propagate and group custom errors under an `errors/` directory. Use digit separators where supported.
- 注释说明关键设计和跨模块合同；公开函数及复杂私有函数提供简短说明，避免吞掉异常。若新增 SQL 建表语句，补充数据库、表和字段注释。
- Stage only the intended files. Before a requested push, review the diff, run checks relevant to the changed scope, and verify the remote SHA and working-tree status afterward.
- 仅文档改动检查链接、命令、状态和差异；运行资源变更还需遵循 [服务文档](server/README.md) 的 Windows 清单要求。

## Commit messages / 提交信息

Use a compact title of at most three lines and 200 characters, then a `Changes` section with one short phrase per file. Do not add explanations.

提交信息使用简短标题与逐文件变更摘要：

```text
Title

Changes
- file: short change phrase
```
