import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/env.js';
import { registerAuditLogging } from './middleware/audit-logger.js';
import { healthRoutes } from './routes/health.js';
import { dataRoutes } from './routes/data.js';
import { adminRoutes } from './routes/admin.js';
import { keyService } from './security/key-service.js';

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

  // Custom 404 handler
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'The requested route does not exist. Check /docs for available endpoints.',
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
