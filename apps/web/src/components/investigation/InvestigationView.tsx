import type { Investigation, Source } from '@proofline/contracts';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  FileWarning,
  GitFork,
  Scale,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EvidenceGraph } from '../EvidenceGraph';
import { SourceDrawer } from '../SourceDrawer';
import { ConversationPanel } from './ConversationPanel';
import { DoubtTimeline } from './DoubtTimeline';
import { EvidenceSummaryPanel } from './EvidenceSummaryPanel';
import { ResearchStatus } from './ResearchStatus';
import {
  caseLabel,
  formatDuration,
  gateInterventions,
  isRunning,
  statusClass,
  strengthLabel,
  strengthNote,
} from '../../lib/investigation';
import { formatDate, formatStatus } from '../../lib/utils';

interface InvestigationViewProps {
  investigation: Investigation;
  startedAt?: number;
  askPending: boolean;
  onAsk: (question: string) => void;
}

const SECTIONS = [
  { id: 'verdict', label: 'Verdict' },
  { id: 'findings', label: 'Key findings' },
  { id: 'cases', label: 'Both cases' },
  { id: 'doubt', label: 'Self-doubt' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'graph', label: 'Graph' },
  { id: 'sources', label: 'Sources' },
  { id: 'conversation', label: 'Conversation' },
] as const;

