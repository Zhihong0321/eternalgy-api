import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import { executeQuery } from '../db/pool.js';

interface SalesLeaderboardQuery {
  month?: string | number;
  year?: string | number;
  format?: 'json' | 'csv' | 'summary';
  agent?: string;
  key?: string;
  apiKey?: string;
  secret?: string;
  password?: string;
  pass?: string;
}

interface CorporateMetricsQuery {
  month?: string | number;
  year?: string | number;
  min_paid_pct?: string | number;
  format?: 'json' | 'summary';
  scope?: string;
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

export interface InvoicePaymentItem {
  payment_id: number | string;
  amount: number;
  payment_date: string | null;
  payment_method: string | null;
  verified_by: string | null;
}

export interface AgentInvoiceItem {
  invoice_number: string;
  invoice_id: number | null;
  invoice_total_amount: number | null;
  invoice_status: string | null;
  invoice_date: string | null;
  customer_name: string | null;
  total_paid_in_period: number;
  payments: InvoicePaymentItem[];
}

export interface AgentBreakdownEntry {
  rank: number;
  salesperson_name: string;
  email: string | null;
  agent_code: string | null;
  total_verified_sales: number;
  payments_count: number;
  invoices_count: number;
  invoices: AgentInvoiceItem[];
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

export async function fetchSalesBreakdown(
  month: number,
  year: number,
  agentFilter?: string
): Promise<{
  period: { month: number; month_name: string; year: number; start_date: string; end_date: string };
  summary: { total_sales: number; total_payments: number; total_invoices: number; salesperson_count: number };
  breakdown: AgentBreakdownEntry[];
}> {
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
        p.verified_by,
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
      mp.payment_id,
      mp.payment_amount,
      mp.payment_date,
      mp.payment_method,
      mp.verified_by,
      TRIM(mp.canonical_name) as salesperson_name,
      NULLIF(mp.email, '') as email,
      NULLIF(mp.agent_code, '') as agent_code,
      mp.linked_invoice as payment_linked_invoice,
      inv.id as invoice_id,
      COALESCE(inv.invoice_number, inv.bubble_id, mp.linked_invoice, 'No Linked Invoice') as invoice_number,
      inv.total_amount as invoice_total_amount,
      inv.status as invoice_status,
      inv.invoice_date,
      COALESCE(inv.customer_name_snapshot, inv.linked_customer) as customer_name
    FROM monthly_payments mp
    LEFT JOIN invoice inv ON (
      mp.linked_invoice = inv.bubble_id 
      OR mp.linked_invoice = inv.id::text 
      OR mp.linked_invoice = inv.invoice_number
    )
    ORDER BY salesperson_name, invoice_number, mp.payment_date ASC;
  `;

  const result = await executeQuery(sql, [startStr, endStr]);

  // Group by salesperson -> invoice -> payments
  const agentMap = new Map<string, {
    salesperson_name: string;
    email: string | null;
    agent_code: string | null;
    total_sales: number;
    payments_count: number;
    invoicesMap: Map<string, AgentInvoiceItem>;
  }>();

  for (const row of result.rows) {
    const agentName = row.salesperson_name || 'Unknown';
    if (agentFilter && !agentName.toLowerCase().includes(agentFilter.toLowerCase())) {
      continue;
    }

    if (!agentMap.has(agentName)) {
      agentMap.set(agentName, {
        salesperson_name: agentName,
        email: row.email || null,
        agent_code: row.agent_code || null,
        total_sales: 0,
        payments_count: 0,
        invoicesMap: new Map(),
      });
    }

    const agentRecord = agentMap.get(agentName)!;
    if (row.email && !agentRecord.email) agentRecord.email = row.email;
    if (row.agent_code && !agentRecord.agent_code) agentRecord.agent_code = row.agent_code;

    const pAmount = Number(row.payment_amount) || 0;
    agentRecord.total_sales += pAmount;
    agentRecord.payments_count += 1;

    const invKey = row.invoice_number || 'Unknown';
    if (!agentRecord.invoicesMap.has(invKey)) {
      agentRecord.invoicesMap.set(invKey, {
        invoice_number: invKey,
        invoice_id: row.invoice_id != null ? Number(row.invoice_id) : null,
        invoice_total_amount: row.invoice_total_amount != null ? Number(row.invoice_total_amount) : null,
        invoice_status: row.invoice_status || null,
        invoice_date: row.invoice_date ? new Date(row.invoice_date).toISOString() : null,
        customer_name: row.customer_name || null,
        total_paid_in_period: 0,
        payments: [],
      });
    }

    const invRecord = agentRecord.invoicesMap.get(invKey)!;
    invRecord.total_paid_in_period += pAmount;
    invRecord.payments.push({
      payment_id: row.payment_id,
      amount: Math.round(pAmount * 100) / 100,
      payment_date: row.payment_date ? new Date(row.payment_date).toISOString() : null,
      payment_method: row.payment_method || null,
      verified_by: row.verified_by || null,
    });
  }

  // Sort agents by total_verified_sales descending, excluding 0 sales
  const sortedAgents = Array.from(agentMap.values())
    .filter((a) => a.total_sales > 0)
    .sort((a, b) => b.total_sales - a.total_sales);

  let totalSales = 0;
  let totalPayments = 0;
  let totalInvoices = 0;
  const breakdown: AgentBreakdownEntry[] = [];

  let rank = 1;
  for (const agent of sortedAgents) {
    totalSales += agent.total_sales;
    totalPayments += agent.payments_count;
    totalInvoices += agent.invoicesMap.size;

    const invoicesList = Array.from(agent.invoicesMap.values()).map((inv) => ({
      ...inv,
      total_paid_in_period: Math.round(inv.total_paid_in_period * 100) / 100,
    }));

    breakdown.push({
      rank: rank++,
      salesperson_name: agent.salesperson_name,
      email: agent.email,
      agent_code: agent.agent_code,
      total_verified_sales: Math.round(agent.total_sales * 100) / 100,
      payments_count: agent.payments_count,
      invoices_count: invoicesList.length,
      invoices: invoicesList,
    });
  }

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
      salesperson_count: breakdown.length,
    },
    breakdown,
  };
}

export async function salesRoutes(app: FastifyInstance) {
  // Enforce API key authentication
  app.addHook('preHandler', authenticateApiKey);

  const checkSalesAuth = (request: FastifyRequest, reply: FastifyReply) => {
    const isAuthorized =
      request.isAdmin ||
      request.apiKeyRecord?.role === 'ceo' ||
      Boolean(request.apiKeyRecord?.tables?.payment);

    if (!isAuthorized) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Access to sales reporting requires CEO or administrator privileges.',
      });
      return false;
    }
    return true;
  };

  // 1. Leaderboard handler
  const leaderboardHandler = async (
    request: FastifyRequest<{ Querystring: SalesLeaderboardQuery }>,
    reply: FastifyReply
  ) => {
    if (!checkSalesAuth(request, reply)) return;

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

  // 2. Breakdown handler (Agent -> Invoices -> Payments)
  const breakdownHandler = async (
    request: FastifyRequest<{ Querystring: SalesLeaderboardQuery }>,
    reply: FastifyReply
  ) => {
    if (!checkSalesAuth(request, reply)) return;

    const { month: rawMonth, year: rawYear, format, agent } = request.query;
    const month = parseMonth(rawMonth);
    const year = parseYear(rawYear);

    const data = await fetchSalesBreakdown(month, year, agent);

    // CSV format
    if (format === 'csv') {
      const headers = [
        'Rank',
        'Sales Person',
        'Email',
        'Agent Code',
        'Invoice Number',
        'Invoice Total Amount (RM)',
        'Invoice Status',
        'Customer',
        'Payment ID',
        'Payment Date',
        'Payment Amount (RM)',
        'Payment Method',
        'Verified By',
      ];

      const rows: string[][] = [];
      for (const agentEntry of data.breakdown) {
        for (const invoice of agentEntry.invoices) {
          for (const payment of invoice.payments) {
            rows.push([
              String(agentEntry.rank),
              escapeCsv(agentEntry.salesperson_name),
              escapeCsv(agentEntry.email),
              escapeCsv(agentEntry.agent_code),
              escapeCsv(invoice.invoice_number),
              invoice.invoice_total_amount != null ? invoice.invoice_total_amount.toFixed(2) : '',
              escapeCsv(invoice.invoice_status),
              escapeCsv(invoice.customer_name),
              escapeCsv(payment.payment_id),
              escapeCsv(payment.payment_date),
              payment.amount.toFixed(2),
              escapeCsv(payment.payment_method),
              escapeCsv(payment.verified_by),
            ]);
          }
        }
      }

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      const filename = `sales_breakdown_${data.period.year}_${String(data.period.month).padStart(2, '0')}.csv`;

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csvContent);
    }

    // Summary text format
    if (format === 'summary') {
      const summaryText = `Sales Breakdown (${data.period.month_name} ${data.period.year}): ${data.summary.salesperson_count} sales persons, ${data.summary.total_invoices} invoices, ${data.summary.total_payments} verified payments totaling RM ${data.summary.total_sales.toLocaleString('en-MY', { minimumFractionDigits: 2 })}.`;
      return reply.type('text/plain; charset=utf-8').send(summaryText);
    }

    return reply.send({
      success: true,
      statusCode: 200,
      ...data,
    });
  };

  // 3. Performance Metrics handler (Total Sales, Total Projects, Total kWp)
  const metricsHandler = async (
    request: FastifyRequest<{ Querystring: CorporateMetricsQuery }>,
    reply: FastifyReply
  ) => {
    if (!checkSalesAuth(request, reply)) return;

    const { month: rawMonth, year: rawYear, min_paid_pct, format, scope } = request.query;
    const isMonthly = Boolean(rawMonth || scope === 'period');
    const month = isMonthly ? parseMonth(rawMonth) : undefined;
    const year = isMonthly ? parseYear(rawYear) : undefined;
    const minPaidPct = min_paid_pct !== undefined ? Number(min_paid_pct) : undefined;

    const data = await fetchPerformanceMetrics({ month, year, minPaidPct });

    // Summary text format
    if (format === 'summary') {
      const periodLabel = data.period ? ` (${data.period.month_name} ${data.period.year})` : ' (All-Time Corporate)';
      const summaryText = `Corporate Performance Metrics${periodLabel}: Total Sales: ${data.total_sales_formatted} | Total Projects: ${data.total_projects} | Installed Capacity: ${data.total_kwp_formatted} (${data.total_mwp_formatted}).`;
      return reply.type('text/plain; charset=utf-8').send(summaryText);
    }

    return reply.send({
      success: true,
      statusCode: 200,
      ...data,
    });
  };

  // Register endpoints
  for (const prefix of ['/api/sales', '/v1/sales']) {
    // Leaderboard
    app.get<{ Querystring: SalesLeaderboardQuery }>(`${prefix}/leaderboard`, leaderboardHandler);
    app.get<{ Querystring: SalesLeaderboardQuery }>(
      `${prefix}/october`,
      async (request, reply) => {
        request.query.month = 10;
        request.query.year = request.query.year || 2026;
        return leaderboardHandler(request, reply);
      }
    );

    // Breakdown (Agent -> Invoices -> Payments)
    app.get<{ Querystring: SalesLeaderboardQuery }>(`${prefix}/breakdown`, breakdownHandler);
    app.get<{ Querystring: SalesLeaderboardQuery }>(
      `${prefix}/october/breakdown`,
      async (request, reply) => {
        request.query.month = 10;
        request.query.year = request.query.year || 2026;
        return breakdownHandler(request, reply);
      }
    );

    // Corporate Performance Metrics (Total Sales, Total Projects, Total kWp)
    app.get(`${prefix}/metrics`, metricsHandler);
    app.get(`${prefix}/summary`, metricsHandler);
    app.get(`${prefix}/corporate-metrics`, metricsHandler);
    app.get(
      `${prefix}/october/metrics`,
      async (request: any, reply) => {
        request.query = request.query || {};
        request.query.month = 10;
        request.query.year = request.query.year || 2026;
        return metricsHandler(request, reply);
      }
    );
  }
}

export interface PerformanceMetricsResult {
  period?: {
    month: number;
    month_name: string;
    year: number;
  };
  total_sales: number;
  total_sales_formatted: string;
  total_projects: number;
  total_projects_description: string;
  total_kwp: number;
  total_kwp_formatted: string;
  total_mwp_formatted: string;
  formula: string;
  breakdown_details: {
    customer_revenue_rm: number;
    total_verified_payments_rm: number;
    total_contract_value_rm: number;
    paid_invoices_count_gt_zero: number;
    installed_projects_over_60_pct: number;
    kwp_for_paid_gt_zero: number;
    kwp_for_installed_over_60_pct: number;
  };
}

export async function fetchPerformanceMetrics(options: {
  month?: number;
  year?: number;
  minPaidPct?: number;
}): Promise<PerformanceMetricsResult> {
  const { month, year, minPaidPct } = options;

  let dateFilterInvoice = '';
  let dateFilterPayment = '';
  const invoiceParams: any[] = [];
  const paymentParams: any[] = [];

  if (month && year) {
    const startStr = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`;

    dateFilterInvoice = ` AND (
      (i.last_payment_date >= $1 AND i.last_payment_date < $2)
      OR (i."1st_payment_date" >= $1 AND i."1st_payment_date" < $2)
      OR (i.invoice_date >= $1 AND i.invoice_date < $2)
      OR (i.created_at >= $1 AND i.created_at < $2)
    )`;
    invoiceParams.push(startStr, endStr);

    dateFilterPayment = ` AND p.payment_date >= $1 AND p.payment_date < $2`;
    paymentParams.push(startStr, endStr);
  }

