import type { Investigation, InvestigationSummary } from '@proofline/contracts';
import { useSyncExternalStore } from 'react';
import type { InvestigationFormInput } from '../components/InvestigationForm';
import {
  askFollowUp,
  createInvestigation,
  deleteInvestigation,
  getInvestigation,
  listInvestigations,
  subscribeToInvestigation,
} from './api';

/**
 * The workspace store.
 *
 * One investigation can be open in several places at once — a tab, the history list, a live
 * research stream — so the investigation record lives here rather than in any component. Tabs hold
 * ids only, and the live subscription for a running investigation is keyed by id and kept open
 * regardless of which tab is in front. Switching tabs therefore never restarts research and never
 * discards a partially complete run.
 */

const STORAGE_KEY = 'proofline.workspace.v2';
const DRAFT_PREFIX = 'draft:';

export interface WorkspaceState {
  /** Ids of the open investigation tabs, in tab order. */
  tabs: string[];
  activeId: string | null;
  byId: Record<string, Investigation>;
  history: InvestigationSummary[];
  historyState: 'idle' | 'loading' | 'ready' | 'error';
  /** Investigations currently being fetched from the API. */
  loading: Record<string, true>;
  /** Investigations waiting on a follow-up answer. */
  askPending: Record<string, true>;
  /** Wall-clock start of a run, used for the live elapsed timer. */
  startedAt: Record<string, number>;
}

const initialState: WorkspaceState = {
  tabs: [],
  activeId: null,
  byId: {},
  history: [],
  historyState: 'idle',
  loading: {},
  askPending: {},
  startedAt: {},
};

export function isDraftId(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}

function isTerminal(investigation: Investigation | undefined): boolean {
  return investigation?.status === 'COMPLETED' || investigation?.status === 'FAILED';
}

function skeleton(id: string, question: string): Investigation {
  const at = new Date().toISOString();
  return {
    id,
    question,
    status: 'QUEUED',
    verdict: null,
    answer: null,
    evidenceStrength: 0,
    createdAt: at,
    completedAt: null,
    limitations: [],
    sources: [],
    claims: [],
    evidence: [],
    contradictions: [],
    securityEvents: [],
    messages: [],
    metrics: {
      sourcesChecked: 0,
      independentSources: 0,
      primarySources: 0,
      contradictions: 0,
      falseConsensusClusters: 0,
    },
    audit: { supportingAgentSummary: '', opposingAgentSummary: '', auditorSummary: '' },
  };
}

function failed(investigation: Investigation, reason: string): Investigation {
  const at = new Date().toISOString();
  return {
    ...investigation,
    status: 'FAILED',
    verdict: 'UNVERIFIABLE',
    answer: 'The live investigation could not be started. No conclusion was produced.',
    completedAt: at,
    limitations: [reason],
  };
}

function summarize(investigation: Investigation): InvestigationSummary {
  return {
    id: investigation.id,
    title: investigation.question.replace(/\s+/g, ' ').trim().slice(0, 64),
    question: investigation.question,
    status: investigation.status,
    verdict: investigation.verdict,
    evidenceStrength: investigation.evidenceStrength,
    createdAt: investigation.createdAt,
    completedAt: investigation.completedAt,
    sourcesChecked: investigation.metrics.sourcesChecked,
    independentSources: investigation.metrics.independentSources,
    contradictions: investigation.metrics.contradictions,
    messageCount: investigation.messages.length,
  };
}

class WorkspaceStore {
  private state: WorkspaceState = initialState;
  private listeners = new Set<() => void>();
  private streams = new Map<string, () => void>();
  private hydrated = false;

  getState = (): WorkspaceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private put(investigation: Investigation) {
    this.set({ byId: { ...this.state.byId, [investigation.id]: investigation } });
    this.mergeHistory(summarize(investigation));
  }

  private mergeHistory(summary: InvestigationSummary) {
    const history = this.state.history.filter((item) => item.id !== summary.id);
    history.unshift(summary);
    history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this.set({ history });
  }

