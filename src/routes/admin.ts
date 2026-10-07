import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../security/auth-middleware.js';
import { keyService } from '../security/key-service.js';
import { proxyService } from '../security/proxy-service.js';
import { executeQuery } from '../db/pool.js';
import { getRecentAuditLogs } from '../middleware/audit-logger.js';
import { TablePolicy, ProxyPolicy } from '../security/types.js';

interface CreateKeyBody {
  name: string;
  apiKey?: string;
  role?: string;
  rateLimitRpm?: number;
  tables: Record<string, TablePolicy>;
  proxies?: Record<string, ProxyPolicy>;
  expiresAt?: string | null;
}

interface UpdateKeyBody {
  name?: string;
  isActive?: boolean;
  rateLimitRpm?: number;
  tables?: Record<string, TablePolicy>;
  proxies?: Record<string, ProxyPolicy>;
  expiresAt?: string | null;
}

interface UpsertProxyServiceBody {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  description?: string;
  isActive?: boolean;
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
      proxies: k.proxies || {},
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
    const { name, apiKey, role, rateLimitRpm, tables, proxies, expiresAt } = request.body;

    const finalTables = tables && typeof tables === 'object' ? tables : {};
    const finalProxies = proxies && typeof proxies === 'object' ? proxies : {};

    if (!name || (Object.keys(finalTables).length === 0 && Object.keys(finalProxies).length === 0)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Missing required fields: name, and at least one table or 3rd-party proxy permission.',
      });
    }

    const created = await keyService.createKey({
      name,
      apiKey,
      role,
      rateLimitRpm,
      tables: finalTables,
      proxies: finalProxies,
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
        proxies: created.proxies,
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

  /**
   * GET /api/admin/proxy-services - List all configured 3rd-party upstream services
   */
  app.get('/api/admin/proxy-services', async () => {
    const services = await proxyService.listServices();
    // Mask sensitive upstream header values
    const masked = services.map((s) => {
      const safeHeaders: Record<string, string> = {};
      if (s.headers) {
        for (const [k, v] of Object.entries(s.headers)) {
          if (v && v.length > 8) {
            safeHeaders[k] = v.slice(0, 4) + '***' + v.slice(-4);
          } else {
            safeHeaders[k] = '********';
          }
        }
      }
      return {
        ...s,
        headers: safeHeaders,
      };
    });
    return { total: masked.length, services: masked };
  });

  /**
   * POST /api/admin/proxy-services - Register a new 3rd-party upstream service
   */
  app.post<{ Body: UpsertProxyServiceBody }>('/api/admin/proxy-services', async (request, reply) => {
    const { id, name, baseUrl, headers, description, isActive } = request.body;

    if (!id || !name || !baseUrl) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Missing required fields: id (slug), name, baseUrl.',
      });
    }

    const created = await proxyService.registerService({
      id,
      name,
      baseUrl,
      headers,
      description,
      isActive,
    });

    return reply.status(201).send({
      message: `Upstream proxy service '${id}' registered successfully.`,
      service: created,
    });
  });

  /**
   * PATCH /api/admin/proxy-services/:id - Update an existing upstream service
   */
  app.patch<{ Params: { id: string }; Body: Partial<UpsertProxyServiceBody> }>(
    '/api/admin/proxy-services/:id',
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const updated = await proxyService.updateService(id, updates);
      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          message: `Proxy service with ID '${id}' not found.`,
        });
      }

      return reply.send({
        message: `Proxy service '${id}' updated successfully.`,
        service: updated,
      });
    }
  );

  /**
   * DELETE /api/admin/proxy-services/:id - Delete an upstream proxy service
   */
  app.delete<{ Params: { id: string } }>('/api/admin/proxy-services/:id', async (request, reply) => {
    const { id } = request.params;
    const deleted = await proxyService.deleteService(id);
    if (!deleted) {
      return reply.status(404).send({
        statusCode: 404,
        message: `Proxy service with ID '${id}' not found.`,
      });
    }
    return reply.send({ message: `Proxy service '${id}' permanently removed.` });
  });
}
