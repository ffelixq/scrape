import type { ProviderUsageDashboard } from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../Brand';
import { InvestigationForm, type InvestigationFormInput } from '../InvestigationForm';
import { ProviderUsagePanel } from '../ProviderUsagePanel';
import { InvestigationView } from '../investigation/InvestigationView';
import { HistorySidebar } from './HistorySidebar';
import { TabStrip } from './TabStrip';
import { useWorkspace, workspaceStore } from '../../lib/workspace-store';

interface WorkspaceShellProps {
  providerUsage: ProviderUsageDashboard | null;
  providerUsageError: string | null;
  onExit: () => void;
}

const STARTERS = [
  'Is this supplier financially healthy enough for a two-year contract?',
  'Does this company’s published revenue claim match its filings?',
  'Is this certification claim verifiable against an official registry?',
];

export function WorkspaceShell({ providerUsage, providerUsageError, onExit }: WorkspaceShellProps) {
  const state = useWorkspace();
  const [railOpen, setRailOpen] = useState(true);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  useEffect(() => {
    workspaceStore.hydrate();
  }, []);

  const active = state.activeId ? state.byId[state.activeId] : undefined;

  function start(input: InvestigationFormInput) {
    workspaceStore.start(input);
    setMobileRailOpen(false);
  }

  function openFromHistory(id: string) {
    workspaceStore.open(id);
    setMobileRailOpen(false);
  }

  return (
    <div className={`workspace ${railOpen ? '' : 'rail-collapsed'}`}>
      <aside className={`workspace-rail ${mobileRailOpen ? 'mobile-open' : ''}`}>
        <div className="rail-head">
          <Brand compact />
          <button
            type="button"
            className="rail-toggle"
            onClick={() => setRailOpen((value) => !value)}
            aria-label={railOpen ? 'Collapse navigation' : 'Expand navigation'}
          >
            {railOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
        </div>
        <HistorySidebar
          history={state.history}
          historyState={state.historyState}
          activeId={state.activeId}
          openIds={state.tabs}
          onOpen={openFromHistory}
          onDelete={(id) => void workspaceStore.remove(id)}
          onNew={() => {
            workspaceStore.newTab();
            setMobileRailOpen(false);
          }}
          onRefresh={() => void workspaceStore.refreshHistory()}
        />
        <button type="button" className="rail-exit" onClick={onExit}>
          <Home size={13} /> Back to overview
        </button>
      </aside>

      {mobileRailOpen && (
        <button
          type="button"
          className="rail-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileRailOpen(false)}
        />
      )}

      <div className="workspace-main">
        <header className="workspace-topbar">
          <button
            type="button"
            className="rail-mobile-toggle"
            onClick={() => setMobileRailOpen((value) => !value)}
            aria-label="Open navigation"
          >
            <PanelLeftOpen size={15} />
          </button>
          <TabStrip
            tabs={state.tabs}
            activeId={state.activeId}
            byId={state.byId}
            onActivate={(id) => workspaceStore.activate(id)}
            onClose={(id) => workspaceStore.closeTab(id)}
            onNew={() => workspaceStore.newTab()}
          />
        </header>

        <main className="workspace-canvas">
          <AnimatePresence mode="wait">
            <motion.div
              key={active?.id ?? 'new'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {active ? (
                <InvestigationView
                  investigation={active}
                  startedAt={state.startedAt[active.id]}
                  askPending={Boolean(state.askPending[active.id])}
                  onAsk={(question) => void workspaceStore.ask(active.id, question)}
                />
              ) : (
                <div className="new-investigation">
                  <span className="kicker">NEW INVESTIGATION</span>
                  <h1>Ask something worth proving.</h1>
                  <p>
                    Proofline researches both sides, traces every source to its origin, and reports
                    what the evidence will not support.
                  </p>
                  <InvestigationForm onSubmit={start} usage={providerUsage} />
                  <div className="starter-list">
                    <span>Try</span>
                    {STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() =>
                          start({
                            question: starter,
                            llmProvider: 'gemini',
                          })
                        }
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                  <ProviderUsagePanel usage={providerUsage} error={providerUsageError} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
