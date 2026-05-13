<!--
SYNC IMPACT REPORT
- Version change: initial → 1.0.0
- Modified principles: none (initial adoption)
- Added sections: all (initial adoption)
- Removed sections: none
- Templates requiring updates: none (no templates exist yet)
- Follow-up TODOs: none
- Ratification date: TODO(RATIFICATION_DATE): mark when formally adopted by maintainers
-->

# GitNexus Project Constitution

**Version:** 1.0.0

**Last Amended:** 2026-05-13

**Ratified:** TODO(RATIFICATION_DATE): mark when formally adopted by maintainers

---

## Preamble

This constitution governs all development activity in the GitNexus project — a code intelligence platform that indexes codebases into knowledge graphs and exposes them through MCP tools. It applies to human contributors and AI agents alike. The principles below are non-negotiable; they exist to preserve correctness, security, and velocity across a multi-package monorepo with published artifacts.

---

## Principles

### 1. Security & Secrets Hygiene

- **Rule:** API keys, tokens, real `.env` values, private URLs, and session cookies MUST NOT be committed. Use `.env.example` with placeholders only.
- **Rule:** Production credentials and other people's machines are off-limits without explicit authorization.
- **Rationale:** A single leaked secret can compromise users, CI pipelines, and published artifacts. Prevention is cheaper than rotation.

### 2. Impact Analysis Before Mutation

- **Rule:** Before editing any shared symbol (function, class, method, interface, or type consumed by other modules), run `gitnexus_impact` with `direction: "upstream"` to determine blast radius.
- **Rule:** Do not proceed with HIGH or CRITICAL risk changes without maintainer sign-off.
- **Rationale:** GitNexus exists to prevent breaking changes. Ignoring its own impact analysis defeats the purpose and ships regressions.

### 3. Graph-Aware Refactoring

- **Rule:** Never rename symbols with plain find-and-replace. Use the `gitnexus_rename` tool with `dry_run: true` first, then review graph edits versus text_search edits before applying.
- **Rule:** After any refactor, run `gitnexus_detect_changes` to verify the affected scope matches expectations.
- **Rationale:** Text-only renames miss dynamic dispatch, reflection, and string-based references. Graph-aware renames are safer and auditable.

### 4. Testing Discipline

- **Rule:** All changes MUST pass tests for the packages they touch (`gitnexus` and/or `gitnexus-web`).
- **Rule:** Typecheck MUST pass: `npx tsc --noEmit` in `gitnexus/` and `npx tsc -b --noEmit` in `gitnexus-web/`.
- **Rule:** The pre-commit hook (formatting via lint-staged + typecheck for staged packages) MUST run clean.
- **Rationale:** CI is the last line of defense, not the first. Local validation prevents broken commits and noisy build failures.

### 5. Minimal Scope & Focused Diffs

- **Rule:** Write only the files required for the fix or feature. Do not include unrelated formatting, refactors, or stylistic changes.
- **Rule:** Update lockfiles when dependencies change, but do not bump unrelated deps.
- **Rationale:** Focused diffs are faster to review, easier to bisect, and reduce the chance of accidental regressions.

### 6. Conventional Commits & Release Hygiene

- **Rule:** Pull request titles MUST follow the conventional-commit format: `<type>[(scope)][!]: <subject>`.
- **Rule:** Allowed types and their release-notes mapping are fixed (see CONTRIBUTING.md). Use `!` or `BREAKING CHANGE:` to flag incompatible changes.
- **Rule:** Version bumps MUST be intentional. npm and Docker images are version-locked and signed.
- **Rationale:** Automated release notes, changelog generation, and supply-chain traceability depend on consistent commit conventions.

### 7. Supply Chain Integrity

- **Rule:** Do not publish from unreviewed automation.
- **Rule:** Docker images MUST be signed with Cosign. Stable images are only published from `v*` tags that match `package.json` version exactly.
- **Rule:** Kubernetes deployments SHOULD enforce the bundled `ClusterImagePolicy` to reject unsigned images.
- **Rationale:** Users rely on signed artifacts for supply-chain protection. Bypassing these controls exposes the project to tampering and typosquatting.

### 8. Embeddings Preservation

- **Rule:** Plain `npx gitnexus analyze` preserves existing embeddings. Pass `--embeddings` explicitly to also generate vectors for new or changed nodes.
- **Rule:** Pass `--drop-embeddings` only when an explicit wipe is intended (e.g., model swap or dimension change).
- **Rationale:** Embeddings are expensive to regenerate. Accidental wipes degrade semantic search quality and waste compute.

### 9. Staleness Awareness

- **Rule:** If MCP warns the index is behind `HEAD`, or search results do not match the latest commit, re-run `npx gitnexus analyze` (plus `--embeddings` if used).
- **Rule:** If the index appears corrupt or incremental writeback is inconsistent, use `npx gitnexus analyze --force` to rebuild from scratch.
- **Rationale:** Tools query the last analyzed state. Working against a stale or corrupt graph produces incorrect impact results and misleading context.

### 10. Documentation Parity

- **Rule:** Update documentation when behavior, public CLI contracts, or MCP tool schemas change.
- **Rule:** Architecture decisions that affect multiple packages MUST be recorded in ARCHITECTURE.md.
- **Rationale:** Documentation is a first-class artifact. Outdated docs waste contributor time and erode trust in the project's reliability.

---

## Governance

### Amendment Procedure

1. Propose changes via GitHub issue or pull request.
2. Any modification to principles requires review by at least one maintainer.
3. MAJOR version bumps (backward-incompatible principle removals or redefinitions) require maintainer consensus.
4. MINOR version bumps (new principle or materially expanded guidance) require maintainer approval.
5. PATCH version bumps (clarifications, wording, typo fixes) may be merged by any contributor with write access, provided CI passes.

### Versioning Policy

- **MAJOR (X.0.0):** Backward-incompatible governance changes — principle removals, redefinitions that alter compliance obligations.
- **MINOR (x.Y.0):** New principle added, new section introduced, or materially expanded guidance.
- **PATCH (x.y.Z):** Clarifications, wording improvements, typo fixes, non-semantic refinements.

### Compliance Review

- This constitution MUST be reviewed quarterly or after any release that adds/removes MCP tools, changes the ingestion pipeline, or alters the graph schema.
- The review checks that all principles remain applicable, accurate, and free of drift from actual project practice.

---

## Enforcement

- Violations of Principles 1 (Security), 2 (Impact Analysis), and 7 (Supply Chain) are considered critical and MUST block merge.
- Violations of Principles 4 (Testing), 5 (Minimal Scope), and 6 (Conventional Commits) SHOULD block merge unless explicitly waived by a maintainer.
- Violations of Principles 3 (Graph-Aware), 8 (Embeddings), 9 (Staleness), and 10 (Documentation) SHOULD be flagged in code review and remediated before merge when feasible.
