import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  keyId?: string;
  role?: string;
  ip: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  errorMessage?: string;
  userAgent?: string;
}

export interface AuditLogFilter {
  statusCode?: number;
  minStatus?: number;
  method?: string;
  keyId?: string;
  endpoint?: string;
  search?: string;
}

const MAX_BUFFERED_LOGS = 500;
const auditLogBuffer: AuditLogEntry[] = [];
let logCounter = 1;

export function getRecentAuditLogs(
  limit: number = 50,
  filter?: AuditLogFilter
): AuditLogEntry[] {
  let logs = [...auditLogBuffer].reverse();

  if (filter?.minStatus) {
    logs = logs.filter((l) => l.statusCode >= filter.minStatus!);
  }
  if (filter?.statusCode) {
    logs = logs.filter((l) => l.statusCode === filter.statusCode);
  }
  if (filter?.method) {
    logs = logs.filter((l) => l.method.toUpperCase() === filter.method!.toUpperCase());
  }
  if (filter?.keyId) {
    const target = filter.keyId.toLowerCase();
    logs = logs.filter((l) => {
      const kid = (l.keyId || '').toLowerCase();
      return (
        kid === target ||
        kid.includes(target) ||
        l.url.toLowerCase().includes(target)
      );
    });
  }
  if (filter?.endpoint) {
    const ep = filter.endpoint.toLowerCase();
    logs = logs.filter((l) => l.url.toLowerCase().includes(ep));
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    logs = logs.filter((l) =>
      l.url.toLowerCase().includes(q) ||
      (l.keyId && l.keyId.toLowerCase().includes(q)) ||
      (l.role && l.role.toLowerCase().includes(q)) ||
      (l.ip && l.ip.includes(q)) ||
      (l.method && l.method.toLowerCase().includes(q)) ||
      (l.errorMessage && l.errorMessage.toLowerCase().includes(q))
    );
  }

  return logs.slice(0, Math.min(limit, MAX_BUFFERED_LOGS));
}

export function getRecentErrors(limit: number = 50): AuditLogEntry[] {
  return getRecentAuditLogs(limit, { minStatus: 400 });
}

export function registerAuditLogging(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    (req as any).startTime = Date.now();
  });

  app.addHook('onError', async (req: FastifyRequest, _reply: FastifyReply, error: any) => {
    (req as any).lastError = error.message || String(error);
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any).startTime || Date.now();
    const durationMs = Date.now() - startTime;

    let callerKeyId = req.authContext?.keyId;
    if (!callerKeyId) {
      if (req.isAdmin) {
        callerKeyId = 'admin';
      } else {
        const docMatch = req.url.match(/\/docs\/keys\/([a-zA-Z0-9_\-]+)/);
        if (docMatch && docMatch[1]) {
          callerKeyId = docMatch[1];
        } else if ((req.query as any)?.key) {
          callerKeyId = String((req.query as any).key);
        } else if ((req.query as any)?.secret) {
          callerKeyId = String((req.query as any).secret);
        } else {
          callerKeyId = 'anonymous';
        }
      }
    }

    const entry: AuditLogEntry = {
      id: `log_${Date.now()}_${logCounter++}`,
      timestamp: new Date().toISOString(),
      keyId: callerKeyId,
      role: req.authContext?.role,
      ip: req.ip,
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs,
      errorMessage: (req as any).lastError,
      userAgent: (req.headers['user-agent'] as string) || undefined,
    };

    auditLogBuffer.push(entry);
    if (auditLogBuffer.length > MAX_BUFFERED_LOGS) {
      auditLogBuffer.shift();
    }

    if (reply.statusCode >= 400) {
      req.log.warn({ audit: entry }, `[Audit Warning] ${entry.method} ${entry.url} - ${entry.statusCode}`);
    } else {
      req.log.info({ audit: entry }, `[Audit OK] ${entry.method} ${entry.url} - ${entry.statusCode}`);
    }
  });
}
