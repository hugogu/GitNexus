import type { GraphRelationship, GraphNode } from 'gitnexus-shared';
import type { KnowledgeGraph } from '../core/graph/types';
import { TREE_HIERARCHY_EDGE_TYPES, type EdgeType, type TreeSortMode } from './constants';
import type { VisibleGraphSnapshot } from './graph-visibility';

export interface TreeViewNode {
  readonly id: string;
  readonly node: GraphNode;
  readonly parentNodeId: string | null;
  readonly childNodeIds: readonly string[];
  readonly depth: number;
  readonly rootId: string;
  readonly inboundVisibleCount: number;
  readonly outboundVisibleCount: number;
  readonly isPromotedRoot: boolean;
}

export interface TreeRootGroup {
  readonly rootNodeId: string;
  readonly descendantNodeIds: readonly string[];
  readonly sortMode: TreeSortMode;
}

export interface TreeCrossLink {
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly relationType: EdgeType;
}

export interface TreeViewModel {
  readonly rootNodeIds: readonly string[];
  readonly nodesById: ReadonlyMap<string, TreeViewNode>;
  readonly rootGroups: readonly TreeRootGroup[];
  readonly crossLinks: readonly TreeCrossLink[];
}

const HIERARCHY_PRIORITY: Record<string, number> = {
  DEFINES: 0,
  CONTAINS: 1,
  IMPORTS: 2,
};

const isTreeHierarchyRelationship = (
  rel: GraphRelationship,
  nodeById: ReadonlyMap<string, GraphNode>,
): boolean => {
  if (rel.type === 'IMPORTS') {
    return nodeById.get(rel.targetId)?.label === 'Import';
  }

  return TREE_HIERARCHY_EDGE_TYPES.includes(rel.type as EdgeType);
};

const getHierarchyParentByChild = (
  relationships: readonly GraphRelationship[],
  nodeIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, GraphNode>,
): Map<string, string> => {
  const parentByChild = new Map<string, string>();
  const hierarchyRels = relationships
    .filter(
      (rel) =>
        isTreeHierarchyRelationship(rel, nodeById) &&
        nodeIds.has(rel.sourceId) &&
        nodeIds.has(rel.targetId),
    )
    .sort((a, b) => (HIERARCHY_PRIORITY[a.type] ?? 99) - (HIERARCHY_PRIORITY[b.type] ?? 99));

  for (const rel of hierarchyRels) {
    if (!parentByChild.has(rel.targetId)) {
      parentByChild.set(rel.targetId, rel.sourceId);
    }
  }

  return parentByChild;
};

const getNonHierarchyDegrees = (
  relationships: readonly GraphRelationship[],
  nodeIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, GraphNode>,
): {
  inbound: Map<string, number>;
  outbound: Map<string, number>;
  crossLinks: TreeCrossLink[];
} => {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const crossLinks: TreeCrossLink[] = [];

  for (const rel of relationships) {
    if (isTreeHierarchyRelationship(rel, nodeById)) continue;
    if (!nodeIds.has(rel.sourceId) || !nodeIds.has(rel.targetId)) continue;

    outbound.set(rel.sourceId, (outbound.get(rel.sourceId) ?? 0) + 1);
    inbound.set(rel.targetId, (inbound.get(rel.targetId) ?? 0) + 1);
    crossLinks.push({
      edgeId: rel.id,
      sourceNodeId: rel.sourceId,
      targetNodeId: rel.targetId,
      relationType: rel.type as EdgeType,
    });
  }

  return { inbound, outbound, crossLinks };
};

