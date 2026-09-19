const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(
  PROJECT_ROOT,
  'src/ui/Neon_Autopilot_HighSpeed_DroneHeat.i18n.js'
);
const HTML_PATH = path.join(
  PROJECT_ROOT,
  'Neon_Autopilot_HighSpeed_DroneHeat.html'
);
const PRESENTATION_METADATA_PATHS = Object.freeze([
  'src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js',
  'src/weather/Neon_Autopilot_HighSpeed_DroneHeat.weather.js',
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-library.js'
]);
const library = require(MODULE_PATH);

class FakeText {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.childNodes = [];
    this.parentNode = null;
    this.parentElement = null;
  }
}

class FakeElement {
  constructor(tagName = 'div', attributes = {}, text = null) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.childNodes = [];
    this.parentNode = null;
    this.parentElement = null;
    this.listeners = new Map();
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
    if (text !== null) this.append(new FakeText(text));
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      node.parentElement = node.nodeType === 1 ? this : this;
      this.childNodes.push(node);
    }
  }

  get textContent() {
    return this.childNodes.map((child) => (
      child.nodeType === 3 ? child.nodeValue : child.textContent
    )).join('');
  }

  set textContent(value) {
    const textNode = new FakeText(value);
    textNode.parentNode = this;
    textNode.parentElement = this;
    this.childNodes = [textNode];
  }

  setAttribute(name, value) {
    const normalizedName = String(name);
    this.attributes.set(normalizedName, String(value));
    if (normalizedName.startsWith('data-')) {
      const dataName = normalizedName
        .slice(5)
        .replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
      this.dataset[dataName] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  matches(selector) {
    if (selector === '*') return true;
    return selector.split(',').some((part) => {
      const match = part.trim().match(/^\[([A-Za-z0-9_-]+)\]$/u);
      return Boolean(match && this.hasAttribute(match[1]));
    });
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, currentTarget: this });
    }
  }
}

class FakeDocument {
  constructor(...children) {
    this.nodeType = 9;
    this.documentElement = new FakeElement('html');
    this.documentElement.append(...children);
    this.childNodes = [this.documentElement];
    this._title = '';
    this.titleWriteCount = 0;
  }

  get title() {
    return this._title;
  }

  set title(value) {
    this._title = String(value);
    this.titleWriteCount++;
  }

  querySelectorAll(selector) {
    const matches = [];
    if (this.documentElement.matches(selector)) matches.push(this.documentElement);
    matches.push(...this.documentElement.querySelectorAll(selector));
    return matches;
  }
}

function createScope(search = '') {
  const events = [];
  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  return {
    scope: {
      location: { search },
      CustomEvent: FakeCustomEvent,
      dispatchEvent(event) {
        events.push(event);
        return true;
      }
    },
    events
  };
}

