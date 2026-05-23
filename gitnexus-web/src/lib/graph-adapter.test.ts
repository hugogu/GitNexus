import { describe, it, expect } from 'vitest';
import { knowledgeGraphToTreeGraphology } from './graph-adapter';
import type { KnowledgeGraph } from '../core/graph/types';
import type { GraphNode } from 'gitnexus-shared';

function makeNode(id: string, label: string, name: string): GraphNode {
  return {
    id,
    label: label as any,
    properties: { name, filePath: '', startLine: 1, endLine: 1 },
  };
}

describe('knowledgeGraphToTreeGraphology', () => {
  it('should create a graph with tree layout', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('root', 'Project', 'MyProject'),
        makeNode('folder', 'Folder', 'src'),
        makeNode('file', 'File', 'main.ts'),
      ],
      relationships: [
        { id: 'r1', type: 'CONTAINS', sourceId: 'root', targetId: 'folder' },
        { id: 'r2', type: 'CONTAINS', sourceId: 'folder', targetId: 'file' },
        { id: 'r3', type: 'CALLS', sourceId: 'file', targetId: 'root' },
      ],
    };

    const sigmaGraph = knowledgeGraphToTreeGraphology(graph, 'alphabetical');

    expect(sigmaGraph.hasNode('root')).toBe(true);
    expect(sigmaGraph.hasNode('folder')).toBe(true);
    expect(sigmaGraph.hasNode('file')).toBe(true);

    const rootAttrs = sigmaGraph.getNodeAttributes('root');
    const folderAttrs = sigmaGraph.getNodeAttributes('folder');
    const fileAttrs = sigmaGraph.getNodeAttributes('file');

    // Root should be above folder
    expect(rootAttrs.y).toBeLessThan(folderAttrs.y);
    // Folder should be above file
    expect(folderAttrs.y).toBeLessThan(fileAttrs.y);

    // Root should be largest
    expect(rootAttrs.size).toBeGreaterThan(folderAttrs.size);
    expect(folderAttrs.size).toBeGreaterThan(fileAttrs.size);
  });

  it('should style hierarchy edges differently from cross-cutting edges', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode('a', 'Function', 'fnA'), makeNode('b', 'Function', 'fnB')],
      relationships: [
        { id: 'r1', type: 'CONTAINS', sourceId: 'a', targetId: 'b' },
        { id: 'r2', type: 'CALLS', sourceId: 'a', targetId: 'b' },
      ],
    };

    const sigmaGraph = knowledgeGraphToTreeGraphology(graph, 'alphabetical');

    // Find edges and check their attributes
    sigmaGraph.forEachEdge((edge, attrs) => {
      if (attrs.relationType === 'CONTAINS') {
        expect(attrs.isHierarchyEdge).toBe(true);
      } else if (attrs.relationType === 'CALLS') {
        expect(attrs.isHierarchyEdge).toBe(false);
      }
    });
  });
});
