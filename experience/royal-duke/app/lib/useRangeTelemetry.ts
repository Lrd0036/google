'use client';

import { useCallback, useEffect, useState } from 'react';

export type RangeState = {
  modelId: string;
  schemaVersion: string;
  runId: string;
  stage: number;
  startedAt: string;
  completedActions: string[];
  availableActions: string[];
  services: { processPlc: 'online' | 'offline'; operatorGateway: 'online' | 'offline' };
  telemetry: Record<string, number>;
  telemetryErrors: string[];
  defensive: { evidencePreserved: boolean; remoteWritesContained: boolean; restorationPrepared: boolean };
  exerciseId: string | null;
  fleet: null | {
    exercise_id?: string;
    status: string;
    updated_at?: string;
    trace_id?: string;
    campaign?: { received: 214; routine: 147; decoys: 39; correlated_anomalies: 17; causal_events: 7; authoritative_facts: 4 };
    facts?: Array<{ fact_id: string; label: string; status: 'PENDING' | 'PROVEN'; evidence_ids: string[] }>;
    activities?: Array<{ activity_id: string; agent_name: string; status: string; summary: string; decision?: string; evidence_ids: string[] }>;
    divergence_elapsed_seconds?: number;
    recovery_elapsed_seconds?: number;
    recovery_started_at?: string;
    model_armor?: { template: string; match_state: string; invocation_result: string; verdict_event_id: string; trace_id: string };
    shadow_decision?: string;
    authoritative_decision?: string;
    pending_approval?: { approval_id: string; role: string; proposed_action: string };
    approval?: { decision: string; principal: string; assertion_id: string };
    injected_evidence?: { evidence_id: string; text: string; trust: string };
    report?: {
      title: string;
      executive_summary: string;
      report_sha256: string;
      event_chain_valid: boolean;
      event_ids: string[];
      verification: { outcome: string; threshold_psi: 58; stable_seconds: 30 };
      limitations: string[];
    };
    error?: string;
  };
  provenance: Array<{ key: string; label: string; value: string; status: 'VERIFIED' | 'UNAVAILABLE' | 'FAILED'; source: string; checked_at: string; href?: string }>;
  events: Array<{ id: string; at: string; kind: string; summary: string; detail?: Record<string, unknown> }>;
};

type Connection = 'detached' | 'connecting' | 'online' | 'degraded';

export function useRangeTelemetry() {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [state, setState] = useState<RangeState | null>(null);
  const [connection, setConnection] = useState<Connection>('detached');
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = new URLSearchParams(window.location.search).get('range');
      if (!value) return;
      try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
        setEndpoint(parsed.origin);
        setConnection('connecting');
      } catch {
        setConnection('degraded');
        setError('The range query parameter must be an HTTP or HTTPS origin.');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refresh = useCallback(async () => {
    if (!endpoint) return;
    try {
      const response = await fetch(`${endpoint}/api/v1/state`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`Range controller returned ${response.status}.`);
      const next = (await response.json()) as RangeState;
      setState(next);
      const healthy = Object.values(next.services).every((service) => service === 'online');
      setConnection(healthy ? 'online' : 'degraded');
      setError(next.telemetryErrors[0] ?? '');
    } catch (reason) {
      setConnection('degraded');
      setError(reason instanceof Error ? reason.message : 'Unable to reach the local range controller.');
    }
  }, [endpoint]);

  useEffect(() => {
    if (!endpoint) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [endpoint, refresh]);

  const post = useCallback(
    async (path: string) => {
      if (!endpoint) return;
      setError('');
      try {
        const response = await fetch(`${endpoint}${path}`, { method: 'POST', signal: AbortSignal.timeout(4000) });
        const body = (await response.json()) as RangeState & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Range controller returned ${response.status}.`);
        setState(body);
        setConnection('online');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Range action failed.');
        setConnection('degraded');
      }
    },
    [endpoint],
  );

  return {
    endpoint,
    state,
    connection,
    error,
    runAction: (id: string) => post(`/api/v1/actions/${encodeURIComponent(id)}`),
    reset: () => post('/api/v1/reset'),
    approve: () => post('/api/v1/fleet/approve'),
    reportUrl: endpoint ? `${endpoint}/api/v1/fleet/bundle` : null,
  };
}