function assertCatalogContract() {
  assert.equal(library.DEFAULT_LANGUAGE, 'zh-CN');
  assert.deepEqual(library.SUPPORTED_LANGUAGES, ['zh-CN', 'en']);
  assert.equal(library.STORAGE_KEY, 'cc-neon-ui-language');
  assert.equal(library.normalizeLanguage('zh'), 'zh-CN');
  assert.equal(library.normalizeLanguage('EN_us'), 'en');
  assert.equal(library.normalizeLanguage('fr'), null);

  const chinese = library.MESSAGES['zh-CN'];
  const english = library.MESSAGES.en;
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  assert.ok(Object.keys(chinese).length >= 600, 'The full Neon UI catalog must remain covered');
  assert.equal(Object.isFrozen(chinese), true);
  assert.equal(Object.isFrozen(english), true);
  for (const [key, value] of Object.entries(english)) {
    assert.doesNotMatch(value, /[\u3400-\u9fff]/u, `English message leaked Han text: ${key}`);
  }
  const chineseTermAllowlist = new Map([
    ['HUD', new Set(['guide.feature.viewFullscreen.body'])]
  ]);
  for (const term of ['HUD', 'PC Ultra', 'PBR', 'Bloom', 'Filmic', 'Sky Dawnflight', 'release-marker']) {
    for (const [key, value] of Object.entries(chinese)) {
      if (chineseTermAllowlist.get(term)?.has(key)) continue;
      assert.equal(value.includes(term), false, `Chinese message leaked ${term}: ${key}`);
    }
  }

  const requiredKeys = [
    'common.kilometers',
    'navigation.sign.distance',
    'direction.n.compact',
    'hud.hoodCollisionGuide.width',
    'hud.hoodCollisionGuide.dimensions',
    'hud.hoodCollisionGuide.projection',
    'hud.hoodCollisionGuide.range',
    'hud.propulsion.rpmAria',
    'hud.propulsion.help',
    'hud.propulsion.state.creep',
    'hud.propulsion.state.shifting',
    'hud.propulsion.state.braking',
    'gear.indicator',
    'gear.label',
    'gear.performanceLabel',
    'gear.indicatorAria',
    'gear.downAria',
    'gear.upAria',
    'gear.panelAria',
    'gear.mode.manual',
    'gear.mode.automatic',
    'gear.mode.manualShort',
    'gear.mode.automaticShort',
    'gear.mode.manualAria',
    'gear.mode.automaticAria',
    'gear.mode.mobileManualAria',
    'gear.mode.mobileAutomaticAria',
    'gear.rangeBandsAria',
    'gear.operatingRange.1',
    'gear.operatingRange.2',
    'gear.operatingRange.3',
    'gear.automaticRange.1',
    'gear.automaticRange.2',
    'gear.automaticRange.3',
    'gear.operatingRangeAria.1',
    'gear.operatingRangeAria.2',
    'gear.operatingRangeAria.3',
    'gear.automaticRangeAria.1',
    'gear.automaticRangeAria.2',
    'gear.automaticRangeAria.3',
    'gear.automaticLuggingLabel',
    'gear.automaticLuggingAria',
    'gear.automaticStalledLabel',
    'gear.automaticStalledAria',
    'gear.luggingLabel',
    'gear.luggingAria',
    'gear.stalledLabel.single',
    'gear.stalledLabel.multiple',
    'gear.stalledAria.single',
    'gear.stalledAria.multiple',
    'gear.alert.luggingTitle',
    'gear.alert.stalledTitle',
    'gear.alert.luggingMeta',
    'gear.alert.stalledMeta',
    'gear.shiftState.engaged',
    'gear.shiftState.shifting',
    'gear.shiftState.rejected',
    'gear.rejection.automatic',
    'gear.rejection.overspeed',
    'gear.rejection.underspeed',
    'gear.rejection.invalid-gear',
    'gear.rejection.shift-in-progress',
    'gear.rejectionShort.automatic',
    'gear.rejectionShort.overspeed',
    'gear.rejectionShort.underspeed',
    'gear.rejectionShort.invalid-gear',
    'gear.rejectionShort.shift-in-progress',
    'gear.help',
    'hud.propulsion.state.lugging',
    'hud.propulsion.state.stalled',
    'hud.damage.shield',
    'hud.damage.announcement',
    'hud.damage.depletedAnnouncement',
    'hud.cinematic',
    'cinematic.state.off',
    'cinematic.state.on',
    'cinematic.initialAria',
    'cinematic.buttonAria',
    'cinematic.enabledStatus',
    'cinematic.disabledStatus',
    'cinematic.shot.stable',
    'cinematic.shot.lowRear',
    'cinematic.shot.roadSkim',
    'cinematic.shot.wide',
    'cinematic.shot.telephoto',
    'cinematic.shot.side',
    'cinematic.shot.oppositeSide',
    'cinematic.shot.rearClose',
    'cinematic.shot.crane',
    'cinematic.shot.high',
    'cinematic.shot.front',
    'cinematic.shot.flyby',
    'cinematic.shot.centerReveal',
    'cinematic.shot.noseMount',
    'cinematic.shot.tailMount',
    'cinematic.shot.wingMount',
    'cinematic.shot.tunnelNoseMount',
    'cinematic.shot.tunnelWingMount',
    'cinematic.shot.tunnelTailMount',
    'cinematic.shot.tunnelEntrance',
    'cinematic.shot.tunnelCompression',
    'cinematic.shot.tunnelWallProfile',
    'cinematic.shot.tunnelAxialRush',
    'cinematic.shot.tunnelOppositeProfile',
    'cinematic.shot.tunnelExitReveal',
    'guide.shortcut.cinematic',
    'launch.action.pauseRestart',
    'launch.offRoadCrashStatus',
    'rating.radar.title',
    'rating.radar.note',
    'rating.radar.summary',
    'rating.radar.invalid',
    'update.source.releaseMarker',
    'update.source.modelDebug',
    'update.details.releaseMarker',
    'update.details.modelDebug'
  ];
  const startupLoadingBaseKeys = [
    'startup.loading.title',
    'startup.loading.modules',
    'startup.loading.world',
    'startup.loading.routes',
    'startup.loading.graphics',
    'startup.loading.firstFrame',
    'startup.loading.complete',
    'startup.loading.note',
    'startup.loading.progressAria'
  ];
  const startupLoadingTipIds = [
    'steering',
    'view',
    'ramps',
    'candlelight',
    'damage',
    'weather'
  ];
  const startupLoadingTipKeys = [
    'startup.loading.tipLabel',
    ...startupLoadingTipIds.map((tipId) => `startup.loading.tip.${tipId}`)
  ];
  const autopilotCommandKeys = [
    'autopilot.summaryAria',
    'autopilot.intent',
    'autopilot.intent.manualHold',
    'autopilot.intent.laneHold',
    'autopilot.intent.collectCandlelight',
    'autopilot.intent.routeChoice',
    'autopilot.intent.avoidThreat',
    'autopilot.risk.clear',
    'autopilot.risk.guarded',
    'autopilot.risk.elevated',
    'autopilot.risk.critical',
    'autopilot.riskMeterAria',
    'autopilot.risk.initialAria',
    'autopilot.risk.valueAria',
    'autopilot.lateralAuthority',
    'autopilot.longitudinalAuthority',
    'autopilot.brakeReason',
    'autopilot.nearestThreat',
    'autopilot.authority.manual',
    'autopilot.authority.autopilot',
    'autopilot.authority.manualTakeover',
    'autopilot.longitudinal.manual',
    'autopilot.longitudinal.cruise',
    'autopilot.longitudinal.fullThrottle',
    'autopilot.longitudinal.autopilot',
    'autopilot.brake.standby',
    'autopilot.brake.manual',
    'autopilot.brake.curve',
    'autopilot.brake.opposingBoundary',
    'autopilot.brake.obstacle',
    'autopilot.threat.none',
    'autopilot.threat.distanceTtc',
    'autopilot.authoritySummary.initial',
    'autopilot.authoritySummary.initialAria',
    'autopilot.authoritySummary.value',
    'autopilot.authoritySummary.valueAria',
    'autopilot.announcement.authority',
    'autopilot.announcement.brake'
  ];
  const controlAuthorityKeys = [
    'hud.throttle.fullThrottle',
    'hud.throttle.autopilotOwned',
    'hud.throttle.preferenceOn',
    'hud.throttle.preferenceOff',
    'hud.throttle.autopilotAria',
    'cinematic.buttonActiveAria',
    'cinematic.safetyStatus',
    'guide.context.authority.longitudinalFullThrottle',
    'guide.context.authority.longitudinalAutopilot',
    'guide.authority.throttle.fullThrottle',
    'guide.authority.throttle.preferenceOff',
    'guide.authority.throttle.preferenceOn',
    'launch.footer.target'
  ];
  const startupLoadingKeys = [...startupLoadingBaseKeys, ...startupLoadingTipKeys];
  requiredKeys.push(...startupLoadingKeys, ...autopilotCommandKeys, ...controlAuthorityKeys);
  for (const key of requiredKeys) {
    assert.ok(Object.hasOwn(chinese, key), `Missing Chinese key: ${key}`);
    assert.ok(Object.hasOwn(english, key), `Missing English key: ${key}`);
  }
  assert.deepEqual(
    Object.keys(chinese).filter((key) => key.startsWith('startup.loading.')).sort(),
    [...startupLoadingKeys].sort(),
    'Startup loading must expose only the nine readiness keys and seven tip keys'
  );
  assert.deepEqual(
    startupLoadingBaseKeys.map((key) => chinese[key]),
    [
      '正在准备天际航线',
      '正在载入飞行系统与场景模块……',
      '正在装配飞船、世界与驾驶界面……',
      '正在铺设首段道路与前方航线……',
      '道路已就绪，正在准备光影与材质……',
      '正在检查图形环境与首帧……',
      '准备完成',
      '加载完成后，开始界面中的“点火启航”会立即可用。',
      '启动准备进度'
    ]
  );
  assert.deepEqual(
    startupLoadingBaseKeys.map((key) => english[key]),
    [
      'Preparing the sky route',
      'Loading flight systems and scene modules…',
      'Assembling the craft, world, and flight deck…',
      'Building the opening road and route ahead…',
      'Roads ready; preparing lighting and materials…',
      'Checking the graphics environment and first frame…',
      'Ready',
      'When loading finishes, Start Flight will be immediately available.',
      'Startup preparation progress'
    ]
  );
  const chineseTipValues = startupLoadingTipKeys.map((key) => chinese[key]);
  const englishTipValues = startupLoadingTipKeys.map((key) => english[key]);
  assert.equal(new Set(chineseTipValues).size, startupLoadingTipKeys.length);
  assert.equal(new Set(englishTipValues).size, startupLoadingTipKeys.length);
  for (const [language, values] of [
    ['Chinese', chineseTipValues],
    ['English', englishTipValues]
  ]) {
    for (const value of values) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim(), `${language} startup tip copy must not be empty`);
      assert.doesNotMatch(value, /<[^>]+>|\{[^}]+\}/, `${language} startup tips must be plain copy`);
    }
  }
  for (const key of startupLoadingKeys) {
    assert.doesNotMatch(chinese[key], /\d+\s*%|预计.*(?:秒|分钟)/u, `${key} must not invent progress`);
    assert.doesNotMatch(english[key], /\d+\s*%|estimated?\s+\d+/iu, `${key} must not invent progress`);
  }
  assert.equal(chinese['guide.feature.launchAndRamps.title'], '主动起飞与3挡随机跳台');
  assert.match(chinese['guide.feature.launchAndRamps.body'], /SPACE \/ 触控起飞可在平路、桥梁纵坡和实体跳台承载面上主动起飞/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /坡上起跳会保留当前坡面切向速度并叠加主动离地冲量/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /MT 用 E 手动升挡[\s\S]*?AT 则在满油门加速至 140 km\/h 时自动升入3挡/);
  assert.match(chinese['guide.quickstart.ramp.body'], /约每小时 260 公里/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /接近速度建立到约 260 km\/h/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /飞船会在坡唇按真实坡度和速度自然离地/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /只有这种坡唇自然腾空才获得道路中心左右各约 42 米的跨车道落地范围/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /主动起飞仍只使用当前路线护栏范围/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /横移速度 10 米\/秒、横向加速度 17 米\/秒² 达到饱和/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /四种跳台已按约 260 km\/h 验证，可跨越约 24 米道路间距/);
  assert.match(chinese['guide.feature.launchAndRamps.body'], /落入缝隙、道路外或路线接入失败会直接坠毁/);
  assert.equal(chinese['navigation.launchFork'], '坡道岔路');
  assert.equal(chinese['navigation.aheadLaunch'], '主干 · 前方坡道岔路');
  assert.equal(english['guide.feature.launchAndRamps.title'], 'Manual launch and Gear 3 random ramps');
  assert.match(english['guide.feature.launchAndRamps.body'], /SPACE or touch launch works from flat roads, structural bridge grades, and the supported plane of a physical ramp/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /preserves the surface-tangent velocity and adds the deliberate separation impulse/i);
  assert.match(english['guide.quickstart.ramp.body'], /about 260 km\/h/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /needs Gear 3 and about 260 km\/h[\s\S]*?MT selects it with E[\s\S]*?AT selects it automatically[\s\S]*?140 km\/h/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /real lip then releases the craft from the authored grade and speed/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /Only that natural lip release receives the roughly 42-metre cross-road landing envelope/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /a deliberate launch retains the current route’s guardrail envelope/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /saturates at 10 m\/s lateral speed and 17 m\/s² lateral acceleration/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /four ramp variants are verified around 260 km\/h[\s\S]*?24-metre gap/i);
  assert.match(english['guide.feature.launchAndRamps.body'], /without a valid route handoff crashes immediately/i);
  assert.equal(chinese['guide.title'], '飞行手册');
  assert.equal(english['guide.title'], 'Flight Manual');
  assert.equal(chinese['guide.context.eyebrow'], '打开手册时快照');
  assert.equal(english['guide.context.eyebrow'], 'Snapshot on open');
  assert.equal(
    english['guide.context.compactInitial'],
    'Manual steering + Manual throttle · 0 km/h · 3 lives / 0 candlelight · Standby'
  );
  assert.equal(
    chinese['guide.context.compactValue']
      .replace('{authority}', '手动转向 · 手动油门')
      .replace('{speed}', '0 公里/小时')
      .replace('{lives}', '3')
      .replace('{candles}', '0')
      .replace('{brake}', '待命'),
    '手动转向 · 手动油门 · 0 公里/小时 · 3 条生命 · 0 份烛光 · 制动 待命'
  );
  assert.equal(
    english['guide.context.compactValue']
      .replace('{authority}', 'Manual steering · Manual throttle')
      .replace('{speed}', '0 km/h')
      .replace('{lives}', '3')
      .replace('{candles}', '0')
      .replace('{brake}', 'Standby'),
    'Manual steering · Manual throttle · 0 km/h · 3 lives · 0 candlelight · Brake Standby'
  );
  assert.match(chinese['guide.quickstart.speed.body'], /松 W[\s\S]*?切掉踏板额外推力[\s\S]*?贴地1挡[\s\S]*?约 8 km\/h[\s\S]*?S 可完全停车并压住怠速[\s\S]*?2\/3挡、换挡和腾空时没有蠕行力[\s\S]*?P 关闭[\s\S]*?持续满油门[\s\S]*?不会追踪 120[\s\S]*?P 开启[\s\S]*?领航统一调油、滑行与制动[\s\S]*?T[\s\S]*?MT \/ AT[\s\S]*?AT 接管 Q\/E[\s\S]*?90 升2[\s\S]*?70 降1[\s\S]*?140 升3[\s\S]*?120 降2/);
  assert.match(english['guide.quickstart.speed.body'], /Releasing W[\s\S]*?cuts excess pedal thrust[\s\S]*?Grounded Gear 1[\s\S]*?near 8 km\/h[\s\S]*?S can stop and hold it completely[\s\S]*?Gears 2\/3, shifts, and airborne motion receive no creep force[\s\S]*?P off[\s\S]*?continuous full throttle[\s\S]*?does not track 120 km\/h[\s\S]*?P on[\s\S]*?Autopilot alone commands throttle, coast, and braking[\s\S]*?T independently switches MT or AT[\s\S]*?AT disables Q\/E[\s\S]*?90 \/ 70[\s\S]*?140 \/ 120/i);
  assert.match(chinese['guide.feature.throttleModes.body'], /7\.5 米\/秒²[\s\S]*?T 独立切换 MT 手动挡与 AT 自动挡[\s\S]*?P 关闭[\s\S]*?持续满油门[\s\S]*?没有目标速度上限[\s\S]*?P 开启[\s\S]*?领航统一决定推进、滑行与制动[\s\S]*?110 km\/h[\s\S]*?0–90[\s\S]*?280 km\/h[\s\S]*?拖挡[\s\S]*?AT 覆盖三挡[\s\S]*?90 \/ 70 km\/h[\s\S]*?140 \/ 120 km\/h[\s\S]*?120 km\/h 普通巡航[\s\S]*?自动升至3挡/);
  assert.match(english['guide.feature.throttleModes.body'], /7\.5 m\/s²[\s\S]*?T independently switches MT or AT[\s\S]*?P off[\s\S]*?continuous full-throttle hold[\s\S]*?no target-speed cap[\s\S]*?P on[\s\S]*?Autopilot alone commands propulsion, coast, and braking[\s\S]*?M stores the post-P preference[\s\S]*?slow high gear lugs[\s\S]*?stall to zero thrust[\s\S]*?AT owns shifting[\s\S]*?all three gears[\s\S]*?1→2 at 90[\s\S]*?2→1 at 70[\s\S]*?2→3 at 140[\s\S]*?3→2 at 120[\s\S]*?120 km\/h cruise normally stays in Gear 2[\s\S]*?automatically reach Gear 3/i);
  assert.match(chinese['guide.feature.speedGuidance.body'], /P 领航[\s\S]*?120[\s\S]*?MT \/ AT[\s\S]*?0–90[\s\S]*?70–140[\s\S]*?140–280[\s\S]*?P 关闭且 M 开启时持续满油门[\s\S]*?不受 120 参考限制[\s\S]*?P 开启后领航统一调速[\s\S]*?拖挡[\s\S]*?7\.5 米\/秒²/);
  assert.match(english['guide.feature.speedGuidance.body'], /P Autopilot[\s\S]*?120 km\/h[\s\S]*?MT \/ AT[\s\S]*?three recommended working bands[\s\S]*?not hard caps[\s\S]*?110 km\/h[\s\S]*?160[\s\S]*?280[\s\S]*?P off and M on[\s\S]*?stays fully pressed[\s\S]*?ignores the 120 reference[\s\S]*?P on[\s\S]*?Autopilot alone regulates speed[\s\S]*?lugs[\s\S]*?all three gears[\s\S]*?90 and 140 km\/h[\s\S]*?70 and 120[\s\S]*?7\.5 m\/s²/i);
  assert.match(chinese['guide.feature.throttleModes.body'], /贴地1挡[\s\S]*?约 8 km\/h[\s\S]*?S 能完全停车并压住怠速[\s\S]*?2\/3挡、换挡或腾空时[\s\S]*?没有隐藏推力[\s\S]*?推进核心余转与尾焰随后自然衰减[\s\S]*?不会首帧骤缩/);
  assert.match(english['guide.feature.throttleModes.body'], /grounded Gear 1[\s\S]*?near 8 km\/h[\s\S]*?S can stop and hold it completely[\s\S]*?Gears 2\/3, during shifts, or while airborne[\s\S]*?no hidden force[\s\S]*?Authoritative core rotation and exhaust then decay naturally[\s\S]*?instead of the flame collapsing on the release frame/i);
  assert.match(chinese['guide.feature.speedGuidance.body'], /贴地1挡[\s\S]*?约 8 km\/h[\s\S]*?S 可完全停住[\s\S]*?2\/3挡没有隐藏蠕行/);
  assert.match(english['guide.feature.speedGuidance.body'], /grounded Gear 1[\s\S]*?about 8 km\/h[\s\S]*?S stops it completely[\s\S]*?Gears 2\/3 receive no hidden creep/i);
  assert.match(chinese['hud.propulsion.help'], /1挡怠速扭矩[\s\S]*?尾焰[\s\S]*?权威核心余转[\s\S]*?自然残焰[\s\S]*?不会根据按键或速度反推/);
  assert.match(english['hud.propulsion.help'], /first-gear idle torque[\s\S]*?Exhaust[\s\S]*?authoritative residual core rotation[\s\S]*?natural afterglow[\s\S]*?never keys or speed/i);
  assert.match(chinese['launch.summary'], /松开 W[\s\S]*?贴地1挡[\s\S]*?真实怠速缓慢蠕行[\s\S]*?S 可完全停住/);
  assert.match(english['launch.summary'], /Releasing W[\s\S]*?grounded Gear 1 creeps like a car on real idle torque[\s\S]*?S still stops it completely/i);
  assert.match(chinese['hint.main'], /贴地1挡像汽车一样以真实怠速缓慢蠕行[\s\S]*?S 可完全停住[\s\S]*?推进核心与尾焰会按余转自然衰减/);
  assert.match(english['hint.main'], /grounded Gear 1 creeps like a car on real idle torque[\s\S]*?S stops it completely[\s\S]*?core rotation lets the exhaust decay naturally/i);
  assert.equal(chinese['navigation.brakeManual'], '手动 7.5');
  assert.equal(chinese['navigation.brakeAutomatic'], '自动 7.5');
  assert.equal(english['navigation.brakeManual'], 'Manual 7.5');
  assert.equal(english['navigation.brakeAutomatic'], 'Auto 7.5');
  assert.equal(chinese['gear.label'].replace('{gear}', '2'), '2挡');
  assert.equal(chinese['gear.performanceLabel'].replace('{gear}', '3'), '3挡 · 高速/跳台');
  assert.equal(english['gear.label'].replace('{gear}', '2'), 'Gear 2');
  assert.equal(english['gear.performanceLabel'].replace('{gear}', '3'), 'Gear 3 · High/Ramp');
  assert.equal(chinese['gear.mode.manual'], 'MT 手动');
  assert.equal(chinese['gear.mode.automatic'], 'AT 自动');
  assert.equal(english['gear.mode.manual'], 'MT Manual');
  assert.equal(english['gear.mode.automatic'], 'AT Automatic');
  assert.match(chinese['gear.help'], /T 独立切换[\s\S]*?M 是满油门保持偏好[\s\S]*?P 关闭[\s\S]*?没有目标速度上限[\s\S]*?P 开启[\s\S]*?领航统一调油、滑行和制动[\s\S]*?手动挡显示 Q \/ E 键并允许相邻换挡[\s\S]*?高速道路与跳台推进级[\s\S]*?拖挡[\s\S]*?加载转速[\s\S]*?推力归零[\s\S]*?Q×N[\s\S]*?自动挡覆盖三挡并接管换挡[\s\S]*?隐藏桌面与触控 Q \/ E 手动键以回收布局空间[\s\S]*?继续显示当前挡、自动阈值和三挡工作带[\s\S]*?90[\s\S]*?70[\s\S]*?140[\s\S]*?120[\s\S]*?电影模式只切换镜头[\s\S]*?不改变 MT \/ AT[\s\S]*?手动键是否显示始终服从当前变速箱权限/);
  assert.match(english['gear.help'], /T switches[\s\S]*?M stores full-throttle hold[\s\S]*?P off[\s\S]*?100%[\s\S]*?no target-speed cap[\s\S]*?P on[\s\S]*?Autopilot alone commands throttle, coast, and braking[\s\S]*?Manual displays Q \/ E[\s\S]*?request adjacent gears[\s\S]*?high-performance road and ramp stage[\s\S]*?slow high gear lugs[\s\S]*?zero thrust[\s\S]*?Automatic owns all three gears and hides the desktop and touch Q \/ E controls to reclaim layout space[\s\S]*?retaining the live gear, exact automatic thresholds, and all three working bands[\s\S]*?1→2 at 90[\s\S]*?2→1 at 70[\s\S]*?2→3 at 140[\s\S]*?3→2 at 120[\s\S]*?Film mode changes only the camera[\s\S]*?manual-control visibility always follows the current MT \/ AT authority/i);
  assert.match(chinese['cinematic.enabledStatus'], /电影模式已开启[\s\S]*?MT 继续显示 Q \/ E[\s\S]*?AT 继续隐藏手动换挡键并自动接管/);
  assert.match(english['cinematic.enabledStatus'], /Film mode is on[\s\S]*?MT keeps Q \/ E visible[\s\S]*?AT keeps the manual shift controls hidden and owns shifting/i);
  assert.match(chinese['guide.feature.viewFullscreen.body'], /电影模式不读取或改写[\s\S]*?MT \/ AT[\s\S]*?MT 下 Q \/ E 手动键继续显示并可用[\s\S]*?AT 下这些键继续隐藏且由自动箱接管/);
  assert.match(english['guide.feature.viewFullscreen.body'], /Film never reads or writes[\s\S]*?MT \/ AT[\s\S]*?Q \/ E remain visible and usable in MT[\s\S]*?in AT those manual controls remain hidden while the automatic transmission owns shifting/i);
  assert.equal(chinese['gear.operatingRange.1'], '1挡 · 推荐 0–90 · E→2 ≥70');
  assert.equal(chinese['gear.operatingRange.2'], '2挡 · 推荐 70–140 · Q→1 ≤125 · E→3 ≥140');
  assert.equal(chinese['gear.operatingRange.3'], '3挡 · 推荐 140–280 · Q→2 ≤190');
  assert.equal(english['gear.operatingRange.1'], 'G1 · REC 0–90 · E→2 ≥70');
  assert.equal(english['gear.operatingRange.2'], 'G2 · REC 70–140 · Q→1 ≤125 · E→3 ≥140');
  assert.equal(english['gear.operatingRange.3'], 'G3 · REC 140–280 · Q→2 ≤190');
  assert.match(chinese['gear.automaticRange.1'], /≥90[\s\S]*?自动升2/);
  assert.match(chinese['gear.automaticRange.2'], /≤70降1[\s\S]*?≥140升3/);
  assert.match(chinese['gear.automaticRange.3'], /3挡[\s\S]*?≤120[\s\S]*?自动降2/);
  assert.match(english['gear.automaticRange.1'], /AUTO 1→2 ≥90/);
  assert.match(english['gear.automaticRange.2'], /≤70→G1[\s\S]*?≥140→G3/);
  assert.match(english['gear.automaticRange.3'], /G3[\s\S]*?AUTO 3→2 ≤120/);
  assert.equal(chinese['gear.automaticLuggingLabel'], '低转 · 待自动降至{gear}挡');
  assert.equal(english['gear.automaticLuggingLabel'], 'LOW RPM · AUTO→G{gear}');
  assert.equal(chinese['gear.automaticStalledLabel'], '失速 · 自动降至{gear}挡');
  assert.equal(english['gear.automaticStalledLabel'], 'STALLED · AUTO→G{gear}');
  assert.equal(chinese['gear.luggingLabel'], '拖挡 · Q→{gear}挡');
  assert.equal(english['gear.luggingLabel'], 'LUGGING · Q→G{gear}');
  assert.equal(chinese['gear.stalledLabel.single'], '完全失速 · Q→{gear}挡');
  assert.equal(chinese['gear.stalledLabel.multiple'], '完全失速 · Q×{count}→{gear}挡');
  assert.equal(english['gear.stalledLabel.single'], 'STALLED · Q→G{gear}');
  assert.equal(english['gear.stalledLabel.multiple'], 'STALLED · Q×{count}→G{gear}');
  assert.match(chinese['gear.stalledAria.single'], /推力归零[\s\S]*?Q[\s\S]*?{gear}挡/);
  assert.match(chinese['gear.stalledAria.multiple'], /推力归零[\s\S]*?Q[\s\S]*?{count}[\s\S]*?{gear}挡/);
  assert.match(english['gear.stalledAria.single'], /thrust is zero[\s\S]*?Q[\s\S]*?Gear {gear}/i);
  assert.match(english['gear.stalledAria.multiple'], /thrust is zero[\s\S]*?Q[\s\S]*?{count}[\s\S]*?Gear {gear}/i);
  assert.match(chinese['gear.alert.luggingMeta'], /推进受限[\s\S]*?转速/);
  assert.match(chinese['gear.alert.stalledMeta'], /推力归零[\s\S]*?立即降/);
  assert.match(english['gear.alert.luggingMeta'], /PROPULSION LIMITED[\s\S]*?RPM FALLING/);
  assert.match(english['gear.alert.stalledMeta'], /ZERO THRUST[\s\S]*?DOWNSHIFT NOW/);
  assert.equal(chinese['hud.propulsion.state.lugging'], '拖挡');
  assert.equal(english['hud.propulsion.state.lugging'], 'Lugging');
  assert.equal(chinese['hud.propulsion.state.creep'], '怠速蠕行');
  assert.equal(english['hud.propulsion.state.creep'], 'Idle creep');
  assert.equal(chinese['hud.propulsion.state.stalled'], '完全失速');
  assert.equal(english['hud.propulsion.state.stalled'], 'Stalled');
  assert.match(chinese['gear.rejection.automatic'], /自动挡接管换挡[\s\S]*?按 T[\s\S]*?手动挡[\s\S]*?Q\/E/);
  assert.match(english['gear.rejection.automatic'], /Automatic transmission owns shifting[\s\S]*?press T[\s\S]*?manual[\s\S]*?Q\/E/i);
  assert.equal(chinese['gear.rejection.invalid-gear'], '请求的挡位无效');
  assert.equal(english['gear.rejection.invalid-gear'], 'The requested gear is invalid');
  assert.equal(chinese['gear.rejection.shift-in-progress'], '当前换挡尚未完成');
  assert.equal(english['gear.rejection.shift-in-progress'], 'The current shift is still in progress');
  assert.deepEqual(
    [
      chinese['gear.rejectionShort.automatic'],
      chinese['gear.rejectionShort.overspeed'],
      chinese['gear.rejectionShort.underspeed'],
      chinese['gear.rejectionShort.invalid-gear'],
      chinese['gear.rejectionShort.shift-in-progress']
    ],
    ['自动接管', '速度过高', '速度不足', '挡位无效', '换挡中']
  );
  assert.deepEqual(
    [
      english['gear.rejectionShort.automatic'],
      english['gear.rejectionShort.overspeed'],
      english['gear.rejectionShort.underspeed'],
      english['gear.rejectionShort.invalid-gear'],
      english['gear.rejectionShort.shift-in-progress']
    ],
    ['Auto owns', 'Too fast', 'Too slow', 'Invalid', 'Busy']
  );
  assert.match(
    chinese['guide.feature.viewFullscreen.body'],
    /C 只切换[\s\S]*?F[\s\S]*?只启动镜头导演[\s\S]*?不读取或改写 P、M、T、MT \/ AT、方向、油门、刹车、跳跃、挡位、速度、路线或得分[\s\S]*?MT 下 Q \/ E 手动键继续显示并可用[\s\S]*?AT 下这些键继续隐藏且由自动箱接管[\s\S]*?P 关闭时仍由你手动驾驶[\s\S]*?P 开启时才由领航驾驶[\s\S]*?仍可随时切换 P、M、T 与挡位[\s\S]*?导演保持只读[\s\S]*?普通接触[\s\S]*?不会扣除生命[\s\S]*?不会替你转向、制动或换挡[\s\S]*?退出返回原驾驶视角/
  );
  assert.match(
    english['guide.feature.viewFullscreen.body'],
    /C cycles only the four driving views[\s\S]*?F or Film starts the camera director[\s\S]*?Film never reads or writes P, M, T, MT \/ AT, steering, throttle, braking, jumping, gear, speed, route, or score[\s\S]*?Q \/ E remain visible and usable in MT[\s\S]*?in AT those manual controls remain hidden while the automatic transmission owns shifting[\s\S]*?P off the player stays in manual control[\s\S]*?P on Autopilot remains the driver[\s\S]*?can still be changed during Film[\s\S]*?read-only reels[\s\S]*?Ordinary contact costs no life[\s\S]*?does not steer, brake, or shift for the player[\s\S]*?exit restores the prior driving view/i
  );
  assert.equal(chinese['hud.cinematic'], '电影');
  assert.equal(english['hud.cinematic'], 'Film');
  assert.equal(chinese['cinematic.state.off'], '关闭');
  assert.equal(chinese['cinematic.state.on'], '开启');
  assert.equal(english['cinematic.state.off'], 'Off');
  assert.equal(english['cinematic.state.on'], 'On');
  assert.equal(chinese['cinematic.initialAria'], '电影模式已关闭，点击开启');
  assert.equal(english['cinematic.initialAria'], 'Film mode is off. Activate to turn it on');
  assert.equal(
    chinese['cinematic.buttonAria'].replace('{state}', '开启'),
    '电影模式已开启，点击切换'
  );
  assert.equal(
    english['cinematic.buttonAria'].replace('{state}', 'On'),
    'Film mode is On. Press to toggle'
  );
  assert.deepEqual(
    [
      'stable',
      'lowRear',
      'roadSkim',
      'wide',
      'telephoto',
      'side',
      'oppositeSide',
      'rearClose',
      'crane',
      'high',
      'front',
      'flyby',
      'centerReveal',
      'noseMount',
      'tailMount',
      'wingMount',
      'tunnelNoseMount',
      'tunnelWingMount',
      'tunnelTailMount',
      'tunnelEntrance',
      'tunnelCompression',
      'tunnelWallProfile',
      'tunnelAxialRush',
      'tunnelOppositeProfile',
      'tunnelExitReveal'
    ].map((shotId) => chinese[`cinematic.shot.${shotId}`]),
    [
      '稳定构图',
      '低位后侧',
      '贴地追光',
      '宽幅巡航',
      '长焦跟拍',
      '右翼平行',
      '左翼平行',
      '近身追尾',
      '摇臂升空',
      '高位俯冲',
      '前侧回望',
      '高速穿越',
      '中轴揭幕',
      '船首挂载',
      '船尾挂载',
      '右翼尖挂载',
      '隧道船首挂载',
      '隧道翼根挂载',
      '隧道船尾挂载',
      '洞门切入',
      '隧道长焦压缩',
      '贴墙侧写',
      '隧道中轴推进',
      '对侧廊壁侧写',
      '出洞揭幕'
    ]
  );
  assert.equal(
    new Set([
      'stable',
      'lowRear',
      'roadSkim',
      'wide',
      'telephoto',
      'side',
      'oppositeSide',
      'rearClose',
      'crane',
      'high',
      'front',
      'flyby',
      'centerReveal',
      'noseMount',
      'tailMount',
      'wingMount',
      'tunnelNoseMount',
      'tunnelWingMount',
      'tunnelTailMount',
      'tunnelEntrance',
      'tunnelCompression',
      'tunnelWallProfile',
      'tunnelAxialRush',
      'tunnelOppositeProfile',
      'tunnelExitReveal'
    ].map((shotId) => english[`cinematic.shot.${shotId}`])).size,
    25,
    'Every film shot needs a distinct English diagnostic name'
  );
  assert.equal(
    chinese['guide.feature.routeMap.body'],
    '地图会按场景切换路线细节、立交总览和分流引导。金白实线是已选路线，金色虚线是候选路线，红色是障碍，蓝色是烛光；优先看顶部下一指令和距分流数值。'
  );
  assert.match(english['guide.feature.routeMap.body'], /Solid gold-white lines[\s\S]*?dashed gold lines[\s\S]*?distance-to-split/i);
  assert.equal(
    chinese['guide.feature.surfaceWeather.body'],
    '露天路面会随天气逐步形成积水、积雪、雪泥或积尘；隧道内保持干燥。水坑和积雪会改变接地反馈，因此高速时要提前留出转向与制动余量。'
  );
  assert.match(english['guide.feature.surfaceWeather.body'], /tunnels remain dry[\s\S]*?steering and braking margin/i);
  assert.equal(
    chinese['guide.feature.shipWeather.body'],
    '飞船压过露天积水会产生涟漪、水花与尾流，压过积雪会留下双沟和雪粉；这些接触会给手动和领航施加相同、有限的阻力与侧滑，但不改路线、碰撞或生命。'
  );
  assert.match(english['guide.feature.shipWeather.body'], /same bounded drag and lateral slip[\s\S]*?without changing route, collision, or lives/i);
  assert.equal(chinese['guide.footer.back'], '返回上一界面');
  assert.equal(english['guide.footer.back'], 'Return to previous screen');
  assert.match(chinese['guide.authority.brakeNote'], /只要 P 开启[\s\S]*?与 M 保存的偏好无关[\s\S]*?制动都会先把推进指令严格归零/);
  assert.match(english['guide.authority.brakeNote'], /Whenever P is on[\s\S]*?regardless of the saved M preference[\s\S]*?brake request zeros propulsion first/i);
  assert.equal(chinese['launch.footer.target'], 'P 领航调速 · M 满油门 · T 切 MT / AT');
  assert.equal(english['launch.footer.target'], 'P controls speed · M full throttle · T selects MT / AT');
  assert.equal(chinese['hud.throttle.fullThrottle'], '满油门');
  assert.equal(english['hud.throttle.fullThrottle'], 'Full throttle');
  assert.match(chinese['hud.throttle.autopilotAria'], /领航统一控制[\s\S]*?M 保存的偏好[\s\S]*?点击可切换退出领航后的偏好/);
  assert.match(english['hud.throttle.autopilotAria'], /Autopilot currently owns throttle[\s\S]*?saved M preference[\s\S]*?post-Autopilot preference/i);
  assert.match(chinese['guide.rule.scoreCandles'], /漏掉烛光或间隔一段时间不会清零/);
  assert.match(english['guide.rule.scoreCandles'], /missing one or waiting between pickups never resets/i);
  assert.match(chinese['guide.rule.candleHandling'], /不直接增加纵向最高速度或碰撞能力/);
  assert.match(english['guide.rule.candleHandling'], /does not directly raise longitudinal top speed or collision capability/i);
  assert.match(chinese['launch.offRoadCrashStatus'], /腾空 \{airTime\}.*真实道路.*立即结束/);
  assert.match(english['launch.offRoadCrashStatus'], /\{airTime\} airborne.*real road.*ends immediately/);
  assert.equal(english['navigation.launchFork'], 'Ramp fork');
  assert.equal(english['navigation.aheadLaunch'], 'Trunk · ramp fork ahead');
  assert.equal(chinese['hud.hoodCollisionGuide.label'], '真实碰撞边界');
  assert.equal(chinese['hud.hoodCollisionGuide.width'], '宽 {width} 米');
  assert.equal(chinese['hud.hoodCollisionGuide.dimensions'], '高 {height} · 长 {length} 米');
  assert.equal(chinese['hud.hoodCollisionGuide.projection'], '等尺寸前置 {distance} 米');
  assert.equal(english['hud.hoodCollisionGuide.label'], 'True collision envelope');
  assert.equal(english['hud.hoodCollisionGuide.width'], 'W {width} m');
  assert.equal(english['hud.hoodCollisionGuide.dimensions'], 'H {height} · L {length} m');
  assert.equal(english['hud.hoodCollisionGuide.projection'], 'Equal-size copy {distance} m ahead');
  assert.equal(chinese['hud.damage.shield'], '无敌护盾');
  assert.equal(
    chinese['hud.damage.announcement'],
    '受到撞击，剩余 {current} 条生命；无敌护盾保护 {seconds} 秒。'
  );
  assert.equal(chinese['hud.damage.depletedAnnouncement'], '受到撞击，生命耗尽。');
  assert.equal(english['hud.damage.shield'], 'Invulnerability shield');
  assert.equal(
    english['hud.damage.announcement'],
    'Collision. {current} lives remain; invulnerability shield active for {seconds} seconds.'
  );
  assert.equal(english['hud.damage.depletedAnnouncement'], 'Collision. No lives remain.');
  assert.equal(chinese['autopilot.authoritySummary.initialAria'], '横向手动，纵向手动，制动待命');
  assert.equal(
    chinese['autopilot.authoritySummary.value']
      .replace('{lateral}', '领航')
      .replace('{longitudinal}', '自动巡航')
      .replace('{brake}', '弯道自动制动'),
    '横向领航 · 纵向自动巡航 · 弯道自动制动'
  );
  assert.equal(
    chinese['autopilot.risk.valueAria']
      .replace('{level}', '警戒')
      .replace('{value}', '68'),
    '警戒，68%'
  );
  assert.equal(
    chinese['autopilot.threat.distanceTtc']
      .replace('{distance}', '42 米')
      .replace('{ttc}', '1.8'),
    '42 米 · TTC 1.8 秒'
  );
  assert.equal(
    english['autopilot.authoritySummary.initialAria'],
    'Lateral manual, longitudinal manual, brake standby'
  );
  assert.equal(
    english['autopilot.authoritySummary.value']
      .replace('{lateral}', 'Autopilot')
      .replace('{longitudinal}', 'Auto cruise')
      .replace('{brake}', 'Automatic curve braking'),
    'Lateral Autopilot · Longitudinal Auto cruise · Automatic curve braking'
  );
  assert.equal(
    english['autopilot.risk.valueAria']
      .replace('{level}', 'Elevated')
      .replace('{value}', '68'),
    'Elevated, 68%'
  );
  assert.equal(
    english['autopilot.threat.distanceTtc']
      .replace('{distance}', '42 m')
      .replace('{ttc}', '1.8'),
    '42 m · TTC 1.8 s'
  );
  assert.match(chinese['guide.rule.collisions'], /至少 1\.3 秒[\s\S]*?重复接触[\s\S]*?暂停/);
  assert.match(
    english['guide.rule.collisions'],
    /at least 1\.3 seconds[\s\S]*?repeated contact[\s\S]*?paus/i
  );
}

