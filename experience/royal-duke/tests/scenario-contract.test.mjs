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
});

test('the visible narrative follows canonical attack and fleet state', () => {
  assert.equal(deriveScene({}), 'baseline');
  assert.equal(deriveScene({ completedActions: ['vendor_session_established'] }), 'vendor-access');
  assert.equal(deriveScene({ completedActions: ['vendor_session_established', 'engineering_path_resolved', 'controller_context_acquired'] }), 'engineering-path');
  assert.equal(deriveScene({ completedActions: ['prompt_injection_inserted'] }), 'evidence-poisoning');
  assert.equal(deriveScene({ completedActions: ['operator_view_frozen'] }), 'operator-view-frozen');
  assert.equal(deriveScene({ completedActions: ['pump_command_changed'] }), 'pump-deenergized');
  assert.equal(deriveScene({ completedActions: ['pump_command_changed'], fleet: { status: 'AWAITING_APPROVAL' } }), 'fleet-containment');
  assert.equal(deriveScene({ completedActions: ['followup_write_attempt'], defensive: { remoteWritesContained: true } }), 'fleet-containment');
  assert.equal(deriveScene({ completedActions: ['low_pressure_observed'], fleet: { status: 'AWAITING_APPROVAL' } }), 'human-approval');
  assert.equal(deriveScene({ fleet: { status: 'VERIFYING' } }), 'recovery-verification');
  assert.equal(deriveScene({ fleet: { status: 'COMPLETED' } }), 'incident-complete');
  assert.equal(deriveScene({ fleet: { status: 'ESCALATED' } }), 'incident-escalated');
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
