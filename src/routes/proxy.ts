import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import { proxyService } from '../security/proxy-service.js';

const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'x-api-key',
  'x-admin-secret',
]);

function matchesPathPattern(path: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '/*') return true;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;

  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedPath.startsWith(prefix);
  }
  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath.startsWith(prefix);
  }
  return normalizedPath === normalizedPattern;
}

async function handleProxyRequest(
  request: FastifyRequest<{ Params: { service: string; '*'?: string } }>,
  reply: FastifyReply
) {
  const serviceId = request.params.service;
  const upstreamService = await proxyService.getService(serviceId);

  if (!upstreamService || !upstreamService.isActive) {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Upstream proxy service '${serviceId}' not found or is currently inactive.`,
    });
  }

  // 1. Authorization check
  if (!request.isAdmin) {
    const keyRecord = request.apiKeyRecord;
    const clientProxies = keyRecord?.proxies || {};
    const policy = clientProxies[serviceId] || clientProxies['*'];

    if (!policy) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `API Key '${keyRecord?.name || 'Client'}' is not authorized to access proxy service '${serviceId}'.`,
      });
    }

    // Check HTTP method policy
    if (policy.methods && policy.methods.length > 0) {
      const allowedMethods = policy.methods.map((m) => m.toUpperCase());
      if (!allowedMethods.includes(request.method.toUpperCase())) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Method '${request.method}' is not permitted for proxy service '${serviceId}'. Allowed: ${allowedMethods.join(', ')}`,
        });
      }
    }

    // Check path policy
    const wildPath = request.params['*'] || '';
    const fullSubPath = wildPath.startsWith('/') ? wildPath : `/${wildPath}`;
    if (policy.allowedPaths && policy.allowedPaths.length > 0) {
      const isPathAllowed = policy.allowedPaths.some((pattern) => matchesPathPattern(fullSubPath, pattern));
      if (!isPathAllowed) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Subpath '${fullSubPath}' is not permitted for proxy service '${serviceId}'.`,
        });
      }
    }
  }

  // 2. Build target URL
  const wildPath = request.params['*'] || '';
  const subPath = wildPath ? `/${wildPath.replace(/^\/+/, '')}` : '';
  const queryIdx = request.url.indexOf('?');
  const queryString = queryIdx !== -1 ? request.url.slice(queryIdx) : '';
  const targetUrl = `${upstreamService.baseUrl.replace(/\/+$/, '')}${subPath}${queryString}`;

  // 3. Prepare headers
  const outHeaders = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && value !== undefined) {
      outHeaders.set(key, Array.isArray(value) ? value.join(', ') : (value as string));
    }
  }

  // Inject upstream configured credentials/headers
  if (upstreamService.headers) {
    for (const [key, value] of Object.entries(upstreamService.headers)) {
      outHeaders.set(key, value);
    }
  }

  // 4. Prepare payload/body
  let bodyPayload: any = undefined;
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase()) && request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'object') {
      bodyPayload = JSON.stringify(request.body);
      if (!outHeaders.has('content-type')) {
        outHeaders.set('content-type', 'application/json');
      }
    } else {
      bodyPayload = request.body;
    }
  }

  // 5. Execute proxy request
  try {
    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: outHeaders,
      body: bodyPayload,
      redirect: 'follow',
    });

    reply.status(upstreamRes.status);

    // Forward upstream response headers
    upstreamRes.headers.forEach((value, headerName) => {
      const lower = headerName.toLowerCase();
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(lower)) {
        reply.header(headerName, value);
      }
    });

    const responseBytes = await upstreamRes.arrayBuffer();
    return reply.send(Buffer.from(responseBytes));
  } catch (err: any) {
    request.log.error({ err, serviceId, targetUrl }, 'Proxy upstream error');
    return reply.status(502).send({
      statusCode: 502,
      error: 'Bad Gateway',
      message: `Failed to proxy request to upstream service '${serviceId}': ${err.message}`,
    });
  }
}

export async function proxyRoutes(app: FastifyInstance) {
  // Enforce API Key authentication for all proxy routes
  app.addHook('preHandler', authenticateApiKey);

  // Route: /api/proxy/:service (root of service)
  app.all<{ Params: { service: string; '*'?: string } }>(
    '/api/proxy/:service',
    {
      schema: {
        description: 'Proxy requests to a 3rd-party service using single Eternalgy API key',
        tags: ['Proxy Router'],
      },
    },
    handleProxyRequest
  );

  // Route: /api/proxy/:service/* (wildcard paths)
  app.all<{ Params: { service: string; '*'?: string } }>(
    '/api/proxy/:service/*',
    {
      schema: {
        description: 'Proxy requests with wildcard path to a 3rd-party service using single Eternalgy API key',
        tags: ['Proxy Router'],
      },
    },
    handleProxyRequest
  );
}
