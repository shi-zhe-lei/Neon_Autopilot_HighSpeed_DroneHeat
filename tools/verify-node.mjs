#!/usr/bin/env node
/**
 * Unified server-side verification for the Neon browser game.
 * Neon 浏览器游戏统一服务端验证入口。
 *
 * This command intentionally excludes browser layout, WebGL rendering, trusted
 * gestures, and long-run gameplay. Those contracts require the real browser
 * fixture and must never be inferred from a green Node run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
// Verification resolves every deployment path from the project root, not from this tools module.
const projectDirectory = join(toolDirectory, '..');
const entryFile = 'Neon_Autopilot_HighSpeed_DroneHeat.html';
const layoutFixtureFile = 'tests/browser/Neon_Autopilot_HighSpeed_DroneHeat.layout-test.html';
const postprocessingFixtureFile =
  'tests/browser/Neon_Autopilot_HighSpeed_DroneHeat.postprocessing-pixel-test.html';
const collisionRenderFixtureFile =
  'tests/browser/Neon_Autopilot_HighSpeed_DroneHeat.collision-render-test.html';
const minimumNodeMajor = 20;
const releaseCacheVersion = 'neon-ipad-road-residency-253';
const vendorCacheVersion = '0.160.0';
const expectedStylesheet = 'styles/Neon_Autopilot_HighSpeed_DroneHeat.css';
const expectedWeatherModes = Object.freeze(['dry', 'severe', 'mixed']);
const expectedLayoutCases = Object.freeze([
  '1024x768',
  '1440x900',
  '1920x1080',
  '320x568',
  '360x640',
  '390x844',
  '402x874',
  '440x956',
  '768x1024',
  '820x1180',
  '834x1194',
  '568x320',
  '640x360',
  '844x390',
  '874x402',
  '956x440',
  '1024x1366',
  '1180x820',
  '1194x834',
  '1366x1024',
  '700x390',
  '720x460',
  '800x460',
  '830x560',
  '900x700',
  '920x700',
  '720x460-debug'
]);
const expectedScriptOrder = Object.freeze([
  'errors/startup.js',
  'src/ui/Neon_Autopilot_HighSpeed_DroneHeat.i18n.js',
  'vendor/three-0.160.0.min.js',
  'src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js',
  'src/weather/Neon_Autopilot_HighSpeed_DroneHeat.weather.js',
  'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.modeling.js',
  'src/entities/Neon_Autopilot_HighSpeed_DroneHeat.candlelight.js',
  'src/entities/Neon_Autopilot_HighSpeed_DroneHeat.obstacles.js',
  'src/world/Neon_Autopilot_HighSpeed_DroneHeat.creatures.js',
  'src/world/Neon_Autopilot_HighSpeed_DroneHeat.region-scenery.js',
  'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.lighting.js',
  'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.postprocessing.js',
  'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.track.js',
  'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf.js',
  'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-tiles.js',
  'errors/minimap.js',
  'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-map.js',
  'src/entities/Neon_Autopilot_HighSpeed_DroneHeat.ship.js',
  'src/world/Neon_Autopilot_HighSpeed_DroneHeat.world.js',
  'src/weather/Neon_Autopilot_HighSpeed_DroneHeat.surface-weather.js',
  'src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js',
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-library.js',
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-rhythm.js',
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.effect-assets.js',
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.audio.js',
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-player.js',
  'src/ui/Neon_Autopilot_HighSpeed_DroneHeat.fullscreen.js',
  'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'
]);
// Every first-party runtime file belongs to one deployment generation; only
// the pinned vendor filename/version follows its independent upstream version.
const releaseVersionedScripts = Object.freeze(expectedScriptOrder.filter(
  (scriptPath) => scriptPath !== 'vendor/three-0.160.0.min.js'
));

function fail(message) {
  console.error(`[verify-node] FAIL: ${message}`);
  process.exit(1);
}

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(absolutePath));
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) files.push(absolutePath);
  }
  return files.sort();
}

/** Parse one relative production asset URL without coupling validation to a live server. */
function parseAssetSource(source) {
  const parsed = new URL(source, 'https://neon.local.invalid/');
  return {
    path: parsed.pathname.replace(/^\//, ''),
    version: parsed.searchParams.get('v')
  };
}

/** Extract one nested div by exact class so ancestor-sensitive UI contracts do not rely on flat text searches. */
function extractDivByClass(source, className) {
  const divPattern = /<\/?div\b[^>]*>/gi;
  let startIndex = -1;
  let match;
  while ((match = divPattern.exec(source)) !== null) {
    if (match[0].startsWith('</')) continue;
    const classAttribute = /\bclass=(["'])(.*?)\1/i.exec(match[0])?.[2] || '';
    if (classAttribute.split(/\s+/).includes(className)) {
      startIndex = match.index;
      break;
    }
  }
  if (startIndex < 0) return '';

  divPattern.lastIndex = startIndex;
  let depth = 0;
  while ((match = divPattern.exec(source)) !== null) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(startIndex, divPattern.lastIndex);
  }
  return '';
}

/** Validate dependency order and prevent a release from mixing stale local cache generations. */
function verifyEntryContract() {
  const absoluteEntry = join(projectDirectory, entryFile);
  if (!existsSync(absoluteEntry)) fail(`missing entry file ${entryFile}`);
  const absoluteLayoutFixture = join(projectDirectory, layoutFixtureFile);
  if (!existsSync(absoluteLayoutFixture)) fail(`missing browser fixture ${layoutFixtureFile}`);
  const absolutePostprocessingFixture = join(projectDirectory, postprocessingFixtureFile);
  if (!existsSync(absolutePostprocessingFixture)) {
    fail(`missing browser fixture ${postprocessingFixtureFile}`);
  }
  const absoluteCollisionRenderFixture = join(projectDirectory, collisionRenderFixtureFile);
  if (!existsSync(absoluteCollisionRenderFixture)) {
    fail(`missing browser fixture ${collisionRenderFixtureFile}`);
  }
  for (const scriptPath of expectedScriptOrder) {
    if (!existsSync(join(projectDirectory, scriptPath))) fail(`missing runtime dependency ${scriptPath}`);
  }

  const html = readFileSync(absoluteEntry, 'utf8');
  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] || '';
  if (!/\blang="zh-CN"/i.test(htmlTag) || !/\bdata-language="zh-CN"/i.test(htmlTag)) {
    fail('entry must default both document language contracts to zh-CN');
  }
  const languageToggleTags = [...html.matchAll(
    /<([a-z][\w:-]*)\b[^>]*\bdata-language-toggle(?=[\s=>])[^>]*>/gi
  )];
  if (languageToggleTags.length === 0) fail('entry must expose at least one language toggle');
  for (const languageToggle of languageToggleTags) {
    if (languageToggle[1].toLowerCase() !== 'button') {
      fail('every language toggle must use native button semantics');
    }
    if (!/\bdata-language-compact(?=[\s=>])/.test(languageToggle[0])) {
      fail('every language toggle must use the compact presentation contract');
    }
  }
  const hudMarkup = extractDivByClass(html, 'hud');
  if (!hudMarkup) fail('entry is missing the HUD container');
  if (/\bdata-language-toggle(?=[\s=>])/.test(hudMarkup)) {
    fail('language toggles must stay outside the HUD');
  }
  // The finished checkout must publish stable last; an active lease is valid only during an unfinished multi-file edit.
  const releaseStatusMatch = html.match(
    /<script\b[^>]*\bid="releaseStatus"[^>]*\btype="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!releaseStatusMatch) fail('entry is missing the inline release-status contract');
  let releaseStatus;
  try {
    releaseStatus = JSON.parse(releaseStatusMatch[1]);
  } catch (error) {
    fail(`release-status JSON is invalid: ${error.message}`);
  }
  if (releaseStatus.schemaVersion !== 1
    || releaseStatus.state !== 'stable'
    || releaseStatus.noticeId !== releaseCacheVersion
    || releaseStatus.issuedAt !== null
    || releaseStatus.expiresAt !== null) {
    fail(`finished release-status must be stable and match ${releaseCacheVersion}`);
  }
  const weatherModeTags = [...html.matchAll(/<input\b[^>]*\bname="weatherMode"[^>]*>/g)]
    .map((match) => match[0]);
  const weatherModeValues = weatherModeTags.map((tag) => tag.match(/\bvalue="([^"]+)"/)?.[1] || '');
  if (JSON.stringify(weatherModeValues) !== JSON.stringify(expectedWeatherModes)) {
    fail(`launch weather modes must be ${expectedWeatherModes.join(' -> ')}`);
  }
  const checkedWeatherModes = weatherModeTags.filter((tag) => /\schecked(?:\s|>)/.test(tag));
  if (checkedWeatherModes.length !== 1 || !/\bvalue="mixed"/.test(checkedWeatherModes[0])) {
    fail('launch weather modes must default to exactly one mixed selection');
  }
  if (!html.includes('data-guide-contract-version="18"')
    || !html.includes('data-guide-feature="render-quality"')
    || !html.includes('data-guide-feature="pause-restart"')
    || !html.includes('data-guide-feature="weather-launch-modes"')
    || !html.includes('data-guide-feature="fps-display"')
    || !html.includes('data-guide-feature="lighting-toggle"')
    || !html.includes('data-guide-feature="candle-handling"')
    || !html.includes('data-guide-feature="music-library"')
    || !html.includes('data-guide-view="essential"')
    || !html.includes('id="guideContext"')
    || !html.includes('id="guideEssentialViewBtn"')
    || !html.includes('id="guideAllViewBtn"')
    || !html.includes('id="guidePreviousChapterBtn"')
    || !html.includes('id="guideNextChapterBtn"')) {
    fail('flight manual must synchronize render quality, candle handling, weather-mode, FPS, and themed music contracts');
  }
  if (!html.includes('太阳、月亮与雷电是真实投影光源')
    || !html.includes('所有画质都让整段灯罩和扩散片始终可见发亮')
    || !html.includes('低和中画质不扫描、不选择也不预热任何动态隧道或桥底聚光')
    || !html.includes('只有高画质启用六盏复用聚光，其中两盏投影阴影')
    || !html.includes('全档灯罩、扩散片和静态基础照度的固定常亮状态')
    || !html.includes('普通开放桥下保留天空与 HDR 能量')
    || !html.includes('道路之外的地貌与景物也接收真实投影阴影')
    || !html.includes('飞船的引擎、烛芯和警示采用可见自发光材质')
    || !html.includes('1K / 2K / 8K 主太阳阴影随低 / 中 / 高画质切换')
    || !html.includes('高画质在设备不支持时安全回退 4K')
    || !html.includes('“光影 开 / 关”可随时停用真实灯光、HDR 环境反射与投影阴影')
    || !html.includes('露天路面会随天气逐步形成积水、积雪、雪泥或积尘')
    || !html.includes('高速时要提前留出转向与制动余量')
    || !html.includes('飞船压过露天积水会产生涟漪、水花与尾流')
    || !html.includes('给手动和领航施加相同、有限的阻力与侧滑')) {
    fail('flight manual must document tiered tunnel lighting, HDR, and actionable surface-weather decisions');
  }
  if (!html.includes('最低云底仍保持在最高桥面上方 36 米')
    || !html.includes('进入镜头中央视线或贴近相机的云叶会平滑退让')
    || !html.includes('外围云幕密度保持不变')) {
    fail('flight manual must document the road-safe and camera-safe cloud presentation contract');
  }
  if (!html.includes('最低云底仍保持在最高桥面上方 36 米、当前世界高度 45 米')
    || !html.includes('雾与沙尘会在原天气能见度上继续叠加衰减并提前进入近雾')
    || !html.includes('镜头周围最低垂直跨度为 72 米')
    || !html.includes('切到高视角也不会看穿顶面或前壁')) {
    fail('flight manual must document dense visibility and the Top-view weather envelope');
  }
  if (!html.includes('隧道内保持干燥')
    || !html.includes('压过积雪会留下双沟和雪粉')
    || !html.includes('不改路线、碰撞或生命')
    || !html.includes('封闭隧道还会沿洞门连续移除室外暴雪、浓雾与沙尘造成的能见度衰减')
    || !html.includes('深处恢复当前境界的正常基础雾距')) {
    fail('flight manual must document snow contact, gameplay boundaries, and tunnel shelter');
  }
  if (!html.includes('当前可见的地标、环境造物与空中生物')
    || !html.includes('所有环境生物只提供世界氛围，不参与玩家速度、路线或碰撞权威')
    || html.includes('冥龙以约 259 km/h')) {
    fail('flight manual must keep ambient creatures presentation-only without exposing legacy speed copy');
  }
  const i18nSource = readFileSync(
    join(projectDirectory, 'src/ui/Neon_Autopilot_HighSpeed_DroneHeat.i18n.js'),
    'utf8'
  );
  if (!html.includes('四驾驶视角、电影模式与全屏')
    || !html.includes('F 只启用电影镜头而不改变 MT / AT')
    || !html.includes('MT 继续显示并允许 Q / E')
    || !html.includes('AT 继续隐藏手动换挡键并自动接管')
    || !i18nSource.includes('P 关闭时仍由你手动驾驶')
    || !i18nSource.includes('电影中仍可随时切换 P、M、T 与挡位')
    || !i18nSource.includes('安全层不会替你转向、制动或换挡')) {
    fail('flight manual must document camera-only Film mode with MT-visible and AT-hidden manual shift controls');
  }
  // Cloud safety belongs to world presentation and must remain exported for deterministic server-side tests.
  const worldSource = readFileSync(
    join(projectDirectory, 'src/world/Neon_Autopilot_HighSpeed_DroneHeat.world.js'),
    'utf8'
  );
  for (const marker of [
    'CLOUD_PRESENTATION_CLEARANCE_CONTRACT',
    'roadVerticalClearanceM: 36',
    'requiredCloudLiftM',
    'cloudSightlineScale',
    'cloudRoadClearanceViolationCount',
    'cloudCameraOcclusionProtection: true',
    'cloudClearanceVisualOnly: true'
  ]) {
    if (!worldSource.includes(marker)) fail(`world cloud-safety contract is missing ${marker}`);
  }
  for (const marker of [
    'WEATHER_VIEW_VOLUME_CONTRACT',
    'maximumSupportedCameraHeightAboveSurfaceM: 26',
    'maximumTopViewUpwardRayDeg: 14',
    'minimumCameraCenteredVerticalSpanM: 72',
    'dustDenseGroundFraction: 0.72',
    "const hailPool = createWeatherPointPool(",
    "const dustPool = createWeatherPointPool(",
    "weatherAdditionalDrawGroups: WEATHER_VIEW_VOLUME_CONTRACT.additionalDrawGroups",
    'weatherCoverageViolationCount: 0'
  ]) {
    if (!worldSource.includes(marker)) fail(`world Top-view weather contract is missing ${marker}`);
  }
  // High horizon must remain one physical relief mesh per realm; a flat Basic ribbon or repeated instance ring
  // would pass generic world syntax while recreating the visible high-camera defect.
  for (const marker of [
    'horizonSegments: 96',
    'horizonDepthLayerCount: 3',
    'horizonTrianglesPerZone: 1_728',
    'horizonMeshesPerZone: 1',
    'horizonInstancesPerZone: 0',
    'horizonMorphTargetsPerZone: 1',
    'horizonMaximumVisibleDrawGroups: 1',
    "horizonGeometryMode: 'deterministic-concentric-relief-bands'",
    "horizonMaterialModel: 'opaque-physically-lit-standard'",
    "horizonTransitionMode: 'single-mesh-position-normal-morph-explicit-color-attribute'",
    "horizonColorTransitionMode: 'webgl1-webgl2-next-color-attribute'",
    "horizonAnchorMode: 'bounded-world-space-parallax'",
    "cameraContract: 'read-only-unchanged'",
    'new THREE.MeshStandardMaterial({',
    'emissive: 0x00_0000',
    'emissiveIntensity: 0',
    'transparent: false',
    'depthWrite: true',
    'morphAttributes[attributeName] = [nextAttribute]',
    "setAttribute('neonNextHorizonColor', nextAttribute)",
    'attribute vec3 neonNextHorizonColor',
    'uniform float neonHorizonColorBlend',
    'material.customProgramCacheKey',
    'colorBlendUniform.value = blend',
    'ultraHorizonAnchorWorldX - renderOriginX',
    '-renderOriginY',
    'ultraHorizonMorphWeight = blend'
  ]) {
    if (!worldSource.includes(marker)) fail(`world High-horizon contract is missing ${marker}`);
  }
  for (const forbidden of [
    'createUltraHorizonRibbon',
    'Neon.World.UltraHorizonFeatures',
    'ultraHorizonOpacityWeightSum',
    'neonBaseOpacity'
  ]) {
    if (worldSource.includes(forbidden)) {
      fail(`world High horizon must not restore the flat/repeated implementation: ${forbidden}`);
    }
  }
  for (const marker of [
    'DARK_DRAGON_FLIGHT_CONTRACT',
    'forwardSpeedMps: 72',
    'function darkDragonRouteDistanceM(',
    'const lateral = dragon.userData.lateral;',
    'dragon.rotation.x = 0;',
    'dragon.rotation.z = 0;',
    "darkDragonMotion: reducedMotion ? 'static-pose' : 'stable-forward-flight'",
    'darkDragonVisualOnly: DARK_DRAGON_FLIGHT_CONTRACT.presentationOnly'
  ]) {
    if (!worldSource.includes(marker)) fail(`world dark-dragon flight contract is missing ${marker}`);
  }
  if (!html.includes('id="fpsDisplay"') || !html.includes('data-fps-level="pending"')) {
    fail('HUD must expose the pending FPS readout before the first renderer sample');
  }
  for (const marker of [
    'id="handlingMetric"',
    'id="handlingValue">55.0%',
    'id="handlingGauge" role="meter"',
    'aria-valuemin="55"',
    'aria-valuemax="100"',
    'id="handlingFill" aria-hidden="true"',
    'data-guide-feature="candle-handling"'
  ]) {
    if (!html.includes(marker)) fail(`HUD candle handling meter is missing ${marker}`);
  }
  const gameplayCoreSource = readFileSync(
    join(projectDirectory, 'src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js'),
    'utf8'
  );
  for (const marker of [
    'CANDLE_HANDLING_CONTRACT',
    "formula: 'bounded-diminishing-returns'",
    'halfResponseCandles: 18',
    'baselineDisplayPercent: 55',
    'maximumDisplayPercent: 100',
    'maximumRpmGain: 0.25',
    'maximumSpoolUpRateGain: 0.50',
    "colorSequence: 'warm-gold-violet-cyan'",
    'function resolveCandleHandling(candleCount, target = {})'
  ]) {
    if (!gameplayCoreSource.includes(marker)) fail(`candle handling core contract is missing ${marker}`);
  }
  // Player-facing km/h, authoritative m/s travel, and collision pressure must remain one contract.
  const speedReadoutMarkers = Object.freeze([
    'data-testid="speedometer"',
    'id="speedValue">0',
    'id="speedometerTarget">120',
    'class="speedometer-target-tick" d="M 95.927 22.580 L 89.606 27.484"',
    'preserveAspectRatio="xMidYMid meet"',
    'id="speedometerValueArc" d="M 10 52"',
    'id="speedometerNeedle" x1="58" y1="52" x2="58" y2="4"',
    'data-target-progress="0.790000"',
    'data-scale-mode="segmented-target"',
    '数字始终显示真实速度',
    'P 领航的 120 km/h 普通巡航参考',
    'P 关闭且 M 开启时持续满油门，不受该参考限制',
    '1挡约每小时 110 公里、2挡约每小时 160 公里',
    '高速道路/跳台3挡约每小时 280 公里，MT 与 AT 均可进入',
    '<strong>0</strong><span>km/h</span>',
    '<strong>120</strong><span>km/h</span>'
  ]);
  for (const marker of speedReadoutMarkers) {
    if (!html.includes(marker)) fail(`entry speed readout is missing ${marker}`);
  }
  for (const marker of [
    'id="speedModeBtn"',
    'aria-label="满油门保持已关闭；P 关闭时由 W 控制油门，点击开启"',
    'data-automatic-throttle-enabled="false"',
    'data-automatic-throttle-preference-enabled="false"',
    'data-longitudinal-authority="player"',
    '<span class="hud-toggle-label">自动油门</span>',
    '<b id="speedModeBtnState">关闭</b>',
    '<kbd aria-hidden="true">M</kbd>',
    'P 关闭时 M 满油门无目标上限；P 开启时领航拥有唯一纵向权威'
  ]) {
    if (!html.includes(marker)) fail(`entry automatic-throttle default is missing ${marker}`);
  }
  if (
    html.includes('目标 300 m/s')
    || html.includes('<strong>32</strong><span>m/s</span>')
    || html.includes('<strong>115</strong><span>km/h</span>')
    || html.includes('<strong>1,080</strong><span>km/h</span>')
  ) {
    fail('entry substituted internal m/s values for the public km/h speed contract');
  }
  const stylesheetSource = readFileSync(join(projectDirectory, expectedStylesheet), 'utf8');
  const valueArcStyle = [...stylesheetSource.matchAll(/\.speedometer-value-arc\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((block) => block.includes('stroke: var(--speedometer-tone)')) || '';
  const needleStyle = stylesheetSource.match(/\.speedometer-needle\s*\{([^}]*)\}/)?.[1] || '';
  if (!stylesheetSource.includes('.metric.speedometer-metric')
    || !stylesheetSource.includes('.speedometer-value-arc')
    || !stylesheetSource.includes('.speedometer-ticks .speedometer-target-tick')
    || !valueArcStyle.includes('stroke-linecap: butt')
    || !valueArcStyle.includes('filter: none')
    || !needleStyle.includes('filter: none')
    // Only the value arc forbids dashes; unrelated route/collision guides may use them for semantics.
    || valueArcStyle.includes('stroke-dasharray')) {
    fail('HUD speedometer is missing its compact dial, target tick, value arc, or needle presentation');
  }
  for (const marker of [
    '.metric.handling-metric',
    '.handling-summary',
    '.handling-gauge',
    '#handlingFill',
    'transform: scaleX(0.55)'
  ]) {
    if (!stylesheetSource.includes(marker)) fail(`HUD candle handling styles are missing ${marker}`);
  }
  const runtimeSource = readFileSync(
    join(projectDirectory, 'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'),
    'utf8'
  );
  const cloverleafTilesSource = readFileSync(
    join(
      projectDirectory,
      'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-tiles.js'
    ),
    'utf8'
  );
  // Opposing-road presentation work must be ready before touchdown when possible, but it cannot own speed until
  // the already-visible landing alias enters its physical stopping envelope.
  for (const marker of [
    'const opposingVariantReadinessBoundaryMarginM = 2',
    'function preflightOpposingLandingVariant(sourceEdgeId)',
    'preflightOpposingLandingVariant(metadata.edgeId)',
    'function opposingVariantReadinessRequiresBoundaryBrake()',
    "? 'opposing-boundary'",
    'state.speed = state.opposingVariantBoundaryStopped ? 0 : integratedSpeed',
    'opposingVariantReadinessPreflightCount:',
    'opposingVariantReadinessBoundaryBrakeCount:'
  ]) {
    if (!runtimeSource.includes(marker)) {
      fail(`runtime opposing-road speed-continuity contract is missing ${marker}`);
    }
  }
  if (runtimeSource.includes("state.autoBrakeReason = 'opposing-variant-readiness'")) {
    fail('runtime restored unconditional opposing-road readiness braking');
  }
  for (const marker of [
    "purpose: 'opposing-bypass-prewarm'",
    'priority: tile.token === state.token ? 0 : 1'
  ]) {
    if (!cloverleafTilesSource.includes(marker)) {
      fail(`opposing-road prewarm priority contract is missing ${marker}`);
    }
  }
  for (const marker of [
    'worldDarkDragonForwardSpeedMps',
    'worldDarkDragonLongitudinalSwayAmplitudeM',
    'worldDarkDragonLateralSwayAmplitudeM',
    'worldDarkDragonRootPitchSwayRadians',
    'worldDarkDragonRootRollSwayRadians'
  ]) {
    if (!runtimeSource.includes(marker)) fail(`runtime dark-dragon diagnostics are missing ${marker}`);
  }
  for (const marker of [
    "Object.freeze(['追尾', '近距', '俯视', '车头'])",
    'const cameraViewHood = 3',
    'hoodEyeHeightM: 2.05',
    'cameraPositionSide = state.lateral',
    'samplePlannedFrame(hoodLookAhead, state.lateral, cameraHoodLookFrame)',
    ': hoodViewActive\n          ? 0\n          : 1)',
    'const hoodCameraLocked = hoodViewActive && state.cameraTransition <= 0',
    'const actualCameraSide = (camera.position.x - routeAnchor.x) * rightX',
    'cameraHoodActive: !state.cameraCinematicActive && state.viewMode === cameraViewHood',
    'cameraHoodLateralErrorM',
    'cameraHoodSightlineM'
  ]) {
    if (!runtimeSource.includes(marker)) fail(`runtime hood-camera contract is missing ${marker}`);
  }
  const surfaceWeatherSource = readFileSync(
    join(projectDirectory, 'src/weather/Neon_Autopilot_HighSpeed_DroneHeat.surface-weather.js'),
    'utf8'
  );
  for (const marker of [
    "exposure: 'open-sky-route-only'",
    'SNOW_ACCUMULATION_CONTRACT',
    'SNOW_POWDER_CONTACT_CONTRACT',
    'SHOULDER_SNOW_INTERACTION_CONTRACT',
    'function allowsStandingWater(frame = {})',
    'function allowsSnowAccumulation(frame = {})',
    'function crossesSnowPatch(sweep = {}, patch = {})',
    'entry.standingWaterAllowed = allowsStandingWater(waterFrame)',
    'if (!entry.standingWaterAllowed) continue',
    'entry.snowAccumulationAllowed = allowsSnowAccumulation(snowFrame)',
    'entry.snowHalfWidth = (1.4',
    "const interval = sampleEntryInterval(sweep, entry, 'snow')",
    "sampleEntryInterval(sweep, entry, 'snow-bank')",
    'resolveShoulderSnowInteraction(',
    'snowBankContactThisUpdate:',
    'disturbedSnowBankCellCount:',
    'if (!interval.hit) continue',
    'snowPowderMaximumLifeSeconds:',
    'liveSnowParticleCount:',
    'bankEntry.snowAccumulationAllowed = allowsSnowAccumulation(bankFrame)',
    'coveredPuddleVisibleCount: 0',
    'coveredWaterInteractionViolationCount: 0',
    'coveredSnowPatchVisibleCount: 0',
    'coveredSnowBankVisibleCount: 0',
    'coveredSnowInteractionViolationCount: 0'
  ]) {
    if (!surfaceWeatherSource.includes(marker)) {
      fail(`surface-weather tunnel-shelter contract is missing ${marker}`);
    }
  }
  const weatherSource = readFileSync(
    join(projectDirectory, 'src/weather/Neon_Autopilot_HighSpeed_DroneHeat.weather.js'),
    'utf8'
  );
  for (const marker of [
    'TUNNEL_WEATHER_SHELTER_CONTRACT',
    'OPEN_AIR_VISIBILITY_CONTRACT',
    'function resolveOpenAirVisibility(weather = {}, out = null)',
    'minimumVisibilityScale: 0.10',
    'fogNearMaximumM: 18',
    'fogNearMinimumM: 4',
    'function isSealedTunnelFrame(routeFrame = {})',
    'function resolveTunnelAtmosphere(weather = {}, routeFrame = {}, out = null)',
    "visibility: 'realm-baseline-at-full-enclosure'"
  ]) {
    if (!weatherSource.includes(marker)) fail(`weather tunnel-shelter contract is missing ${marker}`);
  }
  for (const marker of [
    'sampleSurfaceWeatherFrame(',
    'weather.resolveTunnelAtmosphere(',
    'weather.OPEN_AIR_VISIBILITY_CONTRACT.minimumVisibilityScale',
    'scene.fog.near = Math.min(scene.fog.near, weatherFogNearCapM)',
    'weatherVisibilityContractVersion:',
    'weatherViewVolumeContractVersion:',
    'weatherCoverageViolationCount:',
    'state.weatherSurfaceSnowCover = tunnelAtmosphere.snowCover',
    'weatherTunnelVisibilityNormalized:',
    'weatherCoveredSnowPatchVisibleCount:',
    'weatherCoveredSnowBankVisibleCount:',
    'weatherSnowPowderVisible:',
    'weatherSnowPowderContactRequired:',
    'weatherSnowPowderMaximumLifeSeconds:',
    'weatherLiveSnowParticleCount:',
    'weatherSnowPatchCrossingCount:'
  ]) {
    if (!runtimeSource.includes(marker)) fail(`runtime tunnel-shelter contract is missing ${marker}`);
  }
  for (const marker of [
    'roadScaleKmh: 80',
    'roadScaleDialProgress: 0.58',
    'targetDialProgress: 0.79',
    'overspeedCompressionKmh: 48',
    'needleContinuesAboveTarget: true',
    'overspeedUsesContinuousCompression: true',
    'analogueIndicatorsShareEndpoint: true',
    'valueArcUsesPartialPath: true',
    'function speedometerProgressForKmh(speedKmh)',
    'function resolveSpeedometerDialPresentation(speedKmh, target = {})',
    "speedometerValueArcEl.setAttribute('d', dialPresentation.arcPath)",
    "speedometerEl.dataset.analogueMode = 'shared-endpoint-path'",
    "'segmented-target'",
    "'compressed-overspeed'"
  ]) {
    if (!runtimeSource.includes(marker)) fail(`runtime overspeed gauge contract is missing ${marker}`);
  }
  if (runtimeSource.includes('strokeDasharray') || runtimeSource.includes('stroke-dasharray')) {
    fail('runtime reintroduced a dash-based speedometer value arc that can drift under non-scaling stroke');
  }
  for (const marker of [
    'function syncCandleHandling()',
    'currentRpm: state.propulsionCoreRpm',
    'baseMaximumLateralSpeed * state.handling.lateralSpeedMultiplier',
    'maxLatAccel:',
    '* state.handling.lateralAccelerationMultiplier',
    'baseDragRate * state.handling.dragMultiplier',
    'maximumRpm: state.handling.maximumRpm',
    'spoolUpRatePerSecond: state.handling.spoolUpRatePerSecond',
    'function updateHandlingMeter()',
    'sampleHandlingProfile(candleCount)',
    'handlingMeterMatchesPhysics:',
    'propulsionMeterMaximumMatchesProfile:'
  ]) {
    if (!runtimeSource.includes(marker)) fail(`runtime candle handling contract is missing ${marker}`);
  }
  // The independent pointer and digital bearing already communicate heading, so the removed top marker must stay absent.
  if (html.includes('desktop-compass-lubber') || stylesheetSource.includes('.desktop-compass-lubber')) {
    fail('entry reintroduced the redundant desktop compass top marker');
  }
  const scriptSources = [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map((match) => match[1]);
  const parsedScripts = scriptSources.map(parseAssetSource);
  const actualScriptOrder = parsedScripts.map((asset) => asset.path);
  if (JSON.stringify(actualScriptOrder) !== JSON.stringify(expectedScriptOrder)) {
    fail([
      'entry script order differs from the documented runtime contract',
      `expected: ${expectedScriptOrder.join(' -> ')}`,
      `actual:   ${actualScriptOrder.join(' -> ')}`
    ].join('\n'));
  }
  const startupIndex = actualScriptOrder.indexOf('errors/startup.js');
  const i18nIndex = actualScriptOrder.indexOf('src/ui/Neon_Autopilot_HighSpeed_DroneHeat.i18n.js');
  const threeIndex = actualScriptOrder.indexOf('vendor/three-0.160.0.min.js');
  if (i18nIndex !== startupIndex + 1 || threeIndex !== i18nIndex + 1) {
    fail('entry must load startup -> i18n -> local Three.js before the remaining runtime');
  }

  const stylesheetMatch = html.match(/<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"/);
  if (!stylesheetMatch) fail(`missing production stylesheet ${expectedStylesheet}`);
  const stylesheet = parseAssetSource(stylesheetMatch[1]);
  if (stylesheet.path !== expectedStylesheet || stylesheet.version !== releaseCacheVersion) {
    fail(`stylesheet cache key must be ${expectedStylesheet}?v=${releaseCacheVersion}`);
  }

  const scriptVersions = new Map(parsedScripts.map((asset) => [asset.path, asset.version]));
  for (const scriptPath of releaseVersionedScripts) {
    const actualVersion = scriptVersions.get(scriptPath);
    if (actualVersion !== releaseCacheVersion) {
      fail(`${scriptPath} cache key must be ${releaseCacheVersion}; received ${actualVersion || 'missing'}`);
    }
  }
  if (scriptVersions.get('vendor/three-0.160.0.min.js') !== vendorCacheVersion) {
    fail(`local Three.js cache key must preserve ${vendorCacheVersion}`);
  }
  const productionResourceSources = [...html.matchAll(
    /<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"/gi
  )]
    .map((match) => match[1])
    .filter((source) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source));
  for (const source of productionResourceSources) {
    const asset = parseAssetSource(source);
    const expectedVersion = asset.path === 'vendor/three-0.160.0.min.js'
      ? vendorCacheVersion
      : releaseCacheVersion;
    if (asset.version !== expectedVersion) {
      fail(`${asset.path} must use production cache generation ${expectedVersion}`);
    }
  }

  // The iframe URL is a document-level cache buster for repeated local audits.
  // Lock each required query flag independently so adding another fixture-only
  // flag cannot silently remove either update coverage or generation parity.
  const layoutFixture = readFileSync(absoluteLayoutFixture, 'utf8');
  const layoutGeneration = releaseCacheVersion.split('-').at(-1);
  if (!layoutFixture.includes('&modelDebug=1')
    || !layoutFixture.includes('&updateNotice=1')
    || !layoutFixture.includes(`&cache=${layoutGeneration}`)) {
    fail(`${layoutFixtureFile} must force model-debug/update-notice coverage with cache=${layoutGeneration}`);
  }
  // Responsive audits must wait for the runtime's published boundary; a short arbitrary snapshot recreates
  // false update-dialog and launch failures on throttled phone/WebGL hosts.
  if (!layoutFixture.includes('const runtimeReadinessTimeoutMs = 30_000;')
    || !layoutFixture.includes(
      'const waitForLaunchCommit = async (timeoutMs = runtimeReadinessTimeoutMs)'
    )
    || !layoutFixture.includes(
      'const updateReadyDeadline = Date.now() + runtimeReadinessTimeoutMs;'
    )) {
    fail(`${layoutFixtureFile} must share the 30-second readiness hang guard`);
  }
  // The phone-specific flight deck owns the full viewport in both orientations. Lock containment, separation, and
  // direct-action hit targets here so the responsive matrix cannot silently fall back to the retired desktop shells.
  if (!layoutFixture.includes('output.hud.mobileFlightDeck.surface.box?.width === output.viewport.width')
    || !layoutFixture.includes('output.hud.mobileFlightDeck.surface.box?.height === output.viewport.height')
    || !layoutFixture.includes('inside(output.hud.mobileFlightDeck.surface.box, output.hud.mobileFlightDeck.route)')
    || !layoutFixture.includes('!overlaps(output.hud.mobileFlightDeck.glance, output.hud.mobileFlightDeck.actions)')
    || !layoutFixture.includes('!overlaps(output.hud.mobileFlightDeck.glance, output.hud.mobileFlightDeck.route)')
    || !layoutFixture.includes('!overlaps(output.hud.mobileFlightDeck.actions, output.hud.mobileFlightDeck.route)')
    || !layoutFixture.includes("expect('ipad-landscape-route-occupies-safe-top-center-slot'")
    || !layoutFixture.includes("expect('ipad-portrait-route-retains-below-head-slot'")
    || !layoutFixture.includes("expect('mobile-utility-drawer-and-route-retain-separate-safe-lanes'")
    || !layoutFixture.includes("expect('mobile-details-clear-the-autopilot-status-lane'")
    || !layoutFixture.includes("expect('mobile-details-clear-transmission-and-driving-controls'")
    || !layoutFixture.includes("expect('short-landscape-700-to-830-keeps-one-coordinated-hud'")
    || !layoutFixture.includes("expect('ultra-short-landscape-keeps-usable-details-and-one-row-controls'")
    || !layoutFixture.includes("expect('compact-tablet-landscape-keeps-route-below-the-top-command-rail'")
    || !layoutFixture.includes("expect('ipad-to-phone-resize-keeps-only-the-last-detail'")
    || !layoutFixture.includes("expect('viewport-camera-renderer-and-postprocessing-share-one-snapshot'")
    || !layoutFixture.includes('output.hud.mobileFlightDeck.actionButtons.length === 4')) {
    fail(`${layoutFixtureFile} must enforce the dedicated portrait and landscape mobile flight deck`);
  }
  // Button-level containment does not expose ellipsized descendants; require the real layout audit to measure each
  // label and state leaf so a four-column desktop deck cannot regress to clipped glyph fragments.
  if (!layoutFixture.includes("expect('desktop-command-copy-remains-fully-visible'")
    || !layoutFixture.includes('action.labelClipped === false')
    || !layoutFixture.includes('action.stateClipped === false')
    || !layoutFixture.includes('action.copyHorizontalOverflow === false')
    || !layoutFixture.includes('action.metaHorizontalOverflow === false')) {
    fail(`${layoutFixtureFile} must measure complete desktop command copy at the leaf level`);
  }
  const requiredCasesMatch = /const requiredResponsiveCases = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(layoutFixture);
  if (!requiredCasesMatch) fail(`${layoutFixtureFile} must publish its required responsive matrix`);
  for (const caseName of expectedLayoutCases) {
    if (!layoutFixture.includes(`'${caseName}': Object.freeze`)
      || !requiredCasesMatch[1].includes(`'${caseName}'`)) {
      fail(`${layoutFixtureFile} must define and require responsive case ${caseName}`);
    }
  }
  const postprocessingFixture = readFileSync(absolutePostprocessingFixture, 'utf8');
  const postprocessingSources = [...postprocessingFixture.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map((match) => parseAssetSource(match[1]))
    .filter((asset) => asset.path !== 'vendor/three-0.160.0.min.js');
  if (postprocessingSources.length === 0) {
    fail(`${postprocessingFixtureFile} must load its first-party rendering dependency`);
  }
  for (const asset of postprocessingSources) {
    if (asset.version !== releaseCacheVersion) {
      fail(`${postprocessingFixtureFile} dependency ${asset.path} must use ${releaseCacheVersion}`);
    }
  }

  // Node only proves that the real-WebGL collision fixture and its assertions ship together. The fixture itself
  // must still execute in a browser so a static green gate cannot be presented as shader or GPU evidence.
  const collisionRenderFixture = readFileSync(absoluteCollisionRenderFixture, 'utf8');
  const collisionRenderSources = [...collisionRenderFixture.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map((match) => parseAssetSource(match[1]))
    .filter((asset) => asset.path !== 'vendor/three-0.160.0.min.js');
  if (collisionRenderSources.length !== 2) {
    fail(`${collisionRenderFixtureFile} must load the modeling and ship first-party dependencies`);
  }
  for (const asset of collisionRenderSources) {
    if (asset.version !== releaseCacheVersion) {
      fail(`${collisionRenderFixtureFile} dependency ${asset.path} must use ${releaseCacheVersion}`);
    }
  }
  const collisionRenderMarkers = Object.freeze([
    'prepareInvulnerabilityShieldCompilation()',
    'renderer.info.programs || []',
    'gl.isContextLost()',
    'gl.getError()',
    'program?.diagnostics?.runnable !== false',
    'gl.LINK_STATUS',
    'first-activation-uses-prewarmed-programs',
    "low: Object.freeze({ orbitCount: 1, anchorCount: 1 })",
    "medium: Object.freeze({ orbitCount: 2, anchorCount: 3 })",
    "high: Object.freeze({ orbitCount: 3, anchorCount: 5 })",
    'collisionRenderAuditStatus'
  ]);
  for (const marker of collisionRenderMarkers) {
    if (!collisionRenderFixture.includes(marker)) {
      fail(`${collisionRenderFixtureFile} is missing required real-WebGL assertion ${marker}`);
    }
  }
}

function runNode(label, argumentsList) {
  console.log(`[verify-node] ${label}`);
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: projectDirectory,
    stdio: 'inherit'
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < minimumNodeMajor) {
  fail(`Node.js ${minimumNodeMajor}+ is required; current version is ${process.versions.node}`);
}

verifyEntryContract();

const syntaxFiles = collectJavaScriptFiles(projectDirectory);
// Infrastructure tests use ESM directly, so both .test.js and .test.mjs belong to the serial release gate.
const testFiles = syntaxFiles.filter((file) => /\.test\.(?:js|mjs)$/.test(file));
const benchmarkFiles = syntaxFiles.filter((file) => file.endsWith('.benchmark.mjs'));
if (syntaxFiles.length === 0) fail('no JavaScript files were discovered');
if (testFiles.length === 0) fail('no Node test files were discovered');
if (benchmarkFiles.length === 0) fail('no non-gating Node benchmark files were discovered');

for (const file of syntaxFiles) {
  runNode(`syntax ${relative(projectDirectory, file)}`, ['--check', file]);
}

// Wall-clock benchmarks are syntax-checked above but never run here: host timing
// observations cannot decide the deterministic regression gate's exit status.
runNode(`tests (${testFiles.length} files, serial)`, [
  '--test',
  '--test-concurrency=1',
  ...testFiles
]);

console.log(
  `[verify-node] PASS: entry order, ${releaseCacheVersion} local cache contract, local Three.js, `
    + `${syntaxFiles.length} JavaScript files, `
    + `${testFiles.length} serial Node tests; ${benchmarkFiles.length} benchmark syntax-checked, not executed`
);
