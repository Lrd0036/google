import assert from 'node:assert/strict';
import test from 'node:test';
import { PubSubResumeEventConsumer, PubSubResumeEventPublisher } from './resume-events.js';

test('Pub/Sub resume publisher creates topic once and publishes an encoded envelope', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response('{}', { status: 200 });
  };
  const publisher = new PubSubResumeEventPublisher({ host: 'http://pubsub.test', project: 'p', topic: 'resume', fetchImpl });
  const event = { schema: 'runbook-resume/v0.1' as const, event_id: 'resume-1', execution_id: 'exec-1', cause: 'HUMAN_APPROVAL' as const, approval_id: 'approval-1', state_version: 3 };
  await publisher.publish(event);
  await publisher.publish(event);
  assert.equal(requests.length, 3);
  const body = JSON.parse(String(requests[1]?.init?.body)) as { messages: Array<{ data: string }> };
  assert.deepEqual(JSON.parse(Buffer.from(body.messages[0]!.data, 'base64').toString('utf8')), event);
});

test('Pub/Sub consumer validates, handles, and acknowledges resume envelopes', async () => {
  const event = { schema: 'runbook-resume/v0.1' as const, event_id: 'resume-2', execution_id: 'exec-2', cause: 'HUMAN_APPROVAL' as const, approval_id: 'approval-2', state_version: 4 };
  let acknowledged = false;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith(':pull')) return new Response(JSON.stringify({ receivedMessages: [{ ackId: 'ack-1', message: { data: Buffer.from(JSON.stringify(event)).toString('base64') } }] }), { status: 200 });
    if (url.endsWith(':acknowledge')) { acknowledged = true; return new Response('{}', { status: 200 }); }
    throw new Error(`unexpected ${url}`);
  };
  const consumer = new PubSubResumeEventConsumer({ host: 'http://pubsub.test', project: 'p', subscription: 's', fetchImpl });
  let handled: unknown;
  assert.equal(await consumer.pullOnce((received) => { handled = received; }), 1);
  assert.deepEqual(handled, event);
  assert.equal(acknowledged, true);
});
