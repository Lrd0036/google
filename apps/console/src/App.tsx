import { useState } from 'react';
import './styles/index.css';

type Tab = 'incidents' | 'approvals' | 'compiler';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('incidents');

  return (
    <div className="app-container">
      <header className="header">
        <div className="brand">
          <span className="logo-badge">RBIR v0.1</span>
          <span className="brand-title">Runbook Operator Console</span>
        </div>
        <nav className="nav-links">
          <button
            id="tab-incidents"
            className={`nav-button ${activeTab === 'incidents' ? 'active' : ''}`}
            onClick={() => setActiveTab('incidents')}
          >
            Active Executions
          </button>
          <button
            id="tab-approvals"
            className={`nav-button ${activeTab === 'approvals' ? 'active' : ''}`}
            onClick={() => setActiveTab('approvals')}
          >
            Human Approvals (1)
          </button>
          <button
            id="tab-compiler"
            className={`nav-button ${activeTab === 'compiler' ? 'active' : ''}`}
            onClick={() => setActiveTab('compiler')}
          >
            Compiler Studio
          </button>
        </nav>
      </header>

      <main className="main-content">
        <div className="hero-banner">
          <div className="hero-text">
            <h1>Autonomous Incident Mitigation with Hard Authority Boundaries</h1>
            <p>
              The model may interpret reality; it may not invent authority. Every consequential action requires a cryptographically signed Action Grant verified by the Action Broker.
            </p>
          </div>
        </div>

        {activeTab === 'incidents' && (
          <div className="grid-cards">
            <div className="card">
              <div className="card-title">
                <span>acme-ingestion-recovery</span>
                <span className="status-badge active">RUNNING</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Execution ID: <code>exec_01J87B64</code> • Lease: Generation 18
              </p>
              <div className="code-snippet">
                Current Node: [VERIFY] verify_job_completion<br />
                Last Transition: TRANSIENT_UPSTREAM_FAILURE &rarr; retry_job
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span>database-failover</span>
                <span className="status-badge pending">WAITING APPROVAL</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Execution ID: <code>exec_01J99D12</code> • Risk: R3_DESTRUCTIVE_HIGH
              </p>
              <div className="code-snippet">
                Target Node: [HUMAN_APPROVAL] promote_replica_to_primary<br />
                Floor: INCIDENT_COMMANDER
              </div>
            </div>
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="card" style={{ maxWidth: '800px' }}>
            <div className="card-title">
              <span>Pending Approval: Database Replica Promotion</span>
              <span className="status-badge pending">QUORUM 1/1</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Execution <code>exec_01J99D12</code> reached human approval boundary. Sign with Cloud KMS asymmetric assertion.
            </p>
            <div className="code-snippet" style={{ marginBottom: '1.5rem' }}>
              {`{
  "typ": "RB-APPROVAL-ASSERTION",
  "version": "0.1",
  "execution_id": "exec_01J99D12",
  "node_id": "promote_replica",
  "authority_id": "auth_01J_DIR",
  "decision": "APPROVE"
}`}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                id="btn-approve"
                style={{
                  background: 'var(--accent-emerald)',
                  color: '#fff',
                  border: 'none',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sign & Approve
              </button>
              <button
                id="btn-reject"
                style={{
                  background: 'var(--accent-rose)',
                  color: '#fff',
                  border: 'none',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {activeTab === 'compiler' && (
          <div className="card">
            <div className="card-title">
              <span>Interactive Runbook Compiler Studio</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Statically analyzes runbooks, generates content-addressed statement IDs, proves cycle bounds, and produces RBIR v0.1 JSON.
            </p>
            <div className="code-snippet">
              $ rbc check fixtures/runbooks/acme-ingestion-recovery.md<br />
              &gt; Parsed 14 structural blocks<br />
              &gt; CFG Analysis: Cycles bounded (Tarjan SCC = 1 finite loop)<br />
              &gt; Mutation Verification: PASSED (all mutations guarded by VERIFY)<br />
              &gt; Generated RBIR: dist/acme-ingestion-recovery.rbir.json
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
