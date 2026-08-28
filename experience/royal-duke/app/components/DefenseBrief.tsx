'use client';

import { BUDGET_CAP, DEFENSES, EVIDENCE } from '../lib/scenario';

type Props = {
  open: boolean;
  stage: number;
  spend: number;
  selected: string[];
  blockStage: number;
  budgetError: string;
  onClose: () => void;
  onToggle: (id: string) => void;
  onReplay: () => void;
};

export default function DefenseBrief({
  open,
  stage,
  spend,
  selected,
  blockStage,
  budgetError,
  onClose,
  onToggle,
  onReplay,
}: Props) {
  const held = blockStage !== Number.POSITIVE_INFINITY;
  return (
    <div className={`brief${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="brief-dim" onClick={onClose} />
      <section className="brief-sheet" role="dialog" aria-labelledby="brief-title">
        <header className="brief-head">
          <div>
            <p>Phase II · Investigation file</p>
            <h2 id="brief-title">Defend Royal Duke</h2>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="brief-lede">
          You have $500,000. The attack path does not change. Spend the money, replay the same night, and prove where a control
          turns a network incident back into a plant that still has water.
        </p>
        <div className="brief-budget">
          <div>
            <span>Defense budget</span>
            <strong>
              {(spend * 1000).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} /{' '}
              {(BUDGET_CAP * 1000).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </strong>
          </div>
          <div className="brief-track">
            <b style={{ width: `${Math.min(100, (spend / BUDGET_CAP) * 100)}%` }} />
          </div>
          <p role="alert">{budgetError}</p>
        </div>
        <div className="brief-grid">
          <div>
            <p className="brief-label">Controls</p>
            <ul className="brief-controls">
              {DEFENSES.map((defense) => {
                const on = selected.includes(defense.id);
                return (
                  <li key={defense.id}>
                    <button type="button" className={on ? 'is-on' : ''} aria-pressed={on} onClick={() => onToggle(defense.id)}>
                      <i>{on ? 'On' : 'Off'}</i>
                      <span>
                        <strong>{defense.title}</strong>
                        <small>{defense.brief}</small>
                      </span>
                      <em>
                        {(defense.cost * 1000).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                        <small>Stops {String(defense.stage).padStart(2, '0')}</small>
                      </em>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="brief-label">Evidence notebook</p>
            <ol className="brief-evidence">
              {EVIDENCE.map((item) => (
                <li key={item.text} className={stage >= item.stage ? 'is-found' : ''}>
                  <span>{String(item.stage).padStart(2, '0')}</span>
                  {item.text}
                </li>
              ))}
            </ol>
            <div className="brief-result">
              <strong>{held ? `Projected stop: chapter ${String(blockStage).padStart(2, '0')}` : 'Attack path still open'}</strong>
              <p>
                {held
                  ? 'Replay the briefing. The packet should die at the first control you funded.'
                  : 'No selected control currently breaks the chain.'}
              </p>
            </div>
            <button type="button" className="brief-replay" onClick={onReplay}>
              Replay the attack
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
