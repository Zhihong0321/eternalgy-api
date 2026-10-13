import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import * as poolModule from '../src/db/pool.js';
import { PolicyEngine } from '../src/security/policy-engine.js';
import { keyService } from '../src/security/key-service.js';

describe('CEO API Key (ceo2026) - Read Only Access Control', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Key Lookup and Initialization', () => {
    it('initializes and finds ceo2026 key in keyService', async () => {
      const valid = await keyService.getValidKey('ceo2026');
      expect(valid.valid).toBe(true);
      expect(valid.record).toBeDefined();
      expect(valid.record?.apiKey).toBe('ceo2026');
      expect(valid.record?.role).toBe('ceo');
      expect(valid.record?.tables).toHaveProperty('invoice');
      expect(valid.record?.tables).toHaveProperty('user');
      expect(valid.record?.tables).toHaveProperty('payment');
      expect(valid.record?.tables).toHaveProperty('submited_payment');
    });

    it('finds hyphen alias -ceo2026 in keyService', async () => {
      const valid = await keyService.getValidKey('-ceo2026');
      expect(valid.valid).toBe(true);
      expect(valid.record?.apiKey).toBe('-ceo2026');
      expect(valid.record?.role).toBe('ceo');
    });
  });

  describe('PolicyEngine Authorization for CEO', () => {
    it('authorizes READ for invoice, user, payment, and submited_payment', async () => {
      const keyRec = (await keyService.getValidKey('ceo2026')).record!;
      const authCtx = { keyId: keyRec.id, clientName: keyRec.name, role: keyRec.role };

      const tablesToTest = [
        'invoice',
        'Invoice',
        'invoices',
        'user',
        'User',
        'users',
        'payment',
        'Payment',
        'payments',
        'submited_payment',
        'submitted_payment',
        'submited payment',
        'submitted payment',
      ];

      for (const tbl of tablesToTest) {
        const res = PolicyEngine.authorize(keyRec, tbl, 'read', authCtx);
        expect(res.allowed).toBe(true);
      }
    });

    it('strictly forbids WRITE actions (create, update, delete) for all tables', async () => {
      const keyRec = (await keyService.getValidKey('ceo2026')).record!;
      const authCtx = { keyId: keyRec.id, clientName: keyRec.name, role: keyRec.role };

      const writeActions: ('create' | 'update' | 'delete')[] = ['create', 'update', 'delete'];
      const tables = ['invoice', 'user', 'payment', 'submited_payment'];

      for (const tbl of tables) {
        for (const act of writeActions) {
          const res = PolicyEngine.authorize(keyRec, tbl, act, authCtx);
          expect(res.allowed).toBe(false);
          expect(res.reason).toContain(`Action '${act.toUpperCase()}' is not permitted`);
        }
      }
    });

    it('blocks access to non-assigned tables (product, package, support_ticket)', async () => {
      const keyRec = (await keyService.getValidKey('ceo2026')).record!;
      const authCtx = { keyId: keyRec.id, clientName: keyRec.name, role: keyRec.role };

      for (const tbl of ['product', 'package', 'support_ticket']) {
        const res = PolicyEngine.authorize(keyRec, tbl, 'read', authCtx);
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('not authorized for this API key');
      }
    });

    it('blocks access to system internal tables (otps, user_debug, system_logs)', async () => {
      const keyRec = (await keyService.getValidKey('ceo2026')).record!;
      const authCtx = { keyId: keyRec.id, clientName: keyRec.name, role: keyRec.role };

      for (const tbl of ['otps', 'user_debug', 'system_logs', 'schema_migrations']) {
        const res = PolicyEngine.authorize(keyRec, tbl, 'read', authCtx);
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('strictly restricted by gateway security policy');
      }
    });
  });

  describe('HTTP Route Integration for ceo2026', () => {
    it('authorizes READ with mock DB results for invoice, user, payment, submited_payment', async () => {
      const querySpy = vi.spyOn(poolModule, 'executeQuery').mockImplementation(async (sql: string) => {
        if (sql.includes('"invoice"')) {
          return { rows: [{ id: 101, invoice_no: 'INV-2026-001', total_amount: 15000, status: 'PAID' }] } as any;
        }
        if (sql.includes('"user"')) {
          return { rows: [{ id: 1, name: 'Admin User', email: 'admin@eternalgy.com', password_hash: 'secret_123' }] } as any;
        }
        if (sql.includes('"payment"')) {
          return { rows: [{ id: 501, payment_no: 'PAY-001', amount: 5000, status: 'SUCCESS' }] } as any;
        }
        if (sql.includes('"submited_payment"') || sql.includes('"submitted_payment"')) {
          return { rows: [{ id: 901, submission_no: 'SUB-001', amount: 5000, status: 'VERIFIED' }] } as any;
        }
        return { rows: [] } as any;
      });

      // 1. GET /v1/data/invoice
      const resInvoice = await app.inject({
        method: 'GET',
        url: '/v1/data/invoice',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resInvoice.statusCode).toBe(200);
      const invData = resInvoice.json();
      expect(invData.data).toHaveLength(1);
      expect(invData.data[0].invoice_no).toBe('INV-2026-001');

      // 2. GET /v1/data/user (masks sensitive password_hash)
      const resUser = await app.inject({
        method: 'GET',
        url: '/v1/data/user',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resUser.statusCode).toBe(200);
      const userData = resUser.json();
      expect(userData.data).toHaveLength(1);
      expect(userData.data[0].name).toBe('Admin User');
      expect(userData.data[0].password_hash).toBeUndefined(); // sensitive column masked

      // 3. GET /v1/data/payment
      const resPayment = await app.inject({
        method: 'GET',
        url: '/v1/data/payment',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resPayment.statusCode).toBe(200);
      const payData = resPayment.json();
      expect(payData.data).toHaveLength(1);
      expect(payData.data[0].payment_no).toBe('PAY-001');

      // 4. GET /v1/data/submited_payment
      const resSubmited = await app.inject({
        method: 'GET',
        url: '/v1/data/submited_payment',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resSubmited.statusCode).toBe(200);
      const subData = resSubmited.json();
      expect(subData.data).toHaveLength(1);
      expect(subData.data[0].submission_no).toBe('SUB-001');

      // 5. GET /v1/data/Invoice (Case variation)
      const resCase = await app.inject({
        method: 'GET',
        url: '/v1/data/Invoice',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resCase.statusCode).toBe(200);

      // 6. GET /v1/data/submited%20payment (Space variation)
      const resSpace = await app.inject({
        method: 'GET',
        url: '/v1/data/submited%20payment',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resSpace.statusCode).toBe(200);

      // 7. GET /v1/data/submitted_payment (Spelling variation)
      const resSpell = await app.inject({
        method: 'GET',
        url: '/v1/data/submitted_payment',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resSpell.statusCode).toBe(200);

      // 8. GET /v1/data/invoice with ?key=ceo2026 query param (ensuring key param is not filtered as column)
      const resQueryKey = await app.inject({
        method: 'GET',
        url: '/v1/data/invoice?key=ceo2026',
      });
      expect(resQueryKey.statusCode).toBe(200);
      expect(resQueryKey.json().data).toHaveLength(1);

      // 9. GET /api/data/invoice alias with ?key=ceo2026
      const resApiAlias = await app.inject({
        method: 'GET',
        url: '/api/data/invoice?key=ceo2026',
      });
      expect(resApiAlias.statusCode).toBe(200);
      expect(resApiAlias.json().data).toHaveLength(1);

      querySpy.mockRestore();
    });

    it('rejects POST, PATCH, and DELETE on invoice with 403 Forbidden', async () => {
      // POST /v1/data/invoice
      const resPost = await app.inject({
        method: 'POST',
        url: '/v1/data/invoice',
        headers: { 'x-api-key': 'ceo2026' },
        payload: { invoice_no: 'INV-NEW-999', total_amount: 1000 },
      });
      expect(resPost.statusCode).toBe(403);
      expect(resPost.json().message).toContain("Action 'CREATE' is not permitted");

      // PATCH /v1/data/invoice/101
      const resPatch = await app.inject({
        method: 'PATCH',
        url: '/v1/data/invoice/101',
        headers: { 'x-api-key': 'ceo2026' },
        payload: { status: 'CANCELLED' },
      });
      expect(resPatch.statusCode).toBe(403);
      expect(resPatch.json().message).toContain("Action 'UPDATE' is not permitted");

      // DELETE /v1/data/invoice/101
      const resDelete = await app.inject({
        method: 'DELETE',
        url: '/v1/data/invoice/101',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resDelete.statusCode).toBe(403);
      expect(resDelete.json().message).toContain("Action 'DELETE' is not permitted");
    });

    it('blocks access to undeclared tables like product with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/data/product',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('not authorized for this API key');
    });

    it('supports authentication via query parameters ?key=ceo2026 and ?password=ceo2026', async () => {
      const querySpy = vi.spyOn(poolModule, 'executeQuery').mockImplementation(async () => {
        return { rows: [{ id: 1, invoice_no: 'INV-1' }] } as any;
      });

      const resKey = await app.inject({
        method: 'GET',
        url: '/v1/data/invoice?key=ceo2026',
      });
      expect(resKey.statusCode).toBe(200);

      const resPass = await app.inject({
        method: 'GET',
        url: '/v1/data/invoice?password=ceo2026',
      });
      expect(resPass.statusCode).toBe(200);

      const resHyphen = await app.inject({
        method: 'GET',
        url: '/v1/data/invoice',
        headers: { 'x-api-key': '-ceo2026' },
      });
      expect(resHyphen.statusCode).toBe(200);

      querySpy.mockRestore();
    });
  });

  describe('Key Documentation & Portal (/docs/keys/ceo2026)', () => {
    it('serves SSR HTML documentation listing granted read-only tables', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/keys/ceo2026',
        headers: { accept: 'text/html' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('ceo2026');
      expect(res.body).toContain('invoice');
      expect(res.body).toContain('user');
      expect(res.body).toContain('payment');
      expect(res.body).toContain('submited_payment');
    });

    it('serves Markdown AI Agent documentation at /docs/keys/ceo2026/llms.txt', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/keys/ceo2026/llms.txt',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.body).toContain('ceo2026');
      expect(res.body).toContain('Table: `invoice`');
      expect(res.body).toContain('Table: `user`');
      expect(res.body).toContain('Table: `payment`');
      expect(res.body).toContain('Table: `submited_payment`');
    });

    it('returns document JSON at /api/document?key=ceo2026', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/document?key=ceo2026',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.statusCode).toBe(200);
      expect(json.apiKey).toBe('ceo2026');
      expect(json.document).toContain('Table: `invoice`');
    });
  });

  describe('Monthly Sales Leaderboard Route (/api/sales/leaderboard)', () => {
    it('returns ranked sales leaderboard for October 2026 with ceo2026 key', async () => {
      const querySpy = vi.spyOn(poolModule, 'executeQuery').mockImplementation(async (sql: string) => {
        if (sql.includes('monthly_payments')) {
          return {
            rows: [
              {
                salesperson_name: 'Ng Zhan Yi',
                email: 'louisng0705@gmail.com',
                agent_code: 'A001',
                total_verified_sales: '105049.50',
                payments_count: '9',
                invoices_count: '8',
              },
              {
                salesperson_name: 'OLIVIER KOH CONG LEE',
                email: 'mail2olivier@gmail.com',
                agent_code: 'A002',
                total_verified_sales: '76396.84',
                payments_count: '7',
                invoices_count: '7',
              },
              {
                salesperson_name: 'Teng Kah Kent',
                email: '1989kkteng@gmail.com',
                agent_code: null,
                total_verified_sales: '68040.00',
                payments_count: '8',
                invoices_count: '6',
              },
            ],
          } as any;
        }
        return { rows: [] } as any;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/sales/leaderboard?month=10&year=2026',
        headers: { 'x-api-key': 'ceo2026' },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.period.month).toBe(10);
      expect(json.period.month_name).toBe('October');
      expect(json.period.year).toBe(2026);
      expect(json.summary.total_sales).toBe(249486.34);
      expect(json.summary.salesperson_count).toBe(3);
      expect(json.leaderboard).toHaveLength(3);
      expect(json.leaderboard[0].salesperson_name).toBe('Ng Zhan Yi');
      expect(json.leaderboard[0].rank).toBe(1);
      expect(json.leaderboard[0].total_verified_sales).toBe(105049.5);
      expect(json.leaderboard[1].salesperson_name).toBe('OLIVIER KOH CONG LEE');
      expect(json.leaderboard[1].rank).toBe(2);

      // Test direct alias /api/sales/october
      const resAlias = await app.inject({
        method: 'GET',
        url: '/api/sales/october',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resAlias.statusCode).toBe(200);
      expect(resAlias.json().period.month).toBe(10);

      // Test format=csv
      const resCsv = await app.inject({
        method: 'GET',
        url: '/api/sales/october?format=csv',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resCsv.statusCode).toBe(200);
      expect(resCsv.headers['content-type']).toContain('text/csv');
      expect(resCsv.body).toContain('Ng Zhan Yi');

      // Test format=summary
      const resSum = await app.inject({
        method: 'GET',
        url: '/api/sales/october?format=summary',
        headers: { 'x-api-key': 'ceo2026' },
      });
      expect(resSum.statusCode).toBe(200);
      expect(resSum.body).toContain('Sales Leaderboard (October 2026)');

      querySpy.mockRestore();
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sales/leaderboard',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects unauthorized roles (like catalog_viewer) with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sales/leaderboard',
        headers: { 'x-api-key': 'eter_demo_catalog_key_2026' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Access to the sales leaderboard requires CEO or administrator privileges');
    });
  });
});
