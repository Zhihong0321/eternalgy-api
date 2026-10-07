import {
  Action,
  AuthContext,
  ClientPolicy,
  TablePolicy,
} from './types.js';
import {
  GLOBALLY_BLOCKED_TABLES,
  DEFAULT_SENSITIVE_COLUMNS,
} from './policies.js';

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  tablePolicy?: TablePolicy;
  rowScopeConstraint?: { column: string; value: any };
}

export class PolicyEngine {
  /**
   * Verify if the client has permission to perform an action on a table
   */
  static authorize(
    keyRecord: { tables: Record<string, TablePolicy>; role?: string },
    tableName: string,
    action: Action,
    authContext: AuthContext
  ): AuthorizationResult {
    // 1. Check globally blocked tables
    if (GLOBALLY_BLOCKED_TABLES.has(tableName.toLowerCase())) {
      return {
        allowed: false,
        reason: `Access to table '${tableName}' is strictly restricted by gateway security policy.`,
      };
    }

    // 2. Check if table is configured in this API key's permissions
    const tablePolicy = keyRecord.tables[tableName];
    if (!tablePolicy) {
      return {
        allowed: false,
        reason: `Table '${tableName}' is not authorized for this API key (${authContext.clientName || authContext.keyId}).`,
      };
    }

    // 3. Check action permission
    if (!tablePolicy.actions.includes(action)) {
      return {
        allowed: false,
        reason: `Action '${action.toUpperCase()}' is not permitted on table '${tableName}'. Allowed actions: [${tablePolicy.actions.join(', ')}].`,
      };
    }

    // 4. Resolve row-level scope constraint if configured
    let rowScopeConstraint: { column: string; value: any } | undefined;
    if (tablePolicy.rowScope) {
      const authVal = (authContext as any)[tablePolicy.rowScope.authField];
      if (!authVal) {
        return {
          allowed: false,
          reason: `Row-level authorization failed: missing '${tablePolicy.rowScope.authField}' in authentication context.`,
        };
      }
      rowScopeConstraint = {
        column: tablePolicy.rowScope.column,
        value: authVal,
      };
    }

    return {
      allowed: true,
      tablePolicy,
      rowScopeConstraint,
    };
  }

  /**
   * Filter and mask columns in a response row based on table policy
   */
  static maskRow(tablePolicy: TablePolicy, row: Record<string, any>): Record<string, any> {
    const output: Record<string, any> = {};
    const allowed = tablePolicy.allowedColumns ? new Set(tablePolicy.allowedColumns) : null;
    const forbidden = tablePolicy.forbiddenColumns ? new Set(tablePolicy.forbiddenColumns) : null;

    for (const [key, value] of Object.entries(row)) {
      // 1. If explicit allowedColumns defined, must be in whitelist
      if (allowed && !allowed.has(key)) {
        continue;
      }

      // 2. If explicit forbiddenColumns defined, must not be in blacklist
      if (forbidden && forbidden.has(key)) {
        continue;
      }

      // 3. Default sensitive column check
      if (DEFAULT_SENSITIVE_COLUMNS.has(key.toLowerCase())) {
        continue;
      }

      output[key] = value;
    }

    return output;
  }

  /**
   * Validate and sanitize mutation payload (INSERT / UPDATE)
   */
  static validatePayload(
    tablePolicy: TablePolicy,
    payload: Record<string, any>
  ): { valid: boolean; sanitized?: Record<string, any>; error?: string } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { valid: false, error: 'Request body must be a JSON object.' };
    }

    const sanitized: Record<string, any> = {};
    const writable = tablePolicy.writableColumns ? new Set(tablePolicy.writableColumns) : null;

    for (const [key, value] of Object.entries(payload)) {
      // Disallow updating primary ID or system timestamps unless specifically configured
      if (key === 'id' && !writable?.has('id')) {
        return { valid: false, error: `Modifying column 'id' directly is not permitted.` };
      }

      // If writable columns are restricted, check permission
      if (writable && !writable.has(key)) {
        return { valid: false, error: `Writing to column '${key}' is not allowed for this role.` };
      }

      sanitized[key] = value;
    }

    if (Object.keys(sanitized).length === 0) {
      return { valid: false, error: 'Payload contains no valid writable fields.' };
    }

    return { valid: true, sanitized };
  }
}
