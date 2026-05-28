/**
 * Adapter from `(ParsedImport, WorkspaceIndex)` → concrete file path.
 *
 * Unit 2 shape: suffix-match against the repo's `.cs` files. Each
 * `using System.Collections.Generic;` could legally expand to multiple
 * files (every `.cs` that declares `namespace System.Collections.Generic`
 * — partial classes, assembly-wide namespaces). The scope-resolver
 * contract returns a single primary target, so we pick the first
 * match. Cross-file partial-class aggregation runs at graph-bridge
 * time (Unit 6) via `populateOwners`.
 *
 * The legacy csproj-based `resolveCSharpImportInternal` needs config
 * objects the scope-resolver doesn't carry; the Unit 7 parity gate
 * will surface cases where the suffix-match diverges from the
 * namespace-based resolver and we'll adjust the contract if needed.
 *
 * Returning `null` lets the finalize algorithm mark the edge as
 * `linkStatus: 'unresolved'`.
 */

import type { ParsedImport, WorkspaceIndex } from 'gitnexus-shared';

export interface CsharpResolveContext {
  readonly fromFile: string;
  readonly allFilePaths: ReadonlySet<string>;
}

/**
 * Return the top-level directory segment of a normalized file path
 * (i.e., everything before the first `/`). Used to identify which
 * project a file belongs to in a multi-project repo layout where each
 * project lives in its own top-level directory (e.g. `Renju.Core`,
 * `Renju.Infrastructure`, `Renju.Infrastructure.Tests`).
 *
 * Returns the full path when no `/` is present (single-segment path).
 */
function projectRoot(normalizedPath: string): string {
  const idx = normalizedPath.indexOf('/');
  return idx === -1 ? normalizedPath : normalizedPath.slice(0, idx);
}

/**
 * Pick the best directory-child candidate when multiple `.cs` files
 * inside directories named `dirName/` are found. Prefers the file
 * whose top-level project directory matches `fromProjectRoot`; falls
 * back to any candidate otherwise. This prevents a test-project file
 * in `Tests/Model/Foo.cs` from being chosen over the real model file
 * in `App/Model/Bar.cs` when both live in a directory named `Model/`.
 */
function pickDirectoryChild(candidates: string[], fromProjectRoot: string): string | null {
  if (candidates.length === 0) return null;
  const sameProject = candidates.find(
    (c) => projectRoot(c.replace(/\\/g, '/')) === fromProjectRoot,
  );
  return sameProject ?? candidates[0] ?? null;
}

export function resolveCsharpImportTarget(
  parsedImport: ParsedImport,
  workspaceIndex: WorkspaceIndex,
): string | null {
  // WorkspaceIndex is `unknown` in the shared contract (Ring 1
  // placeholder). The scope-resolution orchestrator hands us a
  // CsharpResolveContext-shaped object; narrow structurally rather
  // than via a cast chain so unexpected shapes return null cleanly.
  const ctx = workspaceIndex as CsharpResolveContext | undefined;
  if (
    ctx === undefined ||
    typeof (ctx as { fromFile?: unknown }).fromFile !== 'string' ||
    !((ctx as { allFilePaths?: unknown }).allFilePaths instanceof Set)
  ) {
    return null;
  }
  if (parsedImport.kind === 'dynamic-unresolved') return null;
  if (parsedImport.targetRaw === null || parsedImport.targetRaw === '') return null;

  // Namespace path: `System.Collections.Generic` → `System/Collections/Generic`.
  const pathLike = parsedImport.targetRaw.replace(/\./g, '/');
  const suffix = `/${pathLike}`;

  // Exact file match: `System/Collections/Generic.cs` (rare but legal).
  // Suffix match for nested layouts: `src/lib/System/Collections/Generic.cs`.
  // Directory match: first `.cs` file directly inside the namespace dir
  // (e.g. `System/Collections/Generic/List.cs` matches namespace Generic).
  let exactFile: string | null = null;
  let suffixFile: string | null = null;
  const dirCandidates: string[] = [];
  const dirPrefix = `${pathLike}/`;
  const suffixDirPrefix = `/${dirPrefix}`;
  const fromProjectRoot = projectRoot(ctx.fromFile.replace(/\\/g, '/'));

  for (const raw of ctx.allFilePaths) {
    const f = raw.replace(/\\/g, '/');
    if (!f.endsWith('.cs')) continue;
    if (f === `${pathLike}.cs`) {
      exactFile = raw;
      break;
    }
    if (suffixFile === null && f.endsWith(`${suffix}.cs`)) {
      suffixFile = raw;
    }
    // Namespace-to-directory match: collect all `.cs` files directly in
    // the namespace dir (not nested deeper). Multiple projects can have a
    // directory with the same name (e.g. both `App/Model/` and
    // `App.Tests/Model/`). Collecting all candidates first lets
    // `pickDirectoryChild` prefer the file whose project root matches the
    // importer — preventing test-project files from shadowing real ones.
    const atRoot = f.startsWith(dirPrefix);
    const atNested = f.includes(suffixDirPrefix);
    if (atRoot || atNested) {
      const idx = atRoot ? 0 : f.indexOf(suffixDirPrefix) + 1;
      const after = f.slice(idx + dirPrefix.length);
      if (after.length > 0 && !after.includes('/')) {
        dirCandidates.push(raw);
      }
    }
  }

  if (exactFile !== null) return exactFile;
  if (suffixFile !== null) return suffixFile;
  const directoryChild = pickDirectoryChild(dirCandidates, fromProjectRoot);
  if (directoryChild !== null) return directoryChild;

  // Progressive prefix stripping — mirrors csproj's root-namespace
  // mapping without the csproj. `using CrossFile.Models;` in a repo
  // laid out `Models/User.cs` (no `CrossFile/` prefix) works because
  // the legacy resolver consults csproj; the scope-resolver layer
  // doesn't have csproj, so we try each suffix of the namespace path
  // against `.cs` files and directories.
  //
  // Also handles `using static CrossFile.Models.UserFactory;` —
  // strip the leading segment, try `Models/UserFactory.cs`; strip
  // two, try `UserFactory.cs`.
  const segments = pathLike.split('/').filter(Boolean);
  for (let skip = 1; skip < segments.length; skip++) {
    const tail = segments.slice(skip).join('/');
    if (tail === '') continue;
    const tailFile = `${tail}.cs`;
    const tailSuffix = `/${tailFile}`;
    const tailDir = `${tail}/`;
    const tailSuffixDir = `/${tailDir}`;
    const tailCandidates: string[] = [];
    for (const raw of ctx.allFilePaths) {
      const f = raw.replace(/\\/g, '/');
      if (!f.endsWith('.cs')) continue;
      if (f === tailFile) return raw;
      if (f.endsWith(tailSuffix)) return raw;
      const atRoot = f.startsWith(tailDir);
      const atNested = f.includes(tailSuffixDir);
      if (atRoot || atNested) {
        const idx = atRoot ? 0 : f.indexOf(tailSuffixDir) + 1;
        const after = f.slice(idx + tailDir.length);
        if (after.length > 0 && !after.includes('/')) tailCandidates.push(raw);
      }
    }
    const best = pickDirectoryChild(tailCandidates, fromProjectRoot);
    if (best !== null) return best;
  }

  return null;
}