  // 1. Fetch total verified payments from payment table
  const paySql = `
    SELECT 
      COALESCE(SUM(p.amount::numeric), 0) as total_verified_payments,
      COUNT(p.id) as payment_count
    FROM payment p
    WHERE p.verified_by IS NOT NULL
      ${dateFilterPayment}
  `;
  const payRes = await executeQuery(paySql, paymentParams);
  const totalVerifiedPayments = Number(payRes.rows[0]?.total_verified_payments) || 0;

  // 2. Query invoices joined with package and product
  const invSql = `
    SELECT 
      i.id as invoice_id,
      i.invoice_number,
      COALESCE(i.paid_amount::numeric, 0) as paid_amount,
      COALESCE(i.total_amount::numeric, 0) as total_amount,
      COALESCE(i.percent_of_total_amount::numeric, 0) as percent_of_total_amount,
      i.paid,
      i.status as invoice_status,
      COALESCE(i.panel_qty::numeric, pkg.panel_qty::numeric, 0) as panel_qty,
      COALESCE(i.panel_rating::numeric, 0) as inv_panel_rating,
      i.linked_package,
      pkg.bubble_id as pkg_bubble_id,
      pkg.package_name as pkg_name,
      prod.name as prod_name,
      prod.selling_price as prod_price
    FROM invoice i
    LEFT JOIN package pkg ON (i.linked_package = pkg.bubble_id OR i.linked_package = pkg.id::text)
    LEFT JOIN product prod ON (pkg.panel = prod.bubble_id OR pkg.panel = prod.id::text)
    WHERE COALESCE(i.is_deleted, false) = false
      AND (
        COALESCE(i.paid_amount::numeric, 0) > 0 
        OR i.paid = true 
        OR COALESCE(i.percent_of_total_amount::numeric, 0) > 0
      )
      ${dateFilterInvoice}
  `;

