import type { ProviderUsageDashboard } from '@proofline/contracts';
import { Activity, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';

interface ProviderUsagePanelProps {
  usage: ProviderUsageDashboard | null;
  error: string | null;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-SG', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function resetText(resetAt: string | null, fallback: string): string {
  if (!resetAt) return fallback;
  const instant = new Date(resetAt);
  if (Number.isNaN(instant.getTime())) return fallback;
  return `Resets ${new Intl.DateTimeFormat('en-SG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Singapore',
  }).format(instant)}`;
}

export function ProviderUsagePanel({ usage, error }: ProviderUsagePanelProps) {
  if (error) {
    return (
      <div className="usage-panel usage-panel-error" role="status">
        <AlertTriangle size={14} /> Usage data is temporarily unavailable.
      </div>
    );
  }
  if (!usage) {
    return (
      <div className="usage-panel usage-panel-loading" role="status">
        <Activity size={14} /> Checking provider allowances…
      </div>
    );
  }

  return (
    <details className="usage-panel" open>
      <summary>
        <span>
          <Activity size={14} /> Provider usage
        </span>
        <small>provider-reported where available · otherwise app-tracked</small>
      </summary>
      <div className="usage-grid">
        {usage.providers.map((provider) => {
          const percentage = provider.limit
            ? Math.min(100, Math.round((provider.used / provider.limit) * 100))
            : null;
          const hasIssue = ['needs_attention', 'unavailable', 'not_configured'].includes(
            provider.status,
          );
          return (
            <article className="usage-card" key={provider.provider}>
              <div className="usage-card-heading">
                <div>
                  <strong>{provider.label}</strong>
                  {provider.model && <span>{provider.model}</span>}
                </div>
                <span className={hasIssue ? 'provider-status issue' : 'provider-status'}>
                  {hasIssue ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                  {provider.status.replace('_', ' ')}
                </span>
              </div>
              <div className="usage-numbers">
                <b>{compactNumber(provider.used)}</b>
                <span>
                  / {provider.limit ? compactNumber(provider.limit) : 'limit shown in console'}{' '}
                  {provider.unit}
                </span>
              </div>
              <div
                className={percentage === null ? 'quota-meter unknown' : 'quota-meter'}
                role="progressbar"
                aria-label={`${provider.label} ${provider.unit} used`}
                aria-valuenow={provider.used}
                aria-valuemin={0}
                aria-valuemax={provider.limit ?? undefined}
                aria-valuetext={
                  percentage === null
                    ? `${provider.used} used; exact provider limit unavailable`
                    : `${percentage}% used`
                }
              >
                <span style={{ width: percentage === null ? '100%' : `${percentage}%` }} />
              </div>
              <p>{provider.note}</p>
              <div className="usage-reset">
                <Clock3 size={11} /> {resetText(provider.resetAt, provider.resetLabel)}
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
