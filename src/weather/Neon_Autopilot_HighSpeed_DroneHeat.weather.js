/*
 * Neon deterministic weather field and forecast contract.
 * Weather is visual-only: it samples the same route-realm coordinate as terrain and never owns gameplay state.
 */
window.NeonWeather = (() => {
  'use strict';

  const PROFILE_FIELDS = Object.freeze([
    'cloudCover',
    'cloudDarkness',
    'rain',
    'snow',
    'hail',
    'dust',
    'fog',
    'wind',
    'gust',
    'lightning',
    'wetness',
    'snowCover',
    'visibility',
    'intensity'
  ]);
  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
  const smootherstep = (value) => {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const TUNNEL_WEATHER_SHELTER_CONTRACT = Object.freeze({
    blockedTunnelKinds: Object.freeze(['mountain-tunnel', 'underground-tunnel']),
    precipitation: 'local-zero-with-outdoor-weather-state-retained',
    surfaceSnow: 'open-sky-route-only',
    visibility: 'realm-baseline-at-full-enclosure',
    portalTransition: 'route-underpass-smootherstep',
    visualOnly: true
  });
  const OPEN_AIR_VISIBILITY_CONTRACT = Object.freeze({
    version: 1,
    mode: 'profile-visibility-with-aerosol-extinction',
    fogExtinctionWeight: 0.42,
    dustExtinctionWeight: 0.28,
    maximumAerosolExtinction: 0.55,
    minimumVisibilityScale: 0.10,
    fogNearCapActivationObscuration: 0.10,
    fogNearMaximumM: 18,
    fogNearMinimumM: 4,
    presentationOnly: true
  });

  /**
   * Compound the authored visibility with fog and airborne dust instead of letting either aerosol stay cosmetic.
   * The bounded result is presentation-only and deliberately leaves clear weather and all gameplay contracts intact.
   */
  function resolveOpenAirVisibility(weather = {}, out = null) {
    const target = out || {};
    const rawVisibility = Number(weather?.visibility);
    const profileVisibility = Number.isFinite(rawVisibility) ? clamp01(rawVisibility) : 1;
    const fog = clamp01(weather?.fog);
    const dust = clamp01(weather?.dust);
    const aerosolExtinction = Math.min(
      OPEN_AIR_VISIBILITY_CONTRACT.maximumAerosolExtinction,
      fog * OPEN_AIR_VISIBILITY_CONTRACT.fogExtinctionWeight
        + dust * OPEN_AIR_VISIBILITY_CONTRACT.dustExtinctionWeight
    );
    const outdoorVisibility = Math.max(
      OPEN_AIR_VISIBILITY_CONTRACT.minimumVisibilityScale,
      profileVisibility * (1 - aerosolExtinction)
    );
    const outdoorObscuration = Math.max(fog, dust, 1 - outdoorVisibility);
    const capProgress = smootherstep(
      (outdoorObscuration - OPEN_AIR_VISIBILITY_CONTRACT.fogNearCapActivationObscuration)
        / (1 - OPEN_AIR_VISIBILITY_CONTRACT.fogNearCapActivationObscuration)
    );
    target.profileVisibility = profileVisibility;
    target.aerosolExtinction = aerosolExtinction;
    target.outdoorVisibility = outdoorVisibility;
    target.outdoorObscuration = outdoorObscuration;
    target.fogNearCapActive = outdoorObscuration
      > OPEN_AIR_VISIBILITY_CONTRACT.fogNearCapActivationObscuration;
    target.fogNearCapM = OPEN_AIR_VISIBILITY_CONTRACT.fogNearMaximumM
      + (OPEN_AIR_VISIBILITY_CONTRACT.fogNearMinimumM
        - OPEN_AIR_VISIBILITY_CONTRACT.fogNearMaximumM) * capProgress;
    return out ? target : Object.freeze(target);
  }

  /** Treat every explicit covered route as sealed, including future tunnel kinds not known by this release. */
  function isSealedTunnelFrame(routeFrame = {}) {
    return routeFrame?.covered === true || Boolean(routeFrame?.tunnelKind);
  }

  /**
   * Remove outdoor obscuration continuously after the tunnel portal while retaining the realm's normal fog.
   * A missing enclosure blend on an explicitly covered frame fails safe to full shelter instead of leaking weather.
   */
  function resolveTunnelAtmosphere(weather = {}, routeFrame = {}, out = null) {
    const target = out || {};
    const sealedTunnel = isSealedTunnelFrame(routeFrame);
    const rawEnclosureBlend = Number(routeFrame?.underpassBlend);
    const enclosureBlend = sealedTunnel
      ? (Number.isFinite(rawEnclosureBlend) ? clamp01(rawEnclosureBlend) : 1)
      : 0;
    const shelter = smootherstep(enclosureBlend);
    const exposure = 1 - shelter;
    resolveOpenAirVisibility(weather, target);
    target.sealedTunnel = sealedTunnel;
    target.tunnelKind = routeFrame?.tunnelKind || null;
    target.enclosureBlend = enclosureBlend;
    target.shelter = shelter;
    target.exposure = exposure;
    target.fog = clamp01(weather?.fog) * exposure;
    target.visibility = 1 - (1 - target.outdoorVisibility) * exposure;
    target.cloudDarkness = clamp01(weather?.cloudDarkness) * exposure;
    target.dust = clamp01(weather?.dust) * exposure;
    target.snow = clamp01(weather?.snow) * exposure;
    target.snowCover = clamp01(weather?.snowCover) * exposure;
    target.lightning = clamp01(weather?.lightning) * exposure;
    return out ? target : Object.freeze(target);
  }

  function defineType(id, name, icon, profile) {
    const normalizedProfile = {};
    for (const field of PROFILE_FIELDS) normalizedProfile[field] = clamp01(profile[field]);
    return Object.freeze({ id, name, icon, profile: Object.freeze(normalizedProfile) });
  }

  const types = Object.freeze({
    clear: defineType('clear', '晴朗', '☀', {
      cloudCover: 0.08, visibility: 1, wind: 0.16, gust: 0.04, intensity: 0.12
    }),
    'partly-cloudy': defineType('partly-cloudy', '少云', '◒', {
      cloudCover: 0.36, cloudDarkness: 0.08, fog: 0.04, visibility: 0.94,
      wind: 0.24, gust: 0.12, intensity: 0.28
    }),
    cloudy: defineType('cloudy', '阴天', '☁', {
      cloudCover: 0.76, cloudDarkness: 0.25, fog: 0.14, visibility: 0.82,
      wind: 0.34, gust: 0.22, intensity: 0.46
    }),
    mist: defineType('mist', '雾霭', '≋', {
      cloudCover: 0.62, cloudDarkness: 0.18, fog: 0.68, visibility: 0.48,
      wind: 0.14, gust: 0.06, wetness: 0.16, intensity: 0.42
    }),
    rain: defineType('rain', '降雨', '☂', {
      cloudCover: 0.96, cloudDarkness: 0.42, rain: 0.68, fog: 0.30,
      visibility: 0.68, wind: 0.46, gust: 0.38, wetness: 0.78, intensity: 0.68
    }),
    'heavy-rain': defineType('heavy-rain', '暴雨', '☔', {
      cloudCover: 1, cloudDarkness: 0.66, rain: 1, fog: 0.56,
      visibility: 0.42, wind: 0.68, gust: 0.72, lightning: 0.28,
      wetness: 1, intensity: 0.90
    }),
    thunderstorm: defineType('thunderstorm', '雷暴', 'ϟ', {
      cloudCover: 1, cloudDarkness: 0.82, rain: 0.90, fog: 0.48,
      visibility: 0.46, wind: 0.82, gust: 0.92, lightning: 0.88,
      wetness: 1, intensity: 0.96
    }),
    hail: defineType('hail', '冰雹', '◆', {
      cloudCover: 1, cloudDarkness: 0.78, rain: 0.58, hail: 1, fog: 0.42,
      visibility: 0.50, wind: 0.86, gust: 1, lightning: 0.62,
      wetness: 0.92, intensity: 1
    }),
    flurry: defineType('flurry', '飘雪', '✧', {
      cloudCover: 0.88, cloudDarkness: 0.26, snow: 0.34, fog: 0.20,
      visibility: 0.76, wind: 0.30, gust: 0.20, snowCover: 0.22, intensity: 0.46
    }),
    snow: defineType('snow', '降雪', '❄', {
      cloudCover: 0.97, cloudDarkness: 0.36, snow: 0.78, fog: 0.36,
      visibility: 0.60, wind: 0.46, gust: 0.42, snowCover: 0.82, intensity: 0.72
    }),
    blizzard: defineType('blizzard', '暴雪', '✦', {
      cloudCover: 1, cloudDarkness: 0.58, snow: 1, fog: 0.76,
      visibility: 0.26, wind: 1, gust: 1, snowCover: 1, intensity: 1
    }),
    haze: defineType('haze', '薄霭', '◌', {
      cloudCover: 0.16, cloudDarkness: 0.12, dust: 0.08, fog: 0.30,
      visibility: 0.72, wind: 0.24, gust: 0.16, intensity: 0.32
    }),
    'dust-haze': defineType('dust-haze', '浮尘', '⋯', {
      cloudCover: 0.14, cloudDarkness: 0.24, dust: 0.34, fog: 0.42,
      visibility: 0.56, wind: 0.46, gust: 0.42, intensity: 0.52
    }),
    'blowing-dust': defineType('blowing-dust', '扬沙', '≋', {
      cloudCover: 0.16, cloudDarkness: 0.40, dust: 0.70, fog: 0.62,
      visibility: 0.36, wind: 0.78, gust: 0.84, intensity: 0.78
    }),
    sandstorm: defineType('sandstorm', '沙尘暴', '▧', {
      cloudCover: 0.20, cloudDarkness: 0.58, dust: 1, fog: 0.88,
      visibility: 0.16, wind: 1, gust: 1, intensity: 1
    })
  });

  const transitionGraph = Object.freeze({
    clear: Object.freeze(['partly-cloudy', 'haze']),
    'partly-cloudy': Object.freeze(['clear', 'cloudy']),
    cloudy: Object.freeze(['partly-cloudy', 'mist', 'rain', 'flurry', 'haze']),
    mist: Object.freeze(['cloudy', 'rain', 'clear']),
    rain: Object.freeze(['cloudy', 'mist', 'heavy-rain', 'thunderstorm']),
    'heavy-rain': Object.freeze(['rain', 'thunderstorm']),
    thunderstorm: Object.freeze(['rain', 'heavy-rain', 'hail']),
    hail: Object.freeze(['thunderstorm']),
    flurry: Object.freeze(['cloudy', 'snow']),
    snow: Object.freeze(['flurry', 'blizzard']),
    blizzard: Object.freeze(['snow']),
    haze: Object.freeze(['clear', 'cloudy', 'dust-haze']),
    'dust-haze': Object.freeze(['haze', 'blowing-dust']),
    'blowing-dust': Object.freeze(['dust-haze', 'sandstorm']),
    sandstorm: Object.freeze(['blowing-dust'])
  });

  const weatherModes = Object.freeze({
    dry: Object.freeze({
      id: 'dry',
      name: '无降水版',
      description: '晴朗、云层与雾霭轮换，不进入雨、雪、冰雹或沙尘天气。'
    }),
    severe: Object.freeze({
      id: 'severe',
      name: '雨雪风暴版',
      description: '各地进入能形成的降雨、降雪、冰雹或沙尘天气，并保留必要缓冲。'
    }),
    mixed: Object.freeze({
      id: 'mixed',
      name: '混合版',
      description: '晴朗、云雾与强天气按当地气候自然轮换。'
    })
  });

  function freezePattern(ids) {
    return Object.freeze(ids.map((id) => Object.freeze({ id })));
  }

  // The game uses compressed meteorological time: ordinary conditions stay for at least one minute and
  // even short hail has a visible hold plus a 12-second smootherstep exit. Flight speed never scales these values.
  const weatherPacing = Object.freeze({
    clock: 'pausable-sky-elapsed-seconds',
    speedIndependent: true,
    minimumTransitionSeconds: 12,
    byType: Object.freeze({
      clear: Object.freeze({ holdSeconds: 75, transitionSeconds: 18 }),
      'partly-cloudy': Object.freeze({ holdSeconds: 60, transitionSeconds: 18 }),
      cloudy: Object.freeze({ holdSeconds: 60, transitionSeconds: 20 }),
      mist: Object.freeze({ holdSeconds: 60, transitionSeconds: 20 }),
      rain: Object.freeze({ holdSeconds: 90, transitionSeconds: 24 }),
      'heavy-rain': Object.freeze({ holdSeconds: 60, transitionSeconds: 20 }),
      thunderstorm: Object.freeze({ holdSeconds: 60, transitionSeconds: 18 }),
      hail: Object.freeze({ holdSeconds: 20, transitionSeconds: 12 }),
      flurry: Object.freeze({ holdSeconds: 60, transitionSeconds: 18 }),
      snow: Object.freeze({ holdSeconds: 90, transitionSeconds: 24 }),
      blizzard: Object.freeze({ holdSeconds: 45, transitionSeconds: 20 }),
      haze: Object.freeze({ holdSeconds: 90, transitionSeconds: 24 }),
      'dust-haze': Object.freeze({ holdSeconds: 75, transitionSeconds: 20 }),
      'blowing-dust': Object.freeze({ holdSeconds: 60, transitionSeconds: 18 }),
      sandstorm: Object.freeze({ holdSeconds: 60, transitionSeconds: 24 })
    })
  });

  // Realm patterns define climate goals only. A running transition remains locked when the craft crosses
  // a realm boundary; subsequent stages walk the graph toward the new climate instead of resetting.
  const zonePatterns = Object.freeze([
    freezePattern(['clear', 'partly-cloudy', 'cloudy', 'rain', 'cloudy', 'partly-cloudy']),
    freezePattern(['partly-cloudy', 'cloudy', 'rain', 'thunderstorm', 'hail', 'thunderstorm', 'rain', 'cloudy']),
    freezePattern(['cloudy', 'mist', 'rain', 'heavy-rain', 'thunderstorm', 'heavy-rain', 'rain', 'cloudy']),
    freezePattern(['cloudy', 'flurry', 'snow', 'blizzard', 'snow', 'flurry', 'cloudy']),
    freezePattern(['cloudy', 'mist', 'clear', 'haze']),
    freezePattern(['haze', 'dust-haze', 'blowing-dust', 'sandstorm', 'blowing-dust', 'dust-haze', 'haze'])
  ]);

  // Mode patterns change climate goals, never profile interpolation. The severe set starts inside the strongest
  // locally plausible family, while graph traversal is still free to insert ordinary buffer states between families.
  const modePatterns = Object.freeze({
    dry: Object.freeze([
      freezePattern(['clear', 'partly-cloudy', 'cloudy', 'partly-cloudy']),
      freezePattern(['partly-cloudy', 'cloudy', 'partly-cloudy']),
      freezePattern(['cloudy', 'mist', 'cloudy']),
      freezePattern(['cloudy']),
      freezePattern(['clear', 'haze', 'cloudy', 'mist']),
      freezePattern(['clear', 'haze'])
    ]),
    severe: Object.freeze([
      freezePattern(['rain', 'cloudy']),
      freezePattern(['thunderstorm', 'hail', 'thunderstorm', 'rain']),
      freezePattern(['heavy-rain', 'thunderstorm', 'heavy-rain', 'rain']),
      freezePattern(['snow', 'blizzard', 'snow', 'flurry']),
      freezePattern(['mist', 'cloudy', 'haze', 'clear', 'haze', 'cloudy']),
      freezePattern(['sandstorm', 'blowing-dust'])
    ]),
    mixed: zonePatterns
  });

  const climateContracts = Object.freeze([
    Object.freeze({ id: 'oceanic-dawn', allowed: Object.freeze(['clear', 'partly-cloudy', 'cloudy', 'rain']) }),
    Object.freeze({ id: 'temperate-prairie', allowed: Object.freeze(['partly-cloudy', 'cloudy', 'rain', 'thunderstorm', 'hail']) }),
    Object.freeze({ id: 'humid-rainforest', allowed: Object.freeze(['cloudy', 'mist', 'rain', 'heavy-rain', 'thunderstorm']) }),
    Object.freeze({ id: 'alpine-tundra', allowed: Object.freeze(['cloudy', 'flurry', 'snow', 'blizzard']) }),
    Object.freeze({ id: 'astral-calm', allowed: Object.freeze(['cloudy', 'mist', 'clear', 'haze']) }),
    Object.freeze({ id: 'volcanic-dry', allowed: Object.freeze(['haze', 'dust-haze', 'blowing-dust', 'sandstorm', 'clear']) })
  ]);

  function hashSeed(value) {
    const source = String(value ?? 'neon-weather');
    let hash = 0x811c_9dc5;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x0100_0193);
    }
    return hash >>> 0;
  }

  function createSnapshot() {
    const snapshot = {
      currentId: 'clear',
      currentName: types.clear.name,
      currentIcon: types.clear.icon,
      nextId: 'partly-cloudy',
      nextName: types['partly-cloudy'].name,
      nextIcon: types['partly-cloudy'].icon,
      phase: 'steady',
      trend: 'stable',
      blend: 0,
      rawBlend: 0,
      zoneIndex: 0,
      nextZoneIndex: 1,
      stageClimateZoneIndex: 0,
      localDistanceM: 0,
      weatherElapsedSeconds: 0,
      nextChangeSeconds: 0,
      segmentRemainingSeconds: 0,
      segmentLengthSeconds: 0,
      segmentSerial: 0,
      motionTimeSeconds: 0,
      modeId: weatherModes.mixed.id,
      modeName: weatherModes.mixed.name,
      forced: false,
      skyGroundPaired: true
    };
    for (const field of PROFILE_FIELDS) snapshot[field] = types.clear.profile[field];
    return Object.seal(snapshot);
  }

  function createForecast() {
    const items = Array.from({ length: 3 }, () => Object.seal({
      id: 'clear', name: types.clear.name, icon: types.clear.icon, etaSeconds: 0
    }));
    return Object.seal({
      currentId: 'clear',
      currentName: types.clear.name,
      currentIcon: types.clear.icon,
      nextId: 'partly-cloudy',
      nextName: types['partly-cloudy'].name,
      nextIcon: types['partly-cloudy'].icon,
      phase: 'steady',
      trend: 'stable',
      blend: 0,
      intensity: types.clear.profile.intensity,
      nextChangeEtaSeconds: 0,
      expectedDurationSeconds: 0,
      modeId: weatherModes.mixed.id,
      modeName: weatherModes.mixed.name,
      key: '',
      items: Object.freeze(items)
    });
  }

  function validateContracts(zoneCount) {
    if (zoneCount !== zonePatterns.length) {
      throw new RangeError(`Neon weather requires ${zonePatterns.length} route realms; received ${zoneCount}.`);
    }
    for (const [modeId, patterns] of Object.entries(modePatterns)) {
      if (!weatherModes[modeId]) throw new RangeError(`Weather pattern set ${modeId} has no public mode contract.`);
      if (patterns.length !== zoneCount) {
        throw new RangeError(`Weather mode ${modeId} requires ${zoneCount} route-realm patterns.`);
      }
      for (let zoneIndex = 0; zoneIndex < patterns.length; zoneIndex++) {
        const allowed = new Set(climateContracts[zoneIndex].allowed);
        for (const entry of patterns[zoneIndex]) {
          if (!types[entry.id]) throw new RangeError(`Unknown weather type ${entry.id}.`);
          if (!allowed.has(entry.id)) {
            throw new RangeError(
              `Weather ${entry.id} in mode ${modeId} is not valid for climate ${climateContracts[zoneIndex].id}.`
            );
          }
        }
      }
      for (let zoneIndex = 0; zoneIndex < patterns.length; zoneIndex++) {
        const pattern = patterns[zoneIndex];
        for (let entryIndex = 0; entryIndex < pattern.length; entryIndex++) {
          const sourceId = pattern[entryIndex].id;
          const targetId = pattern[(entryIndex + 1) % pattern.length].id;
          if (sourceId !== targetId && !transitionGraph[sourceId]?.includes(targetId)) {
            throw new RangeError(
              `Weather transition ${sourceId} -> ${targetId} in mode ${modeId} bypasses a required buffer state.`
            );
          }
        }
      }
    }
    for (const [id, pacing] of Object.entries(weatherPacing.byType)) {
      if (!types[id]) throw new RangeError(`Weather pacing references unknown type ${id}.`);
      if (pacing.holdSeconds < 20) throw new RangeError(`Weather ${id} has an unrealistically short hold.`);
      if (pacing.transitionSeconds < weatherPacing.minimumTransitionSeconds) {
        throw new RangeError(`Weather ${id} bypasses the minimum transition buffer.`);
      }
    }
  }

  function firstTransitionStep(sourceId, targetId) {
    if (sourceId === targetId) return sourceId;
    const queue = [sourceId];
    const previous = new Map([[sourceId, null]]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentId = queue[cursor];
      for (const nextId of transitionGraph[currentId] || []) {
        if (previous.has(nextId)) continue;
        previous.set(nextId, currentId);
        if (nextId === targetId) {
          let stepId = targetId;
          let parentId = previous.get(stepId);
          while (parentId && parentId !== sourceId) {
            stepId = parentId;
            parentId = previous.get(stepId);
          }
          return stepId;
        }
        queue.push(nextId);
      }
    }
    throw new RangeError(`No buffered weather route exists from ${sourceId} to ${targetId}.`);
  }

  /** Create one shared lifecycle sampler; render state and forecast read the same locked time segment. */
  function createController({
    zones,
    worldContract,
    seed = 'neon-weather',
    forcedType = null,
    mode = weatherModes.mixed.id
  } = {}) {
    const zoneCount = Array.isArray(zones) ? zones.length : Number(zones?.length) || 0;
    validateContracts(zoneCount);
    const zoneLength = Math.max(1, Number(worldContract?.zoneLength) || 2_700);
    let activeForcedWeather = forcedType && types[forcedType] ? forcedType : null;
    if (!weatherModes[mode]) throw new RangeError(`Unknown weather mode ${mode}.`);
    let activeModeId = mode;
    const motionPhaseSeconds = hashSeed(`${seed}:weather-motion`) / 0xffff_ffff * 37;
    const internalSnapshot = createSnapshot();
    const forecastScratch = createSnapshot();
    const internalForecast = createForecast();
    const patternCursorByZone = new Uint16Array(zoneCount);
    const schedule = Object.seal({
      initialized: false,
      sourceId: 'clear',
      targetId: 'partly-cloudy',
      followingId: 'cloudy',
      stageStartSeconds: 0,
      holdEndSeconds: 0,
      endSeconds: 0,
      climateZoneIndex: 0,
      serial: 0,
      lastSampleSeconds: 0
    });
    let activeGoalZoneIndex = -1;
    let activeGoalId = null;

    const activePatterns = () => modePatterns[activeModeId];

    function normalizedZoneIndex(input) {
      const index = Number.isInteger(input?.zoneState?.index) ? input.zoneState.index : 0;
      return positiveModulo(index, zoneCount);
    }

    function setClimateGoal(sourceId, zoneIndex) {
      const pattern = activePatterns()[zoneIndex];
      let cursor = patternCursorByZone[zoneIndex] % pattern.length;
      if (pattern[cursor].id === sourceId) cursor = (cursor + 1) % pattern.length;
      patternCursorByZone[zoneIndex] = cursor;
      activeGoalZoneIndex = zoneIndex;
      activeGoalId = pattern[cursor].id;
    }

    function selectNextType(sourceId, zoneIndex) {
      const pattern = activePatterns()[zoneIndex];
      if (activeGoalZoneIndex !== zoneIndex || !activeGoalId) setClimateGoal(sourceId, zoneIndex);
      if (sourceId === activeGoalId) {
        let cursor = (patternCursorByZone[zoneIndex] + 1) % pattern.length;
        let guard = 0;
        while (pattern[cursor].id === sourceId && guard < pattern.length) {
          cursor = (cursor + 1) % pattern.length;
          guard++;
        }
        patternCursorByZone[zoneIndex] = cursor;
        activeGoalId = pattern[cursor].id;
      }
      return firstTransitionStep(sourceId, activeGoalId);
    }

    function previewNextType(sourceId, zoneIndex) {
      const pattern = activePatterns()[zoneIndex];
      let cursor = patternCursorByZone[zoneIndex] % pattern.length;
      let goalId = activeGoalZoneIndex === zoneIndex && activeGoalId
        ? activeGoalId
        : pattern[cursor].id;
      if (sourceId === goalId) {
        cursor = (cursor + 1) % pattern.length;
        let guard = 0;
        while (pattern[cursor].id === sourceId && guard < pattern.length) {
          cursor = (cursor + 1) % pattern.length;
          guard++;
        }
        goalId = pattern[cursor].id;
      }
      return firstTransitionStep(sourceId, goalId);
    }

    function configureStage(sourceId, targetId, startSeconds, climateZoneIndex, serial) {
      const pacing = weatherPacing.byType[sourceId];
      schedule.sourceId = sourceId;
      schedule.targetId = targetId;
      schedule.stageStartSeconds = startSeconds;
      schedule.holdEndSeconds = startSeconds + pacing.holdSeconds;
      schedule.endSeconds = schedule.holdEndSeconds + pacing.transitionSeconds;
      schedule.climateZoneIndex = climateZoneIndex;
      schedule.serial = serial;
      schedule.followingId = previewNextType(targetId, climateZoneIndex);
    }

    function initializeSchedule(zoneIndex) {
      patternCursorByZone.fill(0);
      const pattern = activePatterns()[zoneIndex];
      const sourceId = pattern[0].id;
      patternCursorByZone[zoneIndex] = pattern.length > 1 ? 1 : 0;
      activeGoalZoneIndex = zoneIndex;
      activeGoalId = pattern[patternCursorByZone[zoneIndex]].id;
      configureStage(sourceId, firstTransitionStep(sourceId, activeGoalId), 0, zoneIndex, 0);
      schedule.lastSampleSeconds = 0;
      schedule.initialized = true;
    }

    function advanceSchedule(elapsedSeconds, zoneIndex) {
      if (!schedule.initialized || elapsedSeconds + 0.000_001 < schedule.lastSampleSeconds) {
        initializeSchedule(zoneIndex);
      }
      let guard = 0;
      while (elapsedSeconds >= schedule.endSeconds && guard < 1_024) {
        const stageStartSeconds = schedule.endSeconds;
        const sourceId = schedule.targetId;
        const targetId = selectNextType(sourceId, zoneIndex);
        configureStage(sourceId, targetId, stageStartSeconds, zoneIndex, schedule.serial + 1);
        guard++;
      }
      if (guard >= 1_024) throw new RangeError('Weather clock advanced beyond the supported catch-up window.');
      schedule.lastSampleSeconds = elapsedSeconds;
    }

    function sample(input, output = internalSnapshot) {
      const zoneState = input?.zoneState || {};
      const zoneIndex = normalizedZoneIndex(input);
      const elapsedSeconds = Math.max(0, Number(input?.skyElapsedSeconds) || 0);
      const localDistanceM = Number.isFinite(zoneState.localDistance)
        ? Math.max(0, Math.min(zoneLength - 0.000_001, Number(zoneState.localDistance)))
        : positiveModulo(Math.max(0, Number(input?.routeDistance) || 0), zoneLength);
      output.zoneIndex = zoneIndex;
      output.nextZoneIndex = Number.isInteger(zoneState.nextIndex)
        ? positiveModulo(zoneState.nextIndex, zoneCount)
        : (zoneIndex + 1) % zoneCount;
      output.stageClimateZoneIndex = schedule.initialized ? schedule.climateZoneIndex : zoneIndex;
      output.localDistanceM = localDistanceM;
      output.weatherElapsedSeconds = elapsedSeconds;
      output.motionTimeSeconds = elapsedSeconds + motionPhaseSeconds;
      output.modeId = activeModeId;
      output.modeName = weatherModes[activeModeId].name;
      output.forced = Boolean(activeForcedWeather);
      output.skyGroundPaired = true;

      if (activeForcedWeather) {
        const forced = types[activeForcedWeather];
        output.currentId = forced.id;
        output.currentName = forced.name;
        output.currentIcon = forced.icon;
        output.nextId = forced.id;
        output.nextName = forced.name;
        output.nextIcon = forced.icon;
        output.phase = 'forced';
        output.trend = 'stable';
        output.blend = 0;
        output.rawBlend = 0;
        output.nextChangeSeconds = Number.POSITIVE_INFINITY;
        output.segmentRemainingSeconds = Number.POSITIVE_INFINITY;
        output.segmentLengthSeconds = Number.POSITIVE_INFINITY;
        output.segmentSerial = 0;
        for (const field of PROFILE_FIELDS) output[field] = forced.profile[field];
        return output;
      }

      advanceSchedule(elapsedSeconds, zoneIndex);
      output.stageClimateZoneIndex = schedule.climateZoneIndex;
      const source = types[schedule.sourceId];
      const target = types[schedule.targetId];
      const transitionSeconds = Math.max(0.000_001, schedule.endSeconds - schedule.holdEndSeconds);
      const transitioning = schedule.sourceId !== schedule.targetId
        && elapsedSeconds > schedule.holdEndSeconds;
      const rawBlend = transitioning
        ? clamp01((elapsedSeconds - schedule.holdEndSeconds) / transitionSeconds)
        : 0;
      const blend = smootherstep(rawBlend);
      output.currentId = source.id;
      output.currentName = source.name;
      output.currentIcon = source.icon;
      output.nextId = target.id;
      output.nextName = target.name;
      output.nextIcon = target.icon;
      output.phase = transitioning ? 'transition' : 'steady';
      output.blend = blend;
      output.rawBlend = rawBlend;
      output.trend = !transitioning || Math.abs(target.profile.intensity - source.profile.intensity) < 0.04
        ? 'stable'
        : target.profile.intensity > source.profile.intensity ? 'strengthening' : 'easing';
      output.nextChangeSeconds = Math.max(
        0,
        (transitioning ? schedule.endSeconds : schedule.holdEndSeconds) - elapsedSeconds
      );
      output.segmentRemainingSeconds = Math.max(0, schedule.endSeconds - elapsedSeconds);
      output.segmentLengthSeconds = Math.max(0, schedule.endSeconds - schedule.stageStartSeconds);
      output.segmentSerial = schedule.serial;
      for (const field of PROFILE_FIELDS) {
        output[field] = source.profile[field] + (target.profile[field] - source.profile[field]) * blend;
      }
      return output;
    }

    function forecast(input, output = internalForecast) {
      const snapshot = sample(input, forecastScratch);
      output.currentId = snapshot.currentId;
      output.currentName = snapshot.currentName;
      output.currentIcon = snapshot.currentIcon;
      output.nextId = snapshot.nextId;
      output.nextName = snapshot.nextName;
      output.nextIcon = snapshot.nextIcon;
      output.phase = snapshot.phase;
      output.trend = snapshot.trend;
      output.blend = snapshot.blend;
      output.intensity = snapshot.intensity;
      output.modeId = snapshot.modeId;
      output.modeName = snapshot.modeName;
      output.nextChangeEtaSeconds = snapshot.segmentRemainingSeconds;
      output.expectedDurationSeconds = snapshot.forced
        ? Number.POSITIVE_INFINITY
        : weatherPacing.byType[snapshot.nextId].holdSeconds;
      output.key = [
        snapshot.modeId,
        snapshot.segmentSerial,
        snapshot.currentId,
        snapshot.nextId,
        snapshot.phase
      ].join(':');

      const first = output.items[0];
      Object.assign(first, {
        id: snapshot.currentId,
        name: snapshot.currentName,
        icon: snapshot.currentIcon,
        etaSeconds: 0
      });
      const second = output.items[1];
      Object.assign(second, {
        id: snapshot.nextId,
        name: snapshot.nextName,
        icon: snapshot.nextIcon,
        etaSeconds: snapshot.segmentRemainingSeconds
      });
      const thirdType = snapshot.forced ? types[snapshot.currentId] : types[schedule.followingId];
      const thirdEtaSeconds = snapshot.forced
        ? Number.POSITIVE_INFINITY
        : snapshot.segmentRemainingSeconds
          + weatherPacing.byType[snapshot.nextId].holdSeconds
          + weatherPacing.byType[snapshot.nextId].transitionSeconds;
      Object.assign(output.items[2], {
        id: thirdType.id,
        name: thirdType.name,
        icon: thirdType.icon,
        etaSeconds: thirdEtaSeconds
      });
      return output;
    }

    function reset() {
      // Reset only the deterministic lifecycle; the first post-reset sample selects the starting realm climate.
      schedule.initialized = false;
      schedule.lastSampleSeconds = 0;
      patternCursorByZone.fill(0);
      activeGoalZoneIndex = -1;
      activeGoalId = null;
      return true;
    }

    /** Select the next run's climate-goal set and restart its deterministic schedule from time zero. */
    function setMode(modeId) {
      if (!weatherModes[modeId]) throw new RangeError(`Unknown weather mode ${modeId}.`);
      if (modeId === activeModeId) return false;
      activeModeId = modeId;
      reset();
      return true;
    }

    /**
     * Apply or clear a visual-only test override without resetting the pausable natural-weather clock.
     * Releasing the override lets the sealed schedule catch up to the same elapsed time on its next sample.
     */
    function setForcedType(typeId) {
      const normalizedTypeId = typeId === null || typeId === '' ? null : typeId;
      if (normalizedTypeId !== null && !types[normalizedTypeId]) {
        throw new RangeError(`Unknown forced weather type ${normalizedTypeId}.`);
      }
      if (normalizedTypeId === activeForcedWeather) return false;
      activeForcedWeather = normalizedTypeId;
      return true;
    }

    return Object.freeze({
      sample,
      forecast,
      reset,
      setMode,
      setForcedType,
      createSnapshot,
      createForecast,
      getDiagnostics: () => Object.freeze({
        seedHash: hashSeed(seed),
        forcedType: activeForcedWeather,
        modeId: activeModeId,
        modeName: weatherModes[activeModeId].name,
        selector: 'pausable-time-with-locked-realm-stage-goals',
        minimumTransitionSeconds: weatherPacing.minimumTransitionSeconds,
        speedIndependent: true,
        motionClock: 'pausable-sky-elapsed-seconds',
        visualOnly: true
      })
    });
  }

  return Object.freeze({
    PROFILE_FIELDS,
    TUNNEL_WEATHER_SHELTER_CONTRACT,
    OPEN_AIR_VISIBILITY_CONTRACT,
    types,
    transitionGraph,
    weatherModes,
    zonePatterns,
    modePatterns,
    climateContracts,
    weatherPacing,
    smootherstep,
    isSealedTunnelFrame,
    resolveOpenAirVisibility,
    resolveTunnelAtmosphere,
    createSnapshot,
    createForecast,
    createController
  });
})();
