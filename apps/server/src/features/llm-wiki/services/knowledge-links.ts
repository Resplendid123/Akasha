import { CompiledKnowledgeArtifact } from '../types/compiler-artifact.types';
import { KnowledgeSourceRef } from '../types/knowledge.types';

type Link = NonNullable<CompiledKnowledgeArtifact['links']>[number];
/** One page-link identity retains the union of its source dependencies. */
export function mergeKnowledgeLinks(links: Link[]): Link[] {
  const result = new Map<string, Link>();
  for (const link of links) {
    const key = JSON.stringify([link.toKnowledgePageId, link.linkType]);
    const previous = result.get(key);
    const refs = [...(previous?.inputSourceRefs ?? []), ...(link.inputSourceRefs ?? [])];
    const merged = [...new Map(refs.map(ref => [sourceIdentity(ref), ref])).values()];
    result.set(key, {
      linkType: link.linkType,
      linkText: previous?.linkText ?? link.linkText,
      toKnowledgePageId: link.toKnowledgePageId,
      ...(merged.length ? { inputSourceRefs: merged } : {}),
    });
  }
  return [...result.values()];
}
function sourceIdentity(ref: KnowledgeSourceRef): string {
  return JSON.stringify([ref.workspaceId,ref.spaceId,ref.sourcePageId,ref.sourceVersion,ref.contentHash,
    ref.sourceRange?.startOffset??null,ref.sourceRange?.endOffset??null,ref.quoteHash??null]);
}
