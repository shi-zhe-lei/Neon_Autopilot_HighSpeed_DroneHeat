#!/usr/bin/env node
/** Real hull projection and HUD-safe driving-camera regression / 真实飞船包络与 HUD 安全构图回归。 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PREFIX = 'Neon_Autopilot_HighSpeed_DroneHeat';
const runtime = fs.readFileSync(path.join(PROJECT_ROOT, `src/runtime/${PREFIX}.js`), 'utf8');
const shipSource = fs.readFileSync(path.join(PROJECT_ROOT, `src/entities/${PREFIX}.ship.js`), 'utf8');
const trackSource = fs.readFileSync(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.track.js`), 'utf8');
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));

/** Read the real frozen literals rather than duplicating the camera or ship envelope dimensions. */
function contractFrom(source, name) {
  const match = source.match(new RegExp(`const ${name} = Object\\.freeze\\((\\{[\\s\\S]*?\\})\\);`));
  assert.ok(match, `missing ${name}`);
  return Function(`return Object.freeze(${match[1]});`)();
}

const contract = contractFrom(runtime, 'drivingCameraFramingContract');
const optics = contractFrom(runtime, 'cameraSpeedPerceptionContract');
const coveredOptics = contractFrom(runtime, 'undergroundCameraContract');
const bounds = contractFrom(shipSource, 'COVERED_CLEARANCE_CONTRACT');
const maximumRoadGrade = Number(trackSource.match(/const CLOVERLEAF_MAXIMUM_GRADE = ([\d.]+);/)[1]);
const start = runtime.indexOf('function createDrivingCameraFramingGuard(');
const end = runtime.indexOf('\n  const drivingCameraFramingGuard =', start);
assert.ok(start >= 0 && end > start);
const factorySource = runtime.slice(start, end).trim();
const createGuard = Function(`return (${factorySource});`)();
const smootherstep = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Inset rectangles reserve cockpit lanes rather than assuming an empty canvas. The 640/320/834 rectangles
// are browser measurements; 768/568 are the corrected drawer budgets, independently verified by the browser audit.
const layouts = [
  { width: 640, height: 480, left: 6, right: 634, top: 168, bottom: 338 },
  { width: 800, height: 450, left: 164, right: 690, top: 98, bottom: 350 },
  { width: 320, height: 568, left: 6, right: 314, top: 202, bottom: 426 },
  { width: 390, height: 844, left: 8, right: 382, top: 208, bottom: 646 },
  { width: 280, height: 720, left: 8, right: 272, top: 198, bottom: 522 },
  { width: 844, height: 390, left: 140, right: 726, top: 78, bottom: 294 },
  { width: 640, height: 260, left: 94, right: 538, top: 56, bottom: 188 },
  { width: 320, height: 568, left: 8, right: 312, top: 204, bottom: 385 },
  { width: 768, height: 1_024, left: 6, right: 762, top: 550, bottom: 876 },
  { width: 834, height: 1_194, left: 6, right: 828, top: 648.695_3, bottom: 1_046 },
  { width: 568, height: 320, left: 6, right: 350, top: 120, bottom: 268 }
];

