/* Shared V23 procedural modeling kernel. Main visuals must be built from these closed indexed meshes. */
window.NeonV23Modeling = (() => {
  'use strict';

  const immutableTopologyReports = new WeakMap();

  const DEFAULT_QUALITY_PROFILES = Object.freeze({
    high: Object.freeze({
      id: 'high',
      terrainSegments: 32,
      radialSegments: 24,
      tubularSegments: 32,
      bevelSegments: 3,
      particleScale: 1,
      farDensity: 1,
      lodDistance: 440,
      shadowMapSize: 4_096,
      pixelRatioCap: 2,
      maxRenderPixels: 5_200_000
    }),
    mobile: Object.freeze({
      id: 'mobile',
      terrainSegments: 14,
      radialSegments: 12,
      tubularSegments: 18,
      bevelSegments: 1,
      particleScale: 0.42,
      farDensity: 0.46,
      lodDistance: 250,
      shadowMapSize: 2_048,
      pixelRatioCap: 1.5,
      maxRenderPixels: 2_400_000
    })
  });

  const MATERIAL_KINDS = Object.freeze([
    'surface',
    'structure',
    'organic',
    'road',
    'glow',
    'hazard',
    'glass',
    'effect'
  ]);

  // Physical defaults express how each authored surface responds to the shared HDR environment. Small non-zero
  // sheen values preserve broad grazing highlights without making mineral, road, or structural surfaces look waxed.
  const PHYSICAL_MATERIAL_DEFAULTS = Object.freeze({
    surface: Object.freeze({
      emissiveIntensity: 0.015,
      roughness: 0.68,
      metalness: 0.04,
      clearcoat: 0.22,
      clearcoatRoughness: 0.38,
      sheen: 0.08,
      sheenRoughness: 0.72,
      ior: 1.46
    }),
    structure: Object.freeze({
      emissiveIntensity: 0.02,
      roughness: 0.72,
      metalness: 0.10,
      clearcoat: 0.28,
      clearcoatRoughness: 0.32,
      sheen: 0.05,
      sheenRoughness: 0.76,
      ior: 1.50
    }),
    organic: Object.freeze({
      emissiveIntensity: 0.025,
      roughness: 0.74,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.72,
      sheen: 0.72,
      sheenRoughness: 0.68,
      ior: 1.46
    }),
    road: Object.freeze({
      emissiveIntensity: 0.03,
      roughness: 0.62,
      metalness: 0.06,
      clearcoat: 0.18,
      clearcoatRoughness: 0.40,
      sheen: 0.03,
      sheenRoughness: 0.82,
      ior: 1.50
    }),
    hazard: Object.freeze({
      emissiveIntensity: 0.10,
      roughness: 0.58,
      metalness: 0.08,
      clearcoat: 0.18,
      clearcoatRoughness: 0.36,
      sheen: 0.16,
      sheenRoughness: 0.64,
      ior: 1.48
    }),
    glass: Object.freeze({
      emissiveIntensity: 0.025,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      sheen: 0,
      sheenRoughness: 1,
      ior: 1.45,
      transmission: 0.82,
      thickness: 0.18
    })
  });

  function requireThree(provided) {
    const THREE = provided || window.THREE;
    if (!THREE) throw new Error('NeonV23Modeling requires THREE');
    return THREE;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * Converts strings, numbers, and structured seed values into one stable unsigned 32-bit seed.
   * The avalanche stage prevents similar zone/object identifiers from producing visibly related streams.
   */
  function hashSeed(value) {
    const source = typeof value === 'string' ? value : JSON.stringify(value ?? 0);
    let hash = 0x811c_9dc5;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x0100_0193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85eb_ca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2_ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
  }

  /** Returns a stable hash for spatial coordinates without consuming a gameplay random stream. */
  function hashCoordinates(...values) {
    return hashSeed(values.map((value) => Number.isFinite(value) ? Number(value).toPrecision(12) : String(value)).join('|'));
  }

  /**
   * Creates an isolated deterministic PRNG for visual construction. The returned callable also exposes
   * range/int/pick/chance/fork helpers so model factories never need Math.random or gameplay RNG state.
   */
  function createRng(seed = 1) {
    let state = hashSeed(seed) || 0x6d2b_79f5;
    const random = () => {
      state = (state + 0x6d2b_79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
    };
    random.next = random;
    random.float = random;
    random.range = (min, max) => min + (max - min) * random();
    random.int = (min, maxInclusive) => Math.floor(random.range(min, maxInclusive + 1));
    random.pick = (items) => {
      if (!Array.isArray(items) || items.length === 0) throw new Error('createRng.pick requires a non-empty array');
      return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
    };
    random.chance = (probability) => random() < clamp(probability, 0, 1);
    random.fork = (label) => createRng(`${hashSeed(seed)}:${label}`);
    random.getState = () => state >>> 0;
    return random;
  }

  function toVector3(THREE, value, label = 'point') {
    if (value?.isVector3) return value.clone();
    if (Array.isArray(value) && value.length >= 3) {
      return new THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
    }
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
      return new THREE.Vector3(Number(value.x), Number(value.y), Number(value.z));
    }
    throw new Error(`${label} must be [x,y,z], THREE.Vector3, or {x,y,z}`);
  }

  function toVector2(THREE, value, label = 'point') {
    if (value?.isVector2) return value.clone();
    if (Array.isArray(value) && value.length >= 2) return new THREE.Vector2(Number(value[0]), Number(value[1]));
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return new THREE.Vector2(Number(value.x), Number(value.y));
    }
    throw new Error(`${label} must be [x,y], THREE.Vector2, or {x,y}`);
  }

  function normalizeLoftRing(THREE, ring, ringIndex) {
    if (Array.isArray(ring)) return ring.map((point) => toVector3(THREE, point, `rings[${ringIndex}] point`));
    if (ring && Array.isArray(ring.points) && Number.isFinite(ring.z)) {
      return ring.points.map((point) => {
        const profilePoint = toVector2(THREE, point, `rings[${ringIndex}].points point`);
        return new THREE.Vector3(profilePoint.x, profilePoint.y, Number(ring.z));
      });
    }
    throw new Error(`rings[${ringIndex}] must be a 3D point array or {z, points:[[x,y], ...]}`);
  }

  function averageRing(THREE, ring) {
    const center = new THREE.Vector3();
    for (const point of ring) center.add(point);
    return center.multiplyScalar(1 / ring.length);
  }

  /**
   * Builds a manifold indexed shell from equally sampled closed rings. Side rings share vertices with
   * cap fans, making weld-based topology checks reflect the real watertight contract rather than UV seams.
   */
  function buildRingShell(THREE, rings, { capStart = true, capEnd = true, loopRings = false } = {}) {
    if (!Array.isArray(rings) || rings.length < (loopRings ? 3 : 2)) {
      throw new Error(`A ${loopRings ? 'closed path' : 'loft'} requires at least ${loopRings ? 3 : 2} rings`);
    }
    const pointsPerRing = rings[0].length;
    if (pointsPerRing < 3 || rings.some((ring) => ring.length !== pointsPerRing)) {
      throw new Error('Every closed loft ring must contain the same number of at least three points');
    }

    const positions = [];
    const indices = [];
    for (const ring of rings) {
      for (const point of ring) positions.push(point.x, point.y, point.z);
    }

    const ringPairCount = loopRings ? rings.length : rings.length - 1;
    for (let ringIndex = 0; ringIndex < ringPairCount; ringIndex++) {
      const nextRingIndex = (ringIndex + 1) % rings.length;
      for (let pointIndex = 0; pointIndex < pointsPerRing; pointIndex++) {
        const nextPointIndex = (pointIndex + 1) % pointsPerRing;
        const a = ringIndex * pointsPerRing + pointIndex;
        const b = ringIndex * pointsPerRing + nextPointIndex;
        const c = nextRingIndex * pointsPerRing + nextPointIndex;
        const d = nextRingIndex * pointsPerRing + pointIndex;
        indices.push(a, b, c, a, c, d);
      }
    }

    if (!loopRings && capStart) {
      const centerIndex = positions.length / 3;
      const center = averageRing(THREE, rings[0]);
      positions.push(center.x, center.y, center.z);
      for (let pointIndex = 0; pointIndex < pointsPerRing; pointIndex++) {
        indices.push(centerIndex, (pointIndex + 1) % pointsPerRing, pointIndex);
      }
    }
    if (!loopRings && capEnd) {
      const centerIndex = positions.length / 3;
      const lastRingOffset = (rings.length - 1) * pointsPerRing;
      const center = averageRing(THREE, rings[rings.length - 1]);
      positions.push(center.x, center.y, center.z);
      for (let pointIndex = 0; pointIndex < pointsPerRing; pointIndex++) {
        indices.push(
          centerIndex,
          lastRingOffset + pointIndex,
          lastRingOffset + (pointIndex + 1) % pointsPerRing
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.neonV23 = {
      factory: loopRings ? 'closed-ring-shell' : 'indexed-loft',
      closedExpected: loopRings || (capStart && capEnd)
    };
    return geometry;
  }

  /**
   * Creates a closed indexed loft. Rings are arrays of [x,y,z]/Vector3/{x,y,z}; a convenience
   * `{z, points:[[x,y], ...]}` form is also accepted for profiles extruded along Z.
   */
  function createLoftGeometry({ THREE: providedThree, rings, capStart = true, capEnd = true } = {}) {
    const THREE = requireThree(providedThree);
    const normalizedRings = rings?.map((ring, index) => normalizeLoftRing(THREE, ring, index));
    const geometry = buildRingShell(THREE, normalizedRings, { capStart, capEnd });
    geometry.userData.neonV23.factory = 'createLoftGeometry';
    return geometry;
  }

  /**
   * Extrudes a closed XY outline symmetrically along Z. Bevel rings shrink toward each sealed face,
   * avoiding coplanar overlay parts while retaining a predictable centered local origin.
   */
  function createExtrudedProfileGeometry({
    THREE: providedThree,
    outline,
    depth = 1,
    bevel = 0,
    bevelSegments = 1
  } = {}) {
    const THREE = requireThree(providedThree);
    if (!Array.isArray(outline) || outline.length < 3) throw new Error('outline requires at least three XY points');
    if (!(depth > 0)) throw new Error('depth must be greater than zero');

    const profile = outline.map((point, index) => toVector2(THREE, point, `outline[${index}]`));
    if (profile.length > 3 && profile[0].distanceToSquared(profile[profile.length - 1]) < 1e-12) profile.pop();
    const centroid = new THREE.Vector2();
    for (const point of profile) centroid.add(point);
    centroid.multiplyScalar(1 / profile.length);
    const profileRadius = Math.max(...profile.map((point) => point.distanceTo(centroid)), 1e-6);
    const effectiveBevel = clamp(Number(bevel) || 0, 0, Math.min(depth * 0.45, profileRadius * 0.45));
    const segmentCount = effectiveBevel > 0 ? Math.max(1, Math.round(bevelSegments)) : 0;
    const innerScale = effectiveBevel > 0 ? Math.max(0.55, 1 - effectiveBevel / profileRadius) : 1;
    const halfDepth = depth / 2;
    const rings = [];

    const addRing = (z, scale) => {
      rings.push(profile.map((point) => new THREE.Vector3(
        centroid.x + (point.x - centroid.x) * scale,
        centroid.y + (point.y - centroid.y) * scale,
        z
      )));
    };

    if (segmentCount === 0) {
      addRing(-halfDepth, 1);
      addRing(halfDepth, 1);
    } else {
      addRing(-halfDepth, innerScale);
      for (let segment = 1; segment <= segmentCount; segment++) {
        const t = segment / segmentCount;
        addRing(-halfDepth + effectiveBevel * t, innerScale + (1 - innerScale) * smoothstep(t));
      }
      addRing(halfDepth - effectiveBevel, 1);
      for (let segment = 1; segment <= segmentCount; segment++) {
        const t = segment / segmentCount;
        addRing(halfDepth - effectiveBevel + effectiveBevel * t, 1 - (1 - innerScale) * smoothstep(t));
      }
    }

    const geometry = buildRingShell(THREE, rings, { capStart: true, capEnd: true });
    geometry.userData.neonV23.factory = 'createExtrudedProfileGeometry';
    return geometry;
  }

  /** Creates a chamfered, axially beveled prism without relying on THREE.BoxGeometry. */
  function createBeveledPrismGeometry({
    THREE: providedThree,
    width = 1,
    height = 1,
    depth = 1,
    chamfer = Math.min(width, height) * 0.12,
    bevel = Math.min(width, height, depth) * 0.06,
    bevelSegments = 1
  } = {}) {
    const THREE = requireThree(providedThree);
    if (!(width > 0 && height > 0 && depth > 0)) throw new Error('Prism dimensions must be greater than zero');
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const edge = clamp(chamfer, 0, Math.min(halfWidth, halfHeight) * 0.92);
    const outline = [
      [-halfWidth + edge, -halfHeight],
      [halfWidth - edge, -halfHeight],
      [halfWidth, -halfHeight + edge],
      [halfWidth, halfHeight - edge],
      [halfWidth - edge, halfHeight],
      [-halfWidth + edge, halfHeight],
      [-halfWidth, halfHeight - edge],
      [-halfWidth, -halfHeight + edge]
    ];
    const geometry = createExtrudedProfileGeometry({
      THREE,
      outline,
      depth,
      bevel,
      bevelSegments
    });
    geometry.userData.neonV23.factory = 'createBeveledPrismGeometry';
    return geometry;
  }

  function interpolateArrayValue(values, t) {
    if (values.length === 1) return Number(values[0]);
    const scaled = clamp(t, 0, 1) * (values.length - 1);
    const low = Math.floor(scaled);
    const high = Math.min(values.length - 1, low + 1);
    return Number(values[low]) + (Number(values[high]) - Number(values[low])) * (scaled - low);
  }

  /**
   * Sweeps a circular profile along a curve using THREE's parallel-transport Frenet frames. Open tubes
   * are sealed by default; closed paths connect the final ring back to the first and never add caps.
   */
  function createTubeGeometry({
    THREE: providedThree,
    points,
    curve,
    radius = 0.1,
    radii,
    tubularSegments = 24,
    radialSegments = 12,
    closed = false,
    capStart = !closed,
    capEnd = !closed
  } = {}) {
    const THREE = requireThree(providedThree);
    let path = curve;
    if (!path) {
      if (!Array.isArray(points) || points.length < (closed ? 3 : 2)) {
        throw new Error(`createTubeGeometry requires at least ${closed ? 3 : 2} path points`);
      }
      path = new THREE.CatmullRomCurve3(
        points.map((point, index) => toVector3(THREE, point, `points[${index}]`)),
        closed,
        'centripetal'
      );
    }
    if (typeof path.getPointAt !== 'function' || typeof path.computeFrenetFrames !== 'function') {
      throw new Error('curve must implement getPointAt and computeFrenetFrames');
    }

    const pathSegments = Math.max(closed ? 3 : 1, Math.round(tubularSegments));
    const sideSegments = Math.max(3, Math.round(radialSegments));
    const frames = path.computeFrenetFrames(pathSegments, closed);
    const ringCount = closed ? pathSegments : pathSegments + 1;
    const rings = [];
    const radiusAt = (t, index) => {
      if (typeof radii === 'function') return Number(radii(t, index));
      if (Array.isArray(radii) && radii.length > 0) return interpolateArrayValue(radii, t);
      if (typeof radius === 'function') return Number(radius(t, index));
      return Number(radius);
    };

    for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
      const t = ringIndex / pathSegments;
      const center = path.getPointAt(t);
      const normal = frames.normals[ringIndex];
      const binormal = frames.binormals[ringIndex];
      const ringRadius = Math.max(1e-5, radiusAt(t, ringIndex));
      const ring = [];
      for (let sideIndex = 0; sideIndex < sideSegments; sideIndex++) {
        const angle = sideIndex / sideSegments * Math.PI * 2;
        ring.push(center.clone()
          .addScaledVector(normal, Math.cos(angle) * ringRadius)
          .addScaledVector(binormal, Math.sin(angle) * ringRadius));
      }
      rings.push(ring);
    }

    const geometry = buildRingShell(THREE, rings, {
      capStart: !closed && capStart,
      capEnd: !closed && capEnd,
      loopRings: closed
    });
    geometry.userData.neonV23.factory = 'createTubeGeometry';
    return geometry;
  }

  function radialPoint(THREE, axis, position, radius, angle) {
    const first = Math.cos(angle) * radius;
    const second = Math.sin(angle) * radius;
    if (axis === 'x') return new THREE.Vector3(position, first, second);
    if (axis === 'z') return new THREE.Vector3(first, second, position);
    return new THREE.Vector3(first, position, second);
  }

  /**
   * Revolves `[axisPosition, radius]` samples into a sealed indexed body. The profile must stay above
   * zero radius; caps supply the axis endpoints without degenerate duplicate pole vertices.
   */
  function createRadialGeometry({
    THREE: providedThree,
    profile,
    segments = 24,
    axis = 'y',
    capStart = true,
    capEnd = true
  } = {}) {
    const THREE = requireThree(providedThree);
    if (!['x', 'y', 'z'].includes(axis)) throw new Error("axis must be 'x', 'y', or 'z'");
    if (!Array.isArray(profile) || profile.length < 2) throw new Error('profile requires at least two samples');
    const sideSegments = Math.max(3, Math.round(segments));
    const samples = profile.map((sample, index) => {
      const position = Array.isArray(sample) ? Number(sample[0]) : Number(sample?.position);
      const sampleRadius = Array.isArray(sample) ? Number(sample[1]) : Number(sample?.radius);
      if (!Number.isFinite(position) || !(sampleRadius > 0)) {
        throw new Error(`profile[${index}] must be [axisPosition, positiveRadius] or {position,radius}`);
      }
      return { position, radius: sampleRadius };
    });
    const rings = samples.map((sample) => {
      const ring = [];
      for (let segment = 0; segment < sideSegments; segment++) {
        ring.push(radialPoint(THREE, axis, sample.position, sample.radius, segment / sideSegments * Math.PI * 2));
      }
      return ring;
    });
    const geometry = buildRingShell(THREE, rings, { capStart, capEnd });
    geometry.userData.neonV23.factory = 'createRadialGeometry';
    return geometry;
  }

  function valueNoise2D(x, y, seed = 1) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);
    const sample = (sampleX, sampleY) => hashCoordinates(seed, sampleX, sampleY) / 2_147_483_647.5 - 1;
    const a = sample(x0, y0);
    const b = sample(x0 + 1, y0);
    const c = sample(x0, y0 + 1);
    const d = sample(x0 + 1, y0 + 1);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
  }

  /** Deterministic fractal value noise used only to shape visual meshes. */
  function fractalNoise2D(x, y, seed = 1, octaves = 4, persistence = 0.5, lacunarity = 2) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let normalization = 0;
    for (let octave = 0; octave < Math.max(1, Math.round(octaves)); octave++) {
      total += valueNoise2D(x * frequency, y * frequency, hashCoordinates(seed, octave)) * amplitude;
      normalization += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return normalization > 0 ? total / normalization : 0;
  }

  /**
   * Generates a sealed irregular rock from circular rings. Noise is sampled in angular coordinate space,
   * so the first/last side connection remains continuous and no seam vertices need to be duplicated.
   */
  function createNoiseRockGeometry({
    THREE: providedThree,
    seed = 1,
    radius = 1,
    height = 2,
    radialSegments = 18,
    heightSegments = 8,
    noise = 0.24,
    flatten = 0.12
  } = {}) {
    const THREE = requireThree(providedThree);
    if (!(radius > 0 && height > 0)) throw new Error('Rock radius and height must be greater than zero');
    const around = Math.max(6, Math.round(radialSegments));
    const levels = Math.max(3, Math.round(heightSegments));
    const rings = [];
    const phase = hashSeed(seed) / 4_294_967_296 * Math.PI * 2;
    for (let level = 0; level <= levels; level++) {
      const t = level / levels;
      const roundedProfile = 0.34 + 0.66 * Math.pow(Math.sin(Math.PI * t), 0.72);
      const yBase = (t - 0.5) * height;
      const y = t < flatten ? -height / 2 + height * flatten * smoothstep(t / Math.max(flatten, 1e-5)) : yBase;
      const ring = [];
      for (let segment = 0; segment < around; segment++) {
        const angle = segment / around * Math.PI * 2;
        const noiseValue = fractalNoise2D(
          Math.cos(angle) * 1.7 + t * 0.43,
          Math.sin(angle) * 1.7 + t * 1.13,
          seed,
          3
        );
        const directional = 1 + Math.sin(angle * 3 + phase + t * 2.4) * noise * 0.24;
        const ringRadius = Math.max(radius * 0.12, radius * roundedProfile * (1 + noiseValue * noise) * directional);
        ring.push(new THREE.Vector3(Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius));
      }
      rings.push(ring);
    }
    const geometry = buildRingShell(THREE, rings, { capStart: true, capEnd: true });
    geometry.userData.neonV23.factory = 'createNoiseRockGeometry';
    geometry.userData.neonV23.seed = hashSeed(seed);
    return geometry;
  }

  /**
   * Builds a top grid, perimeter skirt, and bottom fan as one closed indexed terrain shell. The top
   * perimeter vertices are shared with the skirt, preventing daylight cracks between adjacent faces.
   */
  function createTerrainGeometry({
    THREE: providedThree,
    seed = 1,
    width = 12,
    depth = 12,
    height = 2,
    segments,
    segmentsX = segments ?? 24,
    segmentsZ = segments ?? 24,
    skirtDepth = 2,
    noiseScale = 0.14,
    noiseOctaves = 4,
    ridge = 0,
    heightAt
  } = {}) {
    const THREE = requireThree(providedThree);
    if (!(width > 0 && depth > 0 && skirtDepth > 0)) throw new Error('Terrain dimensions and skirtDepth must be positive');
    const countX = Math.max(2, Math.round(segmentsX));
    const countZ = Math.max(2, Math.round(segmentsZ));
    const positions = [];
    const indices = [];
    let minimumTop = Infinity;

    const vertexIndex = (xIndex, zIndex) => zIndex * (countX + 1) + xIndex;
    for (let zIndex = 0; zIndex <= countZ; zIndex++) {
      const z = (zIndex / countZ - 0.5) * depth;
      for (let xIndex = 0; xIndex <= countX; xIndex++) {
        const x = (xIndex / countX - 0.5) * width;
        const rawNoise = fractalNoise2D(x * noiseScale, z * noiseScale, seed, noiseOctaves);
        const ridgedNoise = 1 - Math.abs(rawNoise);
        const blendedNoise = rawNoise + (ridgedNoise * 2 - 1 - rawNoise) * clamp(ridge, 0, 1);
        const y = typeof heightAt === 'function'
          ? Number(heightAt({ x, z, noise: blendedNoise, xIndex, zIndex }))
          : blendedNoise * height;
        if (!Number.isFinite(y)) throw new Error('heightAt must return a finite number');
        minimumTop = Math.min(minimumTop, y);
        positions.push(x, y, z);
      }
    }

    for (let zIndex = 0; zIndex < countZ; zIndex++) {
      for (let xIndex = 0; xIndex < countX; xIndex++) {
        const a = vertexIndex(xIndex, zIndex);
        const b = vertexIndex(xIndex + 1, zIndex);
        const c = vertexIndex(xIndex + 1, zIndex + 1);
        const d = vertexIndex(xIndex, zIndex + 1);
        indices.push(a, d, b, b, d, c);
      }
    }

    // Clockwise perimeter order lets every top boundary edge pair with exactly one skirt triangle edge.
    const perimeter = [];
    for (let xIndex = 0; xIndex <= countX; xIndex++) perimeter.push(vertexIndex(xIndex, 0));
    for (let zIndex = 1; zIndex <= countZ; zIndex++) perimeter.push(vertexIndex(countX, zIndex));
    for (let xIndex = countX - 1; xIndex >= 0; xIndex--) perimeter.push(vertexIndex(xIndex, countZ));
    for (let zIndex = countZ - 1; zIndex >= 1; zIndex--) perimeter.push(vertexIndex(0, zIndex));

    const bottomY = minimumTop - skirtDepth;
    const bottomOffset = positions.length / 3;
    for (const topIndex of perimeter) {
      positions.push(positions[topIndex * 3], bottomY, positions[topIndex * 3 + 2]);
    }
    for (let index = 0; index < perimeter.length; index++) {
      const next = (index + 1) % perimeter.length;
      const topA = perimeter[index];
      const topB = perimeter[next];
      const bottomA = bottomOffset + index;
      const bottomB = bottomOffset + next;
      indices.push(topA, topB, bottomB, topA, bottomB, bottomA);
    }

    const bottomCenterIndex = positions.length / 3;
    positions.push(0, bottomY, 0);
    for (let index = 0; index < perimeter.length; index++) {
      const next = (index + 1) % perimeter.length;
      indices.push(bottomCenterIndex, bottomOffset + next, bottomOffset + index);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.neonV23 = {
      factory: 'createTerrainGeometry',
      closedExpected: true,
      seed: hashSeed(seed)
    };
    return geometry;
  }

  function materialColor(palette, kind, explicitColor) {
    if (explicitColor !== undefined) return explicitColor;
    const keys = {
      surface: ['surface', 'ground', 'structure'],
      structure: ['structure', 'surface', 'road'],
      organic: ['organic', 'accent', 'surface'],
      road: ['road', 'structure', 'surface'],
      glow: ['glow', 'accent', 'edge'],
      hazard: ['hazard', 'secondary', 'accent'],
      glass: ['glass', 'accent', 'glow'],
      effect: ['glow', 'accent', 'edge']
    }[kind] || ['surface'];
    for (const key of keys) if (palette?.[key] !== undefined) return palette[key];
    return kind === 'hazard' ? 0xff_5c68 : kind === 'glow' || kind === 'effect' ? 0xff_e5a8 : 0x8a_8f98;
  }

  function installProceduralSurface(material, { scale = 1.35, strength = 0.12, seed = 1 } = {}) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.neonV23PatternScale = { value: scale };
      shader.uniforms.neonV23PatternStrength = { value: strength };
      shader.uniforms.neonV23PatternSeed = { value: (hashSeed(seed) % 10_000) / 10_000 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNeonV23LocalPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeonV23LocalPosition = transformed;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vNeonV23LocalPosition;
uniform float neonV23PatternScale;
uniform float neonV23PatternStrength;
uniform float neonV23PatternSeed;
float neonV23Hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33 + neonV23PatternSeed);
  return fract((p.x + p.y) * p.z);
}`)
        // Procedural variation belongs in the linear material inputs. Applying it after dithering would tint the
        // display-referred output and bypass the physically based diffuse, roughness, HDR, and tone-mapping pipeline.
        .replace('#include <map_fragment>', `#include <map_fragment>
float neonV23DiffusePattern = neonV23Hash(floor(vNeonV23LocalPosition * neonV23PatternScale));
diffuseColor.rgb *= 1.0 + (neonV23DiffusePattern - 0.5) * neonV23PatternStrength;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float neonV23RoughnessPattern = neonV23Hash(floor(
  vNeonV23LocalPosition * neonV23PatternScale + vec3(11.7, 29.3, 47.1)
));
roughnessFactor = clamp(
  roughnessFactor + (0.5 - neonV23RoughnessPattern) * neonV23PatternStrength * 0.42,
  0.04,
  1.0
);`);
    };
    material.customProgramCacheKey = () => `neon-v23-procedural-linear-v2-${scale}-${strength}-${hashSeed(seed)}`;
  }

  /**
   * Creates palette-aware materials with one stable procedural surface treatment. Glow/effect materials
   * intentionally use MeshBasicMaterial; every non-emitting scene surface prefers MeshPhysicalMaterial so the
   * shared HDR environment, clearcoat, sheen, transmission, and index-of-refraction contracts stay coherent.
   */
  function createMaterial({
    THREE: providedThree,
    palette = {},
    kind = 'surface',
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness,
    sheen,
    sheenRoughness,
    sheenColor,
    ior,
    transmission,
    thickness,
    attenuationColor,
    attenuationDistance,
    envMapIntensity,
    specularIntensity,
    opacity = 1,
    transparent = opacity < 1,
    side,
    vertexColors = false,
    depthWrite,
    blending,
    procedural = !['glow', 'effect', 'glass'].includes(kind),
    proceduralScale = 1.35,
    proceduralStrength = 0.12,
    seed = 1,
    ...overrides
  } = {}) {
    const THREE = requireThree(providedThree);
    if (!MATERIAL_KINDS.includes(kind)) throw new Error(`Unsupported material kind: ${kind}`);
    const resolvedColor = materialColor(palette, kind, color);
    const resolvedEmissive = emissive ?? (kind === 'road'
      ? palette.roadEmissive ?? resolvedColor
      : kind === 'hazard' || kind === 'organic'
        ? palette.glow ?? palette.accent ?? resolvedColor
        : 0x00_0000);
    const shared = {
      color: resolvedColor,
      transparent,
      opacity,
      side: side ?? THREE.FrontSide,
      vertexColors,
      depthWrite: depthWrite ?? opacity >= 1,
      ...overrides
    };
    if (blending !== undefined) shared.blending = blending;

    let material;
    if (kind === 'glow' || kind === 'effect') {
      material = new THREE.MeshBasicMaterial({
        ...shared,
        blending: blending ?? THREE.AdditiveBlending,
        depthWrite: depthWrite ?? false,
        toneMapped: false
      });
    } else if (THREE.MeshPhysicalMaterial) {
      const defaults = PHYSICAL_MATERIAL_DEFAULTS[kind] || PHYSICAL_MATERIAL_DEFAULTS.surface;
      material = new THREE.MeshPhysicalMaterial({
        ...shared,
        emissive: resolvedEmissive,
        emissiveIntensity: emissiveIntensity ?? defaults.emissiveIntensity,
        roughness: roughness ?? defaults.roughness,
        metalness: metalness ?? defaults.metalness,
        clearcoat: clearcoat ?? defaults.clearcoat,
        clearcoatRoughness: clearcoatRoughness ?? defaults.clearcoatRoughness,
        sheen: sheen ?? defaults.sheen,
        sheenRoughness: sheenRoughness ?? defaults.sheenRoughness,
        sheenColor: sheenColor ?? resolvedColor,
        ior: ior ?? defaults.ior,
        envMapIntensity: envMapIntensity ?? 1,
        specularIntensity: specularIntensity ?? 1,
        ...(kind === 'glass' ? {
          transmission: transmission ?? defaults.transmission,
          thickness: thickness ?? defaults.thickness,
          ...(attenuationColor !== undefined ? { attenuationColor } : {}),
          ...(attenuationDistance !== undefined ? { attenuationDistance } : {})
        } : {})
      });
    } else {
      const defaults = PHYSICAL_MATERIAL_DEFAULTS[kind] || PHYSICAL_MATERIAL_DEFAULTS.surface;
      material = new THREE.MeshStandardMaterial({
        ...shared,
        emissive: resolvedEmissive,
        emissiveIntensity: emissiveIntensity ?? defaults.emissiveIntensity,
        roughness: roughness ?? defaults.roughness,
        metalness: metalness ?? defaults.metalness
      });
    }
    material.userData.neonV23 = {
      kind,
      procedural: Boolean(procedural),
      physical: Boolean(material.isMeshPhysicalMaterial)
    };
    if (procedural && material.isMeshStandardMaterial) {
      installProceduralSurface(material, { scale: proceduralScale, strength: proceduralStrength, seed });
    }
    return material;
  }

  /**
   * Chooses a desktop/mobile tessellation budget. Explicit query values always win; auto mode uses only
   * viewport/device hints and never alters model silhouettes or gameplay collision dimensions.
   */
  function resolveQualityProfile(requested = 'auto', {
    width = window.innerWidth || 1_280,
    height = window.innerHeight || 720,
    dpr = window.devicePixelRatio || 1,
    userAgent = window.navigator?.userAgent || '',
    profiles = window.NeonV23Config?.qualityProfiles || DEFAULT_QUALITY_PROFILES
  } = {}) {
    const normalized = String(requested || 'auto').toLowerCase();
    if (!['auto', 'high', 'mobile'].includes(normalized)) throw new Error(`Unsupported quality profile: ${requested}`);
    const mobileHint = Math.min(width, height) <= 640
      || Math.max(width, height) <= 900
      || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
      || (dpr >= 3 && width <= 1_024);
    const id = normalized === 'auto' ? (mobileHint ? 'mobile' : 'high') : normalized;
    return { ...DEFAULT_QUALITY_PROFILES[id], ...(profiles[id] || {}), id };
  }

  /**
   * Bounds WebGL backing-buffer work by both device DPR and a profile pixel budget. The budget affects
   * raster resolution only; CSS layout, camera visibility, world geometry, and collision remain unchanged.
   */
  function resolveRendererPixelRatio({
    width = window.innerWidth || 1_280,
    height = window.innerHeight || 720,
    dpr = window.devicePixelRatio || 1,
    pixelRatioCap = 1.25,
    maxRenderPixels = Number.POSITIVE_INFINITY
  } = {}) {
    const finitePositive = (value, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    };
    const cssWidth = finitePositive(width, 1_280);
    const cssHeight = finitePositive(height, 720);
    const deviceRatio = finitePositive(dpr, 1);
    const profileRatioCap = finitePositive(pixelRatioCap, 1.25);
    const cappedDeviceRatio = Math.min(deviceRatio, profileRatioCap);
    const pixelBudget = Number(maxRenderPixels);
    if (!Number.isFinite(pixelBudget) || pixelBudget <= 0) return cappedDeviceRatio;
    return Math.min(cappedDeviceRatio, Math.sqrt(pixelBudget / (cssWidth * cssHeight)));
  }

  /**
   * Audits welded edge incidence, winding agreement, finite coordinates, and physical triangle area.
   * Position welding intentionally ignores normal/UV splits so reported cracks describe model topology
   * instead of harmless BufferGeometry attribute seams.
   */
  function analyzeTopology(geometry, { tolerance = 0.000_01 } = {}) {
    if (!geometry?.isBufferGeometry) throw new Error('analyzeTopology requires THREE.BufferGeometry');
    if (!(tolerance > 0)) throw new Error('Topology weld tolerance must be greater than zero');
    const position = geometry.getAttribute('position');
    if (!position || position.itemSize < 3) throw new Error('Geometry requires a 3D position attribute');
    let invalidCoordinates = 0;
    for (let index = 0; index < position.count; index++) {
      if (!Number.isFinite(position.getX(index)) || !Number.isFinite(position.getY(index)) || !Number.isFinite(position.getZ(index))) {
        invalidCoordinates++;
      }
    }
    const weldedIds = new Array(position.count);
    const weldedByPosition = new Map();
    let weldedVertexCount = 0;
    for (let index = 0; index < position.count; index++) {
      const x = Math.round(position.getX(index) / tolerance);
      const y = Math.round(position.getY(index) / tolerance);
      const z = Math.round(position.getZ(index) / tolerance);
      const key = `${x},${y},${z}`;
      if (!weldedByPosition.has(key)) weldedByPosition.set(key, weldedVertexCount++);
      weldedIds[index] = weldedByPosition.get(key);
    }

    const sourceIndex = geometry.getIndex();
    const indexCount = sourceIndex ? sourceIndex.count : position.count;
    const edgeUse = new Map();
    let triangleCount = 0;
    let degenerateTriangles = 0;
    let zeroAreaTriangles = 0;
    const vertexAt = (index) => sourceIndex ? sourceIndex.getX(index) : index;
    const addEdge = (a, b) => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      const edge = edgeUse.get(key) || { count: 0, orientation: 0 };
      edge.count++;
      edge.orientation += a === low ? 1 : -1;
      edgeUse.set(key, edge);
    };

    for (let offset = 0; offset + 2 < indexCount; offset += 3) {
      const sourceA = vertexAt(offset);
      const sourceB = vertexAt(offset + 1);
      const sourceC = vertexAt(offset + 2);
      const a = weldedIds[sourceA];
      const b = weldedIds[sourceB];
      const c = weldedIds[sourceC];
      triangleCount++;
      if (a === b || b === c || c === a) {
        degenerateTriangles++;
        continue;
      }
      const abX = position.getX(sourceB) - position.getX(sourceA);
      const abY = position.getY(sourceB) - position.getY(sourceA);
      const abZ = position.getZ(sourceB) - position.getZ(sourceA);
      const acX = position.getX(sourceC) - position.getX(sourceA);
      const acY = position.getY(sourceC) - position.getY(sourceA);
      const acZ = position.getZ(sourceC) - position.getZ(sourceA);
      const crossX = abY * acZ - abZ * acY;
      const crossY = abZ * acX - abX * acZ;
      const crossZ = abX * acY - abY * acX;
      const crossLengthSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
      if (!Number.isFinite(crossLengthSquared) || crossLengthSquared <= tolerance ** 4) {
        degenerateTriangles++;
        zeroAreaTriangles++;
        continue;
      }
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }

    let boundaryEdges = 0;
    let nonManifoldEdges = 0;
    let orientedEdgeMismatches = 0;
    for (const edge of edgeUse.values()) {
      if (edge.count === 1) boundaryEdges++;
      else if (edge.count > 2) nonManifoldEdges++;
      else if (edge.orientation !== 0) orientedEdgeMismatches++;
    }
    return {
      vertexCount: position.count,
      triangleCount,
      weldedVertexCount,
      edgeCount: edgeUse.size,
      boundaryEdges,
      nonManifoldEdges,
      degenerateTriangles,
      zeroAreaTriangles,
      orientedEdgeMismatches,
      invalidCoordinates,
      isClosed: boundaryEdges === 0
        && nonManifoldEdges === 0
        && degenerateTriangles === 0
        && orientedEdgeMismatches === 0
        && invalidCoordinates === 0
    };
  }

  function collectMeshTopology(object, tolerance) {
    const reports = [];
    const visit = (node) => {
      if (node?.isMesh && node.geometry?.isBufferGeometry) {
        const geometry = node.geometry;
        let report = null;
        if (geometry.userData?.neonV23ImmutableTopology) {
          let reportsByTolerance = immutableTopologyReports.get(geometry);
          if (!reportsByTolerance) {
            reportsByTolerance = new Map();
            immutableTopologyReports.set(geometry, reportsByTolerance);
          }
          report = reportsByTolerance.get(tolerance) || null;
          if (!report) {
            report = Object.freeze(analyzeTopology(geometry, { tolerance }));
            reportsByTolerance.set(tolerance, report);
          }
        } else {
          report = analyzeTopology(geometry, { tolerance });
        }
        reports.push({ name: node.name || '', ...report });
      }
    };
    if (typeof object.traverse === 'function') object.traverse(visit);
    else visit(object);
    return reports;
  }

  /** Marks a model as collision-independent main visual and optionally stores an immediate topology report. */
  function markMainVisual(object, {
    family = 'unspecified',
    zoneId = 'shared',
    analyzeTopology: shouldAnalyze = false,
    tolerance = 0.000_01,
    ...metadata
  } = {}) {
    if (!object) throw new Error('markMainVisual requires an Object3D or mesh');
    object.userData = object.userData || {};
    object.userData.neonV23 = {
      ...(object.userData.neonV23 || {}),
      modelClass: 'main-visual',
      family,
      zoneId,
      collisionIndependent: true,
      ...metadata
    };
    if (shouldAnalyze) {
      const reports = collectMeshTopology(object, tolerance);
      object.userData.topology = {
        reports,
        boundaryEdges: reports.reduce((sum, report) => sum + report.boundaryEdges, 0),
        nonManifoldEdges: reports.reduce((sum, report) => sum + report.nonManifoldEdges, 0),
        degenerateTriangles: reports.reduce((sum, report) => sum + report.degenerateTriangles, 0),
        zeroAreaTriangles: reports.reduce((sum, report) => sum + report.zeroAreaTriangles, 0),
        orientedEdgeMismatches: reports.reduce((sum, report) => sum + report.orientedEdgeMismatches, 0),
        invalidCoordinates: reports.reduce((sum, report) => sum + report.invalidCoordinates, 0),
        isClosed: reports.length > 0 && reports.every((report) => report.isClosed)
      };
    }
    return object;
  }

  /**
   * Explicitly tags a visual-only effect as exempt from the main-mesh primitive ban. A non-empty reason
   * is required so static/debug audits can distinguish deliberate particles and lights from regressions.
   */
  function markEffect(object, reason) {
    if (!object) throw new Error('markEffect requires an Object3D or mesh');
    if (typeof reason !== 'string' || reason.trim() === '') throw new Error('markEffect requires a non-empty exception reason');
    object.userData = object.userData || {};
    object.userData.neonV23 = {
      ...(object.userData.neonV23 || {}),
      modelClass: 'effect',
      primitiveException: true,
      collisionIndependent: true,
      reason: reason.trim()
    };
    return object;
  }

  return Object.freeze({
    DEFAULT_QUALITY_PROFILES,
    MATERIAL_KINDS,
    hashSeed,
    hashCoordinates,
    createRng,
    valueNoise2D,
    fractalNoise2D,
    createLoftGeometry,
    createLoft: createLoftGeometry,
    createExtrudedProfileGeometry,
    createExtrusion: createExtrudedProfileGeometry,
    createBeveledPrismGeometry,
    createTubeGeometry,
    createTube: createTubeGeometry,
    createRadialGeometry,
    createNoiseRockGeometry,
    createTerrainGeometry,
    createTerrain: createTerrainGeometry,
    createMaterial,
    resolveQualityProfile,
    resolveRendererPixelRatio,
    analyzeTopology,
    markMainVisual,
    markEffect,
    markEffectException: markEffect
  });
})();
