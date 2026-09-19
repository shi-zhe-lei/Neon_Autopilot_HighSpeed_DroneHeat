/* Deterministic fork, interchange, and ramp contract. This module owns track topology only and never consumes gameplay RNG. */
window.NeonTrack = (() => {
  'use strict';

  const ROUTE_TRUNK = 'trunk';
  const ROUTE_LEFT = 'left';
  const ROUTE_RIGHT = 'right';
  const EVENT_INTERCHANGE = 'stacked-interchange';
  const EVENT_LAUNCH_FORK = 'launch-fork';
  const FIRST_FORK_S = 180;
  // An 800m interchange needs a recovery straight before the next decision; the alternating launch fork remains compact.
  const FORK_CYCLE = 1_100;
  const FORK_DURATION = 800;
  const LAUNCH_FORK_DURATION = 324;
  const LAUNCH_SPLIT_LENGTH = 72;
  const LAUNCH_MERGE_START_OFFSET = 244;
  const INTERCHANGE_SPLIT_LENGTH = 150;
  const INTERCHANGE_MERGE_START_OFFSET = 650;
  const DECISION_LEAD = 150;
  const LAUNCH_BRANCH_SEPARATION = 12.4;
  const INTERCHANGE_BRANCH_SEPARATION = 30;
  // World/scenery exclusion uses the largest route offset, while each event retains its own physical separation.
  const MAX_ROUTE_OFFSET = INTERCHANGE_BRANCH_SEPARATION;
  const BRANCH_SEPARATION = MAX_ROUTE_OFFSET;
  const INTERCHANGE_HEIGHT = 9.0;
  const INTERCHANGE_RISE_START_OFFSET = 0;
  const INTERCHANGE_RISE_END_OFFSET = 280;
  const INTERCHANGE_FALL_START_OFFSET = 520;
  const INTERCHANGE_FALL_END_OFFSET = 800;
  const INTERCHANGE_CROSS_START_OFFSET = 280;
  const INTERCHANGE_CROSS_END_OFFSET = 520;
  const INTERCHANGE_CROSS_OFFSET = 400;
  // The rendered road is 8.4m half-wide; this envelope adds edge trim and a conservative bridge underside.
  const INTERCHANGE_DECK_HALF_WIDTH = 9.0;
  const INTERCHANGE_DECK_THICKNESS = 1.05;
  // Route metadata uses the attainable road envelope: mainline permits the dry terminal neighborhood while tighter
  // collectors and ramps publish progressively lower advisory limits. Runtime curvature remains the final authority.
  const ROAD_SPEED_LIMITS_MPS = Object.freeze({
    mainline: 45,
    collector: 36,
    directRamp: 32,
    loopRamp: 25
  });
  const RAMP_HEIGHT = 3.6;
  const RAMP_ASCENT = 28;
  const RAMP_DESCENT = 58;
  const RAMP_OFFSETS = Object.freeze({
    [ROUTE_LEFT]: 104,
    [ROUTE_RIGHT]: 139
  });
  const eventCache = new Map();
  const interchangeDeckScratch = { height: 0, grade: 0 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /** FNV-1a keeps platform variety stable per immutable tile token without consuming gameplay RNG. */
  function stableTokenHash(value) {
    const text = String(value ?? '');
    let hash = 0x81_1c_9d_c5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01_00_01_93);
    }
    return hash >>> 0;
  }

  /** Quintic easing keeps route position, heading, grade, and lateral acceleration continuous at topology boundaries. */
  function smootherStep01(value) {
    const t = clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function smootherStepDerivative01(value) {
    const t = clamp(value, 0, 1);
    return 30 * t * t * (t - 1) * (t - 1);
  }

  function smootherStepSecondDerivative01(value) {
    const t = clamp(value, 0, 1);
    return 60 * t * (t - 1) * (2 * t - 1);
  }

  function createRamp(event, routeId) {
    const startS = event.startS + RAMP_OFFSETS[routeId];
    return Object.freeze({
      id: `${event.id}:${routeId}:ramp`,
      eventId: event.id,
      routeId,
      startS,
      lipS: startS + RAMP_ASCENT,
      endS: startS + RAMP_ASCENT + RAMP_DESCENT,
      height: RAMP_HEIGHT,
      ascent: RAMP_ASCENT,
      descent: RAMP_DESCENT,
      launchable: true
    });
  }

  function createInterchangeEvent(event) {
    const interchangeOrdinal = Math.floor(event.index / 2);
    event.upperRouteId = interchangeOrdinal % 2 === 0 ? ROUTE_LEFT : ROUTE_RIGHT;
    event.lowerRouteId = event.upperRouteId === ROUTE_LEFT ? ROUTE_RIGHT : ROUTE_LEFT;
    event.entryTurnS = event.startS + INTERCHANGE_SPLIT_LENGTH * 0.5;
    event.turnInEndS = event.splitEndS;
    event.connectorEntryS = event.startS + INTERCHANGE_CROSS_START_OFFSET;
    event.crossStartS = event.startS + INTERCHANGE_CROSS_START_OFFSET;
    event.crossEndS = event.startS + INTERCHANGE_CROSS_END_OFFSET;
    event.crossS = event.startS + INTERCHANGE_CROSS_OFFSET;
    event.connectorExitS = event.crossEndS;
    event.newRouteStartS = event.crossEndS;
    event.newRouteEndS = event.mergeStartS;
    event.turnOutStartS = event.mergeStartS;
    event.returnTurnS = (event.mergeStartS + event.endS) * 0.5;
    event.riseStartS = event.startS + INTERCHANGE_RISE_START_OFFSET;
    event.riseEndS = event.startS + INTERCHANGE_RISE_END_OFFSET;
    event.fallStartS = event.startS + INTERCHANGE_FALL_START_OFFSET;
    event.fallEndS = event.startS + INTERCHANGE_FALL_END_OFFSET;
    event.deckHeight = INTERCHANGE_HEIGHT;
    event.routeLabels = Object.freeze({
      [ROUTE_LEFT]: '左向连接线',
      [ROUTE_RIGHT]: '右向连接线'
    });
    event.turnStations = Object.freeze([
      Object.freeze({ kind: 'entry-turn', label: '入', s: event.entryTurnS }),
      Object.freeze({ kind: 'collector', label: '集', s: (event.turnInEndS + event.connectorEntryS) * 0.5 }),
      Object.freeze({ kind: 'transfer-turn', label: '转', s: event.crossS }),
      Object.freeze({ kind: 'new-route', label: '新', s: (event.newRouteStartS + event.newRouteEndS) * 0.5 }),
      Object.freeze({ kind: 'return-turn', label: '汇', s: event.returnTurnS })
    ]);
    event.pierStationsS = Object.freeze([event.crossS - 38, event.crossS + 38]);
    event.leftRamp = null;
    event.rightRamp = null;
    return event;
  }

  /** Returns a cached immutable event; even events are realistic grade-separated crossings and odd events preserve launch gameplay. */
  function getForkEvent(index) {
    if (!Number.isInteger(index) || index < 0) return null;
    if (eventCache.has(index)) return eventCache.get(index);
    const startS = FIRST_FORK_S + index * FORK_CYCLE;
    const isInterchange = index % 2 === 0;
    const event = {
      id: `fork-${index}`,
      index,
      type: isInterchange ? EVENT_INTERCHANGE : EVENT_LAUNCH_FORK,
      decisionS: startS - DECISION_LEAD,
      commitS: startS,
      startS,
      splitEndS: startS + (isInterchange ? INTERCHANGE_SPLIT_LENGTH : LAUNCH_SPLIT_LENGTH),
      mergeStartS: startS + (isInterchange ? INTERCHANGE_MERGE_START_OFFSET : LAUNCH_MERGE_START_OFFSET),
      endS: startS + (isInterchange ? FORK_DURATION : LAUNCH_FORK_DURATION),
      separation: isInterchange ? INTERCHANGE_BRANCH_SEPARATION : LAUNCH_BRANCH_SEPARATION
    };
    if (isInterchange) {
      createInterchangeEvent(event);
    } else {
      event.upperRouteId = null;
      event.lowerRouteId = null;
      event.entryTurnS = null;
      event.turnInEndS = null;
      event.connectorEntryS = null;
      event.connectorExitS = null;
      event.newRouteStartS = null;
      event.newRouteEndS = null;
      event.turnOutStartS = null;
      event.returnTurnS = null;
      event.routeLabels = null;
      event.turnStations = Object.freeze([]);
      event.leftRamp = createRamp(event, ROUTE_LEFT);
      event.rightRamp = createRamp(event, ROUTE_RIGHT);
    }
    Object.freeze(event);
    eventCache.set(index, event);
    return event;
  }

  function eventIndexNear(s) {
    return Math.floor((s - FIRST_FORK_S) / FORK_CYCLE);
  }

  /** Returns the fork whose physical split/merge envelope contains s. */
  function getForkEventAt(s) {
    const index = eventIndexNear(s);
    const event = getForkEvent(index);
    return event && s >= event.startS && s <= event.endS ? event : null;
  }

  /** Returns the current or next decision event, including its pre-split decision window. */
  function getDecisionEventAt(s, lookAhead = 0) {
    const earliestIndex = Math.max(0, eventIndexNear(s) - 1);
    for (let index = earliestIndex; index <= earliestIndex + 2; index++) {
      const event = getForkEvent(index);
      if (event.endS < s) continue;
      if (event.decisionS <= s + Math.max(0, lookAhead)) return event;
    }
    return null;
  }

  /** Fork openness is C2-continuous and exactly zero on the shared trunk endpoints. */
  function getBranchOpen(event, s) {
    if (!event || s <= event.startS || s >= event.endS) return 0;
    if (s < event.splitEndS) return smootherStep01((s - event.startS) / (event.splitEndS - event.startS));
    if (s <= event.mergeStartS) return 1;
    return smootherStep01((event.endS - s) / (event.endS - event.mergeStartS));
  }

  function routeSign(routeId) {
    return routeId === ROUTE_LEFT ? -1 : routeId === ROUTE_RIGHT ? 1 : 0;
  }

  /** Interchange branches exchange sides with a C2 horizontal braid while their route ids remain stable. */
  function interchangeCrossFactor(event, s) {
    if (!event || event.type !== EVENT_INTERCHANGE || s <= event.crossStartS) return 1;
    if (s >= event.crossEndS) return -1;
    return 1 - 2 * smootherStep01((s - event.crossStartS) / (event.crossEndS - event.crossStartS));
  }

  /** Lateral offset from the original road centerline for a selected branch. */
  function getRouteOffset(s, routeId) {
    const event = getForkEventAt(s);
    if (!event) return 0;
    const crossFactor = event.type === EVENT_INTERCHANGE ? interchangeCrossFactor(event, s) : 1;
    return routeSign(routeId) * event.separation * getBranchOpen(event, s) * crossFactor;
  }

  /** Expose the current directional-connector stage to navigation, autopilot, diagnostics, and the minimap. */
  function getInterchangePhase(event, s) {
    if (!event || event.type !== EVENT_INTERCHANGE || s < event.startS || s > event.endS) return null;
    if (s < event.turnInEndS) return 'entry-turn';
    if (s < event.connectorEntryS) return 'collector';
    if (s <= event.connectorExitS) return 'transfer-turn';
    if (s <= event.newRouteEndS) return 'new-route';
    return 'return-turn';
  }

  function getRouteLabel(event, routeId) {
    return event?.routeLabels?.[routeId] || (routeId === ROUTE_LEFT ? '左支' : routeId === ROUTE_RIGHT ? '右支' : '主干');
  }

  function getRamp(event, routeId) {
    if (!event || event.type !== EVENT_LAUNCH_FORK) return null;
    if (routeId === ROUTE_LEFT) return event.leftRamp;
    if (routeId === ROUTE_RIGHT) return event.rightRamp;
    return null;
  }

  function sampleInterchangeDeck(event, s, out) {
    out.height = 0;
    out.grade = 0;
    if (s < event.riseStartS || s > event.fallEndS) return out;
    if (s < event.riseEndS) {
      const span = event.riseEndS - event.riseStartS;
      const t = (s - event.riseStartS) / span;
      out.height = event.deckHeight * smootherStep01(t);
      out.grade = event.deckHeight * smootherStepDerivative01(t) / span;
      return out;
    }
    if (s <= event.fallStartS) {
      out.height = event.deckHeight;
      return out;
    }
    const span = event.fallEndS - event.fallStartS;
    const t = (s - event.fallStartS) / span;
    out.height = event.deckHeight * (1 - smootherStep01(t));
    out.grade = -event.deckHeight * smootherStepDerivative01(t) / span;
    return out;
  }

  /** Samples a supported interchange deck or a launch ramp, including the lower-route ceiling contract. */
  function sampleSurface(s, routeId, out = {}) {
    const event = getForkEventAt(s);
    const ramp = getRamp(event, routeId);
    out.height = 0;
    out.grade = 0;
    out.rampId = null;
    out.ramp = null;
    out.phase = 'flat';
    out.structure = null;
    out.tunnelKind = null;
    out.tunnelProfileId = null;
    out.covered = false;
    out.launchable = false;
    out.deckHeight = null;
    out.ceilingHeight = Number.POSITIVE_INFINITY;
    out.underpassBlend = 0;
    out.eventId = event?.id ?? null;
    out.eventType = event?.type ?? null;
    out.routeId = event ? routeId : ROUTE_TRUNK;

    if (event?.type === EVENT_INTERCHANGE) {
      const deckSample = interchangeDeckScratch;
      sampleInterchangeDeck(event, s, deckSample);
      out.deckHeight = deckSample.height;
      if (routeId === event.upperRouteId) {
        out.height = deckSample.height;
        out.grade = deckSample.grade;
        out.phase = deckSample.height <= 0.000_1
          ? 'flat'
          : deckSample.height >= event.deckHeight - 0.000_1 ? 'bridge-deck' : 'bridge-grade';
        out.structure = 'interchange-upper';
        return out;
      }
      if (routeId === event.lowerRouteId) {
        const centerGap = Math.abs(
          getRouteOffset(s, event.upperRouteId) - getRouteOffset(s, event.lowerRouteId)
        );
        const crossWindow = smootherStep01(
          1 - Math.abs(s - event.crossS) / (event.crossEndS - event.crossS)
        );
        // Use the complete crossing envelope so high-speed cameras descend before the decks visually overlap.
        out.underpassBlend = crossWindow;
        if (
          s >= event.crossStartS
          && s <= event.crossEndS
          && centerGap <= INTERCHANGE_DECK_HALF_WIDTH * 2
          && deckSample.height > INTERCHANGE_DECK_THICKNESS
        ) {
          out.ceilingHeight = deckSample.height - INTERCHANGE_DECK_THICKNESS;
        }
        out.phase = Number.isFinite(out.ceilingHeight) ? 'underpass' : 'lower-road';
        out.structure = 'interchange-lower';
        return out;
      }
    }

    if (!ramp || s < ramp.startS || s > ramp.endS) return out;
    out.rampId = ramp.id;
    out.ramp = ramp;
    out.launchable = true;
    if (s <= ramp.lipS) {
      const t = clamp((s - ramp.startS) / ramp.ascent, 0, 1);
      out.height = ramp.height * t * t;
      out.grade = 2 * ramp.height * t / ramp.ascent;
      out.phase = 'ascent';
      return out;
    }

    const u = clamp((s - ramp.lipS) / ramp.descent, 0, 1);
    const remaining = 1 - u;
    out.height = ramp.height * remaining * remaining;
    out.grade = -2 * ramp.height * remaining / ramp.descent;
    out.phase = 'descent';
    return out;
  }

  /** Swept lip query prevents a 300m/s frame from skipping the takeoff transition. */
  function crossedRampLip(previousS, currentS, routeId) {
    if (!(currentS > previousS) || routeId === ROUTE_TRUNK) return null;
    const firstIndex = Math.max(0, eventIndexNear(previousS) - 1);
    const lastIndex = Math.max(firstIndex, eventIndexNear(currentS) + 1);
    for (let index = firstIndex; index <= lastIndex; index++) {
      const ramp = getRamp(getForkEvent(index), routeId);
      if (ramp && previousS < ramp.lipS && currentS >= ramp.lipS) return ramp;
    }
    return null;
  }

  /*
   * Full-cloverleaf graph contract.
   *
   * `runDistance` remains a monotonic score/theme clock, but road geometry is addressed by
   * `{ edgeId, edgeS, lateral }`. This separation is required because a 270-degree loop can
   * reverse world-Z, has a route-specific length, and exits onto a different corridor.
   * The legacy scalar fork API remains exported below only while the main runtime migrates.
   */
  const CLOVERLEAF_GRAPH_VERSION = 'Neon-cloverleaf-itinerary-20-crossings';
  const CLOVERLEAF_PORT_DISTANCE = 840;
  const CLOVERLEAF_DECISION_DISTANCE = 840;
  const CLOVERLEAF_DECISION_APPROACH = 1_080;
  // The collector now ends at the physical second decision. Its two turning children own the long common-height
  // throat, which avoids rendering a collector plus two branch shells over the same centreline.
  const CLOVERLEAF_COLLECTOR_LENGTH = 354;
  // The wider outside peel moves the collector/loop bridge far enough upstream to fit a grade-limited fall and
  // a level second-decision throat instead of dropping 6.15m in the final few metres.
  const CLOVERLEAF_COLLECTOR_OFFSET = 240;
  const CLOVERLEAF_COLLECTOR_TANGENT = 0;
  const CLOVERLEAF_CARRIAGEWAY_OFFSET = 12;
  const CLOVERLEAF_LOWER_HEIGHT = 0;
  const CLOVERLEAF_UPPER_HEIGHT = INTERCHANGE_HEIGHT;
  const CLOVERLEAF_MAIN_ROAD_HALF = 8.4;
  const CLOVERLEAF_DIRECT_ROAD_HALF = 5.6;
  const CLOVERLEAF_LOOP_ROAD_HALF = 5.2;
  const CLOVERLEAF_ROAD_SHELL_OUTER_MARGIN = 0.28;
  // The larger direct curve creates real separated grade length; adding terminal straight line never fixed a merge
  // because it moved the overlap and node together.
  const CLOVERLEAF_DIRECT_RADIUS = 400;
  const CLOVERLEAF_LOOP_RADIUS = 175;
  const CLOVERLEAF_TRANSITION_LENGTH = 120;
  const CLOVERLEAF_WIDTH_BLEND_LENGTH = 120;
  // Turning branches remain level until every full-width sibling shell has cleared. Direct envelopes measure at
  // most 162.25m in the canonical layout; the extra margin absorbs the 0.25m audit cadence.
  const CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH = 164;
  // The loop now ends at its true curve tangent instead of duplicating a 164m outbound line. Its measured
  // full-width overlap ends at 119.25m; 136m also keeps the complete wide tunnel portal on a level approach.
  const CLOVERLEAF_LOOP_MERGE_LEVEL_LENGTH = 136;
  const CLOVERLEAF_COLLECTOR_GRADE_START = 96;
  const CLOVERLEAF_COLLECTOR_GRADE_END_MARGIN = 16;
  const CLOVERLEAF_COLLECTOR_LEVEL_END_LENGTH = 12;
  const CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH = 3.5;
  const CLOVERLEAF_GRADE_SAFETY_LENGTH = 1;
  const CLOVERLEAF_GRADE_MIN_LENGTH = 320;
  const CLOVERLEAF_GRADE_MAX_LENGTH = 560;
  const CLOVERLEAF_DECK_THICKNESS = INTERCHANGE_DECK_THICKNESS;
  const CLOVERLEAF_CROSSING_MASK_SPAN = 56;
  const CLOVERLEAF_WEAVE_MASK_SPAN = 32;
  const CLOVERLEAF_CROSSING_LONGITUDINAL_MARGIN = 4;
  // Lower collectors rise by a local 6.15m at their loop conflict; the full-width audit below derives the
  // usable clearance after deck, beam, bank, and grade instead of assuming the former 7.57m centreline gap.
  const CLOVERLEAF_TUNNEL_LEVEL_SEPARATION = 6.15;
  const CLOVERLEAF_TUNNEL_CLEARANCE = 3.6;
  // The complete underground roof—not only the ship clearance plane—passes below the collector. A one-metre
  // basin leaves structural air above the 0.46m roof slab without forcing either junction approach off level.
  const CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT = -1;
  // The underground U wall starts on the road shell's real shoulder edge. Its 0.54m body then grows outward,
  // while the roof keeps only an 0.08m weather lip; deriving every offset prevents an authored air trench or
  // an inward wall shift from opening/penetrating the drivable shell.
  const CLOVERLEAF_ROAD_SHELL_SHOULDER_JOIN = 0.22;
  const CLOVERLEAF_UNDERGROUND_WALL_THICKNESS = 0.54;
  const CLOVERLEAF_UNDERGROUND_ROOF_OVERHANG = 0.08;
  const CLOVERLEAF_UNDERGROUND_WALL_INSET = CLOVERLEAF_ROAD_SHELL_SHOULDER_JOIN
    + CLOVERLEAF_UNDERGROUND_WALL_THICKNESS * 0.5;
  const CLOVERLEAF_UNDERGROUND_ROOF_INSET = CLOVERLEAF_UNDERGROUND_WALL_INSET
    + CLOVERLEAF_UNDERGROUND_WALL_THICKNESS * 0.5
    + CLOVERLEAF_UNDERGROUND_ROOF_OVERHANG;
  const CLOVERLEAF_UNDERGROUND_ROOF_DEPTH = 0.46;
  const CLOVERLEAF_TUNNEL_SHELL_SAFETY_GAP = 0.25;
  const CLOVERLEAF_MOUNTAIN_TUNNEL_CLEARANCE = 7.2;
  // The gallery roof is part of the clearance envelope: road-over-road validation must clear the shell, not only the cockpit.
  const CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_DEPTH = 1.15;
  const CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_INSET = 1.34;
  const CLOVERLEAF_TUNNEL_PORTAL_BLEND = 42;
  const CLOVERLEAF_TUNNEL_PORTAL_FRAME_DEPTH = 2.4;
  // Conflict masks already cover the complete road width; this extra level margin leaves enough distance for
  // the 13.5m flyover to descend at six percent before the late collector crossing.
  const CLOVERLEAF_FLYOVER_CONFLICT_MARGIN = 24;
  const CLOVERLEAF_BRIDGE_BEAM_DEPTH = 0.38;
  // 13.5m clears the banked mountain-gallery roof across its complete width while the longer direct
  // curve and early under-collector loop ascent retain C2 grades below six percent.
  const CLOVERLEAF_FLYOVER_HEIGHT = 13.5;
  const CLOVERLEAF_MAXIMUM_GRADE = 0.06;
  const CLOVERLEAF_EXPECTED_PLANAR_INTERSECTION_COUNT = 20;
  const CLOVERLEAF_JUNCTION_SCAN_STEP = 0.25;
  // Shared merge tangents intentionally extend beyond the former cosmetic-lens range; audit their full footprint.
  const CLOVERLEAF_JUNCTION_MAXIMUM_SCAN = 320;
  // Three metres covers the 2.5m renderer sampling chord plus a 0.5m discretisation tolerance.
  const CLOVERLEAF_JUNCTION_CLEAR_MARGIN = 3;
  // Tunnel walls are wider than the drivable shell. Twelve longitudinal metres leave at least 0.42m from the
  // sibling road at the tight loop split instead of validating only the tunnel centreline.
  const CLOVERLEAF_TUNNEL_JUNCTION_MARGIN = 12;
  // Support placement clears the footing's complete circumscribed footprint, not merely the narrower pier shaft.
  // The visible shaft remains inside the 1.24m clearance envelope, but a 0.92m radius gives the kilometre-scale
  // viaduct a believable load path instead of reading as a row of utility poles at hood-camera distance.
  const CLOVERLEAF_BRIDGE_PIER_RADIUS = 0.92;
  const CLOVERLEAF_BRIDGE_SUPPORT_RADIUS = 1.24;
  const CLOVERLEAF_BRIDGE_ROAD_GAP = 1.8;
  const CLOVERLEAF_BRIDGE_SUPPORT_GAP = 0.35;
  const CLOVERLEAF_GEOMETRY_STEP = 1;
  const CLOVERLEAF_CURVE_THRESHOLD = 0.000_8;
  const CLOVERLEAF_LOCK_LEAD = 180;
  const CLOVERLEAF_RECOVERY_LENGTH = 3_000;
  const CLOVERLEAF_RECOVERY_EXTENSION = 1_500;
  const CLOVERLEAF_RECENT_TILE_AVOIDANCE_COUNT = 4;
  const CLOVERLEAF_LAUNCH_OFFSET = 900;
  const CLOVERLEAF_LAUNCH_LENGTH = LAUNCH_FORK_DURATION;
  // Flattening the former full-width road hump must not move route portals, score distance, warmed tile
  // signatures, or obstacle chronology. This preserves that edge's established logical length while its
  // 324m world-space chord becomes a level corridor carrying one independent jump platform.
  const CLOVERLEAF_JUMP_PLATFORM_CORRIDOR_LENGTH = 324.454_197_356_685_9;
  // Lip heights are ballistic geometry, not launch boosts. At 260km/h under 9.81m/s² gravity, even the compact
  // variant supplies at least 4.2s of flight so the shared saturated lateral model can reach the 24m carriageway.
  const JUMP_PLATFORM_VARIANTS = Object.freeze([
    Object.freeze({
      id: 'compact-left',
      length: 18,
      width: 7.2,
      height: 5.2,
      lateral: -2.1
    }),
    Object.freeze({
      id: 'medium-centre',
      length: 24,
      width: 9.4,
      height: 6.8,
      lateral: 0
    }),
    Object.freeze({
      id: 'wide-right',
      length: 30,
      width: 12.2,
      height: 8.3,
      lateral: 1.1
    }),
    Object.freeze({
      id: 'long-offset',
      length: 36,
      width: 10.6,
      height: 9.8,
      lateral: -0.7
    })
  ]);
  // Straight-road forks are a routing contract, separate from any cosmetic cruise motion. Every recovery
  // keeps the established launch position, then exposes two simultaneously rendered physical roads.
  const STRAIGHT_FORK_APPROACH_LENGTH = 500;
  const STRAIGHT_FORK_BRANCH_PLANAR_LENGTH = 900;
  const STRAIGHT_FORK_BASE_OUT_LENGTH = 376;
  // The inside branch stays close to the through lane while the outside branch supplies the visible choice.
  // Their 20m peak centre separation leaves the same 7.2m clear gore both between branches and between the
  // 2m inside branch and the 24m-offset opposing carriageway.
  const STRAIGHT_FORK_LEFT_MAXIMUM_OFFSET = 2;
  const STRAIGHT_FORK_RIGHT_MAXIMUM_OFFSET = 18;
  const STRAIGHT_FORK_MAXIMUM_OFFSET = STRAIGHT_FORK_RIGHT_MAXIMUM_OFFSET;
  const STRAIGHT_FORK_BRANCH_ROAD_HALF = 6.4;
  const STRAIGHT_FORK_PROFILE_STEP = 0.5;
  const STRAIGHT_FORK_GORE_CLEAR_WIDTH = 2;
  const STRAIGHT_FORK_CLEARANCE_STEP = 4;
  const STRAIGHT_FORK_LEFT = 'left';
  const STRAIGHT_FORK_RIGHT = 'right';
  const CLOVERLEAF_INITIAL_TILE_COUNT = 3;
  const CLOVERLEAF_PORTS = Object.freeze(['south', 'west', 'north', 'east']);
  const CLOVERLEAF_KINDS = Object.freeze(['straight', 'right', 'left']);
  const CLOVERLEAF_EXIT_BY_ENTRY = Object.freeze({
    south: Object.freeze({ straight: 'north', right: 'east', left: 'west' }),
    west: Object.freeze({ straight: 'east', right: 'south', left: 'north' }),
    north: Object.freeze({ straight: 'south', right: 'west', left: 'east' }),
    east: Object.freeze({ straight: 'west', right: 'north', left: 'south' })
  });
  const CLOVERLEAF_KIND_LABELS = Object.freeze({
    straight: '直行',
    right: '直接右转',
    left: '左转环道'
  });
  const CLOVERLEAF_PORT_LABELS = Object.freeze({ north: '北', east: '东', south: '南', west: '西' });
  const graphNodeDrafts = new Map();
  const graphEdgeDrafts = new Map();
  const graphMovementDrafts = new Map();
  const graphEdgeSamples = new Map();
  // Curvature profiles are compact, immutable lookup data used by the per-frame preview without route-cursor allocations.
  const graphCurvatureProfiles = new Map();
  const graphCrossings = [];
  const graphCrossingsByEdge = new Map();
  let graphPlanarIntersections = [];
  let graphJunctionOverlapEnvelopes = [];
  let graphIntersectionAudit = null;

  function freezePoint(point) {
    return Object.freeze({ x: point.x, y: point.y ?? 0, z: point.z });
  }

  function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function lerpAngleValue(from, to, t) {
    return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
  }

  function rotatePlanar(point, quarterTurns) {
    const normalizedTurns = ((quarterTurns % 4) + 4) % 4;
    if (normalizedTurns === 1) return { x: -point.z, z: point.x };
    if (normalizedTurns === 2) return { x: -point.x, z: -point.z };
    if (normalizedTurns === 3) return { x: point.z, z: -point.x };
    return { x: point.x, z: point.z };
  }

  function portHeight(portId) {
    return portId === 'west' || portId === 'east'
      ? CLOVERLEAF_UPPER_HEIGHT
      : CLOVERLEAF_LOWER_HEIGHT;
  }

  function canonicalEntryPoint() {
    return {
      x: CLOVERLEAF_CARRIAGEWAY_OFFSET,
      z: CLOVERLEAF_DECISION_DISTANCE + CLOVERLEAF_DECISION_APPROACH
    };
  }

  function canonicalDecisionPoint() {
    return {
      x: CLOVERLEAF_CARRIAGEWAY_OFFSET,
      z: CLOVERLEAF_DECISION_DISTANCE
    };
  }

  function canonicalCollectorDecisionPoint() {
    return {
      x: CLOVERLEAF_CARRIAGEWAY_OFFSET + CLOVERLEAF_COLLECTOR_OFFSET,
      z: CLOVERLEAF_DECISION_DISTANCE - CLOVERLEAF_COLLECTOR_LENGTH - CLOVERLEAF_COLLECTOR_TANGENT
    };
  }

  function canonicalExitPoint(kind) {
    if (kind === 'straight') {
      return { x: CLOVERLEAF_CARRIAGEWAY_OFFSET, z: -CLOVERLEAF_PORT_DISTANCE };
    }
    if (kind === 'right') {
      return { x: CLOVERLEAF_PORT_DISTANCE, z: CLOVERLEAF_CARRIAGEWAY_OFFSET };
    }
    return { x: -CLOVERLEAF_PORT_DISTANCE, z: -CLOVERLEAF_CARRIAGEWAY_OFFSET };
  }

  function canonicalExitHeading(kind) {
    if (kind === 'straight') return -Math.PI * 0.5;
    if (kind === 'right') return 0;
    return Math.PI;
  }

  function appendPoint(points, x, z, heading, curvature = 0) {
    const previous = points[points.length - 1];
    const s = previous ? previous.s + Math.hypot(x - previous.x, z - previous.z) : 0;
    if (previous && s - previous.s <= 0.000_001) {
      previous.heading = heading;
      previous.curvature = curvature;
      return previous;
    }
    const point = { s, x, z, heading: normalizeAngle(heading), curvature };
    points.push(point);
    return point;
  }

  function appendLine(points, start, end, heading, step = CLOVERLEAF_GEOMETRY_STEP) {
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const count = Math.max(1, Math.ceil(length / step));
    if (!points.length) appendPoint(points, start.x, start.z, heading, 0);
    for (let index = 1; index <= count; index++) {
      const t = index / count;
      appendPoint(
        points,
        start.x + (end.x - start.x) * t,
        start.z + (end.z - start.z) * t,
        heading,
        0
      );
    }
  }

  /** Numerically integrate a linear-curvature segment; midpoint integration keeps the LUT deterministic and smooth. */
  function appendCurvatureSegment(points, length, curvatureStart, curvatureEnd) {
    const count = Math.max(1, Math.ceil(length / CLOVERLEAF_GEOMETRY_STEP));
    const ds = length / count;
    for (let index = 0; index < count; index++) {
      const previous = points[points.length - 1];
      const t = (index + 0.5) / count;
      const curvature = curvatureStart + (curvatureEnd - curvatureStart) * t;
      const headingMid = previous.heading + curvature * ds * 0.5;
      const x = previous.x + Math.cos(headingMid) * ds;
      const z = previous.z + Math.sin(headingMid) * ds;
      appendPoint(points, x, z, previous.heading + curvature * ds, curvature);
    }
  }

  function buildCanonicalTurnPath(start, end, endHeading, totalTurn, radius, transitionLength) {
    const startHeading = -Math.PI * 0.5;
    const maxCurvature = 1 / radius;
    const transitionTurn = transitionLength * maxCurvature;
    const constantTurn = Math.max(0, totalTurn - transitionTurn);
    const constantLength = constantTurn * radius;
    const curve = [{ s: 0, x: 0, z: 0, heading: startHeading, curvature: 0 }];
    appendCurvatureSegment(curve, transitionLength, 0, maxCurvature);
    appendCurvatureSegment(curve, constantLength, maxCurvature, maxCurvature);
    appendCurvatureSegment(curve, transitionLength, maxCurvature, 0);
    const curveEnd = curve[curve.length - 1];
    const startVector = { x: Math.cos(startHeading), z: Math.sin(startHeading) };
    const endVector = { x: Math.cos(endHeading), z: Math.sin(endHeading) };
    const remaining = {
      x: end.x - start.x - curveEnd.x,
      z: end.z - start.z - curveEnd.z
    };
    const determinant = startVector.x * endVector.z - endVector.x * startVector.z;
    if (Math.abs(determinant) <= 0.000_001) throw new Error('Cloverleaf turn tangents are parallel');
    const entryLength = (
      remaining.x * endVector.z - endVector.x * remaining.z
    ) / determinant;
    const exitLength = (
      startVector.x * remaining.z - remaining.x * startVector.z
    ) / determinant;
    if (entryLength < -0.001 || exitLength < -0.001) {
      throw new Error('Cloverleaf geometry does not fit inside its directional ports');
    }

    const points = [];
    const curveStart = {
      x: start.x + startVector.x * Math.max(0, entryLength),
      z: start.z + startVector.z * Math.max(0, entryLength)
    };
    appendLine(points, start, curveStart, startHeading);
    for (let index = 1; index < curve.length; index++) {
      const point = curve[index];
      appendPoint(
        points,
        curveStart.x + point.x,
        curveStart.z + point.z,
        point.heading,
        point.curvature
      );
    }
    const translatedCurveEnd = points[points.length - 1];
    appendLine(
      points,
      { x: translatedCurveEnd.x, z: translatedCurveEnd.z },
      end,
      endHeading
    );
    const finalPoint = points[points.length - 1];
    finalPoint.x = end.x;
    finalPoint.z = end.z;
    finalPoint.heading = normalizeAngle(endHeading);
    finalPoint.curvature = 0;
    return {
      points,
      segments: [
        { kind: 'line-in', length: Math.max(0, entryLength) },
        { kind: 'clothoid-in', length: transitionLength, curvatureStart: 0, curvatureEnd: maxCurvature },
        { kind: 'arc', length: constantLength, radius, sweep: constantTurn },
        { kind: 'clothoid-out', length: transitionLength, curvatureStart: maxCurvature, curvatureEnd: 0 },
        { kind: 'line-out', length: Math.max(0, exitLength) }
      ]
    };
  }

  function buildCanonicalMovementPath(kind) {
    const start = kind === 'straight' ? canonicalDecisionPoint() : canonicalCollectorDecisionPoint();
    const end = canonicalExitPoint(kind);
    if (kind === 'straight') {
      const points = [];
      appendLine(points, start, end, -Math.PI * 0.5);
      return {
        points,
        segments: [{ kind: 'line', length: Math.hypot(end.x - start.x, end.z - start.z) }]
      };
    }
    if (kind === 'right') {
      return buildCanonicalTurnPath(
        start,
        end,
        canonicalExitHeading(kind),
        Math.PI * 0.5,
        CLOVERLEAF_DIRECT_RADIUS,
        CLOVERLEAF_TRANSITION_LENGTH
      );
    }
    return buildCanonicalTurnPath(
      start,
      end,
      canonicalExitHeading(kind),
      Math.PI * 1.5,
      CLOVERLEAF_LOOP_RADIUS,
      CLOVERLEAF_TRANSITION_LENGTH
    );
  }

  /** Split a common outbound segment from each movement so converging routes share one physical road shell. */
  function trimPathEnd(path, trimLength) {
    const targetS = path.points[path.points.length - 1].s - trimLength;
    if (!(targetS > 0)) throw new Error('Cloverleaf outbound split exceeds movement length');
    const points = [];
    for (let index = 0; index < path.points.length; index++) {
      const point = path.points[index];
      if (point.s < targetS) {
        points.push({ ...point });
        continue;
      }
      const previous = path.points[Math.max(0, index - 1)];
      const span = point.s - previous.s;
      const t = span > 0.000_001 ? (targetS - previous.s) / span : 0;
      points.push({
        s: targetS,
        x: previous.x + (point.x - previous.x) * t,
        z: previous.z + (point.z - previous.z) * t,
        heading: lerpAngleValue(previous.heading, point.heading, t),
        curvature: previous.curvature + (point.curvature - previous.curvature) * t
      });
      break;
    }
    const segments = path.segments.map((segment) => ({ ...segment }));
    let remainingTrim = trimLength;
    for (let index = segments.length - 1; index >= 0 && remainingTrim > 0.000_001; index--) {
      const removed = Math.min(segments[index].length, remainingTrim);
      segments[index].length -= removed;
      remainingTrim -= removed;
      if (segments[index].length <= 0.000_001) segments.splice(index, 1);
    }
    const mergePoint = points[points.length - 1];
    mergePoint.curvature = 0;
    return { points, segments, mergePoint };
  }

  /** The shared collector peels outward with zero lateral derivative at both decision portals. */
  function buildCanonicalCollectorPath() {
    const start = canonicalDecisionPoint();
    const end = canonicalCollectorDecisionPoint();
    const blendEnd = { x: end.x, z: end.z + CLOVERLEAF_COLLECTOR_TANGENT };
    const points = [];
    const count = Math.max(1, Math.ceil(CLOVERLEAF_COLLECTOR_LENGTH / CLOVERLEAF_GEOMETRY_STEP));
    for (let index = 0; index <= count; index++) {
      const t = index / count;
      const lateralBlend = smootherStep01(t);
      const derivative = smootherStepDerivative01(t);
      const x = start.x + CLOVERLEAF_COLLECTOR_OFFSET * lateralBlend;
      const z = start.z - CLOVERLEAF_COLLECTOR_LENGTH * t;
      const dxDs = CLOVERLEAF_COLLECTOR_OFFSET * derivative / CLOVERLEAF_COLLECTOR_LENGTH;
      const heading = Math.atan2(-1, dxDs);
      appendPoint(points, x, z, heading, 0);
    }
    points[0].heading = -Math.PI * 0.5;
    points[points.length - 1].heading = -Math.PI * 0.5;
    for (let index = 1; index < points.length - 1; index++) {
      const before = points[index - 1];
      const after = points[index + 1];
      const span = after.s - before.s;
      points[index].curvature = span > 0.000_001
        ? Math.atan2(
            Math.sin(after.heading - before.heading),
            Math.cos(after.heading - before.heading)
          ) / span
        : 0;
    }
    const blendEndS = points[points.length - 1].s;
    appendLine(points, blendEnd, end, -Math.PI * 0.5);
    return {
      points,
      segments: [
        {
          kind: 'collector-quintic',
          length: blendEndS,
          lateralOffset: CLOVERLEAF_COLLECTOR_OFFSET
        },
        { kind: 'shared-turn-tangent', length: CLOVERLEAF_COLLECTOR_TANGENT }
      ]
    };
  }

  function rotatePath(path, quarterTurns) {
    const rotation = quarterTurns * Math.PI * 0.5;
    return path.map((point) => {
      const rotated = rotatePlanar(point, quarterTurns);
      return {
        s: point.s,
        x: rotated.x,
        z: rotated.z,
        heading: normalizeAngle(point.heading + rotation),
        curvature: point.curvature
      };
    });
  }

  function edgeBounds(points, roadHalf) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      minX = Math.min(minX, point.x - roadHalf);
      maxX = Math.max(maxX, point.x + roadHalf);
      minZ = Math.min(minZ, point.z - roadHalf);
      maxZ = Math.max(maxZ, point.z + roadHalf);
    }
    return Object.freeze({ minX, maxX, minZ, maxZ });
  }

  function heightProfileFor(length, startHeight, endHeight) {
    if (Math.abs(endHeight - startHeight) <= 0.000_001) {
      return Object.freeze({ startHeight, endHeight, startS: 0, endS: length, gradeLength: 0 });
    }
    const gradeLength = clamp(
      length * 0.40,
      CLOVERLEAF_GRADE_MIN_LENGTH,
      CLOVERLEAF_GRADE_MAX_LENGTH
    );
    return Object.freeze({
      startHeight,
      endHeight,
      startS: (length - gradeLength) * 0.5,
      endS: (length + gradeLength) * 0.5,
      gradeLength
    });
  }

  /** Delay an upper collector's rise until its first junction is fully clear, then finish before the turn split. */
  function collectorHeightProfileFor(length, startHeight, endHeight) {
    if (Math.abs(endHeight - startHeight) <= 0.000_001) {
      return heightProfileFor(length, startHeight, endHeight);
    }
    const startS = Math.min(CLOVERLEAF_COLLECTOR_GRADE_START, length);
    const endS = Math.max(startS, length - CLOVERLEAF_COLLECTOR_GRADE_END_MARGIN);
    const gradeLength = endS - startS;
    const maximumGrade = Math.abs(endHeight - startHeight) * 1.875
      / Math.max(0.000_001, gradeLength);
    if (maximumGrade > CLOVERLEAF_MAXIMUM_GRADE + 0.000_001) {
      throw new Error(`Collector cannot clear its level junctions: ${maximumGrade.toFixed(6)}`);
    }
    return Object.freeze({ startHeight, endHeight, startS, endS, gradeLength });
  }

  /**
   * Turning branches remain one physical throat until their complete shell overlap ends. Descending ramps use
   * all separated curve length; rising ramps stay low through the direct/loop crossing and use the latest safe
   * C2 rise. Both profiles finish before the merge overlap begins.
   */
  function directRampHeightProfileFor(length, startHeight, endHeight) {
    if (Math.abs(endHeight - startHeight) <= 0.000_001) {
      return heightProfileFor(length, startHeight, endHeight);
    }
    const throatStartS = Math.min(CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH, length);
    const throatEndS = Math.max(throatStartS, length - CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH);
    const availableGradeLength = throatEndS - throatStartS;
    const minimumGradeLength = Math.abs(endHeight - startHeight) * 1.875
      / CLOVERLEAF_MAXIMUM_GRADE + CLOVERLEAF_GRADE_SAFETY_LENGTH;
    const rising = endHeight > startHeight;
    const gradeLength = rising
      ? Math.min(availableGradeLength, minimumGradeLength)
      : availableGradeLength;
    const startS = rising ? throatEndS - gradeLength : throatStartS;
    const endS = startS + gradeLength;
    const maximumGrade = Math.abs(endHeight - startHeight) * 1.875
      / Math.max(0.000_001, gradeLength);
    if (maximumGrade > CLOVERLEAF_MAXIMUM_GRADE + 0.000_001) {
      throw new Error(
        `Direct ramp cannot clear its shared junction throat: ${maximumGrade.toFixed(6)}`
      );
    }
    return Object.freeze({
      startHeight,
      endHeight,
      startS,
      endS,
      gradeLength
    });
  }

  function bankProfileFor(family) {
    const maxDegrees = family === 'loop-ramp' ? 10 : family === 'direct-ramp' ? 6 : 0;
    /*
     * A shared junction throat is one physical deck, not merely equal centreline heights. Keep every turning
     * shell unbanked until its complete sibling footprint has separated, then introduce superelevation with the
     * normal C2 envelope. Otherwise overlapping siblings form a scissor seam across the road width.
     */
    const startFlatLength = family === 'loop-ramp' || family === 'direct-ramp'
      ? CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH
      : 0;
    const endFlatLength = family === 'loop-ramp'
      ? CLOVERLEAF_LOOP_MERGE_LEVEL_LENGTH
      : family === 'direct-ramp'
        ? CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH
        : 0;
    return Object.freeze({
      maxRadians: maxDegrees * Math.PI / 180,
      transitionLength: family === 'mainline' || family === 'approach' ? 0 : CLOVERLEAF_TRANSITION_LENGTH,
      startFlatLength,
      endFlatLength
    });
  }

  function registerNode(id, kind, point, heading, elevation, extra = {}) {
    graphNodeDrafts.set(id, {
      id,
      kind,
      world: freezePoint({ x: point.x, y: elevation, z: point.z }),
      heading: normalizeAngle(heading),
      elevation,
      inEdges: [],
      outEdges: [],
      exitCode: extra.exitCode ?? null,
      entryPort: extra.entryPort ?? null
    });
  }

  function registerEdge({
    id,
    from,
    to,
    family,
    maneuver,
    entryPort,
    exitPort,
    points,
    roadHalf,
    speedLimit,
    geometrySegments,
    startHeight,
    endHeight,
    layer,
    successors = []
  }) {
    const length = points[points.length - 1].s;
    const frozenSegments = Object.freeze(geometrySegments.map((segment) => Object.freeze({ ...segment })));
    const edge = {
      id,
      from,
      to,
      family,
      maneuver,
      entryPort,
      exitPort,
      length,
      roadHalf,
      speedLimit,
      geometrySegments: frozenSegments,
      heightProfile: family === 'direct-ramp'
        ? directRampHeightProfileFor(length, startHeight, endHeight)
        : family === 'collector'
          ? collectorHeightProfileFor(length, startHeight, endHeight)
        : heightProfileFor(length, startHeight, endHeight),
      verticalFeatures: [],
      tunnelProfiles: [],
      bankProfile: bankProfileFor(family),
      surfaceId: `surface:${id}`,
      layer,
      interchangeClearZone: true,
      successors: [...successors],
      bounds: edgeBounds(points, Math.max(CLOVERLEAF_MAIN_ROAD_HALF, roadHalf))
    };
    graphEdgeDrafts.set(id, edge);
    graphEdgeSamples.set(id, points);
    graphNodeDrafts.get(from).outEdges.push(id);
    graphNodeDrafts.get(to).inEdges.push(id);
    return edge;
  }

  function movementId(entryPort, kind) {
    return `${entryPort}-${kind}`;
  }

  function maneuverEdgeId(entryPort, exitPort, kind) {
    if (kind === 'straight') return `through-${entryPort}-${exitPort}`;
    if (kind === 'right') return `direct-${entryPort}-${exitPort}`;
    return `loop-${entryPort}-${exitPort}`;
  }

  function buildCloverleafGraphDrafts() {
    const canonicalApproachStart = canonicalEntryPoint();
    const canonicalApproachEnd = canonicalDecisionPoint();
    const canonicalApproach = [];
    appendLine(canonicalApproach, canonicalApproachStart, canonicalApproachEnd, -Math.PI * 0.5);
    const canonicalCollector = buildCanonicalCollectorPath();
    const canonicalFullMovements = Object.fromEntries(
      CLOVERLEAF_KINDS.map((kind) => [kind, buildCanonicalMovementPath(kind)])
    );
    const directTerminalLength = canonicalFullMovements.right.segments.at(-1).length;
    const loopTerminalLength = canonicalFullMovements.left.segments.at(-1).length;
    // Both turning branches end at their true curve tangents. Retaining either private terminal line duplicates
    // the already-shared outbound deck and recreates the exact merge penetration this graph must prevent.
    const directMergeBack = directTerminalLength;
    const loopMergeBack = loopTerminalLength;
    if (!(directMergeBack > 0 && loopMergeBack > 0)) {
      throw new Error('Cloverleaf terminal tangent cannot contain the shared merge throat');
    }
    const canonicalMovements = Object.freeze({
      straight: trimPathEnd(canonicalFullMovements.straight, loopMergeBack),
      right: trimPathEnd(canonicalFullMovements.right, directMergeBack),
      left: trimPathEnd(canonicalFullMovements.left, loopMergeBack)
    });
    if (!(loopMergeBack > directMergeBack)) {
      throw new Error('Cloverleaf loop merge must precede the direct-ramp merge');
    }

    for (let quarterTurns = 0; quarterTurns < CLOVERLEAF_PORTS.length; quarterTurns++) {
      const entryPort = CLOVERLEAF_PORTS[quarterTurns];
      const entryPoint = rotatePlanar(canonicalApproachStart, quarterTurns);
      const decisionPoint = rotatePlanar(canonicalApproachEnd, quarterTurns);
      const collectorDecisionPoint = rotatePlanar(canonicalCollectorDecisionPoint(), quarterTurns);
      const entryHeading = normalizeAngle(-Math.PI * 0.5 + quarterTurns * Math.PI * 0.5);
      const entryHeight = portHeight(entryPort);
      // Upper approaches lift the common turning throat before the second split. Direct and loop choices therefore
      // share one deck until their full widths clear, instead of starting as vertically intersecting sibling roads.
      const turnSplitHeight = entryHeight > CLOVERLEAF_LOWER_HEIGHT
        ? CLOVERLEAF_FLYOVER_HEIGHT
        : entryHeight;
      registerNode(`entry-${entryPort}`, 'entry', entryPoint, entryHeading, entryHeight, { entryPort });
      registerNode(`decision-${entryPort}`, 'decision', decisionPoint, entryHeading, entryHeight, { entryPort });
      registerNode(
        `collector-decision-${entryPort}`,
        'collector-decision',
        collectorDecisionPoint,
        entryHeading,
        turnSplitHeight,
        { entryPort }
      );

      const exitPorts = CLOVERLEAF_EXIT_BY_ENTRY[entryPort];
      for (const kind of CLOVERLEAF_KINDS) {
        const exitPort = exitPorts[kind];
        const canonicalExit = canonicalExitPoint(kind);
        const exitPoint = rotatePlanar(canonicalExit, quarterTurns);
        const exitHeading = normalizeAngle(canonicalExitHeading(kind) + quarterTurns * Math.PI * 0.5);
        if (!graphNodeDrafts.has(`exit-${exitPort}`)) {
          registerNode(`exit-${exitPort}`, 'exit', exitPoint, exitHeading, portHeight(exitPort), { exitCode: exitPort });
        }
        const loopMergeNodeId = `loop-merge-${exitPort}`;
        const directMergeNodeId = `direct-merge-${exitPort}`;
        if (!graphNodeDrafts.has(loopMergeNodeId)) {
          const exitDirection = { x: Math.cos(exitHeading), z: Math.sin(exitHeading) };
          const loopMergePoint = {
            x: exitPoint.x - exitDirection.x * loopMergeBack,
            z: exitPoint.z - exitDirection.z * loopMergeBack
          };
          const directMergePoint = {
            x: exitPoint.x - exitDirection.x * directMergeBack,
            z: exitPoint.z - exitDirection.z * directMergeBack
          };
          const exitHeight = portHeight(exitPort);
          const exitLayer = exitHeight > CLOVERLEAF_LOWER_HEIGHT ? 'upper' : 'lower';
          registerNode(loopMergeNodeId, 'loop-merge', loopMergePoint, exitHeading, exitHeight, { exitCode: exitPort });
          registerNode(directMergeNodeId, 'direct-merge', directMergePoint, exitHeading, exitHeight, { exitCode: exitPort });
          const outboundMidPoints = [];
          appendLine(outboundMidPoints, loopMergePoint, directMergePoint, exitHeading);
          registerEdge({
            id: `outbound-mid-${exitPort}`,
            from: loopMergeNodeId,
            to: directMergeNodeId,
            family: 'outbound',
            maneuver: 'outbound',
            entryPort: null,
            exitPort,
            points: outboundMidPoints,
            roadHalf: CLOVERLEAF_MAIN_ROAD_HALF,
            speedLimit: ROAD_SPEED_LIMITS_MPS.mainline,
            geometrySegments: [{ kind: 'line', length: loopMergeBack - directMergeBack }],
            startHeight: exitHeight,
            endHeight: exitHeight,
            layer: exitLayer,
            successors: [`outbound-${exitPort}`]
          });
          const outboundPoints = [];
          appendLine(outboundPoints, directMergePoint, exitPoint, exitHeading);
          registerEdge({
            id: `outbound-${exitPort}`,
            from: directMergeNodeId,
            to: `exit-${exitPort}`,
            family: 'outbound',
            maneuver: 'outbound',
            entryPort: null,
            exitPort,
            points: outboundPoints,
            roadHalf: CLOVERLEAF_MAIN_ROAD_HALF,
            speedLimit: ROAD_SPEED_LIMITS_MPS.mainline,
            geometrySegments: [{ kind: 'line', length: directMergeBack }],
            startHeight: exitHeight,
            endHeight: exitHeight,
            layer: exitLayer
          });
        }
      }

      const approachEdgeId = `approach-${entryPort}`;
      registerEdge({
        id: approachEdgeId,
        from: `entry-${entryPort}`,
        to: `decision-${entryPort}`,
        family: 'approach',
        maneuver: 'approach',
        entryPort,
        exitPort: null,
        points: rotatePath(canonicalApproach, quarterTurns),
        roadHalf: CLOVERLEAF_MAIN_ROAD_HALF,
        speedLimit: ROAD_SPEED_LIMITS_MPS.mainline,
        geometrySegments: [{ kind: 'line', length: CLOVERLEAF_DECISION_APPROACH }],
        startHeight: entryHeight,
        endHeight: entryHeight,
        layer: entryHeight > CLOVERLEAF_LOWER_HEIGHT ? 'upper' : 'lower'
      });
      const collectorEdgeId = `collector-${entryPort}`;
      const collectorEdge = registerEdge({
        id: collectorEdgeId,
        from: `decision-${entryPort}`,
        to: `collector-decision-${entryPort}`,
        family: 'collector',
        maneuver: 'collector',
        entryPort,
        exitPort: null,
        points: rotatePath(canonicalCollector.points, quarterTurns),
        roadHalf: 6.4,
        speedLimit: ROAD_SPEED_LIMITS_MPS.collector,
        geometrySegments: canonicalCollector.segments,
        startHeight: entryHeight,
        endHeight: turnSplitHeight,
        layer: entryHeight > CLOVERLEAF_LOWER_HEIGHT ? 'upper' : 'lower'
      });

      for (const kind of CLOVERLEAF_KINDS) {
        const exitPort = exitPorts[kind];
        const edgeId = maneuverEdgeId(entryPort, exitPort, kind);
        const family = kind === 'straight' ? 'mainline' : kind === 'right' ? 'direct-ramp' : 'loop-ramp';
        const roadHalf = kind === 'straight'
          ? CLOVERLEAF_MAIN_ROAD_HALF
          : kind === 'right' ? CLOVERLEAF_DIRECT_ROAD_HALF : CLOVERLEAF_LOOP_ROAD_HALF;
        const path = canonicalMovements[kind];
        const edge = registerEdge({
          id: edgeId,
          from: kind === 'straight' ? `decision-${entryPort}` : `collector-decision-${entryPort}`,
          to: kind === 'right' ? `direct-merge-${exitPort}` : `loop-merge-${exitPort}`,
          family,
          maneuver: kind,
          entryPort,
          exitPort,
          points: rotatePath(path.points, quarterTurns),
          roadHalf,
          speedLimit: kind === 'straight'
            ? ROAD_SPEED_LIMITS_MPS.mainline
            : kind === 'right'
              ? ROAD_SPEED_LIMITS_MPS.directRamp
              : ROAD_SPEED_LIMITS_MPS.loopRamp,
          geometrySegments: path.segments,
          startHeight: kind === 'straight' ? entryHeight : turnSplitHeight,
          endHeight: portHeight(exitPort),
          layer: (kind === 'straight' ? entryHeight : turnSplitHeight) === portHeight(exitPort)
            ? ((kind === 'straight' ? entryHeight : turnSplitHeight) > CLOVERLEAF_LOWER_HEIGHT
                ? 'upper'
                : 'lower')
            : 'transition'
        });
        const outboundMidEdgeId = `outbound-mid-${exitPort}`;
        const outboundEdgeId = `outbound-${exitPort}`;
        const edgeIds = kind === 'straight'
          ? [approachEdgeId, edgeId, outboundMidEdgeId, outboundEdgeId]
          : kind === 'right'
            ? [approachEdgeId, collectorEdgeId, edgeId, outboundEdgeId]
            : [approachEdgeId, collectorEdgeId, edgeId, outboundMidEdgeId, outboundEdgeId];
        let movementLength = 0;
        const cumulativeLengths = Object.freeze(edgeIds.map((movementEdgeId) => {
          const cumulativeLength = movementLength;
          const movementEdge = graphEdgeDrafts.get(movementEdgeId);
          if (!movementEdge) throw new Error(`Missing movement edge: ${movementEdgeId}`);
          movementLength += movementEdge.length;
          return cumulativeLength;
        }));
        graphMovementDrafts.set(movementId(entryPort, kind), {
          id: movementId(entryPort, kind),
          entryPort,
          exitPort,
          kind,
          label: kind === 'straight'
            ? `地上主路 · ${CLOVERLEAF_PORT_LABELS[exitPort]}`
            : kind === 'right'
              ? `2A 山体隧道 · ${CLOVERLEAF_PORT_LABELS[exitPort]}`
              : `2B 地下隧道 · ${CLOVERLEAF_PORT_LABELS[exitPort]}`,
          shortLabel: kind === 'straight'
            ? '地上主路'
            : kind === 'right' ? '山体隧道' : '地下隧道',
          routeType: kind === 'straight'
            ? 'surface'
            : kind === 'right' ? 'mountain-tunnel' : 'underground-tunnel',
          edgeIds,
          cumulativeLengths,
          length: movementLength,
          decisionNodeId: `decision-${entryPort}`,
          collectorDecisionNodeId: kind === 'straight' ? null : `collector-decision-${entryPort}`,
          entryGate: Object.freeze(kind === 'straight'
            ? { min: -Number.POSITIVE_INFINITY, max: 1.6 }
            : { min: 1.6, max: Number.POSITIVE_INFINITY }),
          collectorGate: kind === 'straight'
            ? null
            : Object.freeze(kind === 'right'
              ? { min: 1.6, max: Number.POSITIVE_INFINITY }
              : { min: -Number.POSITIVE_INFINITY, max: 1.6 }),
          fallback: kind === 'straight'
        });
      }
    }

    for (const entryPort of CLOVERLEAF_PORTS) {
      const approach = graphEdgeDrafts.get(`approach-${entryPort}`);
      const straightExit = CLOVERLEAF_EXIT_BY_ENTRY[entryPort].straight;
      approach.successors = [
        maneuverEdgeId(entryPort, straightExit, 'straight'),
        `collector-${entryPort}`
      ];
      const collector = graphEdgeDrafts.get(`collector-${entryPort}`);
      collector.successors = ['right', 'left'].map((kind) => {
        const exitPort = CLOVERLEAF_EXIT_BY_ENTRY[entryPort][kind];
        return maneuverEdgeId(entryPort, exitPort, kind);
      });
    }
  }

  function segmentIntersection(a0, a1, b0, b1) {
    const adx = a1.x - a0.x;
    const adz = a1.z - a0.z;
    const bdx = b1.x - b0.x;
    const bdz = b1.z - b0.z;
    const denominator = adx * bdz - adz * bdx;
    if (Math.abs(denominator) <= 0.000_001) return null;
    const dx = b0.x - a0.x;
    const dz = b0.z - a0.z;
    const ta = (dx * bdz - dz * bdx) / denominator;
    const tb = (dx * adz - dz * adx) / denominator;
    if (ta < 0 || ta > 1 || tb < 0 || tb > 1) return null;
    return {
      x: a0.x + adx * ta,
      z: a0.z + adz * ta,
      aS: ta * Math.hypot(adx, adz),
      bS: tb * Math.hypot(bdx, bdz)
    };
  }

  /** Locate the first plan-view crossing between two curved LUT edges without reducing either edge to one chord. */
  function sampledEdgeIntersection(edgeAId, edgeBId) {
    const samplesA = graphEdgeSamples.get(edgeAId);
    const samplesB = graphEdgeSamples.get(edgeBId);
    for (let aIndex = 1; aIndex < samplesA.length; aIndex++) {
      const a0 = samplesA[aIndex - 1];
      const a1 = samplesA[aIndex];
      for (let bIndex = 1; bIndex < samplesB.length; bIndex++) {
        const b0 = samplesB[bIndex - 1];
        const b1 = samplesB[bIndex];
        if (
          Math.max(a0.x, a1.x) < Math.min(b0.x, b1.x)
          || Math.min(a0.x, a1.x) > Math.max(b0.x, b1.x)
          || Math.max(a0.z, a1.z) < Math.min(b0.z, b1.z)
          || Math.min(a0.z, a1.z) > Math.max(b0.z, b1.z)
        ) continue;
        const intersection = segmentIntersection(a0, a1, b0, b1);
        if (!intersection) continue;
        return {
          x: intersection.x,
          z: intersection.z,
          edgeAS: a0.s + intersection.aS,
          edgeBS: b0.s + intersection.bS
        };
      }
    }
    return null;
  }

  function edgePairKey(edgeAId, edgeBId) {
    return edgeAId < edgeBId ? `${edgeAId}|${edgeBId}` : `${edgeBId}|${edgeAId}`;
  }

  /** Enumerate every non-node plan-view conflict so no visually crossing road can remain outside the collision contract. */
  function enumerateNonNodePlanarIntersections() {
    const edges = [...graphEdgeDrafts.values()];
    const intersections = [];
    for (let edgeAIndex = 0; edgeAIndex < edges.length; edgeAIndex++) {
      const edgeA = edges[edgeAIndex];
      for (let edgeBIndex = edgeAIndex + 1; edgeBIndex < edges.length; edgeBIndex++) {
        const edgeB = edges[edgeBIndex];
        const sharesNode = edgeA.from === edgeB.from
          || edgeA.from === edgeB.to
          || edgeA.to === edgeB.from
          || edgeA.to === edgeB.to;
        if (sharesNode) continue;
        const intersection = sampledEdgeIntersection(edgeA.id, edgeB.id);
        if (!intersection) continue;
        intersections.push(Object.freeze({
          id: `planar-intersection:${edgePairKey(edgeA.id, edgeB.id)}`,
          pairKey: edgePairKey(edgeA.id, edgeB.id),
          edgeAId: edgeA.id,
          edgeBId: edgeB.id,
          edgeAS: intersection.edgeAS,
          edgeBS: intersection.edgeBS,
          x: intersection.x,
          z: intersection.z
        }));
      }
    }
    intersections.sort((left, right) => left.pairKey.localeCompare(right.pairKey));
    return intersections;
  }

  /** Sample a draft edge by planar station before the public graph switches to true 3D arc length. */
  function sampleDraftPlanarFrame(edgeId, planarS) {
    const edge = graphEdgeDrafts.get(edgeId);
    const samples = graphEdgeSamples.get(edgeId);
    const targetS = clamp(planarS, 0, samples[samples.length - 1].s);
    let low = 0;
    let high = samples.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (samples[middle].s <= targetS) low = middle;
      else high = middle;
    }
    const a = samples[low];
    const b = samples[Math.min(samples.length - 1, low + 1)];
    const span = b.s - a.s;
    const t = span > 0.000_001 ? (targetS - a.s) / span : 0;
    const curvature = a.curvature + (b.curvature - a.curvature) * t;
    const heightSample = sampleHeight(edge, targetS);
    const bank = sampleBank(edge, targetS, curvature);
    const tangentScale = 1 / Math.hypot(1, heightSample.grade);
    const tangentX = Math.cos(lerpAngleValue(a.heading, b.heading, t));
    const tangentZ = Math.sin(lerpAngleValue(a.heading, b.heading, t));
    const baseRightX = -tangentZ;
    const baseRightZ = tangentX;
    const baseUpX = -heightSample.grade * tangentX * tangentScale;
    const baseUpZ = -heightSample.grade * tangentZ * tangentScale;
    const bankCos = Math.cos(bank);
    const bankSin = Math.sin(bank);
    return {
      edge,
      planarS: targetS,
      x: a.x + (b.x - a.x) * t,
      y: heightSample.height,
      z: a.z + (b.z - a.z) * t,
      heading: lerpAngleValue(a.heading, b.heading, t),
      curvature,
      grade: heightSample.grade,
      tangentX,
      tangentY: heightSample.grade * tangentScale,
      tangentZ,
      rightX: baseRightX * bankCos + baseUpX * bankSin,
      rightY: tangentScale * bankSin,
      rightZ: baseRightZ * bankCos + baseUpZ * bankSin,
      upX: baseUpX * bankCos - baseRightX * bankSin,
      upY: tangentScale * bankCos,
      upZ: baseUpZ * bankCos - baseRightZ * bankSin,
      roadHalf: sampleRoadHalf(edge, targetS)
    };
  }

  function registerGraphCrossing(crossing) {
    const frozenCrossing = Object.freeze(crossing);
    graphCrossings.push(frozenCrossing);
    for (const edgeId of [frozenCrossing.lowerEdgeId, frozenCrossing.upperEdgeId]) {
      if (!graphCrossingsByEdge.has(edgeId)) graphCrossingsByEdge.set(edgeId, []);
      graphCrossingsByEdge.get(edgeId).push(frozenCrossing);
    }
    return frozenCrossing;
  }

  /**
   * Cover the complete upper-deck footprint along the lower road, including skewed weave crossings.
   * A fixed station span can expose the ship top near an oblique bridge edge after geometry is enlarged.
   */
  function crossingMaskSpan(upperEdgeId, upperEdgeS, lowerEdgeId, lowerEdgeS, minimumSpan) {
    const upperEdge = graphEdgeDrafts.get(upperEdgeId);
    const lowerEdge = graphEdgeDrafts.get(lowerEdgeId);
    const headingAtPlanarS = (samples, planarS) => {
      const targetS = clamp(planarS, 0, samples[samples.length - 1].s);
      let low = 0;
      let high = samples.length - 1;
      while (low + 1 < high) {
        const middle = (low + high) >> 1;
        if (samples[middle].s <= targetS) low = middle;
        else high = middle;
      }
      const a = samples[low];
      const b = samples[Math.min(samples.length - 1, low + 1)];
      const span = b.s - a.s;
      const t = span > 0.000_001 ? (targetS - a.s) / span : 0;
      return lerpAngleValue(a.heading, b.heading, t);
    };
    const upperHeading = headingAtPlanarS(graphEdgeSamples.get(upperEdgeId), upperEdgeS);
    const lowerHeading = headingAtPlanarS(graphEdgeSamples.get(lowerEdgeId), lowerEdgeS);
    const crossingSin = Math.max(
      0.28,
      Math.abs(Math.sin(normalizeAngle(upperHeading - lowerHeading)))
    );
    const upperHalf = sampleRoadHalf(upperEdge, upperEdgeS);
    const lowerHalf = sampleRoadHalf(lowerEdge, lowerEdgeS);
    const longitudinalHalf = (
      upperHalf + Math.min(lowerHalf, CLOVERLEAF_CROSSING_LONGITUDINAL_MARGIN)
    ) / crossingSin;
    return Math.max(minimumSpan, longitudinalHalf * 2);
  }

  function draftSurfacePoint(edgeId, planarS, lateral) {
    const frame = sampleDraftPlanarFrame(edgeId, planarS);
    return {
      x: frame.x + frame.rightX * lateral,
      y: frame.y + frame.rightY * lateral,
      z: frame.z + frame.rightZ * lateral
    };
  }

  /** Sample the renderer-owned tunnel roof top so bridge validation covers thickness, bank, and outer overhang. */
  function draftTunnelShellTopPoints(edgeId, planarS) {
    const edge = graphEdgeDrafts.get(edgeId);
    if (edge.family !== 'direct-ramp' && edge.family !== 'loop-ramp') return [];
    const frame = sampleDraftPlanarFrame(edgeId, planarS);
    const mountain = edge.family === 'direct-ramp';
    const roofHalf = frame.roadHalf + (
      mountain ? CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_INSET : CLOVERLEAF_UNDERGROUND_ROOF_INSET
    );
    const roofTop = (
      mountain ? CLOVERLEAF_MOUNTAIN_TUNNEL_CLEARANCE : CLOVERLEAF_TUNNEL_CLEARANCE
    ) + (
      mountain ? CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_DEPTH : CLOVERLEAF_UNDERGROUND_ROOF_DEPTH
    );
    return [-roofHalf, 0, roofHalf].map((lateral) => ({
      x: frame.x + frame.rightX * lateral + frame.upX * roofTop,
      y: frame.y + frame.rightY * lateral + frame.upY * roofTop,
      z: frame.z + frame.rightZ * lateral + frame.upZ * roofTop
    }));
  }

  /** Project a plan-view point onto the sampled upper road and return its banked surface height. */
  function draftSurfaceHeightNearPoint(edgeId, centerS, longitudinalSpan, x, z) {
    const edge = graphEdgeDrafts.get(edgeId);
    const halfSpan = longitudinalSpan * 0.5;
    const startS = clamp(centerS - halfSpan, 0, edge.length);
    const endS = clamp(centerS + halfSpan, 0, edge.length);
    const sampleCount = Math.max(1, Math.ceil((endS - startS) / 0.25));
    let nearestFrame = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= sampleCount; index++) {
      const planarS = startS + (endS - startS) * index / sampleCount;
      const frame = sampleDraftPlanarFrame(edgeId, planarS);
      const distanceSquared = (frame.x - x) ** 2 + (frame.z - z) ** 2;
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestFrame = frame;
      }
    }
    const dx = x - nearestFrame.x;
    const dz = z - nearestFrame.z;
    const planarRightLengthSquared = nearestFrame.rightX ** 2 + nearestFrame.rightZ ** 2;
    const lateral = (dx * nearestFrame.rightX + dz * nearestFrame.rightZ)
      / Math.max(0.000_001, planarRightLengthSquared);
    return nearestFrame.y + nearestFrame.rightY * lateral;
  }

  function requiredCrossingClearance(lowerEdgeId) {
    const lowerEdge = graphEdgeDrafts.get(lowerEdgeId);
    if (lowerEdge.family === 'direct-ramp') {
      return CLOVERLEAF_MOUNTAIN_TUNNEL_CLEARANCE + CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_DEPTH;
    }
    if (lowerEdge.family === 'loop-ramp') return CLOVERLEAF_TUNNEL_CLEARANCE;
    return CLOVERLEAF_UPPER_HEIGHT - CLOVERLEAF_DECK_THICKNESS - CLOVERLEAF_BRIDGE_BEAM_DEPTH;
  }

  /**
   * Publish a conservative world-Y soffit plane for the complete banked lower-road mask. The plane is shifted
   * below every sampled point on the curved upper road, then collision sampling evaluates it at the ship's x/z.
   */
  function applyConservativeCrossingEnvelopes() {
    for (let index = 0; index < graphCrossings.length; index++) {
      const crossing = graphCrossings[index];
      const upperMaskSpan = crossingMaskSpan(
        crossing.lowerEdgeId,
        crossing.lowerEdgeS,
        crossing.upperEdgeId,
        crossing.upperEdgeS,
        crossing.maskSpan
      );
      const upperCenter = sampleDraftPlanarFrame(crossing.upperEdgeId, crossing.upperEdgeS);
      const planeDeterminant = upperCenter.tangentX * upperCenter.rightZ
        - upperCenter.tangentZ * upperCenter.rightX;
      if (Math.abs(planeDeterminant) <= 0.000_001) {
        throw new Error(`Cloverleaf soffit plane is singular: ${crossing.id}`);
      }
      const gradientX = (
        upperCenter.grade * upperCenter.rightZ - upperCenter.rightY * upperCenter.tangentZ
      ) / planeDeterminant;
      const gradientZ = (
        upperCenter.tangentX * upperCenter.rightY - upperCenter.grade * upperCenter.rightX
      ) / planeDeterminant;
      const lowerEdge = graphEdgeDrafts.get(crossing.lowerEdgeId);
      const lowerStartS = clamp(crossing.lowerEdgeS - crossing.maskSpan * 0.5, 0, lowerEdge.length);
      const lowerEndS = clamp(crossing.lowerEdgeS + crossing.maskSpan * 0.5, 0, lowerEdge.length);
      const lowerSampleCount = Math.max(1, Math.ceil((lowerEndS - lowerStartS) / 0.25));
      const surfaceSamples = [];
      const tunnelShellSamples = [];
      let upperPlaneOverstatement = 0;
      let minimumUpperSurfaceHeight = Number.POSITIVE_INFINITY;
      let maximumLowerSurfaceHeight = Number.NEGATIVE_INFINITY;
      for (let sampleIndex = 0; sampleIndex <= lowerSampleCount; sampleIndex++) {
        const lowerS = lowerStartS + (lowerEndS - lowerStartS) * sampleIndex / lowerSampleCount;
        const lowerFrame = sampleDraftPlanarFrame(crossing.lowerEdgeId, lowerS);
        const stationSurfaceSamples = [];
        for (const lateralRatio of [-1, 0, 1]) {
          const point = draftSurfacePoint(
            crossing.lowerEdgeId,
            lowerS,
            lowerFrame.roadHalf * lateralRatio
          );
          stationSurfaceSamples.push(point);
          surfaceSamples.push({ point });
        }
        const stationShellSamples = draftTunnelShellTopPoints(crossing.lowerEdgeId, lowerS);
        for (const point of stationShellSamples) tunnelShellSamples.push({ point });
        for (const point of [...stationSurfaceSamples, ...stationShellSamples]) {
          const planeHeight = upperCenter.y
            + gradientX * (point.x - upperCenter.x)
            + gradientZ * (point.z - upperCenter.z);
          const upperSurfaceHeight = draftSurfaceHeightNearPoint(
            crossing.upperEdgeId,
            crossing.upperEdgeS,
            upperMaskSpan,
            point.x,
            point.z
          );
          upperPlaneOverstatement = Math.max(
            upperPlaneOverstatement,
            planeHeight - upperSurfaceHeight
          );
          minimumUpperSurfaceHeight = Math.min(minimumUpperSurfaceHeight, upperSurfaceHeight);
          if (stationSurfaceSamples.includes(point)) {
            maximumLowerSurfaceHeight = Math.max(maximumLowerSurfaceHeight, point.y);
          }
        }
      }
      const curvatureTolerance = Math.max(0, upperPlaneOverstatement) + (
        Math.abs(upperCenter.curvature) > 0.000_001
          || Math.abs(upperCenter.grade) > 0.000_001
          || Math.abs(upperCenter.rightY) > 0.000_001
          ? 0.01
          : 0
      );
      const soffitOriginHeight = upperCenter.y - curvatureTolerance
        - CLOVERLEAF_DECK_THICKNESS - CLOVERLEAF_BRIDGE_BEAM_DEPTH;
      let clearance = Number.POSITIVE_INFINITY;
      for (const sample of surfaceSamples) {
        const planeHeight = upperCenter.y
          + gradientX * (sample.point.x - upperCenter.x)
          + gradientZ * (sample.point.z - upperCenter.z);
        const ceilingHeight = planeHeight - curvatureTolerance
          - CLOVERLEAF_DECK_THICKNESS - CLOVERLEAF_BRIDGE_BEAM_DEPTH;
        clearance = Math.min(clearance, ceilingHeight - sample.point.y);
      }
      let minimumTunnelShellGap = Number.POSITIVE_INFINITY;
      for (const sample of tunnelShellSamples) {
        const planeHeight = upperCenter.y
          + gradientX * (sample.point.x - upperCenter.x)
          + gradientZ * (sample.point.z - upperCenter.z);
        const ceilingHeight = planeHeight - curvatureTolerance
          - CLOVERLEAF_DECK_THICKNESS - CLOVERLEAF_BRIDGE_BEAM_DEPTH;
        minimumTunnelShellGap = Math.min(
          minimumTunnelShellGap,
          ceilingHeight - sample.point.y
        );
      }
      const soffitHeight = soffitOriginHeight
        + gradientX * (crossing.x - upperCenter.x)
        + gradientZ * (crossing.z - upperCenter.z);
      const requiredClearance = requiredCrossingClearance(crossing.lowerEdgeId);
      if (clearance < requiredClearance - 0.000_001) {
        throw new Error(
          `Cloverleaf full-width clearance is too small: ${crossing.id} (${clearance.toFixed(3)}m < ${requiredClearance.toFixed(3)}m)`
        );
      }
      if (Number.isFinite(minimumTunnelShellGap)
        && minimumTunnelShellGap < CLOVERLEAF_TUNNEL_SHELL_SAFETY_GAP - 0.000_001) {
        throw new Error(
          `Cloverleaf tunnel shell intersects an upper structure: ${crossing.id} (${
            minimumTunnelShellGap.toFixed(3)
          }m < ${CLOVERLEAF_TUNNEL_SHELL_SAFETY_GAP.toFixed(3)}m)`
        );
      }
      graphCrossings[index] = Object.freeze({
        ...crossing,
        upperMaskSpan,
        soffitHeight,
        soffitPlane: Object.freeze({
          originX: upperCenter.x,
          originZ: upperCenter.z,
          originHeight: soffitOriginHeight,
          gradientX,
          gradientZ,
          curvatureTolerance
        }),
        clearance,
        minimumTunnelShellGap: Number.isFinite(minimumTunnelShellGap)
          ? minimumTunnelShellGap
          : null,
        requiredClearance,
        minimumUpperSurfaceHeight,
        maximumLowerSurfaceHeight
      });
    }
    graphCrossingsByEdge.clear();
    for (const crossing of graphCrossings) {
      for (const edgeId of [crossing.lowerEdgeId, crossing.upperEdgeId]) {
        if (!graphCrossingsByEdge.has(edgeId)) graphCrossingsByEdge.set(edgeId, []);
        graphCrossingsByEdge.get(edgeId).push(crossing);
      }
    }
  }

  /** Register every planar conflict omitted by the historical central/weave allow-list. */
  function registerRemainingRoadCrossings() {
    const declaredPairs = new Set(graphCrossings.map((crossing) => (
      edgePairKey(crossing.lowerEdgeId, crossing.upperEdgeId)
    )));
    for (const intersection of graphPlanarIntersections) {
      if (declaredPairs.has(intersection.pairKey)) continue;
      const edgeAHeight = sampleHeight(
        graphEdgeDrafts.get(intersection.edgeAId),
        intersection.edgeAS
      ).height;
      const edgeBHeight = sampleHeight(
        graphEdgeDrafts.get(intersection.edgeBId),
        intersection.edgeBS
      ).height;
      if (Math.abs(edgeAHeight - edgeBHeight) <= 0.000_001) {
        throw new Error(`Cloverleaf planar conflict has no vertical ordering: ${intersection.pairKey}`);
      }
      const upperIsA = edgeAHeight > edgeBHeight;
      const upperEdgeId = upperIsA ? intersection.edgeAId : intersection.edgeBId;
      const lowerEdgeId = upperIsA ? intersection.edgeBId : intersection.edgeAId;
      const upperEdgeS = upperIsA ? intersection.edgeAS : intersection.edgeBS;
      const lowerEdgeS = upperIsA ? intersection.edgeBS : intersection.edgeAS;
      const maskSpan = crossingMaskSpan(
        upperEdgeId,
        upperEdgeS,
        lowerEdgeId,
        lowerEdgeS,
        CLOVERLEAF_WEAVE_MASK_SPAN
      );
      registerGraphCrossing({
        id: `crossing:${lowerEdgeId}:${upperEdgeId}`,
        upperEdgeId,
        lowerEdgeId,
        upperEdgeS,
        lowerEdgeS,
        clearance: edgeAHeight - edgeBHeight,
        deckHeight: Math.max(edgeAHeight, edgeBHeight),
        soffitDepth: CLOVERLEAF_BRIDGE_BEAM_DEPTH,
        maskSpan,
        structure: 'ramp-grade-separation',
        x: intersection.x,
        z: intersection.z
      });
      declaredPairs.add(intersection.pairKey);
    }
  }

  function registerCentralCrossings() {
    // The central bridge belongs to the shared outbound mainline after the loop merge, not to any one movement core.
    const lowerEdges = ['outbound-mid-north', 'outbound-mid-south'];
    const upperEdges = ['outbound-mid-east', 'outbound-mid-west'];
    for (const lowerEdgeId of lowerEdges) {
      const lowerSamples = graphEdgeSamples.get(lowerEdgeId);
      const lowerStart = lowerSamples[0];
      const lowerEnd = lowerSamples[lowerSamples.length - 1];
      for (const upperEdgeId of upperEdges) {
        const upperSamples = graphEdgeSamples.get(upperEdgeId);
        const upperStart = upperSamples[0];
        const upperEnd = upperSamples[upperSamples.length - 1];
        const crossingPoint = segmentIntersection(lowerStart, lowerEnd, upperStart, upperEnd);
        if (!crossingPoint) throw new Error(`Missing cloverleaf crossing ${lowerEdgeId}/${upperEdgeId}`);
        const maskSpan = crossingMaskSpan(
          upperEdgeId,
          crossingPoint.bS,
          lowerEdgeId,
          crossingPoint.aS,
          CLOVERLEAF_CROSSING_MASK_SPAN
        );
        const crossing = Object.freeze({
          id: `crossing:${lowerEdgeId}:${upperEdgeId}`,
          upperEdgeId,
          lowerEdgeId,
          upperEdgeS: crossingPoint.bS,
          lowerEdgeS: crossingPoint.aS,
          clearance: CLOVERLEAF_UPPER_HEIGHT - CLOVERLEAF_DECK_THICKNESS
            - CLOVERLEAF_BRIDGE_BEAM_DEPTH - CLOVERLEAF_LOWER_HEIGHT,
          deckHeight: CLOVERLEAF_UPPER_HEIGHT,
          soffitDepth: CLOVERLEAF_BRIDGE_BEAM_DEPTH,
          maskSpan,
          x: crossingPoint.x,
          z: crossingPoint.z
        });
        graphCrossings.push(crossing);
        for (const edgeId of [lowerEdgeId, upperEdgeId]) {
          if (!graphCrossingsByEdge.has(edgeId)) graphCrossingsByEdge.set(edgeId, []);
          graphCrossingsByEdge.get(edgeId).push(crossing);
        }
      }
    }
  }

  /** Give every direct ramp a covered mountainside gallery while leaving its proven surface profile unchanged. */
  function registerMountainTunnels() {
    for (const edge of graphEdgeDrafts.values()) {
      if (edge.family !== 'direct-ramp') continue;
      edge.tunnelProfiles.push(Object.freeze({
        id: `mountain-tunnel:${edge.id}`,
        kind: 'mountain-tunnel',
        label: '山体多孔隧道',
        startS: edge.length * 0.18,
        endS: edge.length * 0.84,
        portalBlend: CLOVERLEAF_TUNNEL_PORTAL_BLEND,
        portalFrameDepth: CLOVERLEAF_TUNNEL_PORTAL_FRAME_DEPTH,
        clearance: CLOVERLEAF_MOUNTAIN_TUNNEL_CLEARANCE,
        roofInset: CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_INSET,
        roofDepth: CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_DEPTH,
        multiOpeningGallery: true
      }));
    }
  }

  function heightSegment(kind, startS, endS, startHeight, endHeight, options = {}) {
    if (!(endS > startS)) throw new Error(`Tunnel height segment is not positive: ${kind}`);
    return Object.freeze({ kind, startS, endS, startHeight, endHeight, ...options });
  }

  function validateSmoothStepGrade(edgeId, segment) {
    const span = segment.endS - segment.startS;
    const transition = segment.profile === 'grade-limited-c2'
      ? Math.min(segment.transitionLength, span * 0.5)
      : 0;
    const maximumGrade = segment.profile === 'grade-limited-c2'
      ? Math.abs(segment.endHeight - segment.startHeight)
        / Math.max(0.000_001, span - transition)
      : Math.abs(segment.endHeight - segment.startHeight) * 1.875 / span;
    if (maximumGrade > CLOVERLEAF_MAXIMUM_GRADE + 0.000_001) {
      throw new Error(
        `Cloverleaf grade exceeds six percent: ${edgeId}/${segment.kind} (${maximumGrade.toFixed(6)})`
      );
    }
  }

  /** Integrate a constant-grade middle with quintic slope easing so the bridge ramp is C2 and grade-limited. */
  function sampleGradeLimitedRamp(heightDelta, distance, span, transitionLength) {
    const transition = Math.min(transitionLength, span * 0.5);
    const maximumSlope = heightDelta / Math.max(0.000_001, span - transition);
    const rampIntegral = (t) => t ** 6 - 3 * t ** 5 + 2.5 * t ** 4;
    if (distance < transition) {
      const t = clamp(distance / transition, 0, 1);
      return {
        height: maximumSlope * transition * rampIntegral(t),
        grade: maximumSlope * smootherStep01(t)
      };
    }
    if (distance <= span - transition) {
      return {
        height: maximumSlope * (transition * 0.5 + distance - transition),
        grade: maximumSlope
      };
    }
    const remaining = span - distance;
    const t = clamp(remaining / transition, 0, 1);
    return {
      height: heightDelta - maximumSlope * transition * rampIntegral(t),
      grade: maximumSlope * smootherStep01(t)
    };
  }

  function validateGradeLimitedFeature(edgeId, feature) {
    const spans = [
      feature.riseEndS - feature.startS,
      feature.endS - feature.fallStartS
    ];
    for (const [index, span] of spans.entries()) {
      const transition = Math.min(feature.transitionLength, span * 0.5);
      const maximumGrade = Math.abs(feature.heightDelta)
        / Math.max(0.000_001, span - transition);
      if (maximumGrade > CLOVERLEAF_MAXIMUM_GRADE + 0.000_001) {
        const phase = index === 0 ? 'rise' : 'fall';
        throw new Error(
          `Cloverleaf grade-limited feature exceeds six percent: ${edgeId}/${phase} (${maximumGrade.toFixed(6)})`
        );
      }
    }
  }

  /**
   * Grade-separate collector/loop conflicts as covered lower roads. Upper-to-lower loops first climb onto a
   * validated flyover plateau covering every early ramp conflict, then descend into the collector tunnel.
   * All transitions are C2 smooth and are rejected at construction time if their grade exceeds six percent.
   */
  function registerWeaveTunnels() {
    const crossingPairs = [
      ['collector-south', 'loop-west-north'],
      ['collector-east', 'loop-south-west'],
      ['collector-north', 'loop-east-south'],
      ['collector-west', 'loop-north-east']
    ];
    for (const [collectorEdgeId, loopEdgeId] of crossingPairs) {
      const intersection = sampledEdgeIntersection(collectorEdgeId, loopEdgeId);
      if (!intersection) throw new Error(`Missing cloverleaf weave crossing ${collectorEdgeId}/${loopEdgeId}`);
      const collectorEdge = graphEdgeDrafts.get(collectorEdgeId);
      const loopEdge = graphEdgeDrafts.get(loopEdgeId);
      const maskSpan = crossingMaskSpan(
        collectorEdgeId,
        intersection.edgeAS,
        loopEdgeId,
        intersection.edgeBS,
        CLOVERLEAF_WEAVE_MASK_SPAN
      );
      const halfMask = maskSpan * 0.5;
      const crossingStartS = intersection.edgeBS - halfMask;
      const crossingEndS = intersection.edgeBS + halfMask;
      const startHeight = loopEdge.heightProfile.startHeight;
      const endHeight = loopEdge.heightProfile.endHeight;
      if (!(crossingStartS > 0 && crossingEndS < loopEdge.length)) {
        throw new Error(`Cloverleaf tunnel has no safe grade envelope: ${loopEdgeId}`);
      }
      let segments;
      if (startHeight > CLOVERLEAF_LOWER_HEIGHT) {
        const earlyConflicts = graphPlanarIntersections.flatMap((candidate) => {
          const loopIsA = candidate.edgeAId === loopEdgeId;
          const loopIsB = candidate.edgeBId === loopEdgeId;
          if (!loopIsA && !loopIsB) return [];
          const otherEdgeId = loopIsA ? candidate.edgeBId : candidate.edgeAId;
          if (otherEdgeId === collectorEdgeId) return [];
          const loopS = loopIsA ? candidate.edgeAS : candidate.edgeBS;
          const otherS = loopIsA ? candidate.edgeBS : candidate.edgeAS;
          if (loopS >= intersection.edgeBS - halfMask) return [];
          const conflictSpan = crossingMaskSpan(
            otherEdgeId,
            otherS,
            loopEdgeId,
            loopS,
            CLOVERLEAF_WEAVE_MASK_SPAN
          );
          return [{ loopS, conflictSpan }];
        });
        if (earlyConflicts.length === 0) {
          throw new Error(`Upper cloverleaf loop has no enumerated flyover conflicts: ${loopEdgeId}`);
        }
        const earliestConflictStartS = Math.min(
          ...earlyConflicts.map((conflict) => conflict.loopS - conflict.conflictSpan * 0.5)
        );
        const minimumRiseLength = (CLOVERLEAF_FLYOVER_HEIGHT - startHeight)
          * 1.875 / CLOVERLEAF_MAXIMUM_GRADE;
        const plateauStartS = Math.max(
          1,
          earliestConflictStartS - CLOVERLEAF_FLYOVER_CONFLICT_MARGIN,
          minimumRiseLength + 0.01
        );
        const plateauEndS = Math.max(
          ...earlyConflicts.map((conflict) => conflict.loopS + conflict.conflictSpan * 0.5)
        ) + CLOVERLEAF_FLYOVER_CONFLICT_MARGIN;
        if (!(plateauStartS < earliestConflictStartS
          && plateauStartS < plateauEndS
          && plateauEndS < crossingStartS)) {
          throw new Error(`Upper cloverleaf loop cannot fit its flyover/descent envelope: ${loopEdgeId}`);
        }
        segments = [
          heightSegment('flyover-rise', 0, plateauStartS, startHeight, CLOVERLEAF_FLYOVER_HEIGHT),
          heightSegment(
            'flyover-level',
            plateauStartS,
            plateauEndS,
            CLOVERLEAF_FLYOVER_HEIGHT,
            CLOVERLEAF_FLYOVER_HEIGHT
          ),
          heightSegment(
            'tunnel-descent',
            plateauEndS,
            crossingStartS,
            CLOVERLEAF_FLYOVER_HEIGHT,
            CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
            {
              profile: 'grade-limited-c2',
              transitionLength: CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH
            }
          )
        ];
      } else {
        const basinDescentStartS = CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH
          + CLOVERLEAF_TUNNEL_JUNCTION_MARGIN;
        const minimumBasinDescentLength = Math.abs(
          startHeight - CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT
        ) / CLOVERLEAF_MAXIMUM_GRADE + CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH;
        const basinDescentEndS = basinDescentStartS + Math.max(64, minimumBasinDescentLength);
        if (!(basinDescentEndS < crossingStartS)) {
          throw new Error(`Lower cloverleaf loop cannot reach its tunnel basin: ${loopEdgeId}`);
        }
        segments = [
          heightSegment(
            'split-level',
            0,
            basinDescentStartS,
            startHeight,
            startHeight
          ),
          heightSegment(
            'tunnel-descent',
            basinDescentStartS,
            basinDescentEndS,
            startHeight,
            CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
            {
              profile: 'grade-limited-c2',
              transitionLength: CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH
            }
          ),
          heightSegment(
          'underground-level',
            basinDescentEndS,
            crossingStartS,
            CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
            CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT
          )
        ];
      }
      segments.push(heightSegment(
        'collector-underpass-level',
        crossingStartS,
        crossingEndS,
        CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
        CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT
      ));
      const mergeLevelStartS = loopEdge.length - CLOVERLEAF_LOOP_MERGE_LEVEL_LENGTH;
      if (!(mergeLevelStartS > crossingEndS)) {
        throw new Error(`Cloverleaf loop cannot contain the shared merge throat: ${loopEdgeId}`);
      }
      segments.push(heightSegment(
        'tunnel-ascent',
        crossingEndS,
        mergeLevelStartS,
        CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
        endHeight,
        {
          profile: 'grade-limited-c2',
          transitionLength: CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH
        }
      ));
      segments.push(heightSegment(
        'merge-level',
        mergeLevelStartS,
        loopEdge.length,
        endHeight,
        endHeight
      ));
      for (const segment of segments) validateSmoothStepGrade(loopEdgeId, segment);
      loopEdge.heightProfile = Object.freeze({
        startHeight,
        endHeight,
        startS: 0,
        endS: loopEdge.length,
        gradeLength: 0,
        mode: 'piecewise-tunnel',
        segments: Object.freeze(segments)
      });
      loopEdge.tunnelProfiles.push(Object.freeze({
        id: `underground-tunnel:${loopEdge.id}`,
        kind: 'underground-tunnel',
        label: '地下分层隧道',
        startS: 48,
        endS: loopEdge.length - 36,
        portalBlend: CLOVERLEAF_TUNNEL_PORTAL_BLEND,
        portalFrameDepth: CLOVERLEAF_TUNNEL_PORTAL_FRAME_DEPTH,
        clearance: CLOVERLEAF_TUNNEL_CLEARANCE,
        roadShoulderJoin: CLOVERLEAF_ROAD_SHELL_SHOULDER_JOIN,
        wallInset: CLOVERLEAF_UNDERGROUND_WALL_INSET,
        wallThickness: CLOVERLEAF_UNDERGROUND_WALL_THICKNESS,
        roofInset: CLOVERLEAF_UNDERGROUND_ROOF_INSET,
        roofOverhang: CLOVERLEAF_UNDERGROUND_ROOF_OVERHANG,
        roofDepth: CLOVERLEAF_UNDERGROUND_ROOF_DEPTH,
        basinHeight: CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
        crossingHeight: CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
        crossingS: intersection.edgeBS,
        multiOpeningGallery: false
      }));

      const collectorBaseHeight = sampleHeight(collectorEdge, intersection.edgeAS).height;
      if (collectorBaseHeight < CLOVERLEAF_UPPER_HEIGHT - 0.000_001) {
        const feature = Object.freeze({
          kind: 'tunnel-overpass',
          profile: 'grade-limited-c2',
          centerS: intersection.edgeAS,
          // The first decision remains one level deck until the collector footprint clears the straight road.
          startS: CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH,
          riseEndS: intersection.edgeAS - halfMask,
          fallStartS: intersection.edgeAS + halfMask,
          // The final level interval is longer than the measured collector/turn overlap, so all three shells
          // present exactly the node height throughout their common footprint.
          endS: collectorEdge.length - CLOVERLEAF_COLLECTOR_LEVEL_END_LENGTH,
          transitionLength: CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH,
          heightDelta: CLOVERLEAF_TUNNEL_LEVEL_SEPARATION
        });
        validateGradeLimitedFeature(collectorEdge.id, feature);
        collectorEdge.verticalFeatures.push(feature);
      }
      const collectorHeight = sampleHeight(collectorEdge, intersection.edgeAS).height;
      const crossing = Object.freeze({
        id: `crossing:${loopEdgeId}:${collectorEdgeId}`,
        upperEdgeId: collectorEdgeId,
        lowerEdgeId: loopEdgeId,
        upperEdgeS: intersection.edgeAS,
        lowerEdgeS: intersection.edgeBS,
        clearance: collectorHeight - CLOVERLEAF_DECK_THICKNESS
          - CLOVERLEAF_BRIDGE_BEAM_DEPTH - CLOVERLEAF_LOWER_HEIGHT,
        deckHeight: collectorHeight,
        soffitDepth: CLOVERLEAF_BRIDGE_BEAM_DEPTH,
        maskSpan,
        structure: 'mountain-interchange-tunnel',
        x: intersection.x,
        z: intersection.z
      });
      if (crossing.clearance < CLOVERLEAF_TUNNEL_CLEARANCE) {
        throw new Error(`Cloverleaf tunnel clearance is too small: ${loopEdgeId}`);
      }
      graphCrossings.push(crossing);
      for (const edgeId of [loopEdgeId, collectorEdgeId]) {
        if (!graphCrossingsByEdge.has(edgeId)) graphCrossingsByEdge.set(edgeId, []);
        graphCrossingsByEdge.get(edgeId).push(crossing);
      }
    }
  }

  const CLOVERLEAF_JUNCTION_KINDS = new Set([
    'decision',
    'collector-decision',
    'loop-merge',
    'direct-merge'
  ]);

  function sampleDraftJunctionEdge(edge, startsAtNode, distance) {
    const planarS = startsAtNode
      ? Math.min(edge.length, distance)
      : Math.max(0, edge.length - distance);
    return sampleDraftPlanarFrame(edge.id, planarS);
  }

  /** Measure sibling surface overlap and the stricter plan envelope required by portal roofs and walls. */
  function siblingOverlapDistance(leftRecord, rightRecord) {
    const maximumDistance = Math.min(
      leftRecord.edge.length,
      rightRecord.edge.length,
      CLOVERLEAF_JUNCTION_MAXIMUM_SCAN
    );
    let lastOverlapDistance = 0;
    let lastSurfaceOverlapDistance = 0;
    let sawOverlap = false;
    let cleared = false;
    for (
      let distance = 0;
      distance <= maximumDistance + 0.000_001;
      distance += CLOVERLEAF_JUNCTION_SCAN_STEP
    ) {
      const left = sampleDraftJunctionEdge(leftRecord.edge, leftRecord.startsAtNode, distance);
      const right = sampleDraftJunctionEdge(rightRecord.edge, rightRecord.startsAtNode, distance);
      const overlaps = Math.hypot(left.x - right.x, left.z - right.z)
        <= left.roadHalf + right.roadHalf - 0.15;
      if (overlaps) {
        sawOverlap = true;
        lastOverlapDistance = distance;
        if (Math.abs(left.y - right.y) <= 0.75) lastSurfaceOverlapDistance = distance;
      } else if (sawOverlap) {
        cleared = true;
        break;
      }
    }
    if (!sawOverlap || !cleared) {
      throw new Error(`Cloverleaf sibling overlap did not clear: ${leftRecord.edge.id}/${rightRecord.edge.id}`);
    }
    return Object.freeze({ lastOverlapDistance, lastSurfaceOverlapDistance });
  }

  /**
   * Publish per-edge split/merge envelopes for renderer shells, tunnel clipping, and regression tests.
   * Every consumer must start structural geometry beyond `clearS`; otherwise sibling road ribbons can penetrate it.
   */
  function registerJunctionOverlapEnvelopes() {
    const nodeEnvelopes = [];
    for (const node of graphNodeDrafts.values()) {
      if (!CLOVERLEAF_JUNCTION_KINDS.has(node.kind)) continue;
      const incidentRecords = [...graphEdgeDrafts.values()]
        .filter((edge) => edge.from === node.id || edge.to === node.id)
        .map((edge) => ({ edge, startsAtNode: edge.from === node.id, pairs: [] }));
      if (incidentRecords.length !== 3) {
        throw new Error(`Cloverleaf junction must connect exactly three edges: ${node.id}`);
      }
      for (let leftIndex = 0; leftIndex < incidentRecords.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < incidentRecords.length; rightIndex++) {
          const left = incidentRecords[leftIndex];
          const right = incidentRecords[rightIndex];
          const overlap = siblingOverlapDistance(left, right);
          left.pairs.push(Object.freeze({
            siblingEdgeId: right.edge.id,
            ...overlap
          }));
          right.pairs.push(Object.freeze({
            siblingEdgeId: left.edge.id,
            ...overlap
          }));
        }
      }
      const edgeEnvelopes = incidentRecords.map((record) => {
        const clearPlanarDistance = Math.max(
          ...record.pairs.map((pair) => pair.lastOverlapDistance)
        ) + CLOVERLEAF_JUNCTION_CLEAR_MARGIN;
        if (clearPlanarDistance >= record.edge.length) {
          throw new Error(`Cloverleaf junction envelope consumes its edge: ${node.id}/${record.edge.id}`);
        }
        const endpoint = record.startsAtNode ? 'from' : 'to';
        const envelope = Object.freeze({
          nodeId: node.id,
          nodeKind: node.kind,
          edgeId: record.edge.id,
          endpoint,
          clearPlanarDistance,
          clearPlanarS: record.startsAtNode
            ? clearPlanarDistance
            : record.edge.length - clearPlanarDistance,
          overlapPairs: Object.freeze(record.pairs)
        });
        record.edge.junctionOverlapEnvelopes = record.edge.junctionOverlapEnvelopes || [];
        record.edge.junctionOverlapEnvelopes.push(envelope);
        return envelope;
      });
      nodeEnvelopes.push(Object.freeze({
        nodeId: node.id,
        nodeKind: node.kind,
        edgeEnvelopes: Object.freeze(edgeEnvelopes)
      }));
    }
    if (nodeEnvelopes.length !== 16) {
      throw new Error(`Cloverleaf junction envelope count is wrong: ${nodeEnvelopes.length}`);
    }
    graphJunctionOverlapEnvelopes = nodeEnvelopes;
  }

  /** Trim tunnel shells away from both connected junction envelopes while preserving one useful covered interval. */
  function trimTunnelProfilesToJunctionEnvelopes() {
    for (const edge of graphEdgeDrafts.values()) {
      if (!edge.tunnelProfiles.length) continue;
      const envelopes = edge.junctionOverlapEnvelopes || [];
      const fromEnvelope = envelopes.find((envelope) => envelope.endpoint === 'from');
      const toEnvelope = envelopes.find((envelope) => envelope.endpoint === 'to');
      edge.tunnelProfiles = edge.tunnelProfiles.map((profile) => {
        const startS = Math.max(
          profile.startS,
          (fromEnvelope?.clearPlanarS || 0) + CLOVERLEAF_TUNNEL_JUNCTION_MARGIN
        );
        const endS = Math.min(
          profile.endS,
          (toEnvelope?.clearPlanarS ?? edge.length) - CLOVERLEAF_TUNNEL_JUNCTION_MARGIN
        );
        if (endS - startS < profile.portalBlend * 2) {
          throw new Error(`Cloverleaf tunnel has no useful junction-safe interval: ${profile.id}`);
        }
        return Object.freeze({
          ...profile,
          startS,
          endS,
          junctionTrimmed: true
        });
      });
    }
  }

  /**
   * Prove each complete portal frame clears both sibling road shells. Centreline trimming alone misses the roof
   * overhang and the 2.4m-deep portal corners at a shallow split angle.
   */
  function validateTunnelPortalShellClearance() {
    const stationStep = 0.25;
    for (const edge of graphEdgeDrafts.values()) {
      if (!edge.tunnelProfiles.length) continue;
      const fromEnvelope = edge.junctionOverlapEnvelopes.find((envelope) => envelope.endpoint === 'from');
      const toEnvelope = edge.junctionOverlapEnvelopes.find((envelope) => envelope.endpoint === 'to');
      edge.tunnelProfiles = edge.tunnelProfiles.map((profile) => {
        const roofInset = Number(profile.roofInset) || 0;
        const roofTop = Number(profile.clearance) + Number(profile.roofDepth);
        const portalHalfDepth = Number(profile.portalFrameDepth) * 0.5;
        const gapAtPortal = (edgeS, envelope) => {
          const frame = sampleDraftPlanarFrame(edge.id, edgeS);
          const roofHalf = frame.roadHalf + roofInset;
          const portalCorners = [];
          for (const lateral of [-roofHalf, roofHalf]) {
            for (const vertical of [0, roofTop]) {
              for (const longitudinal of [-portalHalfDepth, portalHalfDepth]) {
                portalCorners.push({
                  x: frame.x + frame.rightX * lateral + frame.upX * vertical
                    + frame.tangentX * longitudinal,
                  z: frame.z + frame.rightZ * lateral + frame.upZ * vertical
                    + frame.tangentZ * longitudinal
                });
              }
            }
          }
          const nodeEnvelope = graphJunctionOverlapEnvelopes.find(
            (candidate) => candidate.nodeId === envelope.nodeId
          );
          let minimumGap = Number.POSITIVE_INFINITY;
          for (const pair of envelope.overlapPairs) {
            const siblingEdge = graphEdgeDrafts.get(pair.siblingEdgeId);
            const siblingEnvelope = nodeEnvelope.edgeEnvelopes.find(
              (candidate) => candidate.edgeId === pair.siblingEdgeId
            );
            const searchDistance = Math.min(
              siblingEdge.length,
              Math.max(envelope.clearPlanarDistance, siblingEnvelope.clearPlanarDistance)
                + CLOVERLEAF_TUNNEL_JUNCTION_MARGIN
                + CLOVERLEAF_TUNNEL_PORTAL_FRAME_DEPTH
                + 24
            );
            const sampleCount = Math.max(1, Math.ceil(searchDistance / stationStep));
            for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
              const endpointDistance = searchDistance * sampleIndex / sampleCount;
              const siblingS = siblingEnvelope.endpoint === 'from'
                ? endpointDistance
                : siblingEdge.length - endpointDistance;
              const siblingFrame = sampleDraftPlanarFrame(siblingEdge.id, siblingS);
              for (const corner of portalCorners) {
                minimumGap = Math.min(
                  minimumGap,
                  Math.hypot(corner.x - siblingFrame.x, corner.z - siblingFrame.z)
                    - siblingFrame.roadHalf - CLOVERLEAF_ROAD_SHELL_OUTER_MARGIN
                );
              }
            }
          }
          return minimumGap;
        };
        const portalStartSiblingGap = gapAtPortal(profile.startS, fromEnvelope);
        const portalEndSiblingGap = gapAtPortal(profile.endS, toEnvelope);
        const minimumPortalSiblingGap = Math.min(
          portalStartSiblingGap,
          portalEndSiblingGap
        );
        if (minimumPortalSiblingGap < CLOVERLEAF_TUNNEL_SHELL_SAFETY_GAP - 0.000_001) {
          throw new Error(
            `Cloverleaf tunnel portal intersects a sibling road: ${profile.id} (${
              minimumPortalSiblingGap.toFixed(3)
            }m < ${CLOVERLEAF_TUNNEL_SHELL_SAFETY_GAP.toFixed(3)}m)`
          );
        }
        return Object.freeze({
          ...profile,
          portalStartSiblingGap,
          portalEndSiblingGap,
          minimumPortalSiblingGap
        });
      });
    }
  }

  function surfaceSForPlanarSamples(samples, planarS) {
    const targetS = clamp(planarS, 0, samples[samples.length - 1].s);
    let low = 0;
    let high = samples.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (samples[middle].s <= targetS) low = middle;
      else high = middle;
    }
    const a = samples[low];
    const b = samples[Math.min(samples.length - 1, low + 1)];
    const span = b.s - a.s;
    const t = span > 0.000_001 ? (targetS - a.s) / span : 0;
    return a.surfaceS + (b.surfaceS - a.surfaceS) * t;
  }

  /** Locate the exact linear-interpolation station where braking-relevant curvature begins. */
  function firstCurvatureThresholdStation(stations, curvatures) {
    if (Math.abs(curvatures[0]) > CLOVERLEAF_CURVE_THRESHOLD) return stations[0];
    for (let index = 1; index < stations.length; index++) {
      const previousCurvature = curvatures[index - 1];
      const curvature = curvatures[index];
      if (Math.abs(curvature) <= CLOVERLEAF_CURVE_THRESHOLD) continue;
      const target = Math.sign(curvature) * CLOVERLEAF_CURVE_THRESHOLD;
      const delta = curvature - previousCurvature;
      const t = Math.abs(delta) > 0.000_000_001
        ? clamp((target - previousCurvature) / delta, 0, 1)
        : 1;
      return stations[index - 1] + (stations[index] - stations[index - 1]) * t;
    }
    return Number.POSITIVE_INFINITY;
  }

  /** Precompute one typed curvature range per template edge; runtime tiles reuse it because translation preserves arc length. */
  function buildGraphCurvatureProfiles() {
    graphCurvatureProfiles.clear();
    for (const [edgeId, samples] of graphEdgeSamples) {
      const stations = new Float64Array(samples.length);
      const curvatures = new Float64Array(samples.length);
      let maxAbsCurvature = 0;
      let signedCurvature = 0;
      let peakS = 0;
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        stations[index] = sample.surfaceS;
        curvatures[index] = sample.curvature;
        if (Math.abs(sample.curvature) > maxAbsCurvature) {
          maxAbsCurvature = Math.abs(sample.curvature);
          signedCurvature = sample.curvature;
          peakS = sample.surfaceS;
        }
      }
      graphCurvatureProfiles.set(edgeId, Object.freeze({
        stations,
        curvatures,
        maxAbsCurvature,
        signedCurvature,
        peakS,
        firstCurveS: firstCurvatureThresholdStation(stations, curvatures)
      }));
    }
  }

  /** Public edge distance is true 3D centreline arc length; planar station remains internal to geometry profiles. */
  function reparameterizeGraphBySurfaceArcLength() {
    /*
     * A physical bridge span is one connected union of overlapping masks on the same upper edge. Keeping
     * disjoint masks separate prevents a decorative bridge from filling the road between unrelated crossings.
     */
    const upperSpanCandidates = new Map();
    for (const crossing of graphCrossings) {
      const upperEdge = graphEdgeDrafts.get(crossing.upperEdgeId);
      const upperMaskSpan = crossing.upperMaskSpan || crossingMaskSpan(
          crossing.lowerEdgeId,
          crossing.lowerEdgeS,
          crossing.upperEdgeId,
          crossing.upperEdgeS,
          crossing.maskSpan
        );
      const startS = clamp(crossing.upperEdgeS - upperMaskSpan * 0.5, 0, upperEdge.length);
      const endS = clamp(crossing.upperEdgeS + upperMaskSpan * 0.5, 0, upperEdge.length);
      if (!upperSpanCandidates.has(crossing.upperEdgeId)) upperSpanCandidates.set(crossing.upperEdgeId, []);
      upperSpanCandidates.get(crossing.upperEdgeId).push({ crossingId: crossing.id, startS, endS });
    }
    const upperPlanarSpansByCrossing = new Map();
    for (const [upperEdgeId, candidates] of upperSpanCandidates) {
      candidates.sort((left, right) => left.startS - right.startS || left.endS - right.endS);
      const clusters = [];
      for (const candidate of candidates) {
        const cluster = clusters.at(-1);
        if (cluster && candidate.startS <= cluster.endS + 0.000_001) {
          cluster.endS = Math.max(cluster.endS, candidate.endS);
          cluster.crossingIds.push(candidate.crossingId);
        } else {
          clusters.push({
            startS: candidate.startS,
            endS: candidate.endS,
            crossingIds: [candidate.crossingId]
          });
        }
      }
      for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
        const cluster = clusters[clusterIndex];
        for (const crossingId of cluster.crossingIds) {
          upperPlanarSpansByCrossing.set(crossingId, Object.freeze({
            id: `physical-span:${upperEdgeId}:${clusterIndex}`,
            startS: cluster.startS,
            endS: cluster.endS
          }));
        }
      }
    }
    for (const edge of graphEdgeDrafts.values()) {
      const samples = graphEdgeSamples.get(edge.id);
      let surfaceS = 0;
      let previousHeight = sampleHeight(edge, samples[0].s).height;
      samples[0].surfaceS = 0;
      for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1];
        const point = samples[index];
        const height = sampleHeight(edge, point.s).height;
        surfaceS += Math.hypot(point.x - previous.x, height - previousHeight, point.z - previous.z);
        point.surfaceS = surfaceS;
        previousHeight = height;
      }
      edge.planarLength = edge.length;
      edge.length = surfaceS;
      edge.tunnelProfiles = edge.tunnelProfiles.map((profile) => Object.freeze({
        ...profile,
        surfaceStartS: surfaceSForPlanarSamples(samples, profile.startS),
        surfaceEndS: surfaceSForPlanarSamples(samples, profile.endS),
        surfaceCrossingS: Number.isFinite(profile.crossingS)
          ? surfaceSForPlanarSamples(samples, profile.crossingS)
          : null
      }));
      edge.junctionOverlapEnvelopes = Object.freeze((edge.junctionOverlapEnvelopes || []).map((envelope) => {
        const clearS = surfaceSForPlanarSamples(samples, envelope.clearPlanarS);
        return Object.freeze({
          ...envelope,
          clearS,
          clearDistance: envelope.endpoint === 'from' ? clearS : edge.length - clearS
        });
      }));
    }
    graphJunctionOverlapEnvelopes = graphJunctionOverlapEnvelopes.map((nodeEnvelope) => Object.freeze({
      ...nodeEnvelope,
      edgeEnvelopes: Object.freeze(nodeEnvelope.edgeEnvelopes.map((envelope) => {
        const edge = graphEdgeDrafts.get(envelope.edgeId);
        return edge.junctionOverlapEnvelopes.find((candidate) => candidate.nodeId === envelope.nodeId);
      }))
    }));
    for (let index = 0; index < graphCrossings.length; index++) {
      const crossing = graphCrossings[index];
      const lowerSamples = graphEdgeSamples.get(crossing.lowerEdgeId);
      const upperSamples = graphEdgeSamples.get(crossing.upperEdgeId);
      const lowerEdge = graphEdgeDrafts.get(crossing.lowerEdgeId);
      const lowerSpanStartPlanarS = clamp(
        crossing.lowerEdgeS - crossing.maskSpan * 0.5,
        0,
        lowerEdge.planarLength
      );
      const lowerSpanEndPlanarS = clamp(
        crossing.lowerEdgeS + crossing.maskSpan * 0.5,
        0,
        lowerEdge.planarLength
      );
      const upperPlanarSpan = upperPlanarSpansByCrossing.get(crossing.id);
      graphCrossings[index] = Object.freeze({
        ...crossing,
        physicalSpanId: upperPlanarSpan.id,
        lowerPlanarS: crossing.lowerEdgeS,
        upperPlanarS: crossing.upperEdgeS,
        lowerEdgeS: surfaceSForPlanarSamples(lowerSamples, crossing.lowerEdgeS),
        upperEdgeS: surfaceSForPlanarSamples(upperSamples, crossing.upperEdgeS),
        lowerSpanStartS: surfaceSForPlanarSamples(lowerSamples, lowerSpanStartPlanarS),
        lowerSpanEndS: surfaceSForPlanarSamples(lowerSamples, lowerSpanEndPlanarS),
        upperSpanStartS: surfaceSForPlanarSamples(upperSamples, upperPlanarSpan.startS),
        upperSpanEndS: surfaceSForPlanarSamples(upperSamples, upperPlanarSpan.endS)
      });
    }
    graphCrossingsByEdge.clear();
    for (const crossing of graphCrossings) {
      for (const edgeId of [crossing.lowerEdgeId, crossing.upperEdgeId]) {
        if (!graphCrossingsByEdge.has(edgeId)) graphCrossingsByEdge.set(edgeId, []);
        graphCrossingsByEdge.get(edgeId).push(crossing);
      }
    }
    for (const movement of graphMovementDrafts.values()) {
      let length = 0;
      movement.cumulativeLengths = Object.freeze(movement.edgeIds.map((edgeId) => {
        const startS = length;
        length += graphEdgeDrafts.get(edgeId).length;
        return startS;
      }));
      movement.length = length;
    }
  }

  function buildIntersectionAudit() {
    const crossingByPair = new Map();
    for (const crossing of graphCrossings) {
      const pairKey = edgePairKey(crossing.lowerEdgeId, crossing.upperEdgeId);
      if (crossingByPair.has(pairKey)) throw new Error(`Duplicate cloverleaf crossing contract: ${pairKey}`);
      crossingByPair.set(pairKey, crossing);
    }
    const intersections = graphPlanarIntersections.map((intersection) => {
      const crossing = crossingByPair.get(intersection.pairKey) || null;
      return Object.freeze({
        id: intersection.id,
        pairKey: intersection.pairKey,
        edgeAId: intersection.edgeAId,
        edgeBId: intersection.edgeBId,
        edgeAPlanarS: intersection.edgeAS,
        edgeBPlanarS: intersection.edgeBS,
        x: intersection.x,
        z: intersection.z,
        declared: Boolean(crossing),
        crossingId: crossing?.id || null
      });
    });
    const undeclaredIntersectionCount = intersections.filter((intersection) => !intersection.declared).length;
    graphIntersectionAudit = Object.freeze({
      planarIntersectionCount: intersections.length,
      declaredIntersectionCount: crossingByPair.size,
      undeclaredIntersectionCount,
      physicalSpanCount: new Set(graphCrossings.map((crossing) => crossing.physicalSpanId)).size,
      minimumFullWidthClearance: Math.min(...graphCrossings.map((crossing) => crossing.clearance)),
      minimumTunnelShellGap: Math.min(
        ...graphCrossings
          .map((crossing) => crossing.minimumTunnelShellGap)
          .filter(Number.isFinite)
      ),
      intersections: Object.freeze(intersections)
    });
    if (undeclaredIntersectionCount !== 0 || crossingByPair.size !== intersections.length) {
      throw new Error('Cloverleaf planar intersection audit is incomplete');
    }
  }

  buildCloverleafGraphDrafts();
  graphPlanarIntersections = enumerateNonNodePlanarIntersections();
  if (graphPlanarIntersections.length !== CLOVERLEAF_EXPECTED_PLANAR_INTERSECTION_COUNT) {
    throw new Error(`Unexpected cloverleaf planar intersection count: ${graphPlanarIntersections.length}`);
  }
  registerCentralCrossings();
  registerMountainTunnels();
  registerWeaveTunnels();
  registerRemainingRoadCrossings();
  applyConservativeCrossingEnvelopes();
  registerJunctionOverlapEnvelopes();
  trimTunnelProfilesToJunctionEnvelopes();
  validateTunnelPortalShellClearance();
  reparameterizeGraphBySurfaceArcLength();
  buildIntersectionAudit();
  buildGraphCurvatureProfiles();

  const graphNodes = Object.freeze([...graphNodeDrafts.values()].map((node) => Object.freeze({
    ...node,
    pose: Object.freeze({ position: node.world, heading: node.heading, elevation: node.elevation }),
    inEdges: Object.freeze([...node.inEdges]),
    outEdges: Object.freeze([...node.outEdges]),
    outgoingEdgeIds: Object.freeze([...node.outEdges])
  })));
  const graphEdges = Object.freeze([...graphEdgeDrafts.values()].map((edge) => Object.freeze({
    ...edge,
    nodes: Object.freeze([edge.from, edge.to]),
    halfWidth: edge.roadHalf,
    verticalFeatures: Object.freeze([...edge.verticalFeatures]),
    tunnelProfiles: Object.freeze([...edge.tunnelProfiles]),
    junctionOverlapEnvelopes: Object.freeze([...(edge.junctionOverlapEnvelopes || [])]),
    successors: Object.freeze([...edge.successors])
  })));
  const graphMovements = Object.freeze([...graphMovementDrafts.values()].map((movement) => Object.freeze({
    ...movement,
    edgeIds: Object.freeze([...movement.edgeIds])
  })));
  const graphNodesById = Object.freeze(Object.fromEntries(graphNodes.map((node) => [node.id, node])));
  const graphEdgesById = Object.freeze(Object.fromEntries(graphEdges.map((edge) => [edge.id, edge])));
  const graphMovementsById = Object.freeze(Object.fromEntries(graphMovements.map((movement) => [movement.id, movement])));
  const graphBounds = Object.freeze(graphEdges.reduce((bounds, edge) => ({
    minX: Math.min(bounds.minX, edge.bounds.minX),
    maxX: Math.max(bounds.maxX, edge.bounds.maxX),
    minZ: Math.min(bounds.minZ, edge.bounds.minZ),
    maxZ: Math.max(bounds.maxZ, edge.bounds.maxZ)
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  }));
  const cloverleafGraph = Object.freeze({
    version: CLOVERLEAF_GRAPH_VERSION,
    ports: CLOVERLEAF_PORTS,
    nodes: graphNodes,
    nodesById: graphNodesById,
    edges: graphEdges,
    edgesById: graphEdgesById,
    crossings: Object.freeze(graphCrossings),
    intersectionAudit: graphIntersectionAudit,
    junctionOverlapEnvelopes: Object.freeze(graphJunctionOverlapEnvelopes),
    movements: graphMovements,
    movementsById: graphMovementsById,
    bounds: graphBounds,
    contract: Object.freeze({
      portDistance: CLOVERLEAF_PORT_DISTANCE,
      decisionDistance: CLOVERLEAF_DECISION_DISTANCE,
      decisionApproach: CLOVERLEAF_DECISION_APPROACH,
      collectorLength: CLOVERLEAF_COLLECTOR_LENGTH,
      collectorOffset: CLOVERLEAF_COLLECTOR_OFFSET,
      collectorTangent: CLOVERLEAF_COLLECTOR_TANGENT,
      lowerHeight: CLOVERLEAF_LOWER_HEIGHT,
      upperHeight: CLOVERLEAF_UPPER_HEIGHT,
      deckThickness: CLOVERLEAF_DECK_THICKNESS,
      bridgeBeamDepth: CLOVERLEAF_BRIDGE_BEAM_DEPTH,
      minimumVerticalClearance: CLOVERLEAF_UPPER_HEIGHT - CLOVERLEAF_DECK_THICKNESS
        - CLOVERLEAF_BRIDGE_BEAM_DEPTH,
      directRadius: CLOVERLEAF_DIRECT_RADIUS,
      loopRadius: CLOVERLEAF_LOOP_RADIUS,
      transitionLength: CLOVERLEAF_TRANSITION_LENGTH,
      bridgePierRadius: CLOVERLEAF_BRIDGE_PIER_RADIUS,
      bridgeSupportRadius: CLOVERLEAF_BRIDGE_SUPPORT_RADIUS,
      bridgeRoadGap: CLOVERLEAF_BRIDGE_ROAD_GAP,
      bridgeSupportGap: CLOVERLEAF_BRIDGE_SUPPORT_GAP,
      roadShellOuterMargin: CLOVERLEAF_ROAD_SHELL_OUTER_MARGIN,
      roadShellShoulderJoin: CLOVERLEAF_ROAD_SHELL_SHOULDER_JOIN,
      tunnelClearance: CLOVERLEAF_TUNNEL_CLEARANCE,
      undergroundTunnelBasinHeight: CLOVERLEAF_UNDERGROUND_BASIN_HEIGHT,
      undergroundTunnelWallInset: CLOVERLEAF_UNDERGROUND_WALL_INSET,
      undergroundTunnelWallThickness: CLOVERLEAF_UNDERGROUND_WALL_THICKNESS,
      undergroundTunnelRoofInset: CLOVERLEAF_UNDERGROUND_ROOF_INSET,
      undergroundTunnelRoofOverhang: CLOVERLEAF_UNDERGROUND_ROOF_OVERHANG,
      undergroundTunnelRoofDepth: CLOVERLEAF_UNDERGROUND_ROOF_DEPTH,
      tunnelShellSafetyGap: CLOVERLEAF_TUNNEL_SHELL_SAFETY_GAP,
      tunnelPortalFrameDepth: CLOVERLEAF_TUNNEL_PORTAL_FRAME_DEPTH,
      mountainTunnelClearance: CLOVERLEAF_MOUNTAIN_TUNNEL_CLEARANCE,
      mountainTunnelRoofDepth: CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_DEPTH,
      mountainTunnelRoofInset: CLOVERLEAF_MOUNTAIN_TUNNEL_ROOF_INSET,
      tunnelLevelSeparation: CLOVERLEAF_TUNNEL_LEVEL_SEPARATION,
      flyoverHeight: CLOVERLEAF_FLYOVER_HEIGHT,
      maximumGrade: CLOVERLEAF_MAXIMUM_GRADE,
      turnSplitHeightPolicy: 'upper-collector-flyover-throat',
      sharedJunctionThroatLength: CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH,
      turnBranchGradeStartDistance: CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH,
      mergeGradeEndDistance: CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH,
      loopMergeLevelLength: CLOVERLEAF_LOOP_MERGE_LEVEL_LENGTH,
      collectorGradeStartDistance: CLOVERLEAF_COLLECTOR_GRADE_START,
      collectorGradeEndMargin: CLOVERLEAF_COLLECTOR_GRADE_END_MARGIN,
      collectorLevelEndLength: CLOVERLEAF_COLLECTOR_LEVEL_END_LENGTH,
      collectorFeatureEaseLength: CLOVERLEAF_COLLECTOR_FEATURE_EASE_LENGTH,
      lowerCollectorRiseStartDistance: CLOVERLEAF_SHARED_JUNCTION_THROAT_LENGTH,
      junctionSurfaceAuthority: 'level-overlap-edge-shells',
      planarIntersectionCount: CLOVERLEAF_EXPECTED_PLANAR_INTERSECTION_COUNT,
      junctionClearMargin: CLOVERLEAF_JUNCTION_CLEAR_MARGIN,
      tunnelJunctionMargin: CLOVERLEAF_TUNNEL_JUNCTION_MARGIN,
      selectableRouteTypes: Object.freeze(['surface', 'mountain-tunnel', 'underground-tunnel']),
      clearZoneEntityPolicy: 'no-obstacles-or-pickups',
      minimumRecoveryDistance: CLOVERLEAF_RECOVERY_LENGTH,
      recoveryExtensionStep: CLOVERLEAF_RECOVERY_EXTENSION,
      recentTileAvoidanceCount: CLOVERLEAF_RECENT_TILE_AVOIDANCE_COUNT,
      launchOffset: CLOVERLEAF_LAUNCH_OFFSET,
      launchRampHeight: RAMP_HEIGHT,
      initialTileCount: CLOVERLEAF_INITIAL_TILE_COUNT,
      distanceParameter: 'surface-arc-length-3d'
    })
  });

  /*
   * Runtime itinerary overlay.
   *
   * The immutable graph above remains the minimap/render template. Runtime tiles translate that template
   * after every selected exit, while path ids encode the exit history so divergent previews cannot alias.
   */
  const runtimeNodesById = new Map();
  const runtimeEdgesById = new Map();
  const runtimeMovementsById = new Map();
  const runtimeTilesByToken = new Map();
  // A tile token can prepare multiple cloverleaf exits, so recovery topology is keyed by token plus exit port.
  const runtimeRecoveryTopologiesByKey = new Map();
  const runtimeRecoveryForksByDecisionId = new Map();
  const bidirectionalVisualEdgesByTileToken = new Map();
  /*
   * Runtime topology is a CPU-side registry, not the three-resident GPU tile pool. Route candidates deliberately
   * register complete immutable alternatives, so ownership must be released explicitly after those candidates,
   * historical PathPlan prefixes, entities, and Film/landing residents stop referring to their tile tokens.
   */
  const runtimeTopologyLifecycle = {
    pruneRunCount: 0,
    retiredTileCount: 0,
    retiredNodeCount: 0,
    retiredEdgeCount: 0,
    retiredMovementCount: 0,
    retiredRecoveryTopologyCount: 0,
    retiredRecoveryForkCount: 0,
    retiredBidirectionalRecordCount: 0,
    compactedPathPlanCount: 0,
    compactedPathPlanTileCount: 0,
    compactedPathPlanEdgeCount: 0,
    lastLeaseTokenCount: 0,
    lastMinimumProtectedTileIndex: null,
    lastMaximumProtectedTileIndex: null,
    lastRetiredTileTokens: Object.freeze([]),
    maximumRegisteredTileCount: 0,
    maximumRegisteredNodeCount: 0,
    maximumRegisteredEdgeCount: 0,
    maximumRegisteredMovementCount: 0,
    maximumRegisteredRecoveryTopologyCount: 0,
    maximumRegisteredRecoveryForkCount: 0,
    maximumRegisteredBidirectionalRecordCount: 0,
    roadClearanceQueryCount: 0,
    roadClearanceLastCandidateCount: 0,
    roadClearanceMaximumCandidateCount: 0,
    visibleEdgeQueryCount: 0,
    visibleEdgeLastCandidateCount: 0,
    visibleEdgeMaximumCandidateCount: 0,
    runtimeTileIndexQueryCount: 0,
    runtimeTileIndexLastCandidateCount: 0,
    runtimeTileIndexMaximumCandidateCount: 0
  };

  /** Capture registry high-water marks at topology publication boundaries without retaining another object graph. */
  function recordRuntimeTopologyHighWater() {
    runtimeTopologyLifecycle.maximumRegisteredTileCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredTileCount,
      runtimeTilesByToken.size
    );
    runtimeTopologyLifecycle.maximumRegisteredNodeCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredNodeCount,
      runtimeNodesById.size
    );
    runtimeTopologyLifecycle.maximumRegisteredEdgeCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredEdgeCount,
      runtimeEdgesById.size
    );
    runtimeTopologyLifecycle.maximumRegisteredMovementCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredMovementCount,
      runtimeMovementsById.size
    );
    runtimeTopologyLifecycle.maximumRegisteredRecoveryTopologyCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredRecoveryTopologyCount,
      runtimeRecoveryTopologiesByKey.size
    );
    runtimeTopologyLifecycle.maximumRegisteredRecoveryForkCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredRecoveryForkCount,
      runtimeRecoveryForksByDecisionId.size
    );
    runtimeTopologyLifecycle.maximumRegisteredBidirectionalRecordCount = Math.max(
      runtimeTopologyLifecycle.maximumRegisteredBidirectionalRecordCount,
      bidirectionalVisualEdgesByTileToken.size
    );
  }
  const BIDIRECTIONAL_VISUAL_RUNTIME_KIND = 'bidirectional-visual';
  const BIDIRECTIONAL_OUTBOUND_EXTENSION = 'outbound-extension';
  const BIDIRECTIONAL_OPPOSING_INTERTILE = 'opposing-intertile';
  const OPPOSING_RECOVERY_PROXY = 'reverse-proxy';
  const OPPOSING_RECOVERY_CROSSOVER = 'crossover-flyover';
  // The complete 1,080m entry-side opposing ribbon remains exactly flat and straight so every visible landing
  // point maps onto the crossover without a positional or vertical snap. After that authority handoff, one
  // deliberate 720m C2 lane change makes the return to the main carriageway legible instead of smearing 24m of
  // displacement across the remaining 4.7km. The bridge rises for 360m before that lane change begins, so the
  // physical crossover occurs over the high crest instead of slicing through a live same-level carriageway.
  // The matching local flyover rises, crosses on a flat crest, and
  // returns to grade before the long ordinary approach; this is route geometry, not a camera-only flourish.
  const OPPOSING_CROSSOVER_LATERAL_STABILIZATION_LENGTH = CLOVERLEAF_DECISION_APPROACH;
  const OPPOSING_CROSSOVER_VERTICAL_STABILIZATION_LENGTH = CLOVERLEAF_DECISION_APPROACH;
  const OPPOSING_CROSSOVER_LATERAL_START_LENGTH = 1_440;
  const OPPOSING_CROSSOVER_LATERAL_TRANSITION_LENGTH = 720;
  const OPPOSING_CROSSOVER_VERTICAL_TRANSITION_LENGTH = 720;
  const OPPOSING_CROSSOVER_VERTICAL_PLATEAU_LENGTH = 240;
  const OPPOSING_CROSSOVER_CONNECTOR_ROAD_HALF = 5.6;
  const OPPOSING_CROSSOVER_WIDTH_TAPER_LENGTH = 120;
  const OPPOSING_CROSSOVER_LATERAL_ACCELERATION_RAMP_RATIO = 0.06;
  // At the real 280km/h manual third-gear ceiling, the worst-case 20m rise stays below 0.11g of vertical normal
  // acceleration and about 5.7% grade. The flat 240m crest makes the actual crossing structurally readable.
  const OPPOSING_CROSSOVER_VERTICAL_ACCELERATION_RAMP_RATIO = 0.035;
  const OPPOSING_CROSSOVER_PEAK_WORLD_Y = 20;
  const OPPOSING_CROSSOVER_MAX_BANK_RADIANS = Math.PI * 8 / 180;
  const OPPOSING_CROSSOVER_PROFILE_STEP = 2;
  const OPPOSING_CROSSOVER_CLEARANCE_STEP = 4;
  const OPPOSING_CROSSOVER_STRUCTURE_CONTRACT = Object.freeze({
    kind: 'continuous-box-girder',
    supportSpacingM: 88,
    fasciaSegmentM: 24,
    fasciaWidthM: 0.34,
    fasciaDepthM: 0.72,
    diaphragmDepthM: 0.20
  });
  const PORT_CODE = Object.freeze({ north: 'n', east: 'e', south: 's', west: 'w' });
  const OPPOSITE_PORT = Object.freeze({ north: 'south', east: 'west', south: 'north', west: 'east' });
  const TILE_HISTORY_DIGEST_VERSION = 'h1';
  const TILE_HISTORY_DIGEST_HEX_LENGTH = 32;

  function tileHistoryDigestLane(input, seed) {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index++) {
      hash = Math.imul(hash ^ input.charCodeAt(index), 0x0100_0193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85eb_ca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2_ae35);
    return (hash ^ (hash >>> 16)) >>> 0;
  }

  /**
   * Fold exit history into a deterministic 128-bit identity. Runtime only needs to distinguish simultaneously live
   * route alternatives; retaining the literal unbounded exit string made every live node/edge id grow with mileage.
   */
  function nextTileHistoryKey(previousHistoryKey, exitPort) {
    const input = `${TILE_HISTORY_DIGEST_VERSION}|${previousHistoryKey || 'origin'}|${PORT_CODE[exitPort] || 'o'}`;
    return `h${[
      tileHistoryDigestLane(input, 0x811c_9dc5),
      tileHistoryDigestLane(input, 0x9e37_79b9),
      tileHistoryDigestLane(input, 0x243f_6a88),
      tileHistoryDigestLane(input, 0xb7e1_5163)
    ].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
  }

  function tileToken(index, historyKey, initialEntryPort = null) {
    // Index zero has no exit history yet, so its entry must disambiguate the four public test/playable starts.
    const key = index === 0 ? PORT_CODE[initialEntryPort] || 'o' : historyKey || 'o';
    return `tile:${index}:${key}`;
  }

  function parseTileScopedId(id) {
    if (typeof id !== 'string') return null;
    const match = /^tile:(\d+):([a-z0-9]+):(.+)$/.exec(id);
    if (!match) return null;
    return {
      tileIndex: Number(match[1]),
      historyKey: match[2] === 'o' ? '' : match[2],
      token: `tile:${match[1]}:${match[2]}`,
      baseId: match[3]
    };
  }

  function scopedTemplateId(tile, baseId) {
    return tile.index === 0 ? baseId : `${tile.token}:${baseId}`;
  }

  function translatedBounds(bounds, offsetX, offsetZ) {
    return Object.freeze({
      minX: bounds.minX + offsetX,
      maxX: bounds.maxX + offsetX,
      minZ: bounds.minZ + offsetZ,
      maxZ: bounds.maxZ + offsetZ
    });
  }

  function physicalTileKey(centerX, centerZ) {
    return `${centerX.toFixed(3)},${centerZ.toFixed(3)}`;
  }

  function tileFootprint(centerX, centerZ) {
    return Object.freeze({
      minX: graphBounds.minX + centerX,
      maxX: graphBounds.maxX + centerX,
      minZ: graphBounds.minZ + centerZ,
      maxZ: graphBounds.maxZ + centerZ
    });
  }

  function footprintsOverlap(a, b) {
    return !(
      a.maxX <= b.minX
      || a.minX >= b.maxX
      || a.maxZ <= b.minZ
      || a.minZ >= b.maxZ
    );
  }

  /** Register routable template topology first, then attach separately flagged visual-only carriageways. */
  function registerRuntimeTile(tile) {
    if (runtimeTilesByToken.has(tile.token)) return runtimeTilesByToken.get(tile.token);
    const frozenTile = Object.freeze({
      ...tile,
      physicalKey: physicalTileKey(tile.centerX, tile.centerZ),
      footprint: tile.footprint || tileFootprint(tile.centerX, tile.centerZ)
    });
    runtimeTilesByToken.set(tile.token, frozenTile);
    if (tile.index === 0) {
      registerBidirectionalVisualEdges(frozenTile);
      return frozenTile;
    }
    for (const baseNode of graphNodes) {
      const id = scopedTemplateId(tile, baseNode.id);
      const world = freezePoint({
        x: baseNode.world.x + tile.centerX,
        y: baseNode.world.y,
        z: baseNode.world.z + tile.centerZ
      });
      runtimeNodesById.set(id, Object.freeze({
        ...baseNode,
        id,
        world,
        pose: Object.freeze({ position: world, heading: baseNode.heading, elevation: baseNode.elevation }),
        inEdges: Object.freeze(baseNode.inEdges.map((edgeId) => scopedTemplateId(tile, edgeId))),
        outEdges: Object.freeze(baseNode.outEdges.map((edgeId) => scopedTemplateId(tile, edgeId))),
        outgoingEdgeIds: Object.freeze(baseNode.outEdges.map((edgeId) => scopedTemplateId(tile, edgeId))),
        tileIndex: tile.index,
        tileToken: tile.token,
        templateNodeId: baseNode.id
      }));
    }
    for (const baseEdge of graphEdges) {
      const id = scopedTemplateId(tile, baseEdge.id);
      const from = scopedTemplateId(tile, baseEdge.from);
      const to = scopedTemplateId(tile, baseEdge.to);
      runtimeEdgesById.set(id, Object.freeze({
        ...baseEdge,
        id,
        from,
        to,
        nodes: Object.freeze([from, to]),
        // A route may revisit a physical tile with a new traversal id; collision identity remains tied to the road itself.
        surfaceId: frozenTile.physicalKey === '0.000,0.000'
          ? baseEdge.surfaceId
          : `surface:tile:${frozenTile.physicalKey}:${baseEdge.id}`,
        successors: Object.freeze(baseEdge.successors.map((edgeId) => scopedTemplateId(tile, edgeId))),
        bounds: translatedBounds(baseEdge.bounds, tile.centerX, tile.centerZ),
        tileIndex: tile.index,
        tileToken: tile.token,
        templateEdgeId: baseEdge.id,
        runtimeKind: 'template',
        supportSpanContract: null,
        offsetX: tile.centerX,
        offsetZ: tile.centerZ
      }));
    }
    for (const baseMovement of graphMovements) {
      const id = scopedTemplateId(tile, baseMovement.id);
      runtimeMovementsById.set(id, Object.freeze({
        ...baseMovement,
        id,
        movementId: id,
        edgeIds: Object.freeze(baseMovement.edgeIds.map((edgeId) => scopedTemplateId(tile, edgeId))),
        decisionNodeId: scopedTemplateId(tile, baseMovement.decisionNodeId),
        collectorDecisionNodeId: baseMovement.collectorDecisionNodeId
          ? scopedTemplateId(tile, baseMovement.collectorDecisionNodeId)
          : null,
        tileIndex: tile.index,
        tileToken: tile.token,
        templateMovementId: baseMovement.id
      }));
    }
    registerBidirectionalVisualEdges(frozenTile);
    return frozenTile;
  }

  function createRuntimeNode(id, kind, point, heading, tile, extra = {}) {
    if (runtimeNodesById.has(id)) return runtimeNodesById.get(id);
    const world = freezePoint(point);
    const node = Object.freeze({
      ...extra,
      id,
      kind,
      world,
      pose: Object.freeze({ position: world, heading, elevation: world.y }),
      heading,
      elevation: world.y,
      inEdges: Object.freeze([]),
      outEdges: Object.freeze([]),
      outgoingEdgeIds: Object.freeze([]),
      exitCode: null,
      entryPort: null,
      tileIndex: tile.index,
      tileToken: tile.token
    });
    runtimeNodesById.set(id, node);
    return node;
  }

  function templateNodeForTile(tile, baseNodeId) {
    const node = tile.index === 0
      ? graphNodesById[baseNodeId]
      : runtimeNodesById.get(scopedTemplateId(tile, baseNodeId));
    if (!node) throw new Error(`Missing runtime tile node ${baseNodeId} for ${tile.token}`);
    return node;
  }

  /**
   * Register one flat road ribbon that render/map consumers may sample but gameplay can never select.
   * Empty successors plus `gameplaySurface: false` keep the edge outside routing and collision authority;
   * the edge remains in the global clearance union so scenery cannot occupy a visibly paved carriageway.
   */
  function createBidirectionalVisualEdge({ id, from, to, start, end, family, visualKind, tile, port }) {
    if (runtimeEdgesById.has(id)) return runtimeEdgesById.get(id);
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (!(length > 0.000_001) || Math.abs(end.y - start.y) > 0.000_001) {
      throw new Error(`Bidirectional visual edge must be a non-zero flat line: ${id}`);
    }
    const heading = Math.atan2(end.z - start.z, end.x - start.x);
    const edge = Object.freeze({
      id,
      from,
      to,
      nodes: Object.freeze([from, to]),
      family,
      maneuver: visualKind,
      entryPort: visualKind === BIDIRECTIONAL_OPPOSING_INTERTILE ? tile.entryPort : null,
      exitPort: port,
      length,
      planarLength: length,
      roadHalf: CLOVERLEAF_MAIN_ROAD_HALF,
      halfWidth: CLOVERLEAF_MAIN_ROAD_HALF,
      speedLimit: ROAD_SPEED_LIMITS_MPS.mainline,
      geometrySegments: Object.freeze([Object.freeze({ kind: 'line', length })]),
      heightProfile: Object.freeze({
        startHeight: start.y,
        endHeight: end.y,
        startS: 0,
        endS: length,
        gradeLength: 0
      }),
      verticalFeatures: Object.freeze([]),
      bankProfile: Object.freeze({ maxRadians: 0, transitionLength: 0 }),
      surfaceId: `surface:bidirectional-visual:${visualKind}:${start.x.toFixed(3)},${start.z.toFixed(3)}:${end.x.toFixed(3)},${end.z.toFixed(3)}`,
      layer: start.y > CLOVERLEAF_LOWER_HEIGHT ? 'upper' : 'lower',
      successors: Object.freeze([]),
      bounds: Object.freeze({
        minX: Math.min(start.x, end.x) - CLOVERLEAF_MAIN_ROAD_HALF,
        maxX: Math.max(start.x, end.x) + CLOVERLEAF_MAIN_ROAD_HALF,
        minZ: Math.min(start.z, end.z) - CLOVERLEAF_MAIN_ROAD_HALF,
        maxZ: Math.max(start.z, end.z) + CLOVERLEAF_MAIN_ROAD_HALF
      }),
      tileIndex: tile.index,
      tileToken: tile.token,
      previousTileIndex: visualKind === BIDIRECTIONAL_OPPOSING_INTERTILE ? tile.index - 1 : null,
      destinationTileIndex: tile.index,
      runtimeKind: BIDIRECTIONAL_VISUAL_RUNTIME_KIND,
      supportSpanContract: null,
      visualKind,
      bidirectionalRole: visualKind,
      bidirectionalPort: port,
      visualOnly: true,
      drivable: false,
      routeSelectable: false,
      gameplayReachable: false,
      gameplayRandom: false,
      gameplaySurface: false,
      collisionEnabled: false,
      // The destination-owned connector and its contiguous 1,080m entry extension form one visible opposing
      // carriageway. Both may catch flight without acquiring ordinary route, traffic, or collision authority.
      airborneLandingSurface: visualKind === BIDIRECTIONAL_OPPOSING_INTERTILE
        || (
          visualKind === BIDIRECTIONAL_OUTBOUND_EXTENSION
          && tile.index > 0
          && port === tile.entryPort
        ),
      ambientTrafficEligible: false,
      interchangeClearZone: false,
      recoveryStart: freezePoint(start),
      recoveryEnd: freezePoint(end),
      recoverySamples: null,
      samplingMode: 'analytic-line',
      launchProfileLut: null,
      heading,
      launchable: false,
      ramp: null,
      rampId: null,
      lipS: null,
      legacyEventType: null
    });
    runtimeEdgesById.set(id, edge);
    return edge;
  }

  /**
   * Pre-register all four port continuations for a tile. The public selector removes only the continuation
   * underneath the chosen player recovery. A destination-owned connector begins at its entry-port
   * continuation's outer endpoint, so crossing a tile portal cannot make the opposing carriageway vanish.
   */
  function registerBidirectionalVisualEdges(tile) {
    const existing = bidirectionalVisualEdgesByTileToken.get(tile.token);
    if (existing) return existing;
    const outboundExtensionEdgeIds = [];
    for (const port of CLOVERLEAF_PORTS) {
      const exitNode = templateNodeForTile(tile, `exit-${port}`);
      const direction = { x: Math.cos(exitNode.heading), z: Math.sin(exitNode.heading) };
      const end = {
        x: exitNode.world.x + direction.x * CLOVERLEAF_DECISION_APPROACH,
        y: exitNode.world.y,
        z: exitNode.world.z + direction.z * CLOVERLEAF_DECISION_APPROACH
      };
      const endNodeId = `${tile.token}:visual-outbound-end-${port}`;
      createRuntimeNode(endNodeId, 'visual-outbound-end', end, exitNode.heading, tile);
      const edgeId = `${tile.token}:outbound-extension-${port}`;
      createBidirectionalVisualEdge({
        id: edgeId,
        from: exitNode.id,
        to: endNodeId,
        start: exitNode.world,
        end,
        family: 'outbound',
        visualKind: BIDIRECTIONAL_OUTBOUND_EXTENSION,
        tile,
        port
      });
      outboundExtensionEdgeIds.push(edgeId);
    }

    let opposingIntertileEdgeId = null;
    let opposingRecovery = null;
    if (tile.index > 0) {
      const entryExtensionId = `${tile.token}:outbound-extension-${tile.entryPort}`;
      const entryExtension = runtimeEdgesById.get(entryExtensionId);
      const connectorLength = (Number(tile.incomingRecoveryPlanarLength) || CLOVERLEAF_RECOVERY_LENGTH)
        - CLOVERLEAF_DECISION_APPROACH;
      if (!(connectorLength > 0.000_001)) {
        throw new Error(`Opposing intertile connector has no positive span: ${tile.token}`);
      }
      const direction = { x: Math.cos(entryExtension.heading), z: Math.sin(entryExtension.heading) };
      const start = entryExtension.recoveryEnd;
      const end = {
        x: start.x + direction.x * connectorLength,
        y: start.y,
        z: start.z + direction.z * connectorLength
      };
      const endNodeId = `${tile.token}:visual-opposing-previous-end-${tile.entryPort}`;
      createRuntimeNode(endNodeId, 'visual-opposing-previous-end', end, entryExtension.heading, tile);
      opposingIntertileEdgeId = `${tile.token}:opposing-intertile-${tile.entryPort}`;
      createBidirectionalVisualEdge({
        id: opposingIntertileEdgeId,
        from: entryExtension.to,
        to: endNodeId,
        start,
        end,
        family: 'mainline',
        visualKind: BIDIRECTIONAL_OPPOSING_INTERTILE,
        tile,
        port: tile.entryPort
      });
      opposingRecovery = registerOpposingRecoveryEdges(
        tile,
        runtimeEdgesById.get(opposingIntertileEdgeId)
      );
    }

    const record = {
      tileToken: tile.token,
      outboundExtensionEdgeIds: Object.freeze(outboundExtensionEdgeIds),
      opposingIntertileEdgeId,
      opposingRecovery,
      selectionCache: new Map()
    };
    bidirectionalVisualEdgesByTileToken.set(tile.token, record);
    recordRuntimeTopologyHighWater();
    return record;
  }

  /**
   * Return a stable read-only visual edge set for one tile specification. The selected exit extension is
   * omitted because the player's recovery occupies that exact ribbon. Map overview callers may request all
   * four short extensions with `includeSelectedExit`; none of the returned ids enter PathPlan.
   */
  function getBidirectionalVisualEdgesForTile(tileOrToken, options = {}) {
    const tile = typeof tileOrToken === 'string'
      ? runtimeTilesByToken.get(tileOrToken)
      : tileOrToken;
    if (!tile?.token) return Object.freeze([]);
    const record = bidirectionalVisualEdgesByTileToken.get(tile.token)
      || registerBidirectionalVisualEdges(runtimeTilesByToken.get(tile.token) || tile);
    const normalizedOptions = typeof options === 'string' ? { exitPort: options } : options || {};
    const requestedExitPort = CLOVERLEAF_PORTS.includes(normalizedOptions.exitPort)
      ? normalizedOptions.exitPort
      : CLOVERLEAF_PORTS.includes(tile.exitPort) ? tile.exitPort : null;
    const exitPort = normalizedOptions.includeSelectedExit === true ? null : requestedExitPort;
    const includeLongCorridor = normalizedOptions.includeLongCorridor !== false;
    // One token can be queried first as an ordinary tile and later adopted as an opposing bypass. The physical
    // selector must not reuse the ordinary extension set after the crossover replaces its entry-side ribbon.
    const cacheKey = `${tile.opposingBypass === true ? 'opposing-bypass' : 'ordinary'}:${
      normalizedOptions.includeSelectedExit === true ? 'include-selected-exit' : exitPort || '*'}:${
      includeLongCorridor ? 'with-corridor' : 'short-only'
    }`;
    if (record.selectionCache.has(cacheKey)) return record.selectionCache.get(cacheKey);
    const replacedCounterflowExtensionPort = tile.opposingBypass === true ? tile.entryPort : null;
    const edges = record.outboundExtensionEdgeIds
      .map((edgeId) => runtimeEdgesById.get(edgeId))
      .filter((edge) => (
        edge
        && edge.exitPort !== exitPort
        // The raised crossover starts where this short visual-only extension ended; rendering both would leave
        // an unexplained dead road under the recovery ramp and duplicate its first physical ribbon.
        && edge.exitPort !== replacedCounterflowExtensionPort
      ));
    if (includeLongCorridor && record.opposingIntertileEdgeId) {
      const connector = runtimeEdgesById.get(record.opposingIntertileEdgeId);
      if (connector) edges.push(connector);
    }
    const frozen = Object.freeze(edges);
    record.selectionCache.set(cacheKey, frozen);
    return frozen;
  }

  function recoveryTopologyForTile(tileOrToken) {
    const tile = typeof tileOrToken === 'string'
      ? runtimeTilesByToken.get(tileOrToken)
      : tileOrToken;
    if (!tile?.token) return null;
    if (CLOVERLEAF_PORTS.includes(tile.exitPort)) {
      return runtimeRecoveryTopologiesByKey.get(recoveryTopologyKey(tile)) || null;
    }
    return [...runtimeRecoveryTopologiesByKey.values()].find((candidate) => (
      candidate.tileToken === tile.token
    )) || null;
  }

  /** Return both physical recovery branches; route selection is intentionally not applied to visual geometry. */
  function getRecoveryVisualEdgesForTile(tileOrToken) {
    const tile = typeof tileOrToken === 'string'
      ? runtimeTilesByToken.get(tileOrToken)
      : tileOrToken;
    const topology = recoveryTopologyForTile(tileOrToken);
    const opposingCrossoverEdgeId = tile?.opposingBypass === true && tile?.token
      ? bidirectionalVisualEdgesByTileToken.get(tile.token)?.opposingRecovery?.crossoverEdgeId
      : null;
    const edgeIds = [
      // The crossover replaces this tile's complete selected recovery corridor. Publishing both would create
      // intersecting roads and duplicate supports along the same destination approach.
      ...(tile?.opposingBypass === true ? [] : topology?.visualEdgeIds || []),
      ...(opposingCrossoverEdgeId ? [opposingCrossoverEdgeId] : [])
    ];
    return Object.freeze(edgeIds.map((edgeId) => runtimeEdgesById.get(edgeId)).filter(Boolean));
  }

  function getJumpPlatformsForEdge(edgeId) {
    return getEdge(edgeId)?.jumpPlatforms || Object.freeze([]);
  }

  /** Return stable descriptors without exposing the mutable runtime topology registries. */
  function getJumpPlatformsForTile(tileOrToken) {
    const platforms = getRecoveryVisualEdgesForTile(tileOrToken)
      .flatMap((edge) => edge?.jumpPlatforms || []);
    return Object.freeze(platforms);
  }

  /**
   * Sample only an independent table top. The underlying route sampler remains a level road authority, so
   * callers explicitly compose this higher support only while the craft footprint overlaps the platform.
   */
  function sampleJumpPlatformSupport(edgeId, edgeS, lateral, out = {}, footprintHalfWidth = 0) {
    const edge = getEdge(edgeId);
    if (!edge?.jumpPlatforms?.length) return null;
    const station = clamp(Number(edgeS) || 0, 0, edge.length);
    const lateralPosition = Number(lateral) || 0;
    const supportHalfWidth = Math.max(0, Number(footprintHalfWidth) || 0);
    for (const platform of edge.jumpPlatforms) {
      if (
        station < platform.startS - 0.000_001
        || station > platform.lipS + 0.000_001
        // A centre-point touch is insufficient: the complete craft width must remain on the table.
        || Math.abs(lateralPosition - platform.lateral) + supportHalfWidth
          > platform.halfWidth + 0.000_001
      ) continue;
      const progress = clamp(
        (station - platform.startS) / Math.max(0.000_001, platform.ascent),
        0,
        1
      );
      const baseFrame = sampleEdge(edge.id, station, lateralPosition, {});
      out.platformId = platform.id;
      out.platform = platform;
      out.edgeId = edge.id;
      out.edgeS = station;
      out.lateral = lateralPosition;
      out.height = platform.height * progress;
      out.surfaceHeight = baseFrame.y + out.height;
      out.grade = platform.grade;
      return out;
    }
    return null;
  }

  /** Return the two independently selectable movements owned by one straight-road fork. */
  function getRecoveryForkMovementsForTile(tileOrToken) {
    const topology = recoveryTopologyForTile(tileOrToken);
    return topology
      ? Object.freeze(topology.movementIds.map((movementIdValue) => runtimeMovementsById.get(movementIdValue)))
      : Object.freeze([]);
  }

  /**
   * Expand a traffic cursor on an uncommitted straight fork into both physically reachable branch positions.
   * Shared approaches and merged tails remain single entities, while a committed choice remaps any stale default-left
   * cursor onto the selected branch at the same arc-length station.
   */
  function getReachableTrafficPlacements(cursor, committedChoices = {}) {
    const edge = getEdge(cursor?.edgeId);
    const topology = edge?.decisionNodeId
      ? runtimeRecoveryForksByDecisionId.get(edge.decisionNodeId)
      : null;
    if (!edge || edge.family !== 'straight-fork-branch' || !topology) {
      return Object.freeze([Object.freeze({
        cursor: Object.freeze(routePosition(cursor)),
        decisionId: null,
        movementId: null
      })]);
    }
    const committedMovementId = committedChoices?.[topology.decisionNodeId];
    const movementIds = committedMovementId ? [committedMovementId] : topology.movementIds;
    const placements = movementIds.map((movementIdValue) => {
      const movement = getMovement(movementIdValue);
      const branchEdge = getEdge(movement?.toEdgeId);
      if (!movement || !branchEdge || movement.decisionNodeId !== topology.decisionNodeId) return null;
      return Object.freeze({
        cursor: Object.freeze(routePosition({
          ...cursor,
          edgeId: branchEdge.id,
          edgeS: clamp(cursor.edgeS, 0, branchEdge.length),
          tileIndex: branchEdge.tileIndex,
          entryPort: branchEdge.entryPort
        })),
        decisionId: topology.decisionNodeId,
        movementId: movement.id
      });
    }).filter(Boolean);
    return Object.freeze(placements.length ? placements : [Object.freeze({
      cursor: Object.freeze(routePosition(cursor)),
      decisionId: topology.decisionNodeId,
      movementId: null
    })]);
  }

  function sampleIntervalIndex(stations, station) {
    let low = 0;
    let high = stations.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (stations[middle] <= station) low = middle;
      else high = middle;
    }
    return low;
  }

  /**
   * Sample the mirrored near-bang-bang rise/fall without borrowing its curvature for steering or superelevation.
   * The returned second derivative is with respect to the crossover's longitudinal planar station.
   */
  function sampleOpposingCrossoverVertical(profile, planarS, out = {}) {
    const station = clamp(planarS, 0, profile.planarLength);
    out.height = 0;
    out.grade = 0;
    out.secondDerivative = 0;
    if (!(profile.verticalRise > 0) || !profile.verticalProfile || station <= profile.verticalStartS) {
      return out;
    }
    if (station <= profile.verticalRiseEndS) {
      sampleOpposingCrossoverDisplacement(
        profile.verticalProfile,
        station - profile.verticalStartS,
        out
      );
      out.height = out.offset;
      out.grade = out.slope;
      return out;
    }
    if (station <= profile.verticalFallStartS) {
      out.height = profile.verticalRise;
      return out;
    }
    if (station >= profile.verticalFallEndS) return out;
    sampleOpposingCrossoverDisplacement(
      profile.verticalProfile,
      profile.verticalFallEndS - station,
      out
    );
    out.height = out.offset;
    out.grade = -out.slope;
    return out;
  }

  /** Unit acceleration for a C2 near-minimum-peak lane change; its mirrored halves integrate to zero end slope. */
  function opposingCrossoverUnitAcceleration(t, rampRatio) {
    const clampedT = clamp(t, 0, 1);
    const ramp = clamp(rampRatio, 0.001, 0.24);
    if (clampedT < ramp) return smootherStep01(clampedT / ramp);
    if (clampedT < 0.5 - ramp) return 1;
    if (clampedT < 0.5 + ramp) {
      return 1 - 2 * smootherStep01((clampedT - (0.5 - ramp)) / (2 * ramp));
    }
    if (clampedT < 1 - ramp) return -1;
    return -(1 - smootherStep01((clampedT - (1 - ramp)) / ramp));
  }

  /**
   * Integrate the acceleration contract once into offset/slope/curvature LUTs. Compared with the former quintic
   * shift, this spreads almost constant lateral acceleration across the useful length and keeps C2 zero curvature
   * at both joins while the full 1,080m opposing ribbon remains an exact landing alias.
   */
  function buildOpposingCrossoverDisplacementProfile(transitionLength, displacement, rampRatio) {
    const count = Math.max(1, Math.ceil(transitionLength / OPPOSING_CROSSOVER_PROFILE_STEP));
    const normalizedVelocities = new Float64Array(count + 1);
    const normalizedOffsets = new Float64Array(count + 1);
    const unitAccelerations = new Float64Array(count + 1);
    const dt = 1 / count;
    unitAccelerations[0] = opposingCrossoverUnitAcceleration(0, rampRatio);
    for (let index = 1; index <= count; index++) {
      const acceleration = opposingCrossoverUnitAcceleration(index / count, rampRatio);
      const previousVelocity = normalizedVelocities[index - 1];
      const velocity = previousVelocity
        + (unitAccelerations[index - 1] + acceleration) * 0.5 * dt;
      normalizedVelocities[index] = velocity;
      normalizedOffsets[index] = normalizedOffsets[index - 1]
        + (previousVelocity + velocity) * 0.5 * dt;
      unitAccelerations[index] = acceleration;
    }
    const unitDisplacement = normalizedOffsets[count];
    if (!(Math.abs(unitDisplacement) > 0.000_001)) {
      throw new Error('Opposing crossover acceleration did not produce displacement');
    }
    const scale = displacement / unitDisplacement;
    const offsets = new Float64Array(count + 1);
    const slopes = new Float64Array(count + 1);
    const secondDerivatives = new Float64Array(count + 1);
    for (let index = 0; index <= count; index++) {
      offsets[index] = normalizedOffsets[index] * scale;
      slopes[index] = normalizedVelocities[index] * scale / transitionLength;
      secondDerivatives[index] = unitAccelerations[index] * scale
        / (transitionLength * transitionLength);
    }
    offsets[count] = displacement;
    slopes[0] = 0;
    slopes[count] = 0;
    secondDerivatives[0] = 0;
    secondDerivatives[count] = 0;
    return Object.freeze({
      count,
      transitionLength,
      displacement,
      accelerationRampRatio: rampRatio,
      offsets,
      slopes,
      secondDerivatives
    });
  }

  function buildOpposingCrossoverLateralProfile(transitionLength, lateralOffset) {
    return buildOpposingCrossoverDisplacementProfile(
      transitionLength,
      lateralOffset,
      OPPOSING_CROSSOVER_LATERAL_ACCELERATION_RAMP_RATIO
    );
  }

  function sampleOpposingCrossoverDisplacement(profile, transitionS, out = {}) {
    const station = clamp(transitionS, 0, profile.transitionLength);
    const scaledIndex = profile.transitionLength > 0
      ? station / profile.transitionLength * profile.count
      : 0;
    const low = Math.min(profile.count - 1, Math.max(0, Math.floor(scaledIndex)));
    const high = Math.min(profile.count, low + 1);
    const blend = scaledIndex - low;
    out.offset = profile.offsets[low] + (profile.offsets[high] - profile.offsets[low]) * blend;
    out.slope = profile.slopes[low] + (profile.slopes[high] - profile.slopes[low]) * blend;
    out.secondDerivative = profile.secondDerivatives[low]
      + (profile.secondDerivatives[high] - profile.secondDerivatives[low]) * blend;
    return out;
  }

  function sampleOpposingCrossoverLateral(profile, transitionS, out = {}) {
    return sampleOpposingCrossoverDisplacement(profile.lateralProfile || profile, transitionS, out);
  }

  /**
   * Resolve independent signed horizontal and vertical curvature plus the exact 3D curvature magnitude.
   * Only horizontal curvature is permitted to drive steering and bank; the other components are diagnostics.
   */
  function writeOpposingCrossoverCurvatureComponents(
    lateralSlope,
    lateralSecondDerivative,
    verticalGrade,
    verticalSecondDerivative,
    out = {}
  ) {
    const horizontalScale = Math.pow(1 + lateralSlope * lateralSlope, 1.5);
    const verticalScale = Math.pow(1 + verticalGrade * verticalGrade, 1.5);
    const spatialScale = Math.pow(
      1 + lateralSlope * lateralSlope + verticalGrade * verticalGrade,
      1.5
    );
    out.horizontal = lateralSecondDerivative / horizontalScale;
    out.vertical = verticalSecondDerivative / verticalScale;
    out.spatial = Math.hypot(
      lateralSlope * verticalSecondDerivative - verticalGrade * lateralSecondDerivative,
      verticalSecondDerivative,
      lateralSecondDerivative
    ) / spatialScale;
    return out;
  }

  /**
   * Build one C2 semi-directional crossover. Its complete entry-side opposing ribbon remains straight for landing
   * continuity, while an independently timed mirrored rise/fall clears the live interchange without a hard crest.
   */
  function buildOpposingCrossoverProfile(planarLength, lateralOffset, startHeight) {
    const lateralStabilizationLength = OPPOSING_CROSSOVER_LATERAL_STABILIZATION_LENGTH;
    const lateralStartS = OPPOSING_CROSSOVER_LATERAL_START_LENGTH;
    const verticalStabilizationLength = OPPOSING_CROSSOVER_VERTICAL_STABILIZATION_LENGTH;
    const lateralTransitionLength = OPPOSING_CROSSOVER_LATERAL_TRANSITION_LENGTH;
    const verticalRise = Math.max(0, OPPOSING_CROSSOVER_PEAK_WORLD_Y - startHeight);
    const verticalTransitionLength = OPPOSING_CROSSOVER_VERTICAL_TRANSITION_LENGTH;
    const verticalPlateauLength = OPPOSING_CROSSOVER_VERTICAL_PLATEAU_LENGTH;
    const requiredProfileLength = Math.max(
      lateralStartS + lateralTransitionLength,
      verticalStabilizationLength + verticalTransitionLength * 2 + verticalPlateauLength
    );
    if (
      !(lateralTransitionLength > 0.000_001)
      || !(verticalTransitionLength > 0.000_001)
      || planarLength + 0.000_001 < requiredProfileLength
    ) {
      throw new Error(`Opposing crossover has insufficient displacement length: ${planarLength}`);
    }
    const lateralProfile = buildOpposingCrossoverLateralProfile(
      lateralTransitionLength,
      lateralOffset
    );
    const verticalProfile = verticalRise > 0
      ? buildOpposingCrossoverDisplacementProfile(
          verticalTransitionLength,
          verticalRise,
          OPPOSING_CROSSOVER_VERTICAL_ACCELERATION_RAMP_RATIO
        )
      : null;
    const verticalStartS = verticalStabilizationLength;
    const verticalRiseEndS = verticalStartS + verticalTransitionLength;
    const verticalFallStartS = verticalRiseEndS + verticalPlateauLength;
    const verticalFallEndS = verticalFallStartS + verticalTransitionLength;
    const exitStabilizationLength = planarLength - verticalFallEndS;
    const widthNarrowStartS = lateralStabilizationLength;
    const widthNarrowEndS = widthNarrowStartS + OPPOSING_CROSSOVER_WIDTH_TAPER_LENGTH;
    const widthWidenEndS = verticalFallEndS;
    const widthWidenStartS = widthWidenEndS - OPPOSING_CROSSOVER_WIDTH_TAPER_LENGTH;
    const count = Math.max(1, Math.ceil(planarLength / OPPOSING_CROSSOVER_PROFILE_STEP));
    const planarStations = new Float64Array(count + 1);
    const surfaceStations = new Float64Array(count + 1);
    const curvatures = new Float64Array(count + 1);
    const verticalCurvatures = new Float64Array(count + 1);
    const spatialCurvatures = new Float64Array(count + 1);
    let surfaceS = 0;
    let maximumAbsCurvature = 0;
    let maximumAbsVerticalCurvature = 0;
    let maximumSpatialCurvature = 0;
    let maximumGrade = 0;
    let peakIndex = 0;
    let verticalPeakIndex = 0;
    let spatialPeakIndex = 0;
    let previousSlope = 0;
    let previousGrade = 0;
    const lateralSample = {};
    const verticalSample = {};
    const curvatureSample = {};
    const verticalContract = {
      planarLength,
      verticalRise,
      verticalProfile,
      verticalTransitionLength,
      verticalStartS,
      verticalRiseEndS,
      verticalFallStartS,
      verticalFallEndS
    };
    for (let index = 0; index <= count; index++) {
      const planarS = planarLength * index / count;
      const transitionS = clamp(
        planarS - lateralStartS,
        0,
        lateralTransitionLength
      );
      sampleOpposingCrossoverLateral(lateralProfile, transitionS, lateralSample);
      const slope = lateralSample.slope;
      const secondDerivative = lateralSample.secondDerivative;
      const vertical = sampleOpposingCrossoverVertical(verticalContract, planarS, verticalSample);
      writeOpposingCrossoverCurvatureComponents(
        slope,
        secondDerivative,
        vertical.grade,
        vertical.secondDerivative,
        curvatureSample
      );
      const curvature = curvatureSample.horizontal;
      planarStations[index] = planarS;
      curvatures[index] = curvature;
      verticalCurvatures[index] = curvatureSample.vertical;
      spatialCurvatures[index] = curvatureSample.spatial;
      if (index > 0) {
        const previousPlanarS = planarStations[index - 1];
        surfaceS += (planarS - previousPlanarS) * Math.hypot(
          1,
          (previousSlope + slope) * 0.5,
          (previousGrade + vertical.grade) * 0.5
        );
      }
      surfaceStations[index] = surfaceS;
      previousSlope = slope;
      previousGrade = vertical.grade;
      if (Math.abs(curvature) > maximumAbsCurvature) {
        maximumAbsCurvature = Math.abs(curvature);
        peakIndex = index;
      }
      if (Math.abs(curvatureSample.vertical) > maximumAbsVerticalCurvature) {
        maximumAbsVerticalCurvature = Math.abs(curvatureSample.vertical);
        verticalPeakIndex = index;
      }
      if (curvatureSample.spatial > maximumSpatialCurvature) {
        maximumSpatialCurvature = curvatureSample.spatial;
        spatialPeakIndex = index;
      }
      maximumGrade = Math.max(maximumGrade, Math.abs(vertical.grade));
    }
    let firstCurveS = Number.POSITIVE_INFINITY;
    for (let index = 0; index < curvatures.length; index++) {
      if (Math.abs(curvatures[index]) > CLOVERLEAF_CURVE_THRESHOLD) {
        firstCurveS = surfaceStations[index];
        break;
      }
    }
    return Object.freeze({
      id: 'opposing-crossover-profile-v5-local-merge',
      planarLength,
      surfaceLength: surfaceS,
      lateralOffset,
      stabilizationLength: lateralStabilizationLength,
      lateralStabilizationLength,
      lateralStartS,
      verticalStabilizationLength,
      lateralTransitionLength,
      lateralProfile,
      verticalRise,
      verticalProfile,
      peakWorldY: startHeight + verticalRise,
      verticalTransitionLength,
      verticalPlateauLength,
      verticalStartS,
      verticalRiseEndS,
      verticalFallStartS,
      verticalFallEndS,
      exitStabilizationLength,
      connectorRoadHalf: OPPOSING_CROSSOVER_CONNECTOR_ROAD_HALF,
      widthTaperLength: OPPOSING_CROSSOVER_WIDTH_TAPER_LENGTH,
      widthNarrowStartS,
      widthNarrowEndS,
      widthWidenStartS,
      widthWidenEndS,
      maximumGrade,
      planarStations,
      surfaceStations,
      curvatures,
      verticalCurvatures,
      spatialCurvatures,
      curvatureProfile: Object.freeze({
        stations: surfaceStations,
        curvatures,
        verticalCurvatures,
        spatialCurvatures,
        maxAbsCurvature: maximumAbsCurvature,
        maxAbsVerticalCurvature: maximumAbsVerticalCurvature,
        maxSpatialCurvature: maximumSpatialCurvature,
        signedCurvature: curvatures[peakIndex],
        peakS: surfaceStations[peakIndex],
        verticalPeakS: surfaceStations[verticalPeakIndex],
        spatialPeakS: surfaceStations[spatialPeakIndex],
        firstCurveS
      })
    });
  }

  /**
   * Register a full-length gameplay alias over the opposing ribbon and one long raised crossover to the straight
   * exit. This deliberately bypasses the current interchange; recovery then enters the next tile through its
   * ordinary approach, so a landing never splices into a live decision or needs a disposable approach remainder.
   */
  function registerOpposingRecoveryEdges(tile, opposingVisualEdge) {
    if (!opposingVisualEdge) return null;
    const straightMovement = movementForTile(tile, 'straight');
    const exitPort = straightMovement?.exitPort || OPPOSITE_PORT[tile.entryPort];
    const targetExitEdgeId = scopedTemplateId(tile, `outbound-${exitPort}`);
    const targetExitEdge = runtimeEdgesById.get(targetExitEdgeId);
    if (!straightMovement || !targetExitEdge || opposingVisualEdge.length <= 0.000_001) {
      throw new Error(`Opposing recovery cannot resolve destination straight exit: ${tile.token}`);
    }
    const sourceFrame = sampleEdge(opposingVisualEdge.id, 0, 0, {});
    const exitFrame = sampleEdge(targetExitEdge.id, targetExitEdge.length, 0, {});
    const targetFrame = {
      centerX: exitFrame.centerX + exitFrame.horizontalTangentX * CLOVERLEAF_RECOVERY_LENGTH,
      centerY: exitFrame.centerY,
      centerZ: exitFrame.centerZ + exitFrame.horizontalTangentZ * CLOVERLEAF_RECOVERY_LENGTH,
      heading: exitFrame.heading
    };
    const nextHistoryKey = nextTileHistoryKey(tile.historyKey, exitPort);
    const nextTileToken = tileToken(tile.index + 1, nextHistoryKey);
    const targetEntryNodeId = `${nextTileToken}:entry-${tile.entryPort}`;
    const nextApproachEdgeId = `${nextTileToken}:approach-${tile.entryPort}`;
    const reverseHeading = Math.atan2(
      -sourceFrame.horizontalTangentZ,
      -sourceFrame.horizontalTangentX
    );
    const tangentX = Math.cos(reverseHeading);
    const tangentZ = Math.sin(reverseHeading);
    const rightX = -tangentZ;
    const rightZ = tangentX;
    const deltaX = targetFrame.centerX - sourceFrame.centerX;
    const deltaZ = targetFrame.centerZ - sourceFrame.centerZ;
    const planarLength = deltaX * tangentX + deltaZ * tangentZ;
    const lateralOffset = deltaX * rightX + deltaZ * rightZ;
    const headingError = Math.abs(Math.atan2(
      Math.sin(targetFrame.heading - reverseHeading),
      Math.cos(targetFrame.heading - reverseHeading)
    ));
    if (
      !(planarLength > OPPOSING_CROSSOVER_LATERAL_STABILIZATION_LENGTH)
      || Math.abs(Math.abs(lateralOffset) - 24) > 0.001
      || headingError > 0.000_001
      || Math.abs(targetFrame.centerY - sourceFrame.centerY) > 0.000_001
    ) {
      throw new Error(`Opposing recovery geometry is not a parallel 24m crossover: ${tile.token}`);
    }
    const crossoverProfile = buildOpposingCrossoverProfile(
      planarLength,
      lateralOffset,
      sourceFrame.centerY
    );
    const proxyEdgeId = `${tile.token}:opposing-recovery-proxy-${tile.entryPort}`;
    const crossoverEdgeId = `${tile.token}:opposing-crossover-${tile.entryPort}`;
    const crossoverStartNodeId = `${tile.token}:opposing-crossover-start-${tile.entryPort}`;
    createRuntimeNode(
      crossoverStartNodeId,
      'opposing-crossover-start',
      { x: sourceFrame.centerX, y: sourceFrame.centerY, z: sourceFrame.centerZ },
      reverseHeading,
      tile
    );

    const registerEdge = ({
      id,
      from,
      to,
      start,
      end,
      family,
      maneuver,
      opposingRecoveryKind,
      successors,
      profile = null,
      surfaceId,
      renderableRecovery = false,
      edgeExitPort = null
    }) => {
      if (runtimeEdgesById.has(id)) return runtimeEdgesById.get(id);
      const linePlanarLength = Math.hypot(end.x - start.x, end.z - start.z);
      const edgePlanarLength = profile?.planarLength || linePlanarLength;
      const length = profile?.surfaceLength || linePlanarLength;
      const heading = profile ? reverseHeading : Math.atan2(end.z - start.z, end.x - start.x);
      const lateralPadding = Math.abs(profile?.lateralOffset || 0);
      const edge = Object.freeze({
        id,
        from,
        to,
        nodes: Object.freeze([from, to]),
        family,
        maneuver,
        entryPort: tile.entryPort,
        exitPort: edgeExitPort,
        length,
        planarLength: edgePlanarLength,
        roadHalf: CLOVERLEAF_MAIN_ROAD_HALF,
        halfWidth: CLOVERLEAF_MAIN_ROAD_HALF,
        speedLimit: ROAD_SPEED_LIMITS_MPS.mainline,
        geometrySegments: Object.freeze([Object.freeze({
          kind: profile ? 'opposing-crossover' : 'line',
          length: edgePlanarLength,
          lateralOffset: profile?.lateralOffset || 0
        })]),
        heightProfile: Object.freeze({
          startHeight: start.y,
          endHeight: end.y,
          startS: 0,
          endS: edgePlanarLength,
          gradeLength: profile?.verticalTransitionLength || 0,
          peakHeight: profile?.peakWorldY ?? Math.max(start.y, end.y)
        }),
        verticalFeatures: Object.freeze(profile ? [Object.freeze({
          kind: 'opposing-crossover-flyover',
          startS: profile.verticalStartS,
          riseEndS: profile.verticalRiseEndS,
          fallStartS: profile.verticalFallStartS,
          endS: profile.verticalFallEndS,
          heightDelta: profile.verticalRise
        })] : []),
        bankProfile: Object.freeze(profile
          ? {
              maxRadians: OPPOSING_CROSSOVER_MAX_BANK_RADIANS,
              transitionLength: OPPOSING_CROSSOVER_WIDTH_TAPER_LENGTH,
              startFlatLength: profile.lateralStartS,
              endFlatLength: profile.exitStabilizationLength
            }
          : { maxRadians: 0, transitionLength: 0 }),
        surfaceId,
        layer: profile
          ? 'transition'
          : start.y > CLOVERLEAF_LOWER_HEIGHT ? 'upper' : 'lower',
        successors: Object.freeze([...successors]),
        bounds: Object.freeze({
          minX: Math.min(start.x, end.x) - CLOVERLEAF_MAIN_ROAD_HALF - lateralPadding,
          maxX: Math.max(start.x, end.x) + CLOVERLEAF_MAIN_ROAD_HALF + lateralPadding,
          minZ: Math.min(start.z, end.z) - CLOVERLEAF_MAIN_ROAD_HALF - lateralPadding,
          maxZ: Math.max(start.z, end.z) + CLOVERLEAF_MAIN_ROAD_HALF + lateralPadding
        }),
        tileIndex: tile.index,
        tileToken: tile.token,
        nextTileIndex: tile.index,
        runtimeKind: 'recovery',
        opposingRecoveryKind,
        opposingVisualEdgeId: opposingVisualEdge.id,
        renderableRecovery,
        visualOnly: false,
        drivable: true,
        routeSelectable: false,
        gameplayReachable: true,
        gameplayRandom: true,
        gameplaySurface: true,
        collisionEnabled: true,
        airborneLandingSurface: renderableRecovery,
        ambientTrafficEligible: true,
        interchangeClearZone: false,
        recoveryStart: freezePoint(start),
        recoveryEnd: freezePoint(end),
        recoverySamples: null,
        samplingMode: profile ? 'opposing-crossover-profile' : 'analytic-line',
        launchProfileLut: null,
        straightForkProfileLut: null,
        opposingCrossoverProfileLut: profile,
        // The return flyover owns a continuous box-girder presentation and an 88m pier rhythm. It remains inside
        // the existing road-shell envelope and uses the same clearance-proven columns; this is not permission for
        // an unsupported long span or the removed cable-stayed tower system.
        supportSpanContract: profile ? OPPOSING_CROSSOVER_STRUCTURE_CONTRACT : null,
        curvatureProfile: profile?.curvatureProfile || null,
        forkSide: null,
        maximumCenterOffset: profile?.lateralOffset || 0,
        decisionNodeId: null,
        heading,
        launchable: false,
        jumpPlatformCorridor: false,
        jumpPlatforms: Object.freeze([]),
        ramp: null,
        rampId: null,
        lipS: null,
        legacyEventType: null
      });
      runtimeEdgesById.set(id, edge);
      return edge;
    };

    const proxyStart = opposingVisualEdge.recoveryEnd;
    const proxyEnd = { x: sourceFrame.centerX, y: sourceFrame.centerY, z: sourceFrame.centerZ };
    registerEdge({
      id: proxyEdgeId,
      from: opposingVisualEdge.to,
      to: crossoverStartNodeId,
      start: proxyStart,
      end: proxyEnd,
      family: 'opposing-recovery-proxy',
      maneuver: 'opposing-counterflow',
      opposingRecoveryKind: OPPOSING_RECOVERY_PROXY,
      successors: [crossoverEdgeId],
      surfaceId: `surface:opposing-counterflow:${tile.physicalKey}:${tile.entryPort}`
    });
    registerEdge({
      id: crossoverEdgeId,
      from: crossoverStartNodeId,
      to: targetEntryNodeId,
      start: proxyEnd,
      end: {
        x: targetFrame.centerX,
        y: targetFrame.centerY,
        z: targetFrame.centerZ
      },
      family: 'opposing-crossover',
      maneuver: 'opposing-return-flyover',
      opposingRecoveryKind: OPPOSING_RECOVERY_CROSSOVER,
      successors: [nextApproachEdgeId],
      profile: crossoverProfile,
      surfaceId: `surface:opposing-crossover:${tile.physicalKey}:${tile.entryPort}`,
      renderableRecovery: true,
      edgeExitPort: exitPort
    });
    return Object.freeze({
      visualEdgeId: opposingVisualEdge.id,
      proxyEdgeId,
      crossoverEdgeId,
      targetExitEdgeId,
      targetEntryNodeId,
      nextTileToken,
      nextApproachEdgeId,
      straightMovementId: straightMovement.id,
      decisionNodeId: straightMovement.decisionNodeId,
      exitPort,
      sourceS: 0,
      stabilizationLength: crossoverProfile.stabilizationLength,
      maximumGrade: crossoverProfile.maximumGrade,
      // Steering retains the signed horizontal maximum; ride diagnostics remain independently addressable.
      maximumCurvature: crossoverProfile.curvatureProfile.maxAbsCurvature,
      maximumVerticalCurvature: crossoverProfile.curvatureProfile.maxAbsVerticalCurvature,
      maximumSpatialCurvature: crossoverProfile.curvatureProfile.maxSpatialCurvature
    });
  }

  /** Build one immutable local jump table; token hashing changes variety without changing spawn RNG order. */
  function jumpPlatformsForCorridor(edgeId, tile, edgeLength, planarLength) {
    const hash = stableTokenHash(`${tile.token}|${edgeId}|jump-platform-v1`);
    const variantIndex = (hash + tile.index) % JUMP_PLATFORM_VARIANTS.length;
    const variant = JUMP_PLATFORM_VARIANTS[variantIndex];
    const minimumStartS = 52;
    const maximumStartS = Math.max(
      minimumStartS,
      Math.min(edgeLength - variant.length - 112, 142)
    );
    const positionUnit = ((hash >>> 8) & 0xff_ff) / 0xff_ff;
    const startS = minimumStartS + (maximumStartS - minimumStartS) * positionUnit;
    const lipS = startS + variant.length;
    const horizontalLength = variant.length * planarLength / edgeLength;
    const platform = Object.freeze({
      id: `${edgeId}:jump-platform`,
      edgeId,
      tileToken: tile.token,
      variant: variant.id,
      startS,
      lipS,
      endS: lipS,
      length: variant.length,
      ascent: variant.length,
      width: variant.width,
      halfWidth: variant.width * 0.5,
      lateral: variant.lateral,
      height: variant.height,
      grade: variant.height / Math.max(0.000_001, horizontalLength),
      launchable: true
    });
    return Object.freeze([platform]);
  }

  function straightForkMaximumOffset(forkSide) {
    return forkSide === STRAIGHT_FORK_LEFT
      ? STRAIGHT_FORK_LEFT_MAXIMUM_OFFSET
      : STRAIGHT_FORK_RIGHT_MAXIMUM_OFFSET;
  }

  /**
   * Write one side of the asymmetric branch envelope. Both sides share the same quintic timing and road-width
   * profile, so their endpoints remain C2 even though the inside branch moves only 2m and the outside moves 18m.
   */
  function writeStraightForkProfile(planarS, forkSide, out = {}) {
    const t = clamp(planarS / STRAIGHT_FORK_BRANCH_PLANAR_LENGTH, 0, 1);
    const opening = t <= 0.5;
    const u = opening ? t * 2 : (1 - t) * 2;
    const direction = opening ? 1 : -1;
    const envelope = smootherStep01(u);
    const maximumOffset = straightForkMaximumOffset(forkSide);
    const slope = maximumOffset
      * smootherStepDerivative01(u)
      * direction * 2 / STRAIGHT_FORK_BRANCH_PLANAR_LENGTH;
    const secondDerivative = maximumOffset
      * smootherStepSecondDerivative01(u)
      * 4 / (STRAIGHT_FORK_BRANCH_PLANAR_LENGTH * STRAIGHT_FORK_BRANCH_PLANAR_LENGTH);
    out.planarS = clamp(planarS, 0, STRAIGHT_FORK_BRANCH_PLANAR_LENGTH);
    out.envelope = envelope;
    out.maximumOffset = maximumOffset;
    out.offset = maximumOffset * envelope;
    out.slope = slope;
    out.secondDerivative = secondDerivative;
    out.curvature = secondDerivative / Math.pow(1 + slope * slope, 1.5);
    out.roadHalf = CLOVERLEAF_MAIN_ROAD_HALF
      + (STRAIGHT_FORK_BRANCH_ROAD_HALF - CLOVERLEAF_MAIN_ROAD_HALF) * smootherStep01(envelope);
    out.combinedVoidWidthM = Math.max(
      0,
      (STRAIGHT_FORK_LEFT_MAXIMUM_OFFSET + STRAIGHT_FORK_RIGHT_MAXIMUM_OFFSET) * envelope
        - 2 * out.roadHalf
    );
    return out;
  }

  function buildStraightForkProfile(forkSide) {
    const count = Math.max(1, Math.ceil(STRAIGHT_FORK_BRANCH_PLANAR_LENGTH / STRAIGHT_FORK_PROFILE_STEP));
    const planarStations = new Float64Array(count + 1);
    const surfaceStations = new Float64Array(count + 1);
    const baseCurvatures = new Float64Array(count + 1);
    const sample = {};
    let surfaceS = 0;
    let maximumAbsCurvature = 0;
    let peakIndex = 0;
    for (let index = 0; index <= count; index++) {
      const planarS = STRAIGHT_FORK_BRANCH_PLANAR_LENGTH * index / count;
      writeStraightForkProfile(planarS, forkSide, sample);
      planarStations[index] = planarS;
      baseCurvatures[index] = sample.curvature;
      if (index > 0) {
        const planarStep = planarS - planarStations[index - 1];
        const previous = {};
        writeStraightForkProfile(planarStations[index - 1], forkSide, previous);
        surfaceS += planarStep * Math.hypot(1, (previous.slope + sample.slope) * 0.5);
      }
      surfaceStations[index] = surfaceS;
      if (Math.abs(sample.curvature) > maximumAbsCurvature) {
        maximumAbsCurvature = Math.abs(sample.curvature);
        peakIndex = index;
      }
    }
    /** The shell gap, boundary exposure, and gore placement must all resolve from the same analytic profile. */
    function openingPlanarStationForClearWidth(clearWidthM) {
      let low = 0;
      let high = STRAIGHT_FORK_BRANCH_PLANAR_LENGTH * 0.5;
      // The clamped gap is exactly zero throughout the overlapping throat. A positive epsilon finds the first
      // genuinely open station instead of collapsing the visual-void contract to the edge origin.
      const targetGap = Math.max(0.000_001, clearWidthM);
      for (let iteration = 0; iteration < 48; iteration++) {
        const middle = (low + high) * 0.5;
        writeStraightForkProfile(middle, forkSide, sample);
        if (sample.combinedVoidWidthM < targetGap) low = middle;
        else high = middle;
      }
      return (low + high) * 0.5;
    }
    function surfaceStationForPlanarStation(planarS) {
      const targetS = clamp(planarS, 0, STRAIGHT_FORK_BRANCH_PLANAR_LENGTH);
      const low = sampleIntervalIndex(planarStations, targetS);
      const high = Math.min(planarStations.length - 1, low + 1);
      const span = planarStations[high] - planarStations[low];
      const t = span > 0.000_001 ? (targetS - planarStations[low]) / span : 0;
      return surfaceStations[low] + (surfaceStations[high] - surfaceStations[low]) * t;
    }
    const openingVoidPlanarS = openingPlanarStationForClearWidth(0);
    const openingNosePlanarS = openingPlanarStationForClearWidth(STRAIGHT_FORK_GORE_CLEAR_WIDTH);
    const closingVoidPlanarS = STRAIGHT_FORK_BRANCH_PLANAR_LENGTH - openingVoidPlanarS;
    const closingNosePlanarS = STRAIGHT_FORK_BRANCH_PLANAR_LENGTH - openingNosePlanarS;
    writeStraightForkProfile(STRAIGHT_FORK_BRANCH_PLANAR_LENGTH * 0.5, forkSide, sample);
    const centralVoid = Object.freeze({
      startPlanarS: openingVoidPlanarS,
      endPlanarS: closingVoidPlanarS,
      startS: surfaceStationForPlanarStation(openingVoidPlanarS),
      endS: surfaceStationForPlanarStation(closingVoidPlanarS),
      noseStartPlanarS: openingNosePlanarS,
      noseEndPlanarS: closingNosePlanarS,
      noseStartS: surfaceStationForPlanarStation(openingNosePlanarS),
      noseEndS: surfaceStationForPlanarStation(closingNosePlanarS),
      maximumWidthM: sample.combinedVoidWidthM,
      noseClearWidthM: STRAIGHT_FORK_GORE_CLEAR_WIDTH
    });
    return Object.freeze({
      id: `asymmetric-straight-fork-profile-v3:${forkSide}`,
      forkSide,
      maximumOffset: straightForkMaximumOffset(forkSide),
      sampleStep: STRAIGHT_FORK_PROFILE_STEP,
      planarLength: STRAIGHT_FORK_BRANCH_PLANAR_LENGTH,
      surfaceLength: surfaceS,
      planarStations,
      surfaceStations,
      baseCurvatures,
      maximumAbsCurvature,
      peakIndex,
      centralVoid
    });
  }

  function createStraightForkCurvatureProfile(sharedProfile, side) {
    const curvatures = new Float64Array(sharedProfile.baseCurvatures.length);
    let firstCurveS = Number.POSITIVE_INFINITY;
    for (let index = 0; index < curvatures.length; index++) {
      curvatures[index] = sharedProfile.baseCurvatures[index] * side;
      if (!Number.isFinite(firstCurveS) && Math.abs(curvatures[index]) > CLOVERLEAF_CURVE_THRESHOLD) {
        firstCurveS = sharedProfile.surfaceStations[index];
      }
    }
    return Object.freeze({
      stations: sharedProfile.surfaceStations,
      curvatures,
      maxAbsCurvature: sharedProfile.maximumAbsCurvature,
      signedCurvature: curvatures[sharedProfile.peakIndex],
      peakS: sharedProfile.surfaceStations[sharedProfile.peakIndex],
      firstCurveS
    });
  }

  const straightForkProfiles = Object.freeze({
    [STRAIGHT_FORK_LEFT]: buildStraightForkProfile(STRAIGHT_FORK_LEFT),
    [STRAIGHT_FORK_RIGHT]: buildStraightForkProfile(STRAIGHT_FORK_RIGHT)
  });
  const sharedStraightForkCurvatureProfiles = Object.freeze({
    [STRAIGHT_FORK_LEFT]: createStraightForkCurvatureProfile(straightForkProfiles[STRAIGHT_FORK_LEFT], -1),
    [STRAIGHT_FORK_RIGHT]: createStraightForkCurvatureProfile(straightForkProfiles[STRAIGHT_FORK_RIGHT], 1)
  });

  function createRecoveryEdge(
    id,
    from,
    to,
    start,
    end,
    family,
    successors,
    tile,
    nextTile,
    jumpPlatformCorridor = false,
    options = {}
  ) {
    if (runtimeEdgesById.has(id)) return runtimeEdgesById.get(id);
    const planarLength = Math.hypot(end.x - start.x, end.z - start.z);
    if (Math.abs(end.y - start.y) > 0.000_001) {
      throw new Error(`Recovery edge endpoints must share one base elevation: ${id}`);
    }
    if (jumpPlatformCorridor && Math.abs(planarLength - CLOVERLEAF_LAUNCH_LENGTH) > 0.000_001) {
      throw new Error(`Jump-platform corridor length is invalid: ${id}`);
    }
    const forkSide = options.forkSide === STRAIGHT_FORK_LEFT || options.forkSide === STRAIGHT_FORK_RIGHT
      ? options.forkSide
      : null;
    const straightForkProfile = forkSide ? straightForkProfiles[forkSide] : null;
    if (forkSide && Math.abs(planarLength - straightForkProfile.planarLength) > 0.000_001) {
      throw new Error(`Straight-fork edge length does not match its shared profile: ${id}`);
    }
    const length = jumpPlatformCorridor
      ? CLOVERLEAF_JUMP_PLATFORM_CORRIDOR_LENGTH
      : forkSide ? straightForkProfile.surfaceLength : planarLength;
    const heading = Math.atan2(end.z - start.z, end.x - start.x);
    const jumpPlatforms = jumpPlatformCorridor
      ? jumpPlatformsForCorridor(id, tile, length, planarLength)
      : Object.freeze([]);
    const edge = Object.freeze({
      id,
      from,
      to,
      nodes: Object.freeze([from, to]),
      family,
      maneuver: options.maneuver || (jumpPlatformCorridor ? 'jump-platform-corridor' : 'recovery'),
      entryPort: nextTile.entryPort,
      exitPort: tile.exitPort,
      length,
      planarLength,
      roadHalf: forkSide ? STRAIGHT_FORK_BRANCH_ROAD_HALF : CLOVERLEAF_MAIN_ROAD_HALF,
      halfWidth: forkSide ? STRAIGHT_FORK_BRANCH_ROAD_HALF : CLOVERLEAF_MAIN_ROAD_HALF,
      speedLimit: ROAD_SPEED_LIMITS_MPS.mainline,
      geometrySegments: forkSide
          ? Object.freeze([Object.freeze({
              kind: 'straight-fork',
              length: planarLength,
              maximumOffset: straightForkMaximumOffset(forkSide),
              side: forkSide
            })])
          : Object.freeze([Object.freeze({ kind: 'line', length: planarLength })]),
      heightProfile: Object.freeze({ startHeight: start.y, endHeight: end.y, startS: 0, endS: planarLength, gradeLength: 0 }),
      verticalFeatures: Object.freeze([]),
      bankProfile: Object.freeze({ maxRadians: 0, transitionLength: 0 }),
      surfaceId: `surface:recovery:${id}`,
      layer: start.y > CLOVERLEAF_LOWER_HEIGHT ? 'upper' : 'lower',
      successors: Object.freeze([...successors]),
      bounds: Object.freeze({
        minX: Math.min(start.x, end.x) - CLOVERLEAF_MAIN_ROAD_HALF - (forkSide ? STRAIGHT_FORK_MAXIMUM_OFFSET : 0),
        maxX: Math.max(start.x, end.x) + CLOVERLEAF_MAIN_ROAD_HALF + (forkSide ? STRAIGHT_FORK_MAXIMUM_OFFSET : 0),
        minZ: Math.min(start.z, end.z) - CLOVERLEAF_MAIN_ROAD_HALF - (forkSide ? STRAIGHT_FORK_MAXIMUM_OFFSET : 0),
        maxZ: Math.max(start.z, end.z) + CLOVERLEAF_MAIN_ROAD_HALF + (forkSide ? STRAIGHT_FORK_MAXIMUM_OFFSET : 0)
      }),
      tileIndex: tile.index,
      tileToken: tile.token,
      nextTileIndex: nextTile.index,
      runtimeKind: 'recovery',
      supportSpanContract: null,
      interchangeClearZone: false,
      recoveryStart: freezePoint(start),
      recoveryEnd: freezePoint(end),
      recoverySamples: null,
      samplingMode: jumpPlatformCorridor
        ? 'scaled-analytic-line'
        : forkSide ? 'shared-straight-fork-profile' : 'analytic-line',
      launchProfileLut: null,
      straightForkProfileLut: straightForkProfile,
      curvatureProfile: forkSide ? sharedStraightForkCurvatureProfiles[forkSide] : null,
      forkSide,
      maximumCenterOffset: forkSide ? straightForkMaximumOffset(forkSide) : 0,
      decisionNodeId: options.decisionNodeId || null,
      heading,
      launchable: jumpPlatforms.length > 0,
      jumpPlatformCorridor,
      jumpPlatforms,
      ramp: null,
      rampId: null,
      lipS: null,
      legacyEventType: null
    });
    runtimeEdgesById.set(id, edge);
    return edge;
  }

  function recoveryTopologyKey(tile) {
    return `${tile.token}|${tile.exitPort}`;
  }

  function recoveryTopologyIds(tile) {
    const stem = `${tile.token}:${tile.exitPort}`;
    return Object.freeze({
      recoveryIn: `${tile.token}:recovery-in-${tile.exitPort}`,
      launch: `${tile.token}:launch-${tile.exitPort}`,
      forkApproach: `${tile.token}:straight-fork-approach-${tile.exitPort}`,
      forkLeft: `${tile.token}:straight-fork-left-${tile.exitPort}`,
      forkRight: `${tile.token}:straight-fork-right-${tile.exitPort}`,
      recoveryOut: `${tile.token}:recovery-out-${tile.exitPort}`,
      decisionNode: `${stem}:straight-fork-decision`,
      mergeNode: `${stem}:straight-fork-merge`,
      leftMovement: `${stem}:straight-fork-movement-left`,
      rightMovement: `${stem}:straight-fork-movement-right`
    });
  }

  function pointAlongRecovery(start, direction, distance) {
    return {
      x: start.x + direction.x * distance,
      y: start.y,
      z: start.z + direction.z * distance
    };
  }

  /**
   * Connect two tiles with a shared 900m entry, a stable-length flat jump-platform corridor, a 500m decision
   * approach, two real 900m branch roads, and a 376m base tail. Only the selected branch enters PathPlan,
   * while topology retains both roads for rendering, airborne landing support, clearance, and candidate scoring.
   */
  function registerRecovery(tile, nextTile) {
    const key = recoveryTopologyKey(tile);
    if (runtimeRecoveryTopologiesByKey.has(key)) return runtimeRecoveryTopologiesByKey.get(key);
    const ids = recoveryTopologyIds(tile);
    const exitNode = tile.index === 0
      ? graphNodesById[`exit-${tile.exitPort}`]
      : runtimeNodesById.get(scopedTemplateId(tile, `exit-${tile.exitPort}`));
    const entryNode = runtimeNodesById.get(scopedTemplateId(nextTile, `entry-${nextTile.entryPort}`));
    const direction = { x: Math.cos(exitNode.heading), z: Math.sin(exitNode.heading) };
    const start = exitNode.world;
    const launchStart = pointAlongRecovery(start, direction, CLOVERLEAF_LAUNCH_OFFSET);
    const launchEnd = pointAlongRecovery(
      start,
      direction,
      CLOVERLEAF_LAUNCH_OFFSET + CLOVERLEAF_LAUNCH_LENGTH
    );
    const forkStart = pointAlongRecovery(
      start,
      direction,
      CLOVERLEAF_LAUNCH_OFFSET + CLOVERLEAF_LAUNCH_LENGTH + STRAIGHT_FORK_APPROACH_LENGTH
    );
    const forkEnd = pointAlongRecovery(
      start,
      direction,
      CLOVERLEAF_LAUNCH_OFFSET + CLOVERLEAF_LAUNCH_LENGTH
        + STRAIGHT_FORK_APPROACH_LENGTH + STRAIGHT_FORK_BRANCH_PLANAR_LENGTH
    );
    const end = entryNode.world;
    const requiredPlanarLength = nextTile.incomingRecoveryPlanarLength || CLOVERLEAF_RECOVERY_LENGTH;
    const recoveryOutPlanarLength = requiredPlanarLength
      - CLOVERLEAF_LAUNCH_OFFSET
      - CLOVERLEAF_LAUNCH_LENGTH
      - STRAIGHT_FORK_APPROACH_LENGTH
      - STRAIGHT_FORK_BRANCH_PLANAR_LENGTH;
    if (recoveryOutPlanarLength + 0.000_001 < STRAIGHT_FORK_BASE_OUT_LENGTH) {
      throw new Error(`Straight-fork recovery tail is shorter than ${STRAIGHT_FORK_BASE_OUT_LENGTH}m`);
    }
    const launchStartNodeId = `${tile.token}:launch-start-${tile.exitPort}`;
    const launchEndNodeId = `${tile.token}:launch-end-${tile.exitPort}`;
    createRuntimeNode(launchStartNodeId, 'launch-start', launchStart, exitNode.heading, tile);
    createRuntimeNode(launchEndNodeId, 'launch-end', launchEnd, exitNode.heading, tile);
    createRuntimeNode(ids.decisionNode, 'decision', forkStart, exitNode.heading, tile, {
      decisionType: 'straight-fork',
      transitionIds: Object.freeze([ids.leftMovement, ids.rightMovement])
    });
    createRuntimeNode(ids.mergeNode, 'straight-fork-merge', forkEnd, exitNode.heading, tile);
    createRecoveryEdge(
      ids.recoveryIn,
      exitNode.id,
      launchStartNodeId,
      start,
      launchStart,
      'recovery',
      [ids.launch],
      tile,
      nextTile
    );
    createRecoveryEdge(
      ids.launch,
      launchStartNodeId,
      launchEndNodeId,
      launchStart,
      launchEnd,
      'recovery',
      [ids.forkApproach],
      tile,
      nextTile,
      true
    );
    createRecoveryEdge(
      ids.forkApproach,
      launchEndNodeId,
      ids.decisionNode,
      launchEnd,
      forkStart,
      'straight-fork-approach',
      [ids.forkLeft, ids.forkRight],
      tile,
      nextTile,
      false,
      { maneuver: 'straight-fork-approach', decisionNodeId: ids.decisionNode }
    );
    const leftEdge = createRecoveryEdge(
      ids.forkLeft,
      ids.decisionNode,
      ids.mergeNode,
      forkStart,
      forkEnd,
      'straight-fork-branch',
      [ids.recoveryOut],
      tile,
      nextTile,
      false,
      { maneuver: 'straight-fork-left', forkSide: STRAIGHT_FORK_LEFT, decisionNodeId: ids.decisionNode }
    );
    const rightEdge = createRecoveryEdge(
      ids.forkRight,
      ids.decisionNode,
      ids.mergeNode,
      forkStart,
      forkEnd,
      'straight-fork-branch',
      [ids.recoveryOut],
      tile,
      nextTile,
      false,
      { maneuver: 'straight-fork-right', forkSide: STRAIGHT_FORK_RIGHT, decisionNodeId: ids.decisionNode }
    );
    createRecoveryEdge(
      ids.recoveryOut,
      ids.mergeNode,
      entryNode.id,
      forkEnd,
      end,
      'recovery',
      [scopedTemplateId(nextTile, `approach-${nextTile.entryPort}`)],
      tile,
      nextTile
    );

    const movementSpecs = [
      [STRAIGHT_FORK_LEFT, ids.leftMovement, leftEdge, Object.freeze({ min: Number.NEGATIVE_INFINITY, max: 0 })],
      [STRAIGHT_FORK_RIGHT, ids.rightMovement, rightEdge, Object.freeze({ min: 0, max: Number.POSITIVE_INFINITY })]
    ];
    for (const [forkSide, movementIdValue, edge, entryGate] of movementSpecs) {
      runtimeMovementsById.set(movementIdValue, Object.freeze({
        id: movementIdValue,
        movementId: movementIdValue,
        transitionId: movementIdValue,
        runtimeKind: 'straight-fork-transition',
        decisionType: 'straight-fork',
        decisionNodeId: ids.decisionNode,
        collectorDecisionNodeId: null,
        entryPort: tile.entryPort,
        exitPort: tile.exitPort,
        kind: `straight-fork-${forkSide}`,
        forkSide,
        label: forkSide === STRAIGHT_FORK_LEFT ? '左岔路' : '右岔路',
        shortLabel: forkSide === STRAIGHT_FORK_LEFT ? '左支' : '右支',
        routeType: 'surface-fork',
        edgeIds: Object.freeze([edge.id]),
        cumulativeLengths: Object.freeze([0]),
        length: edge.length,
        entryGate,
        collectorGate: null,
        fallback: forkSide === STRAIGHT_FORK_LEFT,
        toEdgeId: edge.id,
        maxCurvature: straightForkProfiles[forkSide].maximumAbsCurvature,
        gradeCost: 0,
        lengthPenalty: 0,
        tileIndex: tile.index,
        tileToken: tile.token
      }));
    }

    const selectedEdgeIds = Object.freeze({
      [STRAIGHT_FORK_LEFT]: Object.freeze([
        ids.recoveryIn,
        ids.launch,
        ids.forkApproach,
        ids.forkLeft,
        ids.recoveryOut
      ]),
      [STRAIGHT_FORK_RIGHT]: Object.freeze([
        ids.recoveryIn,
        ids.launch,
        ids.forkApproach,
        ids.forkRight,
        ids.recoveryOut
      ])
    });
    const visualEdgeIds = Object.freeze([
      ids.recoveryIn,
      ids.launch,
      ids.forkApproach,
      ids.forkLeft,
      ids.forkRight,
      ids.recoveryOut
    ]);
    const actualPlanarLength = Math.hypot(end.x - start.x, end.z - start.z);
    if (Math.abs(actualPlanarLength - requiredPlanarLength) > 0.000_001) {
      throw new Error(`Recovery planar distance contract violated: ${actualPlanarLength}`);
    }
    for (const forkSide of [STRAIGHT_FORK_LEFT, STRAIGHT_FORK_RIGHT]) {
      const totalLength = selectedEdgeIds[forkSide]
        .reduce((sum, edgeId) => sum + runtimeEdgesById.get(edgeId).length, 0);
      if (totalLength + 0.000_001 < requiredPlanarLength) {
        throw new Error(`Recovery distance contract violated for ${forkSide}: ${totalLength}`);
      }
    }
    const topology = Object.freeze({
      key,
      tileToken: tile.token,
      tileIndex: tile.index,
      exitPort: tile.exitPort,
      nextTileToken: nextTile.token,
      decisionNodeId: ids.decisionNode,
      movementIds: Object.freeze([ids.leftMovement, ids.rightMovement]),
      selectedEdgeIds,
      visualEdgeIds,
      recoveryOutPlanarLength,
      requiredPlanarLength,
      maximumCenterOffset: STRAIGHT_FORK_MAXIMUM_OFFSET
    });
    runtimeRecoveryTopologiesByKey.set(key, topology);
    runtimeRecoveryForksByDecisionId.set(ids.decisionNode, topology);
    recordRuntimeTopologyHighWater();
    return topology;
  }

  function makeInitialTile(entryPort) {
    const tile = {
      index: 0,
      historyKey: '',
      token: tileToken(0, '', entryPort),
      centerX: 0,
      centerZ: 0,
      entryPort
    };
    return registerRuntimeTile(tile);
  }

  function makeNextTile(previousTile, recentTiles = []) {
    const exitNode = graphNodesById[`exit-${previousTile.exitPort}`];
    const nextEntryPort = OPPOSITE_PORT[previousTile.exitPort];
    const nextEntryNode = graphNodesById[`entry-${nextEntryPort}`];
    const direction = { x: Math.cos(exitNode.heading), z: Math.sin(exitNode.heading) };
    const historyKey = nextTileHistoryKey(previousTile.historyKey, previousTile.exitPort);
    const recentFootprints = recentTiles
      .slice(-CLOVERLEAF_RECENT_TILE_AVOIDANCE_COUNT)
      .map((tile) => tile.footprint || tileFootprint(tile.centerX, tile.centerZ));
    let incomingRecoveryPlanarLength = CLOVERLEAF_RECOVERY_LENGTH;
    let recoveryExtensionSteps = 0;
    while (true) {
      const desiredEntryX = previousTile.centerX + exitNode.world.x
        + direction.x * incomingRecoveryPlanarLength;
      const desiredEntryZ = previousTile.centerZ + exitNode.world.z
        + direction.z * incomingRecoveryPlanarLength;
      const centerX = desiredEntryX - nextEntryNode.world.x;
      const centerZ = desiredEntryZ - nextEntryNode.world.z;
      const footprint = tileFootprint(centerX, centerZ);
      if (!recentFootprints.some((recentFootprint) => footprintsOverlap(footprint, recentFootprint))) {
        return registerRuntimeTile({
          index: previousTile.index + 1,
          historyKey,
          token: tileToken(previousTile.index + 1, historyKey),
          centerX,
          centerZ,
          entryPort: nextEntryPort,
          footprint,
          incomingRecoveryPlanarLength,
          recoveryExtensionSteps
        });
      }
      incomingRecoveryPlanarLength += CLOVERLEAF_RECOVERY_EXTENSION;
      recoveryExtensionSteps += 1;
      if (recoveryExtensionSteps > 32) {
        throw new Error(`Unable to place non-overlapping itinerary tile after ${previousTile.token}`);
      }
    }
  }

  function movementForTile(tile, kind) {
    const baseId = movementId(tile.entryPort, kind);
    return tile.index === 0
      ? graphMovementsById[baseId]
      : runtimeMovementsById.get(scopedTemplateId(tile, baseId));
  }

  function committedMovementKind(tile, committedChoices, fallbackKind) {
    const decisionId = scopedTemplateId(tile, `decision-${tile.entryPort}`);
    const collectorDecisionId = scopedTemplateId(tile, `collector-decision-${tile.entryPort}`);
    for (const nodeId of [collectorDecisionId, decisionId]) {
      const movement = runtimeMovementsById.get(committedChoices?.[nodeId])
        || graphMovementsById[committedChoices?.[nodeId]];
      if (movement?.entryPort === tile.entryPort) return movement.kind;
    }
    return CLOVERLEAF_KINDS.includes(fallbackKind) ? fallbackKind : 'straight';
  }

  /** Resolve one recovery fork independently from the cloverleaf movement that selected the source tile exit. */
  function committedStraightForkSide(topology, committedChoices) {
    const movement = getMovement(committedChoices?.[topology.decisionNodeId]);
    return movement?.decisionNodeId === topology.decisionNodeId
      && movement.forkSide === STRAIGHT_FORK_RIGHT
      ? STRAIGHT_FORK_RIGHT
      : STRAIGHT_FORK_LEFT;
  }

  function createTilePlanSpec(tile, kind) {
    const movement = movementForTile(tile, kind);
    return Object.freeze({
      ...tile,
      kind,
      movementId: movement.id,
      exitPort: movement.exitPort,
      edgeIds: movement.edgeIds,
      decisionNodeId: movement.decisionNodeId,
      collectorDecisionNodeId: movement.collectorDecisionNodeId
    });
  }

  function createEdgeIndexMap(edgeIds) {
    const edgeIndexById = new Map();
    for (let index = 0; index < edgeIds.length; index++) edgeIndexById.set(edgeIds[index], index);
    return edgeIndexById;
  }

  function appendPlanEdges(plan, edgeIds) {
    for (const edgeId of edgeIds) {
      if (plan.edgeIndexById.has(edgeId)) {
        throw new Error(`PathPlan edge ids must remain unique: ${edgeId}`);
      }
      plan.cumulativeLengths.push(plan.length);
      plan.edgeIndexById.set(edgeId, plan.edgeIds.length);
      plan.edgeIds.push(edgeId);
      plan.length += (runtimeEdgesById.get(edgeId) || graphEdgesById[edgeId]).length;
    }
  }

  function appendNextItineraryTile(plan) {
    const previous = plan.tiles[plan.tiles.length - 1];
    const nextTile = makeNextTile(previous, plan.tiles);
    const recoveryTopology = registerRecovery(previous, nextTile);
    const forkSide = committedStraightForkSide(recoveryTopology, plan._committedChoices);
    appendPlanEdges(plan, recoveryTopology.selectedEdgeIds[forkSide]);
    const fallbackKind = plan._futureKinds?.[nextTile.index] || plan._futureKind;
    const kind = committedMovementKind(nextTile, plan._committedChoices, fallbackKind);
    const nextSpec = createTilePlanSpec(nextTile, kind);
    plan.tiles.push(nextSpec);
    appendPlanEdges(plan, nextSpec.edgeIds);
    return nextSpec;
  }

  /** Register future route topology early so visual pooling can build it away from a live interchange transition. */
  function ensureItineraryHorizon(plan, cursor, tilesAhead = 1) {
    if (!plan?.itinerary || !plan.tiles?.length || !cursor?.edgeId) return;
    const currentTileIndex = getEdge(cursor.edgeId)?.tileIndex ?? cursor.tileIndex ?? plan.tileBaseIndex ?? 0;
    while (plan.tiles[plan.tiles.length - 1].index < currentTileIndex + tilesAhead) {
      appendNextItineraryTile(plan);
    }
  }

  /** Remove retired tile-scoped decisions while preserving unscoped launch metadata and every live choice. */
  function compactTileScopedChoices(choices, minimumTileIndex) {
    if (!choices || typeof choices !== 'object') return choices;
    const compacted = {};
    for (const [key, value] of Object.entries(choices)) {
      const keyScope = parseTileScopedId(key);
      const valueScope = parseTileScopedId(value);
      if (
        (keyScope && keyScope.tileIndex < minimumTileIndex)
        || (valueScope && valueScope.tileIndex < minimumTileIndex)
      ) continue;
      compacted[key] = value;
    }
    return compacted;
  }

  /**
   * Rebase one mutable itinerary around its oldest still-needed tile. Cursors, Film signed sampling, entity motion,
   * and route decisions keep exact edge ids; only an unreachable prefix and its cumulative/index tables are removed.
   */
  function compactItineraryPlan(plan, minimumTileIndex = 0) {
    if (!plan?.itinerary || !Array.isArray(plan.tiles) || !Array.isArray(plan.edgeIds)) {
      return Object.freeze({ compacted: false, removedTileCount: 0, removedEdgeCount: 0 });
    }
    const requestedMinimum = Math.max(0, Math.trunc(Number(minimumTileIndex) || 0));
    const firstRetainedTile = plan.tiles.find((tile) => tile.index >= requestedMinimum);
    if (!firstRetainedTile) {
      return Object.freeze({ compacted: false, removedTileCount: 0, removedEdgeCount: 0 });
    }
    const effectiveMinimum = firstRetainedTile.index;
    const retainedTiles = plan.tiles.filter((tile) => tile.index >= effectiveMinimum);
    const retainedEdgeIds = plan.edgeIds.filter((edgeId) => {
      const edge = getEdge(edgeId);
      return edge && (edge.tileIndex ?? 0) >= effectiveMinimum;
    });
    const removedTileCount = plan.tiles.length - retainedTiles.length;
    const removedEdgeCount = plan.edgeIds.length - retainedEdgeIds.length;
    if (removedTileCount === 0 && removedEdgeCount === 0) {
      return Object.freeze({
        compacted: false,
        removedTileCount: 0,
        removedEdgeCount: 0,
        minimumTileIndex: effectiveMinimum
      });
    }
    if (!retainedEdgeIds.length) {
      return Object.freeze({ compacted: false, removedTileCount: 0, removedEdgeCount: 0 });
    }
    const cumulativeLengths = [];
    let retainedLength = 0;
    for (const edgeId of retainedEdgeIds) {
      const edge = getEdge(edgeId);
      if (!edge) {
        throw new Error(`Cannot compact PathPlan ${plan.id}: missing retained edge ${edgeId}`);
      }
      cumulativeLengths.push(retainedLength);
      retainedLength += edge.length;
    }
    plan.tiles = retainedTiles;
    plan.edgeIds = retainedEdgeIds;
    plan.edgeIndexById = createEdgeIndexMap(retainedEdgeIds);
    plan.cumulativeLengths = cumulativeLengths;
    plan.length = retainedLength;
    plan.tileBaseIndex = effectiveMinimum;
    plan._committedChoices = compactTileScopedChoices(plan._committedChoices, effectiveMinimum);
    if (plan.committedChoices) {
      plan.committedChoices = Object.freeze(
        compactTileScopedChoices(plan.committedChoices, effectiveMinimum)
      );
    }
    if (plan.proposedChoices) {
      plan.proposedChoices = compactTileScopedChoices(plan.proposedChoices, effectiveMinimum);
    }
    if (plan.lockedChoices) {
      plan.lockedChoices = compactTileScopedChoices(plan.lockedChoices, effectiveMinimum);
    }
    runtimeTopologyLifecycle.compactedPathPlanCount++;
    runtimeTopologyLifecycle.compactedPathPlanTileCount += removedTileCount;
    runtimeTopologyLifecycle.compactedPathPlanEdgeCount += removedEdgeCount;
    return Object.freeze({
      compacted: true,
      removedTileCount,
      removedEdgeCount,
      minimumTileIndex: effectiveMinimum
    });
  }

  /**
   * Retire complete token-owned topology only outside the caller's hard current/Film/prewarm window. `liveTileTokens`
   * are explicit leases for detached entities, residents, landing variants, or plans that legitimately outlive it.
   */
  function pruneRuntimeTopology(options = {}) {
    const minimumProtectedTileIndex = Number.isInteger(options.minimumProtectedTileIndex)
      ? options.minimumProtectedTileIndex
      : null;
    const maximumProtectedTileIndex = Number.isInteger(options.maximumProtectedTileIndex)
      ? options.maximumProtectedTileIndex
      : null;
    if (
      minimumProtectedTileIndex === null
      || maximumProtectedTileIndex === null
      || maximumProtectedTileIndex < minimumProtectedTileIndex
    ) {
      return Object.freeze({
        pruned: false,
        reason: 'invalid-protected-tile-window',
        retiredTileCount: 0,
        retiredTileTokens: Object.freeze([])
      });
    }
    const liveTileTokens = options.liveTileTokens instanceof Set
      ? new Set(options.liveTileTokens)
      : new Set(Array.isArray(options.liveTileTokens) ? options.liveTileTokens : []);
    const protectedTokens = new Set([...liveTileTokens].filter((token) => typeof token === 'string'));
    for (const tile of runtimeTilesByToken.values()) {
      if (
        tile.index >= minimumProtectedTileIndex
        && tile.index <= maximumProtectedTileIndex
      ) protectedTokens.add(tile.token);
    }
    // A live source owns exactly one recovery seam into its destination. Snapshot the owner set first: recursively
    // treating a dependency destination as a new owner would retain every registered future tile in the chain.
    const recoveryDependencySources = new Set(protectedTokens);
    for (const topology of runtimeRecoveryTopologiesByKey.values()) {
      if (recoveryDependencySources.has(topology.tileToken)) {
        protectedTokens.add(topology.nextTileToken);
      }
    }
    for (const [tileTokenValue, record] of bidirectionalVisualEdgesByTileToken) {
      const nextTileToken = record.opposingRecovery?.nextTileToken;
      if (recoveryDependencySources.has(tileTokenValue) && nextTileToken) {
        protectedTokens.add(nextTileToken);
      }
    }
    const retiredTileTokens = [...runtimeTilesByToken.values()]
      .filter((tile) => !protectedTokens.has(tile.token))
      .sort((a, b) => a.index - b.index || a.token.localeCompare(b.token))
      .map((tile) => tile.token);
    const retiredTokenSet = new Set(retiredTileTokens);
    let retiredNodeCount = 0;
    let retiredEdgeCount = 0;
    let retiredMovementCount = 0;
    let retiredRecoveryTopologyCount = 0;
    let retiredRecoveryForkCount = 0;
    let retiredBidirectionalRecordCount = 0;
    for (const [id, node] of runtimeNodesById) {
      if (!retiredTokenSet.has(node.tileToken)) continue;
      runtimeNodesById.delete(id);
      retiredNodeCount++;
    }
    for (const [id, edge] of runtimeEdgesById) {
      if (!retiredTokenSet.has(edge.tileToken)) continue;
      runtimeEdgesById.delete(id);
      retiredEdgeCount++;
    }
    for (const [id, movement] of runtimeMovementsById) {
      if (!retiredTokenSet.has(movement.tileToken)) continue;
      runtimeMovementsById.delete(id);
      retiredMovementCount++;
    }
    for (const [key, topology] of runtimeRecoveryTopologiesByKey) {
      if (!retiredTokenSet.has(topology.tileToken)) continue;
      runtimeRecoveryTopologiesByKey.delete(key);
      retiredRecoveryTopologyCount++;
    }
    for (const [decisionNodeId, topology] of runtimeRecoveryForksByDecisionId) {
      if (!retiredTokenSet.has(topology.tileToken)) continue;
      runtimeRecoveryForksByDecisionId.delete(decisionNodeId);
      retiredRecoveryForkCount++;
    }
    for (const token of retiredTileTokens) {
      const record = bidirectionalVisualEdgesByTileToken.get(token);
      if (record) {
        record.selectionCache.clear();
        bidirectionalVisualEdgesByTileToken.delete(token);
        retiredBidirectionalRecordCount++;
      }
      runtimeTilesByToken.delete(token);
    }
    runtimeTopologyLifecycle.pruneRunCount++;
    runtimeTopologyLifecycle.retiredTileCount += retiredTileTokens.length;
    runtimeTopologyLifecycle.retiredNodeCount += retiredNodeCount;
    runtimeTopologyLifecycle.retiredEdgeCount += retiredEdgeCount;
    runtimeTopologyLifecycle.retiredMovementCount += retiredMovementCount;
    runtimeTopologyLifecycle.retiredRecoveryTopologyCount += retiredRecoveryTopologyCount;
    runtimeTopologyLifecycle.retiredRecoveryForkCount += retiredRecoveryForkCount;
    runtimeTopologyLifecycle.retiredBidirectionalRecordCount += retiredBidirectionalRecordCount;
    runtimeTopologyLifecycle.lastLeaseTokenCount = liveTileTokens.size;
    runtimeTopologyLifecycle.lastMinimumProtectedTileIndex = minimumProtectedTileIndex;
    runtimeTopologyLifecycle.lastMaximumProtectedTileIndex = maximumProtectedTileIndex;
    runtimeTopologyLifecycle.lastRetiredTileTokens = Object.freeze(retiredTileTokens);
    return Object.freeze({
      pruned: retiredTileTokens.length > 0,
      retiredTileCount: retiredTileTokens.length,
      retiredNodeCount,
      retiredEdgeCount,
      retiredMovementCount,
      retiredRecoveryTopologyCount,
      retiredRecoveryForkCount,
      retiredBidirectionalRecordCount,
      retainedTileCount: runtimeTilesByToken.size,
      leaseTokenCount: liveTileTokens.size,
      minimumProtectedTileIndex,
      maximumProtectedTileIndex,
      retiredTileTokens: Object.freeze(retiredTileTokens)
    });
  }

  /** Publish bounded CPU-registry evidence separately from renderer.info's GPU-only counters. */
  function getRuntimeTopologyDiagnostics() {
    let registeredTokenCharacterCount = 0;
    let maximumRegisteredTokenLength = 0;
    for (const token of runtimeTilesByToken.keys()) {
      registeredTokenCharacterCount += token.length;
      maximumRegisteredTokenLength = Math.max(maximumRegisteredTokenLength, token.length);
    }
    return Object.freeze({
      registeredTileCount: runtimeTilesByToken.size,
      registeredNodeCount: runtimeNodesById.size,
      registeredEdgeCount: runtimeEdgesById.size,
      registeredMovementCount: runtimeMovementsById.size,
      registeredRecoveryTopologyCount: runtimeRecoveryTopologiesByKey.size,
      registeredRecoveryForkCount: runtimeRecoveryForksByDecisionId.size,
      registeredBidirectionalRecordCount: bidirectionalVisualEdgesByTileToken.size,
      registeredTokenCharacterCount,
      maximumRegisteredTokenLength,
      tileHistoryDigestVersion: TILE_HISTORY_DIGEST_VERSION,
      tileHistoryDigestHexLength: TILE_HISTORY_DIGEST_HEX_LENGTH,
      maximumTileTokenLengthContract: 55,
      ...runtimeTopologyLifecycle
    });
  }

  function buildItineraryPlan(input, startTile, firstKind) {
    const firstSpec = createTilePlanSpec(startTile, firstKind);
    const movement = movementForTile(startTile, firstKind);
    const plan = {
      id: `itinerary:${movement.id}`,
      itinerary: true,
      movementId: movement.id,
      entryPort: movement.entryPort,
      exitPort: movement.exitPort,
      kind: movement.kind,
      label: movement.label,
      edgeIds: [],
      edgeIndexById: new Map(),
      cumulativeLengths: [],
      length: 0,
      decisionNodeId: movement.decisionNodeId,
      committedThroughNodeId: movement.decisionNodeId,
      tiles: [firstSpec],
      tileBaseIndex: startTile.index,
      _committedChoices: { ...(input.committedChoices || {}) },
      _futureKinds: Array.isArray(input.itineraryKinds) ? [...input.itineraryKinds] : null,
      _futureKind: CLOVERLEAF_KINDS.includes(input.futureMovementKind) ? input.futureMovementKind : 'straight',
      version: 0
    };
    appendPlanEdges(plan, firstSpec.edgeIds);
    let requiredLastTileIndex = startTile.index + CLOVERLEAF_INITIAL_TILE_COUNT - 1;
    for (const scopedId of [
      ...Object.keys(input.committedChoices || {}),
      ...Object.values(input.committedChoices || {})
    ]) {
      const parsed = parseTileScopedId(scopedId);
      if (parsed) requiredLastTileIndex = Math.max(requiredLastTileIndex, parsed.tileIndex + 2);
    }
    while (plan.tiles[plan.tiles.length - 1].index < requiredLastTileIndex) appendNextItineraryTile(plan);
    return plan;
  }

  function getNode(nodeId) {
    return graphNodesById[nodeId] || runtimeNodesById.get(nodeId) || null;
  }

  function getEdge(edgeId) {
    return graphEdgesById[edgeId] || runtimeEdgesById.get(edgeId) || null;
  }

  /**
   * Enumerate registered runtime alternatives for one itinerary index so detached visual planners can exclude
   * mutually exclusive warm variants without repeatedly discovering them through global clearance queries.
   */
  function getRuntimeEdgesForTileIndex(tileIndex) {
    if (!Number.isInteger(tileIndex)) return Object.freeze([]);
    const candidateCount = runtimeEdgesById.size;
    runtimeTopologyLifecycle.runtimeTileIndexQueryCount++;
    runtimeTopologyLifecycle.runtimeTileIndexLastCandidateCount = candidateCount;
    runtimeTopologyLifecycle.runtimeTileIndexMaximumCandidateCount = Math.max(
      runtimeTopologyLifecycle.runtimeTileIndexMaximumCandidateCount,
      candidateCount
    );
    return Object.freeze([...runtimeEdgesById.values()].filter((edge) => edge.tileIndex === tileIndex));
  }

  function getMovement(movementIdValue) {
    return graphMovementsById[movementIdValue] || runtimeMovementsById.get(movementIdValue) || null;
  }

  function routePosition(values = {}) {
    return {
      edgeId: values.edgeId ?? null,
      edgeS: Number.isFinite(values.edgeS) ? values.edgeS : 0,
      lateral: Number.isFinite(values.lateral) ? values.lateral : 0,
      runDistance: Number.isFinite(values.runDistance) ? values.runDistance : 0,
      entryPort: values.entryPort ?? null,
      tileIndex: Number.isInteger(values.tileIndex) ? values.tileIndex : 0,
      exited: Boolean(values.exited)
    };
  }

  function cloneRouteCursor(cursor, out = {}) {
    out.edgeId = cursor?.edgeId ?? null;
    out.edgeS = Number.isFinite(cursor?.edgeS) ? cursor.edgeS : 0;
    out.lateral = Number.isFinite(cursor?.lateral) ? cursor.lateral : 0;
    out.runDistance = Number.isFinite(cursor?.runDistance) ? cursor.runDistance : 0;
    out.entryPort = cursor?.entryPort ?? null;
    out.tileIndex = Number.isInteger(cursor?.tileIndex) ? cursor.tileIndex : 0;
    out.exited = Boolean(cursor?.exited);
    return out;
  }

  function resolveMovementId(input = {}) {
    if (typeof input === 'string' && getMovement(input)) return input;
    if (getMovement(input?.movementId)) return input.movementId;
    const entryPort = CLOVERLEAF_PORTS.includes(input?.entryPort) ? input.entryPort : 'south';
    const requestedKind = input?.kind ?? input?.movementKind;
    const kind = committedMovementKind(makeInitialTile(entryPort), input?.committedChoices, requestedKind);
    return movementId(entryPort, kind);
  }

  function createSingleTilePathPlan(input = {}) {
    const resolvedMovementId = resolveMovementId(input);
    const movement = getMovement(resolvedMovementId);
    if (!movement) throw new Error(`Unknown cloverleaf movement: ${resolvedMovementId}`);
    return Object.freeze({
      id: `plan:${resolvedMovementId}`,
      itinerary: false,
      movementId: movement.id,
      entryPort: movement.entryPort,
      exitPort: movement.exitPort,
      kind: movement.kind,
      label: movement.label,
      edgeIds: movement.edgeIds,
      edgeIndexById: createEdgeIndexMap(movement.edgeIds),
      cumulativeLengths: movement.cumulativeLengths,
      length: movement.length,
      decisionNodeId: movement.decisionNodeId,
      committedThroughNodeId: movement.decisionNodeId
    });
  }

  function createPathPlan(input = {}) {
    const options = typeof input === 'string' ? { movementId: input } : input;
    if (options.singleTile || options.itinerary === false) return createSingleTilePathPlan(options);
    const explicitMovement = getMovement(options.movementId);
    const explicitStraightFork = explicitMovement?.runtimeKind === 'straight-fork-transition';
    if (explicitMovement?.tileIndex > 0 && !explicitStraightFork) {
      const tile = runtimeTilesByToken.get(explicitMovement.tileToken);
      if (!tile) throw new Error(`Missing runtime tile: ${explicitMovement.tileToken}`);
      return buildItineraryPlan(options, tile, explicitMovement.kind);
    }
    const entryPort = (!explicitStraightFork && explicitMovement?.entryPort)
      || (CLOVERLEAF_PORTS.includes(options.entryPort) ? options.entryPort : 'south');
    const initialTile = makeInitialTile(entryPort);
    const requestedKind = explicitStraightFork
      ? options.kind ?? options.movementKind
      : explicitMovement?.kind ?? options.kind ?? options.movementKind;
    const committedChoices = explicitStraightFork
      ? { ...(options.committedChoices || {}), [explicitMovement.decisionNodeId]: explicitMovement.id }
      : options.committedChoices;
    const normalizedOptions = committedChoices === options.committedChoices
      ? options
      : { ...options, committedChoices };
    const firstKind = committedMovementKind(initialTile, committedChoices, requestedKind);
    return buildItineraryPlan(normalizedOptions, initialTile, firstKind);
  }

  /**
   * Prepare an exclusively held route candidate away from a commit frame. Consumers may inspect `plan`, then
   * call `select()` at the portal; callers must not extend its itinerary horizon before that explicit selection.
   */
  function preparePathPlanCandidate(input = {}) {
    const plan = createPathPlan(input);
    // A candidate identifies the transition being prepared, even when its complete itinerary retains the
    // initial cloverleaf movement as plan.movementId. Commit queues use this identity for fork and cloverleaf alike.
    const candidateMovementId = getMovement(input.movementId)?.id || plan.movementId;
    let selected = false;
    return Object.freeze({
      id: `candidate:${input.decisionId || plan.decisionNodeId || 'decision'}:${candidateMovementId}`,
      decisionId: input.decisionId || plan.decisionNodeId || null,
      movementId: candidateMovementId,
      plan,
      get selected() { return selected; },
      select() {
        selected = true;
        return plan;
      }
    });
  }

  function getInitialRouteCursor(input = {}) {
    const options = typeof input === 'string' ? { entryPort: input } : input;
    const plan = options.pathPlan || createPathPlan(options);
    const edgeId = plan.edgeIds[0];
    return routePosition({
      edgeId,
      edgeS: 0,
      lateral: options.lateral,
      runDistance: options.runDistance,
      entryPort: plan.entryPort,
      tileIndex: plan.tileBaseIndex || 0,
      exited: false
    });
  }

  function sampleAtDistance(samples, edgeS) {
    const targetS = clamp(edgeS, 0, samples[samples.length - 1].surfaceS);
    let low = 0;
    let high = samples.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (samples[middle].surfaceS <= targetS) low = middle;
      else high = middle;
    }
    const a = samples[low];
    const b = samples[Math.min(samples.length - 1, low + 1)];
    const span = b.surfaceS - a.surfaceS;
    const t = span > 0.000_001 ? (targetS - a.surfaceS) / span : 0;
    return {
      s: targetS,
      planarS: a.s + (b.s - a.s) * t,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      heading: lerpAngleValue(a.heading, b.heading, t),
      curvature: a.curvature + (b.curvature - a.curvature) * t
    };
  }

  function sampleHeight(edge, edgeS) {
    const profile = edge.heightProfile;
    if (profile.mode === 'piecewise-tunnel' && profile.segments?.length) {
      let height = profile.startHeight;
      for (const segment of profile.segments) {
        if (edgeS <= segment.startS) return { height, grade: 0 };
        if (edgeS < segment.endS) {
          const span = segment.endS - segment.startS;
          if (segment.profile === 'grade-limited-c2') {
            const heightDelta = segment.endHeight - segment.startHeight;
            const ramp = sampleGradeLimitedRamp(
              heightDelta,
              edgeS - segment.startS,
              span,
              segment.transitionLength
            );
            return {
              height: segment.startHeight + ramp.height,
              grade: ramp.grade
            };
          }
          const t = clamp((edgeS - segment.startS) / span, 0, 1);
          const heightDelta = segment.endHeight - segment.startHeight;
          return {
            height: segment.startHeight + heightDelta * smootherStep01(t),
            grade: heightDelta * smootherStepDerivative01(t) / span
          };
        }
        height = segment.endHeight;
      }
      return { height, grade: 0 };
    }
    let height = profile.startHeight;
    let grade = 0;
    if (profile.gradeLength > 0) {
      const t = clamp((edgeS - profile.startS) / profile.gradeLength, 0, 1);
      const heightDelta = profile.endHeight - profile.startHeight;
      height += heightDelta * smootherStep01(t);
      grade += heightDelta * smootherStepDerivative01(t) / profile.gradeLength;
    }
    for (const feature of edge.verticalFeatures || []) {
      if (edgeS <= feature.startS || edgeS >= feature.endS) continue;
      if (feature.profile === 'grade-limited-c2') {
        if (edgeS < feature.riseEndS) {
          const ramp = sampleGradeLimitedRamp(
            feature.heightDelta,
            edgeS - feature.startS,
            feature.riseEndS - feature.startS,
            feature.transitionLength
          );
          height += ramp.height;
          grade += ramp.grade;
        } else if (edgeS <= feature.fallStartS) {
          height += feature.heightDelta;
        } else {
          const ramp = sampleGradeLimitedRamp(
            feature.heightDelta,
            feature.endS - edgeS,
            feature.endS - feature.fallStartS,
            feature.transitionLength
          );
          height += ramp.height;
          grade -= ramp.grade;
        }
        continue;
      }
      if (edgeS < feature.riseEndS) {
        const t = (edgeS - feature.startS) / (feature.riseEndS - feature.startS);
        height += feature.heightDelta * smootherStep01(t);
        grade += feature.heightDelta * smootherStepDerivative01(t) / (feature.riseEndS - feature.startS);
      } else if (edgeS <= feature.fallStartS) {
        height += feature.heightDelta;
      } else {
        const t = (feature.endS - edgeS) / (feature.endS - feature.fallStartS);
        height += feature.heightDelta * smootherStep01(t);
        grade -= feature.heightDelta * smootherStepDerivative01(t) / (feature.endS - feature.fallStartS);
      }
    }
    return { height, grade };
  }

  function planarStationAtSurfaceStation(profile, surfaceS) {
    const targetS = clamp(surfaceS, 0, profile.surfaceLength);
    const low = sampleIntervalIndex(profile.surfaceStations, targetS);
    const high = Math.min(profile.surfaceStations.length - 1, low + 1);
    const span = profile.surfaceStations[high] - profile.surfaceStations[low];
    const t = span > 0.000_001 ? (targetS - profile.surfaceStations[low]) / span : 0;
    return profile.planarStations[low]
      + (profile.planarStations[high] - profile.planarStations[low]) * t;
  }

  function surfaceStationAtPlanarStation(profile, planarS) {
    const targetS = clamp(planarS, 0, profile.planarLength);
    const low = sampleIntervalIndex(profile.planarStations, targetS);
    const high = Math.min(profile.planarStations.length - 1, low + 1);
    const span = profile.planarStations[high] - profile.planarStations[low];
    const t = span > 0.000_001 ? (targetS - profile.planarStations[low]) / span : 0;
    return profile.surfaceStations[low]
      + (profile.surfaceStations[high] - profile.surfaceStations[low]) * t;
  }

  const straightForkSampleScratch = {};
  const straightForkClearanceScratchA = {};
  const straightForkClearanceScratchB = {};
  const opposingCrossoverSampleScratch = {};
  const opposingCrossoverVerticalScratch = {};
  const opposingCrossoverCurvatureScratch = {};
  const opposingCrossoverClearanceScratchA = {};
  const opposingCrossoverClearanceScratchB = {};
  const roadClearanceVerticalFrameScratch = {};
  const roadClearanceVerticalResultScratch = {};
  // Three local 2×2 corrections remove bank/grade XZ drift to floating-point scale. This epsilon is contact noise,
  // not permission for a support to enter the road slab.
  const ROAD_CLEARANCE_VERTICAL_CONTACT_TOLERANCE_M = 0.000_001;
  const ROAD_CLEARANCE_VERTICAL_PROJECTION_ITERATIONS = 3;

  /** Sample the raised crossover centreline from its straight-stabilized C2 lateral profile. */
  function writeOpposingCrossoverCenter(edge, planarS, out = {}) {
    const profile = edge.opposingCrossoverProfileLut;
    const clampedPlanarS = clamp(planarS, 0, profile.planarLength);
    const transitionS = clamp(
      clampedPlanarS - profile.lateralStartS,
      0,
      profile.lateralTransitionLength
    );
    sampleOpposingCrossoverLateral(profile, transitionS, out);
    const offset = out.offset;
    const slope = out.slope;
    const secondDerivative = out.secondDerivative;
    const tangentX = Math.cos(edge.heading);
    const tangentZ = Math.sin(edge.heading);
    const baseRightX = -tangentZ;
    const baseRightZ = tangentX;
    const tangentScale = 1 / Math.hypot(1, slope);
    out.x = edge.recoveryStart.x + tangentX * clampedPlanarS + baseRightX * offset;
    out.z = edge.recoveryStart.z + tangentZ * clampedPlanarS + baseRightZ * offset;
    out.horizontalTangentX = (tangentX + baseRightX * slope) * tangentScale;
    out.horizontalTangentZ = (tangentZ + baseRightZ * slope) * tangentScale;
    out.curvature = secondDerivative / Math.pow(1 + slope * slope, 1.5);
    out.roadHalf = opposingCrossoverRoadHalf(profile, clampedPlanarS, edge.roadHalf);
    return out;
  }

  /** Narrow only the dedicated flyover body; both landing and main-road joins retain their full sealed width. */
  function opposingCrossoverRoadHalf(profile, planarS, fullRoadHalf) {
    const station = clamp(planarS, 0, profile.planarLength);
    const connectorRoadHalf = Number(profile.connectorRoadHalf) || fullRoadHalf;
    if (station <= profile.widthNarrowStartS) return fullRoadHalf;
    if (station < profile.widthNarrowEndS) {
      const blend = smootherStep01(
        (station - profile.widthNarrowStartS)
          / Math.max(0.000_001, profile.widthNarrowEndS - profile.widthNarrowStartS)
      );
      return fullRoadHalf + (connectorRoadHalf - fullRoadHalf) * blend;
    }
    if (station <= profile.widthWidenStartS) return connectorRoadHalf;
    if (station < profile.widthWidenEndS) {
      const blend = smootherStep01(
        (station - profile.widthWidenStartS)
          / Math.max(0.000_001, profile.widthWidenEndS - profile.widthWidenStartS)
      );
      return connectorRoadHalf + (fullRoadHalf - connectorRoadHalf) * blend;
    }
    return fullRoadHalf;
  }

  /** Write one fork centerline frame from its analytic mirrored offset profile. */
  function writeStraightForkCenter(edge, planarS, out = {}) {
    const side = edge.forkSide === STRAIGHT_FORK_LEFT ? -1 : 1;
    writeStraightForkProfile(planarS, edge.forkSide, straightForkSampleScratch);
    const tangentX = Math.cos(edge.heading);
    const tangentZ = Math.sin(edge.heading);
    const baseRightX = -tangentZ;
    const baseRightZ = tangentX;
    const unsignedOffset = straightForkSampleScratch.offset;
    const voidWidthM = straightForkSampleScratch.combinedVoidWidthM;
    const signedOffset = unsignedOffset * side;
    const signedSlope = straightForkSampleScratch.slope * side;
    const tangentScale = 1 / Math.hypot(1, signedSlope);
    out.x = edge.recoveryStart.x + tangentX * planarS + baseRightX * signedOffset;
    out.z = edge.recoveryStart.z + tangentZ * planarS + baseRightZ * signedOffset;
    out.horizontalTangentX = (tangentX + baseRightX * signedSlope) * tangentScale;
    out.horizontalTangentZ = (tangentZ + baseRightZ * signedSlope) * tangentScale;
    out.curvature = straightForkSampleScratch.curvature * side;
    out.roadHalf = straightForkSampleScratch.roadHalf;
    out.straightForkOffsetM = unsignedOffset;
    out.straightForkVoidWidthM = voidWidthM;
    return out;
  }

  function sampleRoadHalf(edge, edgeS) {
    if (edge.forkSide && edge.straightForkProfileLut) {
      const planarS = planarStationAtSurfaceStation(edge.straightForkProfileLut, edgeS);
      return writeStraightForkProfile(planarS, edge.forkSide, straightForkSampleScratch).roadHalf;
    }
    if (edge.family === 'mainline' || edge.family === 'approach') return edge.roadHalf;
    if (edge.opposingCrossoverProfileLut) {
      const planarS = planarStationAtSurfaceStation(edge.opposingCrossoverProfileLut, edgeS);
      return opposingCrossoverRoadHalf(edge.opposingCrossoverProfileLut, planarS, edge.roadHalf);
    }
    const endpointDistance = Math.min(edgeS, edge.length - edgeS);
    const blend = smootherStep01(endpointDistance / CLOVERLEAF_WIDTH_BLEND_LENGTH);
    return CLOVERLEAF_MAIN_ROAD_HALF + (edge.roadHalf - CLOVERLEAF_MAIN_ROAD_HALF) * blend;
  }

  function sampleBank(edge, edgeS, curvature) {
    if (edge.bankProfile.maxRadians <= 0 || Math.abs(curvature) <= 0.000_001) return 0;
    const startDistance = edgeS;
    const endDistance = edge.length - edgeS;
    const endpointDistance = Math.min(startDistance, endDistance);
    const flatLength = startDistance <= endDistance
      ? edge.bankProfile.startFlatLength || 0
      : edge.bankProfile.endFlatLength || 0;
    const envelope = smootherStep01(
      (endpointDistance - flatLength) / Math.max(1, edge.bankProfile.transitionLength)
    );
    const designCurvature = edge.opposingCrossoverProfileLut
      ? Math.max(0.000_000_001, edge.curvatureProfile?.maxAbsCurvature || 0)
      : edge.family === 'loop-ramp'
        ? 1 / CLOVERLEAF_LOOP_RADIUS
        : 1 / CLOVERLEAF_DIRECT_RADIUS;
    const curvatureRatio = clamp(Math.abs(curvature) / designCurvature, 0, 1);
    // Positive curvature turns toward the frame's right axis, so negative bank must lower that inside edge.
    return -Math.sign(curvature) * edge.bankProfile.maxRadians * smootherStep01(curvatureRatio) * envelope;
  }

  /**
   * Initialize every edge-family-specific field before a reusable sample object crosses graph, recovery, visual,
   * or translated-template branches. Absence is explicit so a prior tunnel or runtime edge cannot retain authority.
   */
  function initializeEdgeSampleVariantFields(out) {
    out.tunnelKind = null;
    out.tunnelProfileId = null;
    out.covered = false;
    out.templateEdgeId = null;
    out.nextTileIndex = null;
    out.runtimeKind = null;
    out.visualKind = null;
    out.visualOnly = false;
    out.verticalCurvature = null;
    out.spatialCurvature = null;
    out.straightForkOffsetM = 0;
    out.straightForkVoidWidthM = 0;
    return out;
  }

  function sampleRecoveryEdge(edge, edgeS, lateral, out) {
    initializeEdgeSampleVariantFields(out);
    const s = clamp(edgeS, 0, edge.length);
    let planarS = s;
    let height = 0;
    let grade = 0;
    let phase = 'recovery';
    let launchable = false;
    let curvature = 0;
    let verticalCurvature = 0;
    let spatialCurvature = 0;
    let verticalSecondDerivative = 0;
    let roadHalf = edge.roadHalf;
    let straightForkOffsetM = 0;
    let straightForkVoidWidthM = 0;
    if (edge.jumpPlatformCorridor) {
      // Preserve the former logical edge length while its physical chord is flat; platform support is sampled
      // separately so neither the road shell nor an adjacent lane inherits a full-width vertical hump.
      planarS = edge.length > 0.000_001 ? edge.planarLength * s / edge.length : 0;
      phase = 'jump-platform-corridor';
    } else if (edge.forkSide && edge.straightForkProfileLut) {
      planarS = planarStationAtSurfaceStation(edge.straightForkProfileLut, s);
      phase = `fork-${edge.forkSide}`;
    } else if (edge.opposingCrossoverProfileLut) {
      planarS = planarStationAtSurfaceStation(edge.opposingCrossoverProfileLut, s);
      const vertical = sampleOpposingCrossoverVertical(
        edge.opposingCrossoverProfileLut,
        planarS,
        opposingCrossoverVerticalScratch
      );
      height = vertical.height;
      grade = vertical.grade;
      verticalSecondDerivative = vertical.secondDerivative;
      phase = 'opposing-crossover';
    }
    const pathT = edge.planarLength > 0.000_001 ? planarS / edge.planarLength : 0;
    let centerX = edge.recoveryStart.x + (edge.recoveryEnd.x - edge.recoveryStart.x) * pathT;
    const centerY = edge.recoveryStart.y + height;
    let centerZ = edge.recoveryStart.z + (edge.recoveryEnd.z - edge.recoveryStart.z) * pathT;
    let horizontalTangentX = Math.cos(edge.heading);
    let horizontalTangentZ = Math.sin(edge.heading);
    if (edge.forkSide) {
      const forkFrame = writeStraightForkCenter(edge, planarS, straightForkSampleScratch);
      centerX = forkFrame.x;
      centerZ = forkFrame.z;
      horizontalTangentX = forkFrame.horizontalTangentX;
      horizontalTangentZ = forkFrame.horizontalTangentZ;
      curvature = forkFrame.curvature;
      roadHalf = forkFrame.roadHalf;
      straightForkOffsetM = forkFrame.straightForkOffsetM;
      straightForkVoidWidthM = forkFrame.straightForkVoidWidthM;
    } else if (edge.opposingCrossoverProfileLut) {
      const crossoverFrame = writeOpposingCrossoverCenter(
        edge,
        planarS,
        opposingCrossoverSampleScratch
      );
      centerX = crossoverFrame.x;
      centerZ = crossoverFrame.z;
      horizontalTangentX = crossoverFrame.horizontalTangentX;
      horizontalTangentZ = crossoverFrame.horizontalTangentZ;
      curvature = crossoverFrame.curvature;
      roadHalf = crossoverFrame.roadHalf;
      const curvatureComponents = writeOpposingCrossoverCurvatureComponents(
        crossoverFrame.slope,
        crossoverFrame.secondDerivative,
        grade,
        verticalSecondDerivative,
        opposingCrossoverCurvatureScratch
      );
      verticalCurvature = curvatureComponents.vertical;
      spatialCurvature = curvatureComponents.spatial;
    }
    if (!edge.opposingCrossoverProfileLut) spatialCurvature = Math.abs(curvature);
    const tangentScale = 1 / Math.hypot(1, grade);
    const tangentX = horizontalTangentX * tangentScale;
    const tangentY = grade * tangentScale;
    const tangentZ = horizontalTangentZ * tangentScale;
    const baseRightX = -horizontalTangentZ;
    const baseRightZ = horizontalTangentX;
    const baseUpX = -grade * horizontalTangentX * tangentScale;
    const baseUpY = tangentScale;
    const baseUpZ = -grade * horizontalTangentZ * tangentScale;
    const bank = sampleBank(edge, s, curvature);
    const bankCos = Math.cos(bank);
    const bankSin = Math.sin(bank);
    const rightX = baseRightX * bankCos + baseUpX * bankSin;
    const rightY = baseUpY * bankSin;
    const rightZ = baseRightZ * bankCos + baseUpZ * bankSin;
    const upX = baseUpX * bankCos - baseRightX * bankSin;
    const upY = baseUpY * bankCos;
    const upZ = baseUpZ * bankCos - baseRightZ * bankSin;
    out.edgeId = edge.id;
    out.edgeS = s;
    out.surfaceId = edge.surfaceId;
    out.layer = edge.layer;
    out.centerX = centerX;
    out.centerY = centerY;
    out.centerZ = centerZ;
    out.x = centerX + rightX * lateral;
    out.y = centerY + rightY * lateral;
    out.z = centerZ + rightZ * lateral;
    out.surfaceHeight = centerY;
    out.ceilingHeight = Number.POSITIVE_INFINITY;
    out.deckHeight = null;
    out.underpassBlend = 0;
    out.eventType = edge.visualOnly
      ? 'bidirectional-visual-corridor'
      : edge.jumpPlatformCorridor
        ? 'jump-platform-corridor'
        : edge.forkSide
          ? 'straight-road-fork'
          : edge.opposingCrossoverProfileLut ? 'opposing-crossover' : 'recovery-corridor';
    out.phase = phase;
    out.tangentX = tangentX;
    out.tangentY = tangentY;
    out.tangentZ = tangentZ;
    out.horizontalTangentX = horizontalTangentX;
    out.horizontalTangentZ = horizontalTangentZ;
    out.rightX = rightX;
    out.rightY = rightY;
    out.rightZ = rightZ;
    out.upX = upX;
    out.upY = upY;
    out.upZ = upZ;
    out.heading = Math.atan2(horizontalTangentZ, horizontalTangentX);
    out.yaw = Math.atan2(-tangentX, -tangentZ);
    out.grade = grade;
    out.bank = bank;
    // Horizontal signed curvature remains the steering/bank contract; vertical and spatial values are read-only
    // diagnostics for ride load and must never change the driver's turn direction.
    out.curvature = curvature;
    out.verticalCurvature = verticalCurvature;
    out.spatialCurvature = spatialCurvature;
    out.roadHalf = roadHalf;
    out.safeHalf = roadHalf - 0.78;
    out.straightForkOffsetM = straightForkOffsetM;
    out.straightForkVoidWidthM = straightForkVoidWidthM;
    out.structure = null;
    out.maneuver = edge.maneuver;
    out.family = edge.family;
    out.launchable = launchable;
    out.rampId = launchable ? edge.rampId : null;
    out.ramp = launchable ? edge.ramp : null;
    out.lipS = edge.lipS ?? null;
    out.tileIndex = edge.tileIndex;
    out.nextTileIndex = edge.nextTileIndex ?? null;
    out.runtimeKind = edge.runtimeKind || null;
    out.visualKind = edge.visualKind || null;
    out.visualOnly = Boolean(edge.visualOnly);
    return out;
  }

  /** Sample one graph edge by local arc length; this is the single geometry source for render, physics, map, and AI. */
  function sampleEdge(edgeId, edgeS, lateral = 0, out = {}) {
    const runtimeEdge = runtimeEdgesById.get(edgeId);
    if (runtimeEdge?.runtimeKind === 'recovery'
      || runtimeEdge?.runtimeKind === BIDIRECTIONAL_VISUAL_RUNTIME_KIND) {
      return sampleRecoveryEdge(runtimeEdge, edgeS, lateral, out);
    }
    if (runtimeEdge?.runtimeKind === 'template') {
      sampleEdge(runtimeEdge.templateEdgeId, edgeS, lateral, out);
      out.edgeId = runtimeEdge.id;
      out.surfaceId = runtimeEdge.surfaceId;
      out.centerX += runtimeEdge.offsetX;
      out.centerZ += runtimeEdge.offsetZ;
      out.x += runtimeEdge.offsetX;
      out.z += runtimeEdge.offsetZ;
      out.tileIndex = runtimeEdge.tileIndex;
      out.templateEdgeId = runtimeEdge.templateEdgeId;
      out.nextTileIndex = runtimeEdge.nextTileIndex ?? null;
      out.runtimeKind = runtimeEdge.runtimeKind;
      out.visualKind = runtimeEdge.visualKind || null;
      out.visualOnly = Boolean(runtimeEdge.visualOnly);
      return out;
    }
    const edge = graphEdgesById[edgeId];
    const samples = graphEdgeSamples.get(edgeId);
    if (!edge || !samples) throw new Error(`Unknown cloverleaf edge: ${edgeId}`);
    initializeEdgeSampleVariantFields(out);
    const center = sampleAtDistance(samples, edgeS);
    const heightSample = sampleHeight(edge, center.planarS);
    const bank = sampleBank(edge, center.s, center.curvature);
    const horizontalTangentX = Math.cos(center.heading);
    const horizontalTangentZ = Math.sin(center.heading);
    const tangentScale = 1 / Math.hypot(1, heightSample.grade);
    const tangentX = horizontalTangentX * tangentScale;
    const tangentY = heightSample.grade * tangentScale;
    const tangentZ = horizontalTangentZ * tangentScale;
    const baseRightX = -horizontalTangentZ;
    const baseRightZ = horizontalTangentX;
    const baseUpX = -heightSample.grade * horizontalTangentX * tangentScale;
    const baseUpY = tangentScale;
    const baseUpZ = -heightSample.grade * horizontalTangentZ * tangentScale;
    const bankCos = Math.cos(bank);
    const bankSin = Math.sin(bank);
    const rightX = baseRightX * bankCos + baseUpX * bankSin;
    const rightY = baseUpY * bankSin;
    const rightZ = baseRightZ * bankCos + baseUpZ * bankSin;
    const upX = baseUpX * bankCos - baseRightX * bankSin;
    const upY = baseUpY * bankCos;
    const upZ = baseUpZ * bankCos - baseRightZ * bankSin;
    const surfaceX = center.x + rightX * lateral;
    const surfaceZ = center.z + rightZ * lateral;
    let ceilingHeight = Number.POSITIVE_INFINITY;
    let structure = null;
    let deckHeight = null;
    let underpassBlend = 0;
    for (const crossing of graphCrossingsByEdge.get(edgeId) || []) {
      if (edgeId === crossing.lowerEdgeId && Math.abs(center.planarS - crossing.lowerPlanarS) <= crossing.maskSpan * 0.5) {
        const crossingCeiling = crossing.soffitPlane
          ? crossing.soffitPlane.originHeight
            + crossing.soffitPlane.gradientX * (surfaceX - crossing.soffitPlane.originX)
            + crossing.soffitPlane.gradientZ * (surfaceZ - crossing.soffitPlane.originZ)
          : crossing.soffitHeight
            ?? crossing.deckHeight - CLOVERLEAF_DECK_THICKNESS - (crossing.soffitDepth || 0);
        ceilingHeight = Math.min(
          ceilingHeight,
          crossingCeiling
        );
        structure = 'cloverleaf-underpass';
        deckHeight = crossing.deckHeight;
        underpassBlend = Math.max(
          underpassBlend,
          smootherStep01(1 - Math.abs(center.planarS - crossing.lowerPlanarS) / (crossing.maskSpan * 0.5))
        );
      } else if (edgeId === crossing.upperEdgeId
        && Math.abs(center.planarS - crossing.upperPlanarS) <= crossing.upperMaskSpan * 0.5) {
        structure = 'cloverleaf-overpass';
        deckHeight = crossing.deckHeight;
      }
    }
    const tunnelProfile = (edge.tunnelProfiles || []).find((profile) => (
      center.planarS >= profile.startS && center.planarS <= profile.endS
    )) || null;
    if (tunnelProfile) {
      const portalBlend = Math.max(1, Number(tunnelProfile.portalBlend) || CLOVERLEAF_TUNNEL_PORTAL_BLEND);
      const entryBlend = smootherStep01((center.planarS - tunnelProfile.startS) / portalBlend);
      const exitBlend = smootherStep01((tunnelProfile.endS - center.planarS) / portalBlend);
      const coveredBlend = Math.min(entryBlend, exitBlend);
      // Physics stores one world-Y ceiling, so include the raised bank edge to preserve the declared local
      // clearance for both sides of a curved tunnel instead of protecting only its centreline.
      const tunnelCeiling = heightSample.height + tunnelProfile.clearance
        + Math.abs(rightY) * sampleRoadHalf(edge, center.s);
      ceilingHeight = Math.min(ceilingHeight, tunnelCeiling);
      structure = tunnelProfile.kind;
      deckHeight = tunnelCeiling;
      underpassBlend = Math.max(underpassBlend, coveredBlend);
    }
    const roadHalfAtS = sampleRoadHalf(edge, center.s);
    out.edgeId = edge.id;
    out.edgeS = center.s;
    out.surfaceId = edge.surfaceId;
    out.layer = tunnelProfile?.kind === 'underground-tunnel' ? 'underground' : edge.layer;
    out.centerX = center.x;
    out.centerY = heightSample.height;
    out.centerZ = center.z;
    out.x = surfaceX;
    out.y = heightSample.height + rightY * lateral;
    out.z = surfaceZ;
    out.surfaceHeight = heightSample.height;
    out.ceilingHeight = ceilingHeight;
    out.deckHeight = deckHeight;
    out.underpassBlend = underpassBlend;
    out.eventType = 'cloverleaf-interchange';
    out.phase = structure || edge.maneuver;
    out.tangentX = tangentX;
    out.tangentY = tangentY;
    out.tangentZ = tangentZ;
    out.horizontalTangentX = horizontalTangentX;
    out.horizontalTangentZ = horizontalTangentZ;
    out.rightX = rightX;
    out.rightY = rightY;
    out.rightZ = rightZ;
    out.upX = upX;
    out.upY = upY;
    out.upZ = upZ;
    out.heading = center.heading;
    out.yaw = Math.atan2(-horizontalTangentX, -horizontalTangentZ);
    out.grade = heightSample.grade;
    out.bank = bank;
    out.curvature = center.curvature;
    out.roadHalf = roadHalfAtS;
    out.safeHalf = Math.max(0, roadHalfAtS - 0.78);
    out.structure = structure;
    out.tunnelKind = tunnelProfile?.kind || null;
    out.tunnelProfileId = tunnelProfile?.id || null;
    out.covered = Boolean(tunnelProfile);
    out.maneuver = edge.maneuver;
    out.family = edge.family;
    out.launchable = false;
    out.rampId = null;
    out.ramp = null;
    out.lipS = null;
    out.tileIndex = 0;
    out.templateEdgeId = edge.id;
    return out;
  }

  function sampleRouteCursor(cursor, lateral = cursor?.lateral ?? 0, out = {}) {
    return sampleEdge(cursor.edgeId, cursor.edgeS, lateral, out);
  }

  function planEdgeIndex(pathPlan, edgeId) {
    const mappedIndex = pathPlan?.edgeIndexById?.get?.(edgeId);
    // Some render-only callers intentionally clone a plan with a shortened edge list; validate before using its inherited map.
    if (Number.isInteger(mappedIndex) && pathPlan.edgeIds?.[mappedIndex] === edgeId) return mappedIndex;
    return pathPlan?.edgeIds?.indexOf(edgeId) ?? -1;
  }

  function advanceCursorInternal(cursor, deltaDistance, pathPlan) {
    const plan = pathPlan || createPathPlan({ entryPort: cursor?.entryPort });
    const result = cloneRouteCursor(cursor, {});
    const requestedDistance = Math.max(0, Number.isFinite(deltaDistance) ? deltaDistance : 0);
    let remaining = requestedDistance;
    let index = planEdgeIndex(plan, result.edgeId);
    if (index < 0) throw new Error(`Cursor edge ${result.edgeId} is not in ${plan.id}`);
    const crossedTransitions = [];
    let positionJump = 0;
    let headingJumpDeg = 0;
    let gradeJump = 0;
    while (remaining > 0.000_001 && index < plan.edgeIds.length) {
      const edge = getEdge(result.edgeId);
      const available = Math.max(0, edge.length - result.edgeS);
      if (remaining <= available + 0.000_001) {
        result.edgeS = Math.min(edge.length, result.edgeS + remaining);
        remaining = 0;
        break;
      }
      remaining -= available;
      if (index + 1 >= plan.edgeIds.length && plan.itinerary) appendNextItineraryTile(plan);
      if (index + 1 >= plan.edgeIds.length) {
        result.edgeS = edge.length;
        result.exited = true;
        remaining = 0;
        break;
      }
      const before = sampleEdge(edge.id, edge.length, result.lateral, {});
      const nextEdgeId = plan.edgeIds[++index];
      const after = sampleEdge(nextEdgeId, 0, result.lateral, {});
      const jump = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
      const headingJump = Math.abs(Math.atan2(
        Math.sin(after.heading - before.heading),
        Math.cos(after.heading - before.heading)
      )) * 180 / Math.PI;
      positionJump = Math.max(positionJump, jump);
      headingJumpDeg = Math.max(headingJumpDeg, headingJump);
      gradeJump = Math.max(gradeJump, Math.abs(after.grade - before.grade));
      crossedTransitions.push(Object.freeze({
        fromEdgeId: edge.id,
        toEdgeId: nextEdgeId,
        nodeId: edge.to,
        positionJump: jump,
        headingJumpDeg: headingJump,
        gradeJump: Math.abs(after.grade - before.grade)
      }));
      result.edgeId = nextEdgeId;
      result.edgeS = 0;
      result.tileIndex = getEdge(nextEdgeId)?.tileIndex ?? result.tileIndex;
      result.entryPort = getEdge(nextEdgeId)?.entryPort ?? result.entryPort;
      result.exited = false;
    }
    result.runDistance += requestedDistance;
    return {
      cursor: result,
      transitionCount: crossedTransitions.length,
      crossedTransitions: Object.freeze(crossedTransitions),
      positionJump,
      headingJumpDeg,
      gradeJump
    };
  }

  /** Advance on the committed linear plan and return the new cursor only. */
  function advanceCursor(cursor, deltaDistance, pathPlan, out = {}) {
    const report = advanceCursorInternal(cursor, deltaDistance, pathPlan);
    return cloneRouteCursor(report.cursor, out);
  }

  /** Runtime adapter returns transition diagnostics in addition to the advanced cursor. */
  function advanceRouteCursor(cursor, deltaDistance, pathPlan) {
    return advanceCursorInternal(cursor, deltaDistance, pathPlan);
  }

  /**
   * Swept graph/lateral query prevents a high-speed frame from skipping a table lip or launching from beside it.
   * Footprint overlap is intentionally separate from route selection: a platform never enters PathPlan.
   */
  function crossedJumpPlatformLip(
    previousCursor,
    currentCursor,
    pathPlan,
    previousLateral = 0,
    currentLateral = previousLateral,
    footprintHalfWidth = 0
  ) {
    if (!previousCursor || !currentCursor || !pathPlan) return null;
    const startIndex = planEdgeIndex(pathPlan, previousCursor.edgeId);
    const endIndex = planEdgeIndex(pathPlan, currentCursor.edgeId);
    if (startIndex < 0 || endIndex < startIndex) return null;
    let totalDistance = 0;
    for (let index = startIndex; index <= endIndex; index++) {
      const edge = getEdge(pathPlan.edgeIds[index]);
      if (!edge) continue;
      const fromS = index === startIndex ? previousCursor.edgeS : 0;
      const toS = index === endIndex ? currentCursor.edgeS : edge.length;
      if (toS > fromS) totalDistance += toS - fromS;
    }
    if (!(totalDistance > 0.000_001)) return null;
    let elapsedDistance = 0;
    for (let index = startIndex; index <= endIndex; index++) {
      const edge = getEdge(pathPlan.edgeIds[index]);
      if (!edge) continue;
      const fromS = index === startIndex ? previousCursor.edgeS : 0;
      const toS = index === endIndex ? currentCursor.edgeS : edge.length;
      for (const platform of edge.jumpPlatforms || []) {
        if (!(fromS < platform.lipS && toS >= platform.lipS)) continue;
        const crossingFraction = clamp(
          (elapsedDistance + platform.lipS - fromS) / totalDistance,
          0,
          1
        );
        const startLateral = Number(previousLateral) || 0;
        const endLateral = Number(currentLateral) || 0;
        const crossingLateral = startLateral + (endLateral - startLateral) * crossingFraction;
        const craftHalfWidth = Math.max(0, Number(footprintHalfWidth) || 0);
        if (
          Math.abs(crossingLateral - platform.lateral) + craftHalfWidth
          <= platform.halfWidth + 0.000_001
        ) {
          return platform;
        }
      }
      if (toS > fromS) elapsedDistance += toS - fromS;
    }
    return null;
  }

  /** One-release compatibility alias; new runtime code must pass lateral chronology to the platform API above. */
  function crossedLaunchLip(previousCursor, currentCursor, pathPlan) {
    return crossedJumpPlatformLip(previousCursor, currentCursor, pathPlan);
  }

  function samplePathFrame(cursor, aheadDistance, pathPlan, lateral = cursor?.lateral ?? 0, out = {}) {
    const advanced = advanceCursor(cursor, Math.max(0, aheadDistance || 0), pathPlan, {});
    return sampleRouteCursor(advanced, lateral, out);
  }

  /**
   * Sample a signed PathPlan offset without mutating its forward-only RoutePosition. Cameras may retreat across
   * graph seams, while gameplay progression and route commits continue to use advanceRouteCursor exclusively.
   */
  function sampleSignedPathFrame(cursor, signedDistance, pathPlan, lateral = cursor?.lateral ?? 0, out = {}) {
    const offset = Number.isFinite(signedDistance) ? signedDistance : 0;
    if (offset >= 0) return samplePathFrame(cursor, offset, pathPlan, lateral, out);
    const edgeIds = pathPlan?.edgeIds || [];
    let edgeIndex = planEdgeIndex(pathPlan, cursor?.edgeId);
    if (edgeIndex < 0) return sampleRouteCursor(cursor, lateral, out);
    let edgeS = clamp(Number(cursor.edgeS) || 0, 0, getEdge(cursor.edgeId).length) + offset;
    while (edgeS < 0 && edgeIndex > 0) {
      edgeIndex--;
      const previousEdge = getEdge(edgeIds[edgeIndex]);
      if (!previousEdge) break;
      edgeS += previousEdge.length;
    }
    const targetEdge = getEdge(edgeIds[edgeIndex]);
    if (!targetEdge) return sampleRouteCursor(cursor, lateral, out);
    return sampleEdge(targetEdge.id, clamp(edgeS, 0, targetEdge.length), lateral, out);
  }

  function pathDistanceAt(cursor, pathPlan) {
    const index = planEdgeIndex(pathPlan, cursor.edgeId);
    if (index < 0) return Number.POSITIVE_INFINITY;
    return pathPlan.cumulativeLengths[index] + clamp(cursor.edgeS, 0, getEdge(cursor.edgeId).length);
  }

  /** Return signed along-plan distance; callers may pass an already prepared plan to avoid rebuilding a candidate. */
  function forwardDistance(cursor, target, pathPlan, movementOverride = null) {
    const plan = movementOverride?.edgeIds
      ? movementOverride
      : movementOverride ? createPathPlan(movementOverride) : pathPlan;
    if (!plan || !cursor || !target) return Number.POSITIVE_INFINITY;
    const fromDistance = pathDistanceAt(cursor, plan);
    const toDistance = pathDistanceAt(target, plan);
    if (!Number.isFinite(fromDistance) || !Number.isFinite(toDistance)) return Number.POSITIVE_INFINITY;
    return toDistance - fromDistance;
  }

  function distanceAlongPath(cursor, target, pathPlan, movementOverride = null) {
    return forwardDistance(cursor, target, pathPlan, movementOverride);
  }

  /**
   * Find the next lower-deck crossing on the committed path before the camera reaches its physical mask.
   * Template crossing stations remain valid for translated runtime edges because translation never changes edge arc length.
   */
  function getUpcomingLowerCrossing(cursor, pathPlan, lookAhead = Number.POSITIVE_INFINITY) {
    if (!cursor || !pathPlan) return null;
    const startIndex = planEdgeIndex(pathPlan, cursor.edgeId);
    if (startIndex < 0) return null;
    let distanceToEdgeStart = -clamp(cursor.edgeS, 0, getEdge(cursor.edgeId).length);
    let best = null;
    for (let index = startIndex; index < pathPlan.edgeIds.length; index++) {
      const edgeId = pathPlan.edgeIds[index];
      const edge = getEdge(edgeId);
      const templateEdgeId = edge?.templateEdgeId || edge?.id;
      if (!edge) break;
      for (const crossing of graphCrossingsByEdge.get(templateEdgeId) || []) {
        if (crossing.lowerEdgeId !== templateEdgeId) continue;
        const distance = distanceToEdgeStart + crossing.lowerEdgeS;
        if (distance < -crossing.maskSpan * 0.5 || distance > lookAhead) continue;
        if (!best || distance < best.distance) {
          best = Object.freeze({
            id: crossing.id,
            lowerEdgeId: edgeId,
            upperEdgeId: crossing.upperEdgeId,
            distance,
            maskSpan: crossing.maskSpan,
            deckHeight: crossing.deckHeight,
            ceilingHeight: crossing.soffitHeight
              ?? crossing.deckHeight - CLOVERLEAF_DECK_THICKNESS - (crossing.soffitDepth || 0),
            clearance: crossing.clearance
          });
        }
      }
      if (best || distanceToEdgeStart > lookAhead) break;
      distanceToEdgeStart += edge.length;
    }
    return best;
  }

  function resolveEntryPort(input) {
    if (typeof input === 'string') {
      if (CLOVERLEAF_PORTS.includes(input)) return input;
      if (input.startsWith('entry-')) return input.slice('entry-'.length);
      if (input.startsWith('decision-')) return input.slice('decision-'.length);
    }
    if (CLOVERLEAF_PORTS.includes(input?.entryPort)) return input.entryPort;
    const edge = getEdge(input?.edgeId);
    return edge?.entryPort || null;
  }

  /** Enumerate the three semantic movements available from an entry or its current approach cursor. */
  function enumerateMovements(input = 'south') {
    const entryPort = resolveEntryPort(input) || 'south';
    const inputEdge = getEdge(input?.edgeId);
    const parsedInput = parseTileScopedId(typeof input === 'string' ? input : input?.id);
    const tileTokenValue = input?.tileToken || inputEdge?.tileToken || parsedInput?.token || null;
    const tile = tileTokenValue ? runtimeTilesByToken.get(tileTokenValue) : null;
    return CLOVERLEAF_KINDS.map((kind) => {
      const baseMovementId = movementId(entryPort, kind);
      const movement = tile?.index > 0
        ? runtimeMovementsById.get(scopedTemplateId(tile, baseMovementId))
        : graphMovementsById[baseMovementId];
      return Object.freeze({
        ...movement,
        movementId: movement.id,
        cursor: Object.freeze(routePosition({
          edgeId: movement.edgeIds[1],
          edgeS: 0,
          entryPort,
          tileIndex: tile?.index || 0,
          exited: false
        }))
      });
    });
  }

  /** Resolve the same shallow interior lane for player/autopilot portals and decorative split markings. */
  function gateTargetForHalfWidth(gate, halfWidth) {
    const safeHalfWidth = Math.max(0, Number(halfWidth) || 0);
    const minimum = gate?.min ?? Number.NEGATIVE_INFINITY;
    const maximum = gate?.max ?? Number.POSITIVE_INFINITY;
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
      return clamp((minimum + maximum) * 0.5, -safeHalfWidth, safeHalfWidth);
    }
    if (Number.isFinite(minimum)) return clamp(minimum + 0.8, -safeHalfWidth, safeHalfWidth);
    if (Number.isFinite(maximum)) return clamp(Math.min(0, maximum - 0.8), -safeHalfWidth, safeHalfWidth);
    return 0;
  }

  function outgoingForDecisionEdge(edge) {
    const straightFork = edge.decisionNodeId
      ? runtimeRecoveryForksByDecisionId.get(edge.decisionNodeId)
      : null;
    if (straightFork && edge.family === 'straight-fork-approach') {
      return Object.freeze(straightFork.movementIds.map((movementIdValue) => {
        const movement = getMovement(movementIdValue);
        return Object.freeze({
          id: movement.id,
          movementId: movement.id,
          toEdgeId: movement.toEdgeId,
          kind: movement.kind,
          label: movement.label,
          routeType: movement.routeType,
          entryGate: movement.entryGate,
          fallback: movement.fallback,
          edgeIds: movement.edgeIds,
          maxCurvature: movement.maxCurvature
        });
      }));
    }
    if (edge.family !== 'approach' && edge.family !== 'collector') return null;
    const allowedKinds = edge.family === 'collector' ? new Set(['right', 'left']) : new Set(CLOVERLEAF_KINDS);
    return Object.freeze(enumerateMovements({
      entryPort: edge.entryPort,
      tileToken: edge.tileToken,
      edgeId: edge.id
    }).filter((movement) => allowedKinds.has(movement.kind)).map((movement) => {
      // Both turning movements share the first collector portal; its second portal separates right and loop-left.
      const entryGate = edge.family === 'approach'
        ? movement.kind === 'straight'
          ? { min: -Number.POSITIVE_INFINITY, max: 1.6 }
          : { min: 1.6, max: Number.POSITIVE_INFINITY }
        : movement.kind === 'right'
          ? { min: 1.6, max: Number.POSITIVE_INFINITY }
          : { min: -Number.POSITIVE_INFINITY, max: 1.6 };
      return Object.freeze({
        id: movement.id,
        movementId: movement.id,
        toEdgeId: edge.family === 'collector' ? movement.edgeIds[2] : movement.edgeIds[1],
        kind: movement.kind,
        label: movement.label,
        routeType: movement.routeType,
        entryGate: Object.freeze(entryGate),
        fallback: movement.fallback,
        edgeIds: movement.edgeIds
      });
    }));
  }

  /** Return the nearest commit portal, including a recovery fork that lies beyond shared straight edges. */
  function getUpcomingDecisions(cursor, lookAhead = Number.POSITIVE_INFINITY, pathPlan = null) {
    ensureItineraryHorizon(pathPlan, cursor, 1);
    const currentEdge = getEdge(cursor?.edgeId);
    if (!currentEdge) return [];
    const startIndex = pathPlan ? planEdgeIndex(pathPlan, currentEdge.id) : 0;
    if (pathPlan && startIndex < 0) return [];
    const edgeIds = pathPlan?.edgeIds || [currentEdge.id];
    let distanceToEdgeStart = -clamp(cursor.edgeS, 0, currentEdge.length);
    for (let index = startIndex; index < edgeIds.length; index++) {
      const edge = getEdge(edgeIds[index]);
      if (!edge) break;
      const distance = Math.max(0, distanceToEdgeStart + edge.length);
      if (distance > lookAhead) break;
      const outgoing = outgoingForDecisionEdge(edge);
      if (outgoing?.length) {
        const node = getNode(edge.to);
        return [Object.freeze({
          id: node.id,
          nodeId: node.id,
          decisionType: node.decisionType || (edge.family === 'collector' ? 'collector' : 'cloverleaf'),
          distance,
          commitDistance: distance,
          lockLeadM: CLOVERLEAF_LOCK_LEAD,
          outgoing
        })];
      }
      distanceToEdgeStart += edge.length;
    }
    return [];
  }

  function getVisibleEdges(bounds = cloverleafGraph.bounds, pathPlan = null, cursor = null) {
    const options = bounds?.pathPlan || bounds?.cursor || bounds?.bounds ? bounds : null;
    const viewport = options?.bounds || bounds;
    const plan = options?.pathPlan || pathPlan;
    const activeCursor = options?.cursor || cursor;
    ensureItineraryHorizon(plan, activeCursor, 1);
    const normalized = Number.isFinite(viewport.radius)
      ? {
          minX: (viewport.centerX ?? viewport.x ?? 0) - viewport.radius,
          maxX: (viewport.centerX ?? viewport.x ?? 0) + viewport.radius,
          minZ: (viewport.centerZ ?? viewport.z ?? 0) - viewport.radius,
          maxZ: (viewport.centerZ ?? viewport.z ?? 0) + viewport.radius
        }
      : viewport;
    let candidates = [...graphEdges, ...runtimeEdgesById.values()];
    runtimeTopologyLifecycle.visibleEdgeQueryCount++;
    runtimeTopologyLifecycle.visibleEdgeLastCandidateCount = candidates.length;
    runtimeTopologyLifecycle.visibleEdgeMaximumCandidateCount = Math.max(
      runtimeTopologyLifecycle.visibleEdgeMaximumCandidateCount,
      candidates.length
    );
    if (plan?.tiles && activeCursor?.edgeId) {
      const currentTileIndex = getEdge(activeCursor.edgeId)?.tileIndex ?? 0;
      const visibleTiles = plan.tiles.filter((tile) => (
        tile.index === currentTileIndex
        || tile.index === currentTileIndex + 1
        // Presentation may retain any previous resident for a rear/high/Film camera. Spatial bounds still cull
        // unrelated edges, and this visibility-only allowance never extends route or collision authority.
        || tile.index === currentTileIndex - 1
      ));
      const visibleTokens = new Set(visibleTiles.map((tile) => tile.token));
      const visibleBidirectionalEdgeIds = new Set();
      const visibleRecoveryEdgeIds = new Set();
      for (const tile of visibleTiles) {
        for (const edge of getBidirectionalVisualEdgesForTile(tile)) {
          visibleBidirectionalEdgeIds.add(edge.id);
        }
        for (const edge of getRecoveryVisualEdgesForTile(tile)) {
          visibleRecoveryEdgeIds.add(edge.id);
        }
      }
      candidates = candidates.filter((edge) => {
        if (edge.runtimeKind === 'recovery') {
          return visibleRecoveryEdgeIds.has(edge.id);
        }
        if (edge.runtimeKind === BIDIRECTIONAL_VISUAL_RUNTIME_KIND) {
          return visibleBidirectionalEdgeIds.has(edge.id);
        }
        const edgeTileIndex = edge.tileIndex ?? 0;
        if (edgeTileIndex === 0 && currentTileIndex === 0) return true;
        return visibleTokens.has(edge.tileToken);
      });
    }
    return candidates.filter((edge) => !(
      edge.bounds.maxX < normalized.minX
      || edge.bounds.minX > normalized.maxX
      || edge.bounds.maxZ < normalized.minZ
      || edge.bounds.minZ > normalized.maxZ
    ));
  }

  function pointSegmentDistanceSquared(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0.000_001
      ? clamp(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0, 1)
      : 0;
    const x = ax + dx * t;
    const z = az + dz * t;
    return { distanceSquared: (px - x) ** 2 + (pz - z) ** 2, x, z, t };
  }

  const AIRBORNE_LANDING_EPSILON_M = 0.000_001;
  const AIRBORNE_LANDING_SEAM_POSITION_TOLERANCE_M = 0.03;
  const AIRBORNE_LANDING_SEAM_HEIGHT_TOLERANCE_M = 0.12;
  const AIRBORNE_LANDING_SEAM_HEADING_COSINE = Math.cos(0.5 * Math.PI / 180);
  const AIRBORNE_LANDING_MAX_CONTINUATION_HOPS = 8;
  const AIRBORNE_LANDING_SPATIAL_SCORE_TIE_EPSILON = 0.000_001;

  function activeAirborneLandingTiles(activeTileTokens, pathPlan) {
    const requested = typeof activeTileTokens === 'string'
      ? [activeTileTokens]
      : activeTileTokens instanceof Set
        ? [...activeTileTokens]
        : Array.isArray(activeTileTokens) ? activeTileTokens : [...runtimeTilesByToken.keys()];
    const plannedTilesByToken = new Map(
      (Array.isArray(pathPlan?.tiles) ? pathPlan.tiles : [])
        .map((tile) => [tile.token, tile])
    );
    const seen = new Set();
    const tiles = [];
    for (const token of requested) {
      if (seen.has(token)) continue;
      seen.add(token);
      // Tile tokens describe physical residency, while the PathPlan tile spec supplies the selected exit needed
      // to exclude warmed recovery variants that share the same token.
      const tile = plannedTilesByToken.get(token) || runtimeTilesByToken.get(token);
      if (tile) tiles.push(tile);
    }
    return tiles;
  }

  /**
   * Resolve only roads physically published for active tiles. Mutually exclusive warmed recovery variants stay
   * out unless they are the tile's selected topology, and visual corridors participate only when explicitly
   * marked as airborne landing surfaces.
   */
  function airborneLandingEdgeRecords(activeTileTokens, pathPlan) {
    const records = [];
    const seen = new Set();
    const append = (edge, tileTokenValue) => {
      if (!edge || seen.has(edge.id)) return;
      seen.add(edge.id);
      records.push({ edge, tileToken: tileTokenValue });
    };
    for (const tile of activeAirborneLandingTiles(activeTileTokens, pathPlan)) {
      if (tile.index === 0) {
        for (const edge of graphEdges) append(edge, tile.token);
      } else {
        for (const edge of runtimeEdgesById.values()) {
          if (edge.runtimeKind === 'template' && edge.tileToken === tile.token) append(edge, tile.token);
        }
      }
      for (const edge of getRecoveryVisualEdgesForTile(tile)) append(edge, tile.token);
      for (const edge of getBidirectionalVisualEdgesForTile(tile)) {
        if (edge.airborneLandingSurface === true) append(edge, tile.token);
      }
    }
    return records;
  }

  /**
   * Classify physical support separately from route ownership. A visual opposing edge is intentionally never in
   * PathPlan; its explicit relation is the hand-off token that permits one atomic route adoption after landing.
   */
  function airborneLandingRouteRelation(edge, pathPlan) {
    if (!edge) return 'unsupported';
    if (planEdgeIndex(pathPlan, edge.id) >= 0) return 'current-plan';
    if (
      edge.visualKind === BIDIRECTIONAL_OPPOSING_INTERTILE
      || (
        edge.visualKind === BIDIRECTIONAL_OUTBOUND_EXTENSION
        && edge.airborneLandingSurface === true
      )
      || edge.opposingRecoveryKind === OPPOSING_RECOVERY_PROXY
      || edge.opposingRecoveryKind === OPPOSING_RECOVERY_CROSSOVER
    ) return 'opposing-counterflow';
    if (edge.family === 'straight-fork-branch' && edge.decisionNodeId) {
      const topology = runtimeRecoveryForksByDecisionId.get(edge.decisionNodeId);
      const alternative = topology?.movementIds
        .map((movementIdValue) => getMovement(movementIdValue))
        .find((movement) => movement?.toEdgeId === edge.id);
      if (alternative && pathPlan?.edgeIds?.some((edgeId) => (
        getEdge(edgeId)?.decisionNodeId === edge.decisionNodeId
      ))) return 'selectable-alternative';
    }
    return 'unsupported';
  }

  function airborneLandingRelationFamily(relation) {
    if (relation === 'current-plan' || relation === 'selectable-alternative') return 'routable';
    if (relation === 'opposing-counterflow') return 'opposing-counterflow';
    return null;
  }

  /** Keep microscopic projection noise from changing route authority on physically overlapping ribbons. */
  function airborneLandingRoutePriority(relation) {
    if (relation === 'current-plan') return 3;
    if (relation === 'selectable-alternative') return 2;
    if (relation === 'opposing-counterflow') return 1;
    return 0;
  }

  /**
   * Find real pavement beyond one finite edge endpoint.
   *
   * A PathPlan edge boundary is not a physical gap: a craft may straddle two active ribbons when their paved
   * endpoints, heights, headings, and usable widths form one continuous surface. Conversely, mere spatial
   * overlap, an inactive warmed variant, or an unsupported road must never extend a finite landing surface.
   */
  function hasAirborneLandingContinuation(
    sourceRecord,
    sourceEndpoint,
    sourceLateral,
    remainingLengthM,
    footprintHalfWidthM,
    activeRecords,
    relationByEdgeId,
    relationFamily,
    visitedEdgeIds,
    hopCount
  ) {
    if (remainingLengthM <= AIRBORNE_LANDING_EPSILON_M) return true;
    if (hopCount >= AIRBORNE_LANDING_MAX_CONTINUATION_HOPS) return false;
    const sourceEdge = sourceRecord.edge;
    const sourceS = sourceEndpoint === 'start' ? 0 : sourceEdge.length;
    const sourceFrame = sampleEdge(sourceEdge.id, sourceS, sourceLateral, {});
    if (
      Math.abs(sourceLateral) + footprintHalfWidthM
        > sourceFrame.roadHalf + AIRBORNE_LANDING_EPSILON_M
    ) return false;
    const sourceDirection = sourceEndpoint === 'start' ? -1 : 1;
    const sourceOutwardX = sourceFrame.horizontalTangentX * sourceDirection;
    const sourceOutwardZ = sourceFrame.horizontalTangentZ * sourceDirection;

    for (const targetRecord of activeRecords) {
      const targetEdge = targetRecord.edge;
      if (!targetEdge || visitedEdgeIds.has(targetEdge.id)) continue;
      if (airborneLandingRelationFamily(relationByEdgeId.get(targetEdge.id)) !== relationFamily) continue;
      for (const targetEndpoint of ['start', 'end']) {
        const targetS = targetEndpoint === 'start' ? 0 : targetEdge.length;
        const targetCenterFrame = sampleEdge(targetEdge.id, targetS, 0, {});
        const targetLateral = (
          (sourceFrame.x - targetCenterFrame.x) * targetCenterFrame.rightX
          + (sourceFrame.z - targetCenterFrame.z) * targetCenterFrame.rightZ
        );
        const targetFrame = sampleEdge(targetEdge.id, targetS, targetLateral, {});
        const targetDirection = targetEndpoint === 'start' ? 1 : -1;
        const headingAlignment = sourceOutwardX
          * targetCenterFrame.horizontalTangentX * targetDirection
          + sourceOutwardZ * targetCenterFrame.horizontalTangentZ * targetDirection;
        const seamPositionErrorM = Math.hypot(
          sourceFrame.x - targetFrame.x,
          sourceFrame.y - targetFrame.y,
          sourceFrame.z - targetFrame.z
        );
        if (
          seamPositionErrorM > AIRBORNE_LANDING_SEAM_POSITION_TOLERANCE_M
          || Math.abs(sourceFrame.surfaceHeight - targetFrame.surfaceHeight)
            > AIRBORNE_LANDING_SEAM_HEIGHT_TOLERANCE_M
          || headingAlignment < AIRBORNE_LANDING_SEAM_HEADING_COSINE
          || Math.abs(targetLateral) + footprintHalfWidthM
            > targetFrame.roadHalf + AIRBORNE_LANDING_EPSILON_M
        ) continue;

        const targetTravelM = Math.min(remainingLengthM, targetEdge.length);
        const targetInteriorS = targetEndpoint === 'start'
          ? targetTravelM
          : targetEdge.length - targetTravelM;
        const targetInteriorFrame = sampleEdge(targetEdge.id, targetInteriorS, targetLateral, {});
        if (
          Math.abs(targetLateral) + footprintHalfWidthM
            > targetInteriorFrame.roadHalf + AIRBORNE_LANDING_EPSILON_M
        ) continue;
        if (remainingLengthM <= targetEdge.length + AIRBORNE_LANDING_EPSILON_M) return true;

        visitedEdgeIds.add(targetEdge.id);
        const continued = hasAirborneLandingContinuation(
          targetRecord,
          targetEndpoint === 'start' ? 'end' : 'start',
          targetLateral,
          remainingLengthM - targetEdge.length,
          footprintHalfWidthM,
          activeRecords,
          relationByEdgeId,
          relationFamily,
          visitedEdgeIds,
          hopCount + 1
        );
        visitedEdgeIds.delete(targetEdge.id);
        if (continued) return true;
      }
    }
    return false;
  }

  /** Validate the longitudinal footprint against the union of physically continuous active road ribbons. */
  function hasContinuousAirborneLandingLength(
    record,
    edgeS,
    lateral,
    footprintHalfLengthM,
    footprintHalfWidthM,
    activeRecords,
    relationByEdgeId
  ) {
    const edge = record.edge;
    const missingBeforeM = Math.max(0, footprintHalfLengthM - edgeS);
    const missingAfterM = Math.max(0, footprintHalfLengthM - (edge.length - edgeS));
    if (
      missingBeforeM <= AIRBORNE_LANDING_EPSILON_M
      && missingAfterM <= AIRBORNE_LANDING_EPSILON_M
    ) return true;
    const relationFamily = airborneLandingRelationFamily(relationByEdgeId.get(edge.id));
    if (!relationFamily) return false;
    if (missingBeforeM > AIRBORNE_LANDING_EPSILON_M) {
      const visited = new Set([edge.id]);
      if (!hasAirborneLandingContinuation(
        record,
        'start',
        lateral,
        missingBeforeM,
        footprintHalfWidthM,
        activeRecords,
        relationByEdgeId,
        relationFamily,
        visited,
        0
      )) return false;
    }
    if (missingAfterM > AIRBORNE_LANDING_EPSILON_M) {
      const visited = new Set([edge.id]);
      if (!hasAirborneLandingContinuation(
        record,
        'end',
        lateral,
        missingAfterM,
        footprintHalfWidthM,
        activeRecords,
        relationByEdgeId,
        relationFamily,
        visited,
        0
      )) return false;
    }
    return true;
  }

  function projectWorldPointToLandingEdge(edge, x, z, out = {}) {
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    let bestEdgeS = 0;
    const consider = (ax, az, aS, bx, bz, bS) => {
      const nearest = pointSegmentDistanceSquared(x, z, ax, az, bx, bz);
      if (nearest.distanceSquared >= bestDistanceSquared) return;
      bestDistanceSquared = nearest.distanceSquared;
      bestEdgeS = aS + (bS - aS) * nearest.t;
    };

    if (edge.forkSide && edge.straightForkProfileLut) {
      const segmentCount = Math.max(1, Math.ceil(edge.planarLength / STRAIGHT_FORK_CLEARANCE_STEP));
      let previous = writeStraightForkCenter(edge, 0, straightForkClearanceScratchA);
      let previousS = 0;
      let currentBuffer = straightForkClearanceScratchB;
      for (let index = 1; index <= segmentCount; index++) {
        const planarS = edge.planarLength * index / segmentCount;
        const current = writeStraightForkCenter(edge, planarS, currentBuffer);
        const currentS = surfaceStationAtPlanarStation(edge.straightForkProfileLut, planarS);
        consider(previous.x, previous.z, previousS, current.x, current.z, currentS);
        currentBuffer = previous;
        previous = current;
        previousS = currentS;
      }
    } else if (edge.opposingCrossoverProfileLut) {
      const segmentCount = Math.max(
        1,
        Math.ceil(edge.planarLength / OPPOSING_CROSSOVER_CLEARANCE_STEP)
      );
      let previous = writeOpposingCrossoverCenter(edge, 0, opposingCrossoverClearanceScratchA);
      let previousS = 0;
      let currentBuffer = opposingCrossoverClearanceScratchB;
      for (let index = 1; index <= segmentCount; index++) {
        const planarS = edge.planarLength * index / segmentCount;
        const current = writeOpposingCrossoverCenter(edge, planarS, currentBuffer);
        const currentS = surfaceStationAtPlanarStation(edge.opposingCrossoverProfileLut, planarS);
        consider(previous.x, previous.z, previousS, current.x, current.z, currentS);
        currentBuffer = previous;
        previous = current;
        previousS = currentS;
      }
    } else if (edge.runtimeKind === 'recovery' || edge.runtimeKind === BIDIRECTIONAL_VISUAL_RUNTIME_KIND) {
      consider(
        edge.recoveryStart.x,
        edge.recoveryStart.z,
        0,
        edge.recoveryEnd.x,
        edge.recoveryEnd.z,
        edge.length
      );
    } else {
      const templateSamples = edge.runtimeKind === 'template'
        ? graphEdgeSamples.get(edge.templateEdgeId)
        : graphEdgeSamples.get(edge.id);
      const offsetX = edge.runtimeKind === 'template' ? edge.offsetX : 0;
      const offsetZ = edge.runtimeKind === 'template' ? edge.offsetZ : 0;
      for (let index = 1; index < (templateSamples?.length || 0); index++) {
        const a = templateSamples[index - 1];
        const b = templateSamples[index];
        consider(
          a.x + offsetX,
          a.z + offsetZ,
          a.surfaceS,
          b.x + offsetX,
          b.z + offsetZ,
          b.surfaceS
        );
      }
    }
    out.edgeS = clamp(bestEdgeS, 0, edge.length);
    out.distanceSquared = bestDistanceSquared;
    return out;
  }

  /**
   * Query the highest road support below an airborne craft at world XZ. This never mutates routing and never
   * promotes visual-only opposing pavement into PathPlan, ordinary collision, or traffic authority.
   */
  function queryAirborneLandingSupport(xValue, zValue, options = {}, out = {}) {
    const x = Number(xValue);
    const z = Number(zValue);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new TypeError('queryAirborneLandingSupport requires finite world x/z coordinates');
    }
    const footprintHalfWidthM = Math.max(0, Number(options.footprintHalfWidthM) || 0);
    const footprintHalfLengthM = Math.max(0, Number(options.footprintHalfLengthM) || 0);
    const maximumSurfaceHeight = Number.isFinite(options.maximumSurfaceHeight)
      ? Number(options.maximumSurfaceHeight)
      : Number.POSITIVE_INFINITY;
    let best = null;
    const projection = {};
    const frame = {};
    const platformSupport = {};
    const activeRecords = airborneLandingEdgeRecords(options.activeTileTokens, options.pathPlan);
    const relationByEdgeId = new Map(activeRecords.map(({ edge }) => [
      edge.id,
      airborneLandingRouteRelation(edge, options.pathPlan)
    ]));
    for (const record of activeRecords) {
      const { edge, tileToken: activeTileToken } = record;
      projectWorldPointToLandingEdge(edge, x, z, projection);
      if (!Number.isFinite(projection.distanceSquared)) continue;
      sampleEdge(edge.id, projection.edgeS, 0, frame);
      const offsetX = x - frame.centerX;
      const offsetZ = z - frame.centerZ;
      const lateral = offsetX * frame.rightX + offsetZ * frame.rightZ;
      const longitudinal = offsetX * frame.horizontalTangentX + offsetZ * frame.horizontalTangentZ;
      // Segment clamping must not turn the finite road endpoints into circular ghost landing pads.
      if (
        (projection.edgeS <= AIRBORNE_LANDING_EPSILON_M
          && longitudinal < -AIRBORNE_LANDING_EPSILON_M)
        || (projection.edgeS >= edge.length - AIRBORNE_LANDING_EPSILON_M
          && longitudinal > AIRBORNE_LANDING_EPSILON_M)
      ) continue;
      const roadHalfAtS = Number.isFinite(frame.roadHalf) ? frame.roadHalf : edge.roadHalf;
      const clearance = Math.sqrt(projection.distanceSquared) + footprintHalfWidthM - roadHalfAtS;
      if (clearance > AIRBORNE_LANDING_EPSILON_M) continue;
      const table = sampleJumpPlatformSupport(
        edge.id,
        projection.edgeS,
        lateral,
        platformSupport,
        footprintHalfWidthM
      );
      const spansConnectedEdges = (
        projection.edgeS + AIRBORNE_LANDING_EPSILON_M < footprintHalfLengthM
        || edge.length - projection.edgeS + AIRBORNE_LANDING_EPSILON_M < footprintHalfLengthM
      );
      // A platform top remains edge-local; only ordinary paved road may combine adjacent ribbons as one support.
      if (spansConnectedEdges && (
        table
        || !hasContinuousAirborneLandingLength(
          record,
          projection.edgeS,
          lateral,
          footprintHalfLengthM,
          footprintHalfWidthM,
          activeRecords,
          relationByEdgeId
        )
      )) continue;
      const surfaceHeight = table ? table.surfaceHeight : frame.y;
      if (surfaceHeight > maximumSurfaceHeight + AIRBORNE_LANDING_EPSILON_M) continue;
      const supportKind = table ? 'jump-platform' : 'road';
      const spatialScore = Math.abs(lateral) / Math.max(AIRBORNE_LANDING_EPSILON_M, roadHalfAtS);
      const routeRelation = relationByEdgeId.get(edge.id);
      const routePriority = airborneLandingRoutePriority(routeRelation);
      const sameHeightAsBest = best
        && Math.abs(surfaceHeight - best.surfaceHeight) <= AIRBORNE_LANDING_EPSILON_M;
      const spatialScoreDelta = best ? spatialScore - best.spatialScore : 0;
      if (best && (
        surfaceHeight < best.surfaceHeight - AIRBORNE_LANDING_EPSILON_M
        || (
          sameHeightAsBest
          && (
            spatialScoreDelta > AIRBORNE_LANDING_SPATIAL_SCORE_TIE_EPSILON
            || (
              Math.abs(spatialScoreDelta) <= AIRBORNE_LANDING_SPATIAL_SCORE_TIE_EPSILON
              && routePriority <= best.routePriority
            )
          )
        )
      )) continue;
      best = {
        edge,
        edgeS: projection.edgeS,
        lateral,
        surfaceHeight,
        roadHalf: roadHalfAtS,
        tileToken: activeTileToken,
        supportKind,
        routeRelation,
        routePriority,
        platformId: table?.platformId || null,
        footprintSupportMode: spansConnectedEdges ? 'connected-road-seam' : 'single-edge',
        clearance,
        spatialScore
      };
    }
    if (!best) return null;
    out.edgeId = best.edge.id;
    out.edgeS = best.edgeS;
    out.lateral = best.lateral;
    out.surfaceHeight = best.surfaceHeight;
    out.roadHalf = best.roadHalf;
    out.surfaceId = best.edge.surfaceId;
    out.tileToken = best.tileToken;
    out.supportKind = best.supportKind;
    out.platformId = best.platformId;
    out.footprintSupportMode = best.footprintSupportMode;
    out.worldX = x;
    out.worldY = best.surfaceHeight;
    out.worldZ = z;
    out.routeRelation = best.routeRelation;
    out.relation = best.routeRelation;
    out.airborneLandingSurface = best.edge.gameplaySurface !== false
      || best.edge.airborneLandingSurface === true;
    out.clearance = best.clearance;
    return out;
  }

  function rebuildItineraryWithChoices(pathPlan, routeChoices, options = {}) {
    const firstSpec = pathPlan?.tiles?.[0] || null;
    const startTile = firstSpec?.token
      ? runtimeTilesByToken.get(firstSpec.token) || firstSpec
      : makeInitialTile(pathPlan?.entryPort || options.entryPort || 'south');
    const firstKind = firstSpec?.kind || pathPlan?.kind || 'straight';
    return buildItineraryPlan({
      committedChoices: routeChoices,
      itineraryKinds: pathPlan?._futureKinds || options.itineraryKinds,
      futureMovementKind: options.futureMovementKind || pathPlan?._futureKind
    }, startTile, firstKind);
  }

  /**
   * Bypass the current interchange after a counterflow landing. The forced straight movement is physical topology,
   * not steering input: the player remains free on the road while the long crossover reaches its matching exit.
   */
  function buildOpposingLandingPlan(pathPlan, tile, routeChoices, options = {}) {
    const record = bidirectionalVisualEdgesByTileToken.get(tile.token)?.opposingRecovery;
    if (!record) throw new Error(`Opposing landing plan has no prepared crossover: ${tile.token}`);
    const committedChoices = Object.freeze({
      ...(routeChoices || {}),
      [record.decisionNodeId]: record.straightMovementId
    });
    const plan = buildItineraryPlan({
      committedChoices,
      itineraryKinds: pathPlan?._futureKinds || options.itineraryKinds,
      futureMovementKind: options.futureMovementKind || pathPlan?._futureKind
    }, tile, 'straight');
    const firstSpec = plan.tiles[0];
    const nextSpec = plan.tiles[1];
    const nextApproachIndex = plan.edgeIds.indexOf(record.nextApproachEdgeId);
    const remainingPlanEdgeIds = nextApproachIndex >= 0
      ? plan.edgeIds.slice(nextApproachIndex)
      : [];
    if (
      firstSpec.movementId !== record.straightMovementId
      || nextSpec?.token !== record.nextTileToken
      || !runtimeEdgesById.has(record.proxyEdgeId)
      || !runtimeEdgesById.has(record.crossoverEdgeId)
      || remainingPlanEdgeIds[0] !== record.nextApproachEdgeId
    ) {
      throw new Error(`Opposing landing plan cannot reach the next ordinary approach: ${tile.token}`);
    }
    const crossoverEnd = sampleEdge(record.crossoverEdgeId, runtimeEdgesById.get(record.crossoverEdgeId).length, 0, {});
    const nextApproachStart = sampleEdge(record.nextApproachEdgeId, 0, 0, {});
    if (
      Math.hypot(
        crossoverEnd.x - nextApproachStart.x,
        crossoverEnd.y - nextApproachStart.y,
        crossoverEnd.z - nextApproachStart.z
      ) > 0.001
    ) {
      throw new Error(`Opposing crossover cannot preserve the next-tile seam: ${tile.token}`);
    }
    plan.edgeIds.length = 0;
    plan.cumulativeLengths.length = 0;
    plan.edgeIndexById.clear();
    plan.length = 0;
    appendPlanEdges(plan, [
      record.proxyEdgeId,
      record.crossoverEdgeId,
      ...remainingPlanEdgeIds
    ]);
    plan.tiles[0] = Object.freeze({
      ...firstSpec,
      opposingBypass: true,
      opposingCrossoverEdgeId: record.crossoverEdgeId
    });
    plan.id = `opposing-crossover-itinerary:${tile.token}:straight`;
    plan.opposingRecovery = record;
    plan.version++;
    return plan;
  }

  /**
   * Prepare the exact visual/routing variant that would be adopted after an opposing-road landing. Tile pooling
   * uses this read-only preview before takeoff so a landing can atomically reveal its crossover instead of waiting
   * for a route-owned bridge build after the craft has already reached it.
   */
  function prepareOpposingRecoveryPathPlan(pathPlan, tileOrToken, options = {}) {
    if (!pathPlan) return null;
    const tile = typeof tileOrToken === 'string'
      ? pathPlan.tiles?.find((candidate) => candidate.token === tileOrToken)
        || runtimeTilesByToken.get(tileOrToken)
      : tileOrToken;
    if (!tile?.token || tile.index <= 0) return null;
    return buildOpposingLandingPlan(
      pathPlan,
      runtimeTilesByToken.get(tile.token) || tile,
      options.routeChoices || pathPlan._committedChoices || {},
      options
    );
  }

  function landingWorldFrame(support, edge, lateral) {
    const sampled = sampleEdge(edge.id, support.edgeS, lateral, {});
    return {
      x: Number.isFinite(support.worldX) ? support.worldX : sampled.x,
      y: Number.isFinite(support.worldY)
        ? support.worldY
        : Number.isFinite(support.surfaceHeight) ? support.surfaceHeight : sampled.y,
      z: Number.isFinite(support.worldZ) ? support.worldZ : sampled.z,
      heading: sampled.heading
    };
  }

  /**
   * Resolve a landing into one complete routing package without mutating caller state. Runtime may commit the
   * returned plan, cursor, lateral, and route choices together; an unsupported road never produces a partial plan.
   */
  function resolveAirborneLandingRoute(support, options = {}) {
    const sourceEdge = getEdge(support?.edgeId);
    const pathPlan = options.pathPlan || null;
    const routeCursor = options.routeCursor || null;
    const relation = support?.routeRelation
      || support?.relation
      || airborneLandingRouteRelation(sourceEdge, pathPlan);
    const sourceRouteChoices = options.routeChoices
      || options.committedChoices
      || pathPlan?._committedChoices
      || {};
    const runDistance = Number.isFinite(options.runDistance)
      ? options.runDistance
      : Number.isFinite(routeCursor?.runDistance) ? routeCursor.runDistance : 0;
    const unsupported = (continuityErrorM = Number.POSITIVE_INFINITY, headingErrorDeg = Number.POSITIVE_INFINITY) => (
      Object.freeze({
        supported: false,
        relation: 'unsupported',
        routeRelation: 'unsupported',
        pathPlan,
        cursor: routeCursor ? routePosition(routeCursor) : null,
        previousCursor: options.previousRouteCursor ? routePosition(options.previousRouteCursor) : null,
        lateral: Number(support?.lateral) || 0,
        routeChoices: sourceRouteChoices,
        committedChoices: sourceRouteChoices,
        continuityErrorM,
        headingErrorDeg,
        sourceEdgeId: sourceEdge?.id || null,
        adoptedEdgeId: null
      })
    );
    if (!sourceEdge || !pathPlan || relation === 'unsupported') return unsupported();

    let adoptedPlan = pathPlan;
    let adoptedEdgeId = sourceEdge.id;
    let adoptedEdgeS = clamp(Number(support.edgeS) || 0, 0, sourceEdge.length);
    let adoptedLateral = Number(support.lateral) || 0;
    let routeChoices = sourceRouteChoices;
    let expectedHeading = sampleEdge(sourceEdge.id, adoptedEdgeS, 0, {}).heading;

    if (relation === 'selectable-alternative') {
      const topology = runtimeRecoveryForksByDecisionId.get(sourceEdge.decisionNodeId);
      const movement = topology?.movementIds
        .map((movementIdValue) => getMovement(movementIdValue))
        .find((candidate) => candidate?.toEdgeId === sourceEdge.id);
      if (!movement) return unsupported();
      routeChoices = Object.freeze({
        ...sourceRouteChoices,
        [movement.decisionNodeId]: movement.id
      });
      adoptedPlan = rebuildItineraryWithChoices(pathPlan, routeChoices, options);
      if (planEdgeIndex(adoptedPlan, adoptedEdgeId) < 0) return unsupported();
    } else if (relation === 'opposing-counterflow') {
      const tile = runtimeTilesByToken.get(support.tileToken || sourceEdge.tileToken);
      const opposingRecovery = tile
        ? bidirectionalVisualEdgesByTileToken.get(tile.token)?.opposingRecovery
        : null;
      if (!tile || !opposingRecovery) return unsupported();
      adoptedPlan = buildOpposingLandingPlan(pathPlan, tile, sourceRouteChoices, options);
      routeChoices = Object.freeze({ ...adoptedPlan._committedChoices });
      if (sourceEdge.visualKind === BIDIRECTIONAL_OPPOSING_INTERTILE) {
        adoptedEdgeId = opposingRecovery.proxyEdgeId;
        adoptedEdgeS = sourceEdge.length - adoptedEdgeS;
        adoptedLateral = -adoptedLateral;
        expectedHeading = Math.atan2(
          -Math.sin(sourceEdge.heading),
          -Math.cos(sourceEdge.heading)
        );
      } else if (
        sourceEdge.visualKind === BIDIRECTIONAL_OUTBOUND_EXTENSION
        && sourceEdge.airborneLandingSurface === true
      ) {
        adoptedEdgeId = opposingRecovery.crossoverEdgeId;
        adoptedEdgeS = sourceEdge.length - adoptedEdgeS;
        adoptedLateral = -adoptedLateral;
        expectedHeading = Math.atan2(
          -Math.sin(sourceEdge.heading),
          -Math.cos(sourceEdge.heading)
        );
      } else if (planEdgeIndex(adoptedPlan, sourceEdge.id) < 0) {
        return unsupported();
      }
    } else if (relation !== 'current-plan' || planEdgeIndex(pathPlan, sourceEdge.id) < 0) {
      return unsupported();
    }

    const cursor = routePosition({
      edgeId: adoptedEdgeId,
      edgeS: adoptedEdgeS,
      lateral: adoptedLateral,
      runDistance,
      entryPort: getEdge(adoptedEdgeId)?.entryPort || adoptedPlan.entryPort,
      tileIndex: getEdge(adoptedEdgeId)?.tileIndex ?? routeCursor?.tileIndex ?? 0,
      exited: false
    });
    const sourceWorld = landingWorldFrame(support, sourceEdge, Number(support.lateral) || 0);
    const adoptedFrame = sampleEdge(adoptedEdgeId, adoptedEdgeS, adoptedLateral, {});
    const continuityErrorM = Math.hypot(
      adoptedFrame.x - sourceWorld.x,
      adoptedFrame.y - sourceWorld.y,
      adoptedFrame.z - sourceWorld.z
    );
    const headingErrorDeg = Math.abs(Math.atan2(
      Math.sin(adoptedFrame.heading - expectedHeading),
      Math.cos(adoptedFrame.heading - expectedHeading)
    )) * 180 / Math.PI;
    if (continuityErrorM > 0.001 || headingErrorDeg > 0.5) {
      return unsupported(continuityErrorM, headingErrorDeg);
    }
    return Object.freeze({
      supported: true,
      relation,
      routeRelation: relation,
      pathPlan: adoptedPlan,
      cursor,
      previousCursor: routePosition(cursor),
      lateral: adoptedLateral,
      routeChoices,
      committedChoices: routeChoices,
      continuityErrorM,
      headingErrorDeg,
      sourceEdgeId: sourceEdge.id,
      adoptedEdgeId
    });
  }

  /**
   * Normalize an optional world-Y support envelope. Omitting it preserves the historical plan-view query;
   * providing it opts bridge supports into structure-aware filtering without weakening scenery clearance.
   */
  function roadClearanceVerticalEnvelope(options) {
    const envelope = options?.verticalEnvelope;
    if (envelope == null) return null;
    if (
      typeof envelope !== 'object'
      || !Number.isFinite(envelope.minY)
      || !Number.isFinite(envelope.maxY)
    ) {
      throw new TypeError('queryRoadClearance verticalEnvelope requires finite minY/maxY');
    }
    if (envelope.maxY < envelope.minY) {
      throw new RangeError('queryRoadClearance verticalEnvelope maxY must be greater than or equal to minY');
    }
    return envelope;
  }

  /**
   * Test the real banked road slab at the closest route station against one world-vertical support column.
   * A column ending exactly at the slab underside is a valid bearing contact, not a road penetration.
   */
  function writeRoadStructureVerticalIntersection(edge, edgeS, x, z, envelope, out) {
    if (!envelope) {
      out.intersects = true;
      out.edgeS = null;
      out.roadMinimumY = null;
      out.roadMaximumY = null;
      out.roadLateral = null;
      out.roadSurfaceY = null;
      out.overlapM = null;
      return out;
    }
    const frame = roadClearanceVerticalFrameScratch;
    let projectedEdgeS = clamp(edgeS, 0, edge.length);
    let roadLateral = 0;
    for (let iteration = 0; iteration < ROAD_CLEARANCE_VERTICAL_PROJECTION_ITERATIONS; iteration++) {
      sampleEdge(edge.id, projectedEdgeS, roadLateral, frame);
      const dx = x - frame.x;
      const dz = z - frame.z;
      const determinant = frame.tangentX * frame.rightZ - frame.tangentZ * frame.rightX;
      const regularBasis = Math.abs(determinant) > 0.000_001;
      const tangentPlanarLengthSquared = frame.tangentX ** 2 + frame.tangentZ ** 2;
      const rightPlanarLengthSquared = frame.rightX ** 2 + frame.rightZ ** 2;
      const stationDelta = regularBasis
        ? (dx * frame.rightZ - dz * frame.rightX) / determinant
        : (dx * frame.tangentX + dz * frame.tangentZ)
          / Math.max(0.000_001, tangentPlanarLengthSquared);
      const lateralDelta = regularBasis
        ? (frame.tangentX * dz - frame.tangentZ * dx) / determinant
        : (dx * frame.rightX + dz * frame.rightZ)
          / Math.max(0.000_001, rightPlanarLengthSquared);
      const roadHalf = Number.isFinite(frame.roadHalf)
        ? frame.roadHalf
        : Number(edge.roadHalf) || 0;
      roadLateral = clamp(roadLateral + lateralDelta, -roadHalf, roadHalf);
      projectedEdgeS = clamp(projectedEdgeS + stationDelta, 0, edge.length);
    }
    sampleEdge(edge.id, projectedEdgeS, roadLateral, frame);
    const roadSurfaceY = frame.y;
    // The slab is authored along its local normal. A world-vertical column crosses deckThickness / upY metres
    // between the parallel top and underside planes; multiplying by upY would measure a different XZ location.
    const roadUndersideY = roadSurfaceY
      - CLOVERLEAF_DECK_THICKNESS / Math.max(0.000_001, Math.abs(frame.upY));
    const roadMinimumY = Math.min(roadSurfaceY, roadUndersideY);
    const roadMaximumY = Math.max(roadSurfaceY, roadUndersideY);
    const overlapM = Math.min(envelope.maxY, roadMaximumY)
      - Math.max(envelope.minY, roadMinimumY);
    out.intersects = overlapM > ROAD_CLEARANCE_VERTICAL_CONTACT_TOLERANCE_M;
    out.edgeS = projectedEdgeS;
    out.roadMinimumY = roadMinimumY;
    out.roadMaximumY = roadMaximumY;
    out.roadLateral = roadLateral;
    out.roadSurfaceY = roadSurfaceY;
    out.overlapM = overlapM;
    return out;
  }

  /**
   * Query the swept footprint union used to reject scenery and bridge supports from every road family.
   * `verticalEnvelope` is optional for backward compatibility. When present, only road slabs that truly overlap
   * that world-Y interval can block; a supported/co-planar slab touching the column top remains eligible.
   */
  function queryRoadClearance(xOrPoint, zOrRadius = 0, radiusOrOptions = 0, maybeOptions = {}) {
    const pointInput = typeof xOrPoint === 'object';
    const x = pointInput ? xOrPoint.x : xOrPoint;
    const z = pointInput ? xOrPoint.z : zOrRadius;
    const radius = pointInput ? (Number.isFinite(zOrRadius) ? zOrRadius : 0) : (Number.isFinite(radiusOrOptions) ? radiusOrOptions : 0);
    const options = pointInput
      ? (typeof radiusOrOptions === 'object' ? radiusOrOptions : maybeOptions)
      : maybeOptions;
    const gap = Number.isFinite(options?.gap)
      ? options.gap
      : Number.isFinite(options?.minimumGap) ? options.minimumGap : 0;
    const verticalEnvelope = roadClearanceVerticalEnvelope(options);
    // Bridge piers may ignore only the deck they physically support; every alias of that template edge is excluded together.
    const ignoredEdgeIds = new Set(Array.isArray(options?.ignoreEdgeIds) ? options.ignoreEdgeIds : []);
    let minimumClearance = Number.POSITIVE_INFINITY;
    let closest = null;
    const candidateEdges = [...graphEdges, ...runtimeEdgesById.values()];
    runtimeTopologyLifecycle.roadClearanceQueryCount++;
    runtimeTopologyLifecycle.roadClearanceLastCandidateCount = candidateEdges.length;
    runtimeTopologyLifecycle.roadClearanceMaximumCandidateCount = Math.max(
      runtimeTopologyLifecycle.roadClearanceMaximumCandidateCount,
      candidateEdges.length
    );
    for (const edge of candidateEdges) {
      if (ignoredEdgeIds.has(edge.id) || ignoredEdgeIds.has(edge.templateEdgeId)) continue;
      const boundsPadding = edge.roadHalf + radius + gap;
      if (
        x < edge.bounds.minX - boundsPadding
        || x > edge.bounds.maxX + boundsPadding
        || z < edge.bounds.minZ - boundsPadding
        || z > edge.bounds.maxZ + boundsPadding
      ) continue;
      const templateSamples = edge.runtimeKind === 'template'
        ? graphEdgeSamples.get(edge.templateEdgeId)
        : graphEdgeSamples.get(edge.id);
      if (edge.forkSide && edge.straightForkProfileLut) {
        const segmentCount = Math.max(1, Math.ceil(edge.planarLength / STRAIGHT_FORK_CLEARANCE_STEP));
        let previous = writeStraightForkCenter(edge, 0, straightForkClearanceScratchA);
        let currentBuffer = straightForkClearanceScratchB;
        for (let index = 1; index <= segmentCount; index++) {
          const planarS = edge.planarLength * index / segmentCount;
          const current = writeStraightForkCenter(edge, planarS, currentBuffer);
          const nearest = pointSegmentDistanceSquared(
            x,
            z,
            previous.x,
            previous.z,
            current.x,
            current.z
          );
          const segmentPlanarS = edge.planarLength * (index - 0.5) / segmentCount;
          const segmentS = surfaceStationAtPlanarStation(edge.straightForkProfileLut, segmentPlanarS);
          const roadHalfAtS = writeStraightForkProfile(
            segmentPlanarS,
            edge.forkSide,
            straightForkSampleScratch
          ).roadHalf;
          const clearance = Math.sqrt(nearest.distanceSquared) - roadHalfAtS - radius - gap;
          if (clearance < minimumClearance) {
            const verticalPlanarS = edge.planarLength
              * (index - 1 + nearest.t) / segmentCount;
            const verticalEdgeS = surfaceStationAtPlanarStation(
              edge.straightForkProfileLut,
              verticalPlanarS
            );
            const verticalIntersection = writeRoadStructureVerticalIntersection(
              edge,
              verticalEdgeS,
              x,
              z,
              verticalEnvelope,
              roadClearanceVerticalResultScratch
            );
            if (!verticalIntersection.intersects) {
              currentBuffer = previous;
              previous = current;
              continue;
            }
            minimumClearance = clearance;
            closest = {
              edgeId: edge.id,
              surfaceId: edge.surfaceId,
              edgeS: verticalEnvelope ? verticalIntersection.edgeS : segmentS,
              x: nearest.x,
              z: nearest.z,
              roadHalf: roadHalfAtS,
              roadMinimumY: verticalIntersection.roadMinimumY,
              roadMaximumY: verticalIntersection.roadMaximumY,
              roadLateral: verticalIntersection.roadLateral,
              roadSurfaceY: verticalIntersection.roadSurfaceY,
              verticalOverlapM: verticalIntersection.overlapM
            };
          }
          currentBuffer = previous;
          previous = current;
        }
        continue;
      }
      if (edge.opposingCrossoverProfileLut) {
        const segmentCount = Math.max(
          1,
          Math.ceil(edge.planarLength / OPPOSING_CROSSOVER_CLEARANCE_STEP)
        );
        let previous = writeOpposingCrossoverCenter(edge, 0, opposingCrossoverClearanceScratchA);
        let currentBuffer = opposingCrossoverClearanceScratchB;
        for (let index = 1; index <= segmentCount; index++) {
          const planarS = edge.planarLength * index / segmentCount;
          const current = writeOpposingCrossoverCenter(edge, planarS, currentBuffer);
          const nearest = pointSegmentDistanceSquared(
            x,
            z,
            previous.x,
            previous.z,
            current.x,
            current.z
          );
          const segmentPlanarS = edge.planarLength * (index - 0.5) / segmentCount;
          const segmentS = surfaceStationAtPlanarStation(
            edge.opposingCrossoverProfileLut,
            segmentPlanarS
          );
          const nearestPlanarS = edge.planarLength
            * (index - 1 + nearest.t) / segmentCount;
          const roadHalfAtS = opposingCrossoverRoadHalf(
            edge.opposingCrossoverProfileLut,
            nearestPlanarS,
            edge.roadHalf
          );
          // The return bridge narrows from the full opposing carriageway to one connector. Clearance must follow
          // that authored taper or valid edge bearings are rejected against a fictitious 8.4m-wide slab.
          const clearance = Math.sqrt(nearest.distanceSquared) - roadHalfAtS - radius - gap;
          if (clearance < minimumClearance) {
            const verticalEdgeS = surfaceStationAtPlanarStation(
              edge.opposingCrossoverProfileLut,
              nearestPlanarS
            );
            const verticalIntersection = writeRoadStructureVerticalIntersection(
              edge,
              verticalEdgeS,
              x,
              z,
              verticalEnvelope,
              roadClearanceVerticalResultScratch
            );
            if (!verticalIntersection.intersects) {
              currentBuffer = previous;
              previous = current;
              continue;
            }
            minimumClearance = clearance;
            closest = {
              edgeId: edge.id,
              surfaceId: edge.surfaceId,
              edgeS: verticalEnvelope ? verticalIntersection.edgeS : segmentS,
              x: nearest.x,
              z: nearest.z,
              roadHalf: roadHalfAtS,
              roadMinimumY: verticalIntersection.roadMinimumY,
              roadMaximumY: verticalIntersection.roadMaximumY,
              roadLateral: verticalIntersection.roadLateral,
              roadSurfaceY: verticalIntersection.roadSurfaceY,
              verticalOverlapM: verticalIntersection.overlapM
            };
          }
          currentBuffer = previous;
          previous = current;
        }
        continue;
      }
      const samples = edge.runtimeKind === 'recovery'
        || edge.runtimeKind === BIDIRECTIONAL_VISUAL_RUNTIME_KIND
        ? [
            { x: edge.recoveryStart.x, z: edge.recoveryStart.z, surfaceS: 0 },
            { x: edge.recoveryEnd.x, z: edge.recoveryEnd.z, surfaceS: edge.length }
          ]
        : templateSamples;
      const offsetX = edge.runtimeKind === 'template' ? edge.offsetX : 0;
      const offsetZ = edge.runtimeKind === 'template' ? edge.offsetZ : 0;
      for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1];
        const b = samples[index];
        const nearest = pointSegmentDistanceSquared(
          x,
          z,
          a.x + offsetX,
          a.z + offsetZ,
          b.x + offsetX,
          b.z + offsetZ
        );
        const segmentS = (a.surfaceS + b.surfaceS) * 0.5;
        const roadHalfAtS = sampleRoadHalf(edge, segmentS);
        const clearance = Math.sqrt(nearest.distanceSquared) - roadHalfAtS - radius - gap;
        if (clearance < minimumClearance) {
          const verticalEdgeS = a.surfaceS + (b.surfaceS - a.surfaceS) * nearest.t;
          const verticalIntersection = writeRoadStructureVerticalIntersection(
            edge,
            verticalEdgeS,
            x,
            z,
            verticalEnvelope,
            roadClearanceVerticalResultScratch
          );
          if (!verticalIntersection.intersects) continue;
          minimumClearance = clearance;
          closest = {
            edgeId: edge.id,
            surfaceId: edge.surfaceId,
            edgeS: verticalEnvelope ? verticalIntersection.edgeS : segmentS,
            x: nearest.x,
            z: nearest.z,
            roadHalf: roadHalfAtS,
            roadMinimumY: verticalIntersection.roadMinimumY,
            roadMaximumY: verticalIntersection.roadMaximumY,
            roadLateral: verticalIntersection.roadLateral,
            roadSurfaceY: verticalIntersection.roadSurfaceY,
            verticalOverlapM: verticalIntersection.overlapM
          };
        }
      }
    }
    return Object.freeze({
      clear: minimumClearance >= 0,
      intersects: minimumClearance < 0,
      clearance: minimumClearance,
      edgeId: closest?.edgeId ?? null,
      surfaceId: closest?.surfaceId ?? null,
      edgeS: closest?.edgeS ?? null,
      nearestX: closest?.x ?? null,
      nearestZ: closest?.z ?? null,
      roadHalf: closest?.roadHalf ?? null,
      roadMinimumY: closest?.roadMinimumY ?? null,
      roadMaximumY: closest?.roadMaximumY ?? null,
      roadLateral: closest?.roadLateral ?? null,
      roadSurfaceY: closest?.roadSurfaceY ?? null,
      verticalOverlapM: closest?.verticalOverlapM ?? null
    });
  }

  function getEntitySurfaceId(edgeId) {
    const edge = getEdge(edgeId);
    return edge?.gameplaySurface === false ? null : edge?.surfaceId ?? null;
  }

  function getTemplateEdgeId(edgeId) {
    const edge = getEdge(edgeId);
    if (!edge || edge.runtimeKind === 'recovery'
      || edge.runtimeKind === BIDIRECTIONAL_VISUAL_RUNTIME_KIND) return null;
    return edge.templateEdgeId || edge.id;
  }

  /** Template-tile roads form one clean decision space; only recovery connectors carry gameplay traffic. */
  function isInterchangeClearZone(edgeOrCursor) {
    const edgeId = typeof edgeOrCursor === 'string' ? edgeOrCursor : edgeOrCursor?.edgeId;
    return Boolean(getEdge(edgeId)?.interchangeClearZone);
  }

  function signedDistanceToFootprint(x, z, footprint) {
    const outsideX = Math.max(footprint.minX - x, 0, x - footprint.maxX);
    const outsideZ = Math.max(footprint.minZ - z, 0, z - footprint.maxZ);
    if (outsideX > 0 || outsideZ > 0) return Math.hypot(outsideX, outsideZ);
    return -Math.min(
      x - footprint.minX,
      footprint.maxX - x,
      z - footprint.minZ,
      footprint.maxZ - z
    );
  }

  /** Query the physical tile footprint, including an object's complete horizontal radius. */
  function queryInterchangeClearZone(point, horizontalRadius = 0, options = {}) {
    const x = Number(point?.x);
    const z = Number(point?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new TypeError('queryInterchangeClearZone requires finite world x/z coordinates');
    }
    const radius = Math.max(0, Number(horizontalRadius) || 0);
    const margin = Math.max(0, Number(options.margin) || 0);
    const tiles = Array.isArray(options.pathPlan?.tiles) && options.pathPlan.tiles.length
      ? options.pathPlan.tiles
      : [...runtimeTilesByToken.values()];
    let closest = null;
    for (const tile of tiles) {
      const footprint = tile.footprint || tileFootprint(Number(tile.centerX) || 0, Number(tile.centerZ) || 0);
      const signedDistance = signedDistanceToFootprint(x, z, footprint);
      const clearance = signedDistance - radius;
      if (!closest || clearance < closest.clearance) {
        closest = {
          tileIndex: tile.index,
          tileToken: tile.token,
          signedDistance,
          clearance,
          footprint
        };
      }
    }
    return Object.freeze({
      intersects: Boolean(closest && closest.clearance <= margin),
      clear: !closest || closest.clearance > margin,
      signedDistance: closest?.signedDistance ?? Number.POSITIVE_INFINITY,
      clearance: closest?.clearance ?? Number.POSITIVE_INFINITY,
      tileIndex: closest?.tileIndex ?? null,
      tileToken: closest?.tileToken ?? null,
      footprint: closest?.footprint ?? null
    });
  }

  function getTileForEdge(edgeId) {
    const edge = getEdge(edgeId);
    if (!edge) return null;
    if (edge.tileToken) return runtimeTilesByToken.get(edge.tileToken) || null;
    const matchingEntry = [...runtimeTilesByToken.values()].find((tile) => (
      tile.index === 0 && edge.entryPort && tile.entryPort === edge.entryPort
    ));
    return matchingEntry || [...runtimeTilesByToken.values()].find((tile) => tile.index === 0) || null;
  }

  function curvatureProfileForEdge(edge) {
    if (!edge || edge.runtimeKind === BIDIRECTIONAL_VISUAL_RUNTIME_KIND) return null;
    if (edge.runtimeKind === 'recovery') return edge.curvatureProfile || null;
    return graphCurvatureProfiles.get(edge.templateEdgeId || edge.id) || null;
  }

  function curvatureAtProfileStation(profile, edgeS) {
    const targetS = clamp(edgeS, 0, profile.stations[profile.stations.length - 1]);
    const low = sampleIntervalIndex(profile.stations, targetS);
    const high = Math.min(profile.stations.length - 1, low + 1);
    const span = profile.stations[high] - profile.stations[low];
    const t = span > 0.000_001 ? (targetS - profile.stations[low]) / span : 0;
    return profile.curvatures[low] + (profile.curvatures[high] - profile.curvatures[low]) * t;
  }

  function curvatureThresholdCrossingS(startS, startCurvature, endS, endCurvature) {
    if (Math.abs(startCurvature) > CLOVERLEAF_CURVE_THRESHOLD) return startS;
    if (Math.abs(endCurvature) <= CLOVERLEAF_CURVE_THRESHOLD) return Number.POSITIVE_INFINITY;
    const target = Math.sign(endCurvature) * CLOVERLEAF_CURVE_THRESHOLD;
    const delta = endCurvature - startCurvature;
    const t = Math.abs(delta) > 0.000_000_001
      ? clamp((target - startCurvature) / delta, 0, 1)
      : 1;
    return startS + (endS - startS) * t;
  }

  /** Scan precomputed edge curvature ranges directly; only the returned preview object is allocated per frame. */
  function getCurvatureAhead(cursor, pathPlan, lookAhead = 160) {
    const plan = pathPlan || createPathPlan({ entryPort: cursor?.entryPort });
    if (!plan.itinerary && plan.kind === 'straight') {
      return Object.freeze({
        maxCurvature: 0,
        signedCurvature: 0,
        distance: 0,
        turnKind: 'through'
      });
    }
    const limit = Math.max(0, lookAhead);
    let maximum = 0;
    let signedCurvature = 0;
    let maximumDistance = 0;
    let maximumTurnKind = null;
    let firstCurveDistance = Number.POSITIVE_INFINITY;
    const startIndex = planEdgeIndex(plan, cursor?.edgeId);
    if (startIndex < 0) throw new Error(`Cursor edge ${cursor?.edgeId} is not in ${plan.id}`);
    let index = startIndex;
    const startEdge = getEdge(cursor.edgeId);
    let distanceToEdgeStart = -clamp(cursor.edgeS, 0, startEdge.length);
    while (distanceToEdgeStart <= limit + 0.000_001) {
      if (index >= plan.edgeIds.length) {
        if (!plan.itinerary) break;
        appendNextItineraryTile(plan);
      }
      const edge = getEdge(plan.edgeIds[index]);
      if (!edge) break;
      const fromS = index === startIndex ? clamp(cursor.edgeS, 0, edge.length) : 0;
      const toS = Math.min(edge.length, limit - distanceToEdgeStart);
      if (toS + 0.000_001 < fromS) break;
      const profile = curvatureProfileForEdge(edge);
      if (profile) {
        let rangeMaximum = 0;
        let rangeSignedCurvature = 0;
        let rangePeakS = fromS;
        let rangeFirstCurveS = Number.POSITIVE_INFINITY;
        const profileEndS = profile.stations[profile.stations.length - 1];
        if (fromS <= 0.000_001 && toS >= profileEndS - 0.000_001) {
          rangeMaximum = profile.maxAbsCurvature;
          rangeSignedCurvature = profile.signedCurvature;
          rangePeakS = profile.peakS;
          rangeFirstCurveS = profile.firstCurveS;
        } else {
          let previousS = fromS;
          let previousCurvature = curvatureAtProfileStation(profile, fromS);
          rangeMaximum = Math.abs(previousCurvature);
          rangeSignedCurvature = previousCurvature;
          if (rangeMaximum > CLOVERLEAF_CURVE_THRESHOLD) rangeFirstCurveS = fromS;
          let sampleIndex = sampleIntervalIndex(profile.stations, fromS) + 1;
          while (sampleIndex < profile.stations.length && profile.stations[sampleIndex] < toS) {
            const station = profile.stations[sampleIndex];
            const curvature = profile.curvatures[sampleIndex];
            if (!Number.isFinite(rangeFirstCurveS)) {
              rangeFirstCurveS = curvatureThresholdCrossingS(
                previousS,
                previousCurvature,
                station,
                curvature
              );
            }
            if (Math.abs(curvature) > rangeMaximum) {
              rangeMaximum = Math.abs(curvature);
              rangeSignedCurvature = curvature;
              rangePeakS = station;
            }
            previousS = station;
            previousCurvature = curvature;
            sampleIndex += 1;
          }
          const endCurvature = curvatureAtProfileStation(profile, toS);
          if (!Number.isFinite(rangeFirstCurveS)) {
            rangeFirstCurveS = curvatureThresholdCrossingS(
              previousS,
              previousCurvature,
              toS,
              endCurvature
            );
          }
          if (Math.abs(endCurvature) > rangeMaximum) {
            rangeMaximum = Math.abs(endCurvature);
            rangeSignedCurvature = endCurvature;
            rangePeakS = toS;
          }
        }
        if (!Number.isFinite(firstCurveDistance) && Number.isFinite(rangeFirstCurveS)) {
          firstCurveDistance = Math.max(0, distanceToEdgeStart + rangeFirstCurveS);
        }
        if (rangeMaximum > maximum) {
          maximum = rangeMaximum;
          signedCurvature = rangeSignedCurvature;
          maximumDistance = Math.max(0, distanceToEdgeStart + rangePeakS);
          maximumTurnKind = edge.maneuver || edge.family;
        }
      }
      if (toS >= limit - distanceToEdgeStart - 0.000_001 && toS < edge.length - 0.000_001) break;
      distanceToEdgeStart += edge.length;
      index += 1;
    }
    return Object.freeze({
      maxCurvature: maximum,
      signedCurvature,
      // Braking targets the strictest visible radius but starts at the first physical bend, never at a later peak.
      distance: Number.isFinite(firstCurveDistance) ? firstCurveDistance : maximumDistance,
      peakDistance: maximumDistance,
      turnKind: maximumTurnKind || (plan.kind === 'left' ? 'loop-left' : plan.kind === 'right' ? 'direct-right' : 'through')
    });
  }

  function movementContainsEdge(movementIdValue, edgeId) {
    return Boolean(getMovement(movementIdValue)?.edgeIds.includes(edgeId));
  }

  const legacyTrack = Object.freeze({
    ROUTE_TRUNK,
    ROUTE_LEFT,
    ROUTE_RIGHT,
    EVENT_INTERCHANGE,
    EVENT_LAUNCH_FORK,
    FIRST_FORK_S,
    FORK_CYCLE,
    FORK_DURATION,
    BRANCH_SEPARATION,
    getForkEvent,
    getForkEventAt,
    getDecisionEventAt,
    getBranchOpen,
    getRouteOffset,
    getInterchangePhase,
    getRouteLabel,
    getRamp,
    sampleSurface,
    crossedRampLip,
    otherRoute,
    smootherStep01
  });

  function otherRoute(routeId) {
    return routeId === ROUTE_LEFT ? ROUTE_RIGHT : ROUTE_LEFT;
  }

  return Object.freeze({
    ROUTE_TRUNK,
    ROUTE_LEFT,
    ROUTE_RIGHT,
    EVENT_INTERCHANGE,
    EVENT_LAUNCH_FORK,
    FIRST_FORK_S,
    FORK_CYCLE,
    FORK_DURATION,
    BRANCH_SEPARATION,
    MAX_ROUTE_OFFSET,
    INTERCHANGE_BRANCH_SEPARATION,
    LAUNCH_BRANCH_SEPARATION,
    INTERCHANGE_HEIGHT,
    INTERCHANGE_DECK_HALF_WIDTH,
    INTERCHANGE_DECK_THICKNESS,
    CLOVERLEAF_GRAPH_VERSION,
    CLOVERLEAF_PORT_DISTANCE,
    CLOVERLEAF_DIRECT_RADIUS,
    CLOVERLEAF_LOOP_RADIUS,
    CLOVERLEAF_RECOVERY_LENGTH,
    CLOVERLEAF_RECOVERY_EXTENSION,
    CLOVERLEAF_LAUNCH_OFFSET,
    BIDIRECTIONAL_VISUAL_RUNTIME_KIND,
    graph: cloverleafGraph,
    legacy: legacyTrack,
    RoutePosition: routePosition,
    Node: getNode,
    Edge: getEdge,
    Crossing: (crossingId) => graphCrossings.find((crossing) => crossing.id === crossingId) || null,
    PathPlan: createPathPlan,
    getNode,
    getEdge,
    getRuntimeEdgesForTileIndex,
    getMovement,
    getInitialRouteCursor,
    cloneRouteCursor,
    createPathPlan,
    preparePathPlanCandidate,
    sampleEdge,
    sampleRouteCursor,
    samplePathFrame,
    sampleSignedPathFrame,
    advanceCursor,
    advanceRouteCursor,
    crossedJumpPlatformLip,
    crossedLaunchLip,
    forwardDistance,
    distanceAlongPath,
    getUpcomingLowerCrossing,
    gateTargetForHalfWidth,
    enumerateMovements,
    getUpcomingDecisions,
    ensureItineraryHorizon,
    compactItineraryPlan,
    pruneRuntimeTopology,
    getRuntimeTopologyDiagnostics,
    getBidirectionalVisualEdgesForTile,
    getRecoveryVisualEdgesForTile,
    getJumpPlatformsForEdge,
    getJumpPlatformsForTile,
    sampleJumpPlatformSupport,
    getRecoveryForkMovementsForTile,
    getReachableTrafficPlacements,
    getVisibleEdges,
    queryAirborneLandingSupport,
    prepareOpposingRecoveryPathPlan,
    resolveAirborneLandingRoute,
    queryRoadClearance,
    getEntitySurfaceId,
    getTemplateEdgeId,
    isInterchangeClearZone,
    queryInterchangeClearZone,
    getTileForEdge,
    getCurvatureAhead,
    movementContainsEdge,
    transitionContainsEdge: movementContainsEdge,
    getForkEvent,
    getForkEventAt,
    getDecisionEventAt,
    getBranchOpen,
    getRouteOffset,
    getInterchangePhase,
    getRouteLabel,
    getRamp,
    sampleSurface,
    crossedRampLip,
    otherRoute,
    smootherStep01
  });
})();
