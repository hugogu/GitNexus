import type { KnowledgeGraph } from '../core/graph/types';
import type { GraphNode, NodeLabel } from 'gitnexus-shared';
import { NODE_SIZES } from './constants';

export interface TreeNodePosition {
  x: number;
  y: number;
  size: number;
  depth: number;
}

/**
 * Maps node types to display layers in the tree view.
 * Layer 0 = top (containers), Layer 3 = bottom (functions/methods).
 */
const TYPE_TO_LAYER: Record<string, number> = {
  // Layer 0: Structural containers
  Project: 0,
  Package: 0,
  Module: 0,
  Folder: 0,
  Namespace: 0,

  // Layer 1: Files
  File: 1,
  Section: 1,
  Import: 1,
  Route: 1,
  Tool: 1,

  // Layer 2: Type definitions
  Class: 2,
  Interface: 2,
  Enum: 2,
  Type: 2,
  Struct: 2,
  Trait: 2,
  Union: 2,
  Record: 2,
  Typedef: 2,
  Template: 2,
  TypeAlias: 2,

  // Layer 3: Functions / Methods
  Function: 3,
  Method: 3,
  Impl: 3,
  Delegate: 3,
  Constructor: 3,
  Variable: 3,
  Const: 3,
  Static: 3,
  Property: 3,
  Decorator: 3,
  Annotation: 3,
  Macro: 3,
  CodeElement: 3,
};

/** Fallback layer for unmapped types. */
const DEFAULT_LAYER = 1;

/** Virtual canvas size for layout calculation. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const LAYER_COUNT = 4;
const LAYER_HEIGHT = CANVAS_HEIGHT / LAYER_COUNT; // 200
const PADDING_X = 60;
const PADDING_Y = 15;
const MIN_NODE_GAP = 45;
// HAS_METHOD and HAS_PROPERTY are Kotlin/Java-style hierarchy edges
// (Class→Method, Class→Property). Treat them like DEFINES for layout purposes
// so Methods/Properties cluster beneath their parent Class horizontally.
const HIERARCHY_RELATIONS = new Set(['CONTAINS', 'DEFINES', 'HAS_METHOD', 'HAS_PROPERTY']);
const MAX_X = (CANVAS_WIDTH - PADDING_X * 2) / 2;

const RELATION_SPRING_WEIGHTS: Record<string, number> = {
  CONTAINS: 0.12,
  DEFINES: 0.16,
  HAS_METHOD: 0.16, // Same as DEFINES — keeps methods near their class
  HAS_PROPERTY: 0.14, // Slightly weaker — properties can spread more
  IMPORTS: 0.2,
  CALLS: 0.24,
  EXTENDS: 0.18,
  IMPLEMENTS: 0.18,
};

function calculateNodeSize(layer: number, nodeType: NodeLabel): number {
  const baseSize = NODE_SIZES[nodeType] || 6;
  const layerMultiplier = Math.max(0.6, 1 - layer * 0.12);
  return baseSize * layerMultiplier;
}

function deterministicHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

/**
 * Calculate grid dimensions (cols × rows) for a layer.
 * Aims for a balanced aspect ratio within the available space.
 */
function calculateGrid(nodeCount: number, availableWidth: number, availableHeight: number) {
  if (nodeCount <= 0) return { cols: 0, rows: 0, gapX: 0, gapY: 0 };

  const maxCols = Math.max(1, Math.floor(availableWidth / MIN_NODE_GAP));

  // Target: grid aspect ratio close to availableWidth / availableHeight
  const targetCols = Math.sqrt(nodeCount * (availableWidth / availableHeight));
  const cols = Math.min(maxCols, Math.max(1, Math.round(targetCols)));
  const rows = Math.ceil(nodeCount / cols);

  // Evenly distribute nodes within available space
  const gapX = availableWidth / cols;
  const gapY = availableHeight / rows;

  return { cols, rows, gapX, gapY };
}