/** Reproduce the production route-basis camera offset and YXZ hull attitude without a DOM or WebGL renderer. */
function fixture(layout, view, { lateral = 0, altitude = 0, roll = 0, pitch = 0, slope = 0, bend = 0 } = {}) {
  const portrait = smootherstep((optics.portraitAspectStart - layout.width / layout.height)
    / (optics.portraitAspectStart - optics.portraitAspectFull));
  const crowding = Math.max(0, Math.min(1, (contract.hudHeightCrowdingStartRatio
    - (layout.bottom - layout.top) / layout.height)
      / (contract.hudHeightCrowdingStartRatio - contract.hudHeightCrowdingFullRatio)));
  const rearCompensation = Math.max(portrait, crowding, smootherstep(crowding));
  const camera = new THREE.PerspectiveCamera(
    view === 'tunnel' ? optics.tunnelFovDegrees
      : view === 'close' ? optics.closeFovDegrees : optics.chaseFovDegrees,
    layout.width / layout.height, 0.1, 1_600
  );
  const behind = view === 'tunnel' ? coveredOptics.baseBehindM
    : view === 'top' ? optics.topBehindBaseM
      : view === 'close' ? 8.25 * optics.closeBehindScale
        * (1 + (optics.portraitCloseBehindMaximumScale - 1) * rearCompensation)
        : 17.2 * optics.chaseBehindScale
          * (1 + (optics.portraitChaseBehindMaximumScale - 1) * rearCompensation);
  const height = view === 'tunnel' ? coveredOptics.baseHeightM
    : view === 'top' ? optics.topHeightBaseM
      : view === 'close' ? 3.65 * optics.closeHeightScale : 7.2 * optics.chaseHeightScale;
  const route = new THREE.Quaternion().setFromEuler(new THREE.Euler(slope, bend, 0, 'YXZ'));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(route);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(route);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(route);
  const side = view === 'tunnel' ? Math.max(-2.2, Math.min(2.2, lateral * 0.62))
    : view === 'top' ? lateral : view === 'close' ? lateral * 0.44 : lateral * 0.075;
  const cameraHeight = height + (view === 'tunnel' ? Math.min(0.14, altitude * 0.06)
    : view === 'top' ? altitude * 0.72 * 0.42 : altitude * 0.72);
  camera.position.copy(right).multiplyScalar(side).addScaledVector(up, cameraHeight).addScaledVector(forward, -behind);
  // Open rigs deliberately omit the tangent's vertical displacement; covered rigs follow the trailing road sample.
  if (view !== 'tunnel') camera.position.y = up.y * cameraHeight;
  const look = new THREE.Vector3().copy(up).multiplyScalar(1.05 + altitude * 0.55).addScaledVector(forward, 28);
  if (view !== 'tunnel') look.y = up.y * (1.05 + altitude * 0.55);
  camera.lookAt(look);
  // The rendered hull may lag/lead the route attitude while banking or leaving a ramp.
  const hull = new THREE.Group();
  hull.position.copy(right).multiplyScalar(lateral);
  hull.position.y += altitude;
  const maximumRoll = view === 'tunnel' ? bounds.maximumCoveredRollRad : 0.72;
  const maximumPitch = view === 'tunnel' ? bounds.maximumCoveredPitchRad : 0.42;
  const minimumPitch = view === 'tunnel' ? -bounds.maximumCoveredPitchRad : -0.40;
  const hullRoll = altitude === 0 ? roll * 0.1 : roll;
  hull.rotation.set(
    Math.max(minimumPitch, Math.min(maximumPitch, slope + pitch)),
    bend + 0.5,
    Math.max(-maximumRoll, Math.min(maximumRoll, hullRoll)),
    'YXZ'
  );
  hull.updateMatrixWorld(true);
  return { camera, hull, look };
}

/** Independently project all eight actual ship-contract corners through Three's committed camera matrices. */
function assertInside(camera, hull, safe) {
  const margin = Math.min(contract.cssMarginPx, safe.width * 0.015, safe.height * 0.015);
  const corner = new THREE.Vector3();
  for (let index = 0; index < 8; index++) {
    corner.set(
      (index & 1 ? 1 : -1) * bounds.mainVisualHalfWidthM,
      index & 2 ? bounds.mainVisualMaximumYM : bounds.mainVisualMinimumYM,
      index & 4 ? bounds.mainVisualAftM : -bounds.mainVisualForwardM
    ).applyMatrix4(hull.matrixWorld).project(camera);
    const x = (corner.x + 1) * safe.width * 0.5;
    const y = (1 - corner.y) * safe.height * 0.5;
    assert.ok(x >= safe.left + margin - 0.001 && x <= safe.right - margin + 0.001, `corner ${index} x=${x}`);
    assert.ok(y >= safe.top + margin - 0.001 && y <= safe.bottom - margin + 0.001, `corner ${index} y=${y}`);
    assert.ok(corner.z > -1 && corner.z < 1, 'main visual must remain beyond the near clipping plane');
  }
}

