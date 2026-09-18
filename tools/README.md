# Tools / 工具

## 中文

`verify-node.mjs` 是统一服务端门禁。从项目根目录运行 `node tools/verify-node.mjs`；它校验入口加载顺序、缓存代次、本地 Three.js、全部 JavaScript 语法，以及 `.test.js` / `.test.mjs` 串行 Node 测试，但不替代浏览器视觉验收。局域网服务器的来源网段、Host、公开目录、响应头和音频 Range 合同因此属于同一门禁。

`generate-windows-production-manifest.mjs` 为主 HTML、两个 Windows CMD、PowerShell 服务脚本以及 `assets/errors/src/styles/vendor` 中所有生产脚本、样式、图像与音频生成排序稳定的第 2 版大小和 SHA-256 清单；清单自身保持排除以避免递归。任何启动或生产字节、`WINDOWS_RELEASE` 改动后都要运行 `node tools/generate-windows-production-manifest.mjs`；统一门禁会重新计算并逐字节比较 `server/windows-production-manifest.json`，并锁定 CMD 的 ASCII/无 BOM/CRLF 与 PS1 的 UTF-8 BOM/CRLF，防止旧清单或非 Windows 字节格式进入交付目录。

生产入口固定使用稳定代次 `23-ipad-road-residency-253`：全部首方脚本、样式与浏览器夹具必须同代次，本地 `vendor/three-0.160.0.min.js` 继续使用独立版本。门禁同时核对布局、后处理与首次碰撞真实 WebGL 夹具的代次及关键断言，以及 `releaseStatus=stable`；Node 只确认夹具随版本交付，不能替代浏览器执行结果。

音频门禁锁定 `V23-effect-assets-1` 与 `V23-audio-13`：九个内联载荷必须逐字节等同交付 OGG，`file://` 必须零 `fetch`，HTTP 请求必须带发布代号且损坏 200 响应回到内联；恢复/解码延迟与已排期瞬态声都受生命周期清理约束。雨声回归另锁定原始雨量三层、普通桥下完整户外雨声、山体/地下隧道 `18% / 10%` 非零低通传导、弱雨相对上限、全天气总余量以及逐帧零分配。两份精确 OGG 都失败前不得合成。

替换效果 OGG 后运行 `node tools/generate-effect-audio-inline.mjs`，重新生成 exact-byte 模块；`verify-node.mjs` 会核对模块版本、资源字节、入口顺序和 `23-ipad-road-residency-253` 代次。配乐更换仍使用 `generate-music-rhythm.mjs`。

语言门禁要求 `<html>` 的 `lang` 与 `data-language` 默认均为 `zh-CN`。入口必须提供至少一个原生语言按钮，所有语言按钮均使用紧凑合同，并且 HUD 内不得出现语言按钮。完整的翻译内容与切换行为由独立 i18n 单元测试覆盖，本工具不重复复制词典或目录。

入口静态检查还锁定真实速度首帧：数字读数为 `0km/h`，金色 P 领航巡航参考刻度为 `120km/h / 79%`，辅助文案说明三挡在干地自然接近约 `110 / 160 / 280km/h`，且 MT 与 AT 均可进入高速道路/跳台3挡。布局、可访问性与 i18n 专项回归另外锁定独立 T 变速箱模式（初始 `MT`，不改变 M 满油门偏好）、桌面与手机模式控件、手机至少 `44px` 触控目标、三挡 `0–90 / 70–140 / 140–280km/h` 推荐工作带、P 关闭时 M 持续满油门且不受 `120km/h` 参考限制、P 开启时 M 显示领航接管，以及 MT 的 `70 / 125 / 140 / 190` 操作门槛、AT 的 `90 / 70 / 140 / 120` 自动换挡门槛和按模式区分的低速高挡 `lugging / stalled` 提示。工作带是驾驶建议而非速度硬上限。

## English

`verify-node.mjs` is the unified server-side gate. Run `node tools/verify-node.mjs` from the project root; it verifies entry order, cache generation, local Three.js, all JavaScript syntax, and serial `.test.js` / `.test.mjs` tests, but does not replace browser visual acceptance. The LAN server's client subnet, Host, public-directory, response-header, and audio-range contracts therefore run in the same gate.

`generate-windows-production-manifest.mjs` produces a stable, sorted schema-2 size/SHA-256 inventory for the main HTML, both Windows CMD files, the PowerShell server, and every production script, stylesheet, image, and audio byte under `assets/errors/src/styles/vendor`; the manifest itself remains excluded to avoid recursion. Run `node tools/generate-windows-production-manifest.mjs` after any boot/runtime-byte or `WINDOWS_RELEASE` change. The unified gate recomputes and byte-compares `server/windows-production-manifest.json` and locks CMD to ASCII/BOM-free/CRLF plus PS1 to UTF-8 BOM/CRLF, preventing stale inventory or non-Windows text bytes from reaching the launcher.

The production entry is pinned to stable generation `23-ipad-road-residency-253`: every first-party script, stylesheet, and browser fixture must match, while local Three.js retains its independent version. The gate checks the layout, post-processing, and first-collision real-WebGL fixture generations and required assertions plus `releaseStatus=stable`; Node only proves that the fixture ships with the release, not that a browser executed it.

The audio gate pins `V23-effect-assets-1` and `V23-audio-13`: all nine inline payloads must match delivered OGG files, `file://` performs zero fetches, HTTP requests carry the release key, corrupt 200 responses retry inline, and lifecycle cleanup stops both deferred and scheduled transients. Rain regressions also lock raw-intensity tiers, full outdoor rain under an ordinary bridge, nonzero `18% / 10%` low-pass transmission in mountain/underground tunnels, the weak-rain ratio, total weather headroom, and zero per-frame allocation. Synthesis requires both exact copies to fail.

After replacing an effect OGG, run `node tools/generate-effect-audio-inline.mjs` to rebuild the exact-byte module. `verify-node.mjs` checks module version, asset bytes, entry order, and generation `23-ipad-road-residency-253`. Score replacement still uses `generate-music-rhythm.mjs`.

The language gate requires both `<html lang>` and `<html data-language>` to default to `zh-CN`. The entry must expose at least one native language button, every language button must use the compact contract, and no language button may appear inside the HUD. Dedicated i18n unit tests own translation content and switching behavior, so this tool does not duplicate the dictionary or test tree.

Static entry checks also pin the real-speed first frame: the digital readout is `0km/h`, the gold P-Autopilot cruise-reference tick is `120km/h / 79%`, and accessible copy says the three gears naturally approach about `110 / 160 / 280km/h` on dry road, with both MT and AT able to select the high-performance road/ramp Gear 3. Dedicated layout, accessibility, and i18n regressions also pin the independent T transmission mode (initially `MT`, without changing the M full-throttle preference), desktop and phone mode controls, at least `44px` phone targets, the `0–90 / 70–140 / 140–280km/h` recommended working bands, uncapped P-off/M-on full throttle, visible P takeover of M, MT action thresholds `70 / 125 / 140 / 190`, AT thresholds `90 / 70 / 140 / 120`, and mode-aware low-speed/high-gear `lugging / stalled` warnings. Working bands are guidance, not hard speed caps.
