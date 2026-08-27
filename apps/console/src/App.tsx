import { useEffect, useState } from 'react';
import './styles/index.css';

type Tab = 'overview' | 'approvals' | 'lint';
type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED';
const demoExecutions = [
  { id: 'exec_01J87B64', name: 'acme-ingestion-recovery', status: 'RUNNING', node: 'verify_job_completion', progress: 72, tone: 'good', detail: 'Retry branch is waiting on a deterministic postcondition.' },
  { id: 'exec_01J99D12', name: 'database-failover', status: 'WAITING APPROVAL', node: 'promote_replica_to_primary', progress: 48, tone: 'warn', detail: 'R3 destructive action is held at the Incident Commander floor.' },
];
const events = [
  ['14:32:08', 'VERIFY', 'verify_job_completion', 'Postcondition matched: queue_depth = 0'],
  ['14:31:52', 'AUDIT', 'retry_job', 'Action Grant accepted · lease generation 18'],
  ['14:30:17', 'GATE', 'promote_replica_to_primary', 'Approval assertion required · quorum 1/1'],
  ['14:29:44', 'LINTER', 'database-failover', 'RBK-207 warning: destructive mutation needs human approval'],
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [approval, setApproval] = useState<ApprovalState>('PENDING');
  const [approvalNotice, setApprovalNotice] = useState('');
  const [controlStatus, setControlStatus] = useState('LOCAL DEMO');
  const [liveExecutions, setLiveExecutions] = useState(demoExecutions);
  const [liveEvents, setLiveEvents] = useState(events);
  useEffect(() => {
    const controlUrl = (import.meta.env.VITE_CONTROL_URL as string | undefined) ?? 'http://localhost:8080';
    void fetch(`${controlUrl}/health`).then(async (response) => {
      if (!response.ok) throw new Error('control plane unavailable');
      setControlStatus('CONTROL PLANE ONLINE');
      const listing = await fetch(`${controlUrl}/executions`);
      if (!listing.ok) return;
      const body = await listing.json() as { executions?: Array<{ execution_id: string; status: string; cursor?: { active_tokens?: { main?: { node_id: string } } }; runbook?: { id: string } }> };
      if (body.executions?.length) {
        setLiveExecutions(body.executions.map((execution) => ({ id: execution.execution_id, name: execution.runbook?.id ?? 'execution', status: execution.status, node: execution.cursor?.active_tokens?.main?.node_id ?? '—', progress: execution.status === 'COMPLETED' ? 100 : execution.status === 'PENDING' ? 0 : 50, tone: execution.status === 'SUSPENDED_APPROVAL' || execution.status === 'HALTED' ? 'warn' : 'good', detail: 'Live state loaded from the Control Plane.' })));
        const first = body.executions[0];
        if (first) void fetch(`${controlUrl}/executions/${encodeURIComponent(first.execution_id)}/events`).then((response) => response.ok ? response.json() : undefined).then((eventBody: { events?: Array<{ timestamp?: string; type?: string; node_id?: string; payload?: { outcome?: string } }> } | undefined) => { if (eventBody?.events?.length) setLiveEvents(eventBody.events.map((event) => [event.timestamp?.slice(11, 19) ?? '—', event.type?.includes('VERIFY') ? 'VERIFY' : event.type?.includes('TRANSITION') ? 'AUDIT' : 'GATE', event.node_id ?? 'execution', event.payload?.outcome ? `Outcome: ${event.payload.outcome}` : 'Append-only runtime event'] as [string, string, string, string])); });
      }
    }).catch(() => setControlStatus('LOCAL DEMO · CONTROL OFFLINE'));
  }, []);
  const tabs: Array<[Tab, string, string?]> = [['overview', 'DAG overview'], ['approvals', 'Approvals', approval === 'PENDING' ? '1' : '0'], ['lint', 'Diagnostic linter', '3']];
  async function submitApproval(decision: 'APPROVE' | 'REJECT'): Promise<void> {
    setApprovalNotice('Submitting signed local approval…');
    try {
      const controlUrl = (import.meta.env.VITE_CONTROL_URL as string | undefined) ?? 'http://localhost:8080';
      const response = await fetch(`${controlUrl}/local/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: 'exec_01J99D12', approval_id: 'apr_exec_01J99D12_1', principal: 'local-operator', authority_id: 'local-incident-commander', decision }) });
      const body = await response.json() as { error?: string; assertion_jti?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setApproval(decision === 'APPROVE' ? 'APPROVED' : 'REJECTED');
      setApprovalNotice(`Recorded by Control Plane · ${body.assertion_jti ?? 'signed assertion'}`);
    } catch (error) { setApprovalNotice(`Approval not recorded: ${error instanceof Error ? error.message : 'request failed'}`); }
  }
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">RB</span><div><strong>RunbookBench</strong><span>operator console</span></div></div><div className="topbar-meta"><span className="live-dot" /> {controlStatus} <span className="divider" /> <code>tenant/acme</code></div></header>
    <main className="workspace">
      <section className="intro"><div><p className="eyebrow">RUNBOOK COMPILER · RBIR v0.1</p><h1>Operational control, with authority visible.</h1><p className="intro-copy">One surface for DAG execution, consequential approvals, audit evidence, and compiler diagnostics.</p></div><div className="safety-card"><span className="shield">✓</span><div><small>FATAL SAFETY GATE</small><strong>PASSING</strong><span>0 invented authority paths</span></div></div></section>
      <nav className="tabs" aria-label="Console sections">{tabs.map(([tab, label, count]) => <button key={tab} className={activeTab === tab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab)}>{label}{count && <span className="tab-count">{count}</span>}</button>)}</nav>
      {activeTab === 'overview' && <><section className="section-heading"><div><p className="eyebrow">LIVE EXECUTIONS</p><h2>Active DAG status</h2></div><span className="refresh">● {controlStatus === 'CONTROL PLANE ONLINE' ? 'control plane' : 'demo'} · {liveExecutions.length} executions</span></section><section className="execution-grid">{liveExecutions.map((execution) => <article className="panel execution" key={execution.id}><div className="panel-head"><div><h3>{execution.name}</h3><code>{execution.id}</code></div><span className={`status ${execution.tone}`}>{execution.status}</span></div><div className="node-row"><span className="node-icon">{execution.tone === 'warn' ? '!' : '↗'}</span><div><small>CURRENT NODE</small><strong>{execution.node}</strong></div></div><div className="progress"><span style={{ width: `${execution.progress}%` }} /></div><div className="execution-foot"><span>{execution.progress}% through DAG</span><span className="muted">live state</span></div><p className="detail">{execution.detail}</p></article>)}</section><section className="lower-grid"><article className="panel event-panel"><div className="panel-head"><div><p className="eyebrow">APPEND-ONLY STREAM</p><h2>Live audit events</h2></div><span className="live-label"><span className="live-dot" /> LIVE</span></div><div className="events">{liveEvents.map(([time, kind, node, message]) => <div className="event" key={`${time}-${node}` }><time>{time}</time><span className={`event-kind ${kind.toLowerCase()}`}>{kind}</span><div><strong>{node}</strong><p>{message}</p></div></div>)}</div></article><article className="panel invariant"><p className="eyebrow">SYSTEM INVARIANT</p><blockquote>“The model may interpret reality; it may not invent authority.”</blockquote><div className="invariant-line"><span>Action Broker</span><strong>ENFORCING</strong></div><div className="invariant-line"><span>Manifest hash</span><code>sha256:7a9e…c41b</code></div><div className="invariant-line"><span>Control epoch</span><code>epoch_0042</code></div></article></section></>}
      {activeTab === 'approvals' && <section className="approval-layout"><article className="panel approval-card"><div className="panel-head"><div><p className="eyebrow">PENDING HUMAN ACTION</p><h2>Promote replica to primary</h2><code>exec_01J99D12 · node promote_replica_to_primary</code></div><span className="status warn">{approval}</span></div><div className="approval-warning"><span>!</span><div><strong>R3 · HIGH IMPACT</strong><p>This action changes production state and cannot be released by the agent. Incident Commander approval is required.</p></div></div><dl className="claims"><div><dt>REQUESTED BY</dt><dd>database-failover runbook</dd></div><div><dt>AUTHORITY FLOOR</dt><dd>INCIDENT_COMMANDER</dd></div><div><dt>ASSERTION TTL</dt><dd>04:52 remaining</dd></div><div><dt>TARGET SCOPE</dt><dd>acme-prod / replica-02</dd></div></dl><div className="assertion"><p className="eyebrow">SIGNED ASSERTION PREVIEW</p><pre>{`{\n  "typ": "RB-APPROVAL-ASSERTION",\n  "execution_id": "exec_01J99D12",\n  "node_id": "promote_replica_to_primary",\n  "decision": "${approval === 'PENDING' ? 'PENDING' : approval}"\n}`}</pre></div><p className="detail" role="status">{approvalNotice}</p><div className="actions"><button className="button danger" onClick={() => void submitApproval('REJECT')} disabled={approval !== 'PENDING'}>Reject action</button><button className="button primary" onClick={() => void submitApproval('APPROVE')} disabled={approval !== 'PENDING'}>Sign &amp; approve</button></div></article></section>}
      {activeTab === 'lint' && <section className="lint-layout"><article className="panel linter"><div className="panel-head"><div><p className="eyebrow">COMPILER DIAGNOSTICS</p><h2>database-failover</h2></div><span className="status warn">3 FINDINGS</span></div>{[['RBK-207', 'WARNING', 'Destructive mutation requires an approval floor.', 'promote_replica_to_primary'], ['RBK-114', 'ERROR', 'Predicate “replica is safe” is ambiguous at a high-impact boundary.', 'check_replica_safety'], ['RBK-301', 'INFO', 'Verification postcondition is configured to post-dominate the action.', 'verify_replica_state']].map(([code, severity, message, node]) => <div className="finding" key={code}><span className={`severity ${severity.toLowerCase()}`}>{severity}</span><div><strong><code>{code}</code> {message}</strong><p>{node}</p></div><button className="text-button">Inspect →</button></div>)}</article><aside className="panel lint-summary"><p className="eyebrow">ANALYSIS SUMMARY</p><div className="summary-number">14<span> blocks</span></div><div className="summary-row"><span>CFG cycles</span><strong className="green">bounded</strong></div><div className="summary-row"><span>Mutation verification</span><strong className="green">passed</strong></div><div className="summary-row"><span>Authority gates</span><strong className="amber">1 pending</strong></div><div className="summary-row"><span>Generated artifact</span><code>rbir/v0.1</code></div></aside></section>}
    </main>
  </div>;
}
