import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/security/policy-engine.js';
import { ClientPolicy } from '../src/security/types.js';

describe('PolicyEngine Access Control', () => {
  const testPolicy: ClientPolicy = {
    keyId: 'test_key_01',
    apiKey: 'test_token_secret',
    clientName: 'Testing Client',
    role: 'tester',
    tables: {
      product: {
        actions: ['read'],
        allowedColumns: ['id', 'name', 'price'],
      },
      support_ticket: {
        actions: ['read', 'create'],
        writableColumns: ['title', 'description'],
        rowScope: { column: 'user_id', authField: 'userId' },
      },
    },
  };

  it('blocks access to globally forbidden tables (e.g. otps, user)', () => {
    const auth = PolicyEngine.authorize(
      testPolicy,
      'otps',
      'read',
      { keyId: 'test_key_01', clientName: 'Test', role: 'tester' }
    );
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('strictly restricted');
  });

  it('blocks access to tables not declared in client policy', () => {
    const auth = PolicyEngine.authorize(
      testPolicy,
      'invoice',
      'read',
      { keyId: 'test_key_01', clientName: 'Test', role: 'tester' }
    );
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('not accessible for role');
  });

  it('blocks unpermitted action (e.g. DELETE on read-only table)', () => {
    const auth = PolicyEngine.authorize(
      testPolicy,
      'product',
      'delete',
      { keyId: 'test_key_01', clientName: 'Test', role: 'tester' }
    );
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('is not permitted');
  });

  it('allows permitted action on allowed table', () => {
    const auth = PolicyEngine.authorize(
      testPolicy,
      'product',
      'read',
      { keyId: 'test_key_01', clientName: 'Test', role: 'tester' }
    );
    expect(auth.allowed).toBe(true);
  });

  it('enforces row-level scope constraint if configured', () => {
    const authNoUser = PolicyEngine.authorize(
      testPolicy,
      'support_ticket',
      'read',
      { keyId: 'test_key_01', clientName: 'Test', role: 'tester' }
    );
    expect(authNoUser.allowed).toBe(false);
    expect(authNoUser.reason).toContain('missing \'userId\'');

    const authWithUser = PolicyEngine.authorize(
      testPolicy,
      'support_ticket',
      'read',
      { keyId: 'test_key_01', clientName: 'Test', role: 'tester', userId: 'usr_123' }
    );
    expect(authWithUser.allowed).toBe(true);
    expect(authWithUser.rowScopeConstraint).toEqual({
      column: 'user_id',
      value: 'usr_123',
    });
  });

  it('masks unauthorized and default sensitive columns in responses', () => {
    const rawRow = {
      id: 1,
      name: 'Solar Inverter 5kW',
      price: 4500,
      internal_margin: 800, // not in allowedColumns
      password_hash: 'secret_hash_value', // sensitive
    };

    const masked = PolicyEngine.maskRow(testPolicy.tables.product, rawRow);
    expect(masked).toEqual({
      id: 1,
      name: 'Solar Inverter 5kW',
      price: 4500,
    });
    expect(masked.internal_margin).toBeUndefined();
    expect(masked.password_hash).toBeUndefined();
  });

  it('validates and rejects non-writable fields in mutation payloads', () => {
    const invalidPayload = {
      title: 'Panel not working',
      description: 'Error code E01',
      status: 'RESOLVED', // not in writableColumns
    };

    const result = PolicyEngine.validatePayload(
      testPolicy.tables.support_ticket,
      invalidPayload
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Writing to column \'status\' is not allowed');
  });

  it('accepts valid mutation payload', () => {
    const validPayload = {
      title: 'Panel not working',
      description: 'Error code E01',
    };

    const result = PolicyEngine.validatePayload(
      testPolicy.tables.support_ticket,
      validPayload
    );
    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual(validPayload);
  });
});
