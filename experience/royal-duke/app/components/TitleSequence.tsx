'use client';

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { EXPERIENCE } from '../lib/scenario';

type Props = {
  visible: boolean;
  onSkip: () => void;
};

export default function TitleSequence({ visible, onSkip }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!visible || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.fromTo('.ts-kicker', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out' })
        .fromTo('.ts-word', { y: '115%' }, { y: '0%', duration: 1.15, stagger: 0.09, ease: 'power4.out' }, 0.25)
        .fromTo('.ts-rule', { scaleX: 0 }, { scaleX: 1, duration: 1.35, ease: 'power2.inOut' }, 0.55)
        .fromTo('.ts-sub', { opacity: 0 }, { opacity: 1, duration: 1.1, ease: 'power2.out' }, 1.15)
        .fromTo('.ts-skip', { opacity: 0 }, { opacity: 1, duration: 0.6 }, 1.4);
    }, root);
    return () => ctx.revert();
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="title-seq" ref={root}>
      <p className="ts-kicker">{EXPERIENCE.brand.titleSequence.kicker}</p>
      <h1>
        {EXPERIENCE.brand.titleSequence.words.map((word) => (
          <span className="ts-clip" key={word}>
            <span className={`ts-word${word === EXPERIENCE.brand.titleSequence.accentWord ? ' is-bleed' : ''}`}>{word}</span>{' '}
          </span>
        ))}
      </h1>
      <i className="ts-rule" />
      <p className="ts-sub">{EXPERIENCE.brand.titleSequence.subtitle}</p>
      <p className="ts-credit">{EXPERIENCE.brand.titleSequence.credit}</p>
      <button type="button" className="ts-skip" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}
