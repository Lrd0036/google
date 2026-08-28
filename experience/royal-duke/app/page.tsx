'use client';

import { useEffect, useRef, useState } from 'react';
import AttackSurface from './components/AttackSurface';
import DefenseBrief from './components/DefenseBrief';
import DocumentaryMap from './components/DocumentaryMap';
import FilmOverlay from './components/FilmOverlay';
import TitleSequence from './components/TitleSequence';
import { usePrefersReducedMotion } from './lib/motion';
import { deriveSceneIndex, STAGES } from './lib/scenario';
import { useRangeTelemetry } from './lib/useRangeTelemetry';

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export default function Home() {
  const reduced = usePrefersReducedMotion();
  const [intro, setIntro] = useState(!reduced);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [defenseOpen, setDefenseOpen] = useState(false);
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  const openedLiveCockpit = useRef(false);
  const range = useRangeTelemetry();
  const current = STAGES[stage];
  const livePhysical = range.state?.telemetry['process.pressure.psi'];
  const liveOperator = range.state?.telemetry['operator.pressure.psi'];
  const useLiveTelemetry = range.connection === 'online' && isFiniteNumber(livePhysical) && isFiniteNumber(liveOperator);
  const physicalPressure = useLiveTelemetry ? livePhysical : current.fallbackPhysicalPressurePsi;
  const operatorPressure = useLiveTelemetry ? liveOperator : current.fallbackOperatorPressurePsi;

  useEffect(() => {
    if (!playing || intro) return;
    const timer = window.setTimeout(() => {
      const terminal = current.activation.statuses?.some((status) => status === 'COMPLETED' || status === 'ESCALATED');
      if (terminal || stage >= STAGES.length - 1) {
        setPlaying(false);
        return;
      }
      setStage((value) => Math.min(STAGES.length - 1, value + 1));
    }, STAGES[stage].durationMs);
    return () => window.clearTimeout(timer);
  }, [playing, stage, intro, current.activation.statuses]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (defenseOpen) setDefenseOpen(false);
        else if (intro) setIntro(false);
        return;
      }
      if (defenseOpen || event.target instanceof HTMLInputElement) return;
      if (event.key === ' ' && !intro) {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.key === 'ArrowRight') setStage((value) => Math.min(STAGES.length - 1, value + 1));
      if (event.key === 'ArrowLeft') setStage((value) => Math.max(0, value - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [defenseOpen, intro]);

  useEffect(() => {
    if (range.connection !== 'online' || !range.state) return;
    const timer = window.setTimeout(() => {
      setStage(deriveSceneIndex(range.state));
      if (!openedLiveCockpit.current) {
        openedLiveCockpit.current = true;
        setIntro(false);
        setPlaying(false);
        setSurfaceOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [range.connection, range.state]);

  return (
    <main className="film">
      <DocumentaryMap
        stage={stage}
        pressure={physicalPressure}
        intro={intro}
        reduced={reduced}
        onIntroComplete={() => {
          setIntro(false);
          if (!reduced) setPlaying(true);
        }}
      />
      <div className="film-grain" aria-hidden="true" />
      <div className="film-frame" aria-hidden="true" />
      <TitleSequence
        visible={intro}
        onSkip={() => {
          setIntro(false);
        }}
      />
      {!intro && (
        <FilmOverlay
          stage={stage}
          playing={playing}
          operatorPressure={operatorPressure}
          physicalPressure={physicalPressure}
          log={current.log}
          onPlay={() => setPlaying((value) => !value)}
          onReset={() => {
            setStage(0);
            setPlaying(false);
          }}
          onAdvance={() => setStage((value) => Math.min(STAGES.length - 1, value + 1))}
          onStage={(index) => {
            setPlaying(false);
            setStage(index);
          }}
          onDefend={() => setDefenseOpen(true)}
          onInspect={() => setSurfaceOpen(true)}
        />
      )}
      <DefenseBrief
        open={defenseOpen}
        stage={stage}
        onClose={() => setDefenseOpen(false)}
      />
      <AttackSurface
        open={surfaceOpen}
        documentaryStage={stage}
        endpoint={range.endpoint}
        connection={range.connection}
        rangeState={range.state}
        error={range.error}
        onClose={() => setSurfaceOpen(false)}
        onRunAction={(id) => void range.runAction(id)}
        onReset={() => void range.reset()}
        onApprove={() => void range.approve()}
        reportUrl={range.reportUrl}
      />
    </main>
  );
}