const compareTreeNodes = (
  left: GraphNode,
  right: GraphNode,
  sortMode: TreeSortMode,
  inboundCounts: ReadonlyMap<string, number>,
  outboundCounts: ReadonlyMap<string, number>,
): number => {
  if (sortMode === 'inboundDegree') {
    const diff = (inboundCounts.get(right.id) ?? 0) - (inboundCounts.get(left.id) ?? 0);
    if (diff !== 0) return diff;
  } else if (sortMode === 'outboundDegree') {
    const diff = (outboundCounts.get(right.id) ?? 0) - (outboundCounts.get(left.id) ?? 0);
    if (diff !== 0) return diff;
  }

  const byName = left.properties.name.localeCompare(right.properties.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (byName !== 0) return byName;

  return left.id.localeCompare(right.id);
};

const collectDescendants = (
  rootNodeId: string,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): string[] => {
  const out: string[] = [];
  const stack = [rootNodeId];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    out.push(currentId);
    const children = childrenByParent.get(currentId) ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }

  return out;
};

const hasHierarchyParentInFullGraph = (
  nodeId: string,
  graph: KnowledgeGraph | null | undefined,
): boolean => {
  if (!graph) return false;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.relationships.some(
    (rel) => rel.targetId === nodeId && isTreeHierarchyRelationship(rel, nodeById),
  );
};

export const buildTreeViewModel = (
  snapshot: VisibleGraphSnapshot | null,
  sortMode: TreeSortMode,
  fullGraph?: KnowledgeGraph | null,
): TreeViewModel => {
  if (!snapshot) {
    return {
      rootNodeIds: [],
      nodesById: new Map(),
      rootGroups: [],
      crossLinks: [],
    };
  }

  const visibleNodes = snapshot.nodes;
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const parentByChild = getHierarchyParentByChild(snapshot.relationships, visibleNodeIds, nodeById);
  const childrenByParent = new Map<string, string[]>();

  for (const node of visibleNodes) {
    childrenByParent.set(node.id, []);
  }
  for (const [childNodeId, parentNodeId] of parentByChild) {
    if (!childrenByParent.has(parentNodeId)) childrenByParent.set(parentNodeId, []);
    childrenByParent.get(parentNodeId)!.push(childNodeId);
  }

  const { inbound, outbound, crossLinks } = getNonHierarchyDegrees(
    snapshot.relationships,
    visibleNodeIds,
    nodeById,
  );

  const sortNodeIds = (nodeIds: readonly string[]): string[] => {
    return [...nodeIds].sort((leftId, rightId) =>
      compareTreeNodes(nodeById.get(leftId)!, nodeById.get(rightId)!, sortMode, inbound, outbound),
    );
  };

  for (const [parentNodeId, childNodeIds] of childrenByParent.entries()) {
    childrenByParent.set(parentNodeId, sortNodeIds(childNodeIds));
  }

  const rootNodeIds = sortNodeIds(
    visibleNodes.filter((node) => !parentByChild.has(node.id)).map((node) => node.id),
  );

  const nodesById = new Map<string, TreeViewNode>();
  const rootGroups: TreeRootGroup[] = [];

  const visitNode = (nodeId: string, depth: number, rootId: string) => {
    const node = nodeById.get(nodeId);
    if (!node) return;
    nodesById.set(nodeId, {
      id: nodeId,
      node,
      parentNodeId: parentByChild.get(nodeId) ?? null,
      childNodeIds: childrenByParent.get(nodeId) ?? [],
      depth,
      rootId,
      inboundVisibleCount: inbound.get(nodeId) ?? 0,
      outboundVisibleCount: outbound.get(nodeId) ?? 0,
      isPromotedRoot:
        !parentByChild.has(nodeId) && hasHierarchyParentInFullGraph(nodeId, fullGraph ?? null),
    });

    for (const childNodeId of childrenByParent.get(nodeId) ?? []) {
      visitNode(childNodeId, depth + 1, rootId);
    }
  };

  for (const rootNodeId of rootNodeIds) {
    visitNode(rootNodeId, 0, rootNodeId);
    rootGroups.push({
      rootNodeId,
      descendantNodeIds: collectDescendants(rootNodeId, childrenByParent),
      sortMode,
    });
  }

  return {
    rootNodeIds,
    nodesById,
    rootGroups,
    crossLinks,
  };
};
