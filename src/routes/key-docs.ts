import { FastifyInstance } from 'fastify';
import { keyService } from '../security/key-service.js';
import { schemaService, ColumnMetadata } from '../db/schema-service.js';
import { DEFAULT_SENSITIVE_COLUMNS } from '../security/policies.js';
import { TablePolicy } from '../security/types.js';

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

export async function keyDocsRoutes(app: FastifyInstance) {
  /**
   * Helper to resolve the API key from query, header, or Bearer token
   */
  async function resolveKey(req: any) {
    const rawKey =
      (req.query?.key as string) ||
      (req.headers['x-api-key'] as string) ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : undefined);

    if (!rawKey) {
      return { ok: false, error: 'Missing API key. Provide via ?key=..., x-api-key, or Bearer token.' };
    }

    const keyResult = await keyService.getValidKey(rawKey);
    if (!keyResult.valid || !keyResult.record) {
      return { ok: false, error: keyResult.reason || 'Invalid API key.' };
    }

    return { ok: true, keyRecord: keyResult.record };
  }

  /**
   * GET /api/docs/key-schema - Detailed JSON schema of permitted tables and fields for a specific key
   */
  app.get('/api/docs/key-schema', async (request, reply) => {
    const auth = await resolveKey(request);
    if (!auth.ok) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: auth.error });
    }

    const key = auth.keyRecord!;
    const tableSchemas = [];

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
      const endpoints: any[] = [];
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

    return {
      keyId: key.id,
      clientName: key.name,
      role: key.role,
      rateLimitRpm: key.rateLimitRpm,
      allowedTablesCount: tableSchemas.length,
      tables: tableSchemas,
    };
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
}
