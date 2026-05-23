import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronRight, Folder, GitBranch, Layers } from '@/lib/lucide-icons';
import { useAppState } from '../hooks/useAppState';
import { EDGE_INFO, NODE_COLORS, NODE_SIZES } from '../lib/constants';
import { getVisibleGraphSnapshot } from '../lib/graph-visibility';
import { buildTreeViewModel } from '../lib/tree-view-model';

const LEFT_GUTTER = 72;
const TOP_GUTTER = 84;
const LEVEL_GAP = 132;
const SIBLING_GAP = 172;
const ROOT_GAP_SLOTS = 1;
const NODE_LABEL_OFFSET = 20;

export interface TreeCanvasHandle {
  focusNode: (nodeId: string) => void;
}

interface PositionedTreeNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface RenderedTreeEdge {
  readonly edgeId: string;
  readonly d: string;
}

interface RenderedCrossLink {
  readonly edgeId: string;
  readonly d: string;
  readonly color: string;
  readonly relationLabel: string;
}

interface TreeLayoutModel {
  readonly visibleNodeIds: readonly string[];
  readonly nodePositions: ReadonlyMap<string, PositionedTreeNode>;
  readonly hierarchyEdges: readonly RenderedTreeEdge[];
  readonly crossLinks: readonly RenderedCrossLink[];
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

const getTreeNodeRadius = (label: keyof typeof NODE_SIZES): number => {
  const baseSize = NODE_SIZES[label] ?? 4;
  return Math.max(5, Math.min(16, baseSize * 0.95));
};

const getHierarchyPath = (source: PositionedTreeNode, target: PositionedTreeNode): string => {
  const midY = source.y + (target.y - source.y) * 0.5;
  return `M ${source.x} ${source.y} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`;
};

const getCrossLinkPath = (source: PositionedTreeNode, target: PositionedTreeNode): string => {
  const deltaY = Math.abs(target.y - source.y);
  const controlOffset = Math.max(54, deltaY * 0.4);
  return `M ${source.x} ${source.y} C ${source.x} ${source.y + controlOffset}, ${target.x} ${target.y - controlOffset}, ${target.x} ${target.y}`;
};

export const TreeCanvas = forwardRef<TreeCanvasHandle>((_, ref) => {
  const {
    graph,
    visibleLabels,
    visibleEdgeTypes,
    selectedNode,
    setSelectedNode,
    openCodePanel,
    depthFilter,
    treeSortMode,
  } = useAppState();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeElementRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  const visibleSnapshot = useMemo(
    () =>
      getVisibleGraphSnapshot(
        graph,
        visibleLabels,
        visibleEdgeTypes,
        selectedNode?.id ?? null,
        depthFilter,
      ),
    [graph, visibleLabels, visibleEdgeTypes, selectedNode?.id, depthFilter],
  );

  const treeModel = useMemo(
    () => buildTreeViewModel(visibleSnapshot, treeSortMode, graph),
    [visibleSnapshot, treeSortMode, graph],
  );

  const ensureExpandedToNode = useCallback(
    (nodeId: string) => {
      if (!treeModel.nodesById.has(nodeId)) return;

      setExpandedNodeIds((prev) => {
        const next = new Set(prev);
        let currentNodeId: string | null = nodeId;

        while (currentNodeId) {
          const currentNode = treeModel.nodesById.get(currentNodeId);
          if (!currentNode) break;
          if (currentNode.childNodeIds.length > 0) {
            next.add(currentNodeId);
          }
          currentNodeId = currentNode.parentNodeId;
        }

        return next;
      });
    },
    [treeModel.nodesById],
  );

  useEffect(() => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);

      for (const rootNodeId of treeModel.rootNodeIds) {
        next.add(rootNodeId);
      }

      for (const treeNode of treeModel.nodesById.values()) {
        if (treeNode.depth < 1 && treeNode.childNodeIds.length > 0) {
          next.add(treeNode.id);
        }
      }

      return next;
    });
  }, [treeModel.rootNodeIds, treeModel.nodesById]);

  useEffect(() => {
    if (!selectedNode) return;
    ensureExpandedToNode(selectedNode.id);
  }, [ensureExpandedToNode, selectedNode]);

  const focusTreeNode = useCallback(
    (nodeId: string) => {
      if (!treeModel.nodesById.has(nodeId)) return;

      ensureExpandedToNode(nodeId);
      requestAnimationFrame(() => {
        nodeElementRefs.current.get(nodeId)?.scrollIntoView({
          block: 'center',
          inline: 'center',
          behavior: 'smooth',
        });
      });
    },
    [ensureExpandedToNode, treeModel.nodesById],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusNode: focusTreeNode,
    }),
    [focusTreeNode],
  );

  useEffect(() => {
    if (!selectedNode) return;
    if (!treeModel.nodesById.has(selectedNode.id)) return;

    const frameId = requestAnimationFrame(() => {
      nodeElementRefs.current.get(selectedNode.id)?.scrollIntoView({
        block: 'center',
        inline: 'center',
        behavior: 'smooth',
      });
    });

    return () => cancelAnimationFrame(frameId);
  }, [selectedNode, treeModel.nodesById]);

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const layout = useMemo<TreeLayoutModel>(() => {
    const nodePositions = new Map<string, PositionedTreeNode>();
    const hierarchyEdges: RenderedTreeEdge[] = [];
    const visibleNodeIds: string[] = [];
    let maxDepth = 0;
    let maxLeafIndex = 0;

    const getVisibleChildren = (nodeId: string): readonly string[] => {
      if (!expandedNodeIds.has(nodeId)) return [];
      return treeModel.nodesById.get(nodeId)?.childNodeIds ?? [];
    };

    const measureLeafWidth = (nodeId: string): number => {
      const children = getVisibleChildren(nodeId);
      if (children.length === 0) return 1;
      return children.reduce((sum, childNodeId) => sum + measureLeafWidth(childNodeId), 0);
    };

    const placeNode = (
      nodeId: string,
      depth: number,
      leftLeafIndex: number,
    ): { width: number; centerLeafIndex: number } => {
      const treeNode = treeModel.nodesById.get(nodeId);
      if (!treeNode) return { width: 1, centerLeafIndex: leftLeafIndex };

      const children = getVisibleChildren(nodeId);
      let width = 1;
      let centerLeafIndex = leftLeafIndex;

      if (children.length > 0) {
        let childCursor = leftLeafIndex;
        const childCenters: number[] = [];
        width = 0;

        for (const childNodeId of children) {
          const childLayout = placeNode(childNodeId, depth + 1, childCursor);
          childCenters.push(childLayout.centerLeafIndex);
          childCursor += childLayout.width;
          width += childLayout.width;
        }

        centerLeafIndex = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      }

      const x = LEFT_GUTTER + centerLeafIndex * SIBLING_GAP;
      const y = TOP_GUTTER + depth * LEVEL_GAP;
      const radius = getTreeNodeRadius(treeNode.node.label);

      nodePositions.set(nodeId, { id: nodeId, x, y, radius });
      visibleNodeIds.push(nodeId);
      maxDepth = Math.max(maxDepth, depth);
      maxLeafIndex = Math.max(maxLeafIndex, leftLeafIndex + width - 1);

      return { width, centerLeafIndex };
    };

    let leafCursor = 0;
    treeModel.rootNodeIds.forEach((rootNodeId, index) => {
      if (index > 0) {
        leafCursor += ROOT_GAP_SLOTS;
      }
      const rootLayout = placeNode(rootNodeId, 0, leafCursor);
      leafCursor += rootLayout.width;
    });

    for (const nodeId of visibleNodeIds) {
      const treeNode = treeModel.nodesById.get(nodeId);
      const source = nodePositions.get(nodeId);
      if (!treeNode || !source) continue;

      for (const childNodeId of treeNode.childNodeIds) {
        const target = nodePositions.get(childNodeId);
        if (!target) continue;
        hierarchyEdges.push({
          edgeId: `${nodeId}->${childNodeId}`,
          d: getHierarchyPath(source, target),
        });
      }
    }

    const crossLinks = treeModel.crossLinks
      .map((crossLink) => {
        const source = nodePositions.get(crossLink.sourceNodeId);
        const target = nodePositions.get(crossLink.targetNodeId);
        if (!source || !target) return null;

        return {
          edgeId: crossLink.edgeId,
          d: getCrossLinkPath(source, target),
          color: EDGE_INFO[crossLink.relationType].color,
          relationLabel: EDGE_INFO[crossLink.relationType].label,
        };
      })
      .filter((link): link is RenderedCrossLink => link !== null);

    return {
      visibleNodeIds,
      nodePositions,
      hierarchyEdges,
      crossLinks,
      canvasWidth: Math.max(720, LEFT_GUTTER + (maxLeafIndex + 1) * SIBLING_GAP + 240),
      canvasHeight: Math.max(420, TOP_GUTTER + (maxDepth + 1) * LEVEL_GAP + 160),
    };
  }, [expandedNodeIds, treeModel.crossLinks, treeModel.nodesById, treeModel.rootNodeIds]);

  const registerNodeElement = useCallback(
    (nodeId: string) => (element: HTMLButtonElement | null) => {
      if (element) {
        nodeElementRefs.current.set(nodeId, element);
      } else {
        nodeElementRefs.current.delete(nodeId);
      }
    },
    [],
  );

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      const treeNode = treeModel.nodesById.get(nodeId);
      if (!treeNode) return;
      setSelectedNode(treeNode.node);
      openCodePanel();
    },
    [openCodePanel, setSelectedNode, treeModel.nodesById],
  );

  if (!graph) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-auto bg-void">
        <div className="flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-border-subtle bg-elevated/60 px-6 py-8 text-center backdrop-blur-sm">
          <Layers className="h-8 w-8 text-accent" />
          <div>
            <p className="text-sm font-medium text-text-primary">Tree view is ready</p>
            <p className="mt-1 text-xs text-text-muted">
              Load a repository to explore its structure as a hierarchy graph.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (treeModel.rootNodeIds.length === 0) {
    return (
      <div
        ref={containerRef}
        data-testid="tree-canvas"
        className="relative flex h-full w-full items-center justify-center overflow-auto bg-void"
      >
        <div className="flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-border-subtle bg-elevated/60 px-6 py-8 text-center backdrop-blur-sm">
          <Layers className="h-8 w-8 text-accent" />
          <div>
            <p className="text-sm font-medium text-text-primary">No tree nodes are visible</p>
            <p className="mt-1 text-xs text-text-muted">
              Adjust node filters or focus depth to bring the current visible graph nodes back into
              view.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="tree-canvas"
      className="relative h-full w-full overflow-auto bg-void"
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.03) 0%, transparent 70%), linear-gradient(to bottom, #06060a, #0a0a10)',
          }}
        />
      </div>

      <div className="sticky top-0 z-20 border-b border-border-subtle bg-void/90 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface/80 px-3 py-1.5 text-xs text-text-secondary">
            <Layers className="h-3.5 w-3.5 text-accent" />
            <span>{treeModel.rootNodeIds.length} roots</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface/80 px-3 py-1.5 text-xs text-text-secondary">
            <Folder className="h-3.5 w-3.5 text-accent" />
            <span>{layout.visibleNodeIds.length} visible nodes</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface/80 px-3 py-1.5 text-xs text-text-secondary">
            <GitBranch className="h-3.5 w-3.5 text-accent" />
            <span>{layout.crossLinks.length} dashed links</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface/80 px-3 py-1.5 text-xs text-text-secondary">
            <span>Sort: {treeSortMode}</span>
          </div>
        </div>
      </div>

      <div
        className="relative"
        style={{ width: `${layout.canvasWidth}px`, height: `${layout.canvasHeight}px` }}
      >
        <svg
          className="absolute inset-0"
          width={layout.canvasWidth}
          height={layout.canvasHeight}
          viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
          aria-hidden="true"
        >
          {layout.hierarchyEdges.map((edge) => (
            <path
              key={edge.edgeId}
              d={edge.d}
              stroke="rgba(148, 163, 184, 0.42)"
              strokeWidth={1.5}
              fill="none"
            />
          ))}

          {layout.crossLinks.map((crossLink) => (
            <path
              key={crossLink.edgeId}
              d={crossLink.d}
              stroke={crossLink.color}
              strokeWidth={2}
              strokeDasharray="6 6"
              fill="none"
              opacity={0.82}
            >
              <title>{crossLink.relationLabel}</title>
            </path>
          ))}
        </svg>

        {layout.visibleNodeIds.map((nodeId) => {
          const treeNode = treeModel.nodesById.get(nodeId);
          const position = layout.nodePositions.get(nodeId);
          if (!treeNode || !position) return null;

          const hasChildren = treeNode.childNodeIds.length > 0;
          const isExpanded = expandedNodeIds.has(nodeId);
          const isSelected = selectedNode?.id === nodeId;

          return (
            <div
              key={nodeId}
              className="absolute"
              style={{
                left: `${position.x - 32}px`,
                top: `${position.y - 14}px`,
              }}
            >
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button
                    type="button"
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${treeNode.node.properties.name}`}
                    onClick={() => toggleExpanded(nodeId)}
                    className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="block h-5 w-5" />
                )}

                <button
                  ref={registerNodeElement(nodeId)}
                  type="button"
                  data-testid={`tree-node-${nodeId}`}
                  aria-pressed={isSelected}
                  onClick={() => handleNodeSelect(nodeId)}
                  className="group flex items-center gap-3 text-left"
                >
                  <span
                    className={`relative block rounded-full border transition-all ${
                      isSelected
                        ? 'scale-115 shadow-[0_0_0_5px_rgba(99,102,241,0.16)]'
                        : 'group-hover:scale-110'
                    }`}
                    style={{
                      width: `${position.radius * 2}px`,
                      height: `${position.radius * 2}px`,
                      backgroundColor: NODE_COLORS[treeNode.node.label],
                      borderColor: isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)',
                      boxShadow: isSelected
                        ? `0 0 0 2px ${NODE_COLORS[treeNode.node.label]}`
                        : undefined,
                    }}
                  />

                  <span className="min-w-0">
                    <span
                      className={`block truncate font-mono text-sm ${
                        isSelected
                          ? 'text-text-primary'
                          : 'text-text-secondary group-hover:text-text-primary'
                      }`}
                      style={{
                        maxWidth: `${Math.max(220, layout.canvasWidth - position.x - NODE_LABEL_OFFSET - 48)}px`,
                      }}
                    >
                      {treeNode.node.properties.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-text-muted">
                      {treeNode.node.label}
                      {treeNode.isPromotedRoot ? ' · promoted root' : ''}
                      {` · in ${treeNode.inboundVisibleCount} · out ${treeNode.outboundVisibleCount}`}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

TreeCanvas.displayName = 'TreeCanvas';
