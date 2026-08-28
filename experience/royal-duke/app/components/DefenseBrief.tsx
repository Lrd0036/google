'use client';

import { EVIDENCE, EXPERIENCE, RESPONSE_STEPS } from '../lib/scenario';

type Props = {
  open: boolean;
  stage: number;
  onClose: () => void;
};

export default function DefenseBrief({ open, stage, onClose }: Props) {
  return (
    <div className={`brief${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="brief-dim" onClick={onClose} />
      <section className="brief-sheet" role="dialog" aria-labelledby="brief-title">
        <header className="brief-head">
          <div>
            <p>Compiled procedure · authority map</p>
            <h2 id="brief-title">Loss of trusted operator view</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <p className="brief-lede">
          The model may classify evidence. It cannot declare the physical incident, mint authority,
          approve {EXPERIENCE.process.primaryAsset} restoration, or declare recovery. Those boundaries
          come from the compiled runbook and deterministic process observations.
        </p>
        <div className="brief-grid">
          <div>
            <p className="brief-label">Compiled response</p>
            <ul className="brief-controls">
              {RESPONSE_STEPS.map((step, index) => (
                <li key={step.id}>
                  <div className="runbook-step">
                    <i>{String(index + 1).padStart(2, '0')}</i>
                    <span>
                      <strong>{step.title}</strong>
                      <small>{step.detail}</small>
                    </span>
                    <em>{step.authority}</em>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="brief-label">Canonical evidence</p>
            <ol className="brief-evidence">
              {EVIDENCE.map((item) => (
                <li key={item.sceneId} className={stage >= item.stage ? 'is-found' : ''}>
                  <span>{String(item.stage).padStart(2, '0')}</span>
                  {item.text}
                </li>
              ))}
            </ol>
            <div className="brief-result">
              <strong>{EXPERIENCE.brand.title}</strong>
              <p>{EXPERIENCE.brand.thesis}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
