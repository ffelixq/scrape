import { gsap } from 'gsap';
import {
  ArrowDown,
  Binary,
  Check,
  CircleSlash2,
  FileSearch,
  Fingerprint,
  GitFork,
  Network,
  ScanSearch,
  ShieldAlert,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { Brand } from './Brand';
import { InvestigationForm } from './InvestigationForm';

const TruthScene = lazy(() =>
  import('./TruthScene').then((module) => ({ default: module.TruthScene })),
);

interface LandingProps {
  onInvestigate: (question: string) => void;
}

const principles = [
  {
    number: '01',
    icon: ScanSearch,
    title: 'Research both sides',
    copy: 'One agent builds the case. Another tries to break it. An auditor weighs only the evidence that survives.',
  },
  {
    number: '02',
    icon: GitFork,
    title: 'Trace the origin',
    copy: 'Ten articles repeating one press release count as one source—not consensus.',
  },
  {
    number: '03',
    icon: CircleSlash2,
    title: 'Refuse weak answers',
    copy: 'Inconclusive is a successful result. Proofline states exactly what is missing and why it matters.',
  },
];

const useCases = [
  'Supplier due diligence',
  'Financial fact checking',
  'Compliance research',
  'Market intelligence',
  'Accounting reconciliation',
  'High-stakes procurement',
];

export function Landing({ onInvestigate }: LandingProps) {
  const hero = useRef<HTMLElement>(null);

  function focusInvestigationForm() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(
      () => document.querySelector<HTMLTextAreaElement>('#hero-question')?.focus(),
      350,
    );
  }

  useLayoutEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    const context = gsap.context(() => {
      gsap.from('[data-reveal]', {
        y: 28,
        opacity: 0,
        duration: 0.85,
        stagger: 0.1,
        ease: 'power3.out',
      });
      gsap.from('.truth-scene', {
        opacity: 0,
        scale: 0.92,
        duration: 1.4,
        ease: 'power2.out',
        delay: 0.25,
      });
    }, hero);
    return () => context.revert();
  }, []);

  return (
    <main id="top" className="landing-page">
      <header className="site-header">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#method">Method</a>
          <a href="#security">Security</a>
          <a href="#use-cases">Use cases</a>
        </nav>
        <button className="header-cta" onClick={focusInvestigationForm}>
          Start investigating
        </button>
      </header>

      <section className="hero" ref={hero}>
        <div className="hero-grid" />
        <div className="hero-copy">
          <div className="availability-pill" data-reveal>
            <span className="pulse-dot" />
            Built for decisions where being wrong is expensive
          </div>
          <h1 data-reveal>
            Evidence before
            <br />
            <em>answers.</em>
          </h1>
          <p className="hero-subtitle" data-reveal>
            Proofline is an AI evidence investigator that cross-checks live sources, challenges its
            own conclusions, and tells you when the facts cannot be verified.
          </p>
          <div data-reveal>
            <InvestigationForm onSubmit={onInvestigate} />
          </div>
          <div className="hero-proof-row" data-reveal>
            <span>
              <Check size={13} /> Source provenance
            </span>
            <span>
              <Check size={13} /> Adversarial review
            </span>
            <span>
              <Check size={13} /> Explicit “I don’t know”
            </span>
          </div>
        </div>

        <div className="hero-visual">
          <Suspense fallback={<div className="truth-scene-fallback" />}>
            <TruthScene />
          </Suspense>
          <div className="visual-label label-source">
            <span className="tiny-dot green" /> EXAMPLE · 06 independent sources
          </div>
          <div className="visual-label label-warning">
            <ShieldAlert size={13} /> EXAMPLE · injection isolated
          </div>
          <div className="visual-label label-verdict">EXAMPLE VERDICT · INCONCLUSIVE</div>
        </div>

        <a href="#method" className="scroll-cue" aria-label="Scroll to methodology">
          <span>See how proof is built</span>
          <ArrowDown size={14} />
        </a>
      </section>

      <section className="trust-strip" aria-label="Technology partners">
        <span className="trust-label">RESEARCH INFRASTRUCTURE</span>
        <span className="tech-wordmark">
          DAYTONA <small>ISOLATED COMPUTE</small>
        </span>
        <span className="divider" />
        <span className="tech-wordmark">
          PLAYWRIGHT <small>LIVE WEB</small>
        </span>
      </section>

      <section id="method" className="method-section">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker">THE PROOFLINE METHOD</span>
            <h2>Designed to doubt itself.</h2>
          </div>
          <p>
            Normal AI optimizes for a plausible response. Proofline optimizes for an auditable
            conclusion—and treats uncertainty as information.
          </p>
        </div>

        <div className="principle-grid">
          {principles.map(({ number, icon: Icon, title, copy }, index) => (
            <motion.article
              className="principle-card"
              key={title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: index * 0.08, duration: 0.5 }}
            >
              <div className="principle-top">
                <span>{number}</span>
                <Icon size={22} strokeWidth={1.7} />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="pipeline-section">
        <div className="pipeline-copy">
          <span className="section-kicker">FROM QUESTION TO EVIDENCE</span>
          <h2>Every conclusion leaves a trail.</h2>
          <p>
            Claims are connected to exact excerpts, publication dates, source owners,
            contradictions, and the original evidence they depend on.
          </p>
          <button onClick={focusInvestigationForm}>
            Start an evidence investigation <Network size={16} />
          </button>
        </div>
        <div className="mini-graph" aria-hidden="true">
          <div className="graph-node primary-node">
            <FileSearch size={17} />
            <span>Audited filing</span>
            <small>PRIMARY · 94</small>
          </div>
          <div className="graph-line line-a" />
          <div className="graph-line line-b" />
          <div className="graph-node claim-node">
            <Fingerprint size={18} />
            <span>Liquidity is sufficient</span>
            <small>CONTRADICTED</small>
          </div>
          <div className="graph-node opposing-node">
            <Binary size={17} />
            <span>Lender notice</span>
            <small>OPPOSES · 94</small>
          </div>
          <span className="edge-label support-label">SUPPORTS</span>
          <span className="edge-label oppose-label">OPPOSES</span>
        </div>
      </section>

      <section id="security" className="security-section">
        <div className="security-console">
          <div className="console-header">
            <span>ILLUSTRATIVE SECURITY EVENT</span>
            <span className="console-live">
              <i /> ISOLATED
            </span>
          </div>
          <div className="console-body">
            <p>
              <span>02:14:13</span> ephemeral research computer ready
            </p>
            <p>
              <span>02:15:46</span> 14 untrusted documents contained
            </p>
            <p className="console-alert">
              <span>02:16:36</span> prompt injection pattern detected
            </p>
            <p>
              <span>02:16:36</span> content quarantined · instruction ignored
            </p>
            <p>
              <span>02:18:49</span> evidence exported · sandbox destroyed
            </p>
          </div>
        </div>
        <div className="security-copy">
          <span className="section-kicker light">SECURITY IS PART OF THE VERDICT</span>
          <h2>The open web never touches the core.</h2>
          <p>
            Browsers, downloads, extraction scripts, and hostile pages run inside a disposable
            Daytona computer. Web content is data—not instructions—and all output crosses a typed
            validation boundary.
          </p>
          <ul>
            <li>
              <Check size={15} /> Ephemeral filesystem and process isolation
            </li>
            <li>
              <Check size={15} /> SSRF and private-network blocking
            </li>
            <li>
              <Check size={15} /> Prompt-injection detection and quarantine
            </li>
            <li>
              <Check size={15} /> File limits, timeouts, and domain policy
            </li>
          </ul>
        </div>
      </section>

      <section id="use-cases" className="use-cases-section">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker">HIGH-STAKES RESEARCH</span>
            <h2>Built for the questions that become decisions.</h2>
          </div>
        </div>
        <div className="use-case-list">
          {useCases.map((item, index) => (
            <button key={item} onClick={() => onInvestigate(`Investigate this: ${item}`)}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item}</strong>
              <ArrowDown size={15} className="diagonal-arrow" />
            </button>
          ))}
        </div>
      </section>

      <section className="closing-section">
        <span className="section-kicker">INTELLECTUAL HONESTY, BUILT IN</span>
        <h2>
          An AI that knows
          <br />
          when it doesn’t know.
        </h2>
        <p>Don’t ask AI for an answer. Ask it to prove one.</p>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={focusInvestigationForm}
        >
          Run the investigation <ArrowDown size={17} className="diagonal-arrow" />
        </motion.button>
      </section>

      <footer>
        <Brand compact />
        <p>Evidence-grade research for consequential decisions.</p>
        <span>DAYTONA HACKSPRINT · SINGAPORE</span>
      </footer>
    </main>
  );
}
