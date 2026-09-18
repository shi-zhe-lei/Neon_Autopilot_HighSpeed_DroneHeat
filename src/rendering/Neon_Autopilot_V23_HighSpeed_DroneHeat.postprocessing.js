/*
 * V23 High-only post-processing pipeline.
 * The module owns presentation buffers only: gameplay, global lighting state, and direct Low/Medium rendering stay external.
 */
'use strict';

const NeonV23PostProcessingModule = (() => {
  const BLOOM_LAYER = 12;

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  }

  const POST_PROCESSING_CONTRACT = deepFreeze({
    version: 1,
    qualityProfile: 'high',
    visualOnly: true,
    requiresExplicitEnable: true,
    antiAliasing: {
      requestedSamples: 4,
      fallback: 'fxaa',
      fallbackOnlyWithoutMsaa: true
    },
    ambientOcclusion: {
      mode: 'depth-gtao-style',
      resolutionScale: 0.5,
      bilateralPassCount: 2,
      sampleDirectionCount: 8,
      radiusM: 2.4,
      strength: 0.62
    },
    bloom: {
      selection: 'explicit-object-layer',
      layer: BLOOM_LAYER,
      resolutionScale: 0.5,
      blurPassCount: 2,
      strength: 0.12
    },
    grading: {
      toneMapping: 'single-aces-filmic-pass',
      acesPassCount: 1,
      contrast: 1.035,
      saturation: 1.055,
      vignetteStrength: 0.055
    },
    prohibitedEffects: Object.freeze(['depth-of-field', 'full-screen-blur']),
    lifecycle: {
      directRenderOwnedByRuntime: true,
      releaseTargetsWhenDisabled: true,
      atomicResize: true
    }
  });

  const FULLSCREEN_VERTEX_SHADER = /* glsl */`
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const AO_FRAGMENT_SHADER = /* glsl */`
    precision highp float;
    uniform sampler2D tDepth;
    uniform vec2 uInvFullResolution;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uPerspective;
    uniform float uProjectionScale;
    uniform float uRadiusM;
    varying vec2 vUv;

    float viewDepth(float depth) {
      float perspectiveDepth = (uCameraNear * uCameraFar)
        / max(uCameraFar - depth * (uCameraFar - uCameraNear), 0.000001);
      float orthographicDepth = mix(uCameraNear, uCameraFar, depth);
      return mix(orthographicDepth, perspectiveDepth, uPerspective);
    }

    vec2 directionForIndex(int index) {
      if (index == 0) return vec2(1.0, 0.0);
      if (index == 1) return vec2(0.70710678, 0.70710678);
      if (index == 2) return vec2(0.0, 1.0);
      if (index == 3) return vec2(-0.70710678, 0.70710678);
      if (index == 4) return vec2(-1.0, 0.0);
      if (index == 5) return vec2(-0.70710678, -0.70710678);
      if (index == 6) return vec2(0.0, -1.0);
      return vec2(0.70710678, -0.70710678);
    }

    void main() {
      float rawCenterDepth = texture2D(tDepth, vUv).x;
      if (rawCenterDepth >= 0.999999) {
        gl_FragColor = vec4(1.0);
        return;
      }

      float centerDepth = viewDepth(rawCenterDepth);
      float projectedRadiusPx = clamp(uRadiusM * uProjectionScale / max(centerDepth, 0.05), 2.0, 36.0);
      float depthBias = max(0.018, centerDepth * 0.00045);
      float occlusion = 0.0;
      float weightTotal = 0.0;

      // Two horizon probes per direction retain bridge joints and contact pockets without a full-resolution AO budget.
      for (int directionIndex = 0; directionIndex < 8; directionIndex++) {
        vec2 direction = directionForIndex(directionIndex);
        for (int ringIndex = 1; ringIndex <= 2; ringIndex++) {
          float ring = float(ringIndex) * 0.5;
          vec2 sampleUv = clamp(
            vUv + direction * projectedRadiusPx * ring * uInvFullResolution,
            uInvFullResolution,
            vec2(1.0) - uInvFullResolution
          );
          float rawSampleDepth = texture2D(tDepth, sampleUv).x;
          float sampleDepth = viewDepth(rawSampleDepth);
          float delta = centerDepth - sampleDepth;
          float rangeWeight = 1.0 - smoothstep(uRadiusM * 0.15, uRadiusM, abs(delta));
          float horizonWeight = smoothstep(depthBias, depthBias + uRadiusM * 0.12, delta);
          float sampleWeight = mix(1.0, 0.72, ring);
          occlusion += horizonWeight * rangeWeight * sampleWeight;
          weightTotal += sampleWeight;
        }
      }

      float normalizedOcclusion = occlusion / max(weightTotal, 0.000001);
      float ao = clamp(1.0 - normalizedOcclusion * 0.82, 0.2, 1.0);
      gl_FragColor = vec4(vec3(ao), 1.0);
    }
  `;

  const BILATERAL_FRAGMENT_SHADER = /* glsl */`
    precision highp float;
    uniform sampler2D tAo;
    uniform sampler2D tDepth;
    uniform vec2 uDirection;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uPerspective;
    varying vec2 vUv;

    float viewDepth(float depth) {
      float perspectiveDepth = (uCameraNear * uCameraFar)
        / max(uCameraFar - depth * (uCameraFar - uCameraNear), 0.000001);
      float orthographicDepth = mix(uCameraNear, uCameraFar, depth);
      return mix(orthographicDepth, perspectiveDepth, uPerspective);
    }

    void main() {
      float centerDepth = viewDepth(texture2D(tDepth, vUv).x);
      float result = texture2D(tAo, vUv).x * 0.22702703;
      float weightTotal = 0.22702703;

      for (int index = 1; index <= 4; index++) {
        float distancePx = float(index);
        float spatialWeight = exp(-0.5 * distancePx * distancePx / 3.2);
        vec2 offsetUv = uDirection * distancePx;
        for (int signIndex = 0; signIndex < 2; signIndex++) {
          float signValue = signIndex == 0 ? -1.0 : 1.0;
          vec2 sampleUv = clamp(vUv + offsetUv * signValue, vec2(0.0), vec2(1.0));
          float sampleDepth = viewDepth(texture2D(tDepth, sampleUv).x);
          float relativeDifference = abs(centerDepth - sampleDepth) / max(centerDepth, 1.0);
          float depthWeight = exp(-relativeDifference * 180.0);
          float weight = spatialWeight * depthWeight;
          result += texture2D(tAo, sampleUv).x * weight;
          weightTotal += weight;
        }
      }

      float filtered = result / max(weightTotal, 0.000001);
      gl_FragColor = vec4(vec3(filtered), 1.0);
    }
  `;

  const BLOOM_BLUR_FRAGMENT_SHADER = /* glsl */`
    precision highp float;
    uniform sampler2D tInput;
    uniform vec2 uDirection;
    varying vec2 vUv;

    void main() {
      vec3 color = texture2D(tInput, vUv).rgb * 0.22702703;
      color += texture2D(tInput, vUv + uDirection * 1.38461538).rgb * 0.31621622;
      color += texture2D(tInput, vUv - uDirection * 1.38461538).rgb * 0.31621622;
      color += texture2D(tInput, vUv + uDirection * 3.23076923).rgb * 0.07027027;
      color += texture2D(tInput, vUv - uDirection * 3.23076923).rgb * 0.07027027;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const COMPOSITE_FRAGMENT_SHADER = /* glsl */`
    precision highp float;
    uniform sampler2D tScene;
    uniform sampler2D tAo;
    uniform sampler2D tBloom;
    uniform vec2 uInvFullResolution;
    uniform float uUseFxaa;
    uniform float uExposure;
    uniform float uAoStrength;
    uniform float uBloomStrength;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVignetteStrength;
    varying vec2 vUv;

    vec3 sceneSample(vec2 uv) {
      return texture2D(tScene, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
    }

    vec3 fxaa(vec2 uv) {
      vec3 rgbNorthWest = sceneSample(uv + vec2(-1.0, -1.0) * uInvFullResolution);
      vec3 rgbNorthEast = sceneSample(uv + vec2(1.0, -1.0) * uInvFullResolution);
      vec3 rgbSouthWest = sceneSample(uv + vec2(-1.0, 1.0) * uInvFullResolution);
      vec3 rgbSouthEast = sceneSample(uv + vec2(1.0, 1.0) * uInvFullResolution);
      vec3 rgbMiddle = sceneSample(uv);
      vec3 luma = vec3(0.299, 0.587, 0.114);
      float lumaNorthWest = dot(rgbNorthWest, luma);
      float lumaNorthEast = dot(rgbNorthEast, luma);
      float lumaSouthWest = dot(rgbSouthWest, luma);
      float lumaSouthEast = dot(rgbSouthEast, luma);
      float lumaMiddle = dot(rgbMiddle, luma);
      float lumaMinimum = min(lumaMiddle, min(min(lumaNorthWest, lumaNorthEast), min(lumaSouthWest, lumaSouthEast)));
      float lumaMaximum = max(lumaMiddle, max(max(lumaNorthWest, lumaNorthEast), max(lumaSouthWest, lumaSouthEast)));
      vec2 direction = vec2(
        -((lumaNorthWest + lumaNorthEast) - (lumaSouthWest + lumaSouthEast)),
        (lumaNorthWest + lumaSouthWest) - (lumaNorthEast + lumaSouthEast)
      );
      float reduction = max(
        (lumaNorthWest + lumaNorthEast + lumaSouthWest + lumaSouthEast) * 0.03125,
        0.0078125
      );
      float inverseMinimumDirection = 1.0 / (min(abs(direction.x), abs(direction.y)) + reduction);
      direction = clamp(direction * inverseMinimumDirection, vec2(-8.0), vec2(8.0)) * uInvFullResolution;
      vec3 resultA = 0.5 * (
        sceneSample(uv + direction * (1.0 / 3.0 - 0.5))
        + sceneSample(uv + direction * (2.0 / 3.0 - 0.5))
      );
      vec3 resultB = resultA * 0.5 + 0.25 * (
        sceneSample(uv + direction * -0.5)
        + sceneSample(uv + direction * 0.5)
      );
      float lumaResultB = dot(resultB, luma);
      return lumaResultB < lumaMinimum || lumaResultB > lumaMaximum ? resultA : resultB;
    }

    vec3 acesFilmic(vec3 color) {
      // This is the pipeline's sole display transform; renderer tone mapping is disabled for every offscreen pass.
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
    }

    void main() {
      vec3 linearScene = mix(sceneSample(vUv), fxaa(vUv), uUseFxaa);
      float ao = texture2D(tAo, vUv).x;
      linearScene *= mix(1.0, ao, uAoStrength);
      linearScene += texture2D(tBloom, vUv).rgb * uBloomStrength;

      vec3 color = acesFilmic(linearScene * uExposure);
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;
      color *= vec3(1.012, 1.0, 0.988);

      vec2 vignetteUv = vUv * (1.0 - vUv);
      float vignette = pow(clamp(16.0 * vignetteUv.x * vignetteUv.y, 0.0, 1.0), 0.18);
      color *= mix(1.0, vignette, uVignetteStrength);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      #include <colorspace_fragment>
    }
  `;

  /**
   * Select the immutable anti-aliasing resolve at material creation. With MSAA active the former uniform mix
   * multiplied the unused FXAA branch by zero after sampling it, so removing that branch preserves every finite
   * output value while avoiding nine full-resolution scene reads per pixel.
   */
  function createCompositeFragmentShader(usesFxaa) {
    const uniformDeclaration = '    uniform float uUseFxaa;\n';
    const dynamicResolve = '      vec3 linearScene = mix(sceneSample(vUv), fxaa(vUv), uUseFxaa);';
    const fixedResolve = `      vec3 linearScene = ${usesFxaa ? 'fxaa(vUv)' : 'sceneSample(vUv)'};`;
    if (!COMPOSITE_FRAGMENT_SHADER.includes(uniformDeclaration)
      || !COMPOSITE_FRAGMENT_SHADER.includes(dynamicResolve)) {
      throw new Error('V23 composite anti-aliasing resolve marker is missing.');
    }
    return COMPOSITE_FRAGMENT_SHADER
      .replace(uniformDeclaration, '')
      .replace(dynamicResolve, fixedResolve);
  }

  function finitePositive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  /** Opt one presentation object into the isolated Bloom render without changing its normal visibility layer. */
  function tagBloom(object, enabled = true) {
    if (!object?.layers || typeof object.layers.enable !== 'function' || typeof object.layers.disable !== 'function') {
      throw new TypeError('Bloom tagging requires a Three.js Object3D with layer controls.');
    }
    if (enabled) object.layers.enable(BLOOM_LAYER);
    else object.layers.disable(BLOOM_LAYER);
    object.userData = object.userData || {};
    object.userData.v23Bloom = Boolean(enabled);
    return object;
  }

  /**
   * Create one High-only pipeline; construction is allocation-free until explicitly enabled.
   * `auditLegacyPipeline` exists only so the browser regression can compare the former redundant work byte-for-byte.
   */
  function create({ THREE, renderer, scene, camera, auditLegacyPipeline = false } = {}) {
    if (!THREE || !renderer || !scene || !camera) {
      throw new TypeError('Post-processing requires THREE, renderer, scene, and camera.');
    }

    const requestedSamples = POST_PROCESSING_CONTRACT.antiAliasing.requestedSamples;
    const maximumSamples = Math.max(0, Math.floor(Number(renderer.capabilities?.maxSamples) || 0));
    const effectiveSamples = maximumSamples >= 2 ? Math.min(requestedSamples, maximumSamples) : 0;
    const usesFxaa = effectiveSamples === 0;
    const usesLegacyAuditPath = auditLegacyPipeline === true;
    const sampleFallback = effectiveSamples === requestedSamples
      ? null
      : effectiveSamples > 0
        ? `msaa-capped-to-${effectiveSamples}`
        : 'fxaa-no-multisample-support';
    const supportsHalfFloat = Boolean(
      THREE.HalfFloatType
      && (
        renderer.extensions?.has?.('EXT_color_buffer_float')
        || renderer.extensions?.has?.('EXT_color_buffer_half_float')
      )
    );
    const hdrType = supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const targetColorSpace = THREE.LinearSRGBColorSpace || THREE.NoColorSpace;
    const fullscreenGeometry = new THREE.BufferGeometry();
    fullscreenGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0,
      3, -1, 0,
      -1, 3, 0
    ], 3));
    fullscreenGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      2, 0,
      0, 2
    ], 2));

    function passMaterial(fragmentShader, uniforms) {
      return new THREE.ShaderMaterial({
        uniforms,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false
      });
    }

    const aoMaterial = passMaterial(AO_FRAGMENT_SHADER, {
      tDepth: { value: null },
      uInvFullResolution: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 1_000 },
      uPerspective: { value: 1 },
      uProjectionScale: { value: 1 },
      uRadiusM: { value: POST_PROCESSING_CONTRACT.ambientOcclusion.radiusM }
    });
    const bilateralMaterial = passMaterial(BILATERAL_FRAGMENT_SHADER, {
      tAo: { value: null },
      tDepth: { value: null },
      uDirection: { value: new THREE.Vector2() },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 1_000 },
      uPerspective: { value: 1 }
    });
    const bloomBlurMaterial = passMaterial(BLOOM_BLUR_FRAGMENT_SHADER, {
      tInput: { value: null },
      uDirection: { value: new THREE.Vector2() }
    });
    const compositeUniforms = {
      tScene: { value: null },
      tAo: { value: null },
      tBloom: { value: null },
      uInvFullResolution: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1 },
      uAoStrength: { value: POST_PROCESSING_CONTRACT.ambientOcclusion.strength },
      uBloomStrength: { value: POST_PROCESSING_CONTRACT.bloom.strength },
      uContrast: { value: POST_PROCESSING_CONTRACT.grading.contrast },
      uSaturation: { value: POST_PROCESSING_CONTRACT.grading.saturation },
      uVignetteStrength: { value: POST_PROCESSING_CONTRACT.grading.vignetteStrength }
    };
    if (usesLegacyAuditPath) compositeUniforms.uUseFxaa = { value: usesFxaa ? 1 : 0 };
    const compositeMaterial = passMaterial(
      usesLegacyAuditPath ? COMPOSITE_FRAGMENT_SHADER : createCompositeFragmentShader(usesFxaa),
      compositeUniforms
    );
    const fullscreenQuad = new THREE.Mesh(fullscreenGeometry, aoMaterial);
    fullscreenQuad.frustumCulled = false;
    const fullscreenScene = new THREE.Scene();
    const fullscreenCamera = new THREE.Camera();
    fullscreenScene.add(fullscreenQuad);

    const drawingBufferSize = new THREE.Vector2(1, 1);
    const savedClearColor = new THREE.Color();
    const savedViewport = new THREE.Vector4();
    const savedScissor = new THREE.Vector4();
    let targets = null;
    let enabled = false;
    let disposed = false;
    let width = 1;
    let height = 1;
    let requestedCssWidth = 1;
    let requestedCssHeight = 1;
    let requestedPixelRatio = 1;
    let allocationGeneration = 0;
    let targetDisposalCount = 0;
    let frameCount = 0;

    function configureTexture(texture, name) {
      texture.name = name;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if ('colorSpace' in texture) texture.colorSpace = targetColorSpace;
    }

    function createColorTarget(targetWidth, targetHeight, name, type = THREE.UnsignedByteType) {
      const target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type,
        depthBuffer: false,
        stencilBuffer: false
      });
      configureTexture(target.texture, name);
      return target;
    }

    function createTargetSet(targetWidth, targetHeight) {
      const halfWidth = Math.max(1, Math.ceil(targetWidth * POST_PROCESSING_CONTRACT.ambientOcclusion.resolutionScale));
      const halfHeight = Math.max(1, Math.ceil(targetHeight * POST_PROCESSING_CONTRACT.ambientOcclusion.resolutionScale));
      const allocated = [];
      try {
        const sceneTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: hdrType,
          depthBuffer: true,
          stencilBuffer: false
        });
        configureTexture(sceneTarget.texture, 'V23 High linear scene');
        sceneTarget.samples = effectiveSamples;
        sceneTarget.depthTexture = new THREE.DepthTexture(
          targetWidth,
          targetHeight,
          renderer.capabilities?.isWebGL2 ? THREE.UnsignedIntType : THREE.UnsignedShortType
        );
        sceneTarget.depthTexture.name = 'V23 High scene depth';
        sceneTarget.depthTexture.format = THREE.DepthFormat;
        sceneTarget.depthTexture.minFilter = THREE.NearestFilter;
        sceneTarget.depthTexture.magFilter = THREE.NearestFilter;
        allocated.push(sceneTarget);

        const aoRawTarget = createColorTarget(halfWidth, halfHeight, 'V23 High AO raw');
        const aoPingTarget = createColorTarget(halfWidth, halfHeight, 'V23 High AO bilateral horizontal');
        const aoFinalTarget = createColorTarget(halfWidth, halfHeight, 'V23 High AO bilateral vertical');
        const bloomRawTarget = createColorTarget(halfWidth, halfHeight, 'V23 High Bloom selection', hdrType);
        const bloomPingTarget = createColorTarget(halfWidth, halfHeight, 'V23 High Bloom horizontal', hdrType);
        const bloomFinalTarget = createColorTarget(halfWidth, halfHeight, 'V23 High Bloom vertical', hdrType);
        allocated.push(
          aoRawTarget,
          aoPingTarget,
          aoFinalTarget,
          bloomRawTarget,
          bloomPingTarget,
          bloomFinalTarget
        );
        return {
          all: allocated,
          scene: sceneTarget,
          aoRaw: aoRawTarget,
          aoPing: aoPingTarget,
          aoFinal: aoFinalTarget,
          bloomRaw: bloomRawTarget,
          bloomPing: bloomPingTarget,
          bloomFinal: bloomFinalTarget,
          halfWidth,
          halfHeight
        };
      } catch (error) {
        for (const target of allocated) target.dispose();
        throw error;
      }
    }

    function disposeTargets(targetSet = targets) {
      if (!targetSet) return false;
      for (const target of targetSet.all) target.dispose();
      if (targetSet === targets) targets = null;
      targetDisposalCount += targetSet.all.length;
      return true;
    }

    function allocateTargets(targetWidth, targetHeight) {
      const nextTargets = createTargetSet(targetWidth, targetHeight);
      const previousTargets = targets;
      targets = nextTargets;
      width = targetWidth;
      height = targetHeight;
      allocationGeneration += 1;
      if (previousTargets) disposeTargets(previousTargets);
    }

    function updateRequestedSize(cssWidth, cssHeight, pixelRatio) {
      requestedCssWidth = finitePositive(cssWidth, requestedCssWidth);
      requestedCssHeight = finitePositive(cssHeight, requestedCssHeight);
      requestedPixelRatio = finitePositive(
        pixelRatio,
        typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : requestedPixelRatio
      );
      return {
        width: Math.max(1, Math.floor(requestedCssWidth * requestedPixelRatio)),
        height: Math.max(1, Math.floor(requestedCssHeight * requestedPixelRatio))
      };
    }

    function syncDrawingBufferSize() {
      if (typeof renderer.getDrawingBufferSize !== 'function') return;
      renderer.getDrawingBufferSize(drawingBufferSize);
      const nextWidth = Math.max(1, Math.floor(finitePositive(drawingBufferSize.x, width)));
      const nextHeight = Math.max(1, Math.floor(finitePositive(drawingBufferSize.y, height)));
      if (!targets || nextWidth !== width || nextHeight !== height) allocateTargets(nextWidth, nextHeight);
    }

    function setSize(cssWidth, cssHeight, pixelRatio) {
      if (disposed) throw new Error('Cannot resize a disposed post-processing pipeline.');
      const requested = updateRequestedSize(cssWidth, cssHeight, pixelRatio);
      if (enabled && (!targets || requested.width !== width || requested.height !== height)) {
        allocateTargets(requested.width, requested.height);
      }
      return Object.freeze({ width: requested.width, height: requested.height });
    }

    function setEnabled(nextEnabled) {
      if (disposed) throw new Error('Cannot enable a disposed post-processing pipeline.');
      const next = Boolean(nextEnabled);
      if (next === enabled) return false;
      if (next) {
        enabled = true;
        try {
          syncDrawingBufferSize();
          if (!targets) {
            const requested = updateRequestedSize(requestedCssWidth, requestedCssHeight, requestedPixelRatio);
            allocateTargets(requested.width, requested.height);
          }
        } catch (error) {
          enabled = false;
          disposeTargets();
          throw error;
        }
      } else {
        enabled = false;
        disposeTargets();
      }
      return true;
    }

    /** Intermediate targets are completely overwritten by an opaque oversized triangle, so clearing them is a no-op. */
    function renderFullscreen(material, target, clearTarget = false) {
      fullscreenQuad.material = material;
      renderer.autoClear = usesLegacyAuditPath || clearTarget;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.render(fullscreenScene, fullscreenCamera);
    }

    function updateCameraUniforms() {
      const cameraNear = finitePositive(camera.near, 0.1);
      const cameraFar = Math.max(cameraNear + 0.001, finitePositive(camera.far, 1_000));
      const perspective = camera.isPerspectiveCamera === true ? 1 : 0;
      const projectionScale = perspective
        ? 0.5 * height * Math.abs(Number(camera.projectionMatrix?.elements?.[5]) || 1)
        : 0.5 * height;
      aoMaterial.uniforms.uCameraNear.value = cameraNear;
      aoMaterial.uniforms.uCameraFar.value = cameraFar;
      aoMaterial.uniforms.uPerspective.value = perspective;
      aoMaterial.uniforms.uProjectionScale.value = projectionScale;
      bilateralMaterial.uniforms.uCameraNear.value = cameraNear;
      bilateralMaterial.uniforms.uCameraFar.value = cameraFar;
      bilateralMaterial.uniforms.uPerspective.value = perspective;
    }

    /** Render one High frame. Returning false tells the runtime to use its unchanged direct path. */
    function render() {
      if (disposed) throw new Error('Cannot render with a disposed post-processing pipeline.');
      if (!enabled) return false;
      syncDrawingBufferSize();
      if (!targets) throw new Error('Enabled post-processing pipeline has no render targets.');

      const previousTarget = renderer.getRenderTarget?.() || null;
      const previousAutoClear = renderer.autoClear;
      const previousToneMapping = renderer.toneMapping;
      const previousExposure = finitePositive(renderer.toneMappingExposure, 1);
      const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;
      const previousScissorTest = renderer.getScissorTest?.() ?? false;
      const previousBackground = scene.background;
      const previousCameraLayerMask = camera.layers?.mask;
      const previousShadowAutoUpdate = renderer.shadowMap?.autoUpdate;
      renderer.getClearColor?.(savedClearColor);
      renderer.getViewport?.(savedViewport);
      renderer.getScissor?.(savedScissor);

      try {
        renderer.autoClear = true;
        renderer.toneMapping = THREE.NoToneMapping;
        updateCameraUniforms();

        renderer.setRenderTarget(targets.scene);
        renderer.setScissorTest(false);
        renderer.render(scene, camera);

        aoMaterial.uniforms.tDepth.value = targets.scene.depthTexture;
        aoMaterial.uniforms.uInvFullResolution.value.set(1 / width, 1 / height);
        renderFullscreen(aoMaterial, targets.aoRaw);

        bilateralMaterial.uniforms.tDepth.value = targets.scene.depthTexture;
        bilateralMaterial.uniforms.tAo.value = targets.aoRaw.texture;
        bilateralMaterial.uniforms.uDirection.value.set(1 / targets.halfWidth, 0);
        renderFullscreen(bilateralMaterial, targets.aoPing);
        bilateralMaterial.uniforms.tAo.value = targets.aoPing.texture;
        bilateralMaterial.uniforms.uDirection.value.set(0, 1 / targets.halfHeight);
        renderFullscreen(bilateralMaterial, targets.aoFinal);

        // Only explicitly tagged emissive objects enter Bloom; sky, white roads, and reflective bodywork remain excluded.
        scene.background = null;
        if (camera.layers) camera.layers.set(BLOOM_LAYER);
        if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
        renderer.setClearColor(0x000000, 1);
        renderer.autoClear = true;
        renderer.setRenderTarget(targets.bloomRaw);
        renderer.setScissorTest(false);
        if (usesLegacyAuditPath) renderer.clear(true, true, true);
        renderer.render(scene, camera);

        bloomBlurMaterial.uniforms.tInput.value = targets.bloomRaw.texture;
        bloomBlurMaterial.uniforms.uDirection.value.set(1 / targets.halfWidth, 0);
        renderFullscreen(bloomBlurMaterial, targets.bloomPing);
        bloomBlurMaterial.uniforms.tInput.value = targets.bloomPing.texture;
        bloomBlurMaterial.uniforms.uDirection.value.set(0, 1 / targets.halfHeight);
        renderFullscreen(bloomBlurMaterial, targets.bloomFinal);

        scene.background = previousBackground;
        if (camera.layers && Number.isFinite(previousCameraLayerMask)) camera.layers.mask = previousCameraLayerMask;
        if (renderer.shadowMap) renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
        renderer.setClearColor(savedClearColor, previousClearAlpha);

        compositeMaterial.uniforms.tScene.value = targets.scene.texture;
        compositeMaterial.uniforms.tAo.value = targets.aoFinal.texture;
        compositeMaterial.uniforms.tBloom.value = targets.bloomFinal.texture;
        compositeMaterial.uniforms.uInvFullResolution.value.set(1 / width, 1 / height);
        compositeMaterial.uniforms.uExposure.value = previousExposure;
        // Preserve the caller's target-clearing contract; only private fully-overwritten targets skip their clears.
        renderFullscreen(compositeMaterial, previousTarget, true);
        frameCount += 1;
        return true;
      } finally {
        scene.background = previousBackground;
        if (camera.layers && Number.isFinite(previousCameraLayerMask)) camera.layers.mask = previousCameraLayerMask;
        if (renderer.shadowMap) renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
        renderer.autoClear = previousAutoClear;
        renderer.toneMapping = previousToneMapping;
        renderer.setClearColor?.(savedClearColor, previousClearAlpha);
        renderer.setRenderTarget?.(previousTarget);
        renderer.setViewport?.(savedViewport);
        renderer.setScissor?.(savedScissor);
        renderer.setScissorTest?.(previousScissorTest);
      }
    }

    function getDiagnostics() {
      return Object.freeze({
        contractVersion: POST_PROCESSING_CONTRACT.version,
        qualityProfile: POST_PROCESSING_CONTRACT.qualityProfile,
        enabled,
        disposed,
        width,
        height,
        requestedCssWidth,
        requestedCssHeight,
        requestedPixelRatio,
        requestedSamples,
        maximumSamples,
        effectiveSamples,
        usesFxaa,
        usesLegacyAuditPath,
        sampleFallback,
        ambientOcclusion: enabled,
        ambientOcclusionMode: POST_PROCESSING_CONTRACT.ambientOcclusion.mode,
        bilateralAo: enabled,
        bloom: enabled,
        bloomSelection: POST_PROCESSING_CONTRACT.bloom.selection,
        bloomLayer: BLOOM_LAYER,
        hdrTargetType: supportsHalfFloat ? 'half-float' : 'unsigned-byte',
        acesPassCount: 1,
        duplicateAcesPrevented: true,
        depthOfField: false,
        fullScreenBlur: false,
        targetCount: targets?.all.length || 0,
        allocationGeneration,
        targetDisposalCount,
        frameCount,
        directRenderOwnedByRuntime: true
      });
    }

    function dispose() {
      if (disposed) return false;
      enabled = false;
      disposeTargets();
      for (const material of [aoMaterial, bilateralMaterial, bloomBlurMaterial, compositeMaterial]) {
        material.dispose();
      }
      fullscreenGeometry.dispose();
      disposed = true;
      return true;
    }

    return Object.freeze({
      contract: POST_PROCESSING_CONTRACT,
      setEnabled,
      setSize,
      render,
      tagBloom,
      getDiagnostics,
      dispose
    });
  }

  return Object.freeze({
    POST_PROCESSING_CONTRACT,
    BLOOM_LAYER,
    tagBloom,
    create
  });
})();

if (typeof window === 'object') window.NeonV23PostProcessing = NeonV23PostProcessingModule;
if (typeof module === 'object' && module.exports) module.exports = NeonV23PostProcessingModule;
