/*
 * Neon audio runtime.
 *
 * The controller owns one reusable effects/propulsion Web Audio graph. The themed music library uses
 * its own native-media controller so HTTP and direct-file launches share one playlist contract.
 * Gameplay only publishes semantic state and never receives writable authority from either system.
 */
(() => {
  const STORAGE_KEY = 'cc-neon-audio-enabled';
  const MAX_TRANSIENT_VOICES = 24;
  const MAX_DEFERRED_EVENTS = 12;
  const MAX_DEFERRED_EVENT_AGE_MS = 1_000;
  const INLINE_AUDIO_DATA_PREFIX = 'data:audio/ogg;base64,';
  const EFFECT_ASSET_RELEASE_GENERATION = 'neon-ipad-road-residency-253';
  const MASTER_GAIN_ON = 1;
  const MASTER_GAIN_OFF = 0;
  // Vehicle-speed-only layers share the physical 0–160km/h envelope. Engine pitch and level remain owned by the
  // authoritative RPM/thrust packet, while airflow fades in above 50km/h and surface texture matures by 120km/h.
  const MIX_REFERENCE_SPEED_KMH = 160;
  const AIRFLOW_START_SPEED_KMH = 50;
  const SURFACE_REFERENCE_SPEED_KMH = 120;
  const MIX_REFERENCE_SPEED_MPS = MIX_REFERENCE_SPEED_KMH / 3.6;
  const AIRFLOW_START_SPEED_MPS = AIRFLOW_START_SPEED_KMH / 3.6;
  const SURFACE_REFERENCE_SPEED_MPS = SURFACE_REFERENCE_SPEED_KMH / 3.6;
  const SURFACE_MOTION_START_SPEED_MPS = 0.8;
  const MAX_WATER_SPRAY_GAIN = 0.046;
  const MAX_SNOW_COMPRESSION_GAIN = 0.030;
  const MAX_SNOW_CRUNCH_GAIN = 0.027;
  const MAX_WEATHER_WIND_GAIN = 0.020;
  const MAX_WEATHER_HAIL_GAIN = 0.015;
  const MAX_WEATHER_DUST_GAIN = 0.017;
  const RAIN_ACOUSTIC_CONTRACT = Object.freeze({
    version: 2,
    profile: 'raw-intensity-three-band-with-tunnel-transmission',
    quietCurveExponent: 1.18,
    lightToSteadyStart: 0.22,
    lightToSteadyEnd: 0.48,
    steadyToHeavyStart: 0.72,
    steadyToHeavyEnd: 0.92,
    mountainTunnelTransmission: 0.18,
    undergroundTunnelTransmission: 0.10,
    defaultSealedTunnelTransmission: 0.10,
    maximumCombinedGain: 0.011_5,
    maximumRainAndWindGain: 0.022,
    maximumWeatherGain: 0.032
  });
  const RAIN_TIER_NAMES = Object.freeze(['none', 'light', 'steady', 'heavy']);
  const CORE_IDLE_RPM = 1_800;
  const CORE_BASE_MAXIMUM_RPM = 12_000;
  const CORE_UPGRADED_MAXIMUM_RPM = 15_000;
  // Normalize against the original audible range, but admit the entire candle-upgraded interval without clipping.
  const CORE_MAXIMUM_RPM_MIX = (CORE_UPGRADED_MAXIMUM_RPM - CORE_IDLE_RPM)
    / (CORE_BASE_MAXIMUM_RPM - CORE_IDLE_RPM);
  const PROPULSION_PROFILE = 'authoritative-core-drive-v5';
  // Continuous propulsion retains its full RPM/thrust response at 55% of the prior amplitude so the
  // six-realm score remains the dominant bed; collision, route, and control cues stay independently audible.
  // Lugging reshapes this existing bed instead of emitting a warning event: authoritative drivetrain load lowers
  // pitch and closes the engine filter, so a sustained bad gear cannot create a repeated beep or extra voice.
  const PROPULSION_GAIN_SCALE = 0.55;
  const LUGGING_AUDIO_CONTRACT = Object.freeze({
    maximumCorePitchReduction: 0.22,
    maximumHarmonicRatioReduction: 0.12,
    maximumCutoffReduction: 0.52,
    minimumCutoffHz: 820,
    maximumCoreGainReduction: 0.08,
    maximumHarmonicGainReduction: 0.30,
    maximumResonanceGain: 0.34
  });
  const GAMEPLAY_UNLOCK_CODES = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyA',
    'KeyD',
    'KeyW',
    'KeyS',
    'KeyC',
    'KeyE',
    'KeyM',
    'KeyO',
    'KeyP',
    'KeyQ',
    'KeyR',
    'KeyT',
    'KeyV',
    'Escape',
    'Space'
  ]);
  const GAMEPLAY_UNLOCK_SELECTOR = [
    '#startBtn',
    '#pauseRestartConfirmBtn',
    '#audioBtn',
    '#autoPilotBtn',
    '#speedModeBtn',
    '#transmissionModeBtn',
    '#gearDownBtn',
    '#gearUpBtn',
    '#mobileTransmissionModeBtn',
    '#mobileGearDownBtn',
    '#mobileGearUpBtn',
    '#viewBtn',
    '#pauseBtn',
    '#lightingBtn',
    '#controls .touch-btn',
    '#app canvas'
  ].join(', ');

  const ASSET_MANIFEST = Object.freeze({
    impact: Object.freeze({ url: 'assets/audio/impactMetal_003.ogg', kind: 'effect' }),
    pickup: Object.freeze({ url: 'assets/audio/powerUp3.ogg', kind: 'effect' }),
    jump: Object.freeze({ url: 'assets/audio/phaseJump3.ogg', kind: 'effect' }),
    route: Object.freeze({ url: 'assets/audio/threeTone1.ogg', kind: 'effect' }),
    accelerate: Object.freeze({ url: 'assets/audio/phaserUp3.ogg', kind: 'effect' }),
    brake: Object.freeze({ url: 'assets/audio/phaserDown2.ogg', kind: 'effect' }),
    gameOver: Object.freeze({ url: 'assets/audio/lowDown.ogg', kind: 'effect' }),
    button: Object.freeze({ url: 'assets/audio/click3.ogg', kind: 'effect' }),
    toggle: Object.freeze({ url: 'assets/audio/switch2.ogg', kind: 'effect' })
  });

  // Every semantic cue is declared once. Tests compare this table to the shipped asset manifest and runtime
  // consumers so an orphan file or a misspelled event cannot hide behind a generic fallback beep.
  const EVENT_DEFINITIONS = Object.freeze({
    button: Object.freeze({ category: 'interface', asset: 'button', gain: 0.13, playbackRate: 1.04 }),
    'sound-on': Object.freeze({ category: 'system', asset: 'toggle', gain: 0.16, playbackRate: 1.12 }),
    'sound-off': Object.freeze({ category: 'system', asset: 'toggle', gain: 0.15, playbackRate: 0.82 }),
    pause: Object.freeze({ category: 'system', asset: 'toggle', gain: 0.16, playbackRate: 0.72 }),
    resume: Object.freeze({ category: 'system', asset: 'accelerate', gain: 0.10, playbackRate: 0.82 }),
    pickup: Object.freeze({ category: 'gameplay', asset: 'pickup', gain: 0.15, playbackRate: 1.04 }),
    collision: Object.freeze({ category: 'impact', asset: 'impact', gain: 0.20, playbackRate: 0.88 }),
    ceiling: Object.freeze({ category: 'impact', asset: 'impact', gain: 0.11, playbackRate: 1.30 }),
    landing: Object.freeze({ category: 'impact', asset: 'impact', gain: 0.065, playbackRate: 0.62 }),
    jump: Object.freeze({ category: 'gameplay', asset: 'jump', gain: 0.13, playbackRate: 1.03 }),
    route: Object.freeze({ category: 'navigation', asset: 'route', gain: 0.11, playbackRate: 1.02 }),
    start: Object.freeze({ category: 'navigation', asset: 'route', gain: 0.12, playbackRate: 1.08 }),
    restart: Object.freeze({ category: 'navigation', asset: 'route', gain: 0.11, playbackRate: 0.86 }),
    zone: Object.freeze({ category: 'navigation', asset: 'route', gain: 0.11, playbackRate: 0.78 }),
    accelerate: Object.freeze({ category: 'control', asset: 'accelerate', gain: 0.10, playbackRate: 1.02 }),
    brake: Object.freeze({ category: 'control', asset: 'brake', gain: 0.09, playbackRate: 0.94 }),
    'game-over': Object.freeze({ category: 'gameplay', asset: 'gameOver', gain: 0.16, playbackRate: 0.84 }),
    'steer-left': Object.freeze({ category: 'control', synthesis: 'steer-left' }),
    'steer-right': Object.freeze({ category: 'control', synthesis: 'steer-right' }),
    'autopilot-on': Object.freeze({ category: 'system', synthesis: 'autopilot-on' }),
    'autopilot-off': Object.freeze({ category: 'system', synthesis: 'autopilot-off' }),
    'auto-throttle-on': Object.freeze({ category: 'system', asset: 'accelerate', gain: 0.075, playbackRate: 0.88 }),
    'auto-throttle-off': Object.freeze({ category: 'system', asset: 'brake', gain: 0.070, playbackRate: 1.08 }),
    'view-change': Object.freeze({ category: 'system', asset: 'button', gain: 0.085, playbackRate: 1.24 }),
    'lighting-on': Object.freeze({ category: 'system', asset: 'toggle', gain: 0.11, playbackRate: 1.24 }),
    'lighting-off': Object.freeze({ category: 'system', asset: 'toggle', gain: 0.10, playbackRate: 0.74 }),
    'thunder-near': Object.freeze({ category: 'weather', synthesis: 'thunder-near', cooldownGroup: 'thunder' }),
    'thunder-mid': Object.freeze({ category: 'weather', synthesis: 'thunder-mid', cooldownGroup: 'thunder' }),
    'thunder-far': Object.freeze({ category: 'weather', synthesis: 'thunder-far', cooldownGroup: 'thunder' })
  });

  const EVENT_COOLDOWNS = Object.freeze({
    button: 0.045,
    'sound-on': 0.12,
    'sound-off': 0.12,
    'steer-left': 0.12,
    'steer-right': 0.12,
    accelerate: 0.24,
    brake: 0.20,
    pickup: 0.18,
    collision: 0.16,
    landing: 0.10,
    ceiling: 0.12,
    route: 0.18,
    zone: 0.40,
    thunder: 4.50
  });

  const DEFAULT_SCHEDULER = Object.freeze({
    now: () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle)
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  /** Crossfade fixed acoustic bands without an audible slope discontinuity at a rain-tier boundary. */
  function smootherstepRange(value, start, end) {
    const t = clamp((value - start) / (end - start), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /**
   * Audio allocation follows explicit play intent; reading the manual or changing presentation never downloads assets.
   * 音频仅响应明确的起飞、开声或驾驶意图，打开玩法手册不会下载资源。
   */
  function shouldUnlockForInteraction(event) {
    if (!event?.isTrusted) return false;
    const target = event.target;
    const closest = target && typeof target.closest === 'function' ? target.closest.bind(target) : null;
    if (
      closest?.('#guideOverlay')
      || closest?.('#musicLibraryOverlay')
      || closest?.('#updateNotice')
    ) return false;
    // Arrow and Space inside presentation pickers are native control navigation, not intent to fly or hear the
    // production mix. Keeping every picker excluded also prevents manual diagnostics from prewarming a different path.
    if (
      closest?.('#weatherModePicker')
      || closest?.('#qualityModePicker')
      || closest?.('#manualWeatherTestPanel')
    ) return false;
    if (event.type === 'keydown') return GAMEPLAY_UNLOCK_CODES.has(event.code);
    return Boolean(closest?.(GAMEPLAY_UNLOCK_SELECTOR));
  }

  /**
   * Derive bounded continuous targets from read-only gameplay/contact state without mutating audio nodes or input.
   * Contact strengths are normalized contracts; gameplay and the surface system retain all state authority.
   */
  function deriveMix(input = {}, out = {}) {
    const active = Boolean(input.running && !input.paused && !input.gameOver);
    const speed = Math.max(0, Number(input.speed) || 0);
    const speedMix = clamp(speed / MIX_REFERENCE_SPEED_MPS, 0, 1.15);
    // Legacy `throttle` is only a fail-soft bridge for callers that have not yet published the authoritative core.
    // Once any core field is present, engine tone cannot infer load from speed or raw control demand.
    const legacyThrottle = clamp(Number(input.throttle) || 0, 0, 1);
    const hasAuthoritativeCore = Number.isFinite(input.coreSpool)
      || Number.isFinite(input.coreRpm)
      || Number.isFinite(input.thrustNormalized);
    const coreSpool = Number.isFinite(input.coreSpool)
      ? clamp(input.coreSpool, 0, 1)
      : hasAuthoritativeCore ? 0 : legacyThrottle;
    const coreRpm = Number.isFinite(input.coreRpm)
      ? Math.max(0, input.coreRpm)
      : CORE_IDLE_RPM + coreSpool * (CORE_BASE_MAXIMUM_RPM - CORE_IDLE_RPM);
    // Candle growth may raise the authoritative ceiling to 15,000 RPM. Keep the baseline range as the audible
    // reference so every RPM above 12,000 continues increasing pitch instead of flattening at the old cap.
    const rpmMix = clamp(
      (coreRpm - CORE_IDLE_RPM) / (CORE_BASE_MAXIMUM_RPM - CORE_IDLE_RPM),
      0,
      CORE_MAXIMUM_RPM_MIX
    );
    const thrustNormalized = Number.isFinite(input.thrustNormalized)
      ? clamp(input.thrustNormalized, 0, 1)
      : hasAuthoritativeCore ? 0 : legacyThrottle;
    const gearTorqueAvailability = Number.isFinite(input.gearTorqueAvailability)
      ? clamp(input.gearTorqueAvailability, 0, 1)
      : 1;
    const gearLugging = Boolean(input.gearLugging);
    const gearStalled = Boolean(input.gearStalled);
    const inferredLuggingSeverity = gearStalled
      ? 1
      : gearLugging ? 1 - gearTorqueAvailability : 0;
    const gearLuggingSeverity = Number.isFinite(input.gearLuggingSeverity)
      ? clamp(input.gearLuggingSeverity, 0, 1)
      : inferredLuggingSeverity;
    // `gearLoadNormalized` is throttle-gated by runtime. Missing load stays silent: a warning-only or coasting
    // caller cannot manufacture engine strain merely by publishing a tall-gear boolean.
    const gearLoadNormalized = Number.isFinite(input.gearLoadNormalized)
      ? clamp(input.gearLoadNormalized, 0, 1)
      : 0;
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const tunnel = clamp(Number(input.underpassBlend) || 0, 0, 1);
    const waterContact = clamp(Number(input.waterContact) || 0, 0, 1);
    const snowContact = clamp(Number(input.snowContact) || 0, 0, 1);
    const slushContact = clamp(Number(input.slushContact) || 0, 0, 1);
    const contactIntensity = clamp(Number(input.contactIntensity) || 0, 0, 1);
    const weatherExposure = clamp(Number(input.weatherExposure) || 0, 0, 1);
    const weatherRainIntensity = clamp(Number(input.weatherRain) || 0, 0, 1);
    // Tunnel identity comes from the committed weather route, never the camera/bridge underpass blend. This keeps
    // open main-road bridges at the outdoor mix while allowing only real tunnels to receive a muffled rain return.
    const weatherTunnelSealed = Boolean(input.weatherTunnelSealed);
    const weatherTunnelShelter = weatherTunnelSealed
      ? clamp(Number(input.weatherTunnelShelter) || 0, 0, 1)
      : 0;
    const weatherTunnelKindIndex = !weatherTunnelSealed
      ? 0
      : input.weatherTunnelKind === 'mountain-tunnel'
        ? 1
        : input.weatherTunnelKind === 'underground-tunnel' ? 2 : 3;
    const weatherRainTunnelTransmission = weatherTunnelKindIndex === 1
      ? RAIN_ACOUSTIC_CONTRACT.mountainTunnelTransmission
      : weatherTunnelKindIndex > 1
        ? input.weatherTunnelKind === 'underground-tunnel'
          ? RAIN_ACOUSTIC_CONTRACT.undergroundTunnelTransmission
          : RAIN_ACOUSTIC_CONTRACT.defaultSealedTunnelTransmission
        : 0;
    const weatherRain = weatherRainIntensity * clamp(
      weatherExposure + weatherTunnelShelter * weatherRainTunnelTransmission,
      0,
      1
    );
    const weatherWind = clamp(Number(input.weatherWind) || 0, 0, 1) * weatherExposure;
    const weatherGust = clamp(Number(input.weatherGust) || 0, 0, 1) * weatherExposure;
    const weatherHail = clamp(Number(input.weatherHail) || 0, 0, 1) * weatherExposure;
    const weatherDust = clamp(Number(input.weatherDust) || 0, 0, 1) * weatherExposure;
    const weatherSnow = clamp(Number(input.weatherSnow) || 0, 0, 1) * weatherExposure;
    const airflow = clamp(
      (speed - AIRFLOW_START_SPEED_MPS) / (MIX_REFERENCE_SPEED_MPS - AIRFLOW_START_SPEED_MPS),
      0,
      1
    );
    const surfaceMotion = clamp(
      (speed - SURFACE_MOTION_START_SPEED_MPS)
        / (SURFACE_REFERENCE_SPEED_MPS - SURFACE_MOTION_START_SPEED_MPS),
      0,
      1
    );
    const surfaceLoad = Math.pow(contactIntensity, 0.72);
    // Slush carries both fluid spray and packed-snow body, but damps the brittle high-frequency snow texture.
    const waterPresence = clamp(waterContact + slushContact * 0.82, 0, 1);
    const snowPresence = clamp(snowContact + slushContact * 0.64, 0, 1);
    const drySnowTexture = 1 - slushContact * 0.55;
    const activity = active ? 1 : 0;

    out.activity = activity;
    out.speedMix = speedMix;
    out.coreSpool = coreSpool;
    out.coreRpm = coreRpm;
    out.rpmMix = rpmMix;
    out.thrustNormalized = thrustNormalized;
    out.throttle = thrustNormalized;
    out.gearTorqueAvailability = gearTorqueAvailability;
    out.gearLuggingSeverity = gearLuggingSeverity;
    out.gearLoadNormalized = gearLoadNormalized;
    out.gearLugging = gearLugging ? 1 : 0;
    out.gearStalled = gearStalled ? 1 : 0;
    out.brake = brake;
    out.tunnel = tunnel;
    out.airflow = airflow;
    out.waterContact = waterContact;
    out.snowContact = snowContact;
    out.slushContact = slushContact;
    out.contactIntensity = contactIntensity;
    out.weatherExposure = weatherExposure;
    out.weatherRainIntensity = weatherRainIntensity;
    out.weatherTunnelSealed = weatherTunnelSealed ? 1 : 0;
    out.weatherTunnelShelter = weatherTunnelShelter;
    out.weatherTunnelKindIndex = weatherTunnelKindIndex;
    out.weatherRainTunnelTransmission = weatherRainTunnelTransmission;
    out.weatherRain = weatherRain;
    out.weatherWind = weatherWind;
    out.weatherGust = weatherGust;
    out.weatherHail = weatherHail;
    out.weatherDust = weatherDust;
    out.weatherSnow = weatherSnow;
    out.surfaceMotion = surfaceMotion;
    out.musicGain = activity * (0.17 - thrustNormalized * 0.015);
    out.musicCutoffHz = 13_500 - tunnel * 7_000;
    const luggingAudioMix = activity * gearLoadNormalized;
    out.luggingAudioMix = luggingAudioMix;
    const unloadedCoreGain = activity
      * (0.018 + coreSpool * 0.018 + thrustNormalized * 0.012)
      * PROPULSION_GAIN_SCALE;
    const unloadedHarmonicGain = activity
      * (0.003 + coreSpool * 0.008 + thrustNormalized * 0.011)
      * PROPULSION_GAIN_SCALE;
    out.driveCoreGain = unloadedCoreGain
      * (1 - luggingAudioMix * LUGGING_AUDIO_CONTRACT.maximumCoreGainReduction);
    out.driveHarmonicGain = unloadedHarmonicGain
      * (1 - luggingAudioMix * LUGGING_AUDIO_CONTRACT.maximumHarmonicGainReduction);
    const unloadedCoreFrequencyHz = 96 + rpmMix * 124 + coreSpool * 20;
    out.driveCoreFrequencyHz = unloadedCoreFrequencyHz
      * (1 - luggingAudioMix * LUGGING_AUDIO_CONTRACT.maximumCorePitchReduction);
    out.driveHarmonicFrequencyHz = out.driveCoreFrequencyHz
      * (
        1.498 + thrustNormalized * 0.018
        - luggingAudioMix * LUGGING_AUDIO_CONTRACT.maximumHarmonicRatioReduction
      );
    const unloadedDriveCutoffHz = 1_600 + rpmMix * 3_600
      + coreSpool * 700 + thrustNormalized * 800;
    out.driveCutoffHz = Math.max(
      LUGGING_AUDIO_CONTRACT.minimumCutoffHz,
      unloadedDriveCutoffHz
        * (1 - luggingAudioMix * LUGGING_AUDIO_CONTRACT.maximumCutoffReduction)
    );
    out.driveResonanceQ = 0.72 + coreSpool * 0.28
      + luggingAudioMix * LUGGING_AUDIO_CONTRACT.maximumResonanceGain;
    // Air rush is silent at normal launch speed and band-limited later, avoiding a permanent hiss floor.
    out.airflowGain = activity
      * Math.pow(airflow, 1.55)
      * (0.012 + speedMix * 0.014)
      * PROPULSION_GAIN_SCALE;
    out.airflowHighpassHz = 1_150 + speedMix * 1_250;
    out.airflowLowpassHz = 3_800 + speedMix * 2_600;
    out.brakeGain = activity * brake * (0.038 + speedMix * 0.052);
    out.brakeFrequencyHz = 900 + speedMix * 2_300;
    out.tunnelReturnGain = activity * tunnel * (0.038 + speedMix * 0.052);
    // Contact layers are speed-gated and bounded independently of render cadence. Water opens toward a broad,
    // airy spray at speed, while slush narrows the spectrum to retain its visibly heavier character.
    out.waterSprayGain = activity
      * MAX_WATER_SPRAY_GAIN
      * waterPresence
      * surfaceLoad
      * Math.pow(surfaceMotion, 1.18);
    out.waterSprayHighpassHz = clamp(
      420 + surfaceMotion * 1_180 - slushContact * 120,
      300,
      1_600
    );
    out.waterSprayLowpassHz = clamp(
      3_200 + surfaceMotion * 3_800 - slushContact * 1_100,
      2_100,
      7_000
    );
    // Packed snow owns a low-mid compression body plus a separate dry crunch band. Meltwater preserves the body
    // while reducing brittle crunch, matching the visual transition from powder to slush.
    out.snowCompressionGain = activity
      * MAX_SNOW_COMPRESSION_GAIN
      * snowPresence
      * surfaceLoad
      * Math.pow(surfaceMotion, 0.68)
      * (1 - slushContact * 0.22);
    out.snowCompressionFrequencyHz = clamp(
      360 + surfaceMotion * 720 - slushContact * 90,
      270,
      1_080
    );
    out.snowCompressionResonanceQ = clamp(
      0.78 + contactIntensity * 0.42 + slushContact * 0.15,
      0.78,
      1.35
    );
    out.snowCrunchGain = activity
      * MAX_SNOW_CRUNCH_GAIN
      * snowPresence
      * surfaceLoad
      * Math.pow(surfaceMotion, 1.04)
      * drySnowTexture;
    out.snowCrunchHighpassHz = clamp(
      1_050 + surfaceMotion * 1_150 - slushContact * 240,
      750,
      2_200
    );
    out.snowCrunchLowpassHz = clamp(
      3_400 + surfaceMotion * 2_400 - slushContact * 1_000,
      2_400,
      5_800
    );
    // Raw outdoor rain selects one acoustic profile. Direct rain falls with local exposure while a separate,
    // darker tunnel band rises with actual sealed-route shelter; ordinary bridge shade must never mute the storm.
    // A >1 gain curve keeps weak rain quiet, while every persistent branch stays inside the original rain cap.
    const lightToSteady = smootherstepRange(
      weatherRainIntensity,
      RAIN_ACOUSTIC_CONTRACT.lightToSteadyStart,
      RAIN_ACOUSTIC_CONTRACT.lightToSteadyEnd
    );
    const steadyToHeavy = smootherstepRange(
      weatherRainIntensity,
      RAIN_ACOUSTIC_CONTRACT.steadyToHeavyStart,
      RAIN_ACOUSTIC_CONTRACT.steadyToHeavyEnd
    );
    const rainLightWeight = 1 - lightToSteady;
    const rainHeavyWeight = steadyToHeavy;
    const rainSteadyWeight = clamp(1 - rainLightWeight - rainHeavyWeight, 0, 1);
    const rainOutdoorEnvelope = activity
      * RAIN_ACOUSTIC_CONTRACT.maximumCombinedGain
      * Math.pow(weatherRainIntensity, RAIN_ACOUSTIC_CONTRACT.quietCurveExponent);
    // Fail soft for inconsistent callers: direct plus transmitted rain may never exceed the outdoor envelope.
    const rainTransmissionSum = weatherExposure
      + weatherTunnelShelter * weatherRainTunnelTransmission;
    const rainTransmissionScale = rainTransmissionSum > 1 ? 1 / rainTransmissionSum : 1;
    const rainDirectEnvelope = rainOutdoorEnvelope * weatherExposure * rainTransmissionScale;
    const rainTunnelEnvelope = rainOutdoorEnvelope
      * weatherTunnelShelter
      * weatherRainTunnelTransmission
      * rainTransmissionScale;
    out.weatherRainTierIndex = weatherRainIntensity <= 0.002
      ? 0
      : rainHeavyWeight >= 0.5
        ? 3
        : rainSteadyWeight >= 0.5 ? 2 : 1;
    out.weatherRainLightWeight = rainLightWeight;
    out.weatherRainSteadyWeight = rainSteadyWeight;
    out.weatherRainHeavyWeight = rainHeavyWeight;
    out.weatherRainLightGain = rainDirectEnvelope * rainLightWeight;
    out.weatherRainSteadyGain = rainDirectEnvelope * rainSteadyWeight;
    out.weatherRainHeavyGain = rainDirectEnvelope * rainHeavyWeight;
    out.weatherRainDirectGain = out.weatherRainLightGain
      + out.weatherRainSteadyGain
      + out.weatherRainHeavyGain;
    out.weatherRainTunnelGain = rainTunnelEnvelope;
    out.weatherRainTransmissionScale = rainTransmissionScale;
    // Retain one aggregate read-only target for diagnostics and older deriveMix consumers.
    out.weatherRainGain = out.weatherRainDirectGain + out.weatherRainTunnelGain;
    out.weatherRainLightFrequencyHz = 2_350 + weatherRainIntensity * 450;
    out.weatherRainLightResonanceQ = 1.05 + weatherRainIntensity * 0.25;
    out.weatherRainSteadyFrequencyHz = 1_150 + weatherRainIntensity * 350;
    out.weatherRainSteadyResonanceQ = 0.58 + weatherRainIntensity * 0.16;
    out.weatherRainHeavyFrequencyHz = 420 + weatherRainIntensity * 260;
    out.weatherRainHeavyResonanceQ = 0.68 + weatherRainIntensity * 0.12;
    const mountainTunnel = weatherTunnelKindIndex === 1;
    out.weatherRainTunnelFrequencyHz = mountainTunnel
      ? rainLightWeight * 820 + rainSteadyWeight * 640 + rainHeavyWeight * 520
      : rainLightWeight * 700 + rainSteadyWeight * 520 + rainHeavyWeight * 400;
    out.weatherRainTunnelResonanceQ = mountainTunnel ? 0.62 : 0.72;
    const windPresence = clamp(weatherWind * 0.66 + weatherGust * 0.34 + weatherSnow * 0.18, 0, 1);
    const weatherWindGain = activity * MAX_WEATHER_WIND_GAIN * Math.pow(windPresence, 0.82);
    // Rain and wind are correlated in every wet profile. Reserve a shared ceiling so a storm cannot add two
    // broadband beds at their independent maxima while snow-only wind retains its existing full range.
    out.weatherWindGain = Math.min(
      weatherWindGain,
      Math.max(0, RAIN_ACOUSTIC_CONTRACT.maximumRainAndWindGain - out.weatherRainGain)
    );
    out.weatherWindFrequencyHz = 240 + weatherGust * 520 + weatherSnow * 110;
    out.weatherWindResonanceQ = 0.58 + weatherGust * 0.54;
    out.weatherHailGain = activity * MAX_WEATHER_HAIL_GAIN * Math.pow(weatherHail, 0.76);
    out.weatherHailFrequencyHz = 2_100 + weatherHail * 2_400;
    out.weatherDustGain = activity
      * MAX_WEATHER_DUST_GAIN
      * Math.pow(weatherDust * (0.55 + windPresence * 0.45), 0.78);
    out.weatherDustLowpassHz = 620 + weatherWind * 920;
    const weatherCombinedGain = out.weatherRainGain
      + out.weatherWindGain
      + out.weatherHailGain
      + out.weatherDustGain;
    const weatherGainScale = weatherCombinedGain > RAIN_ACOUSTIC_CONTRACT.maximumWeatherGain
      ? RAIN_ACOUSTIC_CONTRACT.maximumWeatherGain / weatherCombinedGain
      : 1;
    // The final weather ceiling covers hail and dust combinations as well as wet wind; scaling every active
    // weather branch together preserves their authored balance instead of letting one noisy band win the limiter.
    out.weatherRainLightGain *= weatherGainScale;
    out.weatherRainSteadyGain *= weatherGainScale;
    out.weatherRainHeavyGain *= weatherGainScale;
    out.weatherRainDirectGain *= weatherGainScale;
    out.weatherRainTunnelGain *= weatherGainScale;
    out.weatherRainGain *= weatherGainScale;
    out.weatherWindGain *= weatherGainScale;
    out.weatherHailGain *= weatherGainScale;
    out.weatherDustGain *= weatherGainScale;
    out.weatherRainWindGain = out.weatherRainGain + out.weatherWindGain;
    out.weatherCombinedGain = out.weatherRainWindGain
      + out.weatherHailGain
      + out.weatherDustGain;
    out.weatherGainScale = weatherGainScale;
    return out;
  }

  function createController(options = {}) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext || null;
    const inlineAssetModule = options.inlineAssetModule ?? window.NeonEffectAssets ?? null;
    const inlineAssetDataUrls = options.inlineAssetDataUrls ?? inlineAssetModule?.dataUrls ?? {};
    const locationProtocol = options.locationProtocol ?? window.location?.protocol ?? 'http:';
    // Tests inject this boundary so cooldowns and delayed suspension retain exact production timing without wall-clock sleeps.
    const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    if (
      typeof scheduler.now !== 'function'
      || typeof scheduler.setTimeout !== 'function'
      || typeof scheduler.clearTimeout !== 'function'
    ) {
      throw new TypeError('Audio scheduler must provide now(), setTimeout(), and clearTimeout()');
    }
    let storage = options.storage ?? null;
    let storageError = null;
    if (!storage && !Object.prototype.hasOwnProperty.call(options, 'storage')) {
      try {
        storage = window.localStorage;
      } catch (error) {
        storageError = error;
        console.warn('[Neon audio] Browser storage is unavailable; the session preference will still work.', error);
      }
    }
    let storedPreference = null;
    let preferenceSource = 'default';
    try {
      storedPreference = storage?.getItem?.(STORAGE_KEY) ?? null;
      if (storedPreference === 'on' || storedPreference === 'off') preferenceSource = 'storage';
    } catch (error) {
      storageError = error;
      console.warn('[Neon audio] Unable to read the persisted audio preference.', error);
    }

    let enabled = storedPreference !== 'off';
    let context = null;
    let graph = null;
    let assetLoadPromise = null;
    let unlockPromise = null;
    let destroyPromise = null;
    let suspendTimer = null;
    // Fatal shutdown is terminal for this controller: no later trusted event may recreate audio resources.
    let disposed = false;
    let liveVoices = 0;
    const transientVoices = new Set();
    const previousManualControls = {
      left: false,
      right: false,
      throttle: false,
      brake: false
    };
    let lastMix = deriveMix({}, {});
    const listeners = new Set();
    const buffers = new Map();
    const failedAssetKeys = new Set();
    const inlineDecodedAssetKeys = new Set();
    // A first trusted gesture may reach its semantic handler while Web Audio is resuming or its matching OGG is
    // decoding. Keep one fresh request per cooldown group so runtime speed never selects another timbre. Deferred
    // cues expire quickly and are cleared at lifecycle boundaries; an old run must never speak after resume.
    const deferredEvents = new Map();
    const lastEventAt = new Map();
    const automationTargets = new Map();
    const eventCounts = Object.create(null);
    const eventRequests = Object.create(null);

    const diagnostics = {
      supported: Boolean(AudioContextClass),
      enabled,
      disposed,
      propulsionProfile: PROPULSION_PROFILE,
      propulsionGainScale: PROPULSION_GAIN_SCALE,
      mixReferenceSpeedKmh: MIX_REFERENCE_SPEED_KMH,
      airflowStartSpeedKmh: AIRFLOW_START_SPEED_KMH,
      surfaceReferenceSpeedKmh: SURFACE_REFERENCE_SPEED_KMH,
      rainAcousticProfile: RAIN_ACOUSTIC_CONTRACT.profile,
      rainMaximumCombinedGain: RAIN_ACOUSTIC_CONTRACT.maximumCombinedGain,
      rainWindMaximumCombinedGain: RAIN_ACOUSTIC_CONTRACT.maximumRainAndWindGain,
      weatherMaximumCombinedGain: RAIN_ACOUSTIC_CONTRACT.maximumWeatherGain,
      weatherRainIntensity: 0,
      weatherRainExposure: 0,
      weatherRainTier: 'none',
      weatherRainLightGain: 0,
      weatherRainSteadyGain: 0,
      weatherRainHeavyGain: 0,
      weatherRainDirectGain: 0,
      weatherRainTunnelGain: 0,
      weatherRainTunnelTransmission: 0,
      weatherRainGain: 0,
      weatherRainWindGain: 0,
      weatherCombinedGain: 0,
      weatherGainScale: 1,
      gearTorqueAvailability: 1,
      gearLuggingSeverity: 0,
      gearLoadNormalized: 0,
      gearLugging: false,
      gearStalled: false,
      luggingAudioMix: 0,
      legacyPropulsionLoopsLoaded: false,
      preferenceSource,
      contextState: AudioContextClass ? 'uninitialized' : 'unsupported',
      contextCreateCount: 0,
      unlockArmed: Boolean(AudioContextClass),
      unlockAttemptCount: 0,
      unlockSuccessCount: 0,
      masterGainTarget: enabled ? MASTER_GAIN_ON : MASTER_GAIN_OFF,
      audible: false,
      toggleCount: 0,
      lastUnlockReason: 'none',
      lastError: storageError ? String(storageError.message || storageError) : null,
      musicStatus: 'delegated-library',
      musicActive: false,
      musicTransport: 'music-library-controller',
      directFileMusicFallback: false,
      engineActive: false,
      assetsLoaded: 0,
      assetsTotal: Object.keys(ASSET_MANIFEST).length,
      assetErrors: 0,
      assetErrorKeys: [],
      effectAssetModuleVersion: inlineAssetModule?.version ?? null,
      effectAssetReleaseGeneration: inlineAssetModule?.releaseGeneration ?? null,
      assetTransport: locationProtocol === 'file:' ? 'inline-exact-file' : 'fetch-http',
      inlineAssetCount: 0,
      inlineAssetFallbacks: 0,
      deferredEventCount: 0,
      deferredEventRequests: 0,
      deferredEventDrops: 0,
      lastDeferredEventDropReason: 'none',
      synthesizedAssetFallbacks: 0,
      liveVoices: 0,
      transientVoiceCount: 0,
      cancelledTransientVoices: 0,
      lastTransientVoiceCancelReason: 'none',
      maximumTransientVoices: MAX_TRANSIENT_VOICES,
      eventCounts,
      eventRequests,
      lastEvent: 'none',
      graphReuseCount: 0
    };

    function snapshot() {
      dropExpiredDeferredEvents();
      diagnostics.enabled = enabled;
      diagnostics.disposed = disposed;
      diagnostics.contextState = context?.state || (AudioContextClass ? 'uninitialized' : 'unsupported');
      diagnostics.liveVoices = liveVoices;
      diagnostics.transientVoiceCount = transientVoices.size;
      diagnostics.deferredEventCount = deferredEvents.size;
      diagnostics.weatherRainIntensity = lastMix.weatherRainIntensity;
      diagnostics.weatherRainExposure = lastMix.weatherExposure;
      diagnostics.weatherRainTier = RAIN_TIER_NAMES[lastMix.weatherRainTierIndex] || 'none';
      diagnostics.weatherRainLightGain = lastMix.weatherRainLightGain;
      diagnostics.weatherRainSteadyGain = lastMix.weatherRainSteadyGain;
      diagnostics.weatherRainHeavyGain = lastMix.weatherRainHeavyGain;
      diagnostics.weatherRainDirectGain = lastMix.weatherRainDirectGain;
      diagnostics.weatherRainTunnelGain = lastMix.weatherRainTunnelGain;
      diagnostics.weatherRainTunnelTransmission = lastMix.weatherRainTunnelTransmission;
      diagnostics.weatherRainGain = lastMix.weatherRainGain;
      diagnostics.weatherRainWindGain = lastMix.weatherRainWindGain;
      diagnostics.weatherCombinedGain = lastMix.weatherCombinedGain;
      diagnostics.weatherGainScale = lastMix.weatherGainScale;
      diagnostics.gearTorqueAvailability = lastMix.gearTorqueAvailability;
      diagnostics.gearLuggingSeverity = lastMix.gearLuggingSeverity;
      diagnostics.gearLoadNormalized = lastMix.gearLoadNormalized;
      diagnostics.gearLugging = Boolean(lastMix.gearLugging);
      diagnostics.gearStalled = Boolean(lastMix.gearStalled);
      diagnostics.luggingAudioMix = lastMix.luggingAudioMix;
      const webAudioAudible = Boolean(
        !disposed
        && enabled
        && context?.state === 'running'
        && diagnostics.masterGainTarget > 0
        && (lastMix.activity > 0 || liveVoices > 0)
      );
      diagnostics.audible = webAudioAudible;
      return diagnostics;
    }

    function emit() {
      const current = snapshot();
      for (const listener of listeners) listener(current);
    }

    function persistPreference() {
      try {
        storage?.setItem?.(STORAGE_KEY, enabled ? 'on' : 'off');
        diagnostics.preferenceSource = 'storage';
      } catch (error) {
        diagnostics.lastError = String(error.message || error);
        console.warn('[Neon audio] Unable to persist the audio preference.', error);
      }
    }

    function syncAssetCount() {
      diagnostics.assetsLoaded = buffers.size;
    }

    function createNoiseBuffer(audioContext) {
      const frameCount = Math.max(1, Math.round(audioContext.sampleRate * 2));
      const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
      const channel = buffer.getChannelData(0);
      let seed = 0x23_a0_11;
      for (let index = 0; index < channel.length; index++) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        channel[index] = seed / 4_294_967_296 * 2 - 1;
      }
      return buffer;
    }

    /** Build the graph once; disabling or restarting gameplay must only reuse these nodes. */
    function ensureGraph() {
      if (disposed) return null;
      if (graph) {
        diagnostics.graphReuseCount++;
        return graph;
      }
      if (!AudioContextClass) return null;

      context = new AudioContextClass({ latencyHint: 'interactive' });
      diagnostics.contextCreateCount++;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.16;

      const masterGain = context.createGain();
      masterGain.gain.value = enabled && document.visibilityState === 'visible'
        ? MASTER_GAIN_ON
        : MASTER_GAIN_OFF;
      const masterHighpass = context.createBiquadFilter();
      masterHighpass.type = 'highpass';
      masterHighpass.frequency.value = 32;
      masterHighpass.Q.value = 0.65;
      masterGain.connect(masterHighpass);
      masterHighpass.connect(compressor);
      compressor.connect(context.destination);

      const engineBus = context.createGain();
      const engineHighpass = context.createBiquadFilter();
      engineHighpass.type = 'highpass';
      engineHighpass.frequency.value = 72;
      engineHighpass.Q.value = 0.72;
      const engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 1_600;
      engineFilter.Q.value = 0.72;
      engineBus.connect(engineHighpass);
      engineHighpass.connect(engineFilter);
      engineFilter.connect(masterGain);

      // A sine core plus a quiet fifth harmonic reads as continuous electric thrust without piston-like buzz.
      const driveCoreGain = context.createGain();
      driveCoreGain.gain.value = 0;
      const driveCoreOscillator = context.createOscillator();
      driveCoreOscillator.type = 'sine';
      driveCoreOscillator.frequency.value = 96;
      driveCoreOscillator.connect(driveCoreGain);
      driveCoreGain.connect(engineBus);
      driveCoreOscillator.start();

      const driveHarmonicGain = context.createGain();
      driveHarmonicGain.gain.value = 0;
      const driveHarmonicOscillator = context.createOscillator();
      driveHarmonicOscillator.type = 'triangle';
      driveHarmonicOscillator.frequency.value = 144;
      driveHarmonicOscillator.connect(driveHarmonicGain);
      driveHarmonicGain.connect(engineBus);
      driveHarmonicOscillator.start();

      const noiseBuffer = createNoiseBuffer(context);
      const airflowSource = context.createBufferSource();
      airflowSource.buffer = noiseBuffer;
      airflowSource.loop = true;
      const airflowHighpass = context.createBiquadFilter();
      airflowHighpass.type = 'highpass';
      airflowHighpass.frequency.value = 1_150;
      const airflowLowpass = context.createBiquadFilter();
      airflowLowpass.type = 'lowpass';
      airflowLowpass.frequency.value = 3_800;
      const airflowGain = context.createGain();
      airflowGain.gain.value = 0;
      airflowSource.connect(airflowHighpass);
      airflowHighpass.connect(airflowLowpass);
      airflowLowpass.connect(airflowGain);
      airflowGain.connect(masterGain);
      airflowSource.start();

      const brakeSource = context.createBufferSource();
      brakeSource.buffer = noiseBuffer;
      brakeSource.loop = true;
      const brakeFilter = context.createBiquadFilter();
      brakeFilter.type = 'bandpass';
      brakeFilter.Q.value = 1.8;
      const brakeGain = context.createGain();
      brakeGain.gain.value = 0;
      brakeSource.connect(brakeFilter);
      brakeFilter.connect(brakeGain);
      brakeGain.connect(masterGain);
      brakeSource.start();

      // One persistent contact-noise source fans into independently filtered water and snow bands. It reuses the
      // deterministic noise buffer so frame updates only automate AudioParams and never allocate nodes or events.
      const surfaceNoiseSource = context.createBufferSource();
      surfaceNoiseSource.buffer = noiseBuffer;
      surfaceNoiseSource.loop = true;
      const waterSprayHighpass = context.createBiquadFilter();
      waterSprayHighpass.type = 'highpass';
      waterSprayHighpass.frequency.value = 420;
      const waterSprayLowpass = context.createBiquadFilter();
      waterSprayLowpass.type = 'lowpass';
      waterSprayLowpass.frequency.value = 3_200;
      const waterSprayGain = context.createGain();
      waterSprayGain.gain.value = 0;
      surfaceNoiseSource.connect(waterSprayHighpass);
      waterSprayHighpass.connect(waterSprayLowpass);
      waterSprayLowpass.connect(waterSprayGain);
      waterSprayGain.connect(masterGain);

      const snowCompressionFilter = context.createBiquadFilter();
      snowCompressionFilter.type = 'bandpass';
      snowCompressionFilter.frequency.value = 360;
      snowCompressionFilter.Q.value = 0.78;
      const snowCompressionGain = context.createGain();
      snowCompressionGain.gain.value = 0;
      surfaceNoiseSource.connect(snowCompressionFilter);
      snowCompressionFilter.connect(snowCompressionGain);
      snowCompressionGain.connect(masterGain);

      const snowCrunchHighpass = context.createBiquadFilter();
      snowCrunchHighpass.type = 'highpass';
      snowCrunchHighpass.frequency.value = 1_050;
      const snowCrunchLowpass = context.createBiquadFilter();
      snowCrunchLowpass.type = 'lowpass';
      snowCrunchLowpass.frequency.value = 3_400;
      const snowCrunchGain = context.createGain();
      snowCrunchGain.gain.value = 0;
      surfaceNoiseSource.connect(snowCrunchHighpass);
      snowCrunchHighpass.connect(snowCrunchLowpass);
      snowCrunchLowpass.connect(snowCrunchGain);
      snowCrunchGain.connect(masterGain);

      // Weather reuses the deterministic surface source. Light droplets, a steady curtain, and downpour body
      // occupy fixed, disjoint bands; intensity crossfades their gains instead of brightening one broadband hiss.
      const weatherRainLightFilter = context.createBiquadFilter();
      weatherRainLightFilter.type = 'bandpass';
      weatherRainLightFilter.frequency.value = 2_350;
      weatherRainLightFilter.Q.value = 1.05;
      const weatherRainLightGain = context.createGain();
      weatherRainLightGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherRainLightFilter);
      weatherRainLightFilter.connect(weatherRainLightGain);
      weatherRainLightGain.connect(masterGain);

      const weatherRainSteadyFilter = context.createBiquadFilter();
      weatherRainSteadyFilter.type = 'bandpass';
      weatherRainSteadyFilter.frequency.value = 1_150;
      weatherRainSteadyFilter.Q.value = 0.58;
      const weatherRainSteadyGain = context.createGain();
      weatherRainSteadyGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherRainSteadyFilter);
      weatherRainSteadyFilter.connect(weatherRainSteadyGain);
      weatherRainSteadyGain.connect(masterGain);

      const weatherRainHeavyFilter = context.createBiquadFilter();
      weatherRainHeavyFilter.type = 'bandpass';
      weatherRainHeavyFilter.frequency.value = 420;
      weatherRainHeavyFilter.Q.value = 0.68;
      const weatherRainHeavyGain = context.createGain();
      weatherRainHeavyGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherRainHeavyFilter);
      weatherRainHeavyFilter.connect(weatherRainHeavyGain);
      weatherRainHeavyGain.connect(masterGain);

      // A separate low band carries rain through sealed tunnel walls/portals. Reusing the persistent weather
      // source keeps the indoor return dark and continuous without leaking the three direct outdoor bands.
      const weatherRainTunnelFilter = context.createBiquadFilter();
      weatherRainTunnelFilter.type = 'lowpass';
      weatherRainTunnelFilter.frequency.value = 520;
      weatherRainTunnelFilter.Q.value = 0.72;
      const weatherRainTunnelGain = context.createGain();
      weatherRainTunnelGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherRainTunnelFilter);
      weatherRainTunnelFilter.connect(weatherRainTunnelGain);
      weatherRainTunnelGain.connect(masterGain);

      const weatherWindFilter = context.createBiquadFilter();
      weatherWindFilter.type = 'bandpass';
      weatherWindFilter.frequency.value = 240;
      weatherWindFilter.Q.value = 0.58;
      const weatherWindGain = context.createGain();
      weatherWindGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherWindFilter);
      weatherWindFilter.connect(weatherWindGain);
      weatherWindGain.connect(masterGain);

      const weatherHailFilter = context.createBiquadFilter();
      weatherHailFilter.type = 'bandpass';
      weatherHailFilter.frequency.value = 2_100;
      weatherHailFilter.Q.value = 1.35;
      const weatherHailGain = context.createGain();
      weatherHailGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherHailFilter);
      weatherHailFilter.connect(weatherHailGain);
      weatherHailGain.connect(masterGain);

      const weatherDustFilter = context.createBiquadFilter();
      weatherDustFilter.type = 'lowpass';
      weatherDustFilter.frequency.value = 620;
      const weatherDustGain = context.createGain();
      weatherDustGain.gain.value = 0;
      surfaceNoiseSource.connect(weatherDustFilter);
      weatherDustFilter.connect(weatherDustGain);
      weatherDustGain.connect(masterGain);
      surfaceNoiseSource.start();

      const tunnelDelay = context.createDelay(0.35);
      tunnelDelay.delayTime.value = 0.082;
      const tunnelFeedback = context.createGain();
      tunnelFeedback.gain.value = 0.17;
      const tunnelReturn = context.createGain();
      tunnelReturn.gain.value = 0;
      engineFilter.connect(tunnelDelay);
      tunnelDelay.connect(tunnelFeedback);
      tunnelFeedback.connect(tunnelDelay);
      tunnelDelay.connect(tunnelReturn);
      tunnelReturn.connect(masterGain);

      const effectsGain = context.createGain();
      effectsGain.gain.value = 0.76;
      effectsGain.connect(masterGain);
      effectsGain.connect(tunnelDelay);

      graph = {
        compressor,
        masterGain,
        masterHighpass,
        engineBus,
        engineHighpass,
        engineFilter,
        driveCoreGain,
        driveCoreOscillator,
        driveHarmonicGain,
        driveHarmonicOscillator,
        airflowHighpass,
        airflowLowpass,
        airflowGain,
        brakeFilter,
        brakeGain,
        surfaceNoiseSource,
        waterSprayHighpass,
        waterSprayLowpass,
        waterSprayGain,
        snowCompressionFilter,
        snowCompressionGain,
        snowCrunchHighpass,
        snowCrunchLowpass,
        snowCrunchGain,
        weatherRainLightFilter,
        weatherRainLightGain,
        weatherRainSteadyFilter,
        weatherRainSteadyGain,
        weatherRainHeavyFilter,
        weatherRainHeavyGain,
        weatherRainTunnelFilter,
        weatherRainTunnelGain,
        weatherWindFilter,
        weatherWindGain,
        weatherHailFilter,
        weatherHailGain,
        weatherDustFilter,
        weatherDustGain,
        tunnelReturn,
        effectsGain,
        noiseBuffer
      };
      diagnostics.engineActive = true;
      diagnostics.contextState = context.state;
      emit();
      return graph;
    }

    function setTarget(parameter, value, timeConstant = 0.055, epsilon = 0.000_5) {
      if (disposed || !context || !parameter || !Number.isFinite(value)) return;
      const previous = automationTargets.get(parameter);
      if (Number.isFinite(previous) && Math.abs(previous - value) < epsilon) return;
      automationTargets.set(parameter, value);
      const now = context.currentTime;
      if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
      else {
        parameter.cancelScheduledValues(now);
        parameter.setValueAtTime(parameter.value, now);
      }
      parameter.setTargetAtTime(value, now, timeConstant);
    }

    /** Decode one exact inline OGG payload without changing its bytes or bypassing the production Web Audio graph. */
    function decodeInlineAssetData(key) {
      const dataUrl = inlineAssetDataUrls[key];
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(INLINE_AUDIO_DATA_PREFIX)) {
        throw new Error(`Exact inline audio asset ${key} is unavailable`);
      }
      if (typeof window.atob !== 'function') {
        throw new Error('This browser cannot decode exact inline audio data');
      }
      const binary = window.atob(dataUrl.slice(INLINE_AUDIO_DATA_PREFIX.length));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }

    /**
     * HTTP uses the redistributed OGG files directly. Direct-file launch uses a generated exact-byte copy because
     * browsers reject fetch() from file://; both transports still enter the same decoder, gains, rates, and buses.
     */
    async function loadEncodedAsset(key, descriptor) {
      if (locationProtocol === 'file:') {
        return { encoded: decodeInlineAssetData(key), usedInline: true };
      }
      try {
        // Effects share the document generation so replacing one named OGG cannot leave HTTP on a stale cache entry
        // while direct-file playback decodes the newly generated exact-byte module.
        const versionedUrl = `${descriptor.url}?v=${EFFECT_ASSET_RELEASE_GENERATION}`;
        const response = await fetch(versionedUrl, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`Audio asset ${key} returned HTTP ${response.status}`);
        return { encoded: await response.arrayBuffer(), usedInline: false };
      } catch (error) {
        if (!inlineAssetDataUrls[key]) throw error;
        diagnostics.inlineAssetFallbacks++;
        diagnostics.assetTransport = 'fetch-http-with-inline-fallback';
        return { encoded: decodeInlineAssetData(key), usedInline: true };
      }
    }

    async function decodeAsset(key, descriptor) {
      const assetContext = context;
      if (disposed || !assetContext || assetContext.state === 'closed') return false;
      let { encoded, usedInline } = await loadEncodedAsset(key, descriptor);
      if (disposed || context !== assetContext || assetContext.state === 'closed') return false;
      let buffer;
      try {
        buffer = await assetContext.decodeAudioData(encoded);
      } catch (error) {
        // A 200 response may still contain a proxy/SPA error page or corrupt cache entry. Retry exactly once from the
        // generated OGG bytes before declaring failure; direct-file and an already-inline attempt have no second copy.
        if (locationProtocol === 'file:' || usedInline || !inlineAssetDataUrls[key]) throw error;
        diagnostics.inlineAssetFallbacks++;
        diagnostics.assetTransport = 'fetch-http-with-inline-fallback';
        encoded = decodeInlineAssetData(key);
        usedInline = true;
        buffer = await assetContext.decodeAudioData(encoded);
      }
      if (disposed || context !== assetContext || assetContext.state === 'closed') return false;
      if (usedInline) {
        inlineDecodedAssetKeys.add(key);
        diagnostics.inlineAssetCount = inlineDecodedAssetKeys.size;
      }
      buffers.set(key, buffer);
      syncAssetCount();
      flushDeferredEvents(key);
      return true;
    }

    /** Audio is optional to gameplay, so only a confirmed file failure may release its synthesized fallback. */
    function ensureAssets() {
      if (disposed || !context || context.state === 'closed') return Promise.resolve(false);
      if (assetLoadPromise) return assetLoadPromise;
      const assetEntries = Object.entries(ASSET_MANIFEST);
      assetLoadPromise = Promise.all(assetEntries.map(async ([key, descriptor]) => {
        try {
          await decodeAsset(key, descriptor);
        } catch (error) {
          if (disposed) return false;
          failedAssetKeys.add(key);
          diagnostics.assetErrors++;
          diagnostics.assetErrorKeys.push(key);
          diagnostics.lastError = String(error.message || error);
          console.warn(`[Neon audio] Unable to load ${key}; gameplay continues and synthesized feedback remains available.`, error);
          flushDeferredEvents(key);
        }
      })).then(() => {
        if (disposed) return false;
        emit();
        return diagnostics.assetErrors === 0;
      });
      return assetLoadPromise;
    }

    async function unlock(reason = 'manual', trusted = false) {
      if (disposed || !enabled || !trusted || document.visibilityState !== 'visible') return false;
      if (!AudioContextClass) return false;
      if (unlockPromise) return unlockPromise;
      unlockPromise = (async () => {
        if (disposed) return false;
        diagnostics.unlockAttemptCount++;
        diagnostics.lastUnlockReason = reason;
        try {
          const activeGraph = ensureGraph();
          const activeContext = context;
          if (disposed || !activeGraph || !activeContext) return false;
          // Decoding does not require a running destination. Starting it before resume gives the pointerdown-to-click
          // interval to prepare the same samples later gameplay uses, while deferred events close any remaining race.
          ensureAssets();
          scheduler.clearTimeout(suspendTimer);
          if (activeContext.state !== 'running') await activeContext.resume();
          if (disposed || context !== activeContext || activeContext.state === 'closed') return false;
          diagnostics.contextState = activeContext.state;
          const mayBecomeAudible = Boolean(
            enabled
            && document.visibilityState === 'visible'
            && activeContext.state === 'running'
          );
          if (!mayBecomeAudible) {
            diagnostics.masterGainTarget = MASTER_GAIN_OFF;
            setTarget(activeGraph.masterGain.gain, MASTER_GAIN_OFF, 0.01);
            if (activeContext.state === 'running') await activeContext.suspend();
            if (disposed || context !== activeContext) return false;
            diagnostics.contextState = activeContext.state;
            diagnostics.unlockArmed = Boolean(enabled && AudioContextClass);
            emit();
            return false;
          }
          if (activeContext.state === 'running') {
            diagnostics.masterGainTarget = MASTER_GAIN_ON;
            setTarget(activeGraph.masterGain.gain, MASTER_GAIN_ON, 0.035);
            diagnostics.unlockSuccessCount++;
            diagnostics.unlockArmed = false;
            diagnostics.lastError = null;
            flushDeferredEvents();
            emit();
            return true;
          }
        } catch (error) {
          if (disposed) return false;
          diagnostics.lastError = String(error.message || error);
          console.warn('[Neon audio] Browser audio unlock failed; the next trusted interaction will retry.', error);
        }
        diagnostics.unlockArmed = !disposed;
        emit();
        return false;
      })();
      try {
        return await unlockPromise;
      } finally {
        unlockPromise = null;
      }
    }

    function scheduleSuspend(reason = 'context-suspended') {
      scheduler.clearTimeout(suspendTimer);
      if (disposed || !context || context.state !== 'running') return;
      const activeContext = context;
      suspendTimer = scheduler.setTimeout(async () => {
        if (disposed || context !== activeContext) return;
        if (enabled && document.visibilityState === 'visible') return;
        try {
          cancelTransientVoices(reason);
          await activeContext.suspend();
          if (disposed || context !== activeContext) return;
          diagnostics.contextState = activeContext.state;
          emit();
        } catch (error) {
          diagnostics.lastError = String(error.message || error);
          console.warn('[Neon audio] Unable to suspend the audio context.', error);
        }
      }, 140);
    }

    async function setEnabled(nextEnabled, metadata = {}) {
      if (disposed) return false;
      const next = Boolean(nextEnabled);
      if (next === enabled) {
        if (next && metadata.trusted) await unlock(metadata.reason || 'toggle', true);
        return disposed ? false : enabled;
      }
      enabled = next;
      diagnostics.toggleCount++;
      diagnostics.enabled = enabled;
      diagnostics.masterGainTarget = enabled
        && document.visibilityState === 'visible'
        && context?.state === 'running'
        ? MASTER_GAIN_ON
        : MASTER_GAIN_OFF;
      persistPreference();
      if (graph) setTarget(graph.masterGain.gain, diagnostics.masterGainTarget, 0.035);
      if (enabled) {
        cancelTransientVoices('audio-reenabled');
        diagnostics.unlockArmed = Boolean(AudioContextClass && context?.state !== 'running');
        if (metadata.trusted) await unlock(metadata.reason || 'toggle', true);
        if (disposed) return false;
      } else {
        diagnostics.unlockArmed = Boolean(AudioContextClass);
        // Preserve the short sound-off cue until the established 140ms fade/suspend boundary, then cancel its tail
        // with every older transient so none can resume during a later enable.
        clearDeferredEvents('audio-disabled', { cancelTransients: false });
        scheduleSuspend('audio-disabled');
      }
      emit();
      return enabled;
    }

    function beginVoice() {
      if (disposed || liveVoices >= MAX_TRANSIENT_VOICES) return false;
      liveVoices++;
      diagnostics.liveVoices = liveVoices;
      return true;
    }

    function endVoice() {
      liveVoices = Math.max(0, liveVoices - 1);
      diagnostics.liveVoices = liveVoices;
    }

    /** Register only event transients; persistent propulsion/weather sources must survive normal lifecycle clears. */
    function registerTransientVoice(source, nodes) {
      const record = {
        ended: false,
        nodes,
        source,
        finish() {
          if (record.ended) return;
          record.ended = true;
          transientVoices.delete(record);
          for (const node of record.nodes) {
            try {
              node?.disconnect?.();
            } catch (error) {
              if (error?.name !== 'InvalidAccessError') throw error;
            }
          }
          endVoice();
        }
      };
      transientVoices.add(record);
      diagnostics.transientVoiceCount = transientVoices.size;
      source.onended = record.finish;
      return record;
    }

    /** Stop started and future-scheduled event sources so a suspended context cannot replay an earlier lifecycle. */
    function cancelTransientVoices(reason = 'lifecycle') {
      let cancelled = 0;
      for (const record of [...transientVoices]) {
        try {
          record.source.stop();
        } catch (error) {
          if (error?.name !== 'InvalidStateError') {
            diagnostics.lastError = String(error.message || error);
          }
        }
        record.finish();
        cancelled++;
      }
      if (cancelled > 0) {
        diagnostics.cancelledTransientVoices += cancelled;
        diagnostics.lastTransientVoiceCancelReason = reason;
      }
      diagnostics.transientVoiceCount = transientVoices.size;
      return cancelled;
    }

    function playBuffer(key, gainValue, playbackRate = 1) {
      const buffer = buffers.get(key);
      if (!buffer || !graph || !context || !beginVoice()) return false;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      gain.gain.value = Math.max(0.000_1, gainValue);
      source.connect(gain);
      gain.connect(graph.effectsGain);
      registerTransientVoice(source, [source, gain]);
      source.start();
      return true;
    }

    function playTone(frequency, duration, gainValue, endFrequency = frequency, delay = 0) {
      if (!graph || !context || !beginVoice()) return false;
      const startAt = context.currentTime + Math.max(0, delay);
      const stopAt = startAt + Math.max(0.025, duration);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(Math.max(30, frequency), startAt);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), stopAt);
      gain.gain.setValueAtTime(0.000_1, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.000_2, gainValue), startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.000_1, stopAt);
      oscillator.connect(gain);
      gain.connect(graph.effectsGain);
      registerTransientVoice(oscillator, [oscillator, gain]);
      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.012);
      return true;
    }

    /** Shape one deterministic filtered-noise transient from the graph's shared buffer. */
    function playNoiseBurst({
      duration,
      gainValue,
      highpassHz,
      lowpassHz,
      delay = 0,
      attack = 0.018
    }) {
      if (!graph || !context || !beginVoice()) return false;
      const startAt = context.currentTime + Math.max(0, delay);
      const stopAt = startAt + Math.max(0.08, duration);
      const source = context.createBufferSource();
      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = graph.noiseBuffer;
      source.loop = true;
      highpass.type = 'highpass';
      highpass.frequency.value = Math.max(24, highpassHz);
      highpass.Q.value = 0.58;
      lowpass.type = 'lowpass';
      lowpass.frequency.value = Math.max(highpass.frequency.value + 30, lowpassHz);
      lowpass.Q.value = 0.72;
      gain.gain.setValueAtTime(0.000_1, startAt);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.000_2, gainValue),
        startAt + Math.min(Math.max(0.008, attack), duration * 0.3)
      );
      gain.gain.exponentialRampToValueAtTime(0.000_1, stopAt);
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(graph.effectsGain);
      registerTransientVoice(source, [source, highpass, lowpass, gain]);
      source.start(startAt);
      source.stop(stopAt + 0.012);
      return true;
    }

    /** Render three distance-weighted thunder bodies; all variants share one cooldown group at the call boundary. */
    function playThunder(name) {
      const presets = {
        'thunder-near': {
          delay: 0.10,
          crackGain: 0.12,
          bodyGain: 0.20,
          bodyDuration: 2.40,
          bodyLowpassHz: 720,
          rumbleFrequencyHz: 58
        },
        'thunder-mid': {
          delay: 0.38,
          crackGain: 0.075,
          bodyGain: 0.16,
          bodyDuration: 3.05,
          bodyLowpassHz: 510,
          rumbleFrequencyHz: 48
        },
        'thunder-far': {
          delay: 0.78,
          crackGain: 0.035,
          bodyGain: 0.12,
          bodyDuration: 3.80,
          bodyLowpassHz: 340,
          rumbleFrequencyHz: 40
        }
      };
      const preset = presets[name];
      if (!preset) return false;
      let played = false;
      played = playNoiseBurst({
        duration: 0.14,
        gainValue: preset.crackGain,
        highpassHz: 520,
        lowpassHz: 3_800,
        delay: preset.delay,
        attack: 0.006
      }) || played;
      played = playNoiseBurst({
        duration: preset.bodyDuration,
        gainValue: preset.bodyGain,
        highpassHz: 32,
        lowpassHz: preset.bodyLowpassHz,
        delay: preset.delay + 0.06,
        attack: 0.045
      }) || played;
      played = playTone(
        preset.rumbleFrequencyHz,
        preset.bodyDuration * 0.82,
        preset.bodyGain * 0.34,
        32,
        preset.delay + 0.09
      ) || played;
      return played;
    }

    /**
     * Synthesize only events without a source asset, or a complete restrained fallback when asset decoding failed.
     * Loaded samples are no longer doubled by a second bright accent, removing the former harsh two-sound stack.
     */
    function synthesizeEvent(name, assetPlayed) {
      if (name.startsWith('thunder-')) return playThunder(name);
      if (name === 'steer-left') return playTone(520, 0.095, 0.024, 350);
      if (name === 'steer-right') return playTone(350, 0.095, 0.024, 520);
      if (name === 'autopilot-on') {
        const first = playTone(410, 0.14, 0.032, 610);
        const second = playTone(610, 0.15, 0.025, 820, 0.085);
        return first || second;
      }
      if (name === 'autopilot-off') {
        const first = playTone(820, 0.14, 0.030, 560);
        const second = playTone(560, 0.14, 0.023, 330, 0.075);
        return first || second;
      }
      if (assetPlayed) return false;
      if (name === 'pickup') {
        const first = playTone(620, 0.16, 0.070, 980);
        const second = playTone(880, 0.18, 0.052, 1_320, 0.075);
        return first || second;
      } else if (name === 'collision' || name === 'ceiling') {
        return playTone(name === 'collision' ? 105 : 180, 0.32, 0.11, 42);
      } else if (name === 'jump') {
        return playTone(180, 0.28, 0.060, 540);
      } else if (name === 'landing') {
        return playTone(125, 0.15, 0.050, 74);
      } else if (name === 'game-over') {
        return playTone(310, 0.46, 0.075, 96);
      } else if (name === 'route' || name === 'start' || name === 'restart' || name === 'zone') {
        return playTone(name === 'restart' ? 620 : 360, 0.21, 0.050, name === 'restart' ? 360 : 620);
      } else if (
        name === 'accelerate'
        || name === 'resume'
        || name === 'auto-throttle-on'
      ) {
        return playTone(240, 0.17, 0.038, 490);
      } else if (name === 'brake' || name === 'pause' || name === 'auto-throttle-off') {
        return playTone(420, 0.15, 0.038, 210);
      } else if (name === 'sound-on' || name === 'lighting-on') {
        return playTone(430, 0.11, 0.028, 720);
      } else if (name === 'sound-off' || name === 'lighting-off') {
        return playTone(690, 0.11, 0.026, 360);
      } else if (name === 'view-change') {
        return playTone(460, 0.09, 0.025, 640);
      }
      return playTone(520, 0.075, 0.026, 710);
    }

    /** Commit cooldowns and diagnostics only when a decoded sample or a confirmed-failure fallback really starts. */
    function commitPlayedEvent(name, definition, now = scheduler.now()) {
      const cooldownKey = definition.cooldownGroup || name;
      lastEventAt.set(cooldownKey, now);
      eventCounts[name] = (eventCounts[name] || 0) + 1;
      diagnostics.lastEvent = name;
      emit();
    }

    /** Return whether a semantic cue can become audible now instead of being lost inside a suspended destination. */
    function canCommitEvent() {
      return Boolean(
        !disposed
        && enabled
        && graph
        && context?.state === 'running'
        && document.visibilityState === 'visible'
        && diagnostics.masterGainTarget > MASTER_GAIN_OFF
      );
    }

    /** Drop expired cues before inspection so a stale run can never speak after a delayed decode or resume. */
    function dropExpiredDeferredEvents(now = scheduler.now()) {
      let dropped = 0;
      for (const [cooldownKey, pending] of deferredEvents) {
        if (now - pending.acceptedAt <= MAX_DEFERRED_EVENT_AGE_MS) continue;
        deferredEvents.delete(cooldownKey);
        dropped++;
      }
      if (dropped > 0) {
        diagnostics.deferredEventDrops += dropped;
        diagnostics.lastDeferredEventDropReason = 'expired';
      }
      diagnostics.deferredEventCount = deferredEvents.size;
      return dropped;
    }

    /**
     * Lifecycle owners clear semantic intent before publishing the next run, pause state, or terminal event.
     * The clear is idempotent and counts only cues that would otherwise have been able to replay later.
     */
    function clearDeferredEvents(reason = 'lifecycle', options = {}) {
      const dropped = deferredEvents.size;
      if (dropped > 0) {
        diagnostics.deferredEventDrops += dropped;
        diagnostics.lastDeferredEventDropReason = reason;
        deferredEvents.clear();
      }
      if (options.cancelTransients !== false) cancelTransientVoices(reason);
      diagnostics.deferredEventCount = deferredEvents.size;
      return dropped;
    }

    /**
     * Release deferred semantic events through their production sample, or through synthesis only after that asset
     * is known to have failed. Suspended, hidden, disabled, and expired requests remain unable to start a voice.
     */
    function flushDeferredEvents(assetKey = null) {
      dropExpiredDeferredEvents();
      if (!canCommitEvent()) return false;
      let playedAny = false;
      for (const [cooldownKey, pending] of [...deferredEvents]) {
        const definition = EVENT_DEFINITIONS[pending.name];
        if (!definition || (assetKey && definition.asset !== assetKey)) continue;
        const assetReady = Boolean(definition.asset && buffers.has(definition.asset));
        const assetFailed = Boolean(definition.asset && failedAssetKeys.has(definition.asset));
        if (definition.asset && !assetReady && !assetFailed) continue;
        deferredEvents.delete(cooldownKey);
        const played = assetReady
          ? playBuffer(definition.asset, definition.gain, definition.playbackRate)
          : synthesizeEvent(pending.name, false);
        if (!played) {
          diagnostics.deferredEventDrops++;
          diagnostics.lastDeferredEventDropReason = 'voice-unavailable';
          continue;
        }
        if (assetFailed) diagnostics.synthesizedAssetFallbacks++;
        commitPlayedEvent(pending.name, definition);
        playedAny = true;
      }
      diagnostics.deferredEventCount = deferredEvents.size;
      return playedAny;
    }

    /** Accept one fresh cue while Web Audio resumes or its exact production sample finishes decoding. */
    function deferEvent(name, definition, now = scheduler.now()) {
      dropExpiredDeferredEvents(now);
      const cooldownKey = definition.cooldownGroup || name;
      if (deferredEvents.has(cooldownKey)) return false;
      if (deferredEvents.size >= MAX_DEFERRED_EVENTS) {
        diagnostics.deferredEventDrops++;
        diagnostics.lastDeferredEventDropReason = 'queue-capacity';
        return false;
      }
      deferredEvents.set(cooldownKey, { name, acceptedAt: now });
      diagnostics.deferredEventRequests++;
      diagnostics.deferredEventCount = deferredEvents.size;
      if (definition.asset && !buffers.has(definition.asset) && !failedAssetKeys.has(definition.asset)) {
        ensureAssets();
      }
      emit();
      return true;
    }

    function play(name) {
      const definition = EVENT_DEFINITIONS[name];
      if (!definition) throw new RangeError(`Unknown Neon audio event: ${name}`);
      if (disposed) return false;
      eventRequests[name] = (eventRequests[name] || 0) + 1;
      if (
        !enabled
        || !graph
        || !context
        || context.state === 'closed'
        || document.visibilityState !== 'visible'
      ) return false;
      const now = scheduler.now();
      const cooldownKey = definition.cooldownGroup || name;
      const cooldown = (EVENT_COOLDOWNS[cooldownKey] || 0) * 1_000;
      if (now - (lastEventAt.get(cooldownKey) ?? Number.NEGATIVE_INFINITY) < cooldown) return false;

      if (context.state !== 'running' || diagnostics.masterGainTarget <= MASTER_GAIN_OFF) {
        return deferEvent(name, definition, now);
      }
      if (definition.asset && !buffers.has(definition.asset) && !failedAssetKeys.has(definition.asset)) {
        return deferEvent(name, definition, now);
      }
      const assetPlayed = definition.asset && buffers.has(definition.asset)
        ? playBuffer(definition.asset, definition.gain, definition.playbackRate)
        : false;
      const synthesized = synthesizeEvent(name, assetPlayed);
      if (!assetPlayed && !synthesized) return false;
      if (definition.asset && !assetPlayed) diagnostics.synthesizedAssetFallbacks++;
      commitPlayedEvent(name, definition, now);
      return true;
    }

    /**
     * Update only parameter targets; persistent oscillators/noise stay allocated and surface contact never emits events.
     */
    function update(input = {}) {
      if (disposed) return false;
      lastMix = deriveMix(input, lastMix);
      const manualLeft = Boolean(lastMix.activity && input.controlLeft);
      const manualRight = Boolean(lastMix.activity && input.controlRight);
      const manualThrottle = Boolean(lastMix.activity && input.controlThrottle);
      const manualBrake = Boolean(lastMix.activity && input.controlBrake);
      if (!graph || !context) {
        previousManualControls.left = manualLeft;
        previousManualControls.right = manualRight;
        previousManualControls.throttle = manualThrottle;
        previousManualControls.brake = manualBrake;
        snapshot();
        return lastMix;
      }

      setTarget(graph.driveCoreGain.gain, lastMix.driveCoreGain, 0.10);
      setTarget(graph.driveHarmonicGain.gain, lastMix.driveHarmonicGain, 0.12);
      setTarget(graph.driveCoreOscillator.frequency, lastMix.driveCoreFrequencyHz, 0.09);
      setTarget(graph.driveHarmonicOscillator.frequency, lastMix.driveHarmonicFrequencyHz, 0.09);
      setTarget(graph.engineFilter.frequency, lastMix.driveCutoffHz, 0.10);
      setTarget(graph.engineFilter.Q, lastMix.driveResonanceQ, 0.10);
      setTarget(graph.airflowGain.gain, lastMix.airflowGain, 0.14);
      setTarget(graph.airflowHighpass.frequency, lastMix.airflowHighpassHz, 0.14);
      setTarget(graph.airflowLowpass.frequency, lastMix.airflowLowpassHz, 0.14);
      setTarget(graph.brakeGain.gain, lastMix.brakeGain, 0.035);
      setTarget(graph.brakeFilter.frequency, lastMix.brakeFrequencyHz, 0.055);
      setTarget(graph.tunnelReturn.gain, lastMix.tunnelReturnGain, 0.10);
      setTarget(graph.waterSprayGain.gain, lastMix.waterSprayGain, 0.075);
      setTarget(graph.waterSprayHighpass.frequency, lastMix.waterSprayHighpassHz, 0.10);
      setTarget(graph.waterSprayLowpass.frequency, lastMix.waterSprayLowpassHz, 0.10);
      setTarget(graph.snowCompressionGain.gain, lastMix.snowCompressionGain, 0.085);
      setTarget(
        graph.snowCompressionFilter.frequency,
        lastMix.snowCompressionFrequencyHz,
        0.11
      );
      setTarget(
        graph.snowCompressionFilter.Q,
        lastMix.snowCompressionResonanceQ,
        0.11
      );
      setTarget(graph.snowCrunchGain.gain, lastMix.snowCrunchGain, 0.070);
      setTarget(graph.snowCrunchHighpass.frequency, lastMix.snowCrunchHighpassHz, 0.095);
      setTarget(graph.snowCrunchLowpass.frequency, lastMix.snowCrunchLowpassHz, 0.095);
      // Rain gains are intentionally quiet; a tighter epsilon prevents slow weather interpolation from turning
      // their smooth crossfades into audible 0.0005-wide automation steps.
      setTarget(graph.weatherRainLightGain.gain, lastMix.weatherRainLightGain, 0.18, 0.000_02);
      setTarget(graph.weatherRainLightFilter.frequency, lastMix.weatherRainLightFrequencyHz, 0.20);
      setTarget(graph.weatherRainLightFilter.Q, lastMix.weatherRainLightResonanceQ, 0.20);
      setTarget(graph.weatherRainSteadyGain.gain, lastMix.weatherRainSteadyGain, 0.18, 0.000_02);
      setTarget(graph.weatherRainSteadyFilter.frequency, lastMix.weatherRainSteadyFrequencyHz, 0.20);
      setTarget(graph.weatherRainSteadyFilter.Q, lastMix.weatherRainSteadyResonanceQ, 0.20);
      setTarget(graph.weatherRainHeavyGain.gain, lastMix.weatherRainHeavyGain, 0.18, 0.000_02);
      setTarget(graph.weatherRainHeavyFilter.frequency, lastMix.weatherRainHeavyFrequencyHz, 0.20);
      setTarget(graph.weatherRainHeavyFilter.Q, lastMix.weatherRainHeavyResonanceQ, 0.20);
      setTarget(graph.weatherRainTunnelGain.gain, lastMix.weatherRainTunnelGain, 0.22, 0.000_02);
      setTarget(graph.weatherRainTunnelFilter.frequency, lastMix.weatherRainTunnelFrequencyHz, 0.24);
      setTarget(graph.weatherRainTunnelFilter.Q, lastMix.weatherRainTunnelResonanceQ, 0.24);
      setTarget(graph.weatherWindGain.gain, lastMix.weatherWindGain, 0.22);
      setTarget(graph.weatherWindFilter.frequency, lastMix.weatherWindFrequencyHz, 0.22);
      setTarget(graph.weatherWindFilter.Q, lastMix.weatherWindResonanceQ, 0.22);
      setTarget(graph.weatherHailGain.gain, lastMix.weatherHailGain, 0.10);
      setTarget(graph.weatherHailFilter.frequency, lastMix.weatherHailFrequencyHz, 0.12);
      setTarget(graph.weatherDustGain.gain, lastMix.weatherDustGain, 0.20);
      setTarget(graph.weatherDustFilter.frequency, lastMix.weatherDustLowpassHz, 0.20);

      if (manualLeft && !previousManualControls.left) play('steer-left');
      if (manualRight && !previousManualControls.right) play('steer-right');
      if (manualThrottle && !previousManualControls.throttle) play('accelerate');
      if (manualBrake && !previousManualControls.brake) play('brake');
      previousManualControls.left = manualLeft;
      previousManualControls.right = manualRight;
      previousManualControls.throttle = manualThrottle;
      previousManualControls.brake = manualBrake;
      snapshot();
      return lastMix;
    }

    function onTrustedInteraction(event) {
      if (disposed || !enabled || !shouldUnlockForInteraction(event)) return;
      const contextNeedsUnlock = Boolean(AudioContextClass && context?.state !== 'running');
      if (!contextNeedsUnlock) return;
      // A master-toggle click whose current intent is "off" must not allocate the graph or fetch assets first.
      const target = typeof Element === 'function' && event.target instanceof Element ? event.target : null;
      if (target?.closest('#audioBtn')) return;
      unlock(event.type, true);
    }

    function onVisibilityChange() {
      if (disposed) return;
      if (document.visibilityState !== 'visible') {
        clearDeferredEvents('document-hidden');
        diagnostics.masterGainTarget = MASTER_GAIN_OFF;
        if (graph) setTarget(graph.masterGain.gain, MASTER_GAIN_OFF, 0.035);
        scheduleSuspend();
        emit();
        return;
      }
      if (enabled && context) {
        const activeContext = context;
        scheduler.clearTimeout(suspendTimer);
        Promise.resolve()
          .then(() => activeContext.state === 'running' ? undefined : activeContext.resume())
          .then(async () => {
            if (disposed || context !== activeContext) return;
            const mayBecomeAudible = Boolean(
              enabled
              && document.visibilityState === 'visible'
              && activeContext.state === 'running'
            );
            if (!mayBecomeAudible) {
              diagnostics.masterGainTarget = MASTER_GAIN_OFF;
              if (graph) setTarget(graph.masterGain.gain, MASTER_GAIN_OFF, 0.01);
              if (activeContext.state === 'running') await activeContext.suspend();
              if (disposed || context !== activeContext) return;
              diagnostics.contextState = activeContext.state;
              diagnostics.unlockArmed = Boolean(enabled && AudioContextClass);
              emit();
              return;
            }
            diagnostics.contextState = activeContext.state;
            diagnostics.masterGainTarget = MASTER_GAIN_ON;
            if (graph) setTarget(graph.masterGain.gain, MASTER_GAIN_ON, 0.05);
            diagnostics.unlockArmed = false;
            flushDeferredEvents();
            emit();
          }).catch((error) => {
          if (disposed) return;
          diagnostics.lastError = String(error.message || error);
          diagnostics.unlockArmed = true;
          console.warn('[Neon audio] Visibility resume was blocked; the next trusted input will retry.', error);
          emit();
          });
      }
      if (enabled && !context) emit();
    }

    document.addEventListener('pointerdown', onTrustedInteraction, true);
    document.addEventListener('keydown', onTrustedInteraction, true);
    document.addEventListener('click', onTrustedInteraction, true);
    document.addEventListener('visibilitychange', onVisibilityChange);

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      if (disposed) {
        listener(snapshot());
        return () => {};
      }
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }

    function destroy() {
      if (destroyPromise) return destroyPromise;
      if (disposed) return Promise.resolve(true);
      disposed = true;
      enabled = false;
      diagnostics.disposed = true;
      diagnostics.enabled = false;
      diagnostics.unlockArmed = false;
      diagnostics.masterGainTarget = MASTER_GAIN_OFF;
      diagnostics.audible = false;
      clearDeferredEvents('destroyed');
      scheduler.clearTimeout(suspendTimer);
      document.removeEventListener('pointerdown', onTrustedInteraction, true);
      document.removeEventListener('keydown', onTrustedInteraction, true);
      document.removeEventListener('click', onTrustedInteraction, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (graph?.masterGain?.gain) graph.masterGain.gain.value = MASTER_GAIN_OFF;
      lastMix = deriveMix({}, lastMix);

      destroyPromise = (async () => {
        for (const oscillator of [graph?.driveCoreOscillator, graph?.driveHarmonicOscillator]) {
          if (!oscillator) continue;
          try {
            oscillator.stop();
          } catch (error) {
            if (error?.name !== 'InvalidStateError') throw error;
          }
        }
        diagnostics.engineActive = false;
        buffers.clear();
        failedAssetKeys.clear();
        automationTargets.clear();
        if (context && context.state !== 'closed') await context.close();
        emit();
        listeners.clear();
        return true;
      })();
      return destroyPromise;
    }

    return Object.freeze({
      get enabled() { return enabled; },
      get supported() { return diagnostics.supported; },
      getDiagnostics: snapshot,
      setEnabled,
      unlock,
      update,
      play,
      clearDeferredEvents,
      subscribe,
      destroy
    });
  }

  window.NeonAudio = Object.freeze({
    version: 'Neon-audio-13',
    STORAGE_KEY,
    EFFECT_ASSET_RELEASE_GENERATION,
    PROPULSION_PROFILE,
    PROPULSION_GAIN_SCALE,
    LUGGING_AUDIO_CONTRACT,
    RAIN_ACOUSTIC_CONTRACT,
    ASSET_MANIFEST,
    EVENT_DEFINITIONS,
    deriveMix,
    shouldUnlockForInteraction,
    createController
  });
})();
