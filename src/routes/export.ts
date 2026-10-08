import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import {
  fetchPaidCustomerRecords,
  formatRecordsToCsv,
  getMasterCopyStatus,
  readMasterCopy,
  refreshMasterCopy,
  saveMasterCopy,
} from '../services/customer-export-service.js';

interface ExportQuerystring {
  format?: 'csv' | 'json';
  source?: 'master' | 'live';
  deduplicate?: string | boolean;
  requirePhone?: string | boolean;
  requireEmail?: string | boolean;
  minPaidAmount?: string | number;
  since?: string;
  sinceDays?: string | number;
  dateType?: 'updated' | 'payment' | 'created';
  limit?: string | number;
  key?: string;
  apiKey?: string;
  secret?: string;
  password?: string;
  pass?: string;
}

interface RefreshQuerystring {
  mode?: 'full' | 'incremental';
  key?: string;
  apiKey?: string;
  secret?: string;
  password?: string;
  pass?: string;
}

function buildDownloadUrl(request: FastifyRequest): string {
  const protocol = (request.headers['x-forwarded-proto'] as string) || request.protocol || 'http';
  const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || 'localhost:3000';
  const url = new URL(`${protocol}://${host}/api/export/paid-customers/download`);

  const q = (request.query || {}) as Record<string, any>;
  for (const [key, val] of Object.entries(q)) {
    if (key !== 'format' && val !== undefined) {
      url.searchParams.set(key, String(val));
    }
  }

  const authHeader = request.headers.authorization;
  const adminSecret = request.headers['x-admin-secret'] as string | undefined;
  const apiKey =
    (request.headers['x-api-key'] as string | undefined) ||
    q.key ||
    q.apiKey ||
    q.password ||
    q.pass;

  if (
    !url.searchParams.has('key') &&
    !url.searchParams.has('secret') &&
    !url.searchParams.has('apiKey') &&
    !url.searchParams.has('password') &&
    !url.searchParams.has('pass')
  ) {
    if (adminSecret) {
      url.searchParams.set('secret', adminSecret);
    } else if (apiKey) {
      url.searchParams.set('key', apiKey);
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      url.searchParams.set('key', authHeader.slice(7).trim());
    }
  }

  return url.toString();
}