function assertLanguageResolutionAndTranslation() {
  let storageReads = 0;
  const storageWrites = [];
  const startup = {
    readString() {
      storageReads++;
      return 'en';
    },
    writeString(key, value) {
      storageWrites.push([key, value]);
      return true;
    }
  };

  const urlHost = createScope('?lang=zh-CN');
  const urlI18n = library.createI18n(urlHost.scope, {
    startup,
    autoApply: false,
    observe: false
  });
  assert.equal(urlI18n.language, 'zh-CN');
  assert.equal(storageReads, 0, 'An explicit URL override must not depend on storage');
  assert.deepEqual(
    ['A', 'D', 'W', 'SPACE', 'S', 'M', 'Q', 'E'].map((token) => urlI18n.translateSource(token)),
    ['A', 'D', 'W', 'SPACE', 'S', 'M', 'Q', 'E'],
    'Standalone key and instrument tokens must not inherit navigation Canvas semantics'
  );
  assert.equal(urlI18n.t('navigation.canvas.split'), '分');
  assert.equal(urlI18n.t('navigation.canvas.merge'), '合');

  const storedHost = createScope();
  const i18n = library.createI18n(storedHost.scope, {
    startup,
    autoApply: false,
    observe: false
  });
  assert.equal(i18n.language, 'en');
  assert.deepEqual(
    ['A', 'D', 'W', 'SPACE', 'S', 'M', 'Q', 'E'].map((token) => i18n.translateSource(token)),
    ['A', 'D', 'W', 'SPACE', 'S', 'M', 'Q', 'E']
  );
  assert.equal(i18n.t('navigation.canvas.split'), 'S');
  assert.equal(i18n.t('navigation.canvas.merge'), 'M');
  assert.equal(i18n.t('common.kilometers', { value: '18' }), '18 km');
  assert.equal(i18n.translate('navigation.sign.distance', { value: '620' }), '620 m');
  assert.equal(i18n.translateSource('前方限速'), 'Speed limit ahead');
  assert.equal(i18n.translateSource('前方 620 米', { distance: '620' }), '620 m ahead');
  assert.equal(i18n.t('hud.propulsion.label'), 'Propulsion core');
  assert.equal(
    i18n.t('hud.propulsion.rpmAria', { rpm: '12,000' }),
    'Propulsion core speed: 12,000 rpm'
  );
  assert.deepEqual(
    ['idle', 'creep', 'spooling', 'shifting', 'lugging', 'stalled', 'thrust', 'coast', 'braking'].map((state) => (
      i18n.t(`hud.propulsion.state.${state}`)
    )),
    ['Idle', 'Idle creep', 'Spooling', 'Shift torque cut', 'Lugging', 'Stalled', 'Thrust', 'Coast', 'Braking']
  );
  assert.equal(i18n.t('gear.luggingLabel', { gear: '1' }), 'LUGGING · Q→G1');
  assert.equal(
    i18n.t('gear.stalledLabel.multiple', { count: '2', gear: '1' }),
    'STALLED · Q×2→G1'
  );
  assert.equal(
    i18n.t('hud.damage.announcement', { current: '2', seconds: '1.3' }),
    'Collision. 2 lives remain; invulnerability shield active for 1.3 seconds.'
  );
  assert.equal(
    i18n.translateSource('当前{current}，下一天气{next}。', {
      current: 'clear',
      next: 'partly cloudy'
    }),
    'Current weather: clear. Next: partly cloudy.'
  );
  assert.equal(
    i18n.translateSource('HUD 的“光影 开 / 关”可随时停用真实灯光、HDR 环境反射与投影阴影；关闭后保留无投影阴影的均匀底光和轻微接地提示，让露天与隧道路面仍清楚可见。切换只改变画面与渲染开销，不修改速度、路线、碰撞、生命或领航。'),
    library.MESSAGES.en['guide.feature.lighting.body']
  );
  assert.equal(i18n.translate('unknown.key', {}, { fallback: 'Fallback' }), 'Fallback');
  assert.throws(() => i18n.translate('unknown.key', {}, { strict: true }), RangeError);
  assert.throws(() => i18n.translateSource('unknown source', {}, { strict: true }), RangeError);
  assert.equal(i18n.formatNumber(1_080), '1,080');

  i18n.setLanguage('zh-CN');
  assert.equal(i18n.t('direction.n.compact'), '北');
  assert.equal(i18n.t('hud.propulsion.label'), '推进核心');
  assert.equal(
    i18n.t('hud.propulsion.rpmAria', { rpm: '12,000' }),
    '推进核心转速 12,000 转/分'
  );
  assert.deepEqual(
    ['idle', 'creep', 'spooling', 'shifting', 'lugging', 'stalled', 'thrust', 'coast', 'braking'].map((state) => (
      i18n.t(`hud.propulsion.state.${state}`)
    )),
    ['待机', '怠速蠕行', '升转', '换挡断扭', '拖挡', '完全失速', '推进', '滑行', '制动']
  );
  assert.equal(i18n.t('gear.luggingLabel', { gear: '1' }), '拖挡 · Q→1挡');
  assert.equal(
    i18n.t('gear.stalledLabel.multiple', { count: '2', gear: '1' }),
    '完全失速 · Q×2→1挡'
  );
  assert.equal(
    i18n.t('hud.damage.announcement', { current: '2', seconds: '1.3' }),
    '受到撞击，剩余 2 条生命；无敌护盾保护 1.3 秒。'
  );
  assert.deepEqual(storageWrites.at(-1), [library.STORAGE_KEY, 'zh-CN']);

  const defaultI18n = library.createI18n(createScope('?lang=unsupported').scope, {
    startup: { readString: () => 'unsupported' },
    autoApply: false,
    observe: false
  });
  assert.equal(defaultI18n.language, 'zh-CN');
  assert.throws(() => defaultI18n.setLanguage('fr'), RangeError);
}

