'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import AttackSurface from './components/AttackSurface';
import DefenseBrief from './components/DefenseBrief';
import DocumentaryMap from './components/DocumentaryMap';
import FilmOverlay from './components/FilmOverlay';
import TitleSequence from './components/TitleSequence';
import { usePrefersReducedMotion } from './lib/motion';
import { deriveNarrativePresentation, THRESHOLDS } from './lib/scenario';
import { useRangeTelemetry } from './lib/useRangeTelemetry';

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function subscribeToLocation() {
  return () => {};
}

function isConsoleWindow() {
  return new URLSearchParams(window.location.search).get('view') === 'console';
}

export default function Home() {
  const reduced = usePrefersReducedMotion();
  const [intro, setIntro] = useState(!reduced);
  const [defenseOpen, setDefenseOpen] = useState(false);
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  const consoleWindow = useSyncExternalStore(subscribeToLocation, isConsoleWindow, () => false);
  const openedLiveCockpit = useRef(false);
  const range = useRangeTelemetry();
  const narrative = deriveNarrativePresentation(range.state);
  const stage = narrative.stage;
  const livePhysical = range.state?.telemetry['process.pressure.psi'];
  const liveOperator = range.state?.telemetry['operator.pressure.psi'];
  const physicalPressure = isFiniteNumber(livePhysical) ? livePhysical : undefined;
  const operatorPressure = isFiniteNumber(liveOperator) ? liveOperator : undefined;

  useEffect(() => {
    if (consoleWindow) document.title = 'Royal Duke Control Console';
  }, [consoleWindow]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (defenseOpen) setDefenseOpen(false);
        else if (intro) setIntro(false);
        return;
      }
      if (defenseOpen || event.target instanceof HTMLInputElement) return;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [defenseOpen, intro]);

  useEffect(() => {
    if (range.connection !== 'online' || !range.state) return;
    const timer = window.setTimeout(() => {
      if (!openedLiveCockpit.current) {
        openedLiveCockpit.current = true;
        setIntro(false);
        setSurfaceOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [range.connection, range.state]);

  function openConsoleWindow() {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'console');
    const popup = window.open(url.toString(), 'royal-duke-control-console', 'popup=yes,width=1800,height=1100,resizable=yes,scrollbars=yes');
    popup?.focus();
  }

  if (consoleWindow) {
    return (
      <main className="console-window">
        <AttackSurface
          open
          standalone
          endpoint={range.endpoint}
          connection={range.connection}
          rangeState={range.state}
          error={range.error}
          onClose={() => window.close()}
          onRunAction={(id) => void range.runAction(id)}
          onReset={() => void range.reset()}
          onApprove={() => void range.approve()}
          reportUrl={range.reportUrl}
        />
      </main>
    );
  }

  return (
    <main className="film">
      <DocumentaryMap
        stage={stage}
        pressure={physicalPressure ?? THRESHOLDS.nominalPressurePsi}
        blackout={narrative.visual.blackout}
        intro={intro}
        reduced={reduced}
        onIntroComplete={() => {
          setIntro(false);
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
          connection={range.connection}
          hasCanonicalState={Boolean(range.state)}
          operatorPressure={operatorPressure}
          physicalPressure={physicalPressure}
          narrative={narrative}
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
        endpoint={range.endpoint}
        connection={range.connection}
        rangeState={range.state}
        error={range.error}
        onClose={() => setSurfaceOpen(false)}
        onOpenWindow={openConsoleWindow}
        onRunAction={(id) => void range.runAction(id)}
        onReset={() => void range.reset()}
        onApprove={() => void range.approve()}
        reportUrl={range.reportUrl}
      />
    </main>
  );
}
