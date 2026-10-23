export type KnowledgeIndexMode = 'compiled' | 'original';

export const DEFAULT_KNOWLEDGE_INDEX_MODE: KnowledgeIndexMode = 'compiled';

/**
 * Page-level publish mode choice. `inherit` means the page has no override
 * and follows the Space's `settings.knowledge.indexMode`.
 */
export type KnowledgePageIndexModeChoice = KnowledgeIndexMode | 'inherit';

export const KNOWLEDGE_PAGE_INDEX_MODE_INHERIT = 'inherit' as const;

export function isKnowledgeIndexMode(
  value: unknown,
): value is KnowledgeIndexMode {
  return value === 'compiled' || value === 'original';
}

/** Reads the Space-level default from a `spaces.settings` JSON value. */
export function readSpaceKnowledgeIndexMode(
  settings: unknown,
): KnowledgeIndexMode {
  const mode = (settings as { knowledge?: { indexMode?: unknown } } | null)
    ?.knowledge?.indexMode;
  return isKnowledgeIndexMode(mode) ? mode : DEFAULT_KNOWLEDGE_INDEX_MODE;
}

/** Page override wins over the Space default. */
export function resolveEffectiveKnowledgeIndexMode(input: {
  pageIndexMode: KnowledgeIndexMode | null;
  spaceIndexMode: KnowledgeIndexMode;
}): KnowledgeIndexMode {
  return input.pageIndexMode ?? input.spaceIndexMode;
}