function assertStaticApplicationAndToggle() {
  const keyTrackerKeys = [
    ['left', 'A'],
    ['right', 'D'],
    ['throttle', 'W'],
    ['jump', 'SPACE'],
    ['brake', 'S']
  ].map(([control, label]) => new FakeElement('span', {
    'data-control-key': control
  }, label));
  const explicit = new FakeElement('button', {
    'data-i18n': 'launch.action.start',
    'data-i18n-attr': 'aria-label:launch.action.start;title=launch.summary'
  }, '点火启航');
  const parameterized = new FakeElement('span', {
    'data-i18n': 'common.kilometersPerHour',
    'data-i18n-params': '{"value":"1,080"}'
  }, '每小时 1,080 公里');
  const legacy = new FakeElement('section', {
    'aria-label': '当前追尾视角，按 C 切换视角'
  }, '天气预报');
  const toggle = new FakeElement('button', {
    'data-language-toggle': '',
    'data-language-compact': '',
    'data-language-source': 'launch-header'
  }, '英');
  const documentObject = new FakeDocument(
    explicit,
    parameterized,
    legacy,
    toggle,
    ...keyTrackerKeys
  );
  const writes = [];
  const host = createScope();
  const i18n = library.createI18n(host.scope, {
    document: documentObject,
    startup: {
      readString: () => null,
      writeString(key, value) {
        writes.push([key, value]);
        return true;
      }
    }
  });

  assert.equal(documentObject.title, library.MESSAGES['zh-CN']['document.title']);
  assert.equal(documentObject.documentElement.lang, 'zh-CN');
  assert.equal(documentObject.documentElement.dataset.language, 'zh-CN');
  assert.equal(explicit.textContent, '点火启航');
  assert.equal(parameterized.textContent, '1,080 公里/小时');
  assert.equal(toggle.textContent, '英');
  assert.equal(toggle.getAttribute('aria-label'), '切换为英文界面');
  assert.deepEqual(
    keyTrackerKeys.map((element) => element.textContent),
    ['A', 'D', 'W', 'SPACE', 'S']
  );

  const subscriberSnapshots = [];
  i18n.subscribe((detail) => {
    subscriberSnapshots.push({
      detail,
      text: explicit.textContent,
      language: documentObject.documentElement.lang
    });
  });
  toggle.dispatch('click');

  assert.equal(i18n.language, 'en');
  assert.equal(documentObject.title, library.MESSAGES.en['document.title']);
  assert.equal(documentObject.documentElement.lang, 'en');
  assert.equal(explicit.textContent, 'Ignite and launch');
  assert.equal(explicit.getAttribute('aria-label'), 'Ignite and launch');
  assert.equal(explicit.getAttribute('title'), library.MESSAGES.en['launch.summary']);
  assert.equal(parameterized.textContent, '1,080 km/h');
  assert.equal(legacy.textContent, 'Weather forecast');
  assert.equal(legacy.getAttribute('aria-label'), 'Current view: Chase. Press C to change view');
  assert.equal(toggle.textContent, 'ZH');
  assert.equal(toggle.getAttribute('aria-label'), 'Switch to the Chinese interface');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(toggle.dataset.language, 'en');
  assert.deepEqual(
    keyTrackerKeys.map((element) => element.textContent),
    ['A', 'D', 'W', 'SPACE', 'S']
  );
  assert.deepEqual(writes.at(-1), [library.STORAGE_KEY, 'en']);
  assert.equal(subscriberSnapshots[0].text, 'Ignite and launch');
  assert.equal(subscriberSnapshots[0].language, 'en');
  assert.equal(host.events.at(-1).type, library.LANGUAGE_CHANGE_EVENT);
  assert.deepEqual(host.events.at(-1).detail, {
    previousLanguage: 'zh-CN',
    language: 'en',
    source: 'launch-header'
  });

  i18n.setLanguage('zh-CN');
  assert.equal(legacy.textContent, '天气预报', 'WeakMap source authority must make switches reversible');
  assert.equal(legacy.getAttribute('aria-label'), '当前追尾视角，按 C 切换视角');
  assert.equal(toggle.textContent, '英');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(
    keyTrackerKeys.map((element) => element.textContent),
    ['A', 'D', 'W', 'SPACE', 'S'],
    'Physical key legends must remain language-neutral across reversible switches'
  );

  const failedStorageI18n = library.createI18n(createScope().scope, {
    autoApply: false,
    observe: false,
    startup: { writeString: () => false }
  });
  assert.equal(failedStorageI18n.setLanguage('en'), true);
  assert.equal(failedStorageI18n.language, 'en');
  assert.equal(failedStorageI18n.getDiagnostics().lastStorageWriteSucceeded, false);
}