/** Run the production follow ordering across frames; inspect rendered output separately from its authored state. */
function continuousFollow(layout, view, initialPose = {}) {
  const initial = fixture(layout, view, initialPose);
  const { camera, hull } = initial;
  const lookOffset = initial.look.clone();
  const guard = createGuard(THREE, contract, bounds);
  const renderedBefore = camera.quaternion.clone();
  const authoredBefore = new THREE.Quaternion();
  const targetQuaternion = new THREE.Quaternion();
  const positionResponse = Number(runtime.match(/: \(hoodViewActive \? 14 : ([\d.]+)\)/)[1]);
  const lookResponse = Number(runtime.match(/: lerp\(([\d.]+), 14, undergroundTunnelBlend\)/)[1]);
  const rotationResponse = Number(runtime.match(/topViewActive \? 7.5 : hoodViewActive \? 18 : ([\d.]+)/)[1]);
  const fovResponse = Number(runtime.match(/state.cameraTransition > 0 \? 1.9 : ([\d.]+)/)[1]);
  return {
    camera, hull, guard,
    step(target, safe, dt, authoredRoll = 0) {
      renderedBefore.copy(camera.quaternion);
      const fovBefore = camera.fov;
      camera.position.lerp(target.camera.position, 1 - Math.exp(-dt * (view === 'tunnel' ? 8 : positionResponse)));
      lookOffset.lerp(target.look, 1 - Math.exp(-dt * (view === 'tunnel' ? 14 : lookResponse)));
      hull.position.copy(target.hull.position);
      hull.quaternion.copy(target.hull.quaternion);
      hull.updateMatrixWorld(true);
      guard.restoreAuthoredState(camera, true);
      authoredBefore.copy(camera.quaternion);
      camera.lookAt(lookOffset);
      targetQuaternion.copy(camera.quaternion);
      camera.quaternion.copy(authoredBefore).slerp(targetQuaternion, 1 - Math.exp(-dt * (view === 'top' ? 7.5 : rotationResponse)));
      camera.fov += (target.camera.fov - camera.fov) * (1 - Math.exp(-dt * fovResponse));
      camera.updateProjectionMatrix();
      guard.captureAuthoredState(camera);
      camera.rotateZ(authoredRoll);
      const lookBefore = lookOffset.clone();
      const result = guard.fit(camera, hull, safe);
      assert.deepEqual(lookOffset, lookBefore, 'the final guard cannot rewrite the route-follow target');
      return {
        result,
        angleStep: renderedBefore.angleTo(camera.quaternion) * 180 / Math.PI,
        fovStep: Math.abs(camera.fov - fovBefore)
      };
    }
  };
}

test('2,376 real Three projections keep the complete hull inside reduced HUD rectangles through legal grades and flight', () => {
  let count = 0;
  for (const layout of layouts) for (const view of ['chase', 'close', 'top', 'tunnel']) {
    for (const lateral of [-5, 0, 5]) for (const requestedAltitude of [0, 1, 6]) {
      for (const roll of [-0.4, 0, 0.4]) for (const slope of [-Math.atan(maximumRoadGrade), Math.atan(maximumRoadGrade)]) {
        // Underground clearance rules cap flight before the camera runs; a fictitious 18m tunnel jump is not a fixture.
        const altitude = view === 'tunnel' ? Math.min(0.36, requestedAltitude) : requestedAltitude;
        const { camera, hull, look } = fixture(layout, view, { lateral, altitude, roll, slope, pitch: 0.25, bend: 0.8 });
        const beforePosition = camera.position.clone();
        const beforeHull = hull.matrixWorld.clone();
        const guard = createGuard(THREE, contract, bounds);
        const result = guard.fit(camera, hull, { ...layout, revision: 7 });
        assert.equal(result.fits, true, JSON.stringify({ layout, view, lateral, altitude, roll, slope, result }));
        assert.equal(result.fallbackActive, false, 'viewport fallback must never impersonate a HUD-safe frame');
        assertInside(camera, hull, layout);
        assert.deepEqual(camera.position, beforePosition, 'roof/wall clearance cannot be changed by framing');
        assert.deepEqual(hull.matrixWorld, beforeHull, 'the visual hull cannot be shrunk or moved');
        assert.equal(result.positionErrorM, 0);
        assert.equal(result.safeRectRevision, 7);
        assert.ok(camera.fov <= 100);
        assert.equal(camera.far, 1_600);
        assert.equal(camera.zoom, 1);
        assert.ok(result.iterations <= 8);
        count++;
      }
    }
  }
  assert.equal(count, 2_376);
});

