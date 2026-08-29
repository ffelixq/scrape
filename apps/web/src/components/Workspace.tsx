import type { EvidenceStatus, Investigation, Source } from '@proofline/contracts';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  FileWarning,
  GitFork,
  LayoutDashboard,
  Network,
  Scale,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useMemo, useState } from 'react';
import { Brand } from './Brand';
import { EvidenceGraph } from './EvidenceGraph';
import { SourceDrawer } from './SourceDrawer';
import { formatDate, formatStatus } from '../lib/utils';

type WorkspaceTab = 'overview' | 'graph' | 'sources' | 'contradictions' | 'security';

interface WorkspaceProps {
  investigation: Investigation;
  onReset: () => void;
}

const tabItems: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Verdict', icon: LayoutDashboard },
  { id: 'graph', label: 'Evidence graph', icon: Network },
  { id: 'sources', label: 'Source audit', icon: SearchCheck },
  { id: 'contradictions', label: 'Contradictions', icon: Scale },
  { id: 'security', label: 'Security log', icon: ShieldCheck },
];

const statusClass: Record<EvidenceStatus, string> = {
  SUPPORTED: 'supported',
  WELL_SUPPORTED: 'well-supported',
  INCONCLUSIVE: 'inconclusive',
  CONTRADICTED: 'contradicted',
  LIKELY_FALSE: 'likely-false',
  UNVERIFIABLE: 'unverifiable',
};

