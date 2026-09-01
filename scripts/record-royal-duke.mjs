import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';

const repoRoot = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');
const skipStack = args.has('--skip-stack');
const keepServer = args.has('--keep-server');
const allowFallback = args.has('--allow-fallback');
const baseUrl = process.env.ROYAL_DUKE_RECORD_URL ?? 'http://127.0.0.1:3000';
const recordUrl = new URL(baseUrl);
if (recordUrl.protocol !== 'http:') throw new Error('ROYAL_DUKE_RECORD_URL must use http for the local recorder.');
const recordHost = recordUrl.hostname;
const recordPort = recordUrl.port || '80';
const liveControlUrl = 'http://127.0.0.1:8083';
const rangeDir = resolve(repoRoot, 'experience/royal-duke');
const outputDir = resolve(repoRoot, 'experience/royal-duke/output/playwright/recordings');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const webmPath = resolve(outputDir, `royal-duke-incident-${stamp}.webm`);
const mp4Path = resolve(outputDir, `royal-duke-incident-${stamp}.mp4`);
let devServer;
let liveControl;
let browser;
let context;
let rangeUsesLiveControl = false;

function log(message) {
  process.stdout.write(`[royal-duke-recorder] ${message}\n`);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await responds(url)) return;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/royal-duke${path}`, {
    ...options,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path}: ${body.error ?? response.status}`);
  return body;
}

