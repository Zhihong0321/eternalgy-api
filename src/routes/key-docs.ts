import { FastifyInstance } from 'fastify';
import { keyService } from '../security/key-service.js';
import { proxyService } from '../security/proxy-service.js';
import { schemaService, ColumnMetadata } from '../db/schema-service.js';
import { DEFAULT_SENSITIVE_COLUMNS } from '../security/policies.js';
import { ApiKeyRecord } from '../security/types.js';
import { renderKeyDocHtml } from './key-docs-renderer.js';
import { KeyDocProfile, KeyDocTable, KeyDocEndpoint, KeyDocProxyService } from './key-docs-types.js';

function mapPgTypeToJsonSchema(pgType: string): { type: string; format?: string } {
  const t = pgType.toLowerCase();
  if (t.includes('int') || t === 'serial') return { type: 'integer' };
  if (t === 'numeric' || t === 'decimal' || t === 'real' || t.includes('float') || t.includes('double')) return { type: 'number' };
  if (t === 'boolean' || t === 'bool') return { type: 'boolean' };
  if (t.includes('timestamp') || t === 'date' || t === 'time') return { type: 'string', format: 'date-time' };
  if (t === 'json' || t === 'jsonb') return { type: 'object' };
  if (t.includes('[]') || t === 'array') return { type: 'array' };
  return { type: 'string' };
}

export function buildAiAgentPrompt(params: {
  key: ApiKeyRecord;
  keyToUse: string;
  host: string;
  tableSchemas: any[];
  relationships: any[];
  proxyList: any[];
}): string {
  const { key, keyToUse, host, tableSchemas, relationships, proxyList } = params;

  let out = `# 🤖 AI Coding Agent System Prompt & Schema Specification
# Eternalgy Central API Gateway

> ⚠️ **MANDATORY INSTRUCTION FOR AI AGENTS (CRITICAL):**
> Before executing any queries or creating project files, **remind and instruct the user**:
> 1. **Start in a new dedicated workspace directory**:
>    \`\`\`bash
>    mkdir eternalgy-ats-integration && cd eternalgy-ats-integration
>    \`\`\`
> 2. **Store memory, discussion history, and decisions in that directory**:
>    Create and update a \`MEMORY.md\` (or \`.cursorrules\`) file inside this folder to track architectural decisions, table schemas, and API test logs across coding sessions.
> 3. Keep all scripts, environment keys (\`.env\`), and tests contained within this folder.

---

## 🔑 1. Gateway Authentication & Architecture

- **Gateway Base URL**: \`${host}\`
- **Authorized API Key**: \`${keyToUse}\`
- **Client Name / Role**: \`${key.name}\` (\`${key.role || 'custom'}\`)
- **Rate Limit**: \`${key.rateLimitRpm} requests/minute\`
- **Authentication Header**:
  \`\`\`http
  x-api-key: ${keyToUse}
  \`\`\`
*(Bearer token is also supported: \`Authorization: Bearer ${keyToUse}\`)*

### 🛡️ Credential Cloaking & Reverse Proxy
This gateway is your central access point. You **do not need raw database passwords or 3rd-party vendor keys**.
The gateway automatically:
- Authorizes and audits every request.
- Cloaks vendor credentials (upstream vendor keys are securely injected by the gateway).
- Enforces column masking and row guardrails.

---

## 🗄️ 2. PostgreSQL Tables & Data Schemas

`;

  for (const t of tableSchemas) {
    const readableCols = t.columns?.readable || t.columns || [];
    out += `### Table: \`${t.table}\`
- **Permitted Actions**: ${t.actions.map((a: string) => `\`${a.toUpperCase()}\``).join(', ')}
- **Endpoints**:
  - \`GET ${host}/v1/data/${t.table}?limit=10&offset=0\` (Query & filter)
  - \`GET ${host}/v1/data/${t.table}/{id}\` (Get single record)
  - \`POST ${host}/v1/data/${t.table}\` (Create new record)
  - \`PATCH ${host}/v1/data/${t.table}/{id}\` (Update record)
  - \`DELETE ${host}/v1/data/${t.table}/{id}\` (Delete record)

- **Columns (${readableCols.length})**:
| Column Name | PostgreSQL Type | Nullable | Primary Key |
| :--- | :--- | :--- | :--- |
${readableCols.map((c: any) => `| \`${c.name}\` | \`${c.dataType}\` | ${c.isNullable ? 'Nullable' : '**Not Null**'} | ${c.isPrimaryKey ? '🔑 Primary Key' : '-'} |`).join('\n')}

