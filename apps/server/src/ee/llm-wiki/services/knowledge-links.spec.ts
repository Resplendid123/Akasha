import { mergeKnowledgeLinks } from './knowledge-links';

describe('deterministic link identity',()=>{
  const ref={workspaceId:'w',spaceId:'s',sourcePageId:'a',sourceVersion:'1',contentHash:'h'};
  it('merges duplicate targets without losing independent dependencies or evidence ranges',()=>{
    const link={toKnowledgePageId:'page',linkType:'summary_mention' as const,linkText:'Page',inputSourceRefs:[ref]};
    const range={...ref,sourceRange:{startOffset:1,endOffset:8},quoteHash:'q'};
    const result=mergeKnowledgeLinks([link,link,{...link,inputSourceRefs:[{...ref,sourcePageId:'b'},range]}]);
    expect(result).toHaveLength(1);
    expect(result[0].inputSourceRefs).toEqual([ref,{...ref,sourcePageId:'b'},range]);
  });
  it('keeps different deterministic relationship types distinct',()=>{
    const base={toKnowledgePageId:'page',linkText:'Page',inputSourceRefs:[ref]};
    expect(mergeKnowledgeLinks([{...base,linkType:'summary_mention'},{...base,linkType:'catalog_mention'}])).toHaveLength(2);
  });
  it('leaves absent dependencies undefined so artifact lineage still applies',()=>{
    const result=mergeKnowledgeLinks([{toKnowledgePageId:'page',linkType:'catalog_mention',linkText:'Page'}]);
    expect(result).toHaveLength(1);
    expect(result[0].inputSourceRefs).toBeUndefined();
  });
});
