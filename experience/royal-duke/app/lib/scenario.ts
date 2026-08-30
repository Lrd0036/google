import rangeModelJson from '../../range/royal-duke/scenario.json';
import { isLabeledFacility, LOUDOUN_FACILITIES } from './loudoun';

export type CameraShot = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  duration: number;
};

export type ScenarioAction = {
  id: string;
  control: 'attacker' | 'system';
  stage: number;
  label: string;
  plane: string;
  prerequisites: string[];
  effect: string;
  evidence: string;
  condition?: string;
  requiredDefense?: string;
};

export type ScenarioScene = {
  id: string;
  short: string;
  title: string;
  kicker: string;
  subtitle: string;
  fallbackPhysicalPressurePsi: number;
  fallbackOperatorPressurePsi: number;
  event: string;
  operatorDetail: string;
  physicalDetail: string;
  storyTime: string;
  durationMs: number;
  activation: {
    kind: 'baseline' | 'action' | 'fleet';
    actionIds?: string[];
    statuses?: string[];
  };
  visual: { blackout: boolean; contained: boolean; recovered: boolean };
  camera: CameraShot;
  log: string[];
};

type StoryNodeConfig = {
  id: string;
  label: string;
  kicker: string;
  lngLat: [number, number];
  revealScene: string;
  compromisedScene: string;
  recoveredScene?: string;
  kind: 'actor' | 'site';
  monument: 'office' | 'campus' | 'water';
};

type StoryEdgeConfig = {
  id: string;
  from: string;
  to: string;
  revealScene: string;
  infectScene: string;
  blockedScene?: string;
  recoveredScene?: string;
};

type ExperienceModel = {
  brand: {
    kicker: string;
    title: string;
    thesis: string;
    mastheadKicker: string;
    mastheadTitle: string;
    mapCredit: string;
    titleSequence: { kicker: string; words: string[]; accentWord: string; subtitle: string; credit: string };
  };
  process: {
    primaryAsset: string;
    operatorTelemetryLabel: string;
    independentTelemetryLabel: string;
    pressureUnit: string;
  };
  thresholds: {
    nominalPressurePsi: number;
    incidentDeltaPsi: number;
    incidentContinuousSeconds: number;
    lowPressurePsi: number;
    recoveryPressurePsi: number;
    recoveryContinuousSeconds: number;
  };
  campaign: {
    received: number;
    routine: number;
    decoys: number;
    correlatedAnomalies: number;
    causalEvents: number;
    authoritativeFacts: number;
  };
  agents: Array<{ id: string; name: string; authority: string }>;
  scenes: ScenarioScene[];
  map: {
    introShot: CameraShot;
    introFlyMs: number;
    introHoldMs: number;
    storyNodes: StoryNodeConfig[];
    storyEdges: StoryEdgeConfig[];
    load: { sourceNode: string; revealScene: string; compromisedScene: string; recoveredScene?: string };
  };
  responseSteps: Array<{ id: string; title: string; authority: string; detail: string }>;
  evidence: Array<{ sceneId: string; text: string }>;
};

type ScenarioModel = {
  schemaVersion: string;
  modelId: string;
  title: string;
  scope: string;
  actions: ScenarioAction[];
  experience: ExperienceModel;
};

export type SiteNode = {
  id: string;
  label: string;
  kicker: string;
  lngLat: [number, number];
  reveal: number;
  compromisedAt: number;
  recoveredAt?: number;
  kind: 'actor' | 'site' | 'load';
  monument: 'office' | 'campus' | 'water' | 'hall';
  labeled?: boolean;
};

export type SiteEdge = {
  id: string;
  from: string;
  to: string;
  reveal: number;
  infect: number;
  blockedAt?: number;
  recoveredAt?: number;
};

export type NarrativeRangeState = {
  emittedAt?: string;
  startedAt?: string;
  completedActions: string[];
  telemetry?: Record<string, number>;
  defensive?: {
    evidencePreserved?: boolean;
    remoteWritesContained?: boolean;
    restorationPrepared?: boolean;
  };
  events?: Array<{ summary: string }>;
  fleet?: null | {
    status?: string;
    divergence_elapsed_seconds?: number;
    recovery_elapsed_seconds?: number;
    activities?: Array<{ summary: string }>;
  };
};

