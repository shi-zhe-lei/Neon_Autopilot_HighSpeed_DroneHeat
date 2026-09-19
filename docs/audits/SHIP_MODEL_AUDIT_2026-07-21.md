# Neon Player Ship Model Audit / Neon 玩家飞船建模审查

Date / 日期：2026-07-21  
Status / 状态：implemented and browser-accepted / 已实现并通过浏览器验收

## 中文

### 目标与不可变边界

本轮把玩家主体从传统喷气机轮廓重塑为与六区世界一致的“晨岛烛火 + 披风织物 + 星座连线 + 蝠鲼滑翔”语言。全部新增结构均为程序化、代码原生的原创网格和光效，不引入外部角色、贴图或模型资源。

以下玩法合同保持不变：

- 视觉翼展扩大到 `5.24m`，固定碰撞代理仍为 `playerHalf={hx:0.72,hy:0.58,hz:1.36}`。
- 速度、距离积分、路线、生命、碰撞、障碍生成压力和自动驾驶权限不受美术层影响。
- 当前 `300m/s` 高速公平性与无作弊边界继续成立；没有减障碍、锁生命、瞬移或隐藏限速。
- 披风呼吸、尾带摆动、星座辉光、护盾和接触影均是视觉专用；`prefers-reduced-motion` 会把披风呼吸归零。

### 基线问题与处理

| 审查面 | 原问题 | 本轮处理 | 验收重点 |
| --- | --- | --- | --- |
| 追尾轮廓 | 窄三角翼和大喷焰主导，像传统小型战机 | 改为宽展、圆角分瓣的双层披风翼；压低喷焰和局部白光 | 第一眼先读到披风与烛火，而不是喷口 |
| 近距层级 | 机身、翼面和推进光缺少明确视觉中心 | 新增烛芯形灵体、六芒晨星、环形暖光和织物内嵌层 | 中央烛火最亮，翼面纹理仍可辨认 |
| 俯视剪影 | 翼展不足，星座主题不成立 | 健康态 `5.24m` 翼展，左右对称星座节点、连线和翼脉 | 小尺寸仍能读出蝠鲼/披风剪影 |
| 侧向与转弯 | 尾焰体积压过船体，披风厚度不足 | 缩窄主/内焰，增加封闭翼厚、翼尖和两条灵体围巾尾 | 斜侧视角不露断面，视觉重心留在船体 |
| 生命损伤 | 右翼切换可能留下与旧轮廓脱节的灯或纹路 | 健康、受伤、危急三套右翼各自持有翼面、嵌层、翼脉、灯和翼尖 | 任一状态都没有悬空装饰或开放断面 |
| 高速照明 | 白色尾焰和发动机灯会把红色材质冲成白色 | 主/内焰透明度上限 `0.72 / 0.60`，局部推进灯上限 `6.2` | 高速仍能辨认暖红织物和金色星线 |
| 护盾与接地 | 旧护盾、顶视环和接触影覆盖不了新翼展 | 三者随新轮廓扩大，仅改变视觉覆盖 | 不改变碰撞代理或地面接触采样 |
| 竖屏构图 | `390×844` 近距视角会裁翼或压住底部输入仪表 | aspect `<0.78` 平滑后移；到 `0.46` 时后置倍率 `1.42`、前视倍率 `0.55` | 全翼留在可视区，并避开触控/按键安全区 |

### 建模与材质合同

- `SKY_CAPE_ART_CONTRACT` 冻结主题 ID、健康态翼展、每翼最少层数、星座节点数、灵光尾带数、最大披风起伏和纯视觉标记。
- 每侧至少两层封闭披风翼：外层承担宽展剪影，内层以较暗、较粗糙的织物材质提供厚度和层次。
- 健康态共有 `9` 个星座节点（含中央晨星）和成组的星线/翼脉；四条灵光尾带从烛火核心后方分层展开。
- 右翼三种生命轮廓分别构建并分组切换，装饰与所属翼面同生共灭。
- 主体继续使用自定义 indexed 封闭网格；微型光效属于已标记的视觉例外。

### 多角度验收矩阵