export async function exportRoutes(app: FastifyInstance) {
  // Enforce API key or Admin key authentication (supports headers or query param token)
  app.addHook('preHandler', authenticateApiKey);

  /**
   * GET /api/export/paid-customers/status - Check master copy file metadata
   */
  app.get(
    '/api/export/paid-customers/status',
    {
      schema: {
        summary: 'Check Master Copy File Status',
        description: 'Returns metadata for the stored master copy CSV file on the API Gateway.',
        tags: ['Export & Reporting'],
      },
    },
    async (request, reply) => {
      const status = getMasterCopyStatus();
      const downloadUrl = buildDownloadUrl(request);
      return reply.send({
        ...status,
        download_url: downloadUrl,
        link: downloadUrl,
      });
    }
  );

  /**
   * POST /api/export/paid-customers/refresh - Manually update the master copy
   */
  app.post<{ Querystring: RefreshQuerystring }>(
    '/api/export/paid-customers/refresh',
    {
      schema: {
        summary: 'Manually Refresh Master Copy CSV',
        description:
          'Triggers a manual refresh of the stored master copy CSV on the API Gateway. Mode "full" re-queries all paid customers; mode "incremental" appends records updated since last sync.',
        tags: ['Export & Reporting'],
        querystring: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['full', 'incremental'],
              default: 'full',
              description: 'Refresh mode: "full" rewrites entire master copy, "incremental" appends newly paid customers.',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { mode = 'full' } = request.query;
      const result = await refreshMasterCopy({ mode });
      const downloadUrl = buildDownloadUrl(request);

      return reply.send({
        success: true,
        summary: `total customer with payment found : ${result.metadata.recordCount}`,
        total_customers_with_payment: result.metadata.recordCount,
        link: downloadUrl,
        download_url: downloadUrl,
        file_name: result.metadata.fileName,
        file_size_kb: result.metadata.fileSizeKb,
        last_updated: result.metadata.lastUpdated,
        mode,
        added_count: result.addedCount,
      });
    }
  );

  /**
   * Stream / Download handler for CSV file
   */
  const downloadHandler = async (
    request: FastifyRequest<{ Querystring: ExportQuerystring }>,
    reply: FastifyReply
  ) => {
    const {
      source = 'master',
      deduplicate = 'true',
      requirePhone = 'false',
      requireEmail = 'false',
      minPaidAmount = 0,
      since,
      sinceDays,
      dateType = 'updated',
      limit,
    } = request.query;

    const isDeduplicate = deduplicate === true || deduplicate === 'true';
    const isRequirePhone = requirePhone === true || requirePhone === 'true';
    const isRequireEmail = requireEmail === true || requireEmail === 'true';
    const numMinPaidAmount = Number(minPaidAmount) || 0;
    const numSinceDays = sinceDays != null ? Number(sinceDays) : undefined;
    const numLimit = limit ? Number(limit) : undefined;

    const isStandardMasterRequest =
      source === 'master' &&
      !since &&
      numSinceDays == null &&
      !numLimit &&
      !isRequirePhone &&
      !isRequireEmail &&
      numMinPaidAmount === 0 &&
      isDeduplicate;

    if (isStandardMasterRequest) {
      let stored = readMasterCopy();
      if (!stored) {
        const records = await fetchPaidCustomerRecords({ deduplicate: true });
        saveMasterCopy(records);
        stored = readMasterCopy();
      }

      if (stored) {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="paid_customers.csv"')
          .header('X-Master-Copy', 'true')
          .header('X-Export-Summary', `total customer with payment found : ${stored.metadata.recordCount}`)
          .header('X-Export-Count', String(stored.metadata.recordCount))
          .header('X-Export-Timestamp', stored.metadata.lastUpdated)
          .send(stored.content);
      }
    }

    // Filtered / live query
    const records = await fetchPaidCustomerRecords({
      deduplicate: isDeduplicate,
      requirePhone: isRequirePhone,
      requireEmail: isRequireEmail,
      minPaidAmount: numMinPaidAmount,
      since,
      sinceDays: numSinceDays,
      dateType,
      limit: numLimit,
    });

    const exportTimestamp = new Date().toISOString();
    const csvContent = formatRecordsToCsv(records);

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="paid_customers.csv"')
      .header('X-Master-Copy', 'false')
      .header('X-Export-Summary', `total customer with payment found : ${records.length}`)
      .header('X-Export-Count', String(records.length))
      .header('X-Export-Timestamp', exportTimestamp)
      .send(csvContent);
  };

  /**
   * Main API endpoint: Returns summary of total customer with payment found + link to CSV file
   */
  const summaryOrCsvHandler = async (
    request: FastifyRequest<{ Querystring: ExportQuerystring }>,
    reply: FastifyReply
  ) => {
    const { format } = request.query;

    // If caller explicitly asks for CSV download, deliver the file
    if (format === 'csv') {
      return downloadHandler(request, reply);
    }

    const {
      source = 'master',
      deduplicate = 'true',
      requirePhone = 'false',
      requireEmail = 'false',
      minPaidAmount = 0,
      since,
      sinceDays,
      dateType = 'updated',
      limit,
    } = request.query;

    const isDeduplicate = deduplicate === true || deduplicate === 'true';
    const isRequirePhone = requirePhone === true || requirePhone === 'true';
    const isRequireEmail = requireEmail === true || requireEmail === 'true';
    const numMinPaidAmount = Number(minPaidAmount) || 0;
    const numSinceDays = sinceDays != null ? Number(sinceDays) : undefined;
    const numLimit = limit ? Number(limit) : undefined;

    const isStandardMasterRequest =
      source === 'master' &&
      !since &&
      numSinceDays == null &&
      !numLimit &&
      !isRequirePhone &&
      !isRequireEmail &&
      numMinPaidAmount === 0 &&
      isDeduplicate;

    const downloadUrl = buildDownloadUrl(request);

    // If standard master request and master copy is already on disk:
    if (isStandardMasterRequest) {
      let status = getMasterCopyStatus();
      if (!status.exists || !status.metadata) {
        // Generate initial master copy
        const records = await fetchPaidCustomerRecords({ deduplicate: true });
        saveMasterCopy(records);
        status = getMasterCopyStatus();
      }

      const totalCount = status.metadata?.recordCount || 0;
      return reply.send({
        success: true,
        summary: `total customer with payment found : ${totalCount}`,
        total_customers_with_payment: totalCount,
        link: downloadUrl,
        download_url: downloadUrl,
        file_name: status.metadata?.fileName || 'paid_customers_master.csv',
        file_size_kb: status.metadata?.fileSizeKb || 0,
        last_updated: status.metadata?.lastUpdated || new Date().toISOString(),
      });
    }

    // Filtered request: calculate count and provide direct link
    const records = await fetchPaidCustomerRecords({
      deduplicate: isDeduplicate,
      requirePhone: isRequirePhone,
      requireEmail: isRequireEmail,
      minPaidAmount: numMinPaidAmount,
      since,
      sinceDays: numSinceDays,
      dateType,
      limit: numLimit,
    });

    return reply.send({
      success: true,
      summary: `total customer with payment found : ${records.length}`,
      total_customers_with_payment: records.length,
      link: downloadUrl,
      download_url: downloadUrl,
      last_updated: new Date().toISOString(),
    });
  };

  const schema = {
    summary: 'Get Paid Customers Summary & Download Link',
    description:
      'Returns a summary with "total customer with payment found : [x]" and a direct link to download the CSV file. Pass format=csv to stream the CSV file directly.',
    tags: ['Export & Reporting'],
    querystring: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          default: 'json',
          description: 'Return JSON summary with download link (default) or download CSV file directly.',
        },
        source: {
          type: 'string',
          enum: ['master', 'live'],
          default: 'master',
          description: '"master" serves the stored copy on server (instant); "live" queries DB in real time.',
        },
        deduplicate: {
          type: 'string',
          enum: ['true', 'false'],
          default: 'true',
          description: 'Deduplicate by customer (1 row per unique paying customer)',
        },
        requirePhone: {
          type: 'string',
          enum: ['true', 'false'],
          default: 'false',
          description: 'Filter out rows without valid phone number',
        },
        requireEmail: {
          type: 'string',
          enum: ['true', 'false'],
          default: 'false',
          description: 'Filter out rows without valid email address',
        },
        minPaidAmount: {
          type: 'number',
          default: 0,
          description: 'Minimum invoice paid amount filter',
        },
        since: {
          type: 'string',
          description: 'ISO timestamp or YYYY-MM-DD date. Only invoices updated or paid on/after this date are exported.',
        },
        sinceDays: {
          type: 'integer',
          description: 'Relative days filter (e.g. 7 for the last 7 days).',
        },
        dateType: {
          type: 'string',
          enum: ['updated', 'payment', 'created'],
          default: 'updated',
          description: 'Which timestamp to filter on when since or sinceDays is supplied (updated, payment, or created).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of records to return',
        },
      },
    },
  };

  // Primary API endpoint (returns summary + download link, or CSV if ?format=csv)
  app.get<{ Querystring: ExportQuerystring }>(
    '/api/export/paid-customers',
    { schema },
    summaryOrCsvHandler
  );

  // Dedicated direct CSV download endpoint
  app.get<{ Querystring: ExportQuerystring }>(
    '/api/export/paid-customers/download',
    { schema },
    downloadHandler
  );

  // Download extension alias (.csv)
  app.get<{ Querystring: ExportQuerystring }>(
    '/api/export/paid-customers.csv',
    { schema },
    downloadHandler
  );

  // v1 prefix alias
  app.get<{ Querystring: ExportQuerystring }>(
    '/v1/export/paid-customers',
    { schema },
    summaryOrCsvHandler
  );
}
