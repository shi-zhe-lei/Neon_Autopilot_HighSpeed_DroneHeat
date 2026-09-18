# V23 审计测试矩阵与证据

- 日期：2026-07-16
- 目录：`Neon_Autopilot_V23_HighSpeed_DroneHeat`
- 运行环境：
  - macOS
  - Apple M4
  - Chrome `150.0.7871.116`
  - WebGL：`ANGLE Metal Renderer: Apple M4`
  - Node.js `v20.19.0`
  - 本机静态 HTTP 服务

## 1. 文件和测试入口

运行时代码：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-map.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.ship.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.world.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.audio.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.fullscreen.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.js`

Node 测试：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.audio.test.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.ship.test.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.track.test.js`
- `Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-map.test.js`

浏览器测试：

- `Neon_Autopilot_V23_HighSpeed_DroneHeat.layout-test.html`

当前无 `package.json`，无统一 npm test 入口。

## 2. 语法检查

结果：15/15 JavaScript 文件通过 `node --check`。

包括 11 个运行时文件和 4 个测试文件。

## 3. Node 回归

| 测试 | 首轮 | 主要覆盖 |
|---|---|---|
| audio.test.js | PASS | 资源、混音、可信解锁、HTTP/file 生命周期、存储降级 |
| ship.test.js | PASS | 差动推进、固定碰撞代理、速度光流、巡航动态 |
| track.test.js | PASS | 12 movement、20 crossing、16 span、净空、制动、50km |
| cloverleaf-map.test.js | PASS | 四分辨率、场景同源、原子提交、故障帧保留、260 移动帧 |
| node --test 串行 | 4/4 PASS | 四个顶层测试 |

### 3.1 track 计时稳定性

`track.test.js` 使用真实 wall-clock 验证 4ms 构建分片。

- 隔离重复 5 次：4 PASS / 1 FAIL
- 一次失败：`4.812791ms`，slowest=`edges:10:shell`
- 浏览器并行负载下重复 5 次：1 PASS / 4 FAIL
- 观测失败值约：`4.739 / 13.355 / 28.397 / 6.070ms`
- 完整 node --test 重复也出现约 `6.912ms` 失败

结论：逻辑回归可通过，但实时 4ms 断言是机器 benchmark，当前不稳定。

### 3.2 Node 覆盖率

已加载文件的工具报告行覆盖率约 `75.03%`，但该数字不代表整个游戏：

| 文件 | 行覆盖率 |
|---|---:|
| track.js | 91.20% |
| cloverleaf-map.js | 93.05% |
| cloverleaf-tiles.js | 89.91% |
| audio.js | 75.09% |
| cloverleaf.js | 44.27% |
| ship.js | 14.32% |

完全未进入该覆盖报告：

- main.js：10,356 行
- world.js：2,018 行
- modeling.js：964 行
- fullscreen.js：68 行

## 4. Chrome 硬件 WebGL 六尺寸矩阵

本轮当前代码结果：

| Case | 通过/总数 | 结果 | 额外失败 |
|---|---:|---|---|
| 390×844 | 99/105 | FAIL | 无 |
| 1024×768 | 98/104 | FAIL | 无 |
| 1440×900 | 97/104 | FAIL | warm slice 5.1ms |
| 1920×1080 | 98/104 | FAIL | 无 |
| 844×390 | 98/105 | FAIL | 页面高出 7.75px |
| 720×460-debug | 91/100 | FAIL | 3 个罗盘 ownership/visibility 失败 |
| 合计 | 581/622 | FAIL | 41 条失败 |

### 4.1 六个尺寸共同失败

1. `topology-closed`
   - failure count：1
   - label：`cloverleaf-road-shell-batch`
   - boundary edges：672
2. `pier-footings-and-spacing-match-structure`
   - maximum gap：150.171m
   - spacing：52m
   - allowed：104.01m
3. `all-planar-crossings-have-clustered-physical-spans`
   - graph：20 crossings / 16 spans
   - browser-published visual：0 / 0
4. `connected-road-shells-have-no-internal-end-caps`
   - browser-published suppressed caps：0
5. `junction-aprons-and-lenses-seal-every-ramp-gore`
   - candidates：36，后续 pool=3 时可达 54
   - long pairs/lenses：0/0
6. `sustained-frame-budget`
   - FPS：约 69.9–71.5
   - frame P95：约 19.4–26.3ms
   - frame max：约 27.3–28.2ms，个别长跑检查更高
   - Long Tasks：0

### 4.2 地图和主要运行合同

六尺寸中以下项目表现正常：

- map P95：约 0.9–1.2ms
- route gap：0
- chord error：约 0.0014px 级
- arrow error：0 或极低
- 场景坐标拒绝：0
- synthetic map objects：0
- route fallback：0
- route preparation miss：0
- interchange obstacle/pickup intrusion：0
- tunnel safe corridor violation：0
- ambient traffic unsafe edge：0
- bidirectional seam violation：0
- cloud topology failure：0
- terrain runtime rebuild：0

### 4.3 844×390 溢出

直接页面测量：

