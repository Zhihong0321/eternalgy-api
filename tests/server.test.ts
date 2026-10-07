import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { config } from '../src/config/env.js';

describe('API Gateway HTTP Integration & Per-API-Key Access Control', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests to /v1/data/:table with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data/product',
    });

    expect(res.statusCode).toBe(401);
    const json = res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('rejects invalid API keys with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data/product',
      headers: {
        'x-api-key': 'invalid_random_key_123',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('blocks access to undeclared tables for a client API key with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data/invoice',
      headers: {
        'x-api-key': 'eter_demo_catalog_key_2026', // catalog_viewer key (only product, package, etc.)
      },
    });

    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.message).toContain('not authorized for this API key');
  });

  it('blocks access to globally restricted tables (e.g. otps) with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data/otps',
      headers: {
        'x-api-key': 'eter_demo_catalog_key_2026',
      },
    });

    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.message).toContain('strictly restricted');
  });

  it('protects admin routes when secret is missing with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/keys',
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows admin route when valid admin key is supplied', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/keys',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.keys).toBeDefined();
    expect(Array.isArray(json.keys)).toBe(true);
  });

  it('dynamically issues a new per-API-key and enforces its custom table access', async () => {
    // 1. Issue a brand new key for a specific partner
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/keys',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
      payload: {
        name: 'Partner ABC Integration',
        role: 'partner_abc',
        tables: {
          product: {
            actions: ['read'],
            allowedColumns: ['id', 'name'],
          },
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createJson = createRes.json();
    const newKey = createJson.key.apiKey;
    const keyId = createJson.key.id;
    expect(newKey).toBeDefined();

    // 2. New key tries to access forbidden table (invoice) -> 403
    const invoiceRes = await app.inject({
      method: 'GET',
      url: '/v1/data/invoice',
      headers: {
        'x-api-key': newKey,
      },
    });
    expect(invoiceRes.statusCode).toBe(403);
    expect(invoiceRes.json().message).toContain('not authorized for this API key');

    // 3. Admin deactivates this key (isActive: false)
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/keys/${keyId}`,
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
      payload: {
        isActive: false,
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // 4. Request with deactivated key immediately fails with 401
    const disabledRes = await app.inject({
      method: 'GET',
      url: '/v1/data/product',
      headers: {
        'x-api-key': newKey,
      },
    });
    expect(disabledRes.statusCode).toBe(401);
    expect(disabledRes.json().message).toContain('deactivated by administrator');
  });

  it('checks audit logs after requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.count).toBeGreaterThan(0);
    expect(json.logs[0].url).toBeDefined();
  });

  it('exposes tailored API documentation and schemas for a specific key', async () => {
    // 1. Check detailed key-schema endpoint
    const schemaRes = await app.inject({
      method: 'GET',
      url: '/api/docs/key-schema?key=eter_demo_catalog_key_2026',
    });

    expect(schemaRes.statusCode).toBe(200);
    const schemaJson = schemaRes.json();
    expect(schemaJson.clientName).toContain('Public Website');
    expect(Array.isArray(schemaJson.tables)).toBe(true);

    const productTable = schemaJson.tables.find((t: any) => t.table === 'product');
    expect(productTable).toBeDefined();
    expect(productTable.actions).toContain('read');
    expect(productTable.endpoints.some((ep: any) => ep.path === '/v1/data/product')).toBe(true);

    // Ensure invoice is NOT in docs for this key
    expect(schemaJson.tables.some((t: any) => t.table === 'invoice')).toBe(false);

    // 2. Check dynamic OpenAPI 3.0 spec endpoint
    const openApiRes = await app.inject({
      method: 'GET',
      url: '/api/docs/key-openapi.json?key=eter_demo_catalog_key_2026',
    });

    expect(openApiRes.statusCode).toBe(200);
    const openApiJson = openApiRes.json();
    expect(openApiJson.openapi).toBe('3.0.3');
    expect(openApiJson.paths['/v1/data/product']).toBeDefined();
    expect(openApiJson.paths['/v1/data/invoice']).toBeUndefined();
  });
});
