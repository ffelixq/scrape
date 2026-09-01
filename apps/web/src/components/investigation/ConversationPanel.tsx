import type { ConversationMessage, Investigation, Source } from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowUp, LoaderCircle, MessagesSquare, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatTime } from '../../lib/utils';

interface ConversationPanelProps {
  investigation: Investigation;
  pending: boolean;
  onAsk: (question: string) => void;
  onOpenSource: (source: Source) => void;
}

const SUGGESTIONS = [
  'Which three sources are the most reliable?',
  'Only use primary sources.',
  'What is contradicting this?',
  'Try to disprove your conclusion.',
];

function kindChip(message: ConversationMessage) {
  if (message.role === 'USER') return null;
  if (message.kind === 'FOLLOW_UP_RESEARCH') {
    return (
      <span className="turn-kind research">
        <Search size={11} /> CONTINUING RESEARCH
      </span>
    );
  }
  return (
    <span className="turn-kind">
      <MessagesSquare size={11} /> FOLLOW-UP ANALYSIS
    </span>
  );
}

/**
 * The investigation conversation.
 *
 * The opening turn is the research run itself, so the report and every follow-up sit on one
 * thread. Follow-ups are answered from the stored record; a turn that would need new retrieval is
 * labelled as such rather than quietly pretending the web was checked again.
 */
export function ConversationPanel({
  investigation,
  pending,
  onAsk,
  onOpenSource,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState('');
  const disabled = investigation.status !== 'COMPLETED' && investigation.status !== 'FAILED';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (question.length < 3 || pending || disabled) return;
    setDraft('');
    onAsk(question);
  }

  return (
    <div className="conversation">
      <div className="conversation-thread">
        <article className="turn assistant opening">
          <div className="turn-head">
            <span className="turn-role">PROOFLINE</span>
            <span className="turn-kind research">
              <Search size={11} /> NEW RESEARCH
            </span>
          </div>
          <p>{investigation.answer ?? 'No conclusion was produced for this investigation.'}</p>
          <small>
            {investigation.metrics.sourcesChecked} sources ·{' '}
            {investigation.metrics.independentSources} independent origins · evidence strength{' '}
            {investigation.evidenceStrength}/100
          </small>
        </article>

        <AnimatePresence initial={false}>
          {investigation.messages.map((message) => (
            <motion.article
              key={message.id}
              className={`turn ${message.role.toLowerCase()} ${message.failed ? 'failed' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="turn-head">
                <span className="turn-role">{message.role === 'USER' ? 'YOU' : 'PROOFLINE'}</span>
                {kindChip(message)}
                <time>{formatTime(message.createdAt)}</time>
              </div>
              {message.content.split('\n').map((line, index) => (
                <p key={`${message.id}-${index}`}>{line}</p>
              ))}
              {message.citedSourceIds.length > 0 && (
                <div className="turn-citations">
                  <span>Cited</span>
                  {message.citedSourceIds.map((sourceId) => {
                    const source = investigation.sources.find((item) => item.id === sourceId);
                    if (!source) return null;
                    return (
                      <button key={sourceId} type="button" onClick={() => onOpenSource(source)}>
                        {source.publisher}
                      </button>
                    );
                  })}
                </div>
              )}
              {message.limitations.length > 0 && (
                <ul className="turn-limitations">
                  {message.limitations.map((item) => (
                    <li key={item}>
                      <AlertTriangle size={11} /> {item}
                    </li>
                  ))}
                </ul>
              )}
            </motion.article>
          ))}
        </AnimatePresence>

        {pending && (
          <div className="turn assistant thinking">
            <LoaderCircle size={14} className="spin" />
            <span>Re-reading the evidence on the record…</span>
          </div>
        )}
      </div>

      <form className="conversation-composer" onSubmit={submit}>
        <div className="composer-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setDraft(suggestion)}
              disabled={disabled || pending}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div className="composer-row">
          <label htmlFor="follow-up-input" className="sr-only">
            Follow-up question
          </label>
          <textarea
            id="follow-up-input"
            rows={2}
            value={draft}
            maxLength={2000}
            disabled={disabled || pending}
            placeholder={
              disabled
                ? 'Follow-up opens when the investigation finishes.'
                : 'Ask a follow-up about this investigation…'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            className="composer-send"
            disabled={disabled || pending || draft.trim().length < 3}
            aria-label="Send follow-up"
          >
            {pending ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
        <p className="composer-note">
          Follow-ups reason over this investigation’s sources, evidence and contradictions. They do
          not start a new research run.
        </p>
      </form>
    </div>
  );
}
