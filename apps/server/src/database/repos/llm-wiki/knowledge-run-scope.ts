// Pure helpers that reconcile the page scope of a Knowledge Space Run. They
// live in their own dependency-free module so both the compilation repo (which
// coalesces incoming requests) and the execution repo (which detects
// source/image snapshot changes mid-run) can share one authoritative scope
// semantics without importing each other's runtime.

/**
 * Reconciles the page scope of a coalescing target Run with an incoming
 * request. A full-Space request (no target pages) always widens the Run to
 * full scope; two page-scoped inputs union; a page-scoped request against an
 * already full-Space Run leaves it full (the page is already covered).
 * Returns the new scope, or `undefined` when the scope is unchanged.
 */
export function reconcileRunTargetScope(input: {
  runTargetSourcePageIds: string[] | null;
  requestTargetSourcePageIds: string[] | undefined;
}): { changed: boolean; targetSourcePageIds: string[] | null } {
  const runTarget = input.runTargetSourcePageIds;
  const requestTarget = input.requestTargetSourcePageIds;
  const requestIsFullSpace = !requestTarget || requestTarget.length === 0;
  // A full-Space Run already covers every page; nothing to widen or union.
  if (runTarget === null) {
    return { changed: false, targetSourcePageIds: null };
  }
  // A full-Space request widens a page-scoped Run to the whole Space.
  if (requestIsFullSpace) {
    return { changed: true, targetSourcePageIds: null };
  }
  const union = [...new Set([...runTarget, ...requestTarget!])];
  const changed = union.length !== runTarget.length;
  return { changed, targetSourcePageIds: union };
}

/**
 * Resolves the scope that an already initialized Run leaves to its follow-up.
 * A full-Space Run has already frozen its own plan, so the first later page
 * edit can safely narrow the follow-up to that page. Once a full follow-up has
 * explicitly been requested, later page edits must not narrow it again.
 */
export function reconcileFollowUpTargetScope(input: {
  followUpTargetSourcePageIds: string[] | null;
  requestTargetSourcePageIds: string[] | undefined;
  rerunAlreadyRequested: boolean;
}): { changed: boolean; targetSourcePageIds: string[] | null } {
  if (
    !input.rerunAlreadyRequested &&
    input.requestTargetSourcePageIds?.length
  ) {
    return {
      changed: true,
      targetSourcePageIds: [...new Set(input.requestTargetSourcePageIds)],
    };
  }
  return reconcileRunTargetScope({
    runTargetSourcePageIds: input.followUpTargetSourcePageIds,
    requestTargetSourcePageIds: input.requestTargetSourcePageIds,
  });
}

/**
 * Normalizes a request's target page list to either a de-duplicated non-empty
 * array (page-scoped) or null (full-Space). Empty input is treated as
 * full-Space so callers cannot accidentally create a Run that compiles nothing.
 */
export function normalizeTargetSourcePageIds(
  value: string[] | undefined,
): string[] | null {
  if (!value) return null;
  const unique = [...new Set(value.filter((id) => id.length > 0))];
  return unique.length > 0 ? unique : null;
}

/** Reads the persisted JSON scope of a Run back into a string[] or null. */
export function parseTargetSourcePageIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === 'string');
  return ids.length > 0 ? ids : null;
}
