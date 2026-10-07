import { describe, it, expect } from 'vitest';
import { QueryBuilder, sanitizeIdentifier } from '../src/db/query-builder.js';

describe('QueryBuilder Security and SQL Synthesis', () => {
  it('sanitizes identifiers and blocks SQL injection strings', () => {
    expect(sanitizeIdentifier('product')).toBe('"product"');
    expect(sanitizeIdentifier('created_at')).toBe('"created_at"');

    expect(() => sanitizeIdentifier('product; DROP TABLE user;--')).toThrow();
    expect(() => sanitizeIdentifier('users" OR 1=1 --')).toThrow();
    expect(() => sanitizeIdentifier('invalid-column')).toThrow();
  });

  it('builds a secure parameterized SELECT query with clamped limit', () => {
    const query = QueryBuilder.buildSelect({
      table: 'product',
      allowedColumns: ['id', 'name', 'price'],
      filter: { category: 'inverter', is_active: true },
      limit: 500, // Should be clamped to MAX_QUERY_LIMIT (100)
      offset: 10,
      sort: 'price',
      order: 'DESC',
    });

    expect(query.text).toBe(
      'SELECT "id", "name", "price" FROM "product" WHERE "category" = $1 AND "is_active" = $2 ORDER BY "price" DESC LIMIT $3 OFFSET $4'
    );
    expect(query.params).toEqual(['inverter', true, 100, 10]);
  });

  it('injects row-level security constraints into WHERE clause', () => {
    const query = QueryBuilder.buildSelect({
      table: 'invoice',
      rowScopeConstraint: { column: 'customer_id', value: 'cust_abc_123' },
      filter: { status: 'PAID' },
      limit: 20,
    });

    expect(query.text).toBe(
      'SELECT * FROM "invoice" WHERE "customer_id" = $1 AND "status" = $2 LIMIT $3'
    );
    expect(query.params).toEqual(['cust_abc_123', 'PAID', 20]);
  });

  it('builds a secure parameterized INSERT query', () => {
    const query = QueryBuilder.buildInsert(
      'support_ticket',
      { title: 'Help needed', description: 'Cannot view inverter data' },
      { column: 'customer_id', value: 'cust_999' }
    );

    expect(query.text).toContain('INSERT INTO "support_ticket"');
    expect(query.text).toContain('VALUES ($1, $2, $3) RETURNING *');
    expect(query.params).toEqual(['Help needed', 'Cannot view inverter data', 'cust_999']);
  });

  it('builds a secure parameterized UPDATE query', () => {
    const query = QueryBuilder.buildUpdate(
      'support_ticket',
      42,
      { title: 'Updated Title' },
      { column: 'customer_id', value: 'cust_999' }
    );

    expect(query.text).toBe(
      'UPDATE "support_ticket" SET "title" = $1 WHERE "id" = $2 AND "customer_id" = $3 RETURNING *'
    );
    expect(query.params).toEqual(['Updated Title', 42, 'cust_999']);
  });

  it('builds a secure parameterized DELETE query', () => {
    const query = QueryBuilder.buildDelete(
      'support_ticket',
      42,
      { column: 'customer_id', value: 'cust_999' }
    );

    expect(query.text).toBe(
      'DELETE FROM "support_ticket" WHERE "id" = $1 AND "customer_id" = $2 RETURNING "id"'
    );
    expect(query.params).toEqual([42, 'cust_999']);
  });
});
