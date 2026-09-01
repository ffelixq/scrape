import type { Investigation, Source } from '@proofline/contracts';
import {
  Background,
  BackgroundVariant,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import {
  Building2,
  ExternalLink,
  FileCheck2,
  Gavel,
  GitBranch,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Quote,
  Scan,
  ShieldQuestion,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { buildGraphModel, chainFor, type GraphNodeData, type GraphView } from '../lib/graph-model';
import { formatDate } from '../lib/utils';

interface EvidenceGraphProps {
  investigation: Investigation;
  onOpenSource: (source: Source) => void;
}

const kindIcon = {
  verdict: Gavel,
  claim: ShieldQuestion,
  group: Layers,
  evidence: Quote,
  source: FileCheck2,
  origin: GitBranch,
} as const;

function GraphNode({ data }: NodeProps) {
  const node = data as GraphNodeData;
  const Icon = kindIcon[node.kind];
  return (
    <div className={`graph-node-card kind-${node.kind} tone-${node.tone}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="graph-node-head">
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
        <span>{node.kind === 'group' ? node.title : node.kind.toUpperCase()}</span>
        {node.badge && node.kind !== 'group' && <b>{node.badge}</b>}
      </div>
      {node.kind !== 'group' && <strong>{node.title}</strong>}
      {node.subtitle && <small>{node.subtitle}</small>}
      {node.meta.length > 0 && (
        <ul>
          {node.meta.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { proofline: memo(GraphNode) };

function GraphToolbar({
  view,
  onViewChange,
  fullscreen,
  onToggleFullscreen,
  onReset,
}: {
  view: GraphView;
  onViewChange: (view: GraphView) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onReset: () => void;
}) {
  const flow = useReactFlow();
  return (
    <Panel position="top-right" className="graph-toolbar">
      <div className="graph-view-switch" role="group" aria-label="Graph detail level">
        <button
          type="button"
          className={view === 'SIMPLE' ? 'active' : ''}
          onClick={() => onViewChange('SIMPLE')}
        >
          Simplified
        </button>
        <button
          type="button"
          className={view === 'DETAILED' ? 'active' : ''}
          onClick={() => onViewChange('DETAILED')}
        >
          Detailed
        </button>
      </div>
      <div className="graph-zoom" role="group" aria-label="Graph view controls">
        <button type="button" onClick={() => flow.zoomIn()} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" onClick={() => flow.zoomOut()} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => void flow.fitView({ padding: 0.2, duration: 260 })}
          aria-label="Fit graph to screen"
        >
          <Scan size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            onReset();
            void flow.fitView({ padding: 0.2, duration: 260 });
          }}
          aria-label="Reset view"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </Panel>
  );
}

export function EvidenceGraph({ investigation, onOpenSource }: EvidenceGraphProps) {
  const [view, setView] = useState<GraphView>('SIMPLE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const model = useMemo(() => buildGraphModel(investigation, view), [investigation, view]);
  const chain = useMemo(
    () => (selectedId ? chainFor(model, selectedId) : null),
    [model, selectedId],
  );

  useEffect(() => setSelectedId(null), [view, investigation.id]);
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const nodes = useMemo(
    () =>
      model.nodes.map((node) => ({
        ...node,
        className: !chain
          ? 'graph-node'
          : chain.has(node.id)
            ? 'graph-node focused'
            : 'graph-node dimmed',
      })),
    [model.nodes, chain],
  );
  const edges = useMemo(
    () =>
      model.edges.map((edge) => ({
        ...edge,
        className: `${edge.className ?? ''} ${
          !chain ? '' : chain.has(edge.source) && chain.has(edge.target) ? 'focused' : 'dimmed'
        }`.trim(),
      })),
    [model.edges, chain],
  );

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedId((current) => (current === node.id ? null : node.id));
  }, []);

  const selected = selectedId ? model.nodes.find((node) => node.id === selectedId) : undefined;
  const selectedSource = selected?.data.sourceId
    ? investigation.sources.find((source) => source.id === selected.data.sourceId)
    : undefined;

  if (investigation.claims.length === 0) {
    return (
      <div className="panel-empty">
        No claim survived extraction and validation, so there is no evidence chain to draw.
      </div>
    );
  }

  return (
    <div className={`evidence-graph ${fullscreen ? 'fullscreen' : ''}`}>
      <div className="evidence-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedId(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.25}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9d5c9" />
          <GraphToolbar
            view={view}
            onViewChange={setView}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((value) => !value)}
            onReset={() => setSelectedId(null)}
          />
          <Panel position="bottom-left" className="graph-legend">
            <span>
              <i className="legend-claim" /> Claim
            </span>
            <span>
              <i className="legend-support" /> Supporting
            </span>
            <span>
              <i className="legend-oppose" /> Opposing
            </span>
            <span>
              <i className="legend-primary" /> Primary source
            </span>
            <span>
              <i className="legend-origin" /> Origin cluster
            </span>
          </Panel>
        </ReactFlow>
      </div>

      <aside className="graph-inspector" aria-live="polite">
        {!selected && (
          <div className="inspector-empty">
            <strong>Select any node</strong>
            <p>
              Choosing a claim, an evidence link or a source highlights only that chain and dims the
              rest of the graph. {view === 'SIMPLE' ? 'Switch to' : 'Return to'}{' '}
              {view === 'SIMPLE' ? 'Detailed' : 'Simplified'} view to{' '}
              {view === 'SIMPLE'
                ? 'add exact excerpts and source origins'
                : 'reduce the graph to claims and sources'}
              .
            </p>
          </div>
        )}
        {selected && (
          <div className="inspector-body">
            <div className="inspector-head">
              <span>{selected.data.kind.toUpperCase()}</span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Clear selection"
              >
                <X size={14} />
              </button>
            </div>
            <h4>{selected.data.label}</h4>
            {selectedSource ? (
              <dl className="inspector-meta">
                <div>
                  <dt>
                    <Building2 size={12} /> Publisher
                  </dt>
                  <dd>{selectedSource.publisher}</dd>
                </div>
                <div>
                  <dt>Source type</dt>
                  <dd>
                    {selectedSource.tier} · {selectedSource.isPrimary ? 'primary' : 'secondary'}
                  </dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{formatDate(selectedSource.publishedAt)}</dd>
                </div>
                <div>
                  <dt>Reliability</dt>
                  <dd>{selectedSource.reliabilityScore}/100</dd>
                </div>
                <div>
                  <dt>Independent</dt>
                  <dd>{selectedSource.isDuplicate ? 'No — derivative copy' : 'Yes'}</dd>
                </div>
                <div>
                  <dt>Origin group</dt>
                  <dd>{selectedSource.independenceGroup}</dd>
                </div>
              </dl>
            ) : (
              <ul className="inspector-list">
                {selected.data.subtitle && <li>{selected.data.subtitle}</li>}
                {selected.data.meta.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {selectedSource && (
              <div className="inspector-actions">
                <button type="button" onClick={() => onOpenSource(selectedSource)}>
                  Open full record
                </button>
                <a href={selectedSource.url} target="_blank" rel="noreferrer">
                  Original <ExternalLink size={12} />
                </a>
              </div>
            )}
            {selected.data.kind === 'claim' && (
              <div className="inspector-counts">
                <span className="supports">
                  <ThumbsUp size={12} /> {selected.data.meta[0]}
                </span>
                <span className="opposes">
                  <ThumbsDown size={12} /> {selected.data.meta[1]}
                </span>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
