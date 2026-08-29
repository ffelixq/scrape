import type { InvestigationStatus } from '@proofline/contracts';
import { motion } from 'framer-motion';
import { Check, LoaderCircle } from 'lucide-react';

interface ResearchProgressProps {
  question: string;
  status: InvestigationStatus;
}

const workflow = [
  {
    status: 'QUEUED' as const,
    label: 'REQUEST QUEUED',
    message: 'The live research job has been accepted.',
    progress: 8,
  },
  {
    status: 'RESEARCHING' as const,
    label: 'SECURE RESEARCH',
    message: 'Daytona is retrieving and extracting untrusted sources in isolation.',
    progress: 55,
  },
  {
    status: 'AUDITING' as const,
    label: 'ADVERSARIAL AUDIT',
    message: 'Evidence claims and counterclaims are being weighed.',
    progress: 90,
  },
];

const statusRank: Record<InvestigationStatus, number> = {
  QUEUED: 0,
  RESEARCHING: 1,
  AUDITING: 2,
  COMPLETED: 3,
  FAILED: 3,
};

export function ResearchProgress({ question, status }: ResearchProgressProps) {
  const activeIndex = Math.min(statusRank[status], workflow.length - 1);
  const visibleEvents = workflow.slice(0, activeIndex + 1);
  const current = workflow[activeIndex]!;

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
            <span>Live secure run</span>
          </div>
        </section>

        <section className="event-panel" aria-live="polite">
          <div className="event-panel-header">
            <span>INVESTIGATION LOG</span>
            <LoaderCircle size={16} className="spin" />
          </div>
          <div className="event-list">
            {visibleEvents.map((event, index) => (
              <motion.div
                key={event.status}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="event-row"
              >
                <span className="event-icon">
                  {index === activeIndex ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Check size={14} />
                  )}
                </span>
                <div>
                  <strong>{event.label}</strong>
                  <p>{event.message}</p>
                </div>
                <span className="event-index">{String(index + 1).padStart(2, '0')}</span>
              </motion.div>
            ))}
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
