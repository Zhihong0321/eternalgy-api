import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import { DEFAULT_SENSITIVE_COLUMNS } from '../security/policies.js';
import { executeQuery } from '../db/pool.js';
import { config } from '../config/env.js';

/**
 * Read-only invoice lookup:
 *   GET /api/invoices/search?customer_name=...  -> invoices matching a customer name
 *   GET /api/invoices/:id                       -> full invoice detail (+ customer + payments)
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

    // Customer and payments are best-effort: a failure here is reported on the
    // response and never hides the invoice itself.
    const warnings: string[] = [];

    let customer: Record<string, any> | null = null;
    try {
      if (invoice.linked_customer) {
        const custRes = await executeQuery(
          `SELECT customer_id, name, phone, email FROM customer WHERE customer_id = $1 LIMIT 1`,
          [invoice.linked_customer]
        );
        customer = custRes.rows?.[0] ?? null;
      }
    } catch (err: any) {
      warnings.push(`customer lookup failed: ${err?.message ?? 'unknown error'}`);
    }

    let payments: Record<string, any>[] = [];
    try {
      const payRes = await executeQuery(
        `SELECT * FROM payment
         WHERE linked_invoice = $1 OR linked_invoice = $2 OR linked_invoice = $3
         ORDER BY payment_date ASC NULLS LAST`,
        [
          String(invoice.bubble_id ?? ''),
          String(invoice.id ?? ''),
          String(invoice.invoice_number ?? ''),
        ]
      );
      payments = (payRes.rows || []).map(stripSensitive);
    } catch (err: any) {
      warnings.push(`payments lookup failed: ${err?.message ?? 'unknown error'}`);
    }

    return reply.send({
      data: {
        invoice: stripSensitive(invoice),
        customer,
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
