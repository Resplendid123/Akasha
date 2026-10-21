import { parentPort } from 'node:worker_threads';
import { getSchema } from '@tiptap/core';
import { createHistoryDiff } from '@docmost/editor-ext';
import { tiptapExtensions } from '../collaboration.util';

const schema = getSchema(tiptapExtensions);

parentPort?.on('message', (msg: { fromContent: unknown; toContent: unknown }) => {
  try {
    const result = createHistoryDiff(schema, msg.fromContent, msg.toContent);
    parentPort?.postMessage({ ok: true, result });
  } catch (err: any) {
    parentPort?.postMessage({ ok: false, error: err?.message ?? 'unknown' });
  }
});
