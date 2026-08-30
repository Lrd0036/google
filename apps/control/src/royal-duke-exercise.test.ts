import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExerciseEffects, InvestigationResult, RestorationResult } from './royal-duke-exercise.js';
import { deterministicInvestigation, generateCampaignEvents, HOSTILE_SESSION_NOTE, MemoryExerciseStore, RoyalDukeExerciseManager, verifyExerciseEventChain } from './royal-duke-exercise.js';
import { agentRuntimeRequestBody } from './royal-duke-fleet.js';

class FakeEffects implements ExerciseEffects {
  containmentCalls = 0;
  restoreCalls = 0;
  restoration: RestorationResult = { outcome: 'PASS', stableSeconds: 30, evidenceIds: ['evidence:restored-pump', 'evidence:pressure-above-58-for-30s'] };
  reportRecommendation?: { summary: string; evidenceIds: string[] };
  async investigate(exercise: Parameters<ExerciseEffects['investigate']>[0]): Promise<InvestigationResult> {
    const at = new Date().toISOString();
    return {
      modelArmor: { verdict_event_id: 'verdict-1', template: 'projects/test/templates/royal-duke', invocation_result: 'SUCCESS', match_state: 'MATCH_FOUND', prompt_injection_confidence: 'HIGH', trace_id: exercise.trace_id, recorded_at: at },
      shadowDecision: 'SENSOR_FAULT',
      authoritativeDecision: 'UNAUTHORIZED_PROCESS_CHANGE',
      activities: [
        { activity_id: 'shadow-1', agent_id: 'shadow-analyst', agent_name: 'Shadow Analyst', status: 'COMPROMISED', summary: 'Followed poisoned evidence.', decision: 'SENSOR_FAULT', evidence_ids: ['evidence:vendor-session-note'], started_at: at, completed_at: at },
      ],
    };
  }
  async contain() {
    this.containmentCalls += 1;
    return { trace: ['classify_incident', 'preserve_session', 'contain_remote_writes', 'prepare_restoration', 'approve_restoration'], evidenceIds: ['evidence:preserved-session', 'evidence:contained-path', 'evidence:restoration-prepared'] };
  }
  async restoreAndVerify() {
    this.restoreCalls += 1;
    return this.restoration;
  }
  async report() {
    if (!this.reportRecommendation) throw new Error('NO_REPORT_RECOMMENDATION');
    return this.reportRecommendation;
  }
  async provenance() { return []; }
}

class DeferredRestorationEffects extends FakeEffects {
  private resolveRestoration!: (value: RestorationResult) => void;
  private readonly restorationPromise = new Promise<RestorationResult>((resolve) => { this.resolveRestoration = resolve; });
  override async restoreAndVerify() {
    this.restoreCalls += 1;
    return this.restorationPromise;
  }
  finish() { this.resolveRestoration(this.restoration); }
}

class FailingInvestigationEffects extends FakeEffects {
  override async investigate(): Promise<InvestigationResult> {
    throw new Error('AGENT_RUNTIME_TIMEOUT:incident-commander');
  }
}

function clock() {
  let value = Date.parse('2026-08-27T02:17:00.000Z');
  return { now: () => new Date(value), advance: (milliseconds: number) => { value += milliseconds; } };
}

async function armedManager(effects: FakeEffects = new FakeEffects()) {
  const time = clock();
  const manager = new RoyalDukeExerciseManager(new MemoryExerciseStore(), effects, time.now);
  const exercise = await manager.start('range-run-1');
  for (const action of ['vendor_session_established', 'engineering_path_resolved', 'controller_context_acquired', 'prompt_injection_inserted', 'operator_view_frozen', 'pump_command_changed']) {
    time.advance(100);
    await manager.attack(exercise.exercise_id, action);
  }
  return { manager, effects, time, exerciseId: exercise.exercise_id };
}

test('campaign is deterministic and contains exactly the promised 214 events', () => {
  const first = generateCampaignEvents();
  const second = generateCampaignEvents();
  assert.equal(first.length, 214);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.fromEntries(['ROUTINE', 'DECOY', 'CORRELATED_ANOMALY', 'CAUSAL_EVENT', 'AUTHORITATIVE_FACT'].map((bucket) => [bucket, first.filter((event) => event.bucket === bucket).length])), {
    ROUTINE: 147, DECOY: 39, CORRELATED_ANOMALY: 17, CAUSAL_EVENT: 7, AUTHORITATIVE_FACT: 4,
  });
});

