import { execFileSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const project = 'runbook-local-dev';
const topic = 'rb-resume-events';
const subscription = 'rb-resume-events-local-sub';
const base = `http://127.0.0.1:8086/v1/projects/${project}`;
const compose = ['compose', '-f', 'infra/docker/docker-compose.yml'];
const { PubSubResumeEventConsumer } = await import('../apps/control/dist/resume-events.js');

async function request(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok && response.status !== 409) throw new Error(`Pub/Sub emulator HTTP ${response.status}: ${path}`);
  return response;
}

try {
  execFileSync('docker', [...compose, 'up', '-d', 'pubsub-emulator'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/topics/${topic}`)).status !== 0) break; } catch { /* startup */ }
    await wait(250);
  }
  await request(`/topics/${topic}`, { method: 'PUT' });
  await request(`/subscriptions/${subscription}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: `projects/${project}/topics/${topic}` }) });
  const event = { schema: 'runbook-resume/v0.1', event_id: 'resume-local-pubsub-1', execution_id: 'exec-local-pubsub', cause: 'HUMAN_APPROVAL', approval_id: 'apr-local-pubsub', state_version: 2 };
  await request(`/topics/${topic}:publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from(JSON.stringify(event)).toString('base64') }] }) });
  let received;
  const consumer = new PubSubResumeEventConsumer({ host: 'http://127.0.0.1:8086', project, subscription });
  if (await consumer.pullOnce((value) => { received = value; }) !== 1 || JSON.stringify(received) !== JSON.stringify(event)) throw new Error('Pub/Sub resume envelope did not round-trip');
  console.log(JSON.stringify({ ok: true, pubsub_emulator: 'healthy', resume_envelope_round_trip: true }));
} finally {
  execFileSync('docker', [...compose, 'down'], { stdio: 'ignore' });
}
