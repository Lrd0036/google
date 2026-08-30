import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number.parseInt(process.env.PORT ?? '9400', 10);
const gatewayApi = process.env.GATEWAY_API ?? 'http://operator-gateway:9101/api/v1';
const processApi = process.env.PROCESS_API ?? 'http://process-plc:9101/api/v1';
const fleetApi = process.env.FLEET_API?.replace(/\/$/, '') ?? '';
const fleetBridgeToken = process.env.FLEET_BRIDGE_TOKEN ?? '';
const scenarioPath = process.env.SCENARIO_PATH ?? '/app/scenario.json';
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ??
    'http://localhost:3000,http://127.0.0.1:3000,https://royal-duke-cyber-range.lrd01.chatgpt.site')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
const actionById = new Map(scenario.actions.map((action) => [action.id, action]));
const streamClients = new Set();
let exerciseCreation = null;
let observationInFlight = false;
let actionInFlight = false;
let actionQueue = Promise.resolve();
let streamSnapshotInFlight = false;
let fleetRefreshInFlight = false;
let stateRevision = 0;
const state = {
  runId: crypto.randomUUID(),
  completedActions: [],
  events: [],
  defensive: { evidencePreserved: false, remoteWritesContained: false, restorationPrepared: false },
  exerciseId: null,
  fleet: null,
  provenance: [],
  startedAt: new Date().toISOString(),
};

