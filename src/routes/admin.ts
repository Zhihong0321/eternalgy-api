import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../security/auth-middleware.js';
import { policyStore } from '../security/policies.js';
import { executeQuery } from '../db/pool.js';
import { getRecentAuditLogs } from '../middleware/audit-logger.js';
import { ClientPolicy } from '../security/types.js';

export async function adminRoutes(app: FastifyInstance) {
  // Enforce Admin Secret on all admin routes
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /api/admin/keys - List all configured API keys and their permission models
   */
  app.get('/api/admin/keys', async () => {
    const policies = policyStore.getAllPolicies().map((p) => ({
      keyId: p.keyId,
      clientName: p.clientName,
      role: p.role,
      rateLimitRpm: p.rateLimitRpm,
      maskedApiKey: p.apiKey.slice(0, 8) + '...' + p.apiKey.slice(-4),
      tables: Object.keys(p.tables),
    }));

    return { keys: policies };
  });

  /**
   * POST /api/admin/keys - Register or update an API key with granular table policies
   */
  app.post<{ Body: ClientPolicy }>('/api/admin/keys', async (request, reply) => {
    const policy = request.body;

    if (!policy.apiKey || !policy.keyId || !policy.role || !policy.tables) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Missing required fields: keyId, apiKey, role, tables.',
      });
    }

    policyStore.registerPolicy(policy);
    return reply.status(201).send({
      message: 'API Key registered successfully',
      keyId: policy.keyId,
      clientName: policy.clientName,
    });
  });

  /**
   * DELETE /api/admin/keys/:apiKey - Revoke an API key
   */
  app.delete<{ Params: { apiKey: string } }>('/api/admin/keys/:apiKey', async (request, reply) => {
    const { apiKey } = request.params;
    const revoked = policyStore.revokeKey(apiKey);
    if (!revoked) {
      return reply.status(404).send({
        statusCode: 404,
        message: 'API Key not found',
      });
    }
    return reply.send({ message: 'API Key revoked successfully' });
  });

  /**
   * GET /api/admin/tables - Inspect live database tables and schema
   */
  app.get('/api/admin/tables', async () => {
    const query = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    const result = await executeQuery(query);
    return { tables: result.rows.map((r) => r.table_name) };
  });

  /**
   * GET /api/admin/audit-logs - View recent API calls and security audits
   */
  app.get<{ Querystring: { limit?: string } }>('/api/admin/audit-logs', async (request) => {
    const limit = Number(request.query.limit) || 50;
    const logs = getRecentAuditLogs(limit);
    return { count: logs.length, logs };
  });
}
