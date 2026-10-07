import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { config } from '../src/config/env.js';

describe('3rd-Party API Gateway Proxy & Credential Injection', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests to /api/proxy/:service with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
    });

    expect(res.statusCode).toBe(401);
    const json = res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('rejects unknown or invalid API key with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
      headers: {
        'x-api-key': 'invalid_key_xyz',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects keys without authorization for the specific proxy service with 403', async () => {
    // referral_partner demo key has no proxies granted
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
      headers: {
        'x-api-key': 'eter_demo_partner_key_2026',
      },
    });

    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.message).toContain('not authorized to access proxy service');
  });

  it('returns 404 for non-existent upstream service', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/non-existent-service/something',
      headers: {
        'x-api-key': 'eter_demo_catalog_key_2026',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('proxies request to ATAP Solar Calculator, cloaking credentials and returning upstream data', async () => {
    // catalog_viewer key (eter_demo_catalog_key_2026) has calculator proxy permission
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
      headers: {
        'x-api-key': 'eter_demo_catalog_key_2026',
      },
    });

    // Upstream ATAP Solar returns 200 OK
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.key).toBe('ats_addon_price');
  });

  it('allows Master Admin to access proxy services directly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
  });

  it('lists proxy services via admin API with credentials masked', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/proxy-services',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.total).toBeGreaterThanOrEqual(1);
    const calc = json.services.find((s: any) => s.id === 'calculator');
    expect(calc).toBeDefined();
    expect(calc.baseUrl).toBe('https://calculator.atap.solar');
    // Secret header value must be masked
    expect(calc.headers['X-Api-Key']).not.toBe('calculator2026');
    expect(calc.headers['X-Api-Key']).toContain('***');
  });

  it('enforces method policy restrictions on proxy services', async () => {
    // Create a key with only GET permission on calculator
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/keys',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
      payload: {
        name: 'Readonly Proxy Client',
        tables: {},
        proxies: {
          calculator: {
            methods: ['GET'],
          },
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const newKey = createRes.json().key.apiKey;

    // GET should be allowed
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
      headers: {
        'x-api-key': newKey,
      },
    });
    expect(getRes.statusCode).toBe(200);

    // PUT should be forbidden by method policy
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/proxy/calculator/api/v1/settings/ats-addon-price',
      headers: {
        'x-api-key': newKey,
      },
      payload: { price: 1500 },
    });
    expect(putRes.statusCode).toBe(403);
    expect(putRes.json().message).toContain('Method \'PUT\' is not permitted');
  });
});
