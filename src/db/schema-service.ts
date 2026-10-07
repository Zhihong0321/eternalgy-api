import { executeQuery } from './pool.js';

export interface ColumnMetadata {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
}

export interface TableMetadata {
  tableName: string;
  columns: ColumnMetadata[];
}

class SchemaService {
  private cache: Map<string, ColumnMetadata[]> = new Map();
  private lastFetched: number = 0;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  async refreshSchema(): Promise<void> {
    try {
      const query = `
        SELECT 
          table_name, 
          column_name, 
          data_type, 
          is_nullable, 
          column_default
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        ORDER BY table_name, ordinal_position;
      `;
      const res = await executeQuery(query);
      const newCache = new Map<string, ColumnMetadata[]>();

      for (const row of res.rows) {
        const tbl = row.table_name;
        if (!newCache.has(tbl)) {
          newCache.set(tbl, []);
        }
        newCache.get(tbl)!.push({
          name: row.column_name,
          dataType: row.data_type,
          isNullable: row.is_nullable === 'YES',
          defaultValue: row.column_default,
        });
      }

      this.cache = newCache;
      this.lastFetched = Date.now();
    } catch (err: any) {
      console.warn('[SchemaService] Schema refresh error:', err.message);
    }
  }

  async getColumnsForTable(tableName: string): Promise<ColumnMetadata[]> {
    if (this.cache.size === 0 || Date.now() - this.lastFetched > this.TTL_MS) {
      await this.refreshSchema();
    }
    return this.cache.get(tableName) || [];
  }

  async getAllTables(): Promise<string[]> {
    if (this.cache.size === 0 || Date.now() - this.lastFetched > this.TTL_MS) {
      await this.refreshSchema();
    }
    return Array.from(this.cache.keys());
  }
}

export const schemaService = new SchemaService();
