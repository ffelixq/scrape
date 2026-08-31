import type {
  Investigation,
  InvestigationStatus,
  ProviderUsageDashboard,
} from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Landing } from './components/Landing';
import { ResearchProgress } from './components/ResearchProgress';
import type { InvestigationFormInput } from './components/InvestigationForm';
import {
  createInvestigation,
  getInvestigation,
  getProviderUsage,
  subscribeToInvestigation,
} from './lib/api';

type View = 'landing' | 'researching' | 'report';

const Workspace = lazy(() =>
  import('./components/Workspace').then((module) => ({ default: module.Workspace })),
);

export function App() {
  const [view, setView] = useState<View>('landing');
  const [question, setQuestion] = useState('');
  const [researchStatus, setResearchStatus] = useState<InvestigationStatus>('QUEUED');
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [providerUsage, setProviderUsage] = useState<ProviderUsageDashboard | null>(null);
  const [providerUsageError, setProviderUsageError] = useState<string | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => {
    const investigationId = new URLSearchParams(window.location.search).get('investigation');
    if (investigationId) {
      setView('researching');
      void getInvestigation(investigationId)
        .then((result) => {
          setQuestion(result.question);
          setResearchStatus(result.status);
          if (result.status === 'COMPLETED' || result.status === 'FAILED') {
            setInvestigation(result);
            setView('report');
            return;
          }
          unsubscribe.current = subscribeToInvestigation(result.id, (updated) => {
            setResearchStatus(updated.status);
            if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
              setInvestigation(updated);
              setView('report');
              unsubscribe.current?.();
              unsubscribe.current = null;
            }
          });
        })
        .catch(() => {
          window.history.replaceState({}, '', window.location.pathname);
          setView('landing');
        });
    }
    return () => unsubscribe.current?.();
  }, []);

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
    const nextQuestion = input.question;
    setQuestion(nextQuestion);
    setResearchStatus('QUEUED');
    setInvestigation(null);
    unsubscribe.current?.();
    setView('researching');
    window.scrollTo({ top: 0, behavior: 'instant' });

    void createInvestigation({ ...input, mode: 'DEEP', context: '' })
      .then((result) => {
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}?investigation=${encodeURIComponent(result.id)}`,
        );
        setResearchStatus(result.status);
        if (result.status === 'COMPLETED' || result.status === 'FAILED') {
          setInvestigation(result);
          setView('report');
          return;
        }
        unsubscribe.current = subscribeToInvestigation(result.id, (updated) => {
          setResearchStatus(updated.status);
          if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
            setInvestigation(updated);
            setView('report');
            window.scrollTo({ top: 0, behavior: 'instant' });
            unsubscribe.current?.();
            unsubscribe.current = null;
          }
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'The API request failed.';
        const at = new Date().toISOString();
        setInvestigation({
          id: crypto.randomUUID(),
          question: nextQuestion,
          status: 'FAILED',
          verdict: 'UNVERIFIABLE',
          answer: 'The live investigation could not be started. No conclusion was produced.',
          evidenceStrength: 0,
          createdAt: at,
          completedAt: at,
          limitations: [message],
          sources: [],
          claims: [],
          evidence: [],
          contradictions: [],
          securityEvents: [],
          metrics: {
            sourcesChecked: 0,
            independentSources: 0,
            primarySources: 0,
            contradictions: 0,
            falseConsensusClusters: 0,
          },
          audit: {
            supportingAgentSummary: 'The live research service did not start.',
            opposingAgentSummary: 'No adversarial review was performed.',
            auditorSummary: 'No evidence conclusion was produced.',
          },
        });
        setResearchStatus('FAILED');
        setView('report');
      });
  }, []);

  const reset = useCallback(() => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    window.history.replaceState({}, '', window.location.pathname);
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
        transition={{ duration: 0.28 }}
      >
        {view === 'landing' && (
          <Landing
            onInvestigate={startInvestigation}
            providerUsage={providerUsage}
            providerUsageError={providerUsageError}
          />
        )}
        {view === 'researching' && <ResearchProgress question={question} status={researchStatus} />}
        {view === 'report' && investigation && (
          <Suspense fallback={<div className="workspace-loading">Preparing evidence report…</div>}>
            <Workspace investigation={investigation} onReset={reset} />
          </Suspense>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
