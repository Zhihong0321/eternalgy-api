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

export async function dataRoutes(app: FastifyInstance) {
  // Enforce API key authentication for all /v1/data routes
  app.addHook('preHandler', authenticateApiKey);

  /**
   * GET /v1/data/:table - List records with filtering, pagination, and column masking
   */
  app.get<{ Params: TableParams; Querystring: QueryFilterString }>(
    '/v1/data/:table',
    async (request, reply) => {
      const { table } = request.params;
      const { limit, offset, sort, order, ...rawFilters } = request.query;

      // Master admin bypass
      if (request.isAdmin) {
        if (GLOBALLY_BLOCKED_TABLES.has(table.toLowerCase())) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: `Table '${table}' is a protected system table.`,
          });
        }

        const query = QueryBuilder.buildSelect({
          table,
          filter: rawFilters,
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
        request.clientPolicy!,
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

      const query = QueryBuilder.buildSelect({
        table,
        allowedColumns: auth.tablePolicy?.allowedColumns,
        filter: rawFilters,
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
    }
  );

  /**
   * GET /v1/data/:table/:id - Retrieve single record
   */
  app.get<{ Params: TableParams }>(
    '/v1/data/:table/:id',
    async (request, reply) => {
      const { table, id } = request.params;

      if (!id) {
        return reply.status(400).send({ statusCode: 400, message: 'Missing record id' });
      }

      if (request.isAdmin) {
        const query = QueryBuilder.buildSelect({
          table,
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
        request.clientPolicy!,
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

      const query = QueryBuilder.buildSelect({
        table,
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
    }
  );

  /**
   * POST /v1/data/:table - Insert new record with strict schema validation
   */
  app.post<{ Params: TableParams; Body: Record<string, any> }>(
    '/v1/data/:table',
    async (request, reply) => {
      const { table } = request.params;
      const payload = request.body;

      if (request.isAdmin) {
        const query = QueryBuilder.buildInsert(table, payload);
        const result = await executeQuery(query.text, query.params);
        return reply.status(201).send({ data: result.rows[0] });
      }

      const auth = PolicyEngine.authorize(
        request.clientPolicy!,
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

      const query = QueryBuilder.buildInsert(
        table,
        validation.sanitized!,
        auth.rowScopeConstraint
      );

      const result = await executeQuery(query.text, query.params);
      const masked = PolicyEngine.maskRow(auth.tablePolicy!, result.rows[0]);

      return reply.status(201).send({ data: masked });
    }
  );

  /**
   * PATCH /v1/data/:table/:id - Update existing record with strict field filtering
   */
  app.patch<{ Params: TableParams; Body: Record<string, any> }>(
    '/v1/data/:table/:id',
    async (request, reply) => {
      const { table, id } = request.params;
      const payload = request.body;

      if (!id) {
        return reply.status(400).send({ statusCode: 400, message: 'Missing record id' });
      }

      if (request.isAdmin) {
        const query = QueryBuilder.buildUpdate(table, id, payload);
        const result = await executeQuery(query.text, query.params);
        if (result.rows.length === 0) {
          return reply.status(404).send({ statusCode: 404, message: 'Record not found' });
        }
        return reply.send({ data: result.rows[0] });
      }

      const auth = PolicyEngine.authorize(
        request.clientPolicy!,
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

      const query = QueryBuilder.buildUpdate(
        table,
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
    }
  );

  /**
   * DELETE /v1/data/:table/:id - Delete record (if role permitted)
   */
  app.delete<{ Params: TableParams }>(
    '/v1/data/:table/:id',
    async (request, reply) => {
      const { table, id } = request.params;

      if (!id) {
        return reply.status(400).send({ statusCode: 400, message: 'Missing record id' });
      }

      if (request.isAdmin) {
        const query = QueryBuilder.buildDelete(table, id);
        const result = await executeQuery(query.text, query.params);
        if (result.rows.length === 0) {
          return reply.status(404).send({ statusCode: 404, message: 'Record not found' });
        }
        return reply.send({ deleted: true, id });
      }

      const auth = PolicyEngine.authorize(
        request.clientPolicy!,
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

      const query = QueryBuilder.buildDelete(table, id, auth.rowScopeConstraint);
      const result = await executeQuery(query.text, query.params);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          message: `Record with id '${id}' not found or access denied.`,
        });
      }

      return reply.send({ deleted: true, id });
    }
  );
}
