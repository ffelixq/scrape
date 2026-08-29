import type { InvestigationEvent } from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { demoEvents } from '../data/demo';

interface ResearchProgressProps {
  question: string;
  onComplete: () => void;
}

export function ResearchProgress({ question, onComplete }: ResearchProgressProps) {
  const [visibleCount, setVisibleCount] = useState(1);
  const events = useMemo(() => demoEvents, []);

  useEffect(() => {
    if (visibleCount >= events.length) {
      const finish = window.setTimeout(onComplete, 700);
      return () => window.clearTimeout(finish);
    }
    const timer = window.setTimeout(() => setVisibleCount((count) => count + 1), 620);
    return () => window.clearTimeout(timer);
  }, [events.length, onComplete, visibleCount]);

  const visibleEvents = events.slice(0, visibleCount);
  const current = visibleEvents[visibleEvents.length - 1] as InvestigationEvent;

  return (
    <main className="research-progress-page">
      <div className="progress-topbar">
        <span>PROOFLINE / LIVE INVESTIGATION</span>
        <span className="sandbox-chip">
          <i /> DAYTONA ISOLATED
        </span>
      </div>
      <div className="progress-layout">
        <section className="progress-copy-panel">
          <span className="section-kicker">RESEARCH IN PROGRESS</span>
          <h1>
            Building the proof,
            <br />
            not guessing the answer.
          </h1>
          <blockquote>“{question}”</blockquote>
          <div className="progress-meter" aria-label={`${current.progress}% complete`}>
            <motion.div
              animate={{ width: `${current.progress}%` }}
              transition={{ duration: 0.45 }}
            />
          </div>
          <div className="progress-meta">
            <span>{current.progress}% complete</span>
            <span>Illustrative secure run</span>
          </div>
        </section>

        <section className="event-panel" aria-live="polite">
          <div className="event-panel-header">
            <span>INVESTIGATION LOG</span>
            <LoaderCircle size={16} className="spin" />
          </div>
          <div className="event-list">
            <AnimatePresence initial={false}>
              {visibleEvents.map((event, index) => (
                <motion.div
                  key={event.stage}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={event.stage === 'INJECTION_BLOCKED' ? 'event-row danger' : 'event-row'}
                >
                  <span className="event-icon">
                    {event.stage === 'INJECTION_BLOCKED' ? (
                      <ShieldAlert size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                  </span>
                  <div>
                    <strong>{event.stage.replaceAll('_', ' ')}</strong>
                    <p>{event.message}</p>
                  </div>
                  <span className="event-index">{String(index + 1).padStart(2, '0')}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="agent-row">
            <span>
              <i className="support" /> SUPPORT AGENT
            </span>
            <span>
              <i className="oppose" /> SKEPTIC AGENT
            </span>
            <span>
              <i className="audit" /> AUDITOR
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