export type NarrativePresentation = ScenarioScene & {
  stage: number;
  connected: boolean;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Royal Duke scenario: ${message}`);
}

export const RANGE_MODEL = rangeModelJson as unknown as ScenarioModel;
export const EXPERIENCE = RANGE_MODEL.experience;
export const STAGES = EXPERIENCE.scenes;
export const SHOTS = STAGES.map((scene) => scene.camera);
export const INTRO_SHOT = EXPERIENCE.map.introShot;
export const INTRO_FLY_MS = EXPERIENCE.map.introFlyMs;
export const INTRO_HOLD_MS = EXPERIENCE.map.introHoldMs;
export const THRESHOLDS = EXPERIENCE.thresholds;
export const AGENTS = EXPERIENCE.agents;
export const CAMPAIGN = EXPERIENCE.campaign;
export const RESPONSE_STEPS = EXPERIENCE.responseSteps;

const SCENE_INDEX = new Map(STAGES.map((scene, index) => [scene.id, index]));

export function sceneIndex(sceneId: string) {
  const index = SCENE_INDEX.get(sceneId);
  assert(index !== undefined, `unknown scene ${sceneId}`);
  return index;
}

export function actionSceneIndex(actionId: string) {
  const index = STAGES.findIndex(
    (scene) => scene.activation.actionIds?.includes(actionId),
  );
  assert(index >= 0, `action ${actionId} has no presentation scene`);
  return index;
}

export function validateScenarioModel() {
  assert(RANGE_MODEL.modelId.length > 0, 'modelId is required');
  assert(STAGES.length >= 2, 'at least two scenes are required');
  assert(STAGES[0].activation.kind === 'baseline', 'first scene must be the baseline');

  const actionIds = new Set<string>();
  for (const action of RANGE_MODEL.actions) {
    assert(!actionIds.has(action.id), `duplicate action ${action.id}`);
    actionIds.add(action.id);
    assert(action.control === 'attacker' || action.control === 'system', `${action.id} has invalid control ownership`);
    for (const prerequisite of action.prerequisites) {
      assert(RANGE_MODEL.actions.some((candidate) => candidate.id === prerequisite), `${action.id} references unknown prerequisite ${prerequisite}`);
    }
  }

  const sceneIds = new Set<string>();
  const presentedActions = new Set<string>();
  for (const scene of STAGES) {
    assert(!sceneIds.has(scene.id), `duplicate scene ${scene.id}`);
    sceneIds.add(scene.id);
    assert(scene.log.length > 0, `scene ${scene.id} has no narrative evidence`);
    assert(scene.durationMs > 0, `scene ${scene.id} has invalid duration`);
    if (scene.activation.actionIds) {
      for (const actionId of scene.activation.actionIds) {
        assert(actionIds.has(actionId), `scene ${scene.id} references unknown action ${actionId}`);
        presentedActions.add(actionId);
      }
    }
  }
  for (const actionId of actionIds) assert(presentedActions.has(actionId), `action ${actionId} has no presentation scene`);

  for (const node of EXPERIENCE.map.storyNodes) {
    assert(sceneIds.has(node.revealScene), `node ${node.id} has unknown reveal scene`);
    assert(sceneIds.has(node.compromisedScene), `node ${node.id} has unknown compromise scene`);
    if (node.recoveredScene) assert(sceneIds.has(node.recoveredScene), `node ${node.id} has unknown recovery scene`);
  }
  const mapNodeIds = new Set(EXPERIENCE.map.storyNodes.map((node) => node.id));
  for (const edge of EXPERIENCE.map.storyEdges) {
    assert(mapNodeIds.has(edge.from) && mapNodeIds.has(edge.to), `edge ${edge.id} references an unknown node`);
    for (const id of [edge.revealScene, edge.infectScene, edge.blockedScene, edge.recoveredScene].filter(Boolean) as string[]) {
      assert(sceneIds.has(id), `edge ${edge.id} references unknown scene ${id}`);
    }
  }
  for (const evidence of EXPERIENCE.evidence) assert(sceneIds.has(evidence.sceneId), `evidence references unknown scene ${evidence.sceneId}`);

  const lowPressure = RANGE_MODEL.actions.find((action) => action.id === 'low_pressure_observed');
  assert(lowPressure?.condition === `process.pressure.psi < ${THRESHOLDS.lowPressurePsi}`, 'low-pressure action and presentation threshold disagree');
  assert(THRESHOLDS.recoveryPressurePsi > THRESHOLDS.lowPressurePsi, 'recovery threshold must exceed low-pressure threshold');
  assert(THRESHOLDS.nominalPressurePsi > THRESHOLDS.recoveryPressurePsi, 'nominal pressure must exceed recovery threshold');
  return true;
}

validateScenarioModel();

function at(sceneId: string) {
  return sceneIndex(sceneId);
}

const STORY_NODES: SiteNode[] = EXPERIENCE.map.storyNodes.map((node) => ({
  id: node.id,
  label: node.label,
  kicker: node.kicker,
  lngLat: node.lngLat,
  reveal: at(node.revealScene),
  compromisedAt: at(node.compromisedScene),
  recoveredAt: node.recoveredScene ? at(node.recoveredScene) : undefined,
  kind: node.kind,
  monument: node.monument,
}));

const LOAD_NODES: SiteNode[] = LOUDOUN_FACILITIES.map((site) => ({
  id: site.id,
  label: site.name,
  kicker: site.operator,
  lngLat: [site.lon, site.lat],
  reveal: at(EXPERIENCE.map.load.revealScene),
  compromisedAt: at(EXPERIENCE.map.load.compromisedScene),
  recoveredAt: EXPERIENCE.map.load.recoveredScene ? at(EXPERIENCE.map.load.recoveredScene) : undefined,
  kind: 'load',
  monument: 'hall',
  labeled: isLabeledFacility(site.id),
}));

export const NODES: readonly SiteNode[] = [...STORY_NODES, ...LOAD_NODES];

export const EDGES: SiteEdge[] = [
  ...EXPERIENCE.map.storyEdges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    reveal: at(edge.revealScene),
    infect: at(edge.infectScene),
    blockedAt: edge.blockedScene ? at(edge.blockedScene) : undefined,
    recoveredAt: edge.recoveredScene ? at(edge.recoveredScene) : undefined,
  })),
  ...LOUDOUN_FACILITIES.map((site) => ({
    id: `water-${site.id}`,
    from: EXPERIENCE.map.load.sourceNode,
    to: site.id,
    reveal: at(EXPERIENCE.map.load.revealScene),
    infect: at(EXPERIENCE.map.load.compromisedScene),
    recoveredAt: EXPERIENCE.map.load.recoveredScene ? at(EXPERIENCE.map.load.recoveredScene) : undefined,
  })),
];

export const EVIDENCE = EXPERIENCE.evidence.map((item) => ({ ...item, stage: at(item.sceneId) }));
export const BY_ID = Object.fromEntries(NODES.map((node) => [node.id, node]));

export function deriveSceneIndex(state: NarrativeRangeState | null) {
  if (!state) return 0;
  const completed = new Set(state.completedActions);
  let active = 0;
  STAGES.forEach((scene, index) => {
    if (scene.activation.actionIds?.some((id) => completed.has(id))) active = Math.max(active, index);
    if (state.fleet?.status && scene.activation.statuses?.includes(state.fleet.status)) active = Math.max(active, index);
  });
  if (state.defensive?.remoteWritesContained) active = Math.max(active, at('fleet-containment'));
  if (state.fleet?.status === 'FLEET_INVESTIGATING') active = Math.max(active, at('fleet-containment'));
  if (state.fleet?.status === 'AWAITING_APPROVAL') active = Math.max(active, at('human-approval'));
  if (state.fleet?.status === 'RESTORING' || state.fleet?.status === 'VERIFYING') active = Math.max(active, at('recovery-verification'));
  if (state.fleet?.status === 'COMPLETED') return at('incident-complete');
  if (state.fleet?.status === 'ESCALATED') return at('incident-escalated');
  return active;
}

function elapsedClock(startedAt?: string, emittedAt?: string) {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const end = emittedAt ? Date.parse(emittedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '--:--:--';
  const elapsed = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function deriveNarrativePresentation(state: NarrativeRangeState | null): NarrativePresentation {
  const stage = deriveSceneIndex(state);
  const scene = STAGES[stage];
  if (!state) {
    return {
      ...scene,
      stage,
      connected: false,
      storyTime: '--:--:--',
      event: 'Control stream unavailable',
      operatorDetail: 'No authoritative operator reading',
      physicalDetail: 'No authoritative process reading',
      subtitle: 'The map is waiting for canonical Control and process state. Presentation controls cannot advance the incident.',
      log: ['No canonical incident state is attached.', 'Connect the Royal Duke range to begin the exercise.'],
      visual: { blackout: false, contained: false, recovered: false },
    };
  }

  const telemetry = state.telemetry ?? {};
  const physical = telemetry['process.pressure.psi'];
  const operator = telemetry['operator.pressure.psi'];
  const pumpEnergized = telemetry['process.pump.actual'] === 1;
  const lowPressure = telemetry['alarm.low-pressure'] === 1 || (Number.isFinite(physical) && physical < THRESHOLDS.lowPressurePsi);
  const completed = new Set(state.completedActions);
  const status = state.fleet?.status;
  const eventByStatus: Record<string, string> = {
    ARMED: 'Exercise armed',
    ATTACK_IN_PROGRESS: 'Attack path advancing',
    DETERMINISTIC_MONITORING: `Divergence predicate ${Math.min(THRESHOLDS.incidentContinuousSeconds, state.fleet?.divergence_elapsed_seconds ?? 0).toFixed(1)} / ${THRESHOLDS.incidentContinuousSeconds} sec`,
    FLEET_INVESTIGATING: 'Defensive fleet investigating',
    AWAITING_APPROVAL: 'Approval required',
    RESTORING: 'Authorized restoration running',
    VERIFYING: `Recovery verification ${Math.min(THRESHOLDS.recoveryContinuousSeconds, state.fleet?.recovery_elapsed_seconds ?? 0).toFixed(1)} / ${THRESHOLDS.recoveryContinuousSeconds} sec`,
    COMPLETED: 'VERIFY: PASS',
    ESCALATED: 'VERIFY: FAIL',
    BRIDGE_DEGRADED: 'Fleet bridge degraded',
  };
  const liveLines = [
    ...(state.fleet?.activities ?? []).slice(-2).reverse().map((item) => item.summary),
    ...(state.events ?? []).slice(0, 2).map((item) => item.summary),
  ].filter((line, index, lines) => line && lines.indexOf(line) === index).slice(0, 3);

  let title = scene.title;
  let kicker = scene.kicker;
  let subtitle = scene.subtitle;
  if (status === 'FLEET_INVESTIGATING') {
    title = 'The defenders answer';
    kicker = 'Scene 06 · Defensive response';
    subtitle = state.fleet?.activities?.at(-1)?.summary ?? 'The deterministic trigger has handed trusted evidence to the defensive fleet.';
  } else if (status === 'DETERMINISTIC_MONITORING') {
    subtitle = `Operator and independent pressure differ by ${Number.isFinite(operator) && Number.isFinite(physical) ? Math.abs(operator - physical).toFixed(1) : '—'} PSI. The incident does not exist until that condition persists for ${THRESHOLDS.incidentContinuousSeconds} seconds.`;
  } else if (status === 'VERIFYING' || status === 'RESTORING') {
    subtitle = `P-101 restoration is authorized. Independent pressure—not a model judgment—must remain above ${THRESHOLDS.recoveryPressurePsi} PSI for ${THRESHOLDS.recoveryContinuousSeconds} seconds.`;
  }

  return {
    ...scene,
    stage,
    connected: true,
    title,
    kicker,
    subtitle,
    storyTime: elapsedClock(state.startedAt, state.emittedAt),
    event: status ? (eventByStatus[status] ?? status.replaceAll('_', ' ')) : scene.event,
    operatorDetail: completed.has('operator_view_frozen') ? 'Gateway hold active · source untrusted' : 'Live operator-gateway reading',
    physicalDetail: `${pumpEnergized ? 'P-101 energized' : 'P-101 de-energized'} · ${lowPressure ? 'low-pressure alarm active' : 'pressure alarm clear'}`,
    log: liveLines.length > 0 ? liveLines : scene.log,
    visual: {
      blackout: Boolean(lowPressure && status !== 'VERIFYING' && status !== 'RESTORING' && status !== 'COMPLETED'),
      contained: Boolean(state.defensive?.remoteWritesContained),
      recovered: status === 'COMPLETED',
    },
  };
}

export function siteCompromised(node: SiteNode, stage: number) {
  if (stage < node.compromisedAt) return false;
  if (node.recoveredAt !== undefined && stage === node.recoveredAt) return false;
  return true;
}

export function edgeInfected(edge: SiteEdge, stage: number) {
  if (stage < edge.infect) return false;
  if (edge.recoveredAt !== undefined && stage === edge.recoveredAt) return false;
  return true;
}

export function edgeBlocked(edge: SiteEdge, stage: number) {
  if (edge.blockedAt === undefined || stage < edge.blockedAt) return false;
  if (edge.recoveredAt !== undefined && stage === edge.recoveredAt) return false;
  return true;
}
