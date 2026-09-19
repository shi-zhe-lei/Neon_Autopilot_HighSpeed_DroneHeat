# README artwork / 首页展示素材

## 中文

本目录只用于 GitHub README 展示，不属于游戏运行资源。

- `banner.svg`：为本项目绘制的矢量封面，不依赖外部图片或字体。
- 三张 PNG 均为当前游戏在 `1,600 × 900` 视口、High 画质下的实际渲染截图。通过正常界面开启自动变速箱和自动领航，驶入立交桥区域后取景；未跳转位置、修改车速或重绘场景。
- 截图时临时隐藏 HUD，以突出桥面、桥墩、匝道与飞船。生产代码未改动，`modelDebug` 仅用于读取位置和画质诊断。
- 截图采集于 `2026-09-19`，均使用普通追尾视角。记录距离取自截图前的仪表读数，为近似取景位置；截图不用于帧率或性能证明。

### 取景位置

共用入口参数：

```text
seed=2301&weather=clear&quality=high&autostart=1&cloverleafEntry=south&modelDebug=1
```

在上述参数后追加表内的场景与路线设置：

| 文件 | 场景与路线参数 | 约计航程 | 取景内容 |
| :--- | :--- | :--- | :--- |
| `interchange-entrance.png` | `zone=0&cloverleafMove=left` | 1,582 米 | 立交桥下的匝道入口，上层桥面与下层通道 |
| `interchange-ramp.png` | `zone=0&cloverleafMove=left` | 1,437 米 | 转弯匝道与相交的高架桥 |
| `interchange-underpass.png` | `zone=3&cloverleafMove=straight` | 1,900 米 | 上层桥面、桥墩与下层道路间的穿行画面 |

更新首页时保留真实画面，并同步中英文 README 的图片链接与说明。原完整 README 保存在根目录 [README.legacy.md](../../README.legacy.md)。

## English

These files are presentation assets for the GitHub README, separate from the game's runtime resources.

- `banner.svg` is a vector cover drawn for this project, with no external image or font dependencies.
- All three PNGs are actual game renders at a `1,600 × 900` viewport and High quality. Automatic transmission and autopilot were enabled through the normal interface, and the craft drove to the interchange. No teleporting, speed overrides or image repainting were used.
- The HUD was temporarily hidden to emphasize the bridge decks, piers, ramps and craft. Production code was unchanged; `modelDebug` was used only to read position and quality diagnostics.
- Captured on `2026-09-19`, using the normal chase camera. Distances are approximate photo positions read from the instruments immediately before capture. These images are not performance benchmarks.

### Capture positions

Common entry parameters:

```text
seed=2301&weather=clear&quality=high&autostart=1&cloverleafEntry=south&modelDebug=1
```

Append the scene and route settings below:

| File | Scene and route parameters | Approx. run distance | Composition |
| :--- | :--- | :--- | :--- |
| `interchange-entrance.png` | `zone=0&cloverleafMove=left` | 1,582 m | Ramp entrance beneath the interchange, with upper decks and a lower passage |
| `interchange-ramp.png` | `zone=0&cloverleafMove=left` | 1,437 m | Curved ramp and intersecting elevated bridge |
| `interchange-underpass.png` | `zone=3&cloverleafMove=straight` | 1,900 m | Driving between the elevated deck, bridge piers and lower roadway |

Keep screenshots representative of the game and update image links and descriptions in both README languages together. The original full README is preserved at [README.legacy.md](../../README.legacy.md).
