'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const gameplayCore = require(path.join(
  PROJECT_ROOT,
  'src/gameplay/Neon_Autopilot_V23_HighSpeed_DroneHeat.gameplay-core.js'
));

const hazardKind = 0;
const pickupKind = 1;

/** Select contacts with the same allocation-free ordering contract used by production. */
function orderFrameContacts(contacts) {
  const pending = contacts.slice();
  const ordered = [];
  while (pending.length) {
    let bestIndex = 0;
    for (let index = 1; index < pending.length; index++) {
      const candidate = pending[index];
      const best = pending[bestIndex];
      if (gameplayCore.compareSweptContactOrder(
        candidate.entryTime,
        candidate.kind,
        candidate.id,
        best.entryTime,
        best.kind,
        best.id
      ) < 0) bestIndex = index;
    }
    ordered.push(pending.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

/** Replay fixed route-space contacts while varying only the render cadence. */
function replayContacts(frameSeconds, sourceContacts) {
  const speedMps = 300;
  const endDistanceM = 18;
  const seen = new Set();
  const timeline = [];
  let distanceM = 0;
  while (distanceM < endDistanceM) {
    const stepSeconds = Math.min(frameSeconds, (endDistanceM - distanceM) / speedMps);
    const nextDistanceM = distanceM + speedMps * stepSeconds;
    const frameContacts = [];
    for (const contact of sourceContacts) {
      const logicalKey = `${contact.kind}:${contact.id}`;
      if (seen.has(logicalKey)) continue;
      const entryTime = gameplayCore.sweptAabbEntryTime(
        0,
        0,
        contact.distanceM - distanceM,
        0,
        0,
        contact.distanceM - nextDistanceM,
        1,
        1,
        0.5
      );
      if (!Number.isFinite(entryTime)) continue;
      frameContacts.push({ ...contact, entryTime, logicalKey });
    }
    for (const contact of orderFrameContacts(frameContacts)) {
      seen.add(contact.logicalKey);
      timeline.push(contact.label);
    }
    distanceM = nextDistanceM;
  }
  return timeline;
}

test('coarse swept frame reports exact entry chronology instead of final overlap', () => {
  const pickupEntry = gameplayCore.sweptAabbEntryTime(0, 0, 4, 0, 0, -9.5, 1, 1, 0.5);
  const hazardEntry = gameplayCore.sweptAabbEntryTime(0, 0, 7, 0, 0, -6.5, 1, 1, 0.5);
  const laterPickupEntry = gameplayCore.sweptAabbEntryTime(0, 0, 10, 0, 0, -3.5, 1, 1, 0.5);
  assert.ok(pickupEntry < hazardEntry);
  assert.ok(hazardEntry < laterPickupEntry);
  assert.equal(gameplayCore.sweptAabbEntryTime(3, 0, 4, 3, 0, -9.5, 1, 1, 0.5), Infinity);
});

test('hazard and pickup chronology is independent of backing-array order and cadence', () => {
  const contacts = [
    { label: 'pickup-before', kind: pickupKind, id: 11, distanceM: 4 },
    { label: 'hazard', kind: hazardKind, id: 21, distanceM: 7 },
    { label: 'pickup-after', kind: pickupKind, id: 12, distanceM: 10 }
  ];
  const expected = ['pickup-before', 'hazard', 'pickup-after'];
  const cadences = [1 / 120, 1 / 60, 1 / 30, 0.045];
  for (const cadence of cadences) {
    assert.deepEqual(replayContacts(cadence, contacts), expected);
    assert.deepEqual(replayContacts(cadence, contacts.slice().reverse()), expected);
  }
});

test('exact-time ties use damage-first kind order and then stable logical ID', () => {
  const contacts = [
    { label: 'pickup', kind: pickupKind, id: 1, entryTime: 0.5 },
    { label: 'hazard-high-id', kind: hazardKind, id: 9, entryTime: 0.5 },
    { label: 'hazard-low-id', kind: hazardKind, id: 4, entryTime: 0.5 }
  ];
  assert.deepEqual(
    orderFrameContacts(contacts).map((contact) => contact.label),
    ['hazard-low-id', 'hazard-high-id', 'pickup']
  );
});

test('production update records both entity kinds before timeline resolution', () => {
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
    'utf8'
  );
  const updateStart = source.indexOf('function updateEntities(dt, now)');
  const updateEnd = source.indexOf('\n  // Zone blending', updateStart);
  const updateSource = source.slice(updateStart, updateEnd);
  assert.match(updateSource, /obj\._collisionEntryTime = hasRouteGraphContract\(\)/);
  assert.match(updateSource, /item\._collisionEntryTime = hasRouteGraphContract\(\)/);
  assert.match(updateSource, /resolveEntityCollisionTimeline\(\);/);
  assert.doesNotMatch(updateSource, /takeDamage\(i\);\s*return;/);
});