async function waitForState(predicate, description, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await api('/state');
    if (predicate(state)) return state;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${description}; last fleet state was ${state?.fleet?.status ?? 'DETACHED'}`);
}

function verifiedProofs(state) {
  return new Set((state.provenance ?? []).filter((item) => item.status === 'VERIFIED').map((item) => item.key));
}

function failIfEscalated(state) {
  if (state.fleet?.status !== 'ESCALATED') return;
  const failure = [...(state.fleet.events ?? [])].reverse().find((event) => event.kind === 'FLEET_INVESTIGATION_FAILED' || event.kind === 'VERIFY_FAIL');
  throw new Error(failure?.summary ?? 'The live exercise escalated before completing the requested boundary.');
}

function assertLiveCompletion(state) {
  const activities = state.fleet?.activities ?? [];
  const expectedAgents = new Set(['Incident Commander', 'Evidence Correlator', 'Adversarial Content Analyst', 'Process Safety Coordinator', 'Incident Reporter', 'Shadow Analyst']);
  const liveAgents = new Set(activities.filter((item) => item.execution_mode === 'LIVE_MODEL').map((item) => item.agent_name));
  const missing = [...expectedAgents].filter((name) => !liveAgents.has(name));
  if (missing.length) throw new Error(`Managed fleet did not execute every role: ${missing.join(', ')}`);
  if (activities.find((item) => item.agent_name === 'Shadow Analyst')?.status !== 'COMPROMISED') {
    throw new Error('The live Shadow Analyst did not follow the injected classification; no compromise may be claimed.');
  }
  if (state.fleet?.model_armor?.invocation_result !== 'SUCCESS') throw new Error('Model Armor did not return a successful live verdict.');
  const requiredProofs = ['lifecycle', 'identity', 'runtime', 'memory', 'governance', 'content-security', 'state', 'messaging', 'observability', 'model'];
  const proofs = verifiedProofs(state);
  const unavailable = requiredProofs.filter((key) => !proofs.has(key));
  if (unavailable.length) throw new Error(`Submission provenance is not fully verified: ${unavailable.join(', ')}`);
}

async function clickAction(page, name, holdMs = 900) {
  const button = page.getByRole('button', { name, exact: true });
  await button.waitFor({ state: 'visible', timeout: 120_000 });
  await button.click();
  await wait(holdMs);
}

async function commandExists(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
  return result.status === 0;
}

async function stopDevServer() {
  if (!devServer || keepServer) return;
  devServer.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => devServer.once('exit', resolveExit)),
    wait(3000),
  ]);
}


async function stopLiveControl() {
  if (!liveControl) return;
  liveControl.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => liveControl.once('exit', resolveExit)),
    wait(5000),
  ]);
}

function pointRangeAt(fleetApi) {
  const result = spawnSync('docker', ['compose', '-f', 'range/royal-duke/docker-compose.yml', 'up', '-d', '--force-recreate', 'range-controller'], {
    cwd: rangeDir,
    stdio: 'inherit',
    env: { ...process.env, FLEET_API: fleetApi, FLEET_BRIDGE_TOKEN: 'royal-duke-local-demo-bridge-v1' },
  });
  if (result.status !== 0) throw new Error(`Unable to connect the range controller to ${fleetApi}`);
}

async function startLiveControl() {
  log('Building and starting a live local bridge to the managed Agent Runtime fleet.');
  run('pnpm', ['--filter', '@runbook/control', 'build']);
  const runtimeManifest = JSON.parse(await readFile(resolve(repoRoot, '.local/royal-duke-agent-runtime.json'), 'utf8'));
  const environment = {
    ...process.env,
    PORT: '8083',
    GCP_PROJECT: 'project-87ae1ae6-1a71-468d-943',
    GOOGLE_CLOUD_PROJECT: 'project-87ae1ae6-1a71-468d-943',
    GCP_REGION: 'us-central1',
    DEPLOYMENT_MODE: 'local',
    LOCAL_ORCHESTRATION: 'true',
    LOCAL_AUTHORITY: 'true',
    LOCAL_AUTHORITY_ID: 'local-incident-commander',
    LOCAL_OPERATOR_PRINCIPALS: 'local-operator',
    BROKER_URL: 'http://127.0.0.1:8081',
    FLEET_BRIDGE_TOKEN: 'royal-duke-local-demo-bridge-v1',
    LIVE_GEMINI_JUDGMENT: 'true',
    MODEL_ADAPTER: 'gemini',
    AGENT_RUNTIME_RESOURCES: JSON.stringify(runtimeManifest),
    AGENT_GATEWAY_RESOURCE: 'projects/project-87ae1ae6-1a71-468d-943/locations/us-central1/agentGateways/royal-duke-egress',
    MODEL_ARMOR_TEMPLATE: 'projects/project-87ae1ae6-1a71-468d-943/locations/us-central1/templates/royal-duke-agent-defense',
    FLEET_PUBSUB_TOPIC: 'projects/project-87ae1ae6-1a71-468d-943/topics/royal-duke-fleet-events',
    FLEET_PUBSUB_SUBSCRIPTION: 'projects/project-87ae1ae6-1a71-468d-943/subscriptions/royal-duke-fleet-control',
    RETRIEVED_MEMORY_ID: 'projects/248197109620/locations/us-central1/reasoningEngines/3788588865095204864/memories/8239286933604270080',
    GEMINI_MODEL: runtimeManifest.model ?? 'gemini-3.5-flash',
  };
  delete environment.FIRESTORE_EMULATOR_HOST;
  delete environment.PUBSUB_EMULATOR_HOST;
  liveControl = spawn('node', ['apps/control/dist/index.js'], { cwd: repoRoot, env: environment, stdio: ['ignore', 'inherit', 'inherit'] });
  await waitForUrl(`${liveControlUrl}/health`, 60_000);
  pointRangeAt('http://host.docker.internal:8083');
  rangeUsesLiveControl = true;
  await waitForUrl('http://127.0.0.1:9400/health', 60_000);
}

await mkdir(outputDir, { recursive: true });

try {
  if (!skipStack) {
    log('Starting the bounded local Control, Broker, fleet bridge, and OT-sim range.');
    run('pnpm', ['demo:up']);
  }

  if (!allowFallback) {
    await startLiveControl();
  } else {
    log('Fallback recording explicitly enabled; managed-agent participation is not required.');
  }

  if (!(await responds(baseUrl))) {
    log('Starting the Royal Duke web application.');
    devServer = spawn('pnpm', ['--filter', '@runbook/console', 'exec', 'vite', '--host', recordHost, '--port', recordPort, '--strictPort'], {
      cwd: repoRoot,
      env: { ...process.env, ROYAL_DUKE_CONTROLLER_URL: process.env.ROYAL_DUKE_CONTROLLER_URL ?? 'http://127.0.0.1:9400' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  }
  await waitForUrl(baseUrl);
  await waitForUrl(`${baseUrl}/api/royal-duke/state`);

  log('Resetting the incident and waiting for nominal physical state.');
  await api('/reset', { method: 'POST' });
  await waitForState((state) => Number(state.telemetry?.['process.pressure.psi']) > 58 && state.telemetry?.['process.pump.actual'] === 1, 'nominal pressure');
  if (!allowFallback) {
    const requiredBeforeIncident = ['lifecycle', 'identity', 'runtime', 'memory', 'governance', 'state', 'messaging', 'model'];
    await waitForState((state) => {
      const proofs = verifiedProofs(state);
      return requiredBeforeIncident.every((key) => proofs.has(key));
    }, 'managed fleet submission readiness', 180_000);
  }

  browser = await chromium.launch({ headless: !headed });
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outputDir, size: { width: 1920, height: 1080 } },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const video = page.video();
  if (!video) throw new Error('Playwright did not initialize video recording.');

  log('Recording the guided attack.');
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.getByRole('button', { name: 'BEGIN ATTACK', exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
  await wait(2500);
  await clickAction(page, 'BEGIN ATTACK');
  await clickAction(page, 'Resolve the engineering path');
  await clickAction(page, 'Acquire controller project context');
  await clickAction(page, 'Poison the defensive evidence stream', 1600);
  await clickAction(page, 'Freeze the operator pressure view');
  await clickAction(page, 'Change the pump command', 1400);

  log('Recording the deterministic 15-second divergence condition.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await waitForState((state) => {
    failIfEscalated(state);
    return state.fleet?.status === 'AWAITING_APPROVAL';
  }, 'defensive containment and approval boundary', 300_000);
  await wait(1800);

  await page.getByRole('button', { name: 'Control panel', exact: true }).click();
  await wait(1800);
  await clickAction(page, 'Attempt another controller write', 2200);
  const contained = await api('/state');
  if (contained.telemetry?.['process.pump.command'] !== 0 || contained.fleet?.latest_observation?.remote_write_path !== 'CONTAINED') {
    throw new Error('The post-containment write was not visibly blocked.');
  }

  log('Recording the human approval boundary and deterministic recovery.');
  await clickAction(page, 'SIGN & APPROVE RESTORATION', 1600);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const completedState = await waitForState(
    (state) => {
      failIfEscalated(state);
      return state.fleet?.status === 'COMPLETED' && (state.fleet.activities ?? []).some((item) => item.agent_name === 'Incident Reporter');
    },
    '30-second physical recovery verification and incident reporter completion',
    300_000,
  );
  if (!allowFallback) assertLiveCompletion(completedState);
  await wait(1800);

  await page.getByRole('button', { name: 'Control panel', exact: true }).click();
  await page.getByText('Post-incident report', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await wait(7000);

  await context.close();
  context = undefined;
  const rawVideoPath = await video.path();
  await rename(rawVideoPath, webmPath);
  log(`WebM recording: ${webmPath}`);

  if (await commandExists('ffmpeg')) {
    log('Converting the recording to presentation-compatible MP4.');
    run('ffmpeg', ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path]);
    await access(mp4Path, constants.R_OK);
    log(`MP4 recording: ${mp4Path}`);
  } else {
    log('FFmpeg is not installed; the Playwright WebM is ready. Install FFmpeg and rerun for automatic MP4 conversion.');
  }
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  await stopDevServer();
  if (rangeUsesLiveControl) {
    log('Restoring the range controller to the ordinary local Control service.');
    pointRangeAt('http://host.docker.internal:8080');
  }
  await stopLiveControl();
}
