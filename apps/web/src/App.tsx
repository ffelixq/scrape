import type { ProviderUsageDashboard } from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Landing } from './components/Landing';
import type { InvestigationFormInput } from './components/InvestigationForm';
import { getProviderUsage } from './lib/api';
import { workspaceStore } from './lib/workspace-store';

type View = 'landing' | 'workspace';

const WorkspaceShell = lazy(() =>
  import('./components/workspace/WorkspaceShell').then((module) => ({
    default: module.WorkspaceShell,
  })),
);

export function App() {
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('investigation')
      ? 'workspace'
      : 'landing',
  );
  const [providerUsage, setProviderUsage] = useState<ProviderUsageDashboard | null>(null);
  const [providerUsageError, setProviderUsageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getProviderUsage()
        .then((result) => {
          if (!active) return;
          setProviderUsage(result);
          setProviderUsageError(null);
        })
        .catch(() => {
          if (active) setProviderUsageError('Provider usage is unavailable.');
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const startInvestigation = useCallback((input: InvestigationFormInput) => {
    workspaceStore.start(input);
    setView('workspace');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const exitToLanding = useCallback(() => {
    setView('landing');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
      >
        {view === 'landing' ? (
          <Landing
            onInvestigate={startInvestigation}
            providerUsage={providerUsage}
            providerUsageError={providerUsageError}
          />
        ) : (
          <Suspense
            fallback={<div className="workspace-loading">Opening the investigation workspace…</div>}
          >
            <WorkspaceShell
              providerUsage={providerUsage}
              providerUsageError={providerUsageError}
              onExit={exitToLanding}
            />
          </Suspense>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
