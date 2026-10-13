import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import { executeQuery } from '../db/pool.js';

interface SalesLeaderboardQuery {
  month?: string | number;
  year?: string | number;
  format?: 'json' | 'csv' | 'summary';
  key?: string;
  apiKey?: string;
  secret?: string;
  password?: string;
  pass?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseMonth(val?: string | number): number {
  if (val === undefined || val === null || val === '') {
    return new Date().getMonth() + 1; // Default to current month (1-12)
  }
  if (typeof val === 'number') {
    return Math.min(Math.max(Math.floor(val), 1), 12);
  }
  const clean = String(val).trim().toLowerCase();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return num;
  }
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(clean.slice(0, 3)));
  if (idx !== -1) {
    return idx + 1;
  }
  return new Date().getMonth() + 1;
}

function parseYear(val?: string | number): number {
  if (val === undefined || val === null || val === '') {
    return new Date().getFullYear();
  }
  const num = parseInt(String(val), 10);
  if (!isNaN(num) && num >= 2000 && num <= 2100) {
    return num;
  }
  return new Date().getFullYear();
}

function escapeCsv(val: any): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface LeaderboardEntry {
  rank: number;
  salesperson_name: string;
  total_verified_sales: number;
  payments_count: number;
  invoices_count: number;
  email: string | null;
  agent_code: string | null;
}

