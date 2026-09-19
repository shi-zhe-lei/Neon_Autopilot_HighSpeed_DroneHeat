# Documentation / 文档

## 中文

- `audits/` 保存按日期冻结的审计、计划和设计记录；正文中的旧根目录文件名属于历史证据，不回写为当前源码路径。
- `evidence/` 保存审计截图；`audits/` 内的证据链接应使用 `../evidence/`。
- `evidence/Neon_PC_ULTRA_BEFORE_2560X1440.png` 与 `Neon_PC_ULTRA_AFTER_2560X1440.png` 使用同一 `seed=2301&zone=2&weather=clear&quality=high` 查询和追尾相机；无遮挡飞行图另以 `Neon_PC_ULTRA_AFTER_FLIGHT_2560X1440.png` 保存。
- `reports/` 保存修复报告；报告引用原始审计时应使用 `../audits/`。
- 搬迁映射：根目录 `AUDIT_*.md`、`MUSIC_LIBRARY_AUDIT_*.md`、`SHIP_MODEL_AUDIT_*.md` → `docs/audits/`；根目录 `AUDIT_*.png` → `docs/evidence/`；根目录 `FIX_REPORT_*.md` → `docs/reports/`。

## English

- `audits/` stores date-frozen audits, plans, and design records. Legacy root filenames inside historical prose remain historical evidence rather than current source paths.
- `evidence/` stores audit captures; links from `audits/` use `../evidence/`.
- `evidence/Neon_PC_ULTRA_BEFORE_2560X1440.png` and `Neon_PC_ULTRA_AFTER_2560X1440.png` use the same `seed=2301&zone=2&weather=clear&quality=high` query and chase camera; `Neon_PC_ULTRA_AFTER_FLIGHT_2560X1440.png` provides the unobstructed flight view.
- `reports/` stores remediation reports; links back to source audits use `../audits/`.
- Move map: root `AUDIT_*.md`, `MUSIC_LIBRARY_AUDIT_*.md`, and `SHIP_MODEL_AUDIT_*.md` → `docs/audits/`; root `AUDIT_*.png` → `docs/evidence/`; root `FIX_REPORT_*.md` → `docs/reports/`.
