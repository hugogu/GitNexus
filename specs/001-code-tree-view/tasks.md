# Tasks: Tree-Based Code View

**Input**: Design documents from `/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/`  
**Prerequisites**: [plan.md](/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/plan.md), [spec.md](/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/spec.md), [research.md](/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/research.md), [data-model.md](/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/data-model.md), [tree-view-ui-contract.md](/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/contracts/tree-view-ui-contract.md)

**Tests**: This task list includes verification tasks because the implementation plan explicitly requires matching unit and interaction coverage for shared visibility selectors, tree derivation, and cross-view state persistence.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated as an incremental delivery slice.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the implementation surface and capture the shared-symbol safety work required before editing explorer state.

- [X] T001 Capture GitNexus impact-analysis findings for `GraphStateProvider`, `useAppState`, `GraphCanvas`, and `FileTreePanel` in /Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/plan.md
- [X] T002 Create tree-view implementation scaffolds in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/graph-visibility.ts, /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/tree-view-model.ts, and /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx
- [X] T003 [P] Extend tree-view test fixtures for physical hierarchy and non-physical links in /Users/gqq/OpenSource/GitNexus/gitnexus-web/test/fixtures/graph.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the shared explorer state and reusable graph-derivation layer that all user stories depend on.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [X] T004 Add `force`/`tree` visualization mode state and tree sort mode state in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/hooks/app-state/graph.tsx
- [X] T005 Update shared app-state selectors and focus helpers for active visualization routing in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/hooks/useAppState.tsx
- [X] T006 [P] Define physical-node eligibility and tree sort option metadata in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/constants.ts
- [X] T007 [P] Implement reusable visible-node and visible-edge snapshot selectors in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/graph-visibility.ts
- [X] T008 [P] Implement physical tree node, root group, and cross-link derivation utilities in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/tree-view-model.ts
- [X] T009 Update active-canvas focus delegation in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/App.tsx

**Checkpoint**: Shared visibility/state infrastructure is ready; user stories can now proceed in priority order.

---

## Phase 3: User Story 1 - Read Repository Structure Faster (Priority: P1) 🎯 MVP

**Goal**: Add a switchable tree-based main view that renders only the physical structure hierarchy as a multi-root tree.

**Independent Test**: Load a repository, switch to tree view, and navigate from one or more roots down to a file/class/function without falling back to the force-directed layout.

- [X] T010 [US1] Add a primary force/tree view switch and conditional main-canvas mounting in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/App.tsx
- [X] T011 [P] [US1] Implement multi-root physical hierarchy rendering and branch expansion in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx
- [X] T012 [P] [US1] Extend explorer controls and tree empty-state entry points in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/FileTreePanel.tsx
- [X] T013 [US1] Wire tree-node selection, focus, and code-panel navigation behavior in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx

**Checkpoint**: User Story 1 is complete when users can explore repository structure in the tree view and inspect selected nodes independently of the force-directed canvas.

---

## Phase 4: User Story 2 - Inspect Complexity and Dependencies in Context (Priority: P2)

**Goal**: Let users reorder siblings by name or visible degree and inspect non-physical relationships as dashed cross-links without leaving the tree view.

**Independent Test**: In tree view, switch between alphabetical, inbound-degree, and outbound-degree ordering, then confirm dashed cross-links remain visible between eligible nodes.

- [X] T014 [US2] Add alphabetical, inbound-degree, and outbound-degree sibling ordering with stable tie-breaking in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/tree-view-model.ts
- [X] T015 [P] [US2] Add tree sort controls and sort-state presentation in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/FileTreePanel.tsx
- [X] T016 [P] [US2] Render dashed non-physical cross-links with relationship styling in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx
- [X] T017 [US2] Surface visible inbound/outbound degree context and stable ordering affordances in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx

**Checkpoint**: User Story 2 is complete when users can detect high-connection hotspots from within the tree view using ordering and dashed relationship overlays alone.

---

## Phase 5: User Story 3 - Keep Existing Exploration Controls Consistent (Priority: P3)

**Goal**: Make force view and tree view share the same filters, selection, focus depth, and navigation context so switching views preserves exploration progress.

**Independent Test**: Apply node filters, edge filters, and focus depth in one view, select a visible node, switch views, and confirm the other view shows the same eligible nodes, relationships, and selection context.

- [X] T018 [US3] Refactor force-view filtering to consume the shared visible snapshot in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/GraphCanvas.tsx
- [X] T019 [P] [US3] Apply node-type, edge-type, and focus-depth compatibility rules in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx
- [X] T020 [P] [US3] Handle hidden-parent root promotion and single-instance node placement in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/tree-view-model.ts
- [X] T021 [US3] Preserve selected node, code-panel state, and active focus context across force/tree switches in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/hooks/useAppState.tsx and /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/App.tsx

