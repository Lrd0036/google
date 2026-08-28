'use client';

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

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
      <p className="ts-kicker">Auburn AIS presents</p>
      <h1>
        <span className="ts-clip">
          <span className="ts-word">When</span>
        </span>{' '}
        <span className="ts-clip">
          <span className="ts-word">the</span>
        </span>{' '}
        <span className="ts-clip">
          <span className="ts-word">Brainstem</span>
        </span>{' '}
        <span className="ts-clip">
          <span className="ts-word is-bleed">Bleeds</span>
        </span>
      </h1>
      <i className="ts-rule" />
      <p className="ts-sub">The Royal Duke incident, reconstructed from the control room to Data Center Alley.</p>
      <p className="ts-credit">Imagery: Esri, Maxar, Earthstar Geographics. Loudoun halls are public map centroids. Royal Duke sites are a scenario overlay.</p>
      <button type="button" className="ts-skip" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}
