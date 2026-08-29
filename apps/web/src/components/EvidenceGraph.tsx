import type { Investigation, Source } from '@proofline/contracts';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useMemo } from 'react';

interface EvidenceGraphProps {
  investigation: Investigation;
  onSourceSelect: (source: Source) => void;
}

export function EvidenceGraph({ investigation, onSourceSelect }: EvidenceGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const claimNodes: Node[] = investigation.claims.map((claim, index) => ({
      id: claim.id,
      position: { x: 385, y: 50 + index * 155 },
      data: {
        label: (
          <div className="flow-node-content">
            <span className={`flow-badge status-${claim.status.toLowerCase()}`}>
              {claim.status.replaceAll('_', ' ')}
            </span>
            <strong>{claim.text}</strong>
            <small>Evidence strength {claim.evidenceStrength}/100</small>
          </div>
        ),
      },
      className: 'flow-node flow-claim',
    }));

    const supportSourceIds = new Set(
      investigation.evidence
        .filter((item) => item.relation !== 'OPPOSES')
        .map((item) => item.sourceId),
    );
    const sourceNodes: Node[] = investigation.sources.map((source) => {
      const supports = supportSourceIds.has(source.id);
      const laneIndex = supports
        ? investigation.sources
            .filter((item) => supportSourceIds.has(item.id))
            .findIndex((item) => item.id === source.id)
        : investigation.sources
            .filter((item) => !supportSourceIds.has(item.id))
            .findIndex((item) => item.id === source.id);
      return {
        id: source.id,
        position: { x: supports ? 20 : 780, y: 35 + laneIndex * 150 },
        data: {
          source,
          label: (
            <div className="flow-node-content source-content">
              <span className={`source-tier tier-${source.tier.toLowerCase()}`}>{source.tier}</span>
              <strong>{source.title}</strong>
              <small>
                {source.publisher} · {source.reliabilityScore}/100
              </small>
              {source.isDuplicate && <em>COPIED ORIGIN</em>}
            </div>
          ),
        },
        className: `flow-node flow-source ${source.isDuplicate ? 'duplicate' : ''}`,
      };
    });

    const graphEdges: Edge[] = investigation.evidence.map((item) => {
      const opposes = item.relation === 'OPPOSES';
      return {
        id: item.id,
        source: opposes ? item.claimId : item.sourceId,
        target: opposes ? item.sourceId : item.claimId,
        label: item.relation,
        animated: item.weight > 0.9,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: opposes ? '#d45e3c' : '#3a8a65',
        },
        style: {
          stroke: opposes ? '#d45e3c' : '#3a8a65',
          strokeWidth: 1.6,
        },
        labelStyle: {
          fill: opposes ? '#a7442a' : '#28694c',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
        },
      };
    });

    return { nodes: [...sourceNodes, ...claimNodes], edges: graphEdges };
  }, [investigation]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    const source = (node.data as { source?: Source }).source;
    if (source) onSourceSelect(source);
  };

  return (
    <div className="evidence-graph-wrap">
      <div className="graph-legend">
        <span>
          <i className="legend-source" /> Sources
        </span>
        <span>
          <i className="legend-claim" /> Claims
        </span>
        <span>
          <i className="legend-support" /> Supports
        </span>
        <span>
          <i className="legend-oppose" /> Opposes
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.5}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d9d5c9" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(node) => (node.className?.includes('flow-claim') ? '#17241e' : '#7eb798')}
          maskColor="rgba(245, 243, 236, 0.76)"
        />
      </ReactFlow>
    </div>
  );
}