test('2,376 extreme flight and stale-look frames retain all eight hull corners inside the canvas without hiding HUD failures', () => {
  let count = 0;
  let honestHudFallbacks = 0;
  for (const layout of layouts) for (const view of ['chase', 'close', 'top', 'tunnel']) {
    for (const lateral of [-5, 0, 5]) for (const roll of [-0.72, 0, 0.72]) {
      for (const slope of [-Math.atan(maximumRoadGrade), Math.atan(maximumRoadGrade)]) for (const staleYaw of [-1.2, 0, 1.2]) {
        const { camera, hull, look } = fixture(layout, view, {
          lateral, altitude: view === 'tunnel' ? 0.36 : 18, roll, slope, pitch: 0.25, bend: 0.8
        });
        camera.rotateY(staleYaw);
        const beforePosition = camera.position.clone();
        const result = createGuard(THREE, contract, bounds).fit(camera, hull, { ...layout, revision: 3 });
        assert.equal(result.viewportFits, true, JSON.stringify({ layout, view, lateral, roll, slope, staleYaw, result }));
        assertInside(camera, hull, { ...layout, left: 0, top: 0, right: layout.width, bottom: layout.height });
        assert.deepEqual(camera.position, beforePosition);
        assert.ok(camera.fov <= contract.emergencyMaximumFovDegrees);
        if (!result.fits) {
          honestHudFallbacks++;
          assert.equal(result.fallbackActive, true);
          assert.equal(result.hudOccluded, true);
          assert.equal(result.unresolvedCount, 1);
        } else {
          assertInside(camera, hull, layout);
        }
        count++;
      }
    }
  }
  assert.equal(count, 2_376);
  assert.ok(honestHudFallbacks > 0, 'extreme attitudes should exercise truthful HUD-overlap diagnostics');
});

test('safe composition is a no-op and impossible rectangles report failure without breaking clearance or lens limits', () => {
  const layout = { width: 1_920, height: 1_080, left: 0, right: 1_920, top: 0, bottom: 1_080, revision: 0 };
  const { camera, hull, look } = fixture(layout, 'chase');
  const guard = createGuard(THREE, contract, bounds);
  const position = camera.position.clone();
  const quaternion = camera.quaternion.clone();
  const fov = camera.fov;
  const result = guard.fit(camera, hull, layout);
  assert.equal(result.fits, true);
  assert.equal(result.adjusted, false);
  assert.equal(camera.fov, fov);
  assert.deepEqual(camera.quaternion.toArray(), quaternion.toArray());
  const impossible = { width: 320, height: 568, left: 6, right: 102, top: 430, bottom: 470, revision: 1 };
  camera.aspect = impossible.width / impossible.height;
  camera.updateProjectionMatrix();
  const failure = guard.fit(camera, hull, impossible);
  assert.equal(failure.fits, false);
  assert.equal(failure.unresolvedCount, 1);
  assert.equal(failure.viewportFits, true);
  assert.equal(failure.hudOccluded, true);
  assert.equal(failure.fallbackActive, true);
  assertInside(camera, hull, { ...impossible, left: 0, right: impossible.width, top: 0, bottom: impossible.height });
  assert.deepEqual(camera.position, position);
  assert.ok(camera.fov <= contract.emergencyMaximumFovDegrees);
});

