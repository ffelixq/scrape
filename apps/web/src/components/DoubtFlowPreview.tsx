import { motion } from 'framer-motion';
import { ArrowDownRight, Check, Minus } from 'lucide-react';

/**
 * The self-doubt method, shown on the landing page as one worked example.
 *
 * It mirrors the stage structure of a real investigation panel so the marketing page and the
 * product describe the same process, and it is labelled as an example so nobody reads it as a
 * finding.
 */
const STAGES = [
  {
    title: 'Initial thesis',
    body: '“The company appears financially healthy.”',
    shift: 'neutral' as const,
    note: 'Strongest supported reading of the evidence',
  },
  {
    title: 'Challenge the conclusion',
    body: 'A skeptic argues the opposite case over the same sources.',
    shift: 'neutral' as const,
    note: 'Adversarial review',
  },
  {
    title: 'Search for opposing evidence',
    body: 'Looks for newer disclosures, absent primary support and counterexamples.',
    shift: 'down' as const,
    note: 'Two opposing sources found',
  },
  {
    title: 'Contradiction found',
    body: 'A recent filing conflicts with figures repeated by secondary coverage.',
    shift: 'down' as const,
    note: 'Date difference, explained not averaged',
  },
  {
    title: 'Source investigation',
    body: 'The agreeing pages trace back to a single company release.',
    shift: 'down' as const,
    note: 'False consensus · counted once',
  },
  {
    title: 'Re-evaluation',
    body: 'The evidence gate downgrades the original conclusion.',
    shift: 'down' as const,
    note: 'Verdict weakened',
  },
  {
    title: 'Final verdict',
    body: 'INCONCLUSIVE — present readiness cannot be verified.',
    shift: 'final' as const,
    note: 'Published with its limitations',
  },
];

export function DoubtFlowPreview() {
  return (
    <ol className="doubt-preview" aria-label="Example investigation flow">
      {STAGES.map((stage, index) => (
        <motion.li
          key={stage.title}
          className={`doubt-preview-stage shift-${stage.shift}`}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.3) }}
        >
          <span className="doubt-preview-step">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>{stage.title}</h3>
            <p>{stage.body}</p>
          </div>
          <span className="doubt-preview-note">
            {stage.shift === 'down' ? (
              <ArrowDownRight size={12} />
            ) : stage.shift === 'final' ? (
              <Check size={12} />
            ) : (
              <Minus size={12} />
            )}
            {stage.note}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}