function getNodeLayer(node: GraphNode): number {
  return TYPE_TO_LAYER[node.label] ?? DEFAULT_LAYER;
}

function buildHierarchyMaps(graph: KnowledgeGraph) {
  const childrenByParent = new Map<string, string[]>();
  const parentsByChild = new Map<string, string[]>();

  for (const rel of graph.relationships) {
    if (!HIERARCHY_RELATIONS.has(rel.type)) continue;

    if (!childrenByParent.has(rel.sourceId)) {
      childrenByParent.set(rel.sourceId, []);
    }
    childrenByParent.get(rel.sourceId)!.push(rel.targetId);

    if (!parentsByChild.has(rel.targetId)) {
      parentsByChild.set(rel.targetId, []);
    }
    parentsByChild.get(rel.targetId)!.push(rel.sourceId);
  }

  return { childrenByParent, parentsByChild };
}

function buildLayerNodeIds(graph: KnowledgeGraph): string[][] {
  const nodeIdsByLayer: string[][] = Array.from({ length: LAYER_COUNT }, () => []);

  for (const node of graph.nodes) {
    const layer = getNodeLayer(node);
    if (layer >= 0 && layer < LAYER_COUNT) {
      nodeIdsByLayer[layer].push(node.id);
    }
  }

  return nodeIdsByLayer;
}

function getRestEdgeLength(
  relationType: string,
  source: TreeNodePosition,
  target: TreeNodePosition,
) {
  const depthGap = Math.abs(source.depth - target.depth);
  const baseLength = HIERARCHY_RELATIONS.has(relationType) ? 60 : 85;
  return baseLength + depthGap * 40;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function enforceLayerSpacing(
  layerNodeIds: string[],
  positions: Map<string, TreeNodePosition>,
  anchorXByNode: Map<string, number>,
) {
  if (layerNodeIds.length < 2) return;

  const sortedIds = [...layerNodeIds].sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < sortedIds.length; i++) {
      const prev = positions.get(sortedIds[i - 1])!;
      const curr = positions.get(sortedIds[i])!;
      const minGap = Math.max(MIN_NODE_GAP * 0.65, (prev.size + curr.size) * 1.7);
      const gap = curr.x - prev.x;

      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        prev.x -= push;
        curr.x += push;
      }
    }

    for (let i = sortedIds.length - 2; i >= 0; i--) {
      const curr = positions.get(sortedIds[i])!;
      const next = positions.get(sortedIds[i + 1])!;
      const minGap = Math.max(MIN_NODE_GAP * 0.65, (curr.size + next.size) * 1.7);
      const gap = next.x - curr.x;

      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        curr.x -= push;
        next.x += push;
      }
    }
  }

  const anchorCenter =
    sortedIds.reduce((sum, nodeId) => sum + (anchorXByNode.get(nodeId) ?? 0), 0) / sortedIds.length;
  const currentCenter =
    sortedIds.reduce((sum, nodeId) => sum + positions.get(nodeId)!.x, 0) / sortedIds.length;
  const recenterDelta = currentCenter - anchorCenter;

  for (const nodeId of sortedIds) {
    const pos = positions.get(nodeId)!;
    pos.x = clamp(pos.x - recenterDelta, -MAX_X, MAX_X);
  }
}

/**
 * Initialize positions using type-layered grid layout.
 */
