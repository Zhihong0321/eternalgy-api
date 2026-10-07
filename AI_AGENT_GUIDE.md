# AI Assistant & Agent Integration Guide

This guide enables **Antigravity** (and any autonomous AI agent) to interact with and manage the **Eternalgy PostgreSQL API Gateway**.

---

## 🤖 1. Authentication for AI Agents

All administrative and diagnostic endpoints require the Master Admin Secret:

```http
Header:
x-admin-secret: <ADMIN_API_KEY>
```

When calling customer/client data endpoints to verify access on behalf of a user:
```http
Header:
x-api-key: <CLIENT_API_KEY>
```

---

## 🔑 2. Key Management Capabilities (How AI Manages Keys)

### A. List All Active Keys
```http
GET /api/admin/keys
Header: x-admin-secret: <ADMIN_API_KEY>
```
**AI Behavior**: Call this to check what keys exist, which partners have access, rate limits, and expiration dates.

### B. Issue a New API Key
```http
POST /api/admin/keys
Header: x-admin-secret: <ADMIN_API_KEY>
Content-Type: application/json

{
  "name": "Mobile iOS Client",
  "role": "mobile_app",
  "rateLimitRpm": 120,
  "tables": {
    "product": {
      "actions": ["read"],
      "allowedColumns": ["id", "name", "price", "is_active"]
    },
    "support_ticket": {
      "actions": ["read", "create"],
      "writableColumns": ["title", "description", "category"]
    }
  }
}
```
**AI Behavior**: Creates a scoped key and returns the generated `apiKey` token to the user.

### C. Disable / Re-enable a Key
```http
PATCH /api/admin/keys/:id
Header: x-admin-secret: <ADMIN_API_KEY>
Content-Type: application/json

{
  "isActive": false
}
```

### D. Update Key Permissions
```http
PATCH /api/admin/keys/:id
Header: x-admin-secret: <ADMIN_API_KEY>
Content-Type: application/json

{
  "tables": {
    "product": { "actions": ["read"] },
    "invoice": { "actions": ["read"], "allowedColumns": ["id", "invoice_no", "total_amount"] }
  }
}
```

### E. Permanently Revoke a Key
```http
DELETE /api/admin/keys/:id
Header: x-admin-secret: <ADMIN_API_KEY>
```

---

## 🛠️ 3. Debug & Diagnostic Layer (Self-Introspection for AI)

### A. System Health & Pool Diagnostics
```http
GET /api/debug/diagnostics
Header: x-admin-secret: <ADMIN_API_KEY>
```
**Returns:**
- PostgreSQL connection status, latency in milliseconds, error message (if any).
- Connection pool statistics: `totalCount`, `idleCount`, `waitingCount`, `maxConnections`.
- Process memory: `rssMb`, `heapTotalMb`, `heapUsedMb`.
- Uptime in seconds.
- Total keys vs Active keys.

### B. Query Performance & EXPLAIN Analyzer
To diagnose slow queries without executing mutations:
```http
POST /api/debug/explain
Header: x-admin-secret: <ADMIN_API_KEY>
Content-Type: application/json

{
  "sql": "SELECT * FROM saj_reading WHERE reading_time >= NOW() - INTERVAL '1 day' LIMIT 50",
  "params": []
}
```
**Returns:**
PostgreSQL `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)` execution plan showing whether indexes are being utilized or if sequential scans are occurring.

### C. Inspect Recent Errors (4xx & 5xx)
```http
GET /api/debug/recent-errors?limit=50
Header: x-admin-secret: <ADMIN_API_KEY>
```
**Returns:**
The last 50 failed requests with timestamp, client IP, key ID, path, HTTP status code, and specific error messages.

### D. Full Audit Log Stream
```http
GET /api/admin/audit-logs?limit=100
Header: x-admin-secret: <ADMIN_API_KEY>
```
**Returns:**
Recent request stream with latency (ms), status codes, and user agent info.

---

## 📋 4. Database Schema Discovery
To see all valid tables available in `prod_main`:
```http
GET /api/admin/tables
Header: x-admin-secret: <ADMIN_API_KEY>
```
**AI Behavior**: Call this before issuing a key to confirm exact table names.