function assertMutationApplication() {
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  const status = new FakeElement('div', {}, '待机');
  const documentObject = new FakeDocument(status);
  const host = createScope();
  host.scope.MutationObserver = FakeMutationObserver;
  const i18n = library.createI18n(host.scope, { document: documentObject });
  i18n.setLanguage('en', { persist: false });
  assert.equal(status.textContent, 'Idle');
  assert.equal(observers.length, 1);
  assert.equal(observers[0].options.characterData, true);

  const dynamic = new FakeElement('div', { 'aria-label': '起飞' }, '前方限速');
  documentObject.documentElement.append(dynamic);
  const titleWritesBeforeDynamicInsertion = documentObject.titleWriteCount;
  observers[0].callback([{
    type: 'childList',
    target: documentObject.documentElement,
    addedNodes: [dynamic]
  }]);
  assert.equal(dynamic.textContent, 'Speed limit ahead');
  assert.equal(dynamic.getAttribute('aria-label'), 'Launch');
  assert.equal(
    documentObject.titleWriteCount,
    titleWritesBeforeDynamicInsertion,
    'A local mutation must not rewrite <title> and recursively feed the document observer'
  );

  const dynamicText = dynamic.childNodes[0];
  dynamicText.nodeValue = '待机';
  observers[0].callback([{ type: 'characterData', target: dynamicText }]);
  assert.equal(dynamicText.nodeValue, 'Idle');
  const mutationCount = i18n.getDiagnostics().mutationApplyCount;
  observers[0].callback([{ type: 'characterData', target: dynamicText }]);
  assert.equal(
    i18n.getDiagnostics().mutationApplyCount,
    mutationCount,
    'Observer feedback from an owned translation must be ignored'
  );

  dynamic.setAttribute('aria-label', '地表接触：干燥');
  observers[0].callback([{
    type: 'attributes',
    target: dynamic,
    attributeName: 'aria-label'
  }]);
  assert.equal(dynamic.getAttribute('aria-label'), 'Surface contact: dry');

  assert.equal(i18n.disconnect(), true);
  assert.equal(observers[0].disconnected, true);
  assert.equal(i18n.disconnect(), false);
}

