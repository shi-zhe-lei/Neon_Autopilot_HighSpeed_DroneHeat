/* Runtime tile-local visual pool for the directed V23 cloverleaf itinerary. */
window.NeonV23CloverleafTilePool = (() => {
  'use strict';

  const DEFAULT_MAX_TILES = 3;
  const PREWARM_TILES_AHEAD = 2;
  const PREWARM_TOPOLOGY_AHEAD = 3;
  // Build still targets +2 inside the fixed three-slot pool, but presentation starts well outside the render
  // far plane. A separate release edge prevents Film cuts from repeatedly mounting and hiding the same tile.
  const PREWARM_REVEAL_DISTANCE = 2_400;
  const PREWARM_RELEASE_DISTANCE = 2_800;
  const PREVIOUS_TILE_RELEASE_DISTANCE = 2_800;
  // The tactical graph may lead the raster camera: it gives navigation one stable future-tile context while the
  // complete 3D resident is already warmed, without extending PathPlan, collision, or route-cursor authority.
  const DEFAULT_MAP_VISIBILITY_DISTANCE = 2_200;
  // Child builders receive only half the 4ms callback envelope, reserving deterministic headroom for
  // non-preemptible stage completion, diagnostics, and atomic publication on slower browser schedulers.
  const WARM_BUILD_CHILD_BUDGET_MS = 2;
  // Opening road slices are launch-critical. A busy animated page may never report idle time, so the timeout
  // guarantees one bounded slice per display frame instead of stretching initial readiness across many minutes.
  const CRITICAL_BUILD_WAKE_TIMEOUT_MS = 16;
  const CRITICAL_BUILD_MAX_STEPS_PER_SLICE = 12;
  // A corrupt resumable builder is never reused. Two delayed rebuilds cover transient context/allocation faults while
  // keeping one bounded retry target; the third failure escapes through the host's existing runtime error boundary.
  const WARM_BUILD_MAX_RETRY_ATTEMPTS = 2;
  const WARM_BUILD_RETRY_BASE_DELAY_MS = 32;
  const WARM_BUILD_RETRY_MAX_DELAY_MS = 128;
  // Scheduler adapters are allowed to invoke callbacks in the same stack. Publish this sentinel before calling an
  // adapter so a synchronous callback can atomically claim its ticket before a real handle exists.
  const SCHEDULING_HANDLE = Symbol('cloverleaf-warmup-scheduling');

  const STRUCTURAL_COUNT_FIELDS = Object.freeze([
    'crossingCount',
    'physicalSpanCount',
    'mergedCrossingCount',
    'bridgeSpanOverlapCount',
    'dynamicRoadWidthSamples',
    'junctionBiasSamples',
    'trimmedBarrierSampleCount',
    'retainedJunctionBoundaryCount',
    'suppressedConnectedCapCount',
    'recessedTopologySealCount',
    'junctionApronCandidateCount',
    'junctionApronCount',
    'junctionApronCoverageMissCount',
    'junctionApronTopologyFailureCount',
    'junctionLongPairCount',
    'junctionLensCount',
    'junctionLensResidualOverlapCount',
    'junctionLensCoverageStationCount',
    'junctionLensUncoveredStationCount',
    'junctionLensApronContinuityFailureCount',
    'junctionLensClearanceFailureCount',
    'junctionVerticallySeparatedPairCount',
    'junctionVerticalSeparationStationCount',
    'junctionVerticalSeparationFailureCount',
    'junctionLensTopologyFailureCount',
    'junctionRaisedBarrierIntrusionCount'
  ]);
  const STRUCTURAL_MAXIMUM_FIELDS = Object.freeze([
    'bridgeDeckThicknessError',
    'roadShellWidthError',
    'junctionApronMaximumSpanM',
    'junctionApronSurfaceLiftM',
    'junctionLensMaximumRunM',
    'junctionLensMaximumCrossWidthM',
    'junctionLensClearanceToleranceM',
    'junctionLensMaximumEndClearanceErrorM'
  ]);
  const STRUCTURAL_MINIMUM_FIELDS = Object.freeze(['junctionMinimumVerticalShellGapM']);
  const STRUCTURAL_FIELDS = Object.freeze([
    ...STRUCTURAL_COUNT_FIELDS,
    ...STRUCTURAL_MAXIMUM_FIELDS,
    ...STRUCTURAL_MINIMUM_FIELDS
  ]);

  /** Normalize one visual's immutable interchange contract separately from route-owned resident additions. */
  function structuralDiagnosticsForVisual(visual, standardTile = false) {
    const source = standardTile
      ? visual?.standardTileDiagnostics || visual || {}
      : visual || {};
    const diagnostics = {};
    for (const field of STRUCTURAL_COUNT_FIELDS) {
      diagnostics[field] = Number.isFinite(source[field]) ? source[field] : 0;
    }
    for (const field of STRUCTURAL_MAXIMUM_FIELDS) {
      diagnostics[field] = Number.isFinite(source[field]) ? source[field] : 0;
    }
    for (const field of STRUCTURAL_MINIMUM_FIELDS) {
      diagnostics[field] = Number.isFinite(source[field]) ? source[field] : null;
    }
    return Object.freeze(diagnostics);
  }

  /** Counts sum across a set; tolerances use maxima and positive clearance contracts use minima. */
  function aggregateStructuralDiagnostics(diagnosticsList) {
    const aggregate = {};
    for (const field of STRUCTURAL_COUNT_FIELDS) aggregate[field] = 0;
    for (const field of STRUCTURAL_MAXIMUM_FIELDS) aggregate[field] = 0;
    for (const field of STRUCTURAL_MINIMUM_FIELDS) aggregate[field] = Number.POSITIVE_INFINITY;
    for (const diagnostics of diagnosticsList) {
      for (const field of STRUCTURAL_COUNT_FIELDS) aggregate[field] += diagnostics[field] || 0;
      for (const field of STRUCTURAL_MAXIMUM_FIELDS) {
        aggregate[field] = Math.max(aggregate[field], diagnostics[field] || 0);
      }
      for (const field of STRUCTURAL_MINIMUM_FIELDS) {
        if (Number.isFinite(diagnostics[field])) {
          aggregate[field] = Math.min(aggregate[field], diagnostics[field]);
        }
      }
    }
    for (const field of STRUCTURAL_MINIMUM_FIELDS) {
      if (!Number.isFinite(aggregate[field])) aggregate[field] = null;
    }
    return Object.freeze(aggregate);
  }

  /** Publish min/max evidence so a resident total cannot be mistaken for one standard tile invariant. */
  function summarizeStructuralInvariants(diagnosticsList) {
    const minimums = {};
    const maximums = {};
    const mismatchFields = [];
    const canonical = diagnosticsList[0] || structuralDiagnosticsForVisual({});
    for (const field of STRUCTURAL_FIELDS) {
      const finiteValues = diagnosticsList
        .map((diagnostics) => diagnostics[field])
        .filter(Number.isFinite);
      minimums[field] = finiteValues.length ? Math.min(...finiteValues) : null;
      maximums[field] = finiteValues.length ? Math.max(...finiteValues) : null;
      if (minimums[field] !== maximums[field]) mismatchFields.push(field);
    }
    return Object.freeze({
      tileCount: diagnosticsList.length,
      consistent: mismatchFields.length === 0,
      mismatchFields: Object.freeze(mismatchFields),
      values: canonical,
      minimums: Object.freeze(minimums),
      maximums: Object.freeze(maximums)
    });
  }

  function values(source) {
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return [...source.values()];
    if (source && typeof source === 'object') return Object.values(source);
    return [];
  }

  function scopedTemplateId(tile, baseId) {
    return tile.index === 0 ? baseId : `${tile.token}:${baseId}`;
  }

  function uniqueById(items) {
    const result = [];
    const seen = new Set();
    for (const item of items) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
    return result;
  }

  function freezeLookup(items) {
    return Object.freeze(Object.fromEntries(items.map((item) => [item.id, item])));
  }

  /** Keep route-owned recovery and its complementary visual carriageways under one atomic variant key. */
  function recoveryVariantSignature(tileToken, recoveryEdgeIds, bidirectionalVisualEdgeIds) {
    return `${tileToken}|${recoveryEdgeIds.join('|')}|visual:${bidirectionalVisualEdgeIds.join('|')}`;
  }

  function unionBounds(edges, tile) {
    const bounds = {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY
    };
    for (const edge of edges) {
      if (!edge?.bounds) continue;
      bounds.minX = Math.min(bounds.minX, edge.bounds.minX);
      bounds.maxX = Math.max(bounds.maxX, edge.bounds.maxX);
      bounds.minZ = Math.min(bounds.minZ, edge.bounds.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, edge.bounds.maxZ);
    }
    if (!Number.isFinite(bounds.minX)) {
      bounds.minX = bounds.maxX = Number(tile.centerX) || 0;
      bounds.minZ = bounds.maxZ = Number(tile.centerZ) || 0;
    }
    return Object.freeze(bounds);
  }

  function frameDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /** Measure every visual corridor join once when its graph view is built, not in the render loop. */
  function auditBidirectionalSeams(track, tile, pathPlan, visualEdges) {
    const seamPairs = [];
    const extensionByPort = new Map();
    let hiddenTailPortalDistanceM = Number.POSITIVE_INFINITY;
    for (const edge of visualEdges) {
      if (edge.bidirectionalRole !== 'outbound-extension') continue;
      extensionByPort.set(edge.bidirectionalPort, edge);
      const outboundId = scopedTemplateId(tile, `outbound-${edge.bidirectionalPort}`);
      const outbound = track.getEdge(outboundId);
      if (outbound) seamPairs.push([outbound, edge]);
    }
    const connector = visualEdges.find((edge) => edge.bidirectionalRole === 'opposing-intertile');
    if (connector) {
      const extension = extensionByPort.get(connector.bidirectionalPort);
      if (extension) seamPairs.push([extension, connector]);
      const previousTile = pathPlan?.tiles?.find((candidate) => candidate.index === tile.index - 1);
      const previousApproach = previousTile
        ? track.getEdge(scopedTemplateId(previousTile, `approach-${previousTile.exitPort}`))
        : null;
      if (previousApproach) seamPairs.push([connector, previousApproach]);
      const destinationApproach = track.getEdge(scopedTemplateId(tile, `approach-${tile.entryPort}`));
      if (destinationApproach) {
        const portal = track.sampleEdge(destinationApproach.id, 0, 0, {});
        const hiddenTail = track.sampleEdge(connector.id, connector.length, 0, {});
        hiddenTailPortalDistanceM = frameDistance(portal, hiddenTail);
      }
    }

    let maximumCenterGapM = 0;
    let maximumBoundaryGapM = 0;
    let maximumTangentGapDegrees = 0;
    let maximumGradeGapDegrees = 0;
    let violationCount = 0;
    for (const [beforeEdge, afterEdge] of seamPairs) {
      const before = track.sampleEdge(beforeEdge.id, beforeEdge.length, 0, {});
      const after = track.sampleEdge(afterEdge.id, 0, 0, {});
      const centerGapM = frameDistance(before, after);
      const tangentDot = before.tangentX * after.tangentX
        + before.tangentY * after.tangentY
        + before.tangentZ * after.tangentZ;
      const tangentGapDegrees = Math.acos(Math.max(-1, Math.min(1, tangentDot))) * 180 / Math.PI;
      const gradeGapDegrees = Math.abs(Math.atan(before.grade) - Math.atan(after.grade)) * 180 / Math.PI;
      let boundaryGapM = 0;
      for (const side of [-1, 1]) {
        const beforeBoundary = track.sampleEdge(beforeEdge.id, beforeEdge.length, side * before.roadHalf, {});
        const afterBoundary = track.sampleEdge(afterEdge.id, 0, side * after.roadHalf, {});
        boundaryGapM = Math.max(boundaryGapM, frameDistance(beforeBoundary, afterBoundary));
      }
      maximumCenterGapM = Math.max(maximumCenterGapM, centerGapM);
      maximumBoundaryGapM = Math.max(maximumBoundaryGapM, boundaryGapM);
      maximumTangentGapDegrees = Math.max(maximumTangentGapDegrees, tangentGapDegrees);
      maximumGradeGapDegrees = Math.max(maximumGradeGapDegrees, gradeGapDegrees);
      if (
        centerGapM > 0.02
        || boundaryGapM > 0.03
        || tangentGapDegrees > 0.5
        || gradeGapDegrees > 0.25
      ) {
        violationCount++;
      }
    }
    return Object.freeze({
      seamCount: seamPairs.length,
      violationCount,
      maximumCenterGapM,
      maximumBoundaryGapM,
      maximumTangentGapDegrees,
      maximumGradeGapDegrees,
      hiddenTailPortalDistanceM
    });
  }

  function recoveryEdgesForTile(track, tile, pathPlan) {
    if (typeof track.getRecoveryVisualEdgesForTile === 'function') {
      return uniqueById(track.getRecoveryVisualEdgesForTile(tile));
    }
    if (!Array.isArray(pathPlan?.edgeIds)) return [];
    return uniqueById(pathPlan.edgeIds.map((edgeId) => track.getEdge(edgeId)).filter((edge) => (
      edge?.runtimeKind === 'recovery'
      && (edge.tileToken === tile.token || (edge.tileToken == null && edge.tileIndex === tile.index))
    )));
  }

  /** Keep render-only carriageways outside PathPlan while letting overview maps omit only the long corridor. */
  function bidirectionalVisualEdgesForTile(track, tile, options = {}) {
    if (typeof track.getBidirectionalVisualEdgesForTile !== 'function') return [];
    return uniqueById(track.getBidirectionalVisualEdgesForTile(tile, {
      includeLongCorridor: options.includeLongCorridor !== false,
      includeSelectedExit: options.includeSelectedExit === true
    }));
  }

  function resolveTemplateEdges(track, tile) {
    return values(track.graph?.edges).map((baseEdge) => {
      const edgeId = scopedTemplateId(tile, baseEdge.id);
      const edge = track.getEdge(edgeId);
      if (!edge) throw new Error(`Missing cloverleaf runtime edge: ${edgeId}`);
      return edge;
    });
  }

  function resolveTemplateMovements(track, tile) {
    return values(track.graph?.movements).map((baseMovement) => {
      const movementId = scopedTemplateId(tile, baseMovement.id);
      const movement = track.getMovement(movementId);
      if (!movement) throw new Error(`Missing cloverleaf runtime movement: ${movementId}`);
      return movement;
    });
  }

  function crossingForTile(tile, crossing) {
    const upperEdgeId = scopedTemplateId(tile, crossing.upperEdgeId || crossing.upperEdge);
    const lowerEdgeId = scopedTemplateId(tile, crossing.lowerEdgeId || crossing.lowerEdge);
    return Object.freeze({
      ...crossing,
      id: tile.index === 0 ? crossing.id : `${tile.token}:${crossing.id}`,
      upperEdgeId,
      upperEdge: upperEdgeId,
      lowerEdgeId,
      lowerEdge: lowerEdgeId,
      tileIndex: tile.index,
      tileToken: tile.token,
      templateCrossingId: crossing.id
    });
  }

  function buildNodes(track, tile, edges) {
    const nodeById = new Map();
    for (const baseNode of values(track.graph?.nodes)) {
      const nodeId = scopedTemplateId(tile, baseNode.id);
      const node = track.getNode(nodeId);
      if (!node) throw new Error(`Missing cloverleaf runtime node: ${nodeId}`);
      nodeById.set(node.id, node);
    }
    for (const edge of edges) {
      for (const nodeId of [edge.from, edge.to]) {
        if (nodeById.has(nodeId)) continue;
        const node = track.getNode(nodeId);
        if (node) nodeById.set(nodeId, node);
      }
    }

    const incoming = new Map();
    const outgoing = new Map();
    for (const edge of edges) {
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      incoming.get(edge.to).push(edge.id);
      outgoing.get(edge.from).push(edge.id);
    }
    return [...nodeById.values()].map((node) => Object.freeze({
      ...node,
      inEdges: Object.freeze([...(incoming.get(node.id) || [])]),
      outEdges: Object.freeze([...(outgoing.get(node.id) || [])]),
      incomingEdgeIds: Object.freeze([...(incoming.get(node.id) || [])]),
      outgoingEdgeIds: Object.freeze([...(outgoing.get(node.id) || [])])
    }));
  }

  /**
   * Reserve node-owned visual slots from the tile's maximum reachable recovery topology, not whichever variant
   * happened to create the resident visual. An opposing crossover intentionally omits the ordinary straight fork,
   * but eviction may later rebuild from that smaller graph and still need to reactivate the larger normal variant.
   */
  function resolveDecisionStructureCapacity(track, tile, templateEdges, activeRecoveryEdges) {
    const ordinaryRecoveryEdges = (
      typeof track.getRecoveryVisualEdgesForTile === 'function'
        ? track.getRecoveryVisualEdgesForTile(tile.token)
        : null
    ) || activeRecoveryEdges;
    const capacityEdges = uniqueById([
      ...templateEdges,
      ...activeRecoveryEdges,
      ...ordinaryRecoveryEdges
    ]);
    const capacityNodes = buildNodes(track, tile, capacityEdges);
    const decisionNodeCapacity = capacityNodes.filter((node) => (
      node.kind === 'decision' || node.kind === 'collector-decision'
    )).length;
    const straightForkBranchesByDecision = new Map();
    for (const edge of capacityEdges) {
      if (edge.family !== 'straight-fork-branch' || !edge.decisionNodeId) continue;
      if (!straightForkBranchesByDecision.has(edge.decisionNodeId)) {
        straightForkBranchesByDecision.set(edge.decisionNodeId, []);
      }
      straightForkBranchesByDecision.get(edge.decisionNodeId).push(edge);
    }
    const completeStraightForkCapacity = [...straightForkBranchesByDecision.values()]
      .filter((branches) => branches.some((edge) => edge.forkSide === 'left')
        && branches.some((edge) => edge.forkSide === 'right'))
      .length;
    return Object.freeze({
      decisionNodeCapacity,
      // A complete straight fork owns two gore noses instead of the single nose used by an ordinary decision.
      goreNoseCapacity: decisionNodeCapacity + completeStraightForkCapacity
    });
  }

  /**
   * Build a side-effect-free graph view for one already-registered itinerary tile.
   * Recovery edges belong only to their source tile, preventing duplicate road meshes or collision authority.
   */
  function graphForTile(trackOrTile, tileOrPathPlan, pathPlanOrOptions, maybeOptions) {
    const explicitTrack = trackOrTile?.graph && typeof trackOrTile.getEdge === 'function';
    const track = explicitTrack ? trackOrTile : window.NeonV23Track;
    const tile = explicitTrack ? tileOrPathPlan : trackOrTile;
    const pathPlan = explicitTrack ? pathPlanOrOptions : tileOrPathPlan;
    const graphOptions = (explicitTrack ? maybeOptions : pathPlanOrOptions) || {};
    const includeRecovery = graphOptions.includeRecovery !== false;
    if (!track?.graph || typeof track.getEdge !== 'function' || typeof track.sampleEdge !== 'function') {
      throw new Error('graphForTile requires the NeonV23Track directed graph contract');
    }
    if (!tile?.token || !Number.isInteger(tile.index)) {
      throw new Error('graphForTile requires a pathPlan tile with index and token');
    }
    // Variant preparation may retain the resident tile object; route-sensitive visual exclusions must follow
    // the matching candidate tile so an alternate exit never rebuilds the previous arm layout.
    const routeTile = pathPlan?.tiles?.find((candidate) => candidate.token === tile.token) || tile;

    const templateEdges = resolveTemplateEdges(track, tile);
    const recoveryEdges = includeRecovery ? recoveryEdgesForTile(track, routeTile, pathPlan) : [];
    const bidirectionalVisualEdges = bidirectionalVisualEdgesForTile(track, routeTile, {
      includeLongCorridor: includeRecovery,
      // Overview omits route-owned recovery, so its fourth short extension must close the selected arm instead.
      includeSelectedExit: !includeRecovery
    });
    // The public sampler owns the launch ramp's 3D arc length; this graph never substitutes its planar chord.
    const edges = Object.freeze(uniqueById([
      ...templateEdges,
      ...recoveryEdges,
      ...bidirectionalVisualEdges
    ]));
    const nodes = Object.freeze(buildNodes(track, tile, edges));
    const movements = Object.freeze(resolveTemplateMovements(track, routeTile));
    const crossings = Object.freeze(values(track.graph?.crossings).map((crossing) => (
      crossingForTile(tile, crossing)
    )));
    const tileBounds = unionBounds(templateEdges, tile);
    const bounds = unionBounds(edges, tile);
    const recoveryEdgeIds = Object.freeze(recoveryEdges.map((edge) => edge.id));
    const bidirectionalVisualEdgeIds = Object.freeze(bidirectionalVisualEdges.map((edge) => edge.id));
    const recoveryVisualSignature = recoveryVariantSignature(
      tile.token,
      recoveryEdgeIds,
      bidirectionalVisualEdgeIds
    );
    const decisionStructureCapacity = resolveDecisionStructureCapacity(
      track,
      tile,
      templateEdges,
      recoveryEdges
    );
    const bidirectionalPathPlanViolationCount = bidirectionalVisualEdges.reduce((count, edge) => (
      count + (pathPlan?.edgeIndexById?.has(edge.id) || pathPlan?.edgeIds?.includes(edge.id) ? 1 : 0)
    ), 0);
    const bidirectionalSeamAudit = auditBidirectionalSeams(track, routeTile, pathPlan, bidirectionalVisualEdges);
    const graph = {
      version: `${track.graph.version || 'V23-cloverleaf'}:${tile.token}`,
      tile: Object.freeze({ ...routeTile }),
      origin: Object.freeze({ x: Number(routeTile.centerX) || 0, z: Number(routeTile.centerZ) || 0 }),
      ports: track.graph.ports,
      nodes,
      nodesById: freezeLookup(nodes),
      edges,
      edgesById: freezeLookup(edges),
      crossings,
      movements,
      movementsById: freezeLookup(movements),
      tileBounds,
      bounds,
      recoveryEdgeIds,
      bidirectionalVisualEdgeIds,
      recoveryVariantSignature: recoveryVisualSignature,
      bidirectionalPathPlanViolationCount,
      bidirectionalSeamAudit,
      contract: Object.freeze({
        ...(track.graph.contract || {}),
        visualOnly: true,
        collisionAuthority: 'NeonV23Track',
        includeRecovery: Boolean(includeRecovery),
        continuousBidirectionalRoads: true,
        decisionStructureNodeCapacity: decisionStructureCapacity.decisionNodeCapacity,
        goreNoseCapacity: decisionStructureCapacity.goreNoseCapacity
      })
    };
    return Object.freeze(graph);
  }

  function createScopedTrack(track, graph) {
    return Object.freeze({
      graph,
      sampleEdge(edgeId, edgeS, lateral, out) {
        return track.sampleEdge(edgeId, edgeS, lateral, out);
      },
      getEdge(edgeId) {
        return graph.edgesById[edgeId] || track.getEdge(edgeId);
      },
      getRuntimeEdgesForTileIndex(tileIndex) {
        return typeof track.getRuntimeEdgesForTileIndex === 'function'
          ? track.getRuntimeEdgesForTileIndex(tileIndex)
          : Object.freeze(graph.edges.filter((edge) => edge.tileIndex === tileIndex));
      },
      getNode(nodeId) {
        return graph.nodesById[nodeId] || track.getNode(nodeId);
      },
      getMovement(movementId) {
        return graph.movementsById[movementId] || track.getMovement(movementId);
      },
      enumerateMovements() {
        return graph.movements;
      },
      gateTargetForHalfWidth(gate, halfWidth) {
        return typeof track.gateTargetForHalfWidth === 'function'
          ? track.gateTargetForHalfWidth(gate, halfWidth)
          : 0;
      },
      getVisibleEdges() {
        return graph.edges;
      },
      queryRoadClearance(x, z, radius, options) {
        // Clearance remains global so a bridge support cannot be valid locally while invading an adjacent tile road.
        return track.queryRoadClearance(x, z, radius, options);
      }
    });
  }

  function graphSignature(graph) {
    return graph.recoveryVariantSignature || recoveryVariantSignature(
      graph.tile.token,
      graph.recoveryEdgeIds,
      graph.bidirectionalVisualEdgeIds
    );
  }

  function expectedGraphSignature(track, tile, pathPlan) {
    const routeTile = pathPlan?.tiles?.find((candidate) => candidate.token === tile.token) || tile;
    // A candidate keeps the resident tile object but changes its exit; both recovery and visual halves must
    // use the candidate tile or every multi-slice alternate build is cancelled as a false signature mismatch.
    const recoveryIds = recoveryEdgesForTile(track, routeTile, pathPlan).map((edge) => edge.id);
    const visualIds = bidirectionalVisualEdgesForTile(track, routeTile).map((edge) => edge.id);
    return recoveryVariantSignature(tile.token, recoveryIds, visualIds);
  }

  /** Create a bounded pool of complete static tile visuals; gameplay collision remains owned by the track graph. */
  function create(options) {
    const {
      track,
      scene,
      THREE,
      modeling,
      qualityProfile,
      markMainVisual,
      markEffect,
      sampleTerrainHeight
    } = options || {};
    const visualFactory = options?.visualFactory || window.NeonV23CloverleafVisuals;
    if (!track?.graph || typeof track.getEdge !== 'function' || typeof track.sampleEdge !== 'function') {
      throw new Error('Cloverleaf tile pool requires the directed graph sampler contract');
    }
    if (!visualFactory || typeof visualFactory.create !== 'function') {
      throw new Error('Cloverleaf tile pool requires NeonV23CloverleafVisuals.create');
    }
    if (sampleTerrainHeight !== undefined && typeof sampleTerrainHeight !== 'function') {
      throw new TypeError('Cloverleaf tile pool sampleTerrainHeight must be a function');
    }
    // Production visuals expose a resumable builder. Lightweight test doubles may retain the synchronous
    // fallback, but a real opening route must never drain a complete interchange generator on the entry task.
    const stagedTileBuildsEnabled = typeof visualFactory.createBuildJob === 'function';
    const maxTiles = Math.max(
      2,
      Math.min(DEFAULT_MAX_TILES, Math.floor(Number(options?.maxTiles) || DEFAULT_MAX_TILES))
    );
    const prepareRecoveryVariants = options?.prepareRecoveryVariants !== false;
    let activeRenderQualityId = options?.renderQualityId === 'high'
      ? 'high'
      : options?.renderQualityId === 'low' ? 'low' : 'medium';
    const records = new Map();
    let presentationTextureRevision = 0;
    let activeTokens = Object.freeze([]);
    let cameraRetainedPreviousTokens = Object.freeze([]);
    let visibilityOriginX = 0;
    let visibilityOriginZ = 0;
    let cameraPreviousDistanceM = null;
    let activeMapGraphKey = '';
    let activeMapGraph = null;
    let presentedSerial = 0;
    let presentedTiles = Object.freeze([]);
    const presentedSignatureByToken = new Map();
    let updateSerial = 0;
    let lastVisibleEdgeCount = 0;
    let latestWarmupContext = null;
    let warmupHandle = null;
    let warmupTicket = null;
    let warmupScheduleKind = null;
    let warmupGeneration = 0;
    let foregroundBuildCount = 0;
    let criticalBuildCount = 0;
    let warmBuildCount = 0;
    let lastBuildMs = 0;
    let maxBuildMs = 0;
    let lastCriticalTileToken = null;
    let lastWarmTileToken = null;
    let invalidationCount = 0;
    let lastInvalidation = null;
    let activeWarmBuild = null;
    let warmSliceCount = 0;
    let warmSliceMaxMs = 0;
    let warmSliceSlowestLabel = null;
    let warmSliceSlowestStageMs = 0;
    let warmBuildCancellationCount = 0;
    let warmBuildPriorityPromotionCount = 0;
    let warmBuildFailureCount = 0;
    let warmBuildRetryCount = 0;
    let warmBuildRecoveryCount = 0;
    let warmBuildRetryExhaustedCount = 0;
    let lastWarmBuildPriorityPromotion = null;
    let lastWarmBuildFailure = null;
    let pendingWarmBuildRetry = null;
    let warmBuildRetryHandle = null;
    let warmBuildRetryTicket = null;
    let currentWarmupTarget = null;
    let currentWarmupStageLabel = null;
    let disposed = false;
    let warmRegistrationReuseCount = 0;
    let atomicRecoverySwitchCount = 0;
    let deferredRecoverySwitchCount = 0;
    let preparedRecoveryVariantCount = 0;
    let opposingBypassVariantQueuedCount = 0;
    let opposingBypassVariantPreparedCount = 0;
    let opposingBypassPreflightRequestCount = 0;
    let opposingBypassPreflightPromotionCount = 0;
    let opposingBypassPreflightPreparedCount = 0;
    let opposingBypassAtomicSwitchCount = 0;
    let routeVariantCriticalPromotionCount = 0;
    let routeVariantReadinessActivationCount = 0;
    let prioritizedRecoveryVariantCount = 0;
    let prioritizedRecoveryPreemptionCount = 0;
    let mapGraphRouteFallbackCount = 0;
    let mapGraphRouteFallbackActive = false;
    let mapGraphRouteFallbackKey = '';
    let mapGraphRouteFallbackGraph = null;
    let variantPlanState = null;
    // A landing can replace variantPlanState on the next pool update. Keep route-critical requirements outside that
    // enumeration state until the exact resident signature becomes active, otherwise a slow builder can be orphaned.
    const requiredRouteVariants = new Map();
    // The platform-lip physics callback may only add one token here. Route planning and visual activation remain in
    // the pool's bounded work callback, so takeoff cannot synchronously rebuild or publish a complete interchange.
    const pendingOpposingBypassPreflightTokens = new Set();
    // A lip request survives route-cursor and variant-enumeration replacement. It owns the ordinary landing signature
    // as well as the asynchronously discovered opposing signature, so a destination that became "previous" cannot
    // silently fall out of critical work before its exact opposing variant is installed.
    const opposingBypassPreflightsByDestination = new Map();
    // A finished warm build already owns the exact graph/track pair used to create its buffers. Reusing that pair at
    // the sole authoritative activation avoids reconstructing the same scoped maps on a landing frame.
    const preparedVariantBindings = new Map();
    const ambientTrafficMarkers = [];
    let ambientTrafficMarkerKey = '';
    const cameraBlockers = [];
    let cameraBlockerActiveTokens = null;
    let activeTunnelEmitterVisuals = [];
    let activeTunnelLightEmitters = Object.freeze([]);
    let activeCoveredRouteEmitterVisuals = [];
    let activeCoveredRouteLightEmitters = Object.freeze([]);
    const desiredTilesScratch = [];
    const desiredTokensScratch = new Set();
    const activeTokenOrderScratch = [];
    const pinnedVisibleTokensScratch = [];
    const continuityHeldTokensScratch = [];
    const cameraRetainedPreviousTokensScratch = [];
    const retainedVisibleTokensScratch = [];
    const residentTokensScratch = new Set();
    const latestRouteCursor = {};
    const latestDesiredTokens = new Set();
    let pinnedVisibleTokens = Object.freeze([]);
    let continuityHeldTokens = Object.freeze([]);
    const now = typeof options?.now === 'function'
      ? options.now
      : () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now());
    const requestIdle = typeof options?.requestIdleCallback === 'function'
      ? options.requestIdleCallback
      : typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback.bind(window)
        : (callback) => window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 64);
    const cancelIdle = typeof options?.cancelIdleCallback === 'function'
      ? options.cancelIdleCallback
      : typeof window.cancelIdleCallback === 'function'
        ? window.cancelIdleCallback.bind(window)
        : (handle) => window.clearTimeout(handle);
    // requestIdleCallback may be clamped to seconds in a backgrounded or recovering tab. Production opening
    // work therefore uses a zero-delay task; injected deterministic fixtures retain their controlled idle queue.
    const requestCritical = typeof options?.requestCriticalCallback === 'function'
      ? options.requestCriticalCallback
      : typeof options?.requestIdleCallback === 'function'
        ? (callback) => requestIdle(callback, { timeout: CRITICAL_BUILD_WAKE_TIMEOUT_MS })
        : (callback) => window.setTimeout(() => callback({
            didTimeout: true,
            timeRemaining: () => 4
          }), 0);
    const cancelCritical = typeof options?.cancelCriticalCallback === 'function'
      ? options.cancelCriticalCallback
      : typeof options?.requestIdleCallback === 'function'
        ? cancelIdle
        : (handle) => window.clearTimeout(handle);
    const requestRetry = typeof options?.requestRetryCallback === 'function'
      ? options.requestRetryCallback
      : (callback, delayMs) => window.setTimeout(callback, delayMs);
    const cancelRetry = typeof options?.cancelRetryCallback === 'function'
      ? options.cancelRetryCallback
      : (handle) => window.clearTimeout(handle);

    const boundGraphForTile = (tile, pathPlan, graphOptions = {}) => (
      graphForTile(track, tile, pathPlan, graphOptions)
    );

    function visualOptions(graph, scopedTrack) {
      return {
        THREE,
        track: scopedTrack,
        modeling,
        scene,
        qualityProfile,
        markMainVisual,
        markEffect,
        // Preserve absolute-world coordinates across resident and prewarmed tiles; each visual samples the same
        // runtime terrain authority instead of silently falling back to one fixed bridge-foundation elevation.
        sampleTerrainHeight,
        renderQualityId: activeRenderQualityId,
        tileOrigin: graph.origin,
        // Only the registered visual owns this publication lease. A private, failed, replaced, or disposed
        // builder cannot dirty renderer texture state through a late language/atlas callback.
        onPresentationTexturesChanged() {
          if (disposed || records.get(graph.tile.token)?.texturePublicationOwner !== scopedTrack) return false;
          presentationTextureRevision++;
          return true;
        }
      };
    }

    function preparedVariantBindingKey(tileToken, signature) {
      return `${tileToken}|${signature}`;
    }

    function discardPreparedVariantBindings(tileToken) {
      const prefix = `${tileToken}|`;
      for (const key of preparedVariantBindings.keys()) {
        if (key.startsWith(prefix)) preparedVariantBindings.delete(key);
      }
    }

    /** True only when the exact token/signature was submitted by the most recently completed real render. */
    function signatureWasPresented(tileToken, signature) {
      return Boolean(tileToken && signature && presentedSignatureByToken.get(tileToken) === signature);
    }

    /**
     * Snapshot presentation after the renderer has consumed the scene. Visibility mutation during update is not
     * evidence that the next physics step can safely launch toward that road; only this post-render receipt is.
     */
    function markPresented() {
      presentedSignatureByToken.clear();
      const nextPresentedTiles = [];
      for (const tileToken of activeTokens) {
        const record = records.get(tileToken);
        if (!record) continue;
        presentedSignatureByToken.set(tileToken, record.signature);
        nextPresentedTiles.push(Object.freeze({
          tileToken,
          signature: record.signature
        }));
      }
      presentedSerial++;
      presentedTiles = Object.freeze(nextPresentedTiles);
      return Object.freeze({
        serial: presentedSerial,
        tiles: presentedTiles
      });
    }

    /**
     * Keep one cleanup authority until a finished builder result is atomically published. Marking the lease before
     * invoking a disposer prevents an exception inside dispose/cancel from causing a second destructive attempt.
     */
    function createResourceLease(resource, releaseResource) {
      let state = 'owned';
      return Object.freeze({
        get state() { return state; },
        release() {
          if (state !== 'owned') return false;
          state = 'released';
          releaseResource(resource);
          return true;
        },
        transfer() {
          if (state !== 'owned') return false;
          state = 'transferred';
          return true;
        }
      });
    }

    function registerRecord(
      tile,
      graph,
      scopedTrack,
      visual,
      buildSource,
      startedAt,
      elapsedMs = null,
      visualLease = null
    ) {
      const record = {
        token: tile.token,
        tile,
        graph,
        scopedTrack,
        // Recovery swaps may replace scopedTrack while retaining this exact visual and its atlas listener.
        texturePublicationOwner: scopedTrack,
        visual,
        signature: graphSignature(graph),
        expectedSignature: graphSignature(graph),
        routeAuthoritative: true,
        staleReason: null,
        lastUsed: updateSerial,
        buildSource
      };
      visual.setRenderQuality?.(activeRenderQualityId);
      const existing = records.get(tile.token);
      if (existing?.signature === record.signature) {
        // A synchronous activation may win a race with a pending idle build; never orphan the losing visual.
        if (visualLease) visualLease.release();
        else visual.dispose();
        existing.expectedSignature = existing.signature;
        existing.routeAuthoritative = true;
        existing.staleReason = null;
        warmRegistrationReuseCount++;
        return existing;
      } else {
        // Resolve every fallible timing read before replacing the authoritative record. Once Map.set commits, the
        // caller may transfer its lease without any later helper exception leaving a disposed visual in records.
        const measuredBuildMs = Math.max(
          0,
          Number.isFinite(elapsedMs) ? elapsedMs : now() - startedAt
        );
        if (existing) {
          invalidationCount++;
          lastInvalidation = Object.freeze({
            token: tile.token,
            previousSignature: existing.signature,
            expectedSignature: record.signature,
            previousBuildSource: existing.buildSource
          });
          // Remove the old ownership record before disposal. If its disposer throws, retry sees a genuinely missing
          // resident and will never call the same non-idempotent disposer a second time.
          records.delete(tile.token);
          discardPreparedVariantBindings(tile.token);
          existing.visual.dispose();
        }
        records.set(tile.token, record);
        if (!disposed) presentationTextureRevision++;
        lastBuildMs = measuredBuildMs;
      }
      ambientTrafficMarkerKey = '';
      cameraBlockerActiveTokens = null;
      maxBuildMs = Math.max(maxBuildMs, lastBuildMs);
      if (buildSource === 'warm') warmBuildCount++;
      else if (buildSource === 'critical') criticalBuildCount++;
      else foregroundBuildCount++;
      return record;
    }

    function createRecord(tile, pathPlan, buildSource = 'foreground') {
      const startedAt = now();
      const graph = boundGraphForTile(tile, pathPlan, { includeRecovery: true });
      const scopedTrack = createScopedTrack(track, graph);
      const visual = visualFactory.create(visualOptions(graph, scopedTrack));
      const visualLease = createResourceLease(visual, (ownedVisual) => ownedVisual.dispose());
      try {
        const record = registerRecord(
          tile,
          graph,
          scopedTrack,
          visual,
          buildSource,
          startedAt,
          null,
          visualLease
        );
        if (record.visual === visual) visualLease.transfer();
        return record;
      } catch (error) {
        visualLease.release();
        throw error;
      }
    }

    function activatePreparedVariant(tile, pathPlan, expected) {
      const record = records.get(tile.token);
      if (!record?.visual.hasRecoveryVariant?.(expected)) return null;
      const binding = preparedVariantBindings.get(
        preparedVariantBindingKey(tile.token, expected)
      );
      const graph = binding?.graph
        || boundGraphForTile(tile, pathPlan, { includeRecovery: true });
      const scopedTrack = binding?.scopedTrack || createScopedTrack(track, graph);
      if (!record.visual.activateRecoveryVariant(expected, graph, scopedTrack)) return null;
      record.tile = tile;
      record.graph = graph;
      record.scopedTrack = scopedTrack;
      record.signature = expected;
      record.expectedSignature = expected;
      record.routeAuthoritative = true;
      record.staleReason = null;
      record.lastUsed = updateSerial;
      atomicRecoverySwitchCount++;
      const routeTile = pathPlan?.tiles?.find((candidate) => candidate.token === tile.token);
      if (routeTile?.opposingBypass === true) opposingBypassAtomicSwitchCount++;
      ambientTrafficMarkerKey = '';
      cameraBlockerActiveTokens = null;
      return record;
    }

    function routeVariantRequirementKey(tileToken, signature) {
      return `${tileToken}|${signature}`;
    }

    /** Resolve the destination-owned tile whose paired visual must match one adopted route cursor. */
    function routeVariantTile(pathPlan, routeCursorOrTile = null) {
      if (!Array.isArray(pathPlan?.tiles)) return null;
      if (routeCursorOrTile?.token) {
        return pathPlan.tiles.find((tile) => tile.token === routeCursorOrTile.token) || routeCursorOrTile;
      }
      const cursorEdge = track.getEdge(routeCursorOrTile?.edgeId);
      if (cursorEdge?.tileToken) {
        const edgeTile = pathPlan.tiles.find((tile) => tile.token === cursorEdge.tileToken);
        if (edgeTile) return edgeTile;
      }
      return pathPlan.tiles.find((tile) => tile.opposingBypass === true) || null;
    }

    /**
     * Insert one persistent landing requirement into the current bounded work queue. The requirement may belong to
     * the next resident, so it intentionally does not depend on variantPlanState.token.
     */
    function queueRequiredRouteVariant(requirement) {
      const state = variantPlanState;
      if (!state || !requirement || !variantTargetIsPending(requirement)) return false;
      const existingIndex = state.targets.findIndex((target) => (
        target.tile.token === requirement.tile.token && target.signature === requirement.signature
      ));
      const existing = existingIndex >= 0 ? state.targets[existingIndex] : null;
      const target = {
        ...(existing || requirement),
        pathPlan: requirement.pathPlan,
        tile: requirement.tile,
        signature: requirement.signature,
        authoritative: true,
        purpose: 'route-readiness',
        priority: 0,
        buildSource: 'critical'
      };
      if (existingIndex >= 0) state.targets.splice(existingIndex, 1);
      state.targets.unshift(target);
      if (
        activeWarmBuild
        && activeWarmBuild.kind === 'variant'
        && activeWarmBuild.tile.token === target.tile.token
        && activeWarmBuild.signature === target.signature
      ) {
        promoteActiveWarmBuild(target);
      } else if (activeWarmBuild) {
        cancelActiveWarmBuild();
        prioritizedRecoveryPreemptionCount++;
      }
      return true;
    }

    function queueRequiredRouteVariants() {
      let queued = false;
      for (const requirement of requiredRouteVariants.values()) {
        queued = queueRequiredRouteVariant(requirement) || queued;
      }
      return queued;
    }

    /** Build one atomic route-readiness receipt from active state and the last real presentation snapshot. */
    function routeVariantReadinessSnapshot(tile, pathPlan, expected, pendingStatus) {
      const record = records.get(tile.token);
      const recordActive = Boolean(record && activeTokens.includes(tile.token));
      const exactVisualActive = Boolean(
        recordActive
        && record.signature === expected
        && record.routeAuthoritative !== false
      );
      const exactPresented = signatureWasPresented(tile.token, expected);
      const ready = exactVisualActive && exactPresented;
      // The ordinary and opposing variants share the complete landing alias. While the exact variant is pending,
      // physics may use that stable segment only if some active resident for this token was actually presented.
      const landingSurfaceVisible = Boolean(
        recordActive && presentedSignatureByToken.has(tile.token)
      );
      let status = pendingStatus;
      if (ready) status = 'active-presented';
      else if (exactVisualActive) status = `${pendingStatus || 'active'}-awaiting-presentation`;
      else if (record?.signature === expected) status = 'exact-variant-inactive';
      return Object.freeze({
        applicable: true,
        ready,
        status,
        tileToken: tile.token,
        signature: expected,
        landingSurfaceVisible: ready || landingSurfaceVisible,
        stableEdgeId: pathPlan.opposingRecovery?.crossoverEdgeId || tile.opposingCrossoverEdgeId || null,
        stableUntilEdgeS: Number(pathPlan.opposingRecovery?.stabilizationLength) || null
      });
    }

    /**
     * Promote the exact landing variant to bounded critical work and return an immutable physics/visual handshake.
     * The old resident remains visible while pending; readiness requires the exact active signature to appear in a
     * completed render, preventing an update-only visibility change from authorizing physics one frame too early.
     */
    function ensureRouteVariantReadiness(pathPlan, routeCursorOrTile = null) {
      const tile = routeVariantTile(pathPlan, routeCursorOrTile);
      if (!tile?.token || tile.opposingBypass !== true) {
        return Object.freeze({
          applicable: false,
          ready: true,
          status: 'not-applicable',
          tileToken: tile?.token || null,
          signature: null,
          landingSurfaceVisible: true,
          stableEdgeId: null,
          stableUntilEdgeS: null
        });
      }
      const expected = expectedGraphSignature(track, tile, pathPlan);
      const requirementKey = routeVariantRequirementKey(tile.token, expected);
      let record = records.get(tile.token);
      if (record?.signature === expected && record.routeAuthoritative !== false) {
        requiredRouteVariants.delete(requirementKey);
        return routeVariantReadinessSnapshot(tile, pathPlan, expected, 'active');
      }
      if (record?.visual.hasRecoveryVariant?.(expected)) {
        record = activatePreparedVariant(tile, pathPlan, expected);
        if (record) {
          requiredRouteVariants.delete(requirementKey);
          routeVariantReadinessActivationCount++;
          return routeVariantReadinessSnapshot(
            tile,
            pathPlan,
            expected,
            'prepared-activated'
          );
        }
      }
      const existingRequirement = requiredRouteVariants.get(requirementKey);
      const requirement = existingRequirement || {
        kind: 'variant',
        tile,
        pathPlan,
        signature: expected,
        authoritative: true,
        purpose: 'route-readiness',
        priority: 0,
        buildSource: 'critical'
      };
      requirement.tile = tile;
      requirement.pathPlan = pathPlan;
      requiredRouteVariants.set(requirementKey, requirement);
      if (!existingRequirement) routeVariantCriticalPromotionCount++;
      queueRequiredRouteVariant(requirement);
      // Do not leave a landing-critical bridge behind the speculative 1.5s idle timeout.
      if (warmupHandle !== null && warmupScheduleKind === 'idle') {
        cancelIdle(warmupHandle);
        warmupHandle = null;
        warmupTicket = null;
        warmupScheduleKind = null;
      }
      scheduleWarmup();
      return routeVariantReadinessSnapshot(
        tile,
        pathPlan,
        expected,
        record ? 'critical-build-pending' : 'resident-missing'
      );
    }

    /**
     * Put the physically selected recovery road ahead of speculative exits. A committed route is authoritative:
     * it may preempt unrelated warm work because showing the current road and boundaries outranks future scenery.
     */
    function prioritizeRecoveryVariant(tile, pathPlan, signature, authoritative = false) {
      const state = variantPlanState;
      if (!state || state.token !== tile?.token || !pathPlan || !signature) return false;
      const resident = records.get(tile.token);
      if (resident?.signature === signature || resident?.visual.hasRecoveryVariant?.(signature)) return false;
      const existingIndex = state.targets.findIndex((target) => (
        target.tile.token === tile.token && target.signature === signature
      ));
      let target = existingIndex >= 0 ? state.targets[existingIndex] : null;
      if (!target) {
        target = {
          kind: 'variant',
          tile: state.tile,
          pathPlan,
          signature,
          authoritative
        };
      } else if (authoritative && !target.authoritative) {
        target = { ...target, pathPlan, authoritative: true };
      }
      if (existingIndex >= 0) state.targets.splice(existingIndex, 1);
      state.targets.unshift(target);
      if (state.prioritySignature !== signature) {
        state.prioritySignature = signature;
        prioritizedRecoveryVariantCount++;
      }
      if (
        authoritative
        && activeWarmBuild
        && (
          activeWarmBuild.kind !== 'variant'
          || activeWarmBuild.tile.token !== tile.token
          || activeWarmBuild.signature !== signature
        )
      ) {
        cancelActiveWarmBuild();
        prioritizedRecoveryPreemptionCount++;
      }
      return true;
    }

    /** Derive the current committed tile signature without rebuilding the complete resident visual. */
    function prioritizeCommittedRecoveryVariant(tile, pathPlan) {
      const routeTile = pathPlan?.tiles?.find((candidate) => candidate.token === tile?.token);
      if (!routeTile) return false;
      return prioritizeRecoveryVariant(
        tile,
        pathPlan,
        expectedGraphSignature(track, routeTile, pathPlan),
        true
      );
    }

    /**
     * A proposal is an early hint only: queue it first, but do not cancel work until the PathPlan commit makes
     * the signature authoritative. This avoids thrashing while still using the full decision lead distance.
     */
    function prioritizeProposedRecoveryVariant(tile, pathPlan, proposal) {
      const movementId = typeof proposal === 'string'
        ? proposal
        : proposal?.id || proposal?.movementId || null;
      const movement = movementId ? track.getMovement?.(movementId) : null;
      const belongsToTile = movement && (
        movement.tileToken === tile?.token
        || (
          tile?.index === 0
          && !movement.tileToken
          && movement.entryPort === tile.entryPort
        )
      );
      if (!belongsToTile) return false;
      const candidatePathPlan = track.createPathPlan({
        movementId: movement.id,
        futureMovementKind: pathPlan?._futureKind || 'straight'
      });
      const candidateTile = candidatePathPlan.tiles?.find((candidate) => candidate.token === tile.token);
      if (!candidateTile) return false;
      return prioritizeRecoveryVariant(
        tile,
        candidatePathPlan,
        expectedGraphSignature(track, candidateTile, candidatePathPlan),
        false
      );
    }

    function ensureRecord(tile, pathPlan, buildSource = 'foreground') {
      // Deterministic recovery and visual edge ids avoid rebuilding a complete graph in the per-frame comparison path.
      const expected = expectedGraphSignature(track, tile, pathPlan);
      let record = records.get(tile.token);
      if (record?.signature === expected) {
        record.expectedSignature = expected;
        record.routeAuthoritative = true;
        record.staleReason = null;
      }
      if (record && record.signature !== expected) {
        const prepared = activatePreparedVariant(tile, pathPlan, expected);
        if (prepared) return prepared;
        if (buildSource === 'foreground' && variantPlanState?.token === tile.token) {
          // Keep the complete old recovery hidden in the distance, but make the committed replacement the next
          // warm result. The retained visual is explicitly stale and never masquerades as route authority.
          prioritizeCommittedRecoveryVariant(tile, pathPlan);
          record.expectedSignature = expected;
          record.routeAuthoritative = false;
          record.staleReason = 'committed-variant-build-pending';
          deferredRecoverySwitchCount++;
          return record;
        }
        invalidationCount++;
        lastInvalidation = Object.freeze({
          token: tile.token,
          previousSignature: record.signature,
          expectedSignature: expected,
          previousBuildSource: record.buildSource
        });
        record.visual.dispose();
        records.delete(tile.token);
        discardPreparedVariantBindings(tile.token);
        ambientTrafficMarkerKey = '';
        cameraBlockerActiveTokens = null;
        record = null;
      }
      return record || createRecord(tile, pathPlan, buildSource);
    }

    function getCurrentRecord(tile, pathPlan) {
      if (!tile) return null;
      const record = records.get(tile.token);
      return record?.signature === expectedGraphSignature(track, tile, pathPlan) ? record : null;
    }

    /** Keep the opening current and next road complete before runtime publishes a launch-ready boundary. */
    function isInitialRouteReady() {
      const context = latestWarmupContext;
      if (!context?.pathPlan || !context.currentTile) return false;
      const currentReady = Boolean(getCurrentRecord(context.currentTile, context.pathPlan));
      const nextReady = !context.nextTile || Boolean(getCurrentRecord(context.nextTile, context.pathPlan));
      return currentReady && nextReady;
    }

    /**
     * Missing camera-critical tiles outrank speculative exits and distant warm residents. Existing stale
     * records are intentionally excluded: recovery-signature handoffs retain their separate atomic path.
     */
    function resolveCriticalTile(context) {
      if (!stagedTileBuildsEnabled) return null;
      const candidates = [{ tile: context?.currentTile, pathPlan: context?.pathPlan, purpose: 'current' }];
      for (const tileToken of pendingOpposingBypassPreflightTokens) {
        const preflight = opposingBypassPreflightForToken(tileToken);
        if (!preflight) continue;
        candidates.push({
          tile: preflight.destinationTile,
          pathPlan: preflight.ordinaryPathPlan,
          purpose: 'opposing-bypass-preflight-resident'
        });
      }
      const examinedTokens = new Set();
      for (const candidate of candidates) {
        const tile = candidate.tile;
        if (!tile?.token || examinedTokens.has(tile.token)) continue;
        examinedTokens.add(tile.token);
        if (!records.has(tile.token)) {
          return {
            kind: 'tile',
            buildSource: 'critical',
            tile,
            pathPlan: candidate.pathPlan,
            purpose: candidate.purpose
          };
        }
      }
      const nextTile = context?.nextTile;
      if (nextTile?.token && !records.has(nextTile.token)) {
        const nextTarget = {
          kind: 'tile',
          buildSource: 'critical',
          tile: nextTile,
          pathPlan: context.pathPlan,
          purpose: 'next'
        };
        // Current and physical landing leases normally outrank a new next build at capacity. A +2 builder that is
        // already in flight is not a fourth resident, so keep its progress and raise it instead of starving it.
        const nextAlreadyInFlight = warmBuildTargetsMatch(activeWarmBuild, nextTarget)
          || warmBuildTargetsMatch(pendingWarmBuildRetry, nextTarget);
        if (context?.desiredTokens?.size >= maxTiles && !nextAlreadyInFlight) return null;
        return nextTarget;
      }
      return null;
    }

    function distanceToBounds(point, bounds) {
      if (!point || !bounds) return Number.POSITIVE_INFINITY;
      const x = Number(point.x) || 0;
      const z = Number(point.z) || 0;
      const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? x - bounds.maxX : 0;
      const dz = z < bounds.minZ ? bounds.minZ - z : z > bounds.maxZ ? z - bounds.maxZ : 0;
      return Math.hypot(dx, dz);
    }

    /** Publish an authoritative map graph while its complete 3D resident is still behind the atomic handoff. */
    function mapRouteFallbackRecord(tile, pathPlan, residentRecord = null) {
      const expected = expectedGraphSignature(track, tile, pathPlan);
      const fallbackKey = `${tile.token}:${expected}`;
      const graph = fallbackKey === mapGraphRouteFallbackKey && mapGraphRouteFallbackGraph
        ? mapGraphRouteFallbackGraph
        : boundGraphForTile(tile, pathPlan, { includeRecovery: true });
      mapGraphRouteFallbackGraph = graph;
      return {
        ...(residentRecord || {}),
        token: tile.token,
        tile,
        graph,
        signature: graphSignature(graph),
        mapRouteFallback: true,
        residentVisualStale: Boolean(residentRecord),
        residentVisualMissing: !residentRecord,
        residentVisualAuthoritative: false,
        presentationDegraded: true,
        presentationDegradationReason: residentRecord
          ? 'current-road-resident-stale'
          : 'current-road-resident-missing'
      };
    }

    /**
     * Publish the active road graphs within the stable map envelope. The first token is always the current tile;
     * future tiles join atomically only when their real bounds enter the quality floor or a larger requested radius.
     * During a committed recovery handoff, the map may lead the stale resident visual with the authoritative graph.
     */
    function getActiveMapGraph(origin, options = {}) {
      const requestedDistance = Number(options.maximumDistance);
      // A caller's shorter camera far plane must not reintroduce map pop after the 3D pool has deliberately
      // pre-presented a complete future tile. Larger explicit envelopes remain authoritative.
      const maximumDistance = Math.max(
        DEFAULT_MAP_VISIBILITY_DISTANCE,
        Number.isFinite(requestedDistance) ? requestedDistance : 0
      );
      const pathPlan = options.pathPlan;
      const cursorEdge = track.getEdge(options.routeCursor?.edgeId);
      const currentTile = Array.isArray(pathPlan?.tiles)
        ? pathPlan.tiles.find((tile) => (
            tile.token === cursorEdge?.tileToken
            || tile.index === (cursorEdge?.tileIndex ?? options.routeCursor?.tileIndex)
          ))
        : null;
      let selectedRecords = activeTokens
        .map((token) => {
          const record = records.get(token);
          if (!record || currentTile?.token !== token) return record;
          const expected = expectedGraphSignature(track, currentTile, pathPlan);
          if (record.signature === expected) return record;
          // The map follows the authoritative route even while its 3D road variant finishes in bounded idle slices.
          return mapRouteFallbackRecord(currentTile, pathPlan, record);
        })
        .filter(Boolean);
      if (currentTile && !selectedRecords.some((record) => record.token === currentTile.token)) {
        selectedRecords.unshift(mapRouteFallbackRecord(currentTile, pathPlan));
      }
      selectedRecords = selectedRecords.filter((record, index) => record && (
        currentTile
          ? record.token === currentTile.token
            || distanceToBounds(origin, record.graph.tileBounds || record.graph.bounds) <= maximumDistance
          : index === 0
            || distanceToBounds(origin, record.graph.tileBounds || record.graph.bounds) <= maximumDistance
      ));
      if (!selectedRecords.length) return null;
      const fallbackRecord = selectedRecords.find((record) => record.mapRouteFallback);
      const fallbackKey = fallbackRecord ? `${fallbackRecord.token}:${fallbackRecord.signature}` : '';
      mapGraphRouteFallbackActive = Boolean(fallbackRecord);
      if (fallbackKey && fallbackKey !== mapGraphRouteFallbackKey) mapGraphRouteFallbackCount++;
      mapGraphRouteFallbackKey = fallbackKey;
      const key = selectedRecords.map((record) => (
        `${record.token}:${record.signature}:${
          record.residentVisualMissing
            ? 'missing-fallback'
            : record.mapRouteFallback ? 'stale-fallback' : 'resident'
        }`
      )).join('|');
      if (key === activeMapGraphKey && activeMapGraph) return activeMapGraph;
      const edges = Object.freeze(uniqueById(selectedRecords.flatMap((record) => record.graph.edges)));
      const nodes = Object.freeze(uniqueById(selectedRecords.flatMap((record) => record.graph.nodes)));
      const movements = Object.freeze(uniqueById(selectedRecords.flatMap((record) => record.graph.movements)));
      const crossings = Object.freeze(uniqueById(selectedRecords.flatMap((record) => record.graph.crossings)));
      const first = selectedRecords[0].graph;
      const tileTokens = Object.freeze(selectedRecords.map((record) => record.token));
      activeMapGraph = Object.freeze({
        version: `${first.version}:visible:${key}`,
        tile: first.tile,
        tileTokens,
        origin: first.origin,
        ports: first.ports,
        nodes,
        nodesById: freezeLookup(nodes),
        edges,
        edgesById: freezeLookup(edges),
        crossings,
        movements,
        movementsById: freezeLookup(movements),
        bounds: unionBounds(edges, first.tile),
        recoveryEdgeIds: Object.freeze(uniqueById(selectedRecords.flatMap((record) => (
          record.graph.recoveryEdgeIds.map((id) => ({ id }))
        ))).map((item) => item.id)),
        bidirectionalVisualEdgeIds: Object.freeze(uniqueById(selectedRecords.flatMap((record) => (
          record.graph.bidirectionalVisualEdgeIds.map((id) => ({ id }))
        ))).map((item) => item.id)),
        contract: Object.freeze({
          ...(first.contract || {}),
          activeVisualGraph: true,
          maximumVisibilityDistanceM: maximumDistance,
          currentRouteFallback: Boolean(fallbackRecord),
          residentVisualStale: Boolean(fallbackRecord?.residentVisualStale),
          residentVisualMissing: Boolean(fallbackRecord?.residentVisualMissing),
          residentVisualAuthoritative: !fallbackRecord,
          presentationDegraded: Boolean(fallbackRecord),
          presentationDegradationReason: fallbackRecord?.presentationDegradationReason || null
        })
      });
      activeMapGraphKey = key;
      return activeMapGraph;
    }

    function evict(currentIndex, desiredTokens) {
      if (records.size <= maxTiles) return;
      const candidates = [...records.values()]
        .filter((record) => (
          !desiredTokens.has(record.token)
          // An outstanding lip target remains authoritative when it becomes previous. Evict speculative residents
          // first, and never dispose the resident whose recovery-only builder is still writing into that visual.
          && !pendingOpposingBypassPreflightTokens.has(record.token)
          && activeWarmBuild?.tile.token !== record.token
        ))
        .sort((a, b) => {
          const distanceDelta = Math.abs(b.tile.index - currentIndex) - Math.abs(a.tile.index - currentIndex);
          return distanceDelta || a.lastUsed - b.lastUsed;
        });
      while (records.size > maxTiles && candidates.length) {
        const record = candidates.shift();
        record.visual.dispose();
        records.delete(record.token);
        discardPreparedVariantBindings(record.token);
        ambientTrafficMarkerKey = '';
        cameraBlockerActiveTokens = null;
      }
    }

    /** Prioritize a revised next tile, then keep the next-next tile ready outside the live transition frame. */
    function resolveWarmTile(context) {
      // Current, landing-authority pins, and a camera-retained previous tile may legitimately fill all three
      // residents. Speculative construction must then wait; protecting a fourth just-finished record would violate
      // the bounded-pool contract and make Film cuts trade one pop for unbounded GPU memory growth.
      if (context.desiredTokens?.size >= maxTiles) return null;
      const tiles = context.pathPlan.tiles || [];
      const nextTile = tiles.find((tile) => tile.index === context.currentIndex + 1);
      if (nextTile && !getCurrentRecord(nextTile, context.pathPlan)) {
        const replacedNext = [...records.values()].some((record) => record.tile.index === nextTile.index);
        const cursorEdge = track.getEdge(context.routeCursor?.edgeId);
        // A committed exit is still several kilometres from the next tile, so defer its heavy rebuild until recovery.
        if (replacedNext && cursorEdge?.runtimeKind !== 'recovery') return null;
        return nextTile;
      }
      const warmTile = tiles.find((tile) => tile.index === context.currentIndex + PREWARM_TILES_AHEAD);
      return warmTile && !getCurrentRecord(warmTile, context.pathPlan) ? warmTile : null;
    }

    function resetVariantPlanState(tile, pathPlan) {
      variantPlanState = {
        token: tile.token,
        tile,
        sourcePathPlan: pathPlan,
        movements: null,
        movementIndex: 0,
        targets: [],
        prioritySignature: null,
        complete: !prepareRecoveryVariants
      };
    }

    function variantTargetIsPending(target) {
      const resident = records.get(target?.tile?.token);
      return Boolean(
        resident
        && resident.signature !== target.signature
        && !resident.visual.hasRecoveryVariant?.(target.signature)
      );
    }

    function opposingBypassPreflightForToken(tileToken) {
      return opposingBypassPreflightsByDestination.get(tileToken) || null;
    }

    /**
     * A preflight owns its heavyweight PathPlans only while work or the current presentation still references the
     * destination. The explicit pending lease survives cursor resets; a live builder and latest desired set cover
     * the atomic variant handoff and runtime landing pins after pending work completes.
     */
    function opposingBypassPreflightIsLive(preflight) {
      const tileToken = preflight?.destinationTile?.token;
      if (!tileToken) return false;
      return pendingOpposingBypassPreflightTokens.has(tileToken)
        || activeWarmBuild?.tile.token === tileToken
        || latestDesiredTokens.has(tileToken)
        || latestWarmupContext?.currentTile?.token === tileToken
        || latestWarmupContext?.nextTile?.token === tileToken;
    }

    /** Release completed or invalid historical receipts so long sessions retain only live destination PathPlans. */
    function pruneOpposingBypassPreflights() {
      for (const [tileToken, preflight] of opposingBypassPreflightsByDestination) {
        if (
          preflight?.destinationTile?.token === tileToken
          && opposingBypassPreflightIsLive(preflight)
        ) continue;
        pendingOpposingBypassPreflightTokens.delete(tileToken);
        opposingBypassPreflightsByDestination.delete(tileToken);
      }
    }

    function opposingVariantPreparedForPreflight(preflight) {
      if (!preflight?.opposingSignature) return false;
      const resident = records.get(preflight.destinationTile.token);
      return Boolean(
        resident
        && (
          resident.signature === preflight.opposingSignature
          || resident.visual.hasRecoveryVariant?.(preflight.opposingSignature)
        )
      );
    }

    /** Remove critical ownership only after the exact destination-owned opposing signature is resident. */
    function completeOpposingBypassPreflight(preflight) {
      if (!opposingVariantPreparedForPreflight(preflight)) return false;
      preflight.variantPrepared = true;
      if (pendingOpposingBypassPreflightTokens.delete(preflight.destinationTile.token)) {
        opposingBypassPreflightPreparedCount++;
      }
      pruneOpposingBypassPreflights();
      return true;
    }

    /** Return the launch-platform receipt without mutating topology, builders, residents, or presentation state. */
    function opposingBypassPreflightHandshake(preflight, unavailableStatus = 'preflight-unavailable') {
      if (!preflight) {
        return Object.freeze({
          applicable: false,
          sourceTileToken: null,
          destinationTileToken: null,
          landingTileToken: null,
          tileToken: null,
          ordinaryExpectedSignature: null,
          landingTileSignature: null,
          signature: null,
          visualReady: false,
          collisionReady: false,
          presentedReady: false,
          opposingVariantReady: false,
          landingSurfaceReady: false,
          ready: false,
          status: unavailableStatus
        });
      }
      const tileToken = preflight.destinationTile.token;
      const record = records.get(tileToken);
      const visualReady = Boolean(
        record
        && record.signature === preflight.ordinaryExpectedSignature
        && record.routeAuthoritative !== false
        && activeTokens.includes(tileToken)
      );
      const collisionReady = bidirectionalVisualEdgesForTile(track, preflight.destinationTile)
        .some((edge) => edge.airborneLandingSurface === true);
      const presentedReady = signatureWasPresented(tileToken, preflight.ordinaryExpectedSignature);
      const opposingVariantReady = opposingVariantPreparedForPreflight(preflight);
      const landingSurfaceReady = visualReady && collisionReady && presentedReady;
      let status = 'landing-surface-ready';
      if (!record) status = 'awaiting-resident';
      else if (record.signature !== preflight.ordinaryExpectedSignature) {
        status = 'awaiting-ordinary-signature';
      } else if (!activeTokens.includes(tileToken)) status = 'awaiting-visual-activation';
      else if (!collisionReady) status = 'collision-surface-unavailable';
      else if (!presentedReady) status = 'awaiting-presentation';
      else if (!opposingVariantReady) status = 'landing-surface-ready-variant-pending';
      return Object.freeze({
        applicable: true,
        sourceTileToken: preflight.sourceTile.token,
        destinationTileToken: tileToken,
        landingTileToken: tileToken,
        // Runtime retains tileToken/signature as the compact legacy aliases used by the physics metadata table.
        tileToken,
        ordinaryExpectedSignature: preflight.ordinaryExpectedSignature,
        landingTileSignature: preflight.ordinaryExpectedSignature,
        signature: preflight.ordinaryExpectedSignature,
        visualReady,
        collisionReady,
        presentedReady,
        opposingVariantReady,
        landingSurfaceReady,
        ready: landingSurfaceReady,
        status
      });
    }

    /**
     * Promote an already-enumerated counterflow candidate without planning or publishing it on the physics stack.
     * Promotion does not complete the request: its token remains critical until the exact variant is installed.
     */
    function promotePendingOpposingBypassPreflights() {
      const state = variantPlanState;
      if (!state || pendingOpposingBypassPreflightTokens.size === 0) return false;
      let promoted = false;
      for (const tileToken of pendingOpposingBypassPreflightTokens) {
        const preflight = opposingBypassPreflightForToken(tileToken);
        if (!preflight) continue;
        const targetIndex = state.targets.findIndex((target) => (
          target.tile.token === tileToken
          && (
            target.purpose === 'opposing-bypass-prewarm'
            || target.purpose === 'opposing-bypass-preflight'
          )
        ));
        if (targetIndex < 0) continue;
        const target = state.targets[targetIndex];
        preflight.opposingPathPlan = target.pathPlan;
        preflight.opposingTile = target.pathPlan?.tiles?.find((tile) => tile.token === tileToken)
          || target.tile;
        preflight.opposingSignature = target.signature;
        preflight.variantTarget = target;
        if (completeOpposingBypassPreflight(preflight)) {
          continue;
        }
        const wasCritical = target.purpose === 'opposing-bypass-preflight'
          && target.authoritative === true
          && target.buildSource === 'critical';
        target.authoritative = true;
        target.priority = 0;
        target.buildSource = 'critical';
        target.purpose = 'opposing-bypass-preflight';
        state.targets.splice(targetIndex, 1);
        state.targets.unshift(target);
        if (!wasCritical && preflight.promotionRecorded !== true) {
          preflight.promotionRecorded = true;
          opposingBypassPreflightPromotionCount++;
        }
        if (
          activeWarmBuild
          && activeWarmBuild.kind === 'variant'
          && activeWarmBuild.tile.token === tileToken
          && activeWarmBuild.signature === target.signature
        ) {
          promoteActiveWarmBuild(target);
        } else if (activeWarmBuild) {
          cancelActiveWarmBuild();
          prioritizedRecoveryPreemptionCount++;
        }
        promoted = true;
      }
      return promoted;
    }

    /**
     * The platform lip is a hard real-time boundary: resolve only the destination token and wake bounded pool work.
     * Candidate PathPlan construction, recovery geometry, and resident activation are forbidden in this call. The
     * returned frozen receipt proves ordinary landing geometry only when that exact signature was really rendered.
     */
    function requestOpposingRouteVariantPreflight(pathPlan, sourceEdgeId) {
      if (
        !pathPlan
        || !sourceEdgeId
        || typeof track.getTileForEdge !== 'function'
      ) return opposingBypassPreflightHandshake(null, 'invalid-request');
      const sourceTile = track.getTileForEdge(sourceEdgeId);
      const destinationTile = pathPlan.tiles?.find((tile) => (
        tile.index === (sourceTile?.index ?? -1) + 1
      ));
      if (!sourceTile?.token || !destinationTile?.token || destinationTile.index <= 0) {
        return opposingBypassPreflightHandshake(null, 'destination-unavailable');
      }
      const ordinaryExpectedSignature = expectedGraphSignature(track, destinationTile, pathPlan);
      let preflight = opposingBypassPreflightForToken(destinationTile.token);
      const sameRequest = preflight?.sourceTile.token === sourceTile.token
        && preflight.ordinaryExpectedSignature === ordinaryExpectedSignature;
      if (!sameRequest) {
        preflight = {
          sourceTile,
          destinationTile,
          ordinaryPathPlan: pathPlan,
          ordinaryExpectedSignature,
          opposingPathPlan: null,
          opposingTile: null,
          opposingSignature: null,
          variantTarget: null,
          variantPrepared: false,
          promotionRecorded: false
        };
        opposingBypassPreflightsByDestination.set(destinationTile.token, preflight);
      } else {
        preflight.sourceTile = sourceTile;
        preflight.destinationTile = destinationTile;
        preflight.ordinaryPathPlan = pathPlan;
      }
      const wasPending = pendingOpposingBypassPreflightTokens.has(destinationTile.token);
      const variantAlreadyPrepared = opposingVariantPreparedForPreflight(preflight);
      if (!variantAlreadyPrepared) {
        preflight.variantPrepared = false;
        pendingOpposingBypassPreflightTokens.add(destinationTile.token);
      } else {
        preflight.variantPrepared = true;
      }
      // Repeated calls for the same outstanding token/signature are read-only polls, not new prewarm requests.
      if (!sameRequest || (!wasPending && !preflight.variantPrepared)) {
        opposingBypassPreflightRequestCount++;
      }
      // If ordinary idle prewarm already enumerated the candidate, promotion is a constant-size metadata change.
      promotePendingOpposingBypassPreflights();
      if (warmupHandle !== null && warmupScheduleKind === 'idle') {
        cancelIdle(warmupHandle);
        warmupHandle = null;
        warmupTicket = null;
        warmupScheduleKind = null;
      }
      scheduleWarmup();
      return opposingBypassPreflightHandshake(preflight);
    }

    /**
     * Prepare a future resident's counterflow crossover while it is still the next tile. Variant ownership follows
     * the target token and signature, not the current-tile enumeration state that happens to schedule the work.
     */
    function queueOpposingBypassVariant(tile, pathPlan) {
      const state = variantPlanState;
      if (
        !prepareRecoveryVariants
        || !state
        || tile?.index <= 0
        || !records.has(tile.token)
        || typeof track.prepareOpposingRecoveryPathPlan !== 'function'
      ) {
        return false;
      }
      const candidatePathPlan = track.prepareOpposingRecoveryPathPlan(pathPlan, tile);
      const candidateTile = candidatePathPlan?.tiles?.find((candidate) => candidate.token === tile.token);
      if (!candidateTile?.opposingBypass) return false;
      const signature = expectedGraphSignature(track, candidateTile, candidatePathPlan);
      const resident = records.get(tile.token);
      const preflight = opposingBypassPreflightForToken(tile.token);
      if (preflight && pendingOpposingBypassPreflightTokens.has(tile.token)) {
        preflight.opposingPathPlan = candidatePathPlan;
        preflight.opposingTile = candidateTile;
        preflight.opposingSignature = signature;
      }
      if (resident.signature === signature || resident.visual.hasRecoveryVariant?.(signature)) {
        if (preflight) completeOpposingBypassPreflight(preflight);
        return false;
      }
      if (state.targets.some((target) => (
        target.tile.token === tile.token && target.signature === signature
      ))) {
        return false;
      }
      state.targets.push({
        kind: 'variant',
        tile,
        pathPlan: candidatePathPlan,
        signature,
        authoritative: false,
        purpose: 'opposing-bypass-prewarm',
        // A jump can physically adopt this road; current/next opposing variants outrank speculative exit art.
        priority: tile.token === state.token ? 0 : 1
      });
      opposingBypassVariantQueuedCount++;
      return true;
    }

    /**
     * Reinsert every outstanding lip request into the current bounded queue, even when its destination is no longer
     * current or next. Path planning happens here, never in the swept-physics request call.
     */
    function queuePendingOpposingBypassPreflightVariants() {
      const state = variantPlanState;
      if (
        !prepareRecoveryVariants
        || !state
        || typeof track.prepareOpposingRecoveryPathPlan !== 'function'
      ) return false;
      let queued = false;
      for (const tileToken of pendingOpposingBypassPreflightTokens) {
        const preflight = opposingBypassPreflightForToken(tileToken);
        const resident = records.get(tileToken);
        if (!preflight || !resident) continue;
        if (!preflight.opposingPathPlan || !preflight.opposingSignature) {
          const candidatePathPlan = track.prepareOpposingRecoveryPathPlan(
            preflight.ordinaryPathPlan,
            preflight.destinationTile
          );
          const candidateTile = candidatePathPlan?.tiles?.find((tile) => tile.token === tileToken);
          if (!candidateTile?.opposingBypass) continue;
          preflight.opposingPathPlan = candidatePathPlan;
          preflight.opposingTile = candidateTile;
          preflight.opposingSignature = expectedGraphSignature(track, candidateTile, candidatePathPlan);
        }
        if (completeOpposingBypassPreflight(preflight)) continue;
        const existingIndex = state.targets.findIndex((target) => (
          target.tile.token === tileToken && target.signature === preflight.opposingSignature
        ));
        const target = existingIndex >= 0
          ? state.targets[existingIndex]
          : preflight.variantTarget?.signature === preflight.opposingSignature
            ? preflight.variantTarget
            : {
                kind: 'variant',
                tile: preflight.destinationTile,
                pathPlan: preflight.opposingPathPlan,
                signature: preflight.opposingSignature
              };
        target.tile = preflight.destinationTile;
        target.pathPlan = preflight.opposingPathPlan;
        target.signature = preflight.opposingSignature;
        target.authoritative = true;
        target.priority = 0;
        target.buildSource = 'critical';
        target.purpose = 'opposing-bypass-preflight';
        if (existingIndex >= 0) state.targets.splice(existingIndex, 1);
        state.targets.unshift(target);
        preflight.variantTarget = target;
        if (preflight.queuedSignature !== preflight.opposingSignature) {
          preflight.queuedSignature = preflight.opposingSignature;
          opposingBypassVariantQueuedCount++;
        }
        if (preflight.promotionRecorded !== true) {
          preflight.promotionRecorded = true;
          opposingBypassPreflightPromotionCount++;
        }
        if (
          activeWarmBuild
          && activeWarmBuild.kind === 'variant'
          && activeWarmBuild.tile.token === tileToken
          && activeWarmBuild.signature === target.signature
        ) {
          promoteActiveWarmBuild(target);
        } else if (activeWarmBuild) {
          cancelActiveWarmBuild();
          prioritizedRecoveryPreemptionCount++;
        }
        queued = true;
      }
      return queued;
    }

    function queueRelevantOpposingBypassVariants(context) {
      if (!context?.pathPlan) return false;
      const currentQueued = queueOpposingBypassVariant(context.currentTile, context.pathPlan);
      const nextQueued = queueOpposingBypassVariant(context.nextTile, context.pathPlan);
      return currentQueued || nextQueued;
    }

    /** Prepare one semantic exit per idle callback; recovery ids are deterministic for movement/tile. */
    function prepareOneRecoveryVariant() {
      const state = variantPlanState;
      if (!state || state.complete) return false;
      if (!state.movements) {
        state.movements = typeof track.enumerateMovements === 'function'
          ? track.enumerateMovements({
              entryPort: state.tile.entryPort,
              tileToken: state.tile.token,
              edgeId: state.tile.edgeIds?.[0]
            })
          : [];
        if (!state.movements.length) state.complete = true;
        return true;
      }
      const movement = state.movements[state.movementIndex++];
      if (!movement) {
        state.complete = true;
        return false;
      }
      const candidatePathPlan = track.createPathPlan({
        movementId: movement.id,
        futureMovementKind: state.sourcePathPlan?._futureKind || 'straight'
      });
      const candidateTile = candidatePathPlan.tiles?.find((tile) => tile.token === state.tile.token)
        || candidatePathPlan.tiles?.[0];
      if (candidateTile) {
        const signature = expectedGraphSignature(track, candidateTile, candidatePathPlan);
        const resident = records.get(state.tile.token);
        if (resident?.signature !== signature && !resident?.visual.hasRecoveryVariant?.(signature)) {
          const alreadyQueued = state.targets.some((target) => (
            target.tile.token === state.tile.token && target.signature === signature
          ));
          if (!alreadyQueued) {
            state.targets.push({
              kind: 'variant',
              tile: state.tile,
              pathPlan: candidatePathPlan,
              signature,
              authoritative: false,
              purpose: 'exit-variant',
              priority: 2
            });
          }
        }
      }
      if (state.movementIndex >= state.movements.length) state.complete = true;
      return true;
    }

    function resolveVariantTarget() {
      const state = variantPlanState;
      if (!state) return null;
      return state.targets
        .filter(variantTargetIsPending)
        .sort((a, b) => (
          Number(Boolean(b.authoritative)) - Number(Boolean(a.authoritative))
          || (a.priority ?? 2) - (b.priority ?? 2)
        ))[0] || null;
    }

    /** A route adopted by physics outranks candidate enumeration and speculative future scenery. */
    function resolveCriticalVariantTarget() {
      const state = variantPlanState;
      if (!state) return null;
      return state.targets.find((target) => (
        target.authoritative === true && variantTargetIsPending(target)
      )) || null;
    }

    function warmBuildTargetSignature(target) {
      if (target?.signature) return target.signature;
      if (!target?.tile || !target?.pathPlan) return null;
      return expectedGraphSignature(track, target.tile, target.pathPlan);
    }

    function warmBuildTargetKey(target) {
      return target?.tile?.token
        ? `${target.kind || 'tile'}:${target.tile.token}:${warmBuildTargetSignature(target) || 'unknown'}`
        : null;
    }

    function warmBuildTargetsMatch(left, right) {
      const leftKey = warmBuildTargetKey(left);
      return Boolean(leftKey && leftKey === warmBuildTargetKey(right));
    }

    /** Retain only route identity across retry backoff; failed builder/graph resources must remain collectible. */
    function retryTargetSnapshot(target, retryAttempt, firstError) {
      return {
        kind: target.kind || 'tile',
        buildSource: target.buildSource || 'warm',
        tile: target.tile,
        pathPlan: target.pathPlan,
        signature: warmBuildTargetSignature(target),
        authoritative: target.authoritative === true,
        purpose: target.purpose || null,
        retryAttempt,
        firstError
      };
    }

    function warmBuildTargetIsLive(target) {
      if (!target?.tile?.token || !latestWarmupContext?.pathPlan) return false;
      const tileToken = target.tile.token;
      const signature = warmBuildTargetSignature(target);
      const resident = records.get(tileToken);
      if (target.kind === 'variant') {
        if (
          !resident
          || resident.signature === signature
          || resident.visual.hasRecoveryVariant?.(signature)
        ) return false;
        const required = [...requiredRouteVariants.values()].some((requirement) => (
          requirement.tile.token === tileToken && requirement.signature === signature
        ));
        const preflight = opposingBypassPreflightForToken(tileToken);
        const preflightRequired = pendingOpposingBypassPreflightTokens.has(tileToken)
          && preflight?.opposingSignature === signature;
        const queued = variantPlanState?.targets.some((candidate) => (
          candidate.tile.token === tileToken
          && candidate.signature === signature
          && variantTargetIsPending(candidate)
        ));
        return required || preflightRequired || queued;
      }
      if (resident?.signature === signature) return false;
      const currentRouteTile = latestWarmupContext.pathPlan.tiles?.find((tile) => tile.token === tileToken);
      const currentRouteRequired = Boolean(
        currentRouteTile
        && expectedGraphSignature(track, currentRouteTile, latestWarmupContext.pathPlan) === signature
      );
      const preflight = opposingBypassPreflightForToken(tileToken);
      const preflightRequired = pendingOpposingBypassPreflightTokens.has(tileToken)
        && preflight?.ordinaryExpectedSignature === signature;
      return currentRouteRequired || preflightRequired;
    }

    function clearWarmBuildRetry() {
      if (warmBuildRetryHandle !== null) cancelRetry(warmBuildRetryHandle);
      warmBuildRetryHandle = null;
      warmBuildRetryTicket = null;
      pendingWarmBuildRetry = null;
    }

    function scheduleWarmBuildRetryWake() {
      if (disposed || !latestWarmupContext || !pendingWarmBuildRetry || warmBuildRetryHandle !== null) return;
      const delayMs = Math.max(0, pendingWarmBuildRetry.readyAt - now());
      const retryTicket = { generation: warmupGeneration, handle: SCHEDULING_HANDLE };
      warmBuildRetryTicket = retryTicket;
      warmBuildRetryHandle = SCHEDULING_HANDLE;
      let handle;
      try {
        handle = requestRetry(() => {
          // Generation rejects route-revoked work; ticket plus handle identity prevents an old dequeued retry from
          // clearing a newer retry that happens to target the same token after the route is recreated.
          if (
            disposed
            || !latestWarmupContext
            || retryTicket.generation !== warmupGeneration
            || warmBuildRetryTicket !== retryTicket
            || warmBuildRetryHandle !== retryTicket.handle
          ) return;
          warmBuildRetryHandle = null;
          warmBuildRetryTicket = null;
          if (!pendingWarmBuildRetry) return;
          // Injected deterministic schedulers need not emulate a wall clock; delivery itself satisfies the backoff.
          pendingWarmBuildRetry.readyAt = now();
          scheduleWarmup();
        }, delayMs);
      } catch (error) {
        if (warmBuildRetryTicket === retryTicket) {
          warmBuildRetryTicket = null;
          warmBuildRetryHandle = null;
        }
        throw error;
      }
      if (
        warmBuildRetryTicket === retryTicket
        && warmBuildRetryHandle === SCHEDULING_HANDLE
      ) {
        retryTicket.handle = handle;
        warmBuildRetryHandle = handle;
      } else if (handle !== warmBuildRetryHandle) {
        // The synchronous callback already consumed this ticket and may have installed a newer retry. Never let the
        // obsolete return value overwrite that slot; cancelling an unequal spent handle is safe and best-effort.
        cancelRetry(handle);
      }
    }

    /** Raise priority in place so a partially built +2 tile keeps every completed generator stage. */
    function promoteActiveWarmBuild(target) {
      if (!activeWarmBuild || !warmBuildTargetsMatch(activeWarmBuild, target)) return false;
      const wasCritical = activeWarmBuild.buildSource === 'critical';
      activeWarmBuild.buildSource = 'critical';
      activeWarmBuild.authoritative = target.authoritative === true || activeWarmBuild.authoritative;
      activeWarmBuild.purpose = target.purpose || activeWarmBuild.purpose;
      if (!wasCritical) {
        warmBuildPriorityPromotionCount++;
        lastWarmBuildPriorityPromotion = Object.freeze({
          tileToken: activeWarmBuild.tile.token,
          kind: activeWarmBuild.kind,
          signature: activeWarmBuild.signature,
          purpose: activeWarmBuild.purpose,
          completedSteps: Number(activeWarmBuild.builder?.diagnostics?.completedSteps) || null
        });
      }
      return true;
    }

    function promotePendingWarmBuildRetry(target) {
      if (!pendingWarmBuildRetry || !warmBuildTargetsMatch(pendingWarmBuildRetry, target)) return false;
      const wasCritical = pendingWarmBuildRetry.buildSource === 'critical';
      pendingWarmBuildRetry.buildSource = 'critical';
      pendingWarmBuildRetry.authoritative = target.authoritative === true || pendingWarmBuildRetry.authoritative;
      pendingWarmBuildRetry.purpose = target.purpose || pendingWarmBuildRetry.purpose;
      if (!wasCritical) {
        pendingWarmBuildRetry.readyAt = now();
        if (warmBuildRetryHandle !== null) cancelRetry(warmBuildRetryHandle);
        warmBuildRetryHandle = null;
        warmBuildRetryTicket = null;
      }
      return true;
    }

    function cancelActiveWarmBuild() {
      if (!activeWarmBuild) return;
      const cancelledBuild = activeWarmBuild;
      activeWarmBuild = null;
      if (cancelledBuild.resourceLease?.release()) warmBuildCancellationCount++;
      else if (!cancelledBuild.resourceLease) {
        cancelledBuild.builder?.cancel?.();
        warmBuildCancellationCount++;
      }
      pruneOpposingBypassPreflights();
    }

    function beginActiveWarmBuild(target) {
      const startedAt = now();
      const { tile, pathPlan } = target;
      const graph = boundGraphForTile(tile, pathPlan, { includeRecovery: true });
      const scopedTrack = createScopedTrack(track, graph);
      const resident = records.get(tile.token);
      const builder = target.kind === 'variant'
        ? resident?.visual.createRecoveryVariantJob?.({ track: scopedTrack, signature: graphSignature(graph) }) || null
        : visualFactory.createBuildJob?.(visualOptions(graph, scopedTrack)) || null;
      if (!builder) return null;
      // Production jobs retain their finished visual/template until cancel() or successful resident publication.
      // One lease spans step, finish, quality setup, replacement, and recovery-variant installation failures.
      const resourceLease = createResourceLease(builder, (ownedBuilder) => ownedBuilder.cancel?.());
      return {
        tile,
        kind: target.kind || 'tile',
        buildSource: target.buildSource || 'warm',
        pathPlan,
        graph,
        scopedTrack,
        resident,
        builder,
        resourceLease,
        signature: graphSignature(graph),
        authoritative: target.authoritative === true,
        purpose: target.purpose || null,
        startedAt,
        cpuMs: 0,
        retryAttempt: Number(target.retryAttempt) || 0,
        firstError: target.firstError || null
      };
    }

    function failureDiagnostic(error, firstError, target, details = {}) {
      return Object.freeze({
        tileToken: target?.tile?.token || null,
        kind: target?.kind || null,
        signature: target ? warmBuildTargetSignature(target) : null,
        buildSource: target?.buildSource || null,
        purpose: target?.purpose || null,
        stage: currentWarmupStageLabel,
        retryAttempt: Number(target?.retryAttempt) || 0,
        maxRetryAttempts: WARM_BUILD_MAX_RETRY_ATTEMPTS,
        name: firstError?.name || typeof firstError,
        message: firstError?.message || String(firstError),
        stack: typeof firstError?.stack === 'string' ? firstError.stack : null,
        latestName: error?.name || typeof error,
        latestMessage: error?.message || String(error),
        ...details
      });
    }

    /** Cancel only the damaged builder while preserving its first exception for the bounded retry boundary. */
    function cancelDamagedWarmBuild(target) {
      const builder = target?.builder;
      let cleanupError = null;
      const cleanupRequired = Boolean(
        builder && (!target.resourceLease || target.resourceLease.state === 'owned')
      );
      if (builder) {
        try {
          if (target.resourceLease) target.resourceLease.release();
          else builder.cancel?.();
        } catch (error) {
          cleanupError = error;
        }
        if (cleanupRequired) warmBuildCancellationCount++;
      }
      if (activeWarmBuild?.builder === builder || activeWarmBuild === target) activeWarmBuild = null;
      pruneOpposingBypassPreflights();
      return cleanupError;
    }

    function recoverWarmupFailure(error) {
      const failedTarget = currentWarmupTarget || activeWarmBuild;
      const firstError = failedTarget?.firstError || error;
      const retryAttempt = Number(failedTarget?.retryAttempt) || 0;
      const cleanupError = cancelDamagedWarmBuild(failedTarget);
      let targetLive = false;
      let livenessError = null;
      try {
        targetLive = Boolean(failedTarget && warmBuildTargetIsLive(failedTarget));
      } catch (liveError) {
        livenessError = liveError;
      }
      warmBuildFailureCount++;
      if (!targetLive || retryAttempt >= WARM_BUILD_MAX_RETRY_ATTEMPTS) {
        if (targetLive) warmBuildRetryExhaustedCount++;
        if (pendingWarmBuildRetry && warmBuildTargetsMatch(pendingWarmBuildRetry, failedTarget)) {
          clearWarmBuildRetry();
        }
        lastWarmBuildFailure = failureDiagnostic(error, firstError, failedTarget, {
          retryScheduled: false,
          exhausted: targetLive,
          targetLive,
          recovered: false,
          cleanupErrorName: cleanupError?.name || null,
          cleanupErrorMessage: cleanupError?.message || null,
          livenessErrorName: livenessError?.name || null,
          livenessErrorMessage: livenessError?.message || null
        });
        // Unknown/stale callback failures and retry exhaustion are programmer/runtime faults, not valid idle skips.
        throw firstError;
      }
      const nextRetryAttempt = retryAttempt + 1;
      const retryDelayMs = Math.min(
        WARM_BUILD_RETRY_MAX_DELAY_MS,
        WARM_BUILD_RETRY_BASE_DELAY_MS * (2 ** retryAttempt)
      );
      pendingWarmBuildRetry = {
        ...retryTargetSnapshot(failedTarget, nextRetryAttempt, firstError),
        readyAt: now() + retryDelayMs,
        retryDelayMs
      };
      warmBuildRetryCount++;
      lastWarmBuildFailure = failureDiagnostic(error, firstError, failedTarget, {
        retryScheduled: true,
        nextRetryAttempt,
        retryDelayMs,
        exhausted: false,
        targetLive: true,
        recovered: false,
        cleanupErrorName: cleanupError?.name || null,
        cleanupErrorMessage: cleanupError?.message || null,
        livenessErrorName: null,
        livenessErrorMessage: null
      });
      scheduleWarmBuildRetryWake();
    }

    function recordWarmBuildRecovery(target) {
      if (!(Number(target?.retryAttempt) > 0)) return;
      warmBuildRecoveryCount++;
      if (lastWarmBuildFailure) {
        lastWarmBuildFailure = Object.freeze({
          ...lastWarmBuildFailure,
          recovered: true,
          recoveredTileToken: target.tile.token,
          recoveredRetryAttempt: target.retryAttempt,
          recoveredAtMs: now()
        });
      }
    }

    /** Build revised/future visuals in bounded idle slices, then reveal the complete result atomically. */
    function runWarmupUnsafe(idleDeadline = null) {
      const sliceStartedAt = now();
      let callbackSlowestStageMs = 0;
      let callbackSlowestStageLabel = 'idle-entry';
      const context = latestWarmupContext;
      if (!context?.pathPlan || !context.routeCursor) return;
      const measureStage = (label, operation) => {
        currentWarmupStageLabel = label;
        const stageStartedAt = now();
        const value = operation();
        const stageMs = Math.max(0, now() - stageStartedAt);
        if (stageMs > callbackSlowestStageMs) {
          callbackSlowestStageMs = stageMs;
          callbackSlowestStageLabel = label;
        }
        return value;
      };
      const recordSlice = () => {
        const sliceMs = Math.max(0, now() - sliceStartedAt);
        warmSliceCount++;
        if (sliceMs > warmSliceMaxMs) {
          warmSliceMaxMs = sliceMs;
          warmSliceSlowestLabel = callbackSlowestStageLabel;
          warmSliceSlowestStageMs = callbackSlowestStageMs;
        }
        if (activeWarmBuild) activeWarmBuild.cpuMs += sliceMs;
        return sliceMs;
      };
      if (typeof track.ensureItineraryHorizon === 'function') {
        measureStage('ensure-itinerary-horizon', () => (
          track.ensureItineraryHorizon(context.pathPlan, context.routeCursor, PREWARM_TOPOLOGY_AHEAD)
        ));
      }
      measureStage('queue-opposing-bypass-variants', () => queueRelevantOpposingBypassVariants(context));
      measureStage('promote-opposing-bypass-preflights', promotePendingOpposingBypassPreflights);
      if (pendingOpposingBypassPreflightTokens.size) {
        measureStage(
          'queue-pending-opposing-bypass-preflights',
          queuePendingOpposingBypassPreflightVariants
        );
      }
      measureStage('queue-required-route-variants', queueRequiredRouteVariants);
      const resolvedCriticalTarget = resolveCriticalTile(context) || resolveCriticalVariantTarget();
      if (resolvedCriticalTarget) resolvedCriticalTarget.buildSource = 'critical';
      if (resolvedCriticalTarget) {
        promoteActiveWarmBuild(resolvedCriticalTarget);
        promotePendingWarmBuildRetry(resolvedCriticalTarget);
      }
      if (pendingWarmBuildRetry && !warmBuildTargetIsLive(pendingWarmBuildRetry)) clearWarmBuildRetry();
      let target = resolvedCriticalTarget;
      if (pendingWarmBuildRetry) {
        const retryReady = pendingWarmBuildRetry.readyAt <= now();
        const retryMatchesTarget = target && warmBuildTargetsMatch(target, pendingWarmBuildRetry);
        if (!retryReady && retryMatchesTarget) {
          recordSlice();
          scheduleWarmBuildRetryWake();
          return;
        }
        if (retryReady && (!target || retryMatchesTarget)) {
          target = pendingWarmBuildRetry;
        } else if (!target) {
          recordSlice();
          scheduleWarmBuildRetryWake();
          return;
        }
      }
      if (!target && !variantPlanState?.complete) {
        measureStage('prepare-recovery-candidate', prepareOneRecoveryVariant);
        recordSlice();
        scheduleWarmup();
        return;
      }
      if (!target) target = resolveVariantTarget();
      const warmTile = target ? null : resolveWarmTile(context);
      if (!target && warmTile) {
        target = {
          kind: 'tile',
          buildSource: 'warm',
          tile: warmTile,
          pathPlan: context.pathPlan
        };
      }
      if (activeWarmBuild) {
        if (
          target?.buildSource === 'critical'
          && !warmBuildTargetsMatch(activeWarmBuild, target)
        ) cancelActiveWarmBuild();
      }
      if (activeWarmBuild) {
        const preflight = opposingBypassPreflightForToken(activeWarmBuild.tile.token);
        const pendingPreflightBuild = pendingOpposingBypassPreflightTokens.has(activeWarmBuild.tile.token)
          && (
            activeWarmBuild.kind === 'variant'
              ? preflight?.opposingSignature === activeWarmBuild.signature
              : preflight?.ordinaryExpectedSignature === activeWarmBuild.signature
          );
        const tileStillRelevant = pendingPreflightBuild || (activeWarmBuild.kind === 'variant'
          ? variantPlanState?.targets.some((candidate) => (
              candidate.tile.token === activeWarmBuild.tile.token
              && candidate.signature === activeWarmBuild.signature
            ))
          : context.pathPlan.tiles?.some((tile) => tile.token === activeWarmBuild.tile.token));
        const expected = expectedGraphSignature(
          track,
          activeWarmBuild.tile,
          activeWarmBuild.pathPlan
        );
        if (!tileStillRelevant || expected !== activeWarmBuild.signature) cancelActiveWarmBuild();
        else target = activeWarmBuild;
      }
      if (!target) {
        recordSlice();
        scheduleWarmup();
        return;
      }

      currentWarmupTarget = target;
      const canStartBuild = target.kind === 'variant'
        ? typeof records.get(target.tile.token)?.visual.createRecoveryVariantJob === 'function'
        : typeof visualFactory.createBuildJob === 'function';
      if (!activeWarmBuild && canStartBuild) {
        activeWarmBuild = measureStage(`begin-${target.kind}-build`, () => beginActiveWarmBuild(target));
        if (activeWarmBuild) {
          currentWarmupTarget = activeWarmBuild;
          if (pendingWarmBuildRetry && warmBuildTargetsMatch(pendingWarmBuildRetry, activeWarmBuild)) {
            clearWarmBuildRetry();
          }
        }
      }

      let record;
      if (activeWarmBuild) {
        let done = false;
        let stepsThisSlice = 0;
        do {
          const elapsedBeforeStep = Math.max(0, now() - sliceStartedAt);
          const deadlineRemaining = typeof idleDeadline?.timeRemaining === 'function' && !idleDeadline.didTimeout
            ? idleDeadline.timeRemaining()
            : 4;
          const remainingBudget = Math.max(
            0.25,
            Math.min(WARM_BUILD_CHILD_BUDGET_MS, deadlineRemaining, 4 - elapsedBeforeStep)
          );
          done = measureStage(`step-${activeWarmBuild.kind}-build`, () => (
            activeWarmBuild.builder.step(remainingBudget)
          ));
          stepsThisSlice++;
          // Opening geometry has dozens of tiny generator stages. Consume several only while the same strict
          // 4ms callback envelope has room; speculative warm work remains one-step-per-idle-callback.
        } while (
          !done
          && activeWarmBuild.buildSource === 'critical'
          && stepsThisSlice < CRITICAL_BUILD_MAX_STEPS_PER_SLICE
          && Math.max(0, now() - sliceStartedAt) < 4
        );
        const builderStepLabel = activeWarmBuild.builder.diagnostics?.lastStepLabel;
        if (builderStepLabel && callbackSlowestStageLabel === `step-${activeWarmBuild.kind}-build`) {
          callbackSlowestStageLabel += `:${builderStepLabel}`;
        }
        if (!done) {
          recordSlice();
          scheduleWarmup();
          return;
        }
        const completed = activeWarmBuild;
        currentWarmupTarget = completed;
        activeWarmBuild = null;
        const finished = measureStage(`finish-${completed.kind}-build`, () => completed.builder.finish());
        if (completed.kind === 'variant') {
          try {
            measureStage(
              'install-recovery-variant',
              () => completed.resident.visual.installRecoveryVariant(finished)
            );
            // A successful install, including a duplicate that disposed its incoming template, ends builder
            // ownership. Calling cancel() afterwards could release resident-owned buffers a second time.
            completed.resourceLease?.transfer();
          } catch (error) {
            // A visual may publish before a later palette/setup step throws. Detect that ownership transfer so the
            // outer error boundary reports the fault without cancel() double-disposing the now-resident template.
            if (completed.resident.visual.hasRecoveryVariant?.(completed.signature)) {
              completed.resourceLease?.transfer();
            }
            throw error;
          }
          preparedVariantBindings.set(
            preparedVariantBindingKey(completed.tile.token, completed.signature),
            Object.freeze({
              graph: completed.graph,
              scopedTrack: completed.scopedTrack
            })
          );
          const completedPreflight = opposingBypassPreflightForToken(completed.tile.token);
          if (
            completedPreflight
            && completedPreflight.opposingSignature === completed.signature
          ) {
            completeOpposingBypassPreflight(completedPreflight);
          }
        }
        // Finish and install are both part of this callback. Sampling after registration prevents the expensive
        // High-tier marking conversion from disappearing from warmSliceMaxMs on slower mobile devices.
        const sliceMs = Math.max(0, now() - sliceStartedAt);
        completed.cpuMs += sliceMs;
        warmSliceCount++;
        if (sliceMs > warmSliceMaxMs) {
          warmSliceMaxMs = sliceMs;
          warmSliceSlowestLabel = callbackSlowestStageLabel;
          warmSliceSlowestStageMs = callbackSlowestStageMs;
        }
        if (completed.kind === 'variant') {
          record = completed.resident;
          preparedRecoveryVariantCount++;
          const completedRouteTile = completed.pathPlan?.tiles?.find((tile) => (
            tile.token === completed.tile.token
          ));
          if (
            completed.purpose === 'opposing-bypass-prewarm'
            || completedRouteTile?.opposingBypass === true
          ) {
            opposingBypassVariantPreparedCount++;
          }
          warmBuildCount++;
          lastBuildMs = completed.cpuMs;
          maxBuildMs = Math.max(maxBuildMs, lastBuildMs);
        } else {
          record = measureStage(
            'register-tile-record',
            () => registerRecord(
              completed.tile,
              completed.graph,
              completed.scopedTrack,
              finished,
              completed.buildSource,
              completed.startedAt,
              completed.cpuMs,
              completed.resourceLease
            )
          );
          if (record.visual === finished) completed.resourceLease?.transfer();
        }
        target = completed;
      } else {
        currentWarmupTarget = target;
        if (target.kind === 'variant') {
          throw new Error('Cloverleaf visual does not support recovery-only variant preparation');
        }
        const graph = boundGraphForTile(target.tile, target.pathPlan, { includeRecovery: true });
        const scopedTrack = createScopedTrack(track, graph);
        const visual = visualFactory.create(visualOptions(graph, scopedTrack));
        const visualLease = createResourceLease(visual, (ownedVisual) => ownedVisual.dispose());
        try {
          record = registerRecord(
            target.tile,
            graph,
            scopedTrack,
            visual,
            'warm',
            sliceStartedAt,
            null,
            visualLease
          );
          if (record.visual === visual) visualLease.transfer();
        } catch (error) {
          visualLease.release();
          throw error;
        }
        recordSlice();
      }
      recordWarmBuildRecovery(target);
      if (pendingWarmBuildRetry && warmBuildTargetsMatch(pendingWarmBuildRetry, target)) clearWarmBuildRetry();
      record.tile = target.tile;
      record.lastUsed = updateSerial;
      if (!context.desiredTokens.has(target.tile.token)) {
        record.visual.update({ visible: false });
      }
      if (target.buildSource === 'critical') lastCriticalTileToken = target.tile.token;
      else lastWarmTileToken = target.tile.token;
      residentTokensScratch.clear();
      for (const token of context.desiredTokens) residentTokensScratch.add(token);
      // Variant install can clear its pending flag before this eviction pass. Protect every just-completed target
      // unconditionally for the rest of the callback so the pool never destroys work it atomically finished.
      residentTokensScratch.add(target.tile.token);
      evict(context.currentIndex, residentTokensScratch);
      scheduleWarmup();
    }

    function runWarmup(idleDeadline = null, callbackTicket = null) {
      // This identity gate must precede every diagnostic and scheduler mutation. Cancellation cannot recall a
      // browser callback already dequeued, and a later route may already own a different handle in the same slot.
      if (
        disposed
        || !latestWarmupContext
        || !callbackTicket
        || callbackTicket.generation !== warmupGeneration
        || warmupTicket !== callbackTicket
        || warmupHandle !== callbackTicket.handle
      ) return;
      warmupHandle = null;
      warmupTicket = null;
      warmupScheduleKind = null;
      currentWarmupStageLabel = 'warmup-entry';
      currentWarmupTarget = activeWarmBuild || pendingWarmBuildRetry;
      try {
        const entryCriticalTarget = latestWarmupContext
          ? resolveCriticalTile(latestWarmupContext) || resolveCriticalVariantTarget()
          : null;
        if (
          entryCriticalTarget
          && (!activeWarmBuild || !warmBuildTargetsMatch(activeWarmBuild, entryCriticalTarget))
        ) currentWarmupTarget = entryCriticalTarget;
        if (!currentWarmupTarget && latestWarmupContext) {
          const warmTile = resolveWarmTile(latestWarmupContext);
          if (warmTile) {
            currentWarmupTarget = {
              kind: 'tile',
              buildSource: 'warm',
              tile: warmTile,
              pathPlan: latestWarmupContext.pathPlan
            };
          }
        }
        return runWarmupUnsafe(idleDeadline);
      } catch (error) {
        return recoverWarmupFailure(error);
      } finally {
        currentWarmupTarget = null;
        currentWarmupStageLabel = null;
      }
    }

    function scheduleWarmup() {
      if (disposed || !latestWarmupContext) return;
      const lastTile = latestWarmupContext.pathPlan.tiles?.at(-1);
      const topologyReady = lastTile?.index >= latestWarmupContext.currentIndex + PREWARM_TILES_AHEAD;
      const criticalTarget = resolveCriticalTile(latestWarmupContext) || resolveCriticalVariantTarget();
      if (criticalTarget) criticalTarget.buildSource = 'critical';
      if (criticalTarget) {
        promoteActiveWarmBuild(criticalTarget);
        promotePendingWarmBuildRetry(criticalTarget);
      }
      const criticalWorkPending = Boolean(pendingOpposingBypassPreflightTokens.size || criticalTarget);
      if (criticalWorkPending && warmupHandle !== null && warmupScheduleKind === 'idle') {
        cancelIdle(warmupHandle);
        warmupHandle = null;
        warmupTicket = null;
        warmupScheduleKind = null;
      }
      if (warmupHandle !== null) return;
      if (pendingWarmBuildRetry && !warmBuildTargetIsLive(pendingWarmBuildRetry)) clearWarmBuildRetry();
      if (
        criticalTarget
        && pendingWarmBuildRetry
        && warmBuildTargetsMatch(criticalTarget, pendingWarmBuildRetry)
        && pendingWarmBuildRetry.readyAt > now()
      ) {
        scheduleWarmBuildRetryWake();
        return;
      }
      if (
        pendingWarmBuildRetry
        && pendingWarmBuildRetry.readyAt > now()
        && !criticalWorkPending
      ) {
        scheduleWarmBuildRetryWake();
        return;
      }
      const variantWorkPending = !variantPlanState?.complete
        || Boolean(resolveVariantTarget())
        || Boolean(activeWarmBuild)
        || Boolean(pendingWarmBuildRetry);
      if (
        topologyReady
        && !criticalWorkPending
        && !variantWorkPending
        && !resolveWarmTile(latestWarmupContext)
      ) return;
      const scheduleTicket = {
        generation: warmupGeneration,
        handle: SCHEDULING_HANDLE,
        kind: criticalWorkPending ? 'critical' : 'idle'
      };
      const callback = (idleDeadline) => runWarmup(idleDeadline, scheduleTicket);
      warmupTicket = scheduleTicket;
      warmupHandle = SCHEDULING_HANDLE;
      warmupScheduleKind = scheduleTicket.kind;
      let handle;
      try {
        if (criticalWorkPending) {
          handle = requestCritical(callback);
        } else {
          handle = requestIdle(callback, { timeout: 1_500 });
        }
      } catch (error) {
        if (warmupTicket === scheduleTicket) {
          warmupTicket = null;
          warmupHandle = null;
          warmupScheduleKind = null;
        }
        throw error;
      }
      if (warmupTicket === scheduleTicket && warmupHandle === SCHEDULING_HANDLE) {
        scheduleTicket.handle = handle;
        warmupHandle = handle;
      } else if (handle !== warmupHandle) {
        // A same-stack callback consumed this ticket and may already have scheduled its successor. The adapter's
        // returned handle belongs only to the spent request and must never overwrite or cancel an equal successor.
        if (scheduleTicket.kind === 'critical') cancelCritical(handle);
        else cancelIdle(handle);
      }
    }

    /**
     * Invalidate route-owned async work before cancellation. Browser queues may already have delivered a callback;
     * clearing context first makes every such late idle/critical/retry callback a resource-free no-op.
     */
    function invalidateWarmupWork() {
      warmupGeneration++;
      latestWarmupContext = null;
      currentWarmupTarget = null;
      currentWarmupStageLabel = null;
      if (warmupHandle !== null) {
        if (warmupScheduleKind === 'critical') cancelCritical(warmupHandle);
        else cancelIdle(warmupHandle);
      }
      warmupHandle = null;
      warmupTicket = null;
      warmupScheduleKind = null;
      clearWarmBuildRetry();
      cancelActiveWarmBuild();
      variantPlanState = null;
      requiredRouteVariants.clear();
      pendingOpposingBypassPreflightTokens.clear();
      opposingBypassPreflightsByDestination.clear();
    }

    function update({
      origin,
      visibilityOrigin,
      pathPlan,
      selectedPathPlan,
      routeCursor,
      proposal,
      navigation,
      time = 0,
      palette,
      pinnedTileTokens
    } = {}) {
      if (disposed) return activeTokens;
      updateSerial += 1;
      const tiles = Array.isArray(pathPlan?.tiles) ? pathPlan.tiles : [];
      if (!tiles.length) {
        invalidateWarmupWork();
        for (const record of records.values()) record.visual.update({ visible: false });
        activeTokens = Object.freeze([]);
        cameraRetainedPreviousTokens = Object.freeze([]);
        cameraPreviousDistanceM = null;
        pinnedVisibleTokens = Object.freeze([]);
        continuityHeldTokens = Object.freeze([]);
        activeMapGraphKey = '';
        activeMapGraph = null;
        mapGraphRouteFallbackActive = false;
        mapGraphRouteFallbackKey = '';
        mapGraphRouteFallbackGraph = null;
        ambientTrafficMarkers.length = 0;
        ambientTrafficMarkerKey = '';
        cameraBlockers.length = 0;
        cameraBlockerActiveTokens = null;
        lastVisibleEdgeCount = 0;
        latestDesiredTokens.clear();
        return activeTokens;
      }
      const cursorEdge = track.getEdge(routeCursor?.edgeId);
      const cursorTile = typeof track.getTileForEdge === 'function'
        ? track.getTileForEdge(routeCursor?.edgeId)
        : null;
      const currentIndex = cursorTile?.index ?? cursorEdge?.tileIndex ?? routeCursor?.tileIndex ?? tiles[0].index;
      const currentTile = tiles.find((tile) => tile.index === currentIndex) || tiles[0];
      const nextTile = tiles.find((tile) => tile.index === currentTile.index + 1);
      const previousTile = tiles.find((tile) => tile.index === currentTile.index - 1) || null;
      const resolvedVisibilityOrigin = Number.isFinite(visibilityOrigin?.x)
        && Number.isFinite(visibilityOrigin?.z)
        ? visibilityOrigin
        : origin;
      visibilityOriginX = Number(resolvedVisibilityOrigin?.x) || 0;
      visibilityOriginZ = Number(resolvedVisibilityOrigin?.z) || 0;
      // Once the crossover reaches the next ordinary approach, retain its source bridge for one tile stage.
      // Entering the following tile naturally drops this currentIndex - 1 opposing-bypass owner.
      const carryOverTile = tiles.find((tile) => (
        tile.index === currentTile.index - 1 && tile.opposingBypass === true
      )) || null;
      if (variantPlanState?.token !== currentTile.token) resetVariantPlanState(currentTile, pathPlan);
      queueRequiredRouteVariants();
      prioritizeProposedRecoveryVariant(currentTile, pathPlan, proposal);
      const nextRecord = getCurrentRecord(nextTile, pathPlan);
      // The camera retains the exact previously presented resident, not a freshly resolved route signature.
      // Rebuilding a road merely because it is behind the player would turn a visual anti-pop lease into authority.
      const previousRecord = previousTile ? records.get(previousTile.token) : null;
      const previousDistanceM = previousRecord
        ? distanceToBounds(resolvedVisibilityOrigin, previousRecord.graph.bounds)
        : Number.POSITIVE_INFINITY;
      const previousCameraVisible = previousDistanceM <= PREVIOUS_TILE_RELEASE_DISTANCE;
      cameraPreviousDistanceM = Number.isFinite(previousDistanceM) ? previousDistanceM : null;
      const initialUpdate = records.size === 0;
      const carryOverRecord = getCurrentRecord(carryOverTile, pathPlan);
      desiredTilesScratch.length = 0;
      desiredTokensScratch.clear();
      activeTokenOrderScratch.length = 0;
      pinnedVisibleTokensScratch.length = 0;
      continuityHeldTokensScratch.length = 0;
      cameraRetainedPreviousTokensScratch.length = 0;
      retainedVisibleTokensScratch.length = 0;
      // Reserve one resident slot while the staged builder owes current or physical preflight geometry. These are
      // authority records; an ordinary next tile must never displace a complete landing pin merely to build early.
      let missingPreflightResident = false;
      for (const token of pendingOpposingBypassPreflightTokens) {
        if (!records.has(token)) {
          missingPreflightResident = true;
          break;
        }
      }
      const authoritativeResidentMissing = stagedTileBuildsEnabled && (
        !records.has(currentTile.token)
        || missingPreflightResident
      );
      let presentationTileLimit = Math.max(
        1,
        maxTiles - (authoritativeResidentMissing ? 1 : 0)
      );
      const addDesiredTile = (tile) => {
        if (
          !tile?.token
          || desiredTokensScratch.has(tile.token)
          || desiredTokensScratch.size >= presentationTileLimit
        ) {
          return false;
        }
        desiredTilesScratch.push(tile);
        desiredTokensScratch.add(tile.token);
        activeTokenOrderScratch.push(tile.token);
        return true;
      };
      const retainVisibleRecord = (token, diagnosticsTarget) => {
        if (!token || diagnosticsTarget.includes(token)) return false;
        const record = records.get(token);
        if (!record) return false;
        if (!desiredTokensScratch.has(token)) {
          if (desiredTokensScratch.size >= presentationTileLimit) return false;
          desiredTokensScratch.add(token);
          activeTokenOrderScratch.push(token);
          retainedVisibleTokensScratch.push(token);
        }
        diagnosticsTarget.push(token);
        return true;
      };
      // Staged production builds publish only complete residents; test doubles without a build job retain the
      // legacy synchronous fallback so graph-only fixtures can stay intentionally lightweight.
      if (!stagedTileBuildsEnabled || records.has(currentTile.token)) addDesiredTile(currentTile);
      // A ballistic flight can advance the logical cursor before it has finished using the physical takeoff road.
      // Existing complete source residents therefore outrank future visuals and remain in the same bounded pool
      // until runtime releases the landing-authority pin after touchdown or a terminal crash.
      for (const token of Array.isArray(pinnedTileTokens) ? pinnedTileTokens : []) {
        retainVisibleRecord(token, pinnedVisibleTokensScratch);
      }
      // The pool also owns a lease independently of runtime pins. A destination can become previous while airborne;
      // keeping its complete resident active is required both for the next render receipt and for safe variant install.
      for (const token of pendingOpposingBypassPreflightTokens) {
        retainVisibleRecord(token, pinnedVisibleTokensScratch);
      }
      // Once current and every available authority pin have claimed their slots, reserve any remaining capacity
      // for a missing ordinary next resident. Continuity, carry-over art, and camera tails yield before authority.
      if (
        stagedTileBuildsEnabled
        && nextTile
        && !records.has(nextTile.token)
        && desiredTokensScratch.size < presentationTileLimit
      ) {
        presentationTileLimit = Math.max(
          desiredTokensScratch.size,
          presentationTileLimit - 1
        );
      }
      // Startup intentionally has no last-good scene. During play, however, an unfinished current resident must
      // not clear the complete presentation that was visible one frame earlier; outbound tails cover this short
      // bounded build window, and the authoritative map graph can advance independently through its fallback.
      if (stagedTileBuildsEnabled && !records.has(currentTile.token)) {
        for (const token of activeTokens) {
          retainVisibleRecord(token, continuityHeldTokensScratch);
        }
      }
      if (carryOverRecord) addDesiredTile(carryOverTile);
      // Presentation residency is camera-owned while gameplay and transforms remain player-origin-owned. Retaining
      // the ordinary previous resident to 2.8km covers rear/high/world-locked Film shots without extending any
      // collision, route, or minimap authority. Current and physical landing leases have already taken priority.
      if (previousCameraVisible && previousRecord) {
        retainVisibleRecord(previousTile.token, cameraRetainedPreviousTokensScratch);
      }
      // The initial next tile may load with the opening scene. Later route revisions stay hidden until idle rebuild completes.
      if (nextTile && (nextRecord || (!stagedTileBuildsEnabled && initialUpdate))) {
        addDesiredTile(nextTile);
      }
      const warmTile = tiles.find((tile) => tile.index === currentTile.index + PREWARM_TILES_AHEAD);
      const warmRecord = getCurrentRecord(warmTile, pathPlan);
      const warmDistanceM = warmRecord
        ? distanceToBounds(resolvedVisibilityOrigin, warmRecord.graph.bounds)
        : Number.POSITIVE_INFINITY;
      const warmCameraVisible = warmRecord && (
        warmDistanceM <= PREWARM_REVEAL_DISTANCE
        || (
          activeTokens.includes(warmRecord.token)
          && warmDistanceM <= PREWARM_RELEASE_DISTANCE
        )
      );
      if (
        !carryOverTile
        && warmCameraVisible
      ) {
        addDesiredTile(warmTile);
      }

      for (const tile of desiredTilesScratch) {
        const record = ensureRecord(tile, pathPlan);
        record.tile = tile;
        record.lastUsed = updateSerial;
        if (palette) record.visual.setPalette(palette);
        // Geometry registration needs the complete itinerary, while selection may expose only physically committed edges.
        record.visual.update({
          origin,
          pathPlan: selectedPathPlan || pathPlan,
          proposal,
          navigation,
          time,
          visible: true
        });
      }
      for (const token of retainedVisibleTokensScratch) {
        if (desiredTilesScratch.some((tile) => tile.token === token)) continue;
        const record = records.get(token);
        if (!record) continue;
        record.lastUsed = updateSerial;
        if (palette) record.visual.setPalette(palette);
        record.visual.update({
          origin,
          pathPlan: selectedPathPlan || pathPlan,
          proposal,
          navigation,
          time,
          visible: true
        });
      }
      for (const record of records.values()) {
        if (!desiredTokensScratch.has(record.token)) record.visual.update({ visible: false });
      }
      residentTokensScratch.clear();
      for (const token of desiredTokensScratch) residentTokensScratch.add(token);
      if (warmRecord && (
        residentTokensScratch.has(warmRecord.token)
        || residentTokensScratch.size < maxTiles
      )) {
        residentTokensScratch.add(warmRecord.token);
      }
      evict(currentTile.index, residentTokensScratch);
      const nextActiveTokenKey = activeTokenOrderScratch.join('|');
      if (nextActiveTokenKey !== activeTokens.join('|')) {
        activeTokens = Object.freeze([...activeTokenOrderScratch]);
        activeMapGraphKey = '';
        activeMapGraph = null;
        mapGraphRouteFallbackActive = false;
        mapGraphRouteFallbackKey = '';
        mapGraphRouteFallbackGraph = null;
      }
      // Count only the final published resident graphs after pin priority, capacity eviction, and atomic handoff.
      // maxTiles bounds this to three Map reads and integer additions, with no per-frame collection allocation.
      lastVisibleEdgeCount = 0;
      for (const token of activeTokens) lastVisibleEdgeCount += records.get(token).graph.edges.length;
      const nextPinnedVisibleTokenKey = pinnedVisibleTokensScratch.join('|');
      if (nextPinnedVisibleTokenKey !== pinnedVisibleTokens.join('|')) {
        pinnedVisibleTokens = Object.freeze([...pinnedVisibleTokensScratch]);
      }
      const nextContinuityHeldTokenKey = continuityHeldTokensScratch.join('|');
      if (nextContinuityHeldTokenKey !== continuityHeldTokens.join('|')) {
        continuityHeldTokens = Object.freeze([...continuityHeldTokensScratch]);
      }
      const nextCameraRetainedPreviousKey = cameraRetainedPreviousTokensScratch.join('|');
      if (nextCameraRetainedPreviousKey !== cameraRetainedPreviousTokens.join('|')) {
        cameraRetainedPreviousTokens = Object.freeze([...cameraRetainedPreviousTokensScratch]);
      }
      const nextMarkerKey = activeTokens.join('|');
      if (nextMarkerKey !== ambientTrafficMarkerKey) {
        ambientTrafficMarkerKey = '';
        cameraBlockerActiveTokens = null;
      }
      Object.assign(latestRouteCursor, routeCursor);
      latestDesiredTokens.clear();
      for (const token of desiredTokensScratch) latestDesiredTokens.add(token);
      latestWarmupContext ||= {};
      latestWarmupContext.pathPlan = pathPlan;
      latestWarmupContext.routeCursor = latestRouteCursor;
      latestWarmupContext.currentIndex = currentTile.index;
      latestWarmupContext.currentTile = currentTile;
      latestWarmupContext.nextTile = nextTile || null;
      latestWarmupContext.desiredTokens = latestDesiredTokens;
      pruneOpposingBypassPreflights();
      queueRelevantOpposingBypassVariants(latestWarmupContext);
      promotePendingOpposingBypassPreflights();
      queueRequiredRouteVariants();
      scheduleWarmup();
      return activeTokens;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      invalidateWarmupWork();
      for (const record of records.values()) record.visual.dispose();
      records.clear();
      preparedVariantBindings.clear();
      pendingOpposingBypassPreflightTokens.clear();
      opposingBypassPreflightsByDestination.clear();
      presentedSignatureByToken.clear();
      presentedTiles = Object.freeze([]);
      presentedSerial = 0;
      activeTokens = Object.freeze([]);
      cameraRetainedPreviousTokens = Object.freeze([]);
      cameraPreviousDistanceM = null;
      pinnedVisibleTokens = Object.freeze([]);
      continuityHeldTokens = Object.freeze([]);
      activeMapGraphKey = '';
      activeMapGraph = null;
      mapGraphRouteFallbackActive = false;
      mapGraphRouteFallbackKey = '';
      mapGraphRouteFallbackGraph = null;
      ambientTrafficMarkers.length = 0;
      ambientTrafficMarkerKey = '';
      cameraBlockers.length = 0;
      cameraBlockerActiveTokens = null;
      activeTunnelEmitterVisuals = [];
      activeTunnelLightEmitters = Object.freeze([]);
      activeCoveredRouteEmitterVisuals = [];
      activeCoveredRouteLightEmitters = Object.freeze([]);
    }

    /** Propagate one presentation tier to resident and future tile visuals without rebuilding route geometry. */
    function setRenderQuality(id) {
      activeRenderQualityId = id === 'high' ? 'high' : id === 'low' ? 'low' : 'medium';
      for (const record of records.values()) record.visual.setRenderQuality?.(activeRenderQualityId);
      return true;
    }

    /** O(1) identity-publication clock; geometry-only variants and reused residents do not replace textures. */
    function getTextureRevision() {
      return presentationTextureRevision;
    }

    /** Return stable marker objects; their numeric route fields are updated in place by each active visual. */
    function getAmbientTrafficMarkers() {
      const key = activeTokens.join('|');
      if (ambientTrafficMarkerKey === key) return ambientTrafficMarkers;
      ambientTrafficMarkers.length = 0;
      for (const token of activeTokens) {
        const visual = records.get(token)?.visual;
        const markers = visual?.getAmbientTrafficMarkers?.() || visual?.ambientTrafficMarkers || [];
        for (const marker of markers) ambientTrafficMarkers.push(marker);
      }
      ambientTrafficMarkerKey = key;
      return ambientTrafficMarkers;
    }

    /** Aggregate retained blocker records for the active Film-visible tiles without exposing resident meshes. */
    function getCameraBlockers() {
      if (cameraBlockerActiveTokens === activeTokens) return cameraBlockers;
      cameraBlockers.length = 0;
      for (const token of activeTokens) {
        const visual = records.get(token)?.visual;
        const blockers = visual?.getCameraBlockers?.() || visual?.cameraBlockers || [];
        for (const blocker of blockers) cameraBlockers.push(blocker);
      }
      cameraBlockerActiveTokens = activeTokens;
      return cameraBlockers;
    }

    /**
     * Aggregate immutable emitters from the current visible resident records. Visual identity is the cache key,
     * so a same-token atomic replacement cannot leave the central light pool bound to a disposed tile visual.
     */
    function getActiveTunnelLightEmitters() {
      const visuals = activeTokens
        .map((token) => records.get(token)?.visual)
        .filter(Boolean);
      const unchanged = visuals.length === activeTunnelEmitterVisuals.length
        && visuals.every((visual, index) => visual === activeTunnelEmitterVisuals[index]);
      if (unchanged) return activeTunnelLightEmitters;
      const emitters = [];
      for (const visual of visuals) {
        const visualEmitters = visual.getTunnelLightEmitters?.() || visual.tunnelLightEmitters || [];
        for (const emitter of visualEmitters) emitters.push(emitter);
      }
      activeTunnelEmitterVisuals = visuals;
      activeTunnelLightEmitters = Object.freeze(emitters);
      return activeTunnelLightEmitters;
    }

    /** Aggregate only authored bridge/tunnel fixtures; the central light rig may reject records outside their reach. */
    function getActiveCoveredRouteLightEmitters() {
      const visuals = activeTokens
        .map((token) => records.get(token)?.visual)
        .filter(Boolean);
      const unchanged = visuals.length === activeCoveredRouteEmitterVisuals.length
        && visuals.every((visual, index) => visual === activeCoveredRouteEmitterVisuals[index]);
      if (unchanged) return activeCoveredRouteLightEmitters;
      const emitters = [];
      for (const visual of visuals) {
        const visualEmitters = visual.getCoveredRouteLightEmitters?.()
          || visual.getTunnelLightEmitters?.()
          || visual.coveredRouteLightEmitters
          || visual.tunnelLightEmitters
          || [];
        for (const emitter of visualEmitters) emitters.push(emitter);
      }
      activeCoveredRouteEmitterVisuals = visuals;
      activeCoveredRouteLightEmitters = Object.freeze(emitters);
      return activeCoveredRouteLightEmitters;
    }

    /**
     * Read diffuse tunnel bounce from the visible resident owning this exact sampled route frame. Existing
     * edge/tile maps and the bounded active-token list are the only lookup authority: no graph extension,
     * emitter selection, texture publication, or per-frame cache allocation is permitted on this render path.
     */
    function sampleTunnelBounce(frame, out) {
      out.valid = false;
      out.enclosure = out.irradiance = out.red = out.green = out.blue = 0;
      if (disposed || frame?.covered !== true || typeof frame.edgeId !== 'string'
        || !Number.isFinite(frame.edgeS) || typeof frame.tunnelProfileId !== 'string'
        || (frame.tunnelKind !== 'underground-tunnel' && frame.tunnelKind !== 'mountain-tunnel')) return out;
      const registeredEdge = track.getEdge(frame.edgeId);
      let record = registeredEdge?.tileToken ? records.get(registeredEdge.tileToken) : null;
      // Initial tile-zero template edges predate tileToken. Its exact unprefixed edge ID can belong to only one
      // of the at-most-three active residents; later runtime tiles retain the direct edge-to-token Map lookup.
      if (registeredEdge && !registeredEdge.tileToken) {
        for (const token of activeTokens) {
          const candidate = records.get(token);
          if (candidate?.graph.edgesById[frame.edgeId]) {
            record = candidate;
            break;
          }
        }
      }
      if (!record || record.routeAuthoritative === false || !activeTokens.includes(record.token)
        || record.visual.group?.visible !== true || typeof record.visual.sampleTunnelBounce !== 'function') return out;
      const residentEdge = record.graph.edgesById[frame.edgeId];
      if (!residentEdge || !Array.isArray(residentEdge.tunnelProfiles)) return out;
      if (frame.tileToken !== undefined && frame.tileToken !== record.token) return out;
      if (Number.isInteger(frame.tileIndex) && frame.tileIndex !== record.tile.index) return out;
      let exactProfile = false;
      for (const profile of residentEdge.tunnelProfiles) {
        if (profile.id === frame.tunnelProfileId && profile.kind === frame.tunnelKind) {
          exactProfile = true;
          break;
        }
      }
      if (!exactProfile) return out;
      return record.visual.sampleTunnelBounce(frame.edgeId, frame.edgeS, out, frame.tunnelProfileId);
    }

    function getDiagnostics() {
      const visualTotals = [...records.values()].reduce((totals, record) => {
        const visual = record.visual.diagnostics || {};
        const active = activeTokens.includes(record.token);
        totals.edgeCount += visual.edgeCount || 0;
        totals.expectedSupportCount += visual.expectedSupportCount || 0;
        totals.supportCount += visual.supportCount || 0;
        totals.crossingSupportCount += visual.crossingSupportCount || 0;
        totals.elevatedRoadEdgeCount += visual.elevatedRoadEdgeCount || 0;
        totals.elevatedRoadSupportCount += visual.elevatedRoadSupportCount || 0;
        totals.runtimeElevatedRoadSupportCount += visual.runtimeElevatedRoadSupportCount || 0;
        totals.elevatedSupportCandidateCount += visual.elevatedSupportCandidateCount || 0;
        totals.elevatedSupportBlockedCandidateCount += visual.elevatedSupportBlockedCandidateCount || 0;
        totals.elevatedSupportUnsupportedEdgeCount += visual.elevatedSupportUnsupportedEdgeCount || 0;
        for (const edgeId of visual.elevatedSupportUnsupportedEdgeIds || []) {
          totals.elevatedSupportUnsupportedEdgeIds.push(edgeId);
        }
        for (const edgeId of visual.elevatedSupportBlockedByEdgeIds || []) {
          totals.elevatedSupportBlockedByEdgeIds.push(edgeId);
        }
        if ((visual.elevatedSupportMaximumGap || 0) > totals.elevatedSupportMaximumGap) {
          totals.elevatedSupportMaximumGap = visual.elevatedSupportMaximumGap;
          totals.elevatedSupportMaximumGapEdgeId = visual.elevatedSupportMaximumGapEdgeId || null;
          totals.elevatedSupportMaximumGapStations = visual.elevatedSupportMaximumGapStations || [];
          totals.elevatedSupportMaximumGapCoverage = visual.elevatedSupportMaximumGapCoverage || null;
          totals.elevatedSupportMaximumGapSource = visual.elevatedSupportMaximumGapSource || null;
          totals.elevatedSupportMaximumGapStartS = visual.elevatedSupportMaximumGapStartS ?? null;
          totals.elevatedSupportMaximumGapEndS = visual.elevatedSupportMaximumGapEndS ?? null;
          totals.elevatedSupportMaximumGapTileToken = record.token;
        }
        totals.elevatedSupportSpacing = Math.max(
          totals.elevatedSupportSpacing,
          visual.elevatedSupportSpacing || 0
        );
        totals.elevatedSupportMaximumAllowedGap = Math.max(
          totals.elevatedSupportMaximumAllowedGap,
          visual.elevatedSupportMaximumAllowedGap || 0
        );
        totals.elevatedSupportGapViolationCount += visual.elevatedSupportGapViolationCount || 0;
        for (const violation of visual.elevatedSupportGapViolations || []) {
          totals.elevatedSupportGapViolations.push(Object.freeze({
            tileToken: record.token,
            ...violation
          }));
        }
        if (Number.isFinite(visual.elevatedSupportMinimumPierHeight)) {
          totals.elevatedSupportMinimumPierHeight = Math.min(
            totals.elevatedSupportMinimumPierHeight,
            visual.elevatedSupportMinimumPierHeight
          );
        }
        totals.supportFootingCount += visual.supportFootingCount || 0;
        totals.supportCapAndFootingCount += visual.supportCapAndFootingCount || 0;
        totals.supportGroundContactError = Math.max(
          totals.supportGroundContactError,
          visual.supportGroundContactError || 0
        );
        if (Number.isFinite(visual.supportGroundY)) totals.supportGroundY = visual.supportGroundY;
        totals.supportPlacementFailureCount += visual.supportPlacementFailureCount || 0;
        totals.supportRoadOverlapCount += visual.supportRoadOverlapCount || 0;
        if (Number.isFinite(visual.supportMinimumRoadGap)) {
          totals.supportMinimumRoadGap = Math.min(totals.supportMinimumRoadGap, visual.supportMinimumRoadGap);
        }
        if (Number.isFinite(visual.supportMinimumSurfaceGap)) {
          totals.supportMinimumSurfaceGap = Math.min(
            totals.supportMinimumSurfaceGap,
            visual.supportMinimumSurfaceGap
          );
        }
        totals.bridgeDeckThicknessError = Math.max(
          totals.bridgeDeckThicknessError,
          visual.bridgeDeckThicknessError || 0
        );
        totals.roadShellWidthError = Math.max(totals.roadShellWidthError, visual.roadShellWidthError || 0);
        totals.dynamicRoadWidthSamples += visual.dynamicRoadWidthSamples || 0;
        totals.junctionBiasSamples += visual.junctionBiasSamples || 0;
        totals.junctionApronCandidateCount += visual.junctionApronCandidateCount || 0;
        totals.junctionApronCount += visual.junctionApronCount || 0;
        totals.junctionApronCoverageMissCount += visual.junctionApronCoverageMissCount || 0;
        totals.junctionApronTopologyFailureCount += visual.junctionApronTopologyFailureCount || 0;
        totals.junctionApronMaximumSpanM = Math.max(
          totals.junctionApronMaximumSpanM,
          visual.junctionApronMaximumSpanM || 0
        );
        totals.junctionApronSurfaceLiftM = Math.max(
          totals.junctionApronSurfaceLiftM,
          visual.junctionApronSurfaceLiftM || 0
        );
        totals.beamCount += visual.beamCount || 0;
        totals.underpassLightCount += visual.underpassLightCount || 0;
        totals.tunnelProfileCount += visual.tunnelProfileCount || 0;
        totals.mountainTunnelCount += visual.mountainTunnelCount || 0;
        totals.undergroundTunnelCount += visual.undergroundTunnelCount || 0;
        totals.tunnelRibCount += visual.tunnelRibCount || 0;
        totals.tunnelRoofPanelCount += visual.tunnelRoofPanelCount || 0;
        totals.tunnelPortalCount += visual.tunnelPortalCount || 0;
        totals.tunnelLightCount += visual.tunnelLightCount || 0;
        totals.tunnelLightEmitterCount += visual.tunnelLightEmitterCount || 0;
        totals.tunnelLightEmitterMismatchCount += visual.tunnelLightEmitterMismatchCount || 0;
        if (active) {
          totals.activeTunnelLightFixtureCount += visual.tunnelLightCount || 0;
          totals.activeTunnelLightEmitterDeclaredCount += visual.tunnelLightEmitterCount || 0;
        }
        totals.mountainOpeningCount += visual.mountainOpeningCount || 0;
        totals.undergroundWallPanelCount += visual.undergroundWallPanelCount || 0;
        totals.tunnelSafeCorridorViolationCount += visual.tunnelSafeCorridorViolationCount || 0;
        totals.decorativeLaneBundleCount += visual.decorativeLaneBundleCount || 0;
        totals.decorativeLanePathCount += visual.decorativeLanePathCount || 0;
        totals.laneGateTargetMaxError = Math.max(totals.laneGateTargetMaxError, visual.laneGateTargetMaxError || 0);
        totals.laneSafeHalfViolationCount += visual.laneSafeHalfViolationCount || 0;
        totals.structuralDetailCount += visual.structuralDetailCount || 0;
        totals.longitudinalGirderCount += visual.longitudinalGirderCount || 0;
        totals.expansionJointCount += visual.expansionJointCount || 0;
        totals.decisionPylonCount += visual.decisionPylonCount || 0;
        totals.railPostCount += visual.railPostCount || 0;
        totals.solidSafeCorridorViolationCount += visual.solidSafeCorridorViolationCount || 0;
        totals.maximumAddedSoffitDepth = Math.max(
          totals.maximumAddedSoffitDepth,
          visual.maximumAddedSoffitDepth || 0
        );
        totals.decorativeGeometryCount += visual.decorativeGeometryCount || 0;
        totals.decorativeDrawGroupCount += visual.decorativeDrawGroupCount || 0;
        totals.decorativeMapEdgeCount += visual.decorativeMapEdgeCount || 0;
        totals.signCount += visual.signCount || 0;
        totals.goreCount += visual.goreCount || 0;
        // Capacity and draw-group budgets are per tile; resident warm tiles must not inflate those contracts.
        totals.ambientTrafficCapacity = Math.max(
          totals.ambientTrafficCapacity,
          visual.ambientTrafficCapacity || visual.decorativeTrafficCount || 0
        );
        const trafficPrimitive = visual.ambientTrafficRenderPrimitive || 'missing';
        totals.ambientTrafficRenderPrimitive ||= trafficPrimitive;
        if (trafficPrimitive !== 'triangles') totals.ambientTrafficPrimitiveViolationCount++;
        // Shape complexity and dimensions are lower-bound contracts: one malformed resident tile must fail the pool.
        totals.ambientTrafficGeometryVertexCount = Math.min(
          totals.ambientTrafficGeometryVertexCount,
          visual.ambientTrafficGeometryVertexCount || 0
        );
        totals.ambientTrafficGeometryTriangleCount = Math.min(
          totals.ambientTrafficGeometryTriangleCount,
          visual.ambientTrafficGeometryTriangleCount || 0
        );
        totals.ambientTrafficGeometryComponentCount = Math.min(
          totals.ambientTrafficGeometryComponentCount,
          visual.ambientTrafficGeometryComponentCount || 0
        );
        totals.ambientTrafficGeometryFeatureCount = Math.min(
          totals.ambientTrafficGeometryFeatureCount,
          visual.ambientTrafficGeometryFeatureCount || 0
        );
        totals.ambientTrafficGeometryWingPairCount = Math.min(
          totals.ambientTrafficGeometryWingPairCount,
          visual.ambientTrafficGeometryWingPairCount || 0
        );
        totals.ambientTrafficGeometryCanopyCount = Math.min(
          totals.ambientTrafficGeometryCanopyCount,
          visual.ambientTrafficGeometryCanopyCount || 0
        );
        totals.ambientTrafficGeometryEngineCount = Math.min(
          totals.ambientTrafficGeometryEngineCount,
          visual.ambientTrafficGeometryEngineCount || 0
        );
        totals.ambientTrafficGeometryTailFinCount = Math.min(
          totals.ambientTrafficGeometryTailFinCount,
          visual.ambientTrafficGeometryTailFinCount || 0
        );
        totals.ambientTrafficGeometryWidthM = Math.min(
          totals.ambientTrafficGeometryWidthM,
          visual.ambientTrafficGeometryWidthM || 0
        );
        totals.ambientTrafficGeometryHeightM = Math.min(
          totals.ambientTrafficGeometryHeightM,
          visual.ambientTrafficGeometryHeightM || 0
        );
        totals.ambientTrafficGeometryLengthM = Math.min(
          totals.ambientTrafficGeometryLengthM,
          visual.ambientTrafficGeometryLengthM || 0
        );
        totals.ambientTrafficGeometryBoundaryEdges = Math.max(
          totals.ambientTrafficGeometryBoundaryEdges,
          visual.ambientTrafficGeometryBoundaryEdges || 0
        );
        totals.ambientTrafficGeometryNonManifoldEdges = Math.max(
          totals.ambientTrafficGeometryNonManifoldEdges,
          visual.ambientTrafficGeometryNonManifoldEdges || 0
        );
        totals.ambientTrafficGeometryDegenerateTriangles = Math.max(
          totals.ambientTrafficGeometryDegenerateTriangles,
          visual.ambientTrafficGeometryDegenerateTriangles || 0
        );
        totals.ambientTrafficGeometryZeroAreaTriangles = Math.max(
          totals.ambientTrafficGeometryZeroAreaTriangles,
          visual.ambientTrafficGeometryZeroAreaTriangles || 0
        );
        totals.ambientTrafficGeometryClosed = totals.ambientTrafficGeometryClosed
          && visual.ambientTrafficGeometryClosed === true;
        if (Number.isFinite(visual.ambientTrafficMinimumFullShapeWidthM)) {
          totals.ambientTrafficMinimumFullShapeWidthM = Math.min(
            totals.ambientTrafficMinimumFullShapeWidthM,
            visual.ambientTrafficMinimumFullShapeWidthM
          );
        }
        if (Number.isFinite(visual.ambientTrafficMinimumFullShapeHeightM)) {
          totals.ambientTrafficMinimumFullShapeHeightM = Math.min(
            totals.ambientTrafficMinimumFullShapeHeightM,
            visual.ambientTrafficMinimumFullShapeHeightM
          );
        }
        if (Number.isFinite(visual.ambientTrafficMinimumFullShapeLengthM)) {
          totals.ambientTrafficMinimumFullShapeLengthM = Math.min(
            totals.ambientTrafficMinimumFullShapeLengthM,
            visual.ambientTrafficMinimumFullShapeLengthM
          );
        }
        if (active) {
          totals.ambientTrafficSubmittedCount += visual.ambientTrafficSubmittedCount || 0;
          totals.ambientTrafficVisibleCount += visual.ambientTrafficVisibleCount || 0;
          totals.ambientTrafficMarkerVisibleCount += visual.ambientTrafficMarkerVisibleCount || 0;
          totals.ambientTrafficFullShapeVisibleCount += visual.ambientTrafficFullShapeVisibleCount || 0;
          totals.ambientTrafficSmallShapeViolationCount += visual.ambientTrafficSmallShapeViolationCount || 0;
          if ((visual.ambientTrafficMarkerVisibleCount || 0) > 0) {
            totals.ambientTrafficMinimumVisibleScaleRatio = Math.min(
              totals.ambientTrafficMinimumVisibleScaleRatio,
              Number.isFinite(visual.ambientTrafficMinimumVisibleScaleRatio)
                ? visual.ambientTrafficMinimumVisibleScaleRatio
                : 0
            );
            totals.ambientTrafficMinimumRenderedWidthM = Math.min(
              totals.ambientTrafficMinimumRenderedWidthM,
              Number.isFinite(visual.ambientTrafficMinimumRenderedWidthM)
                ? visual.ambientTrafficMinimumRenderedWidthM
                : 0
            );
            totals.ambientTrafficMinimumRenderedHeightM = Math.min(
              totals.ambientTrafficMinimumRenderedHeightM,
              Number.isFinite(visual.ambientTrafficMinimumRenderedHeightM)
                ? visual.ambientTrafficMinimumRenderedHeightM
                : 0
            );
            totals.ambientTrafficMinimumRenderedLengthM = Math.min(
              totals.ambientTrafficMinimumRenderedLengthM,
              Number.isFinite(visual.ambientTrafficMinimumRenderedLengthM)
                ? visual.ambientTrafficMinimumRenderedLengthM
                : 0
            );
          }
          if (Number.isFinite(visual.ambientTrafficMinimumForwardDot)) {
            totals.ambientTrafficMinimumForwardDot = Math.min(
              totals.ambientTrafficMinimumForwardDot,
              visual.ambientTrafficMinimumForwardDot
            );
          }
        }
        if (active) {
          totals.roadArrowCount += visual.roadArrowCount || 0;
          if ((visual.roadArrowCount || 0) > 0 && Number.isFinite(visual.roadArrowMinimumForwardDot)) {
            totals.roadArrowMinimumForwardDot = Math.min(
              totals.roadArrowMinimumForwardDot,
              visual.roadArrowMinimumForwardDot
            );
          }
          totals.roadArrowDirectionViolationCount += visual.roadArrowDirectionViolationCount || 0;
          totals.exitSignVisibleCount += visual.exitSignVisibleCount || 0;
        }
        if (active) totals.guidanceScopeViolationCount += visual.guidanceScopeViolationCount || 0;
        totals.playerPossibleEdgeCount = Math.max(totals.playerPossibleEdgeCount, visual.playerPossibleEdgeCount || 0);
        totals.safeTrafficEdgeCount = Math.max(totals.safeTrafficEdgeCount, visual.safeTrafficEdgeCount || 0);
        totals.trafficRouteIntersectionCount = Math.max(
          totals.trafficRouteIntersectionCount,
          visual.trafficRouteIntersectionCount || 0
        );
        totals.ambientTrafficUnsafeEdgeViolationCount = Math.max(
          totals.ambientTrafficUnsafeEdgeViolationCount,
          visual.ambientTrafficUnsafeEdgeViolationCount || 0
        );
        totals.ambientTrafficRecoveryEdgeViolationCount = Math.max(
          totals.ambientTrafficRecoveryEdgeViolationCount,
          visual.ambientTrafficRecoveryEdgeViolationCount || 0
        );
        totals.ambientTrafficLaunchEdgeViolationCount = Math.max(
          totals.ambientTrafficLaunchEdgeViolationCount,
          visual.ambientTrafficLaunchEdgeViolationCount || 0
        );
        totals.junctionRaisedBarrierIntrusionCount += visual.junctionRaisedBarrierIntrusionCount || 0;
        totals.bridgeSpanOverlapCount += visual.bridgeSpanOverlapCount || 0;
        totals.duplicateRailStationCount += visual.duplicateRailStationCount || 0;
        totals.girderChordError = Math.max(totals.girderChordError, visual.girderChordError || 0);
        totals.bearingAnchorError = Math.max(totals.bearingAnchorError, visual.bearingAnchorError || 0);
        totals.expansionJointSurfaceError = Math.max(
          totals.expansionJointSurfaceError,
          visual.expansionJointSurfaceError || 0
        );
        totals.recoveryTopologyFailureCount += visual.recoveryTopologyFailureCount || 0;
        totals.bidirectionalVariantCoverageMisses += visual.bidirectionalVariantCoverageMisses || 0;
        totals.bidirectionalGameplayViolationCount += visual.bidirectionalGameplayViolationCount || 0;
        totals.bidirectionalPathPlanViolationCount += record.graph.bidirectionalPathPlanViolationCount || 0;
        totals.bidirectionalSeamViolationCount += record.graph.bidirectionalSeamAudit?.violationCount || 0;
        totals.bidirectionalMaximumCenterGapM = Math.max(
          totals.bidirectionalMaximumCenterGapM,
          record.graph.bidirectionalSeamAudit?.maximumCenterGapM || 0
        );
        totals.bidirectionalMaximumBoundaryGapM = Math.max(
          totals.bidirectionalMaximumBoundaryGapM,
          record.graph.bidirectionalSeamAudit?.maximumBoundaryGapM || 0
        );
        totals.bidirectionalMaximumTangentGapDegrees = Math.max(
          totals.bidirectionalMaximumTangentGapDegrees,
          record.graph.bidirectionalSeamAudit?.maximumTangentGapDegrees || 0
        );
        totals.bidirectionalMaximumGradeGapDegrees = Math.max(
          totals.bidirectionalMaximumGradeGapDegrees,
          record.graph.bidirectionalSeamAudit?.maximumGradeGapDegrees || 0
        );
        if (Number.isFinite(record.graph.bidirectionalSeamAudit?.hiddenTailPortalDistanceM)) {
          totals.bidirectionalMinimumHiddenTailPortalDistanceM = Math.min(
            totals.bidirectionalMinimumHiddenTailPortalDistanceM,
            record.graph.bidirectionalSeamAudit.hiddenTailPortalDistanceM
          );
        }
        if (active) {
          totals.bidirectionalActiveTileCount++;
          totals.bidirectionalActivePortPairCount += visual.bidirectionalActivePortPairCount || 0;
          totals.bidirectionalActivePairCoverageMisses += visual.bidirectionalActivePairCoverageMisses || 0;
          totals.bidirectionalActiveConnectorCount += visual.bidirectionalActiveConnectorCount || 0;
          totals.bidirectionalActiveConnectorCountErrors += visual.bidirectionalActiveConnectorCountErrors || 0;
          totals.bidirectionalVisualEdgeCount += visual.bidirectionalVisualEdgeCount || 0;
          // Visible draw groups are a per-active-tile maximum, never a resident-pool sum.
          totals.drawGroupCount = Math.max(totals.drawGroupCount, visual.drawGroupCount || 0);
        }
        totals.reservedDrawGroupCount = Math.max(
          totals.reservedDrawGroupCount,
          visual.reservedDrawGroupCount || 0
        );
        totals.baseTemplateBuildCount = Math.max(
          totals.baseTemplateBuildCount,
          visual.baseTemplateBuildCount || 0
        );
        totals.baseTemplateCacheHitCount += visual.baseTemplateCacheHit ? 1 : 0;
        totals.baseTemplateRefCount = Math.max(
          totals.baseTemplateRefCount,
          visual.baseTemplateRefCount || 0
        );
        return totals;
      }, {
        edgeCount: 0,
        expectedSupportCount: 0,
        supportCount: 0,
        crossingSupportCount: 0,
        elevatedRoadEdgeCount: 0,
        elevatedRoadSupportCount: 0,
        runtimeElevatedRoadSupportCount: 0,
        elevatedSupportCandidateCount: 0,
        elevatedSupportBlockedCandidateCount: 0,
        elevatedSupportUnsupportedEdgeCount: 0,
        elevatedSupportUnsupportedEdgeIds: [],
        elevatedSupportBlockedByEdgeIds: [],
        elevatedSupportSpacing: 0,
        elevatedSupportMaximumGap: 0,
        elevatedSupportMaximumGapEdgeId: null,
        elevatedSupportMaximumGapStations: [],
        elevatedSupportMaximumGapCoverage: null,
        elevatedSupportMaximumGapSource: null,
        elevatedSupportMaximumGapStartS: null,
        elevatedSupportMaximumGapEndS: null,
        elevatedSupportMaximumGapTileToken: null,
        elevatedSupportMaximumAllowedGap: 0,
        elevatedSupportGapViolationCount: 0,
        elevatedSupportGapViolations: [],
        elevatedSupportMinimumPierHeight: Number.POSITIVE_INFINITY,
        supportFootingCount: 0,
        supportCapAndFootingCount: 0,
        supportGroundContactError: 0,
        supportGroundY: null,
        supportPlacementFailureCount: 0,
        supportRoadOverlapCount: 0,
        supportMinimumRoadGap: Number.POSITIVE_INFINITY,
        supportMinimumSurfaceGap: Number.POSITIVE_INFINITY,
        bridgeDeckThicknessError: 0,
        roadShellWidthError: 0,
        dynamicRoadWidthSamples: 0,
        junctionBiasSamples: 0,
        junctionApronCandidateCount: 0,
        junctionApronCount: 0,
        junctionApronCoverageMissCount: 0,
        junctionApronTopologyFailureCount: 0,
        junctionApronMaximumSpanM: 0,
        junctionApronSurfaceLiftM: 0,
        beamCount: 0,
        underpassLightCount: 0,
        tunnelProfileCount: 0,
        mountainTunnelCount: 0,
        undergroundTunnelCount: 0,
        tunnelRibCount: 0,
        tunnelRoofPanelCount: 0,
        tunnelPortalCount: 0,
        tunnelLightCount: 0,
        tunnelLightEmitterCount: 0,
        tunnelLightEmitterMismatchCount: 0,
        activeTunnelLightFixtureCount: 0,
        activeTunnelLightEmitterDeclaredCount: 0,
        mountainOpeningCount: 0,
        undergroundWallPanelCount: 0,
        tunnelSafeCorridorViolationCount: 0,
        decorativeLaneBundleCount: 0,
        decorativeLanePathCount: 0,
        laneGateTargetMaxError: 0,
        laneSafeHalfViolationCount: 0,
        structuralDetailCount: 0,
        longitudinalGirderCount: 0,
        expansionJointCount: 0,
        decisionPylonCount: 0,
        railPostCount: 0,
        solidSafeCorridorViolationCount: 0,
        maximumAddedSoffitDepth: 0,
        decorativeGeometryCount: 0,
        decorativeDrawGroupCount: 0,
        decorativeMapEdgeCount: 0,
        signCount: 0,
        goreCount: 0,
        ambientTrafficCapacity: 0,
        ambientTrafficSubmittedCount: 0,
        ambientTrafficVisibleCount: 0,
        ambientTrafficMarkerVisibleCount: 0,
        ambientTrafficFullShapeVisibleCount: 0,
        ambientTrafficSmallShapeViolationCount: 0,
        ambientTrafficMinimumVisibleScaleRatio: Number.POSITIVE_INFINITY,
        ambientTrafficMinimumRenderedWidthM: Number.POSITIVE_INFINITY,
        ambientTrafficMinimumRenderedHeightM: Number.POSITIVE_INFINITY,
        ambientTrafficMinimumRenderedLengthM: Number.POSITIVE_INFINITY,
        ambientTrafficMinimumForwardDot: 1,
        ambientTrafficRenderPrimitive: null,
        ambientTrafficPrimitiveViolationCount: 0,
        ambientTrafficGeometryVertexCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryTriangleCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryComponentCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryFeatureCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryWingPairCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryCanopyCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryEngineCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryTailFinCount: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryWidthM: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryHeightM: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryLengthM: Number.POSITIVE_INFINITY,
        ambientTrafficGeometryBoundaryEdges: 0,
        ambientTrafficGeometryNonManifoldEdges: 0,
        ambientTrafficGeometryDegenerateTriangles: 0,
        ambientTrafficGeometryZeroAreaTriangles: 0,
        ambientTrafficGeometryClosed: true,
        ambientTrafficMinimumFullShapeWidthM: Number.POSITIVE_INFINITY,
        ambientTrafficMinimumFullShapeHeightM: Number.POSITIVE_INFINITY,
        ambientTrafficMinimumFullShapeLengthM: Number.POSITIVE_INFINITY,
        roadArrowCount: 0,
        roadArrowMinimumForwardDot: 1,
        roadArrowDirectionViolationCount: 0,
        exitSignVisibleCount: 0,
        guidanceScopeViolationCount: 0,
        playerPossibleEdgeCount: 0,
        safeTrafficEdgeCount: 0,
        trafficRouteIntersectionCount: 0,
        ambientTrafficUnsafeEdgeViolationCount: 0,
        ambientTrafficRecoveryEdgeViolationCount: 0,
        ambientTrafficLaunchEdgeViolationCount: 0,
        junctionRaisedBarrierIntrusionCount: 0,
        bridgeSpanOverlapCount: 0,
        duplicateRailStationCount: 0,
        girderChordError: 0,
        bearingAnchorError: 0,
        expansionJointSurfaceError: 0,
        recoveryTopologyFailureCount: 0,
        bidirectionalActiveTileCount: 0,
        bidirectionalActivePortPairCount: 0,
        bidirectionalActivePairCoverageMisses: 0,
        bidirectionalActiveConnectorCount: 0,
        bidirectionalActiveConnectorCountErrors: 0,
        bidirectionalVisualEdgeCount: 0,
        bidirectionalVariantCoverageMisses: 0,
        bidirectionalGameplayViolationCount: 0,
        bidirectionalPathPlanViolationCount: 0,
        bidirectionalSeamViolationCount: 0,
        bidirectionalMaximumCenterGapM: 0,
        bidirectionalMaximumBoundaryGapM: 0,
        bidirectionalMaximumTangentGapDegrees: 0,
        bidirectionalMaximumGradeGapDegrees: 0,
        bidirectionalMinimumHiddenTailPortalDistanceM: Number.POSITIVE_INFINITY,
        drawGroupCount: 0,
        reservedDrawGroupCount: 0,
        baseTemplateBuildCount: 0,
        baseTemplateCacheHitCount: 0,
        baseTemplateRefCount: 0
      });
      const residentRecords = [...records.values()];
      const activeRecords = activeTokens
        .map((token) => records.get(token))
        .filter(Boolean);
      const staleRecords = residentRecords.filter((record) => record.routeAuthoritative === false);
      const staleActiveRecords = activeRecords.filter((record) => record.routeAuthoritative === false);
      const activeAuthoritativeTokens = Object.freeze(activeRecords
        .filter((record) => record.routeAuthoritative !== false)
        .map((record) => record.token));
      const activeTileDiagnostics = Object.freeze(activeRecords.map((record) => Object.freeze({
        token: record.token,
        index: record.tile.index,
        routeAuthoritative: record.routeAuthoritative !== false,
        stale: record.routeAuthoritative === false,
        expectedSignature: record.expectedSignature,
        standardTile: structuralDiagnosticsForVisual(record.visual.diagnostics, true),
        residentVisual: structuralDiagnosticsForVisual(record.visual.diagnostics, false)
      })));
      const residentStandardDiagnostics = residentRecords.map((record) => (
        structuralDiagnosticsForVisual(record.visual.diagnostics, true)
      ));
      const residentVisualDiagnostics = residentRecords.map((record) => (
        structuralDiagnosticsForVisual(record.visual.diagnostics, false)
      ));
      const activeVisualDiagnostics = activeRecords.map((record) => (
        structuralDiagnosticsForVisual(record.visual.diagnostics, false)
      ));
      const currentActiveRecord = activeRecords[0] || residentRecords[0] || null;
      const currentStandardTileDiagnostics = currentActiveRecord
        ? structuralDiagnosticsForVisual(currentActiveRecord.visual.diagnostics, true)
        : structuralDiagnosticsForVisual({});
      const activeStructuralAggregate = aggregateStructuralDiagnostics(activeVisualDiagnostics);
      const residentStructuralAggregate = aggregateStructuralDiagnostics(residentVisualDiagnostics);
      const perTileStructuralInvariant = summarizeStructuralInvariants(residentStandardDiagnostics);
      const activeEmitterCount = getActiveTunnelLightEmitters().length;
      const activeCoveredRouteEmitterCount = getActiveCoveredRouteLightEmitters().length;
      const initialCurrentReady = Boolean(
        latestWarmupContext?.currentTile
        && getCurrentRecord(latestWarmupContext.currentTile, latestWarmupContext.pathPlan)
      );
      const initialNextReady = Boolean(
        !latestWarmupContext?.nextTile
        || getCurrentRecord(latestWarmupContext.nextTile, latestWarmupContext.pathPlan)
      );
      const currentResidentRecord = records.get(latestWarmupContext?.currentTile?.token);
      const roadPresentationDegradationReason = !latestWarmupContext?.currentTile || initialCurrentReady
        ? null
        : currentResidentRecord
          ? 'current-road-resident-stale'
          : 'current-road-resident-missing';
      const currentExpectedSignature = latestWarmupContext?.currentTile
        ? expectedGraphSignature(
            track,
            latestWarmupContext.currentTile,
            latestWarmupContext.pathPlan
          )
        : null;
      const targetRestoresCurrentRoad = (target) => Boolean(
        target?.tile?.token === latestWarmupContext?.currentTile?.token
        && warmBuildTargetSignature(target) === currentExpectedSignature
      );
      const liveOpposingBypassPreflights = Object.freeze(
        [...opposingBypassPreflightsByDestination.values()]
          .filter(opposingBypassPreflightIsLive)
          .map((preflight) => opposingBypassPreflightHandshake(preflight))
      );
      return Object.freeze({
        renderQualityId: activeRenderQualityId,
        poolSize: records.size,
        maxTiles,
        activeTokens,
        visibilityOriginMode: 'camera-absolute-world-xz-with-player-fallback',
        visibilityOriginX,
        visibilityOriginZ,
        prewarmRevealDistanceM: PREWARM_REVEAL_DISTANCE,
        prewarmReleaseDistanceM: PREWARM_RELEASE_DISTANCE,
        previousTileReleaseDistanceM: PREVIOUS_TILE_RELEASE_DISTANCE,
        defaultMapVisibilityDistanceM: DEFAULT_MAP_VISIBILITY_DISTANCE,
        cameraPreviousDistanceM,
        cameraRetainedPreviousTokens,
        presentedSerial,
        presentedTiles,
        pinnedVisibleTokens,
        continuityHeldTokens,
        activeAuthoritativeTokens,
        staleVisualCount: staleRecords.length,
        staleActiveVisualCount: staleActiveRecords.length,
        prewarmedTokens: Object.freeze([...records.values()]
          .filter((record) => record.buildSource === 'warm')
          .map((record) => record.token)),
        stagedTileBuildsEnabled,
        initialCurrentReady,
        initialNextReady,
        initialRouteReady: initialCurrentReady && initialNextReady,
        foregroundBuildCount,
        criticalBuildCount,
        warmBuildCount,
        lastBuildMs,
        maxBuildMs,
        lastCriticalTileToken,
        lastWarmTileToken,
        invalidationCount,
        lastInvalidation,
        warmupScheduled: warmupHandle !== null || warmBuildRetryHandle !== null,
        warmupScheduleKind: warmupHandle !== null
          ? warmupScheduleKind
          : warmBuildRetryHandle !== null ? 'retry-backoff' : null,
        warmBuildPending: activeWarmBuild !== null,
        warmBuildPendingTarget: activeWarmBuild ? Object.freeze({
          tileToken: activeWarmBuild.tile.token,
          kind: activeWarmBuild.kind,
          signature: activeWarmBuild.signature,
          buildSource: activeWarmBuild.buildSource,
          purpose: activeWarmBuild.purpose,
          retryAttempt: activeWarmBuild.retryAttempt
        }) : null,
        warmBuildPriorityPromotionCount,
        lastWarmBuildPriorityPromotion,
        warmBuildFailureCount,
        warmBuildRetryCount,
        warmBuildRecoveryCount,
        warmBuildRetryExhaustedCount,
        warmBuildRetryPending: pendingWarmBuildRetry !== null,
        warmBuildRetryTarget: pendingWarmBuildRetry ? Object.freeze({
          tileToken: pendingWarmBuildRetry.tile.token,
          kind: pendingWarmBuildRetry.kind,
          signature: pendingWarmBuildRetry.signature,
          buildSource: pendingWarmBuildRetry.buildSource,
          purpose: pendingWarmBuildRetry.purpose,
          retryAttempt: pendingWarmBuildRetry.retryAttempt,
          retryDelayMs: pendingWarmBuildRetry.retryDelayMs
        }) : null,
        lastWarmBuildFailure,
        roadPresentationDegraded: roadPresentationDegradationReason !== null,
        roadPresentationDegradationReason,
        currentRoadBuildProtected: initialCurrentReady
          || targetRestoresCurrentRoad(activeWarmBuild)
          || targetRestoresCurrentRoad(pendingWarmBuildRetry)
          || (warmupHandle !== null && warmupScheduleKind === 'critical'),
        warmSliceCount,
        warmSliceMaxMs,
        warmSliceSlowestLabel,
        warmSliceSlowestStageMs,
        warmBuildCancellationCount,
        warmRegistrationReuseCount,
        atomicRecoverySwitchCount,
        deferredRecoverySwitchCount,
        preparedRecoveryVariantCount,
        opposingBypassVariantQueuedCount,
        opposingBypassVariantPreparedCount,
        opposingBypassPreflightRequestCount,
        opposingBypassPreflightPromotionCount,
        opposingBypassPreflightPreparedCount,
        opposingBypassPreflightPendingCount: pendingOpposingBypassPreflightTokens.size,
        opposingBypassPreflightRetainedCount: opposingBypassPreflightsByDestination.size,
        opposingBypassPreflightLiveCount: liveOpposingBypassPreflights.length,
        opposingBypassPreflights: liveOpposingBypassPreflights,
        opposingBypassVariantPendingCount: variantPlanState?.targets.filter((target) => (
          target.purpose === 'opposing-bypass-prewarm' && variantTargetIsPending(target)
        )).length || 0,
        opposingBypassAtomicSwitchCount,
        routeVariantCriticalPromotionCount,
        routeVariantReadinessActivationCount,
        routeVariantRequirementCount: requiredRouteVariants.size,
        routeVariantRequirements: Object.freeze([...requiredRouteVariants.values()].map((requirement) => (
          Object.freeze({
            tileToken: requirement.tile.token,
            signature: requirement.signature,
            status: records.get(requirement.tile.token)?.visual.hasRecoveryVariant?.(requirement.signature)
              ? 'prepared'
              : activeWarmBuild?.tile.token === requirement.tile.token
                && activeWarmBuild?.signature === requirement.signature
                ? 'building'
                : 'queued'
          })
        ))),
        prioritizedRecoveryVariantCount,
        prioritizedRecoveryPreemptionCount,
        mapGraphRouteFallbackCount,
        mapGraphRouteFallbackActive,
        preparedRecoveryVariantResidentCount: Math.max(
          0,
          (records.get(variantPlanState?.token)?.visual.diagnostics?.preparedRecoveryVariantCount || 1) - 1
        ),
        visibleEdgeCount: lastVisibleEdgeCount,
        ...visualTotals,
        residentTunnelLightEmitterCount: visualTotals.tunnelLightEmitterCount,
        activeTunnelLightEmitterCount: activeEmitterCount,
        activeCoveredRouteLightEmitterCount: activeCoveredRouteEmitterCount,
        activeTunnelLightEmitterMismatchCount: Math.abs(
          visualTotals.activeTunnelLightFixtureCount - activeEmitterCount
        ),
        // Legacy flat fields represent the current active standard interchange, never a resident-pool sum.
        ...currentStandardTileDiagnostics,
        diagnosticSemantics: Object.freeze({
          flatStructuralFields: 'current-active-standard-tile',
          activeTileDiagnostics: 'per-active-tile',
          activeStructuralAggregate: 'active-visual-sum',
          residentStructuralAggregate: 'resident-pool-sum',
          perTileStructuralInvariant: 'resident-standard-tile-min-max',
          activeAuthoritativeTokens: 'active-non-stale-route-visuals'
        }),
        currentActiveTileToken: currentActiveRecord?.token || null,
        activeTileDiagnostics,
        activeStructuralAggregate,
        residentStructuralAggregate,
        perTileStructuralInvariant,
        bidirectionalMinimumHiddenTailPortalDistanceM: Number.isFinite(
          visualTotals.bidirectionalMinimumHiddenTailPortalDistanceM
        ) ? visualTotals.bidirectionalMinimumHiddenTailPortalDistanceM : null,
        ambientTrafficMinimumVisibleScaleRatio: Number.isFinite(visualTotals.ambientTrafficMinimumVisibleScaleRatio)
          ? visualTotals.ambientTrafficMinimumVisibleScaleRatio
          : 0,
        ambientTrafficMinimumRenderedWidthM: Number.isFinite(visualTotals.ambientTrafficMinimumRenderedWidthM)
          ? visualTotals.ambientTrafficMinimumRenderedWidthM
          : 0,
        ambientTrafficMinimumRenderedHeightM: Number.isFinite(visualTotals.ambientTrafficMinimumRenderedHeightM)
          ? visualTotals.ambientTrafficMinimumRenderedHeightM
          : 0,
        ambientTrafficMinimumRenderedLengthM: Number.isFinite(visualTotals.ambientTrafficMinimumRenderedLengthM)
          ? visualTotals.ambientTrafficMinimumRenderedLengthM
          : 0,
        ambientTrafficGeometryVertexCount: Number.isFinite(visualTotals.ambientTrafficGeometryVertexCount)
          ? visualTotals.ambientTrafficGeometryVertexCount
          : 0,
        ambientTrafficGeometryTriangleCount: Number.isFinite(visualTotals.ambientTrafficGeometryTriangleCount)
          ? visualTotals.ambientTrafficGeometryTriangleCount
          : 0,
        ambientTrafficGeometryComponentCount: Number.isFinite(visualTotals.ambientTrafficGeometryComponentCount)
          ? visualTotals.ambientTrafficGeometryComponentCount
          : 0,
        ambientTrafficGeometryFeatureCount: Number.isFinite(visualTotals.ambientTrafficGeometryFeatureCount)
          ? visualTotals.ambientTrafficGeometryFeatureCount
          : 0,
        ambientTrafficGeometryWingPairCount: Number.isFinite(visualTotals.ambientTrafficGeometryWingPairCount)
          ? visualTotals.ambientTrafficGeometryWingPairCount
          : 0,
        ambientTrafficGeometryCanopyCount: Number.isFinite(visualTotals.ambientTrafficGeometryCanopyCount)
          ? visualTotals.ambientTrafficGeometryCanopyCount
          : 0,
        ambientTrafficGeometryEngineCount: Number.isFinite(visualTotals.ambientTrafficGeometryEngineCount)
          ? visualTotals.ambientTrafficGeometryEngineCount
          : 0,
        ambientTrafficGeometryTailFinCount: Number.isFinite(visualTotals.ambientTrafficGeometryTailFinCount)
          ? visualTotals.ambientTrafficGeometryTailFinCount
          : 0,
        ambientTrafficGeometryWidthM: Number.isFinite(visualTotals.ambientTrafficGeometryWidthM)
          ? visualTotals.ambientTrafficGeometryWidthM
          : 0,
        ambientTrafficGeometryHeightM: Number.isFinite(visualTotals.ambientTrafficGeometryHeightM)
          ? visualTotals.ambientTrafficGeometryHeightM
          : 0,
        ambientTrafficGeometryLengthM: Number.isFinite(visualTotals.ambientTrafficGeometryLengthM)
          ? visualTotals.ambientTrafficGeometryLengthM
          : 0,
        ambientTrafficMinimumFullShapeWidthM: Number.isFinite(visualTotals.ambientTrafficMinimumFullShapeWidthM)
          ? visualTotals.ambientTrafficMinimumFullShapeWidthM
          : 0,
        ambientTrafficMinimumFullShapeHeightM: Number.isFinite(visualTotals.ambientTrafficMinimumFullShapeHeightM)
          ? visualTotals.ambientTrafficMinimumFullShapeHeightM
          : 0,
        ambientTrafficMinimumFullShapeLengthM: Number.isFinite(visualTotals.ambientTrafficMinimumFullShapeLengthM)
          ? visualTotals.ambientTrafficMinimumFullShapeLengthM
          : 0,
        supportMinimumRoadGap: Number.isFinite(visualTotals.supportMinimumRoadGap)
          ? visualTotals.supportMinimumRoadGap
          : null,
        supportMinimumSurfaceGap: Number.isFinite(visualTotals.supportMinimumSurfaceGap)
          ? visualTotals.supportMinimumSurfaceGap
          : null,
        tiles: Object.freeze([...records.values()].map((record) => Object.freeze({
          token: record.token,
          index: record.tile.index,
          active: activeTokens.includes(record.token),
          signature: record.signature,
          expectedSignature: record.expectedSignature,
          routeAuthoritative: record.routeAuthoritative !== false,
          stale: record.routeAuthoritative === false,
          staleReason: record.staleReason,
          edgeCount: record.graph.edges.length,
          recoveryEdgeCount: record.graph.recoveryEdgeIds.length,
          bidirectionalVisualEdgeCount: record.graph.bidirectionalVisualEdgeIds.length,
          bidirectionalPathPlanViolationCount: record.graph.bidirectionalPathPlanViolationCount,
          bidirectionalSeamViolationCount: record.graph.bidirectionalSeamAudit.violationCount,
          bidirectionalHiddenTailPortalDistanceM: Number.isFinite(
            record.graph.bidirectionalSeamAudit.hiddenTailPortalDistanceM
          ) ? record.graph.bidirectionalSeamAudit.hiddenTailPortalDistanceM : null,
          standardTileDiagnostics: structuralDiagnosticsForVisual(record.visual.diagnostics, true),
          residentVisualDiagnostics: structuralDiagnosticsForVisual(record.visual.diagnostics, false),
          lastUsed: record.lastUsed
        })))
      });
    }

    return Object.freeze({
      update,
      setRenderQuality,
      getTextureRevision,
      dispose,
      graphForTile: boundGraphForTile,
      getActiveMapGraph,
      getAmbientTrafficMarkers,
      getCameraBlockers,
      getActiveCoveredRouteLightEmitters,
      getActiveTunnelLightEmitters,
      sampleTunnelBounce,
      markPresented,
      requestOpposingRouteVariantPreflight,
      ensureRouteVariantReadiness,
      isInitialRouteReady,
      getDiagnostics
    });
  }

  return Object.freeze({ create, graphForTile });
})();
