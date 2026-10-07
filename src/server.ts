import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config/env.js';
import { registerAuditLogging } from './middleware/audit-logger.js';
import { healthRoutes } from './routes/health.js';
import { dataRoutes } from './routes/data.js';
import { adminRoutes } from './routes/admin.js';
import { debugRoutes } from './routes/debug.js';
import { keyDocsRoutes } from './routes/key-docs.js';
import { keyService } from './security/key-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildServer() {
  // Initialize Per-API-Key store & cache
  await keyService.initialize();

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    disableRequestLogging: true,
  });

  // CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Rate Limiting per IP / API key
  await app.register(rateLimit, {
    max: config.DEFAULT_RATE_LIMIT_RPM,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const apiKey = (req.headers['x-api-key'] as string) || req.ip;
      return apiKey;
    },
  });

  // Serve Web Admin UI Static Assets
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/admin/',
    decorateReply: false,
  });

  // Root & Admin redirects
  app.get('/', async (_req, reply) => {
    return reply.redirect('/admin/');
  });

  app.get('/admin', async (_req, reply) => {
    return reply.redirect('/admin/');
  });

  // Interactive Swagger Documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Eternalgy PostgreSQL API Gateway',
        description: 'Secure, governed data gateway for Eternalgy PostgreSQL database',
        version: '1.0.0',
      },
      servers: [
        {
          url: '/',
          description: 'Current Environment',
        },
      ],
      components: {
        securitySchemes: {
          apiKeyAuth: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
          },
        },
      },
      security: [{ apiKeyAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Register structured audit logging
  registerAuditLogging(app);

  // Register Routes
  await app.register(healthRoutes);
  await app.register(dataRoutes);
  await app.register(adminRoutes);
  await app.register(debugRoutes);
  await app.register(keyDocsRoutes);

  // Custom 404 handler
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'The requested route does not exist. Check /admin/ for console or /docs for API endpoints.',
    });
  });

  // Centralized Error handler
  app.setErrorHandler((error: any, _req, reply) => {
    const statusCode = error.statusCode || 500;
    app.log.error(error);
    reply.status(statusCode).send({
      statusCode,
      error: error.name || 'InternalServerError',
      message: error.message || 'An unexpected error occurred.',
    });
  });

  return app;
}
