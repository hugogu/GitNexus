# Research: Tree-Based Code View

## Decision 1: Use a dedicated tree renderer instead of extending Sigma

- **Decision**: Implement the tree-based view as a separate `TreeCanvas` renderer using existing `d3` utilities plus native SVG/HTML layering, while keeping Sigma dedicated to the force-directed view.
- **Rationale**: Sigma is already tuned around free-form graph layout, ForceAtlas2, and edge reducers. Tree-specific requirements such as multiple roots, stable sibling ordering, branch expansion, and dashed cross-links are easier to implement and reason about in a dedicated tree renderer than by bending Sigma into hierarchical behavior.
- **Alternatives considered**:
  - Reuse Sigma with fixed node coordinates: rejected because tree layout, expand/collapse, and orthogonal or layered cross-link rendering would be awkward and tightly coupled to current force-view assumptions.
  - Add a third-party React tree-graph package: rejected because `d3` is already installed and the feature does not justify a new dependency surface.

## Decision 2: Build a shared visible-graph selector for both view modes

- **Decision**: Extract a reusable visible-graph snapshot layer that applies `visibleLabels`, `visibleEdgeTypes`, `depthFilter`, and current selection once, then feeds both `GraphCanvas` and `TreeCanvas`.
- **Rationale**: The spec requires both views to honor the exact same filtering behavior. Today, depth and label filtering are applied inside Sigma-specific helpers. Moving this logic into a view-agnostic selector prevents drift between renderers and gives tests one authoritative place to validate visibility rules.
- **Alternatives considered**:
  - Reimplement filters separately inside the tree renderer: rejected because it creates behavioral drift risk and doubles test burden.
  - Leave all filtering in Sigma and let the tree infer visibility indirectly: rejected because the tree view needs direct access to the filtered node and edge sets.

## Decision 3: Derive hierarchy only from physical ownership edges, with orphan promotion

- **Decision**: The tree model will treat only physical node labels as eligible tree nodes and will derive parent-child structure from physical ownership relationships already present in the knowledge graph, prioritizing containment/definition ownership and promoting nodes to roots whenever no visible physical parent remains.
- **Rationale**: The user asked for a physical structure tree, not a dependency tree. Using only physical ownership keeps hierarchy legible, while orphan promotion ensures the tree still renders correctly after filters remove parents or when some nodes lack a complete structural chain.
- **Alternatives considered**:
  - Infer hierarchy from all edges: rejected because imports/calls/extends would collapse the structure into a dependency mesh rather than a tree.
  - Force a single synthetic root for every repository: rejected because the spec explicitly allows multiple roots and filters may legitimately split the visible structure.

## Decision 4: Render non-physical relationships as a separate dashed cross-link layer

- **Decision**: Tree mode will render non-physical visible relationships in a separate dashed path layer between already-visible tree nodes, preserving relation-type color coding while keeping structure links visually distinct.
- **Rationale**: This satisfies the requirement that calls, references, imports, and similar non-physical connections remain visible without turning them into hierarchy nodes. A separate overlay also makes it easier to hide or dim these links when filters or selection states change.
- **Alternatives considered**:
  - Encode non-physical relationships as nested pseudo-nodes: rejected because it breaks the mental model of physical structure.
  - Suppress non-physical links entirely in tree mode: rejected because the spec explicitly requires them.

## Decision 5: Keep view mode and tree sort mode in shared explorer state

- **Decision**: Extend shared graph/app state with a visualization mode (`force` vs `tree`) and a tree sort mode (`alphabetical`, `inboundDegree`, `outboundDegree`), while keeping node selection, focus depth, and filter state global to the explorer.
- **Rationale**: The feature’s main UX promise is that users can switch views without losing exploration context. Centralizing this state in the existing shared providers avoids prop-drilling and keeps both canvases synchronized.
- **Alternatives considered**:
  - Store sort mode and selected node locally in the tree renderer: rejected because switching views would reset context.
  - Add view-specific filter state: rejected because it violates the compatibility requirement and complicates mental models.

## Decision 6: Cover the feature with selector tests, tree-model tests, and explorer interaction tests

- **Decision**: Validate the feature with focused unit tests for visible-graph selection and tree-model ordering/rooting, plus targeted UI/e2e checks for view switching and state persistence.
- **Rationale**: Most risk lies in data derivation rather than raw rendering. Unit tests can harden orphan rooting, sort ordering, and filter compatibility, while one end-to-end pass confirms that switching between visual modes preserves user context.
- **Alternatives considered**:
  - Rely only on manual UI testing: rejected because tree derivation and filter parity are easy to regress silently.
  - Add only snapshot tests: rejected because the important behavior is interaction and state continuity, not static markup alone.
