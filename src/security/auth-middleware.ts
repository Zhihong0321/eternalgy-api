import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { policyStore } from './policies.js';
import { AuthContext, ClientPolicy } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    clientPolicy?: ClientPolicy;
    authContext?: AuthContext;
    isAdmin?: boolean;
  }
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const headerKey = request.headers['x-api-key'] as string | undefined;
  const authHeader = request.headers.authorization;
  
  let keyToTest: string | undefined = headerKey;
  if (!keyToTest && authHeader && authHeader.startsWith('Bearer ')) {
    keyToTest = authHeader.slice(7).trim();
  }

  if (!keyToTest) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing API key. Provide via x-api-key header or Authorization: Bearer <key>.',
    });
  }

  // 1. Check if it is the master Admin key
  if (keyToTest === config.ADMIN_API_KEY) {
    request.isAdmin = true;
    request.authContext = {
      keyId: 'admin_root',
      clientName: 'Gateway Administrator',
      role: 'admin',
    };
    return;
  }

  // 2. Lookup standard Client Policy
  const policy = policyStore.getPolicyByApiKey(keyToTest);
  if (!policy) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid API key or key has been revoked.',
    });
  }

  // Optional contextual headers (e.g. mobile app passing authenticated customer ID)
  const userId = request.headers['x-user-id'] as string | undefined;
  const tenantId = request.headers['x-tenant-id'] as string | undefined;

  request.clientPolicy = policy;
  request.authContext = {
    keyId: policy.keyId,
    clientName: policy.clientName,
    role: policy.role,
    userId,
    tenantId,
  };
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const adminSecret =
    (request.headers['x-admin-secret'] as string) ||
    (request.headers['x-api-key'] as string);

  if (adminSecret !== config.ADMIN_API_KEY) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Admin access required. Provide valid x-admin-secret or x-api-key.',
    });
  }
}