/** Load language-neutral data modules and prove every value written through translateSource has two complete faces. */
function assertPresentationMetadataCoverage() {
  const context = vm.createContext({ window: {} });
  for (const relativePath of PRESENTATION_METADATA_PATHS) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    vm.runInContext(fs.readFileSync(absolutePath, 'utf8'), context, { filename: absolutePath });
  }

  const sources = [];
  for (const profile of Object.values(context.window.NeonConfig.renderQualityProfiles)) {
    sources.push(profile.name, profile.description);
  }
  for (const zone of context.window.NeonConfig.zones) sources.push(zone.name);
  for (const mode of Object.values(context.window.NeonWeather.weatherModes)) {
    sources.push(mode.name, mode.description);
  }
  for (const type of Object.values(context.window.NeonWeather.types)) sources.push(type.name);
  for (const mode of Object.values(context.window.NeonMusicLibrary.PLAY_MODES)) {
    sources.push(mode.name, mode.description);
  }
  for (const track of context.window.NeonMusicLibrary.TRACKS) {
    sources.push(track.title, track.realmName, ...track.themeTags);
  }

  const english = library.createI18n(createScope('?lang=en').scope, {
    autoApply: false,
    observe: false
  });
  const chinese = library.createI18n(createScope('?lang=zh-CN').scope, {
    autoApply: false,
    observe: false
  });
  const untranslatedEnglish = [...new Set(sources.filter((value) => (
    /[\u3400-\u9fff]/u.test(english.translateSource(value))
  )))];
  const untranslatedChinese = [...new Set(sources.filter((value) => (
    /\b(?:HUD|PC Ultra|PBR|Bloom|Filmic|Sky Dawnflight|High-only)\b/u
      .test(chinese.translateSource(value))
  )))];

  assert.deepEqual(
    untranslatedEnglish,
    [],
    `Presentation metadata leaks Chinese in English mode: ${untranslatedEnglish.join(' | ')}`
  );
  assert.deepEqual(
    untranslatedChinese,
    [],
    `Presentation metadata leaks English UI terms in Chinese mode: ${untranslatedChinese.join(' | ')}`
  );
}

