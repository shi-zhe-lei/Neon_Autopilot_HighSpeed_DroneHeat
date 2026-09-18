/* Static full-cloverleaf road network visuals. Gameplay topology remains owned by NeonV23Track. */
window.NeonV23CloverleafVisuals = (() => {
  'use strict';

  // Every deck family stays inside one restrained warm-gray band; fog must preserve a readable top/fascia contrast
  // instead of lifting the complete network into a near-white slab. Route identity still belongs to markings.
  const FAMILY_COLORS = Object.freeze({
    mainline: 0xa9_aaa5,
    collector: 0xa3_a6_a2,
    'direct-ramp': 0xa6_a7_a2,
    'loop-ramp': 0xad_aca6,
    'opposing-crossover': 0xa3_a8_a6,
    'opposing-recovery-proxy': 0xa3_a8_a6
  });
  // Graph roads replace the legacy 9.2m inlays, so an equivalent world-fixed rhythm must remain in the shared
  // marking batch. It is measured in route metres and never reads HUD speed, time, or gameplay state.
  const ROAD_SPEED_REFERENCE_CONTRACT = Object.freeze({
    referenceSpeedKmh: 100,
    cadenceM: 9.2,
    markLengthM: 4,
    gapLengthM: 5.2,
    edgeInsetM: 0.45,
    paired: true,
    worldFixed: true,
    affectsGameplay: false
  });

  /**
   * The profile is authored with its tip on negative Y. A positive quarter-turn maps that tip to local -Z;
   * the right/up/back road basis then maps local -Z to the authoritative positive route tangent. Keeping the
   * authored and mounted axes together prevents a visually plausible 180-degree regression on another port.
   */
  const ROAD_ARROW_DIRECTION_CONTRACT = Object.freeze({
    profileForwardAxis: Object.freeze({ x: 0, y: -1, z: 0 }),
    geometryPitchRadians: Math.PI * 0.5,
    localForwardAxis: Object.freeze({ x: 0, y: 0, z: -1 }),
    minimumForwardDot: 0.999
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function edgeList(track) {
    const source = track.graph?.edges;
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return [...source.values()];
    if (source && typeof source === 'object') return Object.values(source);
    return [];
  }

  function crossingList(track) {
    const source = track.graph?.crossings;
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return [...source.values()];
    if (source && typeof source === 'object') return Object.values(source);
    return [];
  }

  function movementList(track) {
    const source = track.graph?.movements;
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return [...source.values()];
    if (source && typeof source === 'object') return Object.values(source);
    if (typeof track.enumerateMovements === 'function') return track.enumerateMovements();
    return [];
  }

  function nodeList(track) {
    const source = track.graph?.nodes;
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return [...source.values()];
    if (source && typeof source === 'object') return Object.values(source);
    return [];
  }

  const ROAD_FAMILY_PRIORITY = Object.freeze({
    mainline: 6,
    approach: 6,
    outbound: 6,
    'direct-ramp': 4,
    collector: 3,
    'loop-ramp': 2
  });
  function nowMilliseconds() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  /** FNV-1a keeps decorative placement deterministic without consuming the gameplay random stream. */
  function stableHash(text) {
    let hash = 0x81_1c_9d_c5;
    for (let index = 0; index < String(text).length; index++) {
      hash ^= String(text).charCodeAt(index);
      hash = Math.imul(hash, 0x01_00_01_93);
    }
    return hash >>> 0;
  }

  function edgeTemplateId(edge) {
    return edge?.templateEdgeId || edge?.id || '';
  }

  function isRuntimeOnlyEdge(edge) {
    return edge?.visualOnly === true
      || edge?.runtimeKind === 'recovery'
      || edge?.runtimeKind === 'launch'
      || edge?.family === 'recovery'
      || edge?.family === 'launch';
  }

  const RUNTIME_SUPPORT_SEARCH_INDICES = Object.freeze([0, 1, -1, 2, -2]);
  // Clearance is proven against the complete footing envelope, not only the narrower pier shaft. The fallback
  // remains safe even when a lightweight audit track omits the production bridge-support contract.
  const BRIDGE_SUPPORT_FOOTING_WIDTH = 2.2;
  const BRIDGE_SUPPORT_FOOTING_DEPTH = 1.05;
  const BRIDGE_SUPPORT_FOOTING_CLEARANCE_RADIUS = Math.hypot(
    BRIDGE_SUPPORT_FOOTING_WIDTH * 0.5,
    BRIDGE_SUPPORT_FOOTING_DEPTH * 0.5
  );
  const BRIDGE_SUPPORT_FALLBACK_GROUND_Y = -1.18;
  const BRIDGE_SUPPORT_FOOTING_CENTER_OFFSET_Y = 0.04;

  /**
   * Resolve the world-height owner once per tile. The renderer may be embedded without a terrain service, so the
   * historical datum remains an explicit compatibility fallback; a present sampler keeps authority and its errors
   * propagate instead of being disguised as flat ground.
   */
  function createSupportGroundHeightResolver(options = {}, runtimeTrack = options.runtimeTrack || options.track) {
    const fallbackGroundY = Number.isFinite(options.supportGroundY)
      ? Number(options.supportGroundY)
      : BRIDGE_SUPPORT_FALLBACK_GROUND_Y;
    const sceneData = options.scene?.userData || null;
    const candidates = [
      ['options.sampleTerrainHeight', options, options.sampleTerrainHeight],
      ['options.sampleWorldHeight', options, options.sampleWorldHeight],
      ['runtimeTrack.sampleTerrainHeight', runtimeTrack, runtimeTrack?.sampleTerrainHeight],
      ['runtimeTrack.sampleWorldHeight', runtimeTrack, runtimeTrack?.sampleWorldHeight],
      ['runtimeTrack.world.sampleHeight', runtimeTrack?.world, runtimeTrack?.world?.sampleHeight],
      [
        'runtimeTrack.graph.world.sampleHeight',
        runtimeTrack?.graph?.world,
        runtimeTrack?.graph?.world?.sampleHeight
      ],
      [
        'scene.userData.neonV23TerrainHeightAt',
        sceneData,
        sceneData?.neonV23TerrainHeightAt
      ]
    ];
    const candidate = candidates.find(([, , sampler]) => typeof sampler === 'function') || null;
    const source = candidate?.[0] || 'fallback.supportGroundY';
    const samplerOwner = candidate?.[1] || null;
    const sampler = candidate?.[2] || null;
    let sampleCount = 0;
    let fallbackCount = 0;
    let minimumGroundY = Number.POSITIVE_INFINITY;
    let maximumGroundY = Number.NEGATIVE_INFINITY;

    function sample(x, z, context = null) {
      sampleCount++;
      const result = sampler ? sampler.call(samplerOwner, x, z, context) : null;
      const resolvedGroundY = Number.isFinite(result)
        ? Number(result)
        : Number.isFinite(result?.worldY)
          ? Number(result.worldY)
          : Number.isFinite(result?.surfaceHeight)
            ? Number(result.surfaceHeight)
            : Number.isFinite(result?.y) ? Number(result.y) : null;
      if (sampler && !Number.isFinite(resolvedGroundY)) {
        throw new TypeError(`${source} must return a finite terrain world height`);
      }
      const sampledGroundY = sampler ? resolvedGroundY : fallbackGroundY;
      if (!sampler) fallbackCount++;
      minimumGroundY = Math.min(minimumGroundY, sampledGroundY);
      maximumGroundY = Math.max(maximumGroundY, sampledGroundY);
      return sampledGroundY;
    }

    function diagnostics() {
      return Object.freeze({
        source,
        fallbackGroundY,
        sampleCount,
        fallbackCount,
        minimumGroundY: Number.isFinite(minimumGroundY) ? minimumGroundY : null,
        maximumGroundY: Number.isFinite(maximumGroundY) ? maximumGroundY : null
      });
    }

    return Object.freeze({ sample, diagnostics, source, fallbackGroundY });
  }

  /**
   * A support shaft is world-vertical, so its top meets the deck-bottom plane at thickness / upY. Multiplying by
   * upY only projects the normal offset onto Y and leaves a visible gap on a banked or graded road.
   */
  function verticalSupportDeckUndersideY(frame, deckThickness) {
    const verticalNormal = Math.max(0.000_001, Math.abs(Number(frame?.upY) || 1));
    return Number(frame?.y) - Number(deckThickness) / verticalNormal;
  }

  /**
   * Size one single-column transfer cap from the real column-to-nearest-girder reach. The local bearing-pad zone
   * stays over the shaft, while only the required transfer reach is added toward the road; the opposite side never
   * receives a mirrored decorative cantilever.
   */
  function supportTransferCapLayout(supportLateralValue, roadHalfValue, supportRadiusValue) {
    const supportLateral = Number(supportLateralValue) || 0;
    const roadHalf = Math.max(0, Number(roadHalfValue) || 0);
    const supportRadius = Math.max(0, Number(supportRadiusValue) || 0);
    const centered = Math.abs(supportLateral) <= 0.000_001;
    const nearestSideGirderLateral = Math.sign(supportLateral)
      * Math.max(0, roadHalf - 0.48);
    const transferReach = Math.max(
      0,
      Math.abs(supportLateral) - Math.abs(nearestSideGirderLateral)
    );
    const centerLateralOffset = -Math.sign(supportLateral) * transferReach * 0.5;
    // A centered shaft receives a real T-cap with visible bearing mass. Offset shafts retain the one-sided
    // transfer rule so this refinement cannot recreate the former giant unloaded mirrored cantilever.
    const centeredWidth = Math.max(
      supportRadius * 2,
      Math.min(5, roadHalf * 0.90)
    );
    const endOverlap = centered ? centeredWidth * 0.5 : Math.max(1.1, supportRadius);
    const width = centered ? centeredWidth : transferReach + endOverlap * 2;
    const minimumLateral = centerLateralOffset - width * 0.5;
    const maximumLateral = centerLateralOffset + width * 0.5;
    const pierOverlap = Math.max(
      0,
      Math.min(maximumLateral, supportRadius)
        - Math.max(minimumLateral, -supportRadius)
    );
    const invalidOutwardOverhang = centered ? 0 : Math.max(
      0,
      supportLateral < 0
        ? -endOverlap - minimumLateral
        : maximumLateral - endOverlap
    );
    return Object.freeze({
      transferReach,
      centerLateralOffset,
      endOverlap,
      width,
      capDepth: centered ? 0.50 : 0.28,
      longitudinalDepth: centered ? 1.60 : 1.10,
      pierOverlap,
      invalidOutwardOverhang
    });
  }

  /**
   * Resume one deck-support search candidate at a time without changing its historical station/lateral order.
   * `evaluateCandidate` returns `undefined` to reject a candidate; every other value is a terminal placement
   * result. Keeping the accepted clearance decision and its installation in that callback makes cancellation
   * safe: a yielded job never retains an accepted-but-uninstalled pier.
   */
  function createSupportPlacementSearchJob(options = {}) {
    const evaluateCandidate = options.evaluateCandidate;
    if (typeof evaluateCandidate !== 'function') {
      throw new Error('Support placement search requires an evaluateCandidate callback');
    }
    const edgeLength = Math.max(0, Number(options.edgeLength) || 0);
    const initialS = Number.isFinite(options.initialS) ? Number(options.initialS) : 0;
    const searchDirection = Number(options.searchDirection) || 1;
    const attemptCount = Math.max(1, Math.floor(Number(options.attemptCount) || 24));
    const searchStep = Math.max(0.25, Number(options.searchStep) || 1.5);
    const lateralOffsets = Array.isArray(options.lateralOffsets) && options.lateralOffsets.length > 0
      ? [...options.lateralOffsets]
      : [0];
    const symmetric = options.symmetric === true;
    let attempt = 0;
    let lateralIndex = 0;
    let candidateCount = 0;
    let complete = false;
    let exhausted = false;
    let result = null;

    function step() {
      if (complete) return true;
      const searchIndex = symmetric && attempt > 0
        ? Math.ceil(attempt * 0.5) * (attempt % 2 === 1 ? 1 : -1)
        : attempt;
      const supportS = clamp(
        initialS + searchDirection * searchIndex * searchStep,
        0,
        edgeLength
      );
      const lateral = lateralOffsets[lateralIndex];
      candidateCount++;
      const candidateResult = evaluateCandidate(supportS, lateral, searchIndex, attempt);
      if (candidateResult !== undefined) {
        result = candidateResult;
        complete = true;
        return true;
      }

      lateralIndex++;
      if (lateralIndex >= lateralOffsets.length) {
        lateralIndex = 0;
        attempt++;
      }
      if (attempt >= attemptCount) {
        exhausted = true;
        complete = true;
      }
      return complete;
    }

    function finish() {
      if (!complete) throw new Error('Support placement search is not complete');
      return result;
    }

    const diagnostics = Object.freeze({
      get candidateCount() { return candidateCount; },
      get complete() { return complete; },
      get exhausted() { return exhausted; }
    });
    return Object.freeze({ step, finish, diagnostics });
  }

  /** Split sampled elevated stations wherever the deck returns to the ground and needs no pier. */
  function splitElevatedStationSegments(stations, interval) {
    const segments = [];
    let current = [];
    for (const station of stations) {
      if (current.length > 0 && station - current[current.length - 1] > interval * 1.5) {
        segments.push(current);
        current = [];
      }
      current.push(station);
    }
    if (current.length > 0) segments.push(current);
    return segments;
  }

  /**
   * The mirrored straight-fork branches form one same-height physical deck while their shells overlap. A pier
   * below that shared envelope may support both branches, so clearance must not reject it as an unrelated road.
   */
  function runtimeSupportCompanionEdgeIds(runtimeEdges, edge) {
    if (edge?.family !== 'straight-fork-branch' || !edge.decisionNodeId) return Object.freeze([]);
    return Object.freeze((runtimeEdges || [])
      .filter((candidate) => (
        candidate?.id
        && candidate.id !== edge.id
        && candidate.family === 'straight-fork-branch'
        && candidate.decisionNodeId === edge.decisionNodeId
        && candidate.tileToken === edge.tileToken
      ))
      .map((candidate) => candidate.id));
  }

  /**
   * Runtime recovery IDs are a cross-component track contract. Excluding already-registered alternatives for
   * the same tile prevents mutually exclusive warm variants from forcing repeated global-clearance queries;
   * `getEdge` verification keeps speculative or future IDs from silently entering the exclusion set.
   */
  function registeredInactiveRuntimeSupportEdgeIds(
    runtimeTrack,
    edge,
    currentRuntimeEdgeIds,
    registeredRuntimeEdges = null
  ) {
    if (!edge?.tileToken || !Number.isInteger(edge.tileIndex)) return Object.freeze([]);
    const ids = [];
    const addIfInactive = (edgeId) => {
      if (currentRuntimeEdgeIds.has(edgeId)) return;
      const candidate = runtimeTrack.getEdge?.(edgeId);
      if (
        candidate
        && isRuntimeOnlyEdge(candidate)
        && candidate.tileIndex === edge.tileIndex
        && candidate.tileToken === edge.tileToken
      ) {
        ids.push(candidate.id);
      }
    };
    if (Array.isArray(registeredRuntimeEdges)) {
      for (const candidate of registeredRuntimeEdges) {
        if (
          candidate?.id
          && !currentRuntimeEdgeIds.has(candidate.id)
          && isRuntimeOnlyEdge(candidate)
          && candidate.tileIndex === edge.tileIndex
        ) {
          ids.push(candidate.id);
        }
      }
      return Object.freeze([...new Set(ids)]);
    }
    for (const port of ['north', 'east', 'south', 'west']) {
      addIfInactive(`${edge.tileToken}:recovery-in-${port}`);
      addIfInactive(`${edge.tileToken}:launch-${port}`);
      addIfInactive(`${edge.tileToken}:straight-fork-approach-${port}`);
      addIfInactive(`${edge.tileToken}:straight-fork-left-${port}`);
      addIfInactive(`${edge.tileToken}:straight-fork-right-${port}`);
      addIfInactive(`${edge.tileToken}:recovery-out-${port}`);
      addIfInactive(`${edge.tileToken}:outbound-extension-${port}`);
    }
    return Object.freeze([...new Set(ids)]);
  }

  /**
   * Plan runtime-only bridge supports without allocating scene objects. Production supplies a matrix composer;
   * server-side audits use the same placement and spacing path with lightweight records.
   */
  function createRuntimeSupportPlacementJob(options) {
    const runtimeTrack = options.runtimeTrack;
    const runtimeEdges = (options.runtimeEdges || []).filter(isRuntimeOnlyEdge);
    const deckThickness = Number(options.deckThickness) || 0.92;
    const supportGroundHeightResolver = options.supportGroundHeightResolver
      || createSupportGroundHeightResolver(options, runtimeTrack);
    const minimumVisiblePierHeight = Number(options.minimumVisiblePierHeight) || 2.2;
    const elevatedSupportSpacing = Number(options.elevatedSupportSpacing) || 52;
    const supportRadius = Number(options.supportRadius) || 0.62;
    const supportClearanceRadius = Math.max(
      supportRadius,
      Number(options.supportClearanceRadius) || BRIDGE_SUPPORT_FOOTING_CLEARANCE_RADIUS
    );
    const supportRoadGap = Number(options.supportRoadGap) || 1;
    const supportGap = Number(options.supportGap) || 0.35;
    const routeExteriorPortalClearHeight = Number(options.routeExteriorPortalClearHeight) || 7.2;
    const standardMaximumAllowedGap = elevatedSupportSpacing * 2 + 0.01;
    const permanentSupportCenters = Array.isArray(options.permanentSupportCenters)
      ? options.permanentSupportCenters
      : [];
    const composeRecord = typeof options.composeRecord === 'function'
      ? options.composeRecord
      : (frame, edgeId, edgeS) => {
          const supportFrames = Array.isArray(frame.supportPairFrames)
            ? frame.supportPairFrames
            : [frame];
          const supportLegs = supportFrames.map((supportFrame) => {
            const groundY = Number.isFinite(supportFrame.supportGroundY)
              ? supportFrame.supportGroundY
              : supportGroundHeightResolver.sample(
                  supportFrame.x,
                  supportFrame.z,
                  { edgeId, edgeS, lateral: Number(supportFrame.supportLateral) || 0 }
                );
            const topY = supportFrames.length === 2
              ? supportFrame.y + routeExteriorPortalClearHeight
              : verticalSupportDeckUndersideY(supportFrame, deckThickness);
            return Object.freeze({
              x: supportFrame.x,
              z: supportFrame.z,
              lateral: Number(supportFrame.supportLateral) || 0,
              groundY,
              topY,
              height: Math.max(0.8, topY - groundY)
            });
          });
          const pairedPortal = supportFrames.length === 2;
          const transferCap = supportTransferCapLayout(
            supportLegs[0].lateral,
            Number(frame.roadHalf) || 0,
            supportRadius
          );
          return Object.freeze({
            edgeId,
            edgeS,
            x: supportFrames.reduce((sum, supportFrame) => sum + supportFrame.x, 0)
              / supportFrames.length,
            z: supportFrames.reduce((sum, supportFrame) => sum + supportFrame.z, 0)
              / supportFrames.length,
            supportKind: pairedPortal ? 'route-exterior-portal' : 'single-column',
            supportLegs: Object.freeze(supportLegs),
            supportLaterals: Object.freeze(supportLegs.map((leg) => leg.lateral)),
            supportLateral: supportLegs[0].lateral,
            supportClearanceRadius,
            roadHalf: Number(frame.roadHalf) || 0,
            height: Math.min(...supportLegs.map((leg) => leg.height)),
            groundContactError: 0,
            capWidth: pairedPortal
              ? Math.hypot(
                  supportLegs[1].x - supportLegs[0].x,
                  supportLegs[1].z - supportLegs[0].z
                ) + supportRadius * 2
              : transferCap.width,
            transferReach: pairedPortal ? 0 : transferCap.transferReach,
            invalidOutwardCapOverhang: pairedPortal ? 0 : transferCap.invalidOutwardOverhang,
            pierCapOverlap: pairedPortal ? supportRadius * 2 : transferCap.pierOverlap
          });
        };
    const currentRuntimeEdgeIds = new Set(runtimeEdges.map((edge) => edge.id));
    // Diagnostics cover every known inactive variant excluded from this visual, whether precomputed or discovered.
    const inactiveVariantIgnoredEdgeIds = new Set();
    const registeredRuntimeEdgesByTileIndex = new Map();
    const candidates = [];
    const edgeStats = new Map();
    const maximumAllowedGapByEdge = {};
    const supportSpacingByEdge = {};
    for (const edge of runtimeEdges) {
      const authoredSupportSpacing = Number(edge.supportSpanContract?.supportSpacingM);
      // Ordinary recovery roads retain the established 52m rhythm. A route may request a wider rhythm only when
      // it also declares the physical structure that makes the longer bay visually and diagnostically explicit.
      const edgeSupportSpacing = Number.isFinite(authoredSupportSpacing)
        ? clamp(authoredSupportSpacing, elevatedSupportSpacing, 96)
        : elevatedSupportSpacing;
      const edgeStandardMaximumAllowedGap = edgeSupportSpacing * 2 + 0.01;
      const declaredLongSpan = edge.supportSpanContract?.kind === 'cable-stayed-box-girder'
        ? Number(edge.supportSpanContract.maximumUnsupportedSpanM)
        : 0;
      maximumAllowedGapByEdge[edge.id] = Math.max(
        edgeStandardMaximumAllowedGap,
        Number.isFinite(declaredLongSpan) ? declaredLongSpan : 0
      );
      supportSpacingByEdge[edge.id] = edgeSupportSpacing;
      const candidateCount = Math.max(1, Math.ceil(edge.length / edgeSupportSpacing));
      const interval = edge.length / candidateCount;
      const stats = {
        edge,
        interval,
        edgeSupportSpacing,
        edgeStandardMaximumAllowedGap,
        eligible: [],
        installed: []
      };
      if (
        !registeredRuntimeEdgesByTileIndex.has(edge.tileIndex)
        && typeof runtimeTrack.getRuntimeEdgesForTileIndex === 'function'
      ) {
        registeredRuntimeEdgesByTileIndex.set(
          edge.tileIndex,
          runtimeTrack.getRuntimeEdgesForTileIndex(edge.tileIndex)
        );
      }
      const registeredInactiveEdgeIds = registeredInactiveRuntimeSupportEdgeIds(
        runtimeTrack,
        edge,
        currentRuntimeEdgeIds,
        registeredRuntimeEdgesByTileIndex.get(edge.tileIndex) || null
      );
      for (const edgeId of registeredInactiveEdgeIds) inactiveVariantIgnoredEdgeIds.add(edgeId);
      edgeStats.set(edge.id, stats);
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const ignoredEdgeIds = [
          edge.id,
          edge.templateEdgeId,
          ...runtimeSupportCompanionEdgeIds(runtimeEdges, edge),
          ...registeredInactiveEdgeIds
        ].filter(Boolean);
        const selectedRecoveryId = edge.tileToken && edge.exitPort
          ? `${edge.tileToken}:recovery-in-${edge.exitPort}`
          : null;
        if (edge.id === selectedRecoveryId) {
          // Track pre-registers all four visual continuations, including the selected one that the active
          // recovery replaces exactly. It is absent from the rendered variant and cannot veto its real pier.
          ignoredEdgeIds.push(`${edge.tileToken}:outbound-extension-${edge.exitPort}`);
        }
        const preferredSide = candidateIndex % 2 === 0 ? 1 : -1;
        const dynamicSingle = (zone, side) => Object.freeze({
          kind: 'dynamic-single-column',
          zone,
          side
        });
        const portalPair = (leftLevel, rightLevel) => Object.freeze({
          kind: 'route-exterior-portal',
          leftLevel,
          rightLevel
        });
        candidates.push({
          edge,
          initialS: interval * (candidateIndex + 0.5),
          searchDirection: candidateIndex % 2 === 0 ? 1 : -1,
          interval,
          ignoredEdgeIds: Object.freeze([...new Set(ignoredEdgeIds)]),
          lateralOffsets: Object.freeze([
            0,
            dynamicSingle('side', preferredSide),
            dynamicSingle('side', -preferredSide),
            dynamicSingle('outer', preferredSide),
            dynamicSingle('outer', -preferredSide),
            // Portal pairs are ordered by complete span. Each leg is still queried separately and the pair is
            // committed atomically, but a blocked road no longer forces every bent into one 84m symmetric roof.
            portalPair('near', 'near'),
            portalPair('middle', 'near'),
            portalPair('near', 'middle'),
            portalPair('middle', 'middle'),
            portalPair('far', 'near'),
            portalPair('near', 'far'),
            portalPair('far', 'middle'),
            portalPair('middle', 'far'),
            portalPair('far', 'far')
          ])
        });
      }
    }
    const centers = permanentSupportCenters.map((center) => ({ ...center }));
    const records = [];
    // One reusable frame remains owned by the active candidate until its terminal decision; this prevents the
    // runtime planner's repeated sampling from manufacturing garbage between idle callbacks.
    const supportSampleScratch = {};
    const supportSampleScratchB = {};
    const supportFrameScratch = {};
    const supportFrameScratchB = {};
    const reusablePlacementCandidate = {
      edgeS: 0,
      frame: supportFrameScratch,
      frames: [],
      undersideY: 0,
      undersideYs: [],
      clearanceTopYs: [],
      groundYs: [],
      clearances: [],
      clearanceLegCursor: 0,
      ignoredEdgeIds: [],
      clearanceRetryCursor: 0
    };
    const clearanceStepResult = { pending: false, clearance: null };
    const retryLimitClearance = Object.freeze({
      clear: false,
      edgeId: null,
      clearance: Number.NEGATIVE_INFINITY,
      reason: 'inactive-variant-clearance-retry-limit'
    });
    let cursor = 0;
    let activeSpec = null;
    let activeStats = null;
    let activeSpecEligibilityResolved = false;
    let searchCursor = 0;
    let lateralCursor = 0;
    let activeCandidate = null;
    let readyToFinalize = candidates.length === 0;
    let complete = false;
    let candidateCount = 0;
    let blockedCandidateCount = 0;
    let plannerStepCount = 0;
    let placementCandidateCount = 0;
    let clearanceQueryCount = 0;
    let clearanceRetryYieldCount = 0;
    let pairedSupportClearanceYieldCount = 0;
    let pairedSupportCount = 0;
    let pairedSupportLegCount = 0;
    let minimumRoadGap = Number.POSITIVE_INFINITY;
    let minimumSurfaceGap = Number.POSITIVE_INFINITY;
    let minimumPierHeight = Number.POSITIVE_INFINITY;
    let supportGroundContactError = 0;
    let maximumInvalidOutwardCapOverhang = 0;
    let minimumPierCapOverlap = Number.POSITIVE_INFINITY;
    let maximumGap = 0;
    let maximumGapEdgeId = null;
    let maximumGapStartS = null;
    let maximumGapEndS = null;
    let elevatedEdgeCount = 0;
    let unsupportedEdgeCount = 0;
    const unsupportedEdgeIds = [];
    const blockedByEdgeIds = new Set();
    const gapViolations = [];
    const designedLongSpans = [];
    const stationsByEdge = {};
    const coverageByEdge = {};
    const finalizationStats = [...edgeStats.values()];
    let finalizationCursor = 0;
    let result = null;
    let lastStepLabel = 'idle';

    /**
     * Resume exactly one clearance query for the current placement candidate. Track retains prebuilt route
     * variants for atomic switching; same-index variants outside this visual are mutually exclusive, so an
     * encountered inactive blocker is appended in historical order before the next resume. Returning `pending`
     * prevents one idle slice from synchronously consuming all 16 clearance retries.
     */
    function resumeSupportClearance(candidate) {
      const clearanceFrame = candidate.frames[candidate.clearanceLegCursor] || candidate.frame;
      const finishClearedLeg = (clearance) => {
        candidate.clearances[candidate.clearanceLegCursor] = clearance;
        if (candidate.clearanceLegCursor + 1 < candidate.frames.length) {
          candidate.clearanceLegCursor++;
          candidate.clearanceRetryCursor = 0;
          pairedSupportClearanceYieldCount++;
          clearanceStepResult.pending = true;
          clearanceStepResult.clearance = null;
          return clearanceStepResult;
        }
        clearanceStepResult.pending = false;
        clearanceStepResult.clearance = clearance;
        return clearanceStepResult;
      };
      if (typeof runtimeTrack.queryRoadClearance !== 'function') {
        return finishClearedLeg(null);
      }
      clearanceQueryCount++;
      const clearance = runtimeTrack.queryRoadClearance(
        clearanceFrame.x,
        clearanceFrame.z,
        supportClearanceRadius,
        {
          minimumGap: supportRoadGap,
          ignoreEdgeIds: candidate.ignoredEdgeIds,
          // Filter plan-view crossings by the complete world-vertical leg. Exact contact with the supported
          // deck remains valid, while a lower or overhead carriageway anywhere along this physical column blocks it.
          verticalEnvelope: {
            minY: candidate.groundYs[candidate.clearanceLegCursor],
            maxY: candidate.clearanceTopYs[candidate.clearanceLegCursor]
          }
        }
      );
      if (clearance?.clear !== false || !clearance.edgeId) {
        return finishClearedLeg(clearance);
      }
      const blocker = runtimeTrack.getEdge?.(clearance.edgeId);
      const inactiveSameIndexVariant = blocker
        && isRuntimeOnlyEdge(blocker)
        && blocker.tileIndex === activeSpec.edge.tileIndex
        && !currentRuntimeEdgeIds.has(blocker.id);
      if (!inactiveSameIndexVariant) {
        clearanceStepResult.pending = false;
        clearanceStepResult.clearance = clearance;
        return clearanceStepResult;
      }
      candidate.ignoredEdgeIds.push(blocker.id);
      inactiveVariantIgnoredEdgeIds.add(blocker.id);
      candidate.clearanceRetryCursor++;
      if (candidate.clearanceRetryCursor < 16) {
        clearanceRetryYieldCount++;
        clearanceStepResult.pending = true;
        clearanceStepResult.clearance = null;
        return clearanceStepResult;
      }
      clearanceStepResult.pending = false;
      clearanceStepResult.clearance = retryLimitClearance;
      return clearanceStepResult;
    }

    /**
     * Each deck may skip at most two of its declared bays. Ordinary roads retain 52m; the return flyover's
     * continuous box-girder contract explicitly owns its wider rhythm. Anything beyond that edge-local limit is
     * accepted only for the exact cable-stayed system with real supported endpoints and a raised deck.
     */
    function recordGap(stats, installedStations, startS, endS) {
      const edgeId = stats.edge.id;
      const gap = endS - startS;
      if (gap > stats.edgeStandardMaximumAllowedGap) {
        const contract = stats.edge.supportSpanContract;
        const endpointToleranceM = 0.001;
        const startSupported = installedStations.some(
          (station) => Math.abs(station - startS) <= endpointToleranceM
        );
        const endSupported = installedStations.some(
          (station) => Math.abs(station - endS) <= endpointToleranceM
        );
        const sampledHeights = [startS, (startS + endS) * 0.5, endS].map((station) => (
          Number(runtimeTrack.sampleEdge?.(edgeId, station, 0, supportSampleScratch)?.y)
        ));
        const minimumDeckSurfaceY = Number(contract?.minimumDeckSurfaceY) || 0;
        const raisedDeck = sampledHeights.every(
          (height) => Number.isFinite(height) && height >= minimumDeckSurfaceY - 0.001
        );
        const allowedGap = maximumAllowedGapByEdge[edgeId] || standardMaximumAllowedGap;
        const contractValid = contract?.kind === 'cable-stayed-box-girder';
        const endpointRequirementMet = contract?.requireSupportedEndpoints !== true
          || (startSupported && endSupported);
        if (
          contractValid
          && endpointRequirementMet
          && raisedDeck
          && gap <= allowedGap + 0.000_001
        ) {
          designedLongSpans.push(Object.freeze({
            edgeId,
            startS,
            endS,
            gap,
            startSupported,
            endSupported,
            minimumSampledDeckSurfaceY: Math.min(...sampledHeights),
            maximumAllowedGap: allowedGap,
            maximumUnsupportedSpanM: allowedGap,
            structureKind: contract.kind
          }));
        } else {
          const reason = !contractValid
            ? 'missing-long-span-contract'
            : !endpointRequirementMet
              ? 'missing-supported-endpoint'
              : !raisedDeck
                ? 'insufficient-deck-height'
                : 'span-limit';
          gapViolations.push(Object.freeze({
            edgeId,
            startS,
            endS,
            gap,
            maximumAllowedGap: allowedGap,
            reason
          }));
        }
      }
      if (!(gap > maximumGap)) return;
      maximumGap = gap;
      maximumGapEdgeId = edgeId;
      maximumGapStartS = startS;
      maximumGapEndS = endS;
    }

    /** Aggregate at most one edge per resume so diagnostic freezing cannot consume the parent idle callback. */
    function resumeFinalization() {
      if (result) return true;
      const stats = finalizationStats[finalizationCursor++];
      if (stats) {
        const installed = [...stats.installed].sort((a, b) => a - b);
        stationsByEdge[stats.edge.id] = Object.freeze(installed);
        if (stats.eligible.length === 0) {
          coverageByEdge[stats.edge.id] = Object.freeze([]);
          return false;
        }
        elevatedEdgeCount++;
        let edgeUnsupported = false;
        const coverageRanges = [];
        for (const segment of splitElevatedStationSegments(stats.eligible, stats.interval)) {
          const coverageStart = Math.max(0, segment[0] - stats.interval * 0.5);
          const coverageEnd = Math.min(
            stats.edge.length,
            segment[segment.length - 1] + stats.interval * 0.5
          );
          coverageRanges.push(Object.freeze([coverageStart, coverageEnd]));
          const installedStations = installed.filter((station) => (
            station >= coverageStart && station <= coverageEnd
          ));
          if (installedStations.length === 0) {
            edgeUnsupported = true;
            recordGap(stats, installedStations, coverageStart, coverageEnd);
            continue;
          }
          let previousS = coverageStart;
          for (const station of installedStations) {
            recordGap(stats, installedStations, previousS, station);
            previousS = station;
          }
          recordGap(stats, installedStations, previousS, coverageEnd);
        }
        coverageByEdge[stats.edge.id] = Object.freeze(coverageRanges);
        if (edgeUnsupported) {
          unsupportedEdgeCount++;
          unsupportedEdgeIds.push(stats.edge.id);
        }
        return false;
      }
      const groundDiagnostics = supportGroundHeightResolver.diagnostics();
      const routeExteriorPortalRecords = records.filter(
        (record) => record.supportKind === 'route-exterior-portal'
      );
      const maximumRouteExteriorPortalSpan = routeExteriorPortalRecords.reduce(
        (maximum, record) => Math.max(maximum, Number(record.portalSpan || record.capWidth) || 0),
        0
      );
      result = Object.freeze({
        records: Object.freeze(records),
        candidateCount,
        blockedCandidateCount,
        plannerSpecCount: candidates.length,
        plannerStepCount,
        placementCandidateCount,
        clearanceQueryCount,
        clearanceRetryYieldCount,
        pairedSupportClearanceYieldCount,
        pairedSupportCount,
        pairedSupportLegCount,
        routeExteriorPortalCount: routeExteriorPortalRecords.length,
        maximumRouteExteriorPortalSpan,
        elevatedEdgeCount,
        unsupportedEdgeCount,
        unsupportedEdgeIds: Object.freeze(unsupportedEdgeIds),
        blockedByEdgeIds: Object.freeze([...blockedByEdgeIds]),
        inactiveVariantIgnoredEdgeIds: Object.freeze([...inactiveVariantIgnoredEdgeIds]),
        elevatedSupportSpacing,
        // The legacy maximum reports the largest configured edge contract; consumers auditing ordinary roads
        // must use the per-edge map or standardMaximumAllowedGap instead of borrowing the crossover allowance.
        maximumAllowedGap: Math.max(
          standardMaximumAllowedGap,
          ...Object.values(maximumAllowedGapByEdge)
        ),
        standardMaximumAllowedGap,
        maximumAllowedGapByEdge: Object.freeze({ ...maximumAllowedGapByEdge }),
        supportSpacingByEdge: Object.freeze({ ...supportSpacingByEdge }),
        maximumAllowedGapForMaximumGapEdge:
          maximumAllowedGapByEdge[maximumGapEdgeId] || standardMaximumAllowedGap,
        maximumGap,
        maximumGapEdgeId,
        maximumGapStartS,
        maximumGapEndS,
        maximumGapStations: Object.freeze([...(stationsByEdge[maximumGapEdgeId] || [])]),
        maximumGapCoverage: coverageByEdge[maximumGapEdgeId] || null,
        gapViolationCount: gapViolations.length,
        gapViolations: Object.freeze(gapViolations),
        designedLongSpanCount: designedLongSpans.length,
        designedLongSpans: Object.freeze(designedLongSpans),
        stationsByEdge: Object.freeze(stationsByEdge),
        coverageByEdge: Object.freeze(coverageByEdge),
        minimumRoadGap: Number.isFinite(minimumRoadGap) ? minimumRoadGap : null,
        minimumSurfaceGap: Number.isFinite(minimumSurfaceGap) ? minimumSurfaceGap : null,
        minimumPierHeight: Number.isFinite(minimumPierHeight) ? minimumPierHeight : null,
        supportClearanceRadius,
        supportGroundY: groundDiagnostics.fallbackGroundY,
        supportGroundHeightSource: groundDiagnostics.source,
        supportGroundHeightSampleCount: groundDiagnostics.sampleCount,
        supportGroundHeightFallbackCount: groundDiagnostics.fallbackCount,
        minimumSupportGroundY: groundDiagnostics.minimumGroundY,
        maximumSupportGroundY: groundDiagnostics.maximumGroundY,
        groundContactError: supportGroundContactError,
        maximumInvalidOutwardCapOverhang,
        minimumPierCapOverlap: Number.isFinite(minimumPierCapOverlap)
          ? minimumPierCapOverlap
          : null
      });
      return true;
    }

    function finishActiveSpec(installed) {
      if (!installed) blockedCandidateCount++;
      cursor++;
      activeSpec = null;
      activeStats = null;
      activeSpecEligibilityResolved = false;
      activeCandidate = null;
      searchCursor = 0;
      lateralCursor = 0;
      readyToFinalize = cursor >= candidates.length;
    }

    function advancePlacementCandidate() {
      activeCandidate = null;
      lateralCursor++;
      if (lateralCursor < activeSpec.lateralOffsets.length) return;
      lateralCursor = 0;
      searchCursor++;
      if (searchCursor >= RUNTIME_SUPPORT_SEARCH_INDICES.length) finishActiveSpec(false);
    }

    /** Commit a terminal clearance decision without yielding an accepted-but-uninstalled support record. */
    function finishPlacementCandidate(clearance) {
      const { edgeS, frame, frames, undersideY, undersideYs } = activeCandidate;
      let nearestSupportGap = Number.POSITIVE_INFINITY;
      let clearsSupports = true;
      const sharedCenters = [];
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const supportFrame = frames[frameIndex];
        let sharedCenter = null;
        for (const center of centers) {
          const centerDistance = Math.hypot(
            supportFrame.x - center.x,
            supportFrame.z - center.z
          );
          const gap = centerDistance - supportClearanceRadius * 2;
          nearestSupportGap = Math.min(nearestSupportGap, gap);
          if (gap < supportGap) {
            clearsSupports = false;
            if (!sharedCenter
              && centerDistance < supportClearanceRadius * 2 + supportGap
              && Math.abs(undersideYs[frameIndex] - center.undersideY) <= 0.75) {
              sharedCenter = center;
            }
          }
        }
        sharedCenters.push(sharedCenter);
      }
      if (clearance?.clear === false) {
        if (clearance.edgeId) blockedByEdgeIds.add(clearance.edgeId);
        advancePlacementCandidate();
        return;
      }
      if (!clearsSupports) {
        if (sharedCenters.every(Boolean)) {
          activeStats.installed.push(edgeS);
          finishActiveSpec(true);
          return;
        }
        advancePlacementCandidate();
        return;
      }
      frame.supportPairFrames = frames.length === 2 ? frames : null;
      frame.supportKind = frames.length === 2 ? 'route-exterior-portal' : 'single-column';
      const record = composeRecord(frame, activeSpec.edge.id, edgeS);
      records.push(record);
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        centers.push({
          x: frames[frameIndex].x,
          z: frames[frameIndex].z,
          undersideY: undersideYs[frameIndex]
        });
      }
      if (frames.length === 2) {
        pairedSupportCount++;
        pairedSupportLegCount += 2;
      }
      activeStats.installed.push(edgeS);
      minimumPierHeight = Math.min(minimumPierHeight, record.height);
      supportGroundContactError = Math.max(
        supportGroundContactError,
        Number(record.groundContactError) || 0
      );
      maximumInvalidOutwardCapOverhang = Math.max(
        maximumInvalidOutwardCapOverhang,
        Number(record.invalidOutwardCapOverhang) || 0
      );
      if (Number.isFinite(record.pierCapOverlap)) {
        minimumPierCapOverlap = Math.min(minimumPierCapOverlap, record.pierCapOverlap);
      }
      for (const legClearance of activeCandidate.clearances) {
        if (Number.isFinite(legClearance?.clearance)) {
          minimumRoadGap = Math.min(
            minimumRoadGap,
            legClearance.clearance + supportRoadGap
          );
        }
      }
      if (Number.isFinite(nearestSupportGap)) {
        minimumSurfaceGap = Math.min(minimumSurfaceGap, nearestSupportGap);
      }
      finishActiveSpec(true);
    }

    function beginActiveSpec() {
      activeSpec = candidates[cursor];
      activeStats = edgeStats.get(activeSpec.edge.id);
      activeSpecEligibilityResolved = false;
    }

    function beginPlacementCandidate() {
      const searchIndex = RUNTIME_SUPPORT_SEARCH_INDICES[searchCursor];
      const edgeS = clamp(
        activeSpec.initialS + activeSpec.searchDirection * searchIndex * activeSpec.interval * 0.25,
        0,
        activeSpec.edge.length
      );
      const placement = activeSpec.lateralOffsets[lateralCursor];
      let laterals = Number.isFinite(placement) ? [placement] : [];
      if (placement?.kind === 'dynamic-single-column' || placement?.kind === 'route-exterior-portal') {
        const centerFrame = sample(
          runtimeTrack,
          activeSpec.edge.id,
          edgeS,
          0,
          supportSampleScratch,
          supportFrameScratch
        );
        const roadHalfAtStation = Number(centerFrame.roadHalf)
          || Number(activeSpec.edge.roadHalf ?? activeSpec.edge.halfWidth)
          || 0;
        const sideOffset = Math.max(0, roadHalfAtStation - supportClearanceRadius - 0.9);
        const outerOffset = roadHalfAtStation + supportClearanceRadius + supportRoadGap + 3;
        if (placement.kind === 'dynamic-single-column') {
          laterals = [
            placement.side * (placement.zone === 'outer' ? outerOffset : sideOffset)
          ];
        } else {
          const portalLevelOffset = (level) => outerOffset + roadHalfAtStation * (
            level === 'far' ? 3.25 : level === 'middle' ? 1.85 : 0.65
          );
          laterals = [
            -portalLevelOffset(placement.leftLevel),
            portalLevelOffset(placement.rightLevel)
          ];
        }
      }
      if (laterals.length === 0 || laterals.length > 2) {
        throw new Error(`Runtime support has an invalid lateral placement: ${activeSpec.edge.id}`);
      }
      reusablePlacementCandidate.frames.length = 0;
      reusablePlacementCandidate.undersideYs.length = 0;
      reusablePlacementCandidate.clearanceTopYs.length = 0;
      reusablePlacementCandidate.groundYs.length = 0;
      reusablePlacementCandidate.clearances.length = 0;
      for (let legIndex = 0; legIndex < laterals.length; legIndex++) {
        const frame = sample(
          runtimeTrack,
          activeSpec.edge.id,
          edgeS,
          laterals[legIndex],
          legIndex === 0 ? supportSampleScratch : supportSampleScratchB,
          legIndex === 0 ? supportFrameScratch : supportFrameScratchB
        );
        frame.supportLateral = laterals[legIndex];
        // Runtime support composition must inherit the authored carriageway width even when a lightweight sampler
        // omits the visual-only roadHalf field; otherwise exterior caps can collapse back to single-column sizing.
        frame.roadHalf = Number.isFinite(frame.roadHalf)
          ? frame.roadHalf
          : Number(activeSpec.edge.roadHalf ?? activeSpec.edge.halfWidth) || 0;
        frame.supportPairFrames = null;
        frame.supportKind = laterals.length === 2 ? 'route-exterior-portal' : 'single-column';
        reusablePlacementCandidate.frames.push(frame);
        const undersideY = verticalSupportDeckUndersideY(frame, deckThickness);
        const groundY = supportGroundHeightResolver.sample(frame.x, frame.z, {
          edgeId: activeSpec.edge.id,
          edgeS,
          lateral: laterals[legIndex],
          supportKind: frame.supportKind
        });
        frame.supportGroundY = groundY;
        reusablePlacementCandidate.undersideYs.push(undersideY);
        reusablePlacementCandidate.clearanceTopYs.push(
          laterals.length === 2
            ? frame.y + routeExteriorPortalClearHeight
            : undersideY
        );
        reusablePlacementCandidate.groundYs.push(groundY);
      }
      const frame = reusablePlacementCandidate.frames[0];
      const undersideY = reusablePlacementCandidate.undersideYs[0];
      if (!activeSpecEligibilityResolved) {
        activeSpecEligibilityResolved = true;
        if (undersideY - reusablePlacementCandidate.groundYs[0] < minimumVisiblePierHeight) {
          cursor++;
          activeSpec = null;
          activeStats = null;
          activeSpecEligibilityResolved = false;
          activeCandidate = null;
          searchCursor = 0;
          lateralCursor = 0;
          readyToFinalize = cursor >= candidates.length;
          return false;
        }
        activeStats.eligible.push(activeSpec.initialS);
        candidateCount++;
      }
      placementCandidateCount++;
      if (reusablePlacementCandidate.undersideYs.some((candidateUndersideY, legIndex) => (
        candidateUndersideY - reusablePlacementCandidate.groundYs[legIndex]
          < minimumVisiblePierHeight
      ))) {
        advancePlacementCandidate();
        return false;
      }
      reusablePlacementCandidate.edgeS = edgeS;
      reusablePlacementCandidate.frame = frame;
      reusablePlacementCandidate.undersideY = undersideY;
      reusablePlacementCandidate.clearanceLegCursor = 0;
      reusablePlacementCandidate.ignoredEdgeIds.length = 0;
      for (const edgeId of activeSpec.ignoredEdgeIds) {
        reusablePlacementCandidate.ignoredEdgeIds.push(edgeId);
      }
      reusablePlacementCandidate.clearanceRetryCursor = 0;
      activeCandidate = reusablePlacementCandidate;
      return true;
    }

    /**
     * Resume at most one station/lateral candidate and one clearance query. A retry keeps the sampled frame and
     * ignore list for the next idle callback; terminal clearance, spacing, and detached-record commit stay atomic.
     */
    function step() {
      if (complete) return true;
      plannerStepCount++;
      if (readyToFinalize) {
        lastStepLabel = finalizationCursor < finalizationStats.length
          ? 'finalize-edge'
          : 'finalize-publish';
        complete = resumeFinalization();
        return complete;
      }
      if (!activeSpec) {
        lastStepLabel = 'sample-initial-candidate';
        beginActiveSpec();
        beginPlacementCandidate();
        return false;
      }
      if (!activeCandidate) {
        lastStepLabel = 'sample-search-candidate';
        beginPlacementCandidate();
        return false;
      }
      lastStepLabel = 'clearance-candidate';
      const clearanceStep = resumeSupportClearance(activeCandidate);
      if (clearanceStep.pending) return false;
      finishPlacementCandidate(clearanceStep.clearance);
      return false;
    }

    function finish() {
      if (!complete) throw new Error('Runtime bridge-support layout is not complete');
      return result;
    }

    const diagnostics = Object.freeze({
      get lastStepLabel() { return lastStepLabel; },
      get finalizationCursor() { return finalizationCursor; },
      get finalizationEdgeCount() { return finalizationStats.length; }
    });
    return Object.freeze({ step, finish, diagnostics });
  }

  /** Run the production runtime-support planner without WebGL so every fork direction stays regression-testable. */
  function inspectRuntimeSupportLayout(runtimeTrack, runtimeEdges, options = {}) {
    const contract = runtimeTrack?.graph?.contract || {};
    const supportGroundHeightResolver = createSupportGroundHeightResolver(options, runtimeTrack);
    const job = createRuntimeSupportPlacementJob({
      runtimeTrack,
      runtimeEdges,
      deckThickness: Number(options.deckThickness ?? contract.deckThickness) || 0.92,
      supportGroundHeightResolver,
      minimumVisiblePierHeight: Number(options.minimumVisiblePierHeight) || 2.2,
      elevatedSupportSpacing: Number(options.elevatedSupportSpacing) || 52,
      supportRadius: Number(options.supportRadius ?? contract.bridgeSupportRadius)
        || Number(contract.bridgePierRadius)
        || 0.62,
      supportClearanceRadius: Math.max(
        Number(options.supportClearanceRadius) || 0,
        BRIDGE_SUPPORT_FOOTING_CLEARANCE_RADIUS
      ),
      supportRoadGap: Number(options.supportRoadGap ?? contract.bridgeRoadGap) || 1,
      supportGap: Number(options.supportGap ?? contract.bridgeSupportGap) || 0.35,
      permanentSupportCenters: options.permanentSupportCenters || []
    });
    while (!job.step(1_000)) {
      // The production planner owns the slice boundary; this audit only drains those bounded slices.
    }
    return job.finish();
  }

  /** Audit one dynamic road batch without granting its visual-only corridors gameplay authority. */
  function bidirectionalCoverageMetrics(edges, tileIndex) {
    const coveredPorts = new Set();
    let opposingConnectorCount = 0;
    let visualEdgeCount = 0;
    let gameplayViolationCount = 0;
    for (const edge of edges || []) {
      const role = edge?.bidirectionalRole || edge?.visualRole || null;
      const port = edge?.bidirectionalPort || edge?.visualPort || null;
      if (edge?.visualOnly === true) {
        visualEdgeCount++;
        if (role === 'outbound-extension' && port) coveredPorts.add(port);
        if (role === 'opposing-intertile') opposingConnectorCount++;
        if (
          edge.collisionEnabled !== false
          || edge.gameplayReachable !== false
          || edge.gameplayRandom !== false
          || (edge.successors?.length || 0) !== 0
        ) {
          gameplayViolationCount++;
        }
      } else if (edge?.runtimeKind === 'recovery' && edge?.exitPort) {
        coveredPorts.add(edge.exitPort);
      }
    }
    const expectedConnectorCount = Number(tileIndex) > 0 ? 1 : 0;
    return Object.freeze({
      coveredPortCount: coveredPorts.size,
      coverageMissCount: Math.max(0, 4 - coveredPorts.size),
      opposingConnectorCount,
      connectorCountError: Math.abs(opposingConnectorCount - expectedConnectorCount),
      visualEdgeCount,
      gameplayViolationCount
    });
  }

  function geometryFromLinePositions(THREE, positions) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Edge and ramp markings retain distinct colors while sharing one LineSegments draw group. */
  function createStaticLineBatchGeometry(THREE, generalGeometry, rampGeometry) {
    const general = generalGeometry?.getAttribute?.('position')?.array || new Float32Array();
    const ramp = rampGeometry?.getAttribute?.('position')?.array || new Float32Array();
    const positions = new Float32Array(general.length + ramp.length);
    positions.set(general, 0);
    positions.set(ramp, general.length);
    const colors = new Float32Array(positions.length);
    const generalColor = new THREE.Color(0xd2_d1_ca);
    const rampColor = new THREE.Color(0xc9_c5_ba);
    for (let offset = 0; offset < general.length; offset += 3) {
      colors[offset] = generalColor.r;
      colors[offset + 1] = generalColor.g;
      colors[offset + 2] = generalColor.b;
    }
    for (let offset = general.length; offset < positions.length; offset += 3) {
      colors[offset] = rampColor.r;
      colors[offset + 1] = rampColor.g;
      colors[offset + 2] = rampColor.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    geometry.userData.generalComponentCount = general.length;
    return geometry;
  }

  /** Convert authored line pairs into a thin opaque PBR ribbon used only by the High presentation tier. */
  function createRoadMarkingRibbonGeometry(THREE, lineGeometry, width = 0.19, lift = 0.006) {
    const sourcePosition = lineGeometry?.getAttribute?.('position');
    const sourceColor = lineGeometry?.getAttribute?.('color');
    const segmentCount = Math.floor((sourcePosition?.count || 0) / 2);
    const positions = new Float32Array(segmentCount * 4 * 3);
    const colors = new Float32Array(positions.length);
    const uvs = new Float32Array(segmentCount * 4 * 2);
    const IndexArray = segmentCount * 4 > 65_535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(segmentCount * 6);
    const halfWidth = width * 0.5;
    for (let segment = 0; segment < segmentCount; segment++) {
      const aIndex = segment * 2;
      const bIndex = aIndex + 1;
      const ax = sourcePosition.getX(aIndex);
      const ay = sourcePosition.getY(aIndex) + lift;
      const az = sourcePosition.getZ(aIndex);
      const bx = sourcePosition.getX(bIndex);
      const by = sourcePosition.getY(bIndex) + lift;
      const bz = sourcePosition.getZ(bIndex);
      const inversePlanLength = 1 / Math.max(0.000_001, Math.hypot(bx - ax, bz - az));
      const offsetX = -(bz - az) * inversePlanLength * halfWidth;
      const offsetZ = (bx - ax) * inversePlanLength * halfWidth;
      const vertexOffset = segment * 4;
      const values = [
        ax - offsetX, ay, az - offsetZ,
        ax + offsetX, ay, az + offsetZ,
        bx - offsetX, by, bz - offsetZ,
        bx + offsetX, by, bz + offsetZ
      ];
      positions.set(values, vertexOffset * 3);
      for (let vertex = 0; vertex < 4; vertex++) {
        const sourceIndex = vertex < 2 ? aIndex : bIndex;
        const target = (vertexOffset + vertex) * 3;
        colors[target] = sourceColor ? sourceColor.getX(sourceIndex) : 1;
        colors[target + 1] = sourceColor ? sourceColor.getY(sourceIndex) : 1;
        colors[target + 2] = sourceColor ? sourceColor.getZ(sourceIndex) : 1;
      }
      uvs.set([0, 0, 1, 0, 0, 1, 1, 1], vertexOffset * 2);
      const indexOffset = segment * 6;
      indices.set([
        vertexOffset, vertexOffset + 2, vertexOffset + 1,
        vertexOffset + 1, vertexOffset + 2, vertexOffset + 3
      ], indexOffset);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.neonV23UltraRoadMarking = true;
    return geometry;
  }

  /**
   * Build every track-authored jump platform as a closed wedge while leaving the underlying recovery ribbon flat.
   * The returned geometry is merged into the existing recovery-road shell, so all size/lateral variants remain
   * independent physical silhouettes without adding a scene object, material, or draw call.
   */
  function createJumpPlatformBatchGeometry({ THREE, track, edges, tileOrigin = Object.freeze({ x: 0, z: 0 }) }) {
    if (!THREE?.BufferGeometry || typeof track?.sampleEdge !== 'function') {
      throw new Error('Jump-platform geometry requires THREE and the track edge sampler');
    }
    const sourceEdges = Array.isArray(edges) ? edges : [];
    const platforms = [];
    for (const edge of sourceEdges) {
      for (const platform of edge?.jumpPlatforms || []) platforms.push({ edge, platform });
    }
    const positions = [];
    const colors = [];
    const roadCoordinates = [];
    const indices = [];
    const topColor = new THREE.Color(0xc9_d2_cd);
    const sideColor = new THREE.Color(0x7d_8e_8f);
    const lipColor = new THREE.Color(0xd9_c8_88);
    const undersideColor = new THREE.Color(0x5f_6d_70);
    const edgeIds = new Set();
    const variants = new Set();
    const dimensionSignatures = new Set();
    const platformIds = new Set();
    let minimumWidthM = Number.POSITIVE_INFINITY;
    let maximumWidthM = 0;
    let minimumHeightM = Number.POSITIVE_INFINITY;
    let maximumHeightM = 0;
    let minimumLengthM = Number.POSITIVE_INFINITY;
    let maximumLengthM = 0;
    let maximumAbsLateralM = 0;
    // Road shells place their visible crown 0.10m above the track sampler. The platform starts 2mm above that
    // crown and keeps its underside 6mm below it, avoiding flicker without changing track-owned support height.
    const roadCrownOffsetM = 0.10;
    const platformStartSeparationM = 0.002;
    const platformBottomOffsetM = roadCrownOffsetM - 0.006;

    const pointAt = (frame, vertical) => ({
      x: frame.x - (Number(tileOrigin.x) || 0) + frame.upX * vertical,
      y: frame.y + frame.upY * vertical,
      z: frame.z - (Number(tileOrigin.z) || 0) + frame.upZ * vertical
    });
    const averageDirection = (a, b, prefix) => {
      const x = Number(a?.[`${prefix}X`]) + Number(b?.[`${prefix}X`]);
      const y = Number(a?.[`${prefix}Y`]) + Number(b?.[`${prefix}Y`]);
      const z = Number(a?.[`${prefix}Z`]) + Number(b?.[`${prefix}Z`]);
      const inverseLength = 1 / Math.max(0.000_001, Math.hypot(x, y, z));
      return { x: x * inverseLength, y: y * inverseLength, z: z * inverseLength };
    };
    const negate = (vector) => ({ x: -vector.x, y: -vector.y, z: -vector.z });

    /**
     * Faces duplicate their four vertices so computed normals stay deliberately hard at the lip and side walls.
     * The expected normal makes winding independent of route heading and of the sampler's right/up convention.
     */
    function appendQuad(points, shade, coordinates, expectedNormal) {
      const baseVertex = positions.length / 3;
      for (let index = 0; index < 4; index++) {
        const point = points[index];
        positions.push(point.x, point.y, point.z);
        colors.push(shade.r, shade.g, shade.b);
        roadCoordinates.push(coordinates[index][0], coordinates[index][1]);
      }
      const ab = {
        x: points[1].x - points[0].x,
        y: points[1].y - points[0].y,
        z: points[1].z - points[0].z
      };
      const ac = {
        x: points[2].x - points[0].x,
        y: points[2].y - points[0].y,
        z: points[2].z - points[0].z
      };
      const normal = {
        x: ab.y * ac.z - ab.z * ac.y,
        y: ab.z * ac.x - ab.x * ac.z,
        z: ab.x * ac.y - ab.y * ac.x
      };
      const forwardWinding = normal.x * expectedNormal.x
        + normal.y * expectedNormal.y
        + normal.z * expectedNormal.z >= 0;
      if (forwardWinding) {
        indices.push(
          baseVertex, baseVertex + 1, baseVertex + 2,
          baseVertex, baseVertex + 2, baseVertex + 3
        );
      } else {
        indices.push(
          baseVertex, baseVertex + 2, baseVertex + 1,
          baseVertex, baseVertex + 3, baseVertex + 2
        );
      }
    }

    for (const { edge, platform } of platforms) {
      const startS = Number(platform.startS);
      const lipS = Number(platform.lipS);
      const endS = Number(platform.endS);
      const length = Number(platform.length);
      const ascent = Number(platform.ascent);
      const width = Number(platform.width);
      const halfWidth = Number(platform.halfWidth);
      const lateral = Number(platform.lateral);
      const height = Number(platform.height);
      const grade = Number(platform.grade);
      const roadHalf = Number(edge.roadHalf || edge.halfWidth);
      const planarLength = Number.isFinite(edge.planarLength) ? Number(edge.planarLength) : Number(edge.length);
      const horizontalAscent = ascent * planarLength / Math.max(0.000_001, Number(edge.length));
      const invalid = !platform.id
        || platformIds.has(platform.id)
        || platform.edgeId !== edge.id
        || platform.launchable !== true
        || !Number.isFinite(startS)
        || !Number.isFinite(lipS)
        || !Number.isFinite(endS)
        || !Number.isFinite(length)
        || !Number.isFinite(ascent)
        || !Number.isFinite(width)
        || !Number.isFinite(halfWidth)
        || !Number.isFinite(lateral)
        || !Number.isFinite(height)
        || !Number.isFinite(grade)
        || !(startS >= 0 && startS < lipS && lipS <= endS && endS <= edge.length + 0.000_001)
        || Math.abs(length - (endS - startS)) > 0.000_001
        || Math.abs(ascent - (lipS - startS)) > 0.000_001
        || Math.abs(width - halfWidth * 2) > 0.000_001
        || Math.abs(grade - height / horizontalAscent) > 0.000_001
        || !(width > 0 && height > 0 && ascent > 0)
        || !(planarLength > 0 && horizontalAscent > 0)
        || !(roadHalf > 0)
        || Math.abs(lateral) + halfWidth > roadHalf + 0.000_001;
      if (invalid) {
        throw new Error(`Invalid jump-platform visual contract: ${platform.id || edge.id}`);
      }
      platformIds.add(platform.id);
      edgeIds.add(edge.id);
      variants.add(String(platform.variant || 'default'));
      dimensionSignatures.add(`${width.toFixed(6)}:${height.toFixed(6)}:${length.toFixed(6)}:${lateral.toFixed(6)}`);
      minimumWidthM = Math.min(minimumWidthM, width);
      maximumWidthM = Math.max(maximumWidthM, width);
      minimumHeightM = Math.min(minimumHeightM, height);
      maximumHeightM = Math.max(maximumHeightM, height);
      minimumLengthM = Math.min(minimumLengthM, length);
      maximumLengthM = Math.max(maximumLengthM, length);
      maximumAbsLateralM = Math.max(maximumAbsLateralM, Math.abs(lateral));

      const stationSpecs = [
        { s: startS, height: roadCrownOffsetM + platformStartSeparationM },
        { s: lipS, height: roadCrownOffsetM + height },
        { s: endS, height: roadCrownOffsetM + height }
      ].filter((station, index, array) => index === 0 || station.s > array[index - 1].s + 0.000_001);
      const rows = stationSpecs.map((station) => {
        const leftFrame = sample(track, edge.id, station.s, lateral - halfWidth, {});
        const rightFrame = sample(track, edge.id, station.s, lateral + halfWidth, {});
        return {
          s: station.s,
          leftFrame,
          rightFrame,
          topLeft: pointAt(leftFrame, station.height),
          topRight: pointAt(rightFrame, station.height),
          bottomLeft: pointAt(leftFrame, platformBottomOffsetM),
          bottomRight: pointAt(rightFrame, platformBottomOffsetM)
        };
      });
      const leftRoadCoordinate = (lateral - halfWidth) / roadHalf;
      const rightRoadCoordinate = (lateral + halfWidth) / roadHalf;

      for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
        const before = rows[rowIndex - 1];
        const after = rows[rowIndex];
        const up = averageDirection(before.leftFrame, after.leftFrame, 'up');
        const right = averageDirection(before.leftFrame, after.leftFrame, 'right');
        const tangent = averageDirection(before.leftFrame, after.leftFrame, 'tangent');
        const topCoordinates = [
          [leftRoadCoordinate, before.s],
          [rightRoadCoordinate, before.s],
          [rightRoadCoordinate, after.s],
          [leftRoadCoordinate, after.s]
        ];
        appendQuad(
          [before.topLeft, before.topRight, after.topRight, after.topLeft],
          topColor,
          topCoordinates,
          up
        );
        appendQuad(
          [before.topLeft, after.topLeft, after.bottomLeft, before.bottomLeft],
          sideColor,
          [
            [leftRoadCoordinate, before.s],
            [leftRoadCoordinate, after.s],
            [leftRoadCoordinate, after.s],
            [leftRoadCoordinate, before.s]
          ],
          negate(right)
        );
        appendQuad(
          [before.topRight, before.bottomRight, after.bottomRight, after.topRight],
          sideColor,
          [
            [rightRoadCoordinate, before.s],
            [rightRoadCoordinate, before.s],
            [rightRoadCoordinate, after.s],
            [rightRoadCoordinate, after.s]
          ],
          right
        );
        appendQuad(
          [before.bottomLeft, after.bottomLeft, after.bottomRight, before.bottomRight],
          undersideColor,
          [
            [leftRoadCoordinate, before.s],
            [leftRoadCoordinate, after.s],
            [rightRoadCoordinate, after.s],
            [rightRoadCoordinate, before.s]
          ],
          negate(up)
        );
        if (rowIndex === 1) {
          appendQuad(
            [before.topLeft, before.bottomLeft, before.bottomRight, before.topRight],
            sideColor,
            [
              [leftRoadCoordinate, before.s],
              [leftRoadCoordinate, before.s],
              [rightRoadCoordinate, before.s],
              [rightRoadCoordinate, before.s]
            ],
            negate(tangent)
          );
        }
        if (rowIndex === rows.length - 1) {
          appendQuad(
            [after.topLeft, after.topRight, after.bottomRight, after.bottomLeft],
            lipColor,
            [
              [leftRoadCoordinate, after.s],
              [rightRoadCoordinate, after.s],
              [rightRoadCoordinate, after.s],
              [leftRoadCoordinate, after.s]
            ],
            tangent
          );
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('roadCoord', new THREE.Float32BufferAttribute(roadCoordinates, 2));
    const IndexArray = positions.length / 3 > 65_535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    Object.assign(geometry.userData, {
      neonV23JumpPlatformGeometry: true,
      jumpPlatformCount: platforms.length,
      jumpPlatformEdgeCount: edgeIds.size,
      jumpPlatformVariantCount: variants.size,
      jumpPlatformDimensionSignatureCount: dimensionSignatures.size,
      jumpPlatformVertexCount: positions.length / 3,
      jumpPlatformTriangleCount: indices.length / 3,
      jumpPlatformMinimumWidthM: Number.isFinite(minimumWidthM) ? minimumWidthM : 0,
      jumpPlatformMaximumWidthM: maximumWidthM,
      jumpPlatformMinimumHeightM: Number.isFinite(minimumHeightM) ? minimumHeightM : 0,
      jumpPlatformMaximumHeightM: maximumHeightM,
      jumpPlatformMinimumLengthM: Number.isFinite(minimumLengthM) ? minimumLengthM : 0,
      jumpPlatformMaximumLengthM: maximumLengthM,
      jumpPlatformMaximumAbsLateralM: maximumAbsLateralM,
      jumpPlatformAdditionalDrawGroupCount: 0,
      jumpPlatformAdditionalObjectCount: 0
    });
    return geometry;
  }

  /** Copy the source line palette into its four-vertex-per-segment PBR counterpart. */
  function syncRoadMarkingRibbonColors(lineGeometry, ribbonGeometry) {
    const source = lineGeometry?.getAttribute?.('color');
    const target = ribbonGeometry?.getAttribute?.('color');
    if (!source || !target) return;
    const segmentCount = Math.min(Math.floor(source.count / 2), Math.floor(target.count / 4));
    for (let segment = 0; segment < segmentCount; segment++) {
      for (let vertex = 0; vertex < 4; vertex++) {
        const sourceIndex = segment * 2 + (vertex < 2 ? 0 : 1);
        const targetIndex = segment * 4 + vertex;
        target.setXYZ(
          targetIndex,
          source.getX(sourceIndex),
          source.getY(sourceIndex),
          source.getZ(sourceIndex)
        );
      }
    }
    target.needsUpdate = true;
  }

  /** Build broad, restrained concrete normal/roughness maps; anisotropy is assigned centrally by the runtime. */
  function createProceduralRoadTextureSet(THREE, size = 64) {
    const texelCount = size * size;
    const heights = new Float32Array(texelCount);
    const normalData = new Uint8Array(texelCount * 4);
    const roughnessData = new Uint8Array(texelCount * 4);
    const sampleHeight = (x, y) => {
      const wrappedX = (x + size) % size;
      const wrappedY = (y + size) % size;
      return heights[wrappedY * size + wrappedX];
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hash = Math.sin((x * 127.1 + y * 311.7) * 0.017_453_292_52) * 43_758.545_3;
        const grain = hash - Math.floor(hash);
        heights[y * size + x] = grain * 0.72
          + Math.sin(x * 0.73 + y * 0.21) * 0.14
          + Math.sin(x * 0.13 - y * 0.61) * 0.14;
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = y * size + x;
        const offset = index * 4;
        const dx = sampleHeight(x + 1, y) - sampleHeight(x - 1, y);
        const dy = sampleHeight(x, y + 1) - sampleHeight(x, y - 1);
        const inverseLength = 1 / Math.hypot(dx * 1.8, dy * 1.8, 1);
        normalData[offset] = Math.round(((-dx * 1.8 * inverseLength) * 0.5 + 0.5) * 255);
        normalData[offset + 1] = Math.round(((-dy * 1.8 * inverseLength) * 0.5 + 0.5) * 255);
        normalData[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
        normalData[offset + 3] = 255;
        const roughness = Math.max(0, Math.min(1, 0.58 + (heights[index] - 0.5) * 0.102));
        roughnessData[offset] = roughnessData[offset + 1] = roughnessData[offset + 2]
          = Math.round(roughness * 255);
        roughnessData[offset + 3] = 255;
      }
    }
    const configure = (texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1.25, 0.162_5);
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      if ('colorSpace' in texture && THREE.NoColorSpace !== undefined) texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      return texture;
    };
    return Object.freeze({
      normal: configure(new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat)),
      roughness: configure(new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat))
    });
  }

  const STATIC_TUNNEL_IRRADIANCE_CONTRACT = Object.freeze({
    version: 2,
    attribute: 'staticTunnelIrradiance',
    colorLinear: Object.freeze([1, 0.74, 0.42]),
    underground: Object.freeze({ floor: 0.10, peak: 0.38 }),
    mountain: Object.freeze({ floor: 0.08, peak: 0.30 }),
    receiverGain: Object.freeze({
      shellInterior: 0.72,
      shellExteriorBounce: 0.08,
      structuralRib: 0.48,
      luminaireHousing: 0.24
    }),
    distanceGated: false,
    additionalDrawGroupCount: 0,
    additionalObjectCount: 0
  });

  /*
   * FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT v1 / Film 道路结构避让合同 v1
   *
   * Film consumes retained absolute-world cylinders derived from the exact published instance matrices. The
   * records are presentation-only: they may move the lens, but never replace Track, collision, support placement,
   * or route-variant authority. Continuous tunnel walls and roofs are deliberately not duplicated as thousands of
   * cylinders because their complete drivable cross-section is already the finite sampleEdge floor/ceiling contract.
   */
  const FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT = Object.freeze({
    version: 1,
    coordinateMode: 'absolute-world-cylinder',
    geometryAuthority: 'published-instanced-mesh-matrix-and-local-bounds',
    lifecycleAuthority: 'tile-visibility-and-active-route-variant',
    includedFamilies: Object.freeze([
      'bridge-pier',
      'bridge-capital-and-footing',
      'bridge-crossbeam',
      'tunnel-rib-portal-and-housing',
      'layered-bridge-detail',
      'runtime-long-span-structure',
      'physical-gore-nose',
      'decision-pylon',
      'exit-sign'
    ]),
    continuousTunnelShellAuthority: 'sampleEdge-finite-floor-and-ceiling',
    continuousTunnelShellDuplicatedAsCylinders: false,
    invariants: Object.freeze({
      gameplayAuthority: 'unchanged-track-collision-and-clearance',
      poolAuthority: 'unchanged-preallocated-render-instances',
      stableFrameAllocations: 0,
      variantPublication: 'rewrite-retained-records-before-visible-use'
    })
  });

  /*
   * SKY_ROUTE_SCENERY_CONTRACT v2 / 天路景物合同 v2
   *
   * This is an original ethereal-pilgrimage interpretation rather than a copy of any shipped asset. Geometry and
   * finish may become richer, but the route graph, collision sampler, prepared instance capacities, and proven
   * clearance matrices remain the sole gameplay authorities. Freezing the complete art contract makes a future
   * material or LOD pass fail loudly if it reintroduces chrome, steel trusses, proximity-switched lamps, or a
   * larger collision silhouette behind a presentation-only change.
   */
  const SKY_ROUTE_SCENERY_CONTRACT = Object.freeze({
    version: 2,
    intent: Object.freeze({
      zhCN: '以风蚀暖石、花瓣与菱形柱冠承托天路，并用恒亮烛星引导隧道；精致但安静，不复制现成资产。',
      en: 'Carry the sky route on wind-eroded warm stone and petal-diamond capitals, guided by constant candle-stars; refined, quiet, and original.'
    }),
    geometry: Object.freeze({
      pier: Object.freeze({
        topology: 'sealed-indexed-wind-eroded-radial-stone',
        profileRingCount: 16,
        radialSegments: 32,
        radiusScaleMaximum: 1,
        localVerticalEnvelope: Object.freeze([-0.5, 0.5])
      }),
      capitalAndFoundation: Object.freeze({
        topology: 'sealed-indexed-four-petal-diamond-prism',
        outlinePointCount: 16,
        axialRingCount: 6,
        localEnvelope: Object.freeze([-0.5, 0.5])
      }),
      portalAndRib: Object.freeze({
        topology: 'sealed-indexed-carved-warm-stone-prism',
        outlinePointCount: 12,
        axialRingCount: 6,
        localEnvelope: Object.freeze([-0.5, 0.5])
      }),
      tunnelShell: Object.freeze({
        topology: 'continuous-indexed-wind-eroded-stone-shell',
        stationAuthority: 'shared-route-and-rib-stations',
        crossSectionEnvelope: 'unchanged-route-clearance-contract'
      }),
      candleStar: Object.freeze({
        topology: 'sealed-indexed-four-point-candle-star',
        outlinePointCount: 8,
        axialRingCount: 4,
        localEnvelope: Object.freeze([-0.5, 0.5])
      })
    }),
    materials: Object.freeze({
      family: 'matte-warm-dielectric-stone',
      maximumMetalness: 0.03,
      minimumRoughness: 0.78,
      maximumClearcoat: 0.04,
      chromeAllowed: false,
      steelTrussAllowed: false,
      baseStructureEmissiveAllowed: false,
      luminaireDiffuserOnlyEmissive: true
    }),
    lighting: Object.freeze({
      fixture: 'paired-candle-star',
      powerMode: 'constant-on',
      distanceGated: false,
      approachSensorAllowed: false,
      stationAuthority: 'authored-route-profile',
      additionalDrawGroupCount: 0,
      additionalObjectCount: 0
    }),
    invariants: Object.freeze({
      roadGeometryAuthority: 'unchanged-track-graph',
      collisionAuthority: 'unchanged-sampleEdge-and-road-clearance',
      instanceCapacity: 'unchanged-prepared-batches',
      clearanceAuthority: 'unchanged-proven-instance-matrices',
      runtimeAllocation: 'no-per-frame-scenery-allocation'
    })
  });

  /*
   * AMBIENT_TRAFFIC_ART_CONTRACT v3 / 环境同行者美术与间距合同 v3
   *
   * Ambient traffic is an original cape-spirit pilgrimage companion, never a reduced mechanical player craft.
   * The former hull envelope remains the hard presentation ceiling because traffic placement, opposing-lane
   * safety, map markers, and the fixed instance pool all consume the existing local -Z nose convention.
   * Companions sharing an edge advance as an evenly phased cohort, while a preallocated world-space sphere
   * guard rejects the later instance at a crossing before submission. That two-stage rule prevents complete
   * model nesting without introducing per-frame allocation, gameplay collision, or a second route authority.
   */
  const AMBIENT_TRAFFIC_ART_CONTRACT = Object.freeze({
    version: 3,
    productionFamily: 'ambient-cape-spirit-companion',
    intent: Object.freeze({
      zhCN: '以披风灵鸟与朝圣同行者替代机械飞船：柔和、安静、有双眼与记忆飘带，并保持原道路安全合同。',
      en: 'Replace mechanical traffic craft with quiet cape-spirit pilgrimage companions carrying paired eyes and memory ribbons while preserving the road-safety contract.'
    }),
    geometry: Object.freeze({
      topology: 'single-merged-indexed-sealed-organic-components',
      noseAxisZ: -1,
      maximumLocalEnvelope: Object.freeze({
        minX: -2.82,
        maxX: 2.82,
        minY: -0.17,
        maxY: 0.98,
        minZ: -2.82,
        maxZ: 1.94
      }),
      componentRoles: Object.freeze([
        'soft-cape-wing-pair',
        'spirit-pilgrim-body',
        'abstract-pilgrim-mask',
        'candle-eye-left',
        'tail-cloth-petal-left',
        'memory-ribbon-left',
        'candle-eye-right',
        'tail-cloth-petal-right',
        'memory-ribbon-right'
      ]),
      inventory: Object.freeze({
        capeWingPairCount: 1,
        spiritBodyCount: 1,
        abstractMaskCount: 1,
        eyeCount: 2,
        tailClothPetalCount: 2,
        memoryRibbonCount: 2,
        engineCount: 0,
        nozzleCount: 0,
        turbineCount: 0,
        mechanicalPanelCount: 0
      })
    }),
    materials: Object.freeze({
      family: 'matte-woven-natural-dielectric',
      metalness: 0,
      minimumRoughness: 0.80,
      maximumClearcoat: 0.025,
      baseEmissiveAllowed: false
    }),
    spacing: Object.freeze({
      minimumSurfaceGapM: 0.60,
      sameEdgeAuthority: 'shared-speed-even-phase-cohort',
      crossingAuthority: 'preallocated-world-sphere-submission-guard',
      suppressionPolicy: 'later-slot-hidden-before-instance-submit',
      diagnosticAuthority: 'submitted-instance-world-space-spheres'
    }),
    invariants: Object.freeze({
      mergedGeometryCount: 1,
      instanceCapacity: 'unchanged-quality-profile-capacity',
      placementAuthority: 'safe-edge-road-frame-phased-slots',
      collisionAuthority: 'non-colliding-decoration',
      mapAuthority: 'unchanged-ambient-traffic-markers',
      runtimeAllocation: 'no-per-frame-traffic-allocation'
    })
  });

  /* Wayfinding changes only presentation: fixed gore slots and localized exit semantics remain authoritative. */
  const SKY_ROUTE_WAYFINDING_ART_CONTRACT = Object.freeze({
    version: 2,
    decisionStructure: Object.freeze({
      role: 'wind-eroded-petal-stone-tower',
      topology: 'sealed-indexed-sixteen-point-petal-spire',
      outlinePointCount: 16,
      axialRingCount: 6,
      matrixAuthority: 'unchanged-reserved-decision-pylon-range',
      verticalOffsetM: 1.9,
      localScale: Object.freeze({ x: 0.28, y: 3.8, z: 0.28 }),
      metalness: 0
    }),
    decisionInscription: Object.freeze({
      role: 'restrained-woven-candle-star-inscription',
      geometryAuthority: 'existing-sealed-candle-star-instance',
      matrixAuthority: 'unchanged-reserved-decision-reflector-range',
      verticalOffsetM: 0.62,
      localScale: Object.freeze({ x: 0.32, y: 0.18, z: 0.12 }),
      additionalLightCount: 0
    }),
    gore: Object.freeze({
      role: 'sealed-warm-stone-four-ray-candle-star',
      topology: 'sealed-indexed-eight-point-outline-prism',
      outlinePointCount: 8,
      collision: false,
      maximumLocalEnvelope: Object.freeze({
        minX: -0.72,
        maxX: 0.72,
        minY: -0.18,
        maxY: 0.18,
        minZ: -1.70,
        maxZ: 1.70
      })
    }),
    exitSign: Object.freeze({
      style: 'woven-scroll-with-candle-star-frame',
      textAuthority: 'unchanged-localized-exit-direction-distance',
      languageSwitch: 'shared-atlas-material-swap',
      additionalDrawGroupCount: 0
    }),
    materials: Object.freeze({
      goreFamily: 'matte-warm-dielectric-stone',
      goreMetalness: 0,
      goreMinimumRoughness: 0.82,
      modernIndustrialAllowed: false
    }),
    invariants: Object.freeze({
      goreInstanceCapacity: 'unchanged-track-graph-contract',
      gorePlacement: 'unchanged-decision-node-frames',
      decisionStructureCapacity: 'unchanged-track-graph-contract',
      decisionStructurePlacement: 'unchanged-sampled-instance-matrices',
      navigationAuthority: 'unchanged-decision-guidance',
      runtimeAllocation: 'no-per-frame-wayfinding-allocation'
    })
  });

  /** Attach immutable semantic evidence without making presentation metadata a geometry or collision authority. */
  function markSkyRouteGeometry(geometry, role, topology, localEnvelope = null) {
    geometry.userData.neonV23SkyRouteScenery = Object.freeze({
      contractVersion: SKY_ROUTE_SCENERY_CONTRACT.version,
      role,
      topology,
      localEnvelope: localEnvelope ? Object.freeze({ ...localEnvelope }) : null
    });
    return geometry;
  }

  /** Tag one resident material so quality switching can be audited against the same dielectric-stone limits. */
  function markSkyRouteMaterial(material, role) {
    material.userData.neonV23SkyRouteScenery = Object.freeze({
      contractVersion: SKY_ROUTE_SCENERY_CONTRACT.version,
      role,
      family: SKY_ROUTE_SCENERY_CONTRACT.materials.family
    });
    return material;
  }

  /**
   * Receive authored tunnel light through the existing PBR diffuse path, preserving albedo, wear, and AO.
   * Local enclosure attenuates outdoor lighting even while the player is outside; real fixture spots retain
   * their complete direct lighting/shadows. The legacy light-map floor/peak were authored as outgoing radiance;
   * calibrate incident energy against fixed 18% reference gray so High does not crush the unlit gaps. Never divide
   * by the actual material albedo: that would cancel the stone/tyre detail this received-light path must preserve.
   */
  function injectStaticTunnelIrradianceShader(shader, THREE, tunnelLightingUniforms) {
    // The rig owns these stable uniforms. Apply only occlusion not already baked into scene-wide light.
    Object.assign(shader.uniforms, tunnelLightingUniforms);
    const [red, green, blue] = STATIC_TUNNEL_IRRADIANCE_CONTRACT.colorLinear
      .map((channel) => Number(channel).toFixed(4));
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float staticTunnelIrradiance;\nattribute float tunnelEnclosure;\nvarying float vNeonV23StaticTunnelIrradiance;\nvarying float vNeonV23TunnelEnclosure;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvNeonV23StaticTunnelIrradiance = staticTunnelIrradiance;\nvNeonV23TunnelEnclosure = tunnelEnclosure;'
      );
    // Expand only the pinned Three chunk containing directional lights; changing all direct light would also
    // dim the High fixture pool and erase its PBR highlights. Keep the original shadow sampling intact.
    const receivedLightChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      `getDirectionalLightInfo( directionalLight, directLight );
        directLight.color *= neonV23TunnelOutdoorTransmission(0.025, neonV23GlobalDirectionalTransmission);`
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vNeonV23StaticTunnelIrradiance;
varying float vNeonV23TunnelEnclosure;
uniform float neonV23GlobalAmbientTransmission;
uniform float neonV23GlobalEnvironmentTransmission;
uniform float neonV23GlobalDirectionalTransmission;
float neonV23TunnelOutdoorTransmission(float deepTransmission, float globalTransmission) {
  return min(1.0, mix(1.0, deepTransmission, clamp(vNeonV23TunnelEnclosure, 0.0, 1.0)) / max(globalTransmission, 0.0001));
}`
      )
      .replace('#include <lights_fragment_begin>', receivedLightChunk)
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
#if defined(RE_IndirectDiffuse)
  irradiance *= neonV23TunnelOutdoorTransmission(0.14, neonV23GlobalAmbientTransmission);
  iblIrradiance *= neonV23TunnelOutdoorTransmission(0.14, neonV23GlobalEnvironmentTransmission);
  irradiance += PI * vec3(${red}, ${green}, ${blue})
    * max(vNeonV23StaticTunnelIrradiance, 0.0) / 0.18;
#endif
#if defined(RE_IndirectSpecular)
  radiance *= neonV23TunnelOutdoorTransmission(0.14, neonV23GlobalEnvironmentTransmission);
  clearcoatRadiance *= neonV23TunnelOutdoorTransmission(0.14, neonV23GlobalEnvironmentTransmission);
#endif`
      );
  }

  /** Low keeps plain asphalt detail but still consumes the resident tunnel light map. */
  function installLowRoadShader(THREE, material, tunnelLightingUniforms) {
    material.onBeforeCompile = (shader) => injectStaticTunnelIrradianceShader(shader, THREE, tunnelLightingUniforms);
    material.customProgramCacheKey = () => 'neon-v23-low-road-static-tunnel-irradiance-v3';
    material.userData.neonV23StaticTunnelIrradiance = STATIC_TUNNEL_IRRADIANCE_CONTRACT.version;
  }

  /** Reuse an existing shell or instanced-structure draw as a static tunnel-light receiver. */
  function installStaticTunnelStructureShader(THREE, material, signature, tunnelLightingUniforms) {
    material.onBeforeCompile = (shader) => injectStaticTunnelIrradianceShader(shader, THREE, tunnelLightingUniforms);
    material.customProgramCacheKey = () => `neon-v23-static-tunnel-structure-${signature}-v3`;
    material.userData.neonV23StaticTunnelIrradiance = STATIC_TUNNEL_IRRADIANCE_CONTRACT.version;
  }

  /** Give Medium a low-cost macro surface so joints and wheel paths survive fog without High texture sampling. */
  function installStandardRoadShader(THREE, material, tunnelLightingUniforms) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 roadCoord;\nvarying vec2 vNeonV23RoadCoord;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeonV23RoadCoord = roadCoord;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vNeonV23RoadCoord;
float neonV23StandardRoadHash(vec2 point) {
  vec3 value = fract(vec3(point.xyx) * vec3(0.1031, 0.11369, 0.13787));
  value += dot(value, value.yzx + 19.19);
  return fract((value.x + value.y) * value.z);
}
float neonV23StandardRoadJoint(vec2 roadCoord) {
  float distanceToJoint = abs(fract(roadCoord.y / 45.0) - 0.5) * 45.0;
  return 1.0 - smoothstep(0.07, 0.22, distanceToJoint);
}
float neonV23StandardTyreWear(float lateral) {
  return 1.0 - smoothstep(0.06, 0.15, abs(abs(lateral) - 0.38));
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float neonV23StandardFade = 1.0 - smoothstep(55.0, 230.0, length(vViewPosition));
float neonV23StandardGrain = neonV23StandardRoadHash(
  floor(vNeonV23RoadCoord * vec2(12.0, 0.38))
);
float neonV23StandardJoint = neonV23StandardRoadJoint(vNeonV23RoadCoord);
float neonV23StandardTyre = neonV23StandardTyreWear(vNeonV23RoadCoord.x);
float neonV23StandardShoulder = smoothstep(0.70, 0.98, abs(vNeonV23RoadCoord.x));
diffuseColor.rgb *= vec3(0.92);
diffuseColor.rgb *= 1.0 + (neonV23StandardGrain - 0.5) * 0.018 * neonV23StandardFade;
diffuseColor.rgb *= 1.0 - neonV23StandardJoint * 0.065
  - neonV23StandardTyre * 0.032 * neonV23StandardFade - neonV23StandardShoulder * 0.055;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float neonV23StandardRoughness = neonV23StandardRoadHash(
  floor(vNeonV23RoadCoord * vec2(16.0, 0.54) + 5.0)
);
roughnessFactor = clamp(
  roughnessFactor + (neonV23StandardRoughness - 0.5) * 0.035 * neonV23StandardFade
    + neonV23StandardJoint * 0.035 + neonV23StandardShoulder * 0.045,
  0.30,
  1.0
);`);
      injectStaticTunnelIrradianceShader(shader, THREE, tunnelLightingUniforms);
    };
    material.customProgramCacheKey = () => 'neon-v23-standard-road-coordinate-v4';
    material.userData.neonV23SurfaceDetail = 'standard-road-coordinate';
    material.userData.neonV23StaticTunnelIrradiance = STATIC_TUNNEL_IRRADIANCE_CONTRACT.version;
  }

  /** Add restrained road-coordinate concrete detail and fade microsurface inputs before they can alias at range. */
  function installUltraRoadShader(THREE, material, tunnelLightingUniforms) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 roadCoord;\nvarying vec2 vNeonV23RoadCoord;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeonV23RoadCoord = roadCoord;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vNeonV23RoadCoord;
float neonV23RoadHash(vec2 point) {
  vec3 value = fract(vec3(point.xyx) * vec3(0.1031, 0.11369, 0.13787));
  value += dot(value, value.yzx + 19.19);
  return fract((value.x + value.y) * value.z);
}
float neonV23RoadJoint(vec2 roadCoord) {
  float distanceToJoint = abs(fract(roadCoord.y / 45.0) - 0.5) * 45.0;
  return 1.0 - smoothstep(0.06, 0.18, distanceToJoint);
}
float neonV23TyreWear(float lateral) {
  return 1.0 - smoothstep(0.045, 0.13, abs(abs(lateral) - 0.38));
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float neonV23RoadDetailFade = 1.0 - smoothstep(70.0, 280.0, length(vViewPosition));
float neonV23RoadGrain = neonV23RoadHash(floor(vNeonV23RoadCoord * vec2(24.0, 0.7)));
float neonV23RoadJointMask = neonV23RoadJoint(vNeonV23RoadCoord);
float neonV23RoadTyreMask = neonV23TyreWear(vNeonV23RoadCoord.x);
float neonV23RoadEdgeDirt = smoothstep(0.68, 0.98, abs(vNeonV23RoadCoord.x));
// Equal-channel albedo keeps the road neutral while leaving restrained concrete variation visible nearby.
diffuseColor.rgb *= vec3(0.88);
diffuseColor.rgb *= 1.0 + (neonV23RoadGrain - 0.5) * 0.02375 * neonV23RoadDetailFade;
diffuseColor.rgb *= 1.0 - neonV23RoadJointMask * 0.05
  - neonV23RoadTyreMask * 0.035 * neonV23RoadDetailFade - neonV23RoadEdgeDirt * 0.05;`)
        .replace('#include <roughnessmap_fragment>', `float neonV23RoadBaseRoughness = roughness;
#include <roughnessmap_fragment>
roughnessFactor = mix(neonV23RoadBaseRoughness, roughnessFactor, neonV23RoadDetailFade);
float neonV23UltraRoughness = neonV23RoadHash(floor(vNeonV23RoadCoord * vec2(32.0, 1.0) + 7.0));
roughnessFactor = clamp(
  roughnessFactor + (neonV23UltraRoughness - 0.5) * 0.054 * neonV23RoadDetailFade
    + neonV23RoadJointMask * 0.035
    + smoothstep(0.70, 0.98, abs(vNeonV23RoadCoord.x)) * 0.05,
  0.22,
  1.0
);`)
        .replace('#include <normal_fragment_maps>', `vec3 neonV23RoadGeometricNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(neonV23RoadGeometricNormal, normal, neonV23RoadDetailFade));
float neonV23RoadMicroHeight = neonV23RoadHash(vNeonV23RoadCoord * vec2(45.75, 1.75));
vec3 neonV23RoadDx = dFdx(vec3(vNeonV23RoadCoord, neonV23RoadMicroHeight));
vec3 neonV23RoadDy = dFdy(vec3(vNeonV23RoadCoord, neonV23RoadMicroHeight));
vec3 neonV23RoadMicroCross = cross(neonV23RoadDx, neonV23RoadDy);
float neonV23RoadMicroLengthSquared = dot(neonV23RoadMicroCross, neonV23RoadMicroCross);
// Caps and skirts may collapse one texture axis; keep their geometric normal instead of normalizing zero.
float neonV23RoadMicroWeight = step(1.0e-10, neonV23RoadMicroLengthSquared);
vec2 neonV23RoadMicroSlope = neonV23RoadMicroCross.xy
  * inversesqrt(max(neonV23RoadMicroLengthSquared, 1.0e-10))
  * neonV23RoadMicroWeight;
normal = normalize(normal + vec3(neonV23RoadMicroSlope * 0.03 * neonV23RoadDetailFade, 0.0));`);
      injectStaticTunnelIrradianceShader(shader, THREE, tunnelLightingUniforms);
    };
    material.customProgramCacheKey = () => 'neon-v23-ultra-road-coordinate-v6';
    material.userData.neonV23StaticTunnelIrradiance = STATIC_TUNNEL_IRRADIANCE_CONTRACT.version;
  }

  /** Give dielectric road stone and carved structure batches local-scale PBR breakup without adding draw calls. */
  function installUltraStructureShader(
    THREE,
    material,
    signature,
    scale,
    strength,
    receiveStaticTunnelIrradiance = false,
    tunnelLightingUniforms = null
  ) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNeonV23StructurePosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeonV23StructurePosition = transformed;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vNeonV23StructurePosition;
float neonV23StructureHash(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.yzx + 31.32);
  return fract((point.x + point.y) * point.z);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float neonV23StructureVariation = neonV23StructureHash(
  floor(vNeonV23StructurePosition * ${Number(scale).toFixed(4)})
);
diffuseColor.rgb *= 1.0 + (neonV23StructureVariation - 0.5) * ${Number(strength).toFixed(4)};`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float neonV23StructureRoughness = neonV23StructureHash(
  floor(vNeonV23StructurePosition * ${Number(scale * 1.7).toFixed(4)} + 13.7)
);
roughnessFactor = clamp(
  roughnessFactor + (neonV23StructureRoughness - 0.5) * ${Number(strength * 0.8).toFixed(4)},
  0.08,
  1.0
);`);
      if (receiveStaticTunnelIrradiance) injectStaticTunnelIrradianceShader(shader, THREE, tunnelLightingUniforms);
    };
    material.customProgramCacheKey = () => (
      `neon-v23-ultra-structure-${signature}-${receiveStaticTunnelIrradiance ? 'tunnel-lit-v3' : 'v1'}`
    );
    if (receiveStaticTunnelIrradiance) {
      material.userData.neonV23StaticTunnelIrradiance = STATIC_TUNNEL_IRRADIANCE_CONTRACT.version;
    }
  }

  /**
   * Preserve source normals while copying one buffer per idle slice into a single draw batch.
   * Road publication opts into the strict roadCoord contract; decorative traffic geometry retains zero fallback UVs.
   */
  function createIndexedGeometryMergeJob(THREE, geometries, boundingSphere, options = {}) {
    const attributeScalarChunk = 12_288;
    const indexChunk = 8_192;
    const requireRoadCoordinates = options.requireRoadCoordinates === true;
    const includeStaticTunnelIrradiance = options.includeStaticTunnelIrradiance === true;
    const includeTunnelEnclosure = options.includeTunnelEnclosure === true;
    const usable = geometries.filter((geometry) => geometry?.getAttribute?.('position'));
    const junctionSurfaceRanges = [];
    const vertexCount = usable.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0);
    const indexCount = usable.reduce((sum, geometry) => (
      sum + (geometry.index?.count || geometry.getAttribute('position').count)
    ), 0);
    const IndexArray = vertexCount > 65_535 ? Uint32Array : Uint16Array;
    let positions = null;
    let colors = null;
    let normals = null;
    let roadCoordinates = null;
    let staticTunnelIrradiance = null;
    let tunnelEnclosure = null;
    let indices = null;
    let geometryCursor = 0;
    let vertexOffset = 0;
    let indexOffset = 0;
    let activeGeometry = null;
    let activePosition = null;
    let activeColor = null;
    let activeNormal = null;
    let activeRoadCoordinate = null;
    let activeStaticTunnelIrradiance = null;
    let activeTunnelEnclosure = null;
    let attributeOffset = 0;
    let sourceIndexOffset = 0;
    let staticTunnelIrradiancePositiveVertexCount = 0;
    let staticTunnelIrradianceMaximum = 0;
    let merged = null;
    let phase = 'allocate-position';

    /** Surface detail coordinates are a High-rendering contract; missing or invalid values must stop publication. */
    function roadCoordinateContractError(message) {
      const ErrorType = window.NeonV23Errors?.NeonV23RenderingError || Error;
      return new ErrorType(message, { code: 'road-coordinate-contract-invalid' });
    }

    function beginGeometryCopy() {
      activeGeometry = usable[geometryCursor];
      activePosition = activeGeometry.getAttribute('position');
      activeColor = activeGeometry.getAttribute('color');
      activeNormal = activeGeometry.getAttribute('normal');
      activeRoadCoordinate = activeGeometry.getAttribute('roadCoord');
      activeStaticTunnelIrradiance = activeGeometry.getAttribute('staticTunnelIrradiance');
      activeTunnelEnclosure = activeGeometry.getAttribute(TUNNEL_ENCLOSURE_CONTRACT.attribute);
      const hasCompleteRoadCoordinates = activeRoadCoordinate
        && activeRoadCoordinate.itemSize === 2
        && activeRoadCoordinate.count === activePosition.count;
      if (requireRoadCoordinates && !hasCompleteRoadCoordinates) {
        throw roadCoordinateContractError(
          `Cloverleaf road geometry ${geometryCursor} has no complete two-component roadCoord attribute`
        );
      }
      if (!hasCompleteRoadCoordinates) {
        activeRoadCoordinate = null;
      }
      const hasCompleteStaticTunnelIrradiance = activeStaticTunnelIrradiance
        && activeStaticTunnelIrradiance.itemSize === 1
        && activeStaticTunnelIrradiance.count === activePosition.count;
      if (!hasCompleteStaticTunnelIrradiance) activeStaticTunnelIrradiance = null;
      if (activeTunnelEnclosure && (activeTunnelEnclosure.itemSize !== 1
        || activeTunnelEnclosure.count !== activePosition.count)) {
        throw roadCoordinateContractError(
          `Cloverleaf road geometry ${geometryCursor} has an incomplete tunnel enclosure attribute`
        );
      }
      attributeOffset = 0;
      sourceIndexOffset = 0;
      phase = 'copy-position';
    }

    /** Copy one bounded scalar range; missing optional attributes use the prior all-white/zero contract. */
    function copyAttributeChunk(source, target, fallback = null, itemSize = 3) {
      const scalarCount = activePosition.count * itemSize;
      const end = Math.min(scalarCount, attributeOffset + attributeScalarChunk);
      const targetOffset = vertexOffset * itemSize + attributeOffset;
      if (source) target.set(source.array.subarray(attributeOffset, end), targetOffset);
      else if (fallback !== null) target.fill(fallback, targetOffset, vertexOffset * itemSize + end);
      attributeOffset = end;
      return end >= scalarCount;
    }

    /** Copy and validate one bounded coordinate range so a non-finite PBR input cannot reach the GPU. */
    function copyRoadCoordinateChunk() {
      const itemSize = 2;
      const scalarCount = activePosition.count * itemSize;
      const end = Math.min(scalarCount, attributeOffset + attributeScalarChunk);
      const targetOffset = vertexOffset * itemSize;
      for (let scalar = attributeOffset; scalar < end; scalar++) {
        const value = activeRoadCoordinate.array[scalar];
        if (!Number.isFinite(value)) {
          throw roadCoordinateContractError(
            `Cloverleaf road geometry ${geometryCursor} has a non-finite roadCoord component`
          );
        }
        roadCoordinates[targetOffset + scalar] = value;
      }
      attributeOffset = end;
      return end >= scalarCount;
    }

    /** Validate baked road irradiance while merging; absent non-road surfaces deliberately receive darkness. */
    function copyStaticTunnelIrradianceChunk() {
      const scalarCount = activePosition.count;
      const end = Math.min(scalarCount, attributeOffset + attributeScalarChunk);
      const targetOffset = vertexOffset;
      if (!activeStaticTunnelIrradiance) {
        staticTunnelIrradiance.fill(0, targetOffset + attributeOffset, targetOffset + end);
      } else {
        for (let scalar = attributeOffset; scalar < end; scalar++) {
          const value = activeStaticTunnelIrradiance.array[scalar];
          if (!Number.isFinite(value) || value < 0) {
            throw roadCoordinateContractError(
              `Cloverleaf road geometry ${geometryCursor} has invalid static tunnel irradiance`
            );
          }
          staticTunnelIrradiance[targetOffset + scalar] = value;
          if (value > 0) staticTunnelIrradiancePositiveVertexCount++;
          staticTunnelIrradianceMaximum = Math.max(staticTunnelIrradianceMaximum, value);
        }
      }
      attributeOffset = end;
      return end >= scalarCount;
    }

    /** Copy one bounded enclosure range; junction aprons and other outdoor sources explicitly remain unmasked. */
    function copyTunnelEnclosureChunk() {
      const scalarCount = activePosition.count;
      const end = Math.min(scalarCount, attributeOffset + attributeScalarChunk);
      if (!activeTunnelEnclosure) {
        tunnelEnclosure.fill(0, vertexOffset + attributeOffset, vertexOffset + end);
      } else {
        for (let scalar = attributeOffset; scalar < end; scalar++) {
          const value = activeTunnelEnclosure.array[scalar];
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw roadCoordinateContractError(
              `Cloverleaf road geometry ${geometryCursor} has invalid tunnel enclosure`
            );
          }
          tunnelEnclosure[vertexOffset + scalar] = value;
        }
      }
      attributeOffset = end;
      return end >= scalarCount;
    }

    function finishActiveGeometry() {
      const sourceIndexCount = activeGeometry.index?.count || activePosition.count;
      const apronNodeId = activeGeometry.userData?.junctionApronNodeId;
      const lensNodeId = activeGeometry.userData?.junctionLensNodeId;
      if (apronNodeId || lensNodeId) {
        // Preserve CPU-only ownership ranges so regression audits inspect the exact junction surfaces without
        // uploading another per-vertex role attribute or guessing from merged-buffer ordering.
        junctionSurfaceRanges.push(Object.freeze({
          kind: apronNodeId ? 'apron' : 'lens',
          nodeId: apronNodeId || lensNodeId,
          vertexStart: vertexOffset,
          vertexCount: activePosition.count,
          indexStart: indexOffset,
          indexCount: sourceIndexCount
        }));
      }
      indexOffset += sourceIndexCount;
      vertexOffset += activePosition.count;
      geometryCursor++;
      activeGeometry = null;
      activePosition = null;
      activeColor = null;
      activeNormal = null;
      activeRoadCoordinate = null;
      activeStaticTunnelIrradiance = null;
      activeTunnelEnclosure = null;
      attributeOffset = 0;
      sourceIndexOffset = 0;
      phase = geometryCursor >= usable.length ? 'publish' : 'prepare-copy';
    }

    function step() {
      if (merged) return true;
      if (phase === 'allocate-position') {
        positions = new Float32Array(vertexCount * 3);
        phase = 'allocate-color';
        return false;
      }
      if (phase === 'allocate-color') {
        colors = new Float32Array(vertexCount * 3);
        phase = 'allocate-normal';
        return false;
      }
      if (phase === 'allocate-normal') {
        normals = new Float32Array(vertexCount * 3);
        phase = 'allocate-road-coordinate';
        return false;
      }
      if (phase === 'allocate-road-coordinate') {
        roadCoordinates = new Float32Array(vertexCount * 2);
        phase = includeStaticTunnelIrradiance
          ? 'allocate-static-tunnel-irradiance'
          : includeTunnelEnclosure ? 'allocate-tunnel-enclosure' : 'allocate-index';
        return false;
      }
      if (phase === 'allocate-static-tunnel-irradiance') {
        staticTunnelIrradiance = new Float32Array(vertexCount);
        phase = includeTunnelEnclosure ? 'allocate-tunnel-enclosure' : 'allocate-index';
        return false;
      }
      if (phase === 'allocate-tunnel-enclosure') {
        tunnelEnclosure = new Float32Array(vertexCount);
        phase = 'allocate-index';
        return false;
      }
      if (phase === 'allocate-index') {
        indices = new IndexArray(indexCount);
        phase = usable.length ? 'prepare-copy' : 'publish';
        return false;
      }
      if (phase === 'prepare-copy') {
        beginGeometryCopy();
        return false;
      }
      if (phase === 'copy-position') {
        if (copyAttributeChunk(activePosition, positions)) {
          attributeOffset = 0;
          phase = 'copy-color';
        }
        return false;
      }
      if (phase === 'copy-color') {
        if (copyAttributeChunk(activeColor, colors, 1)) {
          attributeOffset = 0;
          phase = 'copy-normal';
        }
        return false;
      }
      if (phase === 'copy-normal') {
        if (copyAttributeChunk(activeNormal, normals)) {
          attributeOffset = 0;
          phase = 'copy-road-coordinate';
        }
        return false;
      }
      if (phase === 'copy-road-coordinate') {
        const copyComplete = activeRoadCoordinate
          ? copyRoadCoordinateChunk()
          : copyAttributeChunk(null, roadCoordinates, 0, 2);
        if (copyComplete) {
          attributeOffset = 0;
          phase = includeStaticTunnelIrradiance
            ? 'copy-static-tunnel-irradiance'
            : includeTunnelEnclosure ? 'copy-tunnel-enclosure' : 'copy-index';
        }
        return false;
      }
      if (phase === 'copy-static-tunnel-irradiance') {
        if (copyStaticTunnelIrradianceChunk()) {
          attributeOffset = 0;
          phase = includeTunnelEnclosure ? 'copy-tunnel-enclosure' : 'copy-index';
        }
        return false;
      }
      if (phase === 'copy-tunnel-enclosure') {
        if (copyTunnelEnclosureChunk()) {
          attributeOffset = 0;
          phase = 'copy-index';
        }
        return false;
      }
      if (phase === 'copy-index') {
        const sourceIndexCount = activeGeometry.index?.count || activePosition.count;
        const end = Math.min(sourceIndexCount, sourceIndexOffset + indexChunk);
        if (activeGeometry.index) {
          for (let index = sourceIndexOffset; index < end; index++) {
            indices[indexOffset + index] = activeGeometry.index.getX(index) + vertexOffset;
          }
        } else {
          for (let index = sourceIndexOffset; index < end; index++) {
            indices[indexOffset + index] = vertexOffset + index;
          }
        }
        sourceIndexOffset = end;
        if (sourceIndexOffset >= sourceIndexCount) finishActiveGeometry();
        return false;
      }
      merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      merged.setAttribute('roadCoord', new THREE.BufferAttribute(roadCoordinates, 2));
      if (includeStaticTunnelIrradiance) {
        merged.setAttribute(
          STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute,
          new THREE.BufferAttribute(staticTunnelIrradiance, 1)
        );
      }
      if (includeTunnelEnclosure) {
        merged.setAttribute(TUNNEL_ENCLOSURE_CONTRACT.attribute, new THREE.BufferAttribute(tunnelEnclosure, 1));
        merged.userData.tunnelEnclosureContractVersion = TUNNEL_ENCLOSURE_CONTRACT.version;
      }
      // The micro-normal/roughness maps use the same stable road coordinate; no externally loaded texture is needed.
      merged.setAttribute('uv', new THREE.BufferAttribute(roadCoordinates.slice(), 2));
      merged.setIndex(new THREE.BufferAttribute(indices, 1));
      merged.boundingSphere = boundingSphere;
      merged.userData.junctionSurfaceRanges = Object.freeze(junctionSurfaceRanges);
      if (includeStaticTunnelIrradiance) {
        Object.assign(merged.userData, {
          staticTunnelIrradianceContractVersion: STATIC_TUNNEL_IRRADIANCE_CONTRACT.version,
          staticTunnelIrradianceDistanceGated: STATIC_TUNNEL_IRRADIANCE_CONTRACT.distanceGated,
          staticTunnelIrradiancePositiveVertexCount,
          staticTunnelIrradianceMaximum,
          staticTunnelIrradianceAdditionalDrawGroupCount:
            STATIC_TUNNEL_IRRADIANCE_CONTRACT.additionalDrawGroupCount,
          staticTunnelIrradianceAdditionalObjectCount:
            STATIC_TUNNEL_IRRADIANCE_CONTRACT.additionalObjectCount
        });
      }
      phase = 'done';
      return true;
    }

    function finish() {
      if (!merged) throw new Error('Cloverleaf road merge is not complete');
      return merged;
    }

    return Object.freeze({ step, finish });
  }

  function edgePriority(edge) {
    return ROAD_FAMILY_PRIORITY[edge?.family] || 0;
  }

  function winsJunctionBoundary(edge, sibling) {
    const priorityDelta = edgePriority(edge) - edgePriority(sibling);
    if (priorityDelta !== 0) return priorityDelta > 0;
    // Edge ids are ASCII contract keys; direct ordering avoids locale initialization in the first idle slice.
    return String(edge?.id || '') < String(sibling?.id || '');
  }

  const CONTINUOUS_ENDPOINT_NODE_KINDS = new Set([
    'entry',
    'exit',
    'decision',
    'collector-decision',
    'loop-merge',
    'direct-merge',
    'launch-start',
    'launch-end'
  ]);

  /** Connected graph edges share one physical road volume, so an internal cross-section must never be capped. */
  function createEndpointCapPolicy(track) {
    const incidentCountByNode = new Map();
    for (const edge of edgeList(track)) {
      for (const nodeId of [edge.from, edge.to]) {
        if (!nodeId) continue;
        incidentCountByNode.set(nodeId, (incidentCountByNode.get(nodeId) || 0) + 1);
      }
    }
    const nodesById = new Map(nodeList(track).map((node) => [node.id, node]));

    function endpointIsConnected(edge, endpoint) {
      const nodeId = edge?.[endpoint];
      if (!nodeId) return false;
      if ((incidentCountByNode.get(nodeId) || 0) > 1) return true;
      const node = nodesById.get(nodeId) || track.getNode?.(nodeId) || null;
      return CONTINUOUS_ENDPOINT_NODE_KINDS.has(node?.kind);
    }

    return (edge) => Object.freeze({
      start: !endpointIsConnected(edge, 'from'),
      end: !endpointIsConnected(edge, 'to')
    });
  }

  const JUNCTION_BARRIER_ENDPOINT_LIMIT_M = 160;
  // Inspecting one half-branch covers the complete mirrored overlap, even when the shared profile changes its curve.
  const STRAIGHT_FORK_JUNCTION_ENDPOINT_LIMIT_M = 450;
  // The asymmetric fork's 7.2m peak gap reaches 5m about 56m after the pavement separates, preserving the
  // established gradual barrier rise without waiting until the single midpoint sample to reach full height.
  const STRAIGHT_FORK_VOID_BOUNDARY_FULL_WIDTH_M = 5;
  const STRAIGHT_FORK_VOID_BOUNDARY_HEIGHT_M = 0.78;
  // Absolute offsets retain sub-metre projection accuracy near the gore without multiplying error by station length.
  const JUNCTION_BARRIER_SAMPLE_OFFSETS_M = Object.freeze([
    -12,
    -6,
    -3,
    -1.5,
    -0.75,
    0,
    0.75,
    1.5,
    3,
    6,
    12
  ]);

  /**
   * Only siblings sharing a graph node can own the same junction boundary. Height filtering prevents a true
   * grade separation from accidentally removing an upper-deck rail because its plan footprint overlaps below.
   */
  function createJunctionBarrierPolicy(track, edges) {
    const nodesById = new Map(nodeList(track).map((node) => [node.id, node]));
    const edgesByNode = new Map();
    for (const edge of edges) {
      for (const nodeId of [edge.from, edge.to]) {
        if (!nodeId) continue;
        if (!edgesByNode.has(nodeId)) edgesByNode.set(nodeId, []);
        edgesByNode.get(nodeId).push(edge);
      }
    }
    const siblingsByEdge = new Map();
    for (const edge of edges) {
      const records = [];
      for (const endpoint of ['from', 'to']) {
        const nodeId = edge[endpoint];
        const node = nodesById.get(nodeId) || track.getNode?.(nodeId) || null;
        const straightForkJunction = node?.decisionType === 'straight-fork'
          || node?.kind === 'straight-fork-merge';
        for (const sibling of edgesByNode.get(nodeId) || []) {
          if (sibling.id === edge.id
            || (isRuntimeOnlyEdge(sibling) && !straightForkJunction)
            || sibling.visualOnly === true) continue;
          const extendedStraightForkInspection = edge.family === 'straight-fork-branch'
            && sibling.family === 'straight-fork-branch';
          records.push(Object.freeze({
            sibling,
            edgeEndpoint: endpoint,
            siblingEndpoint: sibling.from === nodeId ? 'from' : 'to',
            endpointLimit: extendedStraightForkInspection
              ? STRAIGHT_FORK_JUNCTION_ENDPOINT_LIMIT_M
              : JUNCTION_BARRIER_ENDPOINT_LIMIT_M
          }));
        }
      }
      siblingsByEdge.set(edge.id, records);
    }

    function createInspectionJob(edge, edgeS, side, halfWidth) {
      const records = siblingsByEdge.get(edge.id) || [];
      let boundary = null;
      let recordIndex = 0;
      let activeRecord = null;
      let endpointDistance = 0;
      let sampleIndex = 0;
      let closest = null;
      let overlaps = false;
      let intrudesSafeCorridor = false;
      let ownsEveryOverlap = true;
      let overlapSiblingId = null;
      let intrusionSiblingId = null;
      let result = records.length === 0 ? Object.freeze({ keep: true, overlaps: false }) : null;

      function step() {
        if (result) return true;
        if (!boundary) {
          boundary = sample(track, edge.id, edgeS, side * (halfWidth + 0.04), {});
          return false;
        }
        while (recordIndex < records.length) {
          if (!activeRecord) {
            activeRecord = records[recordIndex];
            endpointDistance = activeRecord.edgeEndpoint === 'from' ? edgeS : edge.length - edgeS;
            if (endpointDistance < 0 || endpointDistance > activeRecord.endpointLimit) {
              activeRecord = null;
              recordIndex++;
              continue;
            }
            sampleIndex = 0;
            closest = null;
          }
          if (sampleIndex < JUNCTION_BARRIER_SAMPLE_OFFSETS_M.length) {
            const siblingDistance = clamp(
              endpointDistance + JUNCTION_BARRIER_SAMPLE_OFFSETS_M[sampleIndex++],
              0,
              activeRecord.sibling.length
            );
            const siblingS = activeRecord.siblingEndpoint === 'from'
              ? siblingDistance
              : activeRecord.sibling.length - siblingDistance;
            const siblingCenter = sample(track, activeRecord.sibling.id, siblingS, 0, {});
            const planarDistance = Math.hypot(boundary.x - siblingCenter.x, boundary.z - siblingCenter.z);
            if (!closest || planarDistance < closest.planarDistance) closest = { siblingCenter, planarDistance };
            return false;
          }
          const siblingHalf = closest ? sampledRoadHalf(closest.siblingCenter, activeRecord.sibling) : 0;
          if (closest
            && Math.abs(boundary.y - closest.siblingCenter.y) <= 0.75
            && closest.planarDistance <= siblingHalf + 0.18) {
            const recordIntrudes = closest.planarDistance <= Math.max(0, siblingHalf - 0.58);
            overlaps = true;
            overlapSiblingId ||= activeRecord.sibling.id;
            intrudesSafeCorridor ||= recordIntrudes;
            if (recordIntrudes) intrusionSiblingId ||= activeRecord.sibling.id;
            ownsEveryOverlap &&= winsJunctionBoundary(edge, activeRecord.sibling);
          }
          activeRecord = null;
          recordIndex++;
          return false;
        }
        result = Object.freeze({
          keep: !intrudesSafeCorridor && (!overlaps || ownsEveryOverlap),
          overlaps,
          intrudesSafeCorridor,
          siblingId: intrusionSiblingId || overlapSiblingId
        });
        return true;
      }

      function finish() {
        if (!result) throw new Error(`Junction barrier inspection is not complete: ${edge.id}`);
        return result;
      }

      return Object.freeze({ step, finish });
    }

    function inspectBarrier(edge, edgeS, side, halfWidth) {
      const job = createInspectionJob(edge, edgeS, side, halfWidth);
      while (!job.step()) {
        // Synchronous callers retain exact behavior; the road builder consumes createJob incrementally.
      }
      return job.finish();
    }
    inspectBarrier.createJob = createInspectionJob;
    return inspectBarrier;
  }

  function frameComponent(frame, key, nestedKey, fallback = 0) {
    if (Number.isFinite(frame?.[key])) return frame[key];
    if (Number.isFinite(frame?.[nestedKey?.[0]]?.[nestedKey?.[1]])) return frame[nestedKey[0]][nestedKey[1]];
    return fallback;
  }

  function normalizeFrame(frame, target = null) {
    const x = frameComponent(frame, 'x', ['position', 'x']);
    const y = frameComponent(frame, 'y', ['position', 'y'], frame?.height || frame?.surfaceHeight || 0);
    const z = frameComponent(frame, 'z', ['position', 'z']);
    const tangentX = frameComponent(frame, 'tangentX', ['tangent', 'x']);
    const tangentY = frameComponent(frame, 'tangentY', ['tangent', 'y']);
    const tangentZ = frameComponent(frame, 'tangentZ', ['tangent', 'z'], -1);
    const rightX = frameComponent(frame, 'rightX', ['right', 'x'], 1);
    const rightY = frameComponent(frame, 'rightY', ['right', 'y']);
    const rightZ = frameComponent(frame, 'rightZ', ['right', 'z']);
    const upX = frameComponent(frame, 'upX', ['up', 'x']);
    const upY = frameComponent(frame, 'upY', ['up', 'y'], 1);
    const upZ = frameComponent(frame, 'upZ', ['up', 'z']);
    const normalized = target || {};
    normalized.x = x;
    normalized.y = y;
    normalized.z = z;
    normalized.tangentX = tangentX;
    normalized.tangentY = tangentY;
    normalized.tangentZ = tangentZ;
    normalized.rightX = rightX;
    normalized.rightY = rightY;
    normalized.rightZ = rightZ;
    normalized.upX = upX;
    normalized.upY = upY;
    normalized.upZ = upZ;
    normalized.roadHalf = Number.isFinite(frame?.roadHalf) ? frame.roadHalf : null;
    // Fork shell construction consumes the track-owned void contract after frame normalization.
    normalized.straightForkOffsetM = Number(frame?.straightForkOffsetM) || 0;
    normalized.straightForkVoidWidthM = Number(frame?.straightForkVoidWidthM) || 0;
    normalized.surfaceHeight = Number.isFinite(frame?.surfaceHeight) ? frame.surfaceHeight : y;
    normalized.deckHeight = Number.isFinite(frame?.deckHeight) ? frame.deckHeight : null;
    normalized.structure = frame?.structure || null;
    normalized.layer = frame?.layer || null;
    normalized.yaw = Number.isFinite(frame?.yaw) ? frame.yaw : Math.atan2(-tangentX, -tangentZ);
    return normalized;
  }

  function sample(track, edgeId, edgeS, lateral, scratch, target = null) {
    return normalizeFrame(track.sampleEdge(edgeId, edgeS, lateral, scratch), target);
  }

  function sampledRoadHalf(frame, edge) {
    return Number.isFinite(frame?.roadHalf)
      ? frame.roadHalf
      : Number(edge?.roadHalf || edge?.halfWidth || 5.2);
  }

  /** Raised and transitioning samples use the same deck-thickness contract as collision and ceiling queries. */
  function sampledDeckDepth(track, frame) {
    const contract = track.graph?.contract || {};
    const lowerHeight = Number(contract.lowerHeight) || 0;
    const deckThickness = Number(contract.deckThickness) || 0.92;
    const elevationBlend = clamp((frame.y - lowerHeight) / 2, 0, 1);
    const structureBlend = frame.structure === 'cloverleaf-overpass' ? 1 : 0;
    return 0.46 + (deckThickness - 0.46) * Math.max(elevationBlend, structureBlend);
  }

  const JUNCTION_SURFACE_BIAS_LENGTH_M = 320;

  /**
   * Connected junction shells omit internal caps, while a deterministic sub-three-millimetre visual layer breaks
   * depth ties across the complete measured overlap. Track sampling remains the sole collision-height authority.
   */
  function junctionSurfaceBias(edge, edgeS) {
    const familyBias = ({
      approach: 0,
      mainline: -0.000_5,
      outbound: -0.001,
      'direct-ramp': -0.001_5,
      collector: -0.002,
      'loop-ramp': -0.002_5,
      'straight-fork-branch': -0.001_5
    })[edge.family] ?? -0.002;
    let edgeHash = 2_166_136_261;
    for (const character of String(edge.id || '')) {
      edgeHash ^= character.codePointAt(0);
      edgeHash = Math.imul(edgeHash, 16_777_619);
    }
    const tieBreakBias = -(edgeHash >>> 0) / 4_294_967_295 * 0.000_4;
    const priorityBias = familyBias + tieBreakBias;
    const endpointDistance = Math.min(edgeS, edge.length - edgeS);
    const t = clamp(1 - endpointDistance / JUNCTION_SURFACE_BIAS_LENGTH_M, 0, 1);
    const envelope = t * t * (3 - 2 * t);
    return priorityBias * envelope;
  }

  const JUNCTION_APRON_NODE_KINDS = new Set([
    'decision',
    'collector-decision',
    'loop-merge',
    'direct-merge',
    'straight-fork-merge'
  ]);
  const JUNCTION_APRON_MINIMUM_RUN_M = 12;
  const JUNCTION_APRON_STANDARD_MAXIMUM_RUN_M = 48;
  const JUNCTION_APRON_MAXIMUM_RUN_M = 50;
  const JUNCTION_APRON_SHELL_CLEAR_MARGIN_M = 0.05;
  const JUNCTION_APRON_TOP_OFFSET_M = 0.135;
  const JUNCTION_APRON_DECK_TOP_M = 0.10;
  const JUNCTION_APRON_DEPTH_M = 0.54;
  // The long lens follows the physical overlap to one centimetre instead of ending at a broad centreline threshold.
  const JUNCTION_OVERLAP_MAXIMUM_RUN_M = 160;
  const JUNCTION_OVERLAP_SCAN_STEP_M = 2;
  const JUNCTION_LENS_SAMPLE_STEP_M = 4;
  const JUNCTION_LENS_COMPACT_OVERLAP_M = 2;
  const JUNCTION_LENS_THICKNESS_M = 0.08;
  const JUNCTION_LENS_CLEARANCE_TOLERANCE_M = 0.01;
  const JUNCTION_LENS_ENDPOINT_AUDIT_TOLERANCE_M = 0.02;
  const JUNCTION_LENS_COVERAGE_AUDIT_STEP_M = 0.5;
  const JUNCTION_LENS_CLEAR_AUDIT_STEP_M = 0.25;
  const JUNCTION_LENS_CLEAR_AUDIT_SPAN_M = 2;

  function junctionIncidentRecords(node, edges) {
    const straightForkJunction = node?.decisionType === 'straight-fork'
      || node?.kind === 'straight-fork-merge';
    return edges.filter((edge) => (
      (!isRuntimeOnlyEdge(edge) || (straightForkJunction && edge.visualOnly !== true))
        && (edge.from === node.id || edge.to === node.id)
    ))
      .map((edge) => Object.freeze({
        edge,
        startsAtNode: edge.from === node.id,
        maximumRun: Math.max(
          4,
          Math.min(JUNCTION_APRON_MAXIMUM_RUN_M, edge.length * 0.42)
        ),
        overlapMaximumRun: Math.max(
          4,
          Math.min(
            edge.family === 'straight-fork-branch'
              ? STRAIGHT_FORK_JUNCTION_ENDPOINT_LIMIT_M
              : JUNCTION_OVERLAP_MAXIMUM_RUN_M,
            edge.length * (edge.family === 'straight-fork-branch' ? 0.5 : 0.42)
          )
        )
      }));
  }

  function sampleJunctionIncident(track, record, distance, lateral = 0, out = {}) {
    const edgeS = record.startsAtNode
      ? Math.min(record.edge.length, distance)
      : Math.max(0, record.edge.length - distance);
    return sample(track, record.edge.id, edgeS, lateral, out);
  }

  /** Conservative cross-section envelope includes deck depth and an untrimmed 0.58m rail on both sides. */
  function junctionIncidentShellVerticalExtent(track, record, distance) {
    const edgeS = record.startsAtNode
      ? Math.min(record.edge.length, distance)
      : Math.max(0, record.edge.length - distance);
    const center = sampleJunctionIncident(track, record, distance, 0, {});
    const halfWidth = sampledRoadHalf(center, record.edge);
    const deckDepth = sampledDeckDepth(track, center);
    const surfaceBias = junctionSurfaceBias(record.edge, edgeS);
    const profile = [
      [-halfWidth - 0.28, -deckDepth],
      [-halfWidth - 0.22, 0],
      [-halfWidth - 0.18, 0.58],
      [-halfWidth + 0.02, 0.58],
      [-halfWidth + 0.10, 0.10],
      [halfWidth - 0.10, 0.10],
      [halfWidth - 0.02, 0.58],
      [halfWidth + 0.18, 0.58],
      [halfWidth + 0.22, 0],
      [halfWidth + 0.28, -deckDepth],
      [halfWidth - 0.28, -deckDepth],
      [-halfWidth + 0.28, -deckDepth]
    ];
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    for (const [lateral, vertical] of profile) {
      const frame = sampleJunctionIncident(track, record, distance, lateral, {});
      const y = frame.y + frame.upY * (vertical + surfaceBias);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
    }
    return Object.freeze({
      center,
      outerHalfWidth: halfWidth + 0.28,
      minimumY,
      maximumY
    });
  }

  function junctionIncidentPairShellSeparation(track, leftRecord, rightRecord, distance) {
    const left = junctionIncidentShellVerticalExtent(track, leftRecord, distance);
    const right = junctionIncidentShellVerticalExtent(track, rightRecord, distance);
    const planarDistance = Math.hypot(
      left.center.x - right.center.x,
      left.center.z - right.center.z
    );
    const planarOverlap = planarDistance
      <= left.outerHalfWidth + right.outerHalfWidth - JUNCTION_LENS_CLEARANCE_TOLERANCE_M;
    const verticalGap = left.maximumY < right.minimumY
      ? right.minimumY - left.maximumY
      : right.maximumY < left.minimumY
        ? left.minimumY - right.maximumY
        : -Math.min(left.maximumY, right.maximumY) + Math.max(left.minimumY, right.minimumY);
    return Object.freeze({
      overlaps: planarOverlap && verticalGap <= 0,
      planarOverlap,
      verticalGap
    });
  }

  /** Refine only the exceptional 48-50m grade-separation tail; ordinary long pairs use the compact 48m cap. */
  function junctionIncidentPairShellClearAfterStandardRun(track, leftRecord, rightRecord) {
    let low = JUNCTION_APRON_STANDARD_MAXIMUM_RUN_M;
    if (!junctionIncidentPairShellSeparation(track, leftRecord, rightRecord, low).overlaps) {
      return Object.freeze({ clearDistance: low, clearanceVerified: true });
    }
    let high = Math.min(leftRecord.maximumRun, rightRecord.maximumRun);
    if (junctionIncidentPairShellSeparation(track, leftRecord, rightRecord, high).overlaps) {
      return Object.freeze({ clearDistance: high, clearanceVerified: false });
    }
    for (let iteration = 0; iteration < 8; iteration++) {
      const middle = (low + high) * 0.5;
      if (junctionIncidentPairShellSeparation(track, leftRecord, rightRecord, middle).overlaps) low = middle;
      else high = middle;
    }
    return Object.freeze({
      clearDistance: high,
      clearanceVerified: true
    });
  }

  function junctionIncidentPairSeparation(
    track,
    leftRecord,
    rightRecord,
    distance,
    overlapTolerance = JUNCTION_LENS_CLEARANCE_TOLERANCE_M
  ) {
    const left = sampleJunctionIncident(track, leftRecord, distance, 0, {});
    const right = sampleJunctionIncident(track, rightRecord, distance, 0, {});
    const halfWidthSum = sampledRoadHalf(left, leftRecord.edge)
      + sampledRoadHalf(right, rightRecord.edge);
    const planarDistance = Math.hypot(left.x - right.x, left.z - right.z);
    const verticalDistance = Math.abs(left.y - right.y);
    return Object.freeze({
      overlaps: planarDistance <= halfWidthSum - overlapTolerance && verticalDistance <= 0.75,
      planarDistance,
      halfWidthSum,
      physicalOverlapWidth: halfWidthSum - planarDistance,
      verticalDistance
    });
  }

  /** Find the last station where sibling carriageways still overlap, so the apron ends at the real gore nose. */
  function junctionApronRun(track, records) {
    let run = JUNCTION_APRON_MINIMUM_RUN_M;
    for (let leftIndex = 0; leftIndex < records.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex++) {
        const leftRecord = records[leftIndex];
        const rightRecord = records[rightIndex];
        const surfaceOverlap = junctionIncidentPairOverlapRun(track, leftRecord, rightRecord);
        if (surfaceOverlap.overlapEndDistance > JUNCTION_APRON_STANDARD_MAXIMUM_RUN_M) {
          run = Math.max(run, JUNCTION_APRON_STANDARD_MAXIMUM_RUN_M);
          continue;
        }
        const overlap = junctionIncidentPairShellClearAfterStandardRun(track, leftRecord, rightRecord);
        const pairRun = !overlap.clearanceVerified
          ? JUNCTION_APRON_STANDARD_MAXIMUM_RUN_M
          : overlap.clearDistance > JUNCTION_APRON_STANDARD_MAXIMUM_RUN_M
            ? overlap.clearDistance + JUNCTION_APRON_SHELL_CLEAR_MARGIN_M
            : JUNCTION_APRON_MINIMUM_RUN_M;
        run = Math.max(run, Math.min(JUNCTION_APRON_MAXIMUM_RUN_M, pairRun));
      }
    }
    return Math.min(JUNCTION_APRON_MAXIMUM_RUN_M, run);
  }

  function planarCross(origin, a, b) {
    return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
  }

  /** Monotonic hull removes interior road-edge samples and leaves one non-self-intersecting apron boundary. */
  function junctionConvexHull(points) {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
    const unique = [];
    for (const point of sorted) {
      const previous = unique.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.05) {
        if (point.y > previous.y) previous.y = point.y;
        continue;
      }
      unique.push({ ...point });
    }
    if (unique.length < 3) return unique;
    const lower = [];
    for (const point of unique) {
      while (lower.length >= 2 && planarCross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper = [];
    for (let index = unique.length - 1; index >= 0; index--) {
      const point = unique[index];
      while (upper.length >= 2 && planarCross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function junctionApronLayout(track, node, records) {
    const requestedRun = junctionApronRun(track, records);
    const boundaryPoints = [];
    for (const record of records) {
      const run = Math.min(requestedRun, record.maximumRun);
      const center = sampleJunctionIncident(track, record, run, 0, {});
      const boundaryHalf = Math.max(0.5, sampledRoadHalf(center, record.edge) - 0.08);
      for (const side of [-1, 1]) {
        const frame = sampleJunctionIncident(track, record, run, side * boundaryHalf, {});
        boundaryPoints.push({
          x: frame.x + frame.upX * JUNCTION_APRON_TOP_OFFSET_M,
          y: frame.y + frame.upY * JUNCTION_APRON_TOP_OFFSET_M,
          z: frame.z + frame.upZ * JUNCTION_APRON_TOP_OFFSET_M
        });
      }
    }
    const hull = junctionConvexHull(boundaryPoints);
    let maximumSpan = 0;
    for (let leftIndex = 0; leftIndex < hull.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < hull.length; rightIndex++) {
        maximumSpan = Math.max(
          maximumSpan,
          Math.hypot(hull[leftIndex].x - hull[rightIndex].x, hull[leftIndex].z - hull[rightIndex].z)
        );
      }
    }
    return Object.freeze({
      nodeId: node.id,
      nodeKind: node.kind,
      run: requestedRun,
      maximumSpan,
      hull: Object.freeze(hull.map((point) => Object.freeze(point)))
    });
  }

  function junctionIncidentPairOverlaps(track, leftRecord, rightRecord, distance) {
    return junctionIncidentPairSeparation(track, leftRecord, rightRecord, distance).overlaps;
  }

  function junctionIncidentPairShellPlanOverlaps(track, leftRecord, rightRecord, distance) {
    const left = sampleJunctionIncident(track, leftRecord, distance, 0, {});
    const right = sampleJunctionIncident(track, rightRecord, distance, 0, {});
    const outerHalfWidthSum = sampledRoadHalf(left, leftRecord.edge)
      + sampledRoadHalf(right, rightRecord.edge)
      + 0.56;
    return Math.hypot(left.x - right.x, left.z - right.z)
      <= outerHalfWidthSum - JUNCTION_LENS_CLEARANCE_TOLERANCE_M;
  }

  /** Measure the complete initially-connected overlap envelope, then bracket its first one-centimetre-clear station. */
  function junctionIncidentPairOverlapRun(track, leftRecord, rightRecord) {
    const maximumRun = Math.min(leftRecord.overlapMaximumRun, rightRecord.overlapMaximumRun);
    let lastOverlap = 0;
    let firstClear = null;
    let sawOverlap = false;
    const scanDistances = [0];
    for (
      let distance = JUNCTION_OVERLAP_SCAN_STEP_M;
      distance < maximumRun;
      distance += JUNCTION_OVERLAP_SCAN_STEP_M
    ) scanDistances.push(distance);
    if (maximumRun > 0) scanDistances.push(maximumRun);
    for (const distance of scanDistances) {
      if (junctionIncidentPairOverlaps(track, leftRecord, rightRecord, distance)) {
        sawOverlap = true;
        lastOverlap = distance;
      } else if (sawOverlap) {
        firstClear = distance;
        break;
      }
    }
    if (!sawOverlap) {
      return Object.freeze({
        overlapEndDistance: 0,
        clearDistance: 0,
        maximumRun,
        clearanceVerified: true
      });
    }
    if (firstClear === null) {
      return Object.freeze({
        overlapEndDistance: lastOverlap,
        clearDistance: maximumRun,
        maximumRun,
        clearanceVerified: !junctionIncidentPairOverlaps(
          track,
          leftRecord,
          rightRecord,
          maximumRun
        )
      });
    }
    let low = lastOverlap;
    let high = firstClear;
    for (let iteration = 0; iteration < 8; iteration++) {
      const middle = (low + high) * 0.5;
      if (junctionIncidentPairOverlaps(track, leftRecord, rightRecord, middle)) low = middle;
      else high = middle;
    }
    return Object.freeze({
      overlapEndDistance: low,
      clearDistance: high,
      maximumRun,
      clearanceVerified: !junctionIncidentPairOverlaps(track, leftRecord, rightRecord, high)
    });
  }

  /** Measure the longer full-shell plan envelope independently from vertical grade separation. */
  function junctionIncidentPairShellPlanRun(track, leftRecord, rightRecord) {
    const maximumRun = Math.min(leftRecord.overlapMaximumRun, rightRecord.overlapMaximumRun);
    const overlapsAt = (distance) => junctionIncidentPairShellPlanOverlaps(
      track,
      leftRecord,
      rightRecord,
      distance
    );
    let lastOverlap = 0;
    let firstClear = null;
    let sawOverlap = false;
    const scanDistances = [0];
    for (
      let distance = JUNCTION_OVERLAP_SCAN_STEP_M;
      distance < maximumRun;
      distance += JUNCTION_OVERLAP_SCAN_STEP_M
    ) scanDistances.push(distance);
    if (maximumRun > 0) scanDistances.push(maximumRun);
    for (const distance of scanDistances) {
      if (overlapsAt(distance)) {
        sawOverlap = true;
        lastOverlap = distance;
      } else if (sawOverlap) {
        firstClear = distance;
        break;
      }
    }
    if (!sawOverlap) return Object.freeze({ overlapEndDistance: 0, clearDistance: 0, maximumRun });
    if (firstClear === null) {
      return Object.freeze({ overlapEndDistance: lastOverlap, clearDistance: maximumRun, maximumRun });
    }
    let low = lastOverlap;
    let high = firstClear;
    for (let iteration = 0; iteration < 8; iteration++) {
      const middle = (low + high) * 0.5;
      if (overlapsAt(middle)) low = middle;
      else high = middle;
    }
    return Object.freeze({ overlapEndDistance: low, clearDistance: high, maximumRun });
  }

  function junctionLensTopY(track, records, distance, x, z) {
    let topY = Number.NEGATIVE_INFINITY;
    for (const record of records) {
      const center = sampleJunctionIncident(track, record, distance, 0, {});
      const rightLengthSquared = center.rightX * center.rightX + center.rightZ * center.rightZ || 1;
      const lateral = ((x - center.x) * center.rightX + (z - center.z) * center.rightZ)
        / rightLengthSquared;
      const frame = sampleJunctionIncident(track, record, distance, lateral, {});
      topY = Math.max(topY, frame.y + frame.upY * JUNCTION_APRON_TOP_OFFSET_M);
    }
    return topY;
  }

  /** Build one narrow strip over only the pairwise overlap instead of filling the whole fork with a convex slab. */
  function junctionLensSection(track, leftRecord, rightRecord, distance) {
    const left = sampleJunctionIncident(track, leftRecord, distance, 0, {});
    const right = sampleJunctionIncident(track, rightRecord, distance, 0, {});
    const dx = right.x - left.x;
    const dz = right.z - left.z;
    const centerDistance = Math.hypot(dx, dz);
    const fallbackLength = Math.hypot(left.rightX, left.rightZ) || 1;
    const unitX = centerDistance > 0.000_1 ? dx / centerDistance : left.rightX / fallbackLength;
    const unitZ = centerDistance > 0.000_1 ? dz / centerDistance : left.rightZ / fallbackLength;
    const leftHalf = sampledRoadHalf(left, leftRecord.edge);
    const rightHalf = sampledRoadHalf(right, rightRecord.edge);
    const overlapLow = Math.max(-leftHalf, centerDistance - rightHalf);
    const overlapHigh = Math.min(leftHalf, centerDistance + rightHalf);
    if (!(overlapHigh > overlapLow + 0.001)) return null;
    const first = {
      x: left.x + unitX * overlapLow,
      z: left.z + unitZ * overlapLow
    };
    const second = {
      x: left.x + unitX * overlapHigh,
      z: left.z + unitZ * overlapHigh
    };
    const pair = [leftRecord, rightRecord];
    first.y = junctionLensTopY(track, pair, distance, first.x, first.z);
    second.y = junctionLensTopY(track, pair, distance, second.x, second.z);
    return Object.freeze({
      distance,
      crossWidth: overlapHigh - overlapLow,
      first: Object.freeze(first),
      second: Object.freeze(second)
    });
  }

  /**
   * Audit the rendered longitudinal strip rather than trusting its row count: every significant-overlap station
   * must belong to the compact apron or to one contiguous lens segment, and the next bracket must be clear.
   */
  const JUNCTION_LENS_AUDIT_STATIONS_PER_STEP = 24;

  function createJunctionLensCoverageAuditJob(
    track,
    leftRecord,
    rightRecord,
    compactRun,
    startDistance,
    overlapEnvelope,
    sections
  ) {
    const segmentIntervals = [];
    for (let index = 0; index + 1 < sections.length; index++) {
      const current = sections[index];
      const next = sections[index + 1];
      const span = next.distance - current.distance;
      if (span >= 0 && span <= JUNCTION_LENS_SAMPLE_STEP_M + 0.000_1) {
        segmentIntervals.push(Object.freeze({ start: current.distance, end: next.distance }));
      }
    }
    const firstSectionDistance = sections[0]?.distance;
    const lastSectionDistance = sections.at(-1)?.distance;
    const apronLensContinuityFailureCount = Number.isFinite(firstSectionDistance)
      && startDistance <= compactRun
      && firstSectionDistance <= compactRun + JUNCTION_LENS_ENDPOINT_AUDIT_TOLERANCE_M
      && Math.abs(firstSectionDistance - startDistance) <= JUNCTION_LENS_ENDPOINT_AUDIT_TOLERANCE_M
      ? 0
      : 1;
    const endClearanceError = Number.isFinite(lastSectionDistance)
      ? Math.max(0, overlapEnvelope.clearDistance - lastSectionDistance)
      : overlapEnvelope.clearDistance;
    const endClearanceFailureCount = endClearanceError <= JUNCTION_LENS_ENDPOINT_AUDIT_TOLERANCE_M ? 0 : 1;

    function lensCovers(distance) {
      return segmentIntervals.some((interval) => (
        distance >= interval.start - 0.000_1 && distance <= interval.end + 0.000_1
      ));
    }

    let coverageStationCount = 0;
    let uncoveredStationCount = 0;
    let coverageDistance = 0;
    let coverageEndAudited = false;
    function auditCoverageStation(distance) {
      coverageStationCount++;
      if (distance <= compactRun + 0.000_1 || lensCovers(distance)) return;
      uncoveredStationCount++;
    }

    let postEndClearanceFailureCount = overlapEnvelope.clearanceVerified ? 0 : 1;
    const clearAuditEnd = Math.min(
      overlapEnvelope.maximumRun,
      overlapEnvelope.clearDistance + JUNCTION_LENS_CLEAR_AUDIT_SPAN_M
    );
    let clearAuditDistance = overlapEnvelope.clearDistance;
    let phase = 'coverage';
    let result = null;

    function publish() {
      const clearanceFailureCount = endClearanceFailureCount + postEndClearanceFailureCount;
      result = Object.freeze({
        coverageStationCount,
        uncoveredStationCount,
        apronLensContinuityFailureCount,
        clearanceFailureCount,
        endClearanceError,
        residualOverlapCount: uncoveredStationCount
          + apronLensContinuityFailureCount
          + clearanceFailureCount
      });
    }

    function step() {
      if (result) return true;
      if (phase === 'coverage') {
        let processed = 0;
        while (processed < JUNCTION_LENS_AUDIT_STATIONS_PER_STEP
          && coverageDistance < overlapEnvelope.overlapEndDistance) {
          auditCoverageStation(coverageDistance);
          coverageDistance += JUNCTION_LENS_COVERAGE_AUDIT_STEP_M;
          processed++;
        }
        if (processed < JUNCTION_LENS_AUDIT_STATIONS_PER_STEP && !coverageEndAudited) {
          auditCoverageStation(overlapEnvelope.overlapEndDistance);
          coverageEndAudited = true;
        }
        if (coverageEndAudited) phase = 'clearance';
        return false;
      }
      if (phase === 'clearance') {
        let processed = 0;
        while (processed < JUNCTION_LENS_AUDIT_STATIONS_PER_STEP
          && clearAuditDistance <= clearAuditEnd + 0.000_1) {
          if (junctionIncidentPairOverlaps(track, leftRecord, rightRecord, clearAuditDistance)) {
            postEndClearanceFailureCount++;
          }
          clearAuditDistance += JUNCTION_LENS_CLEAR_AUDIT_STEP_M;
          processed++;
        }
        if (clearAuditDistance > clearAuditEnd + 0.000_1) phase = 'publish';
        return false;
      }
      publish();
      return true;
    }

    function finish() {
      if (!result) throw new Error('Junction lens coverage audit is not complete');
      return result;
    }

    return Object.freeze({ step, finish, get phase() { return phase; } });
  }

  function junctionLensCoverageAudit(
    track,
    leftRecord,
    rightRecord,
    compactRun,
    startDistance,
    overlapEnvelope,
    sections
  ) {
    const job = createJunctionLensCoverageAuditJob(
      track,
      leftRecord,
      rightRecord,
      compactRun,
      startDistance,
      overlapEnvelope,
      sections
    );
    while (!job.step()) {
      // Synchronous audit users drain the exact resumable station job used by warm rendering.
    }
    return job.finish();
  }

  const JUNCTION_VERTICAL_AUDIT_STATIONS_PER_STEP = 24;

  /** Resumable 0.5m audit proves plan-overlapping siblings have vertically disjoint deck-and-rail shells. */
  function createJunctionVerticalSeparationAuditJob(track, records, compactRun) {
    const recordPairs = [];
    for (let leftIndex = 0; leftIndex < records.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex++) {
        recordPairs.push(Object.freeze({
          leftRecord: records[leftIndex],
          rightRecord: records[rightIndex]
        }));
      }
    }
    const pairs = [];
    let stationCount = 0;
    let failureCount = 0;
    let minimumShellGap = Number.POSITIVE_INFINITY;
    let pairIndex = 0;
    let activePair = null;
    let result = null;

    function beginPair() {
      while (!activePair && pairIndex < recordPairs.length) {
        const { leftRecord, rightRecord } = recordPairs[pairIndex++];
        const planEnvelope = junctionIncidentPairShellPlanRun(track, leftRecord, rightRecord);
        if (planEnvelope.overlapEndDistance <= compactRun + 0.5) continue;
        const surfaceEnvelope = junctionIncidentPairOverlapRun(track, leftRecord, rightRecord);
        if (surfaceEnvelope.overlapEndDistance > compactRun + 0.5) continue;
        activePair = {
          leftRecord,
          rightRecord,
          planEnvelope,
          nextDistance: compactRun,
          endAudited: false,
          stationCount: 0,
          failureCount: 0,
          minimumShellGap: Number.POSITIVE_INFINITY
        };
      }
    }

    function auditActiveStation(distance) {
      const separation = junctionIncidentPairShellSeparation(
        track,
        activePair.leftRecord,
        activePair.rightRecord,
        distance
      );
      if (!separation.planarOverlap) return;
      activePair.stationCount++;
      activePair.minimumShellGap = Math.min(activePair.minimumShellGap, separation.verticalGap);
      if (separation.overlaps) activePair.failureCount++;
    }

    function finishActivePair() {
      if (junctionIncidentPairShellSeparation(
        track,
        activePair.leftRecord,
        activePair.rightRecord,
        activePair.planEnvelope.clearDistance
      ).planarOverlap) activePair.failureCount++;
      stationCount += activePair.stationCount;
      failureCount += activePair.failureCount;
      minimumShellGap = Math.min(minimumShellGap, activePair.minimumShellGap);
      pairs.push(Object.freeze({
        edgeIds: Object.freeze([activePair.leftRecord.edge.id, activePair.rightRecord.edge.id]),
        startDistance: compactRun,
        endDistance: activePair.planEnvelope.overlapEndDistance,
        verifiedClearDistance: activePair.planEnvelope.clearDistance,
        stationCount: activePair.stationCount,
        failureCount: activePair.failureCount,
        minimumShellGap: activePair.minimumShellGap
      }));
      activePair = null;
    }

    function publish() {
      result = Object.freeze({
        pairCount: pairs.length,
        stationCount,
        failureCount,
        minimumShellGap: Number.isFinite(minimumShellGap) ? minimumShellGap : null,
        pairs: Object.freeze(pairs)
      });
    }

    function step() {
      if (result) return true;
      beginPair();
      if (!activePair) {
        publish();
        return true;
      }
      let processedStations = 0;
      while (processedStations < JUNCTION_VERTICAL_AUDIT_STATIONS_PER_STEP
        && activePair.nextDistance < activePair.planEnvelope.overlapEndDistance) {
        auditActiveStation(activePair.nextDistance);
        activePair.nextDistance += JUNCTION_LENS_COVERAGE_AUDIT_STEP_M;
        processedStations++;
      }
      if (processedStations < JUNCTION_VERTICAL_AUDIT_STATIONS_PER_STEP && !activePair.endAudited) {
        auditActiveStation(activePair.planEnvelope.overlapEndDistance);
        activePair.endAudited = true;
        processedStations++;
      }
      if (activePair.endAudited) finishActivePair();
      return false;
    }

    function finish() {
      if (!result) throw new Error('Junction vertical-separation audit is not complete');
      return result;
    }

    return Object.freeze({ step, finish });
  }

  function junctionVerticalSeparationAudit(track, records, compactRun) {
    const job = createJunctionVerticalSeparationAuditJob(track, records, compactRun);
    while (!job.step()) {
      // Synchronous diagnostics loop the exact station-chunk job consumed by warm rendering.
    }
    return job.finish();
  }

  function createJunctionOverlapLensLayoutJob(
    track,
    node,
    records,
    compactRun,
    lensSectionTransform = null
  ) {
    const recordPairs = [];
    for (let leftIndex = 0; leftIndex < records.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex++) {
        recordPairs.push(Object.freeze({
          leftRecord: records[leftIndex],
          rightRecord: records[rightIndex]
        }));
      }
    }
    let pairCursor = 0;
    let longestPair = null;
    let startDistance = 0;
    let nextSectionDistance = 0;
    let endSectionGenerated = false;
    const generatedSections = [];
    let sections = [];
    let maximumCrossWidth = 0;
    let topologyFailureCount = 0;
    let coverageJob = null;
    let coverageAudit = null;
    let phase = 'pairs';
    let complete = false;
    let result = null;

    function inspectOnePair() {
      const { leftRecord, rightRecord } = recordPairs[pairCursor++];
      const overlapEnvelope = junctionIncidentPairOverlapRun(track, leftRecord, rightRecord);
      if (!longestPair || overlapEnvelope.overlapEndDistance > longestPair.overlapEndDistance) {
        longestPair = { leftRecord, rightRecord, ...overlapEnvelope };
      }
    }

    function generateOneSection() {
      let distance = null;
      if (nextSectionDistance < longestPair.overlapEndDistance) {
        distance = nextSectionDistance;
        nextSectionDistance += JUNCTION_LENS_SAMPLE_STEP_M;
      } else if (!endSectionGenerated) {
        distance = longestPair.overlapEndDistance;
        endSectionGenerated = true;
      }
      if (distance === null) {
        phase = 'transform';
        return;
      }
      const section = junctionLensSection(
        track,
        longestPair.leftRecord,
        longestPair.rightRecord,
        distance
      );
      if (section) generatedSections.push(section);
    }

    function transformSections() {
      // Inspection-only fault injection proves residual diagnostics fail closed without changing rendered geometry.
      const transformedSections = typeof lensSectionTransform === 'function'
        ? lensSectionTransform(Object.freeze({
          nodeId: node.id,
          endDistance: longestPair.overlapEndDistance,
          sections: Object.freeze(generatedSections)
        }))
        : generatedSections;
      sections = Array.isArray(transformedSections) ? transformedSections : [];
      for (const section of sections) {
        maximumCrossWidth = Math.max(maximumCrossWidth, Number(section?.crossWidth) || 0);
        if (
          !Number.isFinite(section?.first?.x)
          || !Number.isFinite(section?.first?.y)
          || !Number.isFinite(section?.first?.z)
          || !Number.isFinite(section?.second?.x)
          || !Number.isFinite(section?.second?.y)
          || !Number.isFinite(section?.second?.z)
          || !(section?.crossWidth > 0)
        ) topologyFailureCount = 1;
      }
      if (sections.length < 2) topologyFailureCount = 1;
      coverageJob = createJunctionLensCoverageAuditJob(
        track,
        longestPair.leftRecord,
        longestPair.rightRecord,
        compactRun,
        startDistance,
        longestPair,
        sections
      );
      phase = 'coverage';
    }

    function publish() {
      result = Object.freeze({
        nodeId: node.id,
        nodeKind: node.kind,
        edgeIds: Object.freeze([
          longestPair.leftRecord.edge.id,
          longestPair.rightRecord.edge.id
        ]),
        startDistance,
        endDistance: longestPair.overlapEndDistance,
        verifiedClearDistance: longestPair.clearDistance,
        clearanceTolerance: JUNCTION_LENS_CLEARANCE_TOLERANCE_M,
        maximumCrossWidth,
        coverageStationCount: coverageAudit.coverageStationCount,
        uncoveredStationCount: coverageAudit.uncoveredStationCount,
        apronLensContinuityFailureCount: coverageAudit.apronLensContinuityFailureCount,
        clearanceFailureCount: coverageAudit.clearanceFailureCount,
        endClearanceError: coverageAudit.endClearanceError,
        residualOverlapCount: coverageAudit.residualOverlapCount,
        topologyFailureCount,
        sections: Object.freeze(sections)
      });
      complete = true;
      phase = 'done';
    }

    function step() {
      if (complete) return true;
      if (phase === 'pairs') {
        if (pairCursor < recordPairs.length) {
          inspectOnePair();
          return false;
        }
        if (!longestPair || longestPair.overlapEndDistance <= compactRun + 0.5) {
          complete = true;
          phase = 'done';
          return true;
        }
        startDistance = Math.max(0, compactRun - JUNCTION_LENS_COMPACT_OVERLAP_M);
        nextSectionDistance = startDistance;
        phase = 'sections';
        return false;
      }
      if (phase === 'sections') {
        generateOneSection();
        return false;
      }
      if (phase === 'transform') {
        transformSections();
        return false;
      }
      if (phase === 'coverage') {
        if (!coverageJob.step()) return false;
        coverageAudit = coverageJob.finish();
        phase = 'publish';
        return false;
      }
      publish();
      return true;
    }

    function finish() {
      if (!complete) throw new Error('Junction overlap-lens layout is not complete');
      return result;
    }

    return Object.freeze({
      step,
      finish,
      get phase() {
        return phase === 'coverage' ? `coverage-${coverageJob?.phase || 'start'}` : phase;
      }
    });
  }

  function junctionOverlapLensLayout(track, node, records, compactRun, lensSectionTransform = null) {
    const job = createJunctionOverlapLensLayoutJob(
      track,
      node,
      records,
      compactRun,
      lensSectionTransform
    );
    while (!job.step()) {
      // Synchronous diagnostics drain the exact resumable pair, section, and coverage job used by rendering.
    }
    return job.finish();
  }

  /** Resumable node-by-node inspection keeps the warm geometry build inside its caller-provided frame budget. */
  function createJunctionApronInspectionJob(track, sourceEdges = edgeList(track), inspectionOptions = null) {
    const candidates = nodeList(track).filter((node) => JUNCTION_APRON_NODE_KINDS.has(node.kind))
      .map((node) => ({ node, records: junctionIncidentRecords(node, sourceEdges) }))
      .filter((candidate) => candidate.records.length > 0);
    const layouts = [];
    const lenses = [];
    const verticalSeparations = [];
    const junctionAudits = [];
    let coverageMissCount = 0;
    let maximumSpan = 0;
    let longPairCount = 0;
    let residualOverlapCount = 0;
    let maximumRun = 0;
    let maximumCrossWidth = 0;
    let topologyFailureCount = 0;
    let coverageStationCount = 0;
    let uncoveredStationCount = 0;
    let apronLensContinuityFailureCount = 0;
    let clearanceFailureCount = 0;
    let maximumEndClearanceError = 0;
    let verticallySeparatedPairCount = 0;
    let verticalSeparationStationCount = 0;
    let verticalSeparationFailureCount = 0;
    let minimumVerticalShellGap = Number.POSITIVE_INFINITY;
    let candidateIndex = 0;
    let activeCandidate = null;
    let phase = 'candidate';
    let result = null;

    function completeCandidate() {
      activeCandidate = null;
      candidateIndex++;
      phase = 'candidate';
    }

    function inspectCandidateLayout() {
      const { node, records } = activeCandidate;
      if (records.length < 2) {
        coverageMissCount++;
        completeCandidate();
        return;
      }
      const layout = junctionApronLayout(track, node, records);
      if (layout.hull.length < 3 || layout.hull.some((point) => (
        !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
      ))) {
        coverageMissCount++;
        completeCandidate();
        return;
      }
      maximumSpan = Math.max(maximumSpan, layout.maximumSpan);
      layouts.push(layout);
      activeCandidate.layout = layout;
      phase = 'vertical';
    }

    function inspectCandidateVerticalSeparation() {
      const { node, records, layout } = activeCandidate;
      if (!activeCandidate.verticalJob) {
        activeCandidate.verticalJob = createJunctionVerticalSeparationAuditJob(track, records, layout.run);
      }
      if (!activeCandidate.verticalJob.step()) return;
      const verticalAudit = activeCandidate.verticalJob.finish();
      verticallySeparatedPairCount += verticalAudit.pairCount;
      verticalSeparationStationCount += verticalAudit.stationCount;
      verticalSeparationFailureCount += verticalAudit.failureCount;
      residualOverlapCount += verticalAudit.failureCount;
      if (verticalAudit.minimumShellGap !== null) {
        minimumVerticalShellGap = Math.min(minimumVerticalShellGap, verticalAudit.minimumShellGap);
      }
      for (const pair of verticalAudit.pairs) {
        verticalSeparations.push(Object.freeze({
          nodeId: node.id,
          nodeKind: node.kind,
          ...pair
        }));
      }
      activeCandidate.verticalAudit = verticalAudit;
      phase = 'lens';
    }

    function inspectCandidateLens() {
      const { node, records, layout, verticalAudit } = activeCandidate;
      if (!activeCandidate.lensJob) {
        activeCandidate.lensJob = createJunctionOverlapLensLayoutJob(
          track,
          node,
          records,
          layout.run,
          inspectionOptions?.lensSectionTransform
        );
        return;
      }
      if (!activeCandidate.lensJob.step()) return;
      const lens = activeCandidate.lensJob.finish();
      if (lens) {
        longPairCount++;
        residualOverlapCount += lens.residualOverlapCount;
        topologyFailureCount += lens.topologyFailureCount;
        coverageStationCount += lens.coverageStationCount;
        uncoveredStationCount += lens.uncoveredStationCount;
        apronLensContinuityFailureCount += lens.apronLensContinuityFailureCount;
        clearanceFailureCount += lens.clearanceFailureCount;
        maximumEndClearanceError = Math.max(maximumEndClearanceError, lens.endClearanceError);
        maximumRun = Math.max(maximumRun, lens.endDistance);
        maximumCrossWidth = Math.max(maximumCrossWidth, lens.maximumCrossWidth);
        if (lens.topologyFailureCount === 0) lenses.push(lens);
      }
      junctionAudits.push(Object.freeze({
        nodeId: node.id,
        nodeKind: node.kind,
        compactRun: layout.run,
        mode: lens ? 'overlap-lens' : verticalAudit.pairCount ? 'vertical-separation' : 'compact-only',
        residualOverlapCount: verticalAudit.failureCount + (lens?.residualOverlapCount || 0)
      }));
      completeCandidate();
    }

    function publish() {
      result = Object.freeze({
        candidateCount: candidates.length,
        coverageMissCount,
        maximumSpan,
        topLift: JUNCTION_APRON_TOP_OFFSET_M - JUNCTION_APRON_DECK_TOP_M,
        layouts: Object.freeze(layouts),
        longPairCount,
        lensCount: lenses.length,
        residualOverlapCount,
        maximumRun,
        maximumCrossWidth,
        clearanceTolerance: JUNCTION_LENS_CLEARANCE_TOLERANCE_M,
        coverageStationCount,
        uncoveredStationCount,
        apronLensContinuityFailureCount,
        clearanceFailureCount,
        maximumEndClearanceError,
        verticallySeparatedPairCount,
        verticalSeparationStationCount,
        verticalSeparationFailureCount,
        minimumVerticalShellGap: Number.isFinite(minimumVerticalShellGap)
          ? minimumVerticalShellGap
          : null,
        topologyFailureCount,
        lenses: Object.freeze(lenses),
        verticalSeparations: Object.freeze(verticalSeparations),
        junctionAudits: Object.freeze(junctionAudits)
      });
    }

    function step() {
      if (result) return true;
      if (!activeCandidate) {
        if (candidateIndex >= candidates.length) {
          publish();
          return true;
        }
        const { node, records } = candidates[candidateIndex];
        activeCandidate = {
          node,
          records,
          layout: null,
          verticalAudit: null,
          verticalJob: null,
          lensJob: null
        };
        phase = 'layout';
      }
      if (phase === 'layout') inspectCandidateLayout();
      else if (phase === 'vertical') inspectCandidateVerticalSeparation();
      else if (phase === 'lens') inspectCandidateLens();
      return false;
    }

    function finish() {
      if (!result) throw new Error('Junction apron inspection is not complete');
      return result;
    }

    return Object.freeze({
      step,
      finish,
      get processedCount() { return candidateIndex; },
      get phase() {
        return phase === 'lens'
          ? `lens-${activeCandidate?.lensJob?.phase || 'create'}`
          : phase;
      },
      candidateCount: candidates.length
    });
  }

  /** Public synchronous inspection loops the same resumable job used by rendering, so diagnostics cannot drift. */
  function inspectJunctionAprons(track, sourceEdges = edgeList(track), inspectionOptions = null) {
    const job = createJunctionApronInspectionJob(track, sourceEdges, inspectionOptions);
    while (!job.step()) {
      // Node tests and diagnostics intentionally use the compatibility path; warm rendering advances one step at a time.
    }
    return job.finish();
  }

  /** Build one sealed apron; the raised top masks sibling shell intersections while the skirt hides every cut edge. */
  function createJunctionApronGeometry(THREE, layout, tileOrigin) {
    const ringCount = layout.hull.length;
    const topCenter = 0;
    const topRingStart = 1;
    const bottomCenter = ringCount + 1;
    const bottomRingStart = ringCount + 2;
    const vertexCount = (ringCount + 1) * 2;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const roadCoordinates = new Float32Array(vertexCount * 2);
    const indices = new Uint16Array(ringCount * 12);
    const apronColor = new THREE.Color(0xc7_c7c3);
    const center = layout.hull.reduce((value, point) => ({
      x: value.x + point.x / ringCount,
      y: value.y + point.y / ringCount,
      z: value.z + point.z / ringCount
    }), { x: 0, y: 0, z: 0 });
    const inverseHalfSpan = 1 / Math.max(1, layout.maximumSpan * 0.5);

    function writeVertex(index, point, shade) {
      const offset = index * 3;
      positions[offset] = point.x - tileOrigin.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z - tileOrigin.z;
      colors[offset] = apronColor.r * shade;
      colors[offset + 1] = apronColor.g * shade;
      colors[offset + 2] = apronColor.b * shade;
      const roadCoordinateOffset = index * 2;
      const relativeY = point.y - center.y;
      // The node-local planar basis keeps the top two-dimensional. A small vertical contribution gives skirts a
      // second texture axis, while neither coordinate changes the physical junction surface or route authority.
      roadCoordinates[roadCoordinateOffset] = (point.x - center.x) * inverseHalfSpan
        + relativeY * 0.125;
      roadCoordinates[roadCoordinateOffset + 1] = point.z - center.z + relativeY * 0.375;
    }

    writeVertex(topCenter, center, 1);
    writeVertex(bottomCenter, { ...center, y: center.y - JUNCTION_APRON_DEPTH_M }, 0.52);
    for (let index = 0; index < ringCount; index++) {
      const point = layout.hull[index];
      writeVertex(topRingStart + index, point, 1);
      writeVertex(bottomRingStart + index, { ...point, y: point.y - JUNCTION_APRON_DEPTH_M }, 0.68);
    }

    let indexCursor = 0;
    for (let index = 0; index < ringCount; index++) {
      const next = (index + 1) % ringCount;
      const topCurrent = topRingStart + index;
      const topNext = topRingStart + next;
      const bottomCurrent = bottomRingStart + index;
      const bottomNext = bottomRingStart + next;
      indices[indexCursor++] = topCenter;
      indices[indexCursor++] = topNext;
      indices[indexCursor++] = topCurrent;
      indices[indexCursor++] = bottomCenter;
      indices[indexCursor++] = bottomCurrent;
      indices[indexCursor++] = bottomNext;
      indices[indexCursor++] = topCurrent;
      indices[indexCursor++] = topNext;
      indices[indexCursor++] = bottomNext;
      indices[indexCursor++] = topCurrent;
      indices[indexCursor++] = bottomNext;
      indices[indexCursor++] = bottomCurrent;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('roadCoord', new THREE.BufferAttribute(roadCoordinates, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.junctionApronNodeId = layout.nodeId;
    geometry.userData.junctionApronTopologyFailureCount = indexCursor === indices.length ? 0 : 1;
    return geometry;
  }

  /** Seal one sampled overlap lens; its start hides under the compact apron and its narrow end meets the gore. */
  function createJunctionOverlapLensGeometry(THREE, layout, tileOrigin) {
    const rowCount = layout.sections.length;
    const verticesPerRow = 4;
    const positions = new Float32Array(rowCount * verticesPerRow * 3);
    const colors = new Float32Array(positions.length);
    const roadCoordinates = new Float32Array(rowCount * verticesPerRow * 2);
    const segmentCount = Math.max(0, rowCount - 1);
    const indices = new Uint16Array(segmentCount * 24 + 12);
    const lensColor = new THREE.Color(0xc7_c7c3);

    function writeVertex(index, point, y, shade, lateralCoordinate, station, verticalDepth = 0) {
      const offset = index * 3;
      positions[offset] = point.x - tileOrigin.x;
      positions[offset + 1] = y;
      positions[offset + 2] = point.z - tileOrigin.z;
      colors[offset] = lensColor.r * shade;
      colors[offset + 1] = lensColor.g * shade;
      colors[offset + 2] = lensColor.b * shade;
      const roadCoordinateOffset = index * 2;
      // Lens rows already follow the physical overlap station. Their explicit -1/+1 cross coordinate prevents
      // the High shader from receiving a constant field as the overlap tapers into the gore.
      roadCoordinates[roadCoordinateOffset] = lateralCoordinate + verticalDepth * 0.125;
      roadCoordinates[roadCoordinateOffset + 1] = station + verticalDepth * 0.375;
    }

    for (let row = 0; row < rowCount; row++) {
      const section = layout.sections[row];
      const base = row * verticesPerRow;
      writeVertex(base, section.first, section.first.y, 1, -1, section.distance);
      writeVertex(base + 1, section.second, section.second.y, 1, 1, section.distance);
      writeVertex(
        base + 2,
        section.first,
        section.first.y - JUNCTION_LENS_THICKNESS_M,
        0.66,
        -1,
        section.distance,
        JUNCTION_LENS_THICKNESS_M
      );
      writeVertex(
        base + 3,
        section.second,
        section.second.y - JUNCTION_LENS_THICKNESS_M,
        0.66,
        1,
        section.distance,
        JUNCTION_LENS_THICKNESS_M
      );
    }

    let indexCursor = 0;
    const writeTriangle = (a, b, c) => {
      indices[indexCursor++] = a;
      indices[indexCursor++] = b;
      indices[indexCursor++] = c;
    };
    for (let row = 0; row < segmentCount; row++) {
      const current = row * verticesPerRow;
      const next = current + verticesPerRow;
      writeTriangle(current, current + 1, next + 1);
      writeTriangle(current, next + 1, next);
      writeTriangle(current + 2, next + 2, next + 3);
      writeTriangle(current + 2, next + 3, current + 3);
      writeTriangle(current, next, next + 2);
      writeTriangle(current, next + 2, current + 2);
      writeTriangle(current + 1, current + 3, next + 3);
      writeTriangle(current + 1, next + 3, next + 1);
    }
    const start = 0;
    const end = (rowCount - 1) * verticesPerRow;
    writeTriangle(start, start + 2, start + 3);
    writeTriangle(start, start + 3, start + 1);
    writeTriangle(end, end + 1, end + 3);
    writeTriangle(end, end + 3, end + 2);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('roadCoord', new THREE.BufferAttribute(roadCoordinates, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.junctionLensNodeId = layout.nodeId;
    geometry.userData.junctionLensTopologyFailureCount = layout.topologyFailureCount
      + (indexCursor === indices.length ? 0 : 1);
    return geometry;
  }

  /** Build one thick ribbon in row chunks; only truly exposed terminals receive cross-section caps. */
  function createEdgeShellBuildJob(
    THREE,
    track,
    edge,
    sampleStep,
    tileOrigin,
    inspectBarrier = null,
    endpointCaps = Object.freeze({ start: true, end: true }),
    isolateWarmup = false,
    topologySeamBias = null
  ) {
    const rows = Math.max(6, Math.ceil(edge.length / sampleStep));
    const ringSize = 12;
    const ringVertices = (rows + 1) * ringSize;
    const capCount = (endpointCaps.start ? 1 : 0) + (endpointCaps.end ? 1 : 0);
    const recessedTopologySealCount = 2 - capCount;
    const startCap = endpointCaps.start ? ringVertices : -1;
    const endCap = endpointCaps.end ? ringVertices + (endpointCaps.start ? 1 : 0) : -1;
    const sealVertexStart = ringVertices + capCount;
    const startSealRing = endpointCaps.start ? -1 : sealVertexStart;
    const startSealCenter = endpointCaps.start ? -1 : startSealRing + ringSize;
    const endSealRing = endpointCaps.end
      ? -1
      : sealVertexStart + (endpointCaps.start ? 0 : ringSize + 1);
    const endSealCenter = endpointCaps.end ? -1 : endSealRing + ringSize;
    const totalVertexCount = ringVertices + capCount + recessedTopologySealCount * (ringSize + 1);
    const positions = new Float32Array(totalVertexCount * 3);
    const colors = new Float32Array(positions.length);
    // Stable road-space attributes let every quality tier retain authored tunnel light without another draw batch.
    const roadCoordinates = new Float32Array(totalVertexCount * 2);
    const staticTunnelIrradiance = new Float32Array(totalVertexCount);
    const staticTunnelIrradianceProfiles = createEdgeStaticTunnelIrradianceProfiles(edge);
    const tunnelEnclosure = new Float32Array(totalVertexCount);
    const indexCount = rows * ringSize * 6
      + capCount * ringSize * 3
      + recessedTopologySealCount * ringSize * 9;
    const IndexArray = totalVertexCount > 65_535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(indexCount);
    const scratch = {};
    const familyColor = new THREE.Color(FAMILY_COLORS[edge.family] || FAMILY_COLORS.mainline);
    const forkVoidBoundaryColor = new THREE.Color(0xe7_bf58);
    let rowCursor = 0;
    let rowState = null;
    let isolatedUnitSteps = isolateWarmup ? 8 : 0;
    let phase = 'rows';
    let geometry = null;
    let normals = null;
    let triangleCursor = 0;
    let normalVertexCursor = 0;
    let dynamicWidthSampleCount = 0;
    let maximumRoadHalfError = 0;
    let maximumDeckThicknessError = 0;
    let junctionBiasSampleCount = 0;
    let trimmedBarrierSampleCount = 0;
    let retainedJunctionBoundaryCount = 0;
    let junctionRaisedBarrierIntrusionCount = 0;
    let straightForkVoidBoundarySampleCount = 0;
    let maximumStraightForkVoidBoundaryHeightM = 0;
    const suppressedConnectedCapCount = 2 - capCount;
    let topologyIndexContractValid = false;
    let topologyDegenerateTriangleCount = 0;
    let topologyInvalidCoordinateCount = 0;
    const recessedTopologySealDepthM = 0.08;
    const recessedTopologySealScale = 0.997;

    function beginRow(row) {
      const edgeS = edge.length * row / rows;
      const centerFrame = sample(track, edge.id, edgeS, 0, scratch);
      const halfWidth = sampledRoadHalf(centerFrame, edge);
      const deckDepth = sampledDeckDepth(track, centerFrame);
      const surfaceBias = junctionSurfaceBias(edge, edgeS);
      maximumRoadHalfError = Math.max(
        maximumRoadHalfError,
        Math.abs(halfWidth - (Number.isFinite(centerFrame.roadHalf) ? centerFrame.roadHalf : halfWidth))
      );
      const contract = track.graph?.contract || {};
      const lowerHeight = Number(contract.lowerHeight) || 0;
      const upperHeight = Number(contract.upperHeight) || 0;
      if (centerFrame.structure === 'cloverleaf-overpass' || centerFrame.y >= upperHeight - lowerHeight - 0.01) {
        maximumDeckThicknessError = Math.max(
          maximumDeckThicknessError,
          Math.abs(deckDepth - (Number(contract.deckThickness) || deckDepth))
        );
      }
      if (Math.abs(surfaceBias) > 0.000_1) junctionBiasSampleCount++;
      if (Math.abs(halfWidth - Number(edge.roadHalf || edge.halfWidth || halfWidth)) > 0.001) {
        dynamicWidthSampleCount++;
      }
      rowState = {
        row,
        edgeS,
        halfWidth,
        deckDepth,
        surfaceBias,
        staticTunnelIrradiance: sampleEdgeStaticTunnelIrradiance(
          staticTunnelIrradianceProfiles,
          edgeS
        ),
        tunnelEnclosure: sampleEdgeTunnelEnclosure(edge.tunnelProfiles, edgeS),
        straightForkVoidWidthM: Number(centerFrame.straightForkVoidWidthM) || 0,
        voidBoundaryEnvelope: 0,
        leftBarrier: null,
        rightBarrier: null,
        leftBarrierJob: null,
        rightBarrierJob: null,
        ringProfile: null,
        sideCursor: 0,
        stage: 'left-barrier'
      };
    }

    function inspectRowBarrier(side) {
      const jobKey = side < 0 ? 'leftBarrierJob' : 'rightBarrierJob';
      if (!rowState[jobKey] && inspectBarrier?.createJob) {
        rowState[jobKey] = inspectBarrier.createJob(edge, rowState.edgeS, side, rowState.halfWidth);
      }
      const job = rowState[jobKey];
      if (job && !job.step()) return false;
      const result = job?.finish?.()
        || inspectBarrier?.(edge, rowState.edgeS, side, rowState.halfWidth)
        || { keep: true, overlaps: false };
      if (!result.keep) trimmedBarrierSampleCount++;
      else if (result.overlaps) retainedJunctionBoundaryCount++;
      if (result.keep && result.intrudesSafeCorridor) junctionRaisedBarrierIntrusionCount++;
      if (side < 0) rowState.leftBarrier = result;
      else rowState.rightBarrier = result;
      return true;
    }

    function prepareRingProfile() {
      const { halfWidth, deckDepth, leftBarrier, rightBarrier } = rowState;
      const rightForkInnerLeft = edge.family === 'straight-fork-branch' && edge.forkSide === 'right';
      const leftForkInnerRight = edge.family === 'straight-fork-branch' && edge.forkSide === 'left';
      rowState.voidBoundaryEnvelope = smootherStep01(
        rowState.straightForkVoidWidthM / STRAIGHT_FORK_VOID_BOUNDARY_FULL_WIDTH_M
      );
      const voidBoundaryHeight = 0.10
        + (STRAIGHT_FORK_VOID_BOUNDARY_HEIGHT_M - 0.10) * rowState.voidBoundaryEnvelope;
      if (rowState.voidBoundaryEnvelope > 0) {
        straightForkVoidBoundarySampleCount++;
        maximumStraightForkVoidBoundaryHeightM = Math.max(
          maximumStraightForkVoidBoundaryHeightM,
          voidBoundaryHeight
        );
      }
      const leftBarrierHeight = rightForkInnerLeft
        ? voidBoundaryHeight
        : leftBarrier.keep ? 0.58 : 0.10;
      const rightBarrierHeight = leftForkInnerRight
        ? voidBoundaryHeight
        : rightBarrier.keep ? 0.58 : 0.10;
      // Collapsing only the conflicting rail crown keeps the thick ribbon sealed while opening the sibling junction.
      rowState.ringProfile = [
        [-halfWidth - 0.28, -deckDepth],
        [-halfWidth - 0.22, 0],
        [-halfWidth - 0.18, leftBarrierHeight],
        [-halfWidth + 0.02, leftBarrierHeight],
        [-halfWidth + 0.10, 0.10],
        [halfWidth - 0.10, 0.10],
        [halfWidth - 0.02, rightBarrierHeight],
        [halfWidth + 0.18, rightBarrierHeight],
        [halfWidth + 0.22, 0],
        [halfWidth + 0.28, -deckDepth],
        [halfWidth - 0.28, -deckDepth],
        [-halfWidth + 0.28, -deckDepth]
      ];
    }

    function writeSideBatch() {
      const sideEnd = Math.min(ringSize, rowState.sideCursor + 4);
      for (let side = rowState.sideCursor; side < sideEnd; side++) {
        const [lateral, vertical] = rowState.ringProfile[side];
        const frame = sample(track, edge.id, rowState.edgeS, lateral, scratch);
        const vertex = rowState.row * ringSize + side;
        const p = vertex * 3;
        positions[p] = frame.x - tileOrigin.x + frame.upX * (vertical + rowState.surfaceBias)
          + (topologySeamBias?.x || 0);
        positions[p + 1] = frame.y + frame.upY * (vertical + rowState.surfaceBias);
        positions[p + 2] = frame.z - tileOrigin.z + frame.upZ * (vertical + rowState.surfaceBias)
          + (topologySeamBias?.z || 0);
        const roadCoordinateOffset = vertex * 2;
        roadCoordinates[roadCoordinateOffset] = rowState.halfWidth > 0
          ? lateral / rowState.halfWidth
          : 0;
        roadCoordinates[roadCoordinateOffset + 1] = rowState.edgeS;
        const onDeck = side === 4 || side === 5;
        const onBarrierTop = side === 3 || side === 6;
        // Deck vertices carry the full light map. Adjacent shoulders/barrier crowns receive only bounced energy;
        // the sealed underside remains dark so the road never reads as a self-illuminated slab.
        staticTunnelIrradiance[vertex] = rowState.staticTunnelIrradiance * (
          onDeck ? 1 : onBarrierTop ? 0.52 : side === 1 || side === 8 ? 0.22 : 0
        );
        // Only the pavement and inward barrier faces live inside the enclosure. The sealed underside and outer
        // skin retain outdoor sky access even though some adjacent shoulder vertices carry weak fixture bounce.
        tunnelEnclosure[vertex] = side >= 3 && side <= 6 ? rowState.tunnelEnclosure : 0;
        const shade = onDeck ? 1 : onBarrierTop ? 0.82 : side === 2 || side === 7 ? 0.64 : 0.42;
        const onForkInnerBoundary = rowState.voidBoundaryEnvelope > 0
          && ((edge.forkSide === 'right' && (side === 2 || side === 3))
            || (edge.forkSide === 'left' && (side === 6 || side === 7)));
        const colorBlend = onForkInnerBoundary ? rowState.voidBoundaryEnvelope : 0;
        colors[p] = (familyColor.r + (forkVoidBoundaryColor.r - familyColor.r) * colorBlend) * shade;
        colors[p + 1] = (familyColor.g + (forkVoidBoundaryColor.g - familyColor.g) * colorBlend) * shade;
        colors[p + 2] = (familyColor.b + (forkVoidBoundaryColor.b - familyColor.b) * colorBlend) * shade;
      }
      rowState.sideCursor = sideEnd;
    }

    function processRowUnit() {
      if (!rowState) {
        beginRow(rowCursor);
        return;
      }
      if (rowState.stage === 'left-barrier') {
        if (inspectRowBarrier(-1)) rowState.stage = 'right-barrier';
        return;
      }
      if (rowState.stage === 'right-barrier') {
        if (inspectRowBarrier(1)) rowState.stage = 'profile';
        return;
      }
      if (rowState.stage === 'profile') {
        prepareRingProfile();
        rowState.stage = 'vertices';
        return;
      }
      writeSideBatch();
      if (rowState.sideCursor >= ringSize) {
        rowCursor++;
        rowState = null;
      }
    }

    function writeCapCenter(vertex, row) {
      const p = vertex * 3;
      const roadCoordinateOffset = vertex * 2;
      for (let side = 0; side < ringSize; side++) {
        const source = (row * ringSize + side) * 3;
        const sourceRoadCoordinate = (row * ringSize + side) * 2;
        positions[p] += positions[source] / ringSize;
        positions[p + 1] += positions[source + 1] / ringSize;
        positions[p + 2] += positions[source + 2] / ringSize;
        roadCoordinates[roadCoordinateOffset] += roadCoordinates[sourceRoadCoordinate] / ringSize;
        roadCoordinates[roadCoordinateOffset + 1] += roadCoordinates[sourceRoadCoordinate + 1] / ringSize;
        staticTunnelIrradiance[vertex] += staticTunnelIrradiance[row * ringSize + side] / ringSize;
        tunnelEnclosure[vertex] += tunnelEnclosure[row * ringSize + side] / ringSize;
      }
      colors[p] = familyColor.r * 0.40;
      colors[p + 1] = familyColor.g * 0.40;
      colors[p + 2] = familyColor.b * 0.40;
    }

    /**
     * Close a connected endpoint behind its public ring. The endpoint itself remains uncapped for the junction
     * contract, while the inset collar and fan sit inside the opaque road volume and make this edge watertight.
     */
    function writeRecessedTopologySeal(sourceRow, adjacentRow, sealRing, sealCenter) {
      const sourceCenter = { x: 0, y: 0, z: 0 };
      const adjacentCenter = { x: 0, y: 0, z: 0 };
      for (let side = 0; side < ringSize; side++) {
        const source = (sourceRow * ringSize + side) * 3;
        const adjacent = (adjacentRow * ringSize + side) * 3;
        sourceCenter.x += positions[source] / ringSize;
        sourceCenter.y += positions[source + 1] / ringSize;
        sourceCenter.z += positions[source + 2] / ringSize;
        adjacentCenter.x += positions[adjacent] / ringSize;
        adjacentCenter.y += positions[adjacent + 1] / ringSize;
        adjacentCenter.z += positions[adjacent + 2] / ringSize;
      }
      const directionX = adjacentCenter.x - sourceCenter.x;
      const directionY = adjacentCenter.y - sourceCenter.y;
      const directionZ = adjacentCenter.z - sourceCenter.z;
      const inverseDirectionLength = 1 / Math.max(
        0.000_001,
        Math.hypot(directionX, directionY, directionZ)
      );
      const insetX = directionX * inverseDirectionLength * recessedTopologySealDepthM;
      const insetY = directionY * inverseDirectionLength * recessedTopologySealDepthM;
      const insetZ = directionZ * inverseDirectionLength * recessedTopologySealDepthM;
      const centerOffset = sealCenter * 3;
      for (let side = 0; side < ringSize; side++) {
        const sourceVertex = sourceRow * ringSize + side;
        const source = sourceVertex * 3;
        const target = (sealRing + side) * 3;
        positions[target] = sourceCenter.x
          + (positions[source] - sourceCenter.x) * recessedTopologySealScale
          + insetX;
        positions[target + 1] = sourceCenter.y
          + (positions[source + 1] - sourceCenter.y) * recessedTopologySealScale
          + insetY;
        positions[target + 2] = sourceCenter.z
          + (positions[source + 2] - sourceCenter.z) * recessedTopologySealScale
          + insetZ;
        colors[target] = colors[source] * 0.72;
        colors[target + 1] = colors[source + 1] * 0.72;
        colors[target + 2] = colors[source + 2] * 0.72;
        const sourceRoadCoordinate = sourceVertex * 2;
        const targetRoadCoordinate = (sealRing + side) * 2;
        roadCoordinates[targetRoadCoordinate] = roadCoordinates[sourceRoadCoordinate];
        roadCoordinates[targetRoadCoordinate + 1] = roadCoordinates[sourceRoadCoordinate + 1];
        staticTunnelIrradiance[sealRing + side] = staticTunnelIrradiance[sourceVertex];
        tunnelEnclosure[sealRing + side] = tunnelEnclosure[sourceVertex];
        positions[centerOffset] += positions[target] / ringSize;
        positions[centerOffset + 1] += positions[target + 1] / ringSize;
        positions[centerOffset + 2] += positions[target + 2] / ringSize;
      }
      colors[centerOffset] = familyColor.r * 0.46;
      colors[centerOffset + 1] = familyColor.g * 0.46;
      colors[centerOffset + 2] = familyColor.b * 0.46;
      const centerRoadCoordinate = sealCenter * 2;
      const sourceRoadCoordinate = sourceRow * ringSize * 2;
      roadCoordinates[centerRoadCoordinate] = 0;
      roadCoordinates[centerRoadCoordinate + 1] = roadCoordinates[sourceRoadCoordinate + 1];
      for (let side = 0; side < ringSize; side++) {
        staticTunnelIrradiance[sealCenter] += staticTunnelIrradiance[sealRing + side] / ringSize;
        tunnelEnclosure[sealCenter] += tunnelEnclosure[sealRing + side] / ringSize;
      }
    }

    function finalizeTopology() {
      let indexCursor = 0;
      for (let row = 0; row < rows; row++) {
        const current = row * ringSize;
        const next = (row + 1) * ringSize;
        for (let side = 0; side < ringSize; side++) {
          const adjacent = (side + 1) % ringSize;
          indices[indexCursor++] = current + side;
          indices[indexCursor++] = current + adjacent;
          indices[indexCursor++] = next + adjacent;
          indices[indexCursor++] = current + side;
          indices[indexCursor++] = next + adjacent;
          indices[indexCursor++] = next + side;
        }
      }
      if (endpointCaps.start) writeCapCenter(startCap, 0);
      if (endpointCaps.end) writeCapCenter(endCap, rows);
      if (!endpointCaps.start) writeRecessedTopologySeal(0, 1, startSealRing, startSealCenter);
      if (!endpointCaps.end) writeRecessedTopologySeal(rows, rows - 1, endSealRing, endSealCenter);
      for (let side = 0; side < ringSize; side++) {
        const adjacent = (side + 1) % ringSize;
        if (endpointCaps.start) {
          indices[indexCursor++] = startCap;
          indices[indexCursor++] = adjacent;
          indices[indexCursor++] = side;
        }
        if (endpointCaps.end) {
          indices[indexCursor++] = endCap;
          indices[indexCursor++] = rows * ringSize + side;
          indices[indexCursor++] = rows * ringSize + adjacent;
        }
        if (!endpointCaps.start) {
          indices[indexCursor++] = side;
          indices[indexCursor++] = startSealRing + adjacent;
          indices[indexCursor++] = adjacent;
          indices[indexCursor++] = side;
          indices[indexCursor++] = startSealRing + side;
          indices[indexCursor++] = startSealRing + adjacent;
          indices[indexCursor++] = startSealCenter;
          indices[indexCursor++] = startSealRing + adjacent;
          indices[indexCursor++] = startSealRing + side;
        }
        if (!endpointCaps.end) {
          const sourceSide = rows * ringSize + side;
          const sourceAdjacent = rows * ringSize + adjacent;
          indices[indexCursor++] = endSealRing + side;
          indices[indexCursor++] = sourceSide;
          indices[indexCursor++] = sourceAdjacent;
          indices[indexCursor++] = endSealRing + side;
          indices[indexCursor++] = sourceAdjacent;
          indices[indexCursor++] = endSealRing + adjacent;
          indices[indexCursor++] = endSealCenter;
          indices[indexCursor++] = endSealRing + side;
          indices[indexCursor++] = endSealRing + adjacent;
        }
      }
      // The ring/cap index construction has analytically two incident faces per edge; length proves no face was omitted.
      topologyIndexContractValid = indexCursor === indices.length;
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('roadCoord', new THREE.BufferAttribute(roadCoordinates, 2));
      geometry.setAttribute(
        STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute,
        new THREE.BufferAttribute(staticTunnelIrradiance, 1)
      );
      geometry.setAttribute(TUNNEL_ENCLOSURE_CONTRACT.attribute, new THREE.BufferAttribute(tunnelEnclosure, 1));
      geometry.userData.tunnelEnclosureContractVersion = TUNNEL_ENCLOSURE_CONTRACT.version;
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      normals = new Float32Array(positions.length);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    }

    function accumulateNormalBatch(budgetMs) {
      const deadline = nowMilliseconds() + Math.max(0.25, Math.min(2.6, Number(budgetMs) * 0.60 || 2.40));
      while (triangleCursor < indices.length && nowMilliseconds() < deadline) {
        const a = indices[triangleCursor++] * 3;
        const b = indices[triangleCursor++] * 3;
        const c = indices[triangleCursor++] * 3;
        const cbX = positions[c] - positions[b];
        const cbY = positions[c + 1] - positions[b + 1];
        const cbZ = positions[c + 2] - positions[b + 2];
        const abX = positions[a] - positions[b];
        const abY = positions[a + 1] - positions[b + 1];
        const abZ = positions[a + 2] - positions[b + 2];
        const normalX = cbY * abZ - cbZ * abY;
        const normalY = cbZ * abX - cbX * abZ;
        const normalZ = cbX * abY - cbY * abX;
        const normalLengthSquared = normalX * normalX + normalY * normalY + normalZ * normalZ;
        if (!Number.isFinite(positions[a]) || !Number.isFinite(positions[a + 1])
          || !Number.isFinite(positions[a + 2]) || !Number.isFinite(positions[b])
          || !Number.isFinite(positions[b + 1]) || !Number.isFinite(positions[b + 2])
          || !Number.isFinite(positions[c]) || !Number.isFinite(positions[c + 1])
          || !Number.isFinite(positions[c + 2])) {
          topologyInvalidCoordinateCount++;
        }
        if (!Number.isFinite(normalLengthSquared) || normalLengthSquared <= 0.000_000_000_1) {
          topologyDegenerateTriangleCount++;
        }
        normals[a] += normalX;
        normals[a + 1] += normalY;
        normals[a + 2] += normalZ;
        normals[b] += normalX;
        normals[b + 1] += normalY;
        normals[b + 2] += normalZ;
        normals[c] += normalX;
        normals[c + 1] += normalY;
        normals[c + 2] += normalZ;
      }
      return triangleCursor >= indices.length;
    }

    function normalizeNormalBatch(budgetMs) {
      const deadline = nowMilliseconds() + Math.max(0.25, Math.min(2.6, Number(budgetMs) * 0.60 || 2.40));
      while (normalVertexCursor < normals.length && nowMilliseconds() < deadline) {
        const x = normals[normalVertexCursor];
        const y = normals[normalVertexCursor + 1];
        const z = normals[normalVertexCursor + 2];
        const inverseLength = 1 / (Math.hypot(x, y, z) || 1);
        normals[normalVertexCursor] = x * inverseLength;
        normals[normalVertexCursor + 1] = y * inverseLength;
        normals[normalVertexCursor + 2] = z * inverseLength;
        normalVertexCursor += 3;
      }
      return normalVertexCursor >= normals.length;
    }

    function publishMetadata() {
      geometry.userData.dynamicWidthSampleCount = dynamicWidthSampleCount;
      geometry.userData.deckThickness = Number(track.graph?.contract?.deckThickness) || 0.92;
      geometry.userData.maximumRoadHalfError = maximumRoadHalfError;
      geometry.userData.maximumDeckThicknessError = maximumDeckThicknessError;
      geometry.userData.junctionBiasSampleCount = junctionBiasSampleCount;
      geometry.userData.trimmedBarrierSampleCount = trimmedBarrierSampleCount;
      geometry.userData.retainedJunctionBoundaryCount = retainedJunctionBoundaryCount;
      geometry.userData.junctionRaisedBarrierIntrusionCount = junctionRaisedBarrierIntrusionCount;
      geometry.userData.straightForkVoidBoundarySampleCount = straightForkVoidBoundarySampleCount;
      geometry.userData.maximumStraightForkVoidBoundaryHeightM = maximumStraightForkVoidBoundaryHeightM;
      geometry.userData.suppressedConnectedCapCount = suppressedConnectedCapCount;
      geometry.userData.recessedTopologySealCount = recessedTopologySealCount;
      geometry.userData.recessedTopologySealDepthM = recessedTopologySealDepthM;
      geometry.userData.topologyFailureCount = topologyIndexContractValid
        && topologyDegenerateTriangleCount === 0
        && topologyInvalidCoordinateCount === 0 ? 0 : 1;
    }

    function step(budgetMs = 4) {
      if (phase === 'done') return true;
      if (phase === 'rows') {
        if (isolatedUnitSteps > 0) {
          isolatedUnitSteps--;
          processRowUnit();
          return false;
        }
        const startedAt = nowMilliseconds();
        const deadline = startedAt + Math.max(0.25, Math.min(2.6, Number(budgetMs) * 0.60 || 2.40));
        do {
          processRowUnit();
        } while ((rowCursor <= rows || rowState) && nowMilliseconds() < deadline);
        if (rowCursor > rows && !rowState) phase = 'topology';
        return false;
      }
      if (phase === 'topology') {
        finalizeTopology();
        phase = 'normals';
        return false;
      }
      if (phase === 'normals') {
        if (accumulateNormalBatch(budgetMs)) phase = 'normalize-normals';
        return false;
      }
      if (phase === 'normalize-normals') {
        if (normalizeNormalBatch(budgetMs)) phase = 'publish';
        return false;
      }
      publishMetadata();
      phase = 'done';
      return true;
    }

    function finish() {
      if (!geometry || phase !== 'done') throw new Error(`Road shell edge batch is not complete: ${edge.id}`);
      return geometry;
    }

    return Object.freeze({ step, finish, edge, rows });
  }

  /** Append road markings in bounded row chunks so long approaches cannot monopolize an idle callback. */
  function createEdgeLineAppendJob(
    track,
    edge,
    sampleStep,
    tileOrigin,
    generalTarget,
    rampTarget,
    selectedTarget,
    proposedTarget
  ) {
    const edgeTarget = edge.family === 'loop-ramp' || edge.family === 'direct-ramp'
      ? rampTarget
      : generalTarget;
    const straightForkVoid = edge.family === 'straight-fork-branch'
      ? edge.straightForkProfileLut?.centralVoid
      : null;
    const edgeBoundarySpecs = straightForkVoid
      ? [
          {
            target: edgeTarget,
            lateralRatio: edge.forkSide === 'left' ? -1 : 1,
            height: 0.14,
            spacing: sampleStep * 1.4
          },
          {
            target: rampTarget,
            lateralRatio: edge.forkSide === 'left' ? 1 : -1,
            height: 0.14,
            spacing: sampleStep,
            startS: straightForkVoid.startS,
            endS: straightForkVoid.endS,
            straightForkVoidBoundary: true
          }
        ]
      : [
          { target: edgeTarget, lateralRatio: -1, height: 0.14, spacing: sampleStep * 1.4 },
          { target: edgeTarget, lateralRatio: 1, height: 0.14, spacing: sampleStep * 1.4 }
        ];
    const speedReferenceSpecs = [-1, 1].map((side) => ({
      target: generalTarget,
      lateralRatio: side,
      lateralInsetM: ROAD_SPEED_REFERENCE_CONTRACT.edgeInsetM,
      height: 0.112,
      dashCadenceM: ROAD_SPEED_REFERENCE_CONTRACT.cadenceM,
      dashLengthM: ROAD_SPEED_REFERENCE_CONTRACT.markLengthM
    }));
    const specs = [
      ...edgeBoundarySpecs,
      ...speedReferenceSpecs,
      // The deck crown is 0.10m above the sampled frame. The 0.112m center mark plus the High ribbon's 0.006m
      // lift leaves an 18mm contact gap; polygon offset resolves depth precision without a visibly floating stripe.
      ...(edge.family === 'mainline'
        ? [
            { target: generalTarget, lateralRatio: -1 / 3, height: 0.112, spacing: sampleStep * 1.5 },
            { target: generalTarget, lateralRatio: 1 / 3, height: 0.112, spacing: sampleStep * 1.5 }
          ]
        : [{ target: generalTarget, lateralRatio: 0, height: 0.112, spacing: sampleStep * 1.5 }]),
      { target: selectedTarget, lateralRatio: 0, height: 0.25, spacing: sampleStep },
      { target: proposedTarget, lateralRatio: 0, height: 0.23, spacing: sampleStep }
    ].map((spec) => ({
      ...spec,
      startS: Number.isFinite(spec.startS) ? clamp(spec.startS, 0, edge.length) : 0,
      endS: Number.isFinite(spec.endS) ? clamp(spec.endS, 0, edge.length) : edge.length,
      rows: Number.isFinite(spec.dashCadenceM)
        ? Math.max(1, Math.ceil(
            ((Number.isFinite(spec.endS) ? spec.endS : edge.length)
              - (Number.isFinite(spec.startS) ? spec.startS : 0)) / spec.dashCadenceM
          ))
        : Math.max(6, Math.ceil(
            ((Number.isFinite(spec.endS) ? spec.endS : edge.length)
              - (Number.isFinite(spec.startS) ? spec.startS : 0)) / spec.spacing
          )),
      row: 0,
      hasPrevious: false,
      previousX: 0,
      previousY: 0,
      previousZ: 0
    }));
    let specIndex = 0;
    const linePointA = new Float64Array(3);
    const linePointB = new Float64Array(3);
    const lineCenterFrame = {};
    const lineSurfaceFrame = {};

    /** Sample one marking point from the physical road width and station without consulting runtime speed or time. */
    function sampleLinePoint(spec, edgeS, target) {
      const centerFrame = sample(track, edge.id, edgeS, 0, lineCenterFrame);
      const roadHalf = sampledRoadHalf(centerFrame, edge);
      const lateral = Number.isFinite(spec.lateralInsetM)
        ? Math.sign(spec.lateralRatio || 1) * Math.max(0, roadHalf - spec.lateralInsetM)
        : roadHalf * spec.lateralRatio;
      const frame = sample(track, edge.id, edgeS, lateral, lineSurfaceFrame);
      const surfaceBias = junctionSurfaceBias(edge, edgeS);
      // The unlit gold line rides above the rising rail crown, remaining visible in night biomes and at speed.
      const lineHeight = spec.straightForkVoidBoundary
        ? 0.14 + (STRAIGHT_FORK_VOID_BOUNDARY_HEIGHT_M - 0.10) * smootherStep01(
          centerFrame.straightForkVoidWidthM / STRAIGHT_FORK_VOID_BOUNDARY_FULL_WIDTH_M
        )
        : spec.height;
      target[0] = frame.x - tileOrigin.x + frame.upX * (lineHeight + surfaceBias);
      target[1] = frame.y + frame.upY * (lineHeight + surfaceBias);
      target[2] = frame.z - tileOrigin.z + frame.upZ * (lineHeight + surfaceBias);
    }

    function step(budgetMs = 4) {
      if (specIndex >= specs.length) return true;
      const deadline = nowMilliseconds() + Math.max(0.25, Math.min(2.6, Number(budgetMs) * 0.60 || 2.40));
      do {
        const spec = specs[specIndex];
        if (Number.isFinite(spec.dashCadenceM)) {
          const markStartS = spec.startS + spec.row * spec.dashCadenceM;
          if (markStartS < spec.endS - 0.000_001) {
            const markEndS = Math.min(spec.endS, markStartS + spec.dashLengthM);
            sampleLinePoint(spec, markStartS, linePointA);
            sampleLinePoint(spec, markEndS, linePointB);
            spec.target.push(
              linePointA[0], linePointA[1], linePointA[2],
              linePointB[0], linePointB[1], linePointB[2]
            );
          }
          spec.row++;
          if (spec.row >= spec.rows) specIndex++;
          continue;
        }
        const edgeS = spec.startS + (spec.endS - spec.startS) * spec.row / spec.rows;
        sampleLinePoint(spec, edgeS, linePointA);
        const x = linePointA[0];
        const y = linePointA[1];
        const z = linePointA[2];
        if (spec.hasPrevious) {
          spec.target.push(spec.previousX, spec.previousY, spec.previousZ, x, y, z);
        }
        spec.previousX = x;
        spec.previousY = y;
        spec.previousZ = z;
        spec.hasPrevious = true;
        spec.row++;
        if (spec.row > spec.rows) specIndex++;
      } while (specIndex < specs.length && nowMilliseconds() < deadline);
      return specIndex >= specs.length;
    }

    return Object.freeze({
      step,
      straightForkVoidBoundaryCount: straightForkVoid ? 1 : 0
    });
  }

  function smootherStep01(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** One shared layout prevents the split and merge noses from drifting back to a logical graph node. */
  function straightForkGoreLayout(branches) {
    const leftEdge = branches.find((edge) => edge.forkSide === 'left');
    const rightEdge = branches.find((edge) => edge.forkSide === 'right');
    const centralVoid = leftEdge?.straightForkProfileLut?.centralVoid;
    if (!leftEdge || !rightEdge || !centralVoid) return Object.freeze([]);
    return Object.freeze([
      Object.freeze({
        kind: 'split',
        edgeS: centralVoid.noseStartS,
        reverseLongitudinal: true,
        tipForwardSign: -1,
        leftEdge,
        rightEdge
      }),
      Object.freeze({
        kind: 'merge',
        edgeS: centralVoid.noseEndS,
        reverseLongitudinal: false,
        tipForwardSign: 1,
        leftEdge,
        rightEdge
      })
    ]);
  }

  /** Build 12 two-path lane bundles from the same gate target used by the autopilot, without adding fake graph edges. */
  function createDecorativeLaneGeometry(THREE, track, edges, tileOrigin, mobile) {
    const positions = [];
    const markHalf = 0.12;
    const sampleSpacing = mobile ? 14 : 8;
    let bundleCount = 0;
    let pathCount = 0;
    let safeHalfViolationCount = 0;
    let gateTargetMaxError = 0;
    for (const edge of edges) {
      const templateId = edge.templateEdgeId || edge.id;
      let startS = 0;
      let endS = 0;
      let merge = false;
      if (edge.family === 'approach') {
        startS = Math.max(0, edge.length - 220);
        endS = edge.length;
      } else if (edge.family === 'collector') {
        startS = Math.max(0, edge.length - 180);
        endS = edge.length;
      } else if (edge.family === 'outbound'
        && String(templateId).startsWith('outbound-')
        && !String(templateId).startsWith('outbound-mid-')) {
        startS = 0;
        endS = Math.min(120, edge.length);
        merge = true;
      } else {
        continue;
      }
      const segments = Math.max(2, Math.ceil((endS - startS) / sampleSpacing));
      bundleCount++;
      for (let pathIndex = 0; pathIndex < 2; pathIndex++) {
        let previous = null;
        pathCount++;
        for (let index = 0; index <= segments; index++) {
          const t = index / segments;
          const edgeS = startS + (endS - startS) * t;
          const center = sample(track, edge.id, edgeS, 0, {});
          const safeHalf = Math.max(0, sampledRoadHalf(center, edge) - 0.58);
          const gateTarget = typeof track.gateTargetForHalfWidth === 'function'
            ? track.gateTargetForHalfWidth({ min: 1.6, max: Number.POSITIVE_INFINITY }, safeHalf)
            : Math.min(2.4, safeHalf);
          gateTargetMaxError = Math.max(gateTargetMaxError, Math.abs(gateTarget - Math.min(2.4, safeHalf)));
          const split = merge ? 1 - smootherStep01(t) : smootherStep01(t);
          const lateral = pathIndex === 0 ? 0 : gateTarget * split;
          if (Math.abs(lateral) + markHalf > safeHalf + 0.000_1) safeHalfViolationCount++;
          const frame = sample(track, edge.id, edgeS, lateral, {});
          const point = [
            frame.x - tileOrigin.x + frame.upX * 0.19,
            frame.y + frame.upY * 0.19,
            frame.z - tileOrigin.z + frame.upZ * 0.19
          ];
          if (previous) positions.push(...previous, ...point);
          previous = point;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    geometry.userData.bundleCount = bundleCount;
    geometry.userData.pathCount = pathCount;
    geometry.userData.safeHalfViolationCount = safeHalfViolationCount;
    geometry.userData.gateTargetMaxError = gateTargetMaxError;
    return geometry;
  }

  /**
   * Geometry preparation is deliberately side-effect free: tile code can run one edge per idle callback and
   * publish the completed visual atomically only after the final assembly stage.
   */
  function createGeometryBatchJob(options, explicitEdges = null) {
    const { THREE, track, qualityProfile } = options;
    const sampleStep = qualityProfile?.id === 'mobile' ? 5 : 2.5;
    const edges = (explicitEdges || edgeList(track))
      .filter((edge) => Number.isFinite(edge.length) && edge.length > 0);
    const tileOrigin = Object.freeze({
      x: Number(options.tileOrigin?.x ?? track.graph?.origin?.x) || 0,
      z: Number(options.tileOrigin?.z ?? track.graph?.origin?.z) || 0
    });
    const inspectBarrier = createJunctionBarrierPolicy(track, edges);
    const endpointCapsForEdge = createEndpointCapPolicy(track);
    const junctionCandidateCount = nodeList(track)
      .filter((node) => JUNCTION_APRON_NODE_KINDS.has(node.kind))
      .filter((node) => junctionIncidentRecords(node, edges).length > 0)
      .length;
    const shellGeometries = [];
    const staticGeneralLinePositions = [];
    const staticRampRailPositions = [];
    const routeLinePositionsByEdge = new Map();
    const metrics = {
      dynamicRoadWidthSamples: 0,
      roadShellWidthError: 0,
      bridgeDeckThicknessError: 0,
      junctionBiasSamples: 0,
      trimmedBarrierSampleCount: 0,
      retainedJunctionBoundaryCount: 0,
      junctionRaisedBarrierIntrusionCount: 0,
      straightForkVoidBoundaryCount: 0,
      straightForkVoidBoundarySampleCount: 0,
      maximumStraightForkVoidBoundaryHeightM: 0,
      straightForkVoidBoundaryFullWidthM: STRAIGHT_FORK_VOID_BOUNDARY_FULL_WIDTH_M,
      suppressedConnectedCapCount: 0,
      recessedTopologySealCount: 0,
      junctionApronCandidateCount: junctionCandidateCount,
      junctionApronCount: 0,
      junctionApronCoverageMissCount: 0,
      junctionApronTopologyFailureCount: 0,
      junctionApronMaximumSpanM: 0,
      junctionApronSurfaceLiftM: 0,
      junctionLongPairCount: 0,
      junctionLensCount: 0,
      junctionLensResidualOverlapCount: 0,
      junctionLensMaximumRunM: 0,
      junctionLensMaximumCrossWidthM: 0,
      junctionLensClearanceToleranceM: JUNCTION_LENS_CLEARANCE_TOLERANCE_M,
      junctionLensCoverageStationCount: 0,
      junctionLensUncoveredStationCount: 0,
      junctionLensApronContinuityFailureCount: 0,
      junctionLensClearanceFailureCount: 0,
      junctionLensMaximumEndClearanceErrorM: 0,
      junctionVerticallySeparatedPairCount: 0,
      junctionVerticalSeparationStationCount: 0,
      junctionVerticalSeparationFailureCount: 0,
      junctionMinimumVerticalShellGapM: null,
      junctionLensTopologyFailureCount: 0,
      topologyFailureCount: 0,
      maximumSliceMs: 0,
      slowestSliceLabel: null,
      lastSliceLabel: null,
      sliceOverrunCount: 0,
      edgeBatchCount: 0,
      jumpPlatformCount: 0,
      jumpPlatformEdgeCount: 0,
      jumpPlatformVariantCount: 0,
      jumpPlatformDimensionSignatureCount: 0,
      jumpPlatformVertexCount: 0,
      jumpPlatformTriangleCount: 0,
      jumpPlatformMinimumWidthM: 0,
      jumpPlatformMaximumWidthM: 0,
      jumpPlatformMinimumHeightM: 0,
      jumpPlatformMaximumHeightM: 0,
      jumpPlatformMinimumLengthM: 0,
      jumpPlatformMaximumLengthM: 0,
      jumpPlatformMaximumAbsLateralM: 0,
      jumpPlatformAdditionalDrawGroupCount: 0,
      jumpPlatformAdditionalObjectCount: 0
    };
    let edgeCursor = 0;
    let edgeShellJob = null;
    let edgeLineJob = null;
    let junctionInspectionJob = null;
    let apronInspection = null;
    let junctionApronCursor = 0;
    let junctionLensCursor = 0;
    let roadMergeJob = null;
    let edgePhase = 'shell';
    let stage = 'warm-center';
    let result = null;
    let roadShellGeometry = null;
    let staticGeneralLineGeometry = null;
    let staticRampRailGeometry = null;
    let staticLineGeometry = null;
    let decorativeLaneGeometry = null;
    let jumpPlatformGeometry = null;
    let cancelled = false;

    function registerEdgeShell(shellGeometry) {
      shellGeometries.push(shellGeometry);
      metrics.dynamicRoadWidthSamples += shellGeometry.userData.dynamicWidthSampleCount || 0;
      metrics.roadShellWidthError = Math.max(
        metrics.roadShellWidthError,
        shellGeometry.userData.maximumRoadHalfError || 0
      );
      metrics.bridgeDeckThicknessError = Math.max(
        metrics.bridgeDeckThicknessError,
        shellGeometry.userData.maximumDeckThicknessError || 0
      );
      metrics.junctionBiasSamples += shellGeometry.userData.junctionBiasSampleCount || 0;
      metrics.trimmedBarrierSampleCount += shellGeometry.userData.trimmedBarrierSampleCount || 0;
      metrics.retainedJunctionBoundaryCount += shellGeometry.userData.retainedJunctionBoundaryCount || 0;
      metrics.junctionRaisedBarrierIntrusionCount += shellGeometry.userData.junctionRaisedBarrierIntrusionCount || 0;
      metrics.straightForkVoidBoundarySampleCount +=
        shellGeometry.userData.straightForkVoidBoundarySampleCount || 0;
      metrics.maximumStraightForkVoidBoundaryHeightM = Math.max(
        metrics.maximumStraightForkVoidBoundaryHeightM,
        shellGeometry.userData.maximumStraightForkVoidBoundaryHeightM || 0
      );
      metrics.suppressedConnectedCapCount += shellGeometry.userData.suppressedConnectedCapCount || 0;
      metrics.recessedTopologySealCount += shellGeometry.userData.recessedTopologySealCount || 0;
      metrics.topologyFailureCount += shellGeometry.userData.topologyFailureCount || 0;
    }

    /** Retain the authored variety and fixed-budget proof after its temporary geometry joins the shell merge. */
    function registerJumpPlatformGeometry(geometry) {
      const report = geometry.userData || {};
      for (const key of [
        'jumpPlatformCount',
        'jumpPlatformEdgeCount',
        'jumpPlatformVariantCount',
        'jumpPlatformDimensionSignatureCount',
        'jumpPlatformVertexCount',
        'jumpPlatformTriangleCount',
        'jumpPlatformMinimumWidthM',
        'jumpPlatformMaximumWidthM',
        'jumpPlatformMinimumHeightM',
        'jumpPlatformMaximumHeightM',
        'jumpPlatformMinimumLengthM',
        'jumpPlatformMaximumLengthM',
        'jumpPlatformMaximumAbsLateralM',
        'jumpPlatformAdditionalDrawGroupCount',
        'jumpPlatformAdditionalObjectCount'
      ]) {
        metrics[key] = Number(report[key]) || 0;
      }
    }

    function step(budgetMs = 4) {
      if (cancelled || result) return Boolean(result);
      const startedAt = nowMilliseconds();
      const sliceLabel = stage === 'edges'
        ? `${stage}:${edgeCursor}:${edgeShellJob ? edgePhase : 'shell-create'}`
        : stage === 'junction-inspection'
          ? `${stage}:${junctionInspectionJob?.processedCount || 0}:${junctionInspectionJob?.phase || 'start'}`
          : stage === 'junction-apron-geometries'
            ? `${stage}:${junctionApronCursor}`
            : stage === 'junction-lens-geometries'
              ? `${stage}:${junctionLensCursor}`
              : stage;
      if (stage === 'warm-center') {
        const edge = edges[0];
        if (edge) {
          const frame = sample(track, edge.id, edge.length * 0.5, 0, {});
          sampledRoadHalf(frame, edge);
          sampledDeckDepth(track, frame);
          junctionSurfaceBias(edge, edge.length * 0.5);
        }
        stage = 'warm-barrier-loop';
      } else if (stage === 'warm-barrier-loop') {
        const edge = edges[0];
        if (edge) {
          const frame = sample(track, edge.id, edge.length * 0.5, 0, {});
          inspectBarrier(edge, edge.length * 0.5, -1, sampledRoadHalf(frame, edge));
        }
        stage = 'edges';
      } else if (stage === 'edges') {
        const edge = edges[edgeCursor];
        // Visual-only corridors are mathematically straight. Longer exact segments reduce warm-build work
        // without changing their silhouette, road width, markings, or the player's sampled road quality.
        const edgeSampleStep = edge.visualOnly === true
          ? 1_024
          : sampleStep;
        if (!edgeShellJob) {
          edgeShellJob = createEdgeShellBuildJob(
            THREE,
            track,
            edge,
            edgeSampleStep,
            tileOrigin,
            inspectBarrier,
            endpointCapsForEdge(edge),
            edgeCursor === 0,
            {
              // Sub-millimetre unique offsets stop sealed sibling caps being welded into one non-manifold batch.
              x: Math.cos(Math.PI * 2 * edgeCursor / Math.max(1, edges.length)) * 0.000_2,
              z: Math.sin(Math.PI * 2 * edgeCursor / Math.max(1, edges.length)) * 0.000_2
            }
          );
        } else if (edgePhase === 'shell') {
          if (edgeShellJob.step(budgetMs)) {
            registerEdgeShell(edgeShellJob.finish());
            const routeLines = { selected: [], proposed: [] };
            // Static batches use template ids so the same relative coordinates can serve every translated tile.
            routeLinePositionsByEdge.set(isRuntimeOnlyEdge(edge) ? edge.id : edgeTemplateId(edge), routeLines);
            edgeLineJob = createEdgeLineAppendJob(
              track,
              edge,
              edgeSampleStep,
              tileOrigin,
              staticGeneralLinePositions,
              staticRampRailPositions,
              routeLines.selected,
              routeLines.proposed
            );
            edgePhase = 'lines';
          }
        } else {
          if (edgeLineJob.step(budgetMs)) {
            metrics.straightForkVoidBoundaryCount += edgeLineJob.straightForkVoidBoundaryCount || 0;
            metrics.edgeBatchCount++;
            edgeCursor++;
            edgeShellJob = null;
            edgeLineJob = null;
            edgePhase = 'shell';
            // Route edge shells are the only visible and physical top authority. Convex aprons and averaged-height
            // lenses made smooth C2 routes look angular and could sit above the sampled floor, so production skips
            // those cosmetic patches and merges the authoritative shells directly.
            if (edgeCursor >= edges.length) stage = 'jump-platforms';
          }
        }
      } else if (stage === 'junction-inspection') {
        if (!junctionInspectionJob) {
          junctionInspectionJob = createJunctionApronInspectionJob(track, edges);
        }
        if (junctionInspectionJob.step(budgetMs)) {
          apronInspection = junctionInspectionJob.finish();
          metrics.junctionApronCandidateCount = apronInspection.candidateCount;
          metrics.junctionApronCoverageMissCount = apronInspection.coverageMissCount;
          metrics.junctionApronMaximumSpanM = apronInspection.maximumSpan;
          metrics.junctionApronSurfaceLiftM = apronInspection.topLift;
          metrics.junctionLongPairCount = apronInspection.longPairCount;
          metrics.junctionLensCount = apronInspection.lensCount;
          metrics.junctionLensResidualOverlapCount = apronInspection.residualOverlapCount;
          metrics.junctionLensMaximumRunM = apronInspection.maximumRun;
          metrics.junctionLensMaximumCrossWidthM = apronInspection.maximumCrossWidth;
          metrics.junctionLensClearanceToleranceM = apronInspection.clearanceTolerance;
          metrics.junctionLensCoverageStationCount = apronInspection.coverageStationCount;
          metrics.junctionLensUncoveredStationCount = apronInspection.uncoveredStationCount;
          metrics.junctionLensApronContinuityFailureCount =
            apronInspection.apronLensContinuityFailureCount;
          metrics.junctionLensClearanceFailureCount = apronInspection.clearanceFailureCount;
          metrics.junctionLensMaximumEndClearanceErrorM = apronInspection.maximumEndClearanceError;
          metrics.junctionVerticallySeparatedPairCount = apronInspection.verticallySeparatedPairCount;
          metrics.junctionVerticalSeparationStationCount = apronInspection.verticalSeparationStationCount;
          metrics.junctionVerticalSeparationFailureCount = apronInspection.verticalSeparationFailureCount;
          metrics.junctionMinimumVerticalShellGapM = apronInspection.minimumVerticalShellGap;
          metrics.junctionLensTopologyFailureCount = apronInspection.topologyFailureCount;
          stage = 'junction-apron-geometries';
        }
      } else if (stage === 'junction-apron-geometries') {
        const layout = apronInspection.layouts[junctionApronCursor++];
        if (layout) {
          const apronGeometry = createJunctionApronGeometry(THREE, layout, tileOrigin);
          metrics.junctionApronCount++;
          metrics.junctionApronTopologyFailureCount +=
            apronGeometry.userData.junctionApronTopologyFailureCount || 0;
          shellGeometries.push(apronGeometry);
        }
        if (junctionApronCursor >= apronInspection.layouts.length) stage = 'junction-lens-geometries';
      } else if (stage === 'junction-lens-geometries') {
        const layout = apronInspection.lenses[junctionLensCursor++];
        if (layout) {
          const lensGeometry = createJunctionOverlapLensGeometry(THREE, layout, tileOrigin);
          metrics.junctionLensTopologyFailureCount +=
            lensGeometry.userData.junctionLensTopologyFailureCount || 0;
          shellGeometries.push(lensGeometry);
        }
        if (junctionLensCursor >= apronInspection.lenses.length) stage = 'junction-finalize';
      } else if (stage === 'junction-finalize') {
        metrics.topologyFailureCount += metrics.junctionApronTopologyFailureCount
          + metrics.junctionLensTopologyFailureCount;
        stage = 'jump-platforms';
      } else if (stage === 'jump-platforms') {
        jumpPlatformGeometry = createJumpPlatformBatchGeometry({ THREE, track, edges, tileOrigin });
        registerJumpPlatformGeometry(jumpPlatformGeometry);
        if (metrics.jumpPlatformCount > 0) {
          // Independent wedges share the recovery road material/buffer only after their own closed geometry exists.
          shellGeometries.push(jumpPlatformGeometry);
        } else {
          jumpPlatformGeometry.dispose();
        }
        jumpPlatformGeometry = null;
        stage = 'merge-road';
      } else if (stage === 'merge-road') {
        if (!roadMergeJob) {
          const bounds = track.graph?.bounds || {};
          const centerX = (Number(bounds.minX) + Number(bounds.maxX)) * 0.5 - tileOrigin.x;
          const centerZ = (Number(bounds.minZ) + Number(bounds.maxZ)) * 0.5 - tileOrigin.z;
          const radius = Math.hypot(
            (Number(bounds.maxX) - Number(bounds.minX)) * 0.5,
            (Number(bounds.maxZ) - Number(bounds.minZ)) * 0.5,
            (Number(track.graph?.contract?.upperHeight) || 9) + 3
          );
          roadMergeJob = createIndexedGeometryMergeJob(
            THREE,
            shellGeometries,
            new THREE.Sphere(new THREE.Vector3(centerX, 4, centerZ), radius),
            {
              requireRoadCoordinates: true,
              includeStaticTunnelIrradiance: true,
              includeTunnelEnclosure: true
            }
          );
        } else if (roadMergeJob.step()) {
          roadShellGeometry = roadMergeJob.finish();
          Object.assign(roadShellGeometry.userData, {
            neonV23JumpPlatformGeometry: metrics.jumpPlatformCount > 0,
            jumpPlatformCount: metrics.jumpPlatformCount,
            jumpPlatformEdgeCount: metrics.jumpPlatformEdgeCount,
            jumpPlatformVariantCount: metrics.jumpPlatformVariantCount,
            jumpPlatformDimensionSignatureCount: metrics.jumpPlatformDimensionSignatureCount,
            jumpPlatformVertexCount: metrics.jumpPlatformVertexCount,
            jumpPlatformTriangleCount: metrics.jumpPlatformTriangleCount,
            jumpPlatformMinimumWidthM: metrics.jumpPlatformMinimumWidthM,
            jumpPlatformMaximumWidthM: metrics.jumpPlatformMaximumWidthM,
            jumpPlatformMinimumHeightM: metrics.jumpPlatformMinimumHeightM,
            jumpPlatformMaximumHeightM: metrics.jumpPlatformMaximumHeightM,
            jumpPlatformMinimumLengthM: metrics.jumpPlatformMinimumLengthM,
            jumpPlatformMaximumLengthM: metrics.jumpPlatformMaximumLengthM,
            jumpPlatformMaximumAbsLateralM: metrics.jumpPlatformMaximumAbsLateralM,
            jumpPlatformAdditionalDrawGroupCount: metrics.jumpPlatformAdditionalDrawGroupCount,
            jumpPlatformAdditionalObjectCount: metrics.jumpPlatformAdditionalObjectCount
          });
          for (const geometry of shellGeometries) geometry.dispose();
          shellGeometries.length = 0;
          stage = 'general-lines';
        }
      } else if (stage === 'general-lines') {
        staticGeneralLineGeometry = geometryFromLinePositions(THREE, staticGeneralLinePositions);
        stage = 'ramp-lines';
      } else if (stage === 'ramp-lines') {
        staticRampRailGeometry = geometryFromLinePositions(THREE, staticRampRailPositions);
        stage = 'combine-lines';
      } else if (stage === 'combine-lines') {
        staticLineGeometry = createStaticLineBatchGeometry(
          THREE,
          staticGeneralLineGeometry,
          staticRampRailGeometry
        );
        staticGeneralLineGeometry.dispose();
        staticRampRailGeometry.dispose();
        staticGeneralLineGeometry = null;
        staticRampRailGeometry = null;
        stage = 'decorative-lanes';
      } else if (stage === 'decorative-lanes') {
        decorativeLaneGeometry = createDecorativeLaneGeometry(
          THREE,
          track,
          edges,
          tileOrigin,
          qualityProfile?.id === 'mobile'
        );
        stage = 'publish';
      } else if (stage === 'publish') {
        result = {
          roadShellGeometry,
          staticLineGeometry,
          decorativeLaneGeometry,
          routeLinePositionsByEdge,
          edges: Object.freeze(edges),
          sampleStep,
          tileOrigin,
          metrics
        };
        stage = 'done';
      }
      const elapsed = nowMilliseconds() - startedAt;
      metrics.lastSliceLabel = sliceLabel;
      if (elapsed > metrics.maximumSliceMs) {
        metrics.maximumSliceMs = elapsed;
        metrics.slowestSliceLabel = sliceLabel;
      }
      if (elapsed > Math.max(0.1, Number(budgetMs) || 4)) metrics.sliceOverrunCount++;
      return Boolean(result);
    }

    function finish() {
      if (!result) throw new Error('Cloverleaf geometry template is not complete');
      return result;
    }

    function cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const geometry of shellGeometries) geometry.dispose();
      roadShellGeometry?.dispose();
      staticGeneralLineGeometry?.dispose();
      staticRampRailGeometry?.dispose();
      staticLineGeometry?.dispose();
      decorativeLaneGeometry?.dispose();
      if (result) {
        roadShellGeometry = null;
        staticGeneralLineGeometry = null;
        staticRampRailGeometry = null;
        staticLineGeometry = null;
        decorativeLaneGeometry = null;
      }
      result = null;
    }

    const diagnostics = Object.freeze({
      get stage() { return stage; },
      get canBatchNextStep() {
        return (stage === 'merge-road' && metrics.lastSliceLabel === 'merge-road')
          || (stage === 'junction-inspection'
            && String(metrics.lastSliceLabel || '').startsWith('junction-inspection:'));
      }
    });
    return Object.freeze({ step, finish, cancel, metrics, diagnostics });
  }

  /** Batch only explicitly cursorized merge/lens work; shell and publication stages retain one callback each. */
  function resumeGeometryJobWithinSafeBudget(job, budgetMs) {
    const sliceBudgetMs = Math.max(0.1, Math.min(1.25, Number(budgetMs) || 4));
    const startedAt = nowMilliseconds();
    let complete = job.step(budgetMs);
    while (
      !complete
      && job.diagnostics?.canBatchNextStep === true
      && nowMilliseconds() - startedAt < sliceBudgetMs
    ) {
      const remainingMs = Math.max(0.1, sliceBudgetMs - (nowMilliseconds() - startedAt));
      complete = job.step(remainingMs);
    }
    return complete;
  }

  const sharedBaseTemplates = new Map();

  function sharedBaseTemplateKey(options, edges) {
    const qualityId = options.qualityProfile?.id || 'high';
    const contract = options.track.graph?.contract || {};
    const topology = edges.map((edge) => `${edgeTemplateId(edge)}:${Number(edge.length).toFixed(6)}`).join('|');
    const contractKey = [
      Number(contract.lowerHeight) || 0,
      Number(contract.upperHeight) || 0,
      Number(contract.deckThickness) || 0,
      Number(contract.bridgeBeamDepth) || 0
    ].join(':');
    return `${qualityId}:${stableHash(`${topology}:${contractKey}`).toString(16)}`;
  }

  function disposeGeometryBatch(template) {
    template?.roadShellGeometry?.dispose();
    template?.staticLineGeometry?.dispose();
    template?.decorativeLaneGeometry?.dispose();
  }

  function emptyGeometryBatch(THREE, sampleStep, tileOrigin) {
    const makeEmpty = () => geometryFromLinePositions(THREE, []);
    // The empty recovery slot shares the live road shader before a variant is installed.
    const roadShellGeometry = makeEmpty();
    roadShellGeometry.setAttribute(
      TUNNEL_ENCLOSURE_CONTRACT.attribute,
      new THREE.BufferAttribute(new Float32Array(0), 1)
    );
    roadShellGeometry.userData.tunnelEnclosureContractVersion = TUNNEL_ENCLOSURE_CONTRACT.version;
    const decorativeLaneGeometry = makeEmpty();
    Object.assign(decorativeLaneGeometry.userData, {
      bundleCount: 0,
      pathCount: 0,
      safeHalfViolationCount: 0,
      gateTargetMaxError: 0
    });
    return {
      roadShellGeometry,
      staticLineGeometry: makeEmpty(),
      decorativeLaneGeometry,
      routeLinePositionsByEdge: new Map(),
      edges: Object.freeze([]),
      sampleStep,
      tileOrigin,
      metrics: {
        dynamicRoadWidthSamples: 0,
        roadShellWidthError: 0,
        bridgeDeckThicknessError: 0,
        junctionBiasSamples: 0,
        trimmedBarrierSampleCount: 0,
        retainedJunctionBoundaryCount: 0,
        junctionRaisedBarrierIntrusionCount: 0,
        straightForkVoidBoundaryCount: 0,
        straightForkVoidBoundarySampleCount: 0,
        maximumStraightForkVoidBoundaryHeightM: 0,
        straightForkVoidBoundaryFullWidthM: STRAIGHT_FORK_VOID_BOUNDARY_FULL_WIDTH_M,
        suppressedConnectedCapCount: 0,
        recessedTopologySealCount: 0,
        junctionApronCandidateCount: 0,
        junctionApronCount: 0,
        junctionApronCoverageMissCount: 0,
        junctionApronTopologyFailureCount: 0,
        junctionApronMaximumSpanM: 0,
        junctionApronSurfaceLiftM: 0,
        junctionLongPairCount: 0,
        junctionLensCount: 0,
        junctionLensResidualOverlapCount: 0,
        junctionLensMaximumRunM: 0,
        junctionLensMaximumCrossWidthM: 0,
        junctionLensClearanceToleranceM: JUNCTION_LENS_CLEARANCE_TOLERANCE_M,
        junctionLensCoverageStationCount: 0,
        junctionLensUncoveredStationCount: 0,
        junctionLensApronContinuityFailureCount: 0,
        junctionLensClearanceFailureCount: 0,
        junctionLensMaximumEndClearanceErrorM: 0,
        junctionVerticallySeparatedPairCount: 0,
        junctionVerticalSeparationStationCount: 0,
        junctionVerticalSeparationFailureCount: 0,
        junctionMinimumVerticalShellGapM: null,
        junctionLensTopologyFailureCount: 0,
        topologyFailureCount: 0,
        maximumSliceMs: 0,
        slowestSliceLabel: null,
        sliceOverrunCount: 0,
        edgeBatchCount: 0,
        jumpPlatformCount: 0,
        jumpPlatformEdgeCount: 0,
        jumpPlatformVariantCount: 0,
        jumpPlatformDimensionSignatureCount: 0,
        jumpPlatformVertexCount: 0,
        jumpPlatformTriangleCount: 0,
        jumpPlatformMinimumWidthM: 0,
        jumpPlatformMaximumWidthM: 0,
        jumpPlatformMinimumHeightM: 0,
        jumpPlatformMaximumHeightM: 0,
        jumpPlatformMinimumLengthM: 0,
        jumpPlatformMaximumLengthM: 0,
        jumpPlatformMaximumAbsLateralM: 0,
        jumpPlatformAdditionalDrawGroupCount: 0,
        jumpPlatformAdditionalObjectCount: 0
      }
    };
  }

  function releaseSharedBaseTemplate(entry) {
    if (!entry || entry.refCount <= 0) return;
    entry.refCount--;
    if (entry.refCount > 0 || entry.waiterCount > 0) return;
    disposeGeometryBatch(entry.template);
    sharedBaseTemplates.delete(entry.key);
  }

  /**
   * Split immutable template roads from route-owned recovery. The cache owns base buffers and each visual owns
   * exactly one lease, preventing translated tiles from cloning or double-disposing the same BufferGeometry.
   */
  function createGeometryTemplateJob(options) {
    const { THREE, track, qualityProfile } = options;
    const sampleStep = qualityProfile?.id === 'mobile' ? 5 : 2.5;
    const tileOrigin = Object.freeze({
      x: Number(options.tileOrigin?.x ?? track.graph?.origin?.x) || 0,
      z: Number(options.tileOrigin?.z ?? track.graph?.origin?.z) || 0
    });
    const allEdges = edgeList(track).filter((edge) => Number.isFinite(edge.length) && edge.length > 0);
    const baseEdges = allEdges.filter((edge) => !isRuntimeOnlyEdge(edge));
    const recoveryEdges = allEdges.filter(isRuntimeOnlyEdge);
    const key = sharedBaseTemplateKey(options, baseEdges);
    let entry = sharedBaseTemplates.get(key);
    const cacheHit = Boolean(entry);
    if (!entry) {
      entry = {
        key,
        state: 'building',
        job: createGeometryBatchJob(options, baseEdges),
        template: null,
        refCount: 0,
        waiterCount: 0,
        buildCount: 1,
        hitCount: 0
      };
      sharedBaseTemplates.set(key, entry);
    } else {
      entry.hitCount++;
    }
    entry.waiterCount++;
    const recoveryJob = recoveryEdges.length ? createGeometryBatchJob(options, recoveryEdges) : null;
    let retained = false;
    let recoveryTemplate = null;
    let result = null;
    let cancelled = false;

    function retainBase() {
      if (retained) return;
      entry.waiterCount = Math.max(0, entry.waiterCount - 1);
      entry.refCount++;
      retained = true;
    }

    function step(budgetMs = 4) {
      if (cancelled || result) return Boolean(result);
      if (entry.state !== 'ready') {
        if (!resumeGeometryJobWithinSafeBudget(entry.job, budgetMs)) return false;
        entry.template = entry.job.finish();
        entry.job = null;
        entry.state = 'ready';
      }
      retainBase();
      if (!recoveryTemplate) {
        if (recoveryJob) {
          if (!resumeGeometryJobWithinSafeBudget(recoveryJob, budgetMs)) return false;
          recoveryTemplate = recoveryJob.finish();
        } else {
          recoveryTemplate = emptyGeometryBatch(THREE, sampleStep, tileOrigin);
        }
      }
      const routeLinePositionsByEdge = new Map(entry.template.routeLinePositionsByEdge);
      for (const [edgeId, positions] of recoveryTemplate.routeLinePositionsByEdge) {
        routeLinePositionsByEdge.set(edgeId, positions);
      }
      const baseMetrics = entry.template.metrics;
      const recoveryMetrics = recoveryTemplate.metrics;
      const minimumPositiveMetric = (key) => {
        const values = [baseMetrics[key], recoveryMetrics[key]]
          .map(Number)
          .filter((value) => Number.isFinite(value) && value > 0);
        return values.length ? Math.min(...values) : 0;
      };
      result = {
        baseTemplate: entry.template,
        recoveryTemplate,
        roadShellGeometry: entry.template.roadShellGeometry,
        staticLineGeometry: entry.template.staticLineGeometry,
        decorativeLaneGeometry: entry.template.decorativeLaneGeometry,
        routeLinePositionsByEdge,
        edges: Object.freeze(allEdges),
        sampleStep,
        tileOrigin,
        baseTemplateKey: key,
        baseTemplateCacheHit: cacheHit,
        baseTemplateBuildCount: entry.buildCount,
        baseTemplateHitCount: entry.hitCount,
        getBaseTemplateRefCount() { return entry.refCount; },
        metrics: {
          dynamicRoadWidthSamples: baseMetrics.dynamicRoadWidthSamples + recoveryMetrics.dynamicRoadWidthSamples,
          roadShellWidthError: Math.max(baseMetrics.roadShellWidthError, recoveryMetrics.roadShellWidthError),
          bridgeDeckThicknessError: Math.max(
            baseMetrics.bridgeDeckThicknessError,
            recoveryMetrics.bridgeDeckThicknessError
          ),
          junctionBiasSamples: baseMetrics.junctionBiasSamples + recoveryMetrics.junctionBiasSamples,
          trimmedBarrierSampleCount: baseMetrics.trimmedBarrierSampleCount + recoveryMetrics.trimmedBarrierSampleCount,
          retainedJunctionBoundaryCount: baseMetrics.retainedJunctionBoundaryCount
            + recoveryMetrics.retainedJunctionBoundaryCount,
          junctionRaisedBarrierIntrusionCount: baseMetrics.junctionRaisedBarrierIntrusionCount
            + recoveryMetrics.junctionRaisedBarrierIntrusionCount,
          straightForkVoidBoundaryCount: baseMetrics.straightForkVoidBoundaryCount
            + recoveryMetrics.straightForkVoidBoundaryCount,
          straightForkVoidBoundarySampleCount: baseMetrics.straightForkVoidBoundarySampleCount
            + recoveryMetrics.straightForkVoidBoundarySampleCount,
          maximumStraightForkVoidBoundaryHeightM: Math.max(
            baseMetrics.maximumStraightForkVoidBoundaryHeightM,
            recoveryMetrics.maximumStraightForkVoidBoundaryHeightM
          ),
          straightForkVoidBoundaryFullWidthM: Math.max(
            baseMetrics.straightForkVoidBoundaryFullWidthM,
            recoveryMetrics.straightForkVoidBoundaryFullWidthM
          ),
          suppressedConnectedCapCount: baseMetrics.suppressedConnectedCapCount
            + recoveryMetrics.suppressedConnectedCapCount,
          recessedTopologySealCount: baseMetrics.recessedTopologySealCount
            + recoveryMetrics.recessedTopologySealCount,
          junctionApronCandidateCount: baseMetrics.junctionApronCandidateCount
            + recoveryMetrics.junctionApronCandidateCount,
          junctionApronCount: baseMetrics.junctionApronCount + recoveryMetrics.junctionApronCount,
          junctionApronCoverageMissCount: baseMetrics.junctionApronCoverageMissCount
            + recoveryMetrics.junctionApronCoverageMissCount,
          junctionApronTopologyFailureCount: baseMetrics.junctionApronTopologyFailureCount
            + recoveryMetrics.junctionApronTopologyFailureCount,
          junctionApronMaximumSpanM: Math.max(
            baseMetrics.junctionApronMaximumSpanM,
            recoveryMetrics.junctionApronMaximumSpanM
          ),
          junctionApronSurfaceLiftM: Math.max(
            baseMetrics.junctionApronSurfaceLiftM,
            recoveryMetrics.junctionApronSurfaceLiftM
          ),
          junctionLongPairCount: baseMetrics.junctionLongPairCount + recoveryMetrics.junctionLongPairCount,
          junctionLensCount: baseMetrics.junctionLensCount + recoveryMetrics.junctionLensCount,
          junctionLensResidualOverlapCount: baseMetrics.junctionLensResidualOverlapCount
            + recoveryMetrics.junctionLensResidualOverlapCount,
          junctionLensMaximumRunM: Math.max(
            baseMetrics.junctionLensMaximumRunM,
            recoveryMetrics.junctionLensMaximumRunM
          ),
          junctionLensMaximumCrossWidthM: Math.max(
            baseMetrics.junctionLensMaximumCrossWidthM,
            recoveryMetrics.junctionLensMaximumCrossWidthM
          ),
          junctionLensClearanceToleranceM: Math.max(
            baseMetrics.junctionLensClearanceToleranceM,
            recoveryMetrics.junctionLensClearanceToleranceM
          ),
          junctionLensCoverageStationCount: baseMetrics.junctionLensCoverageStationCount
            + recoveryMetrics.junctionLensCoverageStationCount,
          junctionLensUncoveredStationCount: baseMetrics.junctionLensUncoveredStationCount
            + recoveryMetrics.junctionLensUncoveredStationCount,
          junctionLensApronContinuityFailureCount:
            baseMetrics.junctionLensApronContinuityFailureCount
              + recoveryMetrics.junctionLensApronContinuityFailureCount,
          junctionLensClearanceFailureCount: baseMetrics.junctionLensClearanceFailureCount
            + recoveryMetrics.junctionLensClearanceFailureCount,
          junctionLensMaximumEndClearanceErrorM: Math.max(
            baseMetrics.junctionLensMaximumEndClearanceErrorM,
            recoveryMetrics.junctionLensMaximumEndClearanceErrorM
          ),
          junctionVerticallySeparatedPairCount: baseMetrics.junctionVerticallySeparatedPairCount
            + recoveryMetrics.junctionVerticallySeparatedPairCount,
          junctionVerticalSeparationStationCount: baseMetrics.junctionVerticalSeparationStationCount
            + recoveryMetrics.junctionVerticalSeparationStationCount,
          junctionVerticalSeparationFailureCount: baseMetrics.junctionVerticalSeparationFailureCount
            + recoveryMetrics.junctionVerticalSeparationFailureCount,
          junctionMinimumVerticalShellGapM: Number.isFinite(baseMetrics.junctionMinimumVerticalShellGapM)
            && Number.isFinite(recoveryMetrics.junctionMinimumVerticalShellGapM)
            ? Math.min(
              baseMetrics.junctionMinimumVerticalShellGapM,
              recoveryMetrics.junctionMinimumVerticalShellGapM
            )
            : Number.isFinite(baseMetrics.junctionMinimumVerticalShellGapM)
              ? baseMetrics.junctionMinimumVerticalShellGapM
              : Number.isFinite(recoveryMetrics.junctionMinimumVerticalShellGapM)
                ? recoveryMetrics.junctionMinimumVerticalShellGapM
                : null,
          junctionLensTopologyFailureCount: baseMetrics.junctionLensTopologyFailureCount
            + recoveryMetrics.junctionLensTopologyFailureCount,
          topologyFailureCount: baseMetrics.topologyFailureCount + recoveryMetrics.topologyFailureCount,
          maximumSliceMs: Math.max(baseMetrics.maximumSliceMs, recoveryMetrics.maximumSliceMs),
          slowestSliceLabel: baseMetrics.maximumSliceMs >= recoveryMetrics.maximumSliceMs
            ? baseMetrics.slowestSliceLabel
            : recoveryMetrics.slowestSliceLabel,
          sliceOverrunCount: baseMetrics.sliceOverrunCount + recoveryMetrics.sliceOverrunCount,
          edgeBatchCount: baseMetrics.edgeBatchCount + recoveryMetrics.edgeBatchCount,
          jumpPlatformCount: baseMetrics.jumpPlatformCount + recoveryMetrics.jumpPlatformCount,
          jumpPlatformEdgeCount: baseMetrics.jumpPlatformEdgeCount + recoveryMetrics.jumpPlatformEdgeCount,
          jumpPlatformVariantCount: baseMetrics.jumpPlatformVariantCount
            + recoveryMetrics.jumpPlatformVariantCount,
          jumpPlatformDimensionSignatureCount: baseMetrics.jumpPlatformDimensionSignatureCount
            + recoveryMetrics.jumpPlatformDimensionSignatureCount,
          jumpPlatformVertexCount: baseMetrics.jumpPlatformVertexCount + recoveryMetrics.jumpPlatformVertexCount,
          jumpPlatformTriangleCount: baseMetrics.jumpPlatformTriangleCount
            + recoveryMetrics.jumpPlatformTriangleCount,
          jumpPlatformMinimumWidthM: minimumPositiveMetric('jumpPlatformMinimumWidthM'),
          jumpPlatformMaximumWidthM: Math.max(
            baseMetrics.jumpPlatformMaximumWidthM,
            recoveryMetrics.jumpPlatformMaximumWidthM
          ),
          jumpPlatformMinimumHeightM: minimumPositiveMetric('jumpPlatformMinimumHeightM'),
          jumpPlatformMaximumHeightM: Math.max(
            baseMetrics.jumpPlatformMaximumHeightM,
            recoveryMetrics.jumpPlatformMaximumHeightM
          ),
          jumpPlatformMinimumLengthM: minimumPositiveMetric('jumpPlatformMinimumLengthM'),
          jumpPlatformMaximumLengthM: Math.max(
            baseMetrics.jumpPlatformMaximumLengthM,
            recoveryMetrics.jumpPlatformMaximumLengthM
          ),
          jumpPlatformMaximumAbsLateralM: Math.max(
            baseMetrics.jumpPlatformMaximumAbsLateralM,
            recoveryMetrics.jumpPlatformMaximumAbsLateralM
          ),
          jumpPlatformAdditionalDrawGroupCount: baseMetrics.jumpPlatformAdditionalDrawGroupCount
            + recoveryMetrics.jumpPlatformAdditionalDrawGroupCount,
          jumpPlatformAdditionalObjectCount: baseMetrics.jumpPlatformAdditionalObjectCount
            + recoveryMetrics.jumpPlatformAdditionalObjectCount
        },
        releaseBaseTemplate() {
          if (!retained) return;
          retained = false;
          releaseSharedBaseTemplate(entry);
        }
      };
      return true;
    }

    function finish() {
      if (!result) throw new Error('Cloverleaf geometry template is not complete');
      return result;
    }

    function cancel() {
      if (cancelled) return;
      cancelled = true;
      if (recoveryTemplate) disposeGeometryBatch(recoveryTemplate);
      else recoveryJob?.cancel?.();
      if (retained) {
        retained = false;
        releaseSharedBaseTemplate(entry);
      } else {
        entry.waiterCount = Math.max(0, entry.waiterCount - 1);
        if (entry.state === 'building' && entry.waiterCount === 0 && entry.refCount === 0) {
          entry.job?.cancel?.();
          sharedBaseTemplates.delete(entry.key);
        }
      }
      recoveryTemplate = null;
      result = null;
    }

    return Object.freeze({ step, finish, cancel });
  }

  function buildGeometryTemplateSynchronously(options) {
    const job = createGeometryTemplateJob(options);
    while (!job.step(Number.POSITIVE_INFINITY)) {
      // The synchronous compatibility path is used only when a caller has not adopted createBuildJob yet.
    }
    return job.finish();
  }

  function disposeGeometryTemplate(template) {
    if (!template) return;
    disposeGeometryBatch(template.recoveryTemplate);
    template.releaseBaseTemplate?.();
  }

  /**
   * Build one sealed cape-spirit companion and merge its organic parts into the resident traffic buffer.
   * Local -Z remains the nose contract consumed by the unchanged road-frame instance basis.
   */
  function createTrafficGeometry(THREE, modeling) {
    const components = [];
    const ringSegments = 14;
    const ellipseRing = ({ z, rx, ry, cx = 0, cy = 0 }) => {
      const ring = [];
      for (let index = 0; index < ringSegments; index++) {
        const angle = index / ringSegments * Math.PI * 2;
        ring.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, z]);
      }
      return ring;
    };
    const addComponent = (geometry, colorHex, role) => {
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const color = new THREE.Color(colorHex);
      const vertexColors = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let offset = 0; offset < vertexColors.length; offset += 3) {
        vertexColors[offset] = color.r;
        vertexColors[offset + 1] = color.g;
        vertexColors[offset + 2] = color.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
      geometry.userData.trafficShipRole = role;
      components.push(geometry);
      return geometry;
    };

    // One gently scalloped cloak reads as a living cape from Film and map-adjacent views without a hard wing edge.
    const capeWingPair = modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [
        [0, 2.54], [0.42, 2.28], [1.10, 1.58], [2.30, 0.84], [2.82, 0.18],
        [2.66, -0.48], [1.86, -0.34], [1.34, -1.02], [0.68, -1.50], [0, -1.78],
        [-0.68, -1.50], [-1.34, -1.02], [-1.86, -0.34], [-2.66, -0.48],
        [-2.82, 0.18], [-2.30, 0.84], [-1.10, 1.58], [-0.42, 2.28]
      ],
      depth: 0.30,
      bevel: 0.085,
      bevelSegments: 2
    });
    capeWingPair.rotateX(-Math.PI / 2);
    capeWingPair.translate(0, 0.07, 0);
    addComponent(capeWingPair, 0xd7_b1_70, 'soft-cape-wing-pair');

    const spiritBody = modeling.createLoftGeometry({
      THREE,
      rings: [
        { z: -2.82, rx: 0.05, ry: 0.04, cy: 0.31 },
        { z: -2.40, rx: 0.22, ry: 0.16, cy: 0.34 },
        { z: -1.54, rx: 0.48, ry: 0.34, cy: 0.38 },
        { z: -0.30, rx: 0.62, ry: 0.42, cy: 0.38 },
        { z: 0.88, rx: 0.42, ry: 0.30, cy: 0.32 },
        { z: 1.55, rx: 0.14, ry: 0.10, cy: 0.24 }
      ].map(ellipseRing),
      capStart: true,
      capEnd: true
    });
    addComponent(spiritBody, 0xee_e2_c3, 'spirit-pilgrim-body');

    const mask = modeling.createLoftGeometry({
      THREE,
      rings: [
        { z: -2.44, rx: 0.035, ry: 0.025, cy: 0.64 },
        { z: -2.28, rx: 0.20, ry: 0.14, cy: 0.67 },
        { z: -1.78, rx: 0.35, ry: 0.23, cy: 0.68 },
        { z: -1.34, rx: 0.24, ry: 0.15, cy: 0.65 },
        { z: -1.18, rx: 0.035, ry: 0.025, cy: 0.61 }
      ].map(ellipseRing),
      capStart: true,
      capEnd: true
    });
    addComponent(mask, 0x8e_7459, 'abstract-pilgrim-mask');

    for (const side of [-1, 1]) {
      const eye = modeling.createLoftGeometry({
        THREE,
        rings: [
          { z: -2.31, rx: 0.012, ry: 0.010, cx: side * 0.14, cy: 0.72 },
          { z: -2.24, rx: 0.074, ry: 0.052, cx: side * 0.14, cy: 0.72 },
          { z: -2.04, rx: 0.080, ry: 0.057, cx: side * 0.14, cy: 0.72 },
          { z: -1.97, rx: 0.012, ry: 0.010, cx: side * 0.14, cy: 0.72 }
        ].map(ellipseRing),
        capStart: true,
        capEnd: true
      });
      addComponent(eye, 0xff_e1_8b, side < 0 ? 'candle-eye-left' : 'candle-eye-right');

      const tailClothPetal = modeling.createExtrudedProfileGeometry({
        THREE,
        outline: [[0, 0.78], [0.25, 0.54], [0.30, -0.78], [0, -1.17], [-0.30, -0.78], [-0.25, 0.54]],
        depth: 0.12,
        bevel: 0.035,
        bevelSegments: 2
      });
      tailClothPetal.rotateX(-Math.PI / 2);
      tailClothPetal.translate(side * 0.58, 0.13, 0.68);
      addComponent(
        tailClothPetal,
        side < 0 ? 0xcb_9e_62 : 0xdf_bd_7c,
        side < 0 ? 'tail-cloth-petal-left' : 'tail-cloth-petal-right'
      );

      const memoryRibbon = modeling.createExtrudedProfileGeometry({
        THREE,
        outline: [[0, 0.56], [0.12, 0.38], [0.10, -0.82], [0, -1.14], [-0.10, -0.82], [-0.12, 0.38]],
        depth: 0.08,
        bevel: 0.022,
        bevelSegments: 1
      });
      memoryRibbon.rotateX(-Math.PI / 2);
      memoryRibbon.translate(side * 1.15, 0.09, 0.72);
      addComponent(
        memoryRibbon,
        side < 0 ? 0x8d_c1_ba : 0xac_d4_ca,
        side < 0 ? 'memory-ribbon-left' : 'memory-ribbon-right'
      );
    }

    const mergeJob = createIndexedGeometryMergeJob(THREE, components, null);
    while (!mergeJob.step()) {
      // This nine-part companion is built once per visual template, outside the gameplay update loop.
    }
    const geometry = mergeJob.finish();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    const artGeometry = AMBIENT_TRAFFIC_ART_CONTRACT.geometry;
    const envelope = artGeometry.maximumLocalEnvelope;
    const box = geometry.boundingBox;
    const envelopeViolationCount = [
      box.min.x < envelope.minX - 0.000_001,
      box.max.x > envelope.maxX + 0.000_001,
      box.min.y < envelope.minY - 0.000_001,
      box.max.y > envelope.maxY + 0.000_001,
      box.min.z < envelope.minZ - 0.000_001,
      box.max.z > envelope.maxZ + 0.000_001
    ].filter(Boolean).length;
    const componentRoles = Object.freeze(components.map((component) => (
      component.userData.trafficShipRole
    )));
    geometry.userData.neonV23AmbientTrafficArt = Object.freeze({
      contractVersion: AMBIENT_TRAFFIC_ART_CONTRACT.version,
      role: 'cape-spirit-pilgrimage-companion',
      topology: artGeometry.topology,
      componentRoles,
      actualLocalEnvelope: Object.freeze({
        minX: box.min.x,
        maxX: box.max.x,
        minY: box.min.y,
        maxY: box.max.y,
        minZ: box.min.z,
        maxZ: box.max.z
      }),
      envelopeViolationCount
    });
    geometry.userData.neonV23TrafficShape = Object.freeze({
      renderPrimitive: 'triangles',
      componentCount: components.length,
      featureCount: 6,
      wingPairCount: artGeometry.inventory.capeWingPairCount,
      capeWingPairCount: artGeometry.inventory.capeWingPairCount,
      spiritBodyCount: artGeometry.inventory.spiritBodyCount,
      maskCount: artGeometry.inventory.abstractMaskCount,
      eyeCount: artGeometry.inventory.eyeCount,
      tailClothPetalCount: artGeometry.inventory.tailClothPetalCount,
      memoryRibbonCount: artGeometry.inventory.memoryRibbonCount,
      canopyCount: 0,
      engineCount: artGeometry.inventory.engineCount,
      nozzleCount: artGeometry.inventory.nozzleCount,
      turbineCount: artGeometry.inventory.turbineCount,
      mechanicalPanelCount: artGeometry.inventory.mechanicalPanelCount,
      tailFinCount: 0,
      mergedGeometryCount: AMBIENT_TRAFFIC_ART_CONTRACT.invariants.mergedGeometryCount,
      componentRoles,
      widthM: size.x,
      heightM: size.y,
      lengthM: size.z,
      vertexCount: geometry.getAttribute('position').count,
      triangleCount: (geometry.index?.count || geometry.getAttribute('position').count) / 3,
      noseAxisZ: artGeometry.noseAxisZ,
      envelopeViolationCount
    });
    for (const component of components) component.dispose();
    if (envelopeViolationCount !== 0) {
      geometry.dispose();
      throw new Error('Ambient traffic art exceeds the preserved local traffic envelope');
    }
    return geometry;
  }

  /** Traverse the Y profile downward so the shared radial factory gives every stone face outward winding. */
  function createSupportGeometry(THREE, modeling, pierRadius) {
    const geometry = modeling.createRadialGeometry({
      THREE,
      profile: [
        [-0.5, pierRadius * 0.88],
        [-0.485, pierRadius * 0.94],
        [-0.455, pierRadius],
        [-0.415, pierRadius * 0.96],
        [-0.36, pierRadius * 0.90],
        [-0.285, pierRadius * 0.86],
        [-0.18, pierRadius * 0.83],
        [-0.055, pierRadius * 0.82],
        [0.09, pierRadius * 0.83],
        [0.22, pierRadius * 0.85],
        [0.325, pierRadius * 0.89],
        [0.395, pierRadius * 0.94],
        [0.445, pierRadius],
        [0.475, pierRadius * 0.97],
        [0.492, pierRadius * 0.92],
        [0.5, pierRadius * 0.86]
      ].reverse(),
      segments: 32,
      capStart: true,
      capEnd: true
    });
    return markSkyRouteGeometry(
      geometry,
      'wind-eroded-bridge-pier',
      SKY_ROUTE_SCENERY_CONTRACT.geometry.pier.topology,
      {
        minX: -pierRadius,
        maxX: pierRadius,
        minY: -0.5,
        maxY: 0.5,
        minZ: -pierRadius,
        maxZ: pierRadius
      }
    );
  }

  /** Consecutive crossings carried by one upper edge share girders, joints, and rails as one physical bridge. */
  function createPhysicalSpans(track, crossings, edgeById) {
    const groups = new Map();
    for (const crossing of crossings) {
      const upperEdgeId = crossing.upperEdgeId || crossing.upperEdge;
      const physicalSpanId = crossing.physicalSpanId || `bridge-span:${edgeTemplateId(
        track.getEdge?.(upperEdgeId) || edgeById.get(upperEdgeId)?.edge || edgeById.get(upperEdgeId)
      )}`;
      if (!groups.has(physicalSpanId)) groups.set(physicalSpanId, { upperEdgeId, records: [] });
      groups.get(physicalSpanId).records.push(crossing);
    }
    return [...groups.entries()].map(([physicalSpanId, group]) => {
      const { upperEdgeId, records } = group;
      const edge = track.getEdge?.(upperEdgeId) || edgeById.get(upperEdgeId)?.edge || edgeById.get(upperEdgeId);
      const startS = clamp(Math.min(...records.map((crossing) => (
        Number.isFinite(crossing.upperSpanStartS)
          ? crossing.upperSpanStartS
          : (crossing.upperEdgeS ?? crossing.upperS) - Number(crossing.maskSpan || 0) * 0.5
      ))), 0, edge?.length || Number.POSITIVE_INFINITY);
      const endS = clamp(Math.max(...records.map((crossing) => (
        Number.isFinite(crossing.upperSpanEndS)
          ? crossing.upperSpanEndS
          : (crossing.upperEdgeS ?? crossing.upperS) + Number(crossing.maskSpan || 0) * 0.5
      ))), 0, edge?.length || Number.POSITIVE_INFINITY);
      return Object.freeze({
        id: physicalSpanId,
        physicalSpanId,
        upperEdgeId,
        upperSpanStartS: startS,
        upperSpanEndS: endS,
        lowerSpans: Object.freeze(records.map((crossing) => Object.freeze({
          crossingId: crossing.id,
          lowerEdgeId: crossing.lowerEdgeId || crossing.lowerEdge,
          lowerSpanStartS: Number.isFinite(crossing.lowerSpanStartS)
            ? crossing.lowerSpanStartS
            : Math.max(0, (crossing.lowerEdgeS ?? crossing.lowerS) - Number(crossing.maskSpan || 0) * 0.5),
          lowerSpanEndS: Number.isFinite(crossing.lowerSpanEndS)
            ? crossing.lowerSpanEndS
            : (crossing.lowerEdgeS ?? crossing.lowerS) + Number(crossing.maskSpan || 0) * 0.5
        }))),
        crossingIds: Object.freeze(records.map((crossing) => crossing.id))
      });
    });
  }

  /** Fail closed unless all three movements for an entry prove a route-disjoint main-road set. */
  function createTrafficSafetyContract(track, edges, entryPort) {
    const movements = movementList(track).filter((movement) => movement.entryPort === entryPort);
    const playerPossibleEdgeIds = new Set(movements.flatMap((movement) => movement.edgeIds || []));
    const safeEdges = movements.length === 3
      ? edges.filter((edge) => (
          !isRuntimeOnlyEdge(edge)
          && (edge.family === 'mainline' || edge.family === 'approach' || edge.family === 'outbound')
          && !playerPossibleEdgeIds.has(edge.id)
        ))
      : [];
    const trafficRouteIntersectionCount = safeEdges.reduce((count, edge) => (
      count + (playerPossibleEdgeIds.has(edge.id) ? 1 : 0)
    ), 0);
    const runtimeEdgeViolationCount = safeEdges.reduce((count, edge) => count + (isRuntimeOnlyEdge(edge) ? 1 : 0), 0);
    const recoveryEdgeViolationCount = safeEdges.reduce((count, edge) => (
      count + (edge.runtimeKind === 'recovery' || edge.family === 'recovery' ? 1 : 0)
    ), 0);
    const launchEdgeViolationCount = safeEdges.reduce((count, edge) => (
      count + (edge.runtimeKind === 'launch' || edge.family === 'launch' ? 1 : 0)
    ), 0);
    return Object.freeze({
      entryPort,
      movementCount: movements.length,
      playerPossibleEdgeIds: Object.freeze([...playerPossibleEdgeIds]),
      safeEdges: Object.freeze(safeEdges),
      trafficRouteIntersectionCount,
      runtimeEdgeViolationCount,
      recoveryEdgeViolationCount,
      launchEdgeViolationCount,
      proven: movements.length === 3 && safeEdges.length > 0
        && trafficRouteIntersectionCount === 0 && runtimeEdgeViolationCount === 0
    });
  }

  /** One sealed petal-spire unit turns decision towers, stone ribbons, and posts organic without moving a matrix. */
  function createSkyPetalSpireRibbonGeometry(THREE, modeling) {
    const outline = Object.freeze([
      Object.freeze([0, -0.5]),
      Object.freeze([0.15, -0.40]),
      Object.freeze([0.34, -0.34]),
      Object.freeze([0.40, -0.15]),
      Object.freeze([0.5, 0]),
      Object.freeze([0.40, 0.15]),
      Object.freeze([0.34, 0.34]),
      Object.freeze([0.15, 0.40]),
      Object.freeze([0, 0.5]),
      Object.freeze([-0.15, 0.40]),
      Object.freeze([-0.34, 0.34]),
      Object.freeze([-0.40, 0.15]),
      Object.freeze([-0.5, 0]),
      Object.freeze([-0.40, -0.15]),
      Object.freeze([-0.34, -0.34]),
      Object.freeze([-0.15, -0.40])
    ]);
    const ringAt = (vertical, scale) => outline.map(([x, z]) => [x * scale, vertical, z * scale]);
    const geometry = modeling.createLoftGeometry({
      THREE,
      rings: [
        ringAt(-0.5, 0.76),
        ringAt(-0.43, 0.92),
        ringAt(-0.28, 1),
        ringAt(0.28, 1),
        ringAt(0.43, 0.92),
        ringAt(0.5, 0.76)
      ],
      capStart: true,
      capEnd: true
    });
    markSkyRouteGeometry(
      geometry,
      'wind-eroded-petal-spire-and-ribbon',
      SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.topology,
      { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 }
    );
    geometry.userData.neonV23SkyWayfindingArt = Object.freeze({
      contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
      role: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.role,
      topology: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.topology,
      matrixAuthority: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.matrixAuthority
    });
    return geometry;
  }

  /** Preserve petal carving while keeping both lateral bearing lands on the matrix-defined contact planes. */
  function createSkyStoneCapitalGeometry(THREE, modeling) {
    const outline = Object.freeze([
      Object.freeze([0, -0.5]),
      Object.freeze([0.16, -0.39]),
      Object.freeze([0.35, -0.35]),
      Object.freeze([0.5, -0.24]),
      Object.freeze([0.5, 0]),
      Object.freeze([0.5, 0.24]),
      Object.freeze([0.35, 0.35]),
      Object.freeze([0.16, 0.39]),
      Object.freeze([0, 0.5]),
      Object.freeze([-0.16, 0.39]),
      Object.freeze([-0.35, 0.35]),
      Object.freeze([-0.5, 0.24]),
      Object.freeze([-0.5, 0]),
      Object.freeze([-0.5, -0.24]),
      Object.freeze([-0.35, -0.35]),
      Object.freeze([-0.16, -0.39])
    ]);
    // The same unit serves short capitals and wide portal transfer beams. Scaling its bearing tips by 0.82
    // retreats the real bottom face by metres on a wide beam even though its matrix still meets both shafts.
    // Keep three vertices at each X end on the complete span, forming a finite bearing land; the other petal
    // vertices and longitudinal bevel retain their authored detail within the unchanged unit envelope. The X/Z
    // outline must also reverse for a +Y loft, otherwise the sealed faces point inward and FrontSide culls them.
    const ringAt = (vertical, scale) => outline.map(([x, z]) => [
      Math.abs(x) === 0.5 ? x : x * scale,
      vertical,
      z * scale
    ]).reverse();
    const geometry = modeling.createLoftGeometry({
      THREE,
      rings: [
        ringAt(-0.5, 0.82),
        ringAt(-0.42, 0.94),
        ringAt(-0.3, 1),
        ringAt(0.3, 1),
        ringAt(0.42, 0.94),
        ringAt(0.5, 0.82)
      ],
      capStart: true,
      capEnd: true
    });
    return markSkyRouteGeometry(
      geometry,
      'petal-diamond-capital-and-foundation',
      SKY_ROUTE_SCENERY_CONTRACT.geometry.capitalAndFoundation.topology,
      { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 }
    );
  }

  /** Chamfered wind-stone ribs retain the exact unit prism envelope consumed by every prepared matrix. */
  function createSkyStoneRibGeometry(THREE, modeling) {
    const geometry = modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [
        [-0.32, -0.5],
        [0.32, -0.5],
        [0.46, -0.42],
        [0.5, -0.22],
        [0.47, 0.16],
        [0.34, 0.42],
        [0.18, 0.5],
        [-0.18, 0.5],
        [-0.34, 0.42],
        [-0.47, 0.16],
        [-0.5, -0.22],
        [-0.46, -0.42]
      ],
      depth: 1,
      bevel: 0.045,
      bevelSegments: 2
    });
    return markSkyRouteGeometry(
      geometry,
      'carved-warm-stone-portal-and-rib',
      SKY_ROUTE_SCENERY_CONTRACT.geometry.portalAndRib.topology,
      { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 }
    );
  }

  /**
   * Seal a four-point star in the horizontal X/Z plane. The old unit bounds and thin Y thickness are preserved,
   * so every bridge/tunnel fixture matrix remains valid while Film views read an actual candle-star silhouette.
   */
  function createCandleStarGeometry(THREE, modeling) {
    const outline = Object.freeze([
      Object.freeze([0, -0.5]),
      Object.freeze([0.12, -0.12]),
      Object.freeze([0.5, 0]),
      Object.freeze([0.12, 0.12]),
      Object.freeze([0, 0.5]),
      Object.freeze([-0.12, 0.12]),
      Object.freeze([-0.5, 0]),
      Object.freeze([-0.12, -0.12])
    ]);
    const ringAt = (vertical, scale) => outline.map(([x, z]) => [x * scale, vertical, z * scale]);
    const geometry = modeling.createLoftGeometry({
      THREE,
      rings: [
        ringAt(-0.5, 0.78),
        ringAt(-0.34, 1),
        ringAt(0.34, 1),
        ringAt(0.5, 0.78)
      ],
      capStart: true,
      capEnd: true
    });
    return markSkyRouteGeometry(
      geometry,
      'constant-on-candle-star-diffuser',
      SKY_ROUTE_SCENERY_CONTRACT.geometry.candleStar.topology,
      { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 }
    );
  }

  const TUNNEL_SHELL_MAXIMUM_SEGMENT_M = 2;
  const TUNNEL_SHELL_MAXIMUM_CHORD_ERROR_M = 0.005;
  const UNDERGROUND_PORTAL_RIB_ROAD_CLEARANCE_M = 0.02;
  const TUNNEL_LUMINAIRE_SPACING_M = Object.freeze({
    underground: 22,
    mountain: 28
  });

  const TUNNEL_ENCLOSURE_CONTRACT = Object.freeze({
    version: 1,
    attribute: 'tunnelEnclosure',
    coordinateMode: 'authored-profile-surface-distance',
    portalBlendDefaultM: 42,
    minimum: 0,
    maximum: 1,
    exteriorValue: 0,
    fixtureDistanceGated: false,
    additionalDrawGroupCount: 0,
    additionalObjectCount: 0
  });

  /**
   * Resolve local sky occlusion from the authored enclosure, independently of electrical fixture brightness or
   * camera position. Profile distances are converted from plan distance to rendered surface distance; the two
   * portal fades meet continuously and never treat an ordinary bridge's underpass mask as a sealed tunnel.
   */
  function sampleTunnelEnclosure(profile, surfaceS) {
    if (profile?.kind !== 'underground-tunnel' && profile?.kind !== 'mountain-tunnel') return 0;
    const startS = Number(profile.surfaceStartS);
    const endS = Number(profile.surfaceEndS);
    if (!Number.isFinite(surfaceS) || !Number.isFinite(startS) || !Number.isFinite(endS)
      || !(endS > startS) || surfaceS <= startS || surfaceS >= endS) return 0;
    const planarSpan = Number(profile.endS) - Number(profile.startS);
    const surfaceScale = planarSpan > 0 ? (endS - startS) / planarSpan : 1;
    const portalBlend = Math.max(1, Number(profile.portalBlend) || TUNNEL_ENCLOSURE_CONTRACT.portalBlendDefaultM)
      * surfaceScale;
    const depth = clamp(Math.min(surfaceS - startS, endS - surfaceS) / portalBlend, 0, 1);
    // Match the authored route's quintic portal easing, including its zero first/second endpoint derivatives.
    return depth * depth * depth * (depth * (depth * 6 - 15) + 10);
  }

  /** Overlapping authored enclosures share the stronger sky mask without combining their lamp energy. */
  function sampleEdgeTunnelEnclosure(profiles, surfaceS) {
    let enclosure = 0;
    for (const profile of profiles || []) {
      enclosure = Math.max(enclosure, sampleTunnelEnclosure(profile, surfaceS));
    }
    return enclosure;
  }

  /**
   * Keep tunnel luminaires on an electrical cadence independent of sparse structural ribs. Mid-cell placement
   * avoids a light directly outside either portal, while equal subdivision guarantees the authored maximum spacing.
   */
  function createTunnelLuminaireStations(profile, startS, endS) {
    const spacingKind = profile.kind === 'underground-tunnel' ? 'underground' : 'mountain';
    const maximumSpacingM = TUNNEL_LUMINAIRE_SPACING_M[spacingKind];
    const lengthM = Math.max(0, endS - startS);
    const stationCount = Math.max(1, Math.ceil(lengthM / maximumSpacingM));
    const actualSpacingM = lengthM / stationCount;
    return Object.freeze({
      maximumSpacingM,
      actualSpacingM,
      stations: Object.freeze(Array.from(
        { length: stationCount },
        (_, index) => startS + actualSpacingM * (index + 0.5)
      ))
    });
  }

  function staticTunnelIrradianceLevels(profile) {
    return profile?.kind === 'underground-tunnel'
      ? STATIC_TUNNEL_IRRADIANCE_CONTRACT.underground
      : profile?.kind === 'mountain-tunnel'
        ? STATIC_TUNNEL_IRRADIANCE_CONTRACT.mountain
        : null;
  }

  /** Freeze one receiver profile around the exact authored luminaire stations used by covers and emitters. */
  function createStaticTunnelIrradianceProfile(profile, startS, endS, stationContract) {
    const levels = staticTunnelIrradianceLevels(profile);
    if (!levels || !(endS > startS) || !stationContract?.stations?.length) return null;
    return Object.freeze({
      startS,
      endS,
      floor: levels.floor,
      peak: levels.peak,
      halfSpacingM: Math.max(0.5, Number(stationContract.actualSpacingM) * 0.5),
      stations: stationContract.stations
    });
  }

  /** Precompute resident tunnel light-map profiles from the same station cadence as the visible luminaires. */
  function createEdgeStaticTunnelIrradianceProfiles(edge) {
    const profiles = [];
    for (const profile of edge?.tunnelProfiles || []) {
      const startS = Number(profile.surfaceStartS);
      const endS = Number(profile.surfaceEndS);
      if (!(endS > startS)) continue;
      const stationContract = createTunnelLuminaireStations(profile, startS, endS);
      const irradianceProfile = createStaticTunnelIrradianceProfile(
        profile,
        startS,
        endS,
        stationContract
      );
      if (irradianceProfile) profiles.push(irradianceProfile);
    }
    return Object.freeze(profiles);
  }

  /**
   * Resolve only authored route position. No player, camera, portal, or frame-time input can make resident tunnel
   * pavement switch on late; the nonzero floor between fixtures models overlapping diffuse bounce.
   */
  function sampleEdgeStaticTunnelIrradiance(profiles, edgeS) {
    let irradiance = 0;
    for (const profile of profiles) {
      if (edgeS < profile.startS || edgeS > profile.endS) continue;
      let nearestStationDistanceM = Number.POSITIVE_INFINITY;
      for (const station of profile.stations) {
        nearestStationDistanceM = Math.min(nearestStationDistanceM, Math.abs(edgeS - station));
      }
      const stationEnvelope = smootherStep01(
        1 - nearestStationDistanceM / profile.halfSpacingM
      );
      irradiance = Math.max(
        irradiance,
        profile.floor + (profile.peak - profile.floor) * stationEnvelope
      );
    }
    return irradiance;
  }

  /**
   * Merge every portal/rib and road-shell row into the denser enclosure table before curvature refinement.
   * Sharing the road rows makes the wall foot follow the exact rendered shoulder polyline; extra stations inside
   * each road segment remain collinear at the joint, so refinement cannot reopen a longitudinal crack.
   */
  function createTunnelSharedStations(startS, endS, ribSegmentCount, roadStations = []) {
    const normalizedRibSegmentCount = Math.max(1, Math.floor(ribSegmentCount));
    const ribStations = [];
    const shellStations = [];
    for (let ribIndex = 0; ribIndex <= normalizedRibSegmentCount; ribIndex++) {
      const ribS = startS + (endS - startS) * ribIndex / normalizedRibSegmentCount;
      ribStations.push(ribS);
      if (ribIndex === normalizedRibSegmentCount) continue;
      const nextRibS = startS
        + (endS - startS) * (ribIndex + 1) / normalizedRibSegmentCount;
      const subdivisionCount = Math.max(
        1,
        Math.ceil((nextRibS - ribS) / TUNNEL_SHELL_MAXIMUM_SEGMENT_M)
      );
      if (shellStations.length === 0) shellStations.push(ribS);
      for (let subdivision = 1; subdivision <= subdivisionCount; subdivision++) {
        shellStations.push(ribS + (nextRibS - ribS) * subdivision / subdivisionCount);
      }
    }
    const mergedShellStations = [...shellStations];
    for (const roadS of roadStations) {
      if (roadS > startS + 0.000_001 && roadS < endS - 0.000_001) {
        mergedShellStations.push(roadS);
      }
    }
    mergedShellStations.sort((left, right) => left - right);
    const uniqueShellStations = mergedShellStations.filter((station, index) => (
      index === 0 || station - mergedShellStations[index - 1] > 0.000_001
    ));
    return Object.freeze({
      ribStations: Object.freeze(ribStations),
      shellStations: Object.freeze(uniqueShellStations)
    });
  }

  /** Build the immutable profile/station records shared by live rendering and server-side geometry audits. */
  function createTunnelProfileSpecs(track, edges, sampleStep, tunnelRibSpacing) {
    const specs = [];
    for (const edge of edges) {
      for (const profile of edge.tunnelProfiles || []) {
        const startS = Number(profile.surfaceStartS);
        const endS = Number(profile.surfaceEndS);
        if (!(endS > startS)) continue;
        const segmentCount = Math.max(2, Math.ceil((endS - startS) / tunnelRibSpacing));
        // These are the exact rows used by createEdgeShellBuildJob(); tunnel joints must include every kink.
        const roadRowCount = Math.max(6, Math.ceil(edge.length / sampleStep));
        const roadStations = Object.freeze(Array.from(
          { length: roadRowCount + 1 },
          (_, rowIndex) => edge.length * rowIndex / roadRowCount
        ));
        const stationContract = createTunnelSharedStations(
          startS,
          endS,
          segmentCount,
          roadStations
        );
        const luminaireContract = createTunnelLuminaireStations(profile, startS, endS);
        const staticIrradianceProfile = createStaticTunnelIrradianceProfile(
          profile,
          startS,
          endS,
          luminaireContract
        );
        if (!staticIrradianceProfile) continue;
        specs.push(Object.freeze({
          edge,
          profile,
          startS,
          endS,
          segmentCount,
          ribStations: stationContract.ribStations,
          shellStations: stationContract.shellStations,
          luminaireStations: luminaireContract.stations,
          luminaireSpacingM: luminaireContract.actualSpacingM,
          luminaireMaximumSpacingM: luminaireContract.maximumSpacingM,
          staticIrradianceProfile,
          roadRowCount,
          roadStations
        }));
      }
    }
    return Object.freeze(specs);
  }

  /**
   * Resolve the shared underground road/U-wall section from one contract. The wall's inner foot is exactly the
   * road shoulder; its body grows only outward, and the roof overlaps the outer wall without crossing inward.
   */
  function inspectUndergroundTunnelRoadJoin(
    profile,
    roadHalf,
    undergroundWallInset,
    undergroundRoofInset,
    roadShoulderJoin,
    undergroundWallThickness
  ) {
    const wallThickness = Number(profile.wallThickness) || undergroundWallThickness;
    const shoulderJoin = Number(profile.roadShoulderJoin) || roadShoulderJoin;
    const wallCenterInset = Number(profile.wallInset) || undergroundWallInset;
    const wallInner = roadHalf + shoulderJoin;
    const wallOuter = wallInner + wallThickness;
    const roofHalf = roadHalf + (Number(profile.roofInset) || undergroundRoofInset);
    const authoredWallInner = roadHalf + wallCenterInset - wallThickness * 0.5;
    return Object.freeze({
      roadHalf,
      shoulderJoin,
      wallThickness,
      wallCenterInset,
      wallInner,
      wallOuter,
      roofHalf,
      roadJoinGapM: Math.max(0, authoredWallInner - wallInner),
      roadJoinPenetrationM: Math.max(0, wallInner - authoredWallInner),
      roofWallGapM: Math.max(0, wallOuter - roofHalf),
      roofOverhangM: roofHalf - wallOuter
    });
  }

  /** Return one CCW solid cross-section: a roof slab for galleries or a road-joined U shell underground. */
  function tunnelShellCrossSection(
    profile,
    roadHalf,
    clearance,
    undergroundWallInset,
    undergroundRoofInset,
    roadShoulderJoin,
    undergroundWallThickness
  ) {
    if (profile.kind === 'mountain-tunnel') {
      const roofHalf = roadHalf + (Number(profile.roofInset) || 1.34);
      const roofThickness = Number(profile.roofDepth) || 1.15;
      return [
        [-roofHalf, clearance],
        [roofHalf, clearance],
        [roofHalf, clearance + roofThickness],
        [-roofHalf, clearance + roofThickness]
      ];
    }
    const join = inspectUndergroundTunnelRoadJoin(
      profile,
      roadHalf,
      undergroundWallInset,
      undergroundRoofInset,
      roadShoulderJoin,
      undergroundWallThickness
    );
    if (join.roadJoinGapM > 0.000_001 || join.roadJoinPenetrationM > 0.000_001) {
      throw new Error('Underground tunnel wall inset no longer resolves to the road shoulder joint');
    }
    if (join.roofWallGapM > 0.000_001 || join.roofOverhangM < -0.000_001) {
      throw new Error('Underground tunnel roof no longer seals the outer U wall');
    }
    const roofThickness = Number(profile.roofDepth) || 0.46;
    return [
      [-join.wallInner, 0],
      [-join.wallInner, clearance],
      [join.wallInner, clearance],
      [join.wallInner, 0],
      [join.wallOuter, 0],
      [join.wallOuter, clearance],
      [join.roofHalf, clearance],
      [join.roofHalf, clearance + roofThickness],
      [-join.roofHalf, clearance + roofThickness],
      [-join.roofHalf, clearance],
      [-join.wallOuter, clearance],
      [-join.wallOuter, 0]
    ];
  }

  /**
   * Inner wall/ceiling vertices receive the authored fixture field directly. The outward structural skin keeps a
   * small bounce term so a Film exterior does not reveal an electrically dead shell, without making it a lamp.
   */
  function tunnelShellReceiverGain(profile, pointIndex) {
    const gain = STATIC_TUNNEL_IRRADIANCE_CONTRACT.receiverGain;
    if (profile.kind === 'mountain-tunnel') {
      return pointIndex <= 1 ? gain.shellInterior : gain.shellExteriorBounce;
    }
    return pointIndex <= 3 ? gain.shellInterior : gain.shellExteriorBounce;
  }

  /**
   * Sweep indexed cross-section rows along every tunnel profile. Adjacent panels reference the same row vertices,
   * so curvature refinement cannot leave the longitudinal cracks produced by independent tangent-aligned boxes.
   */
  function* createContinuousTunnelShellGeometrySteps(
    THREE,
    track,
    specs,
    tileOrigin,
    undergroundWallInset,
    undergroundRoofInset,
    roadShoulderJoin,
    undergroundWallThickness,
    own
  ) {
    const positions = [];
    const colors = [];
    const staticTunnelIrradiance = [];
    const tunnelEnclosure = [];
    const indices = [];
    const mountainColor = new THREE.Color(0xad_835a);
    const undergroundColor = new THREE.Color(0x82_6955);
    let maximumSegmentLengthM = 0;
    let maximumChordErrorM = 0;
    let maximumRibAlignmentErrorM = 0;
    let maximumPortalAlignmentErrorM = 0;
    let stationCount = 0;
    let longitudinalSegmentCount = 0;
    let panelCount = 0;
    let roofPanelCount = 0;
    let undergroundWallPanelCount = 0;
    let safeCorridorViolationCount = 0;
    let roadJoinSharedVertexCount = 0;
    let maximumRoadJoinGapM = 0;
    let maximumRoadJoinPenetrationM = 0;
    let maximumRoadJoinAlignmentAdjustmentM = 0;
    let maximumRoofWallGapM = 0;
    let staticIrradiancePositiveVertexCount = 0;
    let staticIrradianceMinimumReceiver = Number.POSITIVE_INFINITY;
    let staticIrradianceMaximum = 0;

    function nearestStationError(targetS, stations) {
      let error = Number.POSITIVE_INFINITY;
      for (const station of stations) error = Math.min(error, Math.abs(station - targetS));
      return Number.isFinite(error) ? error : 0;
    }

    for (const spec of specs) {
      const { edge, profile } = spec;
      const clearance = Math.max(3.4, Number(profile.clearance) || 3.6);
      const rowCache = new Map();
      const roadJoinRowCache = new Map();

      /** Reconstruct the exact road-shell shoulder vertex at one authored road row. */
      function roadJoinAtRow(rowIndex, side) {
        const cacheKey = `${rowIndex}:${side}`;
        if (roadJoinRowCache.has(cacheKey)) return roadJoinRowCache.get(cacheKey);
        const roadS = spec.roadStations[rowIndex];
        const center = sample(track, edge.id, roadS, 0, {});
        const roadHalf = sampledRoadHalf(center, edge);
        const shoulder = sample(
          track,
          edge.id,
          roadS,
          side * (roadHalf + roadShoulderJoin),
          {}
        );
        const surfaceBias = junctionSurfaceBias(edge, roadS);
        const point = Object.freeze([
          shoulder.x - tileOrigin.x + shoulder.upX * surfaceBias,
          shoulder.y + shoulder.upY * surfaceBias,
          shoulder.z - tileOrigin.z + shoulder.upZ * surfaceBias
        ]);
        roadJoinRowCache.set(cacheKey, point);
        return point;
      }

      /**
       * Interpolate only between the same road rows used by createEdgeShellBuildJob(). Any extra tunnel station
       * therefore lies on the rendered road shoulder edge instead of sampling a subtly different curved chord.
       */
      function roadJoinAt(edgeS, side) {
        const scaledRow = clamp(edgeS / edge.length, 0, 1) * spec.roadRowCount;
        const lowerRow = Math.min(spec.roadRowCount, Math.floor(scaledRow));
        const upperRow = Math.min(spec.roadRowCount, lowerRow + 1);
        const blend = upperRow === lowerRow ? 0 : scaledRow - lowerRow;
        const lower = roadJoinAtRow(lowerRow, side);
        const upper = roadJoinAtRow(upperRow, side);
        return [
          lower[0] + (upper[0] - lower[0]) * blend,
          lower[1] + (upper[1] - lower[1]) * blend,
          lower[2] + (upper[2] - lower[2]) * blend
        ];
      }

      /** A cached row is the sole position authority for every panel meeting at this cross-section station. */
      function rowAt(edgeS) {
        if (rowCache.has(edgeS)) return rowCache.get(edgeS);
        const frame = sample(track, edge.id, edgeS, 0, {});
        const roadHalf = sampledRoadHalf(frame, edge);
        const crossSection = tunnelShellCrossSection(
          profile,
          roadHalf,
          clearance,
          undergroundWallInset,
          undergroundRoofInset,
          roadShoulderJoin,
          undergroundWallThickness
        );
        const rightLength = Math.max(
          0.000_001,
          Math.hypot(frame.rightX, frame.rightY, frame.rightZ)
        );
        const upLength = Math.max(0.000_001, Math.hypot(frame.upX, frame.upY, frame.upZ));
        const rightX = frame.rightX / rightLength;
        const rightY = frame.rightY / rightLength;
        const rightZ = frame.rightZ / rightLength;
        const upX = frame.upX / upLength;
        const upY = frame.upY / upLength;
        const upZ = frame.upZ / upLength;
        const points = crossSection.map(([lateral, vertical]) => ([
          frame.x - tileOrigin.x + rightX * lateral + upX * vertical,
          frame.y + rightY * lateral + upY * vertical,
          frame.z - tileOrigin.z + rightZ * lateral + upZ * vertical
        ]));
        if (profile.kind === 'underground-tunnel') {
          const join = inspectUndergroundTunnelRoadJoin(
            profile,
            roadHalf,
            undergroundWallInset,
            undergroundRoofInset,
            roadShoulderJoin,
            undergroundWallThickness
          );
          maximumRoadJoinGapM = Math.max(maximumRoadJoinGapM, join.roadJoinGapM);
          maximumRoadJoinPenetrationM = Math.max(
            maximumRoadJoinPenetrationM,
            join.roadJoinPenetrationM
          );
          maximumRoofWallGapM = Math.max(maximumRoofWallGapM, join.roofWallGapM);
          for (const [pointIndex, side] of [[0, -1], [3, 1]]) {
            const exactRoadJoin = roadJoinAt(edgeS, side);
            maximumRoadJoinAlignmentAdjustmentM = Math.max(
              maximumRoadJoinAlignmentAdjustmentM,
              Math.hypot(
                points[pointIndex][0] - exactRoadJoin[0],
                points[pointIndex][1] - exactRoadJoin[1],
                points[pointIndex][2] - exactRoadJoin[2]
              )
            );
            points[pointIndex] = exactRoadJoin;
            roadJoinSharedVertexCount++;
          }
          const wallInner = join.wallInner;
          const safeHalf = Math.max(0, roadHalf - 0.58);
          if (wallInner <= safeHalf + 0.000_1) safeCorridorViolationCount += 2;
        }
        const row = Object.freeze({
          edgeS,
          points: Object.freeze(points),
          staticTunnelIrradiance: sampleEdgeStaticTunnelIrradiance(
            [spec.staticIrradianceProfile],
            edgeS
          ),
          tunnelEnclosure: sampleTunnelEnclosure(profile, edgeS)
        });
        rowCache.set(edgeS, row);
        return row;
      }

      function chordError(a, b, midpoint) {
        let error = 0;
        for (let index = 0; index < midpoint.points.length; index++) {
          const midpointPoint = midpoint.points[index];
          const aPoint = a.points[index];
          const bPoint = b.points[index];
          error = Math.max(
            error,
            Math.hypot(
              midpointPoint[0] - (aPoint[0] + bPoint[0]) * 0.5,
              midpointPoint[1] - (aPoint[1] + bPoint[1]) * 0.5,
              midpointPoint[2] - (aPoint[2] + bPoint[2]) * 0.5
            )
          );
        }
        return error;
      }

      const refinedStations = [spec.shellStations[0]];
      const refinedRows = [rowAt(spec.shellStations[0])];

      /**
       * The two-metre station cap normally satisfies the curvature tolerance; recursive bisection is a strict
       * fallback for sharper or vertically transitioning authored profiles.
       */
      function* appendRefinedRange(startS, endS, depth = 0) {
        const startRow = rowAt(startS);
        const endRow = rowAt(endS);
        const midpointS = (startS + endS) * 0.5;
        const midpointRow = rowAt(midpointS);
        const error = chordError(startRow, endRow, midpointRow);
        yield 'tunnel-shell-refine';
        if (error > TUNNEL_SHELL_MAXIMUM_CHORD_ERROR_M && depth < 16) {
          yield* appendRefinedRange(startS, midpointS, depth + 1);
          yield* appendRefinedRange(midpointS, endS, depth + 1);
          return;
        }
        if (error > TUNNEL_SHELL_MAXIMUM_CHORD_ERROR_M) {
          throw new Error(
            `Tunnel shell chord error ${error} exceeds the ${TUNNEL_SHELL_MAXIMUM_CHORD_ERROR_M} m contract`
          );
        }
        refinedStations.push(endS);
        refinedRows.push(endRow);
        maximumSegmentLengthM = Math.max(maximumSegmentLengthM, endS - startS);
        maximumChordErrorM = Math.max(maximumChordErrorM, error);
      }

      for (let index = 0; index < spec.shellStations.length - 1; index++) {
        yield* appendRefinedRange(spec.shellStations[index], spec.shellStations[index + 1]);
      }

      for (let index = 1; index < spec.ribStations.length - 1; index++) {
        maximumRibAlignmentErrorM = Math.max(
          maximumRibAlignmentErrorM,
          nearestStationError(spec.ribStations[index], refinedStations)
        );
        yield 'tunnel-shell-alignment';
      }
      maximumPortalAlignmentErrorM = Math.max(
        maximumPortalAlignmentErrorM,
        nearestStationError(spec.ribStations[0], refinedStations),
        nearestStationError(spec.ribStations[spec.ribStations.length - 1], refinedStations)
      );

      const ringVertexCount = refinedRows[0]?.points.length || 0;
      const vertexOffset = positions.length / 3;
      const color = profile.kind === 'mountain-tunnel' ? mountainColor : undergroundColor;
      for (const row of refinedRows) {
        for (let pointIndex = 0; pointIndex < row.points.length; pointIndex++) {
          const point = row.points[pointIndex];
          positions.push(point[0], point[1], point[2]);
          // A bounded two-frequency patina breaks the old flat shell without moving one clearance-owned vertex.
          const broadPatina = 0.955 + Math.sin(row.edgeS * 0.071 + pointIndex * 1.618) * 0.025;
          const finePatina = 0.985 + Math.sin(row.edgeS * 0.337 - pointIndex * 2.231) * 0.015;
          const patina = broadPatina * finePatina;
          colors.push(color.r * patina, color.g * patina, color.b * patina);
          const receiverIrradiance = row.staticTunnelIrradiance
            * tunnelShellReceiverGain(profile, pointIndex);
          staticTunnelIrradiance.push(receiverIrradiance);
          const interior = profile.kind === 'mountain-tunnel' ? pointIndex <= 1 : pointIndex <= 3;
          tunnelEnclosure.push(interior ? row.tunnelEnclosure : 0);
          if (receiverIrradiance > 0) {
            staticIrradiancePositiveVertexCount++;
            staticIrradianceMinimumReceiver = Math.min(
              staticIrradianceMinimumReceiver,
              receiverIrradiance
            );
            staticIrradianceMaximum = Math.max(staticIrradianceMaximum, receiverIrradiance);
          }
        }
        yield 'tunnel-shell-vertices';
      }
      for (let stationIndex = 0; stationIndex < refinedRows.length - 1; stationIndex++) {
        const rowStart = vertexOffset + stationIndex * ringVertexCount;
        const nextRowStart = rowStart + ringVertexCount;
        for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex++) {
          const nextRingIndex = (ringIndex + 1) % ringVertexCount;
          const a = rowStart + ringIndex;
          const b = rowStart + nextRingIndex;
          const nextA = nextRowStart + ringIndex;
          const nextB = nextRowStart + nextRingIndex;
          indices.push(a, nextA, b, b, nextA, nextB);
        }
        yield 'tunnel-shell-indices';
      }
      const profileSegmentCount = Math.max(0, refinedRows.length - 1);
      stationCount += refinedRows.length;
      longitudinalSegmentCount += profileSegmentCount;
      panelCount += profileSegmentCount * ringVertexCount;
      roofPanelCount += profileSegmentCount;
      if (profile.kind === 'underground-tunnel') undergroundWallPanelCount += profileSegmentCount * 2;
    }

    const geometry = own(new THREE.BufferGeometry());
    const IndexArray = positions.length / 3 > 65_535 ? Uint32Array : Uint16Array;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    yield 'tunnel-shell-attributes';
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    yield 'tunnel-shell-attributes';
    geometry.setAttribute(
      STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute,
      new THREE.Float32BufferAttribute(staticTunnelIrradiance, 1)
    );
    yield 'tunnel-shell-attributes';
    geometry.setAttribute(
      TUNNEL_ENCLOSURE_CONTRACT.attribute,
      new THREE.Float32BufferAttribute(tunnelEnclosure, 1)
    );
    geometry.userData.tunnelEnclosureContractVersion = TUNNEL_ENCLOSURE_CONTRACT.version;
    yield 'tunnel-shell-attributes';
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));
    yield 'tunnel-shell-attributes';
    yield* finalizeTunnelShellGeometry(THREE, geometry);
    markSkyRouteGeometry(
      geometry,
      'continuous-wind-eroded-tunnel-shell',
      SKY_ROUTE_SCENERY_CONTRACT.geometry.tunnelShell.topology
    );
    const diagnostics = Object.freeze({
      maximumSegmentLengthM,
      maximumChordErrorM,
      maximumRibAlignmentErrorM,
      maximumPortalAlignmentErrorM,
      stationCount,
      longitudinalSegmentCount,
      panelCount,
      roofPanelCount,
      undergroundWallPanelCount,
      safeCorridorViolationCount,
      roadJoinSharedVertexCount,
      maximumRoadJoinGapM,
      maximumRoadJoinPenetrationM,
      maximumRoadJoinAlignmentAdjustmentM,
      maximumRoofWallGapM,
      sharedLongitudinalRows: true,
      staticIrradianceContractVersion: STATIC_TUNNEL_IRRADIANCE_CONTRACT.version,
      staticIrradianceDistanceGated: STATIC_TUNNEL_IRRADIANCE_CONTRACT.distanceGated,
      staticIrradiancePositiveVertexCount,
      staticIrradianceMinimumReceiver: Number.isFinite(staticIrradianceMinimumReceiver)
        ? staticIrradianceMinimumReceiver
        : 0,
      staticIrradianceMaximum
    });
    geometry.userData.tunnelShellDiagnostics = diagnostics;
    Object.assign(geometry.userData, {
      staticTunnelIrradianceContractVersion: STATIC_TUNNEL_IRRADIANCE_CONTRACT.version,
      staticTunnelIrradianceDistanceGated: STATIC_TUNNEL_IRRADIANCE_CONTRACT.distanceGated,
      staticTunnelIrradiancePositiveVertexCount: staticIrradiancePositiveVertexCount,
      staticTunnelIrradianceMinimumReceiver: Number.isFinite(staticIrradianceMinimumReceiver)
        ? staticIrradianceMinimumReceiver
        : 0,
      staticTunnelIrradianceMaximum: staticIrradianceMaximum,
      staticTunnelIrradianceAdditionalDrawGroupCount:
        STATIC_TUNNEL_IRRADIANCE_CONTRACT.additionalDrawGroupCount,
      staticTunnelIrradianceAdditionalObjectCount:
        STATIC_TUNNEL_IRRADIANCE_CONTRACT.additionalObjectCount
    });
    yield 'tunnel-shell-finalize';
    return Object.freeze({ geometry, diagnostics });
  }

  /**
   * Pending assembly owns only its new resources, never the caller's prepared/shared template. A cancelled or
   * failed generator releases them; successful publication transfers ownership to the existing visual.dispose().
   */
  function* createResourceOwnedGenerator(build) {
    const pendingResources = new Set();
    const own = (resource) => {
      pendingResources.add(resource);
      return resource;
    };
    try {
      const result = yield* build(own);
      pendingResources.clear();
      return result;
    } finally {
      for (const resource of pendingResources) resource.dispose();
      pendingResources.clear();
    }
  }

  /** Synchronous compatibility for the geometry audit; gameplay uses the same generator through budgeted steps. */
  function createContinuousTunnelShellGeometry(...args) {
    const generator = createResourceOwnedGenerator((own) => (
      createContinuousTunnelShellGeometrySteps(...args, own)
    ));
    let result = generator.next();
    while (!result.done) result = generator.next();
    return result.value;
  }

  /**
   * Match bundled Three r160's indexed normal and sphere algorithms, but return between bounded buffer ranges.
   * Each triangle writes back to Float32 in index order: accumulating in doubles would change the rendered normals.
   */
  function* finalizeTunnelShellGeometry(THREE, geometry) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const normal = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute('normal', normal);
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const pC = new THREE.Vector3();
    const nA = new THREE.Vector3();
    const nB = new THREE.Vector3();
    const nC = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const triangleChunk = 256 * 3;
    for (let start = 0; start < index.count; start += triangleChunk) {
      const end = Math.min(index.count, start + triangleChunk);
      for (let offset = start; offset < end; offset += 3) {
        const a = index.getX(offset);
        const b = index.getX(offset + 1);
        const c = index.getX(offset + 2);
        pA.fromBufferAttribute(position, a);
        pB.fromBufferAttribute(position, b);
        pC.fromBufferAttribute(position, c);
        cb.subVectors(pC, pB);
        ab.subVectors(pA, pB);
        cb.cross(ab);
        nA.fromBufferAttribute(normal, a).add(cb);
        nB.fromBufferAttribute(normal, b).add(cb);
        nC.fromBufferAttribute(normal, c).add(cb);
        normal.setXYZ(a, nA.x, nA.y, nA.z);
        normal.setXYZ(b, nB.x, nB.y, nB.z);
        normal.setXYZ(c, nC.x, nC.y, nC.z);
      }
      yield 'tunnel-shell-normals';
    }
    const vertexChunk = 512;
    for (let start = 0; start < position.count; start += vertexChunk) {
      const end = Math.min(position.count, start + vertexChunk);
      for (let vertex = start; vertex < end; vertex++) {
        nA.fromBufferAttribute(normal, vertex).normalize();
        normal.setXYZ(vertex, nA.x, nA.y, nA.z);
      }
      yield 'tunnel-shell-normalize';
    }
    normal.needsUpdate = true;
    const box = new THREE.Box3();
    for (let start = 0; start < position.count; start += vertexChunk) {
      const end = Math.min(position.count, start + vertexChunk);
      for (let vertex = start; vertex < end; vertex++) {
        box.expandByPoint(pA.fromBufferAttribute(position, vertex));
      }
      yield 'tunnel-shell-bounds';
    }
    const sphere = new THREE.Sphere();
    box.getCenter(sphere.center);
    let maximumRadiusSquared = 0;
    for (let start = 0; start < position.count; start += vertexChunk) {
      const end = Math.min(position.count, start + vertexChunk);
      for (let vertex = start; vertex < end; vertex++) {
        pA.fromBufferAttribute(position, vertex);
        maximumRadiusSquared = Math.max(maximumRadiusSquared, sphere.center.distanceToSquared(pA));
      }
      yield 'tunnel-shell-radius';
    }
    sphere.radius = Math.sqrt(maximumRadiusSquared);
    geometry.boundingSphere = sphere;
  }

  /**
   * Build the exact production tunnel BufferGeometry without allocating a scene, materials, or light fixtures.
   * Tests consume this hook to inspect real vertices rather than treating source-shape regexes as geometry proof.
   */
  function createTunnelShellGeometryAudit(options) {
    const { THREE, track } = options || {};
    if (!THREE || !track?.graph || typeof track.sampleEdge !== 'function') {
      throw new Error('Tunnel shell geometry audit requires THREE and the NeonV23Track graph sampler');
    }
    const mobile = options.qualityProfile?.id === 'mobile';
    const sampleStep = mobile ? 5 : 2.5;
    const tunnelRibSpacing = mobile ? 84 : 44;
    const contract = track.graph.contract || {};
    const roadShoulderJoin = Number(contract.roadShellShoulderJoin) || 0.22;
    const undergroundWallThickness = Number(contract.undergroundTunnelWallThickness) || 0.54;
    const undergroundWallInset = Number(contract.undergroundTunnelWallInset) || 0.49;
    const undergroundRoofInset = Number(contract.undergroundTunnelRoofInset) || 0.84;
    const specs = createTunnelProfileSpecs(
      track,
      options.edges || edgeList(track),
      sampleStep,
      tunnelRibSpacing
    );
    return createContinuousTunnelShellGeometry(
      THREE,
      track,
      specs,
      options.tileOrigin || track.graph.origin || { x: 0, z: 0 },
      undergroundWallInset,
      undergroundRoofInset,
      roadShoulderJoin,
      undergroundWallThickness
    );
  }

  function directionLabel(port) {
    const direction = ({ north: 'n', east: 'e', south: 's', west: 'w' })[port];
    const fallback = ({ north: '北', east: '东', south: '南', west: '西' })[port] || '出口';
    const i18n = window.NeonV23I18n;
    return direction && typeof i18n?.t === 'function'
      ? i18n.t(`direction.${direction}`, {}, { fallback })
      : fallback;
  }

  /** Road-sign text is derived from language-neutral route metadata every time its shared atlas changes. */
  function localizedExitSignSpecs(specs) {
    const i18n = window.NeonV23I18n;
    return specs.map((spec) => {
      const distanceValue = typeof i18n?.formatNumber === 'function'
        ? i18n.formatNumber(spec.distanceM)
        : String(spec.distanceM);
      const distance = typeof i18n?.t === 'function'
        ? i18n.t('common.meters', { value: distanceValue }, { fallback: `${distanceValue} 米` })
        : `${distanceValue} 米`;
      return {
        ...spec,
        text: `${spec.exitNumber} ${directionLabel(spec.exitPort)} ${distance}`
      };
    });
  }

  const sharedExitSignAtlases = new Map();

  /** Draw one restrained four-ray candle-star; the glyph frames text but never replaces its route semantics. */
  function drawExitSignCandleStar(context, centerX, centerY, outerRadius, innerRadius) {
    context.beginPath();
    for (let point = 0; point < 8; point++) {
      const angle = -Math.PI * 0.5 + point / 8 * Math.PI * 2;
      const radius = point % 2 === 0 ? outerRadius : innerRadius;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    context.stroke();
  }

  /** Font rasterization is topology-invariant and expensive; one ref-counted atlas serves every translated tile. */
  function acquireExitSignAtlas(THREE, specs, columns, rows, cellWidth, cellHeight) {
    const key = `${SKY_ROUTE_WAYFINDING_ART_CONTRACT.version}:${columns}x${rows}:${specs.map((spec) => spec.text).join('|')}`;
    let atlas = sharedExitSignAtlases.get(key);
    const cacheHit = Boolean(atlas);
    if (!atlas) {
      const canvas = document.createElement('canvas');
      canvas.width = columns * cellWidth;
      canvas.height = rows * cellHeight;
      const context = canvas.getContext('2d');
      for (let index = 0; index < specs.length; index++) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = column * cellWidth;
        const y = row * cellHeight;
        context.fillStyle = '#4b3d2b';
        context.fillRect(x, y, cellWidth, cellHeight);
        // Flat layered bands suggest a woven scroll without gradients that could blur localized glyphs.
        context.fillStyle = '#b89a64';
        context.fillRect(x + 10, y + 24, 22, cellHeight - 48);
        context.fillRect(x + cellWidth - 32, y + 24, 22, cellHeight - 48);
        context.fillStyle = '#ead8a7';
        context.fillRect(x + 24, y + 16, cellWidth - 48, cellHeight - 32);
        context.fillStyle = '#dcc58f';
        for (let weaveY = y + 30; weaveY < y + cellHeight - 24; weaveY += 16) {
          context.fillRect(x + 32, weaveY, cellWidth - 64, 2);
        }
        context.strokeStyle = '#6d593b';
        context.lineWidth = 5;
        context.strokeRect(x + 24, y + 16, cellWidth - 48, cellHeight - 32);
        context.fillStyle = '#c69743';
        context.strokeStyle = '#6d593b';
        context.lineWidth = 3;
        drawExitSignCandleStar(context, x + 52, y + cellHeight * 0.5, 20, 7);
        drawExitSignCandleStar(context, x + cellWidth - 52, y + cellHeight * 0.5, 20, 7);
        context.fillStyle = '#2e2a21';
        context.font = '700 54px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(specs[index].text, x + cellWidth * 0.5, y + cellHeight * 0.52);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      atlas = {
        key,
        refs: 0,
        texture,
        material: new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      };
      atlas.material.userData.neonV23SkyWayfindingArt = Object.freeze({
        contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
        role: 'woven-scroll-exit-sign-atlas',
        style: SKY_ROUTE_WAYFINDING_ART_CONTRACT.exitSign.style,
        textAuthority: SKY_ROUTE_WAYFINDING_ART_CONTRACT.exitSign.textAuthority
      });
      sharedExitSignAtlases.set(key, atlas);
    }
    atlas.refs++;
    return { atlas, cacheHit };
  }

  function releaseExitSignAtlas(atlas) {
    if (!atlas || atlas.refs <= 0) return;
    atlas.refs--;
    if (atlas.refs > 0) return;
    atlas.material.dispose();
    atlas.texture.dispose();
    sharedExitSignAtlases.delete(atlas.key);
  }

  /** One texture atlas and one two-sided plane batch replace eight independent exit-sign draw calls. */
  function createExitSignBatch(THREE, specs, tileOrigin, onPresentationTexturesChanged = null) {
    const columns = Math.min(2, Math.max(1, specs.length));
    const rows = Math.max(1, Math.ceil(specs.length / columns));
    const cellWidth = 512;
    const cellHeight = 176;
    let { atlas: activeAtlas, cacheHit } = acquireExitSignAtlas(
      THREE,
      localizedExitSignSpecs(specs),
      columns,
      rows,
      cellWidth,
      cellHeight
    );
    const positions = new Float32Array(specs.length * 4 * 3);
    const uvs = new Float32Array(specs.length * 4 * 2);
    const IndexArray = specs.length * 4 > 65_535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(specs.length * 6);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const center = new THREE.Vector3();
    for (let index = 0; index < specs.length; index++) {
      const { frame } = specs[index];
      const column = index % columns;
      const row = Math.floor(index / columns);

      right.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
      up.set(frame.upX, frame.upY, frame.upZ).normalize();
      center.set(
        frame.x - tileOrigin.x + right.x * 3.2 + up.x * 3.4,
        frame.y + right.y * 3.2 + up.y * 3.4,
        frame.z - tileOrigin.z + right.z * 3.2 + up.z * 3.4
      );
      const halfWidth = 2.9;
      const halfHeight = 1;
      const corners = [
        [-halfWidth, -halfHeight],
        [halfWidth, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight]
      ];
      for (let corner = 0; corner < 4; corner++) {
        const [horizontal, vertical] = corners[corner];
        const positionOffset = (index * 4 + corner) * 3;
        positions[positionOffset] = center.x + right.x * horizontal + up.x * vertical;
        positions[positionOffset + 1] = center.y + right.y * horizontal + up.y * vertical;
        positions[positionOffset + 2] = center.z + right.z * horizontal + up.z * vertical;
      }
      const u0 = column / columns;
      const u1 = (column + 1) / columns;
      const v1 = 1 - row / rows;
      const v0 = 1 - (row + 1) / rows;
      uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], index * 8);
      indices.set([
        index * 4,
        index * 4 + 1,
        index * 4 + 2,
        index * 4,
        index * 4 + 2,
        index * 4 + 3
      ], index * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, activeAtlas.material);
    mesh.name = 'cloverleaf-exit-sign-atlas';
    mesh.userData.atlasCacheHit = cacheHit;
    mesh.userData.atlasLanguage = window.NeonV23I18n?.language || 'zh-CN';
    mesh.userData.neonV23SkyWayfindingArt = Object.freeze({
      contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
      role: 'woven-scroll-exit-sign-batch',
      style: SKY_ROUTE_WAYFINDING_ART_CONTRACT.exitSign.style,
      languageSwitch: SKY_ROUTE_WAYFINDING_ART_CONTRACT.exitSign.languageSwitch
    });
    let unsubscribeLanguage = null;
    let released = false;
    let texturePublicationListener = onPresentationTexturesChanged;
    const syncLanguage = () => {
      if (released) return false;
      const next = acquireExitSignAtlas(
        THREE,
        localizedExitSignSpecs(specs),
        columns,
        rows,
        cellWidth,
        cellHeight
      );
      if (next.atlas === activeAtlas) {
        releaseExitSignAtlas(next.atlas);
        return false;
      }
      const previousAtlas = activeAtlas;
      activeAtlas = next.atlas;
      mesh.material = activeAtlas.material;
      mesh.userData.atlasCacheHit = next.cacheHit;
      mesh.userData.atlasLanguage = window.NeonV23I18n?.language || 'zh-CN';
      releaseExitSignAtlas(previousAtlas);
      // An identity swap can keep renderer.info.memory.textures unchanged. Notify only after the new atlas
      // has been installed and the previous lease released; the pool rejects callbacks from unregistered visuals.
      texturePublicationListener?.();
      return true;
    };
    if (typeof window.NeonV23I18n?.subscribe === 'function') {
      unsubscribeLanguage = window.NeonV23I18n.subscribe(syncLanguage);
    }
    mesh.userData.syncLanguage = syncLanguage;
    mesh.userData.releaseAtlas = () => {
      if (released) return false;
      released = true;
      texturePublicationListener = null;
      unsubscribeLanguage?.();
      unsubscribeLanguage = null;
      releaseExitSignAtlas(activeAtlas);
      activeAtlas = null;
      return true;
    };
    return mesh;
  }

  /** Create cached network meshes and lightweight decorative traffic for one deterministic graph template. */
  function* createGenerator(options) {
    return yield* createResourceOwnedGenerator((own) => createOwnedVisualGenerator(options, own));
  }

  /** Assemble privately; only a complete visual may enter the scene or own the prepared geometry template. */
  function* createOwnedVisualGenerator(options, own) {
    const {
      THREE,
      track,
      modeling,
      scene,
      qualityProfile,
      markMainVisual,
      markEffect
    } = options;
    if (!THREE || !track?.graph || typeof track.sampleEdge !== 'function') {
      throw new Error('Cloverleaf visuals require THREE and the NeonV23Track graph sampler');
    }
    const trafficTileToken = track.graph?.tile?.token || track.graph?.version || 'template';
    // The rig is constructed before the road pool. Standalone embedders retain the outdoor identity fallback.
    const tunnelLightingUniforms = scene.userData?.neonV23TunnelLightingUniforms || {
      neonV23GlobalAmbientTransmission: { value: 1 },
      neonV23GlobalEnvironmentTransmission: { value: 1 },
      neonV23GlobalDirectionalTransmission: { value: 1 }
    };

    const group = new THREE.Group();
    own({ dispose: () => scene.remove(group) });
    group.name = 'v23-full-cloverleaf-network';
    let activeRenderQualityId = options.renderQualityId === 'high'
      ? 'high'
      : options.renderQualityId === 'low' ? 'low' : 'medium';
    // Asphalt is a dielectric. Weather changes its clear coat and microsurface, never metallic or emissive energy.
    const roadMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      clearcoat: 0,
      clearcoatRoughness: 0.52,
      ior: 1.48,
      envMapIntensity: 0.28,
      side: THREE.FrontSide
    });
    own(roadMaterial);
    const lowRoadMaterial = roadMaterial.clone();
    own(lowRoadMaterial);
    lowRoadMaterial.userData.neonV23SurfaceDetail = 'low-physical-without-coordinate-shader';
    installLowRoadShader(THREE, lowRoadMaterial, tunnelLightingUniforms);
    installStandardRoadShader(THREE, roadMaterial, tunnelLightingUniforms);
    const ultraRoadTextureSet = createProceduralRoadTextureSet(THREE);
    own(ultraRoadTextureSet.normal);
    own(ultraRoadTextureSet.roughness);
    const ultraRoadMaterial = roadMaterial.clone();
    own(ultraRoadMaterial);
    ultraRoadMaterial.normalMap = ultraRoadTextureSet.normal;
    ultraRoadMaterial.normalScale.set(0.085, 0.085);
    ultraRoadMaterial.roughnessMap = ultraRoadTextureSet.roughness;
    ultraRoadMaterial.roughness = 0.82;
    ultraRoadMaterial.clearcoat = 0.025;
    ultraRoadMaterial.clearcoatRoughness = 0.48;
    ultraRoadMaterial.envMapIntensity = 0.48;
    ultraRoadMaterial.userData.neonV23UltraSurface = 'road';
    installUltraRoadShader(THREE, ultraRoadMaterial, tunnelLightingUniforms);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xff_ffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.84
    });
    own(edgeMaterial);
    const selectedMaterial = new THREE.LineBasicMaterial({
      color: 0xff_f4c9,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    own(selectedMaterial);
    const proposedMaterial = new THREE.LineDashedMaterial({
      color: 0xe7_bf58,
      dashSize: 6,
      gapSize: 4,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    });
    own(proposedMaterial);
    // A caller may prepare this immutable geometry off the gameplay frame through createBuildJob.
    const preparedTemplate = options.preparedGeometryTemplate || buildGeometryTemplateSynchronously(options);
    if (!options.preparedGeometryTemplate) {
      own({ dispose: () => disposeGeometryTemplate(preparedTemplate) });
    }
    const sampleStep = preparedTemplate.sampleStep;
    const edges = preparedTemplate.edges;
    const tileOrigin = preparedTemplate.tileOrigin;
    const routeLinePositionsByEdge = preparedTemplate.routeLinePositionsByEdge;
    // Standard-tile quality gates exclude route-owned recovery and fork additions from the immutable interchange.
    const standardTileMetrics = preparedTemplate.baseTemplate?.metrics || preparedTemplate.metrics;
    const edgeVisuals = new Map();
    const dynamicRoadWidthSamples = preparedTemplate.metrics.dynamicRoadWidthSamples;
    const roadShellWidthError = preparedTemplate.metrics.roadShellWidthError;
    const bridgeDeckThicknessError = preparedTemplate.metrics.bridgeDeckThicknessError;
    const junctionBiasSamples = preparedTemplate.metrics.junctionBiasSamples;
    const trimmedBarrierSampleCount = preparedTemplate.metrics.trimmedBarrierSampleCount;
    const retainedJunctionBoundaryCount = preparedTemplate.metrics.retainedJunctionBoundaryCount;
    const suppressedConnectedCapCount = preparedTemplate.metrics.suppressedConnectedCapCount;
    const recessedTopologySealCount = preparedTemplate.metrics.recessedTopologySealCount;
    const junctionApronCandidateCount = preparedTemplate.metrics.junctionApronCandidateCount;
    const junctionApronCount = preparedTemplate.metrics.junctionApronCount;
    const junctionApronCoverageMissCount = preparedTemplate.metrics.junctionApronCoverageMissCount;
    const junctionApronTopologyFailureCount = preparedTemplate.metrics.junctionApronTopologyFailureCount;
    const junctionApronMaximumSpanM = preparedTemplate.metrics.junctionApronMaximumSpanM;
    const junctionApronSurfaceLiftM = preparedTemplate.metrics.junctionApronSurfaceLiftM;
    const junctionLongPairCount = preparedTemplate.metrics.junctionLongPairCount;
    const junctionLensCount = preparedTemplate.metrics.junctionLensCount;
    const junctionLensResidualOverlapCount = preparedTemplate.metrics.junctionLensResidualOverlapCount;
    const junctionLensMaximumRunM = preparedTemplate.metrics.junctionLensMaximumRunM;
    const junctionLensMaximumCrossWidthM = preparedTemplate.metrics.junctionLensMaximumCrossWidthM;
    const junctionLensClearanceToleranceM = preparedTemplate.metrics.junctionLensClearanceToleranceM;
    const junctionLensCoverageStationCount = preparedTemplate.metrics.junctionLensCoverageStationCount;
    const junctionLensUncoveredStationCount = preparedTemplate.metrics.junctionLensUncoveredStationCount;
    const junctionLensApronContinuityFailureCount =
      preparedTemplate.metrics.junctionLensApronContinuityFailureCount;
    const junctionLensClearanceFailureCount = preparedTemplate.metrics.junctionLensClearanceFailureCount;
    const junctionLensMaximumEndClearanceErrorM =
      preparedTemplate.metrics.junctionLensMaximumEndClearanceErrorM;
    const junctionVerticallySeparatedPairCount =
      preparedTemplate.metrics.junctionVerticallySeparatedPairCount;
    const junctionVerticalSeparationStationCount =
      preparedTemplate.metrics.junctionVerticalSeparationStationCount;
    const junctionVerticalSeparationFailureCount =
      preparedTemplate.metrics.junctionVerticalSeparationFailureCount;
    const junctionMinimumVerticalShellGapM = preparedTemplate.metrics.junctionMinimumVerticalShellGapM;
    const junctionLensTopologyFailureCount = preparedTemplate.metrics.junctionLensTopologyFailureCount;

    const roadShell = new THREE.Mesh(preparedTemplate.roadShellGeometry, roadMaterial);
    roadShell.name = 'cloverleaf-road-shell-batch';
    roadShell.castShadow = true;
    roadShell.receiveShadow = true;
    // The shared base buffer is immutable after publication; debug topology may safely reuse its first exact report.
    roadShell.geometry.userData.neonV23ImmutableTopology = true;
    const sharedRoadVisualContract = roadShell.geometry.userData.neonV23SharedMainVisualContract;
    if (sharedRoadVisualContract) {
      roadShell.userData.modelRole = sharedRoadVisualContract.modelRole;
      roadShell.userData.modelLabel = sharedRoadVisualContract.modelLabel;
      roadShell.userData.neonV23 = sharedRoadVisualContract.neonV23;
      roadShell.userData.topology = sharedRoadVisualContract.topology;
    } else if (markMainVisual) {
      markMainVisual(roadShell, 'cloverleaf-road-shell-batch');
      // The callback's only durable contract is mesh metadata; cache it beside the immutable shared buffer.
      roadShell.geometry.userData.neonV23SharedMainVisualContract = Object.freeze({
        modelRole: roadShell.userData.modelRole,
        modelLabel: roadShell.userData.modelLabel,
        neonV23: roadShell.userData.neonV23,
        topology: roadShell.userData.topology
      });
    }
    group.add(roadShell);
    const recoveryRoadShell = new THREE.Mesh(preparedTemplate.recoveryTemplate.roadShellGeometry, roadMaterial);
    recoveryRoadShell.name = 'cloverleaf-recovery-road-shell-batch';
    recoveryRoadShell.castShadow = true;
    recoveryRoadShell.receiveShadow = true;
    recoveryRoadShell.visible = preparedTemplate.recoveryTemplate.edges.length > 0;
    // Recovery ribbons omit connected endpoint caps, so the merged corridor has no internal cross-section wall.
    if (markEffect) markEffect(recoveryRoadShell, 'cloverleaf-recovery-road-shell-batch');
    group.add(recoveryRoadShell);
    for (const edge of edges) {
      edgeVisuals.set(edge.id, { shell: roadShell, lines: [], selected: null, proposed: null, edge });
    }
    yield 'road-shells';

    /** Explicitly document why a transparent visual is excluded from the physical shadow pass. */
    const markShadowExempt = (visual, reason) => {
      visual.castShadow = false;
      visual.receiveShadow = false;
      visual.userData.shadowExemptReason = reason;
      const materials = Array.isArray(visual.material) ? visual.material : [visual.material];
      for (const material of materials) {
        if (material?.userData) material.userData.shadowExemptReason = reason;
      }
      return visual;
    };

    const createStaticLineBatch = (name, sourceGeometry, label) => {
      const lines = new THREE.LineSegments(sourceGeometry, edgeMaterial);
      lines.name = name;
      markShadowExempt(lines, 'Transparent road markings are light overlays without physical thickness.');
      if (markEffect) markEffect(lines, label);
      group.add(lines);
      return lines;
    };
    const staticGeneralLines = createStaticLineBatch(
      'cloverleaf-static-road-lines',
      preparedTemplate.staticLineGeometry,
      'cloverleaf-static-road-lines'
    );
    // Recovery markings are route-owned but remain one batch, so switching a prepared variant is atomic.
    const recoveryStaticLines = createStaticLineBatch(
      'cloverleaf-recovery-road-lines',
      preparedTemplate.recoveryTemplate.staticLineGeometry,
      'cloverleaf-recovery-road-lines'
    );
    recoveryStaticLines.visible = preparedTemplate.recoveryTemplate.edges.length > 0;
    const ultraMarkingMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd2_d0c9,
      vertexColors: true,
      roughness: 0.68,
      metalness: 0,
      clearcoat: 0.03,
      clearcoatRoughness: 0.50,
      envMapIntensity: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    own(ultraMarkingMaterial);
    const ultraStaticMarkings = new THREE.Mesh(
      createRoadMarkingRibbonGeometry(THREE, preparedTemplate.staticLineGeometry),
      ultraMarkingMaterial
    );
    own(ultraStaticMarkings.geometry);
    ultraStaticMarkings.name = 'cloverleaf-ultra-static-road-markings';
    ultraStaticMarkings.castShadow = false;
    ultraStaticMarkings.receiveShadow = true;
    ultraStaticMarkings.visible = false;
    ultraStaticMarkings.userData.presentationOnly = true;
    group.add(ultraStaticMarkings);
    const ultraRecoveryMarkings = new THREE.Mesh(
      createRoadMarkingRibbonGeometry(THREE, preparedTemplate.recoveryTemplate.staticLineGeometry),
      ultraMarkingMaterial
    );
    own(ultraRecoveryMarkings.geometry);
    ultraRecoveryMarkings.name = 'cloverleaf-ultra-recovery-road-markings';
    ultraRecoveryMarkings.castShadow = false;
    ultraRecoveryMarkings.receiveShadow = true;
    ultraRecoveryMarkings.visible = false;
    ultraRecoveryMarkings.userData.presentationOnly = true;
    group.add(ultraRecoveryMarkings);
    const staticRampRails = staticGeneralLines;
    // The tile pool and visual must share the complete key: returning to the opening exit has to reactivate
    // its original recovery and complementary carriageways instead of retaining the last alternate layout.
    const initialRecoverySignature = track.graph?.recoveryVariantSignature || `${
      track.graph?.tile?.token || 'tile'
    }|${(track.graph?.recoveryEdgeIds || []).join('|')}|visual:${(
      track.graph?.bidirectionalVisualEdgeIds || []
    ).join('|')}`;
    preparedTemplate.recoveryTemplate.variantTrack = track;
    const recoveryVariants = new Map([[initialRecoverySignature, preparedTemplate.recoveryTemplate]]);
    const ultraRecoveryMarkingGeometries = new Map([
      [initialRecoverySignature, ultraRecoveryMarkings.geometry]
    ]);
    let activeRecoverySignature = initialRecoverySignature;
    let activeRecoveryTemplate = preparedTemplate.recoveryTemplate;
    yield 'static-lines';

    const decorativeLaneGeometry = preparedTemplate.decorativeLaneGeometry;
    const decorativeLaneMaterial = new THREE.LineBasicMaterial({
      color: 0xf2_d889,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    own(decorativeLaneMaterial);
    const decorativeLaneGuides = new THREE.LineSegments(decorativeLaneGeometry, decorativeLaneMaterial);
    decorativeLaneGuides.name = 'cloverleaf-braided-gate-lanes';
    markShadowExempt(decorativeLaneGuides, 'Transparent lane guidance has no opaque shadow silhouette.');
    if (markEffect) markEffect(decorativeLaneGuides, 'cloverleaf-braided-gate-lanes');
    group.add(decorativeLaneGuides);

    // Selected and proposed paths are rebuilt only when their edge-id hash changes, so each remains one draw call.
    const selectedRoute = new THREE.LineSegments(geometryFromLinePositions(THREE, []), selectedMaterial);
    own(selectedRoute.geometry);
    selectedRoute.name = 'cloverleaf-selected-route-batch';
    selectedRoute.visible = false;
    markShadowExempt(selectedRoute, 'Selected-route glow is a transparent navigation overlay.');
    if (markEffect) markEffect(selectedRoute, 'cloverleaf-selected-route');
    group.add(selectedRoute);
    const proposedRoute = new THREE.LineSegments(geometryFromLinePositions(THREE, []), proposedMaterial);
    own(proposedRoute.geometry);
    proposedRoute.name = 'cloverleaf-proposed-route-batch';
    proposedRoute.visible = false;
    markShadowExempt(proposedRoute, 'Proposed-route dashes are a transparent navigation overlay.');
    if (markEffect) markEffect(proposedRoute, 'cloverleaf-proposed-route');
    group.add(proposedRoute);
    for (const visual of edgeVisuals.values()) {
      visual.selected = selectedRoute;
      visual.proposed = proposedRoute;
    }
    yield 'route-batches';

    const supportMaterial = markSkyRouteMaterial(new THREE.MeshStandardMaterial({
      color: 0x8d_7259,
      emissive: 0x00_0000,
      emissiveIntensity: 0,
      roughness: 0.94,
      metalness: 0.01,
      envMapIntensity: 0.24
    }), 'wind-eroded-pier-standard');
    own(supportMaterial);
    const bridgeContract = track.graph?.contract || {};
    const deckThickness = Number(bridgeContract.deckThickness) || 0.92;
    const pierRadius = Number(bridgeContract.bridgePierRadius) || 0.62;
    const supportRadius = Number(bridgeContract.bridgeSupportRadius) || pierRadius;
    const supportFootingWidth = BRIDGE_SUPPORT_FOOTING_WIDTH;
    const supportFootingDepth = BRIDGE_SUPPORT_FOOTING_DEPTH;
    const supportClearanceRadius = Math.max(
      supportRadius,
      BRIDGE_SUPPORT_FOOTING_CLEARANCE_RADIUS
    );
    const supportRoadGap = Number(bridgeContract.bridgeRoadGap) || 1;
    const supportGap = Number(bridgeContract.bridgeSupportGap) || 0.35;
    // A host terrain/world sampler owns each column base when available. The flat datum is retained only for old
    // embedders without that API, and diagnostics expose every use of the compatibility path.
    const supportGroundHeightResolver = createSupportGroundHeightResolver(options, track);
    const supportGroundY = supportGroundHeightResolver.fallbackGroundY;
    const supportFootingCenterOffsetY = BRIDGE_SUPPORT_FOOTING_CENTER_OFFSET_Y;
    const supportFootingHeight = 0.36;
    // When every under-deck bearing position is blocked, the bounded exterior pair carries one real portal beam
    // above the carriageway and suspends both side girders without placing a deep member in lower-road clearance.
    const routeExteriorPortalClearHeight = 7.2;
    const routeExteriorPortalMaximumSpanDepthRatio = 24;
    const routeExteriorPortalMinimumCapDepth = 1.2;
    const routeExteriorPortalMaximumCapDepth = 4.2;
    const routeExteriorPortalHangerWidth = 0.28;
    const routeExteriorPortalHangerDepth = 0.42;
    const elevatedSupportSpacing = 52;
    const minimumVisiblePierHeight = 2.2;
    const supportGeometry = createSupportGeometry(THREE, modeling, pierRadius);
    own(supportGeometry);
    const crossings = crossingList(track);
    const physicalSpans = createPhysicalSpans(track, crossings, edgeVisuals);
    const physicalSpansByUpperEdge = new Map();
    for (const span of physicalSpans) {
      if (!physicalSpansByUpperEdge.has(span.upperEdgeId)) physicalSpansByUpperEdge.set(span.upperEdgeId, []);
      physicalSpansByUpperEdge.get(span.upperEdgeId).push(span);
    }
    let bridgeSpanOverlapCount = 0;
    for (const spans of physicalSpansByUpperEdge.values()) {
      spans.sort((a, b) => a.upperSpanStartS - b.upperSpanStartS);
      for (let index = 1; index < spans.length; index++) {
        if (spans[index].upperSpanStartS < spans[index - 1].upperSpanEndS - 0.000_1) {
          bridgeSpanOverlapCount++;
        }
      }
    }
    const decisionStructureNodes = nodeList(track).filter((node) => (
      node.kind === 'decision' || node.kind === 'collector-decision'
    ));
    const decisionStructureNodeCapacity = Math.max(
      decisionStructureNodes.length,
      Math.floor(Number(track.graph?.contract?.decisionStructureNodeCapacity) || 0)
    );
    const authoredGoreNoseCapacity = Math.max(
      decisionStructureNodeCapacity,
      Math.floor(Number(track.graph?.contract?.goreNoseCapacity) || 0)
    );
    /*
     * Capacity includes every possible elevated-road station, not only the smaller set that survives road
     * clearance. This keeps support publication atomic and makes desktop/mobile geometry equally complete.
     */
    const elevatedSupportCapacity = edges
      .reduce((sum, edge) => sum + Math.max(1, Math.ceil(edge.length / elevatedSupportSpacing)), 0);
    // Candidate variants may remove the ordinary straight fork, so every resident reserves the tile's maximum
    // reachable decision topology instead of assuming that the graph used at construction is always the largest.
    const supportCapacity = Math.max(4, crossings.length * 4 + elevatedSupportCapacity + 16);
    const supports = new THREE.InstancedMesh(supportGeometry, supportMaterial, supportCapacity);
    supports.name = 'cloverleaf-grade-separated-supports';
    supports.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    supports.count = 0;
    supports.castShadow = true;
    supports.receiveShadow = true;
    if (markMainVisual) markMainVisual(supports, 'cloverleaf-bridge-supports');
    group.add(supports);
    yield 'bridge-support-allocation';

    // Mobile shares the same received-light warm-stone material; the structure never emits its own illumination.
    const beamMaterial = supportMaterial.clone();
    own(beamMaterial);
    // Instance colors distinguish bridge, mountain, underground, and lamp-housing stone within one resident draw.
    beamMaterial.color.setHex(0xc2_a985);
    beamMaterial.emissive.setHex(0x00_0000);
    beamMaterial.emissiveIntensity = 0;
    beamMaterial.roughness = 0.91;
    beamMaterial.metalness = 0.01;
    beamMaterial.envMapIntensity = 0.26;
    markSkyRouteMaterial(beamMaterial, 'carved-portal-rib-and-lamp-housing-standard');
    installStaticTunnelStructureShader(THREE, beamMaterial, 'instanced-warm-stone-ribs', tunnelLightingUniforms);
    const capMaterial = supportMaterial.clone();
    own(capMaterial);
    capMaterial.color.setHex(0xa0_7f61);
    capMaterial.emissiveIntensity = 0;
    capMaterial.roughness = 0.93;
    capMaterial.metalness = 0.01;
    capMaterial.envMapIntensity = 0.22;
    markSkyRouteMaterial(capMaterial, 'petal-capital-and-foundation-standard');
    const capGeometry = createSkyStoneCapitalGeometry(THREE, modeling);
    own(capGeometry);
    // Caps and ground footings share one geometry/material batch; doubling instance capacity adds no draw group.
    // A paired route-exterior bent adds one overhead transfer beam and two edge hangers in addition to both
    // footings. Three cap-batch slots per possible pier keep a prepared variant switch allocation-free.
    const supportCapCapacity = supportCapacity * 3;
    const supportCaps = new THREE.InstancedMesh(capGeometry, capMaterial, supportCapCapacity);
    supportCaps.name = 'cloverleaf-bridge-bearing-caps-and-footings';
    supportCaps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    supportCaps.count = 0;
    supportCaps.castShadow = true;
    supportCaps.receiveShadow = true;
    if (markMainVisual) markMainVisual(supportCaps, 'cloverleaf-bridge-bearing-caps');
    group.add(supportCaps);
    yield 'bridge-cap-allocation';

    // Discrete portal/rib frames remain in the center-local crossbeam batch. The enclosure uses a separate shared
    // indexed shell, so both quality profiles retain continuous curvature without increasing tile draw groups.
    const tunnelRibSpacing = qualityProfile?.id === 'mobile' ? 84 : 44;
    /*
     * Tunnel dimensions are structural contracts owned by the route graph. Quality tiers may reduce station
     * density, but widening the mobile shell changes portal and bridge clearance and can create real intersections.
     */
    const roadShoulderJoin = Number(track.graph?.contract?.roadShellShoulderJoin) || 0.22;
    const undergroundWallThickness = Number(
      track.graph?.contract?.undergroundTunnelWallThickness
    ) || 0.54;
    const undergroundWallInset = Number(track.graph?.contract?.undergroundTunnelWallInset) || 0.49;
    const undergroundRoofInset = Number(track.graph?.contract?.undergroundTunnelRoofInset) || 0.84;
    const tunnelProfileSpecs = createTunnelProfileSpecs(
      track,
      edges,
      sampleStep,
      tunnelRibSpacing
    );
    yield 'bridge-profile-allocation';
    const tunnelStructuralCapacity = tunnelProfileSpecs.reduce((sum, spec) => (
      sum + (spec.segmentCount + 1) * 3
    ), 0);
    const tunnelLightCapacity = tunnelProfileSpecs.reduce((sum, spec) => (
      sum + spec.luminaireStations.length * 2
    ), 0);

    const beamGeometry = createSkyStoneRibGeometry(THREE, modeling);
    own(beamGeometry);
    const beamStationsPerCrossing = 3;
    const beams = new THREE.InstancedMesh(
      beamGeometry,
      beamMaterial,
      Math.max(
        1,
        crossings.length * beamStationsPerCrossing + tunnelStructuralCapacity + tunnelLightCapacity
      )
    );
    // One per-instance scalar lets bridge beams remain zero while tunnel ribs/housings receive the same resident
    // fixture field as the shell. It reuses this InstancedMesh and therefore cannot change the tile draw budget.
    const beamStaticTunnelIrradiance = new THREE.InstancedBufferAttribute(
      new Float32Array(beams.instanceMatrix.count),
      1
    );
    beamGeometry.setAttribute(
      STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute,
      beamStaticTunnelIrradiance
    );
    const beamTunnelEnclosure = new THREE.InstancedBufferAttribute(
      new Float32Array(beams.instanceMatrix.count),
      1
    );
    beamGeometry.setAttribute(TUNNEL_ENCLOSURE_CONTRACT.attribute, beamTunnelEnclosure);
    beamGeometry.userData.tunnelEnclosureContractVersion = TUNNEL_ENCLOSURE_CONTRACT.version;
    beams.name = 'cloverleaf-bridge-crossbeams';
    beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    beams.count = 0;
    beams.castShadow = true;
    beams.receiveShadow = true;
    if (markMainVisual) markMainVisual(beams, 'cloverleaf-bridge-crossbeams');
    group.add(beams);
    yield 'bridge-beam-allocation';

    // Only the compact diffuser is self-luminous. Its opaque housing is appended to the shadowed beam batch below,
    // while walls, ribs, and road remain ordinary received-light materials in every quality tier.
    const underpassLightMaterial = new THREE.MeshBasicMaterial({
      color: 0xff_ffff,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      toneMapped: true
    });
    own(underpassLightMaterial);
    const guidanceLightColor = new THREE.Color(0xff_d78a);
    const wayfindingInscriptionColor = new THREE.Color(0xc7_a66d);
    const underpassLightGeometry = createCandleStarGeometry(THREE, modeling);
    own(underpassLightGeometry);
    const curvedEdges = edges.filter((edge) => edge.family === 'loop-ramp' || edge.family === 'direct-ramp');
    const reflectorCapacity = curvedEdges.reduce((sum, edge) => (
      sum + Math.ceil(edge.length / (qualityProfile?.id === 'mobile' ? 44 : 32))
    ), 0) + decisionStructureNodeCapacity * 2;
    const underpassLights = new THREE.InstancedMesh(
      underpassLightGeometry,
      underpassLightMaterial,
      Math.max(
        2,
        crossings.length * beamStationsPerCrossing * 2
          + reflectorCapacity + tunnelLightCapacity
      )
    );
    underpassLights.name = 'cloverleaf-underpass-lights';
    underpassLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    underpassLights.count = 0;
    markShadowExempt(
      underpassLights,
      'Small powered diffusers are self-luminous; their separate opaque housings own the physical shadow body.'
    );
    underpassLights.userData.neonV23Bloom = true;
    underpassLights.layers.enable(12);
    underpassLightMaterial.userData.neonV23 = Object.freeze({
      bloomEmitter: true,
      kind: 'constant-on-candle-star-diffuser',
      contractVersion: SKY_ROUTE_SCENERY_CONTRACT.version
    });
    underpassLights.userData.neonV23SkyWayfindingArt = Object.freeze({
      contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
      role: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.role,
      geometryAuthority: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.geometryAuthority,
      additionalLightCount: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.additionalLightCount
    });
    if (markEffect) markEffect(underpassLights, 'cloverleaf-underpass-lights');
    group.add(underpassLights);
    yield 'bridge-light-allocation';

    const tunnelShellBuild = yield* createContinuousTunnelShellGeometrySteps(
      THREE,
      track,
      tunnelProfileSpecs,
      tileOrigin,
      undergroundWallInset,
      undergroundRoofInset,
      roadShoulderJoin,
      undergroundWallThickness,
      own
    );
    const tunnelShellGeometry = tunnelShellBuild.geometry;
    const tunnelShellDiagnostics = tunnelShellBuild.diagnostics;
    const tunnelShellMaterial = markSkyRouteMaterial(new THREE.MeshPhysicalMaterial({
      color: 0xff_ffff,
      vertexColors: true,
      emissive: 0x00_0000,
      emissiveIntensity: 0,
      roughness: 0.92,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.82,
      ior: 1.46,
      envMapIntensity: 0.09
    }), 'continuous-wind-eroded-tunnel-shell-standard');
    own(tunnelShellMaterial);
    installStaticTunnelStructureShader(THREE, tunnelShellMaterial, 'continuous-warm-stone-shell', tunnelLightingUniforms);
    const tunnelShells = new THREE.Mesh(tunnelShellGeometry, tunnelShellMaterial);
    tunnelShells.name = 'cloverleaf-continuous-tunnel-shells';
    tunnelShells.castShadow = true;
    tunnelShells.receiveShadow = true;
    if (markMainVisual) markMainVisual(tunnelShells, 'cloverleaf-continuous-tunnel-shells');
    group.add(tunnelShells);
    yield 'bridge-mesh-allocation';

    // One structural draw group adds longitudinal girders, expansion joints, and paired side pylons. Runtime
    // capacity also covers the opposing return's continuous fascia and diaphragms; keeping them in this existing
    // batch adds physical rhythm without allocating a Mesh or draw group for every road segment.
    const RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY = 768;
    const structuralDetailGeometry = createSkyPetalSpireRibbonGeometry(THREE, modeling);
    own(structuralDetailGeometry);
    const structuralDetailMaterial = markSkyRouteMaterial(new THREE.MeshStandardMaterial({
      color: 0x70_5947,
      emissive: 0x00_0000,
      emissiveIntensity: 0,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.24
    }), 'carved-stone-fascia-spire-and-ribbon-standard');
    own(structuralDetailMaterial);
    structuralDetailMaterial.userData.neonV23SkyWayfindingArt = Object.freeze({
      contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
      role: 'matte-wind-eroded-petal-stone',
      metalness: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.metalness
    });
    const detailSegmentLength = qualityProfile?.id === 'mobile' ? 9 : 6;
    const physicalDetailSegmentCount = physicalSpans.reduce((sum, span) => (
      sum + Math.max(1, Math.ceil((span.upperSpanEndS - span.upperSpanStartS) / detailSegmentLength))
    ), 0);
    const structuralDetailCapacity = physicalDetailSegmentCount * 6
      + physicalSpans.length * 2 + decisionStructureNodeCapacity * 2 + supportCapacity * 2;
    const railPostCapacity = physicalDetailSegmentCount * 2 + physicalSpans.length * 4;
    const structuralDetails = new THREE.InstancedMesh(
      structuralDetailGeometry,
      structuralDetailMaterial,
      Math.max(
        1,
        structuralDetailCapacity + railPostCapacity + RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY
      )
    );
    structuralDetails.name = 'cloverleaf-layered-structural-details';
    structuralDetails.count = 0;
    structuralDetails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    structuralDetails.castShadow = true;
    structuralDetails.receiveShadow = true;
    if (markMainVisual) markMainVisual(structuralDetails, 'cloverleaf-layered-structural-details');
    group.add(structuralDetails);

    const ultraSupportMaterial = supportMaterial.clone();
    own(ultraSupportMaterial);
    ultraSupportMaterial.color.setHex(0x9a_7c60);
    ultraSupportMaterial.emissive.setHex(0x00_0000);
    ultraSupportMaterial.emissiveIntensity = 0;
    ultraSupportMaterial.roughness = 0.86;
    ultraSupportMaterial.metalness = 0.015;
    ultraSupportMaterial.envMapIntensity = 0.28;
    markSkyRouteMaterial(ultraSupportMaterial, 'wind-eroded-pier-high');
    installUltraStructureShader(THREE, ultraSupportMaterial, 'wind-stone-piers', 0.92, 0.18);
    const ultraBeamMaterial = beamMaterial.clone();
    own(ultraBeamMaterial);
    ultraBeamMaterial.color.setHex(0xd0_b78e);
    ultraBeamMaterial.emissive.setHex(0x00_0000);
    ultraBeamMaterial.emissiveIntensity = 0;
    ultraBeamMaterial.roughness = 0.84;
    ultraBeamMaterial.metalness = 0.015;
    ultraBeamMaterial.envMapIntensity = 0.31;
    markSkyRouteMaterial(ultraBeamMaterial, 'carved-portal-rib-and-lamp-housing-high');
    installUltraStructureShader(THREE, ultraBeamMaterial, 'carved-warm-stone-ribs', 1.08, 0.16, true, tunnelLightingUniforms);
    const ultraCapMaterial = capMaterial.clone();
    own(ultraCapMaterial);
    ultraCapMaterial.color.setHex(0xb0_8e6a);
    ultraCapMaterial.emissive.setHex(0x00_0000);
    ultraCapMaterial.emissiveIntensity = 0;
    ultraCapMaterial.roughness = 0.86;
    ultraCapMaterial.metalness = 0.015;
    ultraCapMaterial.envMapIntensity = 0.27;
    markSkyRouteMaterial(ultraCapMaterial, 'petal-capital-and-foundation-high');
    installUltraStructureShader(THREE, ultraCapMaterial, 'petal-stone-capitals', 1.02, 0.17);
    const ultraTunnelShellMaterial = tunnelShellMaterial.clone();
    own(ultraTunnelShellMaterial);
    ultraTunnelShellMaterial.color.setHex(0xff_f3df);
    ultraTunnelShellMaterial.roughness = 0.84;
    ultraTunnelShellMaterial.clearcoat = 0.03;
    ultraTunnelShellMaterial.clearcoatRoughness = 0.78;
    ultraTunnelShellMaterial.envMapIntensity = 0.12;
    markSkyRouteMaterial(ultraTunnelShellMaterial, 'continuous-wind-eroded-tunnel-shell-high');
    installUltraStructureShader(THREE, ultraTunnelShellMaterial, 'tunnel-warm-stone', 0.88, 0.18, true, tunnelLightingUniforms);
    const ultraStructuralDetailMaterial = structuralDetailMaterial.clone();
    own(ultraStructuralDetailMaterial);
    ultraStructuralDetailMaterial.color.setHex(0x80_654f);
    ultraStructuralDetailMaterial.emissive.setHex(0x00_0000);
    ultraStructuralDetailMaterial.emissiveIntensity = 0;
    ultraStructuralDetailMaterial.roughness = 0.84;
    ultraStructuralDetailMaterial.metalness = 0;
    ultraStructuralDetailMaterial.envMapIntensity = 0.3;
    markSkyRouteMaterial(ultraStructuralDetailMaterial, 'carved-stone-fascia-spire-and-ribbon-high');
    ultraStructuralDetailMaterial.userData.neonV23SkyWayfindingArt =
      structuralDetailMaterial.userData.neonV23SkyWayfindingArt;
    installUltraStructureShader(THREE, ultraStructuralDetailMaterial, 'carved-stone-ribbons', 1.2, 0.14);

    // Posts share the higher-detail structural box batch; their matrices are appended after all girder/pylon boxes.
    const railPostGeometry = structuralDetailGeometry;
    const railPostMaterial = structuralDetailMaterial;
    const railPosts = structuralDetails;
    yield 'structural-mesh-allocation';

    const supportMatrix = new THREE.Matrix4();
    const supportPosition = new THREE.Vector3();
    const supportScale = new THREE.Vector3(1, 1, 1);
    const supportQuaternion = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const detailRight = new THREE.Vector3();
    const detailUp = new THREE.Vector3();
    const detailBack = new THREE.Vector3();
    const detailBasis = new THREE.Matrix4();
    const detailQuaternion = new THREE.Quaternion();
    const detailMatrix = new THREE.Matrix4();
    const detailPosition = new THREE.Vector3();
    const detailScale = new THREE.Vector3();
    let supportIndex = 0;
    let supportCapIndex = 0;
    let beamIndex = 0;
    let underpassLightIndex = 0;
    let supportPlacementFailureCount = 0;
    let supportRoadOverlapCount = 0;
    let supportMinimumRoadGap = Number.POSITIVE_INFINITY;
    let supportMinimumSurfaceGap = Number.POSITIVE_INFINITY;
    let supportGroundContactError = 0;
    let supportFootingCount = 0;
    let expectedSupportCount = 0;
    let crossingSupportCount = 0;
    let elevatedRoadEdgeCount = 0;
    let elevatedRoadSupportCount = 0;
    let elevatedSupportCandidateCount = 0;
    let elevatedSupportBlockedCandidateCount = 0;
    const elevatedSupportBlockedByEdgeIds = new Set();
    let elevatedSupportUnsupportedEdgeCount = 0;
    const elevatedSupportUnsupportedEdgeIds = [];
    let elevatedSupportMaximumGap = 0;
    let elevatedSupportMaximumGapEdgeId = null;
    let elevatedSupportMinimumPierHeight = Number.POSITIVE_INFINITY;
    let structuralDetailIndex = 0;
    let longitudinalGirderCount = 0;
    let expansionJointCount = 0;
    let expansionJointSurfaceError = 0;
    let railPostCount = 0;
    let solidSafeCorridorViolationCount = tunnelShellDiagnostics.safeCorridorViolationCount;
    let maximumAddedSoffitDepth = 0;
    let bearingPadCount = 0;
    let supportCapAlignmentError = 0;
    let supportMaximumInvalidOutwardCapOverhang = 0;
    let supportMinimumPierCapOverlap = Number.POSITIVE_INFINITY;
    let maximumGirderChordError = 0;
    let maximumRailChordError = 0;
    let maximumGirderSegmentLength = 0;
    let maximumRailSegmentLength = 0;
    let duplicateRailStationCount = 0;
    let reflectorCount = 0;
    let tunnelRibCount = 0;
    const tunnelRoofPanelCount = tunnelShellDiagnostics.roofPanelCount;
    let tunnelPortalCount = 0;
    let bridgeLightCount = 0;
    let tunnelLightCount = 0;
    let tunnelLuminaireHousingCount = 0;
    let tunnelLuminaireMaximumSpacingM = 0;
    let mountainOpeningCount = 0;
    const undergroundWallPanelCount = tunnelShellDiagnostics.undergroundWallPanelCount;
    let tunnelSafeCorridorViolationCount = tunnelShellDiagnostics.safeCorridorViolationCount;
    let minimumUndergroundPortalRoadClearanceM = Number.POSITIVE_INFINITY;
    const bridgeLightEmitters = [];
    const tunnelLightEmitters = [];
    const tunnelLuminaireHousingIndices = [];
    const railPostMatrices = [];
    const supportCenters = [];
    const supportStationsByEdge = new Map();
    const elevatedSupportCoverageByEdge = new Map();
    const centralSupportEdges = new Set();
    const sharedSupportStation = Symbol('shared-support-station');
    const routeCameraBlockerMatrixScratch = new THREE.Matrix4();
    let supportCameraBlockers = null;
    let supportCapCameraBlockers = null;
    let beamCameraBlockers = null;
    let structuralDetailCameraBlockers = null;
    let goreCameraBlockers = null;

    /** Cache one immutable local AABB per shared geometry; variant rewrites then require no temporary objects. */
    function cameraBlockerLocalEnvelope(geometry) {
      const cached = geometry?.userData?.neonV23FilmCameraBlockerEnvelope;
      if (cached) return cached;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const envelope = Object.freeze({
        centerX: (box.min.x + box.max.x) * 0.5,
        centerY: (box.min.y + box.max.y) * 0.5,
        centerZ: (box.min.z + box.max.z) * 0.5,
        halfX: (box.max.x - box.min.x) * 0.5,
        halfY: (box.max.y - box.min.y) * 0.5,
        halfZ: (box.max.z - box.min.z) * 0.5
      });
      geometry.userData.neonV23FilmCameraBlockerEnvelope = envelope;
      return envelope;
    }

    /** Allocate the complete retained record pool once; hidden slots retain finite values for diagnostics. */
    function createInstancedCameraBlockerPool(mesh, familyForIndex) {
      const capacity = mesh.instanceMatrix.count;
      const records = Array.from({ length: capacity }, (_, instanceIndex) => {
        const kind = typeof familyForIndex === 'function'
          ? familyForIndex(instanceIndex)
          : familyForIndex;
        return Object.seal({
          id: `${trafficTileToken}:${mesh.name}:${instanceIndex}`,
          kind,
          coordinateMode: FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.coordinateMode,
          meshName: mesh.name,
          instanceIndex,
          visible: false,
          layoutVisible: false,
          x: tileOrigin.x,
          y: 0,
          z: tileOrigin.z,
          radiusM: 0.001,
          minY: 0,
          maxY: 0
        });
      });
      return Object.freeze(records);
    }

    /**
     * Rewrite cylinders from the actual published matrices. Transforming the local AABB into a world AABB and
     * wrapping its X/Z rectangle in a circle is conservative under bank, pitch, non-uniform scale, and carved
     * geometry, while remaining allocation-free for runtime route-variant publication.
     */
    function synchronizeInstancedCameraBlockers(
      records,
      mesh,
      excludedStart = -1,
      excludedEnd = -1
    ) {
      if (!records) return;
      const envelope = cameraBlockerLocalEnvelope(mesh.geometry);
      for (let instanceIndex = 0; instanceIndex < records.length; instanceIndex++) {
        const record = records[instanceIndex];
        const excluded = instanceIndex >= excludedStart && instanceIndex < excludedEnd;
        const layoutVisible = instanceIndex < mesh.count && !excluded;
        record.layoutVisible = layoutVisible;
        record.visible = layoutVisible && group.visible;
        if (!layoutVisible) continue;
        mesh.getMatrixAt(instanceIndex, routeCameraBlockerMatrixScratch);
        const elements = routeCameraBlockerMatrixScratch.elements;
        const centerX = elements[0] * envelope.centerX
          + elements[4] * envelope.centerY
          + elements[8] * envelope.centerZ + elements[12];
        const centerY = elements[1] * envelope.centerX
          + elements[5] * envelope.centerY
          + elements[9] * envelope.centerZ + elements[13];
        const centerZ = elements[2] * envelope.centerX
          + elements[6] * envelope.centerY
          + elements[10] * envelope.centerZ + elements[14];
        const extentX = Math.abs(elements[0]) * envelope.halfX
          + Math.abs(elements[4]) * envelope.halfY
          + Math.abs(elements[8]) * envelope.halfZ;
        const extentY = Math.abs(elements[1]) * envelope.halfX
          + Math.abs(elements[5]) * envelope.halfY
          + Math.abs(elements[9]) * envelope.halfZ;
        const extentZ = Math.abs(elements[2]) * envelope.halfX
          + Math.abs(elements[6]) * envelope.halfY
          + Math.abs(elements[10]) * envelope.halfZ;
        record.x = centerX + tileOrigin.x;
        record.y = centerY;
        record.z = centerZ + tileOrigin.z;
        record.radiusM = Math.max(0.001, Math.hypot(extentX, extentZ));
        record.minY = centerY - extentY;
        record.maxY = centerY + extentY;
      }
    }

    /** Refresh route-owned structural slots while leaving dedicated decision-pylon records authoritative. */
    function synchronizeStructuralDetailCameraBlockers() {
      if (!structuralDetailCameraBlockers) return;
      synchronizeInstancedCameraBlockers(
        structuralDetailCameraBlockers,
        structuralDetails,
        decisionPylonInstanceStart,
        decisionPylonInstanceEnd
      );
    }

    function recordElevatedSupportGap(edgeId, gap) {
      if (!(gap > elevatedSupportMaximumGap)) return;
      elevatedSupportMaximumGap = gap;
      elevatedSupportMaximumGapEdgeId = edgeId;
    }

    function installDetailBox(mesh, index, frame, verticalOffset, scale) {
      detailRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
      detailUp.set(frame.upX, frame.upY, frame.upZ).normalize();
      detailBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
      detailBasis.makeBasis(detailRight, detailUp, detailBack);
      detailQuaternion.setFromRotationMatrix(detailBasis);
      detailPosition.set(
        frame.x - tileOrigin.x + frame.upX * verticalOffset,
        frame.y + frame.upY * verticalOffset,
        frame.z - tileOrigin.z + frame.upZ * verticalOffset
      );
      detailScale.set(scale.x, scale.y, scale.z);
      detailMatrix.compose(detailPosition, detailQuaternion, detailScale);
      mesh.setMatrixAt(index, detailMatrix);
    }

    function captureRailPost(frame, verticalOffset, scale) {
      detailRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
      detailUp.set(frame.upX, frame.upY, frame.upZ).normalize();
      detailBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
      detailBasis.makeBasis(detailRight, detailUp, detailBack);
      detailQuaternion.setFromRotationMatrix(detailBasis);
      detailPosition.set(
        frame.x - tileOrigin.x + frame.upX * verticalOffset,
        frame.y + frame.upY * verticalOffset,
        frame.z - tileOrigin.z + frame.upZ * verticalOffset
      );
      detailScale.set(scale.x, scale.y, scale.z);
      detailMatrix.compose(detailPosition, detailQuaternion, detailScale);
      railPostMatrices.push(detailMatrix.clone());
    }

    /**
     * Compose route-owned structural matrices without creating per-edge objects. Continuous return-flyover fascia
     * stays inside the sealed deck envelope; exceptional cable-stayed matrices retain their separately proven
     * deep-girder and supported-endpoint contracts. Everything remains detached until its road variant publishes.
     */
    function composeRuntimeLongSpanStructureMatrices(runtimeTrack, supportLayout) {
      const matrices = [];
      const localPosition = new THREE.Vector3();
      const localScale = new THREE.Vector3();
      const localQuaternion = new THREE.Quaternion();
      const localBasis = new THREE.Matrix4();
      const localRight = new THREE.Vector3();
      const localUp = new THREE.Vector3();
      const localForward = new THREE.Vector3();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const alternateUp = new THREE.Vector3(1, 0, 0);
      const startPoint = new THREE.Vector3();
      const endPoint = new THREE.Vector3();
      const midpoint = new THREE.Vector3();

      const appendFrameBox = (frame, verticalOffset, scale) => {
        localRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
        localUp.set(frame.upX, frame.upY, frame.upZ).normalize();
        localForward.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
        localBasis.makeBasis(localRight, localUp, localForward);
        localQuaternion.setFromRotationMatrix(localBasis);
        localPosition.set(
          frame.x - tileOrigin.x + frame.upX * verticalOffset,
          frame.y + frame.upY * verticalOffset,
          frame.z - tileOrigin.z + frame.upZ * verticalOffset
        );
        localScale.set(scale.x, scale.y, scale.z);
        const matrix = new THREE.Matrix4();
        matrix.compose(localPosition, localQuaternion, localScale);
        matrices.push(matrix);
      };

      const appendVerticalBox = (frame, baseY, height, width, depth) => {
        localPosition.set(frame.x - tileOrigin.x, baseY + height * 0.5, frame.z - tileOrigin.z);
        localQuaternion.identity();
        localScale.set(width, height, depth);
        const matrix = new THREE.Matrix4();
        matrix.compose(localPosition, localQuaternion, localScale);
        matrices.push(matrix);
      };

      const appendSegmentBox = (start, end, thickness) => {
        startPoint.set(start.x - tileOrigin.x, start.y, start.z - tileOrigin.z);
        endPoint.set(end.x - tileOrigin.x, end.y, end.z - tileOrigin.z);
        localForward.subVectors(endPoint, startPoint);
        const length = localForward.length();
        if (!(length > 0.001)) return;
        localForward.multiplyScalar(1 / length);
        const referenceUp = Math.abs(localForward.y) > 0.96 ? alternateUp : worldUp;
        localRight.crossVectors(referenceUp, localForward).normalize();
        localUp.crossVectors(localForward, localRight).normalize();
        localBasis.makeBasis(localRight, localUp, localForward);
        localQuaternion.setFromRotationMatrix(localBasis);
        midpoint.addVectors(startPoint, endPoint).multiplyScalar(0.5);
        localScale.set(thickness, thickness, length);
        const matrix = new THREE.Matrix4();
        matrix.compose(midpoint, localQuaternion, localScale);
        matrices.push(matrix);
      };

      for (const [edgeId, coverageRanges] of Object.entries(supportLayout?.coverageByEdge || {})) {
        const edge = runtimeTrack.getEdge?.(edgeId);
        const contract = edge?.supportSpanContract;
        if (contract?.kind !== 'continuous-box-girder') continue;
        const fasciaSegmentM = clamp(Number(contract.fasciaSegmentM) || 24, 12, 32);
        const fasciaWidthM = clamp(Number(contract.fasciaWidthM) || 0.34, 0.24, 0.48);
        const fasciaDepthM = clamp(
          Number(contract.fasciaDepthM) || deckThickness * 0.68,
          0.42,
          deckThickness * 0.82
        );
        const diaphragmDepthM = clamp(Number(contract.diaphragmDepthM) || 0.20, 0.14, 0.28);
        for (const range of coverageRanges || []) {
          const rangeStartS = clamp(Number(range?.[0]) || 0, 0, edge.length);
          const rangeEndS = clamp(Number(range?.[1]) || 0, rangeStartS, edge.length);
          const segmentCount = Math.max(1, Math.ceil((rangeEndS - rangeStartS) / fasciaSegmentM));
          for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
            const startS = rangeStartS + (rangeEndS - rangeStartS) * segmentIndex / segmentCount;
            const endS = rangeStartS + (rangeEndS - rangeStartS) * (segmentIndex + 1) / segmentCount;
            const centerS = (startS + endS) * 0.5;
            const center = sample(runtimeTrack, edge.id, centerS, 0, {});
            for (const side of [-1, 1]) {
              const frame = sample(
                runtimeTrack,
                edge.id,
                centerS,
                side * (sampledRoadHalf(center, edge) + 0.08),
                {}
              );
              appendFrameBox(
                frame,
                -deckThickness + fasciaDepthM * 0.5,
                {
                  x: fasciaWidthM,
                  y: fasciaDepthM,
                  z: endS - startS + 0.12
                }
              );
            }
          }
        }
        // Thin cross-diaphragms sit wholly inside the existing deck depth and make the wider pier rhythm readable
        // from below without lowering collision clearance or manufacturing a second physical soffit.
        for (const edgeS of supportLayout?.stationsByEdge?.[edgeId] || []) {
          const center = sample(runtimeTrack, edge.id, edgeS, 0, {});
          appendFrameBox(
            center,
            -deckThickness + diaphragmDepthM * 0.5,
            {
              x: sampledRoadHalf(center, edge) * 2 + 0.36,
              y: diaphragmDepthM,
              z: 0.62
            }
          );
        }
      }

      for (const span of supportLayout?.designedLongSpans || []) {
        const edge = runtimeTrack.getEdge?.(span.edgeId);
        const contract = edge?.supportSpanContract;
        if (contract?.kind !== 'cable-stayed-box-girder') continue;
        const spanLength = span.endS - span.startS;
        const girderDepth = Number(contract.girderDepthM) || 2;
        const girderSegmentLength = Number(contract.girderSegmentM) || 16;
        const segmentCount = Math.max(1, Math.ceil(spanLength / girderSegmentLength));
        for (const side of [-1, 1]) {
          for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
            const startS = span.startS + spanLength * segmentIndex / segmentCount;
            const endS = span.startS + spanLength * (segmentIndex + 1) / segmentCount;
            const centerS = (startS + endS) * 0.5;
            const center = sample(runtimeTrack, edge.id, centerS, 0, {});
            const girderFrame = sample(
              runtimeTrack,
              edge.id,
              centerS,
              side * Math.max(0, sampledRoadHalf(center, edge) - 0.48),
              {}
            );
            appendFrameBox(
              girderFrame,
              -deckThickness - girderDepth * 0.5,
              { x: 0.62, y: girderDepth, z: endS - startS + 0.12 }
            );
          }
        }

        const pylonHeight = clamp(
          spanLength * (Number(contract.pylonHeightRatio) || 0.09),
          Number(contract.minimumPylonHeightM) || 28,
          Number(contract.maximumPylonHeightM) || 36
        );
        const pylonWidth = 0.92;
        const endpointTransferDepth = 1.2;
        const endpointTransferOverlap = 0.08;
        const endpointSupportHalfWidth = 0.5;
        const stayPanelM = Number(contract.stayPanelM) || 32;
        const backStayCount = Math.max(0, Math.floor(Number(contract.backStayCount) || 0));
        for (const endpoint of [
          { station: span.startS, direction: 1 },
          { station: span.endS, direction: -1 }
        ]) {
          const center = sample(runtimeTrack, edge.id, endpoint.station, 0, {});
          const pylonLateral = sampledRoadHalf(center, edge) + 0.85;
          let transferMinimumLateral = -pylonLateral - pylonWidth * 0.5;
          let transferMaximumLateral = pylonLateral + pylonWidth * 0.5;
          for (const record of supportLayout?.records || []) {
            if (
              record.edgeId !== edge.id
              || !Number.isFinite(record.edgeS)
              || !Number.isFinite(record.x)
              || !Number.isFinite(record.z)
              || Math.abs(record.edgeS - endpoint.station) > 0.001
            ) continue;
            const supportLateral = (record.x - center.x) * center.rightX
              + (record.z - center.z) * center.rightZ;
            transferMinimumLateral = Math.min(
              transferMinimumLateral,
              supportLateral - endpointSupportHalfWidth
            );
            transferMaximumLateral = Math.max(
              transferMaximumLateral,
              supportLateral + endpointSupportHalfWidth
            );
          }
          const transferCenterLateral = (transferMinimumLateral + transferMaximumLateral) * 0.5;
          const transferFrame = sample(
            runtimeTrack,
            edge.id,
            endpoint.station,
            transferCenterLateral,
            {}
          );
          // One bank-aligned transfer beam overlaps both deep side girders, both world-vertical tower feet, and
          // every route-owned endpoint support. Its top stays inside the solid deck, outside the driveable corridor.
          appendFrameBox(
            transferFrame,
            -deckThickness - endpointTransferDepth * 0.5 + endpointTransferOverlap,
            {
              x: transferMaximumLateral - transferMinimumLateral,
              y: endpointTransferDepth,
              z: 1.4
            }
          );
          const towerTops = [];
          for (const side of [-1, 1]) {
            const pylonFrame = sample(
              runtimeTrack,
              edge.id,
              endpoint.station,
              side * pylonLateral,
              {}
            );
            const baseY = pylonFrame.y - deckThickness;
            const topY = pylonFrame.y + pylonHeight;
            appendVerticalBox(
              pylonFrame,
              baseY,
              topY - baseY,
              pylonWidth,
              pylonWidth
            );
            towerTops.push({
              x: pylonFrame.x,
              y: topY - 0.8,
              z: pylonFrame.z,
              side
            });
          }
          appendSegmentBox(towerTops[0], towerTops[1], 0.68);

          const stayPanelCount = Math.max(
            1,
            Math.floor((spanLength * 0.5 - stayPanelM * 0.5) / stayPanelM)
          );
          for (const towerTop of towerTops) {
            for (let panelIndex = 1; panelIndex <= stayPanelCount; panelIndex++) {
              const station = endpoint.station
                + endpoint.direction * Math.min(spanLength * 0.5, panelIndex * stayPanelM);
              const anchorCenter = sample(runtimeTrack, edge.id, station, 0, {});
              const anchor = sample(
                runtimeTrack,
                edge.id,
                station,
                towerTop.side * Math.max(0, sampledRoadHalf(anchorCenter, edge) - 0.48),
                {}
              );
              appendSegmentBox(towerTop, { x: anchor.x, y: anchor.y + 0.22, z: anchor.z }, 0.11);
            }
            for (let backIndex = 1; backIndex <= backStayCount; backIndex++) {
              const station = clamp(
                endpoint.station - endpoint.direction * backIndex * stayPanelM,
                0,
                edge.length
              );
              if (Math.abs(station - endpoint.station) < 0.001) continue;
              const anchorCenter = sample(runtimeTrack, edge.id, station, 0, {});
              const anchor = sample(
                runtimeTrack,
                edge.id,
                station,
                towerTop.side * Math.max(0, sampledRoadHalf(anchorCenter, edge) - 0.48),
                {}
              );
              appendSegmentBox(towerTop, { x: anchor.x, y: anchor.y + 0.22, z: anchor.z }, 0.10);
            }
          }
        }
      }
      if (matrices.length > RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY) {
        throw new Error(
          `Runtime route structure exceeds ${RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY} instances`
        );
      }
      return Object.freeze(matrices);
    }

    /**
     * Install one ground-anchored pier, a deck-aligned bearing cap, and a visible footing after its complete
     * horizontal footprint clears every non-supported road. `supportKind` is diagnostic-only and cannot alter
     * collision, topology, or placement.
     */
    function installSupport(frame, clearance, supportKind = 'crossing') {
      if (supportIndex >= supportCapacity) {
        supportPlacementFailureCount++;
        return false;
      }
      for (const center of supportCenters) {
        supportMinimumSurfaceGap = Math.min(
          supportMinimumSurfaceGap,
          Math.hypot(frame.x - center.x, frame.z - center.z) - supportClearanceRadius * 2
        );
      }
      detailRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
      detailUp.set(frame.upX, frame.upY, frame.upZ).normalize();
      detailBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
      const undersideY = verticalSupportDeckUndersideY(frame, deckThickness);
      const groundY = Number.isFinite(frame.supportGroundY)
        ? frame.supportGroundY
        : supportGroundHeightResolver.sample(frame.x, frame.z, { supportKind });
      supportCenters.push({ x: frame.x, z: frame.z, undersideY, groundY });
      const height = Math.max(0.8, undersideY - groundY);
      supportQuaternion.setFromAxisAngle(yAxis, frame.yaw);
      supportPosition.set(
        frame.x - tileOrigin.x,
        groundY + height * 0.5,
        frame.z - tileOrigin.z
      );
      supportScale.set(1, height, 1);
      supportMatrix.compose(supportPosition, supportQuaternion, supportScale);
      supports.setMatrixAt(supportIndex, supportMatrix);
      supportGroundContactError = Math.max(
        supportGroundContactError,
        Math.abs(supportPosition.y - height * 0.5 - groundY)
      );
      elevatedSupportMinimumPierHeight = Math.min(elevatedSupportMinimumPierHeight, height);

      detailBasis.makeBasis(detailRight, detailUp, detailBack);
      detailQuaternion.setFromRotationMatrix(detailBasis);
      const supportLateral = Number(frame.supportLateral) || 0;
      const roadHalf = Number(frame.roadHalf) || 0;
      const transferCap = supportTransferCapLayout(supportLateral, roadHalf, supportRadius);
      const capCenterLateralOffset = transferCap.centerLateralOffset;
      // Permanent single-column supports keep a short local bearing cap. Wide route-exterior crossings use the
      // separately clearance-proven two-leg portal path and must never be represented by a giant cantilever here.
      // An exterior column uses one non-symmetric transfer member: the centre moves only toward the nearest side
      // girder and retains the real 1.1m bearing-pad zone at each end, so no duplicate transfer reach exists outside.
      const capHalfDepth = transferCap.capDepth * 0.5;
      const capCenterY = undersideY
        - capHalfDepth / Math.max(0.000_001, Math.abs(detailUp.y))
        + detailRight.y * capCenterLateralOffset;
      supportPosition.set(
        frame.x - tileOrigin.x + detailRight.x * capCenterLateralOffset,
        capCenterY,
        frame.z - tileOrigin.z + detailRight.z * capCenterLateralOffset
      );
      supportScale.set(
        transferCap.width,
        transferCap.capDepth,
        transferCap.longitudinalDepth
      );
      supportMatrix.compose(supportPosition, detailQuaternion, supportScale);
      supportCaps.setMatrixAt(supportCapIndex++, supportMatrix);
      supportMinimumPierCapOverlap = Math.min(
        supportMinimumPierCapOverlap,
        transferCap.pierOverlap
      );
      supportMaximumInvalidOutwardCapOverhang = Math.max(
        supportMaximumInvalidOutwardCapOverhang,
        transferCap.invalidOutwardOverhang
      );
      supportCapAlignmentError = Math.max(
        supportCapAlignmentError,
        Math.abs(
          (-detailRight.x * capCenterLateralOffset) * detailUp.x
            + (undersideY - capCenterY) * detailUp.y
            + (-detailRight.z * capCenterLateralOffset) * detailUp.z
            - capHalfDepth
        )
      );

      // The footing stays world-horizontal; supportClearanceRadius is its complete X/Z half-diagonal, so corners
      // cannot escape the road-clearance proof used for this leg.
      supportPosition.set(
        frame.x - tileOrigin.x,
        groundY + supportFootingCenterOffsetY,
        frame.z - tileOrigin.z
      );
      supportScale.set(supportFootingWidth, supportFootingHeight, supportFootingDepth);
      supportMatrix.compose(supportPosition, supportQuaternion, supportScale);
      supportCaps.setMatrixAt(supportCapIndex++, supportMatrix);
      supportFootingCount++;
      for (const side of [-1, 1]) {
        detailPosition.set(
          frame.x - tileOrigin.x + detailRight.x * side * 0.68 - detailUp.x * (deckThickness + 0.035),
          frame.y + detailRight.y * side * 0.68 - detailUp.y * (deckThickness + 0.035),
          frame.z - tileOrigin.z + detailRight.z * side * 0.68 - detailUp.z * (deckThickness + 0.035)
        );
        detailScale.set(0.48, 0.11, 0.72);
        detailMatrix.compose(detailPosition, detailQuaternion, detailScale);
        structuralDetails.setMatrixAt(structuralDetailIndex++, detailMatrix);
        bearingPadCount++;
      }
      if (supportKind === 'elevated-road') elevatedRoadSupportCount++;
      else crossingSupportCount++;
      supportIndex++;

      if (clearance?.clear === false) supportRoadOverlapCount++;
      if (Number.isFinite(clearance?.clearance)) {
        supportMinimumRoadGap = Math.min(
          supportMinimumRoadGap,
          clearance.clearance + supportRoadGap
        );
      }
      return true;
    }

    /** Search away from a protected crossing, or symmetrically around a regular elevated-road station. */
    function* placeSupportOnDeck(edgeId, edge, initialS, searchDirection, options = {}) {
      const ignoredEdgeIds = [edge.id, edge.templateEdgeId].filter(Boolean);
      const attemptCount = Math.max(1, Math.floor(Number(options.attemptCount) || 24));
      const searchStep = Math.max(0.25, Number(options.searchStep) || 1.5);
      const lateralOffsets = Array.isArray(options.lateralOffsets) && options.lateralOffsets.length > 0
        ? options.lateralOffsets
        : [0];
      const placementJob = createSupportPlacementSearchJob({
        edgeLength: edge.length,
        initialS,
        searchDirection,
        attemptCount,
        searchStep,
        lateralOffsets,
        symmetric: options.symmetric,
        evaluateCandidate(supportS, lateral) {
          const candidate = sample(track, edgeId, supportS, lateral, {});
          const candidateUndersideY = verticalSupportDeckUndersideY(candidate, deckThickness);
          const candidateGroundY = supportGroundHeightResolver.sample(candidate.x, candidate.z, {
            edgeId,
            edgeS: supportS,
            lateral,
            supportKind: options.supportKind || 'crossing'
          });
          candidate.supportGroundY = candidateGroundY;
          if (
            Number.isFinite(options.minimumPierHeight)
            && candidateUndersideY - candidateGroundY < options.minimumPierHeight
          ) {
            return undefined;
          }
          const clearance = typeof track.queryRoadClearance === 'function'
            ? track.queryRoadClearance(candidate.x, candidate.z, supportClearanceRadius, {
                minimumGap: supportRoadGap,
                ignoreEdgeIds: ignoredEdgeIds,
                // This query represents the real shaft, not an infinite plan-view obstacle. A same-height deck
                // may touch its bearing top; only road slabs overlapping the ground-to-underside interval veto it.
                verticalEnvelope: {
                  minY: candidateGroundY,
                  maxY: candidateUndersideY
                }
              })
            : null;
          const clearsSupports = supportCenters.every((center) => (
            Math.hypot(candidate.x - center.x, candidate.z - center.z)
              >= supportClearanceRadius * 2 + supportGap
          ));
          const sharedCenter = !clearsSupports ? supportCenters.find((center) => (
            Math.hypot(candidate.x - center.x, candidate.z - center.z)
              < supportClearanceRadius * 2 + supportGap
            && Math.abs(candidateUndersideY - center.undersideY) <= 0.75
          )) : null;
          if (sharedCenter) {
            if (!supportStationsByEdge.has(edge.id)) supportStationsByEdge.set(edge.id, []);
            supportStationsByEdge.get(edge.id).push(supportS);
            return sharedSupportStation;
          }
          if (clearance?.clear === false && options.supportKind === 'elevated-road' && clearance.edgeId) {
            elevatedSupportBlockedByEdgeIds.add(clearance.edgeId);
          }
          if ((!clearance || clearance.clear !== false) && clearsSupports) {
            candidate.supportLateral = lateral;
            if (!installSupport(candidate, clearance, options.supportKind)) return null;
            if (!supportStationsByEdge.has(edge.id)) supportStationsByEdge.set(edge.id, []);
            supportStationsByEdge.get(edge.id).push(supportS);
            return supportS;
          }
          return undefined;
        }
      });
      const stageLabel = options.stageLabel || 'support-placement-search';
      while (true) {
        // One resume owns one complete clearance decision; no hidden inner scan can monopolize an idle slice.
        yield stageLabel;
        if (placementJob.step()) break;
      }
      const placement = placementJob.finish();
      if (placementJob.diagnostics.exhausted && options.recordFailure !== false) {
        supportPlacementFailureCount++;
      }
      return placement;
    }

    function segmentChordError(edgeId, startS, endS, lateral) {
      const start = sample(track, edgeId, startS, lateral, {});
      const middle = sample(track, edgeId, (startS + endS) * 0.5, lateral, {});
      const end = sample(track, edgeId, endS, lateral, {});
      return Math.hypot(
        middle.x - (start.x + end.x) * 0.5,
        middle.y - (start.y + end.y) * 0.5,
        middle.z - (start.z + end.z) * 0.5
      );
    }

    function installCurvedSpan(span, edge, side, verticalOffset, scaleX, scaleY, detailKind) {
      const spanLength = span.upperSpanEndS - span.upperSpanStartS;
      const segmentCount = Math.max(1, Math.ceil(spanLength / detailSegmentLength));
      for (let segment = 0; segment < segmentCount; segment++) {
        const startS = span.upperSpanStartS + spanLength * segment / segmentCount;
        const endS = span.upperSpanStartS + spanLength * (segment + 1) / segmentCount;
        const centerS = (startS + endS) * 0.5;
        const center = sample(track, edge.id, centerS, 0, {});
        const lateral = side * (sampledRoadHalf(center, edge) + (detailKind === 'rail' ? 0.16 : -0.48));
        const frame = sample(track, edge.id, centerS, lateral, {});
        const segmentLength = endS - startS;
        installDetailBox(
          structuralDetails,
          structuralDetailIndex++,
          frame,
          verticalOffset,
          { x: scaleX, y: scaleY, z: segmentLength + 0.08 }
        );
        const error = segmentChordError(edge.id, startS, endS, lateral);
        if (detailKind === 'rail') {
          maximumRailChordError = Math.max(maximumRailChordError, error);
          maximumRailSegmentLength = Math.max(maximumRailSegmentLength, segmentLength);
        } else {
          maximumGirderChordError = Math.max(maximumGirderChordError, error);
          maximumGirderSegmentLength = Math.max(maximumGirderSegmentLength, segmentLength);
          longitudinalGirderCount++;
        }
      }
    }

    function setGuidanceLightAt(index, frame, verticalOffset, scale) {
      detailRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
      detailUp.set(frame.upX, frame.upY, frame.upZ).normalize();
      detailBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
      detailBasis.makeBasis(detailRight, detailUp, detailBack);
      detailQuaternion.setFromRotationMatrix(detailBasis);
      detailPosition.set(
        frame.x - tileOrigin.x + detailUp.x * verticalOffset,
        frame.y + detailUp.y * verticalOffset,
        frame.z - tileOrigin.z + detailUp.z * verticalOffset
      );
      detailScale.set(scale.x, scale.y, scale.z);
      detailMatrix.compose(detailPosition, detailQuaternion, detailScale);
      underpassLights.setMatrixAt(index, detailMatrix);
    }

    function installGuidanceLight(frame, verticalOffset, scale) {
      const visualInstanceIndex = underpassLightIndex++;
      setGuidanceLightAt(visualInstanceIndex, frame, verticalOffset, scale);
      return visualInstanceIndex;
    }

    /**
     * Create one immutable world/local fixture contract. The renderer subtracts its floating origin and may bind
     * a pooled SpotLight only when the fixture can physically reach the player; visual tiles never allocate lights.
     */
    function createCoveredRouteLightEmitter({
      routeEdge,
      fixtureEdge,
      routeEdgeS,
      fixtureEdgeS,
      side,
      frame,
      verticalOffset,
      intensity,
      distance,
      kind,
      profile = null,
      visualInstanceIndex = null,
      housingInstanceIndex = null,
      powerMode = null
    }) {
      const upLength = Math.max(0.000_001, Math.hypot(frame.upX, frame.upY, frame.upZ));
      const upX = frame.upX / upLength;
      const upY = frame.upY / upLength;
      const upZ = frame.upZ / upLength;
      const absolutePosition = Object.freeze({
        x: frame.x + upX * verticalOffset,
        y: frame.y + upY * verticalOffset,
        z: frame.z + upZ * verticalOffset
      });
      const tileLocalPosition = Object.freeze({
        x: absolutePosition.x - tileOrigin.x,
        y: absolutePosition.y,
        z: absolutePosition.z - tileOrigin.z
      });
      const tileToken = track.graph?.tile?.token || track.graph?.version || 'template';
      return Object.freeze({
        id: `${tileToken}:${kind}:${fixtureEdge.id}:${Math.round(fixtureEdgeS * 1_000)}:${side}`,
        tileToken,
        coordinateMode: 'absolute-world-and-tile-local',
        absolutePosition,
        tileLocalPosition,
        direction: Object.freeze({ x: -upX, y: -upY, z: -upZ }),
        color: guidanceLightColor.getHex(),
        intensity,
        distance,
        kind,
        edge: routeEdge.id,
        fixtureEdge: fixtureEdge.id,
        profile: profile?.id || null,
        profileKind: profile?.kind || null,
        edgeS: routeEdgeS,
        fixtureEdgeS,
        side,
        visualInstanceIndex,
        housingInstanceIndex,
        powerMode
      });
    }

    function captureTunnelLightEmitter(
      edge,
      profile,
      edgeS,
      side,
      frame,
      verticalOffset,
      visualInstanceIndex,
      housingInstanceIndex
    ) {
      tunnelLightEmitters.push(createCoveredRouteLightEmitter({
        routeEdge: edge,
        fixtureEdge: edge,
        routeEdgeS: edgeS,
        fixtureEdgeS: edgeS,
        side,
        frame,
        verticalOffset,
        intensity: profile.kind === 'underground-tunnel' ? 720 : 560,
        distance: profile.kind === 'underground-tunnel' ? 30 : 28,
        kind: 'tunnel-ceiling-fixture',
        profile,
        visualInstanceIndex,
        housingInstanceIndex,
        powerMode: 'constant-on'
      }));
    }

    /** Bind each visible soffit cover to the lower road it illuminates instead of inventing a camera-following light. */
    function captureBridgeLightEmitter({
      lowerEdge,
      upperEdge,
      lowerEdgeS,
      upperEdgeS,
      side,
      frame,
      verticalOffset
    }) {
      bridgeLightEmitters.push(createCoveredRouteLightEmitter({
        routeEdge: lowerEdge,
        fixtureEdge: upperEdge,
        routeEdgeS: lowerEdgeS,
        fixtureEdgeS: upperEdgeS,
        side,
        frame,
        verticalOffset,
        intensity: 1_100,
        distance: 26,
        kind: 'bridge-soffit-fixture'
      }));
    }

    for (const crossing of crossings) {
      yield 'crossing-supports';
      const edgeId = crossing.upperEdgeId || crossing.upperEdge;
      const edgeS = crossing.upperEdgeS ?? crossing.upperS;
      const edge = track.getEdge?.(edgeId) || edgeVisuals.get(edgeId)?.edge;
      if (!edge || !Number.isFinite(edgeS)) continue;
      const lowerEdgeId = crossing.lowerEdgeId || crossing.lowerEdge;
      const lowerEdge = track.getEdge?.(lowerEdgeId) || edgeVisuals.get(lowerEdgeId)?.edge;
      const lowerEdgeS = crossing.lowerEdgeS ?? crossing.lowerS;
      const crossingFrame = sample(track, edgeId, edgeS, 0, {});
      const lowerFrame = sample(track, lowerEdgeId, lowerEdgeS, 0, {});
      const upperHalfWidth = sampledRoadHalf(crossingFrame, edge);
      const lowerHalfWidth = sampledRoadHalf(lowerFrame, lowerEdge);
      const longitudinalOffset = lowerHalfWidth + supportRoadGap + supportClearanceRadius;
      const crossingRight = new THREE.Vector3(
        crossingFrame.rightX,
        crossingFrame.rightY,
        crossingFrame.rightZ
      ).normalize();
      const crossingUp = new THREE.Vector3(crossingFrame.upX, crossingFrame.upY, crossingFrame.upZ).normalize();
      const crossingTangent = new THREE.Vector3(
        crossingFrame.tangentX,
        crossingFrame.tangentY,
        crossingFrame.tangentZ
      ).normalize();
      const crossingBasis = new THREE.Matrix4().makeBasis(crossingRight, crossingUp, crossingTangent);
      const crossingQuaternion = new THREE.Quaternion().setFromRotationMatrix(crossingBasis);
      const beamHeight = Number(bridgeContract.bridgeBeamDepth) || 0.38;
      const beamOffset = Math.min(12, Math.max(6, Number(crossing.maskSpan) * 0.18));
      for (const stationOffset of [-beamOffset, 0, beamOffset]) {
        // Each beam station is independently resumable before support-placement clearance searches begin.
        yield 'crossing-supports';
        const beamEdgeS = clamp(edgeS + stationOffset, 0, edge.length);
        const beamFrame = sample(track, edgeId, beamEdgeS, 0, {});
        crossingRight.set(beamFrame.rightX, beamFrame.rightY, beamFrame.rightZ).normalize();
        crossingUp.set(beamFrame.upX, beamFrame.upY, beamFrame.upZ).normalize();
        crossingTangent.set(beamFrame.tangentX, beamFrame.tangentY, beamFrame.tangentZ).normalize();
        crossingBasis.makeBasis(crossingRight, crossingUp, crossingTangent);
        crossingQuaternion.setFromRotationMatrix(crossingBasis);
        supportPosition.set(
          beamFrame.x - tileOrigin.x - crossingUp.x * (deckThickness + beamHeight * 0.5),
          beamFrame.y - crossingUp.y * (deckThickness + beamHeight * 0.5),
          beamFrame.z - tileOrigin.z - crossingUp.z * (deckThickness + beamHeight * 0.5)
        );
        supportScale.set(upperHalfWidth * 2 + 3.2, beamHeight, 0.92);
        supportMatrix.compose(supportPosition, crossingQuaternion, supportScale);
        beams.setMatrixAt(beamIndex++, supportMatrix);
        for (const side of [-1, 1]) {
          const fixtureFrame = sample(track, edgeId, beamEdgeS, side * upperHalfWidth * 0.58, {});
          const fixtureVerticalOffset = -(deckThickness + beamHeight + 0.07);
          setGuidanceLightAt(
            underpassLightIndex++,
            fixtureFrame,
            fixtureVerticalOffset,
            { x: 0.55, y: 0.12, z: 0.22 }
          );
          captureBridgeLightEmitter({
            lowerEdge,
            upperEdge: edge,
            lowerEdgeS,
            upperEdgeS: beamEdgeS,
            side,
            frame: fixtureFrame,
            verticalOffset: fixtureVerticalOffset
          });
          bridgeLightCount++;
        }
      }

      // Keep central-span station aggregation out of the final beam/light installation slice.
      yield 'crossing-supports';
      const centralCrossing = edge.family === 'outbound' && lowerEdge?.family === 'outbound';
      if (centralCrossing) {
        // Two upper carriageways share three directly loaded piers each instead of duplicating four corner sets per crossing.
        if (centralSupportEdges.has(edgeId)) continue;
        centralSupportEdges.add(edgeId);
        const edgeCrossings = crossings.filter((candidateCrossing) => (
          (candidateCrossing.upperEdgeId || candidateCrossing.upperEdge) === edgeId
        ));
        const stations = edgeCrossings.map((candidateCrossing) => (
          candidateCrossing.upperEdgeS ?? candidateCrossing.upperS
        ));
        const centerS = stations.reduce((sum, station) => sum + station, 0) / Math.max(1, stations.length);
        const supportSpacing = Math.max(24, Math.max(...stations) - Math.min(...stations));
        for (const stationOffset of [-supportSpacing, 0, supportSpacing]) {
          const placement = yield* placeSupportOnDeck(
            edgeId,
            edge,
            centerS + stationOffset,
            Math.sign(stationOffset) || 1,
            { stageLabel: 'crossing-supports' }
          );
          if (Number.isFinite(placement)) expectedSupportCount++;
        }
      } else {
        // Weave flyovers use one pier before and after the lower road, both centered beneath the supported deck.
        for (const along of [-1, 1]) {
          const placement = yield* placeSupportOnDeck(
            edgeId,
            edge,
            edgeS + along * longitudinalOffset,
            along,
            { stageLabel: 'crossing-supports' }
          );
          if (Number.isFinite(placement)) expectedSupportCount++;
        }
      }
    }

    /*
     * Crossings alone do not explain why kilometre-scale upper carriageways remain in the air. Sample every
     * static road at a fixed physical interval and add regular bents wherever the deck is visibly above the
     * world surface. A blocked candidate is intentionally left open for a lower carriageway; crossing-specific
     * supports already bracket that opening and are installed first so they retain placement priority.
     */
    for (const edge of edges) {
      if (isRuntimeOnlyEdge(edge)) continue;
      const candidateCount = Math.max(1, Math.ceil(edge.length / elevatedSupportSpacing));
      const stationInterval = edge.length / candidateCount;
      const eligibleStations = [];
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        yield 'elevated-road-supports';
        const initialS = stationInterval * (candidateIndex + 0.5);
        const initialFrame = sample(track, edge.id, initialS, 0, {});
        const initialUndersideY = verticalSupportDeckUndersideY(initialFrame, deckThickness);
        const initialGroundY = supportGroundHeightResolver.sample(
          initialFrame.x,
          initialFrame.z,
          {
            edgeId: edge.id,
            edgeS: initialS,
            lateral: 0,
            supportKind: 'elevated-road-candidate'
          }
        );
        if (initialUndersideY - initialGroundY < minimumVisiblePierHeight) continue;
        eligibleStations.push(initialS);
        elevatedSupportCandidateCount++;
        const sideOffset = Math.max(
          0,
          sampledRoadHalf(initialFrame, edge) - supportClearanceRadius - 0.9
        );
        const outerOffset = sampledRoadHalf(initialFrame, edge)
          + supportClearanceRadius + supportRoadGap + 3;
        const preferredSide = candidateIndex % 2 === 0 ? 1 : -1;
        const installedS = yield* placeSupportOnDeck(
          edge.id,
          edge,
          initialS,
          candidateIndex % 2 === 0 ? 1 : -1,
          {
            // Five bounded stations bracket a perpendicular lower road without scanning the full edge. Every
            // station/lateral clearance candidate resumes separately while retaining the historical order.
            attemptCount: 5,
            searchStep:
              sampledRoadHalf(initialFrame, edge) + supportRoadGap + supportClearanceRadius + 1.5,
            symmetric: true,
            // When a lower road occupies the deck centerline, a column directly under either deck edge
            // keeps the same station supported without piercing that protected carriageway.
            lateralOffsets: [
              0,
              preferredSide * sideOffset,
              -preferredSide * sideOffset,
              preferredSide * outerOffset,
              -preferredSide * outerOffset
            ],
            minimumPierHeight: minimumVisiblePierHeight,
            supportKind: 'elevated-road',
            // A lower road or dense junction is a designed opening, not a failed structural instance.
            recordFailure: false,
            stageLabel: 'elevated-road-supports'
          }
        );
        if (Number.isFinite(installedS)) {
          expectedSupportCount++;
        } else if (installedS === sharedSupportStation) {
          // A same-level sibling already owns the physical column at this station.
        } else {
          elevatedSupportBlockedCandidateCount++;
        }
      }

      if (eligibleStations.length === 0) continue;
      elevatedRoadEdgeCount++;
      const coverageSegments = splitElevatedStationSegments(eligibleStations, stationInterval);
      const coverageRanges = [];
      let edgeUnsupported = false;
      for (const segment of coverageSegments) {
        const coverageStart = Math.max(0, segment[0] - stationInterval * 0.5);
        const coverageEnd = Math.min(edge.length, segment[segment.length - 1] + stationInterval * 0.5);
        coverageRanges.push(Object.freeze([coverageStart, coverageEnd]));
        // Crossing bents count toward the same physical interval, while a grounded section between elevated
        // intervals is deliberately excluded instead of being misreported as a 300m unsupported bridge.
        const installedStations = (supportStationsByEdge.get(edge.id) || [])
          .filter((station) => station >= coverageStart && station <= coverageEnd)
          .sort((a, b) => a - b);
        if (installedStations.length === 0) {
          edgeUnsupported = true;
          recordElevatedSupportGap(edge.id, coverageEnd - coverageStart);
          continue;
        }
        let previousS = coverageStart;
        for (const installedS of installedStations) {
          recordElevatedSupportGap(edge.id, installedS - previousS);
          previousS = installedS;
        }
        recordElevatedSupportGap(edge.id, coverageEnd - previousS);
      }
      elevatedSupportCoverageByEdge.set(edge.id, Object.freeze(coverageRanges));
      if (edgeUnsupported) {
        elevatedSupportUnsupportedEdgeCount++;
        elevatedSupportUnsupportedEdgeIds.push(edge.id);
      }
    }

    const permanentSupportCount = supportIndex;
    const permanentSupportCapCount = supportCapIndex;
    const permanentExpectedSupportCount = expectedSupportCount;
    const permanentSupportFootingCount = supportFootingCount;
    const permanentSupportCenters = Object.freeze(supportCenters.map((center) => Object.freeze({ ...center })));
    let activeRuntimeSupportLayout = null;

    /** Compose detached instance matrices so an idle-prepared route variant can be published by pointer-sized uploads. */
    function composeRuntimeSupportRecord(frame, edgeId, edgeS) {
      const supportFrames = Array.isArray(frame.supportPairFrames)
        ? frame.supportPairFrames
        : [frame];
      const pairedPortal = supportFrames.length === 2;
      const capCenterX = supportFrames.reduce((sum, supportFrame) => sum + supportFrame.x, 0)
        / supportFrames.length;
      const capCenterY = supportFrames.reduce((sum, supportFrame) => sum + supportFrame.y, 0)
        / supportFrames.length;
      const capCenterZ = supportFrames.reduce((sum, supportFrame) => sum + supportFrame.z, 0)
        / supportFrames.length;
      const supportLateral = Number(frame.supportLateral) || 0;
      const transferCap = supportTransferCapLayout(
        supportLateral,
        Number(frame.roadHalf) || 0,
        supportRadius
      );
      const capCenterLateralOffset = transferCap.centerLateralOffset;
      const supportLegSpecs = supportFrames.map((supportFrame) => {
        const groundY = Number.isFinite(supportFrame.supportGroundY)
          ? supportFrame.supportGroundY
          : supportGroundHeightResolver.sample(supportFrame.x, supportFrame.z, {
              edgeId,
              edgeS,
              lateral: Number(supportFrame.supportLateral) || 0,
              supportKind: pairedPortal ? 'route-exterior-portal' : 'single-column'
            });
        const undersideY = verticalSupportDeckUndersideY(supportFrame, deckThickness);
        const topY = pairedPortal
          ? supportFrame.y + routeExteriorPortalClearHeight
          : undersideY;
        return Object.freeze({
          frame: supportFrame,
          groundY,
          topY,
          height: Math.max(0.8, topY - groundY)
        });
      });
      let portalSpan = 0;
      if (pairedPortal) {
        const firstLeg = supportLegSpecs[0];
        const secondLeg = supportLegSpecs[1];
        detailRight.set(
          secondLeg.frame.x - firstLeg.frame.x,
          secondLeg.topY - firstLeg.topY,
          secondLeg.frame.z - firstLeg.frame.z
        );
        portalSpan = detailRight.length();
        if (portalSpan > 0.000_001) detailRight.multiplyScalar(1 / portalSpan);
        else detailRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
        detailBack.set(
          -(firstLeg.frame.tangentX + secondLeg.frame.tangentX),
          -(firstLeg.frame.tangentY + secondLeg.frame.tangentY),
          -(firstLeg.frame.tangentZ + secondLeg.frame.tangentZ)
        );
        detailBack.addScaledVector(detailRight, -detailBack.dot(detailRight));
        if (detailBack.lengthSq() <= 0.000_000_000_001) {
          detailBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ);
          detailBack.addScaledVector(detailRight, -detailBack.dot(detailRight));
        }
        detailBack.normalize();
        detailUp.crossVectors(detailBack, detailRight).normalize();
        const averageUpDot = detailUp.x
            * (firstLeg.frame.upX + secondLeg.frame.upX)
          + detailUp.y * (firstLeg.frame.upY + secondLeg.frame.upY)
          + detailUp.z * (firstLeg.frame.upZ + secondLeg.frame.upZ);
        if (averageUpDot < 0) {
          detailUp.negate();
          detailBack.negate();
        }
      } else {
        detailRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
        detailUp.set(frame.upX, frame.upY, frame.upZ).normalize();
        detailBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
      }
      detailBasis.makeBasis(detailRight, detailUp, detailBack);
      detailQuaternion.setFromRotationMatrix(detailBasis);
      const capWidth = pairedPortal
        ? portalSpan + supportRadius * 2
        : transferCap.width;
      const capDepth = pairedPortal
        ? clamp(
            capWidth / routeExteriorPortalMaximumSpanDepthRatio,
            routeExteriorPortalMinimumCapDepth,
            routeExteriorPortalMaximumCapDepth
          )
        : transferCap.capDepth;
      const pierMatrices = [];
      const footingMatrices = [];
      const supportLegs = [];
      let groundContactError = 0;
      for (const spec of supportLegSpecs) {
        const supportFrame = spec.frame;
        supportQuaternion.setFromAxisAngle(yAxis, supportFrame.yaw);
        supportPosition.set(
          supportFrame.x - tileOrigin.x,
          spec.groundY + spec.height * 0.5,
          supportFrame.z - tileOrigin.z
        );
        supportScale.set(1, spec.height, 1);
        supportMatrix.compose(supportPosition, supportQuaternion, supportScale);
        pierMatrices.push(supportMatrix.clone());
        groundContactError = Math.max(
          groundContactError,
          Math.abs(supportPosition.y - spec.height * 0.5 - spec.groundY)
        );
        supportPosition.set(
          supportFrame.x - tileOrigin.x,
          spec.groundY + supportFootingCenterOffsetY,
          supportFrame.z - tileOrigin.z
        );
        supportScale.set(supportFootingWidth, supportFootingHeight, supportFootingDepth);
        supportMatrix.compose(supportPosition, supportQuaternion, supportScale);
        footingMatrices.push(supportMatrix.clone());
        supportLegs.push(Object.freeze({
          x: supportFrame.x,
          z: supportFrame.z,
          lateral: Number(supportFrame.supportLateral) || 0,
          groundY: spec.groundY,
          topY: spec.topY,
          height: spec.height
        }));
      }
      let capPierTopAlignmentError = 0;
      let invalidOutwardCapOverhang = 0;
      let pierCapOverlap = supportRadius * 2;
      if (pairedPortal) {
        // The beam basis comes from the two real column-top points, not only the first curved-road sample. Its
        // bottom plane therefore intersects both world-vertical legs even when bank/tangent differ across the span.
        const portalTopCenterY = supportLegSpecs.reduce((sum, spec) => sum + spec.topY, 0)
          / supportLegSpecs.length;
        supportPosition.set(
          capCenterX - tileOrigin.x + detailUp.x * capDepth * 0.5,
          portalTopCenterY + detailUp.y * capDepth * 0.5,
          capCenterZ - tileOrigin.z + detailUp.z * capDepth * 0.5
        );
        for (const spec of supportLegSpecs) {
          const offsetX = spec.frame.x - capCenterX;
          const offsetY = spec.topY - portalTopCenterY;
          const offsetZ = spec.frame.z - capCenterZ;
          capPierTopAlignmentError = Math.max(
            capPierTopAlignmentError,
            Math.abs(offsetX * detailUp.x + offsetY * detailUp.y + offsetZ * detailUp.z),
            Math.abs(
              offsetX * detailBack.x + offsetY * detailBack.y + offsetZ * detailBack.z
            )
          );
        }
      } else {
        // The local bearing zone stays over the world-vertical shaft; an exterior transfer reach may move only
        // along detailRight toward its side girder. The top plane still crosses the exact deck-bottom intersection.
        const capHalfDepth = capDepth * 0.5;
        const capCenterWorldY = supportLegSpecs[0].topY
          - capHalfDepth / Math.max(0.000_001, Math.abs(detailUp.y))
          + detailRight.y * capCenterLateralOffset;
        supportPosition.set(
          capCenterX - tileOrigin.x + detailRight.x * capCenterLateralOffset,
          capCenterWorldY,
          capCenterZ - tileOrigin.z + detailRight.z * capCenterLateralOffset
        );
        capPierTopAlignmentError = Math.abs(
          (-detailRight.x * capCenterLateralOffset) * detailUp.x
            + (supportLegSpecs[0].topY - capCenterWorldY) * detailUp.y
            + (-detailRight.z * capCenterLateralOffset) * detailUp.z
            - capHalfDepth
        );
        pierCapOverlap = transferCap.pierOverlap;
        invalidOutwardCapOverhang = transferCap.invalidOutwardOverhang;
      }
      supportScale.set(
        capWidth,
        capDepth,
        pairedPortal ? 1.8 : transferCap.longitudinalDepth
      );
      supportMatrix.compose(supportPosition, detailQuaternion, supportScale);
      const capMatrix = supportMatrix.clone();
      const capMatrices = [capMatrix];
      if (pairedPortal) {
        const hangerLateral = (Number(frame.roadHalf) || 0) + 0.42;
        const hangerHeight = routeExteriorPortalClearHeight + deckThickness;
        const hangerCenterOffsetY = (routeExteriorPortalClearHeight - deckThickness) * 0.5;
        for (const side of [-1, 1]) {
          const lateral = hangerLateral * side;
          const hangerSurfaceY = capCenterY + detailRight.y * lateral;
          supportPosition.set(
            capCenterX - tileOrigin.x + detailRight.x * lateral,
            hangerSurfaceY + hangerCenterOffsetY,
            capCenterZ - tileOrigin.z + detailRight.z * lateral
          );
          supportQuaternion.setFromAxisAngle(yAxis, frame.yaw);
          supportScale.set(
            routeExteriorPortalHangerWidth,
            hangerHeight,
            routeExteriorPortalHangerDepth
          );
          supportMatrix.compose(supportPosition, supportQuaternion, supportScale);
          capMatrices.push(supportMatrix.clone());
        }
      }
      return Object.freeze({
        edgeId,
        edgeS,
        x: capCenterX,
        z: capCenterZ,
        supportKind: pairedPortal ? 'route-exterior-portal' : 'single-column',
        supportLegs: Object.freeze(supportLegs),
        supportLaterals: Object.freeze(supportLegs.map((leg) => leg.lateral)),
        structuralMode: pairedPortal ? 'overhead-suspended-portal' : 'underdeck-bearing-cap',
        portalSpan,
        capWidth,
        capDepth,
        portalClearHeight: pairedPortal ? routeExteriorPortalClearHeight : 0,
        supportClearanceRadius,
        height: Math.min(...supportLegs.map((leg) => leg.height)),
        groundContactError,
        capPierTopAlignmentError,
        invalidOutwardCapOverhang,
        pierCapOverlap,
        transferReach: pairedPortal ? 0 : transferCap.transferReach,
        capCenterLateralOffset: pairedPortal ? 0 : capCenterLateralOffset,
        capEndOverlap: pairedPortal ? supportRadius : transferCap.endOverlap,
        pierMatrix: pierMatrices[0],
        capMatrix,
        footingMatrix: footingMatrices[0],
        pierMatrices: Object.freeze(pierMatrices),
        capMatrices: Object.freeze(capMatrices),
        footingMatrices: Object.freeze(footingMatrices)
      });
    }

    /**
     * Prepare support matrices for recovery, launch, and bidirectional visual roads one candidate per idle step.
     * Permanent crossing/template supports participate in spacing, while the route variant remains detached until
     * activation so a changed exit cannot leave orphaned piers in the scene.
     */
    function createRuntimeSupportLayoutJob(runtimeTrack, runtimeEdges) {
      return createRuntimeSupportPlacementJob({
        runtimeTrack,
        runtimeEdges,
        deckThickness,
        // Each prepared route variant owns a detached audit snapshot; sharing counters would make an inactive
        // speculative build look like ground work performed by the currently published road.
        supportGroundHeightResolver: createSupportGroundHeightResolver(options, runtimeTrack),
        minimumVisiblePierHeight,
        elevatedSupportSpacing,
        supportRadius,
        supportClearanceRadius,
        supportRoadGap,
        supportGap,
        routeExteriorPortalClearHeight,
        permanentSupportCenters,
        composeRecord: composeRuntimeSupportRecord
      });
    }

    /** Prove a detached route's complete pier/cap cardinality before any visible geometry pointer changes. */
    function assertRuntimeSupportLayoutCapacity(layout) {
      const records = layout?.records || [];
      const runtimePierCount = records.reduce(
        (sum, record) => sum + (record.pierMatrices?.length || (record.pierMatrix ? 1 : 0)),
        0
      );
      const runtimeCapCount = records.reduce(
        (sum, record) => sum
          + (record.capMatrices?.length || (record.capMatrix ? 1 : 0))
          + (record.footingMatrices?.length || (record.footingMatrix ? 1 : 0)),
        0
      );
      if (
        permanentSupportCount + runtimePierCount > supportCapacity
        || permanentSupportCapCount + runtimeCapCount > supportCapacity * 3
      ) {
        throw new Error('Prepared runtime bridge-support layout exceeds the resident instance capacity');
      }
      return Object.freeze({ layout, records, runtimePierCount, runtimeCapCount });
    }

    /** Publish one prepared runtime layout after the permanent matrices; no mesh or material is reallocated. */
    function activateRuntimeSupportLayout(layout, validatedCapacity = null) {
      const capacity = validatedCapacity?.layout === layout
        ? validatedCapacity
        : assertRuntimeSupportLayoutCapacity(layout);
      const { records, runtimePierCount, runtimeCapCount } = capacity;
      supportIndex = permanentSupportCount;
      supportCapIndex = permanentSupportCapCount;
      for (const record of records) {
        for (const matrix of record.pierMatrices || [record.pierMatrix]) {
          supports.setMatrixAt(supportIndex++, matrix);
        }
        for (const matrix of record.capMatrices || [record.capMatrix]) {
          supportCaps.setMatrixAt(supportCapIndex++, matrix);
        }
        for (const matrix of record.footingMatrices || [record.footingMatrix]) {
          supportCaps.setMatrixAt(supportCapIndex++, matrix);
        }
      }
      supports.count = supportIndex;
      supports.instanceMatrix.needsUpdate = true;
      supportCaps.count = supportCapIndex;
      supportCaps.instanceMatrix.needsUpdate = true;
      supports.computeBoundingSphere?.();
      supportCaps.computeBoundingSphere?.();
      activeRuntimeSupportLayout = layout;
      // The guards preserve the standalone audit hook that evaluates this function without the visual registry.
      if (typeof synchronizeInstancedCameraBlockers === 'function') {
        synchronizeInstancedCameraBlockers(
          typeof supportCameraBlockers === 'undefined' ? null : supportCameraBlockers,
          supports
        );
        synchronizeInstancedCameraBlockers(
          typeof supportCapCameraBlockers === 'undefined' ? null : supportCapCameraBlockers,
          supportCaps
        );
      }
    }

    const initialRuntimeSupportJob = createRuntimeSupportLayoutJob(
      track,
      preparedTemplate.recoveryTemplate.edges
    );
    while (!initialRuntimeSupportJob.step()) yield 'runtime-road-supports';
    preparedTemplate.recoveryTemplate.supportLayout = initialRuntimeSupportJob.finish();
    activateRuntimeSupportLayout(preparedTemplate.recoveryTemplate.supportLayout);

    const railStations = new Set();
    const addedGirderDepth = Math.min(Number(bridgeContract.bridgeBeamDepth) || 0.38, 0.34);
    maximumAddedSoffitDepth = addedGirderDepth;
    for (const span of physicalSpans) {
      yield 'physical-span-details';
      const edge = track.getEdge?.(span.upperEdgeId) || edgeVisuals.get(span.upperEdgeId)?.edge;
      if (!edge) continue;
      for (const side of [-1, 1]) {
        installCurvedSpan(
          span,
          edge,
          side,
          -deckThickness - addedGirderDepth * 0.5,
          0.42,
          addedGirderDepth,
          'girder'
        );
        for (const height of [0.68, 1.24]) {
          installCurvedSpan(span, edge, side, height, 0.10, 0.10, 'rail');
        }
      }
      for (const jointS of [span.upperSpanStartS, span.upperSpanEndS]) {
        const center = sample(track, edge.id, jointS, 0, {});
        const jointSurfaceOffset = 0.132_5;
        installDetailBox(
          structuralDetails,
          structuralDetailIndex++,
          center,
          jointSurfaceOffset,
          { x: sampledRoadHalf(center, edge) * 2 + 0.5, y: 0.055, z: 0.24 }
        );
        const expectedJointX = center.x - tileOrigin.x + center.upX * jointSurfaceOffset;
        const expectedJointY = center.y + center.upY * jointSurfaceOffset;
        const expectedJointZ = center.z - tileOrigin.z + center.upZ * jointSurfaceOffset;
        expansionJointSurfaceError = Math.max(
          expansionJointSurfaceError,
          Math.hypot(
            detailPosition.x - expectedJointX,
            detailPosition.y - expectedJointY,
            detailPosition.z - expectedJointZ
          )
        );
        expansionJointCount++;
      }
      const postCount = Math.max(1, Math.ceil(
        (span.upperSpanEndS - span.upperSpanStartS) / detailSegmentLength
      ));
      for (let stationIndex = 0; stationIndex <= postCount; stationIndex++) {
        const station = span.upperSpanStartS
          + (span.upperSpanEndS - span.upperSpanStartS) * stationIndex / postCount;
        for (const side of [-1, 1]) {
          const stationKey = `${span.physicalSpanId}:${side}:${Math.round(station * 1_000)}`;
          if (railStations.has(stationKey)) {
            duplicateRailStationCount++;
            continue;
          }
          railStations.add(stationKey);
          const center = sample(track, edge.id, station, 0, {});
          const lateral = side * (sampledRoadHalf(center, edge) + 0.16);
          const safeHalf = sampledRoadHalf(center, edge) - 0.58;
          if (Math.abs(lateral) - 0.06 <= safeHalf + 0.000_1) solidSafeCorridorViolationCount++;
          const frame = sample(track, edge.id, station, lateral, {});
          captureRailPost(frame, 0.76, { x: 0.12, y: 1.52, z: 0.12 });
          railPostCount++;
        }
      }
    }

    /**
     * Portal/rib boxes now decorate the exact shared shell stations; they no longer approximate curved roofs or
     * walls. The swept enclosure owns continuous coverage while ribs retain the existing structural cadence.
     */
    const bridgeBeamCount = beamIndex;
    const tunnelBeamRanges = [];
    for (const spec of tunnelProfileSpecs) {
      yield 'tunnel-galleries';
      const { edge, profile, segmentCount, ribStations } = spec;
      const tunnelBeamStart = beamIndex;
      const clearance = Math.max(3.4, Number(profile.clearance) || 3.6);
      for (let index = 0; index <= segmentCount; index++) {
        const edgeS = ribStations[index];
        const center = sample(track, edge.id, edgeS, 0, {});
        const ribIrradiance = sampleEdgeStaticTunnelIrradiance(
          [spec.staticIrradianceProfile],
          edgeS
        ) * STATIC_TUNNEL_IRRADIANCE_CONTRACT.receiverGain.structuralRib;
        const ribEnclosure = sampleTunnelEnclosure(profile, edgeS);
        const roadHalfAtStation = sampledRoadHalf(center, edge);
        const portal = index === 0 || index === segmentCount;
        const pillarWidth = profile.kind === 'mountain-tunnel' ? 0.82 : undergroundWallThickness;
        const frameDepth = portal ? Number(profile.portalFrameDepth) || 2.4 : 0.72;
        const beamThickness = profile.kind === 'mountain-tunnel' ? 0.82 : 0.58;
        const pillarHeight = clearance;
        const pillarLateral = roadHalfAtStation
          + (profile.kind === 'mountain-tunnel'
            ? 0.92
            : undergroundWallInset + UNDERGROUND_PORTAL_RIB_ROAD_CLEARANCE_M);
        if (profile.kind === 'underground-tunnel') {
          minimumUndergroundPortalRoadClearanceM = Math.min(
            minimumUndergroundPortalRoadClearanceM,
            pillarLateral - pillarWidth * 0.5 - (roadHalfAtStation + roadShoulderJoin)
          );
        }
        for (const side of [-1, 1]) {
          const safeHalf = Math.max(0, roadHalfAtStation - 0.58);
          if (pillarLateral - pillarWidth * 0.5 <= safeHalf + 0.000_1) {
            tunnelSafeCorridorViolationCount++;
            solidSafeCorridorViolationCount++;
          }
          const pillarFrame = sample(track, edge.id, edgeS, side * pillarLateral, {});
          const pillarInstanceIndex = beamIndex++;
          installDetailBox(
            beams,
            pillarInstanceIndex,
            pillarFrame,
            pillarHeight * 0.5,
            { x: pillarWidth, y: pillarHeight, z: frameDepth }
          );
          beamStaticTunnelIrradiance.setX(pillarInstanceIndex, ribIrradiance);
          beamTunnelEnclosure.setX(pillarInstanceIndex, ribEnclosure);
        }
        const headerInstanceIndex = beamIndex++;
        installDetailBox(
          beams,
          headerInstanceIndex,
          center,
          clearance + beamThickness * 0.5,
          {
            x: (roadHalfAtStation
              + (profile.kind === 'mountain-tunnel' ? 1.34 : undergroundRoofInset)) * 2,
            y: beamThickness,
            z: frameDepth
          }
        );
        beamStaticTunnelIrradiance.setX(headerInstanceIndex, ribIrradiance);
        beamTunnelEnclosure.setX(headerInstanceIndex, ribEnclosure);
        tunnelRibCount++;
        if (portal) tunnelPortalCount++;

      }
      /*
       * Luminaires follow their own dense electrical cadence rather than sparse decorative ribs. Each powered
       * diffuser has one opaque housing and one immutable emitter record, so the light is visibly on throughout
       * the tunnel while the central renderer may pool only the nearest authored physical cones.
       */
      tunnelLuminaireMaximumSpacingM = Math.max(
        tunnelLuminaireMaximumSpacingM,
        Number(spec.luminaireSpacingM) || 0
      );
      for (const edgeS of spec.luminaireStations) {
        const center = sample(track, edge.id, edgeS, 0, {});
        const roadHalfAtStation = sampledRoadHalf(center, edge);
        for (const side of [-1, 1]) {
          const lightFrame = sample(track, edge.id, edgeS, side * roadHalfAtStation * 0.48, {});
          const housingInstanceIndex = beamIndex++;
          installDetailBox(
            beams,
            housingInstanceIndex,
            lightFrame,
            clearance - 0.34,
            { x: 0.44, y: 0.18, z: 2.4 }
          );
          beamStaticTunnelIrradiance.setX(
            housingInstanceIndex,
            sampleEdgeStaticTunnelIrradiance([spec.staticIrradianceProfile], edgeS)
              * STATIC_TUNNEL_IRRADIANCE_CONTRACT.receiverGain.luminaireHousing
          );
          beamTunnelEnclosure.setX(housingInstanceIndex, sampleTunnelEnclosure(profile, edgeS));
          tunnelLuminaireHousingIndices.push(housingInstanceIndex);
          tunnelLuminaireHousingCount++;
          const diffuserVerticalOffset = clearance - 0.46;
          const visualInstanceIndex = installGuidanceLight(
            lightFrame,
            diffuserVerticalOffset,
            { x: 0.28, y: 0.055, z: 2.06 }
          );
          captureTunnelLightEmitter(
            edge,
            profile,
            edgeS,
            side,
            lightFrame,
            diffuserVerticalOffset,
            visualInstanceIndex,
            housingInstanceIndex
          );
          tunnelLightCount++;
        }
      }
      if (profile.multiOpeningGallery) mountainOpeningCount += segmentCount * 2;
      tunnelBeamRanges.push(Object.freeze({
        start: tunnelBeamStart,
        end: beamIndex,
        kind: profile.kind
      }));
    }

    // Reflectors share the under-deck candle-star batch, so the quieter inscription color adds no light or draw.
    const curveReflectorInstanceStart = underpassLightIndex;
    for (const edge of curvedEdges) {
      yield 'curve-reflectors';
      const spacing = qualityProfile?.id === 'mobile' ? 44 : 32;
      const sampleCount = Math.max(1, Math.floor(edge.length / spacing));
      const curveSign = Math.sign(edge.geometrySegments?.find((segment) => Number(segment.sweep))?.sweep || 1);
      for (let index = 1; index <= sampleCount; index++) {
        const edgeS = edge.length * index / (sampleCount + 1);
        const center = sample(track, edge.id, edgeS, 0, {});
        const frame = sample(
          track,
          edge.id,
          edgeS,
          curveSign * (sampledRoadHalf(center, edge) + 0.21),
          {}
        );
        installGuidanceLight(frame, 0.72, { x: 0.34, y: 0.16, z: 0.10 });
        reflectorCount++;
      }
    }
    const curveReflectorInstanceEnd = underpassLightIndex;
    const decisionPylonInstanceStart = structuralDetailIndex;
    const decisionReflectorInstanceStart = underpassLightIndex;
    const decisionPylonInstanceEnd = decisionPylonInstanceStart + decisionStructureNodeCapacity * 2;
    const decisionReflectorInstanceEnd = decisionReflectorInstanceStart + decisionStructureNodeCapacity * 2;
    const hiddenDecisionStructureMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const decisionStructureCameraBlockers = Object.freeze(Array.from(
      { length: decisionStructureNodeCapacity * 2 },
      (_, index) => Object.seal({
        id: `${trafficTileToken}:decision-pylon:${index}`,
        kind: 'wind-eroded-decision-pylon',
        coordinateMode: FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.coordinateMode,
        visible: false,
        layoutVisible: false,
        x: 0,
        y: 0,
        z: 0,
        radiusM: 0.42,
        minY: 0,
        maxY: 0
      })
    ));

    /** Resolve required instances without mutating a resident visual, so overflow fails before an atomic swap. */
    function resolveDecisionStructureEntries(activeTrack, activeNodes) {
      const entries = [];
      for (const node of activeNodes) {
        const incomingId = node.inEdges?.[0] || node.incomingEdgeIds?.[0];
        const incoming = activeTrack.getEdge?.(incomingId);
        if (incoming) entries.push(Object.freeze({ node, incoming }));
      }
      return entries;
    }

    function assertDecisionStructureCapacity(entries) {
      if (entries.length > decisionStructureNodeCapacity) {
        throw new Error('Recovery variant exceeds the reserved decision-structure capacity');
      }
    }

    /**
     * Rewrite a fixed reserved range. Smaller variants zero every unused matrix instead of moving the rail-post
     * range or leaving the removed straight-fork pylons and reflectors floating above an opposing crossover.
     */
    function rewriteDecisionStructures(
      activeTrack,
      activeNodes,
      auditSafeCorridor = false,
      preparedEntries = null
    ) {
      const entries = preparedEntries || resolveDecisionStructureEntries(activeTrack, activeNodes);
      assertDecisionStructureCapacity(entries);
      for (const blocker of decisionStructureCameraBlockers) {
        blocker.layoutVisible = false;
        blocker.visible = false;
      }
      let pylonIndex = decisionPylonInstanceStart;
      let reflectorIndex = decisionReflectorInstanceStart;
      let cameraBlockerIndex = 0;
      for (const { incoming } of entries) {
        const station = Math.max(0, incoming.length - 9);
        const center = sample(activeTrack, incoming.id, station, 0, {});
        const roadHalfAtGate = sampledRoadHalf(center, incoming);
        for (const side of [-1, 1]) {
          const lateral = side * (roadHalfAtGate + 1.05);
          const safeHalf = roadHalfAtGate - 0.58;
          if (auditSafeCorridor && Math.abs(lateral) - 0.14 <= safeHalf + 0.000_1) {
            solidSafeCorridorViolationCount++;
          }
          const pylonFrame = sample(activeTrack, incoming.id, station, lateral, {});
          installDetailBox(
            structuralDetails,
            pylonIndex++,
            pylonFrame,
            SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.verticalOffsetM,
            SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.localScale
          );
          const cameraBlocker = decisionStructureCameraBlockers[cameraBlockerIndex++];
          cameraBlocker.layoutVisible = true;
          cameraBlocker.visible = group.visible;
          cameraBlocker.x = pylonFrame.x;
          cameraBlocker.y = pylonFrame.y
            + SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.verticalOffsetM;
          cameraBlocker.z = pylonFrame.z;
          cameraBlocker.minY = pylonFrame.y;
          cameraBlocker.maxY = pylonFrame.y
            + SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.localScale.y;
          const reflectorFrame = sample(
            activeTrack,
            incoming.id,
            station,
            side * (roadHalfAtGate + 0.24),
            {}
          );
          setGuidanceLightAt(
            reflectorIndex++,
            reflectorFrame,
            SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.verticalOffsetM,
            SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.localScale
          );
        }
      }
      for (let index = pylonIndex; index < decisionPylonInstanceEnd; index++) {
        structuralDetails.setMatrixAt(index, hiddenDecisionStructureMatrix);
      }
      for (let index = reflectorIndex; index < decisionReflectorInstanceEnd; index++) {
        underpassLights.setMatrixAt(index, hiddenDecisionStructureMatrix);
      }
      structuralDetails.instanceMatrix.needsUpdate = true;
      underpassLights.instanceMatrix.needsUpdate = true;
      return Object.freeze({ pylonIndex, reflectorIndex, structureCount: entries.length });
    }
    const initialDecisionStructures = rewriteDecisionStructures(track, decisionStructureNodes, true);
    let activeDecisionStructureCount = initialDecisionStructures.structureCount;
    structuralDetailIndex = decisionPylonInstanceEnd;
    underpassLightIndex = decisionReflectorInstanceEnd;
    reflectorCount += initialDecisionStructures.structureCount * 2;
    yield 'decision-pylons';
    supports.count = supportIndex;
    supports.instanceMatrix.needsUpdate = true;
    supportCaps.count = supportCapIndex;
    supportCaps.instanceMatrix.needsUpdate = true;
    beams.count = beamIndex;
    beams.instanceMatrix.needsUpdate = true;
    beamStaticTunnelIrradiance.needsUpdate = true;
    beamTunnelEnclosure.needsUpdate = true;
    let tunnelStructureIrradiancePositiveInstanceCount = 0;
    let tunnelStructureIrradianceMinimumReceiver = Number.POSITIVE_INFINITY;
    let tunnelStructureIrradianceMaximum = 0;
    for (let index = 0; index < beamIndex; index++) {
      const value = beamStaticTunnelIrradiance.getX(index);
      if (!(value > 0)) continue;
      tunnelStructureIrradiancePositiveInstanceCount++;
      tunnelStructureIrradianceMinimumReceiver = Math.min(
        tunnelStructureIrradianceMinimumReceiver,
        value
      );
      tunnelStructureIrradianceMaximum = Math.max(tunnelStructureIrradianceMaximum, value);
    }
    // All four roles stay inside one matte warm-stone family; value and temperature replace metallic semantics.
    const bridgeBeamColor = new THREE.Color(0x98_795d);
    const mountainBeamColor = new THREE.Color(0xb2_875b);
    const undergroundBeamColor = new THREE.Color(0x7f_6856);
    const luminaireHousingColor = new THREE.Color(0x59_4232);
    for (let index = 0; index < bridgeBeamCount; index++) beams.setColorAt(index, bridgeBeamColor);
    for (const range of tunnelBeamRanges) {
      const color = range.kind === 'mountain-tunnel' ? mountainBeamColor : undergroundBeamColor;
      for (let index = range.start; index < range.end; index++) beams.setColorAt(index, color);
    }
    for (const index of tunnelLuminaireHousingIndices) {
      beams.setColorAt(index, luminaireHousingColor);
    }
    if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
    underpassLights.count = underpassLightIndex;
    underpassLights.instanceMatrix.needsUpdate = true;
    for (let index = 0; index < underpassLightIndex; index++) {
      underpassLights.setColorAt(index, guidanceLightColor);
    }
    for (let index = curveReflectorInstanceStart; index < curveReflectorInstanceEnd; index++) {
      underpassLights.setColorAt(index, wayfindingInscriptionColor);
    }
    for (let index = decisionReflectorInstanceStart; index < decisionReflectorInstanceEnd; index++) {
      underpassLights.setColorAt(index, wayfindingInscriptionColor);
    }
    if (underpassLights.instanceColor) underpassLights.instanceColor.needsUpdate = true;
    const frozenBridgeLightEmitters = Object.freeze(bridgeLightEmitters);
    const frozenTunnelLightEmitters = Object.freeze(tunnelLightEmitters);
    const frozenCoveredRouteLightEmitters = Object.freeze([
      ...frozenBridgeLightEmitters,
      ...frozenTunnelLightEmitters
    ]);
    if (frozenBridgeLightEmitters.length !== bridgeLightCount) {
      throw new Error('Bridge soffit fixture and emitter cardinality diverged');
    }
    if (frozenTunnelLightEmitters.length !== tunnelLightCount) {
      throw new Error('Tunnel fixture and emitter cardinality diverged');
    }
    const structuralDetailCount = structuralDetailIndex;
    for (const matrix of railPostMatrices) structuralDetails.setMatrixAt(structuralDetailIndex++, matrix);
    const permanentStructuralDetailCount = structuralDetailIndex;
    let activeRuntimeLongSpanStructureCount = 0;

    /** Reject an oversized detached route structure before a variant can alter any visible road pointer. */
    function assertRuntimeRouteStructureCapacity(matrices = []) {
      if (
        matrices.length > RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY
        || permanentStructuralDetailCount + matrices.length > structuralDetails.instanceMatrix.count
      ) {
        throw new Error('Prepared runtime route structure exceeds the resident instance capacity');
      }
      return matrices;
    }

    /**
     * Publish prepared tower, girder, and stay matrices after all permanent structural instances. Reducing the
     * mesh count on a normal variant removes every prior long-span instance, so a route swap cannot leave a
     * floating pylon behind.
     */
    function activateRuntimeLongSpanStructures(matrices = []) {
      assertRuntimeRouteStructureCapacity(matrices);
      for (let index = 0; index < matrices.length; index++) {
        structuralDetails.setMatrixAt(permanentStructuralDetailCount + index, matrices[index]);
      }
      activeRuntimeLongSpanStructureCount = matrices.length;
      structuralDetails.count = permanentStructuralDetailCount + matrices.length;
      structuralDetails.instanceMatrix.needsUpdate = true;
      structuralDetails.computeBoundingSphere?.();
      // The activation helper is also source-evaluated by the matrix-only unit audit without a visual registry.
      if (typeof synchronizeStructuralDetailCameraBlockers === 'function') {
        synchronizeStructuralDetailCameraBlockers();
      }
    }

    preparedTemplate.recoveryTemplate.longSpanStructureMatrices =
      composeRuntimeLongSpanStructureMatrices(
        preparedTemplate.recoveryTemplate.variantTrack || track,
        preparedTemplate.recoveryTemplate.supportLayout
      );
    activateRuntimeLongSpanStructures(
      preparedTemplate.recoveryTemplate.longSpanStructureMatrices
    );
    yield 'structural-finalize';

    const signSpecs = [];
    const signKeys = new Set();
    for (const movement of movementList(track)) {
      yield 'exit-sign-specs';
      if (movement.kind !== 'right' && movement.kind !== 'left'
        && movement.kind !== 'direct-right' && movement.kind !== 'loop-left') continue;
      const kind = movement.kind === 'right' || movement.kind === 'direct-right' ? 'right' : 'left';
      const decisionNodeId = movement.collectorDecisionNodeId || movement.decisionNodeId;
      const key = `${decisionNodeId || 'decision'}:${movement.id}`;
      if (signKeys.has(key)) continue;
      const decisionNode = track.getNode?.(decisionNodeId)
        || nodeList(track).find((node) => node.id === decisionNodeId);
      const edgeId = decisionNode?.inEdges?.[0] || decisionNode?.incomingEdgeIds?.[0];
      const edge = track.getEdge?.(edgeId) || edgeVisuals.get(edgeId)?.edge;
      if (!edge) continue;
      signKeys.add(key);
      const exitPort = movement.exitPort || edge.exitPort;
      const exitNumber = kind === 'right' ? '2A' : '2B';
      const distanceM = 120;
      const text = `${exitNumber} ${directionLabel(exitPort)} ${distanceM} 米`;
      const signS = Math.max(0, edge.length - 120);
      const signCenter = sample(track, edge.id, signS, 0, {});
      const frame = sample(track, edge.id, signS, sampledRoadHalf(signCenter, edge), {});
      // The atlas is a fixed 120m physical distance plate; shared guidance selects which indexed plate is visible.
      signSpecs.push(Object.freeze({
        key,
        movementId: movement.id,
        decisionNodeId,
        primaryDecisionNodeId: movement.decisionNodeId,
        entryPort: movement.entryPort,
        kind,
        exitNumber,
        exitPort,
        distanceM,
        text,
        frame
      }));
    }
    const exitSigns = createExitSignBatch(
      THREE,
      signSpecs,
      tileOrigin,
      options.onPresentationTexturesChanged
    );
    own(exitSigns.geometry);
    // The atlas is shared across residents; cancellation returns its lease instead of disposing its material.
    own({ dispose: () => exitSigns.userData.releaseAtlas?.() });
    exitSigns.visible = false;
    markShadowExempt(exitSigns, 'Transparent sign atlas has no opaque shadow silhouette.');
    if (markEffect) markEffect(exitSigns, 'cloverleaf-exit-sign-atlas');
    group.add(exitSigns);
    const signs = Object.freeze([exitSigns]);
    const exitSignCameraBlockers = Object.freeze(signSpecs.map((spec, index) => {
      const frame = spec.frame;
      const centerX = frame.x + frame.rightX * 3.2 + frame.upX * 3.4;
      const centerY = frame.y + frame.rightY * 3.2 + frame.upY * 3.4;
      const centerZ = frame.z + frame.rightZ * 3.2 + frame.upZ * 3.4;
      const verticalExtentM = Math.abs(frame.rightY) * 2.9 + Math.abs(frame.upY) * 1;
      return Object.seal({
        id: `${trafficTileToken}:exit-sign:${index}`,
        kind: 'woven-exit-sign',
        coordinateMode: FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.coordinateMode,
        visible: false,
        x: centerX,
        y: centerY,
        z: centerZ,
        radiusM: Math.hypot(2.9, 1),
        minY: centerY - verticalExtentM,
        maxY: centerY + verticalExtentM
      });
    }));
    let persistentRouteStructureCameraBlockers = null;
    let routeCameraBlockers = null;
    const signIndexByDecisionMovement = new Map();
    for (let index = 0; index < signSpecs.length; index++) {
      const spec = signSpecs[index];
      // Turning guidance begins at the primary split, while the same plate is physically mounted before the collector split.
      for (const decisionId of new Set([spec.primaryDecisionNodeId, spec.decisionNodeId])) {
        if (decisionId) signIndexByDecisionMovement.set(`${decisionId}:${spec.movementId}`, index);
      }
    }
    yield 'exit-sign-atlas';

    const initialStraightForkBranchesByDecision = new Map();
    for (const edge of edges) {
      if (edge.family !== 'straight-fork-branch' || !edge.decisionNodeId) continue;
      if (!initialStraightForkBranchesByDecision.has(edge.decisionNodeId)) {
        initialStraightForkBranchesByDecision.set(edge.decisionNodeId, []);
      }
      initialStraightForkBranchesByDecision.get(edge.decisionNodeId).push(edge);
    }
    const completeStraightForkCount = [...initialStraightForkBranchesByDecision.values()]
      .filter((branches) => branches.some((edge) => edge.forkSide === 'left')
        && branches.some((edge) => edge.forkSide === 'right'))
      .length;
    const goreCapacity = Math.max(
      1,
      authoredGoreNoseCapacity,
      decisionStructureNodes.length + completeStraightForkCount
    );
    // A sealed four-ray stone flower keeps the exact former marker envelope and remains presentation-only.
    const goreGeometry = modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [
        [0, 1.70], [0.22, 0.54], [0.72, 0], [0.22, -0.54],
        [0, -1.70], [-0.22, -0.54], [-0.72, 0], [-0.22, 0.54]
      ],
      depth: 0.36,
      bevel: 0.08,
      bevelSegments: 2
    });
    own(goreGeometry);
    goreGeometry.rotateX(-Math.PI * 0.5);
    goreGeometry.computeBoundingBox();
    const goreBox = goreGeometry.boundingBox;
    const goreEnvelope = SKY_ROUTE_WAYFINDING_ART_CONTRACT.gore.maximumLocalEnvelope;
    const goreEnvelopeViolationCount = [
      goreBox.min.x < goreEnvelope.minX - 0.000_001,
      goreBox.max.x > goreEnvelope.maxX + 0.000_001,
      goreBox.min.y < goreEnvelope.minY - 0.000_001,
      goreBox.max.y > goreEnvelope.maxY + 0.000_001,
      goreBox.min.z < goreEnvelope.minZ - 0.000_001,
      goreBox.max.z > goreEnvelope.maxZ + 0.000_001
    ].filter(Boolean).length;
    goreGeometry.userData.neonV23SkyWayfindingArt = Object.freeze({
      contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
      role: SKY_ROUTE_WAYFINDING_ART_CONTRACT.gore.role,
      topology: SKY_ROUTE_WAYFINDING_ART_CONTRACT.gore.topology,
      collision: SKY_ROUTE_WAYFINDING_ART_CONTRACT.gore.collision,
      envelopeViolationCount: goreEnvelopeViolationCount
    });
    if (goreEnvelopeViolationCount !== 0) {
      goreGeometry.dispose();
      throw new Error('Sky wayfinding gore art exceeds the preserved marker envelope');
    }
    const goreMaterial = new THREE.MeshStandardMaterial({
      color: 0xd2_aa_69,
      emissive: 0x00_0000,
      emissiveIntensity: 0,
      roughness: 0.88,
      metalness: 0
    });
    own(goreMaterial);
    goreMaterial.userData.neonV23SkyWayfindingArt = Object.freeze({
      contractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
      role: 'matte-warm-stone-gore-marker',
      family: SKY_ROUTE_WAYFINDING_ART_CONTRACT.materials.goreFamily
    });
    const goreNoses = new THREE.InstancedMesh(
      goreGeometry,
      goreMaterial,
      goreCapacity
    );
    goreNoses.name = 'cloverleaf-physical-gore-noses';
    goreNoses.count = 0;
    goreNoses.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    goreNoses.castShadow = true;
    goreNoses.receiveShadow = true;
    if (markMainVisual) markMainVisual(goreNoses, 'cloverleaf-physical-gore-noses');
    group.add(goreNoses);
    const goreRight = new THREE.Vector3();
    const goreUp = new THREE.Vector3();
    const goreBack = new THREE.Vector3();
    const goreBasis = new THREE.Matrix4();
    const goreQuaternion = new THREE.Quaternion();
    const gorePosition = new THREE.Vector3();
    const goreScale = new THREE.Vector3(1, 1, 1);
    const goreMatrix = new THREE.Matrix4();
    let goreCount = 0;
    function installGoreNose(frame, reverseLongitudinal = false) {
      goreRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
      goreUp.set(frame.upX, frame.upY, frame.upZ).normalize();
      goreBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
      // Flipping two basis axes turns the merge marker around without mirroring the triangular mesh.
      if (reverseLongitudinal) {
        goreRight.multiplyScalar(-1);
        goreBack.multiplyScalar(-1);
      }
      goreBasis.makeBasis(goreRight, goreUp, goreBack);
      goreQuaternion.setFromRotationMatrix(goreBasis);
      gorePosition.set(
        frame.x - tileOrigin.x + frame.upX * 0.38,
        frame.y + frame.upY * 0.38,
        frame.z - tileOrigin.z + frame.upZ * 0.38
      );
      goreScale.set(1, 1, 1);
      goreMatrix.compose(gorePosition, goreQuaternion, goreScale);
      if (goreCount >= goreCapacity) throw new Error('Recovery variant exceeds gore instance capacity');
      goreNoses.setMatrixAt(goreCount++, goreMatrix);
    }

    function decisionNodesForTrack(activeTrack) {
      return nodeList(activeTrack).filter((node) => (
        node.kind === 'decision' || node.kind === 'collector-decision'
      ));
    }

    function resolveGoreNoseLayout(activeTrack, activeEdges, activeDecisionNodes = null) {
      const nodes = activeDecisionNodes || decisionNodesForTrack(activeTrack);
      const straightForkBranchesByDecision = new Map();
      for (const edge of activeEdges) {
        if (edge.family !== 'straight-fork-branch' || !edge.decisionNodeId) continue;
        if (!straightForkBranchesByDecision.has(edge.decisionNodeId)) {
          straightForkBranchesByDecision.set(edge.decisionNodeId, []);
        }
        straightForkBranchesByDecision.get(edge.decisionNodeId).push(edge);
      }
      let requiredCount = 0;
      for (const node of nodes) {
        if (node.decisionType === 'straight-fork') {
          requiredCount += straightForkGoreLayout(
            straightForkBranchesByDecision.get(node.id) || []
          ).length;
          continue;
        }
        const incomingId = node.inEdges?.[0] || node.incomingEdgeIds?.[0];
        if (activeTrack.getEdge?.(incomingId)) requiredCount++;
      }
      return Object.freeze({ nodes, straightForkBranchesByDecision, requiredCount });
    }

    function assertGoreNoseCapacity(layout) {
      if (layout.requiredCount > goreCapacity) {
        throw new Error('Recovery variant exceeds gore instance capacity');
      }
    }

    /** Rebuild node-owned markers whenever the resident recovery road atomically changes exit. */
    function rebuildGoreNoses(activeTrack, activeEdges, preparedLayout = null) {
      const layout = preparedLayout || resolveGoreNoseLayout(activeTrack, activeEdges);
      assertGoreNoseCapacity(layout);
      const activeDecisionNodes = layout.nodes;
      const { straightForkBranchesByDecision } = layout;
      goreCount = 0;
      for (const node of activeDecisionNodes) {
        if (node.decisionType === 'straight-fork') {
          const branches = straightForkBranchesByDecision.get(node.id) || [];
          for (const layout of straightForkGoreLayout(branches)) {
            const { edgeS, reverseLongitudinal, leftEdge, rightEdge } = layout;
            const leftFrame = sample(activeTrack, leftEdge.id, edgeS, 0, {});
            const rightFrame = sample(activeTrack, rightEdge.id, edgeS, 0, {});
            // Mirrored branch centers average back onto the true central void axis at both exposed ends.
            installGoreNose({
              x: (leftFrame.x + rightFrame.x) * 0.5,
              y: (leftFrame.y + rightFrame.y) * 0.5,
              z: (leftFrame.z + rightFrame.z) * 0.5,
              tangentX: (leftFrame.tangentX + rightFrame.tangentX) * 0.5,
              tangentY: (leftFrame.tangentY + rightFrame.tangentY) * 0.5,
              tangentZ: (leftFrame.tangentZ + rightFrame.tangentZ) * 0.5,
              rightX: (leftFrame.rightX + rightFrame.rightX) * 0.5,
              rightY: (leftFrame.rightY + rightFrame.rightY) * 0.5,
              rightZ: (leftFrame.rightZ + rightFrame.rightZ) * 0.5,
              upX: (leftFrame.upX + rightFrame.upX) * 0.5,
              upY: (leftFrame.upY + rightFrame.upY) * 0.5,
              upZ: (leftFrame.upZ + rightFrame.upZ) * 0.5
            }, reverseLongitudinal);
          }
          continue;
        }
        const incomingId = node.inEdges?.[0] || node.incomingEdgeIds?.[0];
        const incoming = activeTrack.getEdge?.(incomingId) || edgeVisuals.get(incomingId)?.edge;
        if (!incoming) continue;
        const lateral = node.kind === 'decision' ? Math.min(4.3, incoming.roadHalf * 0.58) : 0;
        const frame = sample(activeTrack, incoming.id, Math.max(0, incoming.length - 2.4), lateral, {});
        installGoreNose(frame);
      }
      goreNoses.count = goreCount;
      goreNoses.instanceMatrix.needsUpdate = true;
      goreNoses.computeBoundingSphere?.();
      synchronizeInstancedCameraBlockers(goreCameraBlockers, goreNoses);
      return activeDecisionNodes;
    }
    let activeDecisionStructureNodes = rebuildGoreNoses(track, edges);
    supportCameraBlockers = createInstancedCameraBlockerPool(supports, 'wind-eroded-bridge-pier');
    supportCapCameraBlockers = createInstancedCameraBlockerPool(
      supportCaps,
      'petal-bridge-capital-or-footing'
    );
    beamCameraBlockers = createInstancedCameraBlockerPool(
      beams,
      (instanceIndex) => instanceIndex < bridgeBeamCount
        ? 'carved-bridge-crossbeam'
        : 'carved-tunnel-rib-portal-or-housing'
    );
    structuralDetailCameraBlockers = createInstancedCameraBlockerPool(
      structuralDetails,
      (instanceIndex) => instanceIndex < decisionPylonInstanceStart
        ? 'layered-bridge-detail'
        : instanceIndex < decisionPylonInstanceEnd
          ? 'dedicated-decision-pylon-slot'
          : instanceIndex < permanentStructuralDetailCount
            ? 'bridge-rail-post'
            : 'runtime-long-span-structure'
    );
    goreCameraBlockers = createInstancedCameraBlockerPool(goreNoses, 'physical-gore-nose');
    synchronizeInstancedCameraBlockers(supportCameraBlockers, supports);
    synchronizeInstancedCameraBlockers(supportCapCameraBlockers, supportCaps);
    synchronizeInstancedCameraBlockers(beamCameraBlockers, beams);
    synchronizeStructuralDetailCameraBlockers();
    synchronizeInstancedCameraBlockers(goreCameraBlockers, goreNoses);
    persistentRouteStructureCameraBlockers = Object.freeze([
      ...supportCameraBlockers,
      ...supportCapCameraBlockers,
      ...beamCameraBlockers,
      ...structuralDetailCameraBlockers.slice(0, decisionPylonInstanceStart),
      ...structuralDetailCameraBlockers.slice(decisionPylonInstanceEnd),
      ...goreCameraBlockers,
      ...decisionStructureCameraBlockers
    ]);
    routeCameraBlockers = Object.freeze([
      ...persistentRouteStructureCameraBlockers,
      ...exitSignCameraBlockers
    ]);
    yield 'gore-noses';
    yield 'gore-finalize';

    const arrowGeometry = modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [[0, -1.55], [0.78, -0.35], [0.32, -0.35], [0.32, 1.45], [-0.32, 1.45], [-0.32, -0.35], [-0.78, -0.35]],
      depth: 0.10,
      bevel: 0.055,
      bevelSegments: 1
    });
    own(arrowGeometry);
    arrowGeometry.rotateX(ROAD_ARROW_DIRECTION_CONTRACT.geometryPitchRadians);
    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff_e89a,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    own(arrowMaterial);
    const roadArrows = new THREE.InstancedMesh(
      arrowGeometry,
      arrowMaterial,
      Math.max(1, decisionStructureNodeCapacity * 2)
    );
    roadArrows.name = 'cloverleaf-road-navigation-arrows';
    roadArrows.count = 0;
    roadArrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markShadowExempt(roadArrows, 'Transparent navigation glyphs are light overlays without physical thickness.');
    if (markEffect) markEffect(roadArrows, 'cloverleaf-road-navigation-arrows');
    group.add(roadArrows);
    const arrowMatrix = new THREE.Matrix4();
    const arrowPosition = new THREE.Vector3();
    const arrowScale = new THREE.Vector3(1.1, 0.28, 2.1);
    const arrowQuaternion = new THREE.Quaternion();
    const arrowBasis = new THREE.Matrix4();
    const arrowRight = new THREE.Vector3();
    const arrowUp = new THREE.Vector3();
    const arrowBack = new THREE.Vector3();
    const arrowForward = new THREE.Vector3();
    const arrowTangent = new THREE.Vector3();
    const guidanceDecisionIds = new Set(activeDecisionStructureNodes.map((node) => node.id));
    let activeDecisionNodesById = new Map(activeDecisionStructureNodes.map((node) => [node.id, node]));
    const defaultArrowDistances = Object.freeze([300, 120]);
    let activeDecisionGuidance = null;
    let guidanceArrowHash = '';
    let roadArrowMinimumForwardDot = 1;
    let roadArrowDirectionViolationCount = 0;
    yield 'road-arrows';

    const trafficCount = qualityProfile?.id === 'mobile' ? 28 : 48;
    const trafficGeometry = createTrafficGeometry(THREE, modeling);
    own(trafficGeometry);
    const trafficShape = trafficGeometry.userData.neonV23TrafficShape;
    const trafficMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xff_ffff,
      vertexColors: true,
      emissive: 0x00_0000,
      emissiveIntensity: 0,
      roughness: 0.84,
      metalness: 0,
      clearcoat: 0.018,
      clearcoatRoughness: 0.92,
      sheen: 0.16,
      sheenRoughness: 0.82,
      ior: 1.46,
      flatShading: true,
      transparent: false,
      opacity: 1,
      depthWrite: true
    });
    own(trafficMaterial);
    trafficMaterial.userData.neonV23AmbientTrafficArt = Object.freeze({
      contractVersion: AMBIENT_TRAFFIC_ART_CONTRACT.version,
      role: 'woven-cape-spirit-surface',
      family: AMBIENT_TRAFFIC_ART_CONTRACT.materials.family
    });
    if (
      trafficMaterial.metalness !== AMBIENT_TRAFFIC_ART_CONTRACT.materials.metalness
      || trafficMaterial.roughness < AMBIENT_TRAFFIC_ART_CONTRACT.materials.minimumRoughness
      || trafficMaterial.clearcoat > AMBIENT_TRAFFIC_ART_CONTRACT.materials.maximumClearcoat
    ) {
      throw new Error('Ambient traffic material violates the matte natural dielectric contract');
    }
    const traffic = new THREE.InstancedMesh(trafficGeometry, trafficMaterial, trafficCount);
    traffic.name = 'cloverleaf-decorative-traffic';
    traffic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    traffic.castShadow = true;
    traffic.receiveShadow = true;
    // Each matrix upload refreshes this sphere before rendering. Native per-pass culling can then reject the
    // complete batch without hiding an off-camera companion that still belongs to a light's shadow frustum.
    traffic.frustumCulled = true;
    traffic.computeBoundingSphere();
    modeling.markMainVisual(traffic, {
      family: AMBIENT_TRAFFIC_ART_CONTRACT.productionFamily,
      zoneId: 'shared',
      analyzeTopology: true,
      watertightContract: true,
      nonColliding: true,
      gameplayThreat: false
    });
    group.add(traffic);
    const trafficTopology = traffic.userData.topology || {};

    const trafficEntryPort = options.entryPort
      || track.graph?.tile?.entryPort
      || movementList(track)[0]?.entryPort
      || null;
    const trafficSafety = createTrafficSafetyContract(track, edges, trafficEntryPort);
    const trafficSlotDrafts = [];
    for (let index = 0; index < trafficCount; index++) {
      if (index % 8 === 0) yield 'traffic-slot-batch';
      const edge = trafficSafety.safeEdges[index % Math.max(1, trafficSafety.safeEdges.length)];
      const seed = stableHash(`${trafficTileToken}:${edgeTemplateId(edge)}:${index}`);
      const endpointProtection = edge
        ? Math.min(edge.length * 0.25, Math.max(24, edge.length * 0.06))
        : 0;
      const usableLength = edge ? Math.max(1, edge.length - endpointProtection * 2) : 1;
      const slot = {
        id: `${trafficTileToken}:ambient:${index}`,
        edge,
        endpointProtection,
        usableLength,
        offset: 0,
        speed: 0,
        lateralRatio: seed & 1 ? -0.28 : 0.28,
        scale: 0.92 + ((seed >>> 9) & 0xff) / 255 * 0.22,
        widthScale: 0.94 + ((seed >>> 3) & 0x1f) / 31 * 0.16,
        heightScale: 0.90 + ((seed >>> 14) & 0x0f) / 15 * 0.18,
        lengthScale: 0.94 + ((seed >>> 20) & 0x0f) / 15 * 0.14,
        colorMix: ((seed >>> 17) & 0x7f) / 127
      };
      trafficSlotDrafts.push(slot);
    }
    const trafficSlotsByEdge = new Map();
    for (const slot of trafficSlotDrafts) {
      const edgeKey = slot.edge || null;
      let cohort = trafficSlotsByEdge.get(edgeKey);
      if (!cohort) {
        cohort = [];
        trafficSlotsByEdge.set(edgeKey, cohort);
      }
      cohort.push(slot);
    }
    for (const [edge, cohort] of trafficSlotsByEdge) {
      const cohortSeed = stableHash(`${trafficTileToken}:${edgeTemplateId(edge)}:spacing-cohort`);
      const phase = (cohortSeed & 0x00_ff_ff_ff) / 0x01_00_00_00;
      const cohortSpeed = 22 + ((cohortSeed >>> 24) / 255) * 14;
      for (let rank = 0; rank < cohort.length; rank++) {
        const slot = cohort[rank];
        // A shared speed preserves the even circular phase forever; independent speeds previously guaranteed
        // eventual overtaking and allowed one complete cape-spirit volume to enter another on the same edge.
        slot.offset = slot.usableLength * ((rank + phase) / Math.max(1, cohort.length) % 1);
        slot.speed = cohortSpeed;
        Object.freeze(slot);
      }
      Object.freeze(cohort);
    }
    const trafficSlots = Object.freeze(trafficSlotDrafts);
    const ambientTrafficMarkers = [];
    for (const slot of trafficSlots) {
      ambientTrafficMarkers.push(Object.seal({
        id: slot.id,
        tileToken: trafficTileToken,
        edgeId: slot.edge?.id || null,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        opacity: 0,
        speed: slot.speed,
        visible: false,
        radiusM: 0,
        separationSuppressed: false,
        nonColliding: true
      }));
    }
    Object.freeze(ambientTrafficMarkers);
    const trafficMatrix = new THREE.Matrix4();
    const trafficPosition = new THREE.Vector3();
    const trafficScale = new THREE.Vector3();
    const trafficQuaternion = new THREE.Quaternion();
    const trafficBasis = new THREE.Matrix4();
    const trafficRight = new THREE.Vector3();
    const trafficUp = new THREE.Vector3();
    const trafficBack = new THREE.Vector3();
    const trafficForward = new THREE.Vector3();
    const trafficTangent = new THREE.Vector3();
    const trafficColor = new THREE.Color();
    const trafficSampleScratch = {};
    const trafficFrameScratch = {};
    const acceptedTrafficX = new Float64Array(trafficCount);
    const acceptedTrafficY = new Float64Array(trafficCount);
    const acceptedTrafficZ = new Float64Array(trafficCount);
    const acceptedTrafficRadius = new Float64Array(trafficCount);
    const trafficLocalBoundingRadiusM = Number(trafficGeometry.boundingSphere?.radius)
      || Math.hypot(trafficShape.widthM, trafficShape.heightM, trafficShape.lengthM) * 0.5;
    const minimumTrafficSurfaceGapM = AMBIENT_TRAFFIC_ART_CONTRACT.spacing.minimumSurfaceGapM;
    // These are visual readability bounds, not collision dimensions. Every marker declared visible must retain them.
    const minimumReadableTrafficShape = Object.freeze({ widthM: 4.5, heightM: 0.7, lengthM: 3.8 });
    const minimumFullShapeWidthM = trafficSlots.length
      ? Math.min(...trafficSlots.map((slot) => trafficShape.widthM * slot.scale * slot.widthScale))
      : 0;
    const minimumFullShapeHeightM = trafficSlots.length
      ? Math.min(...trafficSlots.map((slot) => trafficShape.heightM * slot.scale * slot.heightScale))
      : 0;
    const minimumFullShapeLengthM = trafficSlots.length
      ? Math.min(...trafficSlots.map((slot) => trafficShape.lengthM * slot.scale * slot.lengthScale))
      : 0;
    let ambientTrafficMarkerVisibleCount = 0;
    let ambientTrafficFullShapeVisibleCount = 0;
    // Lifetime worst cases prevent a one-frame shrink during an edge/tile transition from disappearing before audit.
    let ambientTrafficSmallShapeViolationCount = 0;
    let ambientTrafficMinimumVisibleScaleRatio = Number.POSITIVE_INFINITY;
    let ambientTrafficMinimumRenderedWidthM = Number.POSITIVE_INFINITY;
    let ambientTrafficMinimumRenderedHeightM = Number.POSITIVE_INFINITY;
    let ambientTrafficMinimumRenderedLengthM = Number.POSITIVE_INFINITY;
    let ambientTrafficMinimumForwardDot = 1;
    let ambientTrafficSeparationSuppressedCount = 0;
    let ambientTrafficSeparationViolationCount = 0;
    let ambientTrafficMinimumSubmittedCenterGapM = Number.POSITIVE_INFINITY;
    let ambientTrafficMinimumSubmittedSurfaceGapM = Number.POSITIVE_INFINITY;
    let ambientTrafficBoundsUpdateCount = 0;
    let routeCameraBlockerVisibilitySweepCount = 0;
    const paletteGeneralScratch = new THREE.Color();
    const paletteRampScratch = new THREE.Color();
    let lastLinePaletteKey = '';
    let lastSurfaceMaterialKey = '';
    let activeLineEdgeHex = 0xe7_f1ee;
    let activeLineAccentHex = 0xd9_c88b;
    let hasActiveLinePalette = false;

    yield 'traffic-slots';
    scene.add(group);
    let activePathHash = '';
    let cachedPathPlanReference = null;
    let cachedPathPlanEdgeCount = -1;
    let cachedPathPlanVersion = null;
    let cachedProposalIdentity = null;
    let cachedActiveEdges = new Set();
    let routeBatchRebuildCount = 0;
    let lastRouteBatchUpdateMs = 0;
    let maximumRouteBatchUpdateMs = 0;

    /** Build route-owned road buffers and support matrices completely before either is allowed to become visible. */
    function createRecoveryVariantJob({ track: variantTrack, signature } = {}) {
      if (!variantTrack?.graph || !signature) throw new Error('Recovery variant job requires a scoped track and signature');
      let recoveryEdges = null;
      let geometryJob = null;
      let supportLayoutJob = null;
      let supportLayoutComplete = false;
      let template = null;
      let complete = false;
      let result = null;
      let lastStepLabel = 'geometry';
      const diagnostics = Object.freeze({
        get lastStepLabel() { return lastStepLabel; }
      });
      return Object.freeze({
        step(budgetMs = 4) {
          if (complete) return true;
          if (!recoveryEdges) {
            lastStepLabel = 'initialize-edges';
            recoveryEdges = edgeList(variantTrack).filter(isRuntimeOnlyEdge);
            return false;
          }
          if (!geometryJob) {
            lastStepLabel = 'initialize-geometry';
            geometryJob = createGeometryBatchJob({
              ...options,
              track: variantTrack,
              tileOrigin
            }, recoveryEdges);
            return false;
          }
          if (!template) {
            const geometryComplete = resumeGeometryJobWithinSafeBudget(geometryJob, budgetMs);
            lastStepLabel = `geometry-${geometryJob.metrics.lastSliceLabel || 'step'}`;
            if (!geometryComplete) return false;
            template = geometryJob.finish();
            return false;
          }
          if (!supportLayoutJob) {
            lastStepLabel = 'initialize-supports';
            supportLayoutJob = createRuntimeSupportLayoutJob(variantTrack, recoveryEdges);
            return false;
          }
          if (!supportLayoutComplete) {
            supportLayoutComplete = supportLayoutJob.step(budgetMs);
          }
          lastStepLabel = `support-${supportLayoutJob.diagnostics.lastStepLabel}`;
          if (!supportLayoutComplete) return false;
          if (!template.supportLayout) {
            template.supportLayout = supportLayoutJob.finish();
            template.longSpanStructureMatrices = composeRuntimeLongSpanStructureMatrices(
              variantTrack,
              template.supportLayout
            );
            // Variant-owned frames keep every node decoration aligned with the atomically swapped road buffers.
            template.variantTrack = variantTrack;
            return false;
          }
          // High-tier marking conversion used to run inside installRecoveryVariant and escape the slice timer.
          // Preparing it here keeps the platform lip and the later authority transaction allocation-free.
          lastStepLabel = 'ultra-road-markings';
          template.ultraRoadMarkingGeometry = createRoadMarkingRibbonGeometry(
            THREE,
            template.staticLineGeometry
          );
          complete = true;
          return true;
        },
        finish() {
      if (!complete || !template?.supportLayout) {
            throw new Error('Recovery variant road and support preparation is not complete');
          }
          result ||= Object.freeze({ signature, template });
          return result;
        },
        cancel() {
          template?.ultraRoadMarkingGeometry?.dispose();
          geometryJob?.cancel();
        },
        diagnostics
      });
    }

    function hasRecoveryVariant(signature) {
      return recoveryVariants.has(signature);
    }

    function installRecoveryVariant(variant) {
      if (!variant?.signature || !variant.template) throw new Error('Invalid recovery variant');
      const existing = recoveryVariants.get(variant.signature);
      if (existing) {
        if (existing !== variant.template) {
          variant.template.ultraRoadMarkingGeometry?.dispose();
          disposeGeometryBatch(variant.template);
        }
        return false;
      }
      recoveryVariants.set(variant.signature, variant.template);
      ultraRecoveryMarkingGeometries.set(
        variant.signature,
        variant.template.ultraRoadMarkingGeometry
          || createRoadMarkingRibbonGeometry(THREE, variant.template.staticLineGeometry)
      );
      // Variants prepared after the last palette update must enter with the resident tile's exact colors.
      if (hasActiveLinePalette) {
        recolorLineGeometry(variant.template.staticLineGeometry);
        syncRoadMarkingRibbonColors(
          variant.template.staticLineGeometry,
          ultraRecoveryMarkingGeometries.get(variant.signature)
        );
      }
      return true;
    }

    /** Geometry pointer swaps are atomic and do not rebuild/dispose the sole tile visual. */
    function activateRecoveryVariant(signature, _graph = null, variantTrack = null) {
      const nextTemplate = recoveryVariants.get(signature);
      if (!nextTemplate) return false;
      if (activeRecoverySignature === signature) return true;
      const activeVariantTrack = variantTrack || nextTemplate.variantTrack || track;
      const nextDecisionStructureNodes = decisionNodesForTrack(activeVariantTrack);
      const nextDecisionStructureEntries = resolveDecisionStructureEntries(
        activeVariantTrack,
        nextDecisionStructureNodes
      );
      const nextGoreNoseLayout = resolveGoreNoseLayout(
        activeVariantTrack,
        nextTemplate.edges,
        nextDecisionStructureNodes
      );
      // All capacity failures must precede geometry/support pointer swaps or recovery could leave a split visual.
      assertDecisionStructureCapacity(nextDecisionStructureEntries);
      assertGoreNoseCapacity(nextGoreNoseLayout);
      const nextSupportCapacity = assertRuntimeSupportLayoutCapacity(nextTemplate.supportLayout);
      const nextRouteStructureMatrices = assertRuntimeRouteStructureCapacity(
        nextTemplate.longSpanStructureMatrices || []
      );
      for (const edge of activeRecoveryTemplate.edges) {
        routeLinePositionsByEdge.delete(edge.id);
        edgeVisuals.delete(edge.id);
      }
      for (const [edgeId, lines] of nextTemplate.routeLinePositionsByEdge) {
        routeLinePositionsByEdge.set(edgeId, lines);
      }
      for (const edge of nextTemplate.edges) {
        edgeVisuals.set(edge.id, {
          shell: recoveryRoadShell,
          lines: [],
          selected: selectedRoute,
          proposed: proposedRoute,
          edge
        });
      }
      recoveryRoadShell.geometry = nextTemplate.roadShellGeometry;
      recoveryRoadShell.visible = nextTemplate.edges.length > 0;
      recoveryStaticLines.geometry = nextTemplate.staticLineGeometry;
      recoveryStaticLines.visible = activeRenderQualityId !== 'high' && nextTemplate.edges.length > 0;
      ultraRecoveryMarkings.geometry = ultraRecoveryMarkingGeometries.get(signature)
        || createRoadMarkingRibbonGeometry(THREE, nextTemplate.staticLineGeometry);
      if (!ultraRecoveryMarkingGeometries.has(signature)) {
        ultraRecoveryMarkingGeometries.set(signature, ultraRecoveryMarkings.geometry);
      }
      ultraRecoveryMarkings.visible = activeRenderQualityId === 'high' && nextTemplate.edges.length > 0;
      activateRuntimeSupportLayout(nextTemplate.supportLayout, nextSupportCapacity);
      activeDecisionStructureNodes = rebuildGoreNoses(
        activeVariantTrack,
        nextTemplate.edges,
        nextGoreNoseLayout
      );
      const revisedDecisionStructures = rewriteDecisionStructures(
        activeVariantTrack,
        activeDecisionStructureNodes,
        false,
        nextDecisionStructureEntries
      );
      activeDecisionStructureCount = revisedDecisionStructures.structureCount;
      activateRuntimeLongSpanStructures(nextRouteStructureMatrices);
      // setMatrixAt does not invalidate InstancedMesh bounds; stale spheres can cull a marker after a 90° exit swap.
      structuralDetails.computeBoundingSphere?.();
      underpassLights.computeBoundingSphere?.();
      guidanceDecisionIds.clear();
      activeDecisionNodesById = new Map();
      for (const node of activeDecisionStructureNodes) {
        guidanceDecisionIds.add(node.id);
        activeDecisionNodesById.set(node.id, node);
      }
      activeRecoveryTemplate = nextTemplate;
      activeRecoverySignature = signature;
      activePathHash = '';
      cachedPathPlanReference = null;
      guidanceArrowHash = '';
      return true;
    }

    function replaceRouteGeometry(batch, edgeIds, routeKind) {
      const sources = [];
      let positionCount = 0;
      for (const edgeId of edgeIds) {
        const edge = edgeVisuals.get(edgeId)?.edge;
        const source = routeLinePositionsByEdge.get(edgeId)?.[routeKind]
          || routeLinePositionsByEdge.get(edgeTemplateId(edge))?.[routeKind];
        if (!source) continue;
        sources.push(source);
        positionCount += source.length;
      }
      const positions = new Float32Array(positionCount);
      let offset = 0;
      for (const source of sources) {
        positions.set(source, offset);
        offset += source.length;
      }
      const previous = batch.geometry;
      batch.geometry = geometryFromLinePositions(THREE, positions);
      batch.visible = positions.length > 0;
      if (batch.material?.isLineDashedMaterial) batch.computeLineDistances();
      previous.dispose();
    }

    function guidanceApplies(navigation) {
      if (!navigation?.active || !guidanceDecisionIds.has(navigation.decisionId)) return false;
      const tileEntryPort = track.graph?.tile?.entryPort;
      return !tileEntryPort || !navigation.entryPort || navigation.entryPort === tileEntryPort;
    }

    function updateRoadArrows(navigation, activeEdges) {
      const arrowDistances = Array.isArray(navigation?.arrowDistances)
        && navigation.arrowDistances.length > 0
        && navigation.arrowDistances.every(Number.isFinite)
        ? navigation.arrowDistances
        : defaultArrowDistances;
      const nextHash = guidanceApplies(navigation)
        ? `${activePathHash}:${navigation.decisionId}:${navigation.movementId}:${arrowDistances.join('|')}`
        : 'inactive';
      if (nextHash === guidanceArrowHash) return;
      guidanceArrowHash = nextHash;
      let arrowCount = 0;
      roadArrowMinimumForwardDot = 1;
      roadArrowDirectionViolationCount = 0;
      if (guidanceApplies(navigation)) {
        const node = activeDecisionNodesById.get(navigation.decisionId);
        const incomingId = [...(node?.inEdges || node?.incomingEdgeIds || [])]
          .find((edgeId) => activeEdges.has(edgeId))
          || node?.inEdges?.[0]
          || node?.incomingEdgeIds?.[0];
        const incoming = edgeVisuals.get(incomingId)?.edge;
        const movement = track.getMovement?.(navigation.movementId);
        const gate = node?.kind === 'collector-decision' ? movement?.collectorGate : movement?.entryGate;
        for (const leadDistance of incoming ? arrowDistances : []) {
          const edgeS = Math.max(0, incoming.length - leadDistance);
          const center = sample(track, incoming.id, edgeS, 0, {});
          const safeHalf = Math.max(0, sampledRoadHalf(center, incoming) - 0.58);
          const lateral = gate && typeof track.gateTargetForHalfWidth === 'function'
            ? track.gateTargetForHalfWidth(gate, safeHalf)
            : 0;
          const frame = sample(track, incoming.id, edgeS, lateral, {});
          arrowRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
          arrowUp.set(frame.upX, frame.upY, frame.upZ).normalize();
          arrowBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
          arrowBasis.makeBasis(arrowRight, arrowUp, arrowBack);
          arrowQuaternion.setFromRotationMatrix(arrowBasis);
          arrowForward
            .set(
              ROAD_ARROW_DIRECTION_CONTRACT.localForwardAxis.x,
              ROAD_ARROW_DIRECTION_CONTRACT.localForwardAxis.y,
              ROAD_ARROW_DIRECTION_CONTRACT.localForwardAxis.z
            )
            .applyQuaternion(arrowQuaternion)
            .normalize();
          arrowTangent.set(frame.tangentX, frame.tangentY, frame.tangentZ).normalize();
          const forwardDot = clamp(arrowForward.dot(arrowTangent), -1, 1);
          roadArrowMinimumForwardDot = Math.min(roadArrowMinimumForwardDot, forwardDot);
          if (forwardDot < ROAD_ARROW_DIRECTION_CONTRACT.minimumForwardDot) {
            roadArrowDirectionViolationCount++;
          }
          arrowPosition.set(
            frame.x - tileOrigin.x + arrowUp.x * 0.24,
            frame.y + arrowUp.y * 0.24,
            frame.z - tileOrigin.z + arrowUp.z * 0.24
          );
          arrowMatrix.compose(arrowPosition, arrowQuaternion, arrowScale);
          roadArrows.setMatrixAt(arrowCount++, arrowMatrix);
        }
      }
      roadArrows.count = arrowCount;
      roadArrows.instanceMatrix.needsUpdate = true;
      roadArrows.computeBoundingSphere?.();
    }

    function updateGuidanceVisibility(navigation) {
      const turning = navigation?.kind === 'right' || navigation?.kind === 'left';
      const signIndex = signIndexByDecisionMovement.get(
        `${navigation?.decisionId}:${navigation?.movementId}`
      );
      exitSigns.visible = guidanceApplies(navigation) && turning && Number.isInteger(signIndex);
      if (exitSigns.visible) exitSigns.geometry.setDrawRange(signIndex * 6, 6);
      for (let index = 0; index < exitSignCameraBlockers.length; index++) {
        exitSignCameraBlockers[index].visible = exitSigns.visible && index === signIndex;
      }
      roadArrows.visible = guidanceApplies(navigation) && roadArrows.count > 0;
      /*
       * Exact turning arrows plus the matching exit placard supersede the generic braided-lane guide. Keeping all
       * three would add a redundant real draw call to the selected/proposed route pair and breach the 16-group tile
       * budget without adding navigational information.
       */
      decorativeLaneGuides.visible = !(exitSigns.visible && roadArrows.visible);
    }

    /** Retain the exact shared DecisionGuidance reference; tile scoping prevents future tiles from lighting early. */
    function mirrorDecisionGuidance(navigation, activeEdges) {
      activeDecisionGuidance = navigation || null;
      updateRoadArrows(activeDecisionGuidance, activeEdges);
      updateGuidanceVisibility(activeDecisionGuidance);
    }

    function setPathPlan(pathPlan, proposal = null) {
      const pathEdgeIds = pathPlan?.edgeIds || pathPlan?.plannedEdgeIds || [];
      const proposalIdentity = typeof proposal === 'string'
        ? proposal
        : proposal?.id || proposal?.movementId || proposal || null;
      if (cachedPathPlanReference === pathPlan
        && cachedPathPlanEdgeCount === pathEdgeIds.length
        && cachedPathPlanVersion === pathPlan?.version
        && cachedProposalIdentity === proposalIdentity) {
        return cachedActiveEdges;
      }
      cachedPathPlanReference = pathPlan;
      cachedPathPlanEdgeCount = pathEdgeIds.length;
      cachedPathPlanVersion = pathPlan?.version;
      cachedProposalIdentity = proposalIdentity;
      const activeEdges = new Set();
      if (pathPlan?.edgeIndexById instanceof Map) {
        // Query the tile's bounded edge set against PathPlan's index instead of scanning a growing 50km itinerary.
        for (const edgeId of edgeVisuals.keys()) {
          if (pathPlan.edgeIndexById.has(edgeId)) activeEdges.add(edgeId);
        }
      } else {
        for (const edgeId of pathEdgeIds) {
          if (edgeVisuals.has(edgeId)) activeEdges.add(edgeId);
        }
      }
      const proposedMovement = typeof proposal === 'string' ? track.getMovement?.(proposal) : proposal;
      const proposedEdges = new Set();
      for (const edgeId of proposedMovement?.edgeIds || proposal?.edgeIds || []) {
        if (edgeVisuals.has(edgeId)) proposedEdges.add(edgeId);
      }
      cachedActiveEdges = activeEdges;
      const hash = `${[...activeEdges].join('|')}::${[...proposedEdges].join('|')}`;
      if (hash === activePathHash) return activeEdges;
      const routeBatchStartedAt = nowMilliseconds();
      activePathHash = hash;
      replaceRouteGeometry(selectedRoute, activeEdges, 'selected');
      replaceRouteGeometry(
        proposedRoute,
        [...proposedEdges].filter((edgeId) => !activeEdges.has(edgeId)),
        'proposed'
      );
      guidanceArrowHash = '';
      routeBatchRebuildCount++;
      lastRouteBatchUpdateMs = nowMilliseconds() - routeBatchStartedAt;
      maximumRouteBatchUpdateMs = Math.max(maximumRouteBatchUpdateMs, lastRouteBatchUpdateMs);
      return activeEdges;
    }

    function update({ origin, pathPlan, proposal, navigation, time = 0, visible = true } = {}) {
      const visibilityChanged = group.visible !== visible;
      group.visible = visible;
      if (!visible) {
        roadArrows.visible = false;
        exitSigns.visible = false;
        if (visibilityChanged) {
          for (const blocker of routeCameraBlockers) blocker.visible = false;
          routeCameraBlockerVisibilitySweepCount++;
        }
        activeDecisionGuidance = null;
        return;
      }
      // Blocker cylinders use absolute coordinates and their layout writers already synchronize variant changes.
      // Player-origin movement cannot invalidate their visibility; only a tile re-entry needs a complete restore.
      if (visibilityChanged) {
        for (const blocker of persistentRouteStructureCameraBlockers) {
          blocker.visible = blocker.layoutVisible;
        }
        routeCameraBlockerVisibilitySweepCount++;
      }
      const originX = Number(origin?.x) || 0;
      const originZ = Number(origin?.z) || 0;
      group.position.set(tileOrigin.x - originX, 0, tileOrigin.z - originZ);
      const activeEdges = setPathPlan(pathPlan, proposal);
      mirrorDecisionGuidance(navigation, activeEdges);
      let count = 0;
      ambientTrafficMarkerVisibleCount = 0;
      ambientTrafficFullShapeVisibleCount = 0;
      ambientTrafficSeparationSuppressedCount = 0;
      ambientTrafficSeparationViolationCount = 0;
      ambientTrafficMinimumSubmittedCenterGapM = Number.POSITIVE_INFINITY;
      ambientTrafficMinimumSubmittedSurfaceGapM = Number.POSITIVE_INFINITY;
      for (let slotIndex = 0; slotIndex < trafficSlots.length; slotIndex++) {
        const slot = trafficSlots[slotIndex];
        const marker = ambientTrafficMarkers[slotIndex];
        const edge = slot.edge;
        marker.separationSuppressed = false;
        marker.radiusM = 0;
        if (!trafficSafety.proven || !edge) {
          marker.visible = false;
          marker.opacity = 0;
          continue;
        }
        const edgeS = slot.endpointProtection
          + (slot.offset + time * 0.001 * slot.speed) % slot.usableLength;
        // A TrackFrame basis is invariant across the road width. Deriving the opposing lane from the
        // center frame preserves the exact bank/elevation contract while halving traffic sampler work.
        const frame = sample(track, edge.id, edgeS, 0, trafficSampleScratch, trafficFrameScratch);
        const lateral = sampledRoadHalf(frame, edge) * slot.lateralRatio;
        const frameX = frame.x + frame.rightX * lateral;
        const frameY = frame.y + frame.rightY * lateral;
        const frameZ = frame.z + frame.rightZ * lateral;
        const fadeDistance = Math.min(
          edgeS - slot.endpointProtection,
          edge.length - slot.endpointProtection - edgeS
        );
        const fade = smootherStep01(fadeDistance / 24);
        trafficRight.set(frame.rightX, frame.rightY, frame.rightZ).normalize();
        trafficUp.set(frame.upX, frame.upY, frame.upZ).normalize();
        trafficBack.set(-frame.tangentX, -frame.tangentY, -frame.tangentZ).normalize();
        trafficBasis.makeBasis(trafficRight, trafficUp, trafficBack);
        trafficQuaternion.setFromRotationMatrix(trafficBasis);
        trafficForward.set(0, 0, trafficShape.noseAxisZ).applyQuaternion(trafficQuaternion).normalize();
        trafficTangent.set(frame.tangentX, frame.tangentY, frame.tangentZ).normalize();
        ambientTrafficMinimumForwardDot = Math.min(
          ambientTrafficMinimumForwardDot,
          trafficForward.dot(trafficTangent)
        );
        trafficPosition.set(
          frameX - tileOrigin.x + frame.upX * 0.58,
          frameY + frame.upY * 0.58,
          frameZ - tileOrigin.z + frame.upZ * 0.58
        );
        // Endpoint guards fade only the surface brightness. Geometry stays full-sized so no visible ship can collapse into a point.
        const visualScale = slot.scale;
        trafficScale.set(
          slot.widthScale * visualScale,
          slot.heightScale * visualScale,
          slot.lengthScale * visualScale
        );
        const trafficRadiusM = trafficLocalBoundingRadiusM * Math.max(
          Math.abs(trafficScale.x),
          Math.abs(trafficScale.y),
          Math.abs(trafficScale.z)
        );
        let separatedFromSubmittedTraffic = true;
        for (let submittedIndex = 0; submittedIndex < count; submittedIndex++) {
          const deltaX = trafficPosition.x - acceptedTrafficX[submittedIndex];
          const deltaY = trafficPosition.y - acceptedTrafficY[submittedIndex];
          const deltaZ = trafficPosition.z - acceptedTrafficZ[submittedIndex];
          const centerDistanceM = Math.hypot(deltaX, deltaY, deltaZ);
          const surfaceGapM = centerDistanceM
            - trafficRadiusM - acceptedTrafficRadius[submittedIndex];
          if (surfaceGapM < minimumTrafficSurfaceGapM) {
            separatedFromSubmittedTraffic = false;
            break;
          }
          ambientTrafficMinimumSubmittedCenterGapM = Math.min(
            ambientTrafficMinimumSubmittedCenterGapM,
            centerDistanceM
          );
          ambientTrafficMinimumSubmittedSurfaceGapM = Math.min(
            ambientTrafficMinimumSubmittedSurfaceGapM,
            surfaceGapM
          );
        }
        marker.edgeId = edge.id;
        marker.x = frameX;
        marker.y = frameY + frame.upY * 0.58;
        marker.z = frameZ;
        marker.heading = frame.yaw;
        marker.radiusM = trafficRadiusM;
        if (!separatedFromSubmittedTraffic) {
          // Suppression happens before InstancedMesh submission, so an invisible duplicate cannot retain a stale
          // matrix and intersect the accepted companion. The fixed slot and marker stay alive for later frames.
          marker.opacity = 0;
          marker.visible = false;
          marker.separationSuppressed = true;
          ambientTrafficSeparationSuppressedCount++;
          continue;
        }
        acceptedTrafficX[count] = trafficPosition.x;
        acceptedTrafficY[count] = trafficPosition.y;
        acceptedTrafficZ[count] = trafficPosition.z;
        acceptedTrafficRadius[count] = trafficRadiusM;
        trafficMatrix.compose(trafficPosition, trafficQuaternion, trafficScale);
        traffic.setMatrixAt(count, trafficMatrix);
        const fadeIntensity = 0.04 + fade * 0.96;
        trafficColor.setRGB(
          (0.70 + slot.colorMix * 0.24) * fadeIntensity,
          (0.86 + fade * 0.12) * fadeIntensity,
          (0.92 + (1 - slot.colorMix) * 0.08) * fadeIntensity
        );
        traffic.setColorAt(count, trafficColor);
        marker.opacity = fade * trafficMaterial.opacity;
        marker.visible = fade > 0.08;
        if (marker.visible) {
          ambientTrafficMarkerVisibleCount++;
          const renderedWidthM = trafficShape.widthM * Math.abs(trafficScale.x);
          const renderedHeightM = trafficShape.heightM * Math.abs(trafficScale.y);
          const renderedLengthM = trafficShape.lengthM * Math.abs(trafficScale.z);
          const visibleScaleRatio = Math.min(
            Math.abs(trafficScale.x) / Math.max(0.000_001, slot.scale * slot.widthScale),
            Math.abs(trafficScale.y) / Math.max(0.000_001, slot.scale * slot.heightScale),
            Math.abs(trafficScale.z) / Math.max(0.000_001, slot.scale * slot.lengthScale)
          );
          ambientTrafficMinimumVisibleScaleRatio = Math.min(
            ambientTrafficMinimumVisibleScaleRatio,
            visibleScaleRatio
          );
          ambientTrafficMinimumRenderedWidthM = Math.min(ambientTrafficMinimumRenderedWidthM, renderedWidthM);
          ambientTrafficMinimumRenderedHeightM = Math.min(ambientTrafficMinimumRenderedHeightM, renderedHeightM);
          ambientTrafficMinimumRenderedLengthM = Math.min(ambientTrafficMinimumRenderedLengthM, renderedLengthM);
          const keepsReadableShape = renderedWidthM >= minimumReadableTrafficShape.widthM
            && renderedHeightM >= minimumReadableTrafficShape.heightM
            && renderedLengthM >= minimumReadableTrafficShape.lengthM;
          if (keepsReadableShape) ambientTrafficFullShapeVisibleCount++;
          else ambientTrafficSmallShapeViolationCount++;
        }
        count++;
      }
      if (ambientTrafficMinimumSubmittedSurfaceGapM < minimumTrafficSurfaceGapM - 0.000_001) {
        ambientTrafficSeparationViolationCount++;
      }
      traffic.count = count;
      traffic.instanceMatrix.needsUpdate = true;
      // InstancedMesh does not invalidate its sphere in setMatrixAt. Recompute from the uploaded Float32
      // matrices, including geometry-centre offsets, non-uniform scale, and this frame's suppressed-slot count.
      traffic.computeBoundingSphere();
      ambientTrafficBoundsUpdateCount++;
      if (traffic.instanceColor) traffic.instanceColor.needsUpdate = true;
    }

    function getAmbientTrafficMarkers() {
      return ambientTrafficMarkers;
    }

    /** Return retained absolute blocker envelopes consumed by Film without exposing mesh or route mutation. */
    function getCameraBlockers() {
      return routeCameraBlockers;
    }

    /** Return the immutable fixture/light-binding contract without allocating Three.js lights in the tile visual. */
    function getTunnelLightEmitters() {
      return frozenTunnelLightEmitters;
    }

    /** Return bridge-soffit and tunnel fixtures through one immutable renderer-facing contract. */
    function getCoveredRouteLightEmitters() {
      return frozenCoveredRouteLightEmitters;
    }

    function getDecisionGuidance() {
      return activeDecisionGuidance;
    }

    function recolorLineGeometry(geometry) {
      const colors = geometry?.getAttribute?.('color');
      if (!colors) return;
      paletteGeneralScratch.setHex(activeLineEdgeHex);
      paletteRampScratch.setHex(activeLineAccentHex);
      const generalComponents = Number(geometry.userData.generalComponentCount) || 0;
      for (let component = 0; component < colors.array.length; component += 3) {
        const color = component < generalComponents ? paletteGeneralScratch : paletteRampScratch;
        colors.array[component] = color.r;
        colors.array[component + 1] = color.g;
        colors.array[component + 2] = color.b;
      }
      colors.needsUpdate = true;
    }

    /**
     * Sample only the resident tunnel's diffuse bounce floor for a moving receiver. The caller owns `out` and
     * the ship owns the PI / reference-gray conversion; fixture peaks and real direct spots must not be counted
     * twice. Reuse the existing edge map and authored portal easing without changing materials or residency.
     */
    function sampleTunnelBounce(edgeId, edgeS, out, expectedProfileId = null) {
      out.valid = false;
      out.enclosure = out.irradiance = out.red = out.green = out.blue = 0;
      if (disposed || !group.visible || typeof edgeId !== 'string' || !Number.isFinite(edgeS)) return out;
      const edge = edgeVisuals.get(edgeId)?.edge;
      if (!edge || !Array.isArray(edge.tunnelProfiles)) return out;
      for (const profile of edge.tunnelProfiles) {
        if (expectedProfileId !== null && profile.id !== expectedProfileId) continue;
        const levels = staticTunnelIrradianceLevels(profile);
        if (!levels) continue;
        const enclosure = sampleTunnelEnclosure(profile, edgeS);
        const irradiance = levels.floor * enclosure;
        if (irradiance <= out.irradiance) continue;
        out.valid = true;
        out.enclosure = enclosure;
        out.irradiance = irradiance;
      }
      if (out.valid) {
        out.red = STATIC_TUNNEL_IRRADIANCE_CONTRACT.colorLinear[0];
        out.green = STATIC_TUNNEL_IRRADIANCE_CONTRACT.colorLinear[1];
        out.blue = STATIC_TUNNEL_IRRADIANCE_CONTRACT.colorLinear[2];
      }
      return out;
    }

    /** Apply stable biome line colors and continuous visual-only weather response without rebuilding road buffers. */
    function setPalette({ edge, accent, surfaceTint, wetness, snowCover } = {}) {
      const linePaletteKey = `${Number.isFinite(edge) ? edge : '-'}:${Number.isFinite(accent) ? accent : '-'}`;
      // Weather can change every frame; only stable edge/accent changes may rescan and upload line-color buffers.
      if (linePaletteKey !== lastLinePaletteKey) {
        lastLinePaletteKey = linePaletteKey;
        activeLineEdgeHex = Number.isFinite(edge) ? edge : 0xe7_f1ee;
        activeLineAccentHex = Number.isFinite(accent) ? accent : 0xd9_c88b;
        hasActiveLinePalette = true;
        recolorLineGeometry(preparedTemplate.staticLineGeometry);
        syncRoadMarkingRibbonColors(preparedTemplate.staticLineGeometry, ultraStaticMarkings.geometry);
        for (const [signature, template] of recoveryVariants) {
          recolorLineGeometry(template.staticLineGeometry);
          syncRoadMarkingRibbonColors(
            template.staticLineGeometry,
            ultraRecoveryMarkingGeometries.get(signature)
          );
        }
        if (Number.isFinite(accent)) {
          selectedMaterial.color.setHex(accent);
          proposedMaterial.color.setHex(accent);
          arrowMaterial.color.setHex(accent);
        }
      }

      const normalizedSurfaceTint = Number.isFinite(surfaceTint) ? surfaceTint : 0xff_ffff;
      const normalizedWetness = clamp(Number(wetness) || 0, 0, 1);
      const normalizedSnowCover = clamp(Number(snowCover) || 0, 0, 1);
      const surfaceMaterialKey = `${normalizedSurfaceTint}:${normalizedWetness}:${normalizedSnowCover}`;
      if (surfaceMaterialKey !== lastSurfaceMaterialKey) {
        lastSurfaceMaterialKey = surfaceMaterialKey;
        roadMaterial.color.setHex(normalizedSurfaceTint);
        const exposedWetness = normalizedWetness * (1 - normalizedSnowCover);
        roadMaterial.roughness = clamp(
          0.86 - exposedWetness * 0.34 + normalizedSnowCover * 0.10,
          0.44,
          0.98
        );
        roadMaterial.metalness = 0;
        roadMaterial.envMapIntensity = 0.28 + exposedWetness * 0.16;
        roadMaterial.clearcoat = clamp(exposedWetness * 0.74, 0, 0.78);
        roadMaterial.clearcoatRoughness = clamp(
          0.52 - exposedWetness * 0.28 + normalizedSnowCover * 0.16,
          0.18,
          0.68
        );
        lowRoadMaterial.color.copy(roadMaterial.color);
        lowRoadMaterial.roughness = roadMaterial.roughness;
        lowRoadMaterial.metalness = 0;
        lowRoadMaterial.envMapIntensity = roadMaterial.envMapIntensity;
        lowRoadMaterial.clearcoat = roadMaterial.clearcoat;
        lowRoadMaterial.clearcoatRoughness = roadMaterial.clearcoatRoughness;
        ultraRoadMaterial.color.setHex(normalizedSurfaceTint);
        ultraRoadMaterial.roughness = clamp(
          0.82 - exposedWetness * 0.40 + normalizedSnowCover * 0.14,
          0.30,
          0.96
        );
        ultraRoadMaterial.metalness = 0;
        ultraRoadMaterial.clearcoat = clamp(0.025 + exposedWetness * 0.76, 0.02, 0.82);
        ultraRoadMaterial.clearcoatRoughness = clamp(
          0.48 - exposedWetness * 0.31 + normalizedSnowCover * 0.20,
          0.12,
          0.68
        );
        ultraRoadMaterial.envMapIntensity = 0.48 + exposedWetness * 0.18;
      }
    }

    /** Swap only prebuilt presentation materials/markings; road geometry and all route contracts stay immutable. */
    function setRenderQuality(id) {
      const normalizedId = id === 'high' ? 'high' : id === 'low' ? 'low' : 'medium';
      const highEnabled = normalizedId === 'high';
      activeRenderQualityId = normalizedId;
      const selectedRoadMaterial = highEnabled
        ? ultraRoadMaterial
        : normalizedId === 'low' ? lowRoadMaterial : roadMaterial;
      roadShell.material = selectedRoadMaterial;
      recoveryRoadShell.material = selectedRoadMaterial;
      supports.material = highEnabled ? ultraSupportMaterial : supportMaterial;
      supportCaps.material = highEnabled ? ultraCapMaterial : capMaterial;
      beams.material = highEnabled ? ultraBeamMaterial : beamMaterial;
      tunnelShells.material = highEnabled ? ultraTunnelShellMaterial : tunnelShellMaterial;
      structuralDetails.material = highEnabled ? ultraStructuralDetailMaterial : structuralDetailMaterial;
      staticGeneralLines.visible = !highEnabled;
      recoveryStaticLines.visible = !highEnabled && activeRecoveryTemplate.edges.length > 0;
      ultraStaticMarkings.visible = highEnabled;
      ultraRecoveryMarkings.visible = highEnabled && activeRecoveryTemplate.edges.length > 0;
      return true;
    }

    setRenderQuality(activeRenderQualityId);

    const opaqueShadowMeshes = Object.freeze([
      roadShell,
      recoveryRoadShell,
      supports,
      supportCaps,
      beams,
      tunnelShells,
      structuralDetails,
      goreNoses,
      traffic
    ]);
    const transparentShadowExemptVisuals = Object.freeze([
      staticGeneralLines,
      recoveryStaticLines,
      decorativeLaneGuides,
      selectedRoute,
      proposedRoute,
      underpassLights,
      exitSigns,
      roadArrows
    ]);

    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      selectedRoute.geometry.dispose();
      proposedRoute.geometry.dispose();
      ultraStaticMarkings.geometry.dispose();
      for (const geometry of ultraRecoveryMarkingGeometries.values()) geometry.dispose();
      ultraRecoveryMarkingGeometries.clear();
      supportGeometry.dispose();
      capGeometry.dispose();
      beamGeometry.dispose();
      underpassLightGeometry.dispose();
      tunnelShellGeometry.dispose();
      structuralDetailGeometry.dispose();
      traffic.geometry.dispose();
      goreGeometry.dispose();
      arrowGeometry.dispose();
      roadMaterial.dispose();
      lowRoadMaterial.dispose();
      ultraRoadMaterial.dispose();
      ultraRoadTextureSet.normal.dispose();
      ultraRoadTextureSet.roughness.dispose();
      edgeMaterial.dispose();
      ultraMarkingMaterial.dispose();
      selectedMaterial.dispose();
      proposedMaterial.dispose();
      supportMaterial.dispose();
      ultraSupportMaterial.dispose();
      capMaterial.dispose();
      ultraCapMaterial.dispose();
      beamMaterial.dispose();
      ultraBeamMaterial.dispose();
      underpassLightMaterial.dispose();
      tunnelShellMaterial.dispose();
      ultraTunnelShellMaterial.dispose();
      decorativeLaneMaterial.dispose();
      structuralDetailMaterial.dispose();
      ultraStructuralDetailMaterial.dispose();
      trafficMaterial.dispose();
      goreMaterial.dispose();
      arrowMaterial.dispose();
      exitSigns.geometry.dispose();
      exitSigns.userData.releaseAtlas?.();
      for (const template of recoveryVariants.values()) disposeGeometryBatch(template);
      recoveryVariants.clear();
      preparedTemplate.releaseBaseTemplate?.();
    }

    /** Count submitted tile-local batches, distinct from the 19 preallocated reusable batch objects. */
    function currentVisibleDrawGroupCount() {
      if (!group.visible) return 0;
      return group.children.reduce((count, child) => (
        count + Number(child.visible && (!child.isInstancedMesh || child.count > 0))
      ), 0);
    }

    return Object.freeze({
      group,
      edgeVisuals,
      roadShell,
      recoveryRoadShell,
      selectedRoute,
      proposedRoute,
      staticGeneralLines,
      staticRampRails,
      recoveryStaticLines,
      ultraStaticMarkings,
      ultraRecoveryMarkings,
      supports,
      supportCaps,
      beams,
      underpassLights,
      tunnelShells,
      decorativeLaneGuides,
      structuralDetails,
      railPosts,
      signs,
      exitSigns,
      goreNoses,
      roadArrows,
      traffic,
      physicalSpans,
      update,
      setPathPlan,
      setPalette,
      setRenderQuality,
      getAmbientTrafficMarkers,
      getCameraBlockers,
      getCoveredRouteLightEmitters,
      getTunnelLightEmitters,
      sampleTunnelBounce,
      getDecisionGuidance,
      createRecoveryVariantJob,
      hasRecoveryVariant,
      installRecoveryVariant,
      activateRecoveryVariant,
      dispose,
      diagnostics: Object.freeze({
        edgeCount: edgeVisuals.size,
        crossingCount: crossings.length,
        physicalSpanCount: physicalSpans.length,
        mergedCrossingCount: Math.max(0, crossings.length - physicalSpans.length),
        standardTileDiagnostics: Object.freeze({
          crossingCount: crossings.length,
          physicalSpanCount: physicalSpans.length,
          mergedCrossingCount: Math.max(0, crossings.length - physicalSpans.length),
          bridgeSpanOverlapCount,
          bridgeDeckThicknessError: standardTileMetrics.bridgeDeckThicknessError || 0,
          roadShellWidthError: standardTileMetrics.roadShellWidthError || 0,
          dynamicRoadWidthSamples: standardTileMetrics.dynamicRoadWidthSamples || 0,
          junctionBiasSamples: standardTileMetrics.junctionBiasSamples || 0,
          trimmedBarrierSampleCount: standardTileMetrics.trimmedBarrierSampleCount || 0,
          retainedJunctionBoundaryCount: standardTileMetrics.retainedJunctionBoundaryCount || 0,
          suppressedConnectedCapCount: standardTileMetrics.suppressedConnectedCapCount || 0,
          recessedTopologySealCount: standardTileMetrics.recessedTopologySealCount || 0,
          junctionApronCandidateCount: standardTileMetrics.junctionApronCandidateCount || 0,
          junctionApronCount: standardTileMetrics.junctionApronCount || 0,
          junctionApronCoverageMissCount: standardTileMetrics.junctionApronCoverageMissCount || 0,
          junctionApronTopologyFailureCount: standardTileMetrics.junctionApronTopologyFailureCount || 0,
          junctionApronMaximumSpanM: standardTileMetrics.junctionApronMaximumSpanM || 0,
          junctionApronSurfaceLiftM: standardTileMetrics.junctionApronSurfaceLiftM || 0,
          junctionLongPairCount: standardTileMetrics.junctionLongPairCount || 0,
          junctionLensCount: standardTileMetrics.junctionLensCount || 0,
          junctionLensResidualOverlapCount: standardTileMetrics.junctionLensResidualOverlapCount || 0,
          junctionLensMaximumRunM: standardTileMetrics.junctionLensMaximumRunM || 0,
          junctionLensMaximumCrossWidthM: standardTileMetrics.junctionLensMaximumCrossWidthM || 0,
          junctionLensClearanceToleranceM: standardTileMetrics.junctionLensClearanceToleranceM || 0,
          junctionLensCoverageStationCount: standardTileMetrics.junctionLensCoverageStationCount || 0,
          junctionLensUncoveredStationCount: standardTileMetrics.junctionLensUncoveredStationCount || 0,
          junctionLensApronContinuityFailureCount:
            standardTileMetrics.junctionLensApronContinuityFailureCount || 0,
          junctionLensClearanceFailureCount: standardTileMetrics.junctionLensClearanceFailureCount || 0,
          junctionLensMaximumEndClearanceErrorM:
            standardTileMetrics.junctionLensMaximumEndClearanceErrorM || 0,
          junctionVerticallySeparatedPairCount:
            standardTileMetrics.junctionVerticallySeparatedPairCount || 0,
          junctionVerticalSeparationStationCount:
            standardTileMetrics.junctionVerticalSeparationStationCount || 0,
          junctionVerticalSeparationFailureCount:
            standardTileMetrics.junctionVerticalSeparationFailureCount || 0,
          junctionMinimumVerticalShellGapM:
            standardTileMetrics.junctionMinimumVerticalShellGapM ?? null,
          junctionLensTopologyFailureCount: standardTileMetrics.junctionLensTopologyFailureCount || 0,
          junctionRaisedBarrierIntrusionCount:
            standardTileMetrics.junctionRaisedBarrierIntrusionCount || 0
        }),
        get expectedSupportCount() {
          return permanentExpectedSupportCount + (activeRuntimeSupportLayout?.records.length || 0);
        },
        get supportCount() { return supportIndex; },
        crossingSupportCount,
        get elevatedRoadEdgeCount() {
          return elevatedRoadEdgeCount + (activeRuntimeSupportLayout?.elevatedEdgeCount || 0);
        },
        get elevatedRoadSupportCount() {
          return elevatedRoadSupportCount + (activeRuntimeSupportLayout?.records.length || 0);
        },
        get runtimeElevatedRoadSupportCount() { return activeRuntimeSupportLayout?.records.length || 0; },
        get elevatedSupportCandidateCount() {
          return elevatedSupportCandidateCount + (activeRuntimeSupportLayout?.candidateCount || 0);
        },
        get elevatedSupportBlockedCandidateCount() {
          return elevatedSupportBlockedCandidateCount + (activeRuntimeSupportLayout?.blockedCandidateCount || 0);
        },
        get elevatedSupportUnsupportedEdgeCount() {
          return elevatedSupportUnsupportedEdgeCount + (activeRuntimeSupportLayout?.unsupportedEdgeCount || 0);
        },
        get elevatedSupportUnsupportedEdgeIds() {
          return Object.freeze([
            ...elevatedSupportUnsupportedEdgeIds,
            ...(activeRuntimeSupportLayout?.unsupportedEdgeIds || [])
          ]);
        },
        get elevatedSupportBlockedByEdgeIds() {
          return Object.freeze([
            ...elevatedSupportBlockedByEdgeIds,
            ...(activeRuntimeSupportLayout?.blockedByEdgeIds || [])
          ]);
        },
        elevatedSupportSpacing,
        get elevatedSupportMaximumGap() {
          return Math.max(elevatedSupportMaximumGap, activeRuntimeSupportLayout?.maximumGap || 0);
        },
        get elevatedSupportMaximumGapEdgeId() {
          return (activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap
            ? activeRuntimeSupportLayout.maximumGapEdgeId
            : elevatedSupportMaximumGapEdgeId;
        },
        get elevatedSupportMaximumGapStations() {
          if ((activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap) {
            return activeRuntimeSupportLayout.maximumGapStations || Object.freeze([]);
          }
          return Object.freeze([...(supportStationsByEdge.get(elevatedSupportMaximumGapEdgeId) || [])]);
        },
        get elevatedSupportMaximumGapCoverage() {
          if ((activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap) {
            return activeRuntimeSupportLayout.maximumGapCoverage || null;
          }
          return elevatedSupportCoverageByEdge.get(elevatedSupportMaximumGapEdgeId) || null;
        },
        get elevatedSupportMaximumGapSource() {
          return (activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap
            ? 'active-runtime-layout'
            : 'resident-template-layout';
        },
        get elevatedSupportMaximumGapStartS() {
          return (activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap
            ? activeRuntimeSupportLayout.maximumGapStartS
            : null;
        },
        get elevatedSupportMaximumGapEndS() {
          return (activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap
            ? activeRuntimeSupportLayout.maximumGapEndS
            : null;
        },
        get elevatedSupportMaximumAllowedGap() {
          // The visual gate must compare the largest observed bay with that edge's authored
          // structure rhythm; the opposing crossover intentionally uses wider continuous-box-girder bays.
          if ((activeRuntimeSupportLayout?.maximumGap || 0) > elevatedSupportMaximumGap) {
            return activeRuntimeSupportLayout.maximumAllowedGapForMaximumGapEdge
              || elevatedSupportSpacing * 2 + 0.01;
          }
          return elevatedSupportSpacing * 2 + 0.01;
        },
        get elevatedSupportStandardMaximumAllowedGap() {
          return activeRuntimeSupportLayout?.standardMaximumAllowedGap
            || elevatedSupportSpacing * 2 + 0.01;
        },
        get elevatedSupportGapViolationCount() {
          return (elevatedSupportMaximumGap > elevatedSupportSpacing * 2 + 0.01 ? 1 : 0)
            + (activeRuntimeSupportLayout?.gapViolationCount || 0);
        },
        get elevatedSupportGapViolations() {
          return activeRuntimeSupportLayout?.gapViolations || Object.freeze([]);
        },
        get designedLongSpanCount() {
          return activeRuntimeSupportLayout?.designedLongSpanCount || 0;
        },
        get designedLongSpans() {
          return activeRuntimeSupportLayout?.designedLongSpans || Object.freeze([]);
        },
        get runtimeLongSpanStructureInstanceCount() {
          return activeRuntimeLongSpanStructureCount;
        },
        get runtimeRouteStructureInstanceCount() {
          return activeRuntimeLongSpanStructureCount;
        },
        runtimeLongSpanStructureCapacity: RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY,
        runtimeRouteStructureCapacity: RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY,
        get runtimeSupportSpacingByEdge() {
          return activeRuntimeSupportLayout?.supportSpacingByEdge || Object.freeze({});
        },
        get runtimeLongSpanUnrenderedCount() {
          return (activeRuntimeSupportLayout?.designedLongSpanCount || 0) > 0
            && activeRuntimeLongSpanStructureCount === 0
            ? activeRuntimeSupportLayout.designedLongSpanCount
            : 0;
        },
        get elevatedSupportMinimumPierHeight() {
          return Math.min(
            Number.isFinite(elevatedSupportMinimumPierHeight)
              ? elevatedSupportMinimumPierHeight
              : Number.POSITIVE_INFINITY,
            Number.isFinite(activeRuntimeSupportLayout?.minimumPierHeight)
              ? activeRuntimeSupportLayout.minimumPierHeight
              : Number.POSITIVE_INFINITY
          );
        },
        get supportFootingCount() {
          return permanentSupportFootingCount + (activeRuntimeSupportLayout?.records || []).reduce(
            (sum, record) => sum
              + (record.footingMatrices?.length || (record.footingMatrix ? 1 : 0)),
            0
          );
        },
        get supportCapAndFootingCount() { return supportCapIndex; },
        supportGroundY,
        get supportGroundHeightSource() {
          return activeRuntimeSupportLayout?.supportGroundHeightSource
            || supportGroundHeightResolver.diagnostics().source;
        },
        get supportGroundHeightSampleCount() {
          return supportGroundHeightResolver.diagnostics().sampleCount
            + (activeRuntimeSupportLayout?.supportGroundHeightSampleCount || 0);
        },
        get supportGroundHeightFallbackCount() {
          return supportGroundHeightResolver.diagnostics().fallbackCount
            + (activeRuntimeSupportLayout?.supportGroundHeightFallbackCount || 0);
        },
        get minimumSupportGroundY() {
          const permanent = supportGroundHeightResolver.diagnostics().minimumGroundY;
          const runtime = activeRuntimeSupportLayout?.minimumSupportGroundY;
          const minimum = Math.min(
            Number.isFinite(permanent) ? permanent : Number.POSITIVE_INFINITY,
            Number.isFinite(runtime) ? runtime : Number.POSITIVE_INFINITY
          );
          return Number.isFinite(minimum) ? minimum : null;
        },
        get maximumSupportGroundY() {
          const permanent = supportGroundHeightResolver.diagnostics().maximumGroundY;
          const runtime = activeRuntimeSupportLayout?.maximumSupportGroundY;
          const maximum = Math.max(
            Number.isFinite(permanent) ? permanent : Number.NEGATIVE_INFINITY,
            Number.isFinite(runtime) ? runtime : Number.NEGATIVE_INFINITY
          );
          return Number.isFinite(maximum) ? maximum : null;
        },
        get supportGroundContactError() {
          return Math.max(supportGroundContactError, activeRuntimeSupportLayout?.groundContactError || 0);
        },
        get supportMaximumInvalidOutwardCapOverhang() {
          return Math.max(
            supportMaximumInvalidOutwardCapOverhang,
            activeRuntimeSupportLayout?.maximumInvalidOutwardCapOverhang || 0
          );
        },
        get supportMinimumPierCapOverlap() {
          const minimum = Math.min(
            Number.isFinite(supportMinimumPierCapOverlap)
              ? supportMinimumPierCapOverlap
              : Number.POSITIVE_INFINITY,
            Number.isFinite(activeRuntimeSupportLayout?.minimumPierCapOverlap)
              ? activeRuntimeSupportLayout.minimumPierCapOverlap
              : Number.POSITIVE_INFINITY
          );
          return Number.isFinite(minimum) ? minimum : null;
        },
        supportPlacementFailureCount,
        supportRoadOverlapCount,
        get supportMinimumRoadGap() {
          const runtimeGap = activeRuntimeSupportLayout?.minimumRoadGap;
          const minimum = Math.min(
            Number.isFinite(supportMinimumRoadGap) ? supportMinimumRoadGap : Number.POSITIVE_INFINITY,
            Number.isFinite(runtimeGap) ? runtimeGap : Number.POSITIVE_INFINITY
          );
          return Number.isFinite(minimum) ? minimum : null;
        },
        get supportMinimumSurfaceGap() {
          const runtimeGap = activeRuntimeSupportLayout?.minimumSurfaceGap;
          const minimum = Math.min(
            Number.isFinite(supportMinimumSurfaceGap) ? supportMinimumSurfaceGap : Number.POSITIVE_INFINITY,
            Number.isFinite(runtimeGap) ? runtimeGap : Number.POSITIVE_INFINITY
          );
          return Number.isFinite(minimum) ? minimum : null;
        },
        bridgeDeckThickness: deckThickness,
        bridgePierRadius: pierRadius,
        bridgeSupportClearanceRadius: supportClearanceRadius,
        bridgePierClearanceMargin: supportClearanceRadius - pierRadius,
        bridgeDeckThicknessError,
        roadShellWidthError,
        dynamicRoadWidthSamples,
        junctionBiasSamples,
        trimmedBarrierSampleCount,
        retainedJunctionBoundaryCount,
        suppressedConnectedCapCount,
        recessedTopologySealCount,
        junctionApronCandidateCount,
        junctionApronCount,
        junctionApronCoverageMissCount,
        junctionApronTopologyFailureCount,
        junctionApronMaximumSpanM,
        junctionApronSurfaceLiftM,
        junctionLongPairCount,
        junctionLensCount,
        junctionLensResidualOverlapCount,
        junctionLensMaximumRunM,
        junctionLensMaximumCrossWidthM,
        junctionLensClearanceToleranceM,
        junctionLensCoverageStationCount,
        junctionLensUncoveredStationCount,
        junctionLensApronContinuityFailureCount,
        junctionLensClearanceFailureCount,
        junctionLensMaximumEndClearanceErrorM,
        junctionVerticallySeparatedPairCount,
        junctionVerticalSeparationStationCount,
        junctionVerticalSeparationFailureCount,
        junctionMinimumVerticalShellGapM,
        junctionLensTopologyFailureCount,
        junctionGuardrailIntrusionCount: preparedTemplate.metrics.junctionRaisedBarrierIntrusionCount,
        junctionRaisedBarrierIntrusionCount: preparedTemplate.metrics.junctionRaisedBarrierIntrusionCount,
        get straightForkVoidBoundaryCount() {
          return (preparedTemplate.baseTemplate.metrics.straightForkVoidBoundaryCount || 0)
            + (activeRecoveryTemplate.metrics.straightForkVoidBoundaryCount || 0);
        },
        get straightForkVoidBoundarySampleCount() {
          return (preparedTemplate.baseTemplate.metrics.straightForkVoidBoundarySampleCount || 0)
            + (activeRecoveryTemplate.metrics.straightForkVoidBoundarySampleCount || 0);
        },
        get maximumStraightForkVoidBoundaryHeightM() {
          return Math.max(
            preparedTemplate.baseTemplate.metrics.maximumStraightForkVoidBoundaryHeightM || 0,
            activeRecoveryTemplate.metrics.maximumStraightForkVoidBoundaryHeightM || 0
          );
        },
        straightForkVoidBoundaryFullWidthM:
          preparedTemplate.metrics.straightForkVoidBoundaryFullWidthM,
        get jumpPlatformCount() { return activeRecoveryTemplate.metrics.jumpPlatformCount || 0; },
        get jumpPlatformEdgeCount() { return activeRecoveryTemplate.metrics.jumpPlatformEdgeCount || 0; },
        get jumpPlatformVariantCount() { return activeRecoveryTemplate.metrics.jumpPlatformVariantCount || 0; },
        get jumpPlatformDimensionSignatureCount() {
          return activeRecoveryTemplate.metrics.jumpPlatformDimensionSignatureCount || 0;
        },
        get jumpPlatformVertexCount() { return activeRecoveryTemplate.metrics.jumpPlatformVertexCount || 0; },
        get jumpPlatformTriangleCount() { return activeRecoveryTemplate.metrics.jumpPlatformTriangleCount || 0; },
        get jumpPlatformMinimumWidthM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMinimumWidthM || 0;
        },
        get jumpPlatformMaximumWidthM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMaximumWidthM || 0;
        },
        get jumpPlatformMinimumHeightM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMinimumHeightM || 0;
        },
        get jumpPlatformMaximumHeightM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMaximumHeightM || 0;
        },
        get jumpPlatformMinimumLengthM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMinimumLengthM || 0;
        },
        get jumpPlatformMaximumLengthM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMaximumLengthM || 0;
        },
        get jumpPlatformMaximumAbsLateralM() {
          return activeRecoveryTemplate.metrics.jumpPlatformMaximumAbsLateralM || 0;
        },
        get jumpPlatformMergedIntoRecoveryRoadShell() {
          return activeRecoveryTemplate.metrics.jumpPlatformCount === 0
            || activeRecoveryTemplate.roadShellGeometry.userData.jumpPlatformCount
              === activeRecoveryTemplate.metrics.jumpPlatformCount;
        },
        jumpPlatformUnderlyingRoadRemainsFlat: true,
        get jumpPlatformAdditionalDrawGroupCount() {
          return activeRecoveryTemplate.metrics.jumpPlatformAdditionalDrawGroupCount || 0;
        },
        get jumpPlatformAdditionalObjectCount() {
          return activeRecoveryTemplate.metrics.jumpPlatformAdditionalObjectCount || 0;
        },
        bridgeSpanOverlapCount,
        beamCount: beamIndex,
        underpassLightCount: underpassLightIndex,
        roadMaterialType: roadMaterial.type,
        roadMaterialPhysical: roadMaterial.isMeshPhysicalMaterial === true,
        roadMaterialDielectric: roadMaterial.metalness === 0,
        staticTunnelIrradianceContractVersion:
          roadShell.geometry.userData.staticTunnelIrradianceContractVersion || 0,
        staticTunnelIrradianceAttribute:
          roadShell.geometry.hasAttribute(STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute),
        staticTunnelIrradianceDistanceGated:
          roadShell.geometry.userData.staticTunnelIrradianceDistanceGated,
        staticTunnelIrradiancePositiveVertexCount:
          roadShell.geometry.userData.staticTunnelIrradiancePositiveVertexCount || 0,
        staticTunnelIrradianceMaximum:
          roadShell.geometry.userData.staticTunnelIrradianceMaximum || 0,
        staticTunnelIrradianceAdditionalDrawGroupCount:
          roadShell.geometry.userData.staticTunnelIrradianceAdditionalDrawGroupCount || 0,
        staticTunnelIrradianceAdditionalObjectCount:
          roadShell.geometry.userData.staticTunnelIrradianceAdditionalObjectCount || 0,
        staticTunnelIrradianceReceiverMeshCount: 3,
        standardRoadCoordinateDetail: roadMaterial.userData.neonV23SurfaceDetail,
        lowRoadCoordinateDetail: lowRoadMaterial.userData.neonV23SurfaceDetail,
        supportMaterialRoughness: supportMaterial.roughness,
        supportMaterialMetalness: supportMaterial.metalness,
        beamMaterialRoughness: beamMaterial.roughness,
        beamMaterialMetalness: beamMaterial.metalness,
        skyRouteSceneryContractVersion: SKY_ROUTE_SCENERY_CONTRACT.version,
        skyRouteSceneryMaterialFamily: SKY_ROUTE_SCENERY_CONTRACT.materials.family,
        skyRouteSceneryRuntimeAllocation: SKY_ROUTE_SCENERY_CONTRACT.invariants.runtimeAllocation,
        ambientTrafficArtContractVersion: AMBIENT_TRAFFIC_ART_CONTRACT.version,
        ambientTrafficArtMaterialFamily: AMBIENT_TRAFFIC_ART_CONTRACT.materials.family,
        ambientTrafficArtRuntimeAllocation: AMBIENT_TRAFFIC_ART_CONTRACT.invariants.runtimeAllocation,
        skyRouteWayfindingArtContractVersion: SKY_ROUTE_WAYFINDING_ART_CONTRACT.version,
        skyRouteWayfindingDecisionRole: SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionStructure.role,
        skyRouteWayfindingDecisionInscriptionRole:
          SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.role,
        skyRouteWayfindingGoreRole: SKY_ROUTE_WAYFINDING_ART_CONTRACT.gore.role,
        skyRouteWayfindingExitSignStyle: SKY_ROUTE_WAYFINDING_ART_CONTRACT.exitSign.style,
        get roadMaterialClearcoat() { return roadMaterial.clearcoat; },
        get roadMaterialClearcoatRoughness() { return roadMaterial.clearcoatRoughness; },
        get renderQualityId() { return activeRenderQualityId; },
        get ultraRoadEnabled() { return activeRenderQualityId === 'high'; },
        ultraRoadCoordinateAttribute: roadShell.geometry.hasAttribute('roadCoord'),
        ultraRoadNormalMap: ultraRoadMaterial.normalMap?.isTexture === true,
        ultraRoadRoughnessMap: ultraRoadMaterial.roughnessMap?.isTexture === true,
        get ultraPhysicalMarkingVisible() {
          return ultraStaticMarkings.visible && !staticGeneralLines.visible;
        },
        mobileStructuralBasicMaterialViolationCount: beamMaterial.isMeshBasicMaterial === true ? 1 : 0,
        opaqueShadowMeshCount: opaqueShadowMeshes.length,
        get opaqueShadowViolationCount() {
          return opaqueShadowMeshes.filter((mesh) => mesh.castShadow !== true || mesh.receiveShadow !== true).length;
        },
        transparentShadowExemptVisualCount: transparentShadowExemptVisuals.length,
        get transparentShadowExemptionViolationCount() {
          return transparentShadowExemptVisuals.filter((visual) => (
            typeof visual.userData.shadowExemptReason !== 'string'
              || visual.userData.shadowExemptReason.length === 0
          )).length;
        },
        tunnelProfileCount: tunnelProfileSpecs.length,
        mountainTunnelCount: tunnelProfileSpecs.filter((spec) => (
          spec.profile.kind === 'mountain-tunnel'
        )).length,
        undergroundTunnelCount: tunnelProfileSpecs.filter((spec) => (
          spec.profile.kind === 'underground-tunnel'
        )).length,
        tunnelRibCount,
        tunnelRoofPanelCount,
        tunnelPortalCount,
        bridgeLightCount,
        bridgeLightEmitterCount: frozenBridgeLightEmitters.length,
        bridgeLightEmitterMismatchCount: Math.abs(bridgeLightCount - frozenBridgeLightEmitters.length),
        tunnelLightCount,
        tunnelLightEmitterCount: frozenTunnelLightEmitters.length,
        tunnelLightEmitterMismatchCount: Math.abs(tunnelLightCount - frozenTunnelLightEmitters.length),
        tunnelLuminaireHousingCount,
        tunnelLuminaireHousingMismatchCount: Math.abs(
          tunnelLuminaireHousingCount - tunnelLightCount
        ),
        tunnelLuminaireMaximumSpacingM,
        tunnelLuminaireSpacingContractM: TUNNEL_LUMINAIRE_SPACING_M,
        tunnelLuminairePowerMode: SKY_ROUTE_SCENERY_CONTRACT.lighting.powerMode,
        tunnelLuminaireDistanceGated: SKY_ROUTE_SCENERY_CONTRACT.lighting.distanceGated,
        tunnelLuminaireApproachSensorAllowed:
          SKY_ROUTE_SCENERY_CONTRACT.lighting.approachSensorAllowed,
        tunnelStructuralEmissiveIntensity: beamMaterial.emissiveIntensity,
        tunnelShellEmissiveIntensity: tunnelShellMaterial.emissiveIntensity || 0,
        tunnelShellStaticIrradianceAttribute: tunnelShellGeometry.hasAttribute(
          STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute
        ),
        tunnelShellStaticIrradianceContractVersion:
          tunnelShellDiagnostics.staticIrradianceContractVersion,
        tunnelShellStaticIrradianceDistanceGated:
          tunnelShellDiagnostics.staticIrradianceDistanceGated,
        tunnelShellStaticIrradiancePositiveVertexCount:
          tunnelShellDiagnostics.staticIrradiancePositiveVertexCount,
        tunnelShellStaticIrradianceMinimumReceiver:
          tunnelShellDiagnostics.staticIrradianceMinimumReceiver,
        tunnelShellStaticIrradianceMaximum:
          tunnelShellDiagnostics.staticIrradianceMaximum,
        tunnelStructureStaticIrradianceAttribute: beamGeometry.hasAttribute(
          STATIC_TUNNEL_IRRADIANCE_CONTRACT.attribute
        ),
        tunnelStructureStaticIrradiancePositiveInstanceCount:
          tunnelStructureIrradiancePositiveInstanceCount,
        tunnelStructureStaticIrradianceMinimumReceiver: Number.isFinite(
          tunnelStructureIrradianceMinimumReceiver
        ) ? tunnelStructureIrradianceMinimumReceiver : 0,
        tunnelStructureStaticIrradianceMaximum: tunnelStructureIrradianceMaximum,
        coveredRouteLightEmitterCount: frozenCoveredRouteLightEmitters.length,
        coveredRouteLightEmitterMismatchCount: Math.abs(
          bridgeLightCount + tunnelLightCount - frozenCoveredRouteLightEmitters.length
        ),
        mountainOpeningCount,
        undergroundWallPanelCount,
        undergroundWallInstanceCount: 0,
        undergroundWallInstanceMismatchCount: 0,
        undergroundWallMaterialType: tunnelShellMaterial.type,
        undergroundWallMaterialPhysical: tunnelShellMaterial.isMeshPhysicalMaterial === true,
        tunnelShellMaximumSegmentLengthM: tunnelShellDiagnostics.maximumSegmentLengthM,
        tunnelShellMaximumChordErrorM: tunnelShellDiagnostics.maximumChordErrorM,
        tunnelShellRibAlignmentErrorM: tunnelShellDiagnostics.maximumRibAlignmentErrorM,
        tunnelShellPortalAlignmentErrorM: tunnelShellDiagnostics.maximumPortalAlignmentErrorM,
        tunnelShellRoadJoinSharedVertexCount: tunnelShellDiagnostics.roadJoinSharedVertexCount,
        tunnelShellMaximumRoadJoinGapM: tunnelShellDiagnostics.maximumRoadJoinGapM,
        tunnelShellMaximumRoadJoinPenetrationM: tunnelShellDiagnostics.maximumRoadJoinPenetrationM,
        tunnelShellMaximumRoadJoinAlignmentAdjustmentM:
          tunnelShellDiagnostics.maximumRoadJoinAlignmentAdjustmentM,
        tunnelShellMaximumRoofWallGapM: tunnelShellDiagnostics.maximumRoofWallGapM,
        tunnelMinimumUndergroundPortalRoadClearanceM: Number.isFinite(
          minimumUndergroundPortalRoadClearanceM
        ) ? minimumUndergroundPortalRoadClearanceM : null,
        tunnelShellStationCount: tunnelShellDiagnostics.stationCount,
        tunnelShellLongitudinalSegmentCount: tunnelShellDiagnostics.longitudinalSegmentCount,
        tunnelShellPanelCount: tunnelShellDiagnostics.panelCount,
        tunnelShellSharedLongitudinalRows: tunnelShellDiagnostics.sharedLongitudinalRows,
        tunnelWallAndRoofShadowReady: tunnelShells.castShadow === true
          && tunnelShells.receiveShadow === true
          && beams.castShadow === true
          && beams.receiveShadow === true,
        filmRouteStructureBlockerContractVersion: FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.version,
        filmRouteStructureBlockerCoordinateMode:
          FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.coordinateMode,
        filmRouteStructureBlockerGeometryAuthority:
          FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.geometryAuthority,
        filmRouteStructureStableFrameAllocations:
          FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.invariants.stableFrameAllocations,
        continuousTunnelShellCameraAuthority:
          FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT.continuousTunnelShellAuthority,
        continuousTunnelShellCameraCylinderCount: 0,
        routeCameraBlockerCapacity: routeCameraBlockers.length,
        persistentRouteStructureCameraBlockerCapacity:
          persistentRouteStructureCameraBlockers.length,
        get routeCameraBlockerVisibilitySweepCount() { return routeCameraBlockerVisibilitySweepCount; },
        get ambientTrafficBoundsUpdateCount() { return ambientTrafficBoundsUpdateCount; },
        ambientTrafficFrustumCulling: traffic.frustumCulled,
        get routeCameraBlockerVisibleCount() {
          let count = 0;
          for (const blocker of routeCameraBlockers) {
            if (blocker.visible) count++;
          }
          return count;
        },
        bridgePierCameraBlockerCapacity: supportCameraBlockers.length,
        bridgeCapAndFootingCameraBlockerCapacity: supportCapCameraBlockers.length,
        bridgeAndTunnelBeamCameraBlockerCapacity: beamCameraBlockers.length,
        layeredStructureCameraBlockerCapacity:
          structuralDetailCameraBlockers.length - decisionPylonInstanceEnd + decisionPylonInstanceStart,
        goreCameraBlockerCapacity: goreCameraBlockers.length,
        tunnelSafeCorridorViolationCount,
        decorativeLaneBundleCount: decorativeLaneGeometry.userData.bundleCount,
        decorativeLanePathCount: decorativeLaneGeometry.userData.pathCount,
        laneGateTargetMaxError: decorativeLaneGeometry.userData.gateTargetMaxError,
        laneSafeHalfViolationCount: decorativeLaneGeometry.userData.safeHalfViolationCount,
        structuralDetailCount,
        longitudinalGirderCount,
        maximumGirderChordError,
        girderChordError: maximumGirderChordError,
        maximumGirderSegmentLength,
        expansionJointCount,
        expansionJointSurfaceError,
        get decisionPylonCount() { return activeDecisionStructureCount * 2; },
        decisionPylonCapacity: decisionStructureNodeCapacity * 2,
        decisionPylonInstanceStart,
        decisionPylonInstanceEnd,
        decisionReflectorInstanceStart,
        decisionReflectorInstanceEnd,
        get decisionReflectorCount() { return activeDecisionStructureCount * 2; },
        decisionStructureNodeCapacity,
        get activeDecisionStructureNodeCount() { return activeDecisionStructureCount; },
        railPostCount,
        maximumRailChordError,
        maximumRailSegmentLength,
        duplicateRailStationCount,
        bearingPadCount,
        get supportCapAlignmentError() {
          return Math.max(
            supportCapAlignmentError,
            ...(activeRuntimeSupportLayout?.records || []).map(
              (record) => Number(record.capPierTopAlignmentError) || 0
            )
          );
        },
        get bearingAnchorError() {
          return this.supportCapAlignmentError;
        },
        reflectorCount,
        solidSafeCorridorViolationCount,
        maximumAddedSoffitDepth,
        decorativeGeometryCount: 3,
        decorativeDrawGroupCount: 3,
        decorativeMapEdgeCount: 0,
        staticLineDrawGroupCount: 1,
        get recoveryLineDrawGroupCount() { return activeRecoveryTemplate.edges.length > 0 ? 1 : 0; },
        roadShellDrawGroupCount: 2,
        routeDrawGroupCount: 2,
        reservedDrawGroupCount: group.children.length,
        get tileDrawGroupCount() { return currentVisibleDrawGroupCount(); },
        get drawGroupCount() { return currentVisibleDrawGroupCount(); },
        signCount: signSpecs.length,
        signDrawGroupCount: 1,
        get goreCount() { return goreCount; },
        goreCapacity,
        decorativeTrafficCount: trafficCount,
        trafficEntryPort,
        trafficMovementCount: trafficSafety.movementCount,
        playerPossibleEdgeCount: trafficSafety.playerPossibleEdgeIds.length,
        safeTrafficEdgeCount: trafficSafety.safeEdges.length,
        trafficRouteIntersectionCount: trafficSafety.trafficRouteIntersectionCount,
        trafficRuntimeEdgeViolationCount: trafficSafety.runtimeEdgeViolationCount,
        ambientTrafficUnsafeEdgeViolationCount: trafficSafety.trafficRouteIntersectionCount,
        ambientTrafficRecoveryEdgeViolationCount: trafficSafety.recoveryEdgeViolationCount,
        ambientTrafficLaunchEdgeViolationCount: trafficSafety.launchEdgeViolationCount,
        trafficSafetyProven: trafficSafety.proven,
        ambientTrafficCapacity: trafficCount,
        ambientTrafficMarkerCount: ambientTrafficMarkers.length,
        ambientTrafficRenderPrimitive: trafficShape.renderPrimitive,
        ambientTrafficGeometryVertexCount: trafficShape.vertexCount,
        ambientTrafficGeometryTriangleCount: trafficShape.triangleCount,
        ambientTrafficGeometryComponentCount: trafficShape.componentCount,
        ambientTrafficGeometryFeatureCount: trafficShape.featureCount,
        ambientTrafficGeometryWingPairCount: trafficShape.wingPairCount,
        ambientTrafficGeometryCapeWingPairCount: trafficShape.capeWingPairCount,
        ambientTrafficGeometrySpiritBodyCount: trafficShape.spiritBodyCount,
        ambientTrafficGeometryMaskCount: trafficShape.maskCount,
        ambientTrafficGeometryEyeCount: trafficShape.eyeCount,
        ambientTrafficGeometryTailClothPetalCount: trafficShape.tailClothPetalCount,
        ambientTrafficGeometryMemoryRibbonCount: trafficShape.memoryRibbonCount,
        ambientTrafficGeometryCanopyCount: trafficShape.canopyCount,
        ambientTrafficGeometryEngineCount: trafficShape.engineCount,
        ambientTrafficGeometryNozzleCount: trafficShape.nozzleCount,
        ambientTrafficGeometryTurbineCount: trafficShape.turbineCount,
        ambientTrafficGeometryMechanicalPanelCount: trafficShape.mechanicalPanelCount,
        ambientTrafficGeometryTailFinCount: trafficShape.tailFinCount,
        ambientTrafficGeometryMergedGeometryCount: trafficShape.mergedGeometryCount,
        ambientTrafficGeometryComponentRoles: trafficShape.componentRoles,
        ambientTrafficGeometryEnvelopeViolationCount: trafficShape.envelopeViolationCount,
        ambientTrafficGeometryWidthM: trafficShape.widthM,
        ambientTrafficGeometryHeightM: trafficShape.heightM,
        ambientTrafficGeometryLengthM: trafficShape.lengthM,
        ambientTrafficGeometryBoundaryEdges: trafficTopology.boundaryEdges || 0,
        ambientTrafficGeometryNonManifoldEdges: trafficTopology.nonManifoldEdges || 0,
        ambientTrafficGeometryDegenerateTriangles: trafficTopology.degenerateTriangles || 0,
        ambientTrafficGeometryZeroAreaTriangles: trafficTopology.zeroAreaTriangles || 0,
        ambientTrafficGeometryClosed: trafficTopology.isClosed === true,
        ambientTrafficMaterialType: trafficMaterial.type,
        ambientTrafficMaterialMetalness: trafficMaterial.metalness,
        ambientTrafficMaterialRoughness: trafficMaterial.roughness,
        ambientTrafficMaterialClearcoat: trafficMaterial.clearcoat,
        ambientTrafficMaterialEmissive: trafficMaterial.emissive.getHex(),
        ambientTrafficMinimumSurfaceGapM: minimumTrafficSurfaceGapM,
        ambientTrafficSpacingSameEdgeAuthority:
          AMBIENT_TRAFFIC_ART_CONTRACT.spacing.sameEdgeAuthority,
        ambientTrafficSpacingCrossingAuthority:
          AMBIENT_TRAFFIC_ART_CONTRACT.spacing.crossingAuthority,
        goreArtEnvelopeViolationCount: goreEnvelopeViolationCount,
        goreArtMaterialMetalness: goreMaterial.metalness,
        goreArtMaterialRoughness: goreMaterial.roughness,
        decisionStructureGeometryRole:
          structuralDetailGeometry.userData.neonV23SkyWayfindingArt.role,
        decisionStructureGeometryTopology:
          structuralDetailGeometry.userData.neonV23SkyWayfindingArt.topology,
        decisionStructureMaterialMetalness: structuralDetailMaterial.metalness,
        decisionStructureAdditionalLightCount:
          SKY_ROUTE_WAYFINDING_ART_CONTRACT.decisionInscription.additionalLightCount,
        ambientTrafficMinimumFullShapeWidthM: minimumFullShapeWidthM,
        ambientTrafficMinimumFullShapeHeightM: minimumFullShapeHeightM,
        ambientTrafficMinimumFullShapeLengthM: minimumFullShapeLengthM,
        minimumTrafficEndpointProtection: trafficSlots.length
          ? Math.min(...trafficSlots.map((slot) => slot.endpointProtection))
          : 0,
        maximumTrafficEndpointProtection: trafficSlots.length
          ? Math.max(...trafficSlots.map((slot) => slot.endpointProtection))
          : 0,
        get activeDecorativeTrafficCount() { return traffic.count; },
        get ambientTrafficSubmittedCount() { return traffic.count; },
        get ambientTrafficVisibleCount() { return ambientTrafficMarkerVisibleCount; },
        get ambientTrafficMarkerVisibleCount() { return ambientTrafficMarkerVisibleCount; },
        get ambientTrafficFullShapeVisibleCount() { return ambientTrafficFullShapeVisibleCount; },
        get ambientTrafficSmallShapeViolationCount() { return ambientTrafficSmallShapeViolationCount; },
        get ambientTrafficMinimumVisibleScaleRatio() {
          return Number.isFinite(ambientTrafficMinimumVisibleScaleRatio)
            ? ambientTrafficMinimumVisibleScaleRatio
            : 0;
        },
        get ambientTrafficMinimumRenderedWidthM() {
          return Number.isFinite(ambientTrafficMinimumRenderedWidthM) ? ambientTrafficMinimumRenderedWidthM : 0;
        },
        get ambientTrafficMinimumRenderedHeightM() {
          return Number.isFinite(ambientTrafficMinimumRenderedHeightM) ? ambientTrafficMinimumRenderedHeightM : 0;
        },
        get ambientTrafficMinimumRenderedLengthM() {
          return Number.isFinite(ambientTrafficMinimumRenderedLengthM) ? ambientTrafficMinimumRenderedLengthM : 0;
        },
        get ambientTrafficMinimumForwardDot() { return ambientTrafficMinimumForwardDot; },
        get ambientTrafficSeparationSuppressedCount() {
          return ambientTrafficSeparationSuppressedCount;
        },
        get ambientTrafficSeparationViolationCount() {
          return ambientTrafficSeparationViolationCount;
        },
        get ambientTrafficMinimumSubmittedCenterGapM() {
          return Number.isFinite(ambientTrafficMinimumSubmittedCenterGapM)
            ? ambientTrafficMinimumSubmittedCenterGapM
            : 0;
        },
        get ambientTrafficMinimumSubmittedSurfaceGapM() {
          return Number.isFinite(ambientTrafficMinimumSubmittedSurfaceGapM)
            ? ambientTrafficMinimumSubmittedSurfaceGapM
            : 0;
        },
        get roadArrowCount() { return roadArrows.count; },
        get roadArrowMinimumForwardDot() { return roadArrowMinimumForwardDot; },
        get roadArrowDirectionViolationCount() { return roadArrowDirectionViolationCount; },
        get exitSignVisibleCount() { return exitSigns.visible ? 1 : 0; },
        get guidanceScopeViolationCount() {
          return (roadArrows.visible || exitSigns.visible) && !guidanceApplies(activeDecisionGuidance) ? 1 : 0;
        },
        get routeBatchRebuildCount() { return routeBatchRebuildCount; },
        get lastRouteBatchUpdateMs() { return lastRouteBatchUpdateMs; },
        get maximumRouteBatchUpdateMs() { return maximumRouteBatchUpdateMs; },
        geometryBuildEdgeBatchCount: preparedTemplate.metrics.edgeBatchCount,
        geometryBuildMaximumSliceMs: preparedTemplate.metrics.maximumSliceMs,
        geometryBuildSlowestSliceLabel: preparedTemplate.metrics.slowestSliceLabel,
        geometryBuildSliceOverrunCount: preparedTemplate.metrics.sliceOverrunCount,
        baseTemplateKey: preparedTemplate.baseTemplateKey,
        baseTemplateCacheHit: preparedTemplate.baseTemplateCacheHit,
        baseTemplateBuildCount: preparedTemplate.baseTemplateBuildCount,
        baseTemplateHitCount: preparedTemplate.baseTemplateHitCount,
        get baseTemplateRefCount() { return preparedTemplate.getBaseTemplateRefCount?.() || 0; },
        get recoveryEdgeCount() { return activeRecoveryTemplate.edges.length; },
        get recoveryTopologyFailureCount() { return activeRecoveryTemplate.metrics.topologyFailureCount || 0; },
        get preparedRecoveryVariantCount() { return recoveryVariants.size; },
        get bidirectionalActivePortPairCount() {
          return bidirectionalCoverageMetrics(activeRecoveryTemplate.edges, track.graph?.tile?.index).coveredPortCount;
        },
        get bidirectionalActivePairCoverageMisses() {
          return bidirectionalCoverageMetrics(activeRecoveryTemplate.edges, track.graph?.tile?.index).coverageMissCount;
        },
        get bidirectionalActiveConnectorCount() {
          return bidirectionalCoverageMetrics(activeRecoveryTemplate.edges, track.graph?.tile?.index).opposingConnectorCount;
        },
        get bidirectionalActiveConnectorCountErrors() {
          return bidirectionalCoverageMetrics(activeRecoveryTemplate.edges, track.graph?.tile?.index).connectorCountError;
        },
        get bidirectionalVisualEdgeCount() {
          return bidirectionalCoverageMetrics(activeRecoveryTemplate.edges, track.graph?.tile?.index).visualEdgeCount;
        },
        get bidirectionalGameplayViolationCount() {
          return bidirectionalCoverageMetrics(activeRecoveryTemplate.edges, track.graph?.tile?.index).gameplayViolationCount;
        },
        get bidirectionalVariantCoverageMisses() {
          let misses = 0;
          for (const template of recoveryVariants.values()) {
            const metrics = bidirectionalCoverageMetrics(template.edges, track.graph?.tile?.index);
            misses += metrics.coverageMissCount + metrics.connectorCountError;
          }
          return misses;
        },
        get activeRecoverySignature() { return activeRecoverySignature; },
        sampleStep,
        tileOrigin
      })
    });
  }

  function create(options) {
    const generator = createGenerator(options);
    let result = generator.next();
    while (!result.done) result = generator.next();
    return result.value;
  }

  /**
   * Idle-time construction contract used by the tile pool. Tunnel microsteps share a callback only while its
   * budget remains; stage boundaries always return to the scheduler. Other assembly stages remain indivisible.
   * Finish only publishes the completed result; cancelling releases private resources and the template lease.
   */
  function createBuildJob(options) {
    if (!options?.THREE || !options?.track?.graph || typeof options.track.sampleEdge !== 'function') {
      throw new Error('Cloverleaf build job requires THREE and the NeonV23Track graph sampler');
    }
    const geometryJob = createGeometryTemplateJob(options);
    const diagnostics = {
      stepCount: 0,
      maximumStepMs: 0,
      lastStepLabel: null,
      slowestStepLabel: null,
      stepOverrunCount: 0,
      complete: false,
      cancelled: false
    };
    let preparedTemplate = null;
    let visualGenerator = null;
    let visual = null;

    function step(budgetMs = 4) {
      if (diagnostics.cancelled) return false;
      if (diagnostics.complete) return true;
      const startedAt = nowMilliseconds();
      diagnostics.stepCount++;
      let stepLabel = 'geometry-template';
      if (!preparedTemplate) {
        if (!geometryJob.step(budgetMs)) {
          const elapsed = nowMilliseconds() - startedAt;
          diagnostics.lastStepLabel = stepLabel;
          if (elapsed > diagnostics.maximumStepMs) {
            diagnostics.maximumStepMs = elapsed;
            diagnostics.slowestStepLabel = stepLabel;
          }
          if (elapsed > Math.max(0.1, Number(budgetMs) || 4)) diagnostics.stepOverrunCount++;
          return false;
        }
        preparedTemplate = geometryJob.finish();
      } else {
        if (!visualGenerator) {
          visualGenerator = createGenerator({
            ...options,
            preparedGeometryTemplate: preparedTemplate,
            adoptPreparedGeometryTemplate: true
          });
        }
        let assemblyResult = visualGenerator.next();
        const sliceLabel = assemblyResult.value;
        const sliceBudgetMs = Math.max(0.1, Number(budgetMs) || 4);
        // Batch cheap rows so an idle scheduler does not spend one callback per vertex. Return when the yielded
        // stage changes; the final sentinel keeps post-shell assembly out of the remaining callback budget.
        let microstepCount = 1;
        while (!assemblyResult.done && typeof sliceLabel === 'string'
          && sliceLabel.startsWith('tunnel-shell-') && sliceLabel !== 'tunnel-shell-finalize'
          && assemblyResult.value === sliceLabel && microstepCount < 4_096
          && nowMilliseconds() - startedAt < sliceBudgetMs) {
          assemblyResult = visualGenerator.next();
          microstepCount++;
        }
        stepLabel = assemblyResult.done ? 'visual-publish' : `visual-${assemblyResult.value || 'assembly'}`;
        if (assemblyResult.done) {
          visual = assemblyResult.value;
          preparedTemplate = null;
          visualGenerator = null;
          diagnostics.complete = true;
        }
      }
      const elapsed = nowMilliseconds() - startedAt;
      diagnostics.lastStepLabel = stepLabel;
      if (elapsed > diagnostics.maximumStepMs) {
        diagnostics.maximumStepMs = elapsed;
        diagnostics.slowestStepLabel = stepLabel;
      }
      if (elapsed > Math.max(0.1, Number(budgetMs) || 4)) diagnostics.stepOverrunCount++;
      return diagnostics.complete;
    }

    function finish() {
      if (!diagnostics.complete || !visual) {
        throw new Error('Cloverleaf visual build job is not complete');
      }
      return visual;
    }

    function cancel() {
      if (diagnostics.cancelled) return;
      diagnostics.cancelled = true;
      visualGenerator?.return?.();
      if (preparedTemplate) disposeGeometryTemplate(preparedTemplate);
      else if (!diagnostics.complete) geometryJob.cancel();
      if (visual) visual.dispose();
      preparedTemplate = null;
      visual = null;
    }

    return Object.freeze({ step, finish, cancel, diagnostics });
  }

  function getSharedTemplateDiagnostics() {
    return Object.freeze({
      entryCount: sharedBaseTemplates.size,
      entries: Object.freeze([...sharedBaseTemplates.values()].map((entry) => Object.freeze({
        key: entry.key,
        state: entry.state,
        refCount: entry.refCount,
        waiterCount: entry.waiterCount,
        buildCount: entry.buildCount,
        hitCount: entry.hitCount
      })))
    });
  }

  /** Server-side regression hook builds the exact immutable road BufferGeometry without requiring a scene. */
  function createGeometryBatchAuditJob(options) {
    if (!options?.THREE || !options?.track?.graph || typeof options.track.sampleEdge !== 'function') {
      throw new Error('Cloverleaf geometry audit requires THREE and the NeonV23Track graph sampler');
    }
    return options.productionTemplate === true
      ? createGeometryTemplateJob(options)
      : createGeometryBatchJob(options);
  }

  return Object.freeze({
    create,
    createBuildJob,
    createGeometryBatchAuditJob,
    createTunnelShellGeometryAudit,
    createJumpPlatformBatchGeometry,
    createRuntimeSupportPlacementJob,
    createSupportPlacementSearchJob,
    getSharedTemplateDiagnostics,
    inspectRuntimeSupportLayout,
    inspectJunctionAprons,
    inspectStraightForkGoreLayout: straightForkGoreLayout,
    inspectUndergroundTunnelRoadJoin,
    sampleTunnelEnclosure,
    tunnelEnclosureContract: TUNNEL_ENCLOSURE_CONTRACT,
    ambientTrafficArtContract: AMBIENT_TRAFFIC_ART_CONTRACT,
    filmRouteStructureBlockerContract: FILM_ROUTE_STRUCTURE_BLOCKER_CONTRACT,
    skyRouteWayfindingArtContract: SKY_ROUTE_WAYFINDING_ART_CONTRACT,
    skyRouteSceneryContract: SKY_ROUTE_SCENERY_CONTRACT,
    roadArrowDirectionContract: ROAD_ARROW_DIRECTION_CONTRACT,
    roadSpeedReferenceContract: ROAD_SPEED_REFERENCE_CONTRACT
  });
})();