**Checkpoint**: User Story 3 is complete when users can move between visual modes without reapplying filters or losing eligible selection context.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden behavior, verify contracts, and validate the shipped flow against the quickstart.

- [X] T022 [P] Add unit coverage for shared visibility selection in /Users/gqq/OpenSource/GitNexus/gitnexus-web/test/unit/graph-visibility.test.ts
- [X] T023 [P] Add unit coverage for tree roots, ordering, and cross-links in /Users/gqq/OpenSource/GitNexus/gitnexus-web/test/unit/tree-view-model.test.ts
- [X] T024 [P] Add explorer interaction coverage for tree controls and view switching in /Users/gqq/OpenSource/GitNexus/gitnexus-web/test/unit/tree-view-panel.test.tsx
- [X] T025 [P] Add end-to-end force/tree persistence coverage in /Users/gqq/OpenSource/GitNexus/gitnexus-web/e2e/tree-view.spec.ts
- [X] T026 Run `cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npm test`, `cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npx tsc -b --noEmit`, and `cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npm run test:e2e`, then record any verification-driven quickstart updates in /Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks all user story work.
- **User Story 1 (Phase 3)**: Starts after Foundational and establishes the tree-view MVP shell.
- **User Story 2 (Phase 4)**: Starts after User Story 1 establishes the tree canvas and shared tree model.
- **User Story 3 (Phase 5)**: Starts after Foundational, but should land after the User Story 1 tree shell is in place so cross-view parity can be verified against a real tree renderer.
- **Polish (Phase 6)**: Starts after the targeted user stories are implemented.

### User Story Dependency Graph

```text
Setup -> Foundational -> US1 -> US2
                       \-> US3
US2 + US3 -> Polish
```

### Within Each User Story

- Shared selectors and tree derivation must exist before view-specific rendering tasks.
- Tree renderer shell must exist before sort controls or cross-link overlays are added.
- Cross-view persistence tasks should land after both canvases can render the same repository state.
- Verification tasks should run after the corresponding behavior is implemented.

### Parallel Opportunities

- `T003`, `T006`, `T007`, and `T008` can proceed in parallel once setup begins.
- In **US1**, `T011` and `T012` can run in parallel after `T010`.
- In **US2**, `T015` and `T016` can run in parallel after `T014` starts shaping the tree sort contract.
- In **US3**, `T019` and `T020` can run in parallel once the shared visible snapshot is available.
- In **Polish**, `T022` to `T025` can run in parallel before the final validation pass in `T026`.

---

## Parallel Example: User Story 1

```bash
Task: "Implement multi-root physical hierarchy rendering and branch expansion in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx"
Task: "Extend explorer controls and tree empty-state entry points in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/FileTreePanel.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "Add tree sort controls and sort-state presentation in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/FileTreePanel.tsx"
Task: "Render dashed non-physical cross-links with relationship styling in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx"
```

## Parallel Example: User Story 3

```bash
Task: "Apply node-type, edge-type, and focus-depth compatibility rules in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/components/TreeCanvas.tsx"
Task: "Handle hidden-parent root promotion and single-instance node placement in /Users/gqq/OpenSource/GitNexus/gitnexus-web/src/lib/tree-view-model.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate that users can switch into a physical multi-root tree and inspect selected nodes.
5. Demo the tree-view MVP before layering on complexity and compatibility work.

### Incremental Delivery

1. Land the shared state and visible snapshot once.
2. Ship **US1** as the first usable tree-view increment.
3. Add **US2** to make complexity hotspots discoverable inside tree mode.
4. Add **US3** to make tree/force switching seamless for existing users.
5. Finish with automated coverage and quickstart verification.

### Parallel Team Strategy

1. One engineer completes Setup + Foundational.
2. After the shared snapshot and tree model are stable:
   - Engineer A drives `TreeCanvas` and `App.tsx` tasks for **US1**
   - Engineer B adds ordering controls and cross-links for **US2**
   - Engineer C hardens cross-view parity and validation for **US3**
3. A final pass lands shared tests and end-to-end verification.

---

## Notes

- `[P]` tasks touch different files or depend only on already-complete shared primitives.
- `US1` is the suggested MVP scope.
- Story task counts:
  - `US1`: 4 tasks
  - `US2`: 4 tasks
  - `US3`: 4 tasks
- Shared/non-story task counts:
  - Setup: 3 tasks
  - Foundational: 6 tasks
  - Polish: 5 tasks
- Total task count: 26
