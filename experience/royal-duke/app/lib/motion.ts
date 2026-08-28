'use client';

import { useEffect, useState } from 'react';

export function docEase(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

export function useAnimatedNumber(value: number, duration = 900) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = shown;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = 1 - (1 - t) ** 3;
      setShown(from + (value - from) * k);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);
  return shown;
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
