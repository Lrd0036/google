import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const model = JSON.parse(
  await readFile(new URL('../range/royal-duke/scenario.json', import.meta.url), 'utf8'),
);

const scenes = model.experience.scenes;
const sceneById = new Map(scenes.map((scene, index) => [scene.id, { scene, index }]));

function deriveScene({ completedActions = [], defensive = {}, fleet = null }) {
  const completed = new Set(completedActions);
  let active = 0;
  scenes.forEach((scene, index) => {
    if (scene.activation.actionIds?.some((id) => completed.has(id))) active = Math.max(active, index);
    if (fleet?.status && scene.activation.statuses?.includes(fleet.status)) active = Math.max(active, index);
  });
  if (defensive.remoteWritesContained) active = Math.max(active, sceneById.get('fleet-containment').index);
  if (fleet?.status === 'FLEET_INVESTIGATING') active = Math.max(active, sceneById.get('fleet-containment').index);
  if (fleet?.status === 'AWAITING_APPROVAL') active = Math.max(active, sceneById.get('human-approval').index);
  if (fleet?.status === 'RESTORING' || fleet?.status === 'VERIFYING') active = Math.max(active, sceneById.get('recovery-verification').index);
  if (fleet?.status === 'COMPLETED') return 'incident-complete';
  if (fleet?.status === 'ESCALATED') return 'incident-escalated';
  return scenes[active].id;
}

test('one scenario document presents every executable attack action exactly once', () => {
  const actionIds = model.actions.map((action) => action.id);
  assert.deepEqual(actionIds, [
    'vendor_session_established',
    'engineering_path_resolved',
    'controller_context_acquired',
    'prompt_injection_inserted',
    'operator_view_frozen',
    'pump_command_changed',
    'followup_write_attempt',
    'low_pressure_observed',
  ]);
  const presented = scenes.flatMap((scene) => scene.activation.actionIds ?? []);
  assert.deepEqual([...presented].sort(), [...actionIds].sort());
  assert.equal(new Set(actionIds).size, actionIds.length);
  assert.equal(new Set(scenes.map((scene) => scene.id)).size, scenes.length);
  assert.deepEqual(model.actions.filter((action) => action.control === 'system').map((action) => action.id), ['low_pressure_observed']);
  assert(model.actions.filter((action) => action.control === 'attacker').every((action) => action.id !== 'low_pressure_observed'));
});

test('the visible narrative follows canonical attack and fleet state', () => {
  assert.equal(deriveScene({}), 'baseline');
  assert.equal(deriveScene({ completedActions: ['vendor_session_established'] }), 'vendor-access');
  assert.equal(deriveScene({ completedActions: ['vendor_session_established', 'engineering_path_resolved', 'controller_context_acquired'] }), 'engineering-path');
  assert.equal(deriveScene({ completedActions: ['prompt_injection_inserted'] }), 'evidence-poisoning');
  assert.equal(deriveScene({ completedActions: ['operator_view_frozen'] }), 'operator-view-frozen');
  assert.equal(deriveScene({ completedActions: ['pump_command_changed'] }), 'pump-deenergized');
  assert.equal(deriveScene({ completedActions: ['pump_command_changed'], fleet: { status: 'FLEET_INVESTIGATING' } }), 'fleet-containment');
  assert.equal(deriveScene({ completedActions: ['followup_write_attempt'], defensive: { remoteWritesContained: true } }), 'fleet-containment');
  assert.equal(deriveScene({ completedActions: ['low_pressure_observed'], fleet: { status: 'AWAITING_APPROVAL' } }), 'human-approval');
  assert.equal(deriveScene({ fleet: { status: 'VERIFYING' } }), 'recovery-verification');
  assert.equal(deriveScene({ fleet: { status: 'COMPLETED' } }), 'incident-complete');
  assert.equal(deriveScene({ fleet: { status: 'ESCALATED' } }), 'incident-escalated');
});

test('the storyteller has no independent play, advance, stage, or arrow-key state machine', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const overlay = await readFile(new URL('../app/components/FilmOverlay.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /replayStage|setReplayStage|ArrowRight|ArrowLeft|setPlaying/);
  assert.doesNotMatch(overlay, /Play briefing|>Advance<|onAdvance|onStage/);
  assert.match(overlay, /Presentation controls cannot advance the incident/);
});

test('the live console can open as a standalone window without creating separate incident state', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const surface = await readFile(new URL('../app/components/AttackSurface.tsx', import.meta.url), 'utf8');
  assert.match(page, /searchParams\.set\('view', 'console'\)/);
  assert.match(page, /royal-duke-control-console/);
  assert.match(page, /<AttackSurface\s+open\s+standalone/);
  assert.match(surface, /Open in new window/);
  assert.equal((page.match(/useRangeTelemetry\(\)/g) ?? []).length, 1);
});

