'use client';

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { useAnimatedNumber } from '../lib/motion';
import { EXPERIENCE, STAGES, THRESHOLDS } from '../lib/scenario';

type Props = {
  stage: number;
  playing: boolean;
  operatorPressure: number;
  physicalPressure: number;
  log: readonly string[];
  onPlay: () => void;
  onReset: () => void;
  onAdvance: () => void;
  onStage: (index: number) => void;
  onDefend: () => void;
  onInspect: () => void;
};

export default function FilmOverlay({
  stage,
  playing,
  operatorPressure,
  physicalPressure,
  log,
  onPlay,
  onReset,
  onAdvance,
  onStage,
  onDefend,
  onInspect,
}: Props) {
  const current = STAGES[stage];
  const titleRef = useRef<HTMLDivElement>(null);
  const op = useAnimatedNumber(operatorPressure, 900);
  const phys = useAnimatedNumber(physicalPressure, 1100);
  const deceptive = Math.abs(operatorPressure - physicalPressure) > 0.4;

  useLayoutEffect(() => {
    const root = titleRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.chapter-kicker', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });
      gsap.fromTo('.chapter-title', { y: '108%' }, { y: '0%', duration: 0.85, ease: 'power4.out', delay: 0.05 });
      gsap.fromTo('.chapter-sub', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', delay: 0.28 });
      gsap.fromTo('.chapter-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'power3.inOut', delay: 0.12 });
    }, root);
    return () => ctx.revert();
  }, [stage]);

  return (
    <div className="overlay">
      <header className="overlay-top">
        <div className="masthead">
          <p>{EXPERIENCE.brand.mastheadKicker}</p>
          <strong>{EXPERIENCE.brand.mastheadTitle}</strong>
        </div>
        <div className="mast-actions">
          <div className="clock">
            <span>Story time</span>
            <b>T+ {current.storyTime}</b>
          </div>
          <div className="mast-links">
            <button type="button" className="text-btn" onClick={onInspect}>Attack surface</button>
            <button type="button" className="text-btn" onClick={onDefend}>Runbook &amp; authority</button>
          </div>
        </div>
        <p className="mast-credit">{EXPERIENCE.brand.mapCredit}</p>
      </header>

      <div className="chapter" ref={titleRef}>
        <p className="chapter-kicker">{current.kicker}</p>
        <div className="chapter-clip">
          <h1 className="chapter-title">{current.title}</h1>
        </div>
        <i className="chapter-rule" />
        <p className="chapter-sub">{current.subtitle}</p>
      </div>

      <aside className="wire">
        {log.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </aside>

      <div className="overlay-floor">
        <section className={`lower-third${deceptive ? ' is-split' : ''}${current.visual.contained ? ' is-held' : ''}`}>
          <div>
            <span>Operator view</span>
            <strong>{op.toFixed(1)} {EXPERIENCE.process.pressureUnit}</strong>
            <small>{current.operatorDetail}</small>
          </div>
          <div>
            <span>Incident state</span>
            <strong>{current.event}</strong>
            <small>{current.visual.contained ? 'Compiled authority plane engaged' : current.subtitle}</small>
          </div>
          <div className={physicalPressure < THRESHOLDS.lowPressurePsi && !current.visual.recovered ? 'is-alert' : ''}>
            <span>Physical truth</span>
            <strong>{phys.toFixed(1)} {EXPERIENCE.process.pressureUnit}</strong>
            <small>{current.physicalDetail}</small>
          </div>
        </section>

        <nav className="chapters" aria-label="Chapters">
          {STAGES.map((item, index) => (
            <button
              key={item.short}
              type="button"
              className={index === stage ? 'is-active' : index < stage ? 'is-done' : ''}
              onClick={() => onStage(index)}
            >
              <span>{String(index).padStart(2, '0')}</span>
              {item.short}
            </button>
          ))}
        </nav>

        <div className="transport">
          <button type="button" onClick={onReset}>
            Reset
          </button>
          <button type="button" className="play" onClick={onPlay}>
            {playing ? 'Pause' : 'Play briefing'}
          </button>
          <button type="button" onClick={onAdvance}>
            {current.activation.statuses?.some((status) => status === 'COMPLETED' || status === 'ESCALATED') ? 'Hold on outcome' : 'Advance'}
          </button>
        </div>
      </div>
    </div>
  );
}
