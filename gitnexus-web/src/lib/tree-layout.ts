import type { KnowledgeGraph } from '../core/graph/types';
import type { GraphNode, NodeLabel } from 'gitnexus-shared';
import { NODE_SIZES } from './constants';

export interface TreeNodePosition {
  x: number;
  y: number;
  size: number;
  depth: number;
}

const HIERARCHY_RELATIONS = new Set(['CONTAINS', 'DEFINES', 'IMPORTS']);

const ROOT_TYPES = new Set(['Project', 'Package', 'Module', 'Folder']);

const LEVEL_RANGES = [
  { minY: 0, maxY: 120 },
  { minY: 140, maxY: 340 },
  { minY: 360, maxY: 560 },
  { minY: 580, maxY: 740 },
  { minY: 760, maxY: 860 },
  { minY: 880, maxY: 940 },
];

const ROOT_SPACING = 400;
const MIN_LEAF_SPACING = 80;

function deterministicHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash) / 2147483647;
}

function getLevelRange(depth: number): { minY: number; maxY: number } {
  if (depth < LEVEL_RANGES.length) return LEVEL_RANGES[depth];
  const last = LEVEL_RANGES[LEVEL_RANGES.length - 1];
  return { minY: last.maxY + 20, maxY: last.maxY + 80 };
}

function calculateY(nodeId: string, depth: number, degree: number): number {
  const range = getLevelRange(depth);
  const rangeHeight = range.maxY - range.minY;
  const hashOffset = deterministicHash(nodeId) * rangeHeight * 0.6;
  const degreeOffset = Math.min(degree / 20, 1) * rangeHeight * 0.2;
  return range.minY + hashOffset + degreeOffset;
}

function calculateNodeSize(depth: number, nodeType: NodeLabel): number {
  const baseSize = NODE_SIZES[nodeType] || 8;
  const depthMultiplier = Math.max(0.3, 1 - depth * 0.15);
  return baseSize * depthMultiplier;
}

function buildTreeStructure(graph: KnowledgeGraph) {
  const parentToChildren = new Map<string, string[]>();
  const childToParent = new Map<string, string>();
  const nodeMap = new Map<string, GraphNode>();

  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const rel of graph.relationships) {
    if (HIERARCHY_RELATIONS.has(rel.type)) {
      if (!parentToChildren.has(rel.sourceId)) {
        parentToChildren.set(rel.sourceId, []);
      }
      parentToChildren.get(rel.sourceId)!.push(rel.targetId);
      childToParent.set(rel.targetId, rel.sourceId);
    }
  }

  return { parentToChildren, childToParent, nodeMap };
}

function calculateDegrees(graph: KnowledgeGraph): Map<string, number> {
  const degrees = new Map<string, number>();

  for (const node of graph.nodes) {
    degrees.set(node.id, 0);
  }

  for (const rel of graph.relationships) {
    if (rel.type === 'CALLS') {
      degrees.set(rel.sourceId, (degrees.get(rel.sourceId) || 0) + 1);
      degrees.set(rel.targetId, (degrees.get(rel.targetId) || 0) + 1);
    }
  }

  return degrees;
}

function getSubtreeWidth(
  nodeId: string,
  parentToChildren: Map<string, string[]>,
  cache: Map<string, number>,
): number {
  if (cache.has(nodeId)) return cache.get(nodeId)!;

  const children = parentToChildren.get(nodeId) || [];
  if (children.length === 0) {
    cache.set(nodeId, MIN_LEAF_SPACING);
    return MIN_LEAF_SPACING;
  }

  let width = 0;
  for (const child of children) {
    width += getSubtreeWidth(child, parentToChildren, cache);
  }

  cache.set(nodeId, width);
  return width;
}

export function calculateTreeLayout(
  graph: KnowledgeGraph,
  sortMode: 'alphabetical' | 'degree',
): Map<string, TreeNodePosition> {
  const positions = new Map<string, TreeNodePosition>();
  const { parentToChildren, childToParent, nodeMap } = buildTreeStructure(graph);
  const degrees = calculateDegrees(graph);
  const widthCache = new Map<string, number>();

  // Find root nodes
  const roots: string[] = [];
  for (const node of graph.nodes) {
    if (!childToParent.has(node.id) && ROOT_TYPES.has(node.label)) {
      roots.push(node.id);
    }
  }

  // Sort roots
  roots.sort((a, b) => {
    const nodeA = nodeMap.get(a)!;
    const nodeB = nodeMap.get(b)!;
    return nodeA.properties.name.localeCompare(nodeB.properties.name);
  });

  function getSortedChildren(nodeId: string): string[] {
    const children = parentToChildren.get(nodeId) || [];
    return [...children].sort((a, b) => {
      if (sortMode === 'alphabetical') {
        const nodeA = nodeMap.get(a)!;
        const nodeB = nodeMap.get(b)!;
        return nodeA.properties.name.localeCompare(nodeB.properties.name);
      } else {
        const degA = degrees.get(a) || 0;
        const degB = degrees.get(b) || 0;
        return degB - degA;
      }
    });
  }

  function layoutNode(nodeId: string, parentX: number, availableWidth: number, depth: number) {
    if (positions.has(nodeId)) return;

    const node = nodeMap.get(nodeId);
    if (!node) return;

    const degree = degrees.get(nodeId) || 0;
    const y = calculateY(nodeId, depth, degree);
    const size = calculateNodeSize(depth, node.label);

    positions.set(nodeId, { x: parentX, y, size, depth });

    const children = getSortedChildren(nodeId);
    if (children.length === 0) return;

    let currentX = parentX - availableWidth / 2;

    for (const child of children) {
      const childWidth = getSubtreeWidth(child, parentToChildren, widthCache);
      const childCenterX = currentX + childWidth / 2;
      const jitter = (deterministicHash(child) - 0.5) * childWidth * 0.1;

      layoutNode(child, childCenterX + jitter, childWidth, depth + 1);
      currentX += childWidth;
    }
  }

  // Layout multi-root trees
  const totalWidth = roots.reduce(
    (sum, root) => sum + getSubtreeWidth(root, parentToChildren, widthCache),
    0,
  );
  const totalSpacing = (roots.length - 1) * ROOT_SPACING;
  let currentX = -(totalWidth + totalSpacing) / 2;

  for (const root of roots) {
    const rootWidth = getSubtreeWidth(root, parentToChildren, widthCache);
    const rootCenterX = currentX + rootWidth / 2;

    layoutNode(root, rootCenterX, rootWidth, 0);
    currentX += rootWidth + ROOT_SPACING;
  }

  // Handle orphan nodes (no parent, not a root type)
  const orphanX = currentX + 200;
  let orphanOffset = 0;
  for (const node of graph.nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: orphanX + orphanOffset,
        y: calculateY(node.id, 0, degrees.get(node.id) || 0),
        size: calculateNodeSize(0, node.label),
        depth: 0,
      });
      orphanOffset += MIN_LEAF_SPACING;
    }
  }

  return positions;
}
