#!/usr/bin/env node
/** Production tunnel PBR receiver regression / 真实隧道 PBR 受光与画质回归。 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PREFIX = 'Neon_Autopilot_V23_HighSpeed_DroneHeat';
global.window = globalThis;
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
globalThis.THREE = THREE;
require(path.join(PROJECT_ROOT, `src/rendering/${PREFIX}.modeling.js`));
require(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.track.js`));
require(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.cloverleaf-tiles.js`));
require(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.cloverleaf.js`));

/** Stub only the sign atlas raster API; all meshes, materials, buffers, and shaders remain production objects. */
function installCanvasDocumentStub() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          return {
            beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
            fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, fillText() {}
          };
        }
      };
    }
  };
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

/** Construct the complete public visual, preserving production quality switching and resource disposal. */
function buildVisual(qualityProfileId, tunnelLightingUniforms = null) {
  const scene = new THREE.Scene();
  if (tunnelLightingUniforms) scene.userData.neonV23TunnelLightingUniforms = tunnelLightingUniforms;
  const job = globalThis.NeonV23CloverleafVisuals.createBuildJob({
    THREE,
    scene,
    track: globalThis.NeonV23Track,
    modeling: globalThis.NeonV23Modeling,
    qualityProfile: { id: qualityProfileId },
    renderQualityId: 'medium'
  });
  let steps = 0;
  while (!job.step(4)) assert.ok(++steps < 100_000, 'production build must finish');
  return job.finish();
}

/** Resolve exactly the installed vendor includes; this is source-contract validation, not GPU compilation. */
function expandShaderIncludes(source) {
  return source.replace(/#include <([\w\d_]+)>/g, (_, name) => {
    assert.equal(typeof THREE.ShaderChunk[name], 'string', `unknown GLSL chunk ${name}`);
    return expandShaderIncludes(THREE.ShaderChunk[name]);
  });
}

/** Invoke the actual production material extension on its matching pinned Three shader library. */
function prepareShader(material) {
  const library = material.isMeshPhysicalMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
  assert.ok(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial);
  const shader = {
    vertexShader: library.vertexShader,
    fragmentShader: library.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(library.uniforms)
  };
  material.onBeforeCompile(shader, null);
  return { ...shader, expandedFragment: expandShaderIncludes(shader.fragmentShader) };
}

/** Extract one original loop, including its shadow and direct-light invocation, for byte-for-byte comparison. */
function lightLoop(source, name) {
  const marker = `for ( int i = 0; i < NUM_${name}_LIGHTS; i ++ )`;
  const start = source.indexOf(marker);
  const end = source.indexOf('#pragma unroll_loop_end', start);
  assert.ok(start >= 0 && end > start, `${name} light loop must exist`);
  return source.slice(start, end);
}

