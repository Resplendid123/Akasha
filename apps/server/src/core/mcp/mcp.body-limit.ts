import { FastifyInstance } from 'fastify';

export const MCP_ROUTE_URL = '/mcp';

export const MCP_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

export const MCP_UPLOAD_MAX_BASE64_CHARS = 14_000_000;

const DRAIN_CAP_BYTES = 4 * 1024 * 1024;

export const MCP_MANUAL_UPLOAD_GUIDANCE =
  'Do not retry and do not split the file into chunks. Ask the user to upload the file manually in Akasha: open the target page and drag the file into the editor, or use the editor attachment button. The browser upload streams the file, so it handles sizes this tool cannot.';

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function payloadTooLargeMessage(
  limitBytes: number,
  actualBytes?: number,
): string {
  const actual =
    actualBytes === undefined ? '' : `${formatBytes(actualBytes)} payload: `;
  return `${actual}exceeds the ${formatBytes(limitBytes)} MCP request limit. ${MCP_MANUAL_UPLOAD_GUIDANCE}`;
}

export function payloadTooLargeDetails(limitBytes: number) {
  return {
    limitBytes,
    remediation: 'manual_upload_in_akasha' as const,
  };
}

export function registerMcpBodyLimit(instance: FastifyInstance): void {
  instance.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url !== MCP_ROUTE_URL) return;

    routeOptions.bodyLimit = MCP_BODY_LIMIT_BYTES;
    routeOptions.errorHandler = (error, request, reply) => {
      if ((error as { code?: string }).code !== 'FST_ERR_CTP_BODY_TOO_LARGE') {
        throw error;
      }

      const raw = request.raw;
      let drained = 0;
      let replied = false;

      const respond = () => {
        if (replied) return;
        replied = true;
        reply.status(413).send({
          code: 'FILE_TOO_LARGE',
          message: payloadTooLargeMessage(MCP_BODY_LIMIT_BYTES),
          details: payloadTooLargeDetails(MCP_BODY_LIMIT_BYTES),
        });
      };

      raw.on('data', (chunk: Buffer) => {
        drained += chunk.length;
        if (drained > DRAIN_CAP_BYTES) raw.destroy();
      });
      raw.on('end', respond);
      raw.on('error', () => {});
      raw.resume();
    };
  });
}
