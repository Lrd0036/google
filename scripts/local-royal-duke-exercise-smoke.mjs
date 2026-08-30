import { setTimeout as wait } from 'node:timers/promises';

const range = process.env.ROYAL_DUKE_RANGE_URL ?? 'http://127.0.0.1:9400';

async function request(path, method = 'GET') {
  const response = await fetch(`${range}${path}`, { method, signal: AbortSignal.timeout(120_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${body.error ?? response.status}`);
  return body;
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
}

await request('/api/v1/reset', 'POST');
for (const action of ['vendor_session_established', 'engineering_path_resolved', 'controller_context_acquired', 'prompt_injection_inserted', 'operator_view_frozen', 'pump_command_changed']) {
  await request(`/api/v1/actions/${action}`, 'POST');
}

let state;
for (let attempt = 0; attempt < 120; attempt += 1) {
  state = await request('/api/v1/state');
  if (state.fleet?.status === 'AWAITING_APPROVAL') break;
  await wait(1000);
}
requireValue(state?.fleet?.status === 'AWAITING_APPROVAL', `fleet did not reach approval boundary: ${state?.fleet?.status}`);
requireValue(state.defensive.evidencePreserved, 'session evidence was not preserved');
requireValue(state.defensive.remoteWritesContained, 'remote writes were not contained');
requireValue(state.fleet.injected_evidence?.trust === 'QUARANTINED', 'hostile evidence was not quarantined');
requireValue(state.fleet.shadow_decision === 'SENSOR_FAULT', 'shadow analyst did not demonstrate compromise');

state = await request('/api/v1/actions/followup_write_attempt', 'POST');
requireValue(state.events.some((event) => event.kind === 'blocked-action'), 'follow-up write was not blocked');
for (let attempt = 0; attempt < 20 && Number(state.telemetry['process.pressure.psi']) >= 52; attempt += 1) {
  await wait(500);
  state = await request('/api/v1/state');
}
for (let attempt = 0; attempt < 20 && !state.completedActions.includes('low_pressure_observed'); attempt += 1) {
  await wait(250);
  state = await request('/api/v1/state');
}
requireValue(state.completedActions.includes('low_pressure_observed'), 'low-pressure event was not derived from live telemetry');
await request('/api/v1/fleet/approve', 'POST');

let observedLiveRecoveryProgress = false;

for (let attempt = 0; attempt < 55; attempt += 1) {
  state = await request('/api/v1/state');
  if ((state.fleet?.recovery_elapsed_seconds ?? 0) > 0 && (state.fleet?.recovery_elapsed_seconds ?? 0) < 30) observedLiveRecoveryProgress = true;
  if (state.fleet?.status === 'COMPLETED' || state.fleet?.status === 'ESCALATED') break;
  await wait(1000);
}
requireValue(state.fleet?.status === 'COMPLETED', `exercise did not complete: ${state.fleet?.status}`);
requireValue(observedLiveRecoveryProgress, 'recovery timer did not expose intermediate process-derived progress');
requireValue(state.fleet.report?.verification?.outcome === 'PASS', 'deterministic recovery verification did not pass');
requireValue(state.fleet.report?.event_chain_valid === true, 'incident event chain is invalid');
requireValue(state.provenance.length === 10, 'institutional provenance panel is incomplete');

console.log(JSON.stringify({
  ok: true,
  exercise_id: state.exerciseId,
  campaign: state.fleet.campaign,
  shadow_decision: state.fleet.shadow_decision,
  authoritative_decision: state.fleet.authoritative_decision,
  model_armor: state.fleet.model_armor,
  blocked_followup_write: true,
  verification: state.fleet.report.verification,
  report_sha256: state.fleet.report.report_sha256,
  trace_id: state.fleet.trace_id,
  provenance: Object.fromEntries(state.provenance.map((item) => [item.key, item.status])),
}, null, 2));