test('the former low tablet and short landscape drawer strips remain explicit HUD failures with a full-canvas floor', () => {
  for (const layout of [
    { width: 768, height: 1_024, left: 6, right: 762, top: 640.695_3, bottom: 876 },
    { width: 568, height: 320, left: 6, right: 350, top: 182, bottom: 268 }
  ]) {
    const { camera, hull, look } = fixture(layout, 'close', {
      altitude: 1, roll: 0.4, pitch: 0.25, slope: -Math.atan(maximumRoadGrade), bend: 0.8
    });
    const result = createGuard(THREE, contract, bounds).fit(camera, hull, { ...layout, revision: 1 });
    assert.equal(result.fits, false);
    assert.equal(result.hudOccluded, true);
    assert.equal(result.fallbackActive, true);
    assert.equal(result.viewportFits, true);
    assertInside(camera, hull, { ...layout, left: 0, top: 0, right: layout.width, bottom: layout.height });
  }
});

test('HUD opening and recovery reuse the existing time-based lens damping at 30, 60, and 120 Hz', () => {
  const updateStart = runtime.indexOf('function updateCamera(dt)');
  const blendStart = runtime.indexOf('const hudSafeHeightRatio =', updateStart);
  const blendEnd = runtime.indexOf('const portraitChaseHeightScale =', blendStart);
  const resolveBlend = Function(
    'camera', 'cameraHudSafeRect', 'cameraSpeedPerceptionContract', 'drivingCameraFramingContract',
    'portraitAspectRange', 'track', 'clamp', 'drivingCameraFramingGuard',
    `${runtime.slice(blendStart, blendEnd)}; return viewportRearFramingBlend;`
  );
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const sampleBlend = (safe) => resolveBlend(
    { aspect: safe.width / safe.height }, safe, optics, contract,
    optics.portraitAspectStart - optics.portraitAspectFull,
    { smootherStep01: smootherstep }, clamp, { diagnostics: {} }
  );
  const open = { width: 568, height: 320, left: 0, right: 568, top: 0, bottom: 320 };
  const crowded = { ...open, left: 6, right: 350, top: 120, bottom: 268 };
  assert.equal(sampleBlend(open), 0);
  assert.ok(sampleBlend(crowded) > 0.18, 'the 46%-height drawer must respond before the old smootherstep dead zone');
  assert.equal(sampleBlend({ ...open, top: 224 }), 1);
  const damping = runtime.match(/cameraPositionOffset\.lerp\(cameraTargetPositionOffset, (1 - Math\.exp\(-dt \* transitionSoftness\))\)/);
  assert.ok(damping, 'HUD rear compensation must feed the existing damped rig target');
  const softness = Number(runtime.match(/: \(hoodViewActive \? 14 : ([\d.]+)\)/)[1]);
  const alpha = Function('dt', 'transitionSoftness', `return ${damping[1]};`);
  const positions = [];
  for (const hz of [30, 60, 120]) {
    const original = fixture(open, 'close').camera.position;
    const target = fixture(crowded, 'close').camera.position;
    const position = original.clone();
    const completeDistance = original.distanceTo(target);
    for (let frame = 0; frame < hz; frame++) {
      const before = position.clone();
      const distanceBefore = position.distanceTo(target);
      position.lerp(target, alpha(1 / hz, softness));
      assert.ok(position.distanceTo(target) < distanceBefore);
      assert.ok(position.distanceTo(before) < completeDistance * 0.12, 'drawer opening cannot snap the lens');
    }
    const afterOpening = position.clone();
    for (let frame = 0; frame < hz; frame++) {
      const distanceBefore = position.distanceTo(original);
      position.lerp(original, alpha(1 / hz, softness));
      assert.ok(position.distanceTo(original) < distanceBefore, 'closing the HUD must recover monotonically');
    }
    positions.push({ afterOpening, afterRecovery: position });
  }
  for (const sample of positions.slice(1)) {
    assert.ok(sample.afterOpening.distanceTo(positions[0].afterOpening) < 0.000_001);
    assert.ok(sample.afterRecovery.distanceTo(positions[0].afterRecovery) < 0.000_001);
  }
});

