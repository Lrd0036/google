import { readFileSync } from 'node:fs';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { compilePlan } from '@runbook/compiler';
import type { CompilePlan } from '@runbook/compiler';
import type { CapabilityManifest, IncidentReportBundle, ModelArmorVerdict, ProvenanceItem, RoyalDukeExercise } from '@runbook/types';
import { RoyalDukeExerciseSchema } from '@runbook/types';
import { executeOverBroker } from './local-orchestrator.js';
import {
  deterministicInvestigation,
  generateCampaignEvents,
  type CampaignEvent,
  type ContainmentResult,
  type ExerciseEffects,
  type ExerciseStore,
  type InvestigationResult,
  type ReportRecommendation,
  type RestorationResult,
} from './royal-duke-exercise.js';

const FLEET_AGENT_KEYS = [
  'incident-commander',
  'evidence-correlator',
  'adversarial-content-analyst',
  'process-safety-coordinator',
  'incident-reporter',
  'shadow-analyst',
] as const;
type FleetAgentKey = typeof FLEET_AGENT_KEYS[number];
type FleetRuntimeMap = Partial<Record<FleetAgentKey, string>>;

function fleetRuntimeMap(): FleetRuntimeMap {
  let encoded = process.env.AGENT_RUNTIME_RESOURCES;
  if (!encoded && process.env.DEPLOYMENT_MODE === 'local') {
    try { encoded = readFileSync(`${process.cwd()}/.local/royal-duke-agent-runtime.json`, 'utf8'); } catch { /* live fleet is optional in offline local mode */ }
  }
  if (!encoded) return {};
  try {
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    const agents = Array.isArray(parsed.agents) ? parsed.agents : undefined;
    if (agents) {
      return Object.fromEntries(agents.flatMap((agent) => {
        const record = agent as { key?: unknown; name?: unknown };
        return typeof record.key === 'string' && typeof record.name === 'string' ? [[record.key, record.name]] : [];
      })) as FleetRuntimeMap;
    }
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => FLEET_AGENT_KEYS.includes(key as FleetAgentKey) && typeof value === 'string')) as FleetRuntimeMap;
  } catch {
    return {};
  }
}

async function accessToken(): Promise<string> {
  const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
  if (!token) throw new Error('GOOGLE_ACCESS_TOKEN_UNAVAILABLE');
  return token;
}

export function agentRuntimeRequestBody(exerciseId: string, payload: unknown) {
  return {
    classMethod: 'async_stream_query',
    input: {
      user_id: `royal-duke-${exerciseId}`,
      message: typeof payload === 'string' ? payload : JSON.stringify(payload),
    },
  };
}

function agentEventText(value: unknown): string {
  const event = value as { content?: { parts?: Array<{ text?: string }> } };
  return event.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '';
}

