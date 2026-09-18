#!/usr/bin/env node
/** Player-facing manual synchronization contract / 玩家可见飞行手册同步合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Resolve authored contracts from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = join(__dirname, '../..');
const html = readFileSync(join(PROJECT_ROOT, 'Neon_Autopilot_V23_HighSpeed_DroneHeat.html'), 'utf8');
const css = readFileSync(
  join(PROJECT_ROOT, 'styles/Neon_Autopilot_V23_HighSpeed_DroneHeat.css'),
  'utf8'
);
const runtime = readFileSync(
  join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
  'utf8'
);
const i18n = readFileSync(
  join(PROJECT_ROOT, 'src/ui/Neon_Autopilot_V23_HighSpeed_DroneHeat.i18n.js'),
  'utf8'
);

// The exact player ledger intentionally excludes opt-in developer controls. A player-visible feature may be renamed
// in prose, but adding or removing one requires an explicit manual-contract update here.
const requiredFeatureIds = Object.freeze([
  'controls-steering',
  'throttle-modes',
  'launch-and-ramps',
  'free-look',
  'view-and-fullscreen',
  'live-input-authority',
  'fps-display',
  'lighting-toggle',
  'ship-feedback',
  'dynamic-audio',
  'music-library',
  'reduced-motion-pause',
  'render-quality',
  'pause-restart',
  'route-map-modes',
  'straight-fork',
  'cloverleaf-routes',
  'tunnel-camera',
  'speed-guidance',
  'autopilot-guidance',
  'fair-start-speed',
  'fair-target-speed',
  'three-lives',
  'core-loop',
  'score-and-candles',
  'candle-handling',
  'collision-rules',
  'obstacle-pressure',
  'no-cheat',
  'shared-controls',
  'realm-pairing',
  'map-ecology',
  'world-landmarks',
  'covered-routes',
  'ambient-traffic',
  'weather-lifecycle',
  'weather-forecast-clouds',
  'layered-precipitation',
  'surface-weather',
  'ship-weather-interactions',
  'weather-lighting',
  'weather-launch-modes',
  'weather-visual-only'
]);

/** Read one quoted HTML attribute from a previously isolated opening tag. */
function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

/** Return the four tab or panel opening tags without depending on attribute order. */
function openingTags(elementName, markerAttribute) {
  return [...html.matchAll(new RegExp(`<${elementName}\\b[^>]*\\b${markerAttribute}="[^"]+"[^>]*>`, 'g'))]
    .map((match) => ({ tag: match[0], index: match.index }));
}

/** Find a nested element's real closing boundary instead of stopping at an authored child section. */
function nestedElementEnd(openIndex, elementName) {
  const tokenPattern = new RegExp(`<\\/?${elementName}\\b[^>]*>`, 'g');
  tokenPattern.lastIndex = openIndex;
  let depth = 0;
  for (let token = tokenPattern.exec(html); token; token = tokenPattern.exec(html)) {
    if (token[0].startsWith(`</${elementName}`)) depth--;
    else depth++;
    if (depth === 0) return tokenPattern.lastIndex;
  }
  assert.fail(`unterminated ${elementName} at ${openIndex}`);
}

test('manual feature ledger retains exactly 43 player-facing abilities', () => {
  const featureMatches = [...html.matchAll(/data-guide-feature="([a-z0-9-]+)"/g)];
  const actualFeatureIds = featureMatches.map((match) => match[1]);
  assert.equal(new Set(actualFeatureIds).size, actualFeatureIds.length, 'guide feature IDs must be unique');
  assert.deepEqual(
    [...actualFeatureIds].sort(),
    [...requiredFeatureIds].sort(),
    'every player-visible ability must be added to or removed from the guide ledger explicitly'
  );
  assert.equal(actualFeatureIds.length, 43);
  assert.match(html, /data-guide-contract-version="18"/);
  assert.doesNotMatch(
    html.slice(html.indexOf('id="guideOverlay"'), html.indexOf('id="musicLibraryOverlay"')),
    /data-guide-feature="weather-manual-test"/
  );
});

