import { ALLEY_CENTER, isLabeledFacility, LOUDOUN_COUNT, LOUDOUN_FACILITIES } from './loudoun';

export type StageId = 0 | 1 | 2 | 3 | 4 | 5;

export type CameraShot = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  duration: number;
};

export type SiteNode = {
  id: string;
  label: string;
  kicker: string;
  lngLat: [number, number];
  reveal: StageId;
  compromisedAt: StageId;
  kind: 'actor' | 'site' | 'load';
  monument: 'office' | 'campus' | 'water' | 'hall';
  labeled?: boolean;
};

export type SiteEdge = {
  id: string;
  from: string;
  to: string;
  reveal: StageId;
  infect?: StageId;
};

export const STAGES = [
  {
    short: 'Baseline',
    title: 'Normal operations',
    kicker: 'Chapter 00',
    subtitle: 'Royal Duke keeps Data Center Alley alive from a room the public never sees.',
    pressure: 62,
    event: 'Nominal traffic',
    operatorDetail: 'P-101 running · alarms none',
    physicalDetail: 'Flow 11,480 GPM · pump on',
    storyTime: '00:00:00',
    duration: 5600,
  },
  {
    short: 'Open Window',
    title: 'The Open Window',
    kicker: 'Chapter 01',
    subtitle: 'A vendor session is treated as a trusted employee. It is not.',
    pressure: 61.8,
    event: 'Valid vendor session',
    operatorDetail: 'Third-party identity accepted',
    physicalDetail: 'Flow 11,470 GPM · pump on',
    storyTime: '00:00:14',
    duration: 6800,
  },
  {
    short: 'The Pivot',
    title: 'The Pivot',
    kicker: 'Chapter 02',
    subtitle: 'A session is not enough. The route, workstation, and controller project must all line up.',
    pressure: 61.2,
    event: 'Engineering path resolved',
    operatorDetail: 'Station trust + asset model acquired',
    physicalDetail: 'Flow 11,410 GPM · pump on',
    storyTime: '00:00:31',
    duration: 6800,
  },
  {
    short: 'Illusion',
    title: 'The Illusion',
    kicker: 'Chapter 03',
    subtitle: 'With view authority established, the operator screen can smile while the water does not.',
    pressure: 37,
    event: 'Values diverging',
    operatorDetail: 'Displayed pressure 62.0 PSI',
    physicalDetail: 'Independent telemetry 37.0 PSI',
    storyTime: '00:00:48',
    duration: 8400,
  },
  {
    short: 'Physics',
    title: 'The Physics Breach',
    kicker: 'Chapter 04',
    subtitle: 'Controller-write authority turns an approved data path into a process change.',
    pressure: 27,
    event: 'PLC write observed',
    operatorDetail: 'HMI still reports running',
    physicalDetail: 'Flow falling · pump commanded off',
    storyTime: '00:01:02',
    duration: 7400,
  },
  {
    short: 'Fallout',
    title: 'The Fallout',
    kicker: 'Chapter 05',
    subtitle: 'Cooling fails. The alley goes dark. The brainstem has bled out.',
    pressure: 21,
    event: 'Halls dropping offline',
    operatorDetail: 'Emergency shutdown cascade',
    physicalDetail: 'Thermal trip · Loudoun load at risk',
    storyTime: '00:01:27',
    duration: 9000,
  },
] as const;

const STORY_NODES: SiteNode[] = [
  { id: 'vendor', label: 'Vendor access', kicker: 'Initial access', lngLat: [-77.508, 39.033], reveal: 0, compromisedAt: 1, kind: 'actor', monument: 'office' },
  { id: 'hq', label: 'Royal Duke HQ / EMS', kicker: 'The brainstem', lngLat: [-77.455, 39.0], reveal: 0, compromisedAt: 1, kind: 'site', monument: 'campus' },
  { id: 'water', label: 'Water system', kicker: 'P-101 / cooling', lngLat: [-77.461, 39.042], reveal: 2, compromisedAt: 2, kind: 'site', monument: 'water' },
];

const LOAD_NODES: SiteNode[] = LOUDOUN_FACILITIES.map((site) => ({
  id: site.id,
  label: site.name,
  kicker: site.operator,
  lngLat: [site.lon, site.lat],
  reveal: 0,
  compromisedAt: 5,
  kind: 'load',
  monument: 'hall',
  labeled: isLabeledFacility(site.id),
}));

export const NODES: readonly SiteNode[] = [...STORY_NODES, ...LOAD_NODES];

export const EDGES: SiteEdge[] = [
  { id: 'vendor-hq', from: 'vendor', to: 'hq', reveal: 1 },
  { id: 'hq-water', from: 'hq', to: 'water', reveal: 2 },
  ...LOUDOUN_FACILITIES.map((site) => ({
    id: `water-${site.id}`,
    from: 'water',
    to: site.id,
    reveal: 4 as StageId,
    infect: 5 as StageId,
  })),
];

