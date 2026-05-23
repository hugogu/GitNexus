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

export function calculateTreeLayout(
  graph: KnowledgeGraph,
  sortMode: 'alphabetical' | 'degree',
): Map<string, TreeNodePosition> {
  const positions = new Map<string, TreeNodePosition>();
  const degrees = calculateDegrees(graph);

  // 1. Group nodes by layer
  const nodesByLayer: GraphNode[][] = [[], [], [], []];

  for (const node of graph.nodes) {
    const layer = TYPE_TO_LAYER[node.label] ?? DEFAULT_LAYER;
    if (layer >= 0 && layer < LAYER_COUNT) {
      nodesByLayer[layer].push(node);
    }
  }

  // 2. Sort each layer
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

  // 3. Position nodes in a grid within each layer
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

      // X: centered
      const x = -availableWidth / 2 + (col + 0.5) * gapX;

      // Y: within layer, vertically centered
      const y = layerBaseY + verticalOffset + (row + 0.5) * gapY;

      const size = calculateNodeSize(layer, node.label);

      positions.set(node.id, { x, y, size, depth: layer });
    }
  }

  // 4. Center entire layout vertically
  if (positions.size > 0) {
    const centerY = CANVAS_HEIGHT / 2;
    for (const pos of positions.values()) {
      pos.y -= centerY;
    }
  }

  return positions;
}