test('four responsive chapters remain bidirectionally linked and every feature belongs to one panel', () => {
  const tabs = openingTags('button', 'data-guide-tab');
  const panels = openingTags('section', 'data-guide-panel');
  assert.equal(tabs.length, 4);
  assert.equal(panels.length, 4);
  assert.equal(tabs.filter(({ tag }) => attribute(tag, 'aria-selected') === 'true').length, 1);
  assert.equal(panels.filter(({ tag }) => !/\shidden(?:\s|>)/.test(tag)).length, 1);

  const panelByKey = new Map(panels.map((entry) => [attribute(entry.tag, 'data-guide-panel'), entry]));
  for (const tab of tabs) {
    const key = attribute(tab.tag, 'data-guide-tab');
    const panel = panelByKey.get(key);
    assert.ok(panel, `missing panel for guide tab ${key}`);
    assert.equal(attribute(tab.tag, 'aria-controls'), attribute(panel.tag, 'id'));
    assert.equal(attribute(panel.tag, 'aria-labelledby'), attribute(tab.tag, 'id'));
    const panelEnd = nestedElementEnd(panel.index, 'section');
    const panelBody = html.slice(panel.index, panelEnd);
    assert.match(panelBody, /class="guide-section-heading"/);
    assert.match(panelBody, /data-guide-feature="/);
  }

  const panelRanges = panels.map((panel) => ({
    start: panel.index,
    end: nestedElementEnd(panel.index, 'section')
  }));
  for (const match of html.matchAll(/data-guide-feature="([a-z0-9-]+)"/g)) {
    assert.ok(
      panelRanges.some((range) => match.index > range.start && match.index < range.end),
      `${match[1]} must live inside one guide panel`
    );
  }
});

test('manual orientation keeps four concise chapter names and truthful synchronization metadata', () => {
  const tabs = openingTags('button', 'data-guide-tab');
  assert.deepEqual(
    tabs.map(({ tag }) => attribute(tag, 'aria-label')),
    ['操作', '导航', '目标与规则', '天气与世界']
  );
  assert.equal((html.match(/class="guide-tab-index"/g) || []).length, 4);
  assert.equal((html.match(/class="guide-tab-copy"/g) || []).length, 4);
  assert.equal((html.match(/class="guide-tab-mark"/g) || []).length, 4);
  assert.match(html, /class="guide-tabs" role="tablist"[^>]*aria-orientation="vertical"/);
  assert.match(html, /class="guide-header-meta" aria-hidden="true"[\s\S]*?<b>04<\/b> 任务章节/);
  assert.match(html, /class="guide-header-meta" aria-hidden="true"[\s\S]*?<b>43<\/b> 规则条目/);
  assert.match(html, /class="guide-header-meta" aria-hidden="true"[\s\S]*?关键 \/ 完整双层/);
  assert.doesNotMatch(html, /class="guide-footer-sync"/);
});

test('smallest portrait exposes the first numbered quick-start step without removing gameplay rules', () => {
  const quickstartBody = html.slice(
    html.indexOf('<section class="guide-quickstart"'),
    html.indexOf('<section class="guide-authority-matrix"')
  );
  assert.equal((quickstartBody.match(/<li>/g) || []).length, 5);
  assert.match(
    css,
    /@media \(max-width: 340px\) and \(max-height: 620px\) and \(orientation: portrait\)[\s\S]*?\.guide-quickstart > header \{ margin-bottom: 7px; \}[\s\S]*?\.guide-quickstart > header p \{ display: none; \}/
  );
});

test('decision-first and full layers preserve one read-only manual and one chapter authority', () => {
  const essentialBlock = runtime.match(
    /const guideEssentialFeatureIds = new Set\(\[([\s\S]*?)\]\);/
  )?.[1] ?? '';
  const essentialIds = [...essentialBlock.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  assert.equal(new Set(essentialIds).size, essentialIds.length, 'essential guide IDs must be unique');
  assert.equal(essentialIds.length, 16);
  for (const featureId of essentialIds) {
    assert.ok(requiredFeatureIds.includes(featureId), `${featureId} must belong to the 43-item player ledger`);
  }

  const panels = openingTags('section', 'data-guide-panel');
  for (const panel of panels) {
    const panelBody = html.slice(panel.index, nestedElementEnd(panel.index, 'section'));
    assert.equal(
      essentialIds.filter((featureId) => panelBody.includes(`data-guide-feature="${featureId}"`)).length,
      4,
      `${attribute(panel.tag, 'data-guide-panel')} needs four decision-first rules`
    );
  }

  assert.match(
    html,
    /<aside class="guide-context" id="guideContext"[^>]*aria-label="当前航程与阅读范围"[^>]*data-i18n-aria-label="guide\.context\.aria"/
  );
  assert.match(html, /id="guideContextCompact"[^>]*data-i18n-ignore/);
  assert.match(html, /class="guide-view-switch" role="group"[^>]*data-i18n-aria-label="guide\.view\.aria"/);
  const scopeButtons = openingTags('button', 'data-guide-view-option');
  assert.deepEqual(scopeButtons.map(({ tag }) => attribute(tag, 'data-guide-view-option')), ['essential', 'all']);
  assert.equal(scopeButtons.filter(({ tag }) => attribute(tag, 'aria-pressed') === 'true').length, 1);
  assert.match(html, /class="guide-quickstart"[\s\S]*?<ol>[\s\S]*?guide\.quickstart\.survive\.body/);
  assert.match(html, /class="guide-authority-matrix"[\s\S]*?guide\.authority\.mode\.fullBody/);
  assert.match(
    html,
    /class="guide-chapter-nav" role="group"[^>]*data-i18n-aria-label="guide\.footer\.navigationAria"/
  );
  for (const id of [
    'guidePreviousChapterBtn',
    'guideNextChapterBtn',
    'guideBackBtn'
  ]) {
    assert.match(html, new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*\\btype="button"`));
  }
  assert.match(html, /aria-label="关闭玩法详情并返回上一界面"/);
  assert.match(html, /id="guideBackBtn"[\s\S]*?返回上一界面<\/button>/);

  const viewFunction = runtime.match(
    /function applyGuideViewMode\([\s\S]*?\n  }\n\n  \/\*\* Capture one read-only/
  )?.[0] ?? '';
  assert.match(viewFunction, /feature\.hidden = nextMode === 'essential' && !essential/);
  assert.match(viewFunction, /feature\.dataset\.guidePriority = essential \? 'essential' : 'reference'/);
  assert.doesNotMatch(viewFunction, /\bstate\./, 'scope changes cannot mutate or consume gameplay state');

  const contextFunctions = runtime.match(
    /function captureGuideContextSnapshot\(\)[\s\S]*?\n  }\n\n  function selectGuideTab/
  )?.[0] ?? '';
  assert.match(contextFunctions, /state\.gameOver/);
  assert.match(contextFunctions, /state\.autoPilot/);
  assert.match(contextFunctions, /state\.manualThrottleMode/);
  assert.match(contextFunctions, /state\.cameraCinematicActive/);
  assert.match(contextFunctions, /guide\.context\.next\.film/);
  assert.doesNotMatch(contextFunctions, /guide\.context\.authority\.longitudinalFilm/);
  assert.match(contextFunctions, /guide\.context\.authority\.longitudinalAutopilot/);
  assert.match(contextFunctions, /guide\.context\.authority\.longitudinalFullThrottle/);
  assert.match(contextFunctions, /guideContextSnapshot \|\| captureGuideContextSnapshot\(\)/);
  assert.match(contextFunctions, /guide\.context\.compactValue/);
  assert.doesNotMatch(
    contextFunctions,
    /\bstate\.[A-Za-z0-9_]+\s*(?:=|\+\+|--|\+=|-=)/,
    'the manual snapshot must remain read-only'
  );
  assert.match(runtime, /guidePreviousChapterBtn\.addEventListener\('click'[\s\S]*?selectGuideTab\(guideTabs\[targetIndex\]\)/);
  assert.match(runtime, /guideNextChapterBtn\.addEventListener\('click'[\s\S]*?selectGuideTab\(guideTabs\[targetIndex\]\)/);
});

test('World chapter ships five self-contained decorative previews with distinct scene grammar', () => {
  const previews = [...html.matchAll(
    /<span class="world-swatch ([a-z]+)" aria-hidden="true" data-world-preview="([a-z-]+)">/g
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(previews, [
    ['realm', 'realm-pairing'],
    ['ecology', 'map-ecology'],
    ['landmark', 'world-landmarks'],
    ['bridge', 'covered-routes'],
    ['traffic', 'ambient-traffic']
  ]);

  // Each miniature has its own visual vocabulary, so a future cleanup cannot regress all five into generic gradients.
  for (const layer of [
    'world-realm-sun',
    'world-realm-cloud-left',
    'world-realm-ridge-near',
    'world-realm-road',
    'world-realm-route',
    'ecology-detail-wave',
    'ecology-detail-bloom',
    'ecology-detail-reed',
    'ecology-detail-ice',
    'ecology-detail-dune',
    'ecology-detail-ember',
    'world-ecology-road',
    'world-ecology-route',
    'world-landmark-moon',
    'world-landmark-temple',
    'world-landmark-manta',
    'world-landmark-dragon',
    'world-landmark-candles',
    'world-bridge-mountain',
    'world-bridge-deck',
    'world-bridge-portal-center',
    'world-bridge-road',
    'world-bridge-lights',
    'world-traffic-road',
    'world-traffic-ship-player',
    'world-traffic-ship-inbound-a',
    'world-traffic-ship-inbound-b',
    'world-traffic-flow'
  ]) {
    assert.match(html, new RegExp(`class="[^"]*\\b${layer}\\b`), `missing World preview layer ${layer}`);
    assert.match(css, new RegExp(`\\.${layer}(?:\\b|[\\s:{.#])`), `missing World preview styling ${layer}`);
  }

  assert.equal((html.match(/class="ecology-tile\b/g) || []).length, 6);
  const worldPreviewCss = css.slice(css.indexOf('.world-swatch {'), css.indexOf('.guide-footer {'));
  for (const biome of ['ocean', 'meadow', 'wetland', 'tundra', 'wasteland', 'eden']) {
    const tileRule = worldPreviewCss.match(
      new RegExp(`\\.ecology-tile-${biome}\\s*\\{([^}]+)\\}`)
    )?.[1] ?? '';
    assert.match(tileRule, /background:\s*#[0-9a-f]{6}\s*;/i, `${biome} needs one authored flat fill`);
    assert.doesNotMatch(tileRule, /gradient|url\s*\(/i, `${biome} texture belongs in its child detail layer`);
  }
  assert.doesNotMatch(worldPreviewCss, /url\s*\(/, 'World previews must remain local CSS/DOM artwork');
  assert.match(worldPreviewCss, /\.world-swatch\s*\{[\s\S]*?height:\s*68px;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.world-swatch\s*\{\s*height:\s*50px;/);
  assert.match(css, /@media \(max-height: 560px\)[\s\S]*?\.world-swatch\s*\{\s*height:\s*36px;/);
});

test('manual documents the cross-system contracts players need to make decisions', () => {
  // Authored HTML may keep concise placeholders when a stable data-i18n key owns the complete shipped copy.
  const playerGuideSource = `${html}\n${i18n}`;
  for (const concept of [
    /SPACE \/ 触控起飞可在平路、桥梁纵坡和实体跳台承载面上主动起飞/,
    /坡上起跳会保留当前坡面切向速度并叠加主动离地冲量/,
    /若不按 SPACE，跳台前仍需进入3挡并把接近速度建立到约 260 km\/h[\s\S]*?MT 用 E 手动升挡[\s\S]*?AT 则在满油门加速至 140 km\/h 时自动升入3挡/,
    /飞船会在坡唇按真实坡度和速度自然离地/,
    /只有这种坡唇自然腾空才获得道路中心左右各约 42 米的跨车道落地范围/,
    /主动起飞仍只使用当前路线护栏范围/,
    /空中操控仍在横移速度 10 米\/秒、横向加速度 17 米\/秒² 达到饱和/,
    /四种跳台已按约 260 km\/h 验证，可跨越约 24 米道路间距/,
    /船体必须完整落在当前路线、可选岔路或对向道路的真实承载面上/,
    /落入缝隙、道路外或路线接入失败会直接坠毁并结束本局/,
    /P 关闭时 M 满油门无目标上限；P 开启时领航拥有唯一纵向权威/,
    /P 关闭时 M 在 W 手动与持续满油门间切换；P 开启时领航统一调油、滑行和制动/,
    /1挡日常自然约 110 km\/h[\s\S]*?2挡自然约 160[\s\S]*?3挡是高速道路与跳台推进级[\s\S]*?自然约 280/,
    /1挡[\s\S]*?推荐 0–90[\s\S]*?达到 70 km\/h 可升2挡[\s\S]*?2挡[\s\S]*?不高于 125 km\/h 可降1挡[\s\S]*?达到 140 km\/h 可升3挡[\s\S]*?3挡[\s\S]*?不高于 190 km\/h 可降2挡/,
    /这些工作带不是硬限速/,
    /手动高挡低速会拖挡，加载转速与推进力一起下降；完全失速时推力归零，仪表会给出安全挡和 Q×N 次数/,
    /换挡会短暂断推力，不安全降挡会被拒绝/,
    /AT 覆盖三挡并禁用玩家 Q\/E：在 90 \/ 70 km\/h 间自动切换1、2挡，在 140 \/ 120 km\/h 间自动切换2、3挡/,
    /手动挡显示 Q \/ E 键并允许相邻换挡/,
    /自动挡覆盖三挡并接管换挡，隐藏桌面与触控 Q \/ E 手动键以回收布局空间，同时继续显示当前挡、自动阈值和三挡工作带/,
    /P 的 120 km\/h 普通巡航通常保持2挡[\s\S]*?P 关闭且 M 开启时持续满油门没有目标上限，可自动升至3挡/,
    /P 统一负责选路、转向、调油、滑行与制动/,
    /M 只保存退出 P 后的偏好/,
    /只要 P 开启，障碍、弯道和道路边界制动都由同一领航纵向权威处理，与 M 偏好无关/,
    /C 只切换追尾、近距、俯视和车头四种驾驶视角/,
    /F 或界面的“电影”键只启动镜头导演/,
    /P 关闭时仍由你手动驾驶/,
    /P 开启时才由领航驾驶/,
    /电影模式不读取或改写 P、M、T、MT \/ AT/,
    /MT 下 Q \/ E 手动键继续显示并可用，AT 下这些键继续隐藏且由自动箱接管/,
    /电影中仍可随时切换 P、M、T 与挡位/,
    /退出返回原驾驶视角/,
    /主 HUD 每秒更新一次实际渲染帧率/,
    /只显示性能，不改变游戏速度/,
    /“光影 开 \/ 关”可随时停用真实灯光、HDR 环境反射与投影阴影/,
    /保留无投影阴影的均匀底光和轻微接地提示/,
    /切换只改变画面与渲染开销，不修改速度、路线、碰撞、生命或领航/,
    /开始页可先选择画质；飞行中按 O \/ Esc 暂停后也能切换/,
    /低和中画质保留原有直接渲染、全段常亮的隧道灯罩与扩散片/,
    /不扫描、不选择也不预热动态隧道或桥底聚光，局部阴影开销为零/,
    /高画质[^。]*独享六盏原生动态聚光、两盏局部阴影/,
    /高画质地貌的颗粒和明暗斑块锁定绝对世界坐标/,
    /飞船前进时会相对向后掠过，不会粘住镜头/,
    /道路、障碍、可视距离、碰撞、速度与本局进度保持不变/,
    /120 是 P 的普通巡航参考，不是 M 满油门的速度上限/,
    /显示 MT \/ AT、当前挡精确换挡条件与三挡推荐工作带/,
    /指针、蓝色进度带与数字始终显示真实速度/,
    /四入口、十二条路线/,
    /地图会按场景切换路线细节、立交总览和分流引导/,
    /金白实线是已选路线，金色虚线是候选路线/,
    /红色是障碍，蓝色是烛光/,
    /优先看顶部下一指令和距分流数值/,
    /未选支路上的障碍和烛光仍留在原路/,
    /不会因选路瞬间消失/,
    /本局累计收集越多，后续单份奖励越高/,
    /漏掉烛光或间隔一段时间不会清零/,
    /每份烛光都会继续提升成长仪表/,
    /飞船颜色由暖金渐变至紫青/,
    /横向操控、推进核心转速上限与升转速度/,
    /不直接增加纵向最高速度或碰撞能力/,
    /玩家与领航共用烛光强化后的横向操控与推进核心/,
    /不会强制降速/,
    /若未落在任一真实道路上，则属于坠毁并立即结束本局/,
    /贴地驾驶不能直接横穿中央隔离区/,
    /接入平顺跨线回程并跳过当前互通/,
    /天空与地面一一对应/,
    /所有环境生物只提供世界氛围，不参与玩家速度、路线或碰撞权威/,
    /普通天气通常至少稳定 60 秒/,
    /形成和消散至少 12 秒/,
    /降雨、降雪、暴雨、暴雪和冰雹会连续加强中低层/,
    /压低云底/,
    /道路与桥面安全高度之上/,
    /进入镜头中央视线或贴近相机的云叶会平滑退让/,
    /外围云幕密度保持不变/,
    /无降水版、雨雪风暴版或混合版/,
    /约束整局天气目标与预报/,
    /露天路面会随天气逐步形成积水、积雪、雪泥或积尘/,
    /隧道内保持干燥/,
    /高速时要提前留出转向与制动余量/,
    /飞船压过露天积水会产生涟漪、水花与尾流/,
    /压过积雪会留下双沟和雪粉/,
    /给手动和领航施加相同、有限的阻力与侧滑/,
    /不改路线、碰撞或生命/,
    /按世界坐标掠过飞船/,
    /普通高架桥下只遮住近处雨线/,
    /桥外雨幕继续存在/,
    /户外天气状态不会停止/,
    /太阳、月亮与雷电是真实投影光源/,
    /太阳始终是露天最主要、最亮的光源/,
    /道路之外的地貌与景物也接收真实投影阴影/,
    /所有画质都让整段灯罩和扩散片始终可见发亮/,
    /低和中画质不扫描、不选择也不预热任何动态隧道或桥底聚光/,
    /只有高画质启用六盏复用聚光，其中两盏投影阴影/,
    /不得改变全档灯罩、扩散片和静态基础照度的固定常亮状态/,
    /普通开放桥下保留天空与 HDR 能量，由实体桥面自然投影，不再误按深隧道压黑/,
    /封闭隧道还会沿洞门连续移除室外暴雪、浓雾与沙尘造成的能见度衰减/,
    /深处恢复当前境界的正常基础雾距/,
    /飞船的引擎、烛芯和警示采用可见自发光材质/,
    /1K \/ 2K \/ 8K 主太阳阴影随低 \/ 中 \/ 高画质切换/,
    /高画质在设备不支持时安全回退 4K/,
    /局部阴影目标只由高画质分配/,
    /真实积水、积雪与雪泥接触会对手动和领航施加相同的额外阻力/,
    /S \/ ↓ 与领航共用约 7\.5 米\/秒² 的真实制动能力/,
    /恶劣地表的稳定速度可能低于干地/,
    /路线、障碍、碰撞和生命始终不被天气模块改写/
  ]) {
    assert.match(playerGuideSource, concept);
  }
  assert.doesNotMatch(html, /259 km\/h|手动 52|自动 52/);
  assert.doesNotMatch(i18n, /259 km\/h|Manual 52|Auto 52|AUTO 52|手动 52|自动 52/);
  // The release lease owns static HTML during concurrent work, so these updated player-facing contracts
  // are verified at the runtime translation source that replaces the legacy authored guide copy.
  for (const concept of [
    /With P off, M switches between manual W and continuous full throttle; full throttle does not track 120 km\/h/,
    /With P on, Autopilot alone commands throttle, coast, and braking/,
    /Gear 1 naturally settles near 110 km\/h[\s\S]*?Gear 2 near 160[\s\S]*?Gear 3 near 280/,
    /G1 · REC 0–90 · E→2 ≥70[\s\S]*?G2 · REC 70–140 · Q→1 ≤125 · E→3 ≥140[\s\S]*?G3 · REC 140–280 · Q→2 ≤190/,
    /They are not hard caps/,
    /a slow high gear lugs and can stall to zero thrust/i,
    /STALLED · Q×\{count\}→G\{gear\}/,
    /Shifting briefly interrupts thrust, and unsafe shifts are rejected/i,
    /AT owns shifting, disables Q\/E, and covers all three gears: 1→2 at 90 km\/h, 2→1 at 70, 2→3 at 140, and 3→2 at 120/,
    /P’s ordinary 120 km\/h cruise normally stays in Gear 2[\s\S]*?uncapped full throttle with P off can automatically reach Gear 3/,
    /十二首逐曲授权的无人声配乐按六境真实内涵组成两章/,
    /随境模式只在当前地图切换叙事章节/,
    /刹车、转向、领航、自动油门、视角、光影、暂停与重启各有独立提示/,
    /雷暴按远近发出雷声/,
    /雨、风雪、冰雹与沙尘会随露天强度连续变化/,
    /普通高架下雨声保持/,
    /山体廊道与地下隧道仍能听到压暗、变远的外部雨声/,
    /不会完全消失/,
    /C 只切换追尾、近距、俯视和车头四种驾驶视角/,
    /地图会按场景切换路线细节、立交总览和分流引导/,
    /露天路面会随天气逐步形成积水、积雪、雪泥或积尘/,
    /飞船压过露天积水会产生涟漪、水花与尾流/,
    /C cycles only the four driving views/,
    /F or Film starts the camera director/,
    /Film never reads or writes P, M, T, MT \/ AT, steering, throttle, braking, jumping, gear, speed, route, or score/,
    /Q \/ E remain visible and usable in MT; in AT those manual controls remain hidden while the automatic transmission owns shifting/,
    /With P off the player stays in manual control/,
    /with P on Autopilot remains the driver/,
    /P, M, T, and shifting can still be changed during Film/,
    /one of three stylish read-only reels/,
    /driving state never selects a shot or stops its clock/,
    /Reduced Motion holds one stable composition/,
    /Ordinary contact costs no life during Film/,
    /the safety layer does not steer, brake, or shift for the player/,
    /exit restores the prior driving view/,
    /The map switches among route detail, interchange overview, and split guidance/,
    /Exposed roads gradually develop standing water, snow, slush, or dust/,
    /Crossing exposed standing water creates ripples, spray, and wake/
  ]) {
    assert.match(i18n, concept);
  }
  assert.match(runtime, /branchCommitDeletesUnselectedEntities: false/);
  assert.match(runtime, /function preserveTrafficAfterGraphCommit\(/);
});

test('manual keeps the v10 High-only dynamic tunnel-light contract synchronized in both languages', () => {
  for (const concept of [
    /山体廊道与地下隧道沿各自完整路线独立密排灯具/,
    /所有画质都让整段灯罩和扩散片始终可见发亮/,
    /道路、连续墙顶与肋架灯壳在原绘制批次内接收无距离门控的静态基础照度/,
    /结构壳、侧墙和道路本身仍不自发光/,
    /低和中画质不扫描、不选择也不预热任何动态隧道或桥底聚光/,
    /六个聚光槽全部隐藏且局部阴影开销为零/,
    /只有高画质启用六盏复用聚光，其中两盏投影阴影/,
    /动态隧道灯只选择路线边与隧道剖面同时匹配的原生发射记录/,
    /电影模式则完成摄影机最近灯组的平滑交接/,
    /不得改变全档灯罩、扩散片和静态基础照度的固定常亮状态/,
    /找不到匹配记录时保持关闭，绝不生成跟随飞船的兜底灯/,
    /仅高画质的匹配聚光在真实灯具下形成有限光池并投影阴影/,
    /远处、相邻路线或错误剖面不会串光/,
    /局部阴影目标只由高画质分配/
  ]) {
    assert.match(html, concept);
  }
  assert.doesNotMatch(html, /桥底灯与隧道顶灯是真实投影光源/);

  for (const concept of [
    /所有画质都让整段灯罩和扩散片始终可见发亮/,
    /低和中画质不扫描、不选择也不预热任何动态隧道或桥底聚光/,
    /只有高画质启用六盏复用聚光，其中两盏投影阴影/,
    /动态隧道灯只选择路线边与隧道剖面同时匹配的原生发射记录/,
    /局部阴影目标只由高画质分配/,
    /找不到匹配记录时保持关闭，绝不生成跟随飞船的兜底灯/,
    /Every quality tier keeps every cover and diffuser visibly lit for the full span/,
    /distance-independent static base irradiance/,
    /Low and Medium do not scan, select, or prewarm any dynamic tunnel or under-bridge spots/,
    /all six spot slots stay hidden and local-shadow cost is zero/,
    /Only High enables the six pooled spots and two shadow casters/,
    /dynamic tunnel lights select only authored emitter records whose edge and profile both match/,
    /Film smoothly hands off to the camera-nearest exact group/,
    /cannot change the constant-on state of the all-tier covers, diffusers, or static base irradiance/,
    /A missing match stays off and never creates a craft-following fallback/,
    /Only High-quality matched spots create finite light pools and cast shadows beneath real fixtures/,
    /only High allocates local-shadow targets/
  ]) {
    assert.match(i18n, concept);
  }
});

test('mobile cockpit disclosure and glance labels remain complete in both language catalogs', () => {
  const mobileKeys = [
    'hud.mobile.telemetryRegion',
    'hud.mobile.telemetry',
    'hud.mobile.navigation',
    'hud.mobile.glanceAria',
    'hud.mobile.speed',
    'hud.mobile.controlDockAria',
    'hud.mobile.touchControlsAria',
    'hud.mobile.telemetry.expandAria',
    'hud.mobile.telemetry.collapseAria',
    'hud.mobile.navigation.expandAria',
    'hud.mobile.navigation.collapseAria'
  ];
  for (const key of mobileKeys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.equal(
      (i18n.match(new RegExp(`'${escapedKey}':`, 'g')) || []).length,
      2,
      `${key} must exist once in Chinese and once in English`
    );
  }

  assert.match(html, /id="hudPrimaryRegionTitle"[^>]*data-i18n="hud\.mobile\.telemetryRegion"/);
  assert.match(html, /id="mobileGlanceStrip"[^>]*data-i18n-aria-label="hud\.mobile\.glanceAria"/);
  assert.match(html, /id="controlDock"[^>]*data-i18n-aria-label="hud\.mobile\.controlDockAria"/);
  assert.match(html, /id="controls"[^>]*data-i18n-aria-label="hud\.mobile\.touchControlsAria"/);
  for (const key of [
    'hud.mobile.telemetry.collapseAria',
    'hud.mobile.telemetry.expandAria',
    'hud.mobile.navigation.collapseAria',
    'hud.mobile.navigation.expandAria'
  ]) {
    assert.match(runtime, new RegExp(`'${key.replace(/\./g, '\\.')}'`));
  }
});

test('guide disclosure state and chapter scroll reset stay synchronized in the runtime', () => {
  assert.match(html, /id="guideBtn"[^>]*aria-expanded="false"/);
  assert.match(runtime, /guideBtn\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(runtime, /guideBtn\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(runtime, /guidePanelsContainer\.scrollTop = 0/);
  assert.match(runtime, /function syncGuideTabListOrientation\(\)[\s\S]*?setAttribute\('aria-orientation', orientation\)/);
  assert.match(runtime, /const selectedTab = guideTabs\.find[\s\S]*?selectedTab\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(runtime, /orientation === 'horizontal'[\s\S]*?\['ArrowLeft', 'ArrowRight'\][\s\S]*?\['ArrowUp', 'ArrowDown'\]/);
  assert.match(runtime, /if \(isGuideOpen\(\)\) \{[\s\S]*?closeGuide\(\)/);
});
