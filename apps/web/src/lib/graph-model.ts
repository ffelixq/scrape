import type { Investigation } from '@proofline/contracts';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

/**
 * The evidence graph is built as a tree, not a network.
 *
 * Every path reads top-down — verdict, claim, side, evidence, source, origin — and a node is
 * repeated under each branch that uses it rather than being wired across the canvas. That keeps
 * lines short and local, which is the difference between a readable hierarchy and a hairball.
 * Sources that share an origin inside the same branch do converge on one origin node, because that
 * convergence is exactly what false consensus looks like.
 */

export type GraphView = 'SIMPLE' | 'DETAILED';

export type GraphNodeKind = 'verdict' | 'claim' | 'group' | 'evidence' | 'source' | 'origin';

export type GraphTone = 'neutral' | 'support' | 'oppose' | 'primary' | 'secondary' | 'warning';

export interface GraphNodeData extends Record<string, unknown> {
  kind: GraphNodeKind;
  label: string;
  title: string;
  subtitle?: string;
  badge?: string;
  tone: GraphTone;
  meta: string[];
  sourceId?: string;
  claimId?: string;
}

interface TreeNode {
  id: string;
  data: GraphNodeData;
  children: TreeNode[];
}

const ROW_HEIGHT = 168;
const SLOT_WIDTH = 268;

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildTree(investigation: Investigation, view: GraphView): TreeNode {
  const sourceById = new Map(investigation.sources.map((source) => [source.id, source]));
  const detailed = view === 'DETAILED';
  const originCounts = new Map<string, number>();
  for (const source of investigation.sources) {
    originCounts.set(
      source.independenceGroup,
      (originCounts.get(source.independenceGroup) ?? 0) + 1,
    );
  }

  const claimNodes: TreeNode[] = investigation.claims.map((claim) => {
    const sides: TreeNode[] = [];
    for (const relation of ['SUPPORTS', 'OPPOSES'] as const) {
      const links = investigation.evidence.filter(
        (item) => item.claimId === claim.id && item.relation === relation,
      );
      if (!links.length) continue;
      const supporting = relation === 'SUPPORTS';
      const originNodes = new Map<string, TreeNode>();
      const sourceNodes: TreeNode[] = [];

      for (const link of links) {
        const source = sourceById.get(link.sourceId);
        if (!source) continue;
        const branch = `${claim.id}:${relation}`;
        const sourceNode: TreeNode = {
          id: `source:${branch}:${source.id}`,
          data: {
            kind: 'source',
            label: source.title,
            title: truncate(source.title, 76),
            subtitle: source.publisher,
            badge: source.tier,
            tone: source.isPrimary || source.tier === 'PRIMARY' ? 'primary' : 'secondary',
            meta: [
              `Reliability ${source.reliabilityScore}/100`,
              source.isDuplicate ? 'Derivative copy' : 'Independent origin',
            ],
            sourceId: source.id,
            claimId: claim.id,
          },
          children: [],
        };

        if (detailed) {
          const shared = originCounts.get(source.independenceGroup) ?? 1;
          const originId = `origin:${branch}:${source.independenceGroup}`;
          const originNode =
            originNodes.get(originId) ??
            ({
              id: originId,
              data: {
                kind: 'origin',
                label: source.independenceGroup,
                title: truncate(source.independenceGroup, 44),
                subtitle: shared > 1 ? 'Shared origin' : 'Single origin',
                badge: 'ORIGIN',
                tone: shared > 1 ? 'warning' : 'neutral',
                meta: [`${shared} document${shared === 1 ? '' : 's'} in this investigation`],
                claimId: claim.id,
              },
              children: [],
            } satisfies TreeNode);
          originNodes.set(originId, originNode);
          sourceNode.children.push(originNode);

          sourceNodes.push({
            id: `evidence:${link.id}`,
            data: {
              kind: 'evidence',
              label: link.excerpt,
              title: truncate(link.excerpt, 110),
              subtitle: link.location,
              badge: supporting ? 'SUPPORTS' : 'OPPOSES',
              tone: supporting ? 'support' : 'oppose',
              meta: [`Weight ${link.weight.toFixed(2)}`],
              sourceId: source.id,
              claimId: claim.id,
            },
            children: [sourceNode],
          });
          continue;
        }

        if (!sourceNodes.some((node) => node.id === sourceNode.id)) sourceNodes.push(sourceNode);
      }

      if (!sourceNodes.length) continue;
      sides.push({
        id: `group:${claim.id}:${relation}`,
        data: {
          kind: 'group',
          label: supporting ? 'Supporting evidence' : 'Opposing evidence',
          title: supporting ? 'SUPPORTING EVIDENCE' : 'OPPOSING EVIDENCE',
          subtitle: `${links.length} validated link${links.length === 1 ? '' : 's'}`,
          tone: supporting ? 'support' : 'oppose',
          meta: [],
          claimId: claim.id,
        },
        children: sourceNodes,
      });
    }

    return {
      id: `claim:${claim.id}`,
      data: {
        kind: 'claim',
        label: claim.text,
        title: truncate(claim.text, 120),
        subtitle: `Evidence strength ${claim.evidenceStrength}/100`,
        badge: statusLabel(claim.status),
        tone: 'neutral',
        meta: [`+${claim.supportCount} supporting`, `−${claim.opposeCount} opposing`],
        claimId: claim.id,
      },
      children: sides,
    };
  });

  return {
    id: 'verdict',
    data: {
      kind: 'verdict',
      label: investigation.question,
      title: statusLabel(investigation.verdict ?? 'PENDING'),
      subtitle: truncate(investigation.question, 110),
      badge: 'FINAL VERDICT',
      tone: 'neutral',
      meta: [`Evidence strength ${investigation.evidenceStrength}/100`],
    },
    children: claimNodes,
  };
}

