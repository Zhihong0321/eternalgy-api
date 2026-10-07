import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface AuditLogEntry {
  timestamp: string;
  keyId?: string;
  role?: string;
  ip: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
}

const MAX_BUFFERED_LOGS = 200;
const auditLogBuffer: AuditLogEntry[] = [];

export function getRecentAuditLogs(limit: number = 50): AuditLogEntry[] {
  return auditLogBuffer.slice(-Math.min(limit, MAX_BUFFERED_LOGS)).reverse();
}

export function registerAuditLogging(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    (req as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any).startTime || Date.now();
    const durationMs = Date.now() - startTime;

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      keyId: req.authContext?.keyId || (req.isAdmin ? 'admin' : 'anonymous'),
      role: req.authContext?.role,
      ip: req.ip,
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs,
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
