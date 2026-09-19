/* Equal-scale cloverleaf minimap renderer. Track topology and frames remain authoritative in NeonTrack. */
window.NeonCloverleafMap = (() => {
  'use strict';

  const SAMPLE_STEP_M = 4;
  const MOBILE_WIDTH_PX = 160;
  const MOBILE_HEIGHT_PX = 108;
  const DESKTOP_WIDTH_PX = 400;
  const DESKTOP_HEIGHT_PX = 225;
  const COMPACT_MAX_WIDTH_PX = 240;
  const DESKTOP_ROAD_DETAIL_MIN_SCALE = 0.60;
  const DESKTOP_ROAD_DETAIL_MAX_SCALE = 0.72;
  const DESKTOP_ROAD_DETAIL_TARGET_AHEAD_M = 440;
  const DESKTOP_SCALE_BAR_TARGET_PX = 54;
  const TACTICAL_SCALE_BAR_MAX_METERS = 200;
  const DESKTOP_WORLD_CACHE_MIN_SCALE = 0.30;
  const DESKTOP_OVERVIEW_VISIBLE_SPAN_M = 1_800;
  const COMPACT_OVERVIEW_VISIBLE_SPAN_M = 1_440;
  const DESKTOP_GUIDED_VISIBLE_SPAN_M = 1_350;
  const COMPACT_GUIDED_VISIBLE_SPAN_M = 900;
  const PLAYER_ARROW_PX = 11;
  const ROUTE_GAP_LIMIT_PX = 0.75;
  const DRAW_SAMPLE_WINDOW = 180;
  const DRAW_DIAGNOSTIC_REFRESH_FRAMES = 15;
  const SIZE_FALLBACK_INTERVAL_FRAMES = 120;
  const CLIP_AUDIT_INTERVAL_FRAMES = 120;
  const MAP_MODE_TRANSITION_MS = 460;
  const MODE_PROGRESS_KEYS = Object.freeze(['overview', 'guided', 'roadDetail']);
  const WORLD_CACHE_SCALE = 0.32;
  const MOBILE_WORLD_CACHE_SCALE = 0.16;
  const WORLD_CACHE_MARGIN_PX = 48;
  const EMPTY_COLLECTION = Object.freeze([]);
  const SCENE_CONTRACT_VERSION = 1;
  const SCENE_COORDINATE_MODE = 'absolute-world-xz';
  const TERRAIN_PRESENTATION_MIX = 0.58;
  const TERRAIN_PRESENTATION_ALPHA = 0.84;
  const TERRAIN_INK_RGB = Object.freeze({ r: 5, g: 15, b: 23 });
  const COMPACT_COMPASS_RADIUS_PX = 13;
  const DESKTOP_FALLBACK_COMPASS_RADIUS_PX = 18;
  const DEFAULT_COLORS = Object.freeze({
    background: '#06111a',
    grid: 'rgba(159, 228, 220, 0.085)',
    compass: 'rgba(195, 224, 232, 0.78)',
    unreachable: 'rgba(44, 67, 78, 0.78)',
    available: 'rgba(87, 150, 157, 0.90)',
    ground: 'rgba(167, 196, 200, 0.54)',
    lower: 'rgba(112, 164, 178, 0.86)',
    upper: 'rgba(203, 226, 226, 0.94)',
    mask: '#06111a',
    proposed: '#e8c766',
    selectedOuter: '#fff6d8',
    selectedInner: '#f0c75b',
    label: '#effbff',
    labelBackground: 'rgba(3, 11, 18, 0.90)',
    player: '#ffffff',
    playerCore: '#f4cc67',
    obstacle: '#ff7c86',
    pickup: '#74e9ff',
    traffic: '#9db8c2'
  });

  /** Resolve player-facing map copy at paint time so cached topology stays language-neutral. */
  function uiText(key, parameters = {}, fallback = key) {
    const i18n = window.NeonI18n;
    return typeof i18n?.t === 'function'
      ? i18n.t(key, parameters, { fallback })
      : fallback;
  }

  function uiSource(source) {
    const i18n = window.NeonI18n;
    return typeof i18n?.translateSource === 'function'
      ? i18n.translateSource(source)
      : String(source ?? '');
  }

  function uiNumber(value, options = {}) {
    const i18n = window.NeonI18n;
    return typeof i18n?.formatNumber === 'function'
      ? i18n.formatNumber(value, options)
      : String(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smootherStep01(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function snapshotHashText(hash, value) {
    let next = hash >>> 0;
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index++) {
      next = Math.imul(next ^ text.charCodeAt(index), 0x0100_0193) >>> 0;
    }
    return next;
  }

  function snapshotHashNumber(hash, value, precision = 1_000) {
    const normalized = Number.isFinite(value) ? Math.round(value * precision) : 0x7fff_ffff;
    return Math.imul((hash >>> 0) ^ normalized, 0x0100_0193) >>> 0;
  }

  function terrainColorToCss(value) {
    if (!Number.isFinite(value)) return null;
    const color = clamp(Math.trunc(value), 0, 0xff_ffff);
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  /**
   * Reuse the scene terrain contract instead of maintaining a second map-only palette. Presentation tinting
   * may lower luminance, but each overview block remains tied to the corresponding 3D biome base color.
   */
  function resolveTerrainPalette(options) {
    const configuredZones = collectionValues(options.zones || window.NeonConfig?.zones);
    if (!configuredZones.length) {
      throw new TypeError('NeonCloverleafMap.create requires configured terrain zones.');
    }
    return Object.freeze(configuredZones.map((zone, index) => {
      const color = terrainColorToCss(zone?.terrain?.base);
      if (!color) {
        throw new TypeError(`NeonCloverleafMap terrain zone ${index} requires terrain.base.`);
      }
      return color;
    }));
  }

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  /** Graph collections may be arrays, Maps, or id-keyed objects depending on the build/runtime boundary. */
  function collectionValues(source) {
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return [...source.values()];
    if (source && typeof source === 'object') return Object.values(source);
    return EMPTY_COLLECTION;
  }

  function getCollectionValue(source, id) {
    if (!source || id == null) return null;
    if (source instanceof Map) return source.get(id) || null;
    if (Array.isArray(source)) return source.find((item) => item?.id === id) || null;
    return source[id] || null;
  }

  function pointComponent(frame, flatKey, nestedObjectKey, nestedValueKey, fallback = 0) {
    if (Number.isFinite(frame?.[flatKey])) return frame[flatKey];
    if (Number.isFinite(frame?.[nestedObjectKey]?.[nestedValueKey])) return frame[nestedObjectKey][nestedValueKey];
    return fallback;
  }

  function hasFiniteWorldCoordinates(frame) {
    return (Number.isFinite(frame?.x) && Number.isFinite(frame?.z))
      || (Number.isFinite(frame?.position?.x) && Number.isFinite(frame?.position?.z));
  }

  function validateSceneContract(world) {
    if (world?.version !== SCENE_CONTRACT_VERSION) {
      throw new TypeError(`Cloverleaf map requires scene contract version ${SCENE_CONTRACT_VERSION}.`);
    }
    if (world.coordinateMode !== SCENE_COORDINATE_MODE) {
      throw new TypeError(`Cloverleaf map requires ${SCENE_COORDINATE_MODE} coordinates.`);
    }
    return world;
  }

  function normalizeFrame(frame, fallback = null, target = null) {
    const x = pointComponent(frame, 'x', 'position', 'x', fallback?.x || 0);
    const y = pointComponent(frame, 'y', 'position', 'y', fallback?.y || 0);
    const z = pointComponent(frame, 'z', 'position', 'z', fallback?.z || 0);
    let tangentX = pointComponent(frame, 'tangentX', 'tangent', 'x', fallback?.tangentX || 0);
    let tangentZ = pointComponent(frame, 'tangentZ', 'tangent', 'z', fallback?.tangentZ ?? -1);
    const tangentLength = Math.hypot(tangentX, tangentZ);
    if (tangentLength > 1e-6) {
      tangentX /= tangentLength;
      tangentZ /= tangentLength;
    } else {
      tangentX = 0;
      tangentZ = -1;
    }
    const normalized = target || {};
    normalized.x = x;
    normalized.y = y;
    normalized.z = z;
    normalized.tangentX = tangentX;
    normalized.tangentZ = tangentZ;
    normalized.edgeId = frame?.edgeId || fallback?.edgeId || null;
    normalized.edgeS = finite(frame?.edgeS, fallback?.edgeS || 0);
    normalized.surfaceId = frame?.surfaceId || fallback?.surfaceId || null;
    normalized.layer = frame?.layer ?? fallback?.layer ?? 0;
    return normalized;
  }

  function frameFromRawPoint(point, fallback = null) {
    if (Array.isArray(point)) {
      return normalizeFrame({ x: point[0], y: point[1], z: point[2] }, fallback);
    }
    return normalizeFrame(point?.pose || point, fallback);
  }

  function cardinalLabel(port) {
    const direction = ({ north: 'n', east: 'e', south: 's', west: 'w' })[port];
    const fallback = ({ north: '北', east: '东', south: '南', west: '西' })[port] || String(port || '');
    return direction ? uiText(`direction.${direction}`, {}, fallback) : fallback;
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function createBufferCanvas(width, height, createCanvas) {
    if (typeof createCanvas === 'function') return createCanvas(width, height);
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    throw new Error('NeonCloverleafMap requires OffscreenCanvas, document, or options.createCanvas.');
  }

  function recoverableMinimapError(message, options = {}) {
    const ErrorClass = window.NeonMinimapErrors?.NeonMinimapRecoverableError;
    if (typeof ErrorClass === 'function') return new ErrorClass(message, options);
    // Entry-point drift must remain diagnosable while the dedicated error module is being repaired.
    const error = new Error(message, options.cause ? { cause: options.cause } : undefined);
    error.name = 'NeonMinimapRecoverableError';
    error.code = options.code || 'minimap-frame-failure';
    error.phase = options.phase || 'unknown';
    error.recoverable = true;
    return error;
  }

  function markPresentationCanvas(canvas, presented) {
    canvas.classList?.toggle?.('is-presented', presented);
    if (canvas.dataset) canvas.dataset.presented = presented ? 'true' : 'false';
  }

  /**
   * Draw each completed frame into the hidden presentation surface, then swap both visibility flags in one
   * task. Resizing or copying the standby can fail without touching the canvas that still owns the last frame.
   */
  function createAtomicPresenter(options = {}) {
    const primaryCanvas = options.canvas;
    const standbyCanvas = options.standbyCanvas || null;
    if (!primaryCanvas || typeof primaryCanvas.getContext !== 'function') {
      throw new TypeError('NeonCloverleafMap.createAtomicPresenter requires a primary canvas.');
    }
    if (!standbyCanvas || standbyCanvas === primaryCanvas || typeof standbyCanvas.getContext !== 'function') {
      throw new TypeError(
        'NeonCloverleafMap atomic presentation requires a distinct standby canvas.'
      );
    }
    const primaryContext = primaryCanvas.getContext('2d', { alpha: true });
    if (!primaryContext) {
      throw new Error('NeonCloverleafMap could not acquire its primary presentation context.');
    }
    const standbyContext = standbyCanvas.getContext('2d', { alpha: true });
    if (!standbyContext) {
      throw new Error('NeonCloverleafMap could not acquire its standby presentation context.');
    }
    const surfaces = [
      { canvas: primaryCanvas, context: primaryContext },
      { canvas: standbyCanvas, context: standbyContext }
    ];
    let activeIndex = surfaces.findIndex((surface) => (
      surface.canvas.classList?.contains?.('is-presented')
      || surface.canvas.dataset?.presented === 'true'
    ));
    if (activeIndex < 0) activeIndex = 0;
    for (let index = 0; index < surfaces.length; index++) {
      markPresentationCanvas(surfaces[index].canvas, index === activeIndex);
    }
    const diagnostics = {
      mode: 'dual-canvas-swap',
      presentationCount: 0,
      presentationResizeCount: 0,
      presentationSwapCount: 0,
      presentationFailureCount: 0,
      activePresentationIndex: activeIndex,
      presentedBufferWidth: surfaces[activeIndex].canvas.width || 0,
      presentedBufferHeight: surfaces[activeIndex].canvas.height || 0
    };
    let destroyed = false;

    function present(sourceCanvas) {
      if (destroyed) {
        throw new Error('NeonCloverleafMap presenter is destroyed.');
      }
      if (!sourceCanvas || !(sourceCanvas.width > 0) || !(sourceCanvas.height > 0)) {
        throw recoverableMinimapError('Minimap presentation source is unavailable.', {
          code: 'minimap-presentation-source-unavailable',
          phase: 'presentation'
        });
      }
      const targetIndex = 1 - activeIndex;
      const target = surfaces[targetIndex];
      const resized = target.canvas.width !== sourceCanvas.width
        || target.canvas.height !== sourceCanvas.height;
      try {
        if (resized) {
          target.canvas.width = sourceCanvas.width;
          target.canvas.height = sourceCanvas.height;
        }
        target.context.setTransform(1, 0, 0, 1, 0, 0);
        target.context.globalAlpha = 1;
        target.context.globalCompositeOperation = 'copy';
        target.context.drawImage(sourceCanvas, 0, 0);
        target.context.globalCompositeOperation = 'source-over';
        target.context.imageSmoothingEnabled = true;
      } catch (cause) {
        diagnostics.presentationFailureCount++;
        try {
          target.context.globalCompositeOperation = 'source-over';
        } catch (_error) {
          // A lost target context is hidden in dual-canvas mode; the active surface remains untouched.
        }
        throw recoverableMinimapError('Minimap frame presentation failed.', {
          code: 'minimap-presentation-failed',
          phase: 'presentation',
          cause
        });
      }
      markPresentationCanvas(target.canvas, true);
      markPresentationCanvas(surfaces[activeIndex].canvas, false);
      activeIndex = targetIndex;
      diagnostics.presentationSwapCount++;
      diagnostics.presentationCount++;
      if (resized) diagnostics.presentationResizeCount++;
      diagnostics.activePresentationIndex = activeIndex;
      diagnostics.presentedBufferWidth = sourceCanvas.width;
      diagnostics.presentedBufferHeight = sourceCanvas.height;
      return Object.freeze({ ...diagnostics });
    }

    function destroy() {
      if (destroyed) return false;
      destroyed = true;
      for (const surface of surfaces) {
        try {
          surface.context.setTransform(1, 0, 0, 1, 0, 0);
          surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
        } catch (_error) {
          // Resource disposal must continue even if the browser already lost one presentation context.
        }
        markPresentationCanvas(surface.canvas, false);
      }
      diagnostics.activePresentationIndex = -1;
      diagnostics.presentedBufferWidth = 0;
      diagnostics.presentedBufferHeight = 0;
      return true;
    }

    return Object.freeze({
      present,
      getDiagnostics: () => Object.freeze({ ...diagnostics }),
      destroy
    });
  }

  /**
   * Create a graph minimap. `overviewProgress` reveals readable north-up decision context;
   * `guidedProgress` tightens around the selected path while retaining north-up.
   */
  function create(options = {}) {
    const canvas = options.canvas;
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('NeonCloverleafMap.create requires a canvas.');
    }
    const presenter = createAtomicPresenter({
      canvas,
      standbyCanvas: options.standbyCanvas || null
    });

    const track = options.track || window.NeonTrack;
    if (!track) throw new TypeError('NeonCloverleafMap.create requires the track API.');
    let graph = options.graph || track.graph;
    if (!graph) throw new TypeError('NeonCloverleafMap.create requires track.graph or options.graph.');

    const colors = Object.freeze({ ...DEFAULT_COLORS, ...(options.colors || {}) });
    const terrainPalette = resolveTerrainPalette(options);
    const terrainPaletteRgb = Object.freeze(terrainPalette.map((color) => ({
      r: Number.parseInt(color.slice(1, 3), 16),
      g: Number.parseInt(color.slice(3, 5), 16),
      b: Number.parseInt(color.slice(5, 7), 16)
    })));
    const maxDpr = clamp(finite(options.maxDpr, 2), 1, 3);
    const sampleStep = Math.max(1, finite(options.sampleStep, SAMPLE_STEP_M));
    const edgeById = new Map();
    const edgeRecords = new Map();
    const nodeById = new Map();
    const drawDurations = new Float64Array(DRAW_SAMPLE_WINDOW);
    const drawDurationScratch = new Float64Array(DRAW_SAMPLE_WINDOW);
    let drawDurationCount = 0;
    let drawDurationCursor = 0;
    const diagnostics = {
      version: 4,
      graphVersion: graph.version || null,
      activeVisualTileCount: 0,
      activeVisualTileTokens: Object.freeze([]),
      cssWidth: 0,
      cssHeight: 0,
      bufferWidth: 0,
      bufferHeight: 0,
      effectiveDpr: 1,
      edgeCount: 0,
      crossingCount: 0,
      tunnelSegmentCount: 0,
      sampledPointCount: 0,
      clipBeforeCount: 0,
      clipAfterCount: 0,
      preClipSampleCount: 0,
      postClipSampleCount: 0,
      networkClippedSamples: 0,
      trimmedEdgeCount: 0,
      routeGapCount: 0,
      routeGapMaxPx: 0,
      maxRouteGapPx: 0,
      chordErrorMaxPx: 0,
      maxChordErrorPx: 0,
      labelOverlapCount: 0,
      labelClippedCount: 0,
      labelOverlapRejectedCount: 0,
      labelClipRejectedCount: 0,
      labelEllipsisCount: 0,
      labelDrawCount: 0,
      selectedLabelDrawCount: 0,
      labelRepositionCount: 0,
      bridgeLayerErrorCount: 0,
      arrowTangentErrorDeg: 0,
      staticCacheBuildCount: 0,
      staticCacheHitCount: 0,
      staticCachePanHitCount: 0,
      worldCacheWidth: 0,
      worldCacheHeight: 0,
      worldCacheScalePxPerM: 0,
      worldCacheSourceWidth: 0,
      worldCacheSourceHeight: 0,
      clipAuditCount: 0,
      clipAuditSkipCount: 0,
      drawLastMs: 0,
      drawP95Ms: 0,
      mapDrawP95Ms: 0,
      steadyDrawSampleCount: 0,
      northUp: true,
      overviewProgress: 0,
      guidedProgress: 0,
      roadDetailProgress: 0,
      overviewTargetProgress: 0,
      guidedTargetProgress: 0,
      roadDetailTargetProgress: 0,
      modeTransitionActive: false,
      modeTransitionDurationMs: MAP_MODE_TRANSITION_MS,
      modeTransitionMaximumStep: 0,
      reducedMotion: false,
      roadDetailScale: 0,
      roadDetailVisibleAheadM: 0,
      roadDetailRoadWidthPx: 0,
      roadDetailObstacleMarkerWidthPx: 0,
      roadDetailObstacleMarkerHeightPx: 0,
      roadDetailPickupMarkerDiameterPx: 0,
      roadDetailLegendCount: 0,
      mapScalePxPerM: 0,
      visibleWorldWidthM: 0,
      visibleWorldHeightM: 0,
      focusAheadM: 0,
      playerViewportX: 0,
      playerViewportY: 0,
      playerClamped: false,
      playerDrawCount: 0,
      roadDetailRoadBandCount: 0,
      roadDetailTickCount: 0,
      roadDetailControlCount: 0,
      bufferResizeCount: 0,
      frameBufferAllocationFailureCount: 0,
      worldBufferAllocationFailureCount: 0,
      worldCacheRenderFailureCount: 0,
      frameRenderFailureCount: 0,
      deferredResizeCount: 0,
      sizeSyncCount: 0,
      sizeSyncSkipCount: 0,
      framePresentationCount: 0,
      framePresentationResizeCount: 0,
      framePresentationSwapCount: 0,
      framePresentationFailureCount: 0,
      presentationMode: presenter.getDiagnostics().mode,
      activePresentationIndex: presenter.getDiagnostics().activePresentationIndex,
      presentedBufferWidth: canvas.width || 0,
      presentedBufferHeight: canvas.height || 0,
      mapMode: 'local',
      selectedEdgeCount: 0,
      proposedEdgeCount: 0,
      availableEdgeCount: 0,
      scaleBarMeters: 0,
      compassDrawCount: 0,
      compassPlacement: 'external-desktop',
      compassX: 0,
      compassY: 0,
      compassRadiusPx: 0,
      compassInsetPx: 0,
      compassBearingDeg: 0,
      compassNorthAngleRad: 0,
      navigationDrawCount: 0,
      navigationLabel: '',
      navigationDistanceM: null,
      navigationCurrentSpeed: null,
      navigationSuggestedSpeed: null,
      navigationBraking: false,
      ambientTrafficDrawCount: 0,
      hazardDrawCount: 0,
      pickupDrawCount: 0,
      nearestObstacleDistance: null,
      sceneContractVersion: SCENE_CONTRACT_VERSION,
      sceneCoordinateMode: SCENE_COORDINATE_MODE,
      sceneTerrainSource: 'payload.world.terrainCells',
      sceneScenerySource: 'payload.world.sceneryEntities',
      sceneTerrainPaletteCount: terrainPalette.length,
      sceneTerrainPalette: terrainPalette,
      sceneTerrainInputCount: 0,
      sceneTerrainDrawCount: 0,
      sceneTerrainEcotoneCount: 0,
      sceneTerrainZoneMask: 0,
      sceneTerrainSnapshotHash: 0,
      sceneSceneryInputCount: 0,
      sceneSceneryVisibleCount: 0,
      sceneSceneryDrawCount: 0,
      sceneLandmarkDrawCount: 0,
      sceneEnvironmentDrawCount: 0,
      sceneAirTrafficDrawCount: 0,
      sceneDarkDragonDrawCount: 0,
      sceneScenerySnapshotHash: 0,
      sceneSyntheticObjectCount: 0,
      sceneRejectedCoordinateCount: 0,
      sceneEntityRevision: 0,
      sceneTerrainRevision: 0,
      sceneLayerOrder: 'shared-terrain>shared-scenery>roads>route-navigation',
      externalEntityEdgeResolveCount: 0,
      rejectedEntityCoordinateCount: 0,
      pathSourceMutationCount: 0,
      proposalSourceMutationCount: 0,
      attemptedFrameSerial: 0,
      presentedFrameSerial: 0,
      lastFailureCode: null,
      lastFailurePhase: null,
      presentedMapMode: 'local',
      presentedNavigationLabel: '',
      presentedNavigationDistanceM: null,
      presentedNavigationBraking: false,
      debugFaultCount: 0
    };

    let edges = [];
    let movements = [];
    let crossings = [];
    let frameBuffer = null;
    let context = null;
    let staticBuffer = null;
    let staticContext = null;
    let staticCacheKey = '';
    let staticTransform = null;
    let staticWorldWidth = 0;
    let staticWorldHeight = 0;
    let destroyed = false;
    let lastPayload = null;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let graphBounds = { minX: -700, maxX: 700, minZ: -700, maxZ: 700 };
    let geometryBridgeLayerErrors = 0;
    let cachedClassification = null;
    let orderedPathCache = new WeakMap();
    let updateSerial = 0;
    let lastClipAuditSerial = Number.NEGATIVE_INFINITY;
    let lastClipAuditMode = '';
    let forceClipAudit = true;
    let sizeDirty = true;
    let lastSizeSyncSerial = Number.NEGATIVE_INFINITY;
    let resizeObserver = null;
    let debugFailurePhase = null;
    const transitionDurationMs = Math.max(0, finite(options.transitionDurationMs, MAP_MODE_TRANSITION_MS));
    const transitionClock = typeof options.now === 'function' ? options.now : nowMs;
    // The owner supplies a getter instead of a copied boolean so a live media-query change is visible immediately.
    const isReducedMotionEnabled = typeof options.isReducedMotionEnabled === 'function'
      ? options.isReducedMotionEnabled
      : () => false;
    // The page owns the external compass breakpoint. A live getter keeps coarse-pointer tablets from falling
    // between the CSS-only desktop instrument and the compact-width in-canvas fallback.
    const isExternalCompassVisible = typeof options.isExternalCompassVisible === 'function'
      ? options.isExternalCompassVisible
      : () => width > COMPACT_MAX_WIDTH_PX;
    const modeProgress = { overview: 0, guided: 0, roadDetail: 0 };
    const modeTargets = { overview: 0, guided: 0, roadDetail: 0 };
    const modeChannels = {
      overview: { value: 0, from: 0, target: 0, startedAt: 0 },
      guided: { value: 0, from: 0, target: 0, startedAt: 0 },
      roadDetail: { value: 0, from: 0, target: 0, startedAt: 0 }
    };
    let modeTransitionInitialized = false;
    const entitySampleScratch = {};
    const entityFrameScratch = {};
    const focusFrameScratch = {};
    const sceneCornerScratch = Array.from({ length: 4 }, () => ({ x: 0, z: 0 }));
    const sceneProjectedCornerScratch = Array.from({ length: 4 }, () => ({ x: 0, y: 0 }));
    const occupiedLabelBoxes = Array.from({ length: 12 }, () => ({ x: 0, y: 0, width: 0, height: 0 }));
    const selectedPathProjection = { coordinates: new Float32Array(0), count: 0 };
    const proposedPathProjection = { coordinates: new Float32Array(0), count: 0 };

    function debugFailNextFrame(phase = 'frame-render') {
      if (options.allowTestFaults !== true || destroyed) return false;
      if (phase !== 'frame-render' && phase !== 'presentation') {
        throw new RangeError('Minimap debug failure phase must be frame-render or presentation.');
      }
      debugFailurePhase = phase;
      return true;
    }

    function consumeDebugFailure(phase) {
      if (debugFailurePhase !== phase) return false;
      debugFailurePhase = null;
      diagnostics.debugFaultCount++;
      return true;
    }

    function terrainCellColor(zoneIndex, brightness = 1) {
      const source = terrainPaletteRgb[clamp(Math.trunc(zoneIndex), 0, terrainPaletteRgb.length - 1)];
      const gain = clamp(finite(brightness, 1), 0.72, 1.16);
      // Preserve the configured biome hue while compressing luminance into the navigation deck's night-ink
      // range. Semi-opaque cells let the coordinate grid remain visible without inventing map-only terrain.
      const red = clamp(Math.round(lerp(TERRAIN_INK_RGB.r, source.r * gain, TERRAIN_PRESENTATION_MIX)), 0, 255);
      const green = clamp(Math.round(lerp(TERRAIN_INK_RGB.g, source.g * gain, TERRAIN_PRESENTATION_MIX)), 0, 255);
      const blue = clamp(Math.round(lerp(TERRAIN_INK_RGB.b, source.b * gain, TERRAIN_PRESENTATION_MIX)), 0, 255);
      return `rgba(${red}, ${green}, ${blue}, ${TERRAIN_PRESENTATION_ALPHA})`;
    }

    function rawNodePoint(rawNode) {
      if (typeof rawNode === 'string') return frameFromRawPoint(nodeById.get(rawNode));
      if (rawNode?.id && nodeById.has(rawNode.id) && !Number.isFinite(rawNode.x)) {
        return frameFromRawPoint(nodeById.get(rawNode.id));
      }
      return frameFromRawPoint(rawNode);
    }

    function rawEdgePoints(edge) {
      const source = edge.points || edge.nodes || edge.geometryPoints || [];
      return collectionValues(source).map(rawNodePoint).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z));
    }

    function sampleRawEdge(edge, edgeS) {
      const raw = rawEdgePoints(edge);
      if (!raw.length) return normalizeFrame(null, { edgeId: edge.id, edgeS });
      if (raw.length === 1) return normalizeFrame(raw[0], { edgeId: edge.id, edgeS });
      const cumulative = [0];
      for (let index = 1; index < raw.length; index++) {
        cumulative.push(cumulative[index - 1] + Math.hypot(raw[index].x - raw[index - 1].x, raw[index].z - raw[index - 1].z));
      }
      const total = cumulative[cumulative.length - 1] || 1;
      const target = clamp(edgeS, 0, Number(edge.length) || total) / (Number(edge.length) || total) * total;
      let segment = 0;
      while (segment < cumulative.length - 2 && cumulative[segment + 1] < target) segment++;
      const a = raw[segment];
      const b = raw[segment + 1];
      const span = Math.max(1e-6, cumulative[segment + 1] - cumulative[segment]);
      const t = clamp((target - cumulative[segment]) / span, 0, 1);
      return normalizeFrame({
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        z: lerp(a.z, b.z, t),
        tangentX: (b.x - a.x) / span,
        tangentZ: (b.z - a.z) / span,
        edgeId: edge.id,
        edgeS
      });
    }

    function sampleEdgeFrame(edge, edgeS, lateral = 0, scratch = {}, target = null, rejectInvalid = false) {
      if (typeof track.sampleEdge === 'function') {
        const sampledFrame = track.sampleEdge(edge.id, edgeS, lateral, scratch);
        // Entity inputs cross a component boundary and must not inherit normalizeFrame's trusted-graph fallback.
        if (rejectInvalid && !hasFiniteWorldCoordinates(sampledFrame)) return null;
        return normalizeFrame(sampledFrame, {
          edgeId: edge.id,
          edgeS,
          layer: edge.layer,
          surfaceId: edge.surfaceId
        }, target);
      }
      return sampleRawEdge(edge, edgeS);
    }

    function buildEdgeRecord(edge) {
      const edgeLength = Math.max(0.01, finite(edge.length, 0.01));
      // The visual-only half of a corridor is analytic and straight; exact longer segments avoid a map-mode
      // cache spike while retaining the same physical width, heading, and endpoint coordinates.
      const edgeSampleStep = edge.visualOnly === true ? 1_024 : sampleStep;
      const segmentCount = Math.max(2, Math.ceil(edgeLength / edgeSampleStep));
      const points = [];
      const scratch = {};
      for (let index = 0; index <= segmentCount; index++) {
        const edgeS = edgeLength * index / segmentCount;
        const frame = sampleEdgeFrame(edge, edgeS, 0, scratch);
        points.push({ ...frame, edgeS });
      }
      for (let index = 0; index < points.length; index++) {
        if (Math.hypot(points[index].tangentX, points[index].tangentZ) > 1e-6) continue;
        const a = points[Math.max(0, index - 1)];
        const b = points[Math.min(points.length - 1, index + 1)];
        const length = Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z));
        points[index].tangentX = (b.x - a.x) / length;
        points[index].tangentZ = (b.z - a.z) / length;
      }
      let chordErrorM = 0;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        const midpointS = (a.edgeS + b.edgeS) * 0.5;
        const curveMidpoint = sampleEdgeFrame(edge, midpointS, 0, scratch);
        chordErrorM = Math.max(chordErrorM,
          Math.hypot(curveMidpoint.x - (a.x + b.x) * 0.5, curveMidpoint.z - (a.z + b.z) * 0.5));
      }
      const arrowS = edgeLength * 0.58;
      const arrowFrame = sampleEdgeFrame(edge, arrowS, 0, scratch);
      const arrowBefore = sampleEdgeFrame(edge, clamp(arrowS - 0.75, 0, edgeLength), 0, scratch);
      const arrowAfter = sampleEdgeFrame(edge, clamp(arrowS + 0.75, 0, edgeLength), 0, scratch);
      return {
        edge,
        id: edge.id,
        layer: edge.layer,
        family: edge.family || 'mainline',
        points,
        oneWayArrow: Object.freeze({ edgeS: arrowS, frame: arrowFrame, before: arrowBefore, after: arrowAfter }),
        chordErrorM,
        minX: Math.min(...points.map((point) => point.x)),
        maxX: Math.max(...points.map((point) => point.x)),
        minZ: Math.min(...points.map((point) => point.z)),
        maxZ: Math.max(...points.map((point) => point.z))
      };
    }

    function edgeLayer(edge) {
      if (Number.isFinite(edge?.layer)) return edge.layer;
      if (edge?.layer === 'upper' || edge?.structure === 'bridge') return 1;
      if (edge?.layer === 'lower' || edge?.structure === 'underpass') return -1;
      return 0;
    }

    function nearestEdgeStation(record, x, z) {
      if (!record?.points?.length) return 0;
      let best = record.points[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const point of record.points) {
        const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
        if (distance < bestDistance) {
          best = point;
          bestDistance = distance;
        }
      }
      return best.edgeS;
    }

    function crossingStation(crossing, role, record) {
      const station = crossing?.[`${role}EdgeS`] ?? crossing?.[`${role}S`];
      if (Number.isFinite(station)) return clamp(station, 0, record.edge.length);
      return nearestEdgeStation(record, finite(crossing?.x), finite(crossing?.z));
    }

    /** Rebuild geometry once per graph revision; frame sampling is never repeated by the per-frame painter. */
    function rebuildGraph(nextGraph = graph) {
      if (destroyed) return Object.freeze({ ...diagnostics });
      const candidateGraph = nextGraph || track.graph;
      if (!candidateGraph) throw new TypeError('Cloverleaf minimap graph cannot be empty.');

      // Graph refresh is one commit boundary. Geometry sampling and the matching world raster may both fail;
      // neither may leave new topology paired with the previously published cache.
      const previous = {
        graph,
        edges,
        movements,
        crossings,
        graphBounds,
        geometryBridgeLayerErrors,
        edgeById: [...edgeById.entries()],
        edgeRecords: [...edgeRecords.entries()],
        nodeById: [...nodeById.entries()]
      };
      try {
        graph = candidateGraph;
        edges = collectionValues(graph.edges);
        movements = collectionValues(graph.movements);
        crossings = collectionValues(graph.crossings);
        edgeById.clear();
        edgeRecords.clear();
        nodeById.clear();
        for (const node of collectionValues(graph.nodes)) {
          if (node?.id) nodeById.set(node.id, node);
        }
        for (const edge of edges) {
          if (!edge?.id) continue;
          edgeById.set(edge.id, edge);
          edgeRecords.set(edge.id, buildEdgeRecord(edge));
        }
        const records = [...edgeRecords.values()];
        const declaredBounds = graph.bounds || null;
        graphBounds = records.length
          ? {
              minX: finite(declaredBounds?.minX, Math.min(...records.map((record) => record.minX))),
              maxX: finite(declaredBounds?.maxX, Math.max(...records.map((record) => record.maxX))),
              minZ: finite(declaredBounds?.minZ, Math.min(...records.map((record) => record.minZ))),
              maxZ: finite(declaredBounds?.maxZ, Math.max(...records.map((record) => record.maxZ)))
            }
          : { minX: -700, maxX: 700, minZ: -700, maxZ: 700 };
        geometryBridgeLayerErrors = 0;
        for (const crossing of crossings) {
          const upper = edgeRecords.get(crossing.upperEdgeId);
          const lower = edgeRecords.get(crossing.lowerEdgeId);
          if (!upper || !lower) {
            geometryBridgeLayerErrors++;
            continue;
          }
          const upperS = crossingStation(crossing, 'upper', upper);
          const lowerS = crossingStation(crossing, 'lower', lower);
          const upperFrame = sampleEdgeFrame(upper.edge, upperS);
          const lowerFrame = sampleEdgeFrame(lower.edge, lowerS);
          const declaredClearance = Math.max(0, finite(crossing.clearance));
          // Crossing role is authoritative for transition edges whose endpoints span two global deck levels.
          if (upperFrame.y - lowerFrame.y + 0.05 < declaredClearance) {
            geometryBridgeLayerErrors++;
          }
        }

        // Allocate against the candidate bounds before publishing any graph diagnostics or invalidating live caches.
        const worldCandidate = width > 0 && height > 0 ? allocateWorldBuffer(width, dpr) : null;
        diagnostics.graphVersion = graph.version || null;
        diagnostics.activeVisualTileTokens = Object.freeze([
          ...collectionValues(graph.tileTokens).map((token) => String(token))
        ]);
        diagnostics.activeVisualTileCount = diagnostics.activeVisualTileTokens.length || (graph.tile ? 1 : 0);
        diagnostics.edgeCount = edgeRecords.size;
        diagnostics.crossingCount = crossings.length;
        diagnostics.tunnelSegmentCount = edges.reduce((total, edge) => (
          total + (edge.tunnelProfiles?.length || 0)
        ), 0);
        diagnostics.sampledPointCount = records.reduce((total, record) => total + record.points.length, 0);
        diagnostics.bridgeLayerErrorCount = geometryBridgeLayerErrors;
        cachedClassification = null;
        orderedPathCache = new WeakMap();
        forceClipAudit = true;
        invalidate();
        if (worldCandidate) commitWorldBuffer(worldCandidate);
        return Object.freeze({ ...diagnostics });
      } catch (error) {
        graph = previous.graph;
        edges = previous.edges;
        movements = previous.movements;
        crossings = previous.crossings;
        graphBounds = previous.graphBounds;
        geometryBridgeLayerErrors = previous.geometryBridgeLayerErrors;
        edgeById.clear();
        edgeRecords.clear();
        nodeById.clear();
        for (const entry of previous.edgeById) edgeById.set(...entry);
        for (const entry of previous.edgeRecords) edgeRecords.set(...entry);
        for (const entry of previous.nodeById) nodeById.set(...entry);
        throw error;
      }
    }

    function invalidate() {
      if (destroyed) return false;
      staticCacheKey = '';
      staticTransform = null;
      return true;
    }

    /**
     * Allocate one north-up world raster for the complete graph. Player motion changes only the viewport
     * transform applied when this raster is copied; it never invalidates topology or bridge layering.
     */
    function allocateWorldBuffer(targetWidth, targetDpr) {
      const minimumWorldScale = targetWidth <= COMPACT_MAX_WIDTH_PX
        ? MOBILE_WORLD_CACHE_SCALE
        : DESKTOP_WORLD_CACHE_MIN_SCALE;
      const defaultWorldScale = targetWidth <= COMPACT_MAX_WIDTH_PX
        ? MOBILE_WORLD_CACHE_SCALE
        : WORLD_CACHE_SCALE;
      const worldScale = Math.max(minimumWorldScale, finite(options.worldCacheScale, defaultWorldScale));
      const spanX = Math.max(1, graphBounds.maxX - graphBounds.minX);
      const spanZ = Math.max(1, graphBounds.maxZ - graphBounds.minZ);
      const worldWidth = Math.ceil(spanX * worldScale + WORLD_CACHE_MARGIN_PX * 2);
      const worldHeight = Math.ceil(spanZ * worldScale + WORLD_CACHE_MARGIN_PX * 2);
      const bufferWidth = Math.max(1, Math.ceil(worldWidth * targetDpr));
      const bufferHeight = Math.max(1, Math.ceil(worldHeight * targetDpr));
      try {
        const buffer = createBufferCanvas(bufferWidth, bufferHeight, options.createCanvas);
        buffer.width = bufferWidth;
        buffer.height = bufferHeight;
        const bufferContext = buffer.getContext('2d', { alpha: true });
        if (!bufferContext) throw new Error('World-cache 2D context is unavailable.');
        bufferContext.setTransform(targetDpr, 0, 0, targetDpr, 0, 0);
        bufferContext.imageSmoothingEnabled = true;
        return {
          buffer,
          context: bufferContext,
          width: worldWidth,
          height: worldHeight,
          bufferWidth,
          bufferHeight,
          scale: worldScale
        };
      } catch (cause) {
        diagnostics.worldBufferAllocationFailureCount++;
        throw recoverableMinimapError('Minimap world-cache allocation failed.', {
          code: 'minimap-world-buffer-allocation-failed',
          phase: 'world-buffer-allocation',
          cause
        });
      }
    }

    function commitWorldBuffer(candidate) {
      staticBuffer = candidate.buffer;
      staticContext = candidate.context;
      staticWorldWidth = candidate.width;
      staticWorldHeight = candidate.height;
      diagnostics.worldCacheWidth = candidate.bufferWidth;
      diagnostics.worldCacheHeight = candidate.bufferHeight;
      diagnostics.worldCacheScalePxPerM = candidate.scale;
      invalidate();
    }

    function recreateWorldBuffer() {
      const candidate = allocateWorldBuffer(width, dpr);
      commitWorldBuffer(candidate);
    }

    /**
     * Render into a private frame surface first. The visible canvas keeps its last complete map until every
     * terrain, road, marker, and label layer has finished, so a resize or transient painter failure cannot
     * expose the cleared dark backing store.
     */
    function allocateFrameBuffer(bufferWidth, bufferHeight, targetDpr) {
      try {
        const buffer = createBufferCanvas(bufferWidth, bufferHeight, options.createCanvas);
        buffer.width = bufferWidth;
        buffer.height = bufferHeight;
        const bufferContext = buffer.getContext('2d', { alpha: true });
        if (!bufferContext) throw new Error('Frame-buffer 2D context is unavailable.');
        bufferContext.setTransform(targetDpr, 0, 0, targetDpr, 0, 0);
        bufferContext.imageSmoothingEnabled = true;
        return { buffer, context: bufferContext };
      } catch (cause) {
        diagnostics.frameBufferAllocationFailureCount++;
        throw recoverableMinimapError('Minimap frame-buffer allocation failed.', {
          code: 'minimap-frame-buffer-allocation-failed',
          phase: 'frame-buffer-allocation',
          cause
        });
      }
    }

    function syncSize() {
      const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
      const mobileFallback = typeof window !== 'undefined' && finite(window.innerWidth, DESKTOP_WIDTH_PX) <= 760;
      const fallbackWidth = mobileFallback ? MOBILE_WIDTH_PX : DESKTOP_WIDTH_PX;
      const fallbackHeight = mobileFallback ? MOBILE_HEIGHT_PX : DESKTOP_HEIGHT_PX;
      const positive = (...values) => values.find((value) => Number.isFinite(value) && value > 0);
      const nextWidth = Math.max(1, Math.round(positive(rect?.width, canvas.clientWidth, options.width,
        fallbackWidth, finite(canvas.width) / Math.max(1, dpr))));
      const nextHeight = Math.max(1, Math.round(positive(rect?.height, canvas.clientHeight, options.height,
        fallbackHeight, finite(canvas.height) / Math.max(1, dpr))));
      const nextDpr = clamp(finite(options.dpr, finite(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 1)), 1, maxDpr);
      const bufferWidth = Math.max(1, Math.round(nextWidth * nextDpr));
      const bufferHeight = Math.max(1, Math.round(nextHeight * nextDpr));
      const changed = nextWidth !== width || nextHeight !== height || Math.abs(nextDpr - dpr) > 1e-6
        || frameBuffer?.width !== bufferWidth || frameBuffer?.height !== bufferHeight;
      if (changed) {
        // Both candidates must exist before any live dimension or context changes; a retry therefore sees the
        // complete prior state instead of mistaking a half-allocated resize for a settled one.
        const nextFrame = allocateFrameBuffer(bufferWidth, bufferHeight, nextDpr);
        const nextWorld = allocateWorldBuffer(nextWidth, nextDpr);
        width = nextWidth;
        height = nextHeight;
        dpr = nextDpr;
        frameBuffer = nextFrame.buffer;
        context = nextFrame.context;
        commitWorldBuffer(nextWorld);
        diagnostics.bufferResizeCount++;
        forceClipAudit = true;
      }
      diagnostics.cssWidth = width;
      diagnostics.cssHeight = height;
      diagnostics.bufferWidth = bufferWidth;
      diagnostics.bufferHeight = bufferHeight;
      diagnostics.effectiveDpr = dpr;
      diagnostics.sizeSyncCount++;
      sizeDirty = false;
      lastSizeSyncSerial = updateSerial;
      return changed;
    }

    /** Publish one complete backing frame without clearing the visible canvas during layer construction. */
    function presentFrame() {
      if (!frameBuffer) {
        throw recoverableMinimapError('Minimap frame buffer is unavailable.', {
          code: 'minimap-frame-buffer-unavailable',
          phase: 'presentation'
        });
      }
      let presentation;
      try {
        presentation = presenter.present(frameBuffer);
      } catch (error) {
        presentation = presenter.getDiagnostics();
        diagnostics.framePresentationFailureCount = presentation.presentationFailureCount;
        throw error;
      }
      diagnostics.framePresentationCount = presentation.presentationCount;
      diagnostics.framePresentationResizeCount = presentation.presentationResizeCount;
      diagnostics.framePresentationSwapCount = presentation.presentationSwapCount;
      diagnostics.framePresentationFailureCount = presentation.presentationFailureCount;
      diagnostics.presentationMode = presentation.mode;
      diagnostics.activePresentationIndex = presentation.activePresentationIndex;
      diagnostics.presentedBufferWidth = presentation.presentedBufferWidth;
      diagnostics.presentedBufferHeight = presentation.presentedBufferHeight;
    }

    function markSizeDirty() {
      if (destroyed) return false;
      sizeDirty = true;
      return true;
    }

    function payloadPlayerFrame(payload) {
      if (payload.playerFrame) return normalizeFrame(payload.playerFrame);
      const cursor = payload.routeCursor;
      const edge = edgeById.get(cursor?.edgeId);
      return edge ? sampleEdgeFrame(edge, finite(cursor.edgeS), finite(cursor.lateral)) : normalizeFrame(null);
    }

    function movementById(id) {
      return getCollectionValue(graph.movements, id)
        || movements.find((movement) => movement.id === id || movement.movementId === id)
        || null;
    }

    function collectEdgeIds(source, destination, depth = 0) {
      if (!source || depth > 4) return;
      if (typeof source === 'string') {
        const movement = movementById(source);
        if (movement) collectEdgeIds(movement, destination, depth + 1);
        else if (edgeById.has(source)) destination.add(source);
        return;
      }
      if (Array.isArray(source)) {
        for (const item of source) collectEdgeIds(item, destination, depth + 1);
        return;
      }
      if (source instanceof Set) {
        for (const item of source) collectEdgeIds(item, destination, depth + 1);
        return;
      }
      if (source instanceof Map) {
        for (const item of source.values()) collectEdgeIds(item, destination, depth + 1);
        return;
      }
      if (typeof source !== 'object') return;
      collectEdgeIds(source.edgeIds, destination, depth + 1);
      collectEdgeIds(source.edges, destination, depth + 1);
      collectEdgeIds(source.pathPlan, destination, depth + 1);
      collectEdgeIds(source.transition, destination, depth + 1);
      const linkedId = source.movementId || source.transitionId;
      if (linkedId) collectEdgeIds(linkedId, destination, depth + 1);
    }

    function pathSourceSignature(source) {
      return collectionValues(source)
        .map((item) => String(typeof item === 'string' ? item : item?.id || ''))
        .join('\u001f');
    }

    function orderedPathIds(pathPlan, knownSignature = null) {
      const source = pathPlan?.edgeIds || pathPlan?.edges || [];
      const signature = knownSignature ?? pathSourceSignature(source);
      if (pathPlan && typeof pathPlan === 'object') {
        const cached = orderedPathCache.get(pathPlan);
        if (cached?.source === source && cached.signature === signature) return cached.ids;
        if (cached?.source === source && cached.signature !== signature) diagnostics.pathSourceMutationCount++;
      }
      const ids = collectionValues(source)
        .map((item) => typeof item === 'string' ? item : item?.id)
        .filter((id) => edgeById.has(id));
      if (pathPlan && typeof pathPlan === 'object') orderedPathCache.set(pathPlan, { source, signature, ids });
      return ids;
    }

    function classifyEdges(payload) {
      const selectedSource = payload.pathPlan?.edgeIds || payload.pathPlan?.edges || null;
      const selectedSignature = pathSourceSignature(selectedSource);
      const proposed = new Set();
      collectEdgeIds(payload.proposal, proposed);
      const proposalSignature = [...proposed].sort().join('\u001f');
      const fallbackSelectedId = selectedSource ? null : payload.routeCursor?.edgeId || null;
      const entryPort = payload.routeCursor?.entryPort || payload.pathPlan?.entryPort
        || movementById(payload.pathPlan?.movementId)?.entryPort || null;
      if (cachedClassification
        && cachedClassification.selectedSource === selectedSource
        && cachedClassification.selectedSignature === selectedSignature
        && cachedClassification.proposalSource === payload.proposal
        && cachedClassification.proposalSignature === proposalSignature
        && cachedClassification.fallbackSelectedId === fallbackSelectedId
        && cachedClassification.entryPort === entryPort) {
        diagnostics.selectedEdgeCount = cachedClassification.selected.size;
        diagnostics.proposedEdgeCount = cachedClassification.proposed.size;
        diagnostics.availableEdgeCount = cachedClassification.available.size;
        return cachedClassification;
      }
      if (cachedClassification
        && cachedClassification.proposalSource === payload.proposal
        && cachedClassification.proposalSignature !== proposalSignature) {
        diagnostics.proposalSourceMutationCount++;
      }
      const selected = new Set(orderedPathIds(payload.pathPlan, selectedSignature));
      if (!selected.size && payload.routeCursor?.edgeId) selected.add(payload.routeCursor.edgeId);
      const available = new Set();
      for (const movement of movements) {
        if (!entryPort || movement.entryPort === entryPort) collectEdgeIds(movement.edgeIds, available);
      }
      if (!available.size) {
        for (const id of selected) available.add(id);
        for (const id of proposed) available.add(id);
        const frontier = [...available];
        for (let index = 0; index < frontier.length && index < 256; index++) {
          const edge = edgeById.get(frontier[index]);
          for (const successor of collectionValues(edge?.successors)) {
            const id = typeof successor === 'string' ? successor : successor?.id;
            if (id && edgeById.has(id) && !available.has(id)) {
              available.add(id);
              frontier.push(id);
            }
          }
        }
      }
      diagnostics.selectedEdgeCount = selected.size;
      diagnostics.proposedEdgeCount = proposed.size;
      diagnostics.availableEdgeCount = available.size;
      const arrowIds = new Set(available);
      for (const id of selected) arrowIds.add(id);
      for (const id of proposed) arrowIds.add(id);
      cachedClassification = {
        selected,
        selectedIds: [...selected],
        proposed,
        available,
        arrowIds,
        availableKey: [...available].sort().join(','),
        labels: null,
        entryPort,
        selectedSource,
        selectedSignature,
        pathPlan: payload.pathPlan,
        proposalSource: payload.proposal,
        proposalSignature,
        fallbackSelectedId
      };
      return cachedClassification;
    }

    function graphFitScale() {
      const spanX = Math.max(1, graphBounds.maxX - graphBounds.minX);
      const spanZ = Math.max(1, graphBounds.maxZ - graphBounds.minZ);
      return Math.min((width - 22) / spanX, (height - 22) / spanZ);
    }

    /** Snap every visual mode channel to its current target without changing route or projection authority. */
    function snapModeProgress(timestamp) {
      for (const key of MODE_PROGRESS_KEYS) {
        const channel = modeChannels[key];
        channel.value = modeTargets[key];
        channel.from = modeTargets[key];
        channel.target = modeTargets[key];
        channel.startedAt = timestamp;
        modeProgress[key] = modeTargets[key];
      }
      modeTransitionInitialized = true;
    }

    /** Smooth map modes inside the retained renderer unless the live accessibility preference requires a settled frame. */
    function resolveModeProgress(payload, timestamp) {
      modeTargets.overview = clamp(finite(payload.overviewProgress), 0, 1);
      modeTargets.guided = clamp(finite(payload.guidedProgress), 0, 1);
      modeTargets.roadDetail = clamp(finite(payload.roadDetailProgress), 0, 1);
      const reducedMotion = Boolean(isReducedMotionEnabled());
      if (!modeTransitionInitialized || reducedMotion) {
        snapModeProgress(timestamp);
      } else {
        let maximumStep = 0;
        for (const key of MODE_PROGRESS_KEYS) {
          const channel = modeChannels[key];
          const previous = channel.value;
          if (Math.abs(modeTargets[key] - channel.target) > 0.000_001) {
            channel.from = channel.value;
            channel.target = modeTargets[key];
            channel.startedAt = timestamp;
          }
          const elapsed = Math.max(0, timestamp - channel.startedAt);
          const progress = transitionDurationMs > 0
            ? smootherStep01(elapsed / transitionDurationMs)
            : 1;
          channel.value = lerp(channel.from, channel.target, progress);
          if (progress >= 1 || Math.abs(channel.target - channel.value) <= 0.000_1) {
            channel.value = channel.target;
          }
          modeProgress[key] = channel.value;
          maximumStep = Math.max(maximumStep, Math.abs(channel.value - previous));
        }
        diagnostics.modeTransitionMaximumStep = Math.max(
          diagnostics.modeTransitionMaximumStep,
          maximumStep
        );
      }
      diagnostics.overviewTargetProgress = modeTargets.overview;
      diagnostics.guidedTargetProgress = modeTargets.guided;
      diagnostics.roadDetailTargetProgress = modeTargets.roadDetail;
      diagnostics.reducedMotion = reducedMotion;
      diagnostics.modeTransitionDurationMs = reducedMotion ? 0 : transitionDurationMs;
      diagnostics.modeTransitionActive = !reducedMotion && MODE_PROGRESS_KEYS.some((key) => (
        Math.abs(modeChannels[key].value - modeChannels[key].target) > 0.000_1
      ));
      return modeProgress;
    }

    function computeTransform(payload, playerFrame, progressState) {
      const overview = progressState.overview;
      const guided = progressState.guided;
      const roadDetail = progressState.roadDetail;
      const compact = width <= COMPACT_MAX_WIDTH_PX;
      const northLock = clamp(Math.max(overview, guided), 0, 1);
      const requestedLocalLookAhead = compact ? 105 : 155;
      const fit = graphFitScale();
      const baseLocal = Math.max(fit * 1.85, compact ? 0.135 : 0.205);
      // A non-interchange road does not need the kilometre-scale interchange overview. Fit roughly 440m ahead
      // into the available height while preserving one equal X/Z scale, so road width and marker placement
      // stay physically truthful instead of being stretched sideways to fill the wide panel.
      const desktopRoadDetailScale = clamp(
        height * 0.5 / Math.max(1, DESKTOP_ROAD_DETAIL_TARGET_AHEAD_M - requestedLocalLookAhead),
        DESKTOP_ROAD_DETAIL_MIN_SCALE,
        DESKTOP_ROAD_DETAIL_MAX_SCALE
      );
      const detailLocal = compact
        ? Math.max(baseLocal, MOBILE_WORLD_CACHE_SCALE)
        : Math.max(baseLocal, desktopRoadDetailScale);
      const local = lerp(baseLocal, detailLocal, roadDetail);
      const playerViewportMargin = clamp(finite(options.playerArrowSize, PLAYER_ARROW_PX), 10, 12) + 1;
      // Medium-height desktop shells can produce a 163px Canvas. Their scale remains physically fixed, so the
      // heading-up focus—not the player glyph—must move closer until the complete arrow has a real bottom margin.
      const localLookAhead = compact
        ? requestedLocalLookAhead
        : Math.min(
            requestedLocalLookAhead,
            Math.max(0, (height * 0.5 - playerViewportMargin) / Math.max(local, 0.000_001))
          );
      // The next nice-number step after 200m is 500m. This scale floor keeps every desktop tactical shell on the
      // 200m-or-finer side of that discontinuity without altering the compact map's authored scale.
      const desktopTacticalScaleBarFloor = compact
        ? 0
        : DESKTOP_SCALE_BAR_TARGET_PX / (TACTICAL_SCALE_BAR_MAX_METERS * 2.5) + 0.000_001;
      const navigationDistance = Number(payload.navigation?.distanceM);
      const overviewLookAhead = Number.isFinite(navigationDistance)
        ? clamp(navigationDistance * 0.5, compact ? 220 : 240, compact ? 420 : 600)
        : compact ? 360 : 450;
      const guidedLookAhead = Number.isFinite(navigationDistance)
        ? clamp(navigationDistance * 0.5, 180, compact ? 360 : 450)
        : compact ? 260 : 320;
      const overviewFocusAhead = lerp(localLookAhead, overviewLookAhead, overview);
      const focusAhead = lerp(overviewFocusAhead, guidedLookAhead, guided);
      let centerX = playerFrame.x + playerFrame.tangentX * focusAhead;
      let centerZ = playerFrame.z + playerFrame.tangentZ * focusAhead;
      // Sample the real selected path so a curved ramp stays centered without letting distant graph bounds set scale.
      if (payload.routeCursor && payload.pathPlan && typeof track.samplePathFrame === 'function') {
        const focusFrame = track.samplePathFrame(
          payload.routeCursor,
          focusAhead,
          payload.pathPlan,
          finite(payload.routeCursor.lateral),
          focusFrameScratch
        );
        if (Number.isFinite(focusFrame?.x) && Number.isFinite(focusFrame?.z)) {
          centerX = focusFrame.x;
          centerZ = focusFrame.z;
        }
      }
      const overviewTargetScale = Math.max(
        fit,
        height / (compact ? COMPACT_OVERVIEW_VISIBLE_SPAN_M : DESKTOP_OVERVIEW_VISIBLE_SPAN_M),
        desktopTacticalScaleBarFloor
      );
      const guidedTargetScale = Math.max(
        fit,
        height / (compact ? COMPACT_GUIDED_VISIBLE_SPAN_M : DESKTOP_GUIDED_VISIBLE_SPAN_M),
        desktopTacticalScaleBarFloor
      );
      const overviewScale = lerp(local, overviewTargetScale, overview);
      const guidedScale = Math.max(guidedTargetScale, baseLocal * 0.84);
      const scale = lerp(overviewScale, guidedScale, guided);
      const headingAngle = Math.atan2(playerFrame.tangentZ, playerFrame.tangentX);
      const headingUpRotation = normalizeAngle(-Math.PI * 0.5 - headingAngle);
      const rotation = headingUpRotation * (1 - northLock);
      diagnostics.northUp = northLock >= 0.999;
      diagnostics.overviewProgress = overview;
      diagnostics.guidedProgress = guided;
      diagnostics.roadDetailProgress = roadDetail;
      diagnostics.roadDetailScale = local;
      diagnostics.roadDetailVisibleAheadM = local > 0 ? height * 0.5 / local + localLookAhead : 0;
      const desktopRoadDetailEmphasis = compact ? 0 : roadDetail;
      diagnostics.roadDetailObstacleMarkerWidthPx = lerp(compact ? 4.6 : 6, 9.2, desktopRoadDetailEmphasis);
      diagnostics.roadDetailObstacleMarkerHeightPx = lerp(compact ? 2.3 : 2.9, 4.6, desktopRoadDetailEmphasis);
      diagnostics.roadDetailPickupMarkerDiameterPx = lerp(compact ? 3.6 : 4.6, 7.2, desktopRoadDetailEmphasis);
      diagnostics.mapScalePxPerM = scale;
      diagnostics.visibleWorldWidthM = scale > 0 ? width / scale : 0;
      diagnostics.visibleWorldHeightM = scale > 0 ? height / scale : 0;
      diagnostics.focusAheadM = focusAhead;
      diagnostics.mapMode = guided > 0.5 ? 'guided' : overview > 0.5 ? 'overview' : roadDetail > 0.5 ? 'road-detail' : 'local';
      return {
        centerX,
        centerZ,
        scale,
        rotation,
        cos: Math.cos(rotation),
        sin: Math.sin(rotation),
        bearingDeg: (headingAngle * 180 / Math.PI + 450) % 360,
        northLock,
        roadDetail,
        detailEdgeId: payload.routeCursor?.edgeId || null
      };
    }

    function projectPoint(point, transform) {
      const dx = point.x - transform.centerX;
      const dz = point.z - transform.centerZ;
      const viewportWidth = finite(transform.viewportWidth, width);
      const viewportHeight = finite(transform.viewportHeight, height);
      return {
        x: viewportWidth * 0.5 + (dx * transform.cos - dz * transform.sin) * transform.scale,
        y: viewportHeight * 0.5 + (dx * transform.sin + dz * transform.cos) * transform.scale
      };
    }

    function projectPointInto(point, transform, out) {
      const dx = point.x - transform.centerX;
      const dz = point.z - transform.centerZ;
      const viewportWidth = finite(transform.viewportWidth, width);
      const viewportHeight = finite(transform.viewportHeight, height);
      out.x = viewportWidth * 0.5 + (dx * transform.cos - dz * transform.sin) * transform.scale;
      out.y = viewportHeight * 0.5 + (dx * transform.sin + dz * transform.cos) * transform.scale;
      return out;
    }

    function projectTangent(point, transform) {
      const x = point.tangentX * transform.cos - point.tangentZ * transform.sin;
      const y = point.tangentX * transform.sin + point.tangentZ * transform.cos;
      return { x, y, angle: Math.atan2(y, x) };
    }

    function isInside(point, margin = 0) {
      return point.x >= margin && point.x <= width - margin && point.y >= margin && point.y <= height - margin;
    }

    function recordClipDiagnostics(transform) {
      let before = 0;
      let after = 0;
      let trimmedEdges = 0;
      let chordErrorMaxPx = 0;
      for (const record of edgeRecords.values()) {
        let inside = 0;
        chordErrorMaxPx = Math.max(chordErrorMaxPx, record.chordErrorM * transform.scale);
        for (const point of record.points) {
          before++;
          if (isInside(projectPoint(point, transform))) {
            inside++;
            after++;
          }
        }
        if (inside > 0 && inside < record.points.length) trimmedEdges++;
      }
      diagnostics.clipBeforeCount = before;
      diagnostics.clipAfterCount = after;
      diagnostics.preClipSampleCount = before;
      diagnostics.postClipSampleCount = after;
      diagnostics.networkClippedSamples = before - after;
      diagnostics.trimmedEdgeCount = trimmedEdges;
      diagnostics.chordErrorMaxPx = chordErrorMaxPx;
      diagnostics.maxChordErrorPx = diagnostics.chordErrorMaxPx;
      diagnostics.clipAuditCount++;
      lastClipAuditSerial = updateSerial;
      lastClipAuditMode = diagnostics.mapMode;
      forceClipAudit = false;
    }

    /** Full sample clipping is a diagnostic audit, not part of the live rendering contract. */
    function auditClipDiagnostics(payload, transform) {
      const interval = Math.max(1, Math.round(finite(options.clipAuditIntervalFrames, CLIP_AUDIT_INTERVAL_FRAMES)));
      const due = payload.auditDiagnostics === true
        || forceClipAudit
        || lastClipAuditMode !== diagnostics.mapMode
        || updateSerial - lastClipAuditSerial >= interval;
      if (due) recordClipDiagnostics(transform);
      else diagnostics.clipAuditSkipCount++;
    }

    function traceRecord(targetContext, record, transform, startS = 0, endS = record.edge.length) {
      const points = record.points;
      let started = false;
      for (const point of points) {
        if (point.edgeS + 1e-6 < startS || point.edgeS - 1e-6 > endS) continue;
        const projected = projectPoint(point, transform);
        if (!started) {
          targetContext.moveTo(projected.x, projected.y);
          started = true;
        } else {
          targetContext.lineTo(projected.x, projected.y);
        }
      }
      if (!started) {
        const frame = sampleEdgeFrame(record.edge, clamp((startS + endS) * 0.5, 0, record.edge.length));
        const projected = projectPoint(frame, transform);
        targetContext.moveTo(projected.x, projected.y);
        targetContext.lineTo(projected.x + 0.01, projected.y + 0.01);
      }
    }

    function traceRecordLateral(targetContext, record, transform, lateralRatio) {
      let started = false;
      for (const point of record.points) {
        const roadHalf = finite(record.edge.roadHalf, finite(record.edge.halfWidth, 8.4));
        const frame = sampleEdgeFrame(record.edge, point.edgeS, roadHalf * lateralRatio);
        const projected = projectPoint(frame, transform);
        if (!started) {
          targetContext.moveTo(projected.x, projected.y);
          started = true;
        } else {
          targetContext.lineTo(projected.x, projected.y);
        }
      }
    }

    function strokeRecord(targetContext, record, transform, color, lineWidth, dash = []) {
      targetContext.beginPath();
      traceRecord(targetContext, record, transform);
      targetContext.strokeStyle = color;
      targetContext.lineWidth = lineWidth;
      targetContext.setLineDash(dash);
      targetContext.stroke();
    }

    function strokeRecordSegment(targetContext, record, transform, centerS, span, color, lineWidth, dash = []) {
      const startS = clamp(centerS - span * 0.5, 0, record.edge.length);
      const endS = clamp(centerS + span * 0.5, 0, record.edge.length);
      targetContext.beginPath();
      traceRecord(targetContext, record, transform, startS, endS);
      targetContext.strokeStyle = color;
      targetContext.lineWidth = lineWidth;
      targetContext.setLineDash(dash);
      targetContext.stroke();
    }

    function niceScaleDistance(scale, targetPixels) {
      const rawMeters = targetPixels / Math.max(1e-6, scale);
      const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rawMeters)));
      const normalized = rawMeters / magnitude;
      const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
      return step * magnitude;
    }

    function drawMapBackground(targetContext) {
      targetContext.fillStyle = colors.background;
      targetContext.fillRect(0, 0, width, height);
      const compact = width <= COMPACT_MAX_WIDTH_PX;
      const gridSpacing = compact ? 24 : 32;
      targetContext.setLineDash([]);
      let gridIndex = 0;
      for (let x = gridSpacing * 0.5; x < width; x += gridSpacing, gridIndex++) {
        targetContext.beginPath();
        targetContext.moveTo(x, 0);
        targetContext.lineTo(x, height);
        targetContext.strokeStyle = gridIndex % 4 === 0
          ? 'rgba(159, 228, 220, 0.13)'
          : colors.grid;
        targetContext.lineWidth = gridIndex % 4 === 0 ? 0.8 : 0.45;
        targetContext.stroke();
      }
      gridIndex = 0;
      for (let y = gridSpacing * 0.5; y < height; y += gridSpacing, gridIndex++) {
        targetContext.beginPath();
        targetContext.moveTo(0, y);
        targetContext.lineTo(width, y);
        targetContext.strokeStyle = gridIndex % 4 === 0
          ? 'rgba(159, 228, 220, 0.13)'
          : colors.grid;
        targetContext.lineWidth = gridIndex % 4 === 0 ? 0.8 : 0.45;
        targetContext.stroke();
      }
    }

    /** Draw the exact 96m cells currently instantiated by the 3D terrain system. */
    function drawSceneTerrain(targetContext, world, transform) {
      diagnostics.sceneTerrainInputCount = 0;
      diagnostics.sceneTerrainDrawCount = 0;
      diagnostics.sceneTerrainEcotoneCount = 0;
      diagnostics.sceneTerrainZoneMask = 0;
      let snapshotHash = 0x811c_9dc5;
      const cells = collectionValues(world?.terrainCells);
      diagnostics.sceneTerrainRevision = finite(world?.terrainRevision);
      for (const cell of cells) {
        if (!cell || cell.visible === false) continue;
        diagnostics.sceneTerrainInputCount++;
        const sizeM = finite(cell.sizeM);
        snapshotHash = snapshotHashText(snapshotHash, cell.id);
        snapshotHash = snapshotHashNumber(snapshotHash, cell.x);
        snapshotHash = snapshotHashNumber(snapshotHash, cell.z);
        snapshotHash = snapshotHashNumber(snapshotHash, sizeM);
        snapshotHash = snapshotHashNumber(snapshotHash, cell.zoneIndex, 1);
        snapshotHash = snapshotHashNumber(snapshotHash, Number.isInteger(cell.nextZoneIndex) ? cell.nextZoneIndex : -1, 1);
        if (!Number.isFinite(cell.x) || !Number.isFinite(cell.z) || !(sizeM > 0)) {
          diagnostics.sceneRejectedCoordinateCount++;
          continue;
        }
        diagnostics.sceneTerrainZoneMask |= 1 << clamp(Math.trunc(cell.zoneIndex), 0, 30);
        const half = sizeM * 0.5;
        const corners = sceneCornerScratch;
        corners[0].x = cell.x - half; corners[0].z = cell.z - half;
        corners[1].x = cell.x + half; corners[1].z = cell.z - half;
        corners[2].x = cell.x + half; corners[2].z = cell.z + half;
        corners[3].x = cell.x - half; corners[3].z = cell.z + half;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < corners.length; index++) {
          const projected = projectPointInto(corners[index], transform, sceneProjectedCornerScratch[index]);
          minX = Math.min(minX, projected.x);
          maxX = Math.max(maxX, projected.x);
          minY = Math.min(minY, projected.y);
          maxY = Math.max(maxY, projected.y);
        }
        if (maxX < 0 || minX > width || maxY < 0 || minY > height) continue;
        targetContext.beginPath();
        targetContext.moveTo(sceneProjectedCornerScratch[0].x, sceneProjectedCornerScratch[0].y);
        for (let index = 1; index < sceneProjectedCornerScratch.length; index++) {
          targetContext.lineTo(sceneProjectedCornerScratch[index].x, sceneProjectedCornerScratch[index].y);
        }
        targetContext.closePath();
        targetContext.fillStyle = terrainCellColor(cell.zoneIndex, cell.brightness);
        targetContext.fill();
        if (Number.isInteger(cell.nextZoneIndex)) {
          diagnostics.sceneTerrainEcotoneCount++;
          const diagonal = Math.abs(Math.trunc(cell.rotationQuarter || 0)) % 2;
          const indices = diagonal ? [0, 1, 3] : [0, 2, 3];
          targetContext.beginPath();
          targetContext.moveTo(
            sceneProjectedCornerScratch[indices[0]].x,
            sceneProjectedCornerScratch[indices[0]].y
          );
          targetContext.lineTo(
            sceneProjectedCornerScratch[indices[1]].x,
            sceneProjectedCornerScratch[indices[1]].y
          );
          targetContext.lineTo(
            sceneProjectedCornerScratch[indices[2]].x,
            sceneProjectedCornerScratch[indices[2]].y
          );
          targetContext.closePath();
          targetContext.fillStyle = terrainCellColor(cell.nextZoneIndex, cell.brightness);
          targetContext.fill();
        }
        diagnostics.sceneTerrainDrawCount++;
      }
      diagnostics.sceneTerrainSnapshotHash = snapshotHash >>> 0;
    }

    function sceneMarkerAngle(entity, transform) {
      const heading = finite(entity.heading);
      const tangentX = -Math.sin(heading);
      const tangentZ = -Math.cos(heading);
      return Math.atan2(
        tangentX * transform.sin + tangentZ * transform.cos,
        tangentX * transform.cos - tangentZ * transform.sin
      );
    }

    /** Render only records published by world.js; their ids, visibility, and absolute coordinates stay authoritative. */
    function drawSceneScenery(targetContext, world, transform) {
      diagnostics.sceneSceneryInputCount = 0;
      diagnostics.sceneSceneryVisibleCount = 0;
      diagnostics.sceneSceneryDrawCount = 0;
      diagnostics.sceneLandmarkDrawCount = 0;
      diagnostics.sceneEnvironmentDrawCount = 0;
      diagnostics.sceneAirTrafficDrawCount = 0;
      diagnostics.sceneDarkDragonDrawCount = 0;
      let snapshotHash = 0x811c_9dc5;
      diagnostics.sceneEntityRevision = finite(world?.sceneryRevision);
      const entities = collectionValues(world?.sceneryEntities);
      diagnostics.sceneSceneryInputCount = entities.length;
      for (const entity of entities) {
        snapshotHash = snapshotHashText(snapshotHash, entity?.id);
        snapshotHash = snapshotHashText(snapshotHash, entity?.category || entity?.kind);
        snapshotHash = snapshotHashNumber(snapshotHash, entity?.visible === true ? 1 : 0, 1);
        if (entity?.visible) {
          snapshotHash = snapshotHashNumber(snapshotHash, entity.x);
          snapshotHash = snapshotHashNumber(snapshotHash, entity.z);
          snapshotHash = snapshotHashNumber(snapshotHash, entity.heading);
        }
        if (!entity?.visible) continue;
        diagnostics.sceneSceneryVisibleCount++;
        if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) {
          diagnostics.sceneRejectedCoordinateCount++;
          continue;
        }
        const point = projectPointInto(entity, transform, entityFrameScratch);
        const size = clamp(finite(entity.radiusM, 4) * transform.scale, 2.4, width <= COMPACT_MAX_WIDTH_PX ? 6 : 9);
        if (point.x < -size || point.x > width + size || point.y < -size || point.y > height + size) continue;
        const category = String(entity.category || entity.kind || 'environment');
        const zoneIndex = clamp(Math.trunc(entity.zoneIndex || 0), 0, terrainPalette.length - 1);
        targetContext.save();
        targetContext.translate(point.x, point.y);
        targetContext.rotate(sceneMarkerAngle(entity, transform));
        targetContext.beginPath();
        if (category === 'dark-dragon') {
          targetContext.moveTo(size, 0);
          targetContext.lineTo(size * 0.18, -size * 0.34);
          targetContext.lineTo(-size * 0.70, -size * 0.62);
          targetContext.lineTo(-size * 0.38, 0);
          targetContext.lineTo(-size * 0.70, size * 0.62);
          targetContext.lineTo(size * 0.18, size * 0.34);
          targetContext.closePath();
          targetContext.fillStyle = 'rgba(75, 24, 48, 0.96)';
          diagnostics.sceneDarkDragonDrawCount++;
        } else if (category === 'air-traffic') {
          targetContext.moveTo(size, 0);
          targetContext.lineTo(-size * 0.68, -size * 0.52);
          targetContext.lineTo(-size * 0.24, 0);
          targetContext.lineTo(-size * 0.68, size * 0.52);
          targetContext.closePath();
          targetContext.fillStyle = colors.traffic;
          diagnostics.sceneAirTrafficDrawCount++;
        } else if (category === 'landmark') {
          targetContext.moveTo(size, 0);
          targetContext.lineTo(0, -size);
          targetContext.lineTo(-size, 0);
          targetContext.lineTo(0, size);
          targetContext.closePath();
          targetContext.fillStyle = terrainPalette[zoneIndex];
          diagnostics.sceneLandmarkDrawCount++;
        } else {
          targetContext.arc(0, 0, size * 0.72, 0, Math.PI * 2);
          targetContext.fillStyle = terrainPalette[zoneIndex];
          diagnostics.sceneEnvironmentDrawCount++;
        }
        targetContext.fill();
        targetContext.strokeStyle = category === 'dark-dragon'
          ? 'rgba(220, 102, 116, 0.88)'
          : 'rgba(239, 251, 255, 0.78)';
        targetContext.lineWidth = width <= COMPACT_MAX_WIDTH_PX ? 0.55 : 0.8;
        targetContext.stroke();
        targetContext.restore();
        diagnostics.sceneSceneryDrawCount++;
      }
      diagnostics.sceneScenerySnapshotHash = snapshotHash >>> 0;
    }

    /** Draw one in-map direction cue whenever the page-level compass is not actually visible. */
    function drawCompass(targetContext, transform) {
      const compact = width <= COMPACT_MAX_WIDTH_PX;
      const externalCompassVisible = Boolean(isExternalCompassVisible());
      const drawsInternalCompass = compact || !externalCompassVisible;
      const northAngle = transform.rotation - Math.PI * 0.5;
      diagnostics.compassDrawCount = 0;
      diagnostics.compassPlacement = drawsInternalCompass
        ? compact ? 'compact-map-bottom-right' : 'map-bottom-right-fallback'
        : 'external-desktop';
      diagnostics.compassX = 0;
      diagnostics.compassY = 0;
      diagnostics.compassRadiusPx = 0;
      diagnostics.compassInsetPx = 0;
      diagnostics.compassBearingDeg = transform.bearingDeg;
      diagnostics.compassNorthAngleRad = northAngle;
      if (!drawsInternalCompass) return;
      const compassRadius = compact
        ? COMPACT_COMPASS_RADIUS_PX
        : DESKTOP_FALLBACK_COMPASS_RADIUS_PX;
      const compassInset = compact ? 8 : 12;
      const compassX = width - compassInset - compassRadius;
      const compassY = height - compassInset - compassRadius;
      targetContext.save();
      targetContext.beginPath();
      targetContext.arc(compassX, compassY, compassRadius + 2, 0, Math.PI * 2);
      targetContext.fillStyle = 'rgba(2, 7, 12, 0.54)';
      targetContext.fill();
      targetContext.beginPath();
      targetContext.arc(compassX, compassY, compassRadius, 0, Math.PI * 2);
      targetContext.fillStyle = 'rgba(4, 12, 18, 0.90)';
      targetContext.fill();
      targetContext.strokeStyle = 'rgba(195, 224, 232, 0.64)';
      targetContext.lineWidth = compact ? 0.8 : 1.15;
      targetContext.stroke();

      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8;
        const cardinal = index % 4 === 0;
        const innerRadius = compassRadius * (cardinal ? 0.66 : 0.78);
        const outerRadius = compassRadius * 0.91;
        targetContext.beginPath();
        targetContext.moveTo(
          compassX + Math.cos(angle) * innerRadius,
          compassY + Math.sin(angle) * innerRadius
        );
        targetContext.lineTo(
          compassX + Math.cos(angle) * outerRadius,
          compassY + Math.sin(angle) * outerRadius
        );
        targetContext.strokeStyle = cardinal
          ? 'rgba(239, 251, 255, 0.70)'
          : 'rgba(195, 224, 232, 0.34)';
        targetContext.lineWidth = cardinal ? (compact ? 0.8 : 1.15) : 0.55;
        targetContext.stroke();
      }

      const northCos = Math.cos(northAngle);
      const northSin = Math.sin(northAngle);
      const perpendicularX = -northSin;
      const perpendicularY = northCos;
      targetContext.beginPath();
      targetContext.moveTo(compassX, compassY);
      targetContext.lineTo(
        compassX - northCos * compassRadius * 0.58,
        compassY - northSin * compassRadius * 0.58
      );
      targetContext.strokeStyle = 'rgba(126, 233, 255, 0.82)';
      targetContext.lineWidth = compact ? 1.2 : 1.65;
      targetContext.stroke();

      const northTipX = compassX + northCos * compassRadius * 0.72;
      const northTipY = compassY + northSin * compassRadius * 0.72;
      const northBaseX = compassX + northCos * compassRadius * 0.04;
      const northBaseY = compassY + northSin * compassRadius * 0.04;
      targetContext.beginPath();
      targetContext.moveTo(northTipX, northTipY);
      targetContext.lineTo(
        northBaseX + perpendicularX * compassRadius * 0.17,
        northBaseY + perpendicularY * compassRadius * 0.17
      );
      targetContext.lineTo(
        northBaseX - perpendicularX * compassRadius * 0.17,
        northBaseY - perpendicularY * compassRadius * 0.17
      );
      targetContext.closePath();
      targetContext.fillStyle = colors.playerCore;
      targetContext.fill();
      targetContext.strokeStyle = 'rgba(255, 246, 206, 0.92)';
      targetContext.lineWidth = 0.65;
      targetContext.stroke();

      targetContext.beginPath();
      targetContext.arc(compassX, compassY, compact ? 1.5 : 2, 0, Math.PI * 2);
      targetContext.fillStyle = '#f7fbff';
      targetContext.fill();
      targetContext.textAlign = 'center';
      targetContext.textBaseline = 'middle';
      targetContext.font = `800 ${compact ? 6 : 7}px ui-sans-serif, system-ui, sans-serif`;
      targetContext.fillStyle = '#fff2c1';
      targetContext.fillText(
        uiText('direction.n.compact', {}, '北'),
        compassX + northCos * compassRadius * 0.46,
        compassY + northSin * compassRadius * 0.46
      );
      targetContext.font = `700 ${compact ? 5.5 : 7}px ui-monospace, SFMono-Regular, monospace`;
      targetContext.fillStyle = 'rgba(239, 251, 255, 0.90)';
      targetContext.fillText(
        `${String(Math.round(transform.bearingDeg) % 360).padStart(3, '0')}°`,
        compassX,
        compassY + compassRadius * 0.40
      );
      targetContext.restore();
      diagnostics.compassDrawCount = 1;
      diagnostics.compassX = compassX;
      diagnostics.compassY = compassY;
      diagnostics.compassRadiusPx = compassRadius;
      diagnostics.compassInsetPx = compassInset;
    }

    /** Keep the physical scale anchored at bottom-left while the compass owns the opposite corner. */
    function drawScaleBar(targetContext, transform) {
      const compact = width <= COMPACT_MAX_WIDTH_PX;
      const targetPixels = compact ? 30 : DESKTOP_SCALE_BAR_TARGET_PX;
      const scaleMeters = niceScaleDistance(transform.scale, targetPixels);
      const scalePixels = scaleMeters * transform.scale;
      const scaleX = 8;
      const scaleY = height - (compact ? 7 : 10);
      targetContext.beginPath();
      targetContext.moveTo(scaleX, scaleY - 3);
      targetContext.lineTo(scaleX, scaleY);
      targetContext.lineTo(scaleX + scalePixels, scaleY);
      targetContext.lineTo(scaleX + scalePixels, scaleY - 3);
      targetContext.strokeStyle = 'rgba(239, 251, 255, 0.78)';
      targetContext.lineWidth = compact ? 0.8 : 1.1;
      targetContext.stroke();
      targetContext.font = `${compact ? 7 : 9}px ui-sans-serif, system-ui, sans-serif`;
      targetContext.textAlign = 'left';
      targetContext.fillStyle = 'rgba(239, 251, 255, 0.78)';
      const scaleLabel = scaleMeters >= 1_000
        ? uiText('common.kilometers', { value: uiNumber(scaleMeters / 1_000) }, `${scaleMeters / 1_000} km`)
        : uiText('common.meters', { value: uiNumber(scaleMeters) }, `${scaleMeters} 米`);
      targetContext.fillText(scaleLabel, scaleX, scaleY - (compact ? 7 : 9));
      diagnostics.scaleBarMeters = scaleMeters;
    }

    /** Non-interchange lane detail is visual guidance; authoritative graph edges and equal-scale projection stay unchanged. */
    function drawRoadDetailBase(targetContext, transform) {
      diagnostics.roadDetailRoadBandCount = 0;
      diagnostics.roadDetailRoadWidthPx = 0;
      if (transform.roadDetail <= 0.001) return;
      const record = edgeRecords.get(transform.detailEdgeId);
      if (!record) return;
      const roadHalf = finite(record.edge.roadHalf, finite(record.edge.halfWidth, 8.4));
      const roadWidthPx = Math.max(4, roadHalf * 2 * transform.scale);
      targetContext.save();
      targetContext.globalAlpha = transform.roadDetail;
      strokeRecord(targetContext, record, transform, 'rgba(14, 25, 33, 0.98)', roadWidthPx);
      for (const side of [-1, 1]) {
        targetContext.beginPath();
        traceRecordLateral(targetContext, record, transform, side);
        targetContext.strokeStyle = 'rgba(231, 241, 238, 0.82)';
        targetContext.lineWidth = width <= COMPACT_MAX_WIDTH_PX ? 0.7 : 1.15;
        targetContext.setLineDash([]);
        targetContext.stroke();
      }
      targetContext.beginPath();
      traceRecord(targetContext, record, transform);
      targetContext.strokeStyle = 'rgba(217, 200, 139, 0.64)';
      targetContext.lineWidth = width <= COMPACT_MAX_WIDTH_PX ? 0.65 : 1;
      targetContext.setLineDash(width <= COMPACT_MAX_WIDTH_PX ? [3, 4] : [6, 7]);
      targetContext.stroke();
      targetContext.setLineDash([]);
      targetContext.restore();
      diagnostics.roadDetailRoadBandCount = 1;
      diagnostics.roadDetailRoadWidthPx = roadWidthPx;
    }

    function crossingInfo(crossing) {
      const upper = edgeRecords.get(crossing.upperEdgeId);
      const lower = edgeRecords.get(crossing.lowerEdgeId);
      if (!upper || !lower) return null;
      return {
        upper,
        lower,
        upperS: crossingStation(crossing, 'upper', upper),
        lowerS: crossingStation(crossing, 'lower', lower),
        span: Math.max(12, finite(crossing.maskSpan, 42))
      };
    }

    /** Rasterize topology in world coordinates; the live center and heading are applied only while copying it. */
    function buildStaticCache(requestedTransform, classification, key) {
      const minimumWorldScale = width <= COMPACT_MAX_WIDTH_PX
        ? MOBILE_WORLD_CACHE_SCALE
        : DESKTOP_WORLD_CACHE_MIN_SCALE;
      const defaultWorldScale = width <= COMPACT_MAX_WIDTH_PX ? MOBILE_WORLD_CACHE_SCALE : WORLD_CACHE_SCALE;
      const worldScale = Math.max(minimumWorldScale, finite(options.worldCacheScale, defaultWorldScale));
      const transform = {
        centerX: (graphBounds.minX + graphBounds.maxX) * 0.5,
        centerZ: (graphBounds.minZ + graphBounds.maxZ) * 0.5,
        scale: worldScale,
        rotation: 0,
        cos: 1,
        sin: 0,
        viewportWidth: staticWorldWidth,
        viewportHeight: staticWorldHeight
      };
      const lineScale = worldScale / Math.max(0.01, requestedTransform.scale);
      const scaledLine = (pixels) => pixels * lineScale;
      const scaledDash = (dash) => dash.map((pixels) => pixels * lineScale);
      staticContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      staticContext.clearRect(0, 0, staticWorldWidth, staticWorldHeight);
      staticContext.lineCap = 'round';
      staticContext.lineJoin = 'round';

      // Layer 1: every route outside the current entry's movement set is deliberately subdued.
      for (const record of edgeRecords.values()) {
        if (!classification.available.has(record.id)) {
          strokeRecord(staticContext, record, transform, colors.unreachable, scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 2.7 : 3.6));
        }
      }
      // Layer 2: all movements that are still physically reachable remain visible below selection state.
      for (const id of classification.available) {
        const record = edgeRecords.get(id);
        if (record) strokeRecord(staticContext, record, transform, colors.available, scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 2.4 : 3.2));
      }
      // Layer 3: a fine ground-level center stroke preserves lane continuity without erasing reachability color.
      for (const record of edgeRecords.values()) {
        if (edgeLayer(record.edge) <= 0) {
          strokeRecord(staticContext, record, transform, colors.ground, scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 0.75 : 1.05));
        }
      }
      // Covered routes use a dark bore plus a dashed centre line; this is topology data, not a decorative black road.
      for (const record of edgeRecords.values()) {
        for (const profile of record.edge.tunnelProfiles || []) {
          const startS = finite(profile.surfaceStartS);
          const endS = finite(profile.surfaceEndS);
          if (!(endS > startS)) continue;
          const centerS = (startS + endS) * 0.5;
          const span = endS - startS;
          strokeRecordSegment(
            staticContext,
            record,
            transform,
            centerS,
            span,
            colors.mask,
            scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 3.8 : 5.2)
          );
          strokeRecordSegment(
            staticContext,
            record,
            transform,
            centerS,
            span,
            profile.kind === 'underground-tunnel' ? colors.lower : colors.upper,
            scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 1.25 : 1.8),
            scaledDash(profile.kind === 'underground-tunnel' ? [3, 3] : [7, 2])
          );
        }
      }
      // Layers 4-6: lower deck dashes, an explicit occlusion mask, then the upper bridge deck.
      for (const crossing of crossings) {
        const info = crossingInfo(crossing);
        if (!info) continue;
        strokeRecordSegment(staticContext, info.lower, transform, info.lowerS, info.span * 1.25,
          colors.lower, scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 1.6 : 2.1), scaledDash([3, 3]));
      }
      for (const crossing of crossings) {
        const info = crossingInfo(crossing);
        if (!info) continue;
        strokeRecordSegment(staticContext, info.upper, transform, info.upperS, info.span,
          colors.mask, scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 6.2 : 8.2));
      }
      for (const crossing of crossings) {
        const info = crossingInfo(crossing);
        if (!info) continue;
        strokeRecordSegment(staticContext, info.upper, transform, info.upperS, info.span,
          colors.upper, scaledLine(width <= COMPACT_MAX_WIDTH_PX ? 3.1 : 4.1));
      }
      staticContext.setLineDash([]);
      staticCacheKey = key;
      staticTransform = transform;
      diagnostics.staticCacheBuildCount++;
    }

    function transformKey(classification) {
      return [
        diagnostics.graphVersion || '',
        dpr.toFixed(2),
        width <= COMPACT_MAX_WIDTH_PX ? 'mobile' : 'desktop',
        diagnostics.mapMode,
        classification.availableKey
      ].join('|');
    }

    function ensureStaticCache(transform, classification) {
      const key = transformKey(classification);
      if (key === staticCacheKey && staticTransform) {
        diagnostics.staticCacheHitCount++;
        if (Math.abs(transform.centerX - staticTransform.centerX) > 0.01
          || Math.abs(transform.centerZ - staticTransform.centerZ) > 0.01) diagnostics.staticCachePanHitCount++;
        return;
      }
      try {
        buildStaticCache(transform, classification, key);
      } catch (cause) {
        diagnostics.worldCacheRenderFailureCount++;
        // A painter can leave the retained cache context transformed or partially drawn. Replace that private
        // surface before retrying so a later successful frame cannot inherit any failed drawing state.
        commitWorldBuffer(allocateWorldBuffer(width, dpr));
        throw recoverableMinimapError('Minimap world-cache rendering failed.', {
          code: 'minimap-world-cache-render-failed',
          phase: 'world-cache-render',
          cause
        });
      }
    }

    function drawStaticCache(transform) {
      if (!staticBuffer || !staticTransform) return;
      const scaleRatio = transform.scale / staticTransform.scale;
      if (!(scaleRatio > 0)) return;
      const centerDx = transform.centerX - staticTransform.centerX;
      const centerDz = transform.centerZ - staticTransform.centerZ;
      const cacheCenterX = staticWorldWidth * 0.5
        + (centerDx * staticTransform.cos - centerDz * staticTransform.sin) * staticTransform.scale;
      const cacheCenterY = staticWorldHeight * 0.5
        + (centerDx * staticTransform.sin + centerDz * staticTransform.cos) * staticTransform.scale;
      const absoluteCos = Math.abs(transform.cos);
      const absoluteSin = Math.abs(transform.sin);
      // Copy only the inverse-rotated viewport plus an antialias guard. The world raster remains complete
      // and equal-scale; this removes the per-frame upload of off-screen topology without reducing detail.
      const guard = 8 / scaleRatio;
      const halfSourceWidth = (absoluteCos * width + absoluteSin * height) * 0.5 / scaleRatio + guard;
      const halfSourceHeight = (absoluteSin * width + absoluteCos * height) * 0.5 / scaleRatio + guard;
      const sourceLeftPx = Math.max(0, Math.floor((cacheCenterX - halfSourceWidth) * dpr));
      const sourceTopPx = Math.max(0, Math.floor((cacheCenterY - halfSourceHeight) * dpr));
      const sourceRightPx = Math.min(staticBuffer.width, Math.ceil((cacheCenterX + halfSourceWidth) * dpr));
      const sourceBottomPx = Math.min(staticBuffer.height, Math.ceil((cacheCenterY + halfSourceHeight) * dpr));
      const sourceWidthPx = Math.max(0, sourceRightPx - sourceLeftPx);
      const sourceHeightPx = Math.max(0, sourceBottomPx - sourceTopPx);
      diagnostics.worldCacheSourceWidth = sourceWidthPx;
      diagnostics.worldCacheSourceHeight = sourceHeightPx;
      if (sourceWidthPx === 0 || sourceHeightPx === 0) return;
      const destinationX = sourceLeftPx / dpr;
      const destinationY = sourceTopPx / dpr;
      const destinationWidth = sourceWidthPx / dpr;
      const destinationHeight = sourceHeightPx / dpr;
      context.save();
      context.translate(width * 0.5, height * 0.5);
      context.rotate(transform.rotation);
      context.scale(scaleRatio, scaleRatio);
      context.translate(-cacheCenterX, -cacheCenterY);
      context.drawImage(staticBuffer, sourceLeftPx, sourceTopPx, sourceWidthPx, sourceHeightPx,
        destinationX, destinationY, destinationWidth, destinationHeight);
      context.restore();
    }

    /** Project a route once per frame into retained storage so outer/inner strokes share identical pixels. */
    function projectRecordSet(ids, transform, projection) {
      let requiredComponents = 0;
      for (const id of ids) {
        const record = edgeRecords.get(id);
        if (record) requiredComponents += (record.points.length + 1) * 2;
      }
      if (projection.coordinates.length < requiredComponents) {
        let capacity = Math.max(256, projection.coordinates.length || 256);
        while (capacity < requiredComponents) capacity *= 2;
        projection.coordinates = new Float32Array(capacity);
      }
      const coordinates = projection.coordinates;
      let cursor = 0;
      for (const id of ids) {
        const record = edgeRecords.get(id);
        if (!record) continue;
        coordinates[cursor++] = Number.NaN;
        coordinates[cursor++] = Number.NaN;
        for (const point of record.points) {
          const dx = point.x - transform.centerX;
          const dz = point.z - transform.centerZ;
          coordinates[cursor++] = width * 0.5
            + (dx * transform.cos - dz * transform.sin) * transform.scale;
          coordinates[cursor++] = height * 0.5
            + (dx * transform.sin + dz * transform.cos) * transform.scale;
        }
      }
      projection.count = cursor;
      return projection;
    }

    function traceProjectedRecordSet(targetContext, projection) {
      const coordinates = projection.coordinates;
      let startsRecord = true;
      for (let component = 0; component < projection.count; component += 2) {
        const x = coordinates[component];
        const y = coordinates[component + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          startsRecord = true;
        } else if (startsRecord) {
          targetContext.moveTo(x, y);
          startsRecord = false;
        } else {
          targetContext.lineTo(x, y);
        }
      }
    }

    function strokeProjectedRecordSet(projection, color, lineWidth, dash = []) {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash(dash);
      context.beginPath();
      traceProjectedRecordSet(context, projection);
      context.stroke();
      context.setLineDash([]);
    }

    function drawRecordSet(ids, transform, color, lineWidth, dash = [], projection = proposedPathProjection) {
      strokeProjectedRecordSet(projectRecordSet(ids, transform, projection), color, lineWidth, dash);
    }

    function drawSelectedPath(pathIds, transform) {
      if (!pathIds.length) return;
      const projection = projectRecordSet(pathIds, transform, selectedPathProjection);
      strokeProjectedRecordSet(projection, colors.selectedOuter, width <= COMPACT_MAX_WIDTH_PX ? 3.8 : 5.2);
      strokeProjectedRecordSet(projection, colors.selectedInner, width <= COMPACT_MAX_WIDTH_PX ? 1.8 : 2.5);
    }

    function validateRouteGaps(pathIds, transform) {
      diagnostics.routeGapCount = 0;
      diagnostics.routeGapMaxPx = 0;
      for (let index = 1; index < pathIds.length; index++) {
        const previous = edgeRecords.get(pathIds[index - 1]);
        const next = edgeRecords.get(pathIds[index]);
        if (!previous || !next) continue;
        const a = previous.points[previous.points.length - 1];
        const b = next.points[0];
        const deltaX = (b.x - a.x) * transform.cos - (b.z - a.z) * transform.sin;
        const deltaY = (b.x - a.x) * transform.sin + (b.z - a.z) * transform.cos;
        const gap = Math.hypot(deltaX, deltaY) * transform.scale;
        diagnostics.routeGapMaxPx = Math.max(diagnostics.routeGapMaxPx, gap);
        if (gap > ROUTE_GAP_LIMIT_PX) diagnostics.routeGapCount++;
      }
      diagnostics.maxRouteGapPx = diagnostics.routeGapMaxPx;
    }

    function drawOneWayArrow(record, transform, size, edgeS = record.edge.length * 0.58) {
      const cachedArrow = record.oneWayArrow;
      const usesCachedStation = cachedArrow && Math.abs(edgeS - cachedArrow.edgeS) <= 1e-6;
      const frame = usesCachedStation
        ? cachedArrow.frame
        : sampleEdgeFrame(record.edge, clamp(edgeS, 0, record.edge.length));
      const point = projectPoint(frame, transform);
      if (!isInside(point, size + 1)) return false;
      const tangent = projectTangent(frame, transform);
      const renderedAngle = tangent.angle;
      const before = projectPoint(usesCachedStation
        ? cachedArrow.before
        : sampleEdgeFrame(record.edge, clamp(edgeS - 0.75, 0, record.edge.length)), transform);
      const after = projectPoint(usesCachedStation
        ? cachedArrow.after
        : sampleEdgeFrame(record.edge, clamp(edgeS + 0.75, 0, record.edge.length)), transform);
      const finiteDifferenceAngle = Math.atan2(after.y - before.y, after.x - before.x);
      const error = Math.abs(normalizeAngle(renderedAngle - finiteDifferenceAngle)) * 180 / Math.PI;
      diagnostics.arrowTangentErrorDeg = Math.max(diagnostics.arrowTangentErrorDeg, error);
      context.save();
      context.translate(point.x, point.y);
      context.rotate(renderedAngle);
      context.beginPath();
      context.moveTo(size, 0);
      context.lineTo(-size * 0.7, -size * 0.58);
      context.lineTo(-size * 0.35, 0);
      context.lineTo(-size * 0.7, size * 0.58);
      context.closePath();
      context.fillStyle = colors.label;
      context.fill();
      context.restore();
      return true;
    }

    function labelCandidates(classification) {
      if (classification.labels) return classification.labels;
      const candidates = [];
      for (const movement of movements) {
        const ids = collectionValues(movement.edgeIds).map((item) => typeof item === 'string' ? item : item?.id);
        if (!ids.some((id) => classification.available.has(id))) continue;
        const rampId = ids.find((id) => {
          const family = edgeById.get(id)?.family;
          return family === 'direct-ramp' || family === 'loop-ramp' || family === 'collector';
        }) || ids[Math.max(0, ids.length - 2)] || ids[0];
        const record = edgeRecords.get(rampId);
        if (!record) continue;
        const label = movement.label || movement.exitLabel || `出口 ${cardinalLabel(movement.exitPort)}`;
        candidates.push({
          id: movement.id || `${movement.entryPort}-${movement.kind}`,
          label,
          movementKind: movement.kind || null,
          exitPort: movement.exitPort || null,
          record,
          edgeS: record.edge.length * 0.66,
          frame: sampleEdgeFrame(record.edge, record.edge.length * 0.66),
          priority: ids.some((id) => classification.selected.has(id)) ? 0 : ids.some((id) => classification.proposed.has(id)) ? 1 : 2
        });
      }
      for (const edge of edges) {
        const label = edge.exitLabel || edge.signLabel;
        const record = edgeRecords.get(edge.id);
        if (label && record) candidates.push({
          id: edge.id,
          label,
          record,
          edgeS: edge.length * 0.72,
          frame: sampleEdgeFrame(record.edge, edge.length * 0.72),
          priority: 3
        });
      }
      candidates.sort((a, b) => a.priority - b.priority || String(a.id).localeCompare(String(b.id)));
      classification.labels = candidates;
      return classification.labels;
    }

    function reserveLabelBox(index, x, y, boxWidth, boxHeight) {
      const box = occupiedLabelBoxes[index];
      box.x = x;
      box.y = y;
      box.width = boxWidth;
      box.height = boxHeight;
      return index + 1;
    }

    /** Movement metadata selects a stable message key; arbitrary extension labels use the source bridge. */
    function localizedCandidateLabel(candidate) {
      const key = candidate.movementKind === 'straight'
        ? 'navigation.route.surfaceExit'
        : candidate.movementKind === 'right' || candidate.movementKind === 'direct-right'
          ? 'navigation.route.mountainTunnelExit'
          : candidate.movementKind === 'left' || candidate.movementKind === 'loop-left'
            ? 'navigation.route.undergroundTunnelExit'
            : null;
      if (!key) return uiSource(candidate.label);
      return uiText(key, { direction: cardinalLabel(candidate.exitPort) }, candidate.label);
    }

    /**
     * Keep semantic labels away from persistent instruments. These reservations describe the same canvas-owned
     * cue, scale, legend, and fallback compass drawn later in the frame; they do not invent map coordinates.
     */
    function reserveInstrumentBoxes(transform) {
      const compact = width <= COMPACT_MAX_WIDTH_PX;
      const cueSize = compact ? 24 : 32;
      let count = reserveLabelBox(0, 4, 4, cueSize, cueSize);
      count = reserveLabelBox(count, 4, height - (compact ? 25 : 31), compact ? 58 : 86, compact ? 23 : 29);
      const hasInternalCompass = compact || !Boolean(isExternalCompassVisible());
      if (hasInternalCompass) {
        const radius = compact ? COMPACT_COMPASS_RADIUS_PX : DESKTOP_FALLBACK_COMPASS_RADIUS_PX;
        const inset = compact ? 8 : 12;
        count = reserveLabelBox(
          count,
          width - inset - radius * 2 - 3,
          height - inset - radius * 2 - 3,
          radius * 2 + 6,
          radius * 2 + 6
        );
      }
      return count;
    }

    function fitLabelText(text, maximumWidth) {
      const source = String(text || '');
      if (context.measureText(source).width <= maximumWidth) return source;
      const suffix = '…';
      let fitted = source;
      while (fitted.length > 1 && context.measureText(`${fitted}${suffix}`).width > maximumWidth) {
        fitted = fitted.slice(0, -1);
      }
      diagnostics.labelEllipsisCount++;
      return `${fitted}${suffix}`;
    }

    function drawLabelsAndArrows(classification, transform) {
      diagnostics.labelOverlapCount = 0;
      diagnostics.labelClippedCount = 0;
      diagnostics.labelOverlapRejectedCount = 0;
      diagnostics.labelClipRejectedCount = 0;
      diagnostics.labelEllipsisCount = 0;
      diagnostics.labelDrawCount = 0;
      diagnostics.selectedLabelDrawCount = 0;
      diagnostics.labelRepositionCount = 0;
      diagnostics.arrowTangentErrorDeg = 0;
      const mobile = width <= COMPACT_MAX_WIDTH_PX;
      let occupiedCount = reserveInstrumentBoxes(transform);
      const maximumLabels = mobile ? 1 : 6;
      let drawnLabels = 0;
      context.font = `700 ${mobile ? 8 : 10}px ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const candidate of labelCandidates(classification)) {
        if (drawnLabels >= maximumLabels) break;
        const frame = candidate.frame || sampleEdgeFrame(candidate.record.edge, candidate.edgeS);
        const preferredPoint = projectPoint(frame, transform);
        const label = fitLabelText(localizedCandidateLabel(candidate), mobile ? 72 : 124);
        const measured = typeof context.measureText === 'function'
          ? context.measureText(label).width
          : label.length * (mobile ? 4.5 : 5.5);
        const boxHeight = mobile ? 14 : 16;
        const box = occupiedLabelBoxes[occupiedCount];
        const placementCandidates = [{ x: preferredPoint.x, y: preferredPoint.y, routePoint: preferredPoint }];
        if (candidate.priority === 0) {
          const stations = [
            candidate.record.edge.length * 0.52,
            candidate.record.edge.length * 0.35,
            candidate.record.edge.length * 0.78,
            candidate.record.edge.length * 0.18,
            candidate.record.edge.length * 0.90
          ];
          for (const station of stations) {
            const routePoint = projectPoint(sampleEdgeFrame(candidate.record.edge, station), transform);
            placementCandidates.push(
              { x: routePoint.x, y: routePoint.y - (mobile ? 15 : 19), routePoint },
              { x: routePoint.x, y: routePoint.y + (mobile ? 15 : 19), routePoint }
            );
          }
        }

        let placement = null;
        let sawClippedPlacement = false;
        let sawOverlappingPlacement = false;
        for (const candidatePlacement of placementCandidates) {
          box.x = candidatePlacement.x - measured * 0.5 - 4;
          box.y = candidatePlacement.y - boxHeight * 0.5;
          box.width = measured + 8;
          box.height = boxHeight;
          if (box.x < 2 || box.y < 2 || box.x + box.width > width - 2
            || box.y + box.height > height - 2) {
            sawClippedPlacement = true;
            continue;
          }
          let overlaps = false;
          for (let index = 0; index < occupiedCount; index++) {
            const other = occupiedLabelBoxes[index];
            if (box.x < other.x + other.width + 2
              && box.x + box.width + 2 > other.x && box.y < other.y + other.height + 2
              && box.y + box.height + 2 > other.y) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) {
            sawOverlappingPlacement = true;
            continue;
          }
          placement = candidatePlacement;
          break;
        }

        if (!placement && candidate.priority === 0) {
          // The committed exit is the one semantic label that must survive every formal viewport. Anchor its
          // fallback to a visible point on the real selected edge, then scan only unreserved screen rows.
          const routePoint = placementCandidates
            .map((candidatePlacement) => candidatePlacement.routePoint)
            .find((point) => point.x >= 4 && point.x <= width - 4 && point.y >= 4 && point.y <= height - 4);
          if (routePoint) {
            const fallbackRows = mobile
              ? [height * 0.40, height * 0.56]
              : [height * 0.34, height * 0.48, height * 0.62];
            for (const row of fallbackRows) {
              const fallback = {
                x: clamp(routePoint.x, measured * 0.5 + 6, width - measured * 0.5 - 6),
                y: row,
                routePoint
              };
              box.x = fallback.x - measured * 0.5 - 4;
              box.y = fallback.y - boxHeight * 0.5;
              box.width = measured + 8;
              box.height = boxHeight;
              let overlaps = false;
              for (let index = 0; index < occupiedCount; index++) {
                const other = occupiedLabelBoxes[index];
                if (box.x < other.x + other.width + 2
                  && box.x + box.width + 2 > other.x && box.y < other.y + other.height + 2
                  && box.y + box.height + 2 > other.y) {
                  overlaps = true;
                  break;
                }
              }
              if (!overlaps) {
                placement = fallback;
                break;
              }
            }
          }
        }

        if (!placement) {
          if (sawClippedPlacement) diagnostics.labelClipRejectedCount++;
          if (sawOverlappingPlacement) diagnostics.labelOverlapRejectedCount++;
          continue;
        }
        if (placement !== placementCandidates[0]) {
          diagnostics.labelRepositionCount++;
          if (placement.routePoint && Math.hypot(
            placement.x - placement.routePoint.x,
            placement.y - placement.routePoint.y
          ) > 8) {
            context.beginPath();
            context.moveTo(placement.routePoint.x, placement.routePoint.y);
            context.lineTo(placement.x, placement.y);
            context.strokeStyle = 'rgba(240, 199, 91, 0.44)';
            context.lineWidth = mobile ? 0.6 : 0.8;
            context.stroke();
          }
        }
        roundedRectPath(context, box.x, box.y, box.width, box.height, 4);
        context.fillStyle = colors.labelBackground;
        context.fill();
        context.strokeStyle = candidate.priority <= 1 ? colors.proposed : colors.available;
        context.lineWidth = 0.7;
        context.stroke();
        context.fillStyle = colors.label;
        context.fillText(label, placement.x, placement.y);
        occupiedCount++;
        drawnLabels++;
        diagnostics.labelDrawCount++;
        if (candidate.priority === 0) diagnostics.selectedLabelDrawCount++;
      }

      let arrowCount = 0;
      const arrowLimit = mobile ? 8 : 18;
      for (const id of classification.arrowIds) {
        if (arrowCount >= arrowLimit) break;
        const record = edgeRecords.get(id);
        if (!record || record.family === 'mainline' && !classification.selected.has(id)) continue;
        if (drawOneWayArrow(record, transform, mobile ? 2.7 : 3.5)) arrowCount++;
      }
    }

    function entityFrame(entity, target = entityFrameScratch) {
      const reference = entity?.routeRef || entity?.route || entity;
      const localEdge = edgeById.get(reference?.edgeId);
      const edge = localEdge || track.getEdge?.(reference?.edgeId);
      if (edge && Number.isFinite(reference.edgeS)) {
        if (!localEdge) diagnostics.externalEntityEdgeResolveCount++;
        const sampledFrame = sampleEdgeFrame(
          edge,
          reference.edgeS,
          finite(reference.lateral),
          entitySampleScratch,
          target,
          true
        );
        if (sampledFrame) return sampledFrame;
        diagnostics.rejectedEntityCoordinateCount++;
        return null;
      }
      const candidates = [entity?.frame, entity?.position, entity];
      const source = candidates.find((candidate) => (
        Number.isFinite(candidate?.x) && Number.isFinite(candidate?.z)
      ) || (
        Number.isFinite(candidate?.position?.x) && Number.isFinite(candidate?.position?.z)
      ));
      if (!source) {
        // Render-relative mesh coordinates are deliberately rejected: only a route reference or an explicit
        // absolute-world frame may cross the gameplay-to-map boundary.
        diagnostics.rejectedEntityCoordinateCount++;
        return null;
      }
      const frame = normalizeFrame(source, null, target);
      const heading = Number.isFinite(entity?.heading)
        ? entity.heading
        : Number.isFinite(source?.yaw) ? source.yaw : null;
      const hasExplicitTangent = Number.isFinite(source?.tangentX)
        || Number.isFinite(source?.tangent?.x);
      if (!hasExplicitTangent && heading !== null) {
        // Cloverleaf visuals expose their stable marker yaw; this inverse matches TrackFrame.yaw exactly.
        frame.tangentX = -Math.sin(heading);
        frame.tangentZ = -Math.cos(heading);
      }
      return frame;
    }

    function drawEntities(entities, classification, transform, forcedKind = '') {
      let rendered = 0;
      for (const entity of collectionValues(entities)) {
        if (!entity || entity.visible === false || entity.active === false) continue;
        const frame = entityFrame(entity);
        if (!frame) continue;
        const dx = frame.x - transform.centerX;
        const dz = frame.z - transform.centerZ;
        const pointX = width * 0.5 + (dx * transform.cos - dz * transform.sin) * transform.scale;
        const pointY = height * 0.5 + (dx * transform.sin + dz * transform.cos) * transform.scale;
        if (pointX < 2 || pointX > width - 2 || pointY < 2 || pointY > height - 2) continue;
        const routeReference = entity.routeRef || entity.route || entity;
        const onSelectedPath = !routeReference.edgeId || classification.selected.has(routeReference.edgeId);
        const type = String(forcedKind || entity.kind || entity.type || entity.entityType || 'traffic');
        const ambientTraffic = type.includes('ambient') || type.includes('opposing');
        const hazardMarker = type.includes('obstacle') || type.includes('hazard');
        const opacity = clamp(finite(entity.opacity, finite(entity.alpha, 1)), 0, 1);
        context.globalAlpha = (ambientTraffic ? (onSelectedPath ? 0.52 : 0.28) : (onSelectedPath ? 1 : 0.34)) * opacity;
        if (type.includes('pickup') || type.includes('energy') || type.includes('coin')) {
          const radius = diagnostics.roadDetailPickupMarkerDiameterPx * 0.5;
          if (transform.roadDetail > 0.001 && width > COMPACT_MAX_WIDTH_PX) {
            context.beginPath();
            context.arc(pointX, pointY, radius + 1.8, 0, Math.PI * 2);
            context.fillStyle = 'rgba(126, 233, 255, 0.20)';
            context.fill();
          }
          context.beginPath();
          context.arc(pointX, pointY, radius, 0, Math.PI * 2);
          context.fillStyle = colors.pickup;
          context.fill();
          if (transform.roadDetail > 0.5 && width > COMPACT_MAX_WIDTH_PX) {
            context.strokeStyle = 'rgba(239, 251, 255, 0.82)';
            context.lineWidth = 0.8;
            context.stroke();
          }
        } else {
          const tangentX = frame.tangentX * transform.cos - frame.tangentZ * transform.sin;
          const tangentY = frame.tangentX * transform.sin + frame.tangentZ * transform.cos;
          context.save();
          context.translate(pointX, pointY);
          context.rotate(Math.atan2(tangentY, tangentX) + (finite(entity.direction, 1) < 0 ? Math.PI : 0));
          if (ambientTraffic) {
            const markerSize = width <= COMPACT_MAX_WIDTH_PX ? 3.1 : 4.2;
            context.beginPath();
            context.moveTo(markerSize, 0);
            context.lineTo(-markerSize * 0.72, -markerSize * 0.52);
            context.lineTo(-markerSize * 0.30, 0);
            context.lineTo(-markerSize * 0.72, markerSize * 0.52);
            context.closePath();
            context.fillStyle = colors.traffic;
            context.fill();
          } else {
            const markerWidth = hazardMarker
              ? diagnostics.roadDetailObstacleMarkerWidthPx
              : width <= COMPACT_MAX_WIDTH_PX ? 4.6 : 6;
            const markerHeight = hazardMarker
              ? diagnostics.roadDetailObstacleMarkerHeightPx
              : width <= COMPACT_MAX_WIDTH_PX ? 2.3 : 2.9;
            if (hazardMarker && transform.roadDetail > 0.001 && width > COMPACT_MAX_WIDTH_PX) {
              context.fillStyle = 'rgba(255, 107, 113, 0.18)';
              context.fillRect(-markerWidth * 0.68, -markerHeight * 0.82, markerWidth * 1.36, markerHeight * 1.64);
            }
            context.fillStyle = hazardMarker ? colors.obstacle : colors.traffic;
            context.fillRect(-markerWidth * 0.5, -markerHeight * 0.5, markerWidth, markerHeight);
          }
          context.restore();
        }
        rendered++;
      }
      context.globalAlpha = 1;
      return rendered;
    }

    function drawPlayer(playerFrame, transform) {
      const point = projectPoint(playerFrame, transform);
      const tangent = projectTangent(playerFrame, transform);
      const playerRecord = edgeRecords.get(playerFrame.edgeId);
      if (playerRecord) {
        const before = projectPoint(
          sampleEdgeFrame(playerRecord.edge, clamp(playerFrame.edgeS - 0.75, 0, playerRecord.edge.length)),
          transform
        );
        const after = projectPoint(
          sampleEdgeFrame(playerRecord.edge, clamp(playerFrame.edgeS + 0.75, 0, playerRecord.edge.length)),
          transform
        );
        const finiteDifferenceAngle = Math.atan2(after.y - before.y, after.x - before.x);
        diagnostics.arrowTangentErrorDeg = Math.max(
          diagnostics.arrowTangentErrorDeg,
          Math.abs(normalizeAngle(tangent.angle - finiteDifferenceAngle)) * 180 / Math.PI
        );
      }
      const size = clamp(finite(options.playerArrowSize, PLAYER_ARROW_PX), 10, 12);
      diagnostics.playerViewportX = point.x;
      diagnostics.playerViewportY = point.y;
      diagnostics.playerClamped = !isInside(point, size);
      diagnostics.playerDrawCount = 0;
      // An offscreen player is a transform/viewport diagnostic, never a reason to forge an edge marker.
      if (diagnostics.playerClamped) return;
      context.save();
      context.translate(point.x, point.y);
      context.beginPath();
      context.arc(0, 0, size * 0.78, 0, Math.PI * 2);
      context.fillStyle = 'rgba(240, 199, 91, 0.18)';
      context.fill();
      context.rotate(tangent.angle);
      context.beginPath();
      context.moveTo(size * 0.58, 0);
      context.lineTo(-size * 0.48, -size * 0.42);
      context.lineTo(-size * 0.20, 0);
      context.lineTo(-size * 0.48, size * 0.42);
      context.closePath();
      context.fillStyle = colors.player;
      context.fill();
      context.strokeStyle = colors.playerCore;
      context.lineWidth = 1.35;
      context.stroke();
      context.beginPath();
      context.arc(-size * 0.08, 0, size * 0.12, 0, Math.PI * 2);
      context.fillStyle = colors.playerCore;
      context.fill();
      context.restore();
      diagnostics.playerDrawCount = 1;
    }

    /** Distance ticks stay map-local; live controls belong to the persistent viewport tracker. */
    function drawRoadDetailOverlay(playerFrame, transform) {
      diagnostics.roadDetailTickCount = 0;
      diagnostics.roadDetailControlCount = 0;
      diagnostics.roadDetailLegendCount = 0;
      if (transform.roadDetail <= 0.5) return;
      const record = edgeRecords.get(playerFrame.edgeId);
      if (!record) return;
      const roadHalf = finite(record.edge.roadHalf, finite(record.edge.halfWidth, 8.4));
      const maximumTickDistance = Math.min(
        record.edge.length - playerFrame.edgeS,
        diagnostics.roadDetailVisibleAheadM
      );
      context.save();
      context.font = `${width <= COMPACT_MAX_WIDTH_PX ? 7 : 9}px ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      for (let distance = 100; distance <= maximumTickDistance; distance += 100) {
        const edgeS = playerFrame.edgeS + distance;
        const left = projectPoint(sampleEdgeFrame(record.edge, edgeS, -roadHalf), transform);
        const right = projectPoint(sampleEdgeFrame(record.edge, edgeS, roadHalf), transform);
        context.beginPath();
        context.moveTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.strokeStyle = 'rgba(174, 207, 203, 0.38)';
        context.lineWidth = width <= COMPACT_MAX_WIDTH_PX ? 0.55 : 0.8;
        context.setLineDash([2, 3]);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = 'rgba(239, 251, 255, 0.72)';
        context.fillText(
          uiText('common.meters', { value: uiNumber(distance) }, `${distance} 米`),
          right.x + 4,
          right.y
        );
        diagnostics.roadDetailTickCount++;
      }

      context.restore();
    }

    function navigationArrow(kind) {
      if (kind === 'left' || kind === 'loop-left') return '↰';
      if (kind === 'right' || kind === 'exit-right') return '↱';
      return '↑';
    }

    /**
     * Keep one compact direction cue inside the raster while the readable instruction, distance, and speed live
     * in the surrounding DOM instrument. Both surfaces consume this same DecisionGuidance object.
     */
    function drawNavigationOverlay(payload) {
      diagnostics.navigationDrawCount = 0;
      diagnostics.navigationLabel = '';
      diagnostics.navigationDistanceM = null;
      diagnostics.navigationCurrentSpeed = null;
      diagnostics.navigationSuggestedSpeed = null;
      diagnostics.navigationBraking = false;
      diagnostics.nearestObstacleDistance = null;
      const navigation = payload.navigation;
      if (!navigation || typeof navigation !== 'object') return;
      const mobile = width <= COMPACT_MAX_WIDTH_PX;
      const distance = Number.isFinite(navigation.distanceM) ? Math.max(0, navigation.distanceM) : null;
      const currentSpeed = Number.isFinite(navigation.currentSpeed) ? Math.max(0, navigation.currentSpeed) : null;
      const suggestedSpeed = Number.isFinite(navigation.suggestedSpeed) ? Math.max(0, navigation.suggestedSpeed) : null;
      const nearest = Number.isFinite(navigation.nearestObstacleDistance)
        ? Math.max(0, navigation.nearestObstacleDistance)
        : null;
      const braking = Boolean(navigation.braking);
      const label = navigation.labelKey
        ? uiText(navigation.labelKey, navigation.labelParameters || {}, navigation.label || '保持路线')
        : uiSource(navigation.label || '保持路线');
      const cueSize = mobile ? 18 : 24;
      roundedRectPath(context, 6, 6, cueSize, cueSize, mobile ? 5 : 7);
      context.fillStyle = 'rgba(3, 12, 19, 0.92)';
      context.fill();
      context.strokeStyle = braking ? 'rgba(255, 124, 134, 0.96)' : 'rgba(240, 199, 91, 0.88)';
      context.lineWidth = mobile ? 0.9 : 1.15;
      context.stroke();
      context.fillStyle = colors.label;
      context.font = `800 ${mobile ? 12 : 16}px ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(navigationArrow(navigation.kind), 6 + cueSize * 0.5, 6 + cueSize * 0.5);
      if (braking || (nearest !== null && nearest <= 50)) {
        context.beginPath();
        context.arc(6 + cueSize - 2, 8, mobile ? 2.2 : 2.8, 0, Math.PI * 2);
        context.fillStyle = colors.obstacle;
        context.fill();
        context.strokeStyle = 'rgba(3, 12, 19, 0.94)';
        context.lineWidth = 1;
        context.stroke();
      }
      diagnostics.navigationDrawCount = 1;
      diagnostics.navigationLabel = label;
      diagnostics.navigationDistanceM = distance;
      diagnostics.navigationCurrentSpeed = currentSpeed;
      diagnostics.navigationSuggestedSpeed = suggestedSpeed;
      diagnostics.navigationBraking = braking;
      diagnostics.nearestObstacleDistance = nearest;
    }

    /**
     * Draw the fixed layer contract and return a live diagnostic snapshot.
     * Payload contract keeps legacy `entities`, accepts stable `hazards`, `pickups`, `ambientTraffic`,
     * and `navigation`, and consumes `world.terrainCells/sceneryEntities` as the sole scene authority.
     */
    function update(payload = {}) {
      if (destroyed) return Object.freeze({ ...diagnostics });
      // Reject contract drift before any drawing; accepting render-relative data would create a plausible but false map.
      const world = validateSceneContract(payload.world);
      diagnostics.sceneContractVersion = world.version;
      diagnostics.sceneCoordinateMode = world.coordinateMode;
      const startedAt = transitionClock();
      const staticBuildCountBefore = diagnostics.staticCacheBuildCount;
      const bufferResizeCountBefore = diagnostics.bufferResizeCount;
      updateSerial++;
      diagnostics.attemptedFrameSerial = updateSerial;
      lastPayload = payload;
      if (payload.deferResize) {
        diagnostics.deferredResizeCount++;
        sizeDirty = true;
      }
      else if (sizeDirty || updateSerial - lastSizeSyncSerial >= SIZE_FALLBACK_INTERVAL_FRAMES) syncSize();
      else diagnostics.sizeSyncSkipCount++;
      const playerFrame = payloadPlayerFrame(payload);
      const progressState = resolveModeProgress(payload, startedAt);
      const transform = computeTransform(payload, playerFrame, progressState);
      const classification = classifyEdges(payload);
      try {
        ensureStaticCache(transform, classification);
      } catch (error) {
        diagnostics.lastFailureCode = error?.code || 'minimap-world-cache-render-failed';
        diagnostics.lastFailurePhase = error?.phase || 'world-cache-render';
        throw error;
      }
      auditClipDiagnostics(payload, transform);
      diagnostics.bridgeLayerErrorCount = geometryBridgeLayerErrors;

      try {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        if (consumeDebugFailure('frame-render')) {
          throw new Error('Injected minimap frame-render failure.');
        }
        context.lineCap = 'round';
        context.lineJoin = 'round';
        drawMapBackground(context);
        diagnostics.sceneRejectedCoordinateCount = 0;
        drawSceneTerrain(context, world, transform);
        drawSceneScenery(context, world, transform);
        drawStaticCache(transform);
        drawRoadDetailBase(context, transform);

        // Layer 7: proposal first, then the committed gold-white route.
        drawRecordSet(classification.proposed, transform, colors.proposed, width <= COMPACT_MAX_WIDTH_PX ? 2.0 : 2.7, [5, 4]);
        const pathIds = orderedPathIds(payload.pathPlan);
        drawSelectedPath(pathIds.length ? pathIds : classification.selectedIds, transform);
        validateRouteGaps(pathIds, transform);
        // Layers 8-10: signs/arrows, entities, and the tangent-aligned player marker.
        drawLabelsAndArrows(classification, transform);
        diagnostics.externalEntityEdgeResolveCount = 0;
        diagnostics.rejectedEntityCoordinateCount = 0;
        drawEntities(payload.entities, classification, transform);
        const groupedHazards = payload.hazards && !Array.isArray(payload.hazards)
          && !(payload.hazards instanceof Map)
          && (Object.prototype.hasOwnProperty.call(payload.hazards, 'obstacles')
            || Object.prototype.hasOwnProperty.call(payload.hazards, 'pickups')
            || Object.prototype.hasOwnProperty.call(payload.hazards, 'ambientTraffic'));
        const hazardSource = groupedHazards ? payload.hazards.obstacles : (payload.hazards || payload.obstacles);
        const pickupSource = payload.pickups || (groupedHazards ? payload.hazards.pickups : null);
        const ambientTraffic = payload.ambientTraffic || (groupedHazards ? payload.hazards.ambientTraffic : null);
        diagnostics.hazardDrawCount = drawEntities(hazardSource, classification, transform, 'obstacle');
        diagnostics.pickupDrawCount = drawEntities(pickupSource, classification, transform, 'pickup');
        diagnostics.ambientTrafficDrawCount = drawEntities(ambientTraffic, classification, transform, 'ambient-traffic');
        drawRoadDetailOverlay(playerFrame, transform);
        drawPlayer(playerFrame, transform);
        drawScaleBar(context, transform);
        drawCompass(context, transform);
        drawNavigationOverlay(payload);
        // Presentation is the commit boundary: exceptions above leave the previous visible map untouched.
        if (consumeDebugFailure('presentation')) {
          throw recoverableMinimapError('Injected minimap presentation failure.', {
            code: 'minimap-debug-presentation-failed',
            phase: 'presentation'
          });
        }
        presentFrame();
      } catch (error) {
        if (error?.recoverable === true) {
          diagnostics.lastFailureCode = error.code || 'minimap-recoverable-failure';
          diagnostics.lastFailurePhase = error.phase || 'unknown';
          throw error;
        }
        diagnostics.frameRenderFailureCount++;
        // Canvas state restoration is not trustworthy after an arbitrary painter exception. Replacing the private
        // frame surface makes the next retry independent while the last presented canvas remains untouched.
        try {
          const replacement = allocateFrameBuffer(frameBuffer.width, frameBuffer.height, dpr);
          frameBuffer = replacement.buffer;
          context = replacement.context;
        } catch (replacementError) {
          diagnostics.lastFailureCode = replacementError.code || 'minimap-frame-buffer-allocation-failed';
          diagnostics.lastFailurePhase = replacementError.phase || 'frame-buffer-allocation';
          throw replacementError;
        }
        const recoverableError = recoverableMinimapError('Minimap frame rendering failed.', {
          code: 'minimap-frame-render-failed',
          phase: 'frame-render',
          cause: error
        });
        diagnostics.lastFailureCode = recoverableError.code;
        diagnostics.lastFailurePhase = recoverableError.phase;
        throw recoverableError;
      }

      diagnostics.presentedFrameSerial = updateSerial;
      diagnostics.presentedMapMode = diagnostics.mapMode;
      diagnostics.presentedNavigationLabel = diagnostics.navigationLabel;
      diagnostics.presentedNavigationDistanceM = diagnostics.navigationDistanceM;
      diagnostics.presentedNavigationBraking = diagnostics.navigationBraking;
      diagnostics.lastFailureCode = null;
      diagnostics.lastFailurePhase = null;
      const duration = transitionClock() - startedAt;
      diagnostics.drawLastMs = duration;
      // Cache rebuild/resize latency has dedicated counters; the live budget measures ordinary pan/dynamic-marker draws.
      const steadyDraw = staticBuildCountBefore === diagnostics.staticCacheBuildCount
        && bufferResizeCountBefore === diagnostics.bufferResizeCount;
      if (steadyDraw) {
        drawDurations[drawDurationCursor] = duration;
        drawDurationCursor = (drawDurationCursor + 1) % DRAW_SAMPLE_WINDOW;
        drawDurationCount = Math.min(DRAW_SAMPLE_WINDOW, drawDurationCount + 1);
        diagnostics.steadyDrawSampleCount++;
        if (diagnostics.steadyDrawSampleCount % DRAW_DIAGNOSTIC_REFRESH_FRAMES === 0 || drawDurationCount === 1) {
          drawDurationScratch.fill(Number.POSITIVE_INFINITY);
          for (let index = 0; index < drawDurationCount; index++) drawDurationScratch[index] = drawDurations[index];
          drawDurationScratch.sort();
          diagnostics.drawP95Ms = drawDurationScratch[
            Math.min(drawDurationCount - 1, Math.ceil(drawDurationCount * 0.95) - 1)
          ];
        }
      }
      diagnostics.mapDrawP95Ms = diagnostics.drawP95Ms;
      return Object.freeze({ ...diagnostics });
    }

    function resize() {
      if (destroyed) return false;
      sizeDirty = true;
      const changed = syncSize();
      if (lastPayload) update(lastPayload);
      return changed;
    }

    function getDiagnostics() {
      return Object.freeze({ ...diagnostics });
    }

    /** Re-render the retained payload at its settled target after a live reduced-motion preference change. */
    function syncMotionPreference() {
      if (destroyed) return false;
      diagnostics.reducedMotion = Boolean(isReducedMotionEnabled());
      if (!diagnostics.reducedMotion || !lastPayload) return false;
      // Reduced motion has no resize handoff to await, so the retained canvas and transform settle in one presentation.
      update(lastPayload.deferResize ? { ...lastPayload, deferResize: false } : lastPayload);
      return true;
    }

    function destroy() {
      if (destroyed) return false;
      destroyed = true;
      edgeById.clear();
      edgeRecords.clear();
      nodeById.clear();
      drawDurations.fill(0);
      drawDurationScratch.fill(0);
      drawDurationCount = 0;
      drawDurationCursor = 0;
      lastPayload = null;
      debugFailurePhase = null;
      sizeDirty = false;
      frameBuffer = null;
      context = null;
      staticBuffer = null;
      staticContext = null;
      staticCacheKey = '';
      staticTransform = null;
      resizeObserver?.disconnect?.();
      if (typeof window !== 'undefined') {
        window.removeEventListener?.('resize', markSizeDirty);
        window.removeEventListener?.('orientationchange', markSizeDirty);
      }
      presenter.destroy();
      const presentation = presenter.getDiagnostics();
      diagnostics.activePresentationIndex = presentation.activePresentationIndex;
      diagnostics.presentedBufferWidth = presentation.presentedBufferWidth;
      diagnostics.presentedBufferHeight = presentation.presentedBufferHeight;
      return true;
    }

    rebuildGraph(graph);
    syncSize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(markSizeDirty);
      resizeObserver.observe(canvas);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener?.('resize', markSizeDirty, { passive: true });
      window.addEventListener?.('orientationchange', markSizeDirty, { passive: true });
    }

    return Object.freeze({
      update,
      resize,
      invalidate,
      refreshGraph: rebuildGraph,
      getDiagnostics,
      syncMotionPreference,
      debugFailNextFrame,
      destroy
    });
  }

  return Object.freeze({ create, createAtomicPresenter });
})();
