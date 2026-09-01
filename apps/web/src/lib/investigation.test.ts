import { describe, expect, it } from 'vitest';
import { investigationFixture } from '../test/fixture';
import { buildDoubtStages, buildEvidenceSummary, gateInterventions } from './investigation';
import { buildGraphModel, chainFor } from './graph-model';

describe('self-doubt narrative', () => {
  it('records where the conclusion weakened and never invents a stage', () => {
    const stages = buildDoubtStages(investigationFixture());
    const byId = Object.fromEntries(stages.map((stage) => [stage.id, stage]));

    expect(stages.map((stage) => stage.id)).toEqual([
      'thesis',
      'challenge',
      'counter-evidence',
      'contradictions',
      'provenance',
      're-evaluation',
      'verdict',
    ]);
    expect(stages.every((stage) => stage.state === 'DONE')).toBe(true);
    expect(byId['challenge']!.shift).toBe('WEAKER');
    expect(byId['contradictions']!.detail).toContain('1 contradiction');
    expect(byId['provenance']!.findings[0]).toContain('false-consensus cluster');
    expect(byId['re-evaluation']!.shift).toBe('WEAKER');
    expect(byId['re-evaluation']!.detail).toContain('downgraded');
  });

  it('reports an unopposed investigation as unchanged rather than implying a challenge', () => {
    const stages = buildDoubtStages(
      investigationFixture({
        evidence: [],
        contradictions: [],
        limitations: [],
        sources: [],
        metrics: {
          sourcesChecked: 3,
          independentSources: 3,
          primarySources: 3,
          contradictions: 0,
          falseConsensusClusters: 0,
        },
      }),
    );
    const challenge = stages.find((stage) => stage.id === 'challenge')!;

    expect(challenge.shift).toBe('UNCHANGED');
    expect(challenge.findings[0]).toContain('No opposing claim survived');
  });

  it('marks later stages pending while a run is still in flight', () => {
    const stages = buildDoubtStages(investigationFixture({ status: 'RESEARCHING' }));

    expect(stages[0]!.state).toBe('DONE');
    expect(stages[2]!.state).toBe('ACTIVE');
    expect(stages[6]!.state).toBe('PENDING');
    expect(stages[6]!.detail).toBe('Waiting for the previous stage.');
  });

  it('separates the gate downgrade from ordinary limitations', () => {
    const gate = gateInterventions(investigationFixture());
    expect(gate.verdictDowngraded).toBe(true);
    expect(gate.notes).toHaveLength(1);
  });
});

describe('evidence summary', () => {
  it('scores supporting and opposing evidence separately', () => {
    const summary = buildEvidenceSummary(investigationFixture());

    expect(summary.supportingLinks).toBe(1);
    expect(summary.opposingLinks).toBe(1);
    expect(summary.supportingScore).toBe(94);
    expect(summary.opposingScore).toBe(40);
    expect(summary.derivativeSources).toBe(1);
  });
});

describe('evidence graph model', () => {
  it('lays out a hierarchy from verdict to source without stacking nodes', () => {
    const model = buildGraphModel(investigationFixture(), 'SIMPLE');
    const kinds = model.nodes.map((node) => node.data.kind);

    expect(kinds.filter((kind) => kind === 'verdict')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'claim')).toHaveLength(2);
    expect(kinds).toContain('group');
    expect(kinds).toContain('source');
    expect(kinds).not.toContain('origin');

    const positions = new Set(model.nodes.map((node) => `${node.position.x}:${node.position.y}`));
    expect(positions.size).toBe(model.nodes.length);
    // Each layer sits strictly below the one above it.
    const depthOf = (kind: string) =>
      model.nodes.find((node) => node.data.kind === kind)!.position.y;
    expect(depthOf('verdict')).toBeLessThan(depthOf('claim'));
    expect(depthOf('claim')).toBeLessThan(depthOf('group'));
    expect(depthOf('group')).toBeLessThan(depthOf('source'));
  });

  it('adds evidence and origin layers only in the detailed view', () => {
    const model = buildGraphModel(investigationFixture(), 'DETAILED');
    const kinds = model.nodes.map((node) => node.data.kind);

    expect(kinds).toContain('evidence');
    expect(kinds).toContain('origin');
  });

  it('isolates one evidence chain from the selected node', () => {
    const model = buildGraphModel(investigationFixture(), 'SIMPLE');
    const claim = model.nodes.find((node) => node.id === 'claim:claim-growth')!;
    const chain = chainFor(model, claim.id);

    expect(chain.has('verdict')).toBe(true);
    expect(chain.has('claim:claim-certification')).toBe(false);
    expect([...chain].some((id) => id.startsWith('source:claim-growth'))).toBe(true);
  });
});
