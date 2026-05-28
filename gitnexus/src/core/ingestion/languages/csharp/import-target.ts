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
 * Returns true when `ctx` (path before a matched directory) ends with
 * `prefix` separated by `/` or `.`.
 *
 * Also checks a dot-normalized form of `ctx` (replacing `.` with `/`)
 * because C# project directory names use dots as namespace separators
 * (e.g. `Renju.Infrastructure`) while the stripped namespace prefix uses
 * slashes (e.g. `Renju/Infrastructure`). Without this, `using
 * Renju.Infrastructure.Model;` would not benefit from the context hint.
 *
 * Examples:
 *   "Renju.Infrastructure"       endsWith "Infrastructure"        → true
 *   "Renju.Infrastructure"       endsWith "Renju/Infrastructure"  → true
 *   "Renju.Infrastructure/Model" endsWith "Infrastructure/Model"  → true
 *   "Renju.Infrastructure.Tests" endsWith "Infrastructure"        → false
 *   "Renju.Infrastructure.Tests" endsWith "Renju/Infrastructure"  → false
 *   "src/Infrastructure"         endsWith "Infrastructure"        → true
 */
function contextEndsWithPrefix(ctx: string, prefix: string): boolean {
  if (ctx === prefix || ctx.endsWith('/' + prefix) || ctx.endsWith('.' + prefix)) return true;
  // Normalize dots → slashes so "Renju.Infrastructure" matches "Renju/Infrastructure".
  const ctxNorm = ctx.replace(/\./g, '/');
  return ctxNorm === prefix || ctxNorm.endsWith('/' + prefix);
}

/** A candidate file for directory-based namespace resolution. */
interface DirCandidate {
  raw: string;
  /** Path before the matched directory; undefined for root-anchored matches. */
  contextBefore?: string;
}

/**
 * Pick the best directory-child candidate when multiple `.cs` files
 * inside directories named `dirName/` are found. Priority order:
 *
 * 1. Same project root as the importing file (prevents test-project files
 *    from shadowing real model files when the importer is in the same
 *    project as the real target).
 * 2. Context before the matched directory ends with the stripped namespace
 *    prefix (handles the three-project case: importer in `Core/`, real
 *    target in `Infra/Model/`, confuser in `Infra.Tests/Model/`; the
 *    stripped prefix `Infra` aligns with `Infra/Model/`'s context).
 * 3. First candidate (original behaviour).
 */
function pickDirectoryChild(
  candidates: DirCandidate[],
  fromProjectRoot: string,
  strippedHint?: string,
): string | null {
  if (candidates.length === 0) return null;
  const sameProject = candidates.find(
    (c) => projectRoot(c.raw.replace(/\\/g, '/')) === fromProjectRoot,
  );
  if (sameProject) return sameProject.raw;
  if (strippedHint) {
    const hintMatch = candidates.find((c) =>
      contextEndsWithPrefix((c.contextBefore ?? '').replace(/\\/g, '/'), strippedHint),
    );
    if (hintMatch) return hintMatch.raw;
  }
  return candidates[0]?.raw ?? null;
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
  const dirCandidates: DirCandidate[] = [];
  const dirPrefix = `${pathLike}/`;
  const suffixDirPrefix = `/${dirPrefix}`;
  const fromFileNorm = ctx.fromFile.replace(/\\/g, '/');
  const fromProjectRoot = projectRoot(fromFileNorm);

  for (const raw of ctx.allFilePaths) {
    const f = raw.replace(/\\/g, '/');
    if (!f.endsWith('.cs')) continue;
    // Never resolve a using directive to the importing file itself.
    if (f === fromFileNorm) continue;
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
        dirCandidates.push({ raw });
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
    // Segments stripped from the front (e.g. "Infrastructure" for skip=1
    // on `using Infrastructure.Model;`). Used as a context hint: among
    // candidates whose paths contain `/Model/`, prefer the one whose
    // path before `/Model/` ends with "Infrastructure". This prevents
    // `Renju.Infrastructure.Tests/Model/` from shadowing
    // `Renju.Infrastructure/Model/` when the importer is in a third
    // project (`Renju.Core/`).
    const strippedHint = segments.slice(0, skip).join('/');
    const tail = segments.slice(skip).join('/');
    if (tail === '') continue;
    const tailFile = `${tail}.cs`;
    const tailSuffix = `/${tailFile}`;
    const tailDir = `${tail}/`;
    const tailSuffixDir = `/${tailDir}`;
    const tailCandidates: DirCandidate[] = [];
    for (const raw of ctx.allFilePaths) {
      const f = raw.replace(/\\/g, '/');
      if (!f.endsWith('.cs')) continue;
      if (f === fromFileNorm) continue;
      if (f === tailFile) return raw;
      if (f.endsWith(tailSuffix)) return raw;
      const atRoot = f.startsWith(tailDir);
      const atNested = f.includes(tailSuffixDir);
      if (atRoot || atNested) {
        const matchIdx = atRoot ? 0 : f.indexOf(tailSuffixDir) + 1;
        const contextBefore = atRoot ? '' : f.slice(0, f.indexOf(tailSuffixDir));
        const after = f.slice(matchIdx + tailDir.length);
        if (after.length > 0 && !after.includes('/')) {
          tailCandidates.push({ raw, contextBefore });
        }
      }
    }
    const best = pickDirectoryChild(tailCandidates, fromProjectRoot, strippedHint);
    if (best !== null) return best;
  }

  return null;
}
