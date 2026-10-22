import { KnowledgeScope, KnowledgeSourceRef } from './knowledge.types';

export interface KnowledgeEntityEndpoint {
  id: string;
  canonicalKey: string;
  name: string;
  type: string;
  alias: string[];
}

export interface CompiledGraphNode
  extends KnowledgeEntityEndpoint, KnowledgeScope {
  ownerSourcePageId: string;
}

export interface CompiledEntityGraphEdge extends KnowledgeScope {
  from: KnowledgeEntityEndpoint;
  relation: string;
  to: KnowledgeEntityEndpoint;
  inputSourceRefs: KnowledgeSourceRef[];
}

export interface EntityGraphTraversalEdge extends CompiledEntityGraphEdge {
  id: string;
  type: 'semantic';
  weight: number;
  sourcePageIds: string[];
}

export interface EntityGraphPath {
  edgeId: string;
  relation: string;
  from: KnowledgeEntityEndpoint;
  to: KnowledgeEntityEndpoint;
  inputSourceRefs: KnowledgeSourceRef[];
}
