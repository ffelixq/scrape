import type { Investigation } from '@proofline/contracts';
import { Plus, X } from 'lucide-react';
import { isRunning, statusClass } from '../../lib/investigation';

interface TabStripProps {
  tabs: string[];
  activeId: string | null;
  byId: Record<string, Investigation>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

function tabTitle(investigation: Investigation | undefined): string {
  if (!investigation) return 'Loading…';
  const question = investigation.question.replace(/\s+/g, ' ').trim();
  return question.length > 34 ? `${question.slice(0, 33)}…` : question;
}

export function TabStrip({ tabs, activeId, byId, onActivate, onClose, onNew }: TabStripProps) {
  return (
    <div className="tab-strip" role="tablist" aria-label="Open investigations">
      <div className="tab-scroll">
        {tabs.map((id) => {
          const investigation = byId[id];
          const running = investigation ? isRunning(investigation.status) : true;
          return (
            <div key={id} className={`tab ${activeId === id ? 'active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={activeId === id}
                className="tab-open"
                onClick={() => onActivate(id)}
              >
                <i
                  className={`tab-dot ${
                    running
                      ? 'running'
                      : investigation?.verdict
                        ? statusClass[investigation.verdict]
                        : 'pending'
                  }`}
                  aria-hidden="true"
                />
                <span>{tabTitle(investigation)}</span>
              </button>
              <button
                type="button"
                className="tab-close"
                onClick={() => onClose(id)}
                aria-label={`Close ${tabTitle(investigation)}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-new" onClick={onNew} aria-label="New investigation">
        <Plus size={14} />
      </button>
    </div>
  );
}
