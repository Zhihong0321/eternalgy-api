import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateApiKey } from '../security/auth-middleware.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { QueryBuilder } from '../db/query-builder.js';
import { executeQuery } from '../db/pool.js';
import { GLOBALLY_BLOCKED_TABLES } from '../security/policies.js';

interface TableParams {
  table: string;
  id?: string;
}

interface QueryFilterString {
  limit?: string;
  offset?: string;
  sort?: string;
  order?: 'ASC' | 'DESC' | 'asc' | 'desc';
  [key: string]: string | undefined;
}

function extractFilters(rawQuery: Record<string, any>) {
  const {
    limit,
    offset,
    sort,
    order,
    key,
    apiKey,
    api_key,
    'x-api-key': _xApiKey,
    secret,
    adminSecret,
    'x-admin-secret': _xAdminSecret,
    password,
    pass,
    ...filters
  } = rawQuery;

  return {
    limit,
    offset,
    sort,
    order,
    filters,
  };
}

function normalizeTableName(table: string): string {
  let target = (table || '').trim().replace(/[\s-]+/g, '_').toLowerCase();
  if (target === 'submited_payment') {
    target = 'submitted_payment';
  }
  return target;
}

export async function dataRoutes(app: FastifyInstance) {
  // Enforce API key authentication for all /v1/data and /api/data routes
  app.addHook('preHandler', authenticateApiKey);

  const listHandler = async (
    request: FastifyRequest<{ Params: TableParams; Querystring: QueryFilterString }>,
    reply: FastifyReply
  ) => {
    const { table } = request.params;
    const { limit, offset, sort, order, filters } = extractFilters((request.query || {}) as any);

    const targetTable = normalizeTableName(table);

    // Master admin bypass
    if (request.isAdmin) {
      if (GLOBALLY_BLOCKED_TABLES.has(targetTable) && targetTable !== 'user' && targetTable !== 'users') {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Table '${table}' is a protected system table.`,
        });
      }

      const query = QueryBuilder.buildSelect({
        table: targetTable,
        filter: filters,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        sort,
        order: order?.toUpperCase() as any,
      });

      const result = await executeQuery(query.text, query.params);
      return reply.send({
        data: result.rows,
        count: result.rows.length,
        limit: Number(limit) || 20,
        offset: Number(offset) || 0,
      });
    }

    // Governed client check
    const auth = PolicyEngine.authorize(
      request.apiKeyRecord!,
      table,
      'read',
      request.authContext!
    );

    if (!auth.allowed) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: auth.reason,
      });
    }

    const queryTable = auth.resolvedTableName || targetTable;

    const query = QueryBuilder.buildSelect({
      table: queryTable,
      allowedColumns: auth.tablePolicy?.allowedColumns,
      filter: filters,
      rowScopeConstraint: auth.rowScopeConstraint,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      sort,
      order: order?.toUpperCase() as any,
    });

    const result = await executeQuery(query.text, query.params);
    const maskedRows = result.rows.map((row) =>
      PolicyEngine.maskRow(auth.tablePolicy!, row)
    );

    return reply.send({
      data: maskedRows,
      count: maskedRows.length,
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
    });
  };

  const getByIdHandler = async (
    request: FastifyRequest<{ Params: TableParams }>,
    reply: FastifyReply
  ) => {
    const { table, id } = request.params;
    const targetTable = normalizeTableName(table);

    if (!id) {
      return reply.status(400).send({ statusCode: 400, message: 'Missing record id' });
    }

    if (request.isAdmin) {
      const query = QueryBuilder.buildSelect({
        table: targetTable,
        filter: { id },
        limit: 1,
      });
      const result = await executeQuery(query.text, query.params);
      if (result.rows.length === 0) {
        return reply.status(404).send({ statusCode: 404, message: 'Record not found' });
      }
      return reply.send({ data: result.rows[0] });
    }

    const auth = PolicyEngine.authorize(
      request.apiKeyRecord!,
      table,
      'read',
      request.authContext!
    );

    if (!auth.allowed) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: auth.reason,
      });
    }

    const queryTable = auth.resolvedTableName || targetTable;
    const query = QueryBuilder.buildSelect({
      table: queryTable,
      allowedColumns: auth.tablePolicy?.allowedColumns,
      filter: { id },
      rowScopeConstraint: auth.rowScopeConstraint,
      limit: 1,
    });

    const result = await executeQuery(query.text, query.params);
    if (result.rows.length === 0) {
      return reply.status(404).send({
        statusCode: 404,
        message: `Record with id '${id}' not found in table '${table}'.`,
      });
    }

    const masked = PolicyEngine.maskRow(auth.tablePolicy!, result.rows[0]);
    return reply.send({ data: masked });
  };

  const createHandler = async (
    request: FastifyRequest<{ Params: TableParams; Body: Record<string, any> }>,
    reply: FastifyReply
  ) => {
    const { table } = request.params;
    const payload = request.body;
    const targetTable = normalizeTableName(table);

    if (request.isAdmin) {
      const query = QueryBuilder.buildInsert(targetTable, payload);
      const result = await executeQuery(query.text, query.params);
      return reply.status(201).send({ data: result.rows[0] });
    }

    const auth = PolicyEngine.authorize(
      request.apiKeyRecord!,
      table,
      'create',
      request.authContext!
    );

    if (!auth.allowed) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: auth.reason,
      });
    }

    const validation = PolicyEngine.validatePayload(auth.tablePolicy!, payload);
    if (!validation.valid) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: validation.error,
      });
    }

    const queryTable = auth.resolvedTableName || targetTable;
    const query = QueryBuilder.buildInsert(
      queryTable,
      validation.sanitized!,
      auth.rowScopeConstraint
    );

    const result = await executeQuery(query.text, query.params);
    const masked = PolicyEngine.maskRow(auth.tablePolicy!, result.rows[0]);

    return reply.status(201).send({ data: masked });
  };

  const updateHandler = async (
    request: FastifyRequest<{ Params: TableParams; Body: Record<string, any> }>,
    reply: FastifyReply
  ) => {
    const { table, id } = request.params;
    const payload = request.body;
    const targetTable = normalizeTableName(table);

    if (!id) {
      return reply.status(400).send({ statusCode: 400, message: 'Missing record id' });
    }

    if (request.isAdmin) {
      const query = QueryBuilder.buildUpdate(targetTable, id, payload);
      const result = await executeQuery(query.text, query.params);
      if (result.rows.length === 0) {
        return reply.status(404).send({ statusCode: 404, message: 'Record not found' });
      }
      return reply.send({ data: result.rows[0] });
    }

    const auth = PolicyEngine.authorize(
      request.apiKeyRecord!,
      table,
      'update',
      request.authContext!
    );

    if (!auth.allowed) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: auth.reason,
      });
    }

    const validation = PolicyEngine.validatePayload(auth.tablePolicy!, payload);
    if (!validation.valid) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: validation.error,
      });
    }

    const queryTable = auth.resolvedTableName || targetTable;
    const query = QueryBuilder.buildUpdate(
      queryTable,
      id,
      validation.sanitized!,
      auth.rowScopeConstraint
    );

    const result = await executeQuery(query.text, query.params);
    if (result.rows.length === 0) {
      return reply.status(404).send({
        statusCode: 404,
        message: `Record with id '${id}' not found or access denied.`,
      });
    }

    const masked = PolicyEngine.maskRow(auth.tablePolicy!, result.rows[0]);
    return reply.send({ data: masked });
  };

  const deleteHandler = async (
    request: FastifyRequest<{ Params: TableParams }>,
    reply: FastifyReply
  ) => {
    const { table, id } = request.params;
    const targetTable = normalizeTableName(table);

    if (!id) {
      return reply.status(400).send({ statusCode: 400, message: 'Missing record id' });
    }

    if (request.isAdmin) {
      const query = QueryBuilder.buildDelete(targetTable, id);
      const result = await executeQuery(query.text, query.params);
      if (result.rows.length === 0) {
        return reply.status(404).send({ statusCode: 404, message: 'Record not found' });
      }
      return reply.send({ deleted: true, id });
    }

    const auth = PolicyEngine.authorize(
      request.apiKeyRecord!,
      table,
      'delete',
      request.authContext!
    );

    if (!auth.allowed) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: auth.reason,
      });
    }

    const queryTable = auth.resolvedTableName || targetTable;
    const query = QueryBuilder.buildDelete(queryTable, id, auth.rowScopeConstraint);
    const result = await executeQuery(query.text, query.params);

    if (result.rows.length === 0) {
      return reply.status(404).send({
        statusCode: 404,
        message: `Record with id '${id}' not found or access denied.`,
      });
    }

    return reply.send({ deleted: true, id });
  };

  for (const prefix of ['/v1/data', '/api/data']) {
    app.get<{ Params: TableParams; Querystring: QueryFilterString }>(`${prefix}/:table`, listHandler);
    app.get<{ Params: TableParams }>(`${prefix}/:table/:id`, getByIdHandler);
    app.post<{ Params: TableParams; Body: Record<string, any> }>(`${prefix}/:table`, createHandler);
    app.patch<{ Params: TableParams; Body: Record<string, any> }>(`${prefix}/:table/:id`, updateHandler);
    app.delete<{ Params: TableParams }>(`${prefix}/:table/:id`, deleteHandler);
  }
}
