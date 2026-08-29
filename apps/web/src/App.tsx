import type { Investigation } from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Landing } from './components/Landing';
import { ResearchProgress } from './components/ResearchProgress';
import { demoInvestigation } from './data/demo';
import { createInvestigation, subscribeToInvestigation } from './lib/api';

type View = 'landing' | 'researching' | 'report';

const Workspace = lazy(() =>
  import('./components/Workspace').then((module) => ({ default: module.Workspace })),
);

export function App() {
  const [view, setView] = useState<View>('landing');
  const [question, setQuestion] = useState(demoInvestigation.question);
  const [investigation, setInvestigation] = useState<Investigation>(demoInvestigation);
  const liveResult = useRef<Investigation | null>(null);
  const livePending = useRef(false);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribe.current?.(), []);

  const startInvestigation = useCallback((nextQuestion: string) => {
    const isDemoRequest = /show me|demo|explore/i.test(nextQuestion);
    const normalizedQuestion = isDemoRequest ? demoInvestigation.question : nextQuestion;
    setQuestion(normalizedQuestion);
    liveResult.current = null;
    livePending.current = false;
    unsubscribe.current?.();
    setView('researching');
    window.scrollTo({ top: 0, behavior: 'instant' });

    void createInvestigation({ question: normalizedQuestion, mode: 'DEEP', context: '' })
      .then((result) => {
        if (result.status === 'COMPLETED' || result.status === 'FAILED') {
          liveResult.current = result;
          return;
        }
        livePending.current = true;
        unsubscribe.current = subscribeToInvestigation(
          result.id,
          (updated) => {
            if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
              liveResult.current = updated;
              livePending.current = false;
              setInvestigation(updated);
              setView('report');
              window.scrollTo({ top: 0, behavior: 'instant' });
              unsubscribe.current?.();
              unsubscribe.current = null;
            }
          },
          () => {
            livePending.current = false;
            unsubscribe.current?.();
            unsubscribe.current = null;
          },
        );
      })
      .catch(() => {
        // The fixture-backed experience intentionally remains complete when local services or keys are absent.
      });
  }, []);

  const finishResearch = useCallback(() => {
    if (livePending.current && !liveResult.current) return;
    setInvestigation(
      liveResult.current ?? {
        ...demoInvestigation,
        question,
      },
    );
    setView('report');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [question]);

  const reset = useCallback(() => {
    unsubscribe.current?.();
    unsubscribe.current = null;
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
        {view === 'landing' && <Landing onInvestigate={startInvestigation} />}
        {view === 'researching' && (
          <ResearchProgress question={question} onComplete={finishResearch} />
        )}
        {view === 'report' && (
          <Suspense fallback={<div className="workspace-loading">Preparing evidence report…</div>}>
            <Workspace investigation={investigation} onReset={reset} />
          </Suspense>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