export async function fetchSalesLeaderboard(month: number, year: number): Promise<{
  period: { month: number; month_name: string; year: number; start_date: string; end_date: string };
  summary: { total_sales: number; total_payments: number; total_invoices: number; salesperson_count: number };
  leaderboard: LeaderboardEntry[];
}> {
  // Construct UTC timestamp window
  const startStr = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`;

  const sql = `
    WITH monthly_payments AS (
      SELECT 
        p.id as payment_id,
        p.amount as payment_amount,
        p.payment_date,
        p.payment_method,
        p.linked_invoice,
        p.linked_agent,
        COALESCE(
          (SELECT a2.name FROM agent a2 JOIN "user" u2 ON u2.linked_agent_profile = a2.bubble_id WHERE u2.bubble_id = p.linked_agent LIMIT 1),
          a.name, 
          u.name, 
          'Unknown'
        ) as canonical_name,
        COALESCE(a.email, u.email, '') as email,
        COALESCE(a.agent_code, u.agent_code, '') as agent_code
      FROM payment p
      LEFT JOIN agent a ON (p.linked_agent = a.bubble_id OR p.linked_agent = a.id::text)
      LEFT JOIN "user" u ON (p.linked_agent = u.bubble_id OR p.linked_agent = u.id::text)
      WHERE p.payment_date >= $1 AND p.payment_date < $2
        AND p.verified_by IS NOT NULL
    )
    SELECT 
      TRIM(mp.canonical_name) as salesperson_name,
      MAX(NULLIF(mp.email, '')) as email,
      MAX(NULLIF(mp.agent_code, '')) as agent_code,
      SUM(mp.payment_amount) as total_verified_sales,
      COUNT(mp.payment_id) as payments_count,
      COUNT(DISTINCT mp.linked_invoice) as invoices_count
    FROM monthly_payments mp
    GROUP BY TRIM(mp.canonical_name)
    HAVING SUM(mp.payment_amount) > 0
    ORDER BY total_verified_sales DESC;
  `;

  const result = await executeQuery(sql, [startStr, endStr]);

  let totalSales = 0;
  let totalPayments = 0;
  let totalInvoices = 0;

  const leaderboard: LeaderboardEntry[] = [];
  let rank = 1;

  for (const row of result.rows) {
    const sales = Number(row.total_verified_sales) || 0;
    const pCount = Number(row.payments_count) || 0;
    const iCount = Number(row.invoices_count) || 0;

    totalSales += sales;
    totalPayments += pCount;
    totalInvoices += iCount;

    leaderboard.push({
      rank: rank++,
      salesperson_name: row.salesperson_name || 'Unknown',
      total_verified_sales: Math.round(sales * 100) / 100,
      payments_count: pCount,
      invoices_count: iCount,
      email: row.email || null,
      agent_code: row.agent_code || null,
    });
  }

  // Calculate actual last day of month
  const lastDay = new Date(year, month, 0).getDate();
  const endDateFormatted = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return {
    period: {
      month,
      month_name: MONTH_NAMES[month - 1],
      year,
      start_date: `${year}-${String(month).padStart(2, '0')}-01`,
      end_date: endDateFormatted,
    },
    summary: {
      total_sales: Math.round(totalSales * 100) / 100,
      total_payments: totalPayments,
      total_invoices: totalInvoices,
      salesperson_count: leaderboard.length,
    },
    leaderboard,
  };
}

export async function salesRoutes(app: FastifyInstance) {
  // Enforce API key authentication
  app.addHook('preHandler', authenticateApiKey);

  const handler = async (
    request: FastifyRequest<{ Querystring: SalesLeaderboardQuery }>,
    reply: FastifyReply
  ) => {
    // Check permission: Admin, CEO, or key with payment permission
    const isAuthorized =
      request.isAdmin ||
      request.apiKeyRecord?.role === 'ceo' ||
      Boolean(request.apiKeyRecord?.tables?.payment);

    if (!isAuthorized) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Access to the sales leaderboard requires CEO or administrator privileges.',
      });
    }

    const { month: rawMonth, year: rawYear, format } = request.query;
    const month = parseMonth(rawMonth);
    const year = parseYear(rawYear);

    const data = await fetchSalesLeaderboard(month, year);

    // CSV format
    if (format === 'csv') {
      const headers = ['Rank', 'Sales Person', 'Total Verified Sales (RM)', 'Payments Count', 'Invoices Count', 'Email', 'Agent Code'];
      const rows = data.leaderboard.map((item) => [
        item.rank,
        escapeCsv(item.salesperson_name),
        item.total_verified_sales.toFixed(2),
        item.payments_count,
        item.invoices_count,
        escapeCsv(item.email),
        escapeCsv(item.agent_code),
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      const filename = `sales_leaderboard_${data.period.year}_${String(data.period.month).padStart(2, '0')}.csv`;

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csvContent);
    }

    // Summary text format
    if (format === 'summary') {
      const summaryText = `Sales Leaderboard (${data.period.month_name} ${data.period.year}): ${data.summary.salesperson_count} sales persons | Total Verified Sales: RM ${data.summary.total_sales.toLocaleString('en-MY', { minimumFractionDigits: 2 })} across ${data.summary.total_payments} verified payments. Top seller: ${data.leaderboard[0]?.salesperson_name || 'N/A'} (RM ${data.leaderboard[0]?.total_verified_sales.toLocaleString('en-MY', { minimumFractionDigits: 2 }) || '0.00'}).`;
      return reply.type('text/plain; charset=utf-8').send(summaryText);
    }

    // Default JSON format
    return reply.send({
      success: true,
      statusCode: 200,
      ...data,
    });
  };

  // Register main endpoint and shortcuts
  app.get<{ Querystring: SalesLeaderboardQuery }>(
    '/api/sales/leaderboard',
    {
      schema: {
        summary: 'Monthly Sales Leaderboard',
        description: 'Returns the ranked monthly sales leaderboard based on verified payments, sorted highest to lowest, excluding RM 0 sales.',
        tags: ['Sales & Reporting'],
      },
    },
    handler
  );

  app.get<{ Querystring: SalesLeaderboardQuery }>('/v1/sales/leaderboard', handler);

  // Direct convenience alias for October sales
  app.get<{ Querystring: SalesLeaderboardQuery }>(
    '/api/sales/october',
    async (request, reply) => {
      request.query.month = 10;
      request.query.year = request.query.year || 2026;
      return handler(request, reply);
    }
  );

  app.get<{ Querystring: SalesLeaderboardQuery }>(
    '/v1/sales/october',
    async (request, reply) => {
      request.query.month = 10;
      request.query.year = request.query.year || 2026;
      return handler(request, reply);
    }
  );
}