/** Verify lighting energy enters before the real physical BRDF and AO, while direct local lights stay intact. */
function assertReceiverPipeline(shader) {
  const vertex = shader.vertexShader;
  const fragment = shader.fragmentShader;
  const expanded = shader.expandedFragment;
  for (const attribute of ['staticTunnelIrradiance', 'tunnelEnclosure']) {
    assert.equal((vertex.match(new RegExp(`attribute float ${attribute};`, 'g')) || []).length, 1);
  }
  assert.equal((fragment.match(/float neonV23TunnelOutdoorTransmission\(/g) || []).length, 1);
  assert.doesNotMatch(fragment, /totalEmissiveRadiance\s*\+=/);
  assert.equal(lightLoop(fragment, 'POINT'), lightLoop(THREE.ShaderChunk.lights_fragment_begin, 'POINT'));
  assert.equal(lightLoop(fragment, 'SPOT'), lightLoop(THREE.ShaderChunk.lights_fragment_begin, 'SPOT'));
  const directionalLoop = lightLoop(fragment, 'DIR');
  assert.match(directionalLoop, /getDirectionalLightInfo[\s\S]*?neonV23TunnelOutdoorTransmission\(0\.025, neonV23GlobalDirectionalTransmission\)[\s\S]*?getShadow[\s\S]*?RE_Direct/);
  assert.equal(
    directionalLoop.replace(/\n\s*directLight\.color \*= neonV23TunnelOutdoorTransmission\(0\.025, neonV23GlobalDirectionalTransmission\);/, ''),
    lightLoop(THREE.ShaderChunk.lights_fragment_begin, 'DIR'),
    'directional geometry, shadow filtering, and physical response must remain unchanged'
  );
  const main = expanded.slice(expanded.indexOf('void main()'));
  const staticAddition = main.indexOf('irradiance += PI * vec3(');
  const diffuseResponse = main.indexOf('RE_IndirectDiffuse( irradiance');
  const aoResponse = main.indexOf('reflectedLight.indirectDiffuse *= ambientOcclusion;');
  assert.ok(main.indexOf('material.diffuseColor = diffuseColor.rgb') < staticAddition);
  assert.ok(main.indexOf('iblIrradiance += getIBLIrradiance') < staticAddition);
  assert.ok(staticAddition > 0 && staticAddition < diffuseResponse && diffuseResponse < aoResponse);
  for (const variable of ['irradiance', 'iblIrradiance', 'radiance', 'clearcoatRadiance']) {
    const declaration = main.indexOf(`vec3 ${variable} =`);
    const attenuation = main.indexOf(`${variable} *= neonV23TunnelOutdoorTransmission(0.14, `);
    assert.ok(declaration >= 0 && attenuation > declaration, `${variable} must be defined before attenuation`);
  }
  assert.match(fragment, /#if defined\(RE_IndirectDiffuse\)[\s\S]*?irradiance \+= PI[\s\S]*?#endif/);
  assert.match(fragment, /#if defined\(RE_IndirectSpecular\)[\s\S]*?clearcoatRadiance \*=.*?\n#endif/);
  // The vendor declares clearcoatRadiance under RE_IndirectSpecular even when USE_CLEARCOAT is absent.
  assert.match(THREE.ShaderChunk.lights_fragment_begin,
    /#if defined\( RE_IndirectSpecular \)\s*vec3 radiance =[^;]+;\s*vec3 clearcoatRadiance =[^;]+;\s*#endif/);
}

/** Evaluate the inspected r160 diffuse equations on the CPU, using constants extracted from the produced shader. */
function createDiffuseProbe(shader) {
  assert.match(THREE.ShaderChunk.common,
    /vec3 BRDF_Lambert\([^]*?return RECIPROCAL_PI \* diffuseColor;/);
  assert.match(THREE.ShaderChunk.lights_physical_pars_fragment,
    /reflectedLight.indirectDiffuse \+= irradiance \* BRDF_Lambert\( material.diffuseColor \);/);
  assert.match(THREE.ShaderChunk.lights_physical_fragment,
    /material.diffuseColor = diffuseColor.rgb \* \( 1.0 - metalnessFactor \);/);
  const warmMatch = shader.fragmentShader.match(
    /irradiance \+= PI \* vec3\(([^)]+)\)\s*\* max\(vNeonV23StaticTunnelIrradiance, 0\.0\) \/ ([\d.]+);/
  );
  assert.ok(warmMatch);
  const warm = warmMatch[1].split(',').map(Number);
  const referenceReflectance = Number(warmMatch[2]);
  assert.deepEqual(warm, [1, 0.74, 0.42]);
  assert.equal(referenceReflectance, 0.18);
  const staticDiffuse = ({ albedo, scalar, metalness = 0, ao = 1 }) => albedo.map((channel, index) => (
    (Math.PI * warm[index] * scalar / referenceReflectance)
      * ((1 / Math.PI) * channel * (1 - metalness)) * ao
  ));
  const transmissionExpression = shader.fragmentShader.match(
    /float neonV23TunnelOutdoorTransmission\(float deepTransmission, float globalTransmission\)\s*\{\s*return ([^;]+);\s*\}/
  );
  assert.ok(transmissionExpression, 'the generated scalar transmission function must remain inspectable');
  const evaluateTransmission = new Function(
    'mix', 'clamp', 'min', 'max', 'vNeonV23TunnelEnclosure', 'deepTransmission', 'globalTransmission',
    `return ${transmissionExpression[1]};`
  );
  const transmission = (enclosure, deep, globalTransmission = 1) => evaluateTransmission(
    (from, to, amount) => from * (1 - amount) + to * amount,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    Math.min,
    Math.max,
    enclosure,
    deep,
    globalTransmission
  );
  return { staticDiffuse, transmission };
}

test('production tunnel receiver shaders preserve all render tiers, local-light shadows, material detail, and draw budgets', () => {
  const restoreDocument = installCanvasDocumentStub();
  try {
    for (const qualityProfileId of ['mobile', 'desktop']) {
      const tunnelLightingUniforms = {
        neonV23GlobalAmbientTransmission: { value: 1 },
        neonV23GlobalEnvironmentTransmission: { value: 1 },
        neonV23GlobalDirectionalTransmission: { value: 1 }
      };
      const visual = buildVisual(qualityProfileId, tunnelLightingUniforms);
      try {
        const receivers = [visual.roadShell, visual.tunnelShells, visual.beams];
        const geometryIdentities = receivers.map((receiver) => receiver.geometry);
        const geometryArrays = receivers.map((receiver) => receiver.geometry.getAttribute('position').array);
        const children = [...visual.group.children];
        assert.equal(children.length, 19, 'local enclosure must use existing batches');
        let lightCount = 0;
        visual.group.traverse((object) => { if (object.isLight) lightCount++; });
        assert.equal(lightCount, 0);
        for (const receiver of receivers) {
          const enclosure = receiver.geometry.getAttribute('tunnelEnclosure');
          assert.ok(enclosure);
          assert.equal(enclosure.itemSize, 1);
          assert.equal(enclosure.isInstancedBufferAttribute === true, receiver.isInstancedMesh === true);
          const count = receiver.isInstancedMesh ? receiver.count : enclosure.count;
          let exteriorCount = 0;
          let interiorCount = 0;
          for (let index = 0; index < count; index++) {
            const value = enclosure.getX(index);
            assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
            if (value === 0) exteriorCount++;
            if (value > 0.9) interiorCount++;
          }
          assert.ok(exteriorCount > 0 && interiorCount > 0, `${receiver.name} must distinguish inside from outside`);
        }
        const savedMaterials = new Map();
        let highNormalMap;
        let highRoughnessMap;
        for (const quality of ['low', 'medium', 'high', 'low', 'high', 'medium']) {
          visual.setRenderQuality(quality);
          assert.deepEqual(visual.group.children, children);
          receivers.forEach((receiver, index) => {
            assert.equal(receiver.geometry, geometryIdentities[index]);
            assert.equal(receiver.geometry.getAttribute('position').array, geometryArrays[index]);
            assert.equal(receiver.material.emissive.getHex(), 0);
            const shader = prepareShader(receiver.material);
            assertReceiverPipeline(shader);
            for (const [name, uniform] of Object.entries(tunnelLightingUniforms)) {
              assert.equal(shader.uniforms[name], uniform, 'Every resident receiver must share its scene rig values');
              const oldValue = uniform.value;
              uniform.value = 0.07;
              assert.equal(shader.uniforms[name].value, 0.07, 'A lighting update must not require shader recompilation');
              uniform.value = oldValue;
            }
          });
          const materials = receivers.map((receiver) => receiver.material);
          if (savedMaterials.has(quality)) assert.deepEqual(materials, savedMaterials.get(quality));
          else savedMaterials.set(quality, materials);
          if (quality === 'high') {
            const road = visual.roadShell.material;
            assert.ok(road.normalMap?.isDataTexture && road.roughnessMap?.isDataTexture);
            assert.deepEqual(road.normalScale.toArray(), [0.085, 0.085]);
            for (const texture of [road.normalMap, road.roughnessMap]) {
              assert.equal(texture.image.width, 64);
              assert.equal(texture.image.height, 64);
              assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
              assert.equal(texture.generateMipmaps, true);
            }
            if (highNormalMap) {
              assert.equal(road.normalMap, highNormalMap);
              assert.equal(road.roughnessMap, highRoughnessMap);
            }
            highNormalMap = road.normalMap;
            highRoughnessMap = road.roughnessMap;
            const roadShader = prepareShader(road);
            assert.match(roadShader.fragmentShader, /normal_fragment_maps/);
            assert.match(roadShader.fragmentShader, /roughnessmap_fragment/);
            assert.match(roadShader.fragmentShader, /neonV23RoadGrain/);
            assert.ok(roadShader.fragmentShader.indexOf('diffuseColor.rgb *= vec3(0.88)')
              < roadShader.fragmentShader.indexOf('irradiance += PI'));
          }
        }
      } finally {
        visual.dispose();
      }
    }
  } finally {
    restoreDocument();
  }
});

test('real tunnel shader diffuse response retains albedo contrast and AO while exterior illumination has identity transmission', () => {
  const restoreDocument = installCanvasDocumentStub();
  let visual;
  try {
    visual = buildVisual('mobile');
    for (const quality of ['low', 'medium', 'high']) {
      visual.setRenderQuality(quality);
      for (const receiver of [visual.roadShell, visual.tunnelShells, visual.beams]) {
        const { staticDiffuse, transmission } = createDiffuseProbe(prepareShader(receiver.material));
        const scalar = 0.24;
        const white = staticDiffuse({ albedo: [1, 1, 1], scalar });
        const dark = staticDiffuse({ albedo: [0.18, 0.18, 0.18], scalar });
        const worn = staticDiffuse({ albedo: [0.18 * 0.95, 0.18 * 0.95, 0.18 * 0.95], scalar });
        const occluded = staticDiffuse({ albedo: [1, 1, 1], scalar, ao: 0.35 });
        assert.deepEqual(staticDiffuse({ albedo: [0, 0, 0], scalar }), [0, 0, 0],
          'black material must not receive an albedo-independent glowing overlay');
        for (let channel = 0; channel < 3; channel++) {
          assert.ok(Math.abs(dark[channel] - scalar * [1, 0.74, 0.42][channel]) < 0.000_001,
            'Reference gray must retain the authored baseline brightness between fixtures');
          assert.ok(Math.abs(dark[channel] / white[channel] - 0.18) < 0.000_001);
          assert.ok(Math.abs(worn[channel] / dark[channel] - 0.95) < 0.000_001);
          assert.ok(Math.abs(occluded[channel] / white[channel] - 0.35) < 0.000_001);
        }
        for (const deep of [0.025, 0.14]) {
          for (const globalTransmission of [1, 0.5, deep, deep * 0.5]) {
            assert.equal(transmission(0, deep, globalTransmission), 1);
            assert.ok(Math.abs(globalTransmission * transmission(1, deep, globalTransmission)
              - Math.min(globalTransmission, deep)) < 0.000_001,
            'Local enclosure must neither double-attenuate existing indoor light nor brighten outdoor surfaces');
          }
          assert.equal(transmission(0, deep), 1);
          assert.ok(Math.abs(transmission(1, deep) - deep) < 0.000_001);
          let previous = 1;
          for (let step = 0; step <= 100; step++) {
            const value = transmission(step / 100, deep);
            assert.ok(value <= previous && value >= deep - 0.000_001);
            previous = value;
          }
        }
      }
    }
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});
