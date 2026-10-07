# Eternalgy PostgreSQL API Gateway

A high-performance, secure API Gateway built with **Fastify**, **TypeScript**, and **pg** designed to run on **Railway** with direct internal private networking to PostgreSQL (`prod_main`).

---

## 🌟 Why this Gateway?

Instead of exposing raw PostgreSQL query endpoints or direct database access to external users and client applications:
1. **Total Access Sovereignty**: You control exactly which tables can be read or written, which columns are visible, and which rows belong to each user.
2. **Zero Public Database Exposure**: PostgreSQL runs with no public TCP proxy. Only the Gateway connects over Railway's private WireGuard mesh network (`postgres.railway.internal:5432`).
3. **Automatic Data Guardrails**:
   - Column masking (sensitive fields like `password_hash`, `token`, `otp` are automatically stripped).
   - Pagination limits (hard ceiling max 100 rows per query to prevent DoS).
   - Mutation validation (restricts writable fields on `POST`/`PATCH`).
   - Row-level isolation (tenant/customer scoping).
4. **Interactive Swagger Documentation**: Built-in Swagger UI at `/docs`.

---

## 🚀 Quickstart

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Set your configuration:
```env
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:password@localhost:5432/prod_main
ADMIN_API_KEY=your_secret_admin_key
```

### 3. Run Development Server
```bash
pnpm run dev
```

The gateway will start on `http://localhost:3000`.  
Open `http://localhost:3000/docs` to explore interactive documentation.

### 4. Run Test Suite
```bash
pnpm test
```

---

## 🚂 Railway Deployment (Direct Internal Networking)

### 1. In Railway Project Dashboard
1. Deploy this service (`Eternalgy API`) in the **same Railway project and environment** as your PostgreSQL database.
2. In the Gateway service settings, add the environment variable:
   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```
   *(Or `${{Postgres.PRIVATE_DATABASE_URL}}`)*
3. Railway will route all database queries privately through internal DNS (e.g. `postgres.railway.internal:5432`) without leaving Railway's private network.
4. **Security Tip**: In your PostgreSQL service on Railway, remove any public TCP Proxy domain so your database is 100% private.

---

## 🛡️ Access Control Model

### Authentication
All governed requests must include an API key:
- Header: `x-api-key: <key>` OR `Authorization: Bearer <key>`
- Optional context: `x-user-id: <user_id>` (for row-level isolation)

### Role & Table Permissions Example
Configure policies in `src/security/policies.ts` or dynamically register them via the Admin API:

```typescript
{
  keyId: "mobile_app_prod",
  apiKey: "eter_live_mobile_...",
  clientName: "Customer Mobile App",
  role: "customer_portal",
  rateLimitRpm: 120,
  tables: {
    product: {
      actions: ["read"],
      allowedColumns: ["id", "name", "category", "price", "is_active"]
    },
    support_ticket: {
      actions: ["read", "create"],
      writableColumns: ["title", "description", "category"],
      rowScope: { column: "customer_id", authField: "userId" }
    }
  }
}
```

### Globally Blocked Tables
The gateway strictly restricts access to internal system tables:
- `user`, `user_debug`, `otps`
- `system_logs`, `system_setting`, `system_parameter`
- `schema_migrations`, `pending_schema_patches`
- legacy tables and backup snapshots

---

## 📡 API Endpoints

### 1. Health Check
- `GET /api/health` — Checks Gateway uptime and live PostgreSQL connectivity & latency.

### 2. Governed Data CRUD (`/v1/data/:table`)
- `GET /v1/data/:table` — List records (supports `?limit=20&offset=0&sort=name&order=asc&status=active`).
- `GET /v1/data/:table/:id` — Retrieve single record.
- `POST /v1/data/:table` — Insert record (sanitized against `writableColumns`).
- `PATCH /v1/data/:table/:id` — Update record.
- `DELETE /v1/data/:table/:id` — Delete record.

### 3. Admin Management (`/api/admin/*`, requires `x-admin-secret`)
- `GET /api/admin/keys` — List all active API keys.
- `POST /api/admin/keys` — Issue a new API key with custom table permissions.
- `DELETE /api/admin/keys/:apiKey` — Revoke an API key.
- `GET /api/admin/tables` — Inspect live PostgreSQL tables.
- `GET /api/admin/audit-logs` — View recent API calls, latencies, and security warnings.
