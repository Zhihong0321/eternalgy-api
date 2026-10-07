import { config } from '../config/env.js';

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function sanitizeIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER_REGEX.test(identifier)) {
    throw new Error(`Invalid identifier name: '${identifier}'`);
  }
  return `"${identifier}"`;
}

export interface SelectQueryOptions {
  table: string;
  allowedColumns?: string[];
  filter?: Record<string, any>;
  rowScopeConstraint?: { column: string; value: any };
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'ASC' | 'DESC';
}

export interface BuiltQuery {
  text: string;
  params: any[];
}

export class QueryBuilder {
  /**
   * Build a secure parameterized SELECT query
   */
  static buildSelect(options: SelectQueryOptions): BuiltQuery {
    const safeTable = sanitizeIdentifier(options.table);
    const params: any[] = [];
    const whereClauses: string[] = [];

    // 1. Column selection
    let columnsPart = '*';
    if (options.allowedColumns && options.allowedColumns.length > 0) {
      columnsPart = options.allowedColumns.map(sanitizeIdentifier).join(', ');
    }

    // 2. Row scope filter (tenant / user level isolation)
    if (options.rowScopeConstraint) {
      params.push(options.rowScopeConstraint.value);
      whereClauses.push(
        `${sanitizeIdentifier(options.rowScopeConstraint.column)} = $${params.length}`
      );
    }

    // 3. User filter parameters (query string equality filters)
    if (options.filter) {
      for (const [key, val] of Object.entries(options.filter)) {
        if (!SAFE_IDENTIFIER_REGEX.test(key)) continue;
        if (val === undefined || val === null) continue;
        params.push(val);
        whereClauses.push(`${sanitizeIdentifier(key)} = $${params.length}`);
      }
    }

    let text = `SELECT ${columnsPart} FROM ${safeTable}`;
    if (whereClauses.length > 0) {
      text += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    // 4. Order By
    if (options.sort && SAFE_IDENTIFIER_REGEX.test(options.sort)) {
      const order = options.order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      text += ` ORDER BY ${sanitizeIdentifier(options.sort)} ${order}`;
    }

    // 5. Hard Limit & Offset
    const safeLimit = Math.min(
      Math.max(Number(options.limit) || 20, 1),
      config.MAX_QUERY_LIMIT
    );
    const safeOffset = Math.max(Number(options.offset) || 0, 0);

    params.push(safeLimit);
    text += ` LIMIT $${params.length}`;

    if (safeOffset > 0) {
      params.push(safeOffset);
      text += ` OFFSET $${params.length}`;
    }

    return { text, params };
  }

  /**
   * Build a secure parameterized INSERT query
   */
  static buildInsert(
    table: string,
    data: Record<string, any>,
    rowScopeConstraint?: { column: string; value: any }
  ): BuiltQuery {
    const safeTable = sanitizeIdentifier(table);
    const params: any[] = [];
    const columns: string[] = [];
    const placeholders: string[] = [];

    // Inject rowScope column automatically if present
    const payload = { ...data };
    if (rowScopeConstraint) {
      payload[rowScopeConstraint.column] = rowScopeConstraint.value;
    }

    for (const [col, val] of Object.entries(payload)) {
      if (!SAFE_IDENTIFIER_REGEX.test(col)) continue;
      columns.push(sanitizeIdentifier(col));
      params.push(val);
      placeholders.push(`$${params.length}`);
    }

    if (columns.length === 0) {
      throw new Error('Cannot insert empty record');
    }

    const text = `INSERT INTO ${safeTable} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    return { text, params };
  }

  /**
   * Build a secure parameterized UPDATE query
   */
  static buildUpdate(
    table: string,
    id: any,
    data: Record<string, any>,
    rowScopeConstraint?: { column: string; value: any }
  ): BuiltQuery {
    const safeTable = sanitizeIdentifier(table);
    const params: any[] = [];
    const setClauses: string[] = [];
    const whereClauses: string[] = [];

    for (const [col, val] of Object.entries(data)) {
      if (!SAFE_IDENTIFIER_REGEX.test(col)) continue;
      params.push(val);
      setClauses.push(`${sanitizeIdentifier(col)} = $${params.length}`);
    }

    if (setClauses.length === 0) {
      throw new Error('No fields provided to update');
    }

    // WHERE id = $N
    params.push(id);
    whereClauses.push(`"id" = $${params.length}`);

    // Row scope constraint
    if (rowScopeConstraint) {
      params.push(rowScopeConstraint.value);
      whereClauses.push(
        `${sanitizeIdentifier(rowScopeConstraint.column)} = $${params.length}`
      );
    }

    const text = `UPDATE ${safeTable} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')} RETURNING *`;
    return { text, params };
  }

  /**
   * Build a secure parameterized DELETE query
   */
  static buildDelete(
    table: string,
    id: any,
    rowScopeConstraint?: { column: string; value: any }
  ): BuiltQuery {
    const safeTable = sanitizeIdentifier(table);
    const params: any[] = [];
    const whereClauses: string[] = [];

    params.push(id);
    whereClauses.push(`"id" = $${params.length}`);

    if (rowScopeConstraint) {
      params.push(rowScopeConstraint.value);
      whereClauses.push(
        `${sanitizeIdentifier(rowScopeConstraint.column)} = $${params.length}`
      );
    }

    const text = `DELETE FROM ${safeTable} WHERE ${whereClauses.join(' AND ')} RETURNING "id"`;
    return { text, params };
  }
}
