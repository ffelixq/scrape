import type { Evidence, Source } from '@proofline/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Copy, ExternalLink, FileText, ShieldCheck, X } from 'lucide-react';
import { formatDate } from '../lib/utils';

interface SourceDrawerProps {
  source: Source | null;
  evidence: Evidence[];
  onClose: () => void;
}

export function SourceDrawer({ source, evidence, onClose }: SourceDrawerProps) {
  return (
    <AnimatePresence>
      {source && (
        <>
          <motion.button
            className="drawer-backdrop"
            aria-label="Close source details"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="source-drawer"
            aria-label="Source details"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="drawer-header">
              <span>SOURCE RECORD</span>
              <button onClick={onClose} aria-label="Close source details">
                <X size={18} />
              </button>
            </div>
            <div className="drawer-body">
              <div className={`source-tier tier-${source.tier.toLowerCase()}`}>
                {source.tier} SOURCE
              </div>
              <h2>{source.title}</h2>
              <p className="source-publisher">{source.publisher}</p>

              <div className="source-score-card">
                <div>
                  <strong>{source.reliabilityScore}</strong>
                  <span>/100</span>
                  <small>RELIABILITY INDICATOR</small>
                </div>
                <ShieldCheck size={28} />
              </div>

              <dl className="source-meta-list">
                <div>
                  <dt>
                    <CalendarDays size={14} /> Published
                  </dt>
                  <dd>{formatDate(source.publishedAt)}</dd>
                </div>
                <div>
                  <dt>
                    <FileText size={14} /> Origin group
                  </dt>
                  <dd>{source.independenceGroup}</dd>
                </div>
                <div>
                  <dt>Independent</dt>
                  <dd>{source.isDuplicate ? 'No — derivative' : 'Yes'}</dd>
                </div>
                <div>
                  <dt>Primary evidence</dt>
                  <dd>{source.isPrimary ? 'Yes' : 'No'}</dd>
                </div>
              </dl>

              <div className="excerpt-card">
                <span>EXACT EXCERPT</span>
                <blockquote>“{source.excerpt}”</blockquote>
              </div>

              {evidence.length > 0 && (
                <div className="evidence-locations">
                  <span>
                    USED IN {evidence.length} EVIDENCE LINK{evidence.length > 1 ? 'S' : ''}
                  </span>
                  {evidence.map((item) => (
                    <div key={item.id}>
                      <strong className={item.relation === 'OPPOSES' ? 'opposes' : 'supports'}>
                        {item.relation}
                      </strong>
                      <p>{item.excerpt}</p>
                      <small>{item.location}</small>
                    </div>
                  ))}
                </div>
              )}

              <div className="drawer-actions">
                <a href={source.url} target="_blank" rel="noreferrer">
                  Open original <ExternalLink size={15} />
                </a>
                <button onClick={() => void navigator.clipboard?.writeText(source.url)}>
                  Copy link <Copy size={15} />
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