| 角度/状态 | 必查项目 | 结果 |
| --- | --- | --- |
| 追尾 | 左右重量、完整翼展、烛火中心、尾焰遮挡 | 通过 |
| 近距 | 双层织物、晨星、翼脉、翼尖、护盾覆盖 | 通过 |
| 俯视 | 蝠鲼剪影、左右对称、星座连线、顶视环 | 通过 |
| 斜侧自由观察 | 封闭厚度、尾带分层、喷焰与船体比例 | 通过 |
| 危急生命 | 缩短右翼与全部附属件同步、无悬空灯 | 通过 |
| 高速 | 红/金材质不被白焰吞没、光效不遮挡道路 | 通过 |
| `390×844` 竖屏近距 | 全翼边距、底部按键/触控安全区、无横向溢出 | 通过 |
| 降低动态 | 披风呼吸归零，权威障碍运动不变 | 通过（纯函数与源码合同） |

### 验证边界

- Node 专项测试覆盖美术合同冻结、呼吸幅度、降低动态、健康轮廓、双层披风、四条尾带、固定碰撞代理、推进灯上限和竖屏相机合同。
- 真实浏览器验收覆盖追尾、近距、俯视、斜侧、危急生命、高速材质和 `390×844` 竖屏构图；检查 WebGL 错误、拓扑失败、横向溢出和调试合同。
- `23-sky-cape-129` 真实浏览器实测：`390×844` 近距视角在 `485 km/h` 时为 `59 FPS`、`18.0ms` P95、`27.5ms` 最大帧时，竖屏构图混合值 `1.0`，横向溢出 `0`；`1280×720` 桌面近距在超过目标极速的实跑中仍为 `60 FPS`、`18.7ms` P95。两者拓扑失败均为 `0 / 650`，浏览器 error 日志为 `0`。这些数据是当前机器上的验收证据，不替代最低浏览器矩阵和目标服务器部署验证。
- 本文分别记录 Node 合同、WebGL 视觉、尺寸构图和稳态帧数据，不把语法/纯函数测试冒充浏览器证明，也不把一次机器实测外推为所有硬件的性能保证。

## English

### Intent and invariants

The player craft has been rebuilt from a conventional jet silhouette into an original, procedural language shared with the six realms: Dawn-Isle candlelight, woven capes, constellation tracery, and manta-like gliding. No external character, texture, or model asset was introduced.

The healthy visual span is now `5.24m`, while fixed collision remains `playerHalf={hx:0.72,hy:0.58,hz:1.36}`. Speed, distance integration, routing, lives, collision, hazard pressure, autopilot authority, and the current fair `300m/s` no-cheat boundary are unchanged. Cape breathing, wake ribbons, constellation glow, shield, and contact shadow are visual-only; reduced motion resolves cape breathing to zero.

### Review summary

- Rear/chase: the two-layer cape and candle core now lead the silhouette; bounded plumes no longer dominate it.
- Close: a candle-shaped spirit core, six-point dawn star, warm halo, inset weave, ribs, and tips create a clear near-field hierarchy.
- Top: the `5.24m` span, mirrored constellation nodes, and rounded cape lobes remain legible at gameplay scale.
- Oblique/turning: closed cape thickness, paired spirit scarves, and narrower plumes preserve the craft body from side angles.
- Damage: healthy, wounded, and critical right-wing groups each own their surface, inset, tracery, lamp, and tip, preventing floating remnants.
- Lighting: main/inner plume opacity is capped at `0.72 / 0.60`, and the local propulsion light at `6.2`, preserving warm-red cloth at speed.
- Portrait: close view begins camera-only compensation below aspect `0.78` and reaches `1.42` rear scale plus `0.55` look-ahead scale at aspect `0.46`, without scaling ship or collision.

### Verification boundary

Focused Node tests cover the frozen art contract, bounded/reduced-motion cape breath, healthy outline, two-layer capes, four wake ribbons, fixed collision, propulsion-light bound, and portrait-camera contract. Real-browser review covers chase, close, top, oblique, critical damage, high-speed material readability, and `390×844` framing, with WebGL errors, topology failures, overflow, and debug diagnostics checked separately.

On generation `23-sky-cape-129`, the `390×844` close-view run measured `59 FPS`, `18.0ms` P95, `27.5ms` maximum frame time, portrait blend `1.0`, and zero horizontal overflow at `485 km/h`. The `1280×720` desktop close-view run remained at `60 FPS` and `18.7ms` P95 while running beyond the target top speed. Both reported `0 / 650` topology failures and zero browser error logs. These are host-specific acceptance measurements, not a substitute for the minimum-browser matrix or target-server deployment proof.
