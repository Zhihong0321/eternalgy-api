import crypto from 'node:crypto';
import { executeQuery } from '../db/pool.js';
import { ApiKeyRecord, TablePolicy, ProxyPolicy } from './types.js';
import { ROLE_TEMPLATES, ROLE_PROXY_TEMPLATES } from './policies.js';

class KeyService {
  // In-memory cache for sub-millisecond authentication
  private cache: Map<string, ApiKeyRecord> = new Map();
  private dbInitialized = false;

  /**
   * Initialize PostgreSQL table for storing API keys permanently
   */
  async initialize(): Promise<void> {
    try {
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS _gateway_api_keys (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          api_key VARCHAR(128) UNIQUE NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          role VARCHAR(64),
          rate_limit_rpm INT NOT NULL DEFAULT 120,
          permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ
        );
      `);

      this.dbInitialized = true;

      // Check if we need to seed initial default keys
      const countRes = await executeQuery('SELECT COUNT(*) as count FROM _gateway_api_keys');
      if (Number(countRes.rows[0]?.count) === 0) {
        await this.seedDefaults();
      }

      await this.refreshCache();
    } catch (err: any) {
      console.warn('[KeyService] Database initialization skipped (running in-memory fallback):', err.message);
      this.seedInMemoryDefaults();
    }
  }

  private seedInMemoryDefaults() {
    const defaultKeys: ApiKeyRecord[] = [
      {
        id: 'key_viewer_demo',
        name: 'Public Website / Solar Calculator',
        apiKey: 'eter_demo_catalog_key_2026',
        isActive: true,
        role: 'catalog_viewer',
        rateLimitRpm: 60,
        tables: ROLE_TEMPLATES.catalog_viewer,
        proxies: ROLE_PROXY_TEMPLATES.catalog_viewer,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'key_mobile_demo',
        name: 'Mobile Customer App',
        apiKey: 'eter_demo_mobile_key_2026',
        isActive: true,
        role: 'customer_portal',
        rateLimitRpm: 120,
        tables: ROLE_TEMPLATES.customer_portal,
        proxies: ROLE_PROXY_TEMPLATES.customer_portal,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'key_partner_demo',
        name: 'Referral Partner App',
        apiKey: 'eter_demo_partner_key_2026',
        isActive: true,
        role: 'referral_partner',
        rateLimitRpm: 120,
        tables: ROLE_TEMPLATES.referral_partner,
        proxies: {},
        createdAt: new Date().toISOString(),
      },
      {
        id: 'key_prod_mgr_demo',
        name: 'Product & Package Manager (with ATAP Solar ATS Addon)',
        apiKey: 'eter_demo_product_manager_key_2026',
        isActive: true,
        role: 'product_manager',
        rateLimitRpm: 120,
        tables: ROLE_TEMPLATES.product_manager,
        proxies: ROLE_PROXY_TEMPLATES.product_manager,
        createdAt: new Date().toISOString(),
      },
    ];

    for (const key of defaultKeys) {
      this.cache.set(key.apiKey, key);
    }
  }

  private async seedDefaults() {
    const defaultKeys = [
      {
        id: 'key_viewer_demo',
        name: 'Public Website / Solar Calculator',
        apiKey: 'eter_demo_catalog_key_2026',
        role: 'catalog_viewer',
        rateLimitRpm: 60,
        tables: ROLE_TEMPLATES.catalog_viewer,
        proxies: ROLE_PROXY_TEMPLATES.catalog_viewer,
      },
      {
        id: 'key_mobile_demo',
        name: 'Mobile Customer App',
        apiKey: 'eter_demo_mobile_key_2026',
        role: 'customer_portal',
        rateLimitRpm: 120,
        tables: ROLE_TEMPLATES.customer_portal,
        proxies: ROLE_PROXY_TEMPLATES.customer_portal,
      },
      {
        id: 'key_prod_mgr_demo',
        name: 'Product & Package Manager (with ATAP Solar ATS Addon)',
        apiKey: 'eter_demo_product_manager_key_2026',
        role: 'product_manager',
        rateLimitRpm: 120,
        tables: ROLE_TEMPLATES.product_manager,
        proxies: ROLE_PROXY_TEMPLATES.product_manager,
      },
    ];

    for (const k of defaultKeys) {
      await executeQuery(
        `INSERT INTO _gateway_api_keys (id, name, api_key, role, rate_limit_rpm, permissions)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (api_key) DO NOTHING`,
        [k.id, k.name, k.apiKey, k.role, k.rateLimitRpm, JSON.stringify({ tables: k.tables, proxies: k.proxies || {} })]
      );
    }
  }

  /**
   * Reload all active keys from the database into the fast in-memory cache
   */
  async refreshCache(): Promise<void> {
    if (!this.dbInitialized) return;
    try {
      const res = await executeQuery('SELECT * FROM _gateway_api_keys');
      this.cache.clear();
      for (const row of res.rows) {
        const record: ApiKeyRecord = {
          id: row.id,
          name: row.name,
          apiKey: row.api_key,
          isActive: row.is_active,
          role: row.role,
          rateLimitRpm: row.rate_limit_rpm,
          tables: row.permissions?.tables || {},
          proxies: row.permissions?.proxies || {},
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
          lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
        };
        this.cache.set(record.apiKey, record);
      }
    } catch (err: any) {
      console.error('[KeyService] Cache refresh error:', err.message);
    }
  }

  /**
   * Look up an API key, check active status, and verify expiration
   */
  async getValidKey(apiKey: string): Promise<{ valid: boolean; record?: ApiKeyRecord; reason?: string }> {
    let record = this.cache.get(apiKey);

    // If not in cache and DB is available, check DB
    if (!record && this.dbInitialized) {
      const res = await executeQuery('SELECT * FROM _gateway_api_keys WHERE api_key = $1', [apiKey]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        record = {
          id: row.id,
          name: row.name,
          apiKey: row.api_key,
          isActive: row.is_active,
          role: row.role,
          rateLimitRpm: row.rate_limit_rpm,
          tables: row.permissions?.tables || {},
          proxies: row.permissions?.proxies || {},
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
          lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
        };
        this.cache.set(apiKey, record);
      }
    }

    if (!record) {
      return { valid: false, reason: 'Invalid or unknown API key.' };
    }

    if (!record.isActive) {
      return { valid: false, reason: 'API key has been deactivated by administrator.' };
    }

    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: `API key expired on ${record.expiresAt}.` };
    }

    // Touch last_used_at asynchronously
    if (this.dbInitialized) {
      executeQuery('UPDATE _gateway_api_keys SET last_used_at = NOW() WHERE id = $1', [record.id]).catch(() => {});
    }

    return { valid: true, record };
  }

  /**
   * Look up an API key by its keyId (e.g. key_viewer_demo)
   */
  async getKeyById(id: string): Promise<ApiKeyRecord | null> {
    for (const rec of this.cache.values()) {
      if (rec.id === id) return rec;
    }
    if (this.dbInitialized) {
      const res = await executeQuery('SELECT * FROM _gateway_api_keys WHERE id = $1', [id]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        const record: ApiKeyRecord = {
          id: row.id,
          name: row.name,
          apiKey: row.api_key,
          isActive: row.is_active,
          role: row.role,
          rateLimitRpm: row.rate_limit_rpm,
          tables: row.permissions?.tables || {},
          proxies: row.permissions?.proxies || {},
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
          lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
        };
        this.cache.set(record.apiKey, record);
        return record;
      }
    }
    return null;
  }

  /**
   * Create a new API key with custom per-key table and proxy access control
   */
  async createKey(params: {
    name: string;
    apiKey?: string;
    role?: string;
    rateLimitRpm?: number;
    tables: Record<string, TablePolicy>;
    proxies?: Record<string, ProxyPolicy>;
    expiresAt?: string | null;
  }): Promise<ApiKeyRecord> {
    const id = `key_${crypto.randomBytes(8).toString('hex')}`;
    const keySecret = params.apiKey || `eter_live_${crypto.randomBytes(24).toString('hex')}`;
    const rateLimitRpm = params.rateLimitRpm || 120;
    const expiresAt = params.expiresAt || null;

    const record: ApiKeyRecord = {
      id,
      name: params.name,
      apiKey: keySecret,
      isActive: true,
      role: params.role || 'custom',
      rateLimitRpm,
      tables: params.tables,
      proxies: params.proxies || {},
      expiresAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    if (this.dbInitialized) {
      await executeQuery(
        `INSERT INTO _gateway_api_keys (id, name, api_key, role, rate_limit_rpm, permissions, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          params.name,
          keySecret,
          record.role,
          rateLimitRpm,
          JSON.stringify({ tables: params.tables, proxies: params.proxies || {} }),
          expiresAt ? new Date(expiresAt) : null,
        ]
      );
    }

