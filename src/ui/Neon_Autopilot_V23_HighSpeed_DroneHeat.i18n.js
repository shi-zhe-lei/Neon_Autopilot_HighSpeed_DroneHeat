/*
 * V23 bilingual UI authority / V23 双语界面权威。
 *
 * Stable gameplay IDs remain language-neutral. This module alone owns player-facing Chinese and English,
 * applies authored DOM bindings without HTML injection, and announces one synchronous post-apply event so
 * runtime-owned dynamic surfaces and Canvas labels can redraw from their existing state.
 */
(function bootstrapNeonV23I18n(browserWindow, factory) {
  'use strict';

  const library = factory();
  if (typeof module === 'object' && module.exports) module.exports = library;
  if (browserWindow?.document) {
    browserWindow.NeonV23I18n = library.createI18n(browserWindow);
  }
})(typeof window === 'object' ? window : null, () => {
  'use strict';

  const DEFAULT_LANGUAGE = 'zh-CN';
  const SUPPORTED_LANGUAGES = Object.freeze(['zh-CN', 'en']);
  const STORAGE_KEY = 'cc-v23-ui-language';
  const LANGUAGE_CHANGE_EVENT = 'neonv23:languagechange';
  const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
  const TEMPLATE_TOKEN_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  // A standalone physical key or instrument letter has no semantic translation context. Keep it literal during
  // legacy reverse lookup; map renderers that mean split/merge must request their stable catalog keys explicitly.
  const LANGUAGE_NEUTRAL_STANDALONE_TOKEN_PATTERN = /^(?:[A-Za-z]|SPACE)$/u;

  const ZH_CN = Object.freeze({
    'document.title': '霓虹自动领航 V23 · 天际晨航',
    'language.switch.visible': '英文',
    'language.switch.compact': '英',
    'language.switch.aria': '切换为英文界面',
    'language.name.current': '中文',

    'common.on': '开',
    'common.off': '关',
    'common.enabled': '开启',
    'common.disabled': '关闭',
    'common.unavailable': '不可用',
    'common.enter': '进入',
    'common.exit': '退出',
    'common.loading': '正在载入',
    'common.ready': '已准备',
    'common.waiting': '正在守候',
    'common.select': '选择',
    'common.playing': '播放中',
    'common.willPlay': '将播放',
    'common.none': '无',
    'common.manual': '手动',
    'common.automatic': '自动',
    'common.standby': '待命',
    'common.current': '当前',
    'common.next': '下一项',
    'common.stable': '稳定',
    'common.keepCurrent': '保持当前',
    'common.approxSeconds': '约 {value} 秒',
    'common.approxMinutes': '约 {value} 分钟',
    'common.meters': '{value} 米',
    'common.kilometers': '{value} 千米',
    'common.kilometersPerHour': '{value} 公里/小时',
    'common.framesPerSecond': '{value} 帧/秒',
    'common.hudMark': '界面',
    'common.fpsMark': '帧率',
    'common.effectsMark': '特效',

    'hud.sound': '声音',
    'hud.musicLibrary': '曲库',
    'hud.sound.openLibrary': '打开天空主题背景音乐库',
    'hud.sound.library': '曲库',
    'hud.sound.onAria': '声音已开启，点击关闭',
    'hud.sound.offAria': '声音已关闭，点击开启',
    'hud.sound.unsupportedAria': '当前浏览器不支持游戏声音',
    'hud.mobile.telemetryRegion': '飞行仪表',
    'hud.mobile.telemetry': '仪表',
    'hud.mobile.navigation': '地图',
    'hud.mobile.glanceAria': '关键飞行信息',
    'hud.mobile.flightDeckAria': '手机飞行仪表',
    'hud.mobile.speed': '速度',
    'hud.mobile.route': '航路',
    'hud.mobile.autopilotAria': '自动领航状态',
    'hud.mobile.utilitiesAria': '显示与声音工具',
    'hud.mobile.utilities.expandAria': '展开显示与声音工具',
    'hud.mobile.utilities.collapseAria': '收起显示与声音工具',
    'hud.mobile.controlDockAria': '飞行快捷操作',
    'hud.mobile.touchControlsAria': '触控驾驶',
    'hud.mobile.telemetry.expandAria': '展开详细飞行仪表',
    'hud.mobile.telemetry.collapseAria': '收起详细飞行仪表',
    'hud.mobile.navigation.expandAria': '展开航路地图与完整操作',
    'hud.mobile.navigation.collapseAria': '收起航路地图与完整操作',
    'hud.score': '得分',
    'hud.speedometer.label': '速度仪表',
    'hud.speedometer.target': '领航巡航',
    'hud.speedometer.launch': '起步',
    'hud.speedometer.cruise': '巡航',
    'hud.speedometer.high': '高速',
    'hud.speedometer.sprint': '冲刺',
    'hud.speedometer.targetReached': '达到巡航',
    'hud.speedometer.overTarget': '手动高速',
    'hud.speedometer.valueAria': '{speed} 公里/小时',
    'hud.speedometer.scaleHelp': '金色刻度标记 P 领航的 {target} 公里/小时普通巡航参考；P 关闭且 M 开启时持续满油门，不受该参考限制。1挡日常自然约每小时 110 公里，2挡约每小时 160 公里，3挡约每小时 280 公里；指针、蓝色进度带与数字始终显示真实速度。',
    'hud.speedometer.scaleHelpInitial': '金色刻度标记 P 领航的每小时 120 公里普通巡航参考；P 关闭且 M 开启时持续满油门，不受该参考限制。1挡日常自然约每小时 110 公里，2挡约每小时 160 公里，3挡约每小时 280 公里；指针、蓝色进度带与数字始终显示真实速度。',
    'gear.indicator': '挡位',
    'gear.initialLabel': '1挡',
    'gear.initialIndicatorAria': '推进挡位，当前1挡，已接合',
    'gear.label': '{gear}挡',
    'gear.performanceLabel': '{gear}挡 · 高速/跳台',
    'gear.indicatorAria': '推进挡位，当前{gear}挡，{state}',
    'gear.downAria': '降挡（Q）',
    'gear.upAria': '升挡（E）',
    'gear.panelAria': '变速箱模式与换挡范围',
    'gear.mode.manual': 'MT 手动',
    'gear.mode.automatic': 'AT 自动',
    'gear.mode.manualShort': 'MT 手动',
    'gear.mode.automaticShort': 'AT 自动',
    'gear.mode.manualAria': '手动变速箱已启用，按 T 切换自动挡',
    'gear.mode.automaticAria': '自动变速箱已启用，按 T 切换手动挡',
    'gear.mode.mobileManualAria': '手动变速箱已启用，轻触切换自动挡',
    'gear.mode.mobileAutomaticAria': '自动变速箱已启用，轻触切换手动挡',
    'gear.rangeBandsAria': '推荐工作带：1挡每小时0至90公里；2挡每小时70至140公里；3挡每小时140至280公里',
    'gear.operatingRange.1': '1挡 · 推荐 0–90 · E→2 ≥70',
    'gear.operatingRange.2': '2挡 · 推荐 70–140 · Q→1 ≤125 · E→3 ≥140',
    'gear.operatingRange.3': '3挡 · 推荐 140–280 · Q→2 ≤190',
    'gear.automaticRange.1': 'AT · 1挡 · ≥90 自动升2',
    'gear.automaticRange.2': 'AT · 2挡 · ≤70降1 · ≥140升3',
    'gear.automaticRange.3': 'AT · 3挡 · ≤120 自动降2',
    'gear.operatingRangeAria.1': '1挡，推荐每小时0至90公里；每小时70公里以上可升入2挡',
    'gear.operatingRangeAria.2': '2挡，推荐每小时70至140公里；每小时125公里以下可降入1挡，每小时140公里以上可升入3挡',
    'gear.operatingRangeAria.3': '3挡，推荐每小时140至280公里；每小时190公里以下可降入2挡',
    'gear.automaticRangeAria.1': '自动变速箱1挡；达到每小时90公里时自动升入2挡',
    'gear.automaticRangeAria.2': '自动变速箱2挡；降至每小时70公里时自动回1挡，达到每小时140公里时自动升入3挡',
    'gear.automaticRangeAria.3': '自动变速箱3挡；降至每小时120公里时自动回2挡',
    'gear.automaticLuggingLabel': '低转 · 待自动降至{gear}挡',
    'gear.automaticLuggingAria': '当前高挡进入低转速区，推进力受限；继续减速会自动降至{gear}挡',
    'gear.automaticStalledLabel': '失速 · 自动降至{gear}挡',
    'gear.automaticStalledAria': '当前高挡已经失速，推进力已断；自动变速箱正在降至{gear}挡',
    'gear.luggingLabel': '拖挡 · Q→{gear}挡',
    'gear.luggingAria': '当前高挡速度过低，推进力正在持续削减；按 Q 降至安全的{gear}挡',
    'gear.stalledLabel.single': '完全失速 · Q→{gear}挡',
    'gear.stalledLabel.multiple': '完全失速 · Q×{count}→{gear}挡',
    'gear.stalledAria.single': '当前挡位已完全失速，推力归零；立即按 Q 降至安全的{gear}挡',
    'gear.stalledAria.multiple': '当前挡位已完全失速，推力归零；立即按 Q {count}次降至安全的{gear}挡',
    'gear.alert.luggingTitle': '高挡拖挡',
    'gear.alert.stalledTitle': '高挡完全失速',
    'gear.alert.luggingMeta': '推进受限 · 转速正在下沉',
    'gear.alert.stalledMeta': '推力归零 · 立即降至安全挡',
    'gear.shiftState.engaged': '已接合',
    'gear.shiftState.shifting': '换挡中：{from}挡 → {to}挡',
    'gear.shiftState.rejected': '换挡被拒绝',
    'gear.rejection.automatic': '自动挡接管换挡；按 T 切换手动挡后才能使用 Q/E',
    'gear.rejection.overspeed': '当前速度过高，拒绝降挡',
    'gear.rejection.underspeed': '当前速度不足，拒绝升挡',
    'gear.rejection.invalid-gear': '请求的挡位无效',
    'gear.rejection.shift-in-progress': '当前换挡尚未完成',
    'gear.rejectionShort.automatic': '自动接管',
    'gear.rejectionShort.overspeed': '速度过高',
    'gear.rejectionShort.underspeed': '速度不足',
    'gear.rejectionShort.invalid-gear': '挡位无效',
    'gear.rejectionShort.shift-in-progress': '换挡中',
    'gear.help': 'T 独立切换手动挡与自动挡；M 是满油门保持偏好：P 关闭时开启 M 会持续踩满油门且没有目标速度上限，P 开启时则由领航统一调油、滑行和制动。松开油门会立即切掉踏板额外推力；贴地1挡保留真实怠速扭矩，在干燥平路缓慢趋近约每小时 8 公里，S 可完全停车并压住怠速，换挡、腾空和2/3挡都不会偷偷蠕行。手动挡显示 Q / E 键并允许相邻换挡：1挡推荐每小时 0–90 公里且达到 70 可升2挡；2挡推荐 70–140 且不高于 125 可降1挡、达到 140 可升3挡；3挡是高速道路与跳台推进级，推荐 140–280 且不高于 190 可降2挡。这些是工作建议而非速度上限。手动高挡低速会拖挡，加载转速与推进力一起下降；完全失速时推力归零，仪表会给出安全挡和 Q×N 次数，必须照提示连续降挡。自动挡覆盖三挡并接管换挡，隐藏桌面与触控 Q / E 手动键以回收布局空间，同时继续显示当前挡、自动阈值和三挡工作带：达到 90 时由1挡升2挡、降至 70 时回1挡、达到 140 时由2挡升3挡、降至 120 时回2挡；两组 20 公里/小时滞回都避免临界速度反复换挡。P 的 120 公里/小时普通巡航通常保持2挡，P 关闭后的无上限满油门可自动升入3挡。电影模式只切换镜头，不改变 MT / AT；手动键是否显示始终服从当前变速箱权限。',
    'hud.propulsion.label': '推进核心',
    'hud.propulsion.rpm': '转速',
    'hud.propulsion.thrust': '推力',
    'hud.propulsion.netAcceleration': '净加速度',
    'hud.propulsion.rpmInitialAria': '推进核心转速 1,800 转/分',
    'hud.propulsion.rpmAria': '推进核心转速 {rpm} 转/分',
    'hud.propulsion.help': '转速、踏板推力、1挡怠速扭矩与净加速度来自同一推进状态；尾焰还读取权威核心余转形成自然残焰，不会根据按键或速度反推。当前转速上限会随烛光成长。',
    'hud.propulsion.state.idle': '待机',
    'hud.propulsion.state.creep': '怠速蠕行',
    'hud.propulsion.state.spooling': '升转',
    'hud.propulsion.state.shifting': '换挡断扭',
    'hud.propulsion.state.lugging': '拖挡',
    'hud.propulsion.state.stalled': '完全失速',
    'hud.propulsion.state.thrust': '推进',
    'hud.propulsion.state.coast': '滑行',
    'hud.propulsion.state.braking': '制动',
    'hud.distance': '距离',
    'hud.candlelight': '烛光',
    'hud.handling': '成长',
    'hud.handling.help': '收集烛光会以递减增益让飞船由暖金渐变至紫青，并提升横向操控、推进核心转速上限与升转速度；手动驾驶与自动领航共享同一成长能力。',
    'hud.handling.valueAria': '已收集 {count} 份烛光，成长能力 {value}',
    'hud.handling.initialAria': '已收集 0 份烛光，成长能力 55.0%',
    'hud.best': '最高',
    'hud.lives': '生命',
    'hud.lives.valueAria': '{current} / {maximum} 条生命',
    'hud.lives.initialAria': '3 / 3 条生命',
    'hud.damage.shield': '无敌护盾',
    'hud.damage.announcement': '受到撞击，剩余 {current} 条生命；无敌护盾保护 {seconds} 秒。',
    'hud.damage.depletedAnnouncement': '受到撞击，生命耗尽。',
    'hud.hoodCollisionGuide.label': '真实碰撞边界',
    'hud.hoodCollisionGuide.width': '宽 {width} 米',
    'hud.hoodCollisionGuide.dimensions': '高 {height} · 长 {length} 米',
    'hud.hoodCollisionGuide.projection': '等尺寸前置 {distance} 米',
    'hud.hoodCollisionGuide.range': '{distance} 米',
    'hud.lateralPosition': '横向位置',
    'hud.lateralPosition.left': '左',
    'hud.lateralPosition.right': '右',
    'hud.lateralPosition.center': '居中',
    'hud.lateralPosition.leftValue': '左 {value}%',
    'hud.lateralPosition.rightValue': '右 {value}%',
    'hud.frameRate': '帧率',
    'hud.frameRate.realtimeAria': '实时帧率',
    'hud.frameRate.pending': '采样中',
    'hud.frameRate.pendingAria': '等待首次采样',
    'hud.frameRate.pendingValue': '-- 帧/秒',
    'hud.frameRate.smooth': '流畅',
    'hud.frameRate.watch': '波动',
    'hud.frameRate.low': '警告',
    'hud.frameRate.critical': '严重',
    'hud.frameRate.valueAria': '{fps} 帧每秒，{state}',
    'hud.autopilot': '领航',
    'hud.autopilot.onValue': '开',
    'hud.autopilot.offValue': '关',
    'hud.autopilot.onAria': '自动领航已开启，点击关闭',
    'hud.autopilot.offAria': '自动领航已关闭，点击开启',
    'hud.throttle': '自动油门',
    'hud.throttle.onAria': '满油门保持已开启；P 关闭时持续满油门且没有目标速度上限，点击关闭',
    'hud.throttle.offAria': '满油门保持已关闭；P 关闭时由 W 控制油门，点击开启',
    'hud.throttle.fullThrottle': '满油门',
    'hud.throttle.autopilotOwned': '领航接管',
    'hud.throttle.preferenceOn': '退出领航后保持满油门',
    'hud.throttle.preferenceOff': '退出领航后恢复 W 手动油门',
    'hud.throttle.autopilotAria': '自动油门当前由领航统一控制；M 保存的偏好为“{preference}”，点击可切换退出领航后的偏好',
    'hud.view': '视角',
    'hud.cinematic': '电影',
    'hud.pause': '暂停',
    'hud.continue': '继续',
    'hud.pause.running': '运行中',
    'hud.pause.paused': '已暂停',
    'hud.pause.runningAria': '游戏运行中，点击暂停',
    'hud.pause.pausedAria': '游戏已暂停，点击继续',
    'hud.lighting': '光影',
    'hud.lighting.onAria': '真实光影已开启，点击关闭',
    'hud.lighting.offAria': '真实光影已关闭，点击开启',
    'hud.fullscreen': '全屏',
    'hud.fullscreen.enterAria': '进入全屏显示',
    'hud.fullscreen.exitAria': '退出全屏显示',
    'hud.fullscreen.unsupportedAria': '当前浏览器不支持全屏显示',
    'hud.fullscreen.unsupportedFallback': '不支持全屏',
    'hud.fullscreen.enterFallback': '全屏显示',
    'hud.fullscreen.exitFallback': '退出全屏',
    'hud.fullscreen.denied': '浏览器拒绝了全屏请求；游戏仍可在当前窗口继续运行。',
    'hud.fullscreen.policyDenied': '当前页面策略不允许全屏；请在浏览器设置中允许后重试。',

    'weather.forecast.title': '天气预报',
    'weather.current': '当前',
    'weather.next': '下一天气',
    'weather.eta': '预计切换',
    'weather.duration': '下阶段时长',
    'weather.calculating': '计算中',
    'weather.strength': '天气强度',
    'weather.surfaceContact': '地表接触',
    'weather.surfaceContactAria': '地表接触：{surface}',
    'weather.surfaceContactInitialAria': '地表接触：干燥',
    'weather.announcement': '当前{current}，下一天气{next}。',
    'weather.announcement.initial': '当前晴朗，下一天气少云。',
    'weather.forecastAria': '天气预报：{mode}，当前{current}，下一天气{next}，{eta}，趋势{trend}，强度{intensity}%',
    'weather.forecastAnnouncement': '当前{current}，下一天气{next}，{eta}，趋势{trend}。',
    'weather.trend.strengthening': '增强',
    'weather.trend.easing': '减弱',
    'weather.trend.steady': '稳定',
    'weather.trend.transition': '{trend} · 过渡 {percent}%',
    'weather.test.title': '人工天气测试',
    'weather.test.visualOnly': '纯视觉',
    'weather.test.instant': '即时天气',
    'weather.test.instantAria': '人工测试即时天气',
    'weather.test.automaticLifecycle': '自动生命周期',
    'weather.test.automaticStatus': '自动生命周期 · 沿用可暂停天气时钟',
    'weather.test.overrideStatus': '{icon} {weather} · 即时覆盖中',
    'weather.test.manualLock': '人工锁定',
    'weather.test.fixtureLock': '测试锁定',
    'weather.test.locked': '测试锁定',
    'weather.test.manualDescription': '人工测试覆盖当前视觉；可随时切换天气或恢复自动生命周期。',
    'weather.test.fixtureDescription': '固定天气仅用于画面验收，玩家分类暂不可更改。',
    'weather.mode.runLocked': '本局已锁定。{description}',
    'weather.type.clear': '晴朗',
    'weather.type.partlyCloudy': '少云',
    'weather.type.cloudy': '阴天',
    'weather.type.mist': '雾霭',
    'weather.type.rain': '降雨',
    'weather.type.heavyRain': '暴雨',
    'weather.type.thunderstorm': '雷暴',
    'weather.type.hail': '冰雹',
    'weather.type.flurry': '飘雪',
    'weather.type.snow': '降雪',
    'weather.type.blizzard': '暴雪',
    'weather.type.haze': '薄霭',
    'weather.type.dustHaze': '浮尘',
    'weather.type.blowingDust': '扬沙',
    'weather.type.sandstorm': '沙尘暴',
    'weather.mode.dry.name': '无降水版',
    'weather.mode.dry.icon': '晴',
    'weather.mode.dry.description': '晴朗、云层与雾霭轮换，不进入雨、雪、冰雹或沙尘天气。',
    'weather.mode.severe.name': '雨雪风暴版',
    'weather.mode.severe.icon': '暴',
    'weather.mode.severe.description': '各地进入能形成的降雨、降雪、冰雹或沙尘天气，并保留必要缓冲。',
    'weather.mode.mixed.name': '混合版',
    'weather.mode.mixed.icon': '混',
    'weather.mode.mixed.description': '晴朗、云雾与强天气按当地气候自然轮换。',
    'weather.surface.dry': '干燥',
    'weather.surface.water': '积水',
    'weather.surface.snow': '积雪',
    'weather.surface.slush': '雪泥',

    'navigation.eyebrow': '实时导航',
    'navigation.title': '航路导航',
    'navigation.routeInitial': '主干 · 前方 620 米',
    'navigation.displayModeAria': '地图显示模式',
    'navigation.mode.standard': '局部导航',
    'navigation.mode.roadDetail': '巡航细节',
    'navigation.mode.overview': '立交总览',
    'navigation.mode.guided': '路线已锁定',
    'navigation.orientation.northUp': '北向朝上',
    'navigation.orientation.headingUp': '航向朝上',
    'navigation.instructionAria': '当前航路指令',
    'navigation.instruction': '航路指令',
    'navigation.keepRoute': '保持路线',
    'navigation.routeHold': '路线保持',
    'navigation.aheadMeters': '前方 {distance} 米',
    'navigation.sign.distance': '{value} 米',
    'navigation.speedLimitAhead': '前方限速',
    'navigation.legend.selected': '已选',
    'navigation.legend.proposed': '候选',
    'navigation.legend.hazard': '障碍',
    'navigation.legend.candlelight': '烛光',
    'navigation.legend.traffic': '船流',
    'navigation.legendHelp': '地图以金白实线表示已选路线，金色虚线表示候选路线，红色表示障碍，蓝色表示烛光，灰蓝箭头表示环境船流；虚线路段可能位于隧道或下层道路。',
    'navigation.cloverleafAria': '苜蓿叶互通导航状态',
    'navigation.targetExit': '目标出口',
    'navigation.distanceToSplit': '距分流',
    'navigation.brake': '刹车',
    'navigation.brakeManual': '手动 7.5',
    'navigation.brakeAutomatic': '自动 7.5',
    'navigation.headingAria': '实时航向 {bearing} 度，{direction}',
    'navigation.headingInitialAria': '实时航向 000 度，北',
    'navigation.currentTrunk': '当前位于主干',
    'navigation.route.trunk': '主干',
    'navigation.route.left': '左路',
    'navigation.route.right': '右路',
    'navigation.route.leftBranch': '左支',
    'navigation.route.rightBranch': '右支',
    'navigation.route.interchange': '互通',
    'navigation.route.interchangeRoad': '互通道路',
    'navigation.route.leftConnector': '左向连接线',
    'navigation.route.rightConnector': '右向连接线',
    'navigation.route.surfaceMain': '地上主路',
    'navigation.route.mountainTunnel': '山体隧道',
    'navigation.route.undergroundTunnel': '地下隧道',
    'navigation.route.mountainTunnelExit': '2A 山体隧道 · {direction}',
    'navigation.route.undergroundTunnelExit': '2B 地下隧道 · {direction}',
    'navigation.route.surfaceExit': '地上主路 · {direction}',
    'navigation.route.leftFork': '左岔路',
    'navigation.route.rightFork': '右岔路',
    'navigation.phase.entryTurn': '驶入转弯',
    'navigation.phase.collector': '集散道',
    'navigation.phase.transferTurn': '跨线转弯',
    'navigation.phase.newRoute': '新路线',
    'navigation.phase.returnTurn': '回接转弯',
    'navigation.phase.connector': '连接线',
    'navigation.level.upper': '上层',
    'navigation.level.underBridge': '桥下',
    'navigation.launchFork': '坡道岔路',
    'navigation.aheadInterchange': '主干 · 前方立交',
    'navigation.aheadLaunch': '主干 · 前方坡道岔路',
    'navigation.roadDetailStatus': '巡航细节 · {obstacle} · 烛光 {pickupCount}',
    'navigation.obstacleDistance': '障碍 {distance} 米',
    'navigation.noObstacle': '前方无障碍',
    'navigation.noMappedObstacle': '前方无地图内障碍',
    'navigation.statusRoadDetail': '当前为{mode}，{obstacle}，地图内烛光{pickupCount}个，{authority}',
    'navigation.statusRoute': '当前为{mode}，位于{road}，目标{target}',
    'navigation.autopilotOn': '自动领航开启',
    'navigation.manualDriving': '手动驾驶',
    'navigation.exit': '出口 {direction}',
    'navigation.mapFatalTitle': '导航地图已安全停止',
    'navigation.mapFatalMessage': '导航地图遇到不可恢复的错误，游戏已安全停止。请重新加载页面后重试。',
    'navigation.mapRecoveryFatalMessage': '导航地图连续恢复失败，游戏已安全停止。请重新加载页面后重试。',
    'navigation.canvas.upper': '上',
    'navigation.canvas.lower': '下',
    'navigation.canvas.split': '分',
    'navigation.canvas.merge': '合',
    'navigation.station.entry': '入',
    'navigation.station.collector': '集',
    'navigation.station.transfer': '转',
    'navigation.station.newRoute': '新',
    'navigation.station.merge': '汇',

    'direction.n': '北',
    'direction.n.compact': '北',
    'direction.nne': '东北偏北',
    'direction.ne': '东北',
    'direction.ene': '东北偏东',
    'direction.e': '东',
    'direction.ese': '东南偏东',
    'direction.se': '东南',
    'direction.sse': '东南偏南',
    'direction.s': '南',
    'direction.ssw': '西南偏南',
    'direction.sw': '西南',
    'direction.wsw': '西南偏西',
    'direction.w': '西',
    'direction.wnw': '西北偏西',
    'direction.nw': '西北',
    'direction.nnw': '西北偏北',
    'direction.heading': '航向',

    'autopilot.panelEyebrow': '航迹控制',
    'autopilot.panelTitle': '自动领航',
    'autopilot.strategy': '策略',
    'autopilot.risk': '风险',
    'autopilot.direction': '方向',
    'autopilot.ahead': '前方',
    'autopilot.summaryAria': '自动领航摘要',
    'autopilot.intent': '意图',
    'autopilot.intent.manualHold': '手动保持',
    'autopilot.intent.laneHold': '保持道路',
    'autopilot.intent.collectCandlelight': '收集烛光',
    'autopilot.intent.routeChoice': '选择路线',
    'autopilot.intent.avoidThreat': '规避威胁',
    'autopilot.risk.clear': '安全',
    'autopilot.risk.guarded': '留意',
    'autopilot.risk.elevated': '警戒',
    'autopilot.risk.critical': '危险',
    'autopilot.riskMeterAria': '自动领航风险',
    'autopilot.risk.initialAria': '安全，0%',
    'autopilot.risk.valueAria': '{level}，{value}%',
    'autopilot.lateralAuthority': '横向权威',
    'autopilot.longitudinalAuthority': '纵向权威',
    'autopilot.brakeReason': '制动原因',
    'autopilot.nearestThreat': '最近威胁 / TTC',
    'autopilot.authority.manual': '手动',
    'autopilot.authority.autopilot': '领航',
    'autopilot.authority.manualTakeover': '手动接管',
    'autopilot.longitudinal.manual': '手动油门',
    'autopilot.longitudinal.cruise': '领航巡航',
    'autopilot.longitudinal.fullThrottle': '满油门保持',
    'autopilot.longitudinal.autopilot': '领航调速',
    'autopilot.brake.standby': '待命',
    'autopilot.brake.manual': '手动制动',
    'autopilot.brake.curve': '弯道自动制动',
    'autopilot.brake.opposingBoundary': '对向道路边界制动',
    'autopilot.brake.obstacle': '障碍自动制动',
    'autopilot.threat.none': '无 · TTC —',
    'autopilot.threat.distanceTtc': '{distance} · TTC {ttc} 秒',
    'autopilot.authoritySummary.initial': '横向手动 · 纵向手动 · 制动待命',
    'autopilot.authoritySummary.initialAria': '横向手动，纵向手动，制动待命',
    'autopilot.authoritySummary.value': '横向{lateral} · 纵向{longitudinal} · {brake}',
    'autopilot.authoritySummary.valueAria': '横向{lateral}，纵向{longitudinal}，{brake}',
    'autopilot.announcement.authority': '控制权变更：{summary}',
    'autopilot.announcement.brake': '制动状态：{brake}',
    'autopilot.goal.candlelight': '收烛光',
    'autopilot.status.calibrating': '接管校准',
    'autopilot.status.idle': '待机',
    'autopilot.status.scanning': '接管扫描',
    'autopilot.status.airborne': '空中',
    'autopilot.status.cooldown': '冷却',
    'autopilot.status.airbornePass': '空中通过',
    'autopilot.status.fullWidthSafe': '全幅安全',
    'autopilot.status.corridorWide': '宽 {width}',
    'autopilot.status.corridorNarrow': '窄 {width}',
    'autopilot.status.corridorVeryNarrow': '极窄通道',
    'autopilot.status.contractSurvival': 'V23 极速保命',
    'autopilot.status.highSpeedSurvival': 'V23 高速保命',
    'autopilot.status.extremeAvoidance': 'V23 极限避障',
    'autopilot.status.dynamicAvoidance': 'V23 动态避障',
    'autopilot.status.safetyFirst': 'V23 安全优先',
    'autopilot.status.highSpeedSafety': 'V23 高速安全',
    'autopilot.status.candlelightLocked': 'V23 锁定烛光',
    'autopilot.status.collectAlongRoute': 'V23 顺路收光',
    'autopilot.status.cloudCruise': 'V23 云路巡航',
    'autopilot.status.preselectRoute': 'V23 预选{route}',
    'autopilot.status.enterRoute': 'V23 转入{route}',
    'autopilot.status.routeGuidance': 'V23 {route}领航',
    'autopilot.status.safeCruise': 'V23 安全巡航',
    'autopilot.status.closeCorrection': 'V23 近距修正',
    'autopilot.status.corridorPressure': '通道受压',
    'autopilot.status.closeAvoidance': '近距避障',
    'autopilot.status.instantAvoidance': 'V23 即时避障',
    'autopilot.status.instantLine': '即时压线',
    'autopilot.status.instantCorridor': '即时通道',
    'autopilot.status.forcedAvoidance': 'V23 强制避障',
    'autopilot.status.closeEscort': 'V23 近距护航',
    'autopilot.status.escortPass': '护航通过',
    'autopilot.status.lineAvoidance': '压线避障',
    'autopilot.status.collisionFailed': '碰撞失败',
    'autopilot.status.noInsurance': '无保险',

    'input.title': '实时输入',
    'input.key.space': '空格',
    'input.mode.manualTakeover': '手动接管',
    'input.mode.autopilotInput': '领航输入',
    'input.mode.autopilot': '领航',
    'input.mode.manualInput': '手动输入',
    'input.authority.manualTakeover': '自动领航开启，手动接管中',
    'input.authority.autopilotActive': '自动领航输入中',
    'input.authority.autopilotStandby': '自动领航待命',
    'input.authority.manual': '手动驾驶',
    'input.source.autopilot': '领航',
    'input.source.manual': '手动',
    'input.none': '当前无输入',
    'input.aria': '实时驾驶输入：{inputs}；{authority}',
    'input.initialAria': '实时驾驶输入：当前无输入',
    'input.control.left': '向左',
    'input.control.right': '向右',
    'input.control.throttle': '加速',
    'input.control.jump': '起飞',
    'input.control.brake': '刹车',

    'view.chase': '追尾',
    'view.close': '近距',
    'view.top': '俯视',
    'view.hood': '车头',
    'view.buttonAria': '当前{view}视角，按 C 切换视角',
    'view.initialAria': '当前追尾视角，按 C 切换视角',
    'view.changedStatus': '已切换到{view}视角。',
    'cinematic.state.off': '关闭',
    'cinematic.state.on': '开启',
    'cinematic.initialAria': '电影模式已关闭，点击开启',
    'cinematic.buttonAria': '电影模式已{state}，点击切换',
    'cinematic.buttonActiveAria': '电影模式已开启，当前{detail}；点击关闭',
    'cinematic.enabledStatus': '电影模式已开启：只切换镜头；P、M、T、方向、油门、刹车与跳跃继续照常工作，MT 继续显示 Q / E，AT 继续隐藏手动换挡键并自动接管，普通碰撞不会扣除生命。',
    'cinematic.disabledStatus': '电影模式已关闭，已返回{view}视角；驾驶状态未改变。',
    'cinematic.safetyStatus': '电影模式已阻止本次生命扣除；你的驾驶输入没有被接管。',
    'cinematic.hud.mode': '电影模式',
    'cinematic.fallback.reduced-motion': '减少动态',
    'cinematic.fallback.unknown': '构图调整',
    'cinematic.shot.stable': '稳定构图',
    'cinematic.shot.lowRear': '低位后侧',
    'cinematic.shot.roadSkim': '贴地追光',
    'cinematic.shot.wide': '宽幅巡航',
    'cinematic.shot.telephoto': '长焦跟拍',
    'cinematic.shot.side': '右翼平行',
    'cinematic.shot.oppositeSide': '左翼平行',
    'cinematic.shot.rearClose': '近身追尾',
    'cinematic.shot.crane': '摇臂升空',
    'cinematic.shot.high': '高位俯冲',
    'cinematic.shot.front': '前侧回望',
    'cinematic.shot.flyby': '高速穿越',
    'cinematic.shot.centerReveal': '中轴揭幕',
    'cinematic.shot.noseMount': '船首挂载',
    'cinematic.shot.tailMount': '船尾挂载',
    'cinematic.shot.wingMount': '右翼尖挂载',
    'cinematic.shot.tunnelNoseMount': '隧道船首挂载',
    'cinematic.shot.tunnelWingMount': '隧道翼根挂载',
    'cinematic.shot.tunnelTailMount': '隧道船尾挂载',
    'cinematic.shot.tunnelEntrance': '洞门切入',
    'cinematic.shot.tunnelCompression': '隧道长焦压缩',
    'cinematic.shot.tunnelWallProfile': '贴墙侧写',
    'cinematic.shot.tunnelAxialRush': '隧道中轴推进',
    'cinematic.shot.tunnelOppositeProfile': '对侧廊壁侧写',
    'cinematic.shot.tunnelExitReveal': '出洞揭幕',

    'quality.low.name': '低质量',
    'quality.low.option': '低质量 · 优先流畅',
    'quality.low.description': '较低渲染分辨率与阴影精度；保留隧道常亮外观与静态基础照度，不启用动态局部聚光或局部阴影。',
    'quality.medium.name': '中质量',
    'quality.medium.option': '中质量 · 平衡清晰度',
    'quality.medium.description': '平衡清晰度与性能；隧道灯罩、扩散片和静态基础照度保持常亮，但不启用动态聚光或局部阴影。',
    'quality.high.name': '高质量',
    'quality.high.option': '高质量 · 电脑超高动态光影',
    'quality.high.description': '电脑超高画质渲染、超精细主太阳阴影，并启用六盏原生动态聚光与两盏局部阴影。',
    'quality.runLocked': '本局飞行中已锁定；暂停后可切换。{description}',

    'realm.dawnIsle': '晨岛云海',
    'realm.prairieGarden': '云野花庭',
    'realm.rainforestGlow': '雨林幽光',
    'realm.valleyTwilight': '霞谷暮光',
    'realm.vaultStars': '禁阁星穹',
    'realm.edenStorm': '伊甸风眼',

    'startup.loading.title': '正在准备天际航线',
    'startup.loading.modules': '正在载入飞行系统与场景模块……',
    'startup.loading.world': '正在装配飞船、世界与驾驶界面……',
    'startup.loading.routes': '正在铺设首段道路与前方航线……',
    'startup.loading.graphics': '道路已就绪，正在准备光影与材质……',
    'startup.loading.firstFrame': '正在检查图形环境与首帧……',
    'startup.loading.complete': '准备完成',
    'startup.loading.note': '加载完成后，开始界面中的“点火启航”会立即可用。',
    'startup.loading.progressAria': '启动准备进度',
    'startup.loading.tipLabel': '飞行提示',
    'startup.loading.tip.steering': 'A / D、方向键或触控左右键持续横移；松开即停止输入。',
    'startup.loading.tip.view': 'C 切换四种驾驶视角；F 或“电影”键只切换电影镜头，不改变 P、M、T 或任何驾驶输入，退出后恢复原视角。',
    'startup.loading.tip.ramps': '随机跳台按真实坡度与速度起飞；完整落上真实道路才算安全。',
    'startup.loading.tip.candlelight': '烛光会加分，并提升横移、转速上限与升转速度。',
    'startup.loading.tip.damage': '普通撞击扣一命，并提供至少 1.3 秒无敌；保护期间不强制降速。',
    'startup.loading.tip.weather': '积水、积雪和雪泥会带来有上限的阻力与侧滑；手动和领航同权。',

    'launch.stage.lock': '机体 · 视觉锁定',
    'launch.stage.name': 'V23 · 天际晨航',
    'launch.stage.class': '类别',
    'launch.stage.classValue': '高机动翼身飞行器',
    'launch.stage.span': '翼展',
    'launch.stage.spanValue': '5.24 米',
    'launch.stage.core': '核心',
    'launch.stage.coreValue': '烛光',
    'launch.mode.launch': '待启航',
    'launch.mode.pause': '飞行暂停',
    'launch.mode.gameover': '航程结束',
    'launch.status.ready': '就绪 / 01',
    'launch.status.hold': '暂停 / O',
    'launch.status.archive': '归档 / 03',
    'launch.brand': '霓虹自动领航 · V23',
    'launch.title.top': 'V23 · 天际',
    'launch.title.bottom': '晨航',
    'launch.summary': '从静止出发，穿越地上主路、山体廊桥与地下隧道；松开 W 会立即切掉踏板额外推力，贴地1挡则像汽车一样以真实怠速缓慢蠕行，S 可完全停住。P 关闭时 M 保持满油门，P 开启时领航统一调速；F 只切换安全电影镜头，驾驶权不变。',
    'launch.briefing.eyebrow': '任务概览',
    'launch.briefing.title': '航线简报',
    'launch.briefing.aria': '核心玩法',
    'launch.point.candle.title': '烛光强化',
    'launch.point.candle.body': '飞船由暖金渐变至紫青，并同步提升操控、转速上限与升转速度',
    'launch.point.navigation.title': '立体导航',
    'launch.point.navigation.body': '主路、山体廊桥与地下隧道真实分流',
    'launch.point.speed.title': '真实三挡',
    'launch.point.speed.body': '1挡约每小时 110 公里、2挡约每小时 160 公里；高速道路/跳台3挡约每小时 280 公里，MT 与 AT 均可进入',
    'launch.config.eyebrow': '本局设置',
    'launch.config.title': '本局配置',
    'launch.weather.legend': '天气分类',
    'launch.weather.choose': '选择本局',
    'launch.weather.dry.summary': '晴空 · 云层 · 雾霭',
    'launch.weather.severe.summary': '雨雪 · 冰雹 · 沙尘暴',
    'launch.weather.mixed.summary': '晴雨按气候自然轮换',
    'launch.quality.title': '渲染画质',
    'launch.quality.help': '开局或暂停时可切换',
    'launch.action.start': '点火启航',
    'launch.action.restart': '重新启航',
    'launch.action.resume': '继续飞行',
    'launch.action.again': '再次启航',
    'launch.action.committingStart': '建立航线…',
    'launch.action.committingResume': '恢复航线…',
    'launch.action.guide': '飞行手册',
    'launch.action.pauseRestart': '重新开始本局',
    'launch.restartConfirm.eyebrow': '航程重置确认',
    'launch.restartConfirm.title': '确认重新开始本局？',
    'launch.restartConfirm.description': '当前航程的距离、得分、烛光和生命进度会被清除；本页已选画质与天气分类会保留。此操作无法撤销。',
    'launch.restartConfirm.cancel': '取消，返回暂停',
    'launch.restartConfirm.confirm': '确认重新开始',
    'launch.footer.collision': '静止起步',
    'launch.footer.lives': '真实阻力',
    'launch.footer.target': 'P 领航调速 · M 满油门 · T 切 MT / AT',
    'launch.pauseStatus': '游戏已暂停：按 O / Esc 或点击继续游戏可恢复；按 R 或点击重新开始本局会先打开二级确认。',
    'launch.gameOverStatus': '生命耗尽！最终得分 {score}，历史最高 {best}。',
    'launch.offRoadCrashStatus': '坠毁！腾空 {airTime} 后未落在真实道路上，本局立即结束。最终得分 {score}，历史最高 {best}。',
    'launch.runningStatus': 'V23：每份烛光都会继续改变飞船颜色，并提升玩家与领航共享的横移操控、转速上限与升转速度；自动巡航会在真实阻力下稳定于{speed}。',

    'rating.eyebrow': '飞行复盘',
    'rating.title': '本次飞行评级',
    'rating.facts.aria': '整局实测数据',
    'rating.fact.distance': '真实航程',
    'rating.fact.duration': '有效时长',
    'rating.fact.averageSpeed': '平均速度',
    'rating.fact.maximumSpeed': '最高速度',
    'rating.fact.totalAirTime': '累计腾空',
    'rating.fact.longestAirTime': '最长单次',
    'rating.fact.candles': '收集烛光',
    'rating.fact.damage': '有效扣血',
    'rating.dimensions.aria': '五项评级维度',
    'rating.dimension.safety': '安全',
    'rating.dimension.pace': '真实速度',
    'rating.dimension.endurance': '航程耐力',
    'rating.dimension.collection': '烛光收集',
    'rating.dimension.airborne': '腾空与落地',
    'rating.radar.title': '五维表现',
    'rating.radar.note': '顶点为各项原始 0–100 分；图形面积不代表加权总分。',
    'rating.radar.summary': '五维表现：安全 {safety}；真实速度 {pace}；航程耐力 {endurance}；烛光收集 {collection}；腾空与落地 {airborne}。',
    'rating.radar.invalid': '评级图数据不可用',
    'rating.grade.S': '星辉',
    'rating.grade.A': '巡光',
    'rating.grade.B': '稳航',
    'rating.grade.C': '试航',
    'rating.grade.D': '失衡',
    'rating.grade.aria': '总评级 {grade}，{name}，{score} 分',
    'rating.evidence.complete': '完整评级 · 样本覆盖 {coverage}%',
    'rating.evidence.provisional': '暂定评级 · 样本覆盖 {coverage}%',
    'rating.evidence.limited': '短局评级 · 样本覆盖 {coverage}%',
    'rating.reason.offRoad': '结束原因：腾空后未落在真实道路上',
    'rating.reason.lives': '结束原因：三条生命耗尽',
    'rating.value.seconds': '{value} 秒',
    'rating.value.candles': '{value} 份',
    'rating.value.damage': '{value} 次',
    'rating.value.damageWithGuardrail': '{value} 次（护栏 {guardrail}）',
    'rating.dimension.score': '{score} · {grade}',
    'rating.dimension.noSample': '无样本',
    'rating.dimension.meterAria': '{dimension}：{score} 分，等级 {grade}',
    'rating.dimension.noSampleAria': '{dimension}：本局无可用样本',
    'rating.evidence.safety.offRoad': '障碍损伤 {obstacle} 次 · 护栏扣血 {guardrail} 次 · 另有一次路外坠毁',
    'rating.evidence.safety.noDamage': '0 次有效扣血 · 无损航程 {distance}',
    'rating.evidence.safety.damage': '障碍损伤 {obstacle} 次 · 护栏扣血 {guardrail} 次 · 平均无损航段 {segment}',
    'rating.evidence.pace': '平均 {average} · 最高 {maximum} · 巡航基准 {target}',
    'rating.evidence.endurance': '有效飞行 {duration} · 真实航程 {distance}',
    'rating.evidence.collection': '{candles} 份 · 每千米 {rate} 份；档位按保守供给下限每千米 55 份',
    'rating.evidence.collectionUnavailable': '航程不足 2 千米；仅报告 {candles} 份，不判断收集率',
    'rating.evidence.airborne': '跳台安全落地 {landings}/{takeoffs} · 成功跳台腾空 {safeAirTime} · 整局累计 {totalAirTime}',
    'rating.evidence.airborneUnavailable': '未发生跳台腾空；整局累计 {totalAirTime}，不把手工起飞冒充跳台样本',
    'rating.weakness.label': '本局短板',
    'rating.weakness.insufficientTitle': '样本不足',
    'rating.weakness.insufficientAdvice': '先完成至少 30 秒且 1 千米的航程，再判断稳定短板。',
    'rating.advice.safety': '优先增加两次损伤之间的无事故航程；路外坠毁会把安全项限制在低档。',
    'rating.advice.pace': '平均速度和最高速度各占本项一半；持续、稳定给油比结算瞬时速度更重要。',
    'rating.advice.endurance': '耐力只按暂停外的有效飞行时长计量；延长稳定存活时间即可改善。',
    'rating.advice.collection': '在不牺牲道路落点的前提下，更早对准可达烛光；本项按每千米密度计算。',
    'rating.advice.airborne': '先保证完整船体落在真实道路上；安全落地率占腾空项的四分之三。',
    'rating.method': '固定合同 V2：安全 30%、真实速度 25%、耐力 15%、烛光 15%、腾空 15%；无样本维度按其余项目重新分配。S / A / B / C / D 边界为 90 / 80 / 70 / 60 分；这是游戏工程指标，不是玩家百分位。',

    'guide.eyebrow': '飞行手册 · V23',
    'guide.title': '飞行手册',
    'guide.description': '先掌握真正影响飞行结果的规则，再按需展开完整系统说明；这里不会改动航程、路线或控制状态。',
    'guide.meta.chapters': '任务章节',
    'guide.meta.contracts': '规则条目',
    'guide.meta.synced': '关键 / 完整双层',
    'guide.closeAria': '关闭玩法详情并返回上一界面',
    'guide.tabsAria': '玩法详情章节',
    'guide.tabs.heading': '章节导航',
    'guide.tab.controls': '操作',
    'guide.tab.controlsSummary': '驾驶 · 视角 · 设置',
    'guide.tab.navigation': '导航',
    'guide.tab.navigationSummary': '路线 · 立交 · 领航',
    'guide.tab.fairness': '目标与规则',
    'guide.tab.fairnessSummary': '得分 · 生命 · 公平',
    'guide.tab.world': '天气与世界',
    'guide.tab.worldSummary': '生态 · 气候 · 光影',
    'guide.tabs.keyboardHint': '键盘切换',
    'guide.view.aria': '玩法详情阅读范围',
    'guide.view.essential': '必会',
    'guide.view.essentialHint': '关键规则',
    'guide.view.all': '完整',
    'guide.view.allHint': '全部说明',
    'guide.view.essentialSummary': '当前显示会直接影响操控、路线、生命、得分和落地的关键规则。',
    'guide.view.allSummary': '当前显示完整的 43 项玩家规则与系统说明。',
    'guide.context.aria': '当前航程与阅读范围',
    'guide.context.eyebrow': '打开手册时快照',
    'guide.context.title.preflight': '起飞前准备',
    'guide.context.title.flying': '航程进行中',
    'guide.context.title.paused': '航程已暂停',
    'guide.context.title.complete': '航程已结束',
    'guide.context.phase': '阶段',
    'guide.context.phase.preflight': '起飞前',
    'guide.context.phase.flying': '飞行中',
    'guide.context.phase.paused': '已暂停',
    'guide.context.phase.complete': '已结算',
    'guide.context.authority': '驾驶',
    'guide.context.authority.manual': '手动驾驶',
    'guide.context.authority.lateralManual': '手动转向',
    'guide.context.authority.lateralAuto': '领航转向',
    'guide.context.authority.longitudinalManual': '手动油门',
    'guide.context.authority.longitudinalFullThrottle': '满油门保持',
    'guide.context.authority.longitudinalAutopilot': '领航调速',
    'guide.context.authorityValue': '{lateral} · {longitudinal}',
    'guide.context.speed': '速度',
    'guide.context.speedInitial': '0 公里/小时',
    'guide.context.survival': '状态',
    'guide.context.survivalInitial': '3 条生命 · 0 份烛光',
    'guide.context.survivalValue': '{lives} 条生命 · {candles} 份烛光',
    'guide.context.compactInitial': '手动转向 + 手动油门 · 0 公里/小时 · 3 命 / 0 烛 · 待命',
    'guide.context.compactValue': '{authority} · {speed} · {lives} 条生命 · {candles} 份烛光 · 制动 {brake}',
    'guide.context.brake': '制动',
    'guide.context.brake.standby': '待命',
    'guide.context.next': '下一步',
    'guide.context.next.preflight': '先熟悉横移与油门，再点火启航。',
    'guide.context.next.scan': '观察道路、地图和前方障碍，提前决定路线。',
    'guide.context.next.airborne': '调整横向落点，让完整船体落在任一有效真实道路上。',
    'guide.context.next.critical': '仅剩一条生命；优先保住道路落点并避开连续碰撞。',
    'guide.context.next.film': '电影镜头正在运行；驾驶权仍由当前 P、M、T 与你的输入决定。',
    'guide.context.next.autopilot': 'P 已统一接管转向、油门与安全制动；M 只保存退出 P 后的油门偏好。',
    'guide.context.next.complete': '查看本局评级，或返回上一界面开始新的航程。',
    'guide.controls.kicker': '飞行操作',
    'guide.controls.title': '操作、飞船与设置',
    'guide.controls.intro': '键盘、鼠标和触控共用同一套驾驶权威；体感反馈不会偷偷改变物理。',
    'guide.quickstart.eyebrow': '首次飞行 · 60 秒掌握',
    'guide.quickstart.title': '先完成一次稳定飞行',
    'guide.quickstart.intro': '不需要先读完全部说明；按下面顺序操作，就能理解本局最重要的因果关系。',
    'guide.quickstart.steer.title': '先控制车道',
    'guide.quickstart.steer.body': 'A / D 或左右触控横移；先看道路边缘，再追烛光。',
    'guide.quickstart.speed.title': '再建立速度',
    'guide.quickstart.speed.body': 'W 加速、S 刹车；松 W 会立即切掉踏板额外推力。贴地1挡在真实阻力与怠速扭矩的平衡下缓慢趋近约 8 km/h，S 可完全停车并压住怠速；2/3挡、换挡和腾空时没有蠕行力。P 关闭时，M 在 W 手动与持续满油门之间切换，满油门不会追踪 120 km/h；P 开启时由领航统一调油、滑行与制动。T 独立切换 MT / AT。MT 用 Q / E 换挡：低速高挡会拖挡并同步拉低加载转速与推进力，完全失速时推力归零；照仪表的 Q×N 提示连续降到安全挡。AT 接管 Q/E 并覆盖三挡：90 升2、70 降1、140 升3、120 降2 km/h。',
    'guide.quickstart.route.title': '提前选择路线',
    'guide.quickstart.route.body': '看右侧指令与地图，在分流前进入目标车道，不要到岔口才猛打方向。',
    'guide.quickstart.ramp.title': '跳台靠3挡与真实坡面起飞',
    'guide.quickstart.ramp.body': '接近跳台时把速度建立到约每小时 260 公里：MT 可手动升至3挡，AT 会在满油门加速至 140 km/h 时自动升入3挡。不按 SPACE 会在坡唇按真实坡度自然起飞。坡面也可主动起飞，但不会获得跳台专属的跨车道落地权限。',
    'guide.quickstart.survive.title': '用生命换经验，不要赌第二撞',
    'guide.quickstart.survive.body': '普通撞击扣一命并提供至少 1.3 秒护盾；生命耗尽或腾空落空都会结束本局。',
    'guide.feature.controlsSteering.title': '左右横移',
    'guide.feature.controlsSteering.body': '按住可连续移动，方向键和移动端左右键使用同一横移能力。',
    'guide.feature.throttleModes.title': '真实阻力与三挡推进',
    'guide.feature.throttleModes.body': '自动油门默认关闭；W / ↑ 加速、S / ↓ 以约 7.5 米/秒² 制动。松 W 会立即切掉踏板额外推力，但贴地1挡保留独立怠速扭矩：干燥平路会缓慢趋近约 8 km/h，S 能完全停车并压住怠速；16 km/h 以上、2/3挡、换挡或腾空时，滚阻与气阻仍主导滑行且没有隐藏推力。推进核心余转与尾焰随后自然衰减，不会首帧骤缩。T 独立切换 MT 手动挡与 AT 自动挡；P 关闭时，M 是持续满油门偏好，不追踪 120 km/h，也没有目标速度上限；P 开启时由领航统一决定推进、滑行与制动，M 只保存退出 P 后的偏好。MT 用 Q 降挡、E 升挡：1挡日常自然约 110 km/h，推荐 0–90 km/h且达到 70 km/h 可升2挡；2挡自然约 160 km/h，推荐 70–140 km/h且不高于 125 km/h 可降1挡、达到 140 km/h 可升3挡；3挡是高速道路与跳台推进级，自然约 280 km/h，推荐 140–280 km/h且不高于 190 km/h 可降2挡。这些工作带不是硬限速。手动高挡低速会拖挡，加载转速与推进力一起下降；完全失速时推力归零，仪表会给出安全挡和 Q×N 次数，必须照提示连续降挡。换挡会短暂断推力，不安全降挡会被拒绝。AT 覆盖三挡并禁用玩家 Q/E：在 90 / 70 km/h 间自动切换1、2挡，在 140 / 120 km/h 间自动切换2、3挡。P 的 120 km/h 普通巡航通常保持2挡；P 关闭且 M 开启时持续满油门没有目标上限，可自动升至3挡。',
    'guide.feature.launchAndRamps.title': '主动起飞与3挡随机跳台',
    'guide.feature.launchAndRamps.body': 'SPACE / 触控起飞可在平路、桥梁纵坡和实体跳台承载面上主动起飞；坡上起跳会保留当前坡面切向速度并叠加主动离地冲量。若不按 SPACE，跳台前仍需进入3挡并把接近速度建立到约 260 km/h：MT 用 E 手动升挡，AT 则在满油门加速至 140 km/h 时自动升入3挡。飞船会在坡唇按真实坡度和速度自然离地。只有这种坡唇自然腾空才获得道路中心左右各约 42 米的跨车道落地范围；主动起飞仍只使用当前路线护栏范围。空中操控仍在横移速度 10 米/秒、横向加速度 17 米/秒² 达到饱和；四种跳台已按约 260 km/h 验证，可跨越约 24 米道路间距并落入对向道路。船体必须完整落在当前路线、可选岔路或对向道路的真实承载面上；落入缝隙、道路外或路线接入失败会直接坠毁并结束本局。',
    'guide.feature.freeLook.title': '自由观察',
    'guide.feature.freeLook.body': '按住主画布鼠标左键拖动，松开后平滑回正；观察不改变路线和飞船输入。',
    'guide.feature.viewFullscreen.title': '四驾驶视角、电影模式与全屏',
    'guide.feature.viewFullscreen.body': 'C 只切换追尾、近距、俯视和车头四种驾驶视角；F 或界面的“电影”键只启动镜头导演并保存原视角。电影模式不读取或改写 P、M、T、MT / AT、方向、油门、刹车、跳跃、挡位、速度、路线或得分；MT 下 Q / E 手动键继续显示并可用，AT 下这些键继续隐藏且由自动箱接管。P 关闭时仍由你手动驾驶，P 开启时才由领航驾驶，而且电影中仍可随时切换 P、M、T 与挡位。本局种子会选择三套炫酷编排之一：桌面每套十二镜，触屏每套八镜；导演保持只读，驾驶状态不会替它选镜或停表。普通接触在电影模式下不会扣除生命，但安全层不会替你转向、制动或换挡。电影中仅拖动观察停用；减少动态效果时固定为稳定构图。所有世界机位只读取已提交路线，不加黑边或大遮挡；退出返回原驾驶视角。',
    'guide.feature.liveInput.title': '实时输入来源',
    'guide.feature.liveInput.body': '左下 A / D / W / 空格 / S 会持续显示最终命令：金色代表领航，青绿色代表键盘或触控，玩家介入时标记“手动接管”。',
    'guide.feature.fps.title': '实时帧率',
    'guide.feature.fps.body': '主抬头显示界面每秒更新一次实际渲染帧率：青绿色表示流畅，金色提示波动，红色表示低帧；它只显示性能，不改变游戏速度。',
    'guide.feature.lighting.title': '光影开关',
    'guide.feature.lighting.body': '“光影 开 / 关”可随时停用真实灯光、高动态范围环境反射与投影阴影；关闭后保留无投影阴影的均匀底光和轻微接地提示，让露天与隧道路面仍清楚可见。开启时仍遵守画质边界：低和中画质不启用动态隧道或桥底聚光，高画质才启用这些局部灯与阴影。切换只改变画面与渲染开销，不修改速度、路线、碰撞、生命或领航。',
    'guide.feature.quality.title': '低 / 中 / 高画质',
    'guide.feature.quality.body': '开始页可先选择画质；飞行中按 O / Esc 暂停后也能切换。低和中画质保留原有直接渲染、全段常亮的隧道灯罩与扩散片，以及道路、墙顶和灯壳的静态基础照度；它们不扫描、不选择也不预热动态隧道或桥底聚光，局部阴影开销为零。高画质除启用电脑超高分辨率预算、程序化物理材质、空间遮蔽、显式辉光与电影级色调外，还独享六盏原生动态聚光、两盏局部阴影，以及按路线边和隧道剖面匹配的电影镜头灯组交接。高画质地貌的颗粒和明暗斑块锁定绝对世界坐标，飞船前进时会相对向后掠过，不会粘住镜头。道路、障碍、可视距离、碰撞、速度与本局进度保持不变。',
    'guide.feature.shipFeedback.title': '飞船动态反馈',
    'guide.feature.shipFeedback.body': '直道有细微姿态、抬升和镜头惯性；转向改变左右尾焰，刹车点亮翼肩反推焰，高速加入光流和视野变化。',
    'guide.feature.audio.title': '动态声景',
    'guide.feature.audio.body': '电驱核心、谐波与风噪已压低到配乐之后；刹车、转向、领航、自动油门、视角、光影、暂停与重启各有独立提示，雷暴按远近发出雷声，雨、风雪、冰雹与沙尘会随露天强度连续变化。普通高架下雨声保持，山体廊道与地下隧道仍能听到压暗、变远的外部雨声，不会完全消失。V 会同时控制并记住全部声音。',
    'guide.feature.music.title': '六境主题曲库',
    'guide.feature.music.body': '十二首逐曲授权的无人声配乐按六境真实内涵组成两章：晨岛苏醒、云野相遇、雨林成长、霞谷竞翔、禁阁回望、伊甸牺牲与重生；母带响度统一，随境模式只在当前地图切换叙事章节。',
    'guide.feature.pause.title': '暂停与舒适性',
    'guide.feature.pause.body': 'O / Esc 暂停会冻结路线、物理与天气时钟；系统“减少动态效果”会收敛镜头、脉冲和强闪电，但不会停止真实障碍或改写碰撞。',
    'guide.feature.pauseRestart.title': '暂停后重新开始',
    'guide.feature.pauseRestart.body': '按 O / Esc 暂停后，可继续当前航程，也可按 R 或点击“重新开始本局”打开二级确认；取消会保持原局暂停，只有明确确认才会完整清理旧航程，并沿用玩家在本页选择的设置建立新局。',
    'guide.shortcut.throttle': '油门模式',
    'guide.shortcut.gear': '降挡 / 升挡',
    'guide.shortcut.autopilot': '自动领航',
    'guide.shortcut.view': '视角',
    'guide.shortcut.cinematic': '电影模式',
    'guide.shortcut.sound': '声音',
    'guide.shortcut.pause': '暂停',
    'guide.shortcut.restart': '重新开始',
    'guide.navigation.kicker': '路线智能',
    'guide.navigation.title': '路线、地图与立交',
    'guide.navigation.intro': '路线图、道路标识、限速提示和飞船位置共享同一份实时导航数据。',
    'guide.authority.eyebrow': '控制权威',
    'guide.authority.title': 'P 优先接管，M 保存满油门偏好',
    'guide.authority.intro': 'P 关闭时，M 在 W 手动与持续满油门之间切换；P 开启时由领航统一拥有纵向权威，M 不再与领航争抢油门。',
    'guide.authority.steering.manual': '手动转向',
    'guide.authority.steering.auto': '领航转向',
    'guide.authority.throttle.manual': '手动油门',
    'guide.authority.throttle.auto': 'M 满油门',
    'guide.authority.throttle.fullThrottle': 'M 满油门',
    'guide.authority.throttle.preferenceOff': 'M 关偏好',
    'guide.authority.throttle.preferenceOn': 'M 开偏好',
    'guide.authority.mode.manual': '全手动驾驶',
    'guide.authority.mode.manualBody': '玩家同时负责车道、路线、加速与刹车。',
    'guide.authority.mode.guided': '领航接管 · M 关偏好',
    'guide.authority.mode.guidedBody': '系统选路、转向、调油与制动；M 只记住退出 P 后回到 W 手动。',
    'guide.authority.mode.cruise': '持续满油门',
    'guide.authority.mode.cruiseBody': 'P 关闭、M 开启：油门保持 100%，速度只由真实推力、阻力、坡度与挡位形成。',
    'guide.authority.mode.full': '领航接管 · M 开偏好',
    'guide.authority.mode.fullBody': '系统选路、转向、调油与制动；M 只记住退出 P 后继续满油门。',
    'guide.authority.brakeNote': '只要 P 开启，障碍、弯道和对向道路边界制动就由同一领航纵向权威处理，与 M 保存的偏好无关；任何制动都会先把推进指令严格归零。',
    'guide.feature.routeMap.title': '看懂路线图',
    'guide.feature.routeMap.body': '地图会按场景切换路线细节、立交总览和分流引导。金白实线是已选路线，金色虚线是候选路线，红色是障碍，蓝色是烛光；优先看顶部下一指令和距分流数值。',
    'guide.feature.straightFork.title': '直道选择岔路',
    'guide.feature.straightFork.body': '连接直道会以平滑曲线分成独立左右支路；中央无路区由暖金内边界和分流、合流鼻锥连续封边。提前横移到目标侧，路线只提交对应一支；未选支路上的障碍和烛光仍留在原路，直到自然驶离或退出视野，不会因选路瞬间消失。',
    'guide.feature.cloverleaf.title': '四入口、十二条路线',
    'guide.feature.cloverleaf.body': '每个入口都有直行、右转和左转：直行留在地上主路，2A 进入山体多孔廊道，2B 进入地下隧道；选路会先决定主线或集散道，再确认最终出口。',
    'guide.feature.tunnelCamera.title': '隧道与净空相机',
    'guide.feature.tunnelCamera.body': '山体廊道保留开放侧孔，地下路线具有真实顶棚碰撞；相机会沿已选路线收低并前视，不用弯道切线穿墙或贴住顶板。',
    'guide.feature.speedGuidance.title': '速度仪表、挡位、限速与刹车',
    'guide.feature.speedGuidance.body': '左上仪表以金色刻度标出 P 领航普通道路约每小时 120 公里的巡航参考，并显示 MT / AT、当前挡精确换挡条件与三挡推荐工作带：1挡 0–90、2挡 70–140、3挡 140–280 km/h；它们不是硬限速。1挡自然约 110 km/h，2挡约 160，3挡约 280。T 独立切换变速箱模式；P 关闭且 M 开启时持续满油门，不受 120 参考限制；P 开启后领航统一调速。MT 高挡低速会拖挡；AT 禁用玩家 Q/E 并按 90 升2、70 降1、140 升3、120 降2 km/h 覆盖三挡。P 的 120 km/h 普通巡航通常保持2挡，无上限满油门可自动进入3挡。电影模式不改变 T、当前挡或换挡权限。松 W 会立即切掉踏板额外推力；贴地1挡会以真实怠速缓慢趋近约 8 km/h，S 可完全停住，2/3挡没有隐藏蠕行。不安全降挡会被拒绝。中央建议速度只在真实弯道需要处理时出现；S / ↓ 与领航共用约 7.5 米/秒² 的真实制动能力。',
    'guide.feature.autopilot.title': 'P 自动领航',
    'guide.feature.autopilot.body': 'P 开启后统一负责选路、转向、油门、滑行与真实风险制动；M 保持可切换，但只保存退出 P 后是 W 手动还是持续满油门，不能再与 P 争权。普通道路以 120 km/h 为领航参考，弯道和障碍会提前收油或制动。电影模式不会开启、关闭或增强 P，也不会改变 P 的目标速度、换挡或跳台计划；它只换镜头并让普通接触不扣生命。',
    'guide.fairness.kicker': '公平飞行合同',
    'guide.fairness.title': '目标、得分与公平合同',
    'guide.fairness.intro': '躲避真实障碍、收集烛光并尽可能飞得更远；速度更高，规则也不会让路。',
    'guide.stat.start': '起步速度',
    'guide.stat.target': '自动巡航',
    'guide.stat.lives': '初始生命',
    'guide.stat.times': '次',
    'guide.rule.coreLoop': '距离会持续转化为得分；目标是在静态与动态障碍压力下存活、选对路线并收集烛光。',
    'guide.rule.scoreCandles': '烛光增加收集数和单次得分；本局累计收集越多，后续单份奖励越高，漏掉烛光或间隔一段时间不会清零。烛光不会直接改写真实速度，手动油门仍需玩家给油。',
    'guide.rule.candleHandling': '每份烛光都会继续提升成长仪表，让飞船颜色由暖金渐变至紫青，并增强横向操控、推进核心转速上限与升转速度；它不直接增加纵向最高速度或碰撞能力，增益会逐渐放缓。',
    'guide.rule.collisions': '普通撞击扣一命；仍有生命时立即获得至少 1.3 秒有效玩法时间的无敌护盾，保护期间重复接触不扣血，暂停会冻结剩余保护，并且不会强制降速。三条生命耗尽后结算。跳台腾空后若未落在任一真实道路上，则属于坠毁并立即结束本局。',
    'guide.rule.obstacles': '障碍、动态障碍和高速压力不会因为领航开启而减少，环境对向飞船则明确不参与碰撞。',
    'guide.rule.noCheat': '普通手动与 P 领航没有锁血、闪现、跳速、穿越碰撞、隐藏捷径或缩减障碍。F 电影模式是明确的演出安全例外：普通接触不扣生命，但它只改变镜头，不替玩家转向、调油、刹车、跳跃或换挡。',
    'guide.rule.sharedControls': '玩家与领航共用烛光强化后的横向操控与推进核心；满推力、降转和刹车能力不因烛光改变，高速光流、镜头体感和天气地表也不能改写真实速度、路线与碰撞。',
    'guide.world.kicker': '鲜活天空世界',
    'guide.world.title': '天气、生态与流动世界',
    'guide.world.intro': '天空、地貌、地图、天气和地表反馈共享真实世界状态，并随时间连续变化。',
    'guide.feature.realmPairing.title': '天空与地面一一对应',
    'guide.feature.realmPairing.body': '晨岛云海对应海洋、云野花庭对应草地、雨林幽光对应湿地、霞谷暮光对应苔原、禁阁星穹对应星界浅滩、伊甸风眼对应火山荒地，共用同一当前区域、下一地区和混合进度。',
    'guide.feature.mapEcology.title': '场景同源地图',
    'guide.feature.mapEcology.body': '小地图直接读取视野中的 96 米地形单元，以及当前可见的地标、环境造物与空中生物；对象编号、绝对坐标和显隐状态与主场景同源，不再额外随机生成。道路、路线与导航始终显示在上层。',
    'guide.feature.landmarks.title': '区域地标与生物',
    'guide.feature.landmarks.body': '六个区域保留各自地标、环境造物、空中生物以及障碍和烛光造型，边界使用同一进度连续混合；所有环境生物只提供世界氛围，不参与玩家速度、路线或碰撞权威。',
    'guide.feature.coveredRoutes.title': '山中多孔立交',
    'guide.feature.coveredRoutes.body': '山体廊桥以连续洞门、开放侧孔、顶棚和灯带包住真实道路，地下路线保留顶棚碰撞净空。',
    'guide.feature.traffic.title': '对向道路与环境船流',
    'guide.feature.traffic.body': '贴地驾驶不能直接横穿中央隔离区；从跳台腾空后，可以完整落入对向道路，随后会接入平顺跨线回程并跳过当前互通。环境飞船使用完整三维造型营造交通感，只在地图留下低亮标记，不造成伤害。',
    'guide.feature.weatherLifecycle.title': '完整天气谱系与缓冲',
    'guide.feature.weatherLifecycle.body': '晴朗、少云、阴天、雾霭、降雨、暴雨、雷暴、冰雹、飘雪、降雪、暴雪、薄霭、浮尘、扬沙和沙尘暴按常识转换；普通天气通常至少稳定 60 秒，形成和消散至少 12 秒，不会硬切或随速度加快。',
    'guide.feature.forecastClouds.title': '预报、云量与强度同源',
    'guide.feature.forecastClouds.body': '预报显示当前、下一天气、到达时间、预计维持和增强/减弱趋势；高空薄云、中层主体云与低层降水云幕会按同一云量和降水浓度形成不同高度、厚度与明暗层次，降雨、降雪、暴雨、暴雪和冰雹会连续加强中低层、扩大覆盖并在道路与桥面安全高度之上压低云底；最低云底仍保持在最高桥面上方 36 米、当前世界高度 45 米。太阳、月亮和雷电会真实照亮不同云层；进入镜头中央视线或贴近相机的云叶会平滑退让，外围云幕密度保持不变，高视角不会钻入低云，沙尘遮蔽也不会伪装成厚云或低云。',
    'guide.feature.precipitation.title': '精细雨雪与世界运动',
    'guide.feature.precipitation.body': '雨滴具有不同长度、亮度和倾角；雪花使用六枝纹理与远近两层。雾与沙尘会在原天气能见度上继续叠加衰减并提前进入近雾；雨、雪、冰雹和沙尘共用近中远包络，镜头周围最低垂直跨度为 72 米，切到高视角也不会看穿顶面或前壁。全部粒子按世界坐标掠过飞船并在暂停时冻结；普通高架桥下只遮住近处雨线，桥外雨幕继续存在，封闭隧道则按已提交路线在洞门处平滑隐藏本地雨景，但户外天气状态不会停止。',
    'guide.feature.surfaceWeather.title': '地表缓慢积累',
    'guide.feature.surfaceWeather.body': '露天路面会随天气逐步形成积水、积雪、雪泥或积尘；隧道内保持干燥。水坑和积雪会改变接地反馈，因此高速时要提前留出转向与制动余量。',
    'guide.feature.shipWeather.title': '飞船接地互动',
    'guide.feature.shipWeather.body': '飞船压过露天积水会产生涟漪、水花与尾流，压过积雪会留下双沟和雪粉；这些接触会给手动和领航施加相同、有限的阻力与侧滑，但不改路线、碰撞或生命。',
    'guide.feature.weatherLighting.title': '全物理光影与雷电',
    'guide.feature.weatherLighting.body': '太阳、月亮与雷电是真实投影光源，太阳始终是露天最主要、最亮的光源；道路之外的地貌与景物也接收真实投影阴影。普通开放桥下保留天空与高动态范围环境能量，由实体桥面自然投影，不再误按深隧道压黑；桥底灯具外观保留，只有高画质的桥底动态聚光会在桥影中心且自然光不足时渐亮，其合计路面照度始终低于太阳，晴朗白天保持关闭。山体廊道与地下隧道沿各自完整路线独立密排灯具；所有画质都让整段灯罩和扩散片始终可见发亮，并让道路、连续墙顶与肋架灯壳在原绘制批次内接收无距离门控的静态基础照度，结构壳、侧墙和道路本身仍不自发光。低和中画质不扫描、不选择也不预热任何动态隧道或桥底聚光，六个聚光槽全部隐藏且局部阴影开销为零。只有高画质启用六盏复用聚光，其中两盏投影阴影；动态隧道灯只选择路线边与隧道剖面同时匹配的原生发射记录，电影模式则完成摄影机最近灯组的平滑交接。接近洞门时只有高画质会根据相机前方路线预备动态灯，洞外照明交接随洞门距离渐入，但不得改变全档灯罩、扩散片和静态基础照度的固定常亮状态。找不到匹配记录时保持关闭，绝不生成跟随飞船的兜底灯。进入洞门后高动态范围环境光、天体直射与曝光连续衰减；仅高画质的匹配聚光在真实灯具下形成有限光池并投影阴影，远处、相邻路线或错误剖面不会串光。封闭隧道还会沿洞门连续移除室外暴雪、浓雾与沙尘造成的能见度衰减，深处恢复当前境界的正常基础雾距。飞船的引擎、烛芯和警示采用可见自发光材质，避免跟随飞船的点光源在道路上产生无灯具亮斑。一千、两千、八千像素级主太阳阴影随低、中、高画质切换，高画质在设备不支持时安全回退至四千像素级；局部阴影目标只由高画质分配。高动态范围天空反射和电影级色调映射继续照亮实际立交道路、地貌、景物、分层云与物理积水；雷暴采用主闪和回闪，而不是单帧硬白。',
    'guide.feature.weatherModes.title': '开局天气分类',
    'guide.feature.weatherModes.body': '开始页可选择无降水版、雨雪风暴版或混合版；选择会约束整局天气目标与预报，形成和消散仍经过常识缓冲，不会硬切。',
    'guide.feature.weatherManual.title': '人工天气测试面板',
    'guide.feature.weatherManual.body': '开发或视觉验收时可使用 manualTest=1 显式开启“自动生命周期”与 15 种即时天气；它可随时切换并恢复自动，只覆盖画面表现，普通玩家默认不会看到测试控件。',
    'guide.feature.weatherManual.prefix': '开发或视觉验收时可使用',
    'guide.feature.weatherManual.suffix': '显式开启“自动生命周期”与 15 种即时天气；它可随时切换并恢复自动，只覆盖画面表现，普通玩家默认不会看到测试控件。',
    'guide.feature.weatherFairness.title': '天气与地表公平合同',
    'guide.feature.weatherFairness.body': '降水粒子、云雾和光影只改变呈现；真实积水、积雪与雪泥接触会对手动和领航施加相同的额外阻力，因此恶劣地表的稳定速度可能低于干地。路线、障碍、碰撞和生命始终不被天气模块改写。',
    'guide.footer.heading': '章节导航',
    'guide.footer.switch': '切换章节',
    'guide.footer.backKey': 'Esc 返回',
    'guide.footer.navigationAria': '章节前后导航',
    'guide.footer.previous': '上一章',
    'guide.footer.next': '下一章',
    'guide.footer.progress': '{current} / {total}',
    'guide.footer.previousAria': '上一章：{chapter}',
    'guide.footer.nextAria': '下一章：{chapter}',
    'guide.footer.synced': 'V23 · 43 项规则已同步',
    'guide.footer.back': '返回上一界面',

    'music.eyebrow': '六境叙事配乐',
    'music.title': '天空旅途音乐库',
    'music.description': '每境两章都按场景真实内涵重配；随境模式会沿当前地图叙事切换，不会把别处的情绪或鼓点串进来。',
    'music.closeAria': '关闭背景音乐库',
    'music.now.disabled': '声音已关闭',
    'music.now.loading': '正在载入',
    'music.now.playing': '正在播放',
    'music.now.ready': '已准备',
    'music.now.waiting': '正在守候',
    'music.now.realmMode': '{realm} · {mode}模式',
    'music.now.initialRealmMode': '晨岛云海 · 随境模式',
    'music.mode.heading': '播放方式',
    'music.mode.title': '旅途方式',
    'music.mode.help': '切换方式只影响曲序，不触碰玩法随机数。',
    'music.mode.groupAria': '背景音乐播放方式',
    'music.mode.adaptive.name': '随境',
    'music.mode.adaptive.short': '跟随当前区域',
    'music.mode.adaptive.description': '随当前天空与地貌区域自动换曲',
    'music.mode.sequential.name': '顺序',
    'music.mode.sequential.short': '按六境旅程',
    'music.mode.sequential.description': '按六区旅程顺序连续播放',
    'music.mode.shuffle.name': '漫游',
    'music.mode.shuffle.short': '独立随机序列',
    'music.mode.shuffle.description': '以独立音乐序列随机播放且不重复当前曲',
    'music.mode.manual.name': '自选',
    'music.mode.manual.short': '循环已选曲目',
    'music.mode.manual.description': '循环玩家亲自选择的主题曲',
    'music.tracks.heading': '六境',
    'music.tracks.title': '六境乐章',
    'music.tracks.contract': '六境叙事与响度合同已校验 · 待玩家试听签收',
    'music.track.aria': '播放{title}，{realm}主题，{tags}',
    'music.track.loading': '正在载入《{title}》并准备柔和换曲…',
    'music.status.unsupported': '当前浏览器无法创建音乐媒体，但仍可查看完整主题与授权清单。',
    'music.status.disabled': '声音总开关已关闭；重新开启后继续当前乐章。',
    'music.status.blocked': '曲目暂未播放；请再次点选，或确认浏览器允许媒体播放。',
    'music.status.playing': '{description}；曲目切换采用 1.6 秒等功率淡化。',
    'music.status.idle': '选择一首乐章即可预听；开始飞行后将按当前模式延续。',
    'music.transportAria': '背景音乐切换控制',
    'music.previousAria': '播放上一首背景音乐',
    'music.nextAria': '播放下一首背景音乐',
    'music.done': '回到旅途',
    'music.track.dawn.title': '初光苏醒',
    'music.track.dawn.tags': '初醒、孤独、第一束光',
    'music.track.prairie.title': '草海听风',
    'music.track.prairie.tags': '草海、好奇、自由',
    'music.track.rainforest.title': '雨幕寻灯',
    'music.track.rainforest.tags': '暴露、庇护、守护微光',
    'music.track.valley.title': '乘风竞翔',
    'music.track.valley.tags': '飞翔、技巧、自信',
    'music.track.vault.title': '星图旧忆',
    'music.track.vault.tags': '记忆、回望、敬畏',
    'music.track.eden.title': '风眼朝圣',
    'music.track.eden.tags': '朝圣、恐惧、牺牲',
    'music.track.dawnAlternate.title': '云阶初翔',
    'music.track.prairieAlternate.title': '花庭相遇',
    'music.track.rainforestAlternate.title': '雨歇余光',
    'music.track.valleyAlternate.title': '霞光回响',
    'music.track.vaultAlternate.title': '静默升阶',
    'music.track.edenAlternate.title': '余烬重生',
    'music.tag.dawnLight': '初醒',
    'music.tag.cloudsea': '孤独',
    'music.tag.calmExploration': '第一束光',
    'music.tag.cloudborne': '勇气',
    'music.tag.dreamlight': '初次飞行',
    'music.tag.gentleDeparture': '云海',
    'music.tag.flowerFields': '草海',
    'music.tag.wonder': '好奇',
    'music.tag.warmJourney': '自由',
    'music.tag.flowerValley': '伙伴',
    'music.tag.bright': '嬉游',
    'music.tag.freeRoaming': '花庭',
    'music.tag.forest': '暴露',
    'music.tag.rainWashed': '庇护',
    'music.tag.quietEchoes': '守护微光',
    'music.tag.hiddenForest': '失落',
    'music.tag.fireflyGlow': '道歉',
    'music.tag.explorationEchoes': '重新成长',
    'music.tag.racing': '飞翔',
    'music.tag.flight': '技巧',
    'music.tag.brightMomentum': '自信',
    'music.tag.highSpeed': '竞逐',
    'music.tag.synthesizer': '玩心',
    'music.tag.afterglowPulse': '旅程高潮',
    'music.tag.weightlessness': '记忆',
    'music.tag.starCanopy': '回望',
    'music.tag.airySuspension': '敬畏',
    'music.tag.starsea': '智慧',
    'music.tag.cruise': '升阶',
    'music.tag.deepSpaceDrift': '静默',
    'music.tag.storm': '朝圣',
    'music.tag.highPressure': '恐惧',
    'music.tag.restrainedTension': '牺牲',
    'music.tag.pulse': '释放',
    'music.tag.stormeye': '慈悲',
    'music.tag.deepIntensity': '重生',

    'touch.groupAria': '触控驾驶',
    'touch.leftAria': '按住向左移动',
    'touch.jumpAria': '起飞',
    'touch.rightAria': '按住向右移动',
    'touch.throttleAria': '按住加速',
    'touch.brakeAria': '按住刹车',

    'update.eyebrow': 'V23 实时更新',
    'update.title': '游戏正在更新',
    'update.message': '当前版本正在同步。检查通过后仍可进入；若核心文件或图形环境无法正常加载，将只提供重新加载。',
    'update.checking': '正在确认游戏是否可以正常运行……',
    'update.details': '{source}：{noticeId} · 有效至 {expiresAt}',
    'update.source.releaseMarker': '版本标记',
    'update.source.modelDebug': '调试模式',
    'update.details.releaseMarker': '版本标记：{noticeId} · 有效至 {expiresAt}',
    'update.details.modelDebug': '调试模式：{noticeId} · 有效至 {expiresAt}',
    'update.ready': '运行检查已通过。你可以继续进入开始页，或重新加载以获取最新文件。',
    'update.continue': '仍要游玩',
    'update.reload': '重新加载',
    'update.continueFailure': '继续游戏时发生错误，已切换为安全恢复模式。请重新加载页面。',

    'error.eyebrow': 'V23 启动恢复',
    'error.title': '游戏暂时无法启动',
    'error.message': '请重新加载页面，或检查浏览器图形能力和游戏文件完整性。',
    'error.technical': '技术信息',
    'error.reload': '重新加载',
    'error.webgl': '浏览器无法创建网页三维图形环境。请开启硬件加速、更新浏览器或更换支持网页三维图形的设备后重试。',
    'error.dependency': '游戏核心依赖未能加载。请确认游戏目录完整，然后重新加载页面。',
    'error.windowsLocalFile': 'Windows 浏览器隔离了直接打开的本地脚本，真实错误无法可靠读取。请在游戏目录双击“启动Windows本地游戏.cmd”；启动器会先检查文件完整性，再仅在本机打开游戏。',
    'error.initialization': '游戏初始化未完成。请重新加载页面；若问题持续，请检查浏览器图形能力和游戏文件完整性。',
    'error.runtimeTitle': '游戏已安全停止',
    'error.runtimeMessage': '游戏运行时遇到错误并已停止。请重新加载页面后重试。',
    'error.graphicsTitle': '图形环境已中断',
    'error.graphicsMessage': '游戏已安全停止。请重新加载；若问题持续，请开启硬件加速或更换支持网页三维图形的浏览器。',
    'error.canvasAria': '游戏画面：按住鼠标左键拖动可自由观察，松开后平滑回正',

    'hint.main': 'V23 天际晨航：从每小时 0 公里静止起步；松 W 立即切掉踏板额外推力，贴地1挡像汽车一样以真实怠速缓慢蠕行，S 可完全停住；推进核心与尾焰会按余转自然衰减。P 关闭时，M 在 W 手动与持续满油门之间切换，满油门没有 120 km/h 目标上限；P 开启时由领航统一调油、滑行和制动。T 独立切换 MT / AT；MT 用 Q / E 控制三挡，低速高挡会拖挡甚至完全失速；AT 禁用玩家 Q/E，并按 90 / 70 与 140 / 120 km/h 两组门槛自动覆盖三挡。F 只切换电影镜头并提供不扣生命的演出保护，不改变或屏蔽 P、M、T、方向、油门、刹车、跳跃与换挡。'
  });

  const EN = Object.freeze({
    'document.title': 'Neon Autopilot V23 · Sky Dawnflight',
    'language.switch.visible': 'Chinese',
    'language.switch.compact': 'ZH',
    'language.switch.aria': 'Switch to the Chinese interface',
    'language.name.current': 'English',

    'common.on': 'On',
    'common.off': 'Off',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'common.unavailable': 'Unavailable',
    'common.enter': 'Enter',
    'common.exit': 'Exit',
    'common.loading': 'Loading',
    'common.ready': 'Ready',
    'common.waiting': 'Standing by',
    'common.select': 'Select',
    'common.playing': 'Playing',
    'common.willPlay': 'Up next',
    'common.none': 'None',
    'common.manual': 'Manual',
    'common.automatic': 'Automatic',
    'common.standby': 'Standby',
    'common.current': 'Current',
    'common.next': 'Next',
    'common.stable': 'Steady',
    'common.keepCurrent': 'Holding',
    'common.approxSeconds': 'About {value} seconds',
    'common.approxMinutes': 'About {value} minutes',
    'common.meters': '{value} m',
    'common.kilometers': '{value} km',
    'common.kilometersPerHour': '{value} km/h',
    'common.framesPerSecond': '{value} FPS',
    'common.hudMark': 'HUD',
    'common.fpsMark': 'FPS',
    'common.effectsMark': 'FX',

    'hud.sound': 'Sound',
    'hud.musicLibrary': 'Music',
    'hud.sound.openLibrary': 'Open the sky-realm music library',
    'hud.sound.library': 'Music',
    'hud.sound.onAria': 'Sound is on; activate to turn it off',
    'hud.sound.offAria': 'Sound is off; activate to turn it on',
    'hud.sound.unsupportedAria': 'Game audio is unavailable in this browser',
    'hud.mobile.telemetryRegion': 'Flight instruments',
    'hud.mobile.telemetry': 'Gauges',
    'hud.mobile.navigation': 'Map',
    'hud.mobile.glanceAria': 'Critical flight information',
    'hud.mobile.flightDeckAria': 'Mobile flight deck',
    'hud.mobile.speed': 'Speed',
    'hud.mobile.route': 'Route',
    'hud.mobile.autopilotAria': 'Autopilot status',
    'hud.mobile.utilitiesAria': 'Display and sound tools',
    'hud.mobile.utilities.expandAria': 'Expand display and sound tools',
    'hud.mobile.utilities.collapseAria': 'Collapse display and sound tools',
    'hud.mobile.controlDockAria': 'Flight quick actions',
    'hud.mobile.touchControlsAria': 'Touch flight controls',
    'hud.mobile.telemetry.expandAria': 'Expand detailed flight instruments',
    'hud.mobile.telemetry.collapseAria': 'Collapse detailed flight instruments',
    'hud.mobile.navigation.expandAria': 'Expand the route map and full controls',
    'hud.mobile.navigation.collapseAria': 'Collapse the route map and full controls',
    'hud.score': 'Score',
    'hud.speedometer.label': 'Speedometer',
    'hud.speedometer.target': 'P cruise',
    'hud.speedometer.launch': 'Launch',
    'hud.speedometer.cruise': 'Cruise',
    'hud.speedometer.high': 'High speed',
    'hud.speedometer.sprint': 'Sprint',
    'hud.speedometer.targetReached': 'Cruise reached',
    'hud.speedometer.overTarget': 'Manual high speed',
    'hud.speedometer.valueAria': '{speed} kilometers per hour',
    'hud.speedometer.scaleHelp': 'The gold tick marks P Autopilot’s ordinary {target} km/h cruise reference. With P off and M on, throttle stays fully pressed and is not limited by that reference. Gear 1 naturally settles near 110 km/h, Gear 2 near 160, and Gear 3 near 280. The needle, blue band, and number always show true speed.',
    'hud.speedometer.scaleHelpInitial': 'The gold tick marks P Autopilot’s ordinary 120 km/h cruise reference. With P off and M on, throttle stays fully pressed and is not limited by that reference. Gear 1 naturally settles near 110 km/h, Gear 2 near 160, and Gear 3 near 280. The needle, blue band, and number always show true speed.',
    'gear.indicator': 'Gear',
    'gear.initialLabel': 'Gear 1',
    'gear.initialIndicatorAria': 'Propulsion gear 1. Engaged',
    'gear.label': 'Gear {gear}',
    'gear.performanceLabel': 'Gear {gear} · High/Ramp',
    'gear.indicatorAria': 'Propulsion gear {gear}. {state}',
    'gear.downAria': 'Shift down (Q)',
    'gear.upAria': 'Shift up (E)',
    'gear.panelAria': 'Transmission mode and shift ranges',
    'gear.mode.manual': 'MT Manual',
    'gear.mode.automatic': 'AT Automatic',
    'gear.mode.manualShort': 'MT Manual',
    'gear.mode.automaticShort': 'AT Auto',
    'gear.mode.manualAria': 'Manual transmission enabled; press T to switch to automatic',
    'gear.mode.automaticAria': 'Automatic transmission enabled; press T to switch to manual',
    'gear.mode.mobileManualAria': 'Manual transmission enabled; tap to switch to automatic',
    'gear.mode.mobileAutomaticAria': 'Automatic transmission enabled; tap to switch to manual',
    'gear.rangeBandsAria': 'Recommended working bands: Gear 1, 0 to 90 km/h; Gear 2, 70 to 140 km/h; Gear 3, 140 to 280 km/h',
    'gear.operatingRange.1': 'G1 · REC 0–90 · E→2 ≥70',
    'gear.operatingRange.2': 'G2 · REC 70–140 · Q→1 ≤125 · E→3 ≥140',
    'gear.operatingRange.3': 'G3 · REC 140–280 · Q→2 ≤190',
    'gear.automaticRange.1': 'AT · G1 · AUTO 1→2 ≥90',
    'gear.automaticRange.2': 'AT · G2 · ≤70→G1 · ≥140→G3',
    'gear.automaticRange.3': 'AT · G3 · AUTO 3→2 ≤120',
    'gear.operatingRangeAria.1': 'Gear 1, recommended from 0 to 90 km/h; shift into Gear 2 with E at or above 70 km/h',
    'gear.operatingRangeAria.2': 'Gear 2, recommended from 70 to 140 km/h; shift into Gear 1 with Q at or below 125 km/h, or Gear 3 with E at or above 140 km/h',
    'gear.operatingRangeAria.3': 'Gear 3, recommended from 140 to 280 km/h; shift into Gear 2 with Q at or below 190 km/h',
    'gear.automaticRangeAria.1': 'Automatic transmission in Gear 1; it shifts into Gear 2 at 90 km/h',
    'gear.automaticRangeAria.2': 'Automatic transmission in Gear 2; it shifts into Gear 1 at 70 km/h and Gear 3 at 140 km/h',
    'gear.automaticRangeAria.3': 'Automatic transmission in Gear 3; it shifts into Gear 2 at 120 km/h',
    'gear.automaticLuggingLabel': 'LOW RPM · AUTO→G{gear}',
    'gear.automaticLuggingAria': 'The current high gear is in its low-RPM range and propulsion is limited; continued slowing automatically shifts into Gear {gear}',
    'gear.automaticStalledLabel': 'STALLED · AUTO→G{gear}',
    'gear.automaticStalledAria': 'The current high gear is stalled and thrust has cut; the automatic transmission is shifting into Gear {gear}',
    'gear.luggingLabel': 'LUGGING · Q→G{gear}',
    'gear.luggingAria': 'The selected high gear is too slow and propulsion is being continuously reduced; press Q to shift down to safe Gear {gear}',
    'gear.stalledLabel.single': 'STALLED · Q→G{gear}',
    'gear.stalledLabel.multiple': 'STALLED · Q×{count}→G{gear}',
    'gear.stalledAria.single': 'The selected gear is fully stalled and thrust is zero; press Q now to shift down to safe Gear {gear}',
    'gear.stalledAria.multiple': 'The selected gear is fully stalled and thrust is zero; press Q {count} times now to shift down to safe Gear {gear}',
    'gear.alert.luggingTitle': 'HIGH-GEAR LUGGING',
    'gear.alert.stalledTitle': 'HIGH-GEAR STALL',
    'gear.alert.luggingMeta': 'PROPULSION LIMITED · RPM FALLING',
    'gear.alert.stalledMeta': 'ZERO THRUST · DOWNSHIFT NOW',
    'gear.shiftState.engaged': 'Engaged',
    'gear.shiftState.shifting': 'Shifting: Gear {from} to Gear {to}',
    'gear.shiftState.rejected': 'Shift rejected',
    'gear.rejection.automatic': 'Automatic transmission owns shifting; press T for manual before using Q/E',
    'gear.rejection.overspeed': 'Current speed is too high; downshift rejected',
    'gear.rejection.underspeed': 'Current speed is too low; upshift rejected',
    'gear.rejection.invalid-gear': 'The requested gear is invalid',
    'gear.rejection.shift-in-progress': 'The current shift is still in progress',
    'gear.rejectionShort.automatic': 'Auto owns',
    'gear.rejectionShort.overspeed': 'Too fast',
    'gear.rejectionShort.underspeed': 'Too slow',
    'gear.rejectionShort.invalid-gear': 'Invalid',
    'gear.rejectionShort.shift-in-progress': 'Busy',
    'gear.help': 'T switches the manual or automatic transmission independently. M stores full-throttle hold: with P off, M keeps the pedal at 100% with no target-speed cap; with P on, Autopilot alone commands throttle, coast, and braking. Releasing the pedal cuts excess pedal thrust immediately, while grounded Gear 1 retains real idle torque and slowly settles near 8 km/h on a dry level road. S can stop and hold the craft completely; shifts, airborne motion, and Gears 2/3 never receive hidden creep. Manual displays Q / E and lets them request adjacent gears through the published working bands; Gear 3 is the high-performance road and ramp stage, while a slow high gear lugs and can stall to zero thrust. Automatic owns all three gears and hides the desktop and touch Q / E controls to reclaim layout space while retaining the live gear, exact automatic thresholds, and all three working bands: 1→2 at 90 km/h, 2→1 at 70, 2→3 at 140, and 3→2 at 120. Both 20 km/h hysteresis bands prevent threshold chatter. P’s ordinary 120 km/h cruise normally remains in Gear 2, while uncapped full throttle with P off can automatically reach Gear 3. Film mode changes only the camera; manual-control visibility always follows the current MT / AT authority.',
    'hud.propulsion.label': 'Propulsion core',
    'hud.propulsion.rpm': 'RPM',
    'hud.propulsion.thrust': 'Thrust',
    'hud.propulsion.netAcceleration': 'Net accel.',
    'hud.propulsion.rpmInitialAria': 'Propulsion core speed: 1,800 rpm',
    'hud.propulsion.rpmAria': 'Propulsion core speed: {rpm} rpm',
    'hud.propulsion.help': 'Core speed, pedal thrust, first-gear idle torque, and net acceleration come from one propulsion state. Exhaust also reads authoritative residual core rotation for a natural afterglow, never keys or speed. The current RPM ceiling grows with candlelight.',
    'hud.propulsion.state.idle': 'Idle',
    'hud.propulsion.state.creep': 'Idle creep',
    'hud.propulsion.state.spooling': 'Spooling',
    'hud.propulsion.state.shifting': 'Shift torque cut',
    'hud.propulsion.state.lugging': 'Lugging',
    'hud.propulsion.state.stalled': 'Stalled',
    'hud.propulsion.state.thrust': 'Thrust',
    'hud.propulsion.state.coast': 'Coast',
    'hud.propulsion.state.braking': 'Braking',
    'hud.distance': 'Distance',
    'hud.candlelight': 'Candlelight',
    'hud.handling': 'Growth',
    'hud.handling.help': 'Collecting candlelight gradually shifts the craft from warm gold through violet to cyan while improving lateral handling, propulsion-core RPM ceiling, and spool-up speed with diminishing returns. Manual flight and autopilot share one growth profile.',
    'hud.handling.valueAria': '{count} candlelights collected; growth capability {value}',
    'hud.handling.initialAria': '0 candlelights collected; growth capability 55.0%',
    'hud.best': 'Best',
    'hud.lives': 'Lives',
    'hud.lives.valueAria': '{current} of {maximum} lives',
    'hud.lives.initialAria': '3 of 3 lives',
    'hud.damage.shield': 'Invulnerability shield',
    'hud.damage.announcement': 'Collision. {current} lives remain; invulnerability shield active for {seconds} seconds.',
    'hud.damage.depletedAnnouncement': 'Collision. No lives remain.',
    'hud.hoodCollisionGuide.label': 'True collision envelope',
    'hud.hoodCollisionGuide.width': 'W {width} m',
    'hud.hoodCollisionGuide.dimensions': 'H {height} · L {length} m',
    'hud.hoodCollisionGuide.projection': 'Equal-size copy {distance} m ahead',
    'hud.hoodCollisionGuide.range': '{distance} m',
    'hud.lateralPosition': 'Lateral position',
    'hud.lateralPosition.left': 'Left',
    'hud.lateralPosition.right': 'Right',
    'hud.lateralPosition.center': 'Centered',
    'hud.lateralPosition.leftValue': 'Left {value}%',
    'hud.lateralPosition.rightValue': 'Right {value}%',
    'hud.frameRate': 'Frame rate',
    'hud.frameRate.realtimeAria': 'Live frame rate',
    'hud.frameRate.pending': 'Sampling',
    'hud.frameRate.pendingAria': 'Waiting for the first sample',
    'hud.frameRate.pendingValue': '-- FPS',
    'hud.frameRate.smooth': 'Smooth',
    'hud.frameRate.watch': 'Variable',
    'hud.frameRate.low': 'Warning',
    'hud.frameRate.critical': 'Critical',
    'hud.frameRate.valueAria': '{fps} frames per second, {state}',
    'hud.autopilot': 'Autopilot',
    'hud.autopilot.onValue': 'ON',
    'hud.autopilot.offValue': 'OFF',
    'hud.autopilot.onAria': 'Autopilot is on; activate to turn it off',
    'hud.autopilot.offAria': 'Autopilot is off; activate to turn it on',
    'hud.throttle': 'Auto throttle',
    'hud.throttle.onAria': 'Full-throttle hold is on; with P off the pedal stays at 100% with no target-speed cap. Activate to turn it off',
    'hud.throttle.offAria': 'Full-throttle hold is off; with P off W owns throttle. Activate to turn it on',
    'hud.throttle.fullThrottle': 'Full throttle',
    'hud.throttle.autopilotOwned': 'P takeover',
    'hud.throttle.preferenceOn': 'resume full throttle after P exits',
    'hud.throttle.preferenceOff': 'resume manual W throttle after P exits',
    'hud.throttle.autopilotAria': 'Autopilot currently owns throttle; the saved M preference is “{preference}”. Activate to change the post-Autopilot preference',
    'hud.view': 'View',
    'hud.cinematic': 'Film',
    'hud.pause': 'Pause',
    'hud.continue': 'Continue',
    'hud.pause.running': 'Running',
    'hud.pause.paused': 'Paused',
    'hud.pause.runningAria': 'Game running; activate to pause',
    'hud.pause.pausedAria': 'Game paused; activate to continue',
    'hud.lighting': 'Lighting',
    'hud.lighting.onAria': 'Physical lighting is on; activate to turn it off',
    'hud.lighting.offAria': 'Physical lighting is off; activate to turn it on',
    'hud.fullscreen': 'Fullscreen',
    'hud.fullscreen.enterAria': 'Enter fullscreen',
    'hud.fullscreen.exitAria': 'Exit fullscreen',
    'hud.fullscreen.unsupportedAria': 'Fullscreen is unavailable in this browser',
    'hud.fullscreen.unsupportedFallback': 'No fullscreen',
    'hud.fullscreen.enterFallback': 'Fullscreen',
    'hud.fullscreen.exitFallback': 'Exit fullscreen',
    'hud.fullscreen.denied': 'The browser denied the fullscreen request. The game can continue in this window.',
    'hud.fullscreen.policyDenied': 'This page policy blocks fullscreen. Allow it in browser settings and try again.',

    'weather.forecast.title': 'Weather forecast',
    'weather.current': 'Current',
    'weather.next': 'Next weather',
    'weather.eta': 'Expected change',
    'weather.duration': 'Next phase length',
    'weather.calculating': 'Calculating',
    'weather.strength': 'Weather intensity',
    'weather.surfaceContact': 'Surface contact',
    'weather.surfaceContactAria': 'Surface contact: {surface}',
    'weather.surfaceContactInitialAria': 'Surface contact: dry',
    'weather.announcement': 'Current weather: {current}. Next: {next}.',
    'weather.announcement.initial': 'Current weather: clear. Next: partly cloudy.',
    'weather.forecastAria': 'Weather forecast: {mode}. Current {current}; next {next}; {eta}; trend {trend}; intensity {intensity}%.',
    'weather.forecastAnnouncement': 'Current {current}; next {next}; {eta}; trend {trend}.',
    'weather.trend.strengthening': 'Strengthening',
    'weather.trend.easing': 'Easing',
    'weather.trend.steady': 'Steady',
    'weather.trend.transition': '{trend} · transition {percent}%',
    'weather.test.title': 'Manual weather test',
    'weather.test.visualOnly': 'Visual only',
    'weather.test.instant': 'Instant weather',
    'weather.test.instantAria': 'Manual instant-weather test',
    'weather.test.automaticLifecycle': 'Automatic lifecycle',
    'weather.test.automaticStatus': 'Automatic lifecycle · shared pausable weather clock',
    'weather.test.overrideStatus': '{icon} {weather} · instant override active',
    'weather.test.manualLock': 'Manual lock',
    'weather.test.fixtureLock': 'Test lock',
    'weather.test.locked': 'Test locked',
    'weather.test.manualDescription': 'The manual test overrides current visuals. Switch weather or restore the automatic lifecycle at any time.',
    'weather.test.fixtureDescription': 'Fixed weather is for visual acceptance only; the player category is temporarily locked.',
    'weather.mode.runLocked': 'Locked for this run. {description}',
    'weather.type.clear': 'Clear',
    'weather.type.partlyCloudy': 'Partly cloudy',
    'weather.type.cloudy': 'Cloudy',
    'weather.type.mist': 'Mist',
    'weather.type.rain': 'Rain',
    'weather.type.heavyRain': 'Heavy rain',
    'weather.type.thunderstorm': 'Thunderstorm',
    'weather.type.hail': 'Hail',
    'weather.type.flurry': 'Flurries',
    'weather.type.snow': 'Snow',
    'weather.type.blizzard': 'Blizzard',
    'weather.type.haze': 'Haze',
    'weather.type.dustHaze': 'Dust haze',
    'weather.type.blowingDust': 'Blowing dust',
    'weather.type.sandstorm': 'Sandstorm',
    'weather.mode.dry.name': 'No precipitation',
    'weather.mode.dry.icon': 'Clear',
    'weather.mode.dry.description': 'Clear skies, clouds, and mist cycle without rain, snow, hail, or dust weather.',
    'weather.mode.severe.name': 'Rain, snow, and storms',
    'weather.mode.severe.icon': 'Storm',
    'weather.mode.severe.description': 'Each region cycles through its possible rain, snow, hail, or dust weather with the required buffers.',
    'weather.mode.mixed.name': 'Mixed weather',
    'weather.mode.mixed.icon': 'Mixed',
    'weather.mode.mixed.description': 'Clear, cloudy, and severe weather rotate naturally with the local climate.',
    'weather.surface.dry': 'Dry',
    'weather.surface.water': 'Standing water',
    'weather.surface.snow': 'Snow cover',
    'weather.surface.slush': 'Slush',

    'navigation.eyebrow': 'Live navigation',
    'navigation.title': 'Route navigation',
    'navigation.routeInitial': 'Trunk · 620 m ahead',
    'navigation.displayModeAria': 'Map display mode',
    'navigation.mode.standard': 'Local navigation',
    'navigation.mode.roadDetail': 'Cruise detail',
    'navigation.mode.overview': 'Interchange overview',
    'navigation.mode.guided': 'Route locked',
    'navigation.orientation.northUp': 'North up',
    'navigation.orientation.headingUp': 'Heading up',
    'navigation.instructionAria': 'Current route instruction',
    'navigation.instruction': 'Route instruction',
    'navigation.keepRoute': 'Stay on route',
    'navigation.routeHold': 'Holding route',
    'navigation.aheadMeters': '{distance} m ahead',
    'navigation.sign.distance': '{value} m',
    'navigation.speedLimitAhead': 'Speed limit ahead',
    'navigation.legend.selected': 'Selected',
    'navigation.legend.proposed': 'Proposed',
    'navigation.legend.hazard': 'Hazard',
    'navigation.legend.candlelight': 'Candlelight',
    'navigation.legend.traffic': 'Traffic',
    'navigation.legendHelp': 'Gold-white solid lines show the selected route, gold dashed lines show candidate routes, red marks hazards, blue marks candlelight, and gray-blue arrows show ambient traffic. Dashed sections may be tunnels or lower roads.',
    'navigation.cloverleafAria': 'Cloverleaf interchange navigation status',
    'navigation.targetExit': 'Target exit',
    'navigation.distanceToSplit': 'To split',
    'navigation.brake': 'Brake',
    'navigation.brakeManual': 'Manual 7.5',
    'navigation.brakeAutomatic': 'Auto 7.5',
    'navigation.headingAria': 'Live heading {bearing} degrees, {direction}',
    'navigation.headingInitialAria': 'Live heading 000 degrees, north',
    'navigation.currentTrunk': 'Currently on the trunk route',
    'navigation.route.trunk': 'Trunk',
    'navigation.route.left': 'Left route',
    'navigation.route.right': 'Right route',
    'navigation.route.leftBranch': 'Left branch',
    'navigation.route.rightBranch': 'Right branch',
    'navigation.route.interchange': 'Interchange',
    'navigation.route.interchangeRoad': 'Interchange road',
    'navigation.route.leftConnector': 'Left connector',
    'navigation.route.rightConnector': 'Right connector',
    'navigation.route.surfaceMain': 'Surface mainline',
    'navigation.route.mountainTunnel': 'Mountain tunnel',
    'navigation.route.undergroundTunnel': 'Underground tunnel',
    'navigation.route.mountainTunnelExit': '2A mountain tunnel · {direction}',
    'navigation.route.undergroundTunnelExit': '2B underground tunnel · {direction}',
    'navigation.route.surfaceExit': 'Surface mainline · {direction}',
    'navigation.route.leftFork': 'Left fork',
    'navigation.route.rightFork': 'Right fork',
    'navigation.phase.entryTurn': 'Entry turn',
    'navigation.phase.collector': 'Collector road',
    'navigation.phase.transferTurn': 'Transfer turn',
    'navigation.phase.newRoute': 'New route',
    'navigation.phase.returnTurn': 'Return turn',
    'navigation.phase.connector': 'Connector',
    'navigation.level.upper': 'Upper level',
    'navigation.level.underBridge': 'Under bridge',
    'navigation.launchFork': 'Ramp fork',
    'navigation.aheadInterchange': 'Trunk · interchange ahead',
    'navigation.aheadLaunch': 'Trunk · ramp fork ahead',
    'navigation.roadDetailStatus': 'Cruise detail · {obstacle} · candlelight {pickupCount}',
    'navigation.obstacleDistance': 'Hazard {distance} m',
    'navigation.noObstacle': 'No hazard ahead',
    'navigation.noMappedObstacle': 'No mapped hazard ahead',
    'navigation.statusRoadDetail': '{mode}: {obstacle}; {pickupCount} candlelights on map; {authority}',
    'navigation.statusRoute': '{mode}: on {road}; target {target}',
    'navigation.autopilotOn': 'Autopilot on',
    'navigation.manualDriving': 'Manual flight',
    'navigation.exit': 'Exit {direction}',
    'navigation.mapFatalTitle': 'Navigation map stopped safely',
    'navigation.mapFatalMessage': 'The navigation map encountered an unrecoverable error, so the game stopped safely. Reload the page and try again.',
    'navigation.mapRecoveryFatalMessage': 'Navigation-map recovery failed repeatedly, so the game stopped safely. Reload the page and try again.',
    'navigation.canvas.upper': 'U',
    'navigation.canvas.lower': 'L',
    'navigation.canvas.split': 'S',
    'navigation.canvas.merge': 'M',
    'navigation.station.entry': 'In',
    'navigation.station.collector': 'Col',
    'navigation.station.transfer': 'Xfer',
    'navigation.station.newRoute': 'New',
    'navigation.station.merge': 'Join',

    'direction.n': 'North',
    'direction.n.compact': 'N',
    'direction.nne': 'North-northeast',
    'direction.ne': 'Northeast',
    'direction.ene': 'East-northeast',
    'direction.e': 'East',
    'direction.ese': 'East-southeast',
    'direction.se': 'Southeast',
    'direction.sse': 'South-southeast',
    'direction.s': 'South',
    'direction.ssw': 'South-southwest',
    'direction.sw': 'Southwest',
    'direction.wsw': 'West-southwest',
    'direction.w': 'West',
    'direction.wnw': 'West-northwest',
    'direction.nw': 'Northwest',
    'direction.nnw': 'North-northwest',
    'direction.heading': 'Heading',

    'autopilot.panelEyebrow': 'Flight director',
    'autopilot.panelTitle': 'Autopilot',
    'autopilot.strategy': 'Strategy',
    'autopilot.risk': 'Risk',
    'autopilot.direction': 'Direction',
    'autopilot.ahead': 'Ahead',
    'autopilot.summaryAria': 'Autopilot summary',
    'autopilot.intent': 'Intent',
    'autopilot.intent.manualHold': 'Manual hold',
    'autopilot.intent.laneHold': 'Hold road',
    'autopilot.intent.collectCandlelight': 'Collect candlelight',
    'autopilot.intent.routeChoice': 'Choose route',
    'autopilot.intent.avoidThreat': 'Avoid threat',
    'autopilot.risk.clear': 'Clear',
    'autopilot.risk.guarded': 'Guarded',
    'autopilot.risk.elevated': 'Elevated',
    'autopilot.risk.critical': 'Critical',
    'autopilot.riskMeterAria': 'Autopilot risk',
    'autopilot.risk.initialAria': 'Clear, 0%',
    'autopilot.risk.valueAria': '{level}, {value}%',
    'autopilot.lateralAuthority': 'Lateral authority',
    'autopilot.longitudinalAuthority': 'Longitudinal authority',
    'autopilot.brakeReason': 'Brake reason',
    'autopilot.nearestThreat': 'Nearest threat / TTC',
    'autopilot.authority.manual': 'Manual',
    'autopilot.authority.autopilot': 'Autopilot',
    'autopilot.authority.manualTakeover': 'Manual takeover',
    'autopilot.longitudinal.manual': 'Manual throttle',
    'autopilot.longitudinal.cruise': 'Autopilot cruise',
    'autopilot.longitudinal.fullThrottle': 'Full-throttle hold',
    'autopilot.longitudinal.autopilot': 'Autopilot speed',
    'autopilot.brake.standby': 'Standby',
    'autopilot.brake.manual': 'Manual braking',
    'autopilot.brake.curve': 'Automatic curve braking',
    'autopilot.brake.opposingBoundary': 'Opposing-road boundary braking',
    'autopilot.brake.obstacle': 'Automatic obstacle braking',
    'autopilot.threat.none': 'None · TTC —',
    'autopilot.threat.distanceTtc': '{distance} · TTC {ttc} s',
    'autopilot.authoritySummary.initial': 'Lateral manual · Longitudinal manual · Brake standby',
    'autopilot.authoritySummary.initialAria': 'Lateral manual, longitudinal manual, brake standby',
    'autopilot.authoritySummary.value': 'Lateral {lateral} · Longitudinal {longitudinal} · {brake}',
    'autopilot.authoritySummary.valueAria': 'Lateral {lateral}, longitudinal {longitudinal}, {brake}',
    'autopilot.announcement.authority': 'Control authority changed: {summary}',
    'autopilot.announcement.brake': 'Brake state: {brake}',
    'autopilot.goal.candlelight': 'Collect candlelight',
    'autopilot.status.calibrating': 'Takeover calibration',
    'autopilot.status.idle': 'Idle',
    'autopilot.status.scanning': 'Takeover scan',
    'autopilot.status.airborne': 'Airborne',
    'autopilot.status.cooldown': 'Cooldown',
    'autopilot.status.airbornePass': 'Airborne pass',
    'autopilot.status.fullWidthSafe': 'Full-width safe',
    'autopilot.status.corridorWide': 'Wide {width}',
    'autopilot.status.corridorNarrow': 'Narrow {width}',
    'autopilot.status.corridorVeryNarrow': 'Very narrow corridor',
    'autopilot.status.contractSurvival': 'V23 target-speed survival',
    'autopilot.status.highSpeedSurvival': 'V23 high-speed survival',
    'autopilot.status.extremeAvoidance': 'V23 extreme avoidance',
    'autopilot.status.dynamicAvoidance': 'V23 dynamic avoidance',
    'autopilot.status.safetyFirst': 'V23 safety first',
    'autopilot.status.highSpeedSafety': 'V23 high-speed safety',
    'autopilot.status.candlelightLocked': 'V23 candlelight lock',
    'autopilot.status.collectAlongRoute': 'V23 en-route collection',
    'autopilot.status.cloudCruise': 'V23 cloud-route cruise',
    'autopilot.status.preselectRoute': 'V23 preselect {route}',
    'autopilot.status.enterRoute': 'V23 enter {route}',
    'autopilot.status.routeGuidance': 'V23 guide {route}',
    'autopilot.status.safeCruise': 'V23 safe cruise',
    'autopilot.status.closeCorrection': 'V23 close correction',
    'autopilot.status.corridorPressure': 'Corridor constrained',
    'autopilot.status.closeAvoidance': 'Close avoidance',
    'autopilot.status.instantAvoidance': 'V23 immediate avoidance',
    'autopilot.status.instantLine': 'Immediate edge line',
    'autopilot.status.instantCorridor': 'Immediate corridor',
    'autopilot.status.forcedAvoidance': 'V23 forced avoidance',
    'autopilot.status.closeEscort': 'V23 close escort',
    'autopilot.status.escortPass': 'Escort pass',
    'autopilot.status.lineAvoidance': 'Edge-line avoidance',
    'autopilot.status.collisionFailed': 'Collision failure',
    'autopilot.status.noInsurance': 'No protection',

    'input.title': 'Live input',
    'input.key.space': 'Space',
    'input.mode.manualTakeover': 'Manual takeover',
    'input.mode.autopilotInput': 'Autopilot input',
    'input.mode.autopilot': 'Autopilot',
    'input.mode.manualInput': 'Manual input',
    'input.authority.manualTakeover': 'Autopilot on, manual takeover active',
    'input.authority.autopilotActive': 'Autopilot input active',
    'input.authority.autopilotStandby': 'Autopilot standing by',
    'input.authority.manual': 'Manual flight',
    'input.source.autopilot': 'autopilot',
    'input.source.manual': 'manual',
    'input.none': 'no active input',
    'input.aria': 'Live driving input: {inputs}; {authority}',
    'input.initialAria': 'Live driving input: no active input',
    'input.control.left': 'left',
    'input.control.right': 'right',
    'input.control.throttle': 'throttle',
    'input.control.jump': 'launch',
    'input.control.brake': 'brake',

    'view.chase': 'Chase',
    'view.close': 'Close',
    'view.top': 'Top-down',
    'view.hood': 'Hood',
    'view.buttonAria': 'Current view: {view}. Press C to change view',
    'view.initialAria': 'Current view: Chase. Press C to change view',
    'view.changedStatus': 'Switched to the {view} view.',
    'cinematic.state.off': 'Off',
    'cinematic.state.on': 'On',
    'cinematic.initialAria': 'Film mode is off. Activate to turn it on',
    'cinematic.buttonAria': 'Film mode is {state}. Press to toggle',
    'cinematic.buttonActiveAria': 'Film mode is on, currently {detail}. Press to turn it off',
    'cinematic.enabledStatus': 'Film mode is on: only the camera changes. P, M, T, steering, throttle, braking, and jumping remain available; MT keeps Q / E visible, while AT keeps the manual shift controls hidden and owns shifting. Ordinary contact costs no life.',
    'cinematic.disabledStatus': 'Film mode is off. Returned to {view}; driving state did not change.',
    'cinematic.safetyStatus': 'Film mode prevented this life loss without taking over your driving input.',
    'cinematic.hud.mode': 'Film mode',
    'cinematic.fallback.reduced-motion': 'Reduced Motion',
    'cinematic.fallback.unknown': 'Composition adjustment',
    'cinematic.shot.stable': 'Stable composition',
    'cinematic.shot.lowRear': 'Low rear three-quarter',
    'cinematic.shot.roadSkim': 'Ground-skimming chase',
    'cinematic.shot.wide': 'Wide cruise',
    'cinematic.shot.telephoto': 'Telephoto tracking',
    'cinematic.shot.side': 'Right wingtip parallel',
    'cinematic.shot.oppositeSide': 'Left wingtip parallel',
    'cinematic.shot.rearClose': 'Close rear pursuit',
    'cinematic.shot.crane': 'Crane rise',
    'cinematic.shot.high': 'Elevated dive',
    'cinematic.shot.front': 'Front three-quarter',
    'cinematic.shot.flyby': 'High-speed flyby',
    'cinematic.shot.centerReveal': 'Centred reveal',
    'cinematic.shot.noseMount': 'Nose mount',
    'cinematic.shot.tailMount': 'Tail mount',
    'cinematic.shot.wingMount': 'Right wingtip mount',
    'cinematic.shot.tunnelNoseMount': 'Tunnel nose mount',
    'cinematic.shot.tunnelWingMount': 'Tunnel wing-root mount',
    'cinematic.shot.tunnelTailMount': 'Tunnel tail mount',
    'cinematic.shot.tunnelEntrance': 'Portal cut-in',
    'cinematic.shot.tunnelCompression': 'Tunnel compression',
    'cinematic.shot.tunnelWallProfile': 'Wall-side profile',
    'cinematic.shot.tunnelAxialRush': 'Tunnel axial push',
    'cinematic.shot.tunnelOppositeProfile': 'Opposite-wall profile',
    'cinematic.shot.tunnelExitReveal': 'Exit reveal',

    'quality.low.name': 'Low quality',
    'quality.low.option': 'Low · prioritize performance',
    'quality.low.description': 'Lower resolution and shadow precision retain continuously lit tunnel fixtures and static base irradiance without dynamic local spots or local shadows.',
    'quality.medium.name': 'Medium quality',
    'quality.medium.option': 'Medium · balanced clarity',
    'quality.medium.description': 'Balances clarity and performance while tunnel covers, diffusers, and static base irradiance remain continuously lit without dynamic spots or local shadows.',
    'quality.high.name': 'High quality',
    'quality.high.option': 'High · PC Ultra dynamic lighting',
    'quality.high.description': 'PC Ultra rendering and ultra-detailed primary sun shadows add six authored dynamic spots and two local shadow casters.',
    'quality.runLocked': 'Locked during this run; pause to switch. {description}',

    'realm.dawnIsle': 'Dawn Isle Cloudsea',
    'realm.prairieGarden': 'Prairie Garden',
    'realm.rainforestGlow': 'Rainforest Glow',
    'realm.valleyTwilight': 'Valley Twilight',
    'realm.vaultStars': 'Vault Starcanopy',
    'realm.edenStorm': 'Eden Stormeye',

    'startup.loading.title': 'Preparing the sky route',
    'startup.loading.modules': 'Loading flight systems and scene modules…',
    'startup.loading.world': 'Assembling the craft, world, and flight deck…',
    'startup.loading.routes': 'Building the opening road and route ahead…',
    'startup.loading.graphics': 'Roads ready; preparing lighting and materials…',
    'startup.loading.firstFrame': 'Checking the graphics environment and first frame…',
    'startup.loading.complete': 'Ready',
    'startup.loading.note': 'When loading finishes, Start Flight will be immediately available.',
    'startup.loading.progressAria': 'Startup preparation progress',
    'startup.loading.tipLabel': 'Flight tip',
    'startup.loading.tip.steering': 'Hold A/D, arrow keys, or touch steering to move laterally; release to stop input.',
    'startup.loading.tip.view': 'C cycles four driving views. F or Film changes only the cinematic camera, never P, M, T, or driving input, and restores the prior view on exit.',
    'startup.loading.tip.ramps': 'Random platforms launch from their real slope and your speed; land the full craft on real pavement.',
    'startup.loading.tip.candlelight': 'Candlelight adds score and improves handling, RPM ceiling, and spool-up speed.',
    'startup.loading.tip.damage': 'Ordinary damage costs one life, then grants at least 1.3 seconds of invulnerability with no forced slowdown.',
    'startup.loading.tip.weather': 'Water, snow, and slush add bounded drag and slip; manual flight and autopilot share the same rule.',

    'launch.stage.lock': 'Airframe · visual lock',
    'launch.stage.name': 'V23 · Sky Dawnflight',
    'launch.stage.class': 'Class',
    'launch.stage.classValue': 'High-mobility lifting-body craft',
    'launch.stage.span': 'Span',
    'launch.stage.spanValue': '5.24 m',
    'launch.stage.core': 'Core',
    'launch.stage.coreValue': 'Candlelight',
    'launch.mode.launch': 'Pre-flight',
    'launch.mode.pause': 'Flight hold',
    'launch.mode.gameover': 'Run complete',
    'launch.status.ready': 'Ready / 01',
    'launch.status.hold': 'Hold / O',
    'launch.status.archive': 'Archive / 03',
    'launch.brand': 'Neon Autopilot · V23',
    'launch.title.top': 'V23 · Sky',
    'launch.title.bottom': 'Dawnflight',
    'launch.summary': 'Start from rest and cross surface roads, mountain galleries, and underground tunnels. Releasing W immediately cuts excess pedal thrust, while grounded Gear 1 creeps like a car on real idle torque; S still stops it completely. With P off M holds full throttle; with P on Autopilot owns speed. F changes only the safe cinematic camera and keeps driving authority unchanged.',
    'launch.briefing.eyebrow': 'Mission profile',
    'launch.briefing.title': 'Route briefing',
    'launch.briefing.aria': 'Core gameplay',
    'launch.point.candle.title': 'Candlelight boost',
    'launch.point.candle.body': 'Shifts the craft from warm gold through violet to cyan while improving handling, RPM ceiling, and spool-up speed',
    'launch.point.navigation.title': 'Three-dimensional navigation',
    'launch.point.navigation.body': 'Real splits connect the mainline, mountain galleries, and underground tunnels',
    'launch.point.speed.title': 'Three real gears',
    'launch.point.speed.body': 'Gear 1 settles near 110 km/h and Gear 2 near 160 km/h; MT or AT may select the 280 km/h high-performance road/ramp Gear 3',
    'launch.config.eyebrow': 'Run configuration',
    'launch.config.title': 'Run setup',
    'launch.weather.legend': 'Weather category',
    'launch.weather.choose': 'Choose for this run',
    'launch.weather.dry.summary': 'Clear · clouds · mist',
    'launch.weather.severe.summary': 'Rain and snow · hail · sandstorms',
    'launch.weather.mixed.summary': 'Natural climate-driven rotation',
    'launch.quality.title': 'Render quality',
    'launch.quality.help': 'Change before launch or while paused',
    'launch.action.start': 'Ignite and launch',
    'launch.action.restart': 'Restart flight',
    'launch.action.resume': 'Continue flight',
    'launch.action.again': 'Fly again',
    'launch.action.committingStart': 'Building route…',
    'launch.action.committingResume': 'Restoring route…',
    'launch.action.guide': 'Flight manual',
    'launch.action.pauseRestart': 'Restart run',
    'launch.restartConfirm.eyebrow': 'Flight reset confirmation',
    'launch.restartConfirm.title': 'Restart this run?',
    'launch.restartConfirm.description': 'Distance, score, candlelight, and life progress from the current run will be cleared. Render quality and weather category selected on this page will be kept. This action cannot be undone.',
    'launch.restartConfirm.cancel': 'Cancel and return to pause',
    'launch.restartConfirm.confirm': 'Confirm restart',
    'launch.footer.collision': 'Stationary start',
    'launch.footer.lives': 'Real resistance',
    'launch.footer.target': 'P controls speed · M full throttle · T selects MT / AT',
    'launch.pauseStatus': 'Game paused. Press O or Esc, or activate Continue, to resume. Press R or activate Restart run to open a confirmation first.',
    'launch.gameOverStatus': 'No lives remaining. Final score {score}; best {best}.',
    'launch.offRoadCrashStatus': 'Crashed after {airTime} airborne without landing on a real road. This run ends immediately. Final score {score}; best {best}.',
    'launch.runningStatus': 'V23: every candlelight continues shifting craft color while improving lateral handling, RPM ceiling, and spool-up speed for both player and autopilot; automatic cruise settles at {speed} against real resistance.',

    'rating.eyebrow': 'Flight review',
    'rating.title': 'Flight rating',
    'rating.facts.aria': 'Measured full-run facts',
    'rating.fact.distance': 'Real distance',
    'rating.fact.duration': 'Active time',
    'rating.fact.averageSpeed': 'Average speed',
    'rating.fact.maximumSpeed': 'Maximum speed',
    'rating.fact.totalAirTime': 'Total airtime',
    'rating.fact.longestAirTime': 'Longest flight',
    'rating.fact.candles': 'Candlelights',
    'rating.fact.damage': 'Life-loss hits',
    'rating.dimensions.aria': 'Five rating dimensions',
    'rating.dimension.safety': 'Safety',
    'rating.dimension.pace': 'Real pace',
    'rating.dimension.endurance': 'Endurance',
    'rating.dimension.collection': 'Candlelight collection',
    'rating.dimension.airborne': 'Airtime and landing',
    'rating.radar.title': 'Five-dimension profile',
    'rating.radar.note': 'Vertices show each raw 0–100 dimension score; shape area is not the weighted overall score.',
    'rating.radar.summary': 'Five-dimension profile: safety {safety}; real pace {pace}; endurance {endurance}; candlelight collection {collection}; airtime and landing {airborne}.',
    'rating.radar.invalid': 'Rating chart data unavailable',
    'rating.grade.S': 'Starlit',
    'rating.grade.A': 'Luminous',
    'rating.grade.B': 'Steady',
    'rating.grade.C': 'Developing',
    'rating.grade.D': 'Unstable',
    'rating.grade.aria': 'Overall grade {grade}, {name}, {score} points',
    'rating.evidence.complete': 'Complete rating · {coverage}% sample coverage',
    'rating.evidence.provisional': 'Provisional rating · {coverage}% sample coverage',
    'rating.evidence.limited': 'Short-run rating · {coverage}% sample coverage',
    'rating.reason.offRoad': 'End reason: no real road beneath the airborne craft',
    'rating.reason.lives': 'End reason: all three lives depleted',
    'rating.value.seconds': '{value} s',
    'rating.value.candles': '{value}',
    'rating.value.damage': '{value}',
    'rating.value.damageWithGuardrail': '{value} ({guardrail} guardrail)',
    'rating.dimension.score': '{score} · {grade}',
    'rating.dimension.noSample': 'No sample',
    'rating.dimension.meterAria': '{dimension}: {score} points, grade {grade}',
    'rating.dimension.noSampleAria': '{dimension}: no usable sample in this run',
    'rating.evidence.safety.offRoad': '{obstacle} obstacle hits · {guardrail} guardrail hits · plus one off-road crash',
    'rating.evidence.safety.noDamage': '0 life-loss hits · {distance} damage-free',
    'rating.evidence.safety.damage': '{obstacle} obstacle hits · {guardrail} guardrail hits · {segment} average damage-free segment',
    'rating.evidence.pace': 'Average {average} · maximum {maximum} · cruise reference {target}',
    'rating.evidence.endurance': '{duration} active flight · {distance} real travel',
    'rating.evidence.collection': '{candles} collected · {rate}/km; bands use a conservative 55/km supply floor',
    'rating.evidence.collectionUnavailable': 'Below 2 km; reports {candles} only and does not judge collection rate',
    'rating.evidence.airborne': '{landings}/{takeoffs} safe platform landings · {safeAirTime} successful platform airtime · {totalAirTime} total',
    'rating.evidence.airborneUnavailable': 'No platform takeoff; {totalAirTime} total airtime, without mislabelling manual launches as platform evidence',
    'rating.weakness.label': 'Lowest dimension',
    'rating.weakness.insufficientTitle': 'Insufficient sample',
    'rating.weakness.insufficientAdvice': 'Complete at least 30 seconds and 1 km before drawing a stable weakness.',
    'rating.advice.safety': 'Increase damage-free distance between incidents; an off-road crash hard-caps the safety dimension.',
    'rating.advice.pace': 'Average and maximum speed each own half of this dimension; sustained thrust matters more than the final instant.',
    'rating.advice.endurance': 'Endurance uses active flight time only, excluding pauses. Survive steadily for longer to improve it.',
    'rating.advice.collection': 'Line up reachable candlelights earlier without sacrificing a real-road landing; this dimension uses collection per kilometre.',
    'rating.advice.airborne': 'First land the full craft footprint on real pavement; safe landing rate owns three quarters of this dimension.',
    'rating.method': 'Fixed contract V2: safety 30%, real pace 25%, endurance 15%, candlelights 15%, and airborne performance 15%. Missing-sample weights are redistributed. S / A / B / C / D begin at 90 / 80 / 70 / 60; this is an in-game engineering index, not a player percentile.',

    'guide.eyebrow': 'Flight Manual · V23',
    'guide.title': 'Flight Manual',
    'guide.description': 'Learn the rules that actually affect flight outcomes first, then open the full system reference as needed. This manual never changes the run, route, or control state.',
    'guide.meta.chapters': 'Mission chapters',
    'guide.meta.contracts': 'Rule entries',
    'guide.meta.synced': 'Essential / complete layers',
    'guide.closeAria': 'Close gameplay details and return to the previous screen',
    'guide.tabsAria': 'Gameplay detail chapters',
    'guide.tabs.heading': 'Chapter navigation',
    'guide.tab.controls': 'Controls',
    'guide.tab.controlsSummary': 'Flight · views · settings',
    'guide.tab.navigation': 'Navigation',
    'guide.tab.navigationSummary': 'Routes · interchanges · autopilot',
    'guide.tab.fairness': 'Goals and rules',
    'guide.tab.fairnessSummary': 'Score · lives · fairness',
    'guide.tab.world': 'Weather and world',
    'guide.tab.worldSummary': 'Ecology · climate · lighting',
    'guide.tabs.keyboardHint': 'Use arrow keys',
    'guide.view.aria': 'Gameplay-detail reading scope',
    'guide.view.essential': 'Essential',
    'guide.view.essentialHint': 'Key rules',
    'guide.view.all': 'Complete',
    'guide.view.allHint': 'All details',
    'guide.view.essentialSummary': 'Showing the key rules that directly affect controls, routes, lives, scoring, and landings.',
    'guide.view.allSummary': 'Showing the complete set of 43 player rules and system details.',
    'guide.context.aria': 'Current run and reading scope',
    'guide.context.eyebrow': 'Snapshot on open',
    'guide.context.title.preflight': 'Preflight preparation',
    'guide.context.title.flying': 'Flight in progress',
    'guide.context.title.paused': 'Flight paused',
    'guide.context.title.complete': 'Flight complete',
    'guide.context.phase': 'Phase',
    'guide.context.phase.preflight': 'Preflight',
    'guide.context.phase.flying': 'Flying',
    'guide.context.phase.paused': 'Paused',
    'guide.context.phase.complete': 'Complete',
    'guide.context.authority': 'Control',
    'guide.context.authority.manual': 'Manual control',
    'guide.context.authority.lateralManual': 'Manual steering',
    'guide.context.authority.lateralAuto': 'Autopilot steering',
    'guide.context.authority.longitudinalManual': 'Manual throttle',
    'guide.context.authority.longitudinalFullThrottle': 'Full-throttle hold',
    'guide.context.authority.longitudinalAutopilot': 'Autopilot speed',
    'guide.context.authorityValue': '{lateral} · {longitudinal}',
    'guide.context.speed': 'Speed',
    'guide.context.speedInitial': '0 km/h',
    'guide.context.survival': 'Status',
    'guide.context.survivalInitial': '3 lives · 0 candlelight',
    'guide.context.survivalValue': '{lives} lives · {candles} candlelight',
    'guide.context.compactInitial': 'Manual steering + Manual throttle · 0 km/h · 3 lives / 0 candlelight · Standby',
    'guide.context.compactValue': '{authority} · {speed} · {lives} lives · {candles} candlelight · Brake {brake}',
    'guide.context.brake': 'Braking',
    'guide.context.brake.standby': 'Standby',
    'guide.context.next': 'Next',
    'guide.context.next.preflight': 'Learn lateral movement and throttle, then ignite and launch.',
    'guide.context.next.scan': 'Watch the road, map, and hazards ahead, then choose the route early.',
    'guide.context.next.airborne': 'Adjust the lateral touchdown point so the whole craft lands on any valid real road.',
    'guide.context.next.critical': 'One life remains. Prioritize a valid road landing and avoid repeated contact.',
    'guide.context.next.film': 'The Film camera is running; current P, M, T, and player input still own driving.',
    'guide.context.next.autopilot': 'P owns steering, throttle, and safety braking; M only stores the throttle preference used after P exits.',
    'guide.context.next.complete': 'Review the run rating, or return to the previous screen to start another flight.',
    'guide.controls.kicker': 'Flight controls',
    'guide.controls.title': 'Controls, craft, and settings',
    'guide.controls.intro': 'Keyboard, mouse, and touch share one driving authority. Motion feedback never changes physics behind the scenes.',
    'guide.quickstart.eyebrow': 'First flight · Master in 60 seconds',
    'guide.quickstart.title': 'Complete one stable flight first',
    'guide.quickstart.intro': 'You do not need to read every detail first. Follow this order to understand the run’s most important cause-and-effect rules.',
    'guide.quickstart.steer.title': 'Control the lane first',
    'guide.quickstart.steer.body': 'Use A / D or the touch left/right controls. Watch the road edge before chasing candlelight.',
    'guide.quickstart.speed.title': 'Then build speed',
    'guide.quickstart.speed.body': 'W accelerates and S brakes. Releasing W immediately cuts excess pedal thrust. Grounded Gear 1 slowly settles near 8 km/h from the real balance of idle torque and resistance; S can stop and hold it completely, while Gears 2/3, shifts, and airborne motion receive no creep force. With P off, M switches between manual W and continuous full throttle; full throttle does not track 120 km/h. With P on, Autopilot alone commands throttle, coast, and braking. T independently switches MT or AT. Q / E shift in MT, while AT disables Q/E and covers all three gears at the 90 / 70 and 140 / 120 km/h thresholds.',
    'guide.quickstart.route.title': 'Choose the route early',
    'guide.quickstart.route.body': 'Read the right-side instruction and map, enter the target lane before the split, and avoid a last-second swerve.',
    'guide.quickstart.ramp.title': 'Use Gear 3 and the real ramp surface',
    'guide.quickstart.ramp.body': 'Before the ramp, enter Gear 3 and build the approach speed to about 260 km/h. MT selects it manually; AT selects it automatically when full-throttle acceleration reaches 140 km/h. With no SPACE input, the real lip launches the craft naturally. A deliberate launch also works on the slope, but it does not receive the ramp-only cross-road landing authority.',
    'guide.quickstart.survive.title': 'Learn from one life; do not gamble on a second hit',
    'guide.quickstart.survive.body': 'An ordinary collision costs one life and grants at least 1.3 seconds of protection. Losing every life or missing the road after takeoff ends the run.',
    'guide.feature.controlsSteering.title': 'Lateral movement',
    'guide.feature.controlsSteering.body': 'Hold to move continuously. Arrow keys and mobile left/right controls use the same lateral capability.',
    'guide.feature.throttleModes.title': 'Real resistance and three-gear propulsion',
    'guide.feature.throttleModes.body': 'Automatic throttle starts off. W / Up accelerates and S / Down brakes at about 7.5 m/s². Releasing W immediately cuts excess pedal thrust, but grounded Gear 1 keeps an independent idle load: a dry level road slowly settles near 8 km/h, and S can stop and hold it completely. Above 16 km/h, in Gears 2/3, during shifts, or while airborne, rolling and aerodynamic drag dominate coasting with no hidden force. Authoritative core rotation and exhaust then decay naturally instead of the flame collapsing on the release frame. T independently switches MT or AT. With P off, M stores continuous full-throttle hold: it does not track 120 km/h and has no target-speed cap. With P on, Autopilot alone commands propulsion, coast, and braking while M stores the post-P preference. In MT, Q shifts down and E shifts up through three real working bands; Gear 3 is the high-performance road and ramp stage, while a slow high gear lugs and can stall to zero thrust. Shifting briefly interrupts thrust, and unsafe shifts are rejected. AT owns shifting, disables Q/E, and covers all three gears: 1→2 at 90 km/h, 2→1 at 70, 2→3 at 140, and 3→2 at 120. P’s ordinary 120 km/h cruise normally stays in Gear 2; uncapped full throttle with P off can automatically reach Gear 3.',
    'guide.feature.launchAndRamps.title': 'Manual launch and Gear 3 random ramps',
    'guide.feature.launchAndRamps.body': 'SPACE or touch launch works from flat roads, structural bridge grades, and the supported plane of a physical ramp. A sloped takeoff preserves the surface-tangent velocity and adds the deliberate separation impulse. With no SPACE input, the craft still needs Gear 3 and about 260 km/h before a ramp: MT selects it with E, while AT selects it automatically when full-throttle acceleration reaches 140 km/h. The real lip then releases the craft from the authored grade and speed. Only that natural lip release receives the roughly 42-metre cross-road landing envelope on either side of the road centre; a deliberate launch retains the current route’s guardrail envelope. Aerial steering still saturates at 10 m/s lateral speed and 17 m/s² lateral acceleration. All four ramp variants are verified around 260 km/h and can cross the roughly 24-metre gap between roads to reach the opposing road. The whole craft must land on a real load-bearing surface. Landing in a gap, beyond the road, or without a valid route handoff crashes immediately and ends the run.',
    'guide.feature.freeLook.title': 'Free look',
    'guide.feature.freeLook.body': 'Hold the primary mouse button over the main canvas and drag. Releasing recenters smoothly without changing route or craft input.',
    'guide.feature.viewFullscreen.title': 'Four driving views, Film mode, and fullscreen',
    'guide.feature.viewFullscreen.body': 'C cycles only the four driving views. F or Film starts the camera director and saves the prior view. Film never reads or writes P, M, T, MT / AT, steering, throttle, braking, jumping, gear, speed, route, or score. Q / E remain visible and usable in MT; in AT those manual controls remain hidden while the automatic transmission owns shifting. With P off the player stays in manual control; with P on Autopilot remains the driver, and P, M, T, and shifting can still be changed during Film. The run seed selects one of three stylish read-only reels, and driving state never selects a shot or stops its clock. Ordinary contact costs no life during Film, but the safety layer does not steer, brake, or shift for the player. Only pointer free-look is unavailable while the director owns the lens. Reduced Motion holds one stable composition, and exit restores the prior driving view.',
    'guide.feature.liveInput.title': 'Live input source',
    'guide.feature.liveInput.body': 'The lower-left A / D / W / Space / S tracker continuously shows final commands. Gold means autopilot, cyan means keyboard or touch, and player intervention is marked as manual takeover.',
    'guide.feature.fps.title': 'Live frame rate',
    'guide.feature.fps.body': 'The main HUD updates actual rendered frame rate once per second. Cyan means smooth, gold signals variation, and red marks low frame rate. It reports performance without changing game speed.',
    'guide.feature.lighting.title': 'Lighting toggle',
    'guide.feature.lighting.body': 'The Lighting On / Off control can disable physical lights, HDR environment reflections, and cast shadows at any time. When off, uniform fill light and a subtle contact cue keep open and tunnel roads legible. When enabled it still respects the quality boundary: Low and Medium run no dynamic tunnel or under-bridge spots, while only High enables those local lights and shadows. It changes presentation and render cost only, never speed, route, collision, lives, or autopilot.',
    'guide.feature.quality.title': 'Low / Medium / High quality',
    'guide.feature.quality.body': 'Choose quality on the launch screen or pause with O / Esc to change it during flight. Low and Medium retain direct rendering, full-span continuously lit tunnel covers and diffusers, and static base irradiance on pavement, wall/ceiling, and housings. They do not scan, select, or prewarm dynamic tunnel or under-bridge spots, so local-shadow cost is zero. In addition to the PC Ultra resolution budget, procedural PBR, ambient occlusion, explicit bloom, and filmic grading, High alone enables six authored dynamic spots, two local shadow casters, and edge/profile-matched Film handoffs. High-quality terrain grain and tonal patches stay anchored to absolute world coordinates and move behind the craft instead of sticking to the camera. Roads, hazards, visibility, collision, speed, and run progress remain unchanged.',
    'guide.feature.shipFeedback.title': 'Craft motion feedback',
    'guide.feature.shipFeedback.body': 'Straights use subtle attitude, lift, and camera inertia. Steering changes left/right exhaust, braking lights shoulder reverse thrust, and high speed adds flow streaks and field-of-view response.',
    'guide.feature.audio.title': 'Dynamic soundscape',
    'guide.feature.audio.body': 'Electric-drive core, harmonics, and wind noise sit beneath the score. Braking, steering, autopilot, automatic throttle, view, lighting, pause, and restart use distinct cues; thunder follows flash distance, while rain, wind-snow, hail, and dust follow outdoor intensity. Rain remains outdoors under an ordinary elevated bridge; mountain galleries and underground tunnels retain a darker, more distant return of the outside rain instead of becoming silent. V controls and remembers all audio.',
    'guide.feature.music.title': 'Six-realm music library',
    'guide.feature.music.body': 'Twelve per-track-licensed instrumental scores form two truthful narrative chapters per realm: Dawn awakens, Prairie connects, Rainforest grows, Valley soars, Vault remembers, and Eden sacrifices then returns. Masters share one loudness baseline, and Adaptive changes chapters only inside the current map.',
    'guide.feature.pause.title': 'Pause and comfort',
    'guide.feature.pause.body': 'O / Esc pauses route, physics, and the weather clock. Reduced Motion calms camera movement, pulses, and intense lightning without stopping real hazards or changing collision.',
    'guide.feature.pauseRestart.title': 'Restart while paused',
    'guide.feature.pauseRestart.body': 'After pausing with O / Esc, continue the current flight or press R or select Restart run to open a second confirmation. Canceling keeps the current run paused; only explicit confirmation fully clears it and starts a new run with the settings selected on this page.',
    'guide.shortcut.throttle': 'Throttle mode',
    'guide.shortcut.gear': 'Shift down / Shift up',
    'guide.shortcut.autopilot': 'Autopilot',
    'guide.shortcut.view': 'View',
    'guide.shortcut.cinematic': 'Film mode',
    'guide.shortcut.sound': 'Sound',
    'guide.shortcut.pause': 'Pause',
    'guide.shortcut.restart': 'Restart',
    'guide.navigation.kicker': 'Route intelligence',
    'guide.navigation.title': 'Routes, map, and interchanges',
    'guide.navigation.intro': 'The route map, road signs, speed guidance, and craft position share one live navigation source.',
    'guide.authority.eyebrow': 'Control authority',
    'guide.authority.title': 'P takes priority; M stores full-throttle preference',
    'guide.authority.intro': 'With P off, M switches between manual W and continuous full throttle. With P on, Autopilot owns the complete longitudinal command so M cannot fight it.',
    'guide.authority.steering.manual': 'Manual steering',
    'guide.authority.steering.auto': 'Autopilot steering',
    'guide.authority.throttle.manual': 'Manual throttle',
    'guide.authority.throttle.auto': 'M full throttle',
    'guide.authority.throttle.fullThrottle': 'M full throttle',
    'guide.authority.throttle.preferenceOff': 'M-off preference',
    'guide.authority.throttle.preferenceOn': 'M-on preference',
    'guide.authority.mode.manual': 'Fully manual',
    'guide.authority.mode.manualBody': 'The player owns lanes, routes, acceleration, and braking.',
    'guide.authority.mode.guided': 'P takeover · M-off preference',
    'guide.authority.mode.guidedBody': 'The system routes, steers, propels, and brakes; M only remembers to restore manual W after P exits.',
    'guide.authority.mode.cruise': 'Continuous full throttle',
    'guide.authority.mode.cruiseBody': 'P off, M on: the pedal stays at 100%, while real thrust, resistance, grade, and gear determine speed.',
    'guide.authority.mode.full': 'P takeover · M-on preference',
    'guide.authority.mode.fullBody': 'The system routes, steers, propels, and brakes; M only remembers to restore full throttle after P exits.',
    'guide.authority.brakeNote': 'Whenever P is on, obstacle, curve, and opposing-road boundary braking belong to the same longitudinal authority regardless of the saved M preference. Every brake request zeros propulsion first.',
    'guide.feature.routeMap.title': 'Reading the route map',
    'guide.feature.routeMap.body': 'The map switches among route detail, interchange overview, and split guidance for the current scene. Solid gold-white lines mark the selected route, dashed gold lines mark candidate routes, red marks hazards, and blue marks candlelight. Prioritize the next instruction at the top and the distance-to-split value.',
    'guide.feature.straightFork.title': 'Straight-road route fork',
    'guide.feature.straightFork.body': 'A connector straight divides through smooth curves into independent left and right branches. Warm-gold inner boundaries plus split and merge noses continuously seal the central no-road area. Move to the target side early; committing selects only that branch. Hazards and candlelight on the unselected branch remain until they naturally pass or leave view instead of disappearing at commit.',
    'guide.feature.cloverleaf.title': 'Four entries, twelve routes',
    'guide.feature.cloverleaf.body': 'Every entry offers straight, right, and left movement. Straight remains on the surface mainline, 2A enters the perforated mountain gallery, and 2B enters the underground tunnel. Selection first chooses mainline or collector, then confirms the final exit.',
    'guide.feature.tunnelCamera.title': 'Tunnels and clearance camera',
    'guide.feature.tunnelCamera.body': 'Mountain galleries retain open side portals while underground routes have real ceiling collision. The camera lowers and looks ahead along the selected route without cutting through walls on curve tangents or hugging the ceiling.',
    'guide.feature.speedGuidance.title': 'Speedometer, gears, limits, and braking',
    'guide.feature.speedGuidance.body': 'The upper-left gauge marks P Autopilot’s ordinary 120 km/h cruise reference with a gold tick and shows MT / AT, exact shift conditions, and the three recommended working bands. They are not hard caps. Gear 1 naturally settles near 110 km/h, Gear 2 near 160, and Gear 3 near 280. T independently switches transmission mode. With P off and M on, throttle stays fully pressed and ignores the 120 reference; with P on, Autopilot alone regulates speed. A slow high gear in MT lugs. AT disables player Q/E and covers all three gears: up at 90 and 140 km/h, down at 70 and 120. P’s 120 km/h cruise normally stays in Gear 2, while uncapped full throttle can automatically reach Gear 3. Film mode never changes T, the engaged gear, or shift access. Releasing W cuts excess pedal thrust; grounded Gear 1 creeps toward about 8 km/h on real idle torque, S stops it completely, and Gears 2/3 receive no hidden creep. S / Down and Autopilot share the same realistic 7.5 m/s² brake.',
    'guide.feature.autopilot.title': 'P Autopilot',
    'guide.feature.autopilot.body': 'P owns route choice, steering, throttle, coasting, and real risk braking. M remains switchable but only stores whether manual W or continuous full throttle resumes after P exits, so it cannot fight P. Ordinary roads use the 120 km/h Autopilot reference and real curves or obstacles can command an early lift or brake. Film mode never enables, disables, or strengthens P and never changes its target speed, shifts, or ramp plan; it only changes the camera and prevents ordinary contact from costing a life.',
    'guide.fairness.kicker': 'Fair flight contract',
    'guide.fairness.title': 'Goals, scoring, and fairness',
    'guide.fairness.intro': 'Avoid real hazards, collect candlelight, and travel as far as possible. Higher speed never makes the rules step aside.',
    'guide.stat.start': 'Starting speed',
    'guide.stat.target': 'Auto cruise',
    'guide.stat.lives': 'Starting lives',
    'guide.stat.times': 'lives',
    'guide.rule.coreLoop': 'Distance continuously becomes score. Survive static and dynamic hazard pressure, choose the right route, and collect candlelight.',
    'guide.rule.scoreCandles': 'Candlelight increases collection count and per-item score. The more collected during the run, the more each later item is worth; missing one or waiting between pickups never resets that growth. Candlelight does not directly rewrite true speed, and manual throttle still requires player input.',
    'guide.rule.candleHandling': 'Every candlelight continues raising the growth gauge, shifting the craft from warm gold through violet to cyan while improving lateral handling, propulsion-core RPM ceiling, and spool-up speed. It does not directly raise longitudinal top speed or collision capability, and its gains gradually taper.',
    'guide.rule.collisions': 'An ordinary collision removes one life. If a life remains, an active-gameplay invulnerability shield starts immediately for at least 1.3 seconds: repeated contact during protection cannot remove another life, pausing freezes the remaining protection, and speed is not forced down. The run settles after all three lives are gone; an off-road landing crash still ends it immediately.',
    'guide.rule.obstacles': 'Hazards, dynamic hazards, and high-speed pressure do not decrease when autopilot is on. Ambient oncoming craft explicitly do not collide.',
    'guide.rule.noCheat': 'Manual driving and ordinary P Autopilot have no invulnerability lock, teleport, speed jump, collision bypass, hidden shortcut, or reduced hazards. F Film mode is the explicit show-safety exception: ordinary contact costs no life, but Film changes only the camera and never steers, throttles, brakes, jumps, or shifts for the player.',
    'guide.rule.sharedControls': 'Player and autopilot share candlelight-enhanced lateral handling and propulsion-core capability. Full thrust, spool-down, and braking remain unchanged, while speed streaks, camera feel, weather, and surfaces cannot rewrite true speed, route, or collision.',
    'guide.world.kicker': 'Living sky world',
    'guide.world.title': 'Weather, ecology, and a flowing world',
    'guide.world.intro': 'Sky, terrain, map, weather, and surface feedback share real world state and evolve continuously over time.',
    'guide.feature.realmPairing.title': 'One-to-one sky and ground realms',
    'guide.feature.realmPairing.body': 'Dawn Isle Cloudsea pairs with ocean, Prairie Garden with grassland, Rainforest Glow with wetland, Valley Twilight with tundra, Vault Starcanopy with astral shoals, and Eden Stormeye with volcanic badlands. They share one current realm, next realm, and blend progress.',
    'guide.feature.mapEcology.title': 'Scene-sourced map ecology',
    'guide.feature.mapEcology.body': 'The minimap directly reads visible 96 m terrain cells plus current landmarks, ambient constructs, and flying creatures. Object IDs, absolute coordinates, and visibility come from the main scene rather than a second random generator. Roads, routes, and navigation remain on top.',
    'guide.feature.landmarks.title': 'Regional landmarks and creatures',
    'guide.feature.landmarks.body': 'All six regions retain distinct landmarks, ambient constructs, flying creatures, hazards, and candlelight forms, with one shared continuous boundary blend. Every ambient creature provides world atmosphere only and never participates in player speed, route, or collision authority.',
    'guide.feature.coveredRoutes.title': 'Perforated mountain interchange',
    'guide.feature.coveredRoutes.body': 'Mountain galleries wrap real roads with continuous portals, open side holes, roofs, and light strips. Underground routes retain real ceiling collision clearance.',
    'guide.feature.traffic.title': 'Opposing road and ambient traffic',
    'guide.feature.traffic.body': 'Grounded driving cannot cross the central divider directly. After a ramp takeoff, the whole craft may land on the opposing road, then enter a smooth cross-road recovery that skips the current interchange. Fully modeled ambient craft create traffic presence and leave dim map marks without causing damage.',
    'guide.feature.weatherLifecycle.title': 'Complete weather lineage and buffers',
    'guide.feature.weatherLifecycle.body': 'Clear, partly cloudy, cloudy, mist, rain, heavy rain, thunderstorm, hail, flurries, snow, blizzard, haze, dust haze, blowing dust, and sandstorm follow plausible transitions. Ordinary weather generally remains stable for at least 60 seconds, with formation and dissipation lasting at least 12 seconds instead of hard cuts or speed-scaled timing.',
    'guide.feature.forecastClouds.title': 'One source for forecast, clouds, and intensity',
    'guide.feature.forecastClouds.body': 'The forecast shows current and next weather, arrival, expected duration, and strengthening/easing trend. High thin cloud, the mid-level body, and low precipitation decks derive distinct height, depth, and tone from the same cloud and precipitation state. Rain, snow, heavy rain, blizzard, and hail continuously deepen lower layers, expand coverage, and lower cloud bases, but the minimum base remains 36 metres above the highest bridge deck and at world height 45 metres in this release. Sun, moon, and lightning illuminate real layers. Cloud lobes smoothly yield near the central sightline or camera while peripheral density remains unchanged, Top view cannot enter the low deck, and dust never masquerades as thick or low cloud.',
    'guide.feature.precipitation.title': 'Detailed precipitation and world motion',
    'guide.feature.precipitation.body': 'Raindrops vary in length, brightness, and slant, while six-branched snowflakes use near and far layers. Fog and dust compound the authored weather visibility and bring dense fog closer to the camera. Rain, snow, hail, and dust share interleaved near, mid, and far envelopes with at least 72 metres of vertical span around the camera, so Top view cannot expose a ceiling or forward wall. Every particle moves in world coordinates and freezes while paused. An ordinary elevated bridge masks nearby drops but retains the exterior rain curtain; a sealed tunnel smoothly hides local rain at its portal from the committed route without stopping the outdoor weather state.',
    'guide.feature.surfaceWeather.title': 'Gradual surface accumulation',
    'guide.feature.surfaceWeather.body': 'Exposed roads gradually develop standing water, snow, slush, or dust with the weather; tunnels remain dry. Puddles and snow change surface-contact feedback, so leave extra steering and braking margin at high speed.',
    'guide.feature.shipWeather.title': 'Craft-to-surface interaction',
    'guide.feature.shipWeather.body': 'Crossing exposed standing water creates ripples, spray, and wake; crossing snow leaves paired grooves and powder. These contacts apply the same bounded drag and lateral slip to manual flight and autopilot, without changing route, collision, or lives.',
    'guide.feature.weatherLighting.title': 'Physical lighting and lightning',
    'guide.feature.weatherLighting.body': 'Sun, moon, and lightning are real shadow-casting sources; the sun always remains the primary and brightest outdoor source. Terrain and scenery beyond the road also receive real shadows. Ordinary open bridges retain sky and HDR energy and shade naturally beneath physical bridge decks instead of being incorrectly crushed like deep tunnels. Under-bridge fixture appearance remains present, but only High-quality dynamic under-bridge spots fade in near the center of the bridge shadow when natural light is insufficient; their combined road illumination remains below sunlight, and they stay off on clear days. Mountain galleries and underground tunnels independently pack fixtures along their complete routes. Every quality tier keeps every cover and diffuser visibly lit for the full span and applies distance-independent static base irradiance to the existing pavement, continuous wall/ceiling, and rib/housing batches; the structural shell, walls, and road remain non-emissive. Low and Medium do not scan, select, or prewarm any dynamic tunnel or under-bridge spots: all six spot slots stay hidden and local-shadow cost is zero. Only High enables the six pooled spots and two shadow casters. Its dynamic tunnel lights select only authored emitter records whose edge and profile both match, while Film smoothly hands off to the camera-nearest exact group. Only High prepares dynamic lights from camera-route lookahead near a portal; the exterior handoff fades with portal distance but cannot change the constant-on state of the all-tier covers, diffusers, or static base irradiance. A missing match stays off and never creates a craft-following fallback. HDR/ambient energy, celestial direct light, and exposure attenuate continuously through the portal. Only High-quality matched spots create finite light pools and cast shadows beneath real fixtures, while distant, adjacent-route, and wrong-profile fixtures cannot spill into the active tunnel. Sealed tunnels progressively remove visibility loss from outdoor blizzard, dense fog, and dust at the portal, restoring the realm’s normal base fog distance deeper inside. Engine, candle-core, and warning elements use visible emissive materials so craft-following point lights do not create unmotivated bright spots on the road. 1K / 2K / 8K primary sun shadows follow Low / Medium / High quality, with High falling back safely to 4K when unsupported; only High allocates local-shadow targets. HDR sky reflections and ACES tone mapping continue to illuminate real interchange roads, terrain, scenery, layered clouds, and physical standing water. Thunderstorms use a main flash and restrikes instead of a single hard-white frame.',
    'guide.feature.weatherModes.title': 'Launch weather categories',
    'guide.feature.weatherModes.body': 'Choose No precipitation, Rain snow and storms, or Mixed weather on the launch screen. The selection constrains run-wide targets and forecasts while formation and dissipation retain plausible buffers instead of hard cuts.',
    'guide.feature.weatherManual.title': 'Manual weather test panel',
    'guide.feature.weatherManual.body': 'Development and visual acceptance may explicitly use manualTest=1 to expose Automatic lifecycle and 15 instant weather types. It can switch or restore automatic behavior at any time, affects presentation only, and remains hidden for ordinary players.',
    'guide.feature.weatherManual.prefix': 'For development or visual acceptance, use',
    'guide.feature.weatherManual.suffix': 'to explicitly expose Automatic lifecycle and 15 instant weather types. It can switch or restore automatic behavior at any time, affects presentation only, and remains hidden for ordinary players.',
    'guide.feature.weatherFairness.title': 'Weather and surface fairness contract',
    'guide.feature.weatherFairness.body': 'Precipitation particles, cloud, mist, and lighting change presentation only. Real water, snow, and slush contact adds the same resistance for manual flight and autopilot, so severe surfaces may settle below dry-road speed. Weather modules never rewrite routes, hazards, collision, or lives.',
    'guide.footer.heading': 'Chapter navigation',
    'guide.footer.switch': 'Switch chapters',
    'guide.footer.backKey': 'Esc to return',
    'guide.footer.navigationAria': 'Previous and next chapter navigation',
    'guide.footer.previous': 'Previous chapter',
    'guide.footer.next': 'Next chapter',
    'guide.footer.progress': '{current} / {total}',
    'guide.footer.previousAria': 'Previous chapter: {chapter}',
    'guide.footer.nextAria': 'Next chapter: {chapter}',
    'guide.footer.synced': 'V23 · 43 rules synchronized',
    'guide.footer.back': 'Return to previous screen',

    'music.eyebrow': 'Six-Realm Narrative Score',
    'music.title': 'Sky journey music library',
    'music.description': 'Both chapters of every realm now follow its actual meaning. Adaptive follows the current map narrative without importing another realm’s mood or beat.',
    'music.closeAria': 'Close the background-music library',
    'music.now.disabled': 'Sound off',
    'music.now.loading': 'Loading',
    'music.now.playing': 'Now playing',
    'music.now.ready': 'Ready',
    'music.now.waiting': 'Standing by',
    'music.now.realmMode': '{realm} · {mode} mode',
    'music.now.initialRealmMode': 'Dawn Isle Cloudsea · Adaptive mode',
    'music.mode.heading': 'Play mode',
    'music.mode.title': 'Journey mode',
    'music.mode.help': 'Changing mode affects track order only, never gameplay randomness.',
    'music.mode.groupAria': 'Background-music play mode',
    'music.mode.adaptive.name': 'Adaptive',
    'music.mode.adaptive.short': 'Follow the current realm',
    'music.mode.adaptive.description': 'Change tracks automatically with the current sky and terrain realm',
    'music.mode.sequential.name': 'Sequential',
    'music.mode.sequential.short': 'Follow the six-realm journey',
    'music.mode.sequential.description': 'Play continuously in six-realm journey order',
    'music.mode.shuffle.name': 'Roam',
    'music.mode.shuffle.short': 'Independent random sequence',
    'music.mode.shuffle.description': 'Use an independent random sequence without repeating the current track',
    'music.mode.manual.name': 'Manual',
    'music.mode.manual.short': 'Loop the selected track',
    'music.mode.manual.description': 'Loop the theme chosen by the player',
    'music.tracks.heading': 'Six realms',
    'music.tracks.title': 'Six-realm score',
    'music.tracks.contract': 'Realm semantics and loudness verified · player listening sign-off pending',
    'music.track.aria': 'Play {title}, the {realm} theme, tagged {tags}',
    'music.track.loading': 'Loading “{title}” and preparing a gentle transition…',
    'music.status.unsupported': 'This browser cannot create music media, but the complete theme and license list remains available.',
    'music.status.disabled': 'The master sound switch is off. Turning it back on resumes the current score.',
    'music.status.blocked': 'The track did not start. Select it again or confirm that the browser allows media playback.',
    'music.status.playing': '{description}. Track changes use a 1.6-second equal-power fade.',
    'music.status.idle': 'Select a score to preview it. Flight continues with the current mode.',
    'music.transportAria': 'Background-music transport',
    'music.previousAria': 'Play the previous background track',
    'music.nextAria': 'Play the next background track',
    'music.done': 'Return to the journey',
    'music.track.dawn.title': 'First Light Awakening',
    'music.track.dawn.tags': 'awakening, solitude, first light',
    'music.track.prairie.title': 'Listening to the Meadow Wind',
    'music.track.prairie.tags': 'meadow, curiosity, freedom',
    'music.track.rainforest.title': 'Seeking Light in the Rain',
    'music.track.rainforest.tags': 'exposure, shelter, guarded light',
    'music.track.valley.title': 'Racing on the Wind',
    'music.track.valley.tags': 'flight, skill, confidence',
    'music.track.vault.title': 'Memories in the Star Map',
    'music.track.vault.tags': 'memory, reflection, awe',
    'music.track.eden.title': 'Pilgrimage into the Stormeye',
    'music.track.eden.tags': 'pilgrimage, fear, sacrifice',
    'music.track.dawnAlternate.title': 'First Flight Above the Clouds',
    'music.track.prairieAlternate.title': 'Meeting in the Flower Court',
    'music.track.rainforestAlternate.title': 'After the Rain, Light Remains',
    'music.track.valleyAlternate.title': 'Crescendo of the Valley',
    'music.track.vaultAlternate.title': 'Ascending Through Silence',
    'music.track.edenAlternate.title': 'Rebirth from the Last Ember',
    'music.tag.dawnLight': 'awakening',
    'music.tag.cloudsea': 'solitude',
    'music.tag.calmExploration': 'first light',
    'music.tag.cloudborne': 'courage',
    'music.tag.dreamlight': 'first flight',
    'music.tag.gentleDeparture': 'cloud sea',
    'music.tag.flowerFields': 'meadow',
    'music.tag.wonder': 'curiosity',
    'music.tag.warmJourney': 'freedom',
    'music.tag.flowerValley': 'companionship',
    'music.tag.bright': 'play',
    'music.tag.freeRoaming': 'flower court',
    'music.tag.forest': 'exposure',
    'music.tag.rainWashed': 'shelter',
    'music.tag.quietEchoes': 'guarded light',
    'music.tag.hiddenForest': 'loss',
    'music.tag.fireflyGlow': 'apology',
    'music.tag.explorationEchoes': 'renewed growth',
    'music.tag.racing': 'flight',
    'music.tag.flight': 'skill',
    'music.tag.brightMomentum': 'confidence',
    'music.tag.highSpeed': 'competition',
    'music.tag.synthesizer': 'playfulness',
    'music.tag.afterglowPulse': 'journey climax',
    'music.tag.weightlessness': 'memory',
    'music.tag.starCanopy': 'reflection',
    'music.tag.airySuspension': 'awe',
    'music.tag.starsea': 'wisdom',
    'music.tag.cruise': 'ascent',
    'music.tag.deepSpaceDrift': 'stillness',
    'music.tag.storm': 'pilgrimage',
    'music.tag.highPressure': 'fear',
    'music.tag.restrainedTension': 'sacrifice',
    'music.tag.pulse': 'release',
    'music.tag.stormeye': 'compassion',
    'music.tag.deepIntensity': 'rebirth',

    'touch.groupAria': 'Touch flight controls',
    'touch.leftAria': 'Hold to move left',
    'touch.jumpAria': 'Launch',
    'touch.rightAria': 'Hold to move right',
    'touch.throttleAria': 'Hold to accelerate',
    'touch.brakeAria': 'Hold to brake',

    'update.eyebrow': 'V23 Live Update',
    'update.title': 'Game update in progress',
    'update.message': 'The current release is synchronizing. You may continue after checks pass; if a core file or graphics environment fails, only Reload will remain available.',
    'update.checking': 'Checking whether the game can run safely…',
    'update.details': '{source}: {noticeId} · valid until {expiresAt}',
    'update.source.releaseMarker': 'Release marker',
    'update.source.modelDebug': 'Debug mode',
    'update.details.releaseMarker': 'Release marker: {noticeId} · valid until {expiresAt}',
    'update.details.modelDebug': 'Debug mode: {noticeId} · valid until {expiresAt}',
    'update.ready': 'Runtime checks passed. Continue to the launch screen or reload to obtain the newest files.',
    'update.continue': 'Continue anyway',
    'update.reload': 'Reload',
    'update.continueFailure': 'An error occurred while continuing, so safe recovery mode is now active. Reload the page.',

    'error.eyebrow': 'V23 Startup Recovery',
    'error.title': 'The game cannot start right now',
    'error.message': 'Reload the page, or check browser graphics support and game-file integrity.',
    'error.technical': 'Technical information',
    'error.reload': 'Reload',
    'error.webgl': 'The browser could not create a WebGL graphics environment. Enable hardware acceleration, update the browser, or retry on a WebGL-capable device.',
    'error.dependency': 'A core game dependency did not load. Confirm that the game directory is complete, then reload the page.',
    'error.windowsLocalFile': 'Windows isolated the directly opened local scripts, so the real failure cannot be read reliably. Double-click the only .cmd launcher in the game folder; it verifies the copied files and opens the game only on this PC.',
    'error.initialization': 'Game initialization did not finish. Reload the page; if the problem continues, check browser graphics support and game-file integrity.',
    'error.runtimeTitle': 'Game stopped safely',
    'error.runtimeMessage': 'A runtime error stopped the game safely. Reload the page and try again.',
    'error.graphicsTitle': 'Graphics environment interrupted',
    'error.graphicsMessage': 'The game stopped safely. Reload it; if the problem continues, enable hardware acceleration or use a WebGL-capable browser.',
    'error.canvasAria': 'Game view: hold the primary mouse button and drag to look around; release to recenter smoothly',

    'hint.main': 'V23 Sky Dawnflight starts from rest at 0 km/h. Releasing W immediately cuts excess pedal thrust; grounded Gear 1 creeps like a car on real idle torque, S stops it completely, and core rotation lets the exhaust decay naturally. With P off, M switches between manual W and continuous full throttle with no 120 km/h target cap; with P on, Autopilot alone commands throttle, coast, and braking. T independently switches MT / AT; Q / E own manual shifts, while AT disables Q/E and automatically covers all three gears at 90 / 70 and 140 / 120 km/h. F changes only the cinematic camera and adds show-mode life protection without changing or blocking P, M, T, steering, throttle, braking, jumping, or shifting.'
  });

  const MESSAGES = Object.freeze({
    'zh-CN': ZH_CN,
    en: EN
  });

  // Exact aliases cover the shipped mixed-language headings and short status codes that cannot be inferred safely
  // from a one-word source. They are migration inputs only; translated output always comes from the catalogs above.
  const SOURCE_ALIASES = Object.freeze({
    '3D CC Runner · V23 Sky Dawnflight': 'document.title',
    '1挡': 'gear.initialLabel',
    '推进挡位，当前1挡，已接合': 'gear.initialIndicatorAria',
    '降挡 / 升挡': 'guide.shortcut.gear',
    '较低渲染分辨率与阴影精度；隧道静态照明持续常亮，不启用动态局部聚光与阴影，优先保持移动端流畅。': 'quality.low.description',
    '平衡清晰度与性能；隧道静态照明持续常亮，不启用动态局部聚光与阴影，适合作为默认选择。': 'quality.medium.description',
    '电脑超高画质渲染、超精细主太阳阴影与高档专属后处理，并启用 6 盏动态隧道聚光（其中 2 盏投影），优先画面细节。': 'quality.high.description',
    'PC Ultra 渲染、8K 主太阳阴影与 High-only 后处理，优先画面细节。': 'quality.high.description',
    '电脑超高画质渲染、超精细主太阳阴影，并启用六盏原生动态聚光与两盏局部阴影。': 'quality.high.description',
    '玩法详情 · 飞行手册': 'guide.title',
    '手动转向 + 手动油门 · 0 公里/小时 · 3 命 / 0 烛 · 待命': 'guide.context.compactInitial',
    // Concise authored placeholders retain exact catalog ownership even when the complete localized contract is
    // intentionally longer; this also keeps no-script/source audits aligned with the same P/M/F authority rules.
    '金色刻度标记 P 领航的 120 km/h 普通巡航参考；P 关闭且 M 开启时持续满油门，不受该参考限制；数字始终显示真实速度。': 'hud.speedometer.scaleHelpInitial',
    'T 独立切换手动挡与自动挡；MT 显示 Q / E 手动换挡键，AT 接管三挡并隐藏这些键以回收空间，同时保留当前挡、自动阈值与三挡工作带；电影模式只换镜头并服从当前 MT / AT 权限。': 'gear.help',
    '从静止出发；P 关闭时 M 保持满油门，P 开启时领航统一调速；F 只切换安全电影镜头，驾驶权不变。': 'launch.summary',
    'P 统一调速 · M 满油门 · F 电影镜头': 'launch.footer.target',
    'P 关闭时 M 在 W 手动与持续满油门间切换；P 开启时领航统一调油、滑行和制动。': 'guide.quickstart.speed.body',
    'P 关闭时 M 满油门无目标上限；P 开启时领航拥有唯一纵向权威。': 'guide.feature.throttleModes.body',
    '满油门偏好': 'guide.shortcut.throttle',
    'P 关闭时 M 切换 W 手动或持续满油门；P 开启时由领航统一拥有纵向权威。': 'guide.authority.intro',
    '系统统一选路、转向、调油与制动。': 'guide.authority.mode.guidedBody',
    'P 关闭时油门保持 100%，不追踪 120。': 'guide.authority.mode.cruiseBody',
    '只要 P 开启，障碍、弯道和道路边界制动都由同一领航纵向权威处理，与 M 偏好无关。': 'guide.authority.brakeNote',
    '120 是 P 的普通巡航参考，不是 M 满油门的速度上限。': 'guide.feature.speedGuidance.body',
    'P 统一负责选路、转向、调油、滑行与制动；M 只保存退出 P 后的偏好。': 'guide.feature.autopilot.body',
    '普通 P 领航不锁血；F 电影模式只换镜头并提供演出免伤，不接管驾驶。': 'guide.rule.noCheat',
    'V23 天际晨航：P 关闭时 M 为持续满油门且没有 120 km/h 目标上限；P 开启时领航统一调油、滑行和制动；F 只换电影镜头，不改变或屏蔽任何驾驶控制。': 'hint.main',
    // These authored guide leaves intentionally lack declarative keys, so exact aliases keep locale switching
    // attached to the decision-focused catalog copy instead of depending on punctuation normalization.
    'F 只启用电影镜头而不改变 MT / AT：MT 继续显示并允许 Q / E，AT 继续隐藏手动换挡键并自动接管；其余驾驶输入照常可用，普通接触不扣生命。': 'guide.feature.viewFullscreen.body',
    '地图会按场景切换路线细节、立交总览和分流引导。金白实线是已选路线，金色虚线是候选路线，红色是障碍，蓝色是烛光；优先看顶部下一指令和距分流数值。': 'guide.feature.routeMap.body',
    '露天路面会随天气逐步形成积水、积雪、雪泥或积尘；隧道内保持干燥。水坑和积雪会改变接地反馈，因此高速时要提前留出转向与制动余量。': 'guide.feature.surfaceWeather.body',
    '飞船压过露天积水会产生涟漪、水花与尾流，压过积雪会留下双沟和雪粉；这些接触会给手动和领航施加相同、有限的阻力与侧滑，但不改路线、碰撞或生命。': 'guide.feature.shipWeather.body',
    'HUD 的“光影 开 / 关”可随时停用真实灯光、HDR 环境反射与投影阴影；关闭后保留无投影阴影的均匀底光和轻微接地提示，让露天与隧道路面仍清楚可见。切换只改变画面与渲染开销，不修改速度、路线、碰撞、生命或领航。': 'guide.feature.lighting.body',
    'HUD 的“光影 开 / 关”可随时停用真实灯光、HDR 环境反射与投影阴影；关闭后保留无投影阴影的均匀底光和轻微接地提示，让露天与隧道路面仍清楚可见。开启时仍遵守画质边界：低和中画质不启用动态隧道或桥底聚光，高画质才启用这些局部灯与阴影。切换只改变画面与渲染开销，不修改速度、路线、碰撞、生命或领航。': 'guide.feature.lighting.body',
    '电驱核心、谐波与风噪已压低到配乐之后，刹车、碰撞和路线提示仍清楚；V 会同时控制并记住全部声音。': 'guide.feature.audio.body',
    '六首 CC0 无人声配乐分别对应晨岛、云野、雨林、霞谷、禁阁与伊甸；可随区域自动换曲、顺序播放、漫游随机或亲自点选，曲库指示条读取真实五频段随乐章起伏；每境扩大到 18km，在合同极速仍至少停留 60 秒。': 'guide.feature.music.body',
    '六境各有一首无人声主题曲，让云海、花野、雨林、暮光、星穹与风眼拥有自己的呼吸。': 'music.description',
    '开始页可先选择画质；飞行中按 O / Esc 暂停后也能切换。低和中画质保持原有直接渲染；高画质启用 PC Ultra 分辨率预算、程序化 PBR、空间遮蔽、显式发光 Bloom 与 Filmic 分级。高画质地貌的颗粒和明暗斑块锁定绝对世界坐标，飞船前进时会相对向后掠过，不会粘住镜头。道路、障碍、可视距离、碰撞、速度与本局进度保持不变。': 'guide.feature.quality.body',
    '开始页可先选择画质；飞行中按 O / Esc 暂停后也能切换。低和中画质保留原有直接渲染、全段常亮的隧道灯罩与扩散片，以及道路、墙顶和灯壳的静态基础照度；它们不扫描、不选择也不预热动态隧道或桥底聚光，局部阴影开销为零。高画质除启用电脑超高分辨率预算、程序化物理材质、空间遮蔽、显式辉光与电影级色调外，还独享六盏原生动态聚光、两盏局部阴影，以及按路线边和隧道剖面匹配的电影镜头灯组交接。高画质地貌的颗粒和明暗斑块锁定绝对世界坐标，飞船前进时会相对向后掠过，不会粘住镜头。道路、障碍、可视距离、碰撞、速度与本局进度保持不变。': 'guide.feature.quality.body',
    '晨岛云海↔海洋、云野花庭↔草地、雨林幽光↔湿地、霞谷暮光↔苔原、禁阁星穹↔星界浅滩、伊甸风眼↔火山荒地，共用同一当前区域、下一地区和混合进度。': 'guide.feature.realmPairing.body',
    '太阳、月亮、雷电、桥底灯与隧道顶灯是真实投影光源，太阳始终是露天最主要、最亮的光源；道路之外的地貌与景物也接收真实投影阴影。普通开放桥下保留天空与 HDR 能量，由实体桥面自然投影，不再误按深隧道压黑；桥底灯只有进入桥影中心且自然光不足时才渐亮，局部灯合计路面照度始终低于太阳，晴朗白天保持关闭，避免道路发白。山体廊道与地下隧道沿各自完整路线独立密排灯具，整段每一个灯罩和扩散片始终可见发亮；灯罩只负责表现，顶棚结构、侧墙和道路本身不自发光。隧道灯只绑定当前路线和隧道：真实局部光仅选择 edge 与 profile 同时匹配的 authored emitter；接近洞门时会根据相机前方路线预先准备，只有洞外观察的照明交接随洞门距离渐入，不改变隧道内全部灯具的固定常亮状态。找不到匹配记录时保持关闭，绝不生成跟随飞船的兜底灯。进入洞门后 HDR/环境光、天体直射与曝光连续衰减，匹配聚光在真实灯具下形成有限光池并投影阴影；远处、相邻路线或错误 profile 不会串光。封闭隧道还会沿洞门连续移除室外暴雪、浓雾与沙尘造成的能见度衰减，深处恢复当前境界的正常基础雾距。飞船的引擎、烛芯和警示采用可见自发光材质，避免跟随飞船的点光源在道路上产生无灯具亮斑。1K / 2K / 8K 主太阳阴影随低 / 中 / 高画质切换，高画质在设备不支持时安全回退 4K；HDR 天空反射和 ACES 色调映射继续照亮实际立交道路、地貌、景物、分层云与物理积水；雷暴采用主闪和回闪而不是单帧硬白。': 'guide.feature.weatherLighting.body',
    '太阳、月亮与雷电是真实投影光源，太阳始终是露天最主要、最亮的光源；道路之外的地貌与景物也接收真实投影阴影。普通开放桥下保留天空与 HDR 能量，由实体桥面自然投影，不再误按深隧道压黑；桥底灯具外观保留，只有高画质的桥底动态聚光会在桥影中心且自然光不足时渐亮，其合计路面照度始终低于太阳，晴朗白天保持关闭。山体廊道与地下隧道沿各自完整路线独立密排灯具；所有画质都让整段灯罩和扩散片始终可见发亮，并让道路、连续墙顶与肋架灯壳在原绘制批次内接收无距离门控的静态基础照度，结构壳、侧墙和道路本身仍不自发光。低和中画质不扫描、不选择也不预热任何动态隧道或桥底聚光，六个聚光槽全部隐藏且局部阴影开销为零。只有高画质启用六盏复用聚光，其中两盏投影阴影；动态隧道灯只选择路线边与隧道剖面同时匹配的原生发射记录，电影模式则完成摄影机最近灯组的平滑交接。接近洞门时只有高画质会根据相机前方路线预备动态灯，洞外照明交接随洞门距离渐入，但不得改变全档灯罩、扩散片和静态基础照度的固定常亮状态。找不到匹配记录时保持关闭，绝不生成跟随飞船的兜底灯。进入洞门后 HDR 环境光、天体直射与曝光连续衰减；仅高画质的匹配聚光在真实灯具下形成有限光池并投影阴影，远处、相邻路线或错误剖面不会串光。封闭隧道还会沿洞门连续移除室外暴雪、浓雾与沙尘造成的能见度衰减，深处恢复当前境界的正常基础雾距。飞船的引擎、烛芯和警示采用可见自发光材质，避免跟随飞船的点光源在道路上产生无灯具亮斑。1K / 2K / 8K 主太阳阴影随低 / 中 / 高画质切换，高画质在设备不支持时安全回退 4K；局部阴影目标只由高画质分配。HDR 天空反射和 ACES 色调映射继续照亮实际立交道路、地貌、景物、分层云与物理积水；雷暴采用主闪和回闪而不是单帧硬白。': 'guide.feature.weatherLighting.body',
    '3 / 3 生命': 'hud.lives.initialAria',
    '切换为英文': 'language.switch.aria',
    '起飞': 'touch.jumpAria',
    'NAV / LIVE': 'navigation.eyebrow',
    'AIRFRAME / VISUAL LOCK': 'launch.stage.lock',
    'V23 · SKY DAWNFLIGHT': 'launch.stage.name',
    CLASS: 'launch.stage.class',
    SPAN: 'launch.stage.span',
    CORE: 'launch.stage.core',
    CANDLELIGHT: 'launch.stage.coreValue',
    'PRE-FLIGHT / 待启航': 'launch.mode.launch',
    'FLIGHT HOLD / 已暂停': 'launch.mode.pause',
    'RUN COMPLETE / 航程结束': 'launch.mode.gameover',
    'NEON AUTOPILOT · V23': 'launch.brand',
    'V23 · SKY': 'launch.title.top',
    DAWNFLIGHT: 'launch.title.bottom',
    'READY / 01': 'launch.status.ready',
    'HOLD / O': 'launch.status.hold',
    'ARCHIVE / 03': 'launch.status.archive',
    'MISSION PROFILE': 'launch.briefing.eyebrow',
    'RUN CONFIG': 'launch.config.eyebrow',
    'FLIGHT MANUAL · V23': 'guide.eyebrow',
    'MISSION INDEX': 'guide.tabs.heading',
    'FLIGHT CONTROL': 'guide.controls.kicker',
    'ROUTE INTELLIGENCE': 'guide.navigation.kicker',
    'FAIR FLIGHT CONTRACT': 'guide.fairness.kicker',
    'LIVING SKY WORLD': 'guide.world.kicker',
    'CHAPTER NAVIGATION': 'guide.footer.heading',
    'SKY REALM SCORE · CC0': 'music.eyebrow',
    'SKY REALM NARRATIVE SCORE': 'music.eyebrow',
    'PLAY MODE': 'music.mode.heading',
    'SIX REALMS': 'music.tracks.heading',
    'V23 LIVE UPDATE': 'update.eyebrow',
    'V23 STARTUP RECOVERY': 'error.eyebrow',
    SPACE: 'input.key.space',
    HUD: 'common.hudMark',
    FPS: 'common.fpsMark',
    FX: 'common.effectsMark',
    '-- FPS': 'hud.frameRate.pendingValue',
    OFF: 'hud.autopilot.offValue',
    ON: 'hud.autopilot.onValue'
  });

  /**
   * Normalize legacy Chinese copy only for reverse lookup.
   *
   * This removes embedded English UI vocabulary without altering the actual source or emitted translation. Stable
   * identifiers, query flags, route codes, license names, and keyboard shortcuts intentionally remain untouched.
   */
  function canonicalizeSource(source) {
    return String(source ?? '')
      .trim()
      .replace(/\bSky Dawnflight\b/gu, '天际晨航')
      .replace(/\bPC Ultra\b/gu, '电脑超高画质')
      .replace(/\bHigh-only\b/gu, '高档专属')
      .replace(/\bHUD\b/gu, '抬头显示界面')
      .replace(/\bHDR\b/gu, '高动态范围')
      .replace(/\bPBR\b/gu, '物理材质')
      .replace(/\bBloom\b/gu, '辉光')
      .replace(/\bFilmic\b/gu, '电影级色调')
      .replace(/\bSPACE\b/gu, '空格')
      .replace(/\bID\b/gu, '编号')
      .replace(/(\d[\d,.]*)\s*km\/h\b/giu, '每小时 $1 公里')
      .replace(/(\d[\d,.]*)\s*m\/s\b/giu, '每秒 $1 米')
      .replace(/(\d[\d,.]*)\s*km\b/giu, '$1 千米')
      .replace(/(\d[\d,.]*)\s*m\b/giu, '$1 米');
  }

  /** Ignore presentational punctuation and spacing when matching otherwise identical authored sentences. */
  function sourceFingerprint(source) {
    return canonicalizeSource(source)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s,.;:!?'"“”‘’、，。；：！？·/()（）↔]/gu, '');
  }

  /** Reject an incomplete catalog at load time so one language can never silently ship a partial interface. */
  function validateCatalogs() {
    const referenceKeys = Object.keys(ZH_CN).sort();
    const englishKeys = Object.keys(EN).sort();
    if (referenceKeys.length !== englishKeys.length
      || referenceKeys.some((key, index) => key !== englishKeys[index])) {
      const missingEnglish = referenceKeys.filter((key) => !Object.hasOwn(EN, key));
      const missingChinese = englishKeys.filter((key) => !Object.hasOwn(ZH_CN, key));
      throw new TypeError(
        `V23 i18n catalogs differ; missing English: ${missingEnglish.join(', ') || 'none'}; `
          + `missing Chinese: ${missingChinese.join(', ') || 'none'}`
      );
    }
    for (const [key, value] of Object.entries(EN)) {
      if (HAN_PATTERN.test(value)) throw new TypeError(`English V23 i18n message contains Han text: ${key}`);
    }
  }

  validateCatalogs();

  /** Normalize only the two public language contracts while accepting common URL and browser aliases. */
  function normalizeLanguage(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh_hans') return 'zh-CN';
    if (normalized === 'en' || normalized === 'en-us' || normalized === 'en_us') return 'en';
    return null;
  }

  /** Replace named tokens as text; callers remain responsible for providing every business-required parameter. */
  function interpolate(template, parameters = {}) {
    return String(template).replace(TEMPLATE_TOKEN_PATTERN, (token, name) => (
      Object.hasOwn(parameters, name) ? String(parameters[name]) : token
    ));
  }

  /** Build a compatibility index for old call sites that still hold authored display text instead of stable keys. */
  function buildSourceKeyIndex() {
    const sourceKeys = new Map();
    for (const [source, key] of Object.entries(SOURCE_ALIASES)) {
      sourceKeys.set(source, key);
      sourceKeys.set(canonicalizeSource(source), key);
      sourceKeys.set(sourceFingerprint(source), key);
    }
    for (const catalog of Object.values(MESSAGES)) {
      for (const [key, value] of Object.entries(catalog)) {
        if (!sourceKeys.has(value)) sourceKeys.set(value, key);
        const canonical = canonicalizeSource(value);
        if (!sourceKeys.has(canonical)) sourceKeys.set(canonical, key);
        const fingerprint = sourceFingerprint(value);
        if (!sourceKeys.has(fingerprint)) sourceKeys.set(fingerprint, key);
      }
    }
    return sourceKeys;
  }

  const SOURCE_KEY_INDEX = buildSourceKeyIndex();
  const TEMPLATE_SOURCE_ENTRIES = Object.freeze(Object.values(MESSAGES).flatMap((catalog) => (
    Object.entries(catalog).filter(([, value]) => value.includes('{'))
  )));

  /** Create one independent language controller for a browser window or a deterministic test host. */
  function createI18n(scope = {}, options = {}) {
    const documentObject = options.document ?? scope.document ?? null;
    const startup = options.startup ?? scope.NeonV23Startup ?? null;
    const diagnostics = {
      initialSource: 'default',
      languageChanges: 0,
      applyCount: 0,
      mutationApplyCount: 0,
      missingKeyCount: 0,
      storageReadAvailable: typeof startup?.readString === 'function',
      storageWriteAvailable: typeof startup?.writeString === 'function',
      lastStorageWriteSucceeded: null
    };
    const subscribers = new Set();
    const textSources = new WeakMap();
    const textOutputs = new WeakMap();
    const attributeSources = new WeakMap();
    const attributeOutputs = new WeakMap();
    const boundLanguageToggles = new WeakSet();
    let mutationObserver = null;

    /** URL language is an explicit, session-only override and must not mutate a persisted player choice. */
    function languageFromUrl() {
      try {
        const parameters = new URLSearchParams(scope.location?.search || '');
        return normalizeLanguage(parameters.get('lang'));
      } catch (_error) {
        return null;
      }
    }

    /** Read language only through the startup storage boundary; unavailable storage safely falls back to Chinese. */
    function languageFromStorage() {
      if (typeof startup?.readString !== 'function') return null;
      return normalizeLanguage(startup.readString(STORAGE_KEY, null));
    }

    const urlLanguage = languageFromUrl();
    const storedLanguage = urlLanguage ? null : languageFromStorage();
    let currentLanguage = urlLanguage || storedLanguage || DEFAULT_LANGUAGE;
    diagnostics.initialSource = urlLanguage ? 'url' : storedLanguage ? 'storage' : 'default';

    /** Resolve a stable message key in the active language and interpolate named text parameters. */
    function translate(key, parameters = {}, translateOptions = {}) {
      const messageKey = String(key ?? '');
      const catalog = MESSAGES[currentLanguage];
      if (Object.hasOwn(catalog, messageKey)) return interpolate(catalog[messageKey], parameters);
      diagnostics.missingKeyCount++;
      if (translateOptions.strict === true) throw new RangeError(`Unknown V23 i18n key: ${messageKey}`);
      return interpolate(translateOptions.fallback ?? messageKey, parameters);
    }

    /** Short alias for translate(), retained for compact dynamic UI and Canvas rendering call sites. */
    function t(key, parameters = {}, translateOptions = {}) {
      return translate(key, parameters, translateOptions);
    }

    /**
     * Translate a stable key or an exact legacy source string.
     *
     * This migration helper keeps cached gameplay objects language-neutral: new code should store keys and call t()
     * at presentation time, while old immutable metadata may pass its current Chinese or English display value here.
     */
    function translateSource(source, parameters = {}, translateOptions = {}) {
      const candidate = String(source ?? '');
      if (Object.hasOwn(MESSAGES[currentLanguage], candidate)) {
        return translate(candidate, parameters, translateOptions);
      }
      if (LANGUAGE_NEUTRAL_STANDALONE_TOKEN_PATTERN.test(candidate.trim())) return candidate;
      let resolvedKey = SOURCE_KEY_INDEX.get(candidate)
        || SOURCE_KEY_INDEX.get(canonicalizeSource(candidate))
        || SOURCE_KEY_INDEX.get(sourceFingerprint(candidate));
      if (!resolvedKey && Object.keys(parameters).length > 0) {
        const canonicalCandidate = canonicalizeSource(candidate);
        const fingerprintCandidate = sourceFingerprint(candidate);
        for (const [key, template] of TEMPLATE_SOURCE_ENTRIES) {
          const renderedSource = interpolate(template, parameters);
          if (candidate === renderedSource
            || canonicalCandidate === canonicalizeSource(renderedSource)
            || fingerprintCandidate === sourceFingerprint(renderedSource)) {
            resolvedKey = key;
            break;
          }
        }
      }
      if (resolvedKey) return translate(resolvedKey, parameters, translateOptions);
      if (translateOptions.strict === true) throw new RangeError(`Unknown V23 i18n source: ${candidate}`);
      return interpolate(translateOptions.fallback ?? candidate, parameters);
    }

    /** Parse one declarative attribute map without evaluating authored markup or script. */
    function parseAttributeBindings(element) {
      const source = element.getAttribute?.('data-i18n-attr') || '';
      if (!source.trim()) return [];
      if (source.trim().startsWith('{')) {
        const parsed = JSON.parse(source);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new TypeError('data-i18n-attr JSON must be an object');
        }
        return Object.entries(parsed);
      }
      return source.split(/[;,]/u).filter(Boolean).map((binding) => {
        const separator = binding.includes(':') ? ':' : '=';
        const separatorIndex = binding.indexOf(separator);
        if (separatorIndex <= 0) throw new TypeError(`Invalid data-i18n-attr binding: ${binding}`);
        return [
          binding.slice(0, separatorIndex).trim(),
          binding.slice(separatorIndex + 1).trim()
        ];
      });
    }

    /** Read optional interpolation values as inert JSON data. */
    function readElementParameters(element) {
      const source = element.getAttribute?.('data-i18n-params');
      if (!source) return {};
      const parsed = JSON.parse(source);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError('data-i18n-params must be a JSON object');
      }
      return parsed;
    }

    /** Record one module-owned attribute write so the observer never mistakes its own translation for new source text. */
    function setTranslatedAttribute(element, attributeName, value) {
      let outputs = attributeOutputs.get(element);
      if (!outputs) {
        outputs = new Map();
        attributeOutputs.set(element, outputs);
      }
      outputs.set(attributeName, String(value));
      element.setAttribute(attributeName, String(value));
    }

    /** Apply text and accessible attributes to one authored leaf without ever parsing translated HTML. */
    function applyElement(element) {
      const parameters = readElementParameters(element);
      const textKey = element.getAttribute?.('data-i18n');
      if (textKey) element.textContent = translate(textKey, parameters, { strict: true });
      for (const [attributeName, key] of parseAttributeBindings(element)) {
        setTranslatedAttribute(element, attributeName, translate(key, parameters, { strict: true }));
      }
      for (const attributeName of ['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt']) {
        const key = element.getAttribute?.(`data-i18n-${attributeName}`);
        if (key) {
          setTranslatedAttribute(element, attributeName, translate(key, parameters, { strict: true }));
        }
      }
    }

    /** Return true when a declarative owner or language toggle must retain authority over this text node. */
    function hasExplicitTextOwner(textNode) {
      let owner = textNode.parentElement || textNode.parentNode || null;
      while (owner && owner !== documentObject) {
        const tagName = String(owner.tagName || '').toLowerCase();
        if (['script', 'style', 'template', 'noscript'].includes(tagName)) return true;
        if (owner.getAttribute?.('data-i18n')
          || owner.hasAttribute?.('data-language-toggle')
          || owner.hasAttribute?.('data-i18n-ignore')) return true;
        owner = owner.parentElement || owner.parentNode || null;
      }
      return false;
    }

    /** Preserve surrounding layout whitespace while translating one known authored text leaf. */
    function translateTextValue(source) {
      const value = String(source ?? '');
      const leading = value.match(/^\s*/u)?.[0] || '';
      const trailing = value.match(/\s*$/u)?.[0] || '';
      const contentEnd = Math.max(leading.length, value.length - trailing.length);
      const content = value.slice(leading.length, contentEnd);
      if (!content) return value;
      return `${leading}${translateSource(content)}${trailing}`;
    }

    /** Reapply one ordinary text node from its remembered authored/runtime source rather than its last translation. */
    function applyAutomaticTextNode(textNode, refreshSource = false) {
      if (!textNode || textNode.nodeType !== 3 || hasExplicitTextOwner(textNode)) return false;
      if (refreshSource || !textSources.has(textNode)) textSources.set(textNode, textNode.nodeValue || '');
      const translated = translateTextValue(textSources.get(textNode));
      textOutputs.set(textNode, translated);
      if (textNode.nodeValue !== translated) textNode.nodeValue = translated;
      return true;
    }

    /** Identify attributes already owned by explicit keys so automatic source translation cannot overwrite them. */
    function explicitAttributeNames(element) {
      const names = new Set(parseAttributeBindings(element).map(([attributeName]) => attributeName));
      for (const attributeName of ['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt']) {
        if (element.getAttribute?.(`data-i18n-${attributeName}`)) names.add(attributeName);
      }
      return names;
    }

    /** Translate one known user-facing attribute from its authoritative source value. */
    function applyAutomaticAttribute(element, attributeName, refreshSource = false) {
      if (!element?.hasAttribute?.(attributeName)
        || element.hasAttribute?.('data-i18n-ignore')
        || element.hasAttribute?.('data-language-toggle')
        || explicitAttributeNames(element).has(attributeName)) return false;
      let sources = attributeSources.get(element);
      if (!sources) {
        sources = new Map();
        attributeSources.set(element, sources);
      }
      if (refreshSource || !sources.has(attributeName)) {
        sources.set(attributeName, element.getAttribute(attributeName) || '');
      }
      const translated = translateSource(sources.get(attributeName));
      setTranslatedAttribute(element, attributeName, translated);
      return true;
    }

    /** Collect text nodes without relying on TreeWalker so the same contract works in small deterministic fixtures. */
    function collectTextNodes(root, output = []) {
      if (!root) return output;
      if (root.nodeType === 3) {
        output.push(root);
        return output;
      }
      for (const child of Array.from(root.childNodes || [])) collectTextNodes(child, output);
      return output;
    }

    /** Collect every element under a document, fragment, or element exactly once. */
    function collectElements(root) {
      const elements = [];
      if (root?.nodeType === 1 || typeof root?.matches === 'function') elements.push(root);
      if (typeof root?.querySelectorAll === 'function') elements.push(...root.querySelectorAll('*'));
      return [...new Set(elements)];
    }

    /** Keep every full or compact language control synchronized and bound to the same persisted authority. */
    function syncLanguageToggle(button) {
      if (!button) return;
      const compact = button.hasAttribute?.('data-language-compact');
      button.textContent = translate(compact ? 'language.switch.compact' : 'language.switch.visible');
      setTranslatedAttribute(button, 'aria-label', translate('language.switch.aria'));
      setTranslatedAttribute(button, 'aria-pressed', String(currentLanguage === 'en'));
      button.dataset ??= {};
      button.dataset.language = currentLanguage;
      if (boundLanguageToggles.has(button) || typeof button.addEventListener !== 'function') return;
      boundLanguageToggles.add(button);
      button.addEventListener('click', () => {
        setLanguage(currentLanguage === 'zh-CN' ? 'en' : 'zh-CN', {
          source: button.getAttribute?.('data-language-source') || 'language-toggle'
        });
      });
    }

    /** Synchronize document metadata before dynamic subscribers redraw their current state. */
    function applyDocumentMetadata() {
      if (!documentObject) return;
      const translatedTitle = translate('document.title');
      // document.title replaces the title text node even when the value is unchanged in browsers. Keep every
      // metadata write idempotent so the subtree observer cannot turn one dynamic insertion into a title loop.
      if (documentObject.title !== translatedTitle) documentObject.title = translatedTitle;
      const root = documentObject.documentElement;
      if (!root) return;
      if (root.lang !== currentLanguage) root.lang = currentLanguage;
      if (root.dir !== 'ltr') root.dir = 'ltr';
      root.dataset ??= {};
      if (root.dataset.language !== currentLanguage) root.dataset.language = currentLanguage;
    }

    /**
     * Apply explicit bindings first, then translate known legacy text and accessibility attributes from remembered
    * source values. WeakMap authority lets repeated Chinese/English switches remain reversible without HTML clones.
     */
    function apply(root = documentObject) {
      // Local observer work must not rewrite document-wide metadata. A browser title assignment mutates <title>,
      // which would otherwise feed a fresh childList record back into this observer indefinitely.
      if (root === documentObject || root === documentObject?.documentElement) applyDocumentMetadata();
      if (!root) return 0;
      const selector = [
        '[data-i18n]',
        '[data-i18n-attr]',
        '[data-i18n-aria-label]',
        '[data-i18n-aria-valuetext]',
        '[data-i18n-title]',
        '[data-i18n-placeholder]',
        '[data-i18n-alt]'
      ].join(',');
      const elements = [];
      if (typeof root.matches === 'function' && root.matches(selector)) elements.push(root);
      if (typeof root.querySelectorAll === 'function') elements.push(...root.querySelectorAll(selector));
      const uniqueElements = [...new Set(elements)];
      for (const element of uniqueElements) applyElement(element);
      const allElements = collectElements(root);
      for (const element of allElements) {
        for (const attributeName of ['aria-label', 'aria-valuetext', 'title', 'placeholder']) {
          applyAutomaticAttribute(element, attributeName);
        }
      }
      for (const textNode of collectTextNodes(root)) applyAutomaticTextNode(textNode);
      const toggles = allElements.filter((element) => element.hasAttribute?.('data-language-toggle'));
      for (const button of toggles) syncLanguageToggle(button);
      diagnostics.applyCount++;
      return uniqueElements.length + allElements.length;
    }

    /** Format player-facing numbers with the active language's grouping and decimal conventions. */
    function formatNumber(value, formatOptions = {}) {
      const locale = currentLanguage === 'zh-CN' ? 'zh-CN' : 'en-US';
      return new Intl.NumberFormat(locale, formatOptions).format(Number(value));
    }

    /** Notify in-process owners first, then publish the same immutable detail to browser event consumers. */
    function notifyLanguageChange(previousLanguage, source) {
      const detail = Object.freeze({
        previousLanguage,
        language: currentLanguage,
        source
      });
      for (const listener of [...subscribers]) listener(detail);
      if (typeof scope.dispatchEvent === 'function' && typeof scope.CustomEvent === 'function') {
        scope.dispatchEvent(new scope.CustomEvent(LANGUAGE_CHANGE_EVENT, { detail }));
      }
    }

    /** Re-translate externally changed or newly inserted UI while ignoring this module's own observer records. */
    function handleMutations(records) {
      for (const record of records) {
        if (record.type === 'characterData') {
          const output = textOutputs.get(record.target);
          if (output === record.target.nodeValue) continue;
          applyAutomaticTextNode(record.target, true);
          diagnostics.mutationApplyCount++;
          continue;
        }
        if (record.type === 'attributes') {
          const element = record.target;
          const attributeName = record.attributeName;
          const currentValue = element.getAttribute?.(attributeName) || '';
          if (attributeOutputs.get(element)?.get(attributeName) === currentValue) continue;
          if (attributeName.startsWith('data-i18n')
            || attributeName === 'data-language-toggle'
            || attributeName === 'data-language-compact') {
            apply(element);
          } else {
            applyAutomaticAttribute(element, attributeName, true);
          }
          diagnostics.mutationApplyCount++;
          continue;
        }
        if (record.type === 'childList') {
          for (const node of Array.from(record.addedNodes || [])) {
            apply(node);
            diagnostics.mutationApplyCount++;
          }
        }
      }
    }

    /** Observe only user-facing text and localization hooks; rendering/gameplay attributes remain outside this layer. */
    function startMutationObserver() {
      if (options.observe === false
        || mutationObserver
        || typeof scope.MutationObserver !== 'function'
        || !documentObject?.documentElement) return false;
      mutationObserver = new scope.MutationObserver(handleMutations);
      mutationObserver.observe(documentObject.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'aria-label',
          'aria-valuetext',
          'title',
          'placeholder',
          'data-i18n',
          'data-i18n-attr',
          'data-i18n-params',
          'data-i18n-aria-label',
          'data-i18n-aria-valuetext',
          'data-i18n-title',
          'data-i18n-placeholder',
          'data-language-toggle',
          'data-language-compact'
        ]
      });
      return true;
    }

    /** Disconnect automatic DOM observation without changing the current language or translated content. */
    function disconnect() {
      if (!mutationObserver) return false;
      mutationObserver.disconnect();
      mutationObserver = null;
      return true;
    }

    /**
     * Change language atomically for one frame: persist, update document/static DOM, then notify dynamic owners.
     *
     * A storage failure never rolls back the visible choice; persistence is a convenience, not gameplay authority.
     */
    function setLanguage(language, setOptions = {}) {
      const normalized = normalizeLanguage(language);
      if (!normalized) throw new RangeError(`Unsupported V23 UI language: ${language}`);
      const shouldPersist = setOptions.persist !== false;
      if (shouldPersist && typeof startup?.writeString === 'function') {
        diagnostics.lastStorageWriteSucceeded = startup.writeString(STORAGE_KEY, normalized) !== false;
      }
      if (normalized === currentLanguage) {
        if (setOptions.apply !== false) apply(setOptions.root ?? documentObject);
        return false;
      }
      const previousLanguage = currentLanguage;
      currentLanguage = normalized;
      if (setOptions.apply !== false) apply(setOptions.root ?? documentObject);
      diagnostics.languageChanges++;
      notifyLanguageChange(previousLanguage, setOptions.source || 'api');
      return true;
    }

    /** Subscribe to post-apply language changes and return an idempotent unsubscribe function. */
    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('V23 i18n subscriber must be a function');
      subscribers.add(listener);
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return subscribers.delete(listener);
      };
    }

    /** Return an immutable diagnostic snapshot without exposing subscriber or DOM ownership. */
    function getDiagnostics() {
      return Object.freeze({
        ...diagnostics,
        language: currentLanguage,
        subscriberCount: subscribers.size
      });
    }

    /** Expose the frozen catalog for static contract tests and data-module key resolution. */
    function getCatalog(language = currentLanguage) {
      const normalized = normalizeLanguage(language);
      if (!normalized) throw new RangeError(`Unsupported V23 UI language: ${language}`);
      return MESSAGES[normalized];
    }

    const api = {
      DEFAULT_LANGUAGE,
      SUPPORTED_LANGUAGES,
      STORAGE_KEY,
      LANGUAGE_CHANGE_EVENT,
      get language() {
        return currentLanguage;
      },
      translate,
      t,
      translateSource,
      setLanguage,
      apply,
      subscribe,
      formatNumber,
      getCatalog,
      getDiagnostics,
      disconnect
    };

    if (options.autoApply !== false) apply(documentObject);
    startMutationObserver();
    return Object.freeze(api);
  }

  return Object.freeze({
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    STORAGE_KEY,
    LANGUAGE_CHANGE_EVENT,
    MESSAGES,
    normalizeLanguage,
    createI18n
  });
});