- viewport：`844×390`
- document scrollHeight：`398`
- `.hud-wing.hud-navigation`
  - top：8
  - bottom：397.75
  - 高出视口：7.75px

### 4.4 720×460 debug 罗盘

- debug map 放大后 `compactMap=false`
- map 选择 `external-desktop`
- CSS desktop compass 仅在 `min-width:921px` 且 `min-height:561px` 显示
- 当前 DOM compass `display:none`
- map compass draws：0

结论：该 debug case 没有任何可见罗盘。

## 5. 320/360 小屏补测

现有夹具最窄仅 390px，本轮补测：

| Case | 页面溢出 | 启动卡 | 运行时问题 |
|---|---|---|---|
| 360×640 | 无 | 完整可见 | key tracker 与 controls 重叠约 22px |
| 320×568 | 无 | 完整可见 | key tracker 遮住跳跃控制区 |

320×568 关键边界：

- key tracker：top 424 / bottom 464
- controls：top 442 / bottom 556
- 垂直重叠：22px

证据：[AUDIT_2026-07-16_320X568_OVERLAP.png](../evidence/AUDIT_2026-07-16_320X568_OVERLAP.png)

## 6. 300m/s 长跑

参数：

```text
autostart=1
auto=1
seed=2303
quality=high
cloverleafEntry=south
cloverleafMove=straight
modelDebug=1
```

检查点：

| 时间 | 速度 m/s | km/h | 距离 m | 生命 |
|---:|---:|---:|---:|---:|
| 5.0s | 49.25 | 177 | 206 | 3 |
| 20.1s | 100.39 | 361 | 1,332 | 3 |
| 40.1s | 168.43 | 606 | 4,022 | 3 |
| 60.1s | 238.00 | 857 | 8,101 | 3 |
| 75.1s | 290.51 | 1,046 | 12,059 | 3 |
| 80.1s | 307.54 | 1,107 | 13,557 | 3 |

终点状态：

- running=true
- gameOver=false
- autoPilot=true
- lastDamage=null
- routeTransitions=20
- routeCommitMaxMs=0.1
- routeFallbacks=0
- routePreparationMisses=0
- routeContinuityError=0
- rampProtectionViolations=0
- Long Tasks=0

证据：[AUDIT_2026-07-16_300MS_PROOF.png](../evidence/AUDIT_2026-07-16_300MS_PROOF.png)

## 7. 故障注入

| 场景 | 结果 |
|---|---|
| localStorage 读取拒绝 | 未捕获 SecurityError；无 canvas；按钮仍显示但游戏未初始化 |
| 屏蔽 jsDelivr | `Three.js load failed`；无 canvas |
| WebGL getContext 返回 null | `Error creating WebGL context`；无用户可见 fallback |
| fullscreenEnabled=false，但方法存在 | 模块仍 supported=true；按钮仍启用 |
| repeat=true 的 KeyP | 领航仍被切换为 ON |
| leftBtn.click()/jumpBtn.click() | 输入状态仍 false；两个按钮无 aria-label |

## 8. 音频真实交互

### 8.1 开始游戏

在 360×640 和 320×568 中使用真实 Playwright click：

- contextState=running
- contextCreateCount=1
- assetsLoaded=10
- assetErrors=0
- audible=true

### 8.2 只打开玩法详情

游戏仍未开始：

- running=false
- guideOpen=true
- contextState=running
- contextCreateCount=1
- assetsLoaded=10
- assetErrors=0
- musicStatus=ready

结论：任意可信详情点击会提前加载整套音频。

## 9. 控制台和网络

正常游戏页：

- 未发现应用 JavaScript error。
- 未发现本地游戏资源 404。
- 稳定警告：

```text
Scripts "build/three.js" and "build/three.min.js" are deprecated with r150+,
and will be removed with r160.
```

layout 测试外页没有 favicon，因此首次测试可能产生 `/favicon.ico` 404；游戏页本身使用 data favicon。

## 10. 证据文件

| 文件 | 尺寸 | SHA-256 |
|---|---:|---|
| [AUDIT_2026-07-16_300MS_PROOF.png](../evidence/AUDIT_2026-07-16_300MS_PROOF.png) | 1280×720 | `6247b42a3a23caf081cdc3a588b1c5f9d249ea5db97ef214bbe735b567087a31` |
| [AUDIT_2026-07-16_320X568_OVERLAP.png](../evidence/AUDIT_2026-07-16_320X568_OVERLAP.png) | 320×568 | `a16da3cfaba8c4891d084c930c932cf77fd128e8e6f24ce57872b20e080a9654` |

## 11. 测试限制

- Chrome 浏览器矩阵使用硬件 Metal，但以 headless 方式运行；帧时间应再用实体显示器和普通 Chrome 标签复核。
- 未在真实 VoiceOver/TalkBack 中操作，只完成 DOM、ARIA、click 和键盘路径审计。
- 未进行真实用户手势的全屏成功测试；完成了 Permissions Policy 拒绝模拟。
- 300m/s 长跑使用固定 straight movement，证明目标可达，但不能覆盖所有 12 个 movement 的 300m/s 生存率。
- 未修改代码，因此所有失败均保持可复现。