test('the Playwright recorder executes the real authority and verification boundaries', async () => {
  const recorder = await readFile(new URL('../../../scripts/record-royal-duke.mjs', import.meta.url), 'utf8');
  assert.match(recorder, /recordVideo/);
  assert.match(recorder, /Poison the defensive evidence stream/);
  assert.match(recorder, /AWAITING_APPROVAL/);
  assert.match(recorder, /SIGN & APPROVE RESTORATION/);
  assert.match(recorder, /fleet\?\.status === 'COMPLETED'/);
  assert.match(recorder, /post-containment write was not visibly blocked/i);
  assert.match(recorder, /assertLiveCompletion/);
  assert.match(recorder, /LIVE_GEMINI_JUDGMENT: 'true'/);
  assert.match(recorder, /--allow-fallback/);
  assert.match(recorder, /Submission provenance is not fully verified/);
  assert.match(recorder, /const recordPort = recordUrl\.port \|\| '80'/);
  assert.match(recorder, /'exec', 'vite', '--host', recordHost, '--port', recordPort, '--strictPort'/);
});

test('range actions serialize against live fleet observation writes', async () => {
  const controller = await readFile(new URL('../range/royal-duke/controller/server.mjs', import.meta.url), 'utf8');
  assert.match(controller, /serializeAction/);
  assert.match(controller, /while \(observationInFlight\)/);
  assert.match(controller, /observationInFlight \|\| actionInFlight/);
});

test('presentation thresholds and campaign funnel match executable scenario claims', () => {
  const thresholds = model.experience.thresholds;
  const lowPressure = model.actions.find((action) => action.id === 'low_pressure_observed');
  assert.equal(lowPressure.condition, `process.pressure.psi < ${thresholds.lowPressurePsi}`);
  assert.equal(thresholds.incidentDeltaPsi, 5);
  assert.equal(thresholds.incidentContinuousSeconds, 15);
  assert.equal(thresholds.recoveryPressurePsi, 58);
  assert.equal(thresholds.recoveryContinuousSeconds, 30);

  const campaign = model.experience.campaign;
  assert.equal(
    campaign.routine + campaign.decoys + campaign.correlatedAnomalies + campaign.causalEvents + campaign.authoritativeFacts,
    campaign.received,
  );
});

test('map and evidence references resolve to declared scenes', () => {
  const ids = new Set(scenes.map((scene) => scene.id));
  for (const node of model.experience.map.storyNodes) {
    assert(ids.has(node.revealScene));
    assert(ids.has(node.compromisedScene));
    if (node.recoveredScene) assert(ids.has(node.recoveredScene));
  }
  for (const edge of model.experience.map.storyEdges) {
    for (const key of ['revealScene', 'infectScene', 'blockedScene', 'recoveredScene']) {
      if (edge[key]) assert(ids.has(edge[key]));
    }
  }
  for (const evidence of model.experience.evidence) assert(ids.has(evidence.sceneId));
});

test('the documentary map retains and prewarms raster tiles for scripted camera flights', async () => {
  const map = await readFile(new URL('../app/components/DocumentaryMap.tsx', import.meta.url), 'utf8');
  const cache = await readFile(new URL('../app/lib/map-tile-cache.ts', import.meta.url), 'utf8');

  assert.match(map, /maxTileCacheZoomLevels:\s*12/);
  assert.match(map, /cancelPendingTileRequestsWhileZooming:\s*false/);
  assert.match(map, /refreshExpiredTiles:\s*false/);
  assert.match(map, /tilePreloader\.enqueue\(\[SHOTS\[0\]\], 'high'\)/);
  assert.match(map, /SHOTS\.slice\(nextStage, nextStage \+ 2\)/);
  assert.match(cache, /maxConcurrent = 4/);
  assert.match(cache, /PRELOAD_ZOOM_OFFSETS = \[-1, 0\]/);
  assert.match(cache, /image\.fetchPriority = next\.priority/);
});

test('the narrative includes model compromise without delegating restoration authority', () => {
  const titles = scenes.map((scene) => scene.title);
  assert(titles.includes('Attack the defender'));
  assert(titles.includes('The machine stops'));
  assert(titles.includes('Physics answers'));
  assert(titles.includes('Recovery failed'));
  assert.equal(model.experience.agents.length, 5);
  assert.equal(model.experience.responseSteps.find((step) => step.id === 'restore').authority, 'HUMAN APPROVAL');
  assert.equal(model.experience.responseSteps.find((step) => step.id === 'verify').authority, 'DETERMINISTIC');
});
