import { ClientPolicy, TablePolicy } from './types.js';

/**
 * System-critical tables that are blocked by default for non-admin API consumers
 */
export const GLOBALLY_BLOCKED_TABLES = new Set([
  'otps',
  'user',
  'user_debug',
  'system_logs',
  'system_setting',
  'system_parameter',
  'schema_migrations',
  'pending_schema_patches',
  'legacy_data_01',
  'legacy_ini_to_be_remove_later',
  'linked_agent_resync_backup_20260728',
  'referral_agent_identity_backup_20260720',
  'seda_agent_identity_backup_20260428',
]);

/**
 * Default sensitive column names to always strip if forbiddenColumns is not specified
 */
export const DEFAULT_SENSITIVE_COLUMNS = new Set([
  'password',
  'password_hash',
  'secret',
  'token',
  'otp',
  'private_key',
  'api_key',
  'card_number',
  'cvv',
]);

/**
 * Built-in Role Definitions
 */
export const ROLE_TEMPLATES: Record<string, Record<string, TablePolicy>> = {
  // Read-only catalog consumer (e.g. public website, solar calculator)
  catalog_viewer: {
    product: {
      actions: ['read'],
      allowedColumns: ['id', 'name', 'category', 'specifications', 'price', 'is_active', 'created_at'],
    },
    package: {
      actions: ['read'],
      allowedColumns: ['id', 'name', 'code', 'description', 'price', 'system_size_kw', 'is_active'],
    },
    tnb_tariff_2025: {
      actions: ['read'],
    },
    tariff_b_d_database: {
      actions: ['read'],
    },
  },

  // Customer Mobile Application
  customer_portal: {
    product: {
      actions: ['read'],
    },
    package: {
      actions: ['read'],
    },
    invoice: {
      actions: ['read'],
      allowedColumns: ['id', 'invoice_no', 'customer_id', 'total_amount', 'status', 'created_at'],
      rowScope: { column: 'customer_id', authField: 'userId' },
    },
    support_ticket: {
      actions: ['read', 'create'],
      writableColumns: ['title', 'description', 'category', 'priority'],
      rowScope: { column: 'customer_id', authField: 'userId' },
    },
    voucher: {
      actions: ['read'],
      allowedColumns: ['id', 'code', 'title', 'discount_amount', 'valid_until'],
    },
  },

  // Referral Partner App
  referral_partner: {
    referral: {
      actions: ['read', 'create'],
      writableColumns: ['referee_name', 'referee_phone', 'notes', 'package_interest'],
      rowScope: { column: 'agent_id', authField: 'userId' },
    },
    product: {
      actions: ['read'],
    },
    package: {
      actions: ['read'],
    },
  },
};

/**
 * In-memory client key repository.
 * In production, you can load these from a config file, Redis, or database table.
 */
class PolicyStore {
  private policies: Map<string, ClientPolicy> = new Map();

  constructor() {
    this.seedDefaultKeys();
  }

  private seedDefaultKeys() {
    // Demo / Default keys
    this.registerPolicy({
      keyId: 'key_viewer_demo',
      apiKey: 'eter_demo_catalog_key_2026',
      clientName: 'Public Website / Calculator',
      role: 'catalog_viewer',
      rateLimitRpm: 60,
      tables: ROLE_TEMPLATES.catalog_viewer,
    });

    this.registerPolicy({
      keyId: 'key_mobile_demo',
      apiKey: 'eter_demo_mobile_key_2026',
      clientName: 'Mobile Customer App',
      role: 'customer_portal',
      rateLimitRpm: 120,
      tables: ROLE_TEMPLATES.customer_portal,
    });

    this.registerPolicy({
      keyId: 'key_partner_demo',
      apiKey: 'eter_demo_partner_key_2026',
      clientName: 'Referral Partner App',
      role: 'referral_partner',
      rateLimitRpm: 120,
      tables: ROLE_TEMPLATES.referral_partner,
    });
  }

  public registerPolicy(policy: ClientPolicy) {
    this.policies.set(policy.apiKey, policy);
  }

  public getPolicyByApiKey(apiKey: string): ClientPolicy | undefined {
    return this.policies.get(apiKey);
  }

  public getAllPolicies(): ClientPolicy[] {
    return Array.from(this.policies.values());
  }

  public revokeKey(apiKey: string): boolean {
    return this.policies.delete(apiKey);
  }
}

export const policyStore = new PolicyStore();