`;
  }

  out += `---

## 🔗 3. Database Entity Relationships & Foreign Keys

`;

  if (relationships.length > 0) {
    out += `| Source Field | References Target | Type | Description |
| :--- | :--- | :--- | :--- |
`;
    for (const r of relationships) {
      out += `| \`${r.sourceTable}.${r.sourceColumn}\` | \`${r.targetTable}.${r.targetColumn}\` | \`${r.type}\` | ${r.description || ''} |\n`;
    }
  } else {
    out += `No cross-table foreign key constraints configured.\n`;
  }

  if (proxyList.length > 0) {
    out += `\n---

## 🌐 4. 3rd-Party APIs (ATAP Solar Calculator & ATS Add-on)

`;
    for (const p of proxyList) {
      out += `### Service: ${p.name} (\`${p.id}\`)
- **Upstream Target**: \`${p.baseUrl}\` *(Vendor key is cloaked & auto-injected)*
- **ATS Add-on Endpoints**:
  - \`GET ${host}/v1/settings/ats-addon-price\` — Retrieve current price setting
  - \`PUT ${host}/v1/settings/ats-addon-price\` — Update price (Payload: \`{"price": 2000}\`)
  - \`ALL ${host}/api/proxy/${p.id}/*\` — Raw reverse proxy wildcard forwarder
`;
    }
  }

  out += `\n---

## 💻 5. Quickstart Code Snippets

### cURL
\`\`\`bash
# 1. Update ATS Add-on Price
curl -X PUT "${host}/v1/settings/ats-addon-price" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${keyToUse}" \\
  -d '{"price": 2000}'

# 2. Query Products from PostgreSQL
curl -X GET "${host}/v1/data/product?limit=5" \\
  -H "x-api-key: ${keyToUse}"
\`\`\`

### Node.js (fetch)
\`\`\`javascript
const res = await fetch("${host}/v1/settings/ats-addon-price", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${keyToUse}",
  },
  body: JSON.stringify({ price: 2000 }),
});
console.log(await res.json());
\`\`\`
`;

  return out;
}