    this.cache.set(keySecret, record);
    return record;
  }

  /**
   * Update an existing API key's permissions, active status, or limits
   */
  async updateKey(
    id: string,
    updates: {
      name?: string;
      isActive?: boolean;
      rateLimitRpm?: number;
      tables?: Record<string, TablePolicy>;
      proxies?: Record<string, ProxyPolicy>;
      expiresAt?: string | null;
    }
  ): Promise<ApiKeyRecord | null> {
    // Locate in cache or DB
    let targetKeySecret: string | null = null;
    for (const [sec, rec] of this.cache.entries()) {
      if (rec.id === id) {
        targetKeySecret = sec;
        break;
      }
    }

    if (this.dbInitialized) {
      const existing = await this.getKeyById(id);
      const sets: string[] = [];
      const params: any[] = [];

      if (updates.name !== undefined) {
        params.push(updates.name);
        sets.push(`name = $${params.length}`);
      }
      if (updates.isActive !== undefined) {
        params.push(updates.isActive);
        sets.push(`is_active = $${params.length}`);
      }
      if (updates.rateLimitRpm !== undefined) {
        params.push(updates.rateLimitRpm);
        sets.push(`rate_limit_rpm = $${params.length}`);
      }
      if (updates.tables !== undefined || updates.proxies !== undefined) {
        const mergedPermissions = {
          tables: updates.tables !== undefined ? updates.tables : (existing?.tables || {}),
          proxies: updates.proxies !== undefined ? updates.proxies : (existing?.proxies || {}),
        };
        params.push(JSON.stringify(mergedPermissions));
        sets.push(`permissions = $${params.length}`);
      }
      if (updates.expiresAt !== undefined) {
        params.push(updates.expiresAt ? new Date(updates.expiresAt) : null);
        sets.push(`expires_at = $${params.length}`);
      }

      sets.push(`updated_at = NOW()`);
      params.push(id);

      const query = `UPDATE _gateway_api_keys SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`;
      const res = await executeQuery(query, params);
      if (res.rows.length === 0) return null;

      await this.refreshCache();
      return this.cache.get(res.rows[0].api_key) || null;
    }

    // In-memory update fallback
    if (targetKeySecret) {
      const rec = this.cache.get(targetKeySecret)!;
      if (updates.name !== undefined) rec.name = updates.name;
      if (updates.isActive !== undefined) rec.isActive = updates.isActive;
      if (updates.rateLimitRpm !== undefined) rec.rateLimitRpm = updates.rateLimitRpm;
      if (updates.tables !== undefined) rec.tables = updates.tables;
      if (updates.proxies !== undefined) rec.proxies = updates.proxies;
      if (updates.expiresAt !== undefined) rec.expiresAt = updates.expiresAt;
      rec.updatedAt = new Date().toISOString();
      return rec;
    }

    return null;
  }

  /**
   * Delete an API key permanently
   */
  async deleteKey(id: string): Promise<boolean> {
    if (this.dbInitialized) {
      const res = await executeQuery('DELETE FROM _gateway_api_keys WHERE id = $1 RETURNING api_key', [id]);
      if (res.rows.length === 0) return false;
      this.cache.delete(res.rows[0].api_key);
      return true;
    }

    for (const [sec, rec] of this.cache.entries()) {
      if (rec.id === id) {
        this.cache.delete(sec);
        return true;
      }
    }
    return false;
  }

  /**
   * List all configured API keys
   */
  async listKeys(): Promise<ApiKeyRecord[]> {
    if (this.dbInitialized) {
      await this.refreshCache();
    }
    return Array.from(this.cache.values());
  }
}

export const keyService = new KeyService();