function record(kind, summary, detail = {}) {
  state.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), kind, summary, detail });
  state.events = state.events.slice(0, 80);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const headers = {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  };
  if (origin && allowedOrigins.has(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

function reply(response, request, status, body) {
  response.writeHead(status, corsHeaders(request));
  response.end(JSON.stringify(body));
}

async function requestJson(url, options = {}) {
  const { timeoutMs = 2500, ...requestOptions } = options;
  const response = await fetch(url, { ...requestOptions, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  if (response.status === 204) return null;
  return response.json();
}

async function fleetRequest(path, options = {}) {
  if (!fleetApi) return null;
  const headers = { 'content-type': 'application/json', ...(fleetBridgeToken ? { 'x-royal-duke-bridge-token': fleetBridgeToken } : {}), ...(options.headers ?? {}) };
  return requestJson(`${fleetApi}${path}`, { ...options, headers, timeoutMs: 300_000 });
}

async function ensureExercise() {
  if (!fleetApi) return null;
  if (!state.exerciseId && !exerciseCreation) {
    const creatingForRunId = state.runId;
    exerciseCreation = fleetRequest('/exercises', { method: 'POST', body: JSON.stringify({ range_run_id: state.runId }) })
      .then((exercise) => {
        if (state.runId !== creatingForRunId) return null;
        state.exerciseId = exercise.exercise_id;
        state.fleet = exercise;
        return exercise.exercise_id;
      })
      .finally(() => { exerciseCreation = null; });
  }
  if (!state.exerciseId) await exerciseCreation;
  return state.exerciseId;
}

function processObservation(points) {
  return {
    observed_at: new Date().toISOString(),
    pump_state: Number(points['process.pump.actual']) ? 'ENERGIZED' : 'DE_ENERGIZED',
    independent_pressure_psi: Number(points['process.pressure.psi']),
    operator_pressure_psi: Number(points['operator.pressure.psi']),
    remote_write_path: state.defensive.remoteWritesContained ? 'CONTAINED' : 'AVAILABLE',
    evidence_preserved: state.defensive.evidencePreserved,
    restoration_prepared: state.defensive.restorationPrepared,
  };
}

async function submitObservation(points) {
  if (!fleetApi) return;
  const exerciseId = await ensureExercise();
  if (!exerciseId) return;
  const exercise = await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/observations`, {
    method: 'POST',
    body: JSON.stringify(processObservation(points)),
  });
  if (state.exerciseId === exerciseId) state.fleet = exercise;
}

async function refreshFleet() {
  if (!fleetApi) return;
  const exerciseId = await ensureExercise();
  if (!exerciseId) return;
  const [exercise, provenance] = await Promise.all([
    fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}`),
    fleetRequest(`/fleet/provenance?exercise_id=${encodeURIComponent(exerciseId)}`),
  ]);
  if (state.exerciseId === exerciseId) {
    state.fleet = exercise;
    state.provenance = provenance?.items ?? [];
  }
}

async function syncFleet(points) {
  if (!fleetApi) return;
  try {
    await submitObservation(points);
    await refreshFleet();
  } catch (error) {
    state.fleet = { status: 'BRIDGE_DEGRADED', error: error.message ?? 'fleet bridge failed' };
  }
}

function serializeAction(work) {
  const queued = actionQueue.then(async () => {
    actionInFlight = true;
    try {
      while (observationInFlight) await new Promise((resolve) => setTimeout(resolve, 20));
      return await work();
    } finally {
      actionInFlight = false;
    }
  });
  actionQueue = queued.catch(() => undefined);
  return queued;
}

async function writeTag(api, tag, value) {
  await requestJson(`${api}/write/${encodeURIComponent(tag)}/${encodeURIComponent(String(value))}`, { method: 'POST' });
}

function pointsByTag(result) {
  return Object.fromEntries((result?.points ?? []).map((point) => [point.tag, point.value]));
}

async function telemetry() {
  const [processResult, gatewayResult] = await Promise.allSettled([
    requestJson(`${processApi}/query`),
    requestJson(`${gatewayApi}/query`),
  ]);
  const processPoints = processResult.status === 'fulfilled' ? pointsByTag(processResult.value) : {};
  const gatewayPoints = gatewayResult.status === 'fulfilled' ? pointsByTag(gatewayResult.value) : {};
  return {
    services: {
      processPlc: processResult.status === 'fulfilled' ? 'online' : 'offline',
      operatorGateway: gatewayResult.status === 'fulfilled' ? 'online' : 'offline',
    },
    points: { ...processPoints, ...gatewayPoints },
    errors: [processResult, gatewayResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message ?? 'unknown telemetry error'),
  };
}

function stage() {
  return state.completedActions.reduce((max, id) => Math.max(max, actionById.get(id)?.stage ?? 0), 0);
}

function availableActions(points) {
  return scenario.actions.filter((action) => {
    if (action.control === 'system') return false;
    if (state.completedActions.includes(action.id)) return false;
    if (!action.prerequisites.every((id) => state.completedActions.includes(id))) return false;
    if (action.requiredDefense === 'remoteWritesContained' && !state.defensive.remoteWritesContained) return false;
    if (action.id === 'low_pressure_observed') return Number(points['process.pressure.psi']) < 52;
    return true;
  });
}

function automaticConditionSatisfied(action, points) {
  if (action.id === 'low_pressure_observed') {
    return Number(points['process.pressure.psi']) < Number(scenario.experience.thresholds.lowPressurePsi);
  }
  return false;
}

async function reconcileAutomaticActions(points) {
  for (const action of scenario.actions.filter((candidate) => candidate.control === 'system')) {
    if (state.completedActions.includes(action.id)) continue;
    if (!action.prerequisites.every((id) => state.completedActions.includes(id))) continue;
    if (!automaticConditionSatisfied(action, points)) continue;
    state.completedActions.push(action.id);
    record('observation', action.label, { outcome: 'DETERMINISTIC_CONDITION_MET', condition: action.condition, evidence: action.evidence });
    if (fleetApi) {
      const exerciseId = await ensureExercise();
      state.fleet = await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/attack`, { method: 'POST', body: JSON.stringify({ action_id: action.id }) });
    }
  }
}

async function currentState(sync = true) {
  const model = await telemetry();
  if (!actionInFlight) await reconcileAutomaticActions(model.points);
  if (sync && !actionInFlight) await syncFleet(model.points);
  return {
    revision: ++stateRevision,
    emittedAt: new Date().toISOString(),
    modelId: scenario.modelId,
    schemaVersion: scenario.schemaVersion,
    runId: state.runId,
    stage: stage(),
    startedAt: state.startedAt,
    completedActions: [...state.completedActions],
    availableActions: availableActions(model.points).map((action) => action.id),
    services: model.services,
    telemetry: model.points,
    telemetryErrors: model.errors,
    defensive: { ...state.defensive },
    exerciseId: state.exerciseId,
    fleet: state.fleet,
    provenance: state.provenance,
    events: state.events,
  };
}

function publishState(snapshot) {
  if (streamClients.size === 0) return;
  const message = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of streamClients) client.write(message);
}

async function publishCurrentState() {
  publishState(await currentState(false));
}

// Physical telemetry changes independently of HTTP actions. Stream it at a
// visual cadence so the map is a projection of the simulator, not a slide
// deck advanced by the browser.
setInterval(() => {
  if (streamClients.size === 0 || streamSnapshotInFlight) return;
  streamSnapshotInFlight = true;
  void publishCurrentState()
    .catch(() => {})
    .finally(() => { streamSnapshotInFlight = false; });
}, 250);

// Submit trusted observations asynchronously. The separate fleet read loop
// exposes intermediate Control states while a managed investigation is still
// running, instead of hiding them behind one long observation request.
setInterval(() => {
  if (!fleetApi || streamClients.size === 0 || observationInFlight || actionInFlight) return;
  observationInFlight = true;
  void telemetry()
    .then((model) => submitObservation(model.points))
    .then(() => publishCurrentState())
    .catch((error) => { state.fleet = { status: 'BRIDGE_DEGRADED', error: error.message ?? 'fleet bridge failed' }; })
    .finally(() => { observationInFlight = false; });
}, 1000);

setInterval(() => {
  if (!fleetApi || streamClients.size === 0 || fleetRefreshInFlight) return;
  fleetRefreshInFlight = true;
  void refreshFleet()
    .then(() => publishCurrentState())
    .catch((error) => { state.fleet = { status: 'BRIDGE_DEGRADED', error: error.message ?? 'fleet bridge failed' }; })
    .finally(() => { fleetRefreshInFlight = false; });
}, 500);

async function resetModel() {
  await writeTag(processApi, 'process.pump.command', 1);
  await writeTag(processApi, 'safety.interlock.enabled', 0);
  await writeTag(processApi, 'process.pressure.setpoint', 62);
  await writeTag(gatewayApi, 'operator.view.freeze', 0);
  await writeTag(gatewayApi, 'operator.view.hold-pressure', 62);
  state.runId = crypto.randomUUID();
  state.completedActions = [];
  state.events = [];
  state.defensive = { evidencePreserved: false, remoteWritesContained: false, restorationPrepared: false };
  state.exerciseId = null;
  exerciseCreation = null;
  state.fleet = null;
  state.provenance = [];
  state.startedAt = new Date().toISOString();
  record('reset', 'Range returned to the nominal operating state');
}

async function applyAction(action) {
  const missing = action.prerequisites.filter((id) => !state.completedActions.includes(id));
  if (missing.length) {
    const error = new Error(`Missing prerequisites: ${missing.join(', ')}`);
    error.status = 409;
    throw error;
  }
  if (state.completedActions.includes(action.id)) return;

  if (action.id === 'followup_write_attempt') {
    if (!state.defensive.remoteWritesContained) {
      const error = new Error('The follow-up write remains locked until the defensive fleet contains the affected path.');
      error.status = 409;
      throw error;
    }
    state.completedActions.push(action.id);
    record('blocked-action', action.label, { outcome: 'BLOCKED_BY_CONTAINMENT', evidence: action.evidence });
    if (fleetApi) {
      const exerciseId = await ensureExercise();
      state.fleet = await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/attack`, { method: 'POST', body: JSON.stringify({ action_id: action.id }) });
    }
    return;
  }

  if (action.id === 'operator_view_frozen') {
    await writeTag(gatewayApi, 'operator.view.hold-pressure', 62);
    await writeTag(gatewayApi, 'operator.view.freeze', 1);
  }
  if (action.id === 'pump_command_changed') {
    // The gateway's OT-sim Modbus client translates this message-bus update
    // into the allowlisted coil write configured for the process PLC.
    await writeTag(gatewayApi, 'process.pump.command', 0);
  }
  if (action.id === 'low_pressure_observed') {
    const model = await telemetry();
    const pressure = Number(model.points['process.pressure.psi']);
    if (!Number.isFinite(pressure) || pressure >= 52) {
      const error = new Error('Physical consequence not yet proven: process pressure has not crossed 52 PSI.');
      error.status = 409;
      throw error;
    }
  }

  state.completedActions.push(action.id);
  record('action', action.label, { plane: action.plane, evidence: action.evidence });
  if (fleetApi) {
    const exerciseId = await ensureExercise();
    state.fleet = await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/attack`, { method: 'POST', body: JSON.stringify({ action_id: action.id }) });
  }
}

async function applyDefensiveAction(action) {
  if (action === 'preserve-session') state.defensive.evidencePreserved = true;
  if (action === 'contain-remote-writes') state.defensive.remoteWritesContained = true;
  if (action === 'prepare-restoration') state.defensive.restorationPrepared = true;
  if (action === 'restore-pump') await writeTag(processApi, 'process.pump.command', 1);
  record('defensive-action', `Royal Duke defensive action: ${action}`, { action, authority: action === 'restore-pump' ? 'duty-plant-operator approval is external to the range controller' : 'preapproved containment' });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      const model = await telemetry();
      const healthy = Object.values(model.services).every((service) => service === 'online');
      reply(response, request, healthy ? 200 : 503, { status: healthy ? 'ok' : 'degraded', ...model.services });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/graph') {
      reply(response, request, 200, scenario);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/state') {
      reply(response, request, 200, await currentState(url.searchParams.get('sync') !== 'false'));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/events') {
      response.writeHead(200, {
        ...corsHeaders(request),
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      response.write('retry: 1000\n\n');
      streamClients.add(response);
      publishState(await currentState(false));
      request.on('close', () => streamClients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/reset') {
      const snapshot = await serializeAction(async () => {
        await resetModel();
        return currentState(false);
      });
      publishState(snapshot);
      reply(response, request, 200, snapshot);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/fleet/approve') {
      const snapshot = await serializeAction(async () => {
        const exerciseId = await ensureExercise();
        if (!exerciseId) throw Object.assign(new Error('Fleet control is not attached.'), { status: 503 });
        state.fleet = await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/approvals`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', principal: 'local-operator' }) });
        return currentState(false);
      });
      publishState(snapshot);
      reply(response, request, 200, snapshot);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/fleet/report') {
      const exerciseId = await ensureExercise();
      if (!exerciseId) {
        reply(response, request, 503, { error: 'Fleet control is not attached.' });
        return;
      }
      reply(response, request, 200, await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/report`));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/fleet/bundle') {
      const exerciseId = await ensureExercise();
      if (!exerciseId) {
        reply(response, request, 503, { error: 'Fleet control is not attached.' });
        return;
      }
      reply(response, request, 200, await fleetRequest(`/exercises/${encodeURIComponent(exerciseId)}/bundle`));
      return;
    }
    const defensiveMatch = request.method === 'POST' && url.pathname.match(/^\/api\/v1\/defensive\/([a-z-]+)$/);
    if (defensiveMatch) {
      const action = defensiveMatch[1];
      if (!['preserve-session', 'contain-remote-writes', 'prepare-restoration', 'restore-pump'].includes(action)) {
        reply(response, request, 404, { error: 'Unknown defensive action.' });
        return;
      }
      await applyDefensiveAction(action);
      // The capability adapter is called by Control through Broker. Do not
      // synchronously call Control again before replying or the bridge forms a
      // circular wait; the regular state poll reports the result afterward.
      const snapshot = await currentState(false);
      publishState(snapshot);
      reply(response, request, 200, snapshot);
      return;
    }
    const actionMatch = request.method === 'POST' && url.pathname.match(/^\/api\/v1\/actions\/([a-z0-9_]+)$/);
    if (actionMatch) {
      const action = actionById.get(actionMatch[1]);
      if (!action) {
        reply(response, request, 404, { error: 'Unknown action. Only scenario-defined actions are accepted.' });
        return;
      }
      if (action.control === 'system') {
        reply(response, request, 409, { error: 'This event is derived from authoritative process state and cannot be advanced manually.' });
        return;
      }
      const snapshot = await serializeAction(async () => {
        await applyAction(action);
        return currentState(false);
      });
      publishState(snapshot);
      reply(response, request, 200, snapshot);
      return;
    }
    reply(response, request, 404, { error: 'Not found' });
  } catch (error) {
    record('error', error.message ?? 'range controller error');
    reply(response, request, error.status ?? 503, { error: error.message ?? 'range controller error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  record('controller', `Range controller listening on ${port}`);
});
