import type { KnowledgeGraph } from '../core/graph/types';
import type { GraphNode, NodeLabel } from 'gitnexus-shared';
import { NODE_SIZES } from './constants';

export interface CirclesNodePosition {
  x: number;
  y: number;
  size: number;
  /** Logical ring index 0 (innermost) … RING_COUNT-1 (outermost) */
  ring: number;
  /** Angle in radians, stored so the physics can use it as an anchor */
  angle: number;
}

// ---------------------------------------------------------------------------
// Configurable constants
// ---------------------------------------------------------------------------

/** Target radius (px) for each ring.  Ring 0 is innermost. */
export const CIRCLES_RING_RADII = [90, 240, 420, 620] as const;

/** Half-width of the allowed radial band around each ring centre. */
export const CIRCLES_BAND_HALF = 70;

/** Number of rings (= number of layers). */
export const RING_COUNT = CIRCLES_RING_RADII.length; // 4

// ---------------------------------------------------------------------------
// Layer assignment — identical to tree-layout so the same node types
// end up in the same conceptual layer.
// ---------------------------------------------------------------------------

const TYPE_TO_RING: Record<string, number> = {
  // Ring 0 – innermost: structural containers
  Project: 0,
  Package: 0,
  Module: 0,
  Folder: 0,
  Namespace: 0,

  // Ring 1 – files
  File: 1,
  Section: 1,
  Import: 1,
  Route: 1,
  Tool: 1,

  // Ring 2 – type definitions
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

  // Ring 3 – outermost: functions / methods / variables
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

const DEFAULT_RING = 1;

/** Hierarchy edges used for angular-allocation grouping. */
export const CIRCLES_HIERARCHY_RELATIONS = new Set([
  'CONTAINS',
  'DEFINES',
  'HAS_METHOD',
  'HAS_PROPERTY',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getNodeRing(node: GraphNode): number {
  return TYPE_TO_RING[node.label] ?? DEFAULT_RING;
}

function calculateNodeSize(ring: number, nodeType: NodeLabel): number {
  const baseSize = NODE_SIZES[nodeType] || 6;
  const ringMultiplier = Math.max(0.6, 1 - ring * 0.12);
  return baseSize * ringMultiplier;
}

function deterministicHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

function buildHierarchyMaps(graph: KnowledgeGraph) {
  const childrenByParent = new Map<string, string[]>();
  const parentsByChild = new Map<string, string[]>();

  for (const rel of graph.relationships) {
    if (!CIRCLES_HIERARCHY_RELATIONS.has(rel.type)) continue;

    if (!childrenByParent.has(rel.sourceId)) childrenByParent.set(rel.sourceId, []);
    childrenByParent.get(rel.sourceId)!.push(rel.targetId);

    if (!parentsByChild.has(rel.targetId)) parentsByChild.set(rel.targetId, []);
    parentsByChild.get(rel.targetId)!.push(rel.sourceId);
  }

  return { childrenByParent, parentsByChild };
}

// ---------------------------------------------------------------------------
// Proportional angular allocation
//
// Mirrors the proportional X allocation in tree-layout.ts, but in polar space.
// Each parent in ring N is allocated an angular arc proportional to how many
// direct hierarchy children it has in ring N+1.  Children start at evenly
// spaced angles within their parent's arc.  Orphans fill a proportional arc
// at the end (just before 2π).
// ---------------------------------------------------------------------------

function initProportionalAngles(
  graph: KnowledgeGraph,
  parentsByChild: Map<string, string[]>,
): Map<string, CirclesNodePosition> {
  const positions = new Map<string, CirclesNodePosition>();

  // Group nodes by ring
  const nodesByRing: GraphNode[][] = Array.from({ length: RING_COUNT }, () => []);
  const nodeRingMap = new Map<string, number>();

  for (const node of graph.nodes) {
    const ring = getNodeRing(node);
    if (ring >= 0 && ring < RING_COUNT) {
      nodesByRing[ring].push(node);
      nodeRingMap.set(node.id, ring);
    }
  }

  const TWO_PI = Math.PI * 2;

  // --- Ring 0: sort alphabetically, evenly spaced around full circle ---
  const ring0Nodes = [...nodesByRing[0]].sort((a, b) =>
    a.properties.name.localeCompare(b.properties.name),
  );

  if (ring0Nodes.length > 0) {
    const count = ring0Nodes.length;
    for (let i = 0; i < count; i++) {
      const node = ring0Nodes[i];
      const angle = (i / count) * TWO_PI;
      const r = CIRCLES_RING_RADII[0];
      positions.set(node.id, {
        x: r * Math.cos(angle),
        y: r * Math.sin(angle),
        size: calculateNodeSize(0, node.label),
        ring: 0,
        angle,
      });
    }
  }

  // --- Rings 1-3: proportional angular slices from parents ---
  for (let ring = 1; ring < RING_COUNT; ring++) {
    const ringNodes = nodesByRing[ring];
    if (ringNodes.length === 0) continue;

    const r = CIRCLES_RING_RADII[ring];

    // Find each node's primary parent: placed ancestor with highest ring index.
    const assignedParent = new Map<string, string>();
    for (const node of ringNodes) {
      const parents = parentsByChild.get(node.id) ?? [];
      let bestParent: string | null = null;
      let bestParentRing = -1;
      for (const p of parents) {
        if (!positions.has(p)) continue;
        const pRing = nodeRingMap.get(p) ?? -1;
        if (pRing > bestParentRing) {
          bestParentRing = pRing;
          bestParent = p;
        }
      }
      if (bestParent) assignedParent.set(node.id, bestParent);
    }

    // Bucket into parent groups and orphans
    const childrenOfParent = new Map<string, GraphNode[]>();
    const orphans: GraphNode[] = [];

    for (const node of ringNodes) {
      const p = assignedParent.get(node.id);
      if (!p) {
        orphans.push(node);
      } else {
        if (!childrenOfParent.has(p)) childrenOfParent.set(p, []);
        childrenOfParent.get(p)!.push(node);
      }
    }

    for (const children of childrenOfParent.values()) {
      children.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    }
    orphans.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

    // Sort active parents by their own angle
    const activeParents = [...childrenOfParent.keys()].sort((a, b) => {
      const aAngle = positions.get(a)?.angle ?? 0;
      const bAngle = positions.get(b)?.angle ?? 0;
      return aAngle - bAngle;
    });

    const totalParented = ringNodes.length - orphans.length;
    const parentedArc = totalParented > 0 ? TWO_PI * (totalParented / ringNodes.length) : 0;
    const orphanArc = TWO_PI - parentedArc;

    let curAngle = 0; // Start at angle 0; wrap modulo 2π

    // Place each parent's children in a sub-arc proportional to child count
    for (const parentId of activeParents) {
      const children = childrenOfParent.get(parentId) ?? [];
      if (children.length === 0) continue;

      const slotArc = (children.length / totalParented) * parentedArc;
      const childSpacing = slotArc / children.length;

      for (let i = 0; i < children.length; i++) {
        const angle = curAngle + (i + 0.5) * childSpacing;
        positions.set(children[i].id, {
          x: r * Math.cos(angle),
          y: r * Math.sin(angle),
          size: calculateNodeSize(ring, children[i].label),
          ring,
          angle,
        });
      }
      curAngle += slotArc;
    }

    // Orphans fill the remaining arc
    if (orphans.length > 0 && orphanArc > 0) {
      const orphanSpacing = orphanArc / orphans.length;
      for (let i = 0; i < orphans.length; i++) {
        const angle = curAngle + (i + 0.5) * orphanSpacing;
        positions.set(orphans[i].id, {
          x: r * Math.cos(angle),
          y: r * Math.sin(angle),
          size: calculateNodeSize(ring, orphans[i].label),
          ring,
          angle,
        });
      }
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Circles view layout: concentric rings with proportional angular allocation.
 *
 * Ring 0 (innermost) = Folders/Packages
 * Ring 1             = Files
 * Ring 2             = Classes/Interfaces
 * Ring 3 (outermost) = Functions/Methods/Variables
 *
 * Returns initial positions; the physics simulation in useSigma.ts refines
 * them using radial gravity, angular spread, and 2D repulsion.
 */
export function calculateCirclesLayout(graph: KnowledgeGraph): Map<string, CirclesNodePosition> {
  const { parentsByChild } = buildHierarchyMaps(graph);

  // 1. Proportional angular allocation
  const positions = initProportionalAngles(graph, parentsByChild);

  // 2. Subtle radial jitter only — angular jitter would scramble hierarchy ordering
  for (const [nodeId, pos] of positions) {
    const jitter = (deterministicHash(nodeId + 'r') - 0.5) * 18;
    const r = CIRCLES_RING_RADII[pos.ring];
    const newR = r + jitter;
    pos.x = newR * Math.cos(pos.angle);
    pos.y = newR * Math.sin(pos.angle);
  }

  // 3. Structure iterations: align children angularly with their parent
  const STRUCTURE_ITERATIONS = 5;
  for (let iter = 0; iter < STRUCTURE_ITERATIONS; iter++) {
    const nodeRingMap = new Map<string, number>();
    for (const [id, pos] of positions) nodeRingMap.set(id, pos.ring);

    for (const [nodeId, pos] of positions) {
      const r = CIRCLES_RING_RADII[pos.ring] || CIRCLES_RING_RADII[RING_COUNT - 1];
      // Re-derive angle from x/y so accumulated adjustments propagate
      const currentAngle = Math.atan2(pos.y, pos.x);

      // Gently pull toward parent's angular sector
      const parents = parentsByChild.get(nodeId) ?? [];
      if (parents.length === 0) continue;

      const parentAngles = parents
        .map((p) => positions.get(p))
        .filter((p): p is CirclesNodePosition => !!p)
        .map((p) => Math.atan2(p.y, p.x));

      if (parentAngles.length === 0) continue;

      // Circular mean of parent angles
      const sinSum = parentAngles.reduce((s, a) => s + Math.sin(a), 0);
      const cosSum = parentAngles.reduce((c, a) => c + Math.cos(a), 0);
      const targetAngle = Math.atan2(sinSum, cosSum);

      // Blend current toward target (weak pull, structure iterations handle the rest)
      let dAngle = targetAngle - currentAngle;
      // Normalize to [-π, π]
      while (dAngle > Math.PI) dAngle -= Math.PI * 2;
      while (dAngle < -Math.PI) dAngle += Math.PI * 2;

      const blendedAngle = currentAngle + dAngle * 0.3;
      pos.x = r * Math.cos(blendedAngle);
      pos.y = r * Math.sin(blendedAngle);
      pos.angle = blendedAngle;
    }
  }

  return positions;
}
