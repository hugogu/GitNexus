import { useRef, useEffect, useCallback, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import EdgeCurveProgram from '@sigma/edge-curve';
import { SigmaNodeAttributes, SigmaEdgeAttributes } from '../lib/graph-adapter';
import type { NodeAnimation } from './useAppState';
import type { EdgeType } from '../lib/constants';
// Helper: Parse hex color to RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 100, g: 100, b: 100 };
};

// Helper: RGB to hex
const rgbToHex = (r: number, g: number, b: number): string => {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
};

// Dim a color by mixing with dark background (keeps color hint)
const dimColor = (hex: string, amount: number): string => {
  const rgb = hexToRgb(hex);
  const darkBg = { r: 18, g: 18, b: 28 }; // #12121c - dark background
  return rgbToHex(
    darkBg.r + (rgb.r - darkBg.r) * amount,
    darkBg.g + (rgb.g - darkBg.g) * amount,
    darkBg.b + (rgb.b - darkBg.b) * amount,
  );
};

// Brighten a color (increase luminosity)
const brightenColor = (hex: string, factor: number): string => {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + ((255 - rgb.r) * (factor - 1)) / factor,
    rgb.g + ((255 - rgb.g) * (factor - 1)) / factor,
    rgb.b + ((255 - rgb.b) * (factor - 1)) / factor,
  );
};

interface UseSigmaOptions {
  onNodeClick?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onStageClick?: () => void;
  highlightedNodeIds?: Set<string>;
  blastRadiusNodeIds?: Set<string>;
  animatedNodes?: Map<string, NodeAnimation>;
  visibleEdgeTypes?: EdgeType[];
  layoutMode?: 'force' | 'tree' | 'circles';
}

interface UseSigmaReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sigmaRef: React.RefObject<Sigma | null>;
  setGraph: (graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  focusNode: (nodeId: string) => void;
  isLayoutRunning: boolean;
  startLayout: () => void;
  stopLayout: () => void;
  selectedNode: string | null;
  setSelectedNode: (nodeId: string | null) => void;
  refreshHighlights: () => void;
}

// Noverlap for final cleanup - minimal since it starts with good positions
const NOVERLAP_SETTINGS = {
  maxIterations: 20, // Reduced - less cleanup needed
  ratio: 1.1,
  margin: 10,
  expansion: 1.05,
};

// ForceAtlas2 settings - FAST convergence since nodes start near their parents
const getFA2Settings = (nodeCount: number) => {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2000;
  const isLarge = nodeCount >= 2000 && nodeCount < 10000;

  return {
    // Lower gravity allows folders to stay spread out
    gravity: isSmall ? 0.8 : isMedium ? 0.5 : isLarge ? 0.3 : 0.15,

    // Higher scaling ratio = more spread out overall
    scalingRatio: isSmall ? 15 : isMedium ? 30 : isLarge ? 60 : 100,

    // LOW slowDown = FASTER movement (converges quicker)
    slowDown: isSmall ? 1 : isMedium ? 2 : isLarge ? 3 : 5,

    // Barnes-Hut for performance - use it even on smaller graphs
    barnesHutOptimize: nodeCount > 200,
    barnesHutTheta: isLarge ? 0.8 : 0.6, // Higher = faster but less accurate

    // These help with clustering while keeping spread
    strongGravityMode: false,
    outboundAttractionDistribution: true,
    linLogMode: false,
    adjustSizes: true,
    edgeWeightInfluence: 1,
  };
};

// Layout duration - let it run longer for better results
// Web Worker + WebGL means minimal system impact
const getLayoutDuration = (nodeCount: number): number => {
  if (nodeCount > 10000) return 45000; // 45s for huge graphs
  if (nodeCount > 5000) return 35000; // 35s
  if (nodeCount > 2000) return 30000; // 30s
  if (nodeCount > 1000) return 30000; // 30s
  if (nodeCount > 500) return 25000; // 25s
  return 20000; // 20s for small graphs
};

const TREE_MAX_X = 540;
const TREE_REPULSION_RANGE = 130;
const TREE_LAYOUT_MAX_DURATION = 18000;
const TREE_LAYOUT_STABILITY_FRAMES = 24;
const TREE_TARGET_FRAME_MS = 32;
const TREE_LAYOUT_MIN_DURATION = 1500;
const TREE_FORCE_DEADZONE = 0.005;
const TREE_VELOCITY_DEADZONE = 0.01;
// Y is free within each layer's band; gravity + boundary resistance keep layers separate.
// Band half kept at 55px so nodes don't drift far past the initial camera-fit viewport.
const TREE_LAYER_GRAVITY = 0.06; // stronger gravity keeps nodes near their layer center
const TREE_LAYER_BAND_HALF = 55; // ±55px from layer center Y
const TREE_LAYER_BOUNDARY_RESISTANCE = 10; // progressive resistance near band edges
// Spread force: fine-tune density within each layer during physics.
// Kept deliberately weak (0.003) because the initial proportional layout already
// distributes nodes near their ideal positions — aggressive spread would fight
// the hierarchy springs and push edge-parented children away from their parents.
const TREE_SPREAD_STRENGTH = 0.003;

// ---------------------------------------------------------------------------
// Circles View constants
// ---------------------------------------------------------------------------

/** Target radius for each ring — must match CIRCLES_RING_RADII in circles-layout.ts */
const CIRCLES_RING_RADII = [90, 240, 420, 620] as const;
const CIRCLES_RING_COUNT = CIRCLES_RING_RADII.length;

/** Half-width of the allowed radial band around each ring centre. */
const CIRCLES_BAND_HALF = 70;

/** How strongly nodes are pulled back toward their target ring radius. */
const CIRCLES_RADIAL_GRAVITY = 0.06;

/**
 * Progressive resistance as a node drifts outside its ring band.
 * Mirrors TREE_LAYER_BOUNDARY_RESISTANCE.
 */
const CIRCLES_RADIAL_BOUNDARY_RESISTANCE = 10;

/**
 * Angular spread force: equalises angular density within each ring.
 * Kept weak — the proportional initial layout already places nodes well.
 */
const CIRCLES_ANGULAR_SPREAD = 0.003;

/** Max radial deviation (px) from ring centre — canvas boundary analogue. */
const CIRCLES_MAX_R = CIRCLES_RING_RADII[CIRCLES_RING_COUNT - 1] + CIRCLES_BAND_HALF + 30;

/** Repulsion range — same as tree view so nodes from dense rings don't clump. */
const CIRCLES_REPULSION_RANGE = 130;