export const LOG = [
  [
    'P-101 discharge holds at 62.0 PSI.',
    'The alarm queue is empty.',
    'Royal Duke is inside its design envelope.',
  ],
  [
    'A third-party identity is accepted as valid.',
    'Multi-factor authentication is not enforced.',
    'The open window is now a corridor.',
  ],
  [
    'The brokered session can reach the engineering enclave.',
    'The controller project and station identity are known.',
    'Only now is the live Modbus gateway meaningful.',
  ],
  [
    'The operator screen still reads 62.0 PSI.',
    'Independent telemetry reads 37.0 PSI.',
    'The picture in the control room cannot be trusted.',
  ],
  [
    'An allowlisted gateway update crosses live Modbus TCP.',
    'The simulated PLC accepts the P-101 coil change.',
    'Pressure falls through the minimum safe line.',
  ],
  [
    'Campus cooling reserve is gone.',
    'Thermal protection trips the halls.',
    `${LOUDOUN_COUNT} Loudoun data centers start to fail.`,
  ],
] as const;

export const DEFENSES = [
  { id: 'mfa', title: 'Vendor MFA + just-in-time access', cost: 30, stage: 1 as StageId, brief: 'The session dies before it becomes a person.' },
  { id: 'pam', title: 'Recorded privileged sessions', cost: 120, stage: 1 as StageId, brief: 'Every vendor keystroke is watched and timed out.' },
  { id: 'segmentation', title: 'OT DMZ + security perimeter', cost: 180, stage: 2 as StageId, brief: 'The enterprise hop cannot see the plant.' },
  { id: 'monitoring', title: 'Historian integrity monitoring', cost: 120, stage: 3 as StageId, brief: 'The lie on the glass is caught against the record.' },
  { id: 'telemetry', title: 'Independent process telemetry', cost: 80, stage: 3 as StageId, brief: 'Physics gets a second witness.' },
  { id: 'safety', title: 'PLC allow-listing + safety logic', cost: 90, stage: 4 as StageId, brief: 'A rogue write cannot move the process.' },
] as const;

export const EVIDENCE = [
  { stage: 0 as StageId, text: 'Normal operating pressure established at 58–64 PSI.' },
  { stage: 1 as StageId, text: 'Vendor identity has no enforced MFA or expiration.' },
  { stage: 2 as StageId, text: 'The broker destination reaches the engineering enclave.' },
  { stage: 2 as StageId, text: 'Controller project and station context were accessed.' },
  { stage: 3 as StageId, text: 'Operator pressure diverges from physical telemetry.' },
  { stage: 4 as StageId, text: 'Unauthorized PLC process change confirmed.' },
  { stage: 5 as StageId, text: `Cooling loss propagates across ${LOUDOUN_COUNT} Loudoun data-center halls.` },
] as const;

export const INTRO_SHOT: CameraShot = {
  center: [-42.4, 27.8],
  zoom: 1.62,
  pitch: 0,
  bearing: -18,
  duration: 0,
};

export const SHOTS: CameraShot[] = [
  { center: [-77.468, 39.016], zoom: 12.05, pitch: 48, bearing: -20, duration: 2800 },
  { center: [-77.482, 39.02], zoom: 12.85, pitch: 55, bearing: -36, duration: 2400 },
  { center: [-77.458, 39.022], zoom: 12.55, pitch: 52, bearing: 16, duration: 2600 },
  { center: [-77.455, 39.0005], zoom: 13.7, pitch: 62, bearing: -6, duration: 2800 },
  { center: [-77.461, 39.042], zoom: 13.55, pitch: 58, bearing: 22, duration: 2600 },
  { center: [ALLEY_CENTER[0], 38.995], zoom: 11.45, pitch: 47, bearing: -24, duration: 3400 },
];

export const INTRO_FLY_MS = 5600;
export const INTRO_HOLD_MS = 1600;
export const BUDGET_CAP = 500;

export const BY_ID = Object.fromEntries(NODES.map((node) => [node.id, node]));

export function siteCompromised(
  node: SiteNode,
  stage: number,
  contained: boolean,
  blockStage: number,
) {
  if (stage < node.compromisedAt) return false;
  if (contained && node.compromisedAt >= blockStage) return false;
  return true;
}

export function edgeInfected(
  edge: SiteEdge,
  stage: number,
  contained: boolean,
  blockStage: number,
) {
  const infect = edge.infect ?? edge.reveal;
  if (stage < infect) return false;
  if (contained && infect >= blockStage) return false;
  return true;
}

export function edgeBlocked(
  edge: SiteEdge,
  stage: number,
  contained: boolean,
  blockStage: number,
) {
  return contained && stage >= blockStage && edge.reveal === blockStage;
}
