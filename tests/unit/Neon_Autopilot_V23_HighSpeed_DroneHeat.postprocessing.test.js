#!/usr/bin/env node
/** High-only post-processing lifecycle and isolation regression contract / High 专用后处理生命周期与隔离回归合同。 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
const postProcessing = require(path.join(
  PROJECT_ROOT,
  'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.postprocessing.js'
));

function createRenderer({ width = 800, height = 600, maximumSamples = 4, halfFloat = true } = {}) {
  const renderer = {
    capabilities: { maxSamples: maximumSamples, isWebGL2: maximumSamples > 0 },
    extensions: { has: () => halfFloat },
    shadowMap: { autoUpdate: true },
    autoClear: false,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.84,
    currentTarget: null,
    clearColor: new THREE.Color(0x234567),
    clearAlpha: 1,
    viewport: new THREE.Vector4(0, 0, width, height),
    scissor: new THREE.Vector4(0, 0, width, height),
    scissorTest: false,
    clearCount: 0,
    renderLog: [],
    getPixelRatio: () => 2,
    getDrawingBufferSize(target) {
      return target.set(width, height);
    },
    getRenderTarget() {
      return this.currentTarget;
    },
    setRenderTarget(target) {
      this.currentTarget = target;
    },
    getClearColor(target) {
      return target.copy(this.clearColor);
    },
    getClearAlpha() {
      return this.clearAlpha;
    },
    setClearColor(color, alpha = 1) {
      this.clearColor.set(color);
      this.clearAlpha = alpha;
    },
    getViewport(target) {
      return target.copy(this.viewport);
    },
    setViewport(value, y, viewportWidth, viewportHeight) {
      if (value?.isVector4) this.viewport.copy(value);
      else this.viewport.set(value, y, viewportWidth, viewportHeight);
    },
    getScissor(target) {
      return target.copy(this.scissor);
    },
    setScissor(value, y, scissorWidth, scissorHeight) {
      if (value?.isVector4) this.scissor.copy(value);
      else this.scissor.set(value, y, scissorWidth, scissorHeight);
    },
    getScissorTest() {
      return this.scissorTest;
    },
    setScissorTest(enabled) {
      this.scissorTest = Boolean(enabled);
    },
    clear() {
      this.clearCount++;
    },
    render(renderedScene, renderedCamera) {
      this.renderLog.push({
        scene: renderedScene,
        camera: renderedCamera,
        cameraLayerMask: renderedCamera.layers.mask,
        autoClear: this.autoClear,
        shadowAutoUpdate: this.shadowMap.autoUpdate,
        toneMapping: this.toneMapping,
        target: this.currentTarget
      });
    }
  };
  return renderer;
}

test('contract freezes High-only AA, AO, explicit Bloom, grading, and prohibited-effect boundaries', () => {
  const contract = postProcessing.POST_PROCESSING_CONTRACT;
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.ambientOcclusion), true);
  assert.equal(contract.qualityProfile, 'high');
  assert.equal(contract.visualOnly, true);
  assert.equal(contract.requiresExplicitEnable, true);
  assert.equal(contract.antiAliasing.requestedSamples, 4);
  assert.equal(contract.antiAliasing.fallback, 'fxaa');
  assert.equal(contract.ambientOcclusion.mode, 'depth-gtao-style');
  assert.equal(contract.ambientOcclusion.bilateralPassCount, 2);
  assert.equal(contract.bloom.selection, 'explicit-object-layer');
  assert.equal(contract.bloom.layer, postProcessing.BLOOM_LAYER);
  assert.equal(contract.grading.acesPassCount, 1);
  assert.deepEqual(contract.prohibitedEffects, ['depth-of-field', 'full-screen-blur']);
  assert.equal(contract.lifecycle.releaseTargetsWhenDisabled, true);
  assert.equal(contract.lifecycle.directRenderOwnedByRuntime, true);
});

test('Bloom tagging changes only the isolated presentation layer and remains reversible', () => {
  const glow = new THREE.Object3D();
  const defaultMask = glow.layers.mask;
  assert.equal(glow.layers.isEnabled(postProcessing.BLOOM_LAYER), false);

  assert.equal(postProcessing.tagBloom(glow), glow);
  assert.equal(glow.layers.isEnabled(0), true, 'normal scene visibility must remain enabled');
  assert.equal(glow.layers.isEnabled(postProcessing.BLOOM_LAYER), true);
  assert.equal(glow.userData.v23Bloom, true);

  postProcessing.tagBloom(glow, false);
  assert.equal(glow.layers.mask, defaultMask);
  assert.equal(glow.userData.v23Bloom, false);
  assert.throws(() => postProcessing.tagBloom({}), /requires a Three\.js Object3D/);
});

test('enabling allocates seven targets and disabling releases every High-only target', () => {
  const renderer = createRenderer({ maximumSamples: 0, halfFloat: false });
  const pipeline = postProcessing.create({
    THREE,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1_000)
  });

  let diagnostics = pipeline.getDiagnostics();
  assert.equal(diagnostics.enabled, false);
  assert.equal(diagnostics.targetCount, 0);
  assert.equal(diagnostics.effectiveSamples, 0);
  assert.equal(diagnostics.usesFxaa, true);
  assert.equal(diagnostics.sampleFallback, 'fxaa-no-multisample-support');
  assert.equal(diagnostics.hdrTargetType, 'unsigned-byte');
  assert.deepEqual(pipeline.setSize(400, 300, 2), { width: 800, height: 600 });

  assert.equal(pipeline.setEnabled(true), true);
  diagnostics = pipeline.getDiagnostics();
  assert.equal(diagnostics.targetCount, 7);
  assert.equal(diagnostics.allocationGeneration, 1);
  assert.equal(diagnostics.ambientOcclusion, true);
  assert.equal(diagnostics.bloom, true);

  assert.equal(pipeline.setEnabled(false), true);
  diagnostics = pipeline.getDiagnostics();
  assert.equal(diagnostics.targetCount, 0);
  assert.equal(diagnostics.targetDisposalCount, 7);
  assert.equal(pipeline.setEnabled(false), false);
  assert.equal(pipeline.dispose(), true);
  assert.equal(pipeline.dispose(), false);
  assert.throws(() => pipeline.setEnabled(true), /disposed post-processing pipeline/);
});

test('MSAA safely caps to device limits and suppresses FXAA whenever multisampling is available', () => {
  const renderer = createRenderer({ maximumSamples: 2 });
  const pipeline = postProcessing.create({
    THREE,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera()
  });
  const diagnostics = pipeline.getDiagnostics();
  assert.equal(diagnostics.requestedSamples, 4);
  assert.equal(diagnostics.maximumSamples, 2);
  assert.equal(diagnostics.effectiveSamples, 2);
  assert.equal(diagnostics.usesFxaa, false);
  assert.equal(diagnostics.sampleFallback, 'msaa-capped-to-2');
  pipeline.dispose();
});

test('composite compiles exactly one immutable anti-aliasing resolve for each device capability', () => {
  function compositeShader(maximumSamples) {
    const renderer = createRenderer({ maximumSamples });
    const pipeline = postProcessing.create({
      THREE,
      renderer,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera()
    });
    pipeline.setEnabled(true);
    pipeline.render();
    const shader = renderer.renderLog.at(-1).scene.children[0].material.fragmentShader;
    pipeline.dispose();
    return shader;
  }

  const msaaShader = compositeShader(4);
  assert.match(msaaShader, /vec3 linearScene = sceneSample\(vUv\);/);
  assert.doesNotMatch(msaaShader, /linearScene = mix|uUseFxaa/);
  const fxaaShader = compositeShader(0);
  assert.match(fxaaShader, /vec3 linearScene = fxaa\(vUv\);/);
  assert.doesNotMatch(fxaaShader, /linearScene = mix|uUseFxaa/);
});

test('one frame isolates Bloom, keeps ACES single-pass, and restores all renderer and scene state', () => {
  const renderer = createRenderer();
  const scene = new THREE.Scene();
  const background = new THREE.Color(0x456789);
  scene.background = background;
  const camera = new THREE.PerspectiveCamera(58, 4 / 3, 0.2, 1_200);
  const originalLayerMask = camera.layers.mask;
  const originalClearColor = renderer.clearColor.clone();
  const pipeline = postProcessing.create({ THREE, renderer, scene, camera });
  pipeline.setEnabled(true);

  assert.equal(pipeline.render(), true);
  const gameScenePasses = renderer.renderLog.filter((entry) => entry.scene === scene);
  assert.equal(renderer.renderLog.length, 8, 'scene, AO, bilateral x2, Bloom, blur x2, and composite');
  assert.equal(gameScenePasses.length, 2, 'one normal scene pass and one explicit Bloom-layer pass');
  assert.equal(gameScenePasses[0].cameraLayerMask, originalLayerMask);
  assert.equal(gameScenePasses[1].cameraLayerMask, 1 << postProcessing.BLOOM_LAYER);
  assert.deepEqual(
    renderer.renderLog.map((entry) => entry.autoClear),
    [true, false, false, false, true, false, false, true],
    'private fullscreen targets skip only redundant clears'
  );
  assert.deepEqual(
    gameScenePasses.map((entry) => entry.shadowAutoUpdate),
    [true, false],
    'the main scene updates shadows once while the Bloom scene reuses them'
  );
  assert.equal(renderer.clearCount, 0, 'the Bloom scene relies on its one automatic clear');
  assert.ok(renderer.renderLog.every((entry) => entry.toneMapping === THREE.NoToneMapping));

  assert.equal(scene.background, background);
  assert.equal(camera.layers.mask, originalLayerMask);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.autoClear, false);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.currentTarget, null);
  assert.equal(renderer.clearColor.getHex(), originalClearColor.getHex());
  assert.equal(pipeline.getDiagnostics().frameCount, 1);
  assert.equal(pipeline.getDiagnostics().acesPassCount, 1);
  assert.equal(pipeline.getDiagnostics().duplicateAcesPrevented, true);
  assert.equal(pipeline.getDiagnostics().depthOfField, false);
  assert.equal(pipeline.getDiagnostics().fullScreenBlur, false);
  pipeline.dispose();
});
