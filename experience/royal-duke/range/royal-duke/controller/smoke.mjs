const base = process.env.RANGE_API ?? 'http://127.0.0.1:9400';
const actions = [
  'vendor_session_established',
  'engineering_path_resolved',
  'controller_context_acquired',
  'prompt_injection_inserted',
  'operator_view_frozen',
  'pump_command_changed',
];

async function call(path, method = 'GET') {
  const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(120_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `${method} ${path} returned ${response.status}`);
  return body;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function waitForStream(predicate, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/v1/events`, { signal: controller.signal });
    assert(response.ok && response.body, 'real-time state stream did not open');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('real-time state stream closed');
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() ?? '';
      for (const message of messages) {
        const data = message.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
        if (data) {
          const snapshot = JSON.parse(data);
          if (predicate(snapshot)) return snapshot;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

let passed = false;
try {
  const reset = await call('/api/v1/reset', 'POST');
  assert(reset.services.processPlc === 'online', 'process PLC is offline');
  assert(reset.services.operatorGateway === 'online', 'operator gateway is offline');
  assert(reset.telemetry['process.pump.actual'] === 1, 'pump did not reset to running');

  let streamedRevision = reset.revision;
  for (const action of actions) {
    const streamed = waitForStream((snapshot) => snapshot.completedActions.includes(action));
    await call(`/api/v1/actions/${action}`, 'POST');
    const snapshot = await streamed;
    assert(snapshot.revision > streamedRevision, 'real-time stream revision did not advance');
    streamedRevision = snapshot.revision;
  }

  let state;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    state = await call('/api/v1/state');
    if (state.telemetry['process.pressure.psi'] < 52) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert(state.telemetry['process.pump.actual'] === 0, 'Modbus-backed pump state did not change');
  assert(state.telemetry['process.pressure.psi'] < 52, 'physical pressure did not cross 52 PSI');
  assert(state.telemetry['operator.pressure.psi'] === 62, 'operator view did not remain frozen at 62 PSI');
  assert(state.telemetry['alarm.low-pressure'] === 1, 'low-pressure alarm did not assert');

  await call('/api/v1/defensive/contain-remote-writes', 'POST');
  const blocked = await call('/api/v1/actions/followup_write_attempt', 'POST');
  assert(blocked.events.some((event) => event.kind === 'blocked-action'), 'follow-up controller write was not visibly blocked');
  const manualObservation = await fetch(`${base}/api/v1/actions/low_pressure_observed`, { method: 'POST' });
  assert(manualObservation.status === 409, 'process observation was incorrectly exposed as a manual story action');
  let final = blocked;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    final = await call('/api/v1/state');
    if (final.completedActions.includes('low_pressure_observed')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(final.completedActions.includes('low_pressure_observed'), 'low-pressure evidence was not derived from process telemetry');
  assert(final.stage === 5, 'final consequence gate did not complete');
  passed = true;
  console.log(
    JSON.stringify(
      {
        result: 'pass',
        stage: final.stage,
        operatorPressure: final.telemetry['operator.pressure.psi'],
        physicalPressure: final.telemetry['process.pressure.psi'],
        pump: final.telemetry['process.pump.actual'],
        lowPressureAlarm: final.telemetry['alarm.low-pressure'],
        realtimeStream: 'pass',
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await call('/api/v1/reset', 'POST');
  } catch (error) {
    if (passed) throw error;
  }
}