export function InvestigationView({
  investigation,
  startedAt,
  askPending,
  onAsk,
}: InvestigationViewProps) {
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [activeSection, setActiveSection] = useState<string>('verdict');
  const [detailOpen, setDetailOpen] = useState(false);

  const running = isRunning(investigation.status);
  const failed = investigation.status === 'FAILED';
  const gate = useMemo(() => gateInterventions(investigation), [investigation]);
  const selectedEvidence = selectedSource
    ? investigation.evidence.filter((item) => item.sourceId === selectedSource.id)
    : [];

  useEffect(() => {
    if (running || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: [0.1, 0.4] },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [running, investigation.id]);

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="investigation-view">
      <header className="investigation-header">
        <div className="investigation-question">
          <span className="kicker">INVESTIGATION QUESTION</span>
          <h1>{investigation.question}</h1>
          <div className="investigation-meta">
            <span>{caseLabel(investigation.id)}</span>
            <span>
              <Clock3 size={12} />{' '}
              {formatDate(investigation.completedAt ?? investigation.createdAt)}
            </span>
            <span>{formatDuration(investigation.createdAt, investigation.completedAt)}</span>
            <span className={`run-chip ${failed ? 'failed' : running ? 'live' : 'done'}`}>
              {failed ? 'RUN INCOMPLETE' : running ? 'LIVE RUN' : 'EVIDENCE ON RECORD'}
            </span>
          </div>
        </div>
        {!running && (
          <div className="investigation-actions">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(window.location.href)}
            >
              <Copy size={13} /> Share
            </button>
            <button type="button" onClick={() => window.print()}>
              <Download size={13} /> Export
            </button>
          </div>
        )}
      </header>

      {running ? (
        <div className="running-layout">
          <ResearchStatus investigation={investigation} startedAt={startedAt} />
          <section className="panel doubt-panel">
            <div className="panel-head">
              <div>
                <span className="kicker">DESIGNED TO DOUBT ITSELF</span>
                <h2>The investigation in progress</h2>
              </div>
              <p>Each stage below runs before a verdict is allowed to stand.</p>
            </div>
            <DoubtTimeline investigation={investigation} onOpenSource={setSelectedSource} />
          </section>
        </div>
      ) : (
        <>
          <nav className="section-rail" aria-label="Report sections">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? 'active' : ''}
                onClick={() => jumpTo(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          {investigation.securityEvents.length > 0 && (
            <div className="security-alert">
              <ShieldAlert size={16} />
              <div>
                <strong>
                  {investigation.securityEvents.length} prompt injection attempt
                  {investigation.securityEvents.length === 1 ? '' : 's'} isolated
                </strong>
                <span>
                  Content quarantined in the sandbox · instructions ignored · run continued
                </span>
              </div>
              <button type="button" onClick={() => jumpTo('sources')}>
                View log <ChevronRight size={13} />
              </button>
            </div>
          )}

          <motion.section
            id="verdict"
            className="panel verdict-panel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
          >
            <div className="verdict-main">
              <div
                className={`verdict-badge ${investigation.verdict ? statusClass[investigation.verdict] : ''}`}
              >
                FINAL VERDICT · {formatStatus(investigation.verdict)}
              </div>
              <h2>{investigation.answer ?? 'The investigation produced no conclusion.'}</h2>
              <div className="verdict-next">
                <strong>
                  {failed ? 'WHY THIS RUN STOPPED' : 'WHAT WOULD STRENGTHEN THIS VERDICT'}
                </strong>
                <span>
                  {investigation.limitations[0] ??
                    'No material evidence limitation was recorded for this investigation.'}
                </span>
              </div>
            </div>
            <div className="verdict-strength">
              <span className="kicker">EVIDENCE STRENGTH</span>
              <strong>
                {investigation.evidenceStrength}
                <small>/100</small>
              </strong>
              <span className="strength-word">{strengthLabel(investigation.evidenceStrength)}</span>
              <div className="strength-track" aria-hidden="true">
                <span style={{ width: `${investigation.evidenceStrength}%` }} />
              </div>
              <p>{strengthNote(investigation.evidenceStrength)}</p>
              {gate.verdictDowngraded && (
                <div className="gate-flag">
                  <AlertTriangle size={13} /> Downgraded by the evidence gate
                </div>
              )}
            </div>
          </motion.section>

          <section id="findings" className="panel">
            <div className="panel-head">
              <div>
                <span className="kicker">CLAIM-BY-CLAIM AUDIT</span>
                <h2>Key findings</h2>
              </div>
              <p>Only claims with a validated verbatim citation are listed.</p>
            </div>
            <div className="claim-list">
              {investigation.claims.map((claim, index) => (
                <article className="claim-row" key={claim.id}>
                  <span className="claim-number">C{index + 1}</span>
                  <div className="claim-copy">
                    <h4>{claim.text}</h4>
                    <p>{claim.rationale}</p>
                  </div>
                  <div className="claim-counts">
                    <span className="supports">+{claim.supportCount} supporting</span>
                    <span className="opposes">−{claim.opposeCount} opposing</span>
                  </div>
                  <div className={`claim-status ${statusClass[claim.status]}`}>
                    <strong>{formatStatus(claim.status)}</strong>
                    <span>{claim.evidenceStrength}/100</span>
                  </div>
                </article>
              ))}
              {investigation.claims.length === 0 && (
                <div className="panel-empty">
                  No claim survived extraction and citation validation in this run.
                </div>
              )}
            </div>
          </section>

          <section id="cases" className="panel">
            <div className="panel-head">
              <div>
                <span className="kicker">SUPPORTING VS OPPOSING</span>
                <h2>Both cases, weighed separately</h2>
              </div>
              <p>The auditor sees both reports before anything is published.</p>
            </div>
            <div className="case-grid">
              <article className="case-card support">
                <span>
                  <Check size={13} /> CASE FOR
                </span>
                <p>
                  {investigation.audit.supportingAgentSummary || 'No supporting case survived.'}
                </p>
              </article>
              <article className="case-card oppose">
                <span>
                  <AlertTriangle size={13} /> CASE AGAINST
                </span>
                <p>{investigation.audit.opposingAgentSummary || 'No opposing case survived.'}</p>
              </article>
              <article className="case-card audit">
                <span>
                  <Scale size={13} /> AUDITOR
                </span>
                <p>{investigation.audit.auditorSummary || 'No audit summary was produced.'}</p>
              </article>
            </div>
          </section>

          <section id="doubt" className="panel doubt-panel">
            <div className="panel-head">
              <div>
                <span className="kicker">DESIGNED TO DOUBT ITSELF</span>
                <h2>How this conclusion was attacked</h2>
              </div>
              <p>
                The investigation does not stop at its first answer. It argues against itself, then
                keeps only what survives.
              </p>
            </div>
            <DoubtTimeline investigation={investigation} onOpenSource={setSelectedSource} />
          </section>

          <section id="evidence" className="panel">
            <div className="panel-head">
              <div>
                <span className="kicker">EVIDENCE SUMMARY</span>
                <h2>What the evidence base looks like</h2>
              </div>
              <p>The conclusion first, the reasoning underneath it.</p>
            </div>
            <EvidenceSummaryPanel investigation={investigation} />
          </section>

          <section id="graph" className="panel graph-panel">
            <div className="panel-head">
              <div>
                <span className="kicker">PROVENANCE MAP</span>
                <h2>Evidence graph</h2>
              </div>
              <p>
                Verdict to claim to evidence to source to origin. Select any node to isolate it.
              </p>
            </div>
            <EvidenceGraph investigation={investigation} onOpenSource={setSelectedSource} />
          </section>

          <section id="sources" className="panel">
            <div className="panel-head">
              <div>
                <span className="kicker">SOURCE AUDIT</span>
                <h2>Detailed sources</h2>
              </div>
              <p>Agreement is counted by origin, not by page count.</p>
            </div>
            {investigation.metrics.falseConsensusClusters > 0 && (
              <div className="false-consensus-banner">
                <GitFork size={16} />
                <div>
                  <strong>False consensus detected</strong>
                  <span>
                    {investigation.metrics.falseConsensusClusters} derivative cluster
                    {investigation.metrics.falseConsensusClusters === 1 ? ' was' : 's were'} counted
                    once by origin.
                  </span>
                </div>
              </div>
            )}
            <div className="source-table">
              <div className="source-table-head">
                <span>Source</span>
                <span>Tier</span>
                <span>Published</span>
                <span>Independence</span>
                <span>Reliability</span>
                <span />
              </div>
              {investigation.sources.map((source) => (
                <button key={source.id} type="button" onClick={() => setSelectedSource(source)}>
                  <span>
                    <strong>{source.title}</strong>
                    <small>{source.publisher}</small>
                  </span>
                  <span>
                    <i className={`source-tier tier-${source.tier.toLowerCase()}`}>{source.tier}</i>
                  </span>
                  <span>{formatDate(source.publishedAt)}</span>
                  <span className={source.isDuplicate ? 'duplicate-text' : 'independent-text'}>
                    {source.isDuplicate ? 'DERIVATIVE' : 'INDEPENDENT'}
                  </span>
                  <span>
                    <b>{source.reliabilityScore}</b>/100
                  </span>
                  <span>
                    <ChevronRight size={14} />
                  </span>
                </button>
              ))}
              {investigation.sources.length === 0 && (
                <div className="panel-empty">No source was exported from this run.</div>
              )}
            </div>

            <details
              className="deep-detail"
              open={detailOpen}
              onToggle={(event) => setDetailOpen(event.currentTarget.open)}
            >
              <summary>
                Contradictions, limitations and the security log
                <span>
                  {investigation.contradictions.length} · {investigation.limitations.length} ·{' '}
                  {investigation.securityEvents.length}
                </span>
              </summary>

              <div className="detail-block">
                <h3>Contradictions investigated</h3>
                {investigation.contradictions.map((item) => (
                  <article key={item.id} className="contradiction-row">
                    <span className="reason-chip">
                      {item.reason.replaceAll('_', ' ')} DIFFERENCE
                    </span>
                    <h4>{item.summary}</h4>
                    <p>
                      <strong>RESOLUTION</strong> {item.resolution}
                    </p>
                  </article>
                ))}
                {investigation.contradictions.length === 0 && (
                  <div className="panel-empty">No contradiction was identified.</div>
                )}
              </div>

              <div className="detail-block">
                <h3>
                  <FileWarning size={14} /> Limitations
                </h3>
                <ul className="limitation-list">
                  {investigation.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  {investigation.limitations.length === 0 && <li>None recorded.</li>}
                </ul>
              </div>

              <div className="detail-block">
                <h3>
                  <ShieldCheck size={14} /> Security log
                </h3>
                {investigation.securityEvents.map((event) => (
                  <article key={event.id} className="security-row">
                    <span>
                      {event.severity} · {event.category.replaceAll('_', ' ')}
                    </span>
                    <p>{event.message}</p>
                    <small>{formatDate(event.detectedAt)}</small>
                  </article>
                ))}
                {investigation.securityEvents.length === 0 && (
                  <div className="panel-empty">
                    No prompt-injection or malicious-content pattern was recorded.
                  </div>
                )}
              </div>
            </details>
          </section>

          <section id="conversation" className="panel conversation-panel">
            <div className="panel-head">
              <div>
                <span className="kicker">INVESTIGATION CONVERSATION</span>
                <h2>Keep questioning this investigation</h2>
              </div>
              <p>Ask why, ask for the evidence, or ask it to disprove itself.</p>
            </div>
            <ConversationPanel
              investigation={investigation}
              pending={askPending}
              onAsk={onAsk}
              onOpenSource={setSelectedSource}
            />
          </section>
        </>
      )}

      <SourceDrawer
        source={selectedSource}
        evidence={selectedEvidence}
        onClose={() => setSelectedSource(null)}
      />
    </div>
  );
}
