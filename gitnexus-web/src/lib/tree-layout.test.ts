import { describe, it, expect } from 'vitest';
import { calculateTreeLayout } from './tree-layout';
import type { KnowledgeGraph } from '../core/graph/types';
import type { GraphNode } from 'gitnexus-shared';

function makeNode(id: string, label: string, name: string): GraphNode {
  return {
    id,
    label: label as any,
    properties: { name, filePath: '', startLine: 1, endLine: 1 },
  };
}

describe('calculateTreeLayout', () => {
  it('should layout a simple single-root tree', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('root', 'Project', 'MyProject'),
        makeNode('child1', 'Folder', 'src'),
        makeNode('child2', 'Folder', 'tests'),
      ],
      relationships: [
        { id: 'r1', type: 'CONTAINS', sourceId: 'root', targetId: 'child1' },
        { id: 'r2', type: 'CONTAINS', sourceId: 'root', targetId: 'child2' },
      ],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    expect(positions.has('root')).toBe(true);
    expect(positions.has('child1')).toBe(true);
    expect(positions.has('child2')).toBe(true);

    const rootPos = positions.get('root')!;
    const child1Pos = positions.get('child1')!;
    const child2Pos = positions.get('child2')!;

    // Root should be above children
    expect(rootPos.y).toBeLessThan(child1Pos.y);
    expect(rootPos.y).toBeLessThan(child2Pos.y);

    // Children should be on same general level but with some variation
    expect(Math.abs(child1Pos.y - child2Pos.y)).toBeLessThan(100);
  });

  it('should sort children alphabetically', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('root', 'Project', 'Root'),
        makeNode('b', 'Folder', 'B'),
        makeNode('a', 'Folder', 'A'),
        makeNode('c', 'Folder', 'C'),
      ],
      relationships: [
        { id: 'r1', type: 'CONTAINS', sourceId: 'root', targetId: 'b' },
        { id: 'r2', type: 'CONTAINS', sourceId: 'root', targetId: 'a' },
        { id: 'r3', type: 'CONTAINS', sourceId: 'root', targetId: 'c' },
      ],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');
    const aX = positions.get('a')!.x;
    const bX = positions.get('b')!.x;
    const cX = positions.get('c')!.x;

    expect(aX).toBeLessThan(bX);
    expect(bX).toBeLessThan(cX);
  });

  it('should handle multiple root nodes', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode('root1', 'Project', 'Project1'), makeNode('root2', 'Project', 'Project2')],
      relationships: [],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    expect(positions.has('root1')).toBe(true);
    expect(positions.has('root2')).toBe(true);

    const root1X = positions.get('root1')!.x;
    const root2X = positions.get('root2')!.x;

    // Roots should be horizontally separated
    expect(Math.abs(root1X - root2X)).toBeGreaterThan(50);
  });

  it('should make node sizes decrease with depth', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('root', 'Project', 'Root'),
        makeNode('child', 'Folder', 'Child'),
        makeNode('grandchild', 'File', 'Grandchild'),
      ],
      relationships: [
        { id: 'r1', type: 'CONTAINS', sourceId: 'root', targetId: 'child' },
        { id: 'r2', type: 'CONTAINS', sourceId: 'child', targetId: 'grandchild' },
      ],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    const rootSize = positions.get('root')!.size;
    const childSize = positions.get('child')!.size;
    const grandchildSize = positions.get('grandchild')!.size;

    expect(rootSize).toBeGreaterThan(childSize);
    expect(childSize).toBeGreaterThan(grandchildSize);
  });

  it('should distribute orphan nodes across different Y levels', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('a', 'Function', 'fnA'),
        makeNode('b', 'Function', 'fnB'),
        makeNode('c', 'Function', 'fnC'),
        makeNode('d', 'Function', 'fnD'),
      ],
      relationships: [],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    const yValues = [
      positions.get('a')!.y,
      positions.get('b')!.y,
      positions.get('c')!.y,
      positions.get('d')!.y,
    ];

    // Orphan nodes should have varying Y coordinates, not all the same
    const uniqueYValues = new Set(yValues);
    expect(uniqueYValues.size).toBeGreaterThan(1);

    // Y values should be spread across different ranges (at least 100px difference)
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    expect(maxY - minY).toBeGreaterThan(100);
  });
});
