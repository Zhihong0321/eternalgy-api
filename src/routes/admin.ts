import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../security/auth-middleware.js';
import { keyService } from '../security/key-service.js';
import { executeQuery } from '../db/pool.js';
import { getRecentAuditLogs } from '../middleware/audit-logger.js';
import { TablePolicy } from '../security/types.js';

interface CreateKeyBody {
  name: string;
  apiKey?: string;
  role?: string;
  rateLimitRpm?: number;
  tables: Record<string, TablePolicy>;
  expiresAt?: string | null;
}

interface UpdateKeyBody {
  name?: string;
  isActive?: boolean;
  rateLimitRpm?: number;
  tables?: Record<string, TablePolicy>;
  expiresAt?: string | null;
}

export async function adminRoutes(app: FastifyInstance) {
  // Enforce Admin Secret on all admin routes
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /api/admin/keys - List all configured API keys and their per-key access rules
   */
  app.get('/api/admin/keys', async () => {
    const keys = await keyService.listKeys();
    const list = keys.map((k) => ({
      id: k.id,
      name: k.name,
      maskedApiKey: k.apiKey.slice(0, 10) + '...' + k.apiKey.slice(-4),
      isActive: k.isActive,
      role: k.role,
      rateLimitRpm: k.rateLimitRpm,
      allowedTables: Object.keys(k.tables),
      tables: k.tables,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));

    return { total: list.length, keys: list };
  });

  /**
   * POST /api/admin/keys - Issue a new API key with custom per-key table access control
   */
  app.post<{ Body: CreateKeyBody }>('/api/admin/keys', async (request, reply) => {
    const { name, apiKey, role, rateLimitRpm, tables, expiresAt } = request.body;

    if (!name || !tables || typeof tables !== 'object') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Missing required fields: name, tables (object mapping table names to permissions).',
      });
    }

    const created = await keyService.createKey({
      name,
      apiKey,
      role,
      rateLimitRpm,
      tables,
      expiresAt,
    });

    return reply.status(201).send({
      message: 'API Key generated successfully with custom access control.',
      key: {
        id: created.id,
        name: created.name,
        apiKey: created.apiKey, // Returned once upon creation
        isActive: created.isActive,
        role: created.role,
        rateLimitRpm: created.rateLimitRpm,
        tables: created.tables,
        expiresAt: created.expiresAt,
      },
    });
  });

  /**
   * PATCH /api/admin/keys/:id - Update key permissions, toggle active status, or change limits
   */
  app.patch<{ Params: { id: string }; Body: UpdateKeyBody }>(
    '/api/admin/keys/:id',
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const updated = await keyService.updateKey(id, updates);
      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          message: `API Key with ID '${id}' not found.`,
        });
      }

      return reply.send({
        message: 'API Key access controls updated successfully.',
        key: updated,
      });
    }
  );

  /**
   * DELETE /api/admin/keys/:id - Permanently revoke/delete an API key
   */
  app.delete<{ Params: { id: string } }>('/api/admin/keys/:id', async (request, reply) => {
    const { id } = request.params;
    const deleted = await keyService.deleteKey(id);
    if (!deleted) {
      return reply.status(404).send({
        statusCode: 404,
        message: `API Key with ID '${id}' not found.`,
      });
    }
    return reply.send({ message: `API Key '${id}' permanently deleted.` });
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
