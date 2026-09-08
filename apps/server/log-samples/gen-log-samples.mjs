// 生成两份日志测试数据:
//  1) sample-pino-raw.ndjson      —— pino 打到 stdout 的原始 JSON(Vector 的输入,字段契约的真源)
//  2) sample-clickhouse.jsoneachrow —— 拍平后、与 akasha_test_logs 列一一对应(DBA 直接 INSERT 测试用)
// 覆盖:200 access / 404 access(warn)/ 404 filter(warn,含 err 无 stack)/ 500 filter(error,多行 stack)
//       / 业务日志(带 ws+user)/ 后台日志(无 requestId/ws/user,验证 DEFAULT '')
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(dir, { recursive: true });

const PID = 12345;
const HOST = 'akasha-server-6d9f7b8c4-abcde';
const S = 'akasha-server';
const ENV = 'production';

// 一个真实的多行堆栈(演示 err_stack 的换行转义)
const stack500 =
  'InternalServerErrorException: downstream unavailable\n' +
  '    at PageService.render (/app/dist/page/page.service.js:88:15)\n' +
  '    at PageController.getPage (/app/dist/page/page.controller.js:42:9)\n' +
  '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)';

// —— 原始 pino JSON 行(键序仅示意,不影响解析)——
const rawLines = [
  // 1) 正常访问日志 200(access log 顶层有 responseTime,有 res,无 context/err)
  {
    level: 'info', time: '2026-09-08T03:15:20.101Z', service: S, env: ENV, pid: PID, hostname: HOST,
    req: { method: 'GET', url: '/api/pages/019ea6', ip: '127.0.0.1', userAgent: 'Mozilla/5.0 Chrome/152.0.0.0' },
    res: { statusCode: 200 }, responseTime: 12.7,
    requestId: 'a1000000-0000-4000-8000-000000000001',
    workspaceId: '019ea69a-1ddd-7666-87e7-60002c129717',
    userId: 'user-0001',
    msg: 'request completed',
  },
  // 2) 访问日志 404(warn):同一条失败请求的 access log
  {
    level: 'warn', time: '2026-09-08T03:15:27.610Z', service: S, env: ENV, pid: PID, hostname: HOST,
    req: { method: 'POST', url: '/api/mfa/status', ip: '127.0.0.1', userAgent: 'Mozilla/5.0 Chrome/152.0.0.0' },
    res: { statusCode: 404 }, responseTime: 6.2,
    requestId: '5d518f97-d478-4a5b-ab35-c02150f4d3ba',
    workspaceId: '019ea69a-1ddd-7666-87e7-60002c129717',
    // 匿名/未过鉴权 → 无 userId(缺省 '')
    msg: 'request completed',
  },
  // 3) 你实际遇到的那条:AllExceptionsFilter 记的 4xx(warn,含 err 但无 stack,含 req,无 res/responseTime)
  {
    level: 'warn', time: '2026-09-08T03:15:27.604Z', service: S, env: ENV, pid: PID, hostname: HOST,
    req: { method: 'POST', url: '/api/mfa/status', ip: '127.0.0.1', userAgent: 'Mozilla/5.0 Chrome/152.0.0.0' },
    requestId: '5d518f97-d478-4a5b-ab35-c02150f4d3ba',
    workspaceId: '019ea69a-1ddd-7666-87e7-60002c129717',
    context: 'AllExceptionsFilter',
    err: { type: 'NotFoundException', message: 'Cannot POST /api/mfa/status', statusCode: 404 },
    msg: 'Request failed with status 404',
  },
  // 4) 5xx(error,含多行 stack)
  {
    level: 'error', time: '2026-09-08T03:16:02.880Z', service: S, env: ENV, pid: PID, hostname: HOST,
    req: { method: 'GET', url: '/api/pages/019ea6', ip: '10.0.0.5', userAgent: 'Mozilla/5.0 Chrome/152.0.0.0' },
    requestId: 'b2000000-0000-4000-8000-000000000002',
    workspaceId: '019ea69a-1ddd-7666-87e7-60002c129717',
    userId: 'user-0002',
    context: 'AllExceptionsFilter',
    err: { type: 'InternalServerErrorException', message: 'downstream unavailable', statusCode: 500, stack: stack500 },
    msg: 'Request failed with status 500',
  },
  // 5) 业务日志(带 requestId + ws + user,无 req/res/err)
  {
    level: 'info', time: '2026-09-08T03:16:02.870Z', service: S, env: ENV, pid: PID, hostname: HOST,
    requestId: 'b2000000-0000-4000-8000-000000000002',
    workspaceId: '019ea69a-1ddd-7666-87e7-60002c129717',
    userId: 'user-0002',
    context: 'PageService',
    msg: 'render page start',
  },
  // 6) 后台/启动日志:无 requestId/workspaceId/userId(验证表 DEFAULT '')
  {
    level: 'info', time: '2026-09-08T03:00:00.000Z', service: S, env: ENV, pid: PID, hostname: HOST,
    context: 'Bootstrap',
    msg: 'server listening on 0.0.0.0:3000',
  },
];

// 拍平为 ClickHouse 列(键名与 DDL 完全一致)。缺省字符串列省略 → 走 DEFAULT '';
// Nullable 列(res_status/res_time_ms/err_status)缺省显式给 null。
function flatten(o) {
  const row = {
    time: o.time,
    level: o.level,
    service: o.service,
    env: o.env,
    context: o.context ?? '',
    requestId: o.requestId ?? '',
    workspaceId: o.workspaceId ?? '',
    userId: o.userId ?? '',
    msg: o.msg ?? '',
    req_method: o.req?.method ?? '',
    req_url: o.req?.url ?? '',
    res_status: o.res?.statusCode ?? null,
    res_time_ms: o.responseTime ?? null,
    err_type: o.err?.type ?? '',
    err_message: o.err?.message ?? '',
    err_stack: o.err?.stack ?? '',
    err_status: o.err?.statusCode ?? null,
    pid: o.pid,
    hostname: o.hostname,
    raw: JSON.stringify(o), // 原始整行 JSON,原样入 raw 列
  };
  return row;
}

const ndjson = rawLines.map((o) => JSON.stringify(o)).join('\n') + '\n';
const jsoneach = rawLines.map((o) => JSON.stringify(flatten(o))).join('\n') + '\n';

writeFileSync(`${dir}/sample-pino-raw.ndjson`, ndjson);
writeFileSync(`${dir}/sample-clickhouse.jsoneachrow`, jsoneach);
console.log('wrote sample-pino-raw.ndjson & sample-clickhouse.jsoneachrow to', dir);
