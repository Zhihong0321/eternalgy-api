import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import { DEFAULT_SENSITIVE_COLUMNS } from '../security/policies.js';
import { executeQuery } from '../db/pool.js';
import { config } from '../config/env.js';

/**
 * Read-only invoice lookup:
 *   GET /api/invoices/search?customer_name=...  -> invoices matching a customer name
 *   GET /api/invoices/:id                       -> full invoice detail (+ customer, package, items, seda, products, payments)
 * `:id` may be the invoice id, bubble_id or invoice_number.
 * Requires the admin key or an API key with read access to the `invoice` table.
 */

interface SearchQuery {
  customer_name?: string;
  name?: string;
  q?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

function canReadInvoices(request: FastifyRequest): boolean {
  if (request.isAdmin) return true;
  const actions = request.apiKeyRecord?.tables?.invoice?.actions;
  return Array.isArray(actions) && actions.includes('read');
}

function stripSensitive<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (!DEFAULT_SENSITIVE_COLUMNS.has(k.toLowerCase())) out[k] = v;
  }
  return out as T;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateApiKey);

  const guard = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (canReadInvoices(request)) return true;
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: "This API key has no read access to the 'invoice' table.",
    });
    return false;
  };

  const searchHandler = async (
    request: FastifyRequest<{ Querystring: SearchQuery }>,
    reply: FastifyReply
  ) => {
    if (!guard(request, reply)) return;

    const query = request.query || {};
    const term = String(query.customer_name ?? query.name ?? query.q ?? '').trim();
    const status = String(query.status ?? '').trim();
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), config.MAX_QUERY_LIMIT);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const params: any[] = [];
    const where: string[] = [];

    if (term) {
      params.push(`%${escapeLike(term)}%`);
      where.push(`(i.customer_name_snapshot ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`LOWER(i.status) = LOWER($${params.length})`);
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT
        i.id,
        i.bubble_id,
        i.invoice_number,
        i.invoice_date,
        i.status,
        i.total_amount,
        i.paid_amount,
        i.linked_customer,
        COALESCE(NULLIF(TRIM(i.customer_name_snapshot), ''), c.name) AS customer_name
      FROM invoice i
      LEFT JOIN customer c ON i.linked_customer = c.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY i.invoice_date DESC NULLS LAST, i.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await executeQuery(sql, params);
    return reply.send({
      data: result.rows || [],
      count: (result.rows || []).length,
      limit,
      offset,
    });
  };

  const detailHandler = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    if (!guard(request, reply)) return;

    const id = String(request.params?.id ?? '').trim();
    if (!id) {
      return reply.status(400).send({ statusCode: 400, message: 'Missing invoice id' });
    }

    const invoiceRes = await executeQuery(
      `SELECT * FROM invoice
       WHERE id::text = $1 OR bubble_id = $1 OR invoice_number = $1
       LIMIT 1`,
      [id]
    );

    const invoice = invoiceRes.rows?.[0];
    if (!invoice) {
      return reply.status(404).send({ statusCode: 404, message: 'Invoice not found' });
    }

    // Everything below is best-effort: a failed lookup is reported in `warnings`
    // and never hides the invoice itself.
    const warnings: string[] = [];
    const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        warnings.push(`${label} lookup failed: ${err?.message ?? 'unknown error'}`);
        return fallback;
      }
    };
    const rows = async (sql: string, params: any[]): Promise<Record<string, any>[]> => {
      const res = await executeQuery(sql, params);
      return (res.rows || []).map(stripSensitive);
    };
    const idList = (v: any): string[] => {
      if (v === null || v === undefined || v === '') return [];
      if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
      return String(v).split(/[,\s]+/).filter(Boolean);
    };

    const invoiceKeys = [
      String(invoice.bubble_id ?? ''),
      String(invoice.id ?? ''),
      String(invoice.invoice_number ?? ''),
    ];

    const customer = await safe('customer', async () => {
      const ids = idList(invoice.linked_customer);
      if (!ids.length) return null;
      const r = await rows(
        `SELECT * FROM customer WHERE customer_id = ANY($1::text[]) OR bubble_id = ANY($1::text[]) LIMIT 1`,
        [ids]
      );
      return r[0] ?? null;
    }, null as Record<string, any> | null);

    const payments = await safe('payments', () => rows(
      `SELECT * FROM payment
       WHERE linked_invoice = ANY($1::text[])
       ORDER BY payment_date ASC NULLS LAST`,
      [invoiceKeys.filter(Boolean)]
    ), [] as Record<string, any>[]);

    const pkg = await safe('package', async () => {
      const ids = idList(invoice.linked_package);
      if (!ids.length) return null;
      const r = await rows(
        `SELECT * FROM package WHERE bubble_id = ANY($1::text[]) OR id::text = ANY($1::text[]) LIMIT 1`,
        [ids]
      );
      return r[0] ?? null;
    }, null as Record<string, any> | null);

    const invoiceItems = await safe('invoice_items', async () => {
      const found = new Map<string, Record<string, any>>();
      const add = (list: Record<string, any>[]) => {
        for (const r of list) found.set(String(r.bubble_id ?? r.id ?? found.size), r);
      };
      const ids = idList(invoice.linked_invoice_item);
      if (ids.length) {
        try {
          add(await rows(
            `SELECT * FROM invoice_item WHERE bubble_id = ANY($1::text[]) OR id::text = ANY($1::text[])`,
            [ids]
          ));
        } catch (err: any) {
          warnings.push(`invoice_items (by id list) lookup failed: ${err?.message ?? 'unknown error'}`);
        }
      }
      try {
        add(await rows(
          `SELECT * FROM invoice_item WHERE linked_invoice = ANY($1::text[])`,
          [invoiceKeys.filter(Boolean)]
        ));
      } catch (err: any) {
        if (!found.size) warnings.push(`invoice_items (by invoice) lookup failed: ${err?.message ?? 'unknown error'}`);
      }
      return Array.from(found.values());
    }, [] as Record<string, any>[]);

    const seda = await safe('seda_registration', async () => {
      const ids = idList(invoice.linked_seda_registration);
      if (!ids.length) return null;
      const r = await rows(
        `SELECT * FROM seda_registration WHERE bubble_id = ANY($1::text[]) OR id::text = ANY($1::text[]) LIMIT 1`,
        [ids]
      );
      return r[0] ?? null;
    }, null as Record<string, any> | null);

    // Products referenced by the package or the invoice items (panel, inverter, ...).
    const products = await safe('products', async () => {
      const refs = new Set<string>();
      const collect = (row: Record<string, any> | null) => {
        for (const v of Object.values(row || {})) {
          if (typeof v === 'string' && v.length >= 8 && v.length <= 64 && !/\s/.test(v)) refs.add(v);
          else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && refs.add(x));
        }
      };
      collect(pkg);
      invoiceItems.forEach(collect);
      if (!refs.size) return [];
      return rows(
        `SELECT * FROM product WHERE bubble_id = ANY($1::text[]) LIMIT 50`,
        [Array.from(refs)]
      );
    }, [] as Record<string, any>[]);

    return reply.send({
      data: {
        invoice: stripSensitive(invoice),
        customer,
        package: pkg,
        invoice_items: invoiceItems,
        seda_registration: seda,
        products,
        payments,
      },
      ...(warnings.length ? { warnings } : {}),
    });
  };

  for (const prefix of ['/api/invoices', '/v1/invoices']) {
    app.get<{ Querystring: SearchQuery }>(`${prefix}/search`, searchHandler);
    app.get<{ Params: { id: string } }>(`${prefix}/:id`, detailHandler);
  }
}