  const invRes = await executeQuery(invSql, invoiceParams);

  let totalCustomerRevenue = 0;
  let totalContractValue = 0;
  let paidInvoicesCountGtZero = 0;
  let installedProjectsOver60Pct = 0;

  let totalKwpAllPaid = 0;
  let totalKwpOver60Pct = 0;

  for (const row of invRes.rows) {
    const paidAmount = Number(row.paid_amount) || 0;
    const totalAmount = Number(row.total_amount) || 0;
    let pct = Number(row.percent_of_total_amount) || 0;
    if (pct === 0 && totalAmount > 0 && paidAmount > 0) {
      pct = (paidAmount / totalAmount) * 100;
    }

    if (paidAmount > 0 || row.paid === true || pct > 0) {
      paidInvoicesCountGtZero++;
      totalCustomerRevenue += paidAmount;
      totalContractValue += totalAmount;
    }

    const isInstalledOver60 = pct >= 59.9;
    if (isInstalledOver60) {
      installedProjectsOver60Pct++;
    }

    // Determine panel wattage rating (e.g. 550W, 580W, 600W)
    let panelRating = Number(row.inv_panel_rating) || 0;
    if (panelRating <= 0 && row.prod_name) {
      const wattMatch = String(row.prod_name).match(/(\d{3})\s*w/i);
      if (wattMatch) {
        panelRating = Number(wattMatch[1]) || 0;
      }
    }
    if (panelRating <= 0 && row.pkg_name) {
      const wattMatch = String(row.pkg_name).match(/(\d{3})\s*w/i);
      if (wattMatch) {
        panelRating = Number(wattMatch[1]) || 0;
      }
    }

    const qty = Number(row.panel_qty) || 0;
    const rowKwp = (panelRating * qty) / 1000.0;

    totalKwpAllPaid += rowKwp;
    if (isInstalledOver60) {
      totalKwpOver60Pct += rowKwp;
    }
  }