function initGridPositions(graph: KnowledgeGraph): Map<string, TreeNodePosition> {
  const positions = new Map<string, TreeNodePosition>();

  const nodesByLayer: GraphNode[][] = [[], [], [], []];
  for (const node of graph.nodes) {
    const layer = getNodeLayer(node);
    if (layer >= 0 && layer < LAYER_COUNT) {
      nodesByLayer[layer].push(node);
    }
  }

  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    nodesByLayer[layer].sort((a, b) => {
      return a.properties.name.localeCompare(b.properties.name);
    });
  }

  const availableWidth = CANVAS_WIDTH - PADDING_X * 2;
  const availableHeight = LAYER_HEIGHT - PADDING_Y * 2;

  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const nodes = nodesByLayer[layer];
    if (nodes.length === 0) continue;

    const { cols, rows, gapX, gapY } = calculateGrid(nodes.length, availableWidth, availableHeight);

    const visualLayer = LAYER_COUNT - 1 - layer;
    const layerBaseY = visualLayer * LAYER_HEIGHT + PADDING_Y;
    const layerActualHeight = rows * gapY;
    const verticalOffset = (availableHeight - layerActualHeight) / 2;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const row = Math.floor(i / cols);
      const col = i % cols;

      const x = -availableWidth / 2 + (col + 0.5) * gapX;
      const y = layerBaseY + verticalOffset + (row + 0.5) * gapY;
      const size = calculateNodeSize(layer, node.label);

      positions.set(node.id, { x, y, size, depth: layer });
    }
  }

  if (positions.size > 0) {
    const centerY = CANVAS_HEIGHT / 2;
    for (const pos of positions.values()) {
      pos.y -= centerY;
    }
  }

  return positions;
}

/**
 * Tree view layout: type-layered grid with organic jitter and
 * structure-aware horizontal branch shaping.
 */
