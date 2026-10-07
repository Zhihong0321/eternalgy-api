export type Action = 'read' | 'create' | 'update' | 'delete';

export interface RowScopeConstraint {
  column: string;
  authField: 'userId' | 'tenantId' | 'organizationId';
}

export interface TablePolicy {
  /** Actions permitted on this table */
  actions: Action[];
  
  /** Allowed columns in SELECT queries (if omitted, all columns except forbiddenColumns are returned) */
  allowedColumns?: string[];
  
  /** Sensitive columns stripped from responses (e.g., password_hash, secret, otp) */
  forbiddenColumns?: string[];
  
  /** Allowed columns for INSERT / UPDATE operations (prevents payload tampering) */
  writableColumns?: string[];
  
  /** Optional row-level isolation constraint */
  rowScope?: RowScopeConstraint;
}

export interface ClientPolicy {
  keyId: string;
  apiKey: string;
  clientName: string;
  role: string;
  rateLimitRpm?: number;
  tables: Record<string, TablePolicy>;
}

export interface AuthContext {
  keyId: string;
  clientName: string;
  role: string;
  userId?: string;
  tenantId?: string;
}
