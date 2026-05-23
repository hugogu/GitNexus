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
  it('should place different types in correct layers', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('f1', 'Folder', 'src'),
        makeNode('file1', 'File', 'main.ts'),
        makeNode('cls1', 'Class', 'MyClass'),
        makeNode('fn1', 'Function', 'myFunc'),
      ],
      relationships: [],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    const folderY = positions.get('f1')!.y;
    const fileY = positions.get('file1')!.y;
    const classY = positions.get('cls1')!.y;
    const funcY = positions.get('fn1')!.y;

    // Layer ordering: Folder < File < Class < Function
    expect(folderY).toBeLessThan(fileY);
    expect(fileY).toBeLessThan(classY);
    expect(classY).toBeLessThan(funcY);
  });

  it('should arrange many same-type nodes in a grid within a layer', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 40; i++) {
      nodes.push(makeNode(`fn${i}`, 'Function', `func${i}`));
    }

    const graph: KnowledgeGraph = { nodes, relationships: [] };
    const positions = calculateTreeLayout(graph, 'alphabetical');

    const xValues = nodes.map((n) => positions.get(n.id)!.x);
    const yValues = nodes.map((n) => positions.get(n.id)!.y);

    // Should have multiple columns (spread horizontally)
    const uniqueX = [...new Set(xValues)].sort((a, b) => a - b);
    expect(uniqueX.length).toBeGreaterThan(3);

    // Should have multiple rows (spread vertically within layer)
    const uniqueY = [...new Set(yValues)].sort((a, b) => a - b);
    expect(uniqueY.length).toBeGreaterThan(1);

    // Overall width should be significant
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    expect(maxX - minX).toBeGreaterThan(500);

    // Height spread within layer should be moderate (not a single line)
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    expect(maxY - minY).toBeGreaterThan(50);
    expect(maxY - minY).toBeLessThan(250); // But not too tall
  });

  it('should sort nodes alphabetically within layers', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('z', 'Function', 'zFn'),
        makeNode('a', 'Function', 'aFn'),
        makeNode('m', 'Function', 'mFn'),
      ],
      relationships: [],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    // In grid layout, 'a' should appear before 'm' and 'z' in reading order
    // (left-to-right, top-to-bottom)
    const aPos = positions.get('a')!;
    const mPos = positions.get('m')!;
    const zPos = positions.get('z')!;

    // Reading order: a comes before m, which comes before z
    const aIndex = aPos.y * 10000 + aPos.x;
    const mIndex = mPos.y * 10000 + mPos.x;
    const zIndex = zPos.y * 10000 + zPos.x;

    expect(aIndex).toBeLessThan(mIndex);
    expect(mIndex).toBeLessThan(zIndex);
  });

  it('should place multiple node types in correct layers', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('folder', 'Folder', 'src'),
        makeNode('file', 'File', 'main.ts'),
        makeNode('iface', 'Interface', 'MyInterface'),
        makeNode('enum', 'Enum', 'MyEnum'),
        makeNode('method', 'Method', 'myMethod'),
      ],
      relationships: [],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    // Folder (layer 0) should be highest (smallest Y)
    expect(positions.get('folder')!.y).toBeLessThan(positions.get('file')!.y);

    // File (layer 1) should be above Class/Interface/Enum (layer 2)
    expect(positions.get('file')!.y).toBeLessThan(positions.get('iface')!.y);
    expect(positions.get('file')!.y).toBeLessThan(positions.get('enum')!.y);

    // Interface/Enum (layer 2) should be above Method (layer 3)
    expect(positions.get('iface')!.y).toBeLessThan(positions.get('method')!.y);
    expect(positions.get('enum')!.y).toBeLessThan(positions.get('method')!.y);
  });

  it('should keep node sizes reasonable', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('folder', 'Folder', 'src'),
        makeNode('file', 'File', 'main.ts'),
        makeNode('fn', 'Function', 'myFunc'),
      ],
      relationships: [],
    };

    const positions = calculateTreeLayout(graph, 'alphabetical');

    for (const id of ['folder', 'file', 'fn']) {
      expect(positions.get(id)!.size).toBeGreaterThan(2);
      expect(positions.get(id)!.size).toBeLessThan(25);
    }
  });
});
