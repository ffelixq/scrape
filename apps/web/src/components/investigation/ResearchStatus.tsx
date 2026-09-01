import type { Investigation, InvestigationStatus } from '@proofline/contracts';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface ResearchStatusProps {
  investigation: Investigation;
  /** Wall-clock start of the run in this browser, used only for the elapsed readout. */
  startedAt?: number;
}

const stageOrder: InvestigationStatus[] = ['QUEUED', 'RESEARCHING', 'AUDITING'];

const stageCopy: Record<string, { label: string; note: string; progress: number }> = {
  QUEUED: {
    label: 'Queued',
    note: 'The research job has been accepted and is waiting for a runner.',
    progress: 8,
  },
  RESEARCHING: {
    label: 'Secure retrieval',
    note: 'Sources are being discovered and extracted inside an isolated Daytona sandbox.',
    progress: 55,
  },
  AUDITING: {
    label: 'Adversarial audit',
    note: 'The supporting case, the skeptic’s case and the evidence gate are being weighed.',
    progress: 88,
  },
};

type RowState = 'waiting' | 'active' | 'done';

function Row({ label, value, state }: { label: string; value: string; state: RowState }) {
  return (
    <div className={`status-row state-${state}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
      <span className="status-value">{value}</span>
    </div>
  );
}

function elapsedLabel(startedAt: number | undefined, now: number): string {
  if (!startedAt) return '—';
  const seconds = Math.max(0, Math.round((now - startedAt) / 1_000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * The live status of a running investigation.
 *
 * Counts appear only once the run has actually reported them. Anything still unknown says so
 * rather than showing a placeholder number, because a research tool that invents progress figures
 * is teaching the user to distrust the ones that are real.
 */
export function ResearchStatus({ investigation, startedAt }: ResearchStatusProps) {
  const [now, setNow] = useState(() => Date.now());
  const stageIndex = Math.max(0, stageOrder.indexOf(investigation.status));
  const stage = stageCopy[investigation.status] ?? stageCopy.QUEUED!;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const retrieving = stageIndex >= 1;
  const auditing = stageIndex >= 2;
  const known = investigation.metrics;

  return (
    <section className="research-status" aria-live="polite">
      <header>
        <span className="live-chip">
          <i /> RESEARCHING
        </span>
        <h3>{stage.label}</h3>
        <p>{stage.note}</p>
      </header>

      <div className="status-meter" aria-label={`${stage.progress}% complete`}>
        <motion.span
          animate={{ width: `${stage.progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      <div className="status-meter-meta">
        <span>{stage.progress}% complete</span>
        <span>Elapsed {elapsedLabel(startedAt, now)}</span>
      </div>

      <div className="status-rows">
        <Row
          label="Daytona sandbox"
          value={auditing ? 'Released' : retrieving ? 'Active' : 'Provisioning'}
          state={auditing ? 'done' : retrieving ? 'active' : 'waiting'}
        />
        <Row
          label="Web sources"
          value={known.sourcesChecked ? `${known.sourcesChecked} retrieved` : 'Retrieving…'}
          state={known.sourcesChecked ? 'done' : retrieving ? 'active' : 'waiting'}
        />
        <Row
          label="Primary sources"
          value={known.sourcesChecked ? `${known.primarySources} found` : 'Pending retrieval'}
          state={known.sourcesChecked ? 'done' : 'waiting'}
        />
        <Row
          label="Source provenance"
          value={
            known.sourcesChecked
              ? `${known.independentSources} independent origins`
              : retrieving
                ? 'Analysing…'
                : 'Pending retrieval'
          }
          state={known.sourcesChecked ? 'done' : retrieving ? 'active' : 'waiting'}
        />
        <Row
          label="Adversarial challenge"
          value={auditing ? 'Weighing both cases…' : 'Queued behind retrieval'}
          state={auditing ? 'active' : 'waiting'}
        />
        <Row
          label="Contradictions"
          value={known.sourcesChecked ? `${known.contradictions} detected` : 'Pending audit'}
          state={known.sourcesChecked ? 'done' : 'waiting'}
        />
      </div>

      <footer>
        Retrieval runs with no credentials and every extracted page is treated as untrusted
        evidence. Results appear here as soon as the audit closes.
      </footer>
    </section>
  );
}