/** Classic tidy-tree placement: leaves get a slot, parents centre over their children. */
function layout(root: TreeNode): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let cursor = 0;

  const place = (node: TreeNode, depth: number): number => {
    if (!node.children.length) {
      const x = cursor * SLOT_WIDTH;
      cursor += 1;
      positions.set(node.id, { x, y: depth * ROW_HEIGHT });
      return x;
    }
    const childCentres = node.children.map((child) => place(child, depth + 1));
    const x = (childCentres[0]! + childCentres[childCentres.length - 1]!) / 2;
    positions.set(node.id, { x, y: depth * ROW_HEIGHT });
    return x;
  };

  place(root, 0);
  return positions;
}

export interface GraphModel {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
  /** Parent lookup used to highlight one evidence chain and dim everything else. */
  parents: Map<string, string>;
}

export function buildGraphModel(investigation: Investigation, view: GraphView): GraphModel {
  const root = buildTree(investigation, view);
  const positions = layout(root);
  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge[] = [];
  const parents = new Map<string, string>();

  const walk = (node: TreeNode) => {
    nodes.push({
      id: node.id,
      type: 'proofline',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: node.data,
      draggable: false,
      connectable: false,
    });
    for (const child of node.children) {
      parents.set(child.id, node.id);
      const opposing = child.data.tone === 'oppose';
      edges.push({
        id: `${node.id}->${child.id}`,
        source: node.id,
        target: child.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        className: opposing ? 'graph-edge oppose' : 'graph-edge support',
      });
      walk(child);
    }
  };

  walk(root);
  return { nodes, edges, parents };
}

/** The selected node plus its ancestors and descendants — the chain worth reading. */
export function chainFor(model: GraphModel, selectedId: string): Set<string> {
  const chain = new Set<string>([selectedId]);
  let current = model.parents.get(selectedId);
  while (current) {
    chain.add(current);
    current = model.parents.get(current);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parent] of model.parents) {
      if (chain.has(parent) && !chain.has(child)) {
        // Only descend from the selection, never back down a sibling branch of an ancestor.
        let ancestor: string | undefined = parent;
        let fromSelection = false;
        while (ancestor) {
          if (ancestor === selectedId) {
            fromSelection = true;
            break;
          }
          ancestor = model.parents.get(ancestor);
        }
        if (parent === selectedId || fromSelection) {
          chain.add(child);
          grew = true;
        }
      }
    }
  }
  return chain;
}
