export type Action = 'read' | 'create' | 'update' | 'delete';

export interface RowScopeConstraint {
  column: string;
  authField: 'userId' | 'tenantId' | 'organizationId';
}

export interface TablePolicy {
  /** Actions permitted on this table for this API Key */
  actions: Action[];
  
  /** Allowed columns in SELECT queries (if omitted, all non-sensitive columns returned) */
  allowedColumns?: string[];
  
  /** Sensitive columns stripped from responses (e.g. password_hash, secret, otp) */
  forbiddenColumns?: string[];
  
  /** Allowed columns for INSERT / UPDATE operations (prevents unauthorized field tampering) */
  writableColumns?: string[];
  
  /** Optional row-level isolation constraint (e.g. customer_id = user_id) */
  rowScope?: RowScopeConstraint;
}

export interface ProxyPolicy {
  /** Optional allowed HTTP methods, e.g. ['GET', 'PUT', 'POST']. If omitted, all methods allowed. */
  methods?: string[];
  /** Optional allowed path prefixes, e.g. ['/api/v1/settings/*']. If omitted, all paths allowed. */
  allowedPaths?: string[];
}

export interface UpstreamServiceRecord {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Per-API-Key Access Control Model
 */
export interface ApiKeyRecord {
  id: string;
  name: string;
  apiKey: string;
  isActive: boolean;
  role?: string;
  rateLimitRpm: number;
  tables: Record<string, TablePolicy>;
  proxies?: Record<string, ProxyPolicy>;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string | null;
}

export type ClientPolicy = ApiKeyRecord;

export interface AuthContext {
  keyId: string;
  clientName: string;
  role?: string;
  userId?: string;
  tenantId?: string;
}
