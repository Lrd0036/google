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
  events: Array<{ id: string; at: string; kind: string; summary: string }>;
};

type Connection = 'detached' | 'connecting' | 'online' | 'degraded';

export function useRangeTelemetry() {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [state, setState] = useState<RangeState | null>(null);
  const [connection, setConnection] = useState<Connection>('detached');
  const [error, setError] = useState('');

  useEffect(() => {
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
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
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
  };
}