  // Determine which metric set to surface as primary (support minPaidPct filter if provided)
  const isFiltering60 = minPaidPct !== undefined ? minPaidPct >= 50 : false;
  const primaryProjects = isFiltering60 ? installedProjectsOver60Pct : paidInvoicesCountGtZero;
  const primaryKwp = isFiltering60 ? totalKwpOver60Pct : totalKwpAllPaid;
  const primarySales = totalCustomerRevenue > 0 ? totalCustomerRevenue : totalVerifiedPayments;

  const kwpRounded = Math.round(primaryKwp * 100) / 100;
  const mwpRounded = Math.round((kwpRounded / 1000) * 100) / 100;

  const result: PerformanceMetricsResult = {
    total_sales: Math.round(primarySales * 100) / 100,
    total_sales_formatted: `RM ${primarySales.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    total_projects: primaryProjects,
    total_projects_description: isFiltering60 
      ? 'Installed Projects (≥59.9% Paid)' 
      : 'Total Projects with Payment (>0% Paid)',
    total_kwp: kwpRounded,
    total_kwp_formatted: `${kwpRounded.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWp`,
    total_mwp_formatted: `${mwpRounded.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWp`,
    formula: 'linked package solar panel rating * panel qty / 1000',
    breakdown_details: {
      customer_revenue_rm: Math.round(totalCustomerRevenue * 100) / 100,
      total_verified_payments_rm: Math.round(totalVerifiedPayments * 100) / 100,
      total_contract_value_rm: Math.round(totalContractValue * 100) / 100,
      paid_invoices_count_gt_zero: paidInvoicesCountGtZero,
      installed_projects_over_60_pct: installedProjectsOver60Pct,
      kwp_for_paid_gt_zero: Math.round(totalKwpAllPaid * 100) / 100,
      kwp_for_installed_over_60_pct: Math.round(totalKwpOver60Pct * 100) / 100,
    },
  };

  if (month && year) {
    result.period = {
      month,
      month_name: MONTH_NAMES[month - 1],
      year,
    };
  }

  return result;
}

