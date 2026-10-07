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
