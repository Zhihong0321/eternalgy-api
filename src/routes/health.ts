import { FastifyInstance } from 'fastify';
import { checkDbHealth } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/api/health',
    {
      schema: {
        description: 'Gateway and Database Health Check',
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              timestamp: { type: 'string' },
              database: {
                type: 'object',
                properties: {
                  connected: { type: 'boolean' },
                  latencyMs: { type: 'number' },
                  error: { type: 'string' },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              timestamp: { type: 'string' },
              database: {
                type: 'object',
                properties: {
                  connected: { type: 'boolean' },
                  latencyMs: { type: 'number' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const dbStatus = await checkDbHealth();
      const isHealthy = dbStatus.ok;

      const payload = {
        status: isHealthy ? 'healthy' : 'degraded',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: {
          connected: dbStatus.ok,
          latencyMs: dbStatus.latencyMs,
          error: dbStatus.error,
        },
      };

      return reply.status(isHealthy ? 200 : 503).send(payload);
    }
  );
}