export function calculateTreeLayout(graph: KnowledgeGraph): Map<string, TreeNodePosition> {
  // 1. Start with grid layout (provides good X distribution)
  const positions = initGridPositions(graph);
  const nodeIdsByLayer = buildLayerNodeIds(graph);
  const { childrenByParent, parentsByChild } = buildHierarchyMaps(graph);

  // 2. Add organic jitter to avoid rigid grid appearance
  for (const [nodeId, pos] of positions) {
    const jitterX = (deterministicHash(nodeId) - 0.5) * 35;
    const jitterY = (deterministicHash(nodeId + 'y') - 0.5) * 25;
    pos.x += jitterX;
    pos.y += jitterY;
  }

  // 3. Use structural edges to create a tree-like horizontal ordering while
  // preserving the type-based vertical layers.
  const STRUCTURE_ITERATIONS = 6;
  for (let iter = 0; iter < STRUCTURE_ITERATIONS; iter++) {
    const childTargets = new Map<string, { sum: number; count: number }>();

    for (const [parentId, children] of childrenByParent) {
      const parentPos = positions.get(parentId);
      if (!parentPos || children.length === 0) continue;

      const childPositions = children
        .map((childId) => ({ childId, pos: positions.get(childId) }))
        .filter(
          (entry): entry is { childId: string; pos: TreeNodePosition } => entry.pos !== undefined,
        )
        .sort((a, b) => a.pos.x - b.pos.x);

      if (childPositions.length === 0) continue;

      const currentCenter =
        childPositions.reduce((sum, entry) => sum + entry.pos.x, 0) / childPositions.length;
      const shift = parentPos.x - currentCenter;

      for (const entry of childPositions) {
        const existing = childTargets.get(entry.childId) || { sum: 0, count: 0 };
        existing.sum += entry.pos.x + shift;
        existing.count += 1;
        childTargets.set(entry.childId, existing);
      }
    }

    for (const [nodeId, target] of childTargets) {
      const pos = positions.get(nodeId);
      if (!pos) continue;
      const avgTargetX = target.sum / target.count;
      pos.x = pos.x * 0.45 + avgTargetX * 0.55;
    }

    const parentTargets = new Map<string, { sum: number; count: number }>();
    for (const [parentId, children] of childrenByParent) {
      const parentPos = positions.get(parentId);
      if (!parentPos || children.length === 0) continue;

      const childXs = children
        .map((childId) => positions.get(childId)?.x)
        .filter((value): value is number => value !== undefined);

      if (childXs.length === 0) continue;

      const avgChildX = childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
      const existing = parentTargets.get(parentId) || { sum: 0, count: 0 };
      existing.sum += avgChildX;
      existing.count += 1;
      parentTargets.set(parentId, existing);
    }

    for (const [nodeId, target] of parentTargets) {
      const pos = positions.get(nodeId);
      if (!pos) continue;
      const avgTargetX = target.sum / target.count;
      pos.x = pos.x * 0.65 + avgTargetX * 0.35;
    }
  }

  // 4. Pull childless nodes slightly toward their hierarchy parents when the
  // graph has enough structure information to form branches.
  for (const [nodeId, parents] of parentsByChild) {
    if (childrenByParent.has(nodeId)) continue;
    const pos = positions.get(nodeId);
    if (!pos || parents.length === 0) continue;

    const parentXs = parents
      .map((parentId) => positions.get(parentId)?.x)
      .filter((value): value is number => value !== undefined);

    if (parentXs.length === 0) continue;

    const avgParentX = parentXs.reduce((sum, value) => sum + value, 0) / parentXs.length;
    pos.x = pos.x * 0.7 + avgParentX * 0.3;
  }

  // 5. Keep a per-node horizontal anchor so long edges can pull nodes closer
  // without destroying each layer's original spread.
  const anchorXByNode = new Map<string, number>();
  for (const [nodeId, pos] of positions) {
    anchorXByNode.set(nodeId, pos.x);
  }

  // 6. Relax the graph like a constrained spring system. Only X is allowed
  // to move, so node types stay on their original Y layers.
  const SPRING_ITERATIONS = 14;
  for (let iter = 0; iter < SPRING_ITERATIONS; iter++) {
    const deltaXByNode = new Map<string, number>();

    for (const [nodeId, pos] of positions) {
      const anchorX = anchorXByNode.get(nodeId) ?? pos.x;
      const normalizedDistance = Math.min(1, Math.abs(pos.x) / MAX_X);
      const anchorStrength = 0.05 + normalizedDistance * normalizedDistance * 0.1;
      deltaXByNode.set(nodeId, (anchorX - pos.x) * anchorStrength);
    }

    for (const rel of graph.relationships) {
      const sourcePos = positions.get(rel.sourceId);
      const targetPos = positions.get(rel.targetId);
      if (!sourcePos || !targetPos) continue;

      const dx = targetPos.x - sourcePos.x;
      const dy = targetPos.y - sourcePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const restLength = getRestEdgeLength(rel.type, sourcePos, targetPos);
      const stretch = distance - restLength;

      if (stretch <= 0) continue;

      const springWeight = RELATION_SPRING_WEIGHTS[rel.type] ?? 0.14;
      const pull = stretch * springWeight * 0.08;
      const forceX = (dx / distance) * pull;

      deltaXByNode.set(rel.sourceId, (deltaXByNode.get(rel.sourceId) ?? 0) + forceX);
      deltaXByNode.set(rel.targetId, (deltaXByNode.get(rel.targetId) ?? 0) - forceX);
    }

    for (const [nodeId, pos] of positions) {
      const deltaX = deltaXByNode.get(nodeId) ?? 0;
      const normalizedDistance = Math.min(1, Math.abs(pos.x) / MAX_X);
      const edgeResistance = 1 + normalizedDistance * normalizedDistance * 4.5;
      const maxStep = 18 - normalizedDistance * 6;
      const step = clamp(deltaX / edgeResistance, -maxStep, maxStep);
      pos.x = clamp(pos.x + step, -MAX_X, MAX_X);
    }

    for (const layerNodeIds of nodeIdsByLayer) {
      enforceLayerSpacing(layerNodeIds, positions, anchorXByNode);
    }
  }

  // 7. Recenter and softly clamp X so the layout keeps its breadth without
  // drifting too far off-canvas.
  const xValues = Array.from(positions.values()).map((pos) => pos.x);
  if (xValues.length > 0) {
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const centerX = (minX + maxX) / 2;
    const halfSpan = Math.max(1, (maxX - minX) / 2);
    const scale = halfSpan > MAX_X ? MAX_X / halfSpan : 1;

    for (const pos of positions.values()) {
      pos.x = (pos.x - centerX) * scale;
    }
  }

  return positions;
}
