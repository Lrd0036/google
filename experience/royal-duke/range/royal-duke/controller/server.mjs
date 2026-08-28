import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number.parseInt(process.env.PORT ?? '9400', 10);
const gatewayApi = process.env.GATEWAY_API ?? 'http://operator-gateway:9101/api/v1';
const processApi = process.env.PROCESS_API ?? 'http://process-plc:9101/api/v1';
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
const state = {
  runId: crypto.randomUUID(),
  completedActions: [],
  events: [],
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
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  if (response.status === 204) return null;
  return response.json();
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
    if (state.completedActions.includes(action.id)) return false;
    if (!action.prerequisites.every((id) => state.completedActions.includes(id))) return false;
    if (action.id === 'low_pressure_observed') return Number(points['process.pressure.psi']) < 52;
    return true;
  });
}

async function currentState() {
  const model = await telemetry();
  return {
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
    events: state.events,
  };
}

async function resetModel() {
  await writeTag(processApi, 'process.pump.command', 1);
  await writeTag(processApi, 'safety.interlock.enabled', 0);
  await writeTag(processApi, 'process.pressure.setpoint', 62);
  await writeTag(gatewayApi, 'operator.view.freeze', 0);
  await writeTag(gatewayApi, 'operator.view.hold-pressure', 62);
  state.runId = crypto.randomUUID();
  state.completedActions = [];
  state.events = [];
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
      reply(response, request, 200, await currentState());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/reset') {
      await resetModel();
      reply(response, request, 200, await currentState());
      return;
    }
    const actionMatch = request.method === 'POST' && url.pathname.match(/^\/api\/v1\/actions\/([a-z0-9_]+)$/);
    if (actionMatch) {
      const action = actionById.get(actionMatch[1]);
      if (!action) {
        reply(response, request, 404, { error: 'Unknown action. Only scenario-defined actions are accepted.' });
        return;
      }
      await applyAction(action);
      reply(response, request, 200, await currentState());
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
