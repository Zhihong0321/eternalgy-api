import { executeQuery } from '../db/pool.js';
import { UpstreamServiceRecord } from './types.js';

class ProxyService {
  private cache: Map<string, UpstreamServiceRecord> = new Map();
  private dbInitialized = false;

  private defaultServices: UpstreamServiceRecord[] = [
    {
      id: 'calculator',
      name: 'ATAP Solar Calculator',
      baseUrl: 'https://calculator.atap.solar',
      headers: {
        'X-Api-Key': 'calculator2026',
      },
      description: 'ATAP Solar Calculator settings & pricing API',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  /**
   * Initialize PostgreSQL table for storing upstream proxy services permanently
   */
  async initialize(): Promise<void> {
    try {
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS _gateway_proxy_services (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          base_url TEXT NOT NULL,
          headers JSONB NOT NULL DEFAULT '{}'::jsonb,
          description TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      this.dbInitialized = true;

      // Check if we need to seed initial default services
      const countRes = await executeQuery('SELECT COUNT(*) as count FROM _gateway_proxy_services');
      if (Number(countRes.rows[0]?.count) === 0) {
        await this.seedDefaults();
      }

      await this.refreshCache();
    } catch (err: any) {
      console.warn('[ProxyService] Database initialization skipped (running in-memory fallback):', err.message);
      this.seedInMemoryDefaults();
    }
  }

  private seedInMemoryDefaults() {
    for (const s of this.defaultServices) {
      this.cache.set(s.id, { ...s });
    }
  }

  private async seedDefaults() {
    for (const s of this.defaultServices) {
      await executeQuery(
        `INSERT INTO _gateway_proxy_services (id, name, base_url, headers, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.baseUrl, JSON.stringify(s.headers || {}), s.description || null, s.isActive]
      );
    }
  }

  /**
   * Reload all proxy services from database into in-memory cache
   */
  async refreshCache(): Promise<void> {
    if (!this.dbInitialized) return;
    try {
      const res = await executeQuery('SELECT * FROM _gateway_proxy_services');
      this.cache.clear();
      for (const row of res.rows) {
        const record: UpstreamServiceRecord = {
          id: row.id,
          name: row.name,
          baseUrl: row.base_url,
          headers: row.headers || {},
          description: row.description,
          isActive: row.is_active,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
        };
        this.cache.set(record.id, record);
      }
    } catch (err: any) {
      console.error('[ProxyService] Cache refresh error:', err.message);
    }
  }

  /**
   * Look up an upstream service by ID
   */
  async getService(id: string): Promise<UpstreamServiceRecord | null> {
    let service = this.cache.get(id);

    if (!service && this.dbInitialized) {
      const res = await executeQuery('SELECT * FROM _gateway_proxy_services WHERE id = $1', [id]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        service = {
          id: row.id,
          name: row.name,
          baseUrl: row.base_url,
          headers: row.headers || {},
          description: row.description,
          isActive: row.is_active,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
        };
        this.cache.set(service.id, service);
      }
    }

    return service || null;
  }

  /**
   * List all configured upstream proxy services
   */
  async listServices(): Promise<UpstreamServiceRecord[]> {
    if (this.dbInitialized) {
      await this.refreshCache();
    }
    return Array.from(this.cache.values());
  }

  /**
   * Register or add a new upstream 3rd-party service
   */
  async registerService(params: {
    id: string;
    name: string;
    baseUrl: string;
    headers?: Record<string, string>;
    description?: string;
    isActive?: boolean;
  }): Promise<UpstreamServiceRecord> {
    const record: UpstreamServiceRecord = {
      id: params.id,
      name: params.name,
      baseUrl: params.baseUrl.replace(/\/+$/, ''), // strip trailing slash
      headers: params.headers || {},
      description: params.description,
      isActive: params.isActive !== undefined ? params.isActive : true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (this.dbInitialized) {
      await executeQuery(
        `INSERT INTO _gateway_proxy_services (id, name, base_url, headers, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           base_url = EXCLUDED.base_url,
           headers = EXCLUDED.headers,
           description = EXCLUDED.description,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        [record.id, record.name, record.baseUrl, JSON.stringify(record.headers), record.description || null, record.isActive]
      );
    }

    this.cache.set(record.id, record);
    return record;
  }

  /**
   * Update an existing upstream proxy service
   */
  async updateService(
    id: string,
    updates: {
      name?: string;
      baseUrl?: string;
      headers?: Record<string, string>;
      description?: string;
      isActive?: boolean;
    }
  ): Promise<UpstreamServiceRecord | null> {
    const existing = await this.getService(id);
    if (!existing) return null;

    if (this.dbInitialized) {
      const sets: string[] = [];
      const params: any[] = [];

      if (updates.name !== undefined) {
        params.push(updates.name);
        sets.push(`name = $${params.length}`);
      }
      if (updates.baseUrl !== undefined) {
        params.push(updates.baseUrl.replace(/\/+$/, ''));
        sets.push(`base_url = $${params.length}`);
      }
      if (updates.headers !== undefined) {
        params.push(JSON.stringify(updates.headers));
        sets.push(`headers = $${params.length}`);
      }
      if (updates.description !== undefined) {
        params.push(updates.description);
        sets.push(`description = $${params.length}`);
      }
      if (updates.isActive !== undefined) {
        params.push(updates.isActive);
        sets.push(`is_active = $${params.length}`);
      }

      sets.push(`updated_at = NOW()`);
      params.push(id);

      const query = `UPDATE _gateway_proxy_services SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`;
      const res = await executeQuery(query, params);
      if (res.rows.length === 0) return null;

      await this.refreshCache();
      return this.cache.get(id) || null;
    }

    // In-memory fallback
    if (updates.name !== undefined) existing.name = updates.name;
    if (updates.baseUrl !== undefined) existing.baseUrl = updates.baseUrl.replace(/\/+$/, '');
    if (updates.headers !== undefined) existing.headers = updates.headers;
    if (updates.description !== undefined) existing.description = updates.description;
    if (updates.isActive !== undefined) existing.isActive = updates.isActive;
    existing.updatedAt = new Date().toISOString();
    this.cache.set(id, existing);
    return existing;
  }

  /**
   * Delete an upstream proxy service
   */
  async deleteService(id: string): Promise<boolean> {
    if (this.dbInitialized) {
      const res = await executeQuery('DELETE FROM _gateway_proxy_services WHERE id = $1 RETURNING id', [id]);
      if (res.rows.length === 0) return false;
      this.cache.delete(id);
      return true;
    }

    if (this.cache.has(id)) {
      this.cache.delete(id);
      return true;
    }
    return false;
  }
}

export const proxyService = new ProxyService();
