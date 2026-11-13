import Fastify from 'fastify';
import {
  MCP_BODY_LIMIT_BYTES,
  MCP_MANUAL_UPLOAD_GUIDANCE,
  MCP_ROUTE_URL,
  MCP_UPLOAD_MAX_BASE64_CHARS,
  formatBytes,
  payloadTooLargeMessage,
  registerMcpBodyLimit,
} from './mcp.body-limit';

const GLOBAL_BODY_LIMIT = 1024 * 1024;

function buildApp() {
  const app = Fastify({ bodyLimit: GLOBAL_BODY_LIMIT });

  registerMcpBodyLimit(app as any);

  app.addContentTypeParser(
    'application/json',
    { bodyLimit: GLOBAL_BODY_LIMIT, parseAs: 'buffer' },
    (req, body, done) => {
      (req as any).rawBody = body;
      app.getDefaultJsonParser('error', 'error')(req, body as any, done);
    },
  );

  app.all(MCP_ROUTE_URL, async () => ({ ok: true }));
  app.post('/api/pages/update', async () => ({ ok: true }));

  return app;
}

function payloadOfBytes(bytes: number) {
  const envelope = JSON.stringify({ jsonrpc: '2.0', blob: '' });
  return JSON.stringify({
    jsonrpc: '2.0',
    blob: 'x'.repeat(bytes - envelope.length),
  });
}

describe('MCP route body limit', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const inject = (url: string, bytes: number) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: payloadOfBytes(bytes),
    });

  it('is 32MB', () => {
    expect(MCP_BODY_LIMIT_BYTES).toBe(32 * 1024 * 1024);
  });

  it('accepts a JSON-RPC body larger than the global limit', async () => {
    const response = await inject(MCP_ROUTE_URL, 8 * 1024 * 1024);

    expect(response.statusCode).toBe(200);
  });

  it('accepts a body just under the MCP limit', async () => {
    const response = await inject(MCP_ROUTE_URL, MCP_BODY_LIMIT_BYTES - 1024);

    expect(response.statusCode).toBe(200);
  });

  it('rejects an oversized body with manual-upload guidance', async () => {
    const response = await inject(MCP_ROUTE_URL, MCP_BODY_LIMIT_BYTES + 1024);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      code: 'FILE_TOO_LARGE',
      details: { remediation: 'manual_upload_in_akasha' },
    });
    expect(response.json().message).toContain('32.0MB');
    expect(response.json().message).toContain('upload the file manually');
  });

  it('leaves other routes on the global limit', async () => {
    const response = await inject(
      '/api/pages/update',
      GLOBAL_BODY_LIMIT + 1024,
    );

    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('FST_ERR_CTP_BODY_TOO_LARGE');
    expect(response.payload).not.toContain('manual_upload_in_akasha');
  });
});

describe('payloadTooLargeMessage', () => {
  it('tells the agent not to retry or chunk, and to route the user to Akasha', () => {
    expect(MCP_MANUAL_UPLOAD_GUIDANCE).toContain('Do not retry');
    expect(MCP_MANUAL_UPLOAD_GUIDANCE).toContain('do not split the file');
    expect(MCP_MANUAL_UPLOAD_GUIDANCE).toContain('upload the file manually');
    expect(MCP_MANUAL_UPLOAD_GUIDANCE).toContain('drag the file into the editor');
  });

  it('names the limit and includes the guidance', () => {
    const message = payloadTooLargeMessage(MCP_BODY_LIMIT_BYTES);

    expect(message).toContain('32.0MB');
    expect(message).toContain(MCP_MANUAL_UPLOAD_GUIDANCE);
  });

  it('reports the actual size when known', () => {
    const message = payloadTooLargeMessage(
      MCP_UPLOAD_MAX_BASE64_CHARS,
      20_000_000,
    );

    expect(message).toContain('19.1MB payload');
    expect(message).toContain(formatBytes(MCP_UPLOAD_MAX_BASE64_CHARS));
  });

  it('formats sub-megabyte sizes in KB', () => {
    expect(formatBytes(512 * 1024)).toBe('512.0KB');
  });
});
