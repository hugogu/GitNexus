# Quickstart: Tree-Based Code View

## Prerequisites

1. Install dependencies for both packages if they are not already installed.
2. Start the GitNexus backend server from the repository root backend package.
3. Start the GitNexus web client from the frontend package.

## Launch

```bash
cd /Users/gqq/OpenSource/GitNexus/gitnexus && npm run serve
```

```bash
cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npm run dev
```

Open the web client, connect to the local GitNexus server, and load an indexed repository.

## Verification Flow

1. Load a repository and confirm the existing force-directed graph appears.
2. Switch to the new tree-based view and confirm that the main canvas changes to a multi-root hierarchy made of physical structure nodes only.
3. Expand a branch until a file, class, and function are visible, then confirm each node appears once in the hierarchy.
4. Toggle node and edge filters in the left panel and confirm the tree view and force view both show the same eligible nodes and relationships.
5. Select a node, apply a focus-depth filter, and confirm the visible tree contracts to the same neighborhood that the force view would show.
6. Change sibling ordering to alphabetical, inbound degree, and outbound degree, and confirm ordering updates without losing the current selection.
7. Confirm non-physical relationships between visible nodes appear as dashed cross-links instead of extra tree nodes.
8. Switch back to the force-directed view and confirm selection, filters, and focus context remain intact.

## Recommended Validation Commands

```bash
cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npm test
```

```bash
cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npx tsc -b --noEmit
```

```bash
cd /Users/gqq/OpenSource/GitNexus/gitnexus-web && npm run test:e2e
```