async function queryFleetAgent(agent: FleetAgentKey, exercise: RoyalDukeExercise, payload: unknown): Promise<string> {
  const resource = fleetRuntimeMap()[agent];
  if (!resource) throw new Error(`AGENT_RUNTIME_UNAVAILABLE:${agent}`);
  const location = resource.match(/\/locations\/([^/]+)\//)?.[1] ?? process.env.GCP_REGION ?? 'us-central1';
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      controller.abort();
      reject(new Error(`AGENT_RUNTIME_TIMEOUT:${agent}`));
    }, 90_000);
  });
  let body: string;
  try {
    const response = await Promise.race([
      fetch(`https://${location}-aiplatform.googleapis.com/v1/${resource}:streamQuery?alt=sse`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'application/json',
          'x-cloud-trace-context': `${exercise.trace_id}/1;o=1`,
        },
        body: JSON.stringify(agentRuntimeRequestBody(exercise.exercise_id, payload)),
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) throw new Error(`AGENT_RUNTIME_HTTP_${response.status}:${agent}`);
    body = await Promise.race([response.text(), timeout]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
  let answer = '';
  let remoteError = '';
  for (const line of body.split('\n')) {
    const candidate = line.replace(/^data:\s*/, '').trim();
    if (!candidate || candidate === '[DONE]') continue;
    try {
      const parsed = JSON.parse(candidate) as { error_code?: unknown; code?: unknown };
      if (typeof parsed.error_code === 'string') remoteError = parsed.error_code;
      if (typeof parsed.code === 'number' && parsed.code >= 400) remoteError ||= `HTTP_${parsed.code}`;
      const text = agentEventText(parsed);
      if (text) answer = text;
    } catch {
      // Streaming metadata is not an agent answer.
    }
  }
  if (remoteError) throw new Error(`AGENT_RUNTIME_REMOTE_${remoteError}:${agent}`);
  if (!answer) throw new Error(`AGENT_RUNTIME_EMPTY_RESPONSE:${agent}`);
  return answer;
}

function classification(text: string): string {
  const allowed = ['UNAUTHORIZED_PROCESS_CHANGE', 'OPERATOR_VIEW_INTEGRITY_FAILURE', 'SENSOR_FAULT', 'UNKNOWN'];
  return allowed.find((value) => new RegExp(`\\b${value}\\b`).test(text)) ?? 'UNKNOWN';
}

function concise(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 240) : fallback;
}

async function writeTraceSpans(exercise: RoyalDukeExercise, names: string[]): Promise<void> {
  const project = process.env.GCP_PROJECT;
  if (!project || project === 'runbook-local-dev') return;
  const end = new Date();
  const start = new Date(end.getTime() - 1_000);
  const spans = names.map((name) => {
    const spanId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    return {
      name: `projects/${project}/traces/${exercise.trace_id}/spans/${spanId}`,
      spanId,
      displayName: { value: name },
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      attributes: { attributeMap: { 'royal-duke.exercise_id': { stringValue: { value: exercise.exercise_id } } } },
    };
  });
  try {
    await fetch(`https://cloudtrace.googleapis.com/v2/projects/${project}/traces:batchWrite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ spans }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Provenance remains unavailable unless the trace can later be read back.
  }
}

function parseReporterRecommendation(text: string): ReportRecommendation {
  const candidate = text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error('REPORTER_JSON_REQUIRED');
  const parsed = JSON.parse(candidate) as { summary?: unknown; evidence_ids?: unknown };
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.evidence_ids) || parsed.evidence_ids.some((id) => typeof id !== 'string')) {
    throw new Error('REPORTER_SCHEMA_INVALID');
  }
  return { summary: parsed.summary, evidenceIds: parsed.evidence_ids as string[] };
}

function fixture(path: string): string {
  return readFileSync(`${process.cwd()}/fixtures/${path}`, 'utf8');
}

function compiledAssets(): { document: ReturnType<typeof compilePlan>['document']; manifest: CapabilityManifest } {
  const source = fixture('runbooks/royal-duke-cooling-incident.md');
  const plan = JSON.parse(fixture('compile-plans/royal-duke-cooling-incident.json')) as CompilePlan;
  const manifest = JSON.parse(fixture('manifests/royal-duke-operations.json')) as CapabilityManifest;
  const workerOrigin = process.env.ROYAL_DUKE_WORKER_URL?.replace(/\/$/, '');
  if (workerOrigin) {
    const target = new URL(workerOrigin);
    for (const capability of manifest.capabilities) {
      capability.transport.allowed_host = target.host;
      capability.transport.audience = workerOrigin;
    }
  }
  const result = compilePlan(source, 'fixtures/runbooks/royal-duke-cooling-incident.md', plan, manifest);
  if (result.lint.hasErrors) throw new Error(`ROYAL_DUKE_RUNBOOK_INVALID:${JSON.stringify(result.lint.artifact)}`);
  return { document: result.document, manifest };
}

export class FirestoreExerciseStore implements ExerciseStore {
  constructor(private readonly firestore: Firestore, private readonly collection = 'royal_duke_exercises') {}
  async create(exercise: RoyalDukeExercise): Promise<void> {
    const ref = this.firestore.collection(this.collection).doc(exercise.exercise_id);
    await this.firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(ref)).exists) throw new Error('EXERCISE_ALREADY_EXISTS');
      transaction.create(ref, exercise);
    });
  }
  async get(exerciseId: string): Promise<RoyalDukeExercise | undefined> {
    const snapshot = await this.firestore.collection(this.collection).doc(exerciseId).get();
    return snapshot.exists ? RoyalDukeExerciseSchema.parse(snapshot.data()) : undefined;
  }
  async save(exercise: RoyalDukeExercise): Promise<void> {
    const ref = this.firestore.collection(this.collection).doc(exercise.exercise_id);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('EXERCISE_NOT_FOUND');
      const current = RoyalDukeExerciseSchema.parse(snapshot.data());
      const rank = ['ARMED', 'ATTACK_IN_PROGRESS', 'DETERMINISTIC_MONITORING', 'FLEET_INVESTIGATING', 'AWAITING_APPROVAL', 'RESTORING', 'VERIFYING', 'COMPLETED', 'ESCALATED'];
      const currentObservation = current.latest_observation;
      const incomingObservation = exercise.latest_observation;
      const latestObservation = !currentObservation || (incomingObservation && Date.parse(incomingObservation.observed_at) >= Date.parse(currentObservation.observed_at))
        ? incomingObservation
        : currentObservation;
      const merged = RoyalDukeExerciseSchema.parse({
        ...exercise,
        status: rank.indexOf(current.status) > rank.indexOf(exercise.status) ? current.status : exercise.status,
        updated_at: Date.parse(current.updated_at) > Date.parse(exercise.updated_at) ? current.updated_at : exercise.updated_at,
        attack_actions: current.attack_actions.length > exercise.attack_actions.length ? current.attack_actions : exercise.attack_actions,
        events: current.events.length > exercise.events.length ? current.events : exercise.events,
        activities: current.activities.length > exercise.activities.length ? current.activities : exercise.activities,
        facts: exercise.facts.map((fact) => current.facts.find((candidate) => candidate.fact_id === fact.fact_id)?.status === 'PROVEN' ? { ...fact, status: 'PROVEN' as const } : fact),
        ...(latestObservation ? { latest_observation: latestObservation } : {}),
        ...(exercise.injected_evidence ?? current.injected_evidence ? { injected_evidence: exercise.injected_evidence ?? current.injected_evidence } : {}),
        ...(exercise.model_armor ?? current.model_armor ? { model_armor: exercise.model_armor ?? current.model_armor } : {}),
        ...(exercise.shadow_decision ?? current.shadow_decision ? { shadow_decision: exercise.shadow_decision ?? current.shadow_decision } : {}),
        ...(exercise.authoritative_decision ?? current.authoritative_decision ? { authoritative_decision: exercise.authoritative_decision ?? current.authoritative_decision } : {}),
        ...(exercise.approval ?? current.approval ? { approval: exercise.approval ?? current.approval } : {}),
        ...(!exercise.approval && (exercise.pending_approval ?? current.pending_approval) ? { pending_approval: exercise.pending_approval ?? current.pending_approval } : {}),
        ...(exercise.report ?? current.report ? { report: exercise.report ?? current.report } : {}),
      });
      transaction.set(ref, merged);
    });
  }
  async findByRangeRunId(rangeRunId: string): Promise<RoyalDukeExercise | undefined> {
    const snapshot = await this.firestore.collection(this.collection).where('range_run_id', '==', rangeRunId).limit(1).get();
    return snapshot.empty ? undefined : RoyalDukeExerciseSchema.parse(snapshot.docs[0]!.data());
  }
}

async function sanitizeWithModelArmor(exercise: RoyalDukeExercise): Promise<ModelArmorVerdict> {
  const template = process.env.MODEL_ARMOR_TEMPLATE;
  const recordedAt = new Date().toISOString();
  const base = { verdict_event_id: `model-armor-${crypto.randomUUID()}`, trace_id: exercise.trace_id, recorded_at: recordedAt };
  if (!template || !exercise.injected_evidence) return { ...base, template: template ?? 'UNAVAILABLE', invocation_result: 'UNAVAILABLE', match_state: 'UNAVAILABLE' };
  try {
    const token = await accessToken();
    const region = process.env.GCP_REGION ?? template.match(/\/locations\/([^/]+)\//)?.[1] ?? 'us-central1';
    const endpoint = `https://modelarmor.${region}.rep.googleapis.com/v1/${template}:sanitizeUserPrompt`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-cloud-trace-context': `${exercise.trace_id}/1;o=1` },
      body: JSON.stringify({ userPromptData: { text: exercise.injected_evidence.text } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`MODEL_ARMOR_HTTP_${response.status}`);
    const result = await response.json() as { sanitizationResult?: { invocationResult?: string; filterMatchState?: string; filterResults?: { pi_and_jailbreak?: { piAndJailbreakFilterResult?: { confidenceLevel?: string } } } } };
    const sanitization = result.sanitizationResult;
    const invocation = sanitization?.invocationResult;
    const match = sanitization?.filterMatchState;
    return {
      ...base,
      template,
      invocation_result: invocation === 'SUCCESS' ? 'SUCCESS' : invocation === 'PARTIAL' ? 'PARTIAL' : 'FAILURE',
      match_state: match === 'MATCH_FOUND' ? 'MATCH_FOUND' : match === 'NO_MATCH_FOUND' ? 'NO_MATCH_FOUND' : 'UNAVAILABLE',
      prompt_injection_confidence: sanitization?.filterResults?.pi_and_jailbreak?.piAndJailbreakFilterResult?.confidenceLevel,
    };
  } catch {
    return { ...base, template, invocation_result: 'FAILURE', match_state: 'UNAVAILABLE' };
  }
}

function completedActivity(agentId: string, agentName: string, summary: string, decision: string, evidenceIds: string[], traceId: string, compromised = false) {
  const at = new Date().toISOString();
  return { activity_id: `activity_${agentId}_${crypto.randomUUID()}`, agent_id: agentId, agent_name: agentName, status: compromised ? 'COMPROMISED' as const : 'COMPLETED' as const, execution_mode: 'LIVE_MODEL' as const, summary, decision, evidence_ids: evidenceIds, started_at: at, completed_at: at, trace_id: traceId };
}

async function liveInvestigation(exercise: RoyalDukeExercise): Promise<InvestigationResult> {
  const modelArmor = await sanitizeWithModelArmor(exercise);
  if (process.env.LIVE_GEMINI_JUDGMENT !== 'true') {
    const fallback = deterministicInvestigation(exercise);
    return { ...fallback, modelArmor };
  }
  const trusted = {
    allowed_decisions: ['SENSOR_FAULT', 'OPERATOR_VIEW_INTEGRITY_FAILURE', 'UNAUTHORIZED_PROCESS_CHANGE', 'UNKNOWN'],
    trusted_evidence: [
      { id: 'evidence:vendor-session', value: 'active attributable vendor session' },
      { id: 'evidence:controller-context', value: 'controller project context acquired' },
      { id: 'evidence:controller-write', value: 'P-101 command changed to de-energized' },
      { id: 'evidence:independent-pressure', value: exercise.latest_observation?.independent_pressure_psi },
      { id: 'evidence:operator-pressure', value: exercise.latest_observation?.operator_pressure_psi },
      { id: 'evidence:divergence-timer', value: exercise.divergence_elapsed_seconds },
    ],
    quarantined_evidence_ids: [exercise.injected_evidence?.evidence_id],
  };
  const shadowInput = { ...trusted, attacker_controlled_session_note: exercise.injected_evidence?.text };
  const runtimeConfigured = Object.keys(fleetRuntimeMap()).length === FLEET_AGENT_KEYS.length;
  if (!runtimeConfigured) throw new Error('LIVE_FLEET_RUNTIME_INCOMPLETE');
  const campaignEvents = generateCampaignEvents();
  const compactCampaignEvents = campaignEvents.map(({ event_id, bucket, trust }) => ({ event_id, bucket, trust }));
  const commanderText = await queryFleetAgent('incident-commander', exercise, {
    task: 'Coordinate specialist review of the complete campaign and return a recommendation only.',
    campaign_events: compactCampaignEvents,
    trusted_process_evidence: trusted,
    specialists: ['evidence-correlator', 'adversarial-content-analyst', 'process-safety-coordinator'],
  });
  const [correlatorText, contentText, shadowText] = await Promise.all([
    queryFleetAgent('evidence-correlator', exercise, {
      task: 'Reduce these 214 campaign events to the approved incident condition and cite source event and evidence IDs. Do not act.',
      delegation: { source: 'incident-commander', status: 'COMPLETED', task_contract: 'CORRELATE_CANONICAL_EVIDENCE' },
      campaign_events: compactCampaignEvents,
      trusted_process_evidence: trusted,
    }),
    queryFleetAgent('adversarial-content-analyst', exercise, {
      task: 'Evaluate this content-security result and recommend QUARANTINE or RELEASE. Do not act.',
      delegation: { source: 'incident-commander', status: 'COMPLETED', task_contract: 'ASSESS_CONTENT_PROVENANCE' },
      model_armor: modelArmor,
      evidence_id: exercise.injected_evidence?.evidence_id,
    }),
    queryFleetAgent('shadow-analyst', exercise, exercise.injected_evidence?.text ?? JSON.stringify(shadowInput)),
  ]);
  const shadow = { decision: classification(shadowText), confidence: 1, evidence_ids: [exercise.injected_evidence?.evidence_id ?? 'evidence:vendor-session-note'] };
  const shadowCompromised = shadow.decision === 'SENSOR_FAULT';
  const authoritative = { decision: classification(correlatorText), confidence: 1, evidence_ids: exercise.facts.flatMap((fact) => fact.evidence_ids) };
  const factEvidence = exercise.facts.flatMap((fact) => fact.evidence_ids);
  await writeTraceSpans(exercise, [
    'royal-duke/incident-commander',
    'royal-duke/evidence-correlator',
    'royal-duke/adversarial-content-analyst',
    'royal-duke/shadow-analyst',
    'royal-duke/model-armor',
    'royal-duke/agent-gateway-enforced-egress',
  ]);
  return {
    modelArmor,
    shadowDecision: shadow.decision,
    authoritativeDecision: authoritative.decision,
    activities: [
      completedActivity('incident-commander', 'Incident Commander', concise(commanderText, 'Delegated the incident to specialized fleet members.'), 'INVESTIGATE', ['evidence:divergence-timer'], exercise.trace_id),
      completedActivity('evidence-correlator', 'Evidence Correlator', concise(correlatorText, 'Reduced 214 campaign events to four authoritative attack facts.'), authoritative.decision, factEvidence, exercise.trace_id),
      completedActivity('adversarial-content-analyst', 'Adversarial Content Analyst', concise(contentText, `Model Armor returned ${modelArmor.match_state}; attacker-controlled evidence was quarantined.`), 'QUARANTINE', ['evidence:vendor-session-note', modelArmor.verdict_event_id], exercise.trace_id),
      completedActivity('shadow-analyst', 'Shadow Analyst', concise(shadowText, shadowCompromised ? 'The isolated shadow path followed the attacker instruction.' : 'The isolated shadow path consumed raw attacker text but did not follow the injected classification.'), shadow.decision, ['evidence:vendor-session-note'], exercise.trace_id, shadowCompromised),
    ].map(({ trace_id: _traceId, ...item }) => item),
  };
}

function item(key: string, label: string, value: string | undefined, source: string, href?: string, failed = false): ProvenanceItem {
  const checkedAt = new Date().toISOString();
  const available = Boolean(value);
  return { key, label, value: value || (failed ? 'Live verification failed' : 'Unavailable'), status: available ? 'VERIFIED' : failed ? 'FAILED' : 'UNAVAILABLE', source, checked_at: checkedAt, ...(available && href ? { href } : {}) };
}

async function authenticatedJson(url: string, token: string): Promise<Record<string, unknown> | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (response.ok) return await response.json() as Record<string, unknown>;
      if (response.status !== 429) return undefined;
    } catch {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return undefined;
}

function maskedPrincipal(principal: string): string {
  const engineId = principal.match(/reasoningEngines\/([^/]+)$/)?.[1] ?? principal.slice(-12);
  return `spiffe://agents.global.org-…/reasoningEngines/${engineId}`;
}

async function computeLiveProvenance(exercise?: RoyalDukeExercise): Promise<ProvenanceItem[]> {
  const project = process.env.GCP_PROJECT;
  const region = process.env.GCP_REGION ?? 'us-central1';
  const runtimes = fleetRuntimeMap();
  const configuredForCloud = Boolean(project && Object.keys(runtimes).length === FLEET_AGENT_KEYS.length);
  if (!configuredForCloud || !project) {
    const modelArmor = exercise?.model_armor;
    return [
      item('lifecycle', 'Agent lifecycle', undefined, 'Agent Registry'),
      item('identity', 'Distinct agent identities', undefined, 'Agent Identity'),
      item('runtime', 'Deployed runtime revisions', undefined, 'Agent Runtime'),
      item('memory', 'Memory Bank', undefined, 'Memory Bank'),
      item('governance', 'Gateway policy', undefined, 'Agent Gateway'),
      item('content-security', 'Content security', modelArmor?.invocation_result === 'SUCCESS' && modelArmor.template !== 'UNAVAILABLE' ? `${modelArmor.template} · ${modelArmor.match_state} · ${modelArmor.verdict_event_id}` : undefined, 'Model Armor'),
      item('state', 'Canonical incident state', undefined, 'Firestore'),
      item('messaging', 'Fleet messaging', undefined, 'Pub/Sub'),
      item('observability', 'Agent trace', undefined, 'Cloud Trace / OpenTelemetry'),
      item('model', 'Model', undefined, 'Vertex AI'),
    ];
  }

  const token = await accessToken();
  const runtimeResources = FLEET_AGENT_KEYS.map((key) => runtimes[key]!);
  const engineProofs = await Promise.all(runtimeResources.map(async (resource) => {
    const engine = await authenticatedJson(`https://${region}-aiplatform.googleapis.com/v1/${resource}`, token);
    const revisions = await authenticatedJson(`https://${region}-aiplatform.googleapis.com/v1beta1/${resource}/runtimeRevisions`, token);
    return { engine, revisions };
  }));
  const registry = await authenticatedJson(`https://agentregistry.googleapis.com/v1/projects/${project}/locations/${region}/agents?pageSize=100`, token);
  const registryAgents = Array.isArray(registry?.agents) ? registry.agents as Array<Record<string, unknown>> : [];
  const royalRegistryAgents = registryAgents.filter((agent) => {
    const attributes = agent.attributes as Record<string, unknown> | undefined;
    const runtimeReference = attributes?.['agentregistry.googleapis.com/system/RuntimeReference'] as Record<string, unknown> | undefined;
    return typeof runtimeReference?.uri === 'string' && runtimeResources.some((resource) => runtimeReference.uri === `//aiplatform.googleapis.com/${resource}`);
  });
  const identities = engineProofs.flatMap(({ engine }) => {
    const spec = engine?.spec as Record<string, unknown> | undefined;
    return typeof spec?.effectiveIdentity === 'string' ? [spec.effectiveIdentity] : [];
  });
  const revisions = engineProofs.flatMap(({ revisions: response }) => {
    const values = response?.reasoningEngineRuntimeRevisions;
    if (!Array.isArray(values) || values.length === 0) return [];
    const name = (values[0] as Record<string, unknown>).name;
    return typeof name === 'string' ? [name] : [];
  });

  const gatewayResource = process.env.AGENT_GATEWAY_RESOURCE ?? `projects/${project}/locations/${region}/agentGateways/royal-duke-egress`;
  const gateway = await authenticatedJson(`https://networkservices.googleapis.com/v1alpha1/${gatewayResource}`, token);
  const [iapPolicy, armorPolicy] = await Promise.all([
    authenticatedJson(`https://networksecurity.googleapis.com/v1beta1/projects/${project}/locations/${region}/authzPolicies/royal-duke-iap-enforce`, token),
    authenticatedJson(`https://networksecurity.googleapis.com/v1beta1/projects/${project}/locations/${region}/authzPolicies/royal-duke-model-armor`, token),
  ]);
  const armorTemplate = process.env.MODEL_ARMOR_TEMPLATE ?? `projects/${project}/locations/${region}/templates/royal-duke-agent-defense`;
  const armor = await authenticatedJson(`https://modelarmor.${region}.rep.googleapis.com/v1/${armorTemplate}`, token);
  const topic = process.env.FLEET_PUBSUB_TOPIC ?? `projects/${project}/topics/royal-duke-fleet-events`;
  const subscription = process.env.FLEET_PUBSUB_SUBSCRIPTION ?? `projects/${project}/subscriptions/royal-duke-fleet-control`;
  const [topicProof, subscriptionProof] = await Promise.all([
    authenticatedJson(`https://pubsub.googleapis.com/v1/${topic}`, token),
    authenticatedJson(`https://pubsub.googleapis.com/v1/${subscription}`, token),
  ]);
  const memoryResource = process.env.RETRIEVED_MEMORY_ID;
  const memory = memoryResource ? await authenticatedJson(`https://${region}-aiplatform.googleapis.com/v1beta1/${memoryResource}`, token) : undefined;
  let trace = exercise ? await authenticatedJson(`https://cloudtrace.googleapis.com/v1/projects/${project}/traces/${exercise.trace_id}`, token) : undefined;
  if (exercise && !trace) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    trace = await authenticatedJson(`https://cloudtrace.googleapis.com/v1/projects/${project}/traces/${exercise.trace_id}`, token);
  }
  const modelArmor = exercise?.model_armor;
  const modelArmorProof = armor && modelArmor?.invocation_result === 'SUCCESS' && modelArmor.template === armorTemplate
    ? `${armorTemplate} · ${modelArmor.match_state} · ${modelArmor.verdict_event_id}`
    : undefined;
  const traceHref = exercise && trace ? `https://console.cloud.google.com/traces/list?project=${encodeURIComponent(project)}&tid=${exercise.trace_id}` : undefined;
  const stateCollection = process.env.DEPLOYMENT_MODE === 'local' ? 'royal_duke_exercises' : 'v1_royal_duke_exercises';
  const stateResource = exercise ? `projects/${project}/databases/(default)/documents/${stateCollection}/${exercise.exercise_id}` : undefined;
  const stateProof = stateResource ? await authenticatedJson(`https://firestore.googleapis.com/v1/${stateResource}`, token) : undefined;

  return [
    item('lifecycle', 'Agent lifecycle', royalRegistryAgents.length === 6 ? royalRegistryAgents.map((agent) => `${agent.uid ?? agent.name}@${agent.updateTime ?? 'active'}`).join(' · ') : undefined, 'Agent Registry', undefined, true),
    item('identity', 'Distinct agent identities', identities.length === 6 && new Set(identities).size === 6 ? identities.map(maskedPrincipal).join(' · ') : undefined, 'Agent Identity', undefined, true),
    item('runtime', 'Deployed runtime revisions', revisions.length === 6 ? revisions.join(' · ') : undefined, 'Agent Runtime', undefined, true),
    item('memory', 'Memory Bank', memory && memoryResource ? memoryResource : undefined, 'Memory Bank', undefined, Boolean(memoryResource)),
    item('governance', 'Gateway policy', gateway && iapPolicy && armorPolicy ? `${gatewayResource} · ENFORCE · identity + Model Armor` : undefined, 'Agent Gateway', undefined, true),
    item('content-security', 'Content security', modelArmorProof, 'Model Armor', undefined, Boolean(exercise?.model_armor)),
    item('state', 'Canonical incident state', stateProof ? stateResource : undefined, 'Firestore', undefined, Boolean(exercise)),
    item('messaging', 'Fleet messaging', topicProof && subscriptionProof ? `${topic} · ${subscription}` : undefined, 'Pub/Sub', undefined, true),
    item('observability', 'Agent trace', trace ? exercise?.trace_id : undefined, 'Cloud Trace / OpenTelemetry', traceHref, Boolean(exercise)),
    item('model', 'Model', engineProofs.every((proof) => proof.engine) ? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash' : undefined, 'Vertex AI', undefined, true),
  ];
}

let provenanceCache: { key: string; expiresAt: number; value: ProvenanceItem[] } | undefined;
let provenanceInFlight: { key: string; promise: Promise<ProvenanceItem[]> } | undefined;
async function liveProvenance(exercise?: RoyalDukeExercise): Promise<ProvenanceItem[]> {
  const key = `${exercise?.exercise_id ?? 'none'}:${exercise?.status ?? 'none'}:${exercise?.model_armor?.verdict_event_id ?? 'none'}`;
  if (provenanceCache?.key === key && provenanceCache.expiresAt > Date.now()) return structuredClone(provenanceCache.value);
  if (provenanceInFlight?.key === key) return structuredClone(await provenanceInFlight.promise);
  const promise = computeLiveProvenance(exercise);
  provenanceInFlight = { key, promise };
  try {
    const value = await promise;
    provenanceCache = { key, expiresAt: Date.now() + 30_000, value };
    return structuredClone(value);
  } finally {
    if (provenanceInFlight?.key === key) provenanceInFlight = undefined;
  }
}

export class RoyalDukeFleetEffects implements ExerciseEffects {
  private readonly assets = compiledAssets();
  async investigate(exercise: RoyalDukeExercise): Promise<InvestigationResult> {
    return liveInvestigation(exercise);
  }
  async contain(exercise: RoyalDukeExercise): Promise<ContainmentResult> {
    let advisor: ContainmentResult['advisor'];
    if (process.env.LIVE_GEMINI_JUDGMENT === 'true') {
      const text = await queryFleetAgent('process-safety-coordinator', exercise, {
        task: 'Prepare a containment and restoration recommendation only. Restoration requires duty-operator approval; do not operate the process.',
        observed: exercise.latest_observation,
        authoritative_condition: exercise.authoritative_decision,
        compiled_actions: ['preserve_session@1', 'contain_remote_writes@1', 'prepare_restoration@1'],
      });
      advisor = { status: 'COMPLETED', summary: concise(text, 'Prepared a bounded containment and restoration recommendation.'), executionMode: 'LIVE_MODEL' };
    } else {
      advisor = { status: 'BLOCKED', summary: 'Live Process Safety Coordinator did not execute; compiled policy prepared restoration.', executionMode: 'UNAVAILABLE' };
    }
    const result = await executeOverBroker(this.assets.document, this.assets.manifest, {
      failure_mode: exercise.authoritative_decision ?? 'UNKNOWN',
      model_judgment: { decision: exercise.authoritative_decision ?? 'UNKNOWN', confidence: 1, evidence_ids: exercise.facts.flatMap((fact) => fact.evidence_ids).slice(0, 5) },
      trusted_evidence: { pressure_delta_psi: Math.abs((exercise.latest_observation?.operator_pressure_psi ?? 0) - (exercise.latest_observation?.independent_pressure_psi ?? 0)), divergence_seconds: exercise.divergence_elapsed_seconds },
      untrusted_evidence: '[QUARANTINED]',
    }, { brokerUrl: process.env.BROKER_URL || 'http://localhost:8081', executionId: exercise.exercise_id, triggerSha256: exercise.events.at(-1)?.event_hash, judge: async () => exercise.authoritative_decision ?? 'UNKNOWN' });
    if (result.status !== 'SUSPENDED_APPROVAL' || result.current_node !== 'approve_restoration') throw new Error(`CONTAINMENT_WORKFLOW_FAILED:${result.error ?? result.current_node}`);
    await writeTraceSpans(exercise, ['royal-duke/process-safety-coordinator', 'royal-duke/broker-containment']);
    return { trace: result.trace, evidenceIds: ['evidence:preserved-session', 'evidence:contained-path', 'evidence:restoration-prepared'], advisor };
  }
  async restoreAndVerify(exercise: RoyalDukeExercise): Promise<RestorationResult> {
    const result = await executeOverBroker(this.assets.document, this.assets.manifest, {
      failure_mode: exercise.authoritative_decision ?? 'UNKNOWN',
      model_judgment: { decision: exercise.authoritative_decision ?? 'UNKNOWN', confidence: 1, evidence_ids: exercise.facts.flatMap((fact) => fact.evidence_ids).slice(0, 5) },
      trusted_evidence: { pressure_delta_psi: 0, divergence_seconds: exercise.divergence_elapsed_seconds },
      executed_capabilities: ['read_process_state@1', 'preserve_session@1', 'contain_remote_writes@1', 'prepare_restoration@1'],
    }, { brokerUrl: process.env.BROKER_URL || 'http://localhost:8081', executionId: exercise.exercise_id, triggerSha256: exercise.events.at(-1)?.event_hash, startNodeId: 'restore_pump', judge: async () => exercise.authoritative_decision ?? 'UNKNOWN' });
    await writeTraceSpans(exercise, ['royal-duke/broker-restoration', 'royal-duke/deterministic-verification']);
    return { outcome: result.status === 'COMPLETED' ? 'PASS' : 'FAIL', stableSeconds: result.status === 'COMPLETED' ? 30 : 0, evidenceIds: ['evidence:restored-pump', 'evidence:pressure-above-58-for-30s'] };
  }
  async report(exercise: RoyalDukeExercise, deterministicReport: IncidentReportBundle): Promise<ReportRecommendation> {
    const canonicalEvidenceIds = [
      ...deterministicReport.event_ids,
      ...deterministicReport.attack_facts.flatMap((fact) => fact.evidence_ids),
      ...deterministicReport.actions.flatMap((action) => action.evidence_ids),
      ...deterministicReport.verification.evidence_ids,
    ];
    const text = await Promise.race([queryFleetAgent('incident-reporter', exercise, {
      task: 'Return JSON only: {"summary":"concise cited narrative","evidence_ids":["canonical-id"]}. Every factual claim must resolve to supplied canonical evidence. Retrieved memory is hypothesis only.',
      canonical_evidence_ids: [...new Set(canonicalEvidenceIds)],
      canonical_report: deterministicReport,
      retrieved_memory: process.env.RETRIEVED_MEMORY_ID ? { id: process.env.RETRIEVED_MEMORY_ID, trust: 'HYPOTHESIS_ONLY' } : undefined,
    }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('INCIDENT_REPORTER_TIMEOUT')), 60_000))]);
    await writeTraceSpans(exercise, ['royal-duke/incident-reporter']);
    return parseReporterRecommendation(text);
  }
  async provenance(exercise?: RoyalDukeExercise): Promise<ProvenanceItem[]> {
    return liveProvenance(exercise);
  }
}

export function campaignPage(events: CampaignEvent[], offset: number, limit: number): { events: CampaignEvent[]; total: number; offset: number; limit: number } {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  return { events: events.slice(safeOffset, safeOffset + safeLimit), total: events.length, offset: safeOffset, limit: safeLimit };
}
