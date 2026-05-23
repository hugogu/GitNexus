# UI Contract: Tree-Based Code View

## Purpose

Define the user-facing interaction contract for adding a tree-based repository visualization alongside the existing force-directed graph.

## Inputs

- A loaded `KnowledgeGraph` from the GitNexus backend
- Shared explorer state:
  - current selected node
  - visible node labels
  - visible relationship types
  - focus-depth filter
  - active visualization mode
  - active tree sort mode

## Output Surfaces

- Primary canvas in `force` mode
- Primary canvas in `tree` mode
- Shared left-side controls for filtering and navigation
- Shared node details and source navigation behavior

## Interaction Contract

### 1. View Switching

- The explorer MUST provide a direct control for switching between `force` and `tree`.
- Switching modes MUST preserve filters, focus depth, and current selection whenever the selected node remains visible.
- Switching modes MUST NOT trigger a repository reload.

### 2. Tree Eligibility

- Tree nodes MUST represent only physical structure elements.
- Non-physical concepts MUST NOT appear as tree nodes.
- If a visible physical node has no visible physical parent, it MUST appear as a root node.

### 3. Tree Ordering

- Users MUST be able to choose:
  - `alphabetical`
  - `inboundDegree`
  - `outboundDegree`
- The chosen ordering MUST apply consistently to every sibling group in the visible tree.
- Ties MUST resolve with a stable secondary ordering rule.

### 4. Cross-Link Rendering

- Visible non-physical relationships between visible tree nodes MUST render as dashed cross-links.
- Cross-links MUST respect the same relationship visibility rules used by the force-directed view.
- Cross-links MUST disappear when either endpoint becomes hidden.

### 5. Filter Compatibility

- Node-type filters MUST drive both visual modes from the same state.
- Relationship-type filters MUST drive both force edges and tree cross-links from the same state.
- Focus-depth filters MUST limit both visual modes to the same visible neighborhood around the current selection.

### 6. Selection and Focus

- Clicking a node in either mode MUST update the shared selected node.
- Selecting a node in tree mode MUST open the same downstream detail/navigation behavior used by the force view.
- Programmatic focus actions from shared controls MUST target whichever visualization mode is active.

### 7. Empty and Reduced States

- If filters remove all eligible tree nodes, the tree canvas MUST display a clear empty state.
- If a branch has no visible children after filtering, the branch MUST remain structurally valid and MUST NOT duplicate nodes elsewhere in the tree.

## Acceptance Mapping

- `FR-001`, `FR-013`: covered by view-switch behavior
- `FR-002` to `FR-006`, `FR-016`: covered by tree eligibility and cross-link rules
- `FR-007` to `FR-009`: covered by tree ordering rules
- `FR-010` to `FR-015`: covered by filter, selection, and empty-state rules
