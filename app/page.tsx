'use client';

import { useEffect, useMemo, useState } from 'react';
import AttackSurface from './components/AttackSurface';
import DefenseBrief from './components/DefenseBrief';
import DocumentaryMap from './components/DocumentaryMap';
import FilmOverlay from './components/FilmOverlay';
import TitleSequence from './components/TitleSequence';
import { usePrefersReducedMotion } from './lib/motion';
import { BUDGET_CAP, DEFENSES, LOG, STAGES } from './lib/scenario';
import { useRangeTelemetry } from './lib/useRangeTelemetry';

export default function Home() {
  const reduced = usePrefersReducedMotion();
  const [intro, setIntro] = useState(!reduced);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [defenseOpen, setDefenseOpen] = useState(false);
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  const [selectedDefenses, setSelectedDefenses] = useState<string[]>([]);
  const [budgetError, setBudgetError] = useState('');
  const range = useRangeTelemetry();
  const current = STAGES[stage];
  const spend = DEFENSES.reduce((sum, defense) => sum + (selectedDefenses.includes(defense.id) ? defense.cost : 0), 0);
  const blockStage = DEFENSES.filter((defense) => selectedDefenses.includes(defense.id)).reduce(
    (earliest, defense) => Math.min(earliest, defense.stage),
    Number.POSITIVE_INFINITY,
  );
  const contained = blockStage !== Number.POSITIVE_INFINITY && stage >= blockStage;
  const livePhysical = range.state?.telemetry['process.pressure.psi'];
  const liveOperator = range.state?.telemetry['operator.pressure.psi'];
  const useLiveTelemetry = range.connection === 'online' && !contained && Number.isFinite(livePhysical) && Number.isFinite(liveOperator);
  const physicalPressure = useLiveTelemetry ? livePhysical : contained ? 62 : current.pressure;
  const deceptive = (useLiveTelemetry ? Math.abs(liveOperator - livePhysical) > 0.4 : stage >= 3) && !contained;
  const operatorPressure = useLiveTelemetry ? liveOperator : deceptive ? 62 : physicalPressure;
  const log = useMemo(() => {
    if (!contained) return LOG[stage];
    const defense = DEFENSES.find((item) => selectedDefenses.includes(item.id) && item.stage === blockStage);
    return [
      `${defense?.title ?? 'A funded control'} is in the path.`,
      `The attack is held at chapter ${String(blockStage).padStart(2, '0')}.`,
      'The physical process remains inside safe limits.',
    ];
  }, [blockStage, contained, selectedDefenses, stage]);

  function toggleDefense(id: string) {
    const defense = DEFENSES.find((item) => item.id === id);
    if (!defense) return;
    const selected = selectedDefenses.includes(id);
    if (!selected && spend + defense.cost > BUDGET_CAP) {
      setBudgetError(`Budget exceeded. Remove a control before adding ${defense.title}.`);
      return;
    }
    setBudgetError('');
    setSelectedDefenses((items) => (selected ? items.filter((item) => item !== id) : [...items, id]));
  }

  useEffect(() => {
    if (!playing || intro) return;
    if (contained) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (stage >= 5) {
        setPlaying(false);
        return;
      }
      setStage((value) => Math.min(5, value + 1));
    }, STAGES[stage].duration);
    return () => window.clearTimeout(timer);
  }, [playing, stage, intro, contained]);

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
      if (event.key === 'ArrowRight') setStage((value) => Math.min(5, value + 1));
      if (event.key === 'ArrowLeft') setStage((value) => Math.max(0, value - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [defenseOpen, intro]);

  useEffect(() => {
    if (range.connection !== 'online' || !range.state) return;
    setStage(Math.max(0, Math.min(5, range.state.stage)));
  }, [range.connection, range.state?.stage]);

  return (
    <main className="film">
      <DocumentaryMap
        stage={stage}
        contained={contained}
        blockStage={blockStage}
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
          spend={spend}
          contained={contained}
          blockStage={blockStage}
          operatorPressure={operatorPressure}
          physicalPressure={physicalPressure}
          event={current.event}
          operatorDetail={current.operatorDetail}
          physicalDetail={current.physicalDetail}
          log={log}
          onPlay={() => setPlaying((value) => !value)}
          onReset={() => {
            setStage(0);
            setPlaying(false);
          }}
          onAdvance={() => setStage((value) => Math.min(5, value + 1))}
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
        spend={spend}
        selected={selectedDefenses}
        blockStage={blockStage}
        budgetError={budgetError}
        onClose={() => setDefenseOpen(false)}
        onToggle={toggleDefense}
        onReplay={() => {
          setStage(blockStage === Number.POSITIVE_INFINITY ? 5 : blockStage);
          setDefenseOpen(false);
          setPlaying(false);
        }}
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
      />
    </main>
  );
}
