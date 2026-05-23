import { describe, expect, it } from 'vitest';
import { createKnowledgeGraph } from '../../src/core/graph/graph';
import { getVisibleGraphSnapshot } from '../../src/lib/graph-visibility';
import { buildTreeViewModel } from '../../src/lib/tree-view-model';
import {
  createCallsRelationship,
  createContainsRelationship,
  createDefinesRelationship,
  createFileNode,
  createFolderNode,
  createFunctionNode,
  createImportNode,
  createImportsRelationship,
} from '../fixtures/graph';

const createTreeFixtureGraph = () => {
  const graph = createKnowledgeGraph();

  const root = createFolderNode('src', 'src');
  const alphaFile = createFileNode('alpha.ts', 'src/alpha.ts');
  const betaFile = createFileNode('beta.ts', 'src/beta.ts');
  const alphaFunction = createFunctionNode('alpha', 'src/alpha.ts', 10);
  const betaFunction = createFunctionNode('beta', 'src/beta.ts', 20);
  const alphaImport = createImportNode('beta', 'src/alpha.ts');

  for (const node of [root, alphaFile, betaFile, alphaFunction, betaFunction, alphaImport]) {
    graph.addNode(node);
  }

  graph.addRelationship(createContainsRelationship(root.id, alphaFile.id));
  graph.addRelationship(createContainsRelationship(root.id, betaFile.id));
  graph.addRelationship(createDefinesRelationship(alphaFile.id, alphaFunction.id));
  graph.addRelationship(createDefinesRelationship(betaFile.id, betaFunction.id));
  graph.addRelationship(createImportsRelationship(alphaFile.id, alphaImport.id));
  graph.addRelationship(createImportsRelationship(alphaFile.id, betaFile.id));
  graph.addRelationship(createCallsRelationship(alphaFunction.id, betaFunction.id));

  return { graph, root, alphaFile, betaFile, alphaFunction, betaFunction, alphaImport };
};

describe('tree view model', () => {
  it('builds a single-instance physical tree plus dashed cross-links', () => {
    const { graph, root, alphaFile, betaFile, alphaFunction, betaFunction, alphaImport } =
      createTreeFixtureGraph();
    const snapshot = getVisibleGraphSnapshot(
      graph,
      ['Folder', 'File', 'Function', 'Import'],
      ['CONTAINS', 'DEFINES', 'IMPORTS', 'CALLS'],
      null,
      null,
    );

    const model = buildTreeViewModel(snapshot, 'alphabetical', graph);

    expect(model.rootNodeIds).toEqual([root.id]);
    expect(model.nodesById.get(root.id)?.childNodeIds).toEqual([alphaFile.id, betaFile.id]);
    expect(model.nodesById.get(alphaFile.id)?.childNodeIds).toEqual([
      alphaFunction.id,
      alphaImport.id,
    ]);
    expect(model.nodesById.get(betaFile.id)?.childNodeIds).toEqual([betaFunction.id]);
    expect(model.nodesById.has(alphaImport.id)).toBe(true);
    expect(model.crossLinks.map((link) => link.relationType).sort()).toEqual(['CALLS', 'IMPORTS']);
  });

  it('reorders siblings by inbound and outbound visible degree', () => {
    const { graph, root, alphaFile, betaFile } = createTreeFixtureGraph();
    const snapshot = getVisibleGraphSnapshot(
      graph,
      ['Folder', 'File', 'Function'],
      ['CONTAINS', 'DEFINES', 'IMPORTS', 'CALLS'],
      null,
      null,
    );

    const inboundModel = buildTreeViewModel(snapshot, 'inboundDegree', graph);
    const outboundModel = buildTreeViewModel(snapshot, 'outboundDegree', graph);

    expect(inboundModel.nodesById.get(root.id)?.childNodeIds[0]).toBe(betaFile.id);
    expect(outboundModel.nodesById.get(root.id)?.childNodeIds[0]).toBe(alphaFile.id);
  });

  it('promotes visible nodes to roots when their physical parent is filtered out', () => {
    const { graph, alphaFile, alphaFunction, betaFile } = createTreeFixtureGraph();
    const snapshot = getVisibleGraphSnapshot(graph, ['File', 'Function'], ['DEFINES'], null, null);

    const model = buildTreeViewModel(snapshot, 'alphabetical', graph);

    expect(model.rootNodeIds).toContain(alphaFile.id);
    expect(model.rootNodeIds).toContain(betaFile.id);
    expect(model.nodesById.get(alphaFile.id)?.isPromotedRoot).toBe(true);
    expect(model.nodesById.get(alphaFunction.id)?.parentNodeId).toBe(alphaFile.id);
  });
});
