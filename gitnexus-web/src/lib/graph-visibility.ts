import type { GraphNode, GraphRelationship, NodeLabel } from 'gitnexus-shared';
import type { KnowledgeGraph } from '../core/graph/types';
import type { EdgeType } from './constants';

export interface VisibleGraphSnapshot {
  readonly nodes: GraphNode[];
  readonly relationships: GraphRelationship[];
  readonly visibleNodeIds: ReadonlySet<string>;
  readonly visibleEdgeIds: ReadonlySet<string>;
  readonly nodeById: ReadonlyMap<string, GraphNode>;
}

const getAdjacentNodeIds = (graph: KnowledgeGraph): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();

  const addNeighbor = (sourceId: string, targetId: string) => {
    if (!adjacency.has(sourceId)) adjacency.set(sourceId, new Set<string>());
    adjacency.get(sourceId)!.add(targetId);
  };

  for (const rel of graph.relationships) {
    addNeighbor(rel.sourceId, rel.targetId);
    addNeighbor(rel.targetId, rel.sourceId);
  }

  return adjacency;
};

export const getNodesWithinHops = (
  graph: KnowledgeGraph,
  startNodeId: string,
  maxHops: number,
): Set<string> => {
  const adjacency = getAdjacentNodeIds(graph);
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);

    if (current.depth >= maxHops) continue;

    for (const neighborId of adjacency.get(current.nodeId) ?? []) {
      if (!visited.has(neighborId)) {
        queue.push({ nodeId: neighborId, depth: current.depth + 1 });
      }
    }
  }

  return visited;
};

export const getVisibleNodeIds = (
  graph: KnowledgeGraph,
  visibleLabels: readonly NodeLabel[],
  selectedNodeId: string | null,
  maxHops: number | null,
): Set<string> => {
  const visibleLabelSet = new Set(visibleLabels);
  const nodesInRange =
    maxHops !== null && selectedNodeId && graph.nodes.some((node) => node.id === selectedNodeId)
      ? getNodesWithinHops(graph, selectedNodeId, maxHops)
      : null;

  const visibleNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!visibleLabelSet.has(node.label)) continue;
    if (nodesInRange && !nodesInRange.has(node.id)) continue;
    visibleNodeIds.add(node.id);
  }

  return visibleNodeIds;
};

export const getVisibleGraphSnapshot = (
  graph: KnowledgeGraph | null,
  visibleLabels: readonly NodeLabel[],
  visibleEdgeTypes: readonly EdgeType[],
  selectedNodeId: string | null,
  maxHops: number | null,
): VisibleGraphSnapshot | null => {
  if (!graph) return null;

  const visibleNodeIds = getVisibleNodeIds(graph, visibleLabels, selectedNodeId, maxHops);
  const visibleEdgeTypeSet = new Set(visibleEdgeTypes);

  const nodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const relationships = graph.relationships.filter((rel) => {
    if (!visibleNodeIds.has(rel.sourceId) || !visibleNodeIds.has(rel.targetId)) return false;
    return visibleEdgeTypeSet.has(rel.type as EdgeType);
  });

  return {
    nodes,
    relationships,
    visibleNodeIds,
    visibleEdgeIds: new Set(relationships.map((rel) => rel.id)),
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
};
