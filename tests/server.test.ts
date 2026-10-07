import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { config } from '../src/config/env.js';

describe('API Gateway HTTP Integration', () => {
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

  it('blocks access to undeclared tables for a client role with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data/invoice',
      headers: {
        'x-api-key': 'eter_demo_catalog_key_2026', // catalog_viewer role
      },
    });

    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.message).toContain('not accessible for role');
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
});