export async function buildKeyDocProfile(
  key: ApiKeyRecord,
  rawSecret: string | undefined,
  host: string
): Promise<KeyDocProfile> {
  const tableSchemas: KeyDocTable[] = [];

  for (const [tableName, policy] of Object.entries(key.tables)) {
    const allCols = await schemaService.getColumnsForTable(tableName);

    // 1. Filter readable columns
    let readableCols: ColumnMetadata[] = allCols.filter(
      (c) => !DEFAULT_SENSITIVE_COLUMNS.has(c.name.toLowerCase())
    );
    if (policy.allowedColumns && policy.allowedColumns.length > 0) {
      const allowedSet = new Set(policy.allowedColumns);
      readableCols = readableCols.filter((c) => allowedSet.has(c.name));
    }
    if (policy.forbiddenColumns && policy.forbiddenColumns.length > 0) {
      const forbiddenSet = new Set(policy.forbiddenColumns);
      readableCols = readableCols.filter((c) => !forbiddenSet.has(c.name));
    }

    // 2. Filter writable columns
    let writableCols: ColumnMetadata[] = allCols.filter(
      (c) => c.name !== 'id' && !DEFAULT_SENSITIVE_COLUMNS.has(c.name.toLowerCase())
    );
    if (policy.writableColumns && policy.writableColumns.length > 0) {
      const writableSet = new Set(policy.writableColumns);
      writableCols = writableCols.filter((c) => writableSet.has(c.name));
    }

    // 3. Available endpoints for this table
    const endpoints: KeyDocEndpoint[] = [];
    if (policy.actions.includes('read')) {
      endpoints.push({
        method: 'GET',
        path: `/v1/data/${tableName}`,
        description: `List ${tableName} records with filtering and pagination (?limit=20&offset=0&sort=id&order=asc)`,
      });
      endpoints.push({
        method: 'GET',
        path: `/v1/data/${tableName}/{id}`,
        description: `Get a single ${tableName} record by ID`,
      });
    }
    if (policy.actions.includes('create')) {
      endpoints.push({
        method: 'POST',
        path: `/v1/data/${tableName}`,
        description: `Insert a new ${tableName} record`,
      });
    }
    if (policy.actions.includes('update')) {
      endpoints.push({
        method: 'PATCH',
        path: `/v1/data/${tableName}/{id}`,
        description: `Update an existing ${tableName} record by ID`,
      });
    }
    if (policy.actions.includes('delete')) {
      endpoints.push({
        method: 'DELETE',
        path: `/v1/data/${tableName}/{id}`,
        description: `Delete a ${tableName} record by ID`,
      });
    }

    tableSchemas.push({
      table: tableName,
      actions: policy.actions,
      rowScope: policy.rowScope || null,
      endpoints,
      columns: {
        readable: readableCols.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isNullable: c.isNullable,
          isPrimaryKey: c.isPrimaryKey,
          jsonType: mapPgTypeToJsonSchema(c.dataType).type,
        })),
        writable: policy.actions.some((a) => a === 'create' || a === 'update')
          ? writableCols.map((c) => ({
              name: c.name,
              dataType: c.dataType,
              isNullable: c.isNullable,
              jsonType: mapPgTypeToJsonSchema(c.dataType).type,
            }))
          : [],
      },
    });
  }

  // Introspect entity relationships across permitted tables
  const tableNames = Object.keys(key.tables);
  const relationships = await schemaService.getRelationshipsForTables(tableNames);

  const proxyList: KeyDocProxyService[] = [];
  if (key.proxies) {
    for (const [serviceId, policy] of Object.entries(key.proxies)) {
      const svc = await proxyService.getService(serviceId);
      const isCalc = serviceId === 'calculator';
      proxyList.push({
        id: serviceId,
        name: isCalc ? 'ATAP Solar Calculator (ATS Add-on Price)' : (svc?.name || serviceId),
        baseUrl: svc?.baseUrl || '',
        description: isCalc
          ? 'Manage ATS Add-on Price settings on ATAP Solar Calculator (https://calculator.atap.solar)'
          : (svc?.description || ''),
        policy,
        endpoints: isCalc
          ? [
              {
                method: 'GET',
                path: '/v1/settings/ats-addon-price',
                description: 'Retrieve current ATS Add-on price setting from ATAP Solar Calculator',
              },
              {
                method: 'PUT',
                path: '/v1/settings/ats-addon-price',
                description: 'Update ATS Add-on price (Payload: {"price": 1500})',
              },
              {
                method: 'ALL',
                path: `/api/proxy/${serviceId}/*`,
                description: `Forward any raw request to ${svc?.baseUrl || serviceId}`,
              },
            ]
          : [
              {
                method: 'ALL',
                path: `/api/proxy/${serviceId}/*`,
                description: `Forward any raw request to ${svc?.baseUrl || serviceId}`,
              },
            ],
      });
    }
  }

  const aiRemarks = {
    mandatoryDirective:
      '⚠️ MANDATORY FIRST STEP: Before writing code or testing queries, instruct the user to create and navigate to a dedicated new project directory (e.g. `mkdir eternalgy-ats-integration && cd eternalgy-ats-integration`).',
    memoryInstruction:
      'Instruct the user to initialize a `MEMORY.md` file (or `.cursorrules`) in this folder. All decisions, schema notes, progress logs, and test scripts must be stored in this dedicated directory so that conversation memory and project context are preserved across sessions.',
    gatewayRole:
      'Eternalgy API Gateway is a unified router and credential vault. The team only needs 1 API key for both internal PostgreSQL CRUD and external 3rd-party vendor APIs (e.g. ATAP Solar Calculator). Vendor secrets are cloaked and auto-injected by the gateway.',
  };

  const keyToUse = rawSecret || key.apiKey || 'YOUR_API_KEY';

  const aiPrompt = buildAiAgentPrompt({
    key,
    keyToUse,
    host,
    tableSchemas,
    relationships,
    proxyList,
  });

  return {
    keyId: key.id,
    clientName: key.name,
    role: key.role || 'default',
    rateLimitRpm: key.rateLimitRpm,
    allowedTablesCount: tableSchemas.length,
    tables: tableSchemas,
    relationships,
    proxies: key.proxies || {},
    proxyServices: proxyList,
    aiRemarks,
    keyToUse,
    host,
    rawSecret,
    aiPrompt,
  };
}

