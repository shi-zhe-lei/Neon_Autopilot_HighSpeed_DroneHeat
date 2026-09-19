# README artwork / 首页展示素材

## 中文

本目录只用于 GitHub README 展示，不属于游戏运行资源。

- `banner.svg`：为本项目绘制的矢量封面，不依赖外部图片或字体。
- `sunset-flight.png`、`dawn-flight.png`、`starlight-flight.png`：当前游戏在 `1,600 × 900` 视口中的实际渲染截图，使用 High 画质。截图时临时隐藏所有 HUD，未改动生产代码或重绘场景。
- 三张截图均使用 `seed=2301&weather=clear&quality=high&autostart=1`，`zone` 分别为 `3`、`0`、`4`。启航后通过界面切换自动变速箱并开启自动领航。
- 截图采集于 `2026-09-19`；场景、相机与 HUD 随后续代码变化可能不同。截图不用于帧率或性能证明。

更新首页时保留真实画面，并同步中英文 README 的图片链接与说明。原完整 README 保存在根目录 [README.legacy.md](../../README.legacy.md)。

## English

These files are presentation assets for the GitHub README, separate from the game's runtime resources.

- `banner.svg` is a vector cover drawn for this project, with no external image or font dependencies.
- `sunset-flight.png`, `dawn-flight.png` and `starlight-flight.png` are actual game renders at a `1,600 × 900` viewport and High quality. The HUD was temporarily hidden for capture; production code and scene imagery were not edited.
- All three use `seed=2301&weather=clear&quality=high&autostart=1`, with `zone=3`, `zone=0` and `zone=4`, respectively. Automatic transmission and autopilot were enabled through the interface after launch.
- Captured on `2026-09-19`. Later revisions may change the scene, camera and HUD. These images are not performance benchmarks.

Keep screenshots representative of the game and update image links and descriptions in both README languages together. The original full README is preserved at [README.legacy.md](../../README.legacy.md).
