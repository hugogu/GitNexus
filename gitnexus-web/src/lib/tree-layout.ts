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

  // Layer 3: Functions / Methods
  Function: 3,
  Method: 3,
  Impl: 3,
  Delegate: 3,
  Constructor: 3,
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

function calculateNodeSize(layer: number, nodeType: NodeLabel): number {
  const baseSize = NODE_SIZES[nodeType] || 6;
  const layerMultiplier = Math.max(0.6, 1 - layer * 0.12);
  return baseSize * layerMultiplier;
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

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  layer: number;
  size: number;
  degree: number;
  label: NodeLabel;
}

function getNodeLayer(node: GraphNode): number {
  return TYPE_TO_LAYER[node.label] ?? DEFAULT_LAYER;
}

/**
 * Initialize positions using grid layout (used by alphabetical/degree and as auto seed).
 */
function initGridPositions(
  graph: KnowledgeGraph,
  sortMode: 'alphabetical' | 'degree',
): Map<string, TreeNodePosition> {
  const positions = new Map<string, TreeNodePosition>();
  const degrees = calculateDegrees(graph);

  const nodesByLayer: GraphNode[][] = [[], [], [], []];
  for (const node of graph.nodes) {
    const layer = getNodeLayer(node);
    if (layer >= 0 && layer < LAYER_COUNT) {
      nodesByLayer[layer].push(node);
    }
  }

  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    nodesByLayer[layer].sort((a, b) => {
      if (sortMode === 'alphabetical') {
        return a.properties.name.localeCompare(b.properties.name);
      }
      const degA = degrees.get(a.id) || 0;
      const degB = degrees.get(b.id) || 0;
      if (degA !== degB) return degB - degA;
      return a.properties.name.localeCompare(b.properties.name);
    });
  }

  const availableWidth = CANVAS_WIDTH - PADDING_X * 2;
  const availableHeight = LAYER_HEIGHT - PADDING_Y * 2;

  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const nodes = nodesByLayer[layer];
    if (nodes.length === 0) continue;

    const { cols, rows, gapX, gapY } = calculateGrid(nodes.length, availableWidth, availableHeight);

    const layerBaseY = layer * LAYER_HEIGHT + PADDING_Y;
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
 * Auto layout: grid-based with organic jitter and edge-aware clustering.
 * Keeps the full width of the grid layout while adding organic feel.
 */
export function calculateAutoLayout(graph: KnowledgeGraph): Map<string, TreeNodePosition> {
  // 1. Start with grid layout (provides good X distribution)
  const positions = initGridPositions(graph, 'alphabetical');

  // 2. Add organic jitter to avoid rigid grid appearance
  for (const [nodeId, pos] of positions) {
    const jitterX = (deterministicHash(nodeId) - 0.5) * 35;
    const jitterY = (deterministicHash(nodeId + 'y') - 0.5) * 25;
    pos.x += jitterX;
    pos.y += jitterY;
  }

  // 3. Build adjacency list for connected nodes (non-hierarchy only)
  const adjacencies = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacencies.set(node.id, []);
  }
  for (const rel of graph.relationships) {
    if (rel.type !== 'CONTAINS' && rel.type !== 'DEFINES') {
      if (adjacencies.has(rel.sourceId) && adjacencies.has(rel.targetId)) {
        adjacencies.get(rel.sourceId)!.push(rel.targetId);
        adjacencies.get(rel.targetId)!.push(rel.sourceId);
      }
    }
  }

  // 4. Pull connected nodes closer in X direction (only within same or adjacent layers)
  // This creates clusters without collapsing the overall width
  const ITERATIONS = 8;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const [nodeId, neighbors] of adjacencies) {
      const pos = positions.get(nodeId);
      if (!pos || neighbors.length === 0) continue;

      let avgNeighborX = 0;
      let count = 0;

      for (const neighborId of neighbors) {
        const neighborPos = positions.get(neighborId);
        if (neighborPos && Math.abs(neighborPos.depth - pos.depth) <= 1) {
          avgNeighborX += neighborPos.x;
          count++;
        }
      }

      if (count > 0) {
        avgNeighborX /= count;
        // Gentle pull towards connected neighbors
        const pullStrength = 0.08;
        pos.x = pos.x * (1 - pullStrength) + avgNeighborX * pullStrength;
      }
    }
  }

  // 5. Apply repulsion to prevent overlap (lightweight, only when needed)
  for (const [idA, posA] of positions) {
    for (const [idB, posB] of positions) {
      if (idA >= idB) continue;
      if (posA.depth !== posB.depth) continue; // Only within same layer

      const dx = posB.x - posA.x;
      const dy = posB.y - posB.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minDist = (posA.size + posB.size) * 2.2;

      if (dist < minDist) {
        const push = ((minDist - dist) / dist) * 3;
        const pushX = (dx / dist) * push;
        const pushY = (dy / dist) * push;

        posA.x -= pushX;
        posA.y -= pushY;
        posB.x += pushX;
        posB.y += pushY;
      }
    }
  }

  return positions;
}

export function calculateTreeLayout(
  graph: KnowledgeGraph,
  sortMode: 'alphabetical' | 'degree' | 'auto',
): Map<string, TreeNodePosition> {
  if (sortMode === 'auto') {
    return calculateAutoLayout(graph);
  }

  return initGridPositions(graph, sortMode);
}
