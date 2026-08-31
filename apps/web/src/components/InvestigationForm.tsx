import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  CreateInvestigationInput,
  LlmProvider,
  ProviderUsageDashboard,
  SearchProvider,
} from '@proofline/contracts';

export type InvestigationFormInput = Pick<
  CreateInvestigationInput,
  'question' | 'llmProvider' | 'searchProvider'
>;

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
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('tavily');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (normalized.length >= 12) onSubmit({ question: normalized, llmProvider, searchProvider });
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
      <div className="provider-selectors" aria-label="Research providers">
        <label>
          <span>Analysis model</span>
          <select
            value={llmProvider}
            onChange={(event) => setLlmProvider(event.target.value as LlmProvider)}
            disabled={disabled}
          >
            <option value="gemini">Gemini 3.7 Flash (default){suffix('gemini')}</option>
            <option value="groq">Groq · GPT-OSS 120B{suffix('groq')}</option>
            <option value="deepseek">DeepSeek V4 Flash{suffix('deepseek')}</option>
          </select>
        </label>
        <label>
          <span>Search provider</span>
          <select
            value={searchProvider}
            onChange={(event) => setSearchProvider(event.target.value as SearchProvider)}
            disabled={disabled}
          >
            <option value="tavily">Tavily (default){suffix('tavily')}</option>
            <option value="serper">Serper{suffix('serper')}</option>
          </select>
        </label>
      </div>
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
