'use client';

import { useCallback, useEffect, useState } from 'react';

export type RangeState = {
  revision: number;
  emittedAt: string;
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
    campaign?: { received: number; routine: number; decoys: number; correlated_anomalies: number; causal_events: number; authoritative_facts: number };
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
      verification: { outcome: string; threshold_psi: number; stable_seconds: number };
      limitations: string[];
    };
    error?: string;
  };
  provenance: Array<{ key: string; label: string; value: string; status: 'VERIFIED' | 'UNAVAILABLE' | 'FAILED'; source: string; checked_at: string; href?: string }>;
  events: Array<{ id: string; at: string; kind: string; summary: string; detail?: Record<string, unknown> }>;
};

type Connection = 'detached' | 'connecting' | 'online' | 'degraded';

export function useRangeTelemetry() {
  const endpoint = '/api/royal-duke';
  const [state, setState] = useState<RangeState | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${endpoint}/state`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
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
    if (typeof EventSource === 'undefined') {
      const initial = window.setTimeout(() => void refresh(), 0);
      const timer = window.setInterval(() => void refresh(), 1500);
      return () => { window.clearTimeout(initial); window.clearInterval(timer); };
    }

    const stream = new EventSource(`${endpoint}/events`);
    let receivedState = false;
    stream.addEventListener('state', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as RangeState;
        receivedState = true;
        setState((current) => !current || next.revision >= current.revision ? next : current);
        const healthy = Object.values(next.services).every((service) => service === 'online');
        setConnection(healthy ? 'online' : 'degraded');
        setError(next.telemetryErrors[0] ?? next.fleet?.error ?? '');
      } catch {
        setConnection('degraded');
        setError('The range controller emitted an invalid state event.');
      }
    });
    stream.onopen = () => setConnection((value) => value === 'online' ? value : 'connecting');
    stream.onerror = () => {
      setConnection('degraded');
      setError('Real-time Control stream interrupted; reconnecting.');
      if (!receivedState) void refresh();
    };
    return () => stream.close();
  }, [endpoint, refresh]);

  const post = useCallback(
    async (path: string) => {
      setError('');
      try {
        // Starting an exercise may include managed-agent, Model Armor, and
        // provenance calls. A short UI timeout can report failure after the
        // controller has already committed the action, which makes the map
        // appear to disagree with canonical range state.
        const response = await fetch(`${endpoint}${path}`, { method: 'POST', signal: AbortSignal.timeout(120_000) });
        const body = (await response.json()) as RangeState & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Range controller returned ${response.status}.`);
        setState((current) => !current || body.revision >= current.revision ? body : current);
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
    runAction: (id: string) => post(`/actions/${encodeURIComponent(id)}`),
    reset: () => post('/reset'),
    approve: () => post('/fleet/approve'),
    reportUrl: `${endpoint}/fleet/bundle`,
  };
}
