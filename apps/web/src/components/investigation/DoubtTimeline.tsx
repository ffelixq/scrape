import type { Investigation, Source } from '@proofline/contracts';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Check, Circle, LoaderCircle, Minus } from 'lucide-react';
import { useMemo } from 'react';
import { buildDoubtStages, sourcesById, type DoubtStage } from '../../lib/investigation';

interface DoubtTimelineProps {
  investigation: Investigation;
  onOpenSource: (source: Source) => void;
}

const shiftLabel = {
  STRONGER: 'Conclusion strengthened',
  WEAKER: 'Conclusion weakened',
  UNCHANGED: 'Conclusion unchanged',
  PENDING: 'Not reached yet',
} as const;

const shiftIcon = {
  STRONGER: ArrowUpRight,
  WEAKER: ArrowDownRight,
  UNCHANGED: Minus,
  PENDING: Minus,
} as const;

function StageMarker({ state }: { state: DoubtStage['state'] }) {
  if (state === 'ACTIVE') return <LoaderCircle size={13} className="spin" />;
  if (state === 'DONE') return <Check size={13} />;
  return <Circle size={9} />;
}

export function DoubtTimeline({ investigation, onOpenSource }: DoubtTimelineProps) {
  const stages = useMemo(() => buildDoubtStages(investigation), [investigation]);
  const sources = useMemo(() => sourcesById(investigation), [investigation]);

  return (
    <ol className="doubt-timeline">
      {stages.map((stage, index) => {
        const ShiftIcon = shiftIcon[stage.shift];
        const stageSources = stage.sourceIds
          .map((id) => sources.get(id))
          .filter((source): source is Source => Boolean(source))
          .slice(0, 4);
        return (
          <motion.li
            key={stage.id}
            className={`doubt-stage state-${stage.state.toLowerCase()}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: Math.min(index * 0.04, 0.24) }}
          >
            <div className="doubt-rail" aria-hidden="true">
              <span className="doubt-marker">
                <StageMarker state={stage.state} />
              </span>
            </div>
            <div className="doubt-body">
              <div className="doubt-head">
                <span className="doubt-step">{String(index + 1).padStart(2, '0')}</span>
                <h4>{stage.title}</h4>
                <span className={`doubt-shift shift-${stage.shift.toLowerCase()}`}>
                  <ShiftIcon size={11} /> {shiftLabel[stage.shift]}
                </span>
              </div>
              <p className="doubt-purpose">{stage.purpose}</p>
              <p className="doubt-detail">{stage.detail}</p>
              {stage.findings.length > 0 && (
                <ul className="doubt-findings">
                  {stage.findings.map((finding) => (
                    <li key={finding}>{finding}</li>
                  ))}
                </ul>
              )}
              {stageSources.length > 0 && (
                <div className="doubt-sources">
                  <span>Sources</span>
                  {stageSources.map((source) => (
                    <button key={source.id} type="button" onClick={() => onOpenSource(source)}>
                      {source.publisher}
                    </button>
                  ))}
                  {stage.sourceIds.length > stageSources.length && (
                    <em>+{stage.sourceIds.length - stageSources.length} more</em>
                  )}
                </div>
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
