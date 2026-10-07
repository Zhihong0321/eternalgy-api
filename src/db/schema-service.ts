import { executeQuery } from './pool.js';

export interface ColumnMetadata {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey?: boolean;
}

export interface TableRelationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'foreign_key' | 'logical_relation';
  description?: string;
}

export interface TableMetadata {
  tableName: string;
  columns: ColumnMetadata[];
  primaryKeys: string[];
}

class SchemaService {
  private cache: Map<string, ColumnMetadata[]> = new Map();
  private primaryKeysCache: Map<string, Set<string>> = new Map();
  private relationshipsCache: TableRelationship[] = [];
  private lastFetched: number = 0;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  async refreshSchema(): Promise<void> {
    try {
      // 1. Fetch Columns
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

      // 2. Fetch Primary Keys
      const pkQuery = `
        SELECT 
          tc.table_name, 
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public';
      `;
      let pks: Record<string, Set<string>> = {};
      try {
        const pkRes = await executeQuery(pkQuery);
        for (const row of pkRes.rows) {
          if (!pks[row.table_name]) pks[row.table_name] = new Set();
          pks[row.table_name].add(row.column_name);
        }
      } catch (err: any) {
        console.warn('[SchemaService] PK fetch warning:', err.message);
      }

      // 3. Fetch Foreign Keys from Postgres Constraints
      const rels: TableRelationship[] = [];
      const fkQuery = `
        SELECT
          tc.table_name AS source_table,
          kcu.column_name AS source_column,
          ccu.table_name AS target_table,
          ccu.column_name AS target_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
      `;
      try {
        const fkRes = await executeQuery(fkQuery);
        for (const row of fkRes.rows) {
          rels.push({
            sourceTable: row.source_table,
            sourceColumn: row.source_column,
            targetTable: row.target_table,
            targetColumn: row.target_column,
            type: 'foreign_key',
            description: `Foreign key constraint: ${row.source_table}.${row.source_column} -> ${row.target_table}.${row.target_column}`,
          });
        }
      } catch (err: any) {
        console.warn('[SchemaService] FK fetch warning:', err.message);
      }

      const newCache = new Map<string, ColumnMetadata[]>();
      for (const row of res.rows) {
        const tbl = row.table_name;
        if (!newCache.has(tbl)) {
          newCache.set(tbl, []);
        }
        const isPk = pks[tbl]?.has(row.column_name) || row.column_name === 'id';
        newCache.get(tbl)!.push({
          name: row.column_name,
          dataType: row.data_type,
          isNullable: row.is_nullable === 'YES',
          defaultValue: row.column_default,
          isPrimaryKey: isPk,
        });
      }

      // 4. Register Domain Logical Relationships
      const knownLogicalRelations: TableRelationship[] = [
        {
          sourceTable: 'package',
          sourceColumn: 'linked_package_item',
          targetTable: 'package_item',
          targetColumn: 'bubble_id',
          type: 'logical_relation',
          description: 'Array of item bubble IDs (panels, inverters, services) bundled into this package',
        },
        {
          sourceTable: 'package',
          sourceColumn: 'panel',
          targetTable: 'product',
          targetColumn: 'bubble_id',
          type: 'logical_relation',
          description: 'Specific solar panel product model included in the solar package',
        },
        {
          sourceTable: 'package',
          sourceColumn: 'inverter_1',
          targetTable: 'product',
          targetColumn: 'bubble_id',
          type: 'logical_relation',
          description: 'Primary inverter product model configured for this solar package',
        },
        {
          sourceTable: 'product',
          sourceColumn: 'linked_brand',
          targetTable: 'brand',
          targetColumn: 'bubble_id',
          type: 'logical_relation',
          description: 'Manufacturer brand identity associated with this solar product',
        },
        {
          sourceTable: 'product',
          sourceColumn: 'linked_category',
          targetTable: 'category',
          targetColumn: 'bubble_id',
          type: 'logical_relation',
          description: 'Product categorization (e.g. Solar Panel, Inverter, Battery, Accessory)',
        },
      ];

      for (const known of knownLogicalRelations) {
        if (!rels.some((r) => r.sourceTable === known.sourceTable && r.sourceColumn === known.sourceColumn)) {
          rels.push(known);
        }
      }

      this.cache = newCache;
      this.primaryKeysCache = new Map(Object.entries(pks));
      this.relationshipsCache = rels;
      this.lastFetched = Date.now();
    } catch (err: any) {
      console.warn('[SchemaService] Schema refresh error:', err.message);
      this.seedInMemoryFallback();
    }
  }

