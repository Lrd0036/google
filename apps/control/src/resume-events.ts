export interface ResumeEvent {
  schema: 'runbook-resume/v0.1';
  event_id: string;
  execution_id: string;
  cause: 'HUMAN_APPROVAL';
  approval_id: string;
  state_version: number;
}

export interface ResumeEventPublisher {
  publish(event: ResumeEvent): Promise<void>;
}

export type ResumeEventHandler = (event: ResumeEvent) => Promise<void> | void;

/** Records published events for deterministic local tests and embedded runs. */
export class MemoryResumeEventPublisher implements ResumeEventPublisher {
  readonly events: ResumeEvent[] = [];
  async publish(event: ResumeEvent): Promise<void> { this.events.push(event); }
}

/** Minimal Pub/Sub REST client that works with both the emulator and Google Pub/Sub. */
export class PubSubResumeEventPublisher implements ResumeEventPublisher {
  private readonly host: string;
  private readonly project: string;
  private readonly topic: string;
  private ready = false;

  constructor(options: { host?: string; project?: string; topic?: string; fetchImpl?: typeof fetch } = {}) {
    this.host = options.host ?? process.env.PUBSUB_EMULATOR_HOST ?? 'pubsub.googleapis.com';
    this.project = options.project ?? process.env.PUBSUB_PROJECT_ID ?? process.env.GCP_PROJECT ?? 'runbook-local-dev';
    this.topic = options.topic ?? process.env.PUBSUB_RESUME_TOPIC ?? 'rb-resume-events';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private readonly fetchImpl: typeof fetch;

  private baseUrl(): string { return `${this.host.startsWith('http') ? this.host : `http://${this.host}`}/v1/projects/${encodeURIComponent(this.project)}`; }

  private async ensureTopic(): Promise<void> {
    if (this.ready) return;
    const response = await this.fetchImpl(`${this.baseUrl()}/topics/${encodeURIComponent(this.topic)}`, { method: 'PUT' });
    if (!response.ok && response.status !== 409) throw new Error(`PUBSUB_TOPIC_CREATE_FAILED_${response.status}`);
    this.ready = true;
  }

  async publish(event: ResumeEvent): Promise<void> {
    await this.ensureTopic();
    const data = Buffer.from(JSON.stringify(event), 'utf8').toString('base64');
    const response = await this.fetchImpl(`${this.baseUrl()}/topics/${encodeURIComponent(this.topic)}:publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ data }] }),
    });
    if (!response.ok) throw new Error(`PUBSUB_PUBLISH_FAILED_${response.status}`);
  }
}

/** Pull consumer for the emulator or authenticated Google Pub/Sub REST API. */
export class PubSubResumeEventConsumer {
  private readonly host: string;
  private readonly project: string;
  private readonly subscription: string;
  private readonly fetchImpl: typeof fetch;
  private stopped = false;

  constructor(options: { host?: string; project?: string; subscription?: string; fetchImpl?: typeof fetch } = {}) {
    this.host = options.host ?? process.env.PUBSUB_EMULATOR_HOST ?? 'pubsub.googleapis.com';
    this.project = options.project ?? process.env.PUBSUB_PROJECT_ID ?? process.env.GCP_PROJECT ?? 'runbook-local-dev';
    this.subscription = options.subscription ?? process.env.PUBSUB_RESUME_SUBSCRIPTION ?? 'rb-resume-events-local-sub';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private baseUrl(): string { return `${this.host.startsWith('http') ? this.host : `http://${this.host}`}/v1/projects/${encodeURIComponent(this.project)}`; }

  async pullOnce(handler: ResumeEventHandler): Promise<number> {
    const response = await this.fetchImpl(`${this.baseUrl()}/subscriptions/${encodeURIComponent(this.subscription)}:pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ max_messages: 20 }) });
    if (!response.ok) throw new Error(`PUBSUB_PULL_FAILED_${response.status}`);
    const body = await response.json() as { receivedMessages?: Array<{ ackId?: string; message?: { data?: string } }> };
    const acknowledgements: string[] = [];
    for (const received of body.receivedMessages ?? []) {
      const encoded = received.message?.data;
      if (!encoded) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      const event = parsed as Partial<ResumeEvent>;
      if (event.schema !== 'runbook-resume/v0.1' || event.cause !== 'HUMAN_APPROVAL' || typeof event.event_id !== 'string' || typeof event.execution_id !== 'string' || typeof event.approval_id !== 'string' || typeof event.state_version !== 'number') continue;
      await handler(event as ResumeEvent);
      if (received.ackId) acknowledgements.push(received.ackId);
    }
    if (acknowledgements.length) {
      const ack = await this.fetchImpl(`${this.baseUrl()}/subscriptions/${encodeURIComponent(this.subscription)}:acknowledge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ackIds: acknowledgements }) });
      if (!ack.ok) throw new Error(`PUBSUB_ACK_FAILED_${ack.status}`);
    }
    return acknowledgements.length;
  }

  async start(handler: ResumeEventHandler, pollMs = 1000): Promise<void> {
    this.stopped = false;
    while (!this.stopped) { await this.pullOnce(handler); if (!this.stopped) await new Promise((resolve) => setTimeout(resolve, pollMs)); }
  }

  stop(): void { this.stopped = true; }
}
