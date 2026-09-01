import type { InvestigationSummary } from '@proofline/contracts';
import { LoaderCircle, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { statusClass, strengthLabel } from '../../lib/investigation';
import { formatClock, formatDayGroup, formatStatus } from '../../lib/utils';

interface HistorySidebarProps {
  history: InvestigationSummary[];
  historyState: 'idle' | 'loading' | 'ready' | 'error';
  activeId: string | null;
  openIds: string[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}

function groupByDay(history: InvestigationSummary[]) {
  const groups = new Map<string, InvestigationSummary[]>();
  for (const item of history) {
    const key = formatDayGroup(item.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

export function HistorySidebar({
  history,
  historyState,
  activeId,
  openIds,
  onOpen,
  onDelete,
  onNew,
  onRefresh,
}: HistorySidebarProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;
    return history.filter(
      (item) =>
        item.question.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle),
    );
  }, [history, query]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="history-sidebar">
      <button type="button" className="history-new" onClick={onNew}>
        <Plus size={14} /> New investigation
      </button>

      <div className="history-search">
        <Search size={13} />
        <label htmlFor="history-search-input" className="sr-only">
          Search investigations
        </label>
        <input
          id="history-search-input"
          value={query}
          placeholder="Search history"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="history-head">
        <span>HISTORY</span>
        <button type="button" onClick={onRefresh} aria-label="Refresh history">
          {historyState === 'loading' ? (
            <LoaderCircle size={12} className="spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </button>
      </div>

      <div className="history-list">
        {groups.map(([day, items]) => (
          <section key={day}>
            <h3>{day}</h3>
            {items.map((item) => (
              <div
                key={item.id}
                className={`history-item ${activeId === item.id ? 'active' : ''} ${
                  openIds.includes(item.id) ? 'open' : ''
                }`}
              >
                <button type="button" className="history-open" onClick={() => onOpen(item.id)}>
                  <strong>{item.title}</strong>
                  <span className="history-question">{item.question}</span>
                  <span className="history-status">
                    <i
                      className={`verdict-dot ${item.verdict ? statusClass[item.verdict] : 'pending'}`}
                    />
                    {item.status === 'COMPLETED' || item.status === 'FAILED'
                      ? formatStatus(item.verdict)
                      : item.status}
                    <em>· {strengthLabel(item.evidenceStrength)} evidence</em>
                  </span>
                  <span className="history-meta">
                    {formatClock(item.createdAt)} · {item.sourcesChecked} sources ·{' '}
                    {item.contradictions} contradiction{item.contradictions === 1 ? '' : 's'}
                    {item.messageCount > 0 ? ` · ${item.messageCount} follow-ups` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  onClick={() => onDelete(item.id)}
                  aria-label={`Delete investigation: ${item.title}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </section>
        ))}

        {historyState === 'ready' && filtered.length === 0 && (
          <div className="history-empty">
            <strong>{query ? 'No match' : 'No investigations yet'}</strong>
            <p>
              {query
                ? 'No investigation matches that search.'
                : 'Investigations you run are kept here so you can return to the evidence later.'}
            </p>
          </div>
        )}
        {historyState === 'error' && (
          <div className="history-empty">
            <strong>History unavailable</strong>
            <p>
              The investigation history could not be loaded. Open investigations are unaffected.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
