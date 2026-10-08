import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { keyService } from './key-service.js';
import { AuthContext, ApiKeyRecord, TablePolicy } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyRecord?: ApiKeyRecord;
    authContext?: AuthContext;
    isAdmin?: boolean;
    clientTables?: Record<string, TablePolicy>;
  }
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const query = request.query as Record<string, string> | undefined;
  const adminSecret =
    (request.headers['x-admin-secret'] as string | undefined) ||
    query?.['x-admin-secret'] ||
    query?.secret ||
    query?.adminSecret;

  if (adminSecret && adminSecret === config.ADMIN_API_KEY) {
    request.isAdmin = true;
    request.authContext = {
      keyId: 'admin_root',
      clientName: 'Gateway Administrator',
      role: 'admin',
    };
    return;
  }

  const headerKey =
    (request.headers['x-api-key'] as string | undefined) ||
    query?.['x-api-key'] ||
    query?.key ||
    query?.apiKey;
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

  // 2. Lookup Per-API-Key record & verify active status / expiration
  const keyResult = await keyService.getValidKey(keyToTest);
  if (!keyResult.valid || !keyResult.record) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: keyResult.reason || 'Invalid or revoked API key.',
    });
  }

  const record = keyResult.record;
  const userId = request.headers['x-user-id'] as string | undefined;
  const tenantId = request.headers['x-tenant-id'] as string | undefined;

  request.apiKeyRecord = record;
  request.clientTables = record.tables;
  request.authContext = {
    keyId: record.id,
    clientName: record.name,
    role: record.role,
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