  /** Keep the address bar pointed at the investigation in front, so a reload restores it. */
  private syncUrl() {
    try {
      const url = new URL(window.location.href);
      if (this.state.activeId && !isDraftId(this.state.activeId)) {
        url.searchParams.set('investigation', this.state.activeId);
      } else {
        url.searchParams.delete('investigation');
      }
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch {
      // History access can be blocked; the session still works without a shareable URL.
    }
  }

  private persist() {
    this.syncUrl();
    try {
      const openable = this.state.tabs.filter((id) => !isDraftId(id));
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tabs: openable,
          activeId:
            this.state.activeId && !isDraftId(this.state.activeId) ? this.state.activeId : null,
        }),
      );
    } catch {
      // A browser with storage disabled still gets a working session, just not a restored one.
    }
  }

  private restore(): { tabs: string[]; activeId: string | null } {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { tabs: [], activeId: null };
      const parsed = JSON.parse(raw) as { tabs?: unknown; activeId?: unknown };
      const tabs = Array.isArray(parsed.tabs)
        ? parsed.tabs.filter((id): id is string => typeof id === 'string')
        : [];
      const activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null;
      return { tabs, activeId: activeId && tabs.includes(activeId) ? activeId : (tabs[0] ?? null) };
    } catch {
      return { tabs: [], activeId: null };
    }
  }

  /** Keep one live stream per running investigation, independent of which tab is in front. */
  private watch(id: string) {
    if (this.streams.has(id) || isDraftId(id)) return;
    try {
      const stop = subscribeToInvestigation(id, (updated) => {
        this.put(updated);
        if (isTerminal(updated)) this.unwatch(id);
      });
      this.streams.set(id, stop);
    } catch {
      // EventSource is unavailable (or blocked); the record still loads through the REST fetch.
    }
  }

  private unwatch(id: string) {
    this.streams.get(id)?.();
    this.streams.delete(id);
  }

  private addTab(id: string) {
    const tabs = this.state.tabs.includes(id) ? this.state.tabs : [...this.state.tabs, id];
    this.set({ tabs, activeId: id });
    this.persist();
  }

  /** Load the persisted session: open tabs, their records, and the history list. */
  hydrate = () => {
    if (this.hydrated) return;
    this.hydrated = true;
    const { tabs, activeId } = this.restore();
    const linked = new URLSearchParams(window.location.search).get('investigation');
    // A run started from the landing page opens its tab before this shell mounts, so the restored
    // session is merged into what is already open rather than replacing it.
    const restored = [...new Set([...this.state.tabs, ...tabs, ...(linked ? [linked] : [])])];
    if (restored.length) {
      this.set({ tabs: restored, activeId: this.state.activeId ?? linked ?? activeId });
    }
    void this.refreshHistory();
    for (const id of restored) void this.load(id);
  };

  /** Show the new-investigation composer without closing any open tab. */
  newTab = () => {
    this.set({ activeId: null });
    this.persist();
  };

  refreshHistory = async () => {
    if (this.state.historyState !== 'ready') this.set({ historyState: 'loading' });
    try {
      const investigations = await listInvestigations();
      const known = new Map(investigations.map((item) => [item.id, item]));
      // A locally held record is never older than the list, so keep it on top of the response.
      for (const investigation of Object.values(this.state.byId)) {
        if (!isDraftId(investigation.id)) known.set(investigation.id, summarize(investigation));
      }
      this.set({
        history: [...known.values()].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
        historyState: 'ready',
      });
    } catch {
      this.set({ historyState: 'error' });
    }
  };

  /** Fetch one investigation, and start streaming it when the run is still in flight. */
  load = async (id: string) => {
    if (isDraftId(id)) return;
    this.set({ loading: { ...this.state.loading, [id]: true } });
    try {
      const investigation = await getInvestigation(id);
      this.put(investigation);
      if (!isTerminal(investigation)) {
        this.set({ startedAt: { ...this.state.startedAt, [id]: Date.now() } });
        this.watch(id);
      }
    } catch {
      this.closeTab(id);
    } finally {
      const loading = { ...this.state.loading };
      delete loading[id];
      this.set({ loading });
    }
  };

  /**
   * Start a new investigation.
   *
   * A draft tab appears immediately so the question is never lost while the API accepts the run;
   * the draft is replaced in place by the real record, keeping the tab the user is looking at.
   */
  start = (input: InvestigationFormInput) => {
    const draftId = `${DRAFT_PREFIX}${crypto.randomUUID()}`;
    this.put(skeleton(draftId, input.question));
    this.set({ startedAt: { ...this.state.startedAt, [draftId]: Date.now() } });
    this.addTab(draftId);

    void createInvestigation({ ...input, mode: 'DEEP', context: '' })
      .then((created) => {
        this.replaceDraft(draftId, created);
        if (!isTerminal(created)) this.watch(created.id);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'The API request failed.';
        const draft = this.state.byId[draftId];
        if (draft) this.put(failed(draft, message));
      });
    return draftId;
  };

  private replaceDraft(draftId: string, created: Investigation) {
    const byId = { ...this.state.byId };
    delete byId[draftId];
    byId[created.id] = created;
    const startedAt = { ...this.state.startedAt };
    startedAt[created.id] = startedAt[draftId] ?? Date.now();
    delete startedAt[draftId];
    this.set({
      byId,
      startedAt,
      tabs: this.state.tabs.map((id) => (id === draftId ? created.id : id)),
      activeId: this.state.activeId === draftId ? created.id : this.state.activeId,
      history: this.state.history.filter((item) => item.id !== draftId),
    });
    this.mergeHistory(summarize(created));
    this.persist();
  }

  /** Open an investigation from history, restoring its full state rather than re-running it. */
  open = (id: string) => {
    this.addTab(id);
    const known = this.state.byId[id];
    if (!known || !isTerminal(known)) void this.load(id);
  };

  activate = (id: string) => {
    if (!this.state.tabs.includes(id)) return this.open(id);
    this.set({ activeId: id });
    this.persist();
  };

  /** Close a tab. The investigation stays on the record and in history. */
  closeTab = (id: string) => {
    const index = this.state.tabs.indexOf(id);
    if (index < 0) return;
    const tabs = this.state.tabs.filter((tabId) => tabId !== id);
    const activeId =
      this.state.activeId === id ? (tabs[Math.max(0, index - 1)] ?? null) : this.state.activeId;
    this.unwatch(id);
    this.set({ tabs, activeId });
    this.persist();
  };

  /** Delete an investigation everywhere: server record, history and any open tab. */
  remove = async (id: string) => {
    this.closeTab(id);
    const byId = { ...this.state.byId };
    delete byId[id];
    this.set({ byId, history: this.state.history.filter((item) => item.id !== id) });
    try {
      await deleteInvestigation(id);
    } catch {
      void this.refreshHistory();
    }
  };

  /** Ask a follow-up question inside an existing investigation. */
  ask = async (id: string, question: string) => {
    const current = this.state.byId[id];
    if (!current || this.state.askPending[id]) return;
    const asked = new Date().toISOString();
    this.put({
      ...current,
      messages: [
        ...current.messages,
        {
          id: `local-${crypto.randomUUID()}`,
          role: 'USER',
          kind: 'FOLLOW_UP',
          content: question,
          createdAt: asked,
          citedSourceIds: [],
          limitations: [],
          failed: false,
        },
      ],
    });
    this.set({ askPending: { ...this.state.askPending, [id]: true } });
    try {
      this.put(await askFollowUp(id, { question }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The follow-up request failed.';
      const latest = this.state.byId[id];
      if (latest) {
        this.put({
          ...latest,
          messages: [
            ...latest.messages,
            {
              id: `local-${crypto.randomUUID()}`,
              role: 'ASSISTANT',
              kind: 'FOLLOW_UP',
              content: 'The follow-up could not be answered. Nothing in the record changed.',
              createdAt: new Date().toISOString(),
              citedSourceIds: [],
              limitations: [message],
              failed: true,
            },
          ],
        });
      }
    } finally {
      const askPending = { ...this.state.askPending };
      delete askPending[id];
      this.set({ askPending });
    }
  };
}

export const workspaceStore = new WorkspaceStore();

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getState, () =>
    workspaceStore.getState(),
  );
}