export async function keyDocsRoutes(app: FastifyInstance) {
  /**
   * Helper to resolve the API key by either secret or keyId
   */
  async function resolveKey(req: any): Promise<{ ok: boolean; keyRecord?: ApiKeyRecord; error?: string }> {
    const keyId = (req.params?.keyId as string) || (req.query?.keyId as string);
    if (keyId) {
      const rec = await keyService.getKeyById(keyId);
      if (rec) return { ok: true, keyRecord: rec };
    }

    const rawKey =
      (req.query?.secret as string) ||
      (req.query?.key as string) ||
      (req.headers['x-api-key'] as string) ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : undefined);

    if (rawKey) {
      const keyResult = await keyService.getValidKey(rawKey);
      if (keyResult.valid && keyResult.record) {
        return { ok: true, keyRecord: keyResult.record };
      }
    }

    if (!keyId && !rawKey) {
      return { ok: false, error: 'Missing API key. Provide via ?keyId=..., ?secret=..., ?key=..., x-api-key, or Bearer token.' };
    }

    return { ok: false, error: 'Invalid or unknown API key.' };
  }

  /**
   * GET /docs/keys/:keyId - Dedicated Dual-Mode (AI + Human) Documentation Page
   * Server-Side Rendered (SSR) HTML for humans and search/AI tools, with Content Negotiation for pure Markdown.
   */
  app.get<{ Params: { keyId: string } }>('/docs/keys/:keyId', async (request, reply) => {
    const auth = await resolveKey(request);
    const host = `${request.protocol}://${request.headers.host || 'e-api.up.railway.app'}`;
    const rawSecret =
      (request.query as any)?.secret ||
      (request.query as any)?.key ||
      (request.headers['x-api-key'] as string);

    const accept = (request.headers.accept || '').toLowerCase();
    const format = (request.query as any)?.format;
    const isMarkdown =
      format === 'md' ||
      format === 'markdown' ||
      accept.includes('text/markdown') ||
      (!accept.includes('text/html') && accept.includes('text/plain'));

    if (!auth.ok) {
      if (isMarkdown) {
        return reply.status(401).type('text/markdown; charset=utf-8').send(`# 401 Unauthorized\n\n${auth.error}`);
      }
      return reply.status(401).type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>401 Unauthorized — Eternalgy API Gateway</title>
  <link rel="stylesheet" href="/admin/styles.css">
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:100vh; background:#0a0d14; color:#f1f5f9; font-family:sans-serif; margin:0;">
  <div style="background:#181d2a; border:1px solid #ef4444; border-radius:8px; padding:32px; max-width:480px; text-align:center;">
    <h2 style="color:#ef4444; margin-top:0;">Authentication Required</h2>
    <p style="color:#94a3b8; font-size:14px;">${auth.error}</p>
    <p style="font-size:12px; color:#64748b;">Please provide your key or secret in the URL query parameter (e.g. <code>?secret=YOUR_KEY</code>) or via <code>x-api-key</code> header.</p>
  </div>
</body>
</html>`);
    }

    const profile = await buildKeyDocProfile(auth.keyRecord!, rawSecret, host);

    if (isMarkdown) {
      return reply.type('text/markdown; charset=utf-8').send(profile.aiPrompt);
    }

    return reply.type('text/html; charset=utf-8').send(renderKeyDocHtml(profile));
  });

  /**
   * GET /api/docs/key-schema - Detailed JSON schema of permitted tables and fields for a specific key
   */
  app.get('/api/docs/key-schema', async (request, reply) => {
    const auth = await resolveKey(request);
    if (!auth.ok) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: auth.error });
    }

    const host = `${request.protocol}://${request.headers.host || 'e-api.up.railway.app'}`;
    const rawSecret =
      (request.query as any)?.secret ||
      (request.query as any)?.key ||
      (request.headers['x-api-key'] as string);

    const profile = await buildKeyDocProfile(auth.keyRecord!, rawSecret, host);
    return reply.send(profile);
  });

  /**
   * GET /api/docs/key-openapi.json - Dynamically synthesized OpenAPI 3.0 spec for this specific API key
   */
  app.get('/api/docs/key-openapi.json', async (request, reply) => {
    const auth = await resolveKey(request);
    if (!auth.ok) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: auth.error });
    }

    const key = auth.keyRecord!;
    const paths: Record<string, any> = {};

    for (const [tableName, policy] of Object.entries(key.tables)) {
      const allCols = await schemaService.getColumnsForTable(tableName);

      const readableProps: Record<string, any> = {};
      for (const col of allCols) {
        if (DEFAULT_SENSITIVE_COLUMNS.has(col.name.toLowerCase())) continue;
        if (policy.allowedColumns && !policy.allowedColumns.includes(col.name)) continue;
        if (policy.forbiddenColumns && policy.forbiddenColumns.includes(col.name)) continue;
        readableProps[col.name] = mapPgTypeToJsonSchema(col.dataType);
      }

      const writableProps: Record<string, any> = {};
      for (const col of allCols) {
        if (col.name === 'id') continue;
        if (DEFAULT_SENSITIVE_COLUMNS.has(col.name.toLowerCase())) continue;
        if (policy.writableColumns && !policy.writableColumns.includes(col.name)) continue;
        writableProps[col.name] = mapPgTypeToJsonSchema(col.dataType);
      }

      const rowSchema = {
        type: 'object',
        properties: readableProps,
      };

      const tableBasePath = `/v1/data/${tableName}`;
      const tableItemPath = `/v1/data/${tableName}/{id}`;

      paths[tableBasePath] = {};
      paths[tableItemPath] = {};

      if (policy.actions.includes('read')) {
        paths[tableBasePath].get = {
          tags: [tableName],
          summary: `List ${tableName} records`,
          description: `Returns paginated records from ${tableName}. Columns are restricted to permitted fields.`,
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Page limit (max 100)' },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Pagination offset' },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Sort column name' },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['ASC', 'DESC'] }, description: 'Sort order' },
          ],
          responses: {
            200: {
              description: 'Success',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: rowSchema },
                      count: { type: 'integer' },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        };

        paths[tableItemPath].get = {
          tags: [tableName],
          summary: `Get ${tableName} by ID`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Success',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { data: rowSchema },
                  },
                },
              },
            },
            404: { description: 'Record not found' },
          },
        };
      }

      if (policy.actions.includes('create')) {
        paths[tableBasePath].post = {
          tags: [tableName],
          summary: `Create new ${tableName} record`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: writableProps,
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { data: rowSchema },
                  },
                },
              },
            },
          },
        };
      }

      if (policy.actions.includes('update')) {
        paths[tableItemPath].patch = {
          tags: [tableName],
          summary: `Update ${tableName} record by ID`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: writableProps,
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { data: rowSchema },
                  },
                },
              },
            },
          },
        };
      }

      if (policy.actions.includes('delete')) {
        paths[tableItemPath].delete = {
          tags: [tableName],
          summary: `Delete ${tableName} record by ID`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { deleted: { type: 'boolean' }, id: { type: 'string' } },
                  },
                },
              },
            },
          },
        };
      }
    }

    if (key.proxies) {
      for (const [serviceId, policy] of Object.entries(key.proxies)) {
        const proxyPath = `/api/proxy/${serviceId}/{subpath}`;
        const methods = (policy.methods && policy.methods.length > 0)
          ? policy.methods.map((m) => m.toLowerCase())
          : ['get', 'post', 'put', 'patch', 'delete'];

        paths[proxyPath] = {};
        for (const m of methods) {
          paths[proxyPath][m] = {
            tags: ['Proxy: ' + serviceId],
            summary: `Proxy ${m.toUpperCase()} request to upstream service '${serviceId}'`,
            parameters: [
              {
                name: 'subpath',
                in: 'path',
                required: true,
                schema: { type: 'string' },
                description: `Wildcard path forwarded directly to ${serviceId}`,
              },
            ],
            responses: {
              200: { description: 'Upstream response forwarded by Eternalgy Gateway' },
            },
          };
        }
      }
    }

    const openapiSpec = {
      openapi: '3.0.3',
      info: {
        title: `API Documentation for ${key.name}`,
        description: `Custom API documentation generated for API Key: **${key.id}** (${key.role}). Only tables and columns permitted for this key are displayed.`,
        version: '1.0.0',
      },
      servers: [{ url: '/', description: 'API Gateway Base URL' }],
      paths,
      components: {
        securitySchemes: {
          apiKeyAuth: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
          },
        },
      },
      security: [{ apiKeyAuth: [] }],
    };

    return reply.send(openapiSpec);
  });

  /**
   * GET /docs/keys/:keyId/llms.txt - Standardized LLM system prompt & schema guide for AI coding agents
   */
  app.get<{ Params: { keyId: string } }>('/docs/keys/:keyId/llms.txt', async (request, reply) => {
    const auth = await resolveKey(request);
    if (!auth.ok) {
      return reply.status(401).type('text/plain; charset=utf-8').send(`Error 401 Unauthorized: ${auth.error}`);
    }

    const host = `${request.protocol}://${request.headers.host || 'e-api.up.railway.app'}`;
    const rawSecret =
      (request.query as any)?.secret ||
      (request.query as any)?.key ||
      (request.headers['x-api-key'] as string);

    const profile = await buildKeyDocProfile(auth.keyRecord!, rawSecret, host);
    return reply.type('text/markdown; charset=utf-8').send(profile.aiPrompt);
  });
}
