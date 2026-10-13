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
  resolvedTableName?: string;
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
    const lowerName = tableName.toLowerCase();
    const normalizedName = lowerName.replace(/[\s-]+/g, '_');
    const singularName = normalizedName.endsWith('s') ? normalizedName.slice(0, -1) : normalizedName;

    // 1. Check globally blocked tables
    if (GLOBALLY_BLOCKED_TABLES.has(lowerName) || GLOBALLY_BLOCKED_TABLES.has(normalizedName)) {
      const isElevatedRole = keyRecord.role === 'ceo' || authContext.role === 'ceo' || authContext.role === 'admin';
      const isExplicitlyAuthorized = Boolean(
        keyRecord.tables[tableName] ||
        keyRecord.tables[lowerName] ||
        keyRecord.tables[normalizedName] ||
        keyRecord.tables[singularName]
      );
      const isDomainTable =
        lowerName === 'user' ||
        normalizedName === 'user' ||
        lowerName === 'users' ||
        normalizedName === 'users';

      if (!isElevatedRole || !isExplicitlyAuthorized || !isDomainTable) {
        return {
          allowed: false,
          reason: `Access to table '${tableName}' is strictly restricted by gateway security policy.`,
        };
      }
    }

    // 2. Check if table is configured in this API key's permissions
    let tablePolicy = keyRecord.tables[tableName];
    let resolvedTableName = tableName;

    if (!tablePolicy && keyRecord.tables[lowerName]) {
      tablePolicy = keyRecord.tables[lowerName];
      resolvedTableName = lowerName;
    }
    if (!tablePolicy && keyRecord.tables[normalizedName]) {
      tablePolicy = keyRecord.tables[normalizedName];
      resolvedTableName = normalizedName;
    }
    if (!tablePolicy && keyRecord.tables[singularName]) {
      tablePolicy = keyRecord.tables[singularName];
      resolvedTableName = singularName;
    }
    if (!tablePolicy) {
      if (normalizedName === 'submitted_payment' && keyRecord.tables['submited_payment']) {
        tablePolicy = keyRecord.tables['submited_payment'];
        resolvedTableName = 'submited_payment';
      } else if (normalizedName === 'submited_payment' && keyRecord.tables['submitted_payment']) {
        tablePolicy = keyRecord.tables['submitted_payment'];
        resolvedTableName = 'submitted_payment';
      }
    }

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
      resolvedTableName,
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