const CIRCLES_LAYOUT_MAX_DURATION = 18000;
const CIRCLES_LAYOUT_STABILITY_FRAMES = 24;
const CIRCLES_LAYOUT_MIN_DURATION = 1500;
const CIRCLES_FORCE_DEADZONE = 0.005;
const CIRCLES_VELOCITY_DEADZONE = 0.01;

const CIRCLES_EDGE_WEIGHTS: Record<string, number> = {
  CONTAINS: 0.09,
  DEFINES: 0.12,
  IMPORTS: 0.14,
  CALLS: 0.18,
  EXTENDS: 0.13,
  IMPLEMENTS: 0.13,
};

// ---------------------------------------------------------------------------

const TREE_EDGE_WEIGHTS: Record<string, number> = {
  CONTAINS: 0.09,
  DEFINES: 0.12,
  IMPORTS: 0.14,
  CALLS: 0.18,
  EXTENDS: 0.13,
  IMPLEMENTS: 0.13,
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const useSigma = (options: UseSigmaOptions = {}): UseSigmaReturn => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const highlightedRef = useRef<Set<string>>(new Set());
  const blastRadiusRef = useRef<Set<string>>(new Set());
  const animatedNodesRef = useRef<Map<string, NodeAnimation>>(new Map());
  const visibleEdgeTypesRef = useRef<EdgeType[] | null>(null);
  const layoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectsAnimationFrameRef = useRef<number | null>(null);
  const treeLayoutFrameRef = useRef<number | null>(null);
  const treeVelocityRef = useRef<Map<string, number>>(new Map()); // vx per node
  const treeVelocityYRef = useRef<Map<string, number>>(new Map()); // vy per node
  const treeLastTickRef = useRef<number | null>(null);
  const treeAccumulatorRef = useRef(0);
  const treeLayoutStartRef = useRef<number | null>(null);
  const treeStableFramesRef = useRef(0);

  // Circles layout state (mirrors tree layout state)
  const circlesLayoutFrameRef = useRef<number | null>(null);
  const circlesVelocityXRef = useRef<Map<string, number>>(new Map());
  const circlesVelocityYRef = useRef<Map<string, number>>(new Map());
  const circlesLastTickRef = useRef<number | null>(null);
  const circlesAccumulatorRef = useRef(0);
  const circlesLayoutStartRef = useRef<number | null>(null);
  const circlesStableFramesRef = useRef(0);
  const [isLayoutRunning, setIsLayoutRunning] = useState(false);
  const [selectedNode, setSelectedNodeState] = useState<string | null>(null);

  useEffect(() => {
    highlightedRef.current = options.highlightedNodeIds || new Set();
    blastRadiusRef.current = options.blastRadiusNodeIds || new Set();
    animatedNodesRef.current = options.animatedNodes || new Map();
    visibleEdgeTypesRef.current = options.visibleEdgeTypes || null;
    sigmaRef.current?.refresh();
  }, [
    options.highlightedNodeIds,
    options.blastRadiusNodeIds,
    options.animatedNodes,
    options.visibleEdgeTypes,
  ]);

  // Animation loop for node effects
  useEffect(() => {
    if (!options.animatedNodes || options.animatedNodes.size === 0) {
      if (effectsAnimationFrameRef.current) {
        cancelAnimationFrame(effectsAnimationFrameRef.current);
        effectsAnimationFrameRef.current = null;
      }
      return;
    }

    const animate = () => {
      sigmaRef.current?.refresh();
      effectsAnimationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (effectsAnimationFrameRef.current) {
        cancelAnimationFrame(effectsAnimationFrameRef.current);
        effectsAnimationFrameRef.current = null;
      }
    };
  }, [options.animatedNodes]);

  const setSelectedNode = useCallback((nodeId: string | null) => {
    selectedNodeRef.current = nodeId;
    setSelectedNodeState(nodeId);

    const sigma = sigmaRef.current;
    if (!sigma) return;

    // Tiny camera nudge to force edge refresh (workaround for Sigma edge caching)
    const camera = sigma.getCamera();
    const currentRatio = camera.ratio;
    // Imperceptible zoom change that triggers re-render
    camera.animate({ ratio: currentRatio * 1.0001 }, { duration: 50 });

    sigma.refresh();
  }, []);

  const stopTreeLayout = useCallback((refresh: boolean = false) => {
    if (treeLayoutFrameRef.current) {
      cancelAnimationFrame(treeLayoutFrameRef.current);
      treeLayoutFrameRef.current = null;
    }
    treeLastTickRef.current = null;
    treeAccumulatorRef.current = 0;
    treeLayoutStartRef.current = null;
    treeStableFramesRef.current = 0;
    treeVelocityRef.current.clear();
    treeVelocityYRef.current.clear();
    setIsLayoutRunning(false);

    if (refresh) {
      sigmaRef.current?.refresh();
      // Re-fit camera to the actual settled positions — nodes may have drifted
      // from their initial anchors during simulation (especially small/leaf nodes).
      sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
    }
  }, []);

  const stopCirclesLayout = useCallback((refresh: boolean = false) => {
    if (circlesLayoutFrameRef.current) {
      cancelAnimationFrame(circlesLayoutFrameRef.current);
      circlesLayoutFrameRef.current = null;
    }
    circlesLastTickRef.current = null;
    circlesAccumulatorRef.current = 0;
    circlesLayoutStartRef.current = null;
    circlesStableFramesRef.current = 0;
    circlesVelocityXRef.current.clear();
    circlesVelocityYRef.current.clear();
    setIsLayoutRunning(false);

    if (refresh) {
      sigmaRef.current?.refresh();
      sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
    }
  }, []);

  const stopAllLayouts = useCallback(
    (refresh: boolean = false) => {
      if (layoutTimeoutRef.current) {
        clearTimeout(layoutTimeoutRef.current);
        layoutTimeoutRef.current = null;
      }

      if (layoutRef.current) {
        layoutRef.current.stop();
        layoutRef.current.kill();
        layoutRef.current = null;

        const graph = graphRef.current;
        if (graph && options.layoutMode !== 'tree' && options.layoutMode !== 'circles') {
          noverlap.assign(graph, NOVERLAP_SETTINGS);
        }
      }

      stopTreeLayout(false);
      stopCirclesLayout(false);

      if (refresh) {
        sigmaRef.current?.refresh();
      }
    },
    [options.layoutMode, stopTreeLayout, stopCirclesLayout],
  );

  // Initialize Sigma ONCE
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>();
    graphRef.current = graph;

    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'JetBrains Mono, monospace',
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: '#e4e4ed' },
      labelRenderedSizeThreshold: 8,
      labelDensity: 0.1,
      labelGridCellSize: 70,

      defaultNodeColor: '#6b7280',
      defaultEdgeColor: '#2a2a3a',

      defaultEdgeType: 'curved',
      edgeProgramClasses: {
        curved: EdgeCurveProgram,
      },

      // Custom hover renderer - dark background instead of white
      defaultDrawNodeHover: (context, data, settings) => {
        const label = data.label;
        if (!label) return;

        const size = settings.labelSize || 11;
        const font = settings.labelFont || 'JetBrains Mono, monospace';
        const weight = settings.labelWeight || '500';

        context.font = `${weight} ${size}px ${font}`;
        const textWidth = context.measureText(label).width;

        const nodeSize = data.size || 8;
        const x = data.x;
        const y = data.y - nodeSize - 10;
        const paddingX = 8;
        const paddingY = 5;
        const height = size + paddingY * 2;
        const width = textWidth + paddingX * 2;
        const radius = 4;

        // Dark background pill
        context.fillStyle = '#12121c';
        context.beginPath();
        context.roundRect(x - width / 2, y - height / 2, width, height, radius);
        context.fill();

        // Border matching node color
        context.strokeStyle = data.color || '#6366f1';
        context.lineWidth = 2;
        context.stroke();

        // Label text - light color
        context.fillStyle = '#f5f5f7';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, x, y);

        // Also draw a subtle glow ring around the node
        context.beginPath();
        context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
        context.strokeStyle = data.color || '#6366f1';
        context.lineWidth = 2;
        context.globalAlpha = 0.5;
        context.stroke();
        context.globalAlpha = 1;
      },

      minCameraRatio: 0.002,
      maxCameraRatio: 50,
      hideEdgesOnMove: true,
      zIndex: true,

      nodeReducer: (node, data) => {
        const res = { ...data };

        if (data.hidden) {
          res.hidden = true;
          return res;
        }

        const currentSelected = selectedNodeRef.current;
        const highlighted = highlightedRef.current;
        const blastRadius = blastRadiusRef.current;
        const animatedNodes = animatedNodesRef.current;
        const hasHighlights = highlighted.size > 0;
        const hasBlastRadius = blastRadius.size > 0;
        const isQueryHighlighted = highlighted.has(node);
        const isBlastRadiusNode = blastRadius.has(node);

        // Apply animation effects FIRST (before other highlighting)
        const animation = animatedNodes.get(node);
        if (animation) {
          const now = Date.now();
          const elapsed = now - animation.startTime;
          const progress = Math.min(elapsed / animation.duration, 1);

          // Calculate animation phase (0-1-0-1... oscillation)
          const phase = (Math.sin(progress * Math.PI * 4) + 1) / 2;

          if (animation.type === 'pulse') {
            // Cyan pulse for search results
            const sizeMultiplier = 1.5 + phase * 0.8;
            res.size = (data.size || 8) * sizeMultiplier;
            res.color = phase > 0.5 ? '#06b6d4' : brightenColor('#06b6d4', 1.3);
            res.zIndex = 5;
            res.highlighted = true;
          } else if (animation.type === 'ripple') {
            // Red ripple for blast radius
            const sizeMultiplier = 1.3 + phase * 1.2;
            res.size = (data.size || 8) * sizeMultiplier;
            res.color = phase > 0.5 ? '#ef4444' : '#f87171';
            res.zIndex = 5;
            res.highlighted = true;
          } else if (animation.type === 'glow') {
            // Purple glow for highlight
            const sizeMultiplier = 1.4 + phase * 0.6;
            res.size = (data.size || 8) * sizeMultiplier;
            res.color = phase > 0.5 ? '#a855f7' : '#c084fc';
            res.zIndex = 5;
            res.highlighted = true;
          }

          return res;
        }

        // Blast radius takes priority (red highlighting)
        if (hasBlastRadius && !currentSelected) {
          if (isBlastRadiusNode) {
            res.color = '#ef4444'; // Red for blast radius
            res.size = (data.size || 8) * 1.8;
            res.zIndex = 3;
            res.highlighted = true;
          } else if (isQueryHighlighted) {
            // Regular cyan highlight for non-blast-radius nodes
            res.color = '#06b6d4';
            res.size = (data.size || 8) * 1.4;
            res.zIndex = 2;
            res.highlighted = true;
          } else {
            res.color = dimColor(data.color, 0.15);
            res.size = (data.size || 8) * 0.4;
            res.zIndex = 0;
          }
          return res;
        }

        if (hasHighlights && !currentSelected) {
          if (isQueryHighlighted) {
            res.color = '#06b6d4';
            res.size = (data.size || 8) * 1.6;
            res.zIndex = 2;
            res.highlighted = true;
          } else {
            res.color = dimColor(data.color, 0.2);
            res.size = (data.size || 8) * 0.5;
            res.zIndex = 0;
          }
          return res;
        }

        if (currentSelected) {
          const graph = graphRef.current;
          if (graph) {
            const isSelected = node === currentSelected;
            const isNeighbor =
              graph.hasEdge(node, currentSelected) || graph.hasEdge(currentSelected, node);

            if (isSelected) {
              res.color = data.color;
              res.size = (data.size || 8) * 1.8;
              res.zIndex = 2;
              res.highlighted = true;
            } else if (isNeighbor) {
              res.color = data.color;
              res.size = (data.size || 8) * 1.3;
              res.zIndex = 1;
            } else {
              res.color = dimColor(data.color, 0.25);
              res.size = (data.size || 8) * 0.6;
              res.zIndex = 0;
            }
          }
        }

        return res;
      },

      edgeReducer: (edge, data) => {
        const res = { ...data };

        // Check edge type visibility first
        const visibleTypes = visibleEdgeTypesRef.current;
        if (visibleTypes && data.relationType) {
          if (!visibleTypes.includes(data.relationType as EdgeType)) {
            res.hidden = true;
            return res;
          }
        }

        // Tree view: hierarchy edges are subtle, cross-cutting edges are more visible
        const isHierarchyEdge = (data as any).isHierarchyEdge;
        if (isHierarchyEdge !== undefined) {
          if (isHierarchyEdge) {
            // Subtle hierarchy edges in tree view
            res.color = dimColor(data.color, 0.5);
            res.size = Math.max(0.3, (data.size || 1) * 0.5);
          } else {
            // Cross-cutting edges are more visible
            res.color = brightenColor(data.color, 1.2);
            res.size = Math.max(1, (data.size || 1) * 1.2);
          }
        }

        const currentSelected = selectedNodeRef.current;
        const highlighted = highlightedRef.current;
        const blastRadius = blastRadiusRef.current;
        const hasHighlights = highlighted.size > 0 || blastRadius.size > 0; // Check BOTH sets

        if (hasHighlights && !currentSelected) {
          const graph = graphRef.current;
          if (graph) {
            const [source, target] = graph.extremities(edge);

            // Check if nodes are in EITHER set
            const isSourceActive = highlighted.has(source) || blastRadius.has(source);
            const isTargetActive = highlighted.has(target) || blastRadius.has(target);

            const bothHighlighted = isSourceActive && isTargetActive;
            const oneHighlighted = isSourceActive || isTargetActive;

            if (bothHighlighted) {
              // If both nodes are in blast radius, use red edge
              if (blastRadius.has(source) && blastRadius.has(target)) {
                res.color = '#ef4444';
              } else {
                res.color = '#06b6d4';
              }
              res.size = Math.max(2, (data.size || 1) * 3);
              res.zIndex = 2;
            } else if (oneHighlighted) {
              res.color = dimColor('#06b6d4', 0.4);
              res.size = 1;
              res.zIndex = 1;
            } else {
              res.color = dimColor(data.color, 0.08);
              res.size = 0.2;
              res.zIndex = 0;
            }
          }
          return res;
        }

        if (currentSelected) {
          const graph = graphRef.current;
          if (graph) {
            const [source, target] = graph.extremities(edge);
            const isConnected = source === currentSelected || target === currentSelected;

            if (isConnected) {
              res.color = brightenColor(data.color, 1.5);
              res.size = Math.max(3, (data.size || 1) * 4);
              res.zIndex = 2;
            } else {
              res.color = dimColor(data.color, 0.1);
              res.size = 0.3;
              res.zIndex = 0;
            }
          }
        }

        return res;
      },
    });

    sigmaRef.current = sigma;

    sigma.on('clickNode', ({ node }) => {
      setSelectedNode(node);
      options.onNodeClick?.(node);
    });

    sigma.on('clickStage', () => {
      setSelectedNode(null);
      options.onStageClick?.();
    });

    sigma.on('enterNode', ({ node }) => {
      options.onNodeHover?.(node);
      if (containerRef.current) {
        containerRef.current.style.cursor = 'pointer';
      }
    });

    sigma.on('leaveNode', () => {
      options.onNodeHover?.(null);
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grab';
      }
    });

    return () => {
      if (treeLayoutFrameRef.current) {
        cancelAnimationFrame(treeLayoutFrameRef.current);
        treeLayoutFrameRef.current = null;
      }
      treeVelocityRef.current.clear();
      treeVelocityYRef.current.clear();
      if (circlesLayoutFrameRef.current) {
        cancelAnimationFrame(circlesLayoutFrameRef.current);
        circlesLayoutFrameRef.current = null;
      }
      circlesVelocityXRef.current.clear();
      circlesVelocityYRef.current.clear();
      if (layoutTimeoutRef.current) {
        clearTimeout(layoutTimeoutRef.current);
      }
      layoutRef.current?.kill();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []);

  const runTreeLayout = useCallback(
    (graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>) => {
      if (graph.order === 0) return;

      stopAllLayouts(false);

      // Compute each layer's Y center from initial anchor positions
      const layerYSum = new Map<number, number>();
      const layerYCount = new Map<number, number>();

      graph.forEachNode((nodeId, attrs) => {
        const layer = attrs.treeLayer ?? 0;
        const ay = attrs.treeAnchorY ?? attrs.y;
        layerYSum.set(layer, (layerYSum.get(layer) ?? 0) + ay);
        layerYCount.set(layer, (layerYCount.get(layer) ?? 0) + 1);
        treeVelocityRef.current.set(nodeId, 0);
        treeVelocityYRef.current.set(nodeId, 0);
        graph.setNodeAttribute(nodeId, 'x', attrs.treeAnchorX ?? attrs.x);
        graph.setNodeAttribute(nodeId, 'y', ay);
      });

      const layerCenterY = new Map<number, number>();
      for (const [layer, sum] of layerYSum) {
        layerCenterY.set(layer, sum / (layerYCount.get(layer) ?? 1));
      }

      // Compute each node's preferred Y position within its layer band.
      //
      // A node in Layer L that connects upward (to Layer L-1, which has higher Y)
      // should sit near the TOP of the band — it shortens those vertical edges.
      // A node connecting only downward (to Layer L+1) should sit at the BOTTOM.
      // A node that connects in both directions, or only within its own layer,
      // goes to the center — freeing the edges of the band for directional nodes.
      //
      // bias ∈ [-1, +1]:  +1 = top of band (higher Y, toward layer above),
      //                    -1 = bottom of band (lower Y, toward layer below),
      //                     0 = layer center.
      const nodeYBias = new Map<string, number>();
      graph.forEachNode((nodeId, attrs) => {
        const layer = attrs.treeLayer ?? 0;
        let aboveCount = 0;
        let belowCount = 0;
        graph.forEachNeighbor(nodeId, (_, nAttrs) => {
          const nLayer = nAttrs.treeLayer ?? 0;
          if (nLayer < layer) aboveCount++;
          if (nLayer > layer) belowCount++;
        });
        // Weighted ratio: (above − below) / total, scaled to ±0.55 of band half.
        const total = aboveCount + belowCount;
        nodeYBias.set(nodeId, total > 0 ? ((aboveCount - belowCount) / total) * 0.55 : 0);
      });

      // Pre-position nodes at their preferred Y to reduce physics convergence time.
      graph.forEachNode((nodeId, attrs) => {
        const layer = attrs.treeLayer ?? 0;
        const cy = layerCenterY.get(layer) ?? attrs.y;
        const bias = nodeYBias.get(nodeId) ?? 0;
        graph.setNodeAttribute(nodeId, 'y', cy + bias * TREE_LAYER_BAND_HALF * 0.6);
      });

      setIsLayoutRunning(true);

      const step = (timestamp: number) => {
        if (!graphRef.current || graphRef.current !== graph) {
          stopTreeLayout(false);
          return;
        }

        if (treeLayoutStartRef.current === null) {
          treeLayoutStartRef.current = timestamp;
        }

        const frameDelta =
          treeLastTickRef.current === null
            ? TREE_TARGET_FRAME_MS
            : clamp(timestamp - treeLastTickRef.current, 8, 64);
        treeLastTickRef.current = timestamp;
        treeAccumulatorRef.current = Math.min(
          TREE_TARGET_FRAME_MS * 3,
          treeAccumulatorRef.current + frameDelta,
        );

        if (treeAccumulatorRef.current < TREE_TARGET_FRAME_MS) {
          treeLayoutFrameRef.current = requestAnimationFrame(step);
          return;
        }

        const simulationSteps = Math.min(
          2,
          Math.floor(treeAccumulatorRef.current / TREE_TARGET_FRAME_MS),
        );
        treeAccumulatorRef.current -= simulationSteps * TREE_TARGET_FRAME_MS;
        const dtScale = 0.6;

        // --- Accumulate forces ---
        const forceX = new Map<string, number>();
        const forceY = new Map<string, number>();

        // 1. Layer gravity: soft pull toward each node's preferred Y within its band.
        // Directional nodes (above-only or below-only connections) are pulled to the
        // top or bottom of the band; bidirectional / same-layer-only nodes go to
        // the center.  This leaves band edges free for nodes that actually use them.
        graph.forEachNode((nodeId, attrs) => {
          const layer = attrs.treeLayer ?? 0;
          const centerY = layerCenterY.get(layer) ?? attrs.y;
          const bias = nodeYBias.get(nodeId) ?? 0;
          const targetY = centerY + bias * TREE_LAYER_BAND_HALF;
          forceX.set(nodeId, 0);
          forceY.set(nodeId, (targetY - attrs.y) * TREE_LAYER_GRAVITY * dtScale);
        });

        // 2. Edge springs — X and Y handled separately.
        //
        // Root cause of long horizontal edges: the previous 2D spring projected
        // force through (dx/distance, dy/distance).  When the Y layer gap
        // dominates (|dy|≈200, |dx|≈30) the X component shrinks to ~15% of
        // the total spring force, too weak to overcome sibling repulsion.
        //
        // Fix: compute X spring from |dx| alone.  This keeps full strength
        // regardless of how far apart two nodes are in Y.
        graph.forEachEdge((edge, edgeAttrs, source, target, sourceAttrs, targetAttrs) => {
          const dx = targetAttrs.x - sourceAttrs.x;
          const rawWeight = TREE_EDGE_WEIGHTS[edgeAttrs.relationType] ?? 0.18;

          // 2a. Pure X spring.
          // Hierarchy edges: zero rest length so children want to sit directly
          // under their parent (repulsion then spreads siblings out naturally).
          // Cross edges: 60 px rest so far-spanning CALLS/IMPORTS edges only
          // pull when really stretched, and their weight is capped so they
          // don't override the hierarchy structure.
          const xRestLength = edgeAttrs.isHierarchyEdge ? 0 : 60;
          const xStretch = Math.abs(dx) - xRestLength;
          if (xStretch > 0) {
            const xWeight = edgeAttrs.isHierarchyEdge ? rawWeight : Math.min(rawWeight, 0.1);
            const fxX = Math.sign(dx) * xStretch * xWeight * 0.3 * dtScale;
            forceX.set(source, (forceX.get(source) ?? 0) + fxX);
            forceX.set(target, (forceX.get(target) ?? 0) - fxX);
          }

          // 2b. Weak Y spring — layer gravity handles most vertical placement;
          // this just prevents extreme cross-layer stretching.
          const dy = targetAttrs.y - sourceAttrs.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const layerGap = Math.abs((targetAttrs.treeLayer ?? 0) - (sourceAttrs.treeLayer ?? 0));
          const yRestLength =
            (edgeAttrs.isHierarchyEdge ? 70 : 95) +
            layerGap * (edgeAttrs.isHierarchyEdge ? 28 : 36);
          const yStretch = distance - yRestLength;
          if (yStretch > 0) {
            const fy = (dy / distance) * yStretch * rawWeight * 0.008 * dtScale;
            forceY.set(source, (forceY.get(source) ?? 0) + fy);
            forceY.set(target, (forceY.get(target) ?? 0) - fy);
          }
        });

        // 3. Node repulsion in 2D: all pairs within range (cross-layer included)
        // Sort by X for O(n·k) early-exit: once dx > range, all further pairs are too far.
        //
        // Cross-layer pairs use reduced repulsion (25 % of same-layer strength).
        // Full-strength cross-layer repulsion was the main barrier preventing
        // nodes from moving horizontally to align with their parents — a node
        // in Layer 2 would block a Layer 1 File from moving toward its Package.
        const nodeList = graph.nodes().map((id) => {
          const a = graph.getNodeAttributes(id);
          return { id, x: a.x, y: a.y, size: a.size ?? 6, layer: a.treeLayer ?? 0 };
        });
        nodeList.sort((a, b) => a.x - b.x);

        for (let i = 0; i < nodeList.length; i++) {
          const nodeA = nodeList[i];
          for (let j = i + 1; j < nodeList.length; j++) {
            const nodeB = nodeList[j];
            const dx = nodeB.x - nodeA.x;
            if (dx > TREE_REPULSION_RANGE) break; // X-sorted: all further pairs are also too far

            const dy = nodeB.y - nodeA.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist > TREE_REPULSION_RANGE) continue;

            const sameLayer = nodeA.layer === nodeB.layer;
            // Same-layer repulsion reduced from 160→100 so the stronger X spring
            // (0.30) can now overcome collective repulsion from 3-4 nearby nodes.
            // Cross-layer kept low (28) so intermediate-layer nodes don't block
            // parent-child X alignment.
            const repulsionStrength = sameLayer ? 100 : 28;
            const minGap = Math.max(28, (nodeA.size + nodeB.size) * 1.8);
            let repulsion =
              (1 / (dist + 8) - 1 / (TREE_REPULSION_RANGE + 8)) * repulsionStrength * dtScale;
            if (dist < minGap && sameLayer) {
              repulsion += (minGap - dist) * 0.1 * dtScale;
            }
            if (repulsion <= 0) continue;

            const fx = (dx / dist) * repulsion;
            const fy = (dy / dist) * repulsion;

            forceX.set(nodeA.id, (forceX.get(nodeA.id) ?? 0) - fx);
            forceY.set(nodeA.id, (forceY.get(nodeA.id) ?? 0) - fy);
            forceX.set(nodeB.id, (forceX.get(nodeB.id) ?? 0) + fx);
            forceY.set(nodeB.id, (forceY.get(nodeB.id) ?? 0) + fy);
          }
        }

        // 4. Spread force: equalize node density within each layer.
        //
        // For each layer, rank nodes by current X, compute where they would sit
        // in a perfectly even distribution, then add a weak force toward that
        // ideal position.  Nodes that are held by strong hierarchy springs
        // (force ≈ 1–2 units) resist and stay clustered; nodes without a
        // strong spring anchor (isolated or same-layer-only) drift to fill gaps.
        // Net effect: dense centre spreads outward, sparse edges fill in.
        const spreadByLayer = new Map<number, Array<{ id: string; x: number }>>();
        graph.forEachNode((nodeId, attrs) => {
          const layer = attrs.treeLayer ?? 0;
          if (!spreadByLayer.has(layer)) spreadByLayer.set(layer, []);
          spreadByLayer.get(layer)!.push({ id: nodeId, x: attrs.x });
        });
        for (const [, layerNodes] of spreadByLayer) {
          if (layerNodes.length < 2) continue;
          layerNodes.sort((a, b) => a.x - b.x);
          const count = layerNodes.length;
          const spacing = (TREE_MAX_X * 2) / count;
          for (let i = 0; i < count; i++) {
            const { id, x } = layerNodes[i];
            const idealX = -TREE_MAX_X + (i + 0.5) * spacing;
            forceX.set(id, (forceX.get(id) ?? 0) + (idealX - x) * TREE_SPREAD_STRENGTH * dtScale);
          }
        }

        // --- Apply forces: velocity integration with boundary resistance ---
        let totalVelocity = 0;
        let maxVelocity = 0;
        let activeNodes = 0;

        for (let simulationStep = 0; simulationStep < simulationSteps; simulationStep++) {
          totalVelocity = 0;
          maxVelocity = 0;
          activeNodes = 0;

          graph.forEachNode((nodeId, attrs) => {
            const fx = forceX.get(nodeId) ?? 0;
            const fy = forceY.get(nodeId) ?? 0;
            const vx0 = treeVelocityRef.current.get(nodeId) ?? 0;
            const vy0 = treeVelocityYRef.current.get(nodeId) ?? 0;

            // X boundary resistance: grows as node approaches canvas edge
            const normX = Math.min(1, Math.abs(attrs.x) / TREE_MAX_X);
            const resistX = 1 + normX * normX * 4;

            // Y boundary resistance: grows as node drifts from its layer band center
            const layer = attrs.treeLayer ?? 0;
            const centerY = layerCenterY.get(layer) ?? attrs.y;
            const yOffset = attrs.y - centerY;
            const normY = Math.min(1, Math.abs(yOffset) / TREE_LAYER_BAND_HALF);
            const resistY = 1 + normY * normY * TREE_LAYER_BOUNDARY_RESISTANCE;

            const rawVx = (vx0 + fx / resistX) * 0.62;
            const rawVy = (vy0 + fy / resistY) * 0.62;
            const newVx =
              Math.abs(fx) < TREE_FORCE_DEADZONE && Math.abs(rawVx) < TREE_VELOCITY_DEADZONE
                ? 0
                : clamp(rawVx, -3, 3);
            const newVy =
              Math.abs(fy) < TREE_FORCE_DEADZONE && Math.abs(rawVy) < TREE_VELOCITY_DEADZONE
                ? 0
                : clamp(rawVy, -2, 2);

            treeVelocityRef.current.set(nodeId, newVx);
            treeVelocityYRef.current.set(nodeId, newVy);

            const speed = Math.sqrt(newVx * newVx + newVy * newVy);
            totalVelocity += speed;
            maxVelocity = Math.max(maxVelocity, speed);
            if (
              speed > TREE_VELOCITY_DEADZONE ||
              Math.abs(fx) > TREE_FORCE_DEADZONE ||
              Math.abs(fy) > TREE_FORCE_DEADZONE
            ) {
              activeNodes += 1;
            }

            graph.setNodeAttribute(nodeId, 'x', clamp(attrs.x + newVx, -TREE_MAX_X, TREE_MAX_X));
            graph.setNodeAttribute(
              nodeId,
              'y',
              clamp(
                attrs.y + newVy,
                centerY - TREE_LAYER_BAND_HALF,
                centerY + TREE_LAYER_BAND_HALF,
              ),
            );
          });
        }

        sigmaRef.current?.refresh();

        const averageVelocity = totalVelocity / Math.max(1, graph.order);
        const elapsed = timestamp - (treeLayoutStartRef.current ?? timestamp);

        if (
          elapsed >= TREE_LAYOUT_MIN_DURATION &&
          maxVelocity < 0.022 &&
          activeNodes <= Math.max(2, Math.floor(graph.order * 0.008)) &&
          averageVelocity < 0.016
        ) {
          treeStableFramesRef.current += 1;
        } else {
          treeStableFramesRef.current = 0;
        }

        if (
          treeStableFramesRef.current >= TREE_LAYOUT_STABILITY_FRAMES ||
          elapsed >= TREE_LAYOUT_MAX_DURATION
        ) {
          stopTreeLayout(true);
          return;
        }

        treeLayoutFrameRef.current = requestAnimationFrame(step);
      };

      treeLayoutFrameRef.current = requestAnimationFrame(step);
    },
    [stopAllLayouts, stopTreeLayout],
  );

  const runCirclesLayout = useCallback(
    (graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>) => {
      if (graph.order === 0) return;

      stopAllLayouts(false);

      // Compute ring target radii and centre Y (all rings are centred at 0,0)
      const ringTargetR = CIRCLES_RING_RADII as unknown as number[];

      // Pre-position nodes at their anchor and initialise velocities
      graph.forEachNode((nodeId, attrs) => {
        const ax = attrs.circlesAnchorX ?? attrs.x;
        const ay = attrs.circlesAnchorY ?? attrs.y;
        graph.setNodeAttribute(nodeId, 'x', ax);
        graph.setNodeAttribute(nodeId, 'y', ay);
        circlesVelocityXRef.current.set(nodeId, 0);
        circlesVelocityYRef.current.set(nodeId, 0);
      });

      setIsLayoutRunning(true);

      const step = (timestamp: number) => {
        if (!graphRef.current || graphRef.current !== graph) {
          stopCirclesLayout(false);
          return;
        }

        if (circlesLayoutStartRef.current === null) {
          circlesLayoutStartRef.current = timestamp;
        }

        const frameDelta =
          circlesLastTickRef.current === null
            ? TREE_TARGET_FRAME_MS
            : clamp(timestamp - circlesLastTickRef.current, 8, 64);
        circlesLastTickRef.current = timestamp;
        circlesAccumulatorRef.current = Math.min(
          TREE_TARGET_FRAME_MS * 3,
          circlesAccumulatorRef.current + frameDelta,
        );

        if (circlesAccumulatorRef.current < TREE_TARGET_FRAME_MS) {
          circlesLayoutFrameRef.current = requestAnimationFrame(step);
          return;
        }

        const simulationSteps = Math.min(
          2,
          Math.floor(circlesAccumulatorRef.current / TREE_TARGET_FRAME_MS),
        );
        circlesAccumulatorRef.current -= simulationSteps * TREE_TARGET_FRAME_MS;
        const dtScale = 0.6;

        // --- Accumulate forces ---
        const forceX = new Map<string, number>();
        const forceY = new Map<string, number>();

        // 1. Radial gravity: pull each node toward its ring's target radius.
        //    F = (targetR - r) * k * (x/r, y/r)  [Cartesian decomposition]
        graph.forEachNode((nodeId, attrs) => {
          const ring = attrs.circlesRing ?? 0;
          const targetR = ringTargetR[Math.min(ring, CIRCLES_RING_COUNT - 1)];
          const x = attrs.x;
          const y = attrs.y;
          const r = Math.sqrt(x * x + y * y) || 1;
          const stretch = targetR - r; // positive = inside ring, negative = outside
          const fx = (x / r) * stretch * CIRCLES_RADIAL_GRAVITY * dtScale;
          const fy = (y / r) * stretch * CIRCLES_RADIAL_GRAVITY * dtScale;
          forceX.set(nodeId, fx);
          forceY.set(nodeId, fy);
        });

        // 2. Edge springs — radial and tangential components.
        graph.forEachEdge((edge, edgeAttrs, source, target, sourceAttrs, targetAttrs) => {
          const dx = targetAttrs.x - sourceAttrs.x;
          const dy = targetAttrs.y - sourceAttrs.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const rawWeight = CIRCLES_EDGE_WEIGHTS[edgeAttrs.relationType] ?? 0.18;

          // Radial spring: hierarchy edges want zero separation; cross-edges 60px rest.
          const restLength = edgeAttrs.isHierarchyEdge ? 0 : 60;
          const stretch = dist - restLength;
          if (stretch > 0) {
            const weight = edgeAttrs.isHierarchyEdge ? rawWeight : Math.min(rawWeight, 0.1);
            const f = stretch * weight * 0.3 * dtScale;
            const fx = (dx / dist) * f;
            const fy = (dy / dist) * f;
            forceX.set(source, (forceX.get(source) ?? 0) + fx);
            forceY.set(source, (forceY.get(source) ?? 0) + fy);
            forceX.set(target, (forceX.get(target) ?? 0) - fx);
            forceY.set(target, (forceY.get(target) ?? 0) - fy);
          }
        });

        // 3. 2D repulsion (shared logic with tree view, different range constant).
        const nodeList = graph.nodes().map((id) => {
          const a = graph.getNodeAttributes(id);
          return { id, x: a.x, y: a.y, size: a.size ?? 6, ring: a.circlesRing ?? 0 };
        });
        nodeList.sort((a, b) => a.x - b.x);

        for (let i = 0; i < nodeList.length; i++) {
          const nodeA = nodeList[i];
          for (let j = i + 1; j < nodeList.length; j++) {
            const nodeB = nodeList[j];
            const dx = nodeB.x - nodeA.x;
            if (dx > CIRCLES_REPULSION_RANGE) break;

            const dy = nodeB.y - nodeA.y;
            const dist2 = dx * dx + dy * dy;
            const distVal = Math.sqrt(dist2) || 1;
            if (distVal > CIRCLES_REPULSION_RANGE) continue;

            const sameRing = nodeA.ring === nodeB.ring;
            const repulsionStrength = sameRing ? 100 : 28;
            const minGap = Math.max(28, (nodeA.size + nodeB.size) * 1.8);
            let repulsion =
              (1 / (distVal + 8) - 1 / (CIRCLES_REPULSION_RANGE + 8)) * repulsionStrength * dtScale;
            if (distVal < minGap && sameRing) repulsion += (minGap - distVal) * 0.1 * dtScale;
            if (repulsion <= 0) continue;

            const fx = (dx / distVal) * repulsion;
            const fy = (dy / distVal) * repulsion;
            forceX.set(nodeA.id, (forceX.get(nodeA.id) ?? 0) - fx);
            forceY.set(nodeA.id, (forceY.get(nodeA.id) ?? 0) - fy);
            forceX.set(nodeB.id, (forceX.get(nodeB.id) ?? 0) + fx);
            forceY.set(nodeB.id, (forceY.get(nodeB.id) ?? 0) + fy);
          }
        }

        // 4. Angular spread: equalise angular density within each ring.
        //    F_tangential = dθ * k * (-y/r, x/r)   [r-independent arc-length form]
        const spreadByRing = new Map<
          number,
          Array<{ id: string; angle: number; x: number; y: number }>
        >();
        graph.forEachNode((nodeId, attrs) => {
          const ring = attrs.circlesRing ?? 0;
          if (!spreadByRing.has(ring)) spreadByRing.set(ring, []);
          spreadByRing.get(ring)!.push({
            id: nodeId,
            angle: Math.atan2(attrs.y, attrs.x),
            x: attrs.x,
            y: attrs.y,
          });
        });

        for (const [, ringNodes] of spreadByRing) {
          if (ringNodes.length < 2) continue;
          ringNodes.sort((a, b) => a.angle - b.angle);
          const count = ringNodes.length;
          for (let i = 0; i < count; i++) {
            const { id, angle, x, y } = ringNodes[i];
            const idealAngle = ((i + 0.5) / count) * Math.PI * 2 - Math.PI;
            let dAngle = idealAngle - angle;
            while (dAngle > Math.PI) dAngle -= Math.PI * 2;
            while (dAngle < -Math.PI) dAngle += Math.PI * 2;
            const r = Math.sqrt(x * x + y * y) || 1;
            // Tangential unit vector: (-y/r, x/r)
            const tx = -y / r;
            const ty = x / r;
            const fMag = dAngle * CIRCLES_ANGULAR_SPREAD * dtScale;
            forceX.set(id, (forceX.get(id) ?? 0) + tx * fMag);
            forceY.set(id, (forceY.get(id) ?? 0) + ty * fMag);
          }
        }

        // --- Apply forces with radial boundary resistance ---
        let totalVelocity = 0;
        let maxVelocity = 0;
        let activeNodes = 0;

        for (let _step = 0; _step < simulationSteps; _step++) {
          totalVelocity = 0;
          maxVelocity = 0;
          activeNodes = 0;

          graph.forEachNode((nodeId, attrs) => {
            const fx = forceX.get(nodeId) ?? 0;
            const fy = forceY.get(nodeId) ?? 0;
            const vx0 = circlesVelocityXRef.current.get(nodeId) ?? 0;
            const vy0 = circlesVelocityYRef.current.get(nodeId) ?? 0;

            const ring = attrs.circlesRing ?? 0;
            const targetR = ringTargetR[Math.min(ring, CIRCLES_RING_COUNT - 1)];
            const x = attrs.x;
            const y = attrs.y;
            const r = Math.sqrt(x * x + y * y) || 1;

            // Radial boundary resistance: grows as node drifts from ring band
            const rOffset = Math.abs(r - targetR);
            const normR = Math.min(1, rOffset / CIRCLES_BAND_HALF);
            // Decompose resistance into radial direction (x/r, y/r)
            const resistR = 1 + normR * normR * CIRCLES_RADIAL_BOUNDARY_RESISTANCE;
            // Apply resistance along radial direction only; tangential stays free
            const dotFR = (fx * x + fy * y) / r; // radial component of force
            const resistedFx = fx - (x / r) * dotFR + ((x / r) * dotFR) / resistR;
            const resistedFy = fy - (y / r) * dotFR + ((y / r) * dotFR) / resistR;

            // Canvas boundary resistance (outside outermost ring)
            const normCanvas = Math.min(1, r / CIRCLES_MAX_R);
            const resistCanvas = 1 + normCanvas * normCanvas * 4;
            const finalFx = resistedFx / resistCanvas;
            const finalFy = resistedFy / resistCanvas;

            const rawVx = (vx0 + finalFx) * 0.62;
            const rawVy = (vy0 + finalFy) * 0.62;
            const newVx =
              Math.abs(finalFx) < CIRCLES_FORCE_DEADZONE &&
              Math.abs(rawVx) < CIRCLES_VELOCITY_DEADZONE
                ? 0
                : clamp(rawVx, -3, 3);
            const newVy =
              Math.abs(finalFy) < CIRCLES_FORCE_DEADZONE &&
              Math.abs(rawVy) < CIRCLES_VELOCITY_DEADZONE
                ? 0
                : clamp(rawVy, -2, 2);

            circlesVelocityXRef.current.set(nodeId, newVx);
            circlesVelocityYRef.current.set(nodeId, newVy);

            const speed = Math.sqrt(newVx * newVx + newVy * newVy);
            totalVelocity += speed;
            maxVelocity = Math.max(maxVelocity, speed);
            if (
              speed > CIRCLES_VELOCITY_DEADZONE ||
              Math.abs(finalFx) > CIRCLES_FORCE_DEADZONE ||
              Math.abs(finalFy) > CIRCLES_FORCE_DEADZONE
            ) {
              activeNodes += 1;
            }

            const newX = x + newVx;
            const newY = y + newVy;
            // Soft clamp: don't exceed CIRCLES_MAX_R
            const newR = Math.sqrt(newX * newX + newY * newY);
            const scale = newR > CIRCLES_MAX_R ? CIRCLES_MAX_R / newR : 1;
            graph.setNodeAttribute(nodeId, 'x', newX * scale);
            graph.setNodeAttribute(nodeId, 'y', newY * scale);
          });
        }

        sigmaRef.current?.refresh();

        const averageVelocity = totalVelocity / Math.max(1, graph.order);
        const elapsed = timestamp - (circlesLayoutStartRef.current ?? timestamp);

        if (
          elapsed >= CIRCLES_LAYOUT_MIN_DURATION &&
          maxVelocity < 0.022 &&
          activeNodes <= Math.max(2, Math.floor(graph.order * 0.008)) &&
          averageVelocity < 0.016
        ) {
          circlesStableFramesRef.current += 1;
        } else {
          circlesStableFramesRef.current = 0;
        }

        if (
          circlesStableFramesRef.current >= CIRCLES_LAYOUT_STABILITY_FRAMES ||
          elapsed >= CIRCLES_LAYOUT_MAX_DURATION
        ) {
          stopCirclesLayout(true);
          return;
        }

        circlesLayoutFrameRef.current = requestAnimationFrame(step);
      };

      circlesLayoutFrameRef.current = requestAnimationFrame(step);
    },
    [stopAllLayouts, stopCirclesLayout],
  );

  // Run ForceAtlas2 layout
  const runLayout = useCallback(
    (graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>) => {
      const nodeCount = graph.order;
      if (nodeCount === 0) return;

      stopAllLayouts(false);

      // Get settings
      const inferredSettings = forceAtlas2.inferSettings(graph);
      const customSettings = getFA2Settings(nodeCount);
      const settings = { ...inferredSettings, ...customSettings };

      const layout = new FA2Layout(graph, { settings });

      layoutRef.current = layout;
      layout.start();
      setIsLayoutRunning(true);

      const duration = getLayoutDuration(nodeCount);

      layoutTimeoutRef.current = setTimeout(() => {
        if (layoutRef.current) {
          layoutRef.current.stop();
          layoutRef.current = null;

          // Light noverlap cleanup
          noverlap.assign(graph, NOVERLAP_SETTINGS);
          sigmaRef.current?.refresh();

          setIsLayoutRunning(false);
        }
      }, duration);
    },
    [stopAllLayouts],
  );

  const setGraph = useCallback(
    (newGraph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>) => {
      const sigma = sigmaRef.current;
      if (!sigma) return;

      stopAllLayouts(false);

      graphRef.current = newGraph;
      sigma.setGraph(newGraph);
      setSelectedNode(null);

      if (options.layoutMode === 'tree') {
        runTreeLayout(newGraph);
      } else if (options.layoutMode === 'circles') {
        runCirclesLayout(newGraph);
      } else {
        runLayout(newGraph);
      }

      sigma.getCamera().animatedReset({ duration: 500 });
    },
    [
      options.layoutMode,
      runLayout,
      runTreeLayout,
      runCirclesLayout,
      setSelectedNode,
      stopAllLayouts,
    ],
  );

  const focusNode = useCallback((nodeId: string) => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(nodeId)) return;

    // Skip if already focused on this node (prevents double-click issues)
    const alreadySelected = selectedNodeRef.current === nodeId;

    // Set selection state directly (without the camera nudge from setSelectedNode)
    selectedNodeRef.current = nodeId;
    setSelectedNodeState(nodeId);

    // Only animate camera if selecting a new node
    if (!alreadySelected) {
      const nodeAttrs = graph.getNodeAttributes(nodeId);
      sigma.getCamera().animate({ x: nodeAttrs.x, y: nodeAttrs.y, ratio: 0.15 }, { duration: 400 });
    }

    sigma.refresh();
  }, []);

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 200 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 });
  }, []);

  const resetZoom = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
    setSelectedNode(null);
  }, [setSelectedNode]);

  const startLayout = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || graph.order === 0) return;
    if (options.layoutMode === 'tree') {
      runTreeLayout(graph);
    } else if (options.layoutMode === 'circles') {
      runCirclesLayout(graph);
    } else {
      runLayout(graph);
    }
  }, [options.layoutMode, runLayout, runTreeLayout, runCirclesLayout]);

  const stopLayout = useCallback(() => {
    stopAllLayouts(true);
  }, [stopAllLayouts]);

  const refreshHighlights = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  return {
    containerRef,
    sigmaRef,
    setGraph,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    isLayoutRunning,
    startLayout,
    stopLayout,
    selectedNode,
    setSelectedNode,
    refreshHighlights,
  };
};
