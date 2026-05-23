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

/** Base Y coordinate for each layer. */
const LAYER_Y_BASE = [0, 220, 440, 660];

/** Max vertical jitter within a layer. */
const LAYER_JITTER = 80;

/** Minimum horizontal spacing between nodes. */
const MIN_NODE_SPACING = 70;

/** Target width for the widest layer. */
const TARGET_LAYER_WIDTH = 2800;

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
    if (layer >= 0 && layer < 4) {
      nodesByLayer[layer].push(node);
    }
  }

  // 2. Sort each layer
  for (let layer = 0; layer < 4; layer++) {
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

  // 3. Calculate layer width based on node count
  const maxNodes = Math.max(1, ...nodesByLayer.map((l) => l.length));
  const layerWidth = Math.max(maxNodes * MIN_NODE_SPACING, TARGET_LAYER_WIDTH);

  // 4. Position nodes
  for (let layer = 0; layer < 4; layer++) {
    const nodes = nodesByLayer[layer];
    if (nodes.length === 0) continue;

    const spacing = layerWidth / (nodes.length + 1);

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const hash = deterministicHash(node.id);

      // X: evenly distributed across the layer width
      const x = -layerWidth / 2 + (i + 1) * spacing;

      // Y: base layer Y + deterministic jitter
      const y = LAYER_Y_BASE[layer] + (hash - 0.5) * LAYER_JITTER;

      const size = calculateNodeSize(layer, node.label);

      positions.set(node.id, { x, y, size, depth: layer });
    }
  }

  return positions;
}
