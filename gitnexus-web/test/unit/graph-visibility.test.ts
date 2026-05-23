import { describe, expect, it } from 'vitest';
import { createKnowledgeGraph } from '../../src/core/graph/graph';
import { getVisibleGraphSnapshot, getVisibleNodeIds } from '../../src/lib/graph-visibility';
import {
  createCallsRelationship,
  createContainsRelationship,
  createDefinesRelationship,
  createFileNode,
  createFolderNode,
  createFunctionNode,
  createImportsRelationship,
} from '../fixtures/graph';

const createFixtureGraph = () => {
  const graph = createKnowledgeGraph();

  const folder = createFolderNode('src', 'src');
  const fileA = createFileNode('alpha.ts', 'src/alpha.ts');
  const fileB = createFileNode('beta.ts', 'src/beta.ts');
  const functionA = createFunctionNode('alpha', 'src/alpha.ts', 10);
  const functionB = createFunctionNode('beta', 'src/beta.ts', 20);

  for (const node of [folder, fileA, fileB, functionA, functionB]) {
    graph.addNode(node);
  }

  graph.addRelationship(createContainsRelationship(folder.id, fileA.id));
  graph.addRelationship(createContainsRelationship(folder.id, fileB.id));
  graph.addRelationship(createDefinesRelationship(fileA.id, functionA.id));
  graph.addRelationship(createDefinesRelationship(fileB.id, functionB.id));
  graph.addRelationship(createCallsRelationship(functionA.id, functionB.id));
  graph.addRelationship(createImportsRelationship(fileA.id, fileB.id));

  return { graph, folder, fileA, fileB, functionA, functionB };
};

describe('graph visibility selectors', () => {
  it('uses all relationships for focus-depth neighborhood calculations', () => {
    const { graph, fileA, functionA, functionB } = createFixtureGraph();

    const visibleNodeIds = getVisibleNodeIds(
      graph,
      ['Folder', 'File', 'Function'],
      functionA.id,
      1,
    );

    expect(visibleNodeIds.has(functionA.id)).toBe(true);
    expect(visibleNodeIds.has(fileA.id)).toBe(true);
    expect(visibleNodeIds.has(functionB.id)).toBe(true);
  });

  it('filters visible edges by the shared relationship filter set', () => {
    const { graph, functionA, functionB } = createFixtureGraph();

    const snapshot = getVisibleGraphSnapshot(
      graph,
      ['Folder', 'File', 'Function'],
      ['IMPORTS'],
      functionA.id,
      1,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.visibleNodeIds.has(functionB.id)).toBe(true);
    expect(snapshot?.relationships).toEqual([]);
  });

  it('returns only eligible edges whose endpoints are still visible', () => {
    const { graph, functionA, functionB, fileA } = createFixtureGraph();

    const snapshot = getVisibleGraphSnapshot(
      graph,
      ['Folder', 'File', 'Function'],
      ['CALLS', 'IMPORTS'],
      functionA.id,
      2,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.visibleNodeIds.has(fileA.id)).toBe(true);
    expect(snapshot?.visibleEdgeIds.has(`${functionA.id}_CALLS_${functionB.id}`)).toBe(true);
    expect(snapshot?.relationships.every((rel) => snapshot.visibleNodeIds.has(rel.sourceId))).toBe(
      true,
    );
    expect(snapshot?.relationships.every((rel) => snapshot.visibleNodeIds.has(rel.targetId))).toBe(
      true,
    );
  });
});
