import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.env.PORT || 8082);
const rangeController = process.env.ROYAL_DUKE_CONTROLLER_URL?.replace(/\/$/, '');
type PumpState = 'ENERGIZED' | 'DE_ENERGIZED';
type Operation = { operation_id: string; status: 'COMPLETED'; action: string; updated_at: string };
type ProcessState = {
  site: 'royal-duke-cooling-plant'; pump_id: 'P-101'; pump_state: PumpState;
  independent_pressure_psi: number; operator_pressure_psi: number;
  remote_write_path: 'AVAILABLE' | 'CONTAINED'; evidence_preserved: boolean;
  restoration_prepared: boolean; updated_at: string;
};

const operations = new Map<string, Operation>();
let sequence = 0;
let state: ProcessState = {
  site: 'royal-duke-cooling-plant', pump_id: 'P-101', pump_state: 'ENERGIZED',
  independent_pressure_psi: 62, operator_pressure_psi: 62, remote_write_path: 'AVAILABLE',
  evidence_preserved: false, restoration_prepared: false, updated_at: new Date().toISOString(),
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function operation(action: string): Operation {
  sequence += 1;
  const result = { operation_id: `rd_${action}_${Date.now()}_${sequence}`, status: 'COMPLETED' as const, action, updated_at: new Date().toISOString() };
  operations.set(result.operation_id, result);
  return result;
}
async function controller(path: string, method = 'GET'): Promise<unknown> {
  if (!rangeController) return undefined;
  const response = await fetch(`${rangeController}${path}`, { method, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`${response.status} from Royal Duke range controller`);
  return response.json();
}
function localState(): ProcessState {
  state.independent_pressure_psi = state.pump_state === 'DE_ENERGIZED'
    ? Math.max(18, state.independent_pressure_psi - 0.8)
    : Math.min(62, state.independent_pressure_psi + 1.2);
  state.updated_at = new Date().toISOString();
  return { ...state };
}
async function readState(): Promise<Record<string, unknown>> {
  // Capability calls originate from Control through Broker. Reading the range
  // with sync disabled prevents a circular callback into the in-flight Control
  // request while retaining the exact same OT-sim telemetry.
  const live = await controller('/api/v1/state?sync=false');
  if (live && typeof live === 'object') {
    const value = live as { telemetry?: Record<string, unknown>; defensive?: { evidencePreserved?: boolean; remoteWritesContained?: boolean; restorationPrepared?: boolean } };
    const points = value.telemetry ?? {};
    state.evidence_preserved = value.defensive?.evidencePreserved ?? state.evidence_preserved;
    state.remote_write_path = value.defensive?.remoteWritesContained ? 'CONTAINED' : state.remote_write_path;
    state.restoration_prepared = value.defensive?.restorationPrepared ?? state.restoration_prepared;
    return { site: 'royal-duke-cooling-plant', pump_id: 'P-101', pump_state: Number(points['process.pump.actual']) ? 'ENERGIZED' : 'DE_ENERGIZED', independent_pressure_psi: Number(points['process.pressure.psi']), operator_pressure_psi: Number(points['operator.pressure.psi']), remote_write_path: state.remote_write_path, evidence_preserved: state.evidence_preserved, restoration_prepared: state.restoration_prepared, updated_at: new Date().toISOString() };
  }
  return localState();
}
async function action(name: string): Promise<Record<string, unknown>> {
  if (name === 'preserve-session') {
    if (rangeController) await controller('/api/v1/defensive/preserve-session', 'POST');
    state.evidence_preserved = true;
  }
  if (name === 'contain-remote-writes') {
    if (rangeController) await controller('/api/v1/defensive/contain-remote-writes', 'POST');
    state.remote_write_path = 'CONTAINED';
  }
  if (name === 'prepare-restoration') {
    if (rangeController) await controller('/api/v1/defensive/prepare-restoration', 'POST');
    state.restoration_prepared = true;
  }
  if (name === 'restore-pump') {
    if (rangeController) await controller('/api/v1/defensive/restore-pump', 'POST');
    state.pump_state = 'ENERGIZED';
    state.independent_pressure_psi = Math.max(state.independent_pressure_psi, 58.1);
  }
  state.updated_at = new Date().toISOString();
  return { ...operation(name), process: await readState() };
}
async function verifyPressureStable(): Promise<Record<string, unknown>> {
  const requiredMs = Number(process.env.VERIFY_STABLE_SECONDS || 30) * 1000;
  const timeoutMs = Number(process.env.VERIFY_TIMEOUT_SECONDS || 60) * 1000;
  const started = Date.now();
  let stableSince: number | undefined;
  let current = await readState();
  while (Date.now() - started <= timeoutMs) {
    current = await readState();
    const pressure = Number(current.independent_pressure_psi);
    if (pressure > 58) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= requiredMs) return { ...current, verification: 'PASS', threshold_psi: 58, required_stable_seconds: requiredMs / 1000, observed_stable_seconds: (Date.now() - stableSince) / 1000 };
    } else stableSince = undefined;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ...current, verification: 'FAIL', threshold_psi: 58, required_stable_seconds: requiredMs / 1000, observed_stable_seconds: stableSince ? (Date.now() - stableSince) / 1000 : 0 };
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) text += chunk;
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('payload must be an object');
  return parsed as Record<string, unknown>;
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') { send(res, 200, { status: 'HEALTHY', service: 'royal-duke-worker', controller: rangeController ? 'connected' : 'local-model' }); return; }
    if (req.method === 'GET' && url.pathname === '/proof/process') { send(res, 200, await verifyPressureStable()); return; }
    if (req.method === 'GET' && url.pathname === '/capabilities/process-state') { send(res, 200, await readState()); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/operations/')) { const item = operations.get(decodeURIComponent(url.pathname.slice('/operations/'.length))); send(res, item ? 200 : 404, item ?? { error: 'OPERATION_NOT_FOUND' }); return; }
    if (req.method === 'POST' && url.pathname.startsWith('/capabilities/')) { await body(req); const name = url.pathname.slice('/capabilities/'.length); const allowed = new Set(['preserve-session', 'contain-remote-writes', 'prepare-restoration', 'restore-pump']); if (!allowed.has(name)) { send(res, 404, { error: 'CAPABILITY_NOT_DECLARED' }); return; } send(res, 200, await action(name)); return; }
    send(res, 404, { error: 'Not Found' });
  } catch (error) { send(res, 500, { error: error instanceof Error ? error.message : 'INTERNAL_ERROR' }); }
});
server.listen(port, () => console.log(`[royal-duke-worker] bounded capability provider listening on ${port}`));
