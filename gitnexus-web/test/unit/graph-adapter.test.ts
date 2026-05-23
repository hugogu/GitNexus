import { describe, expect, it } from 'vitest';
import { createKnowledgeGraph } from '../../src/core/graph/graph';
import { knowledgeGraphToGraphology } from '../../src/lib/graph-adapter';
import { createCallsRelationship, createFileNode, createFunctionNode } from '../fixtures/graph';

describe('knowledgeGraphToGraphology edge keys', () => {
  it('uses relationship ids as graph edge keys so visibility filtering can match them', () => {
    const graph = createKnowledgeGraph();
    const file = createFileNode('app.ts', 'src/app.ts');
    const sourceFn = createFunctionNode('main', 'src/app.ts', 1);
    const targetFn = createFunctionNode('helper', 'src/app.ts', 20);
    const relationship = createCallsRelationship(sourceFn.id, targetFn.id);

    graph.addNode(file);
    graph.addNode(sourceFn);
    graph.addNode(targetFn);
    graph.addRelationship(relationship);

    const sigmaGraph = knowledgeGraphToGraphology(graph);

    expect(sigmaGraph.hasEdge(relationship.id)).toBe(true);
    expect(sigmaGraph.getEdgeAttribute(relationship.id, 'relationType')).toBe('CALLS');
  });
});
