import { ChangeSet, simplifyChanges } from '@tiptap/pm/changeset';
import { Node, Schema } from '@tiptap/pm/model';
import { recreateTransform } from '../recreate-transform';

export const HISTORY_DIFF_ALGORITHM_VERSION = 'prosemirror-diff-v1';
export const HISTORY_DIFF_SCHEMA_VERSION = 'akasha-editor-v1';

const SPECIAL_NODE_TYPES = new Set([
  'image',
  'attachment',
  'video',
  'excalidraw',
  'drawio',
  'mermaid',
  'mathBlock',
  'mathInline',
  'table',
  'details',
  'callout',
]);

export interface HistoryDiffChange {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  deletedText: string;
  addedSpecialNode: { pos: number; nodeEnd: number } | null;
  deletedSpecialNode: { nodeJSON: unknown } | null;
}

export interface HistoryDiffResult {
  changes: HistoryDiffChange[];
  addedCount: number;
  deletedCount: number;
}

export function createHistoryDiff(
  schema: Schema,
  previousContent: unknown,
  content: unknown,
): HistoryDiffResult {
  const oldContent = Node.fromJSON(schema, previousContent);
  const newContent = Node.fromJSON(schema, content);
  const tr = recreateTransform(oldContent, newContent, {
    complexSteps: false,
    wordDiffs: true,
    simplifyDiff: true,
  });
  const changeSet = ChangeSet.create(oldContent).addSteps(
    tr.doc,
    tr.mapping.maps,
    [],
  );
  const changes = simplifyChanges(changeSet.changes, newContent);
  const result: HistoryDiffChange[] = [];
  let addedCount = 0;
  let deletedCount = 0;

  for (const change of changes) {
    let addedSpecialNode: HistoryDiffChange['addedSpecialNode'] = null;
    let deletedSpecialNode: HistoryDiffChange['deletedSpecialNode'] = null;
    let deletedText = '';

    if (change.toB > change.fromB) {
      addedCount++;
      newContent.nodesBetween(change.fromB, change.toB, (node, pos) => {
        if (SPECIAL_NODE_TYPES.has(node.type.name)) {
          const nodeEnd = pos + node.nodeSize;
          if (change.fromB <= pos && change.toB >= nodeEnd) {
            addedSpecialNode = { pos, nodeEnd };
            return false;
          }
        }
      });
    }

    if (change.toA > change.fromA) {
      deletedCount++;
      oldContent.nodesBetween(change.fromA, change.toA, (node, pos) => {
        if (SPECIAL_NODE_TYPES.has(node.type.name)) {
          const nodeEnd = pos + node.nodeSize;
          if (change.fromA <= pos && change.toA >= nodeEnd) {
            deletedSpecialNode = { nodeJSON: node.toJSON() };
            return false;
          }
        }
      });

      if (!deletedSpecialNode) {
        deletedText = oldContent.textBetween(change.fromA, change.toA, '');
      }
    }

    result.push({
      fromA: change.fromA,
      toA: change.toA,
      fromB: change.fromB,
      toB: change.toB,
      deletedText,
      addedSpecialNode,
      deletedSpecialNode,
    });
  }

  return { changes: result, addedCount, deletedCount };
}