test('stationary left/right road edges settle without pose or FOV cycles at 30, 60, and 120 Hz', (context) => {
  const steadyLayouts = [
    ...layouts,
    { width: 1_280, height: 720, left: 311.195_312_5, right: 891, top: 6, bottom: 660 },
    { width: 1_280, height: 720, left: 311.195_312_5, right: 891, top: 71.398_437_5, bottom: 660 }
  ];
  let frameCount = 0;
  let maximumSettledAngle = 0;
  let maximumSettledFovStep = 0;
  for (const safe of steadyLayouts) for (const view of ['chase', 'close', 'top', 'tunnel']) {
    for (const lateral of [-10, 10]) for (const roll of [-0.03, 0, 0.03]) for (const hz of [30, 60, 120]) {
      const pose = { lateral, pitch: 0, roll: 0, bend: 0 };
      const sequence = continuousFollow(safe, view, pose);
      const target = fixture(safe, view, pose);
      for (let frame = 0; frame < hz * 7; frame++) {
        const sample = sequence.step(target, safe, 1 / hz, roll);
        assert.equal(sample.result.viewportFits, true);
        if (frame >= hz * 6) {
          maximumSettledAngle = Math.max(maximumSettledAngle, sample.angleStep);
          maximumSettledFovStep = Math.max(maximumSettledFovStep, sample.fovStep);
          assert.ok(sample.angleStep < 0.000_1, JSON.stringify({ safe, view, lateral, roll, hz, frame, sample }));
          assert.ok(sample.fovStep < 0.000_1);
        }
        frameCount++;
      }
    }
  }
  context.diagnostic(JSON.stringify({ frameCount, maximumSettledAngle, maximumSettledFovStep }));
});

test('slow left/right traversals retain HUD fit without branch chatter or fixed-size pose and FOV jumps', (context) => {
  // These are production HUD rectangles, including the actual desktop panels that extend beyond their parent.
  const movingLayouts = [layouts[0], layouts[2], layouts[8], layouts[10],
    { width: 1_280, height: 720, left: 311.195_312_5, top: 6, right: 891, bottom: 660 },
    { width: 1_280, height: 720, left: 311.195_312_5, top: 71.398_437_5, right: 891, bottom: 660 }];
  let frameCount = 0;
  let maximumAngleRate = 0;
  let maximumFovRate = 0;
  for (const safe of movingLayouts) for (const view of ['chase', 'close', 'top', 'tunnel']) {
    for (const hz of [30, 60, 120]) {
      const poseAt = (seconds) => ({
        lateral: (view === 'tunnel' ? 3 : 9) * Math.sin(seconds * Math.PI / 4),
        roll: 0.1 * Math.cos(seconds * Math.PI / 4),
        altitude: view === 'tunnel' ? 0 : 0.05 * (1 + Math.sin(seconds)),
        slope: 0.02 * Math.sin(seconds / 2)
      });
      const sequence = continuousFollow(safe, view, poseAt(0));
      for (let frame = 0; frame < hz * 3; frame++) {
        sequence.step(fixture(safe, view, poseAt(0)), safe, 1 / hz, 0.015);
      }
      for (let frame = 0; frame < hz * 16; frame++) {
        const seconds = frame / hz;
        const sample = sequence.step(fixture(safe, view, poseAt(seconds)), safe, 1 / hz,
          0.015 * Math.cos(seconds));
        assert.equal(sample.result.fits, true, 'ordinary traversals cannot alternate into HUD fallback');
        assert.equal(sample.result.fallbackActive, false);
        // Bounds scale with elapsed time: a fixed angular/FOV inset must fail at higher refresh rates.
        assert.ok(sample.angleStep <= 75 / hz, JSON.stringify({ safe, view, hz, frame, sample }));
        assert.ok(sample.fovStep <= 50 / hz, JSON.stringify({ safe, view, hz, frame, sample }));
        maximumAngleRate = Math.max(maximumAngleRate, sample.angleStep * hz);
        maximumFovRate = Math.max(maximumFovRate, sample.fovStep * hz);
        frameCount++;
      }
    }
  }
  context.diagnostic(JSON.stringify({ frameCount, maximumAngleRate, maximumFovRate }));
});

