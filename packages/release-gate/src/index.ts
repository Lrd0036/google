import { UnsignedReleaseAttestationSchema, REQUIRED_RELEASE_GATES, type ReleaseGateName, type UnsignedReleaseAttestation } from '@runbook/types';

export interface GateEvidence {
  gate: ReleaseGateName;
  evidence_sha256: string;
  observed_at: string;
  fresh_until: string;
  checks: Record<string, boolean>;
}

export type ReleaseDescriptor = Omit<UnsignedReleaseAttestation, 'issued_at' | 'expires_at' | 'gates' | 'eligible'>;

export function evaluateRelease(descriptor: ReleaseDescriptor, evidence: readonly GateEvidence[], now = new Date()): UnsignedReleaseAttestation {
  const byGate = new Map<ReleaseGateName, GateEvidence>();
  for (const item of evidence) {
    if (byGate.has(item.gate)) throw new Error(`DUPLICATE_GATE_EVIDENCE:${item.gate}`);
    byGate.set(item.gate, item);
  }
  const gates = Object.fromEntries(REQUIRED_RELEASE_GATES.map((name) => {
    const item = byGate.get(name);
    const observed = item ? Date.parse(item.observed_at) : Number.NaN;
    const freshUntil = item ? Date.parse(item.fresh_until) : Number.NaN;
    const checksPass = item !== undefined && Object.keys(item.checks).length > 0 && Object.values(item.checks).every(Boolean);
    const current = Number.isFinite(observed) && observed <= now.getTime() + 30_000 && Number.isFinite(freshUntil) && freshUntil > now.getTime();
    return [name, {
      status: checksPass && current ? 'PASS' : 'FAIL',
      evidence_sha256: item?.evidence_sha256 ?? `sha256:${'0'.repeat(64)}`,
      observed_at: item?.observed_at ?? now.toISOString(),
    }];
  }));
  const eligible = Object.values(gates).every((gate) => gate.status === 'PASS');
  return UnsignedReleaseAttestationSchema.parse({
    ...descriptor,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    gates,
    eligible,
  });
}
