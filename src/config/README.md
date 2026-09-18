# Configuration / 配置

## 中文

保存六境主题、构建画质和跨模块只读配置。不得持有本局玩法状态。

共享世界尺度以 `45m/s`（`162km/h`）作为普通道路参考；每境 `2_700m` 在该参考速度下驻留 `60s`，末段 `72m` 过渡约 `1.6s`。手动跳台助推挡可达到更高真实速度，所以该值只预算普通道路，不是玩法速度上限；运行时会另外发布跳台挡下更短的驻留与过渡时长。

`sceneVisibilityContract` 把远景可见性统一为纯呈现合同：摄影机远裁面为 `1_600m`，六境基础雾远面落在 `720–1_200m`，地貌驻留再保留 `1.08×` 安全余量。境别雾仍维持伊甸/雨林更凝聚、云野更开阔的层次，天气也可继续缩短有效能见度；这些距离不得进入路线、碰撞、生成或驾驶判断。

六境地表统一遵守自然介电材质合同：海水、湿石、冰面、星尘和火山岩的 `metalness` 均为 `0`，区域差异只由粗糙度、起伏、颜色和天空反射形成。该约束防止地貌退化成镀铬或科幻金属，同时不改变地形高度、隧道裁切、道路、碰撞或天气权威。

生产景物 taxonomy 也使用朝圣与记忆语义：霞谷主地标为 `twilight-pilgrim-terraces`，禁阁环境庭为 `ascending-memory-court`。这两个 ID 是 world 基线对象池、地图可见 family 和测试共同消费的只读合同，不得回退成现代看台或升降机命名。

霞谷道路嵌纹与 High 天际远景身份分别固定为 `woven-wind-memory` 与 `canyon-pilgrim-terraces`。运行时会把前者写入真实道路主视觉 family，并以完整远景 ID 派生确定性 relief，因此所有 `roadStyle` 字符串和 `atmosphere.farScenery` ID 都必须通过 world 的现代语汇禁用扫描，不能再出现 `chevron / grandstand` 等身份。

障碍配置的六境 `3 static + 2 dynamic` 顺序与实体目录逐项相等。自然造型分类固定使用 `butterfly-petal-guardian / pilgrim-terrace-pier / gliding-ice-veil / orbiting-memory-ribbon / circling-constellation-arch / ascending-memory-archive / ash-storm-veil`；运行时对应的视觉运动语义为 `ice-veil-glide-cue / memory-ribbon-orbit-cue / constellation-arch-circle-cue / memory-archive-rise-cue / ash-veil-sweep-cue`。这些改名不改变障碍数量、碰撞盒、对象池容量、横纵向运动曲线或刷新时序。

Low/Medium 渲染值保持不变，并显式设置 `dynamicLocalFixtureLights=false`：隧道灯罩、扩散片及静态照度仍全程可见，但不会聚合灯具记录或启用近距动态聚光/阴影。High 设置该字段为 `true`，并请求 DPR `3`、`24_000_000` 像素、设备最高各向异性、4× MSAA、AO/Bloom，以及 `8_192 / 4_096 / 4_096` 太阳/次级方向光/局部阴影；实际阴影由渲染器纹理上限安全裁剪，且不按 FPS 降档。

High-only 动态灯池固定复用 `6` 盏聚光，其中 `2` 盏投影；Low/Medium 不会创建同等替代灯池。

## English

Owns realm themes, construction quality, and shared read-only configuration. It must not own live gameplay state.

The shared world scale uses `45m/s` (`162km/h`) as its ordinary-road reference. Each `2_700m` realm lasts `60s` at that reference, while its final `72m` transition lasts about `1.6s`. The manual jump-thrust stage reaches a higher real speed, so this value budgets ordinary roads rather than capping gameplay; runtime separately reports the shorter jump-stage residence and transition durations.

`sceneVisibilityContract` centralises distant presentation: the camera far plane is `1_600m`, authored realm fog ends span `720–1_200m`, and terrain residency reserves a further `1.08×` safety margin. Realm fog still keeps Eden/Rainforest more enclosed and Prairie more open, while weather may shorten effective visibility. These distances must never enter routing, collision, spawning, or driving decisions.

All six terrain themes share a natural-dielectric material contract: water, wet stone, ice, astral dust, and volcanic rock keep `metalness = 0`, with realm differences carried only by roughness, relief, colour, and reflected sky. This prevents chrome or sci-fi-metal landscapes without changing terrain height, tunnel cutouts, roads, collision, or weather authority.

Production scenery taxonomy also uses pilgrimage-and-memory semantics: the Valley landmark is `twilight-pilgrim-terraces`, and the Vault environment court is `ascending-memory-court`. These IDs are a shared read-only contract for the world baseline pool, map-visible families, and tests; they must not regress to modern spectator-tier or lift terminology.

The Valley road-inlay and High-horizon identities are fixed to `woven-wind-memory` and `canyon-pilgrim-terraces`. Runtime publishes the former into the real road main-visual family and hashes the complete far-scenery ID into deterministic relief, so every `roadStyle` string and `atmosphere.farScenery` ID must pass world's forbidden-modern-vocabulary scan and may not regress to `chevron / grandstand` identities.

Each realm's configured `3 static + 2 dynamic` obstacle order exactly matches the entity catalog. Natural-form taxonomy is fixed to `butterfly-petal-guardian / pilgrim-terrace-pier / gliding-ice-veil / orbiting-memory-ribbon / circling-constellation-arch / ascending-memory-archive / ash-storm-veil`; corresponding runtime visual-motion semantics are `ice-veil-glide-cue / memory-ribbon-orbit-cue / constellation-arch-circle-cue / memory-archive-rise-cue / ash-veil-sweep-cue`. These names change neither family counts, collider boxes, pool capacity, lateral/longitudinal motion curves, nor spawn timing.

Low/Medium render values remain unchanged and explicitly set `dynamicLocalFixtureLights=false`: tunnel housings, diffusers, and static irradiance remain continuously visible, but fixture records are not aggregated and nearby dynamic spots/shadows do not run. High sets the field to `true` and requests DPR `3`, `24_000_000` pixels, maximum device anisotropy, 4× MSAA, AO/Bloom, and `8_192 / 4_096 / 4_096` sun/secondary/local shadows; the renderer texture limit safely caps effective shadows, and FPS never downgrades the tier.

The High-only dynamic pool reuses six spots, including two shadow casters; Low/Medium create no equivalent fallback pool.
