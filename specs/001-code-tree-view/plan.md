# Implementation Plan: Tree-Based Code View

**Branch**: `001-code-tree-view` | **Date**: 2026-05-23 | **Spec**: [spec.md](/Users/gqq/OpenSource/GitNexus/specs/001-code-tree-view/spec.md)  
**Input**: Feature specification from `/specs/001-code-tree-view/spec.md`

## Summary

Add a second primary visualization mode to the existing GitNexus web explorer so users can switch between the current force-directed graph and a tree-based structure view. The implementation will keep node filters, edge filters, focus-depth, and selection as shared state; introduce a dedicated tree renderer for physical hierarchy; and reuse the same visible node/edge snapshot so both views stay behaviorally consistent.

## Technical Context

**Language/Version**: TypeScript 5.4, React 19, Node.js 20+/22+ toolchain  
**Primary Dependencies**: React, Vite, graphology, Sigma 3, D3 7, gitnexus-shared, Vitest, Playwright  
**Storage**: In-memory `KnowledgeGraph` hydrated from `gitnexus serve` HTTP responses; no new persistent client storage  
**Testing**: `cd gitnexus-web && npm test`, `cd gitnexus-web && npx tsc -b --noEmit`, targeted Playwright coverage for explorer interactions  
**Target Platform**: Desktop browser UI served by Vite, backed by the GitNexus HTTP API  
**Project Type**: Monorepo web application with shared TypeScript package  
**Performance Goals**: View switching and tree sort changes should feel immediate on representative repos and remain within the spec target of stable results inside 2 seconds  
**Constraints**: Preserve existing filter compatibility, preserve selection across view switches, render only physical nodes in the tree, avoid duplicating nodes across branches, avoid new runtime dependencies if existing stack is sufficient  
**Scale/Scope**: Frontend-only explorer feature spanning shared graph state, graph-derived selectors, a new tree canvas, and matching unit/e2e coverage

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is not present in this repository, so this check is derived from the governing rules in [AGENTS.md](/Users/gqq/OpenSource/GitNexus/AGENTS.md) and [GUARDRAILS.md](/Users/gqq/OpenSource/GitNexus/GUARDRAILS.md).

- **Minimal scope**: PASS. Planned changes are limited to `gitnexus-web/` explorer state/rendering plus feature documentation under this spec directory.
- **Shared-symbol safety**: PASS for planning. Implementation tasks must run GitNexus impact analysis before editing shared frontend state or render pipeline symbols such as `GraphStateProvider`, `useAppState`, `GraphCanvas`, `FileTreePanel`, and graph adapters.
- **Dependency discipline**: PASS. Design uses already-installed `d3` and existing graph state instead of adding a new visualization library.
- **Validation discipline**: PASS. Plan includes unit tests, typecheck, and targeted interaction verification before commit.
- **Secrets/destructive operations**: PASS. No secrets, migrations, or destructive workflows are introduced.

**Post-design re-check**:

- **Architecture fit**: PASS. A dedicated tree renderer and a shared visible-graph selector keep the new view additive and avoid destabilizing the existing Sigma force view.
- **Operational safety**: PASS. No backend schema, MCP contract, or indexing changes are required.
- **Testing sufficiency**: PASS. Planned coverage includes selector logic, tree ordering/rooting behavior, and end-to-end state persistence between views.

## Project Structure

### Documentation (this feature)

```text
specs/001-code-tree-view/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── tree-view-ui-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
gitnexus-web/
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── FileTreePanel.tsx
│   │   ├── GraphCanvas.tsx
│   │   ├── Header.tsx
│   │   └── TreeCanvas.tsx
│   ├── hooks/
│   │   ├── useAppState.tsx
│   │   └── app-state/graph.tsx
│   └── lib/
│       ├── constants.ts
│       ├── graph-adapter.ts
│       ├── graph-visibility.ts
│       └── tree-view-model.ts
├── test/
│   ├── fixtures/
│   └── unit/
└── e2e/

gitnexus-shared/
└── src/
    └── graph/
        └── types.ts
```

**Structure Decision**: Keep the feature entirely inside `gitnexus-web/` unless implementation proves a shared type addition is necessary. The force-view renderer remains in `GraphCanvas.tsx`; the new tree renderer lives beside it in `TreeCanvas.tsx`; shared filtering/visibility derivation moves into reusable `lib/` helpers so both canvases consume the same visible graph snapshot.

## Phase 0: Research Plan

1. Confirm whether the tree view should reuse Sigma or use a dedicated renderer.
2. Define a single source of truth for visible nodes/edges across both view modes.
3. Define how physical hierarchy is derived from graph relationships while keeping orphan-safe multi-root behavior.
4. Define how non-physical relationships are rendered in tree mode without becoming hierarchy nodes.
5. Define how current filters and selection persist across force/tree switching.

## Phase 1: Design Plan

1. Model view state, sort state, visible graph snapshot, physical tree nodes, and tree cross-links.
2. Document the UI interaction contract for switching views, sorting, filtering, and selection persistence.
3. Describe the concrete implementation slices for:
   - shared graph visibility selector
   - tree model builder
   - tree renderer
   - app shell/view switch wiring
   - automated verification
4. Update agent context after design artifacts are written.

## Implementation Notes

### Impact Analysis Findings

- `GraphStateProvider`: LOW risk. Direct callers are limited to the shared app-state provider layer, so additive state fields are safe as long as defaults preserve current explorer behavior.
- `useAppState`: HIGH risk. This selector fans out into the explorer shell, graph canvas, header, right panel, process/code panels, and settings flows. Implementation must stay backward-compatible and avoid changing existing state semantics.
- `GraphCanvas`: LOW risk. Upstream usage is limited to the main explorer shell, which makes it safe to refactor filtering behind a shared visible-graph snapshot as long as Sigma selection and focus behavior remain unchanged.
- `FileTreePanel`: LOW risk. It is isolated to the explorer left rail, so adding tree-mode controls is safe provided existing file navigation and filter toggles remain available.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
