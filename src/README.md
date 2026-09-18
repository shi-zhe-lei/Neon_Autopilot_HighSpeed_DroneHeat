# Runtime source / 运行时源码

## 中文

`src/` 保存全部第一方浏览器运行时。入口仍位于项目根目录，并按 `config → weather → rendering（lighting 后接 High-only postprocessing）→ navigation → entities → world → gameplay → audio → ui → runtime` 的既定脚本顺序加载；模块继续通过 `window.NeonV23*` 合同连接。Low/Medium 使用原直接渲染，High 的所有新增模块接口必须可逆并提供 `dispose`。

双语权威位于 `ui/`，但会在启动错误边界之后、Three.js 与其余第一方目录之前提前加载。后续模块保存语言中立的路线、天气、音乐与玩法状态，只在 DOM、无障碍属性、Canvas 或纹理呈现边界解析 `zh-CN` / `en` 文案。

雨天跨模块合同保留一份原始户外天气：`runtime` 只转发已提交路线分类，`world` 负责桥下局部遮雨与隧道可见雨幕，`audio` 负责户外直达声和隧道非零低通传导。相机预览或普通高架的 `underpassBlend` 不得冒充封闭隧道并清除雨景/雨声。

随机跳台跨模块合同由 `navigation` 发布平坦基路、独立跳台几何和只读道路落点，`runtime` 独占切线离坡、腾空计时、有限跨路横移及坠毁结束，`ui` 负责中英文规则与结果文案，`audio` 只消费既有语义事件。对向道路可持续渲染并作为腾空落点，但不得进入 `PathPlan`、障碍生成或普通碰撞；手工 SPACE 不获得平台专属的跨路权限。

高挡低速跨模块合同保持单向数据流：`gameplay` 解析线性加载转速、平方可用扭矩、失速与恢复挡；`runtime` 唯一写入速度并把只读负载包分发给 HUD、`audio` 和 `entities/ship`；`ui`/`styles` 只本地化并突出离散拖挡/失速状态。音频与尾焰不得反推或回写物理，中央告警不得创建第二份挡位权威，完全失速也只沿既有滚阻/气阻减速。

## English

The tall-gear low-speed cross-module contract preserves one-way data flow. `gameplay` resolves linear loaded RPM, squared available torque, stall, and recovery gear; `runtime` remains the sole speed writer and distributes one read-only load packet to HUD, `audio`, and `entities/ship`; `ui`/`styles` only localize and emphasize discrete lugging/stall states. Audio and exhaust cannot infer or write physics, the central advisory cannot create a second gear authority, and complete stall still slows only through the existing rolling/aerodynamic resistance chain.

`src/` contains all first-party browser runtime code. The entry remains at the project root and preserves `config → weather → rendering (High-only postprocessing after lighting) → navigation → entities → world → gameplay → audio → ui → runtime`; modules continue to connect through `window.NeonV23*` contracts. Low/Medium use the original direct path, and every new High interface must be reversible and disposable.

The bilingual authority lives under `ui/` but loads early, immediately after the startup error boundary and before Three.js or any other first-party directory. Later modules retain language-neutral route, weather, music, and gameplay state and resolve `zh-CN` / `en` copy only at DOM, accessibility, Canvas, or texture presentation boundaries.

The cross-module rain contract retains one raw outdoor weather state: `runtime` forwards committed-route classification only, `world` owns local bridge shelter and tunnel visibility, and `audio` owns outdoor direct sound plus nonzero low-pass tunnel transmission. Camera preview or an ordinary bridge's `underpassBlend` cannot impersonate a sealed tunnel and erase rain visuals/audio.

The random-platform contract assigns flat base roads, independent platform geometry, and read-only physical landing ribbons to `navigation`; tangent release, measured airtime, finite cross-road motion, and terminal crash authority to `runtime`; bilingual rules/results to `ui`; and consumption of existing semantic events only to `audio`. Opposing pavement remains visibly resident and may support airborne landing, but cannot enter `PathPlan`, hazard generation, or ordinary collision. Manual SPACE never receives the platform-only cross-road envelope.
