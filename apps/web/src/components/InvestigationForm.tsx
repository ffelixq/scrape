import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  CreateInvestigationInput,
  LlmProvider,
  ProviderUsageDashboard,
} from '@proofline/contracts';

export type InvestigationFormInput = Pick<CreateInvestigationInput, 'question' | 'llmProvider'>;

interface InvestigationFormProps {
  onSubmit: (input: InvestigationFormInput) => void;
  usage?: ProviderUsageDashboard | null;
  compact?: boolean;
  disabled?: boolean;
}

export function InvestigationForm({
  onSubmit,
  usage,
  compact = false,
  disabled = false,
}: InvestigationFormProps) {
  const [question, setQuestion] = useState('');
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('gemini');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (normalized.length >= 12) onSubmit({ question: normalized, llmProvider });
  }

  const status = (provider: string) =>
    usage?.providers.find((item) => item.provider === provider)?.status;
  const suffix = (provider: string) => {
    const providerStatus = status(provider);
    if (providerStatus === 'needs_attention') return ' — key issue';
    if (providerStatus === 'not_configured') return ' — no key';
    return '';
  };

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
        placeholder="Example: Is this company financially healthy enough to invest in?"
        disabled={disabled}
      />
      <div className="form-footer">
        <div className="secure-note">
          <LockKeyhole size={13} />
          <span>Isolated research · citation required</span>
        </div>
        <div className="form-actions">
          {/* The analysis model is the only research choice left to make, so it sits with the
              action it modifies. Discovery and retrieval tooling is fixed and stated on the
              landing page instead of offered here. */}
          <label className="model-select">
            <span className="sr-only">Analysis model</span>
            <select
              value={llmProvider}
              onChange={(event) => setLlmProvider(event.target.value as LlmProvider)}
              disabled={disabled}
            >
              <option value="gemini">Gemini 3.7 Flash{suffix('gemini')}</option>
              <option value="groq">Groq · GPT-OSS 120B{suffix('groq')}</option>
              <option value="deepseek">DeepSeek V4 Flash{suffix('deepseek')}</option>
            </select>
          </label>
          <button
            type="submit"
            className="investigate-button"
            disabled={disabled || question.trim().length < 12}
          >
            <span>{compact ? 'New investigation' : 'Investigate'}</span>
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
    </form>
  );
}
