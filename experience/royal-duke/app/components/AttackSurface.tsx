'use client';

import type { CSSProperties } from 'react';
import rangeModel from '../../range/royal-duke/scenario.json';
import type { RangeState } from '../lib/useRangeTelemetry';

type Props = {
  open: boolean; documentaryStage: number; endpoint: string | null;
  connection: 'detached' | 'connecting' | 'online' | 'degraded';
  rangeState: RangeState | null; error: string; reportUrl: string | null;
  onClose: () => void; onRunAction: (id: string) => void; onReset: () => void; onApprove: () => void;
};

const agents = ['Incident Commander', 'Evidence Correlator', 'Adversarial Content Analyst', 'Process Safety Coordinator', 'Incident Reporter'];

export default function AttackSurface({ open, documentaryStage, endpoint, connection, rangeState, error, reportUrl, onClose, onRunAction, onReset, onApprove }: Props) {
  const isLive = connection === 'online' && rangeState;
  const completed = new Set(rangeState?.completedActions ?? []);
  const available = new Set(rangeState?.availableActions ?? []);
  const nextAction = rangeModel.actions.find((action) => available.has(action.id));
  const physical = rangeState?.telemetry['process.pressure.psi'];
  const operator = rangeState?.telemetry['operator.pressure.psi'];
  const divergence = rangeState?.telemetry['integrity.pressure.delta'];
  const fleet = rangeState?.fleet;
  const campaign = fleet?.campaign;
  const facts = fleet?.facts ?? [];
  const activities = fleet?.activities ?? [];
  const divergenceSeconds = Math.min(15, fleet?.divergence_elapsed_seconds ?? 0);
  const recoverySeconds = Math.min(30, fleet?.status === 'VERIFYING' && fleet.recovery_started_at ? Math.max(0, (Date.parse(fleet.updated_at ?? fleet.recovery_started_at) - Date.parse(fleet.recovery_started_at)) / 1000) : fleet?.recovery_elapsed_seconds ?? 0);
  const firstAction = !rangeState?.completedActions.length;
  const pendingApproval = fleet?.status === 'AWAITING_APPROVAL' && fleet.pending_approval;
  const verifying = fleet?.status === 'VERIFYING';
  const complete = fleet?.status === 'COMPLETED';

  return <div className={`surface attack-cockpit${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
    <div className="surface-dim" onClick={onClose} />
    <section className="surface-sheet cockpit-sheet" role="dialog" aria-labelledby="surface-title">
      <header className="surface-head cockpit-head"><div><p>Fortified Enterprise Fleet · live exercise</p><h2 id="surface-title">Royal Duke: Attack the Agent</h2><blockquote>A defensive AI fleet that can be deceived and partially compromised without surrendering authority.</blockquote></div><div className="surface-head-actions"><span className={`range-state is-${connection}`}>{connection}</span><span className={`fleet-state is-${(fleet?.status ?? 'detached').toLowerCase()}`}>{fleet?.status ?? 'FLEET DETACHED'}</span><button type="button" onClick={onClose}>Close</button></div></header>

      <div className="cockpit-grid">
        <section className="cockpit-column attack-column">
          <div className="cockpit-section-head"><div><p className="surface-label">Red team · guided attack</p><h3>Attack progression</h3></div><button type="button" className="cockpit-reset" onClick={onReset} disabled={!endpoint}>Reset</button></div>
          <ol className="surface-actions cockpit-actions">{rangeModel.actions.map((action, index) => { const done = rangeState ? completed.has(action.id) : documentaryStage >= action.stage; const ready = rangeState ? available.has(action.id) : documentaryStage === action.stage; return <li key={action.id} className={done ? 'is-done' : ready ? 'is-ready' : ''}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{action.label}</strong><small>{action.effect}</small><em>{action.plane}</em></div><b>{done ? action.id === 'followup_write_attempt' ? 'Blocked' : 'Proven' : ready ? 'Ready' : 'Locked'}</b></li>; })}</ol>
          <button type="button" className="begin-attack" onClick={() => nextAction && onRunAction(nextAction.id)} disabled={!isLive || !nextAction}>{firstAction ? 'BEGIN ATTACK' : nextAction ? nextAction.label : complete ? 'EXERCISE COMPLETE' : 'WAITING ON DEFENSIVE FLEET'}</button>
          {error && <p className="surface-error" role="alert">{error}</p>}
        </section>

        <section className="cockpit-column evidence-column">
          <p className="surface-label">Physical truth · deterministic policy</p>
          <div className="pressure-stage"><div><span>Operator HMI</span><strong>{Number.isFinite(operator) ? operator.toFixed(1) : '—'} <small>PSI</small></strong><i>potentially compromised</i></div><div><span>Independent</span><strong>{Number.isFinite(physical) ? physical.toFixed(1) : '—'} <small>PSI</small></strong><i>trusted process telemetry</i></div><div><span>Delta</span><strong>{Number.isFinite(divergence) ? divergence.toFixed(1) : '—'} <small>PSI</small></strong><i>&gt; 5 PSI required</i></div></div>
          <div className="timer-card"><div><span>Incident predicate</span><b>{divergenceSeconds.toFixed(1)} / 15 sec</b></div><div className="timer-track"><i style={{ width: `${(divergenceSeconds / 15) * 100}%` }} /></div><p>The model does not decide when a process incident exists.</p></div>
          {(verifying || complete) && <div className="timer-card is-recovery"><div><span>Recovery verification</span><b>{complete ? '30.0' : recoverySeconds.toFixed(1)} / 30 sec</b></div><div className="timer-track"><i style={{ width: `${complete ? 100 : (recoverySeconds / 30) * 100}%` }} /></div><p>Recovery is pressure above 58 PSI for 30 seconds—not whatever Gemini calls success.</p></div>}
          <div className="campaign-card"><div className="cockpit-section-head"><div><p className="surface-label">Campaign synthesis</p><h3>{campaign?.received ?? 214} events received</h3></div><span>seeded · reproducible</span></div><div className="campaign-funnel"><div style={{ '--funnel': '100%' } as CSSProperties}><b>{campaign?.routine ?? 147}</b><span>routine / background</span></div><div style={{ '--funnel': '72%' } as CSSProperties}><b>{campaign?.decoys ?? 39}</b><span>decoys</span></div><div style={{ '--funnel': '52%' } as CSSProperties}><b>{campaign?.correlated_anomalies ?? 17}</b><span>correlated anomalies</span></div><div style={{ '--funnel': '36%' } as CSSProperties}><b>{campaign?.causal_events ?? 7}</b><span>causal events</span></div><div className="is-final" style={{ '--funnel': '24%' } as CSSProperties}><b>{campaign?.authoritative_facts ?? 4}</b><span>authoritative facts</span></div></div><div className="fact-list">{facts.map((fact) => <details key={fact.fact_id} open={fact.status === 'PROVEN'}><summary><span className={fact.status === 'PROVEN' ? 'fact-proven' : ''}>{fact.status}</span>{fact.label}</summary><code>{fact.evidence_ids.join(' · ')}</code></details>)}</div></div>
        </section>

        <section className="cockpit-column fleet-column">
          <p className="surface-label">Blue team · autonomous fleet</p>
          <div className="agent-roster">{agents.map((name) => { const latest = [...activities].reverse().find((item) => item.agent_name === name); return <div key={name} className={latest ? 'is-active' : ''}><i /><span>{name}</span><b>{latest?.status ?? 'STANDBY'}</b></div>; })}</div>
          {fleet?.injected_evidence && <div className="injection-card"><p className="surface-label">Attack against the defender</p><code>{fleet.injected_evidence.text}</code><div className="decision-split"><div className="is-compromised"><span>Shadow analyst</span><strong>{fleet.shadow_decision ?? 'ANALYZING'}</strong><small>partially compromised · no tools</small></div><div className="is-authoritative"><span>Authoritative fleet</span><strong>{fleet.authoritative_decision ?? 'ANALYZING'}</strong><small>{fleet.injected_evidence.trust}</small></div></div>{fleet.model_armor && <p className="armor-verdict"><b>MODEL ARMOR</b> {fleet.model_armor.match_state} · {fleet.model_armor.verdict_event_id}</p>}</div>}
          <div className="fleet-feed">{activities.slice(-6).reverse().map((item) => <article key={item.activity_id} className={item.status === 'COMPROMISED' ? 'is-compromised' : ''}><div><strong>{item.agent_name}</strong><span>{item.status}</span></div><p>{item.summary}</p>{item.decision && <code>{item.decision}</code>}</article>)}</div>
          {pendingApproval && <div className="approval-boundary"><p className="surface-label">Human authority required</p><h3>Restore P-101</h3><dl><div><dt>Physical pressure</dt><dd>{Number.isFinite(physical) ? physical.toFixed(1) : '—'} PSI</dd></div><div><dt>Remote path</dt><dd>{rangeState?.defensive.remoteWritesContained ? 'CONTAINED' : 'AVAILABLE'}</dd></div><div><dt>Proposed action</dt><dd>{fleet.pending_approval?.proposed_action}</dd></div></dl><button type="button" onClick={onApprove}>SIGN &amp; APPROVE RESTORATION</button></div>}
          {fleet?.report && <div className="report-card"><p className="surface-label">Post-incident report</p><h3>{fleet.report.title}</h3><p>{fleet.report.executive_summary}</p><div><span>VERIFY</span><b>{fleet.report.verification.outcome}</b></div><div><span>EVENT CHAIN</span><b>{fleet.report.event_chain_valid ? 'VALID' : 'INVALID'}</b></div><code>{fleet.report.report_sha256}</code>{reportUrl && <a href={reportUrl} target="_blank" rel="noreferrer">Download evidence bundle</a>}</div>}
        </section>
      </div>

      <section className="provenance-panel"><div className="cockpit-section-head"><div><p className="surface-label">Institutional fleet evidence</p><h3>Live provenance</h3></div><span>Unavailable evidence fails submission readiness</span></div><div className="provenance-grid">{(rangeState?.provenance ?? []).map((proof) => <div key={proof.key} className={`is-${proof.status.toLowerCase()}`}><span>{proof.label}</span><strong>{proof.value}</strong><small>{proof.source} · {proof.status}</small>{proof.href && <a href={proof.href} target="_blank" rel="noreferrer">Open proof ↗</a>}</div>)}{!rangeState?.provenance.length && <p className="surface-caveat">Attach Runbook Control to populate live Registry, Identity, Runtime, Memory, Gateway, Model Armor, Firestore, Pub/Sub, Trace, and model evidence.</p>}</div></section>
    </section>
  </div>;
}