export function Workspace({ investigation, onReset }: WorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const scoreData = useMemo(
    () => [
      { value: investigation.evidenceStrength, fill: '#277052' },
      { value: 100 - investigation.evidenceStrength, fill: '#dedbd0' },
    ],
    [investigation.evidenceStrength],
  );

  const selectedEvidence = selectedSource
    ? investigation.evidence.filter((item) => item.sourceId === selectedSource.id)
    : [];

  function shareReport() {
    void navigator.clipboard?.writeText(window.location.href);
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Brand compact />
        <div className="workspace-breadcrumb">
          <span>INVESTIGATIONS</span>
          <ChevronRight size={13} />
          <strong>MERIDIAN SOLAR</strong>
        </div>
        <div className="workspace-actions">
          <span className="demo-data-chip">ILLUSTRATIVE DEMO DATA</span>
          <button onClick={shareReport}>
            <Copy size={14} /> Share
          </button>
          <button onClick={() => window.print()}>
            <Download size={14} /> Export
          </button>
        </div>
      </header>

      <aside className="workspace-sidebar">
        <div className="investigation-id">
          <span>CASE</span>
          <strong>PL–0829–014</strong>
          <small>Completed in 4m 37s</small>
        </div>
        <nav aria-label="Investigation report sections">
          {tabItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={activeTab === id ? 'active' : ''}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {id === 'contradictions' && <b>{investigation.metrics.contradictions}</b>}
              {id === 'security' && <b>1</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-sandbox">
          <span>
            <i /> SANDBOX DESTROYED
          </span>
          <p>Untrusted files erased after evidence export.</p>
        </div>
        <button className="back-button" onClick={onReset}>
          <ArrowLeft size={15} /> New investigation
        </button>
      </aside>

      <section className="workspace-content">
        <div className="report-question-row">
          <div>
            <span className="section-kicker">INVESTIGATION QUESTION</span>
            <h1>{investigation.question}</h1>
          </div>
          <div className="report-date">
            <Clock3 size={14} /> {formatDate(investigation.completedAt)}
          </div>
        </div>

        <div className="security-alert">
          <ShieldAlert size={18} />
          <div>
            <strong>Potential prompt injection detected</strong>
            <span>
              Content isolated inside Daytona · instruction ignored · research continued safely
            </span>
          </div>
          <button onClick={() => setActiveTab('security')}>
            View event <ChevronRight size={14} />
          </button>
        </div>

        {activeTab === 'overview' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="overview-tab"
          >
            <section className="verdict-panel">
              <div className="verdict-copy">
                <div
                  className={`verdict-badge ${investigation.verdict ? statusClass[investigation.verdict] : ''}`}
                >
                  <CircleHelp size={16} /> FINAL VERDICT · {formatStatus(investigation.verdict)}
                </div>
                <h2>
                  Growth is verified.
                  <br />
                  Contract readiness is not.
                </h2>
                <p>{investigation.answer}</p>
                <div className="next-action">
                  <strong>WHAT WOULD CHANGE THIS VERDICT</strong>
                  <span>
                    Obtain a current bank reference, certification number, and Q2 2026 ageing
                    schedule.
                  </span>
                </div>
              </div>
              <div className="score-visual">
                <ResponsiveContainer width="100%" height={205}>
                  <PieChart>
                    <Pie
                      data={scoreData}
                      dataKey="value"
                      innerRadius={67}
                      outerRadius={85}
                      startAngle={225}
                      endAngle={-45}
                      stroke="none"
                    >
                      {scoreData.map((entry) => (
                        <Cell key={entry.fill} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="score-center">
                  <strong>{investigation.evidenceStrength}</strong>
                  <span>/100</span>
                  <small>
                    EVIDENCE
                    <br />
                    STRENGTH
                  </small>
                </div>
                <p>Moderate evidence · material gaps remain</p>
              </div>
            </section>

            <section className="metric-grid">
              <Metric
                label="Sources checked"
                value={investigation.metrics.sourcesChecked}
                detail="Across web + documents"
              />
              <Metric
                label="Independent origins"
                value={investigation.metrics.independentSources}
                detail="8 derivative sources removed"
                accent
              />
              <Metric
                label="Primary sources"
                value={investigation.metrics.primarySources}
                detail="Filings and registries"
              />
              <Metric
                label="Contradictions"
                value={investigation.metrics.contradictions}
                detail="Both investigated"
                warning
              />
              <Metric
                label="False consensus"
                value={investigation.metrics.falseConsensusClusters}
                detail="Cluster detected"
                warning
              />
            </section>

            <section className="report-section">
              <div className="report-section-header">
                <div>
                  <span className="section-kicker">CLAIM-BY-CLAIM AUDIT</span>
                  <h3>What the evidence actually supports</h3>
                </div>
                <button onClick={() => setActiveTab('graph')}>
                  Open evidence graph <Network size={15} />
                </button>
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
                      <span className="supports">+{claim.supportCount} supports</span>
                      <span className="opposes">−{claim.opposeCount} opposes</span>
                    </div>
                    <div className={`claim-status ${statusClass[claim.status]}`}>
                      <strong>{formatStatus(claim.status)}</strong>
                      <span>{claim.evidenceStrength}/100</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="adversarial-grid">
              <article className="agent-card support-card">
                <div className="agent-card-head">
                  <span>
                    <Check size={15} /> SUPPORT AGENT
                  </span>
                  <small>CASE FOR</small>
                </div>
                <h3>Evidence that strengthens the claim</h3>
                <p>{investigation.audit.supportingAgentSummary}</p>
              </article>
              <article className="agent-card oppose-card">
                <div className="agent-card-head">
                  <span>
                    <AlertTriangle size={15} /> SKEPTIC AGENT
                  </span>
                  <small>CASE AGAINST</small>
                </div>
                <h3>Evidence that challenges the claim</h3>
                <p>{investigation.audit.opposingAgentSummary}</p>
              </article>
              <article className="agent-card audit-card">
                <div className="agent-card-head">
                  <span>
                    <Scale size={15} /> AUDITOR
                  </span>
                  <small>FINAL WEIGHING</small>
                </div>
                <h3>What survives adversarial review</h3>
                <p>{investigation.audit.auditorSummary}</p>
              </article>
            </section>

            <section className="limitations-panel">
              <div>
                <FileWarning size={19} />
                <span>
                  <strong>LIMITATIONS</strong>
                  <small>These gaps prevent a stronger conclusion.</small>
                </span>
              </div>
              <ul>
                {investigation.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </motion.div>
        )}

        {activeTab === 'graph' && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="tab-panel graph-tab"
          >
            <div className="tab-title">
              <div>
                <span className="section-kicker">PROVENANCE MAP</span>
                <h2>Evidence graph</h2>
              </div>
              <p>Click a source to inspect the exact excerpt and origin.</p>
            </div>
            <EvidenceGraph investigation={investigation} onSourceSelect={setSelectedSource} />
          </motion.section>
        )}

        {activeTab === 'sources' && (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tab-panel">
            <div className="tab-title">
              <div>
                <span className="section-kicker">SOURCE QUALITY</span>
                <h2>Independence audit</h2>
              </div>
              <p>Agreement is counted by origin, not page count.</p>
            </div>
            <div className="false-consensus-banner">
              <GitFork size={20} />
              <div>
                <strong>False consensus detected</strong>
                <span>4 pages repeat a single company press release. Counted as one origin.</span>
              </div>
            </div>
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
                <button key={source.id} onClick={() => setSelectedSource(source)}>
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
                    <ChevronRight size={15} />
                  </span>
                </button>
              ))}
            </div>
          </motion.section>
        )}

        {activeTab === 'contradictions' && (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tab-panel">
            <div className="tab-title">
              <div>
                <span className="section-kicker">CONFLICT ANALYSIS</span>
                <h2>Contradictions investigated</h2>
              </div>
              <p>Conflicting numbers are explained, never averaged.</p>
            </div>
            <div className="contradiction-list">
              {investigation.contradictions.map((item, index) => (
                <article key={item.id}>
                  <div className="contradiction-number">0{index + 1}</div>
                  <div className="contradiction-body">
                    <span className="reason-chip">
                      {item.reason.replaceAll('_', ' ')} DIFFERENCE
                    </span>
                    <h3>{item.summary}</h3>
                    <div className="resolution">
                      <Scale size={16} />
                      <p>
                        <strong>RESOLUTION</strong>
                        {item.resolution}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </motion.section>
        )}

        {activeTab === 'security' && (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tab-panel">
            <div className="tab-title">
              <div>
                <span className="section-kicker">DAYTONA ISOLATION</span>
                <h2>Security event log</h2>
              </div>
              <p>Untrusted input remains contained from retrieval to deletion.</p>
            </div>
            <div className="security-summary-grid">
              <div>
                <ShieldCheck size={22} />
                <strong>1</strong>
                <span>Sandbox used</span>
              </div>
              <div>
                <BookOpenCheck size={22} />
                <strong>14</strong>
                <span>Documents isolated</span>
              </div>
              <div>
                <ShieldAlert size={22} />
                <strong>1</strong>
                <span>Injection blocked</span>
              </div>
            </div>
            <div className="security-event-list">
              {investigation.securityEvents.map((event) => (
                <article key={event.id}>
                  <span className="blocked-icon">
                    <ShieldAlert size={17} />
                  </span>
                  <div>
                    <span>
                      {event.severity} · {event.category.replaceAll('_', ' ')}
                    </span>
                    <h3>{event.message}</h3>
                    <p>
                      The webpage content was stored as quoted evidence. No instruction from the
                      page entered the agent control channel.
                    </p>
                  </div>
                  <strong>{formatDate(event.detectedAt)}</strong>
                </article>
              ))}
            </div>
            <div className="isolation-diagram">
              <div>
                <span>01</span>
                <strong>Untrusted web</strong>
                <small>Pages + files</small>
              </div>
              <ChevronRight />
              <div className="isolated-box">
                <span>02</span>
                <strong>Daytona sandbox</strong>
                <small>Browser + extraction</small>
              </div>
              <ChevronRight />
              <div>
                <span>03</span>
                <strong>Validation gate</strong>
                <small>Typed evidence only</small>
              </div>
              <ChevronRight />
              <div>
                <span>04</span>
                <strong>Proofline core</strong>
                <small>Audit + report</small>
              </div>
            </div>
          </motion.section>
        )}
      </section>

      <SourceDrawer
        source={selectedSource}
        evidence={selectedEvidence}
        onClose={() => setSelectedSource(null)}
      />
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  accent = false,
  warning = false,
}: {
  label: string;
  value: number;
  detail: string;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <article className={`metric-card ${accent ? 'accent' : ''} ${warning ? 'warning' : ''}`}>
      <span>{label}</span>
      <strong>{String(value).padStart(2, '0')}</strong>
      <small>{detail}</small>
    </article>
  );
}