function assertShippedMarkupCoverage() {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.doesNotMatch(source, /\blocalStorage\b/u, 'Storage must stay behind NeonStartup');
  assert.doesNotMatch(source, /\binnerHTML\b/u, 'Translated UI must never parse HTML');

  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace(/<script\b[\s\S]*?<\/script>/giu, '')
    .replace(/<style\b[\s\S]*?<\/style>/giu, '');
  const authoredValues = [];
  for (const match of html.matchAll(/>([^<>]+)</gu)) {
    const value = match[1].trim();
    if (value) authoredValues.push(value);
  }
  for (const match of html.matchAll(
    /\b(?:aria-label|aria-valuetext|title|placeholder)="([^"]+)"/gu
  )) {
    authoredValues.push(match[1]);
  }

  const english = library.createI18n(createScope('?lang=en').scope, {
    autoApply: false,
    observe: false
  });
  const untranslatedChinese = [...new Set(authoredValues.filter((value) => (
    /[\u3400-\u9fff]/u.test(value)
      && /[\u3400-\u9fff]/u.test(english.translateSource(value))
  )))];
  assert.deepEqual(
    untranslatedChinese,
    [],
    `Shipped markup contains untranslated Chinese sources: ${untranslatedChinese.join(' | ')}`
  );
}

assertCatalogContract();
assertLanguageResolutionAndTranslation();
assertStaticApplicationAndToggle();
assertMutationApplication();
assertPresentationMetadataCoverage();
assertShippedMarkupCoverage();

console.log(JSON.stringify({
  ok: true,
  catalogKeys: Object.keys(library.MESSAGES['zh-CN']).length,
  reversibleDomSwitching: true,
  mutationCoverage: true,
  presentationMetadataCoverage: true,
  shippedMarkupCoverage: true
}));
