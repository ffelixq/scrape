import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DEMO_QUESTION } from '../data/demo';

interface InvestigationFormProps {
  onSubmit: (question: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function InvestigationForm({
  onSubmit,
  compact = false,
  disabled = false,
}: InvestigationFormProps) {
  const [question, setQuestion] = useState(DEMO_QUESTION);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (normalized.length >= 12) onSubmit(normalized);
  }

  return (
    <form
      className={compact ? 'investigation-form compact' : 'investigation-form'}
      onSubmit={submit}
    >
      {!compact && (
        <div className="form-eyebrow">
          <Sparkles size={14} />
          <span>Start an evidence investigation</span>
        </div>
      )}
      <label htmlFor={compact ? 'workspace-question' : 'hero-question'} className="sr-only">
        Research question
      </label>
      <textarea
        id={compact ? 'workspace-question' : 'hero-question'}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        rows={compact ? 2 : 3}
        maxLength={2000}
        placeholder="Ask a claim that matters..."
        disabled={disabled}
      />
      <div className="form-footer">
        <div className="secure-note">
          <LockKeyhole size={13} />
          <span>Isolated research · citation required</span>
        </div>
        <button
          type="submit"
          className="investigate-button"
          disabled={disabled || question.trim().length < 12}
        >
          <span>{compact ? 'New investigation' : 'Investigate'}</span>
          <ArrowUpRight size={17} />
        </button>
      </div>
    </form>
  );
}