  private seedInMemoryFallback(): void {
    if (this.cache.size > 0) return;

    const packageCols: ColumnMetadata[] = [
      { name: 'id', dataType: 'integer', isNullable: false, defaultValue: null, isPrimaryKey: true },
      { name: 'bubble_id', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'package_name', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'panel', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'inverter_1', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'price', dataType: 'numeric', isNullable: true, defaultValue: null },
      { name: 'nett_price', dataType: 'numeric', isNullable: true, defaultValue: null },
      { name: 'panel_qty', dataType: 'integer', isNullable: true, defaultValue: null },
      { name: 'linked_package_item', dataType: 'ARRAY', isNullable: true, defaultValue: null },
      { name: 'active', dataType: 'boolean', isNullable: true, defaultValue: null },
      { name: 'created_at', dataType: 'timestamp with time zone', isNullable: true, defaultValue: null },
      { name: 'updated_at', dataType: 'timestamp with time zone', isNullable: true, defaultValue: null },
    ];

    const productCols: ColumnMetadata[] = [
      { name: 'id', dataType: 'integer', isNullable: false, defaultValue: null, isPrimaryKey: true },
      { name: 'bubble_id', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'name', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'cost_price', dataType: 'numeric', isNullable: true, defaultValue: null },
      { name: 'selling_price', dataType: 'numeric', isNullable: true, defaultValue: null },
      { name: 'inventory', dataType: 'boolean', isNullable: true, defaultValue: null },
      { name: 'linked_brand', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'linked_category', dataType: 'text', isNullable: true, defaultValue: null },
      { name: 'active', dataType: 'boolean', isNullable: true, defaultValue: null },
      { name: 'created_at', dataType: 'timestamp with time zone', isNullable: true, defaultValue: null },
      { name: 'updated_at', dataType: 'timestamp with time zone', isNullable: true, defaultValue: null },
    ];

    this.cache.set('package', packageCols);
    this.cache.set('product', productCols);

    this.relationshipsCache = [
      {
        sourceTable: 'package',
        sourceColumn: 'panel',
        targetTable: 'product',
        targetColumn: 'bubble_id',
        type: 'logical_relation',
        description: 'Specific solar panel product model included in the solar package',
      },
      {
        sourceTable: 'package',
        sourceColumn: 'inverter_1',
        targetTable: 'product',
        targetColumn: 'bubble_id',
        type: 'logical_relation',
        description: 'Primary inverter product model configured for this solar package',
      },
      {
        sourceTable: 'product',
        sourceColumn: 'linked_brand',
        targetTable: 'brand',
        targetColumn: 'bubble_id',
        type: 'logical_relation',
        description: 'Manufacturer brand identity associated with this solar product',
      },
      {
        sourceTable: 'product',
        sourceColumn: 'linked_category',
        targetTable: 'category',
        targetColumn: 'bubble_id',
        type: 'logical_relation',
        description: 'Product categorization (e.g. Solar Panel, Inverter, Battery, Accessory)',
      },
    ];
    this.lastFetched = Date.now();
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

  async getRelationshipsForTables(tables: string[]): Promise<TableRelationship[]> {
    if (this.cache.size === 0 || Date.now() - this.lastFetched > this.TTL_MS) {
      await this.refreshSchema();
    }
    const tableSet = new Set(tables);
    return this.relationshipsCache.filter(
      (r) => tableSet.has(r.sourceTable) || tableSet.has(r.targetTable)
    );
  }
}

export const schemaService = new SchemaService();

