import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../security/auth-middleware.js';
import { checkDbHealth, getPoolStats, explainQuery } from '../db/pool.js';
import { getRecentErrors } from '../middleware/audit-logger.js';
import { keyService } from '../security/key-service.js';
import { config } from '../config/env.js';

export async function debugRoutes(app: FastifyInstance) {
  // All debug endpoints require admin access
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /api/debug/diagnostics - Comprehensive system diagnostics for AI assistant & admin
   */
  app.get('/api/debug/diagnostics', async () => {
    const dbHealth = await checkDbHealth();
    const poolStats = getPoolStats();
    const mem = process.memoryUsage();
    const allKeys = await keyService.listKeys();

    return {
      status: dbHealth.ok ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        connected: dbHealth.ok,
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error,
        pool: poolStats,
      },
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          rssMb: Math.round(mem.rss / 1024 / 1024),
          heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        },
      },
      keys: {
        total: allKeys.length,
        active: allKeys.filter((k) => k.isActive).length,
        disabled: allKeys.filter((k) => !k.isActive).length,
      },
      guardrails: {
        maxQueryLimit: config.MAX_QUERY_LIMIT,
        queryTimeoutMs: config.QUERY_TIMEOUT_MS,
        defaultRateLimitRpm: config.DEFAULT_RATE_LIMIT_RPM,
      },
    };
  });

  /**
   * POST /api/debug/explain - Run query EXPLAIN for query debugging and index analysis
   */
  app.post<{ Body: { sql: string; params?: any[] } }>('/api/debug/explain', async (request, reply) => {
    const { sql, params = [] } = request.body || {};

    if (!sql || typeof sql !== 'string') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Missing sql statement.',
      });
    }

    try {
      const plan = await explainQuery(sql, params);
      return { sql, plan };
    } catch (err: any) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'ExplainError',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/debug/recent-errors - Retrieve recent failed requests (4xx / 5xx)
   */
  app.get<{ Querystring: { limit?: string } }>('/api/debug/recent-errors', async (request) => {
    const limit = Number(request.query.limit) || 50;
    const errors = getRecentErrors(limit);
    return { count: errors.length, errors };
  });
}
