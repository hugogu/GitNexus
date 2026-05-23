# Data Model: Tree-Based Code View

## Entity: VisualizationMode

- **Purpose**: Tracks which primary repository visualization is active.
- **Fields**:
  - `value`: `force` | `tree`
- **Relationships**:
  - Controls which main canvas component is rendered inside the explorer shell.
- **Validation Rules**:
  - Must always be one of the supported view modes.
  - Changing mode must not clear shared filters or the current selection by itself.
- **State Transitions**:
  - `force -> tree`
  - `tree -> force`

## Entity: TreeSortMode

- **Purpose**: Defines the ordering rule for sibling nodes in the tree view.
- **Fields**:
  - `value`: `alphabetical` | `inboundDegree` | `outboundDegree`
- **Relationships**:
  - Applied to every sibling collection in the derived tree model.
- **Validation Rules**:
  - Must be a supported sort option.
  - Ties must resolve via a stable secondary rule so nodes do not reorder unpredictably.

## Entity: VisibleGraphSnapshot

- **Purpose**: Represents the authoritative filtered graph that both visual modes consume.
- **Fields**:
  - `visibleNodeIds`: set of node identifiers eligible for display
  - `visibleEdgeIds`: set of relationship identifiers eligible for display
  - `selectedNodeId`: currently selected node identifier or null
  - `activeLabelFilters`: current visible node labels
  - `activeEdgeFilters`: current visible relationship types
  - `focusDepth`: active hop limit or null
- **Relationships**:
  - Source input for both `GraphCanvas` and `TreeCanvas`.
  - Source input for derived degree metrics in tree sorting.
- **Validation Rules**:
  - Every visible edge must connect two visible nodes.
  - Applying the same filters must produce identical visible node and edge sets regardless of active visualization mode.

## Entity: PhysicalTreeNode

- **Purpose**: Represents a visible physical structure node in the derived tree model.
- **Fields**:
  - `nodeId`: source graph node identifier
  - `label`: display name
  - `nodeType`: physical node type
  - `filePath`: owning file path or structural path
  - `parentNodeId`: visible physical parent identifier or null
  - `childNodeIds`: ordered visible physical children
  - `depth`: level inside the rendered tree
  - `rootId`: root group identifier
  - `inboundVisibleCount`: count of visible inbound non-structural relationships
  - `outboundVisibleCount`: count of visible outbound non-structural relationships
  - `isPromotedRoot`: whether the node became a root because no visible parent remained
- **Relationships**:
  - Belongs to exactly one rendered root group.
  - May participate in zero or more `TreeCrossLink` relationships.
- **Validation Rules**:
  - A physical node may appear at most once in the rendered tree.
  - If `parentNodeId` is null, the node must be part of the root collection.
  - If a visible physical parent exists, the node must use that parent rather than becoming a root.

## Entity: TreeRootGroup

- **Purpose**: Groups one top-level tree and its descendants when the filtered dataset has multiple roots.
- **Fields**:
  - `rootNodeId`: top-level physical node identifier
  - `descendantNodeIds`: all visible nodes contained under that root
  - `sortMode`: active sibling ordering rule used for this root
- **Relationships**:
  - Owns one or more `PhysicalTreeNode` instances.
- **Validation Rules**:
  - Root groups must be disjoint by node membership.
  - Every visible physical node must belong to exactly one root group.

## Entity: TreeCrossLink

- **Purpose**: Represents a visible non-physical relationship rendered as a dashed connector in tree mode.
- **Fields**:
  - `edgeId`: source graph relationship identifier
  - `sourceNodeId`: visible tree node identifier
  - `targetNodeId`: visible tree node identifier
  - `relationType`: visible relationship type
  - `dashStyle`: dashed visual marker
  - `isVisible`: whether both endpoints remain visible after current filters
- **Relationships**:
  - Connects two `PhysicalTreeNode` records that already exist in the rendered tree.
- **Validation Rules**:
  - Must never create new hierarchy nodes.
  - Must be hidden whenever either endpoint is not visible in the current snapshot.
  - Must respect the active relationship filter set.

## Entity: ExplorerSelectionContext

- **Purpose**: Captures the shared user context that must survive view changes.
- **Fields**:
  - `selectedNodeId`: selected node identifier or null
  - `focusedNodeId`: node currently used for camera/tree focus or null
  - `isCodePanelOpen`: whether the code/context panel is open
- **Relationships**:
  - Shared by both visualization modes and related panels.
- **Validation Rules**:
  - Switching views must preserve this context unless the selected node becomes ineligible under the active filters.
