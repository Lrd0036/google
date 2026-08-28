'use client';

import rangeModel from '../../range/royal-duke/scenario.json';
import type { RangeState } from '../lib/useRangeTelemetry';

type Props = {
  open: boolean;
  documentaryStage: number;
  endpoint: string | null;
  connection: 'detached' | 'connecting' | 'online' | 'degraded';
  rangeState: RangeState | null;
  error: string;
  onClose: () => void;
  onRunAction: (id: string) => void;
  onReset: () => void;
};

const assetById = Object.fromEntries(rangeModel.assets.map((asset) => [asset.id, asset]));

export default function AttackSurface({
  open,
  documentaryStage,
  endpoint,
  connection,
  rangeState,
  error,
  onClose,
  onRunAction,
  onReset,
}: Props) {
  const isLive = connection === 'online' && rangeState;
  const completed = new Set(rangeState?.completedActions ?? []);
  const available = new Set(rangeState?.availableActions ?? []);
  const nextAction = rangeModel.actions.find((action) => available.has(action.id));
  const physical = rangeState?.telemetry['process.pressure.psi'];
  const operator = rangeState?.telemetry['operator.pressure.psi'];
  const divergence = rangeState?.telemetry['integrity.pressure.delta'];

  return (
    <div className={`surface${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="surface-dim" onClick={onClose} />
      <section className="surface-sheet" role="dialog" aria-labelledby="surface-title">
        <header className="surface-head">
          <div>
            <p>Executable model · OT-sim</p>
            <h2 id="surface-title">Attack surface, not a shortcut</h2>
          </div>
          <div className="surface-head-actions">
            <span className={`range-state is-${connection}`}>{connection}</span>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        <p className="surface-lede">
          Reachability is only one gate. This chain also requires an attributable session, an engineering path, controller-project
          knowledge, operator-view authority, controller-write authority, and independent evidence that the process actually moved.
        </p>

        <div className="surface-truth">
          <span><b>Live protocol</b> Modbus TCP · DNP3 TCP</span>
          <span><b>Interface contract</b> Siemens S7 engineering trust</span>
          <span><b>Physical model</b> Pump · pressure · flow · reservoir</span>
        </div>

        <div className="surface-topology" aria-label="Modeled OT topology">
          {rangeModel.surfaces.map((surface) => (
            <div className="surface-hop" key={surface.id}>
              <div>
                <small>{assetById[surface.from]?.zone}</small>
                <strong>{assetById[surface.from]?.label}</strong>
              </div>
              <i className={surface.fidelity === 'live-protocol' ? 'is-live' : ''}>
                <b>{surface.protocol}</b>
                {surface.port ? `TCP/${surface.port}` : surface.fidelity}
              </i>
              <div>
                <small>{assetById[surface.to]?.zone}</small>
                <strong>{assetById[surface.to]?.label}</strong>
              </div>
            </div>
          ))}
        </div>

        <div className="surface-grid">
          <div>
            <p className="surface-label">Prerequisite gates</p>
            <ol className="surface-actions">
              {rangeModel.actions.map((action) => {
                const done = rangeState ? completed.has(action.id) : documentaryStage >= action.stage;
                const ready = rangeState ? available.has(action.id) : documentaryStage === action.stage;
                return (
                  <li key={action.id} className={done ? 'is-done' : ready ? 'is-ready' : ''}>
                    <span>{String(action.stage).padStart(2, '0')}</span>
                    <div>
                      <strong>{action.label}</strong>
                      <small>{action.effect}</small>
                      <em>{action.plane} · evidence: {action.evidence}</em>
                    </div>
                    <b>{done ? 'Proven' : ready ? 'Ready' : 'Locked'}</b>
                  </li>
                );
              })}
            </ol>
          </div>

          <aside className="surface-live">
            <p className="surface-label">Range telemetry</p>
            <div className="surface-readouts">
              <div><span>Operator</span><strong>{Number.isFinite(operator) ? `${operator.toFixed(1)} PSI` : '—'}</strong></div>
              <div><span>Physical</span><strong>{Number.isFinite(physical) ? `${physical.toFixed(1)} PSI` : '—'}</strong></div>
              <div><span>Integrity delta</span><strong>{Number.isFinite(divergence) ? `${divergence.toFixed(1)} PSI` : '—'}</strong></div>
            </div>
            <p className="surface-connection">
              {endpoint
                ? `${isLive ? 'Attached to' : 'Trying'} ${endpoint}`
                : 'Documentary projection. Add ?range=http://127.0.0.1:9400 to attach the local simulator.'}
            </p>
            {error && <p className="surface-error" role="alert">{error}</p>}
            <div className="surface-run">
              <button type="button" onClick={onReset} disabled={!endpoint}>Reset model</button>
              <button type="button" className="is-primary" onClick={() => nextAction && onRunAction(nextAction.id)} disabled={!isLive || !nextAction}>
                {nextAction ? `Run: ${nextAction.label}` : rangeState ? 'No gate is currently ready' : 'Attach live range to run'}
              </button>
            </div>
            <p className="surface-caveat">No shell, scanner, packet builder, or arbitrary tag-write route is exposed by this controller.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
