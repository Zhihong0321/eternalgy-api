import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  max: config.DB_MAX_CONNECTIONS,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[Database Pool Error]:', err.message);
});

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

/**
 * Execute a query with an automatic statement timeout
 */
export async function executeQuery<T = any>(
  text: string,
  params: any[] = [],
  timeoutMs: number = config.QUERY_TIMEOUT_MS
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    // Set query timeout for this session
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
    const result = await client.query(text, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  } finally {
    client.release();
  }
}

/**
 * Check database connectivity & latency
 */
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1 AS health');
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.message || 'Database unreachable',
    };
  }
}

/**
 * Diagnostic pool statistics
 */
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxConnections: config.DB_MAX_CONNECTIONS,
  };
}

/**
 * Execute query EXPLAIN (FORMAT JSON) for query performance debugging
 */
export async function explainQuery(sql: string, params: any[] = []): Promise<any> {
  const cleanSql = sql.trim();
  if (!cleanSql.toUpperCase().startsWith('SELECT')) {
    throw new Error('EXPLAIN is only permitted for SELECT statements.');
  }

  const client = await pool.connect();
  try {
    const res = await client.query(`EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ${cleanSql}`, params);
    return res.rows[0]?.['QUERY PLAN'] || res.rows;
  } finally {
    client.release();
  }
}

/**
 * Graceful shutdown for pool
 */
export async function closePool(): Promise<void> {
  await pool.end();
}