test('managed runtime invocation uses the Vertex AI classMethod contract', () => {
  const body = agentRuntimeRequestBody('exercise-1', { task: 'correlate', events: [1, 2, 3] });
  assert.equal(body.classMethod, 'async_stream_query');
  assert.equal('class_method' in body, false);
  assert.equal(body.input.user_id, 'royal-duke-exercise-1');
  assert.deepEqual(JSON.parse(body.input.message), { task: 'correlate', events: [1, 2, 3] });
});

test('offline investigation does not claim that managed agents executed or that the shadow model was compromised', async () => {
  const { manager, exerciseId } = await armedManager();
  const result = deterministicInvestigation(await manager.get(exerciseId), new Date('2026-08-27T02:18:00.000Z'));
  assert.equal(result.shadowDecision, 'UNKNOWN');
  assert.equal(result.activities.length, 4);
  assert.ok(result.activities.every((activity) => activity.status === 'BLOCKED'));
  assert.ok(result.activities.every((activity) => activity.execution_mode === 'DETERMINISTIC_FALLBACK'));
  assert.equal(result.activities.find((activity) => activity.agent_name === 'Shadow Analyst')?.decision, 'UNKNOWN');
});

test('deterministic monitor requires greater than 5 PSI for 15 continuous seconds', async () => {
  const { manager, effects, time, exerciseId } = await armedManager();
  const observation = (physical: number) => ({ observed_at: time.now().toISOString(), pump_state: 'DE_ENERGIZED' as const, independent_pressure_psi: physical, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE' as const, evidence_preserved: false, restoration_prepared: false });
  await manager.observe(exerciseId, observation(56.9));
  time.advance(14_999);
  let state = await manager.observe(exerciseId, observation(54));
  assert.equal(state.status, 'DETERMINISTIC_MONITORING');
  assert.equal(effects.containmentCalls, 0);
  time.advance(1);
  state = await manager.observe(exerciseId, observation(53));
  assert.equal(state.status, 'AWAITING_APPROVAL');
  assert.equal(effects.containmentCalls, 1);
  assert.equal(state.injected_evidence?.text, HOSTILE_SESSION_NOTE);
  assert.equal(state.injected_evidence?.trust, 'QUARANTINED');
  assert.equal(state.shadow_decision, 'SENSOR_FAULT');
  assert.equal(state.authoritative_decision, 'UNAUTHORIZED_PROCESS_CHANGE');
  assert.equal(state.facts.filter((fact) => fact.status === 'PROVEN').length, 4);
  assert.equal(verifyExerciseEventChain(state.events), true);
});

test('managed-agent failure escalates visibly and never advances to containment or approval', async () => {
  const effects = new FailingInvestigationEffects();
  const { manager, time, exerciseId } = await armedManager(effects);
  const observation = () => ({ observed_at: time.now().toISOString(), pump_state: 'DE_ENERGIZED' as const, independent_pressure_psi: 54, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE' as const, evidence_preserved: false, restoration_prepared: false });
  await manager.observe(exerciseId, observation());
  time.advance(15_000);
  const state = await manager.observe(exerciseId, observation());
  assert.equal(state.status, 'ESCALATED');
  assert.equal(state.pending_approval, undefined);
  assert.equal(effects.containmentCalls, 0);
  assert.equal(state.events.at(-1)?.kind, 'FLEET_INVESTIGATION_FAILED');
  assert.match(state.events.at(-1)?.summary ?? '', /AGENT_RUNTIME_TIMEOUT/);
});

test('approval is single-use and produces an evidence-cited report after deterministic verification', async () => {
  const { manager, effects, time, exerciseId } = await armedManager();
  const observation = () => ({ observed_at: time.now().toISOString(), pump_state: 'DE_ENERGIZED' as const, independent_pressure_psi: 54, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE' as const, evidence_preserved: false, restoration_prepared: false });
  await manager.observe(exerciseId, observation());
  time.advance(15_000);
  await manager.observe(exerciseId, observation());
  const completed = await manager.approve(exerciseId, 'APPROVE', 'local-operator', 'assertion-1');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(effects.restoreCalls, 1);
  assert.equal(completed.report?.verification.outcome, 'PASS');
  assert.equal(completed.report?.verification.stable_seconds, 30);
  assert.equal(completed.report?.event_chain_valid, true);
  assert.ok(completed.report?.event_ids.length);
  assert.equal(JSON.stringify(completed.report).includes(HOSTILE_SESSION_NOTE), false);
  await assert.rejects(() => manager.approve(exerciseId, 'APPROVE', 'local-operator', 'assertion-1'), /APPROVAL_NOT_PENDING/);
});

test('recovery progress is derived continuously from trusted process observations', async () => {
  const effects = new DeferredRestorationEffects();
  const { manager, time, exerciseId } = await armedManager(effects);
  const observation = (physical: number, pump_state: 'ENERGIZED' | 'DE_ENERGIZED' = 'DE_ENERGIZED') => ({ observed_at: time.now().toISOString(), pump_state, independent_pressure_psi: physical, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE' as const, evidence_preserved: true, restoration_prepared: true });
  await manager.observe(exerciseId, observation(54));
  time.advance(15_000);
  await manager.observe(exerciseId, observation(53));
  await manager.approve(exerciseId, 'APPROVE', 'local-operator', 'assertion-progress', false);

  let state = await manager.observe(exerciseId, observation(57, 'ENERGIZED'));
  assert.equal(state.recovery_elapsed_seconds, 0);
  assert.equal(state.recovery_started_at, undefined);
  time.advance(1_000);
  state = await manager.observe(exerciseId, observation(59, 'ENERGIZED'));
  assert.equal(state.recovery_elapsed_seconds, 0);
  time.advance(12_500);
  state = await manager.observe(exerciseId, observation(60, 'ENERGIZED'));
  assert.equal(state.recovery_elapsed_seconds, 12.5);
  time.advance(500);
  state = await manager.observe(exerciseId, observation(57.9, 'ENERGIZED'));
  assert.equal(state.recovery_elapsed_seconds, 0);
  assert.equal(state.recovery_started_at, undefined);

  effects.finish();
});

test('failed recovery escalates and cannot be called success by an agent', async () => {
  const { manager, effects, time, exerciseId } = await armedManager();
  effects.restoration = { outcome: 'FAIL', stableSeconds: 0, evidenceIds: ['evidence:pressure-timeout'] };
  const observation = () => ({ observed_at: time.now().toISOString(), pump_state: 'DE_ENERGIZED' as const, independent_pressure_psi: 54, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE' as const, evidence_preserved: false, restoration_prepared: false });
  await manager.observe(exerciseId, observation());
  time.advance(15_000);
  await manager.observe(exerciseId, observation());
  const state = await manager.approve(exerciseId, 'APPROVE', 'local-operator', 'assertion-2');
  assert.equal(state.status, 'ESCALATED');
  assert.equal(state.report?.verification.outcome, 'FAIL');
});

test('reporter prose is accepted only when every citation resolves to canonical evidence', async () => {
  const { manager, effects, time, exerciseId } = await armedManager();
  const observation = () => ({ observed_at: time.now().toISOString(), pump_state: 'DE_ENERGIZED' as const, independent_pressure_psi: 54, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE' as const, evidence_preserved: false, restoration_prepared: false });
  await manager.observe(exerciseId, observation());
  time.advance(15_000);
  await manager.observe(exerciseId, observation());
  effects.reportRecommendation = { summary: 'Canonical model-authored summary.', evidenceIds: ['evidence:restored-pump'] };
  const accepted = await manager.approve(exerciseId, 'APPROVE', 'local-operator', 'assertion-report-1');
  assert.equal(accepted.report?.executive_summary, 'Canonical model-authored summary.');

  const second = await armedManager();
  await second.manager.observe(second.exerciseId, { ...observation(), observed_at: second.time.now().toISOString() });
  second.time.advance(15_000);
  await second.manager.observe(second.exerciseId, { ...observation(), observed_at: second.time.now().toISOString() });
  second.effects.reportRecommendation = { summary: HOSTILE_SESSION_NOTE, evidenceIds: ['evidence:model-invented-authority'] };
  const rejected = await second.manager.approve(second.exerciseId, 'APPROVE', 'local-operator', 'assertion-report-2');
  assert.notEqual(rejected.report?.executive_summary, HOSTILE_SESSION_NOTE);
  assert.equal(JSON.stringify(rejected.report).includes('evidence:model-invented-authority'), false);
});
