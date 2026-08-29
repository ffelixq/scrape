import { ShieldCheck } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href="#top" aria-label="Proofline home">
      <span className="brand-mark" aria-hidden="true">
        <ShieldCheck size={compact ? 14 : 16} strokeWidth={2.2} />
      </span>
      <span className="brand-name">PROOFLINE</span>
      {!compact && <span className="brand-edition">EVIDENCE OS</span>}
    </a>
  );
}