test('additive roll applies once and leaving driving mode discards the isolated state without moving the rendered pose', () => {
  const safe = { width: 1_920, height: 1_080, left: 0, right: 1_920, top: 0, bottom: 1_080, revision: 1 };
  const sequence = continuousFollow(safe, 'chase');
  const target = fixture(safe, 'chase');
  const expected = target.camera.quaternion.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.03)
  );
  for (let frame = 0; frame < 600; frame++) sequence.step(target, safe, 1 / 60, 0.03);
  assert.ok(sequence.camera.quaternion.angleTo(expected) < 0.000_001, 'roll must not accumulate to roll / dampingAlpha');
  const rendered = sequence.camera.quaternion.clone();
  const renderedFov = sequence.camera.fov;
  sequence.guard.restoreAuthoredState(sequence.camera, false);
  assert.deepEqual(sequence.camera.quaternion.toArray(), rendered.toArray());
  assert.equal(sequence.camera.fov, renderedFov);
  sequence.guard.restoreAuthoredState(sequence.camera, true);
  assert.deepEqual(sequence.camera.quaternion.toArray(), rendered.toArray(), 'returning after Film/Hood/free-look cannot restore a stale driving snapshot');
});

test('the final driving frame consumes cached HUD geometry after camera roll while Film, Hood, and free-look retain their authority', () => {
  const updateStart = runtime.indexOf('function updateCamera(dt)');
  const updateEnd = runtime.indexOf('function sampleCommittedHoodCollisionGuideRawFrame(', updateStart);
  const update = runtime.slice(updateStart, updateEnd);
  assert.match(update, /if \(!cinematicViewActive && !hoodViewActive && !freeLookActive\)/);
  assert.match(update, /drivingCameraFramingGuard\.fit\(camera, player, cameraHudSafeRect\)/);
  assert.ok(update.lastIndexOf('camera.rotateZ(') < update.indexOf('drivingCameraFramingGuard.fit('));
  assert.ok(update.indexOf('camera.updateProjectionMatrix()') < update.indexOf('drivingCameraFramingGuard.fit('));
  assert.ok(update.indexOf('drivingCameraFramingGuard.restoreAuthoredState(') < update.indexOf('cameraQuaternionPrevious.copy('));
  assert.ok(update.indexOf('drivingCameraFramingGuard.captureAuthoredState(') < update.lastIndexOf('camera.rotateZ('));
  assert.equal(contract.authoredStateIsolated, true);
  assert.doesNotMatch(factorySource, /lookTarget\.copy|cameraLookOffset/);
  assert.doesNotMatch(update, /if \(framing.adjusted\) cameraLookOffset/);
  assert.doesNotMatch(factorySource, /getBoundingClientRect|getComputedStyle|document\.|renderer\.|\.scale\s*=|setPixelRatio/);
  assert.equal(contract.positionImmutable, true);
  assert.equal(contract.freeLookReturnRatePerSecond, 14);
  assert.match(update, /freeLookSoftness = state.cameraFreeLookDragging[\s\S]*?drivingCameraFramingContract.freeLookReturnRatePerSecond/);
  assert.match(update, /hudSafeHeightRatio = \(cameraHudSafeRect.bottom - cameraHudSafeRect.top\)/);
  assert.match(update, /viewportRearFramingBlend = Math.max\([\s\S]*?camera.aspect[\s\S]*?hudHeightCrowding[\s\S]*?track.smootherStep01\(hudHeightCrowding\)/);
  assert.match(update, /portraitCloseBehindMaximumScale,\s*viewportRearFramingBlend/);
  assert.match(update, /portraitChaseBehindMaximumScale,\s*viewportRearFramingBlend/);
  assert.match(update, /cameraPositionBehind = lerp\(cameraPositionBehind, tunnelCameraBehind, undergroundTunnelBlend\)/);
});
