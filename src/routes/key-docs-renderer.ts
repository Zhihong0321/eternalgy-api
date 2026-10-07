import { KeyDocProfile, KeyDocTable, KeyDocProxyService } from './key-docs-types.js';

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderKeyDocHtml(data: KeyDocProfile): string {
  const {
    keyId,
    clientName,
    role,
    rateLimitRpm,
    allowedTablesCount,
    tables,
    relationships,
    proxyServices,
    keyToUse,
    host,
    rawSecret,
    aiPrompt,
  } = data;

  const secretQuery = rawSecret ? `?secret=${encodeURIComponent(rawSecret)}` : '';
  const llmsUrl = `/docs/keys/${encodeURIComponent(keyId)}/llms.txt${secretQuery}`;
  const openApiUrl = `/api/docs/key-openapi.json?keyId=${encodeURIComponent(keyId)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Key Access Profile & Documentation — ${escapeHtml(clientName)} (${escapeHtml(keyId)})</title>
  <meta name="description" content="Dedicated API Gateway documentation for API Key ${escapeHtml(keyId)} (${escapeHtml(role)}). Includes live endpoints, PostgreSQL schemas, and AI agent instructions.">
  
  <!-- AI Agent & Machine-Readable Discovery -->
  <link rel="alternate" type="text/markdown" title="AI Agent System Prompt (Markdown / llms.txt)" href="${llmsUrl}">
  <link rel="alternate" type="application/json" title="OpenAPI 3.0 Specification" href="${openApiUrl}">

  <link rel="stylesheet" href="/admin/styles.css">
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg-primary: #0a0d14;
      --bg-secondary: #121620;
      --bg-card: #181d2a;
      --bg-hover: #22293b;
      --border: #262f44;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #10b981;
      --accent-hover: #059669;
      --ai-purple: #c084fc;
      --ai-purple-bg: rgba(168, 85, 247, 0.08);
      --ai-purple-border: rgba(168, 85, 247, 0.35);
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --radius: 8px;
    }
    body {
      background-color: var(--bg-primary);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      font-size: 14px;
      margin: 0;
      padding: 0;
    }
    .app-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-badge {
      background: linear-gradient(135deg, #10b981 0%, #047857 100%);
      color: white;
      font-weight: 700;
      font-size: 13px;
      padding: 6px 10px;
      border-radius: var(--radius);
      letter-spacing: 0.5px;
    }
    .brand h1 {
      font-size: 17px;
      font-weight: 600;
      margin: 0;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .main-content {
      max-width: 1360px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      box-sizing: border-box;
    }
    .key-hero {
      background: linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-card) 100%);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 20px;
    }
    .key-title-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .profile-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .meta-box {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 14px;
    }
    .meta-box-label {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .meta-box-val {
      font-size: 14px;
      font-weight: 600;
      font-family: var(--font-mono);
    }
    /* AI Directive Banner */
    .ai-banner {
      background: var(--ai-purple-bg);
      border: 1px solid var(--ai-purple-border);
      border-radius: var(--radius);
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .badge {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .badge.healthy {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-main);
    }
    .btn:hover {
      background: var(--bg-hover);
      border-color: var(--text-muted);
    }
    .btn.primary {
      background: var(--accent);
      color: #042f2e;
      border: none;
    }
    .btn.primary:hover {
      background: var(--accent-hover);
    }
    .btn.ai-btn {
      background: #9333ea;
      color: #ffffff;
      border: none;
    }
    .btn.ai-btn:hover {
      background: #7e22ce;
    }
    .btn.sm {
      padding: 6px 10px;
      font-size: 12px;
    }
    /* Section Navigation */
    .section-tab-nav {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      flex-wrap: wrap;
    }
    .sec-tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      display: inline-block;
    }
    .sec-tab-btn:hover { color: var(--text-main); background: rgba(255,255,255,0.04); }
    .sec-tab-btn.active { background: var(--bg-hover); color: var(--accent); }
    .sec-pane { display: none; }
    .sec-pane.active { display: block; }
    
    /* Layout Cards & Tables */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
    }
    .grid-cards {
      display: grid;
      gap: 20px;
    }
    .table-container {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-primary);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    th, td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: var(--bg-secondary);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    tr:last-child td { border-bottom: none; }
    .method {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      font-family: var(--font-mono);
      text-transform: uppercase;
    }
    .method.get { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }
    .method.post { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
    .method.put, .method.patch { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
    .method.delete { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
    .method.all { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
    .schema-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--font-mono);
    }
    .schema-tag.type { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
    .schema-tag.req { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
    .schema-tag.opt { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; }
    .code, pre, code {
      font-family: var(--font-mono);
    }
    pre {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      color: #38bdf8;
      font-size: 12px;
      margin: 6px 0;
    }
    .status-code {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      font-family: var(--font-mono);
    }
    .status-code.s2xx { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }
    .status-code.s4xx { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
    
    /* Layout Grid for Docs */
    .layout-grid {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 24px;
    }
    @media (max-width: 850px) {
      .layout-grid { grid-template-columns: 1fr; }
    }
    .sidebar-menu {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      position: sticky;
      top: 80px;
      height: fit-content;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }
    .menu-item {
      display: block;
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--text-main);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 4px;
      transition: all 0.2s;
    }
    .menu-item:hover, .menu-item.active {
      background: var(--bg-hover);
      color: var(--accent);
    }
    .resource-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 24px;
      scroll-margin-top: 80px;
    }
    .resource-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .code-tab-btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .code-tab-btn.active {
      background: var(--bg-hover);
      color: var(--accent);
      border-color: var(--accent);
    }
    .form-input, .form-select {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 8px 12px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="app-container">
    <header class="header">
      <div class="brand">
        <div class="logo-badge">ETERNALGY</div>
        <h1>API Key Access Profile & Documentation</h1>
      </div>
      <div class="header-actions">
        <button class="btn sm" onclick="copyShareLink()">📋 Copy Doc Link</button>
        <button class="btn sm ai-btn" onclick="copyAiPrompt()">🤖 Copy AI Prompt</button>
        <a id="llmsTxtLink" href="${llmsUrl}" target="_blank" class="btn sm">📄 Raw llms.txt</a>
        <a id="openApiDownloadBtn" href="${openApiUrl}" target="_blank" class="btn sm">⚡ OpenAPI 3.0</a>
        <a href="/admin/" class="btn sm primary">Admin Console</a>
      </div>
    </header>

    <main class="main-content">
      <!-- Hero Header (Server-Side Pre-Rendered) -->
      <div class="key-hero">
        <div class="key-title-row">
          <div>
            <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--accent); margin-bottom: 4px;">
              Dedicated API Key Profile
            </div>
            <h1 id="heroKeyName" style="font-size: 24px; font-weight: 700; margin: 0 0 6px 0;">${escapeHtml(clientName)}</h1>
            <p style="color: var(--text-muted); font-size: 13px; margin: 0;">
              Governed gateway profile for <code>${escapeHtml(keyId)}</code>. Internal PostgreSQL tables and 3rd-party proxy endpoints are tailored to this key.
            </p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge healthy">Active Gateway Key</span>
          </div>
        </div>

        <div class="profile-meta-grid">
          <div class="meta-box">
            <div class="meta-box-label">Key ID</div>
            <div class="meta-box-val" id="metaKeyId">${escapeHtml(keyId)}</div>
          </div>
          <div class="meta-box">
            <div class="meta-box-label">Role Definition</div>
            <div class="meta-box-val" id="metaRole">${escapeHtml(role || 'default')}</div>
          </div>
          <div class="meta-box">
            <div class="meta-box-label">Rate Limit</div>
            <div class="meta-box-val"><span id="metaRpm">${rateLimitRpm}</span> rpm</div>
          </div>
          <div class="meta-box">
            <div class="meta-box-label">Database Tables</div>
            <div class="meta-box-val" id="metaTableCount">${allowedTablesCount} tables</div>
          </div>
          <div class="meta-box">
            <div class="meta-box-label">3rd-Party APIs</div>
            <div class="meta-box-val" id="metaProxyCount" style="color: #38bdf8;">${proxyServices.length} services</div>
          </div>
        </div>
      </div>

      <!-- AI Agent Directive Banner -->
      <div class="ai-banner">
        <div style="flex: 1; min-width: 280px;">
          <div style="font-weight: 600; color: #c084fc; font-size: 13px; display: flex; align-items: center; gap: 6px;">
            🤖 AI Agent Directive (Cursor · Windsurf · Claude Code · Antigravity · Copilot)
          </div>
          <div style="font-size: 12px; color: var(--text-main); margin-top: 4px; line-height: 1.5;">
            <strong>⚠️ Mandatory First Step:</strong> AI coding agents must advise the user to <strong>create a new dedicated project folder</strong> (e.g. <code>mkdir eternalgy-ats-integration && cd eternalgy-ats-integration</code>) so discussion history, scripts, and <code>MEMORY.md</code> can be safely stored and isolated.
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn sm ai-btn" onclick="copyAiPrompt()">📋 Copy Prompt for AI</button>
          <a href="${llmsUrl}" target="_blank" class="btn sm">📄 Raw llms.txt</a>
        </div>
      </div>

      <!-- Section Navigation -->
      <div class="section-tab-nav">
        <button class="sec-tab-btn active" data-sec="overviewSec">📋 Access Matrix & Keys</button>
        <button class="sec-tab-btn" data-sec="docsSec">📖 Endpoints & Schema</button>
        <button class="sec-tab-btn" data-sec="aiAgentSec" style="color: #c084fc;">🤖 AI Agent Guide & Relations</button>
        <button class="sec-tab-btn" data-sec="testerSec">⚡ Live Tester & Code</button>
      </div>

      <!-- SECTION 1: OVERVIEW & CREDENTIALS -->
      <section id="overviewSec" class="sec-pane active">
        <div class="grid-cards" style="grid-template-columns: 1.2fr 0.8fr; margin-bottom: 24px;">
          <!-- Connection Card -->
          <div class="card">
            <h3 style="font-size: 16px; margin-bottom: 12px;">Connection Instructions</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
              <div>
                <div class="meta-box-label">Base Gateway URL</div>
                <pre><code id="connBaseUrl">${escapeHtml(host)}</code></pre>
              </div>
              <div>
                <div class="meta-box-label">HTTP Authentication Headers</div>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">Pass your API Key in either header:</p>
                <pre><code>x-api-key: ${escapeHtml(keyToUse)}
# OR
Authorization: Bearer ${escapeHtml(keyToUse)}</code></pre>
              </div>
              <div>
                <div class="meta-box-label">Standard HTTP Status Codes</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; font-size: 12px; margin-top: 6px;">
                  <div><span class="status-code s2xx">200 OK</span>: Successful request</div>
                  <div><span class="status-code s2xx">201 Created</span>: Record created</div>
                  <div><span class="status-code s4xx">401 Unauthorized</span>: Missing or invalid key</div>
                  <div><span class="status-code s4xx">403 Forbidden</span>: Resource/action not granted</div>
                  <div><span class="status-code s4xx">429 Rate Limit</span>: Exceeded quota</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Guardrails Card -->
          <div class="card">
            <h3 style="font-size: 16px; margin-bottom: 12px;">Enforced Guardrails</h3>
            <ul style="color: var(--text-muted); font-size: 13px; list-style-position: inside; display: flex; flex-direction: column; gap: 8px;">
              <li><b>Single Key Architecture</b>: 1 key accesses both internal DB and 3rd-party APIs.</li>
              <li><b>Credential Cloaking</b>: Upstream secret keys (e.g. calculator2026) are injected safely.</li>
              <li><b>Hard Limit Capping</b>: Queries capped at max 100 rows per request.</li>
              <li><b>Statement Timeout</b>: 5,000ms max execution time to protect database CPU.</li>
              <li><b>Sensitive Scrubbing</b>: Passwords, tokens, and hashes are permanently blocked.</li>
            </ul>
          </div>
        </div>

        <!-- 3rd-Party Proxy Services Card -->
        ${proxyServices.length > 0 ? `
        <div class="card" id="proxyServicesCard" style="margin-bottom: 24px;">
          <h3 style="font-size: 16px; margin-bottom: 6px; color: #38bdf8;">🌐 Authorized 3rd-Party APIs & Services</h3>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
            External services you can access through this gateway. Upstream authentication credentials are injected automatically.
          </p>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Service Name</th>
                  <th>Direct Route / Endpoint</th>
                  <th>Allowed Actions</th>
                  <th>Upstream Target</th>
                </tr>
              </thead>
              <tbody id="proxyMatrixBody">
                ${proxyServices.map(p => `
                <tr>
                  <td>
                    <div style="font-weight: 600; color: #38bdf8;">${escapeHtml(p.name)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(p.description)}</div>
                  </td>
                  <td>
                    ${p.endpoints.map(ep => `<div style="font-family: var(--font-mono); font-size: 12px; margin-bottom: 2px;"><span class="method ${ep.method.toLowerCase()}">${escapeHtml(ep.method)}</span> <b>${escapeHtml(ep.path)}</b></div>`).join('')}
                  </td>
                  <td><span class="badge healthy">Full Access</span></td>
                  <td><a href="${escapeHtml(p.baseUrl)}" target="_blank" style="color: #60a5fa; font-family: var(--font-mono); font-size: 12px;">${escapeHtml(p.baseUrl)}</a></td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}

        <!-- Access Profile Matrix Table -->
        <div class="card">
          <h3 style="font-size: 16px; margin-bottom: 6px; color: #10b981;">🗄️ Granted Database Tables Matrix</h3>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
            Comprehensive list of internal PostgreSQL tables and operations explicitly authorized for this key.
          </p>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Table Name</th>
                  <th>Permitted Actions</th>
                  <th>Column Filtering</th>
                  <th>Row-Level Security Scope</th>
                </tr>
              </thead>
              <tbody id="matrixTableBody">
                ${tables.length === 0 ? `
                <tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 16px;">No database tables assigned to this key.</td></tr>
                ` : tables.map(t => {
                  const readableCount = t.columns.readable.length;
                  const writableCount = t.columns.writable.length;
                  const acts = t.actions.map(a => `<span class="method ${a === 'read' ? 'get' : a === 'create' ? 'post' : a === 'update' ? 'patch' : 'delete'}">${a.toUpperCase()}</span>`).join(' ');
                  return `
                  <tr>
                    <td style="font-weight: 600; font-family: var(--font-mono); font-size: 13px;">${escapeHtml(t.table)}</td>
                    <td>${acts}</td>
                    <td>
                      <span class="code">${readableCount} readable columns</span>
                      ${writableCount > 0 ? `<br><span class="code" style="color: var(--accent); margin-top: 4px; display:inline-block;">${writableCount} writable columns</span>` : ''}
                    </td>
                    <td>${t.rowScope ? `<span class="code">${escapeHtml(t.rowScope.column)} = user_id</span>` : '<span style="color: var(--text-muted);">None (Full Table Scope)</span>'}</td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- SECTION 2: ENDPOINTS & SCHEMAS (ALL PRE-RENDERED IN HTML) -->
      <section id="docsSec" class="sec-pane">
        <div class="layout-grid">
          <!-- Sidebar Menu -->
          <div class="sidebar-menu">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">
              Authorized Resources
            </div>
            ${proxyServices.length > 0 ? `
              <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: #38bdf8; margin-top: 8px; margin-bottom: 6px;">🌐 3rd-Party Services</div>
              ${proxyServices.map(p => `
                <a href="#resource-proxy-${escapeHtml(p.id)}" class="menu-item">
                  ${escapeHtml(p.name)}
                  <div style="font-size: 11px; opacity: 0.6; margin-top: 2px;">Reverse Proxy</div>
                </a>
              `).join('')}
            ` : ''}
            ${tables.length > 0 ? `
              <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: #10b981; margin-top: 14px; margin-bottom: 6px;">🗄️ Database Tables</div>
              ${tables.map(t => `
                <a href="#resource-table-${escapeHtml(t.table)}" class="menu-item">
                  ${escapeHtml(t.table)}
                  <div style="font-size: 11px; opacity: 0.6; margin-top: 2px;">${t.actions.join(', ')}</div>
                </a>
              `).join('')}
            ` : ''}
          </div>

          <!-- All Resource Details (Pre-Rendered Sequentially) -->
          <div id="allTableDocDetails">
            ${proxyServices.map(p => `
            <div id="resource-proxy-${escapeHtml(p.id)}" class="resource-card">
              <div class="resource-header">
                <h2 style="font-size: 20px; margin: 0;">3rd-Party Service: <span class="code" style="color: #38bdf8;">${escapeHtml(p.name)}</span></h2>
                <span class="badge healthy">Active</span>
              </div>
              <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
                ${escapeHtml(p.description)} Upstream URL: <a href="${escapeHtml(p.baseUrl)}" target="_blank" style="color: #60a5fa;">${escapeHtml(p.baseUrl)}</a>
              </p>

              <h3 style="font-size: 14px; margin-top: 16px; margin-bottom: 10px;">Available Gateway Endpoints</h3>
              <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                ${p.endpoints.map(ep => `
                <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span class="method ${ep.method.toLowerCase()}">${escapeHtml(ep.method)}</span>
                      <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600;">${escapeHtml(ep.path)}</span>
                    </div>
                  </div>
                  <div style="color: var(--text-muted); font-size: 12px;">${escapeHtml(ep.description)}</div>
                </div>
                `).join('')}
              </div>

              <h3 style="font-size: 14px; margin-top: 20px; margin-bottom: 10px;">Payload Specification (Update ATS Price)</h3>
              <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 12px;">
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">PUT Request Body (JSON):</div>
                <pre><code>{
  "price": 1500
}</code></pre>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 10px; margin-bottom: 6px;">Expected Response (200 OK):</div>
                <pre><code>{
  "success": true,
  "data": {
    "key": "ats_addon_price",
    "price": 1500,
    "currency": "MYR",
    "updatedAt": "2026-10-07T05:15:33.172Z"
  }
}</code></pre>
              </div>
            </div>
            `).join('')}

            ${tables.map(t => `
            <div id="resource-table-${escapeHtml(t.table)}" class="resource-card">
              <div class="resource-header">
                <h2 style="font-size: 20px; margin: 0;">Table: <span class="code" style="color: var(--accent);">${escapeHtml(t.table)}</span></h2>
                <div style="display: flex; gap: 6px;">
                  ${t.actions.map(a => `<span class="method ${a === 'read' ? 'get' : a === 'create' ? 'post' : a === 'update' ? 'patch' : 'delete'}">${a.toUpperCase()}</span>`).join(' ')}
                </div>
              </div>

              <h3 style="font-size: 14px; margin-top: 16px; margin-bottom: 8px;">Available Endpoints</h3>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
                ${t.endpoints.map(ep => `
                <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="method ${ep.method.toLowerCase()}">${escapeHtml(ep.method)}</span>
                    <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600;">${escapeHtml(ep.path)}</span>
                  </div>
                  <div style="color: var(--text-muted); font-size: 12px;">${escapeHtml(ep.description)}</div>
                </div>
                `).join('')}
              </div>

              <h3 style="font-size: 14px; margin-top: 20px; margin-bottom: 8px;">Response Columns Schema (${t.columns.readable.length} fields)</h3>
              <div class="table-container" style="margin-bottom: 20px;">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>DB Type</th>
                      <th>JSON Type</th>
                      <th>Constraint</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${t.columns.readable.map(c => `
                    <tr>
                      <td style="font-weight: 600; font-family: var(--font-mono);">${escapeHtml(c.name)}${c.isPrimaryKey ? ' 🔑' : ''}</td>
                      <td><span class="schema-tag type">${escapeHtml(c.dataType)}</span></td>
                      <td><span class="code">${escapeHtml(c.jsonType)}</span></td>
                      <td>${c.isPrimaryKey ? '<span class="schema-tag req">Primary Key</span>' : c.isNullable ? '<span class="schema-tag opt">Nullable</span>' : '<span class="schema-tag req">Not Null</span>'}</td>
                    </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>

              ${t.columns.writable.length > 0 ? `
              <h3 style="font-size: 14px; margin-top: 20px; margin-bottom: 8px;">Writable Payload Fields (${t.columns.writable.length} fields)</h3>
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>DB Type</th>
                      <th>JSON Type</th>
                      <th>Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${t.columns.writable.map(c => `
                    <tr>
                      <td style="font-weight: 600; font-family: var(--font-mono);">${escapeHtml(c.name)}</td>
                      <td><span class="schema-tag type">${escapeHtml(c.dataType)}</span></td>
                      <td><span class="code">${escapeHtml(c.jsonType)}</span></td>
                      <td>${c.isNullable ? '<span class="schema-tag opt">Optional</span>' : '<span class="schema-tag req">Required</span>'}</td>
                    </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ` : ''}
            </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- SECTION 3: AI AGENT GUIDE & DATABASE RELATIONS -->
      <section id="aiAgentSec" class="sec-pane">
        <!-- Directive Card -->
        <div class="card" style="margin-bottom: 24px; border-left: 4px solid #a855f7;">
          <h3 style="font-size: 16px; margin-bottom: 6px; color: #c084fc;">🤖 AI Agent Directives & Workspace Protocol</h3>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">
            Protocol for AI coding assistants (Cursor, Windsurf, Claude Code, Antigravity, GitHub Copilot).
          </p>
          <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 14px; font-size: 13px; line-height: 1.6;">
            <div style="margin-bottom: 12px;">
              <strong style="color: #c084fc;">1. Workspace Isolation Directive:</strong><br>
              Always remind the user to start in a clean, dedicated folder before creating code:
              <pre style="margin-top: 6px; margin-bottom: 8px;"><code>mkdir eternalgy-ats-integration && cd eternalgy-ats-integration</code></pre>
            </div>
            <div style="margin-bottom: 12px;">
              <strong style="color: #c084fc;">2. Maintain Session Context & Discussion Memory:</strong><br>
              Instruct the user to create a <code>MEMORY.md</code> (or <code>.cursorrules</code>) file inside that folder. Log all key decisions, table relations, and API endpoints so future AI sessions retain full context without cross-polluting unrelated codebases.
            </div>
            <div>
              <strong style="color: #c084fc;">3. Gateway Architecture:</strong><br>
              Use this single API key for both internal PostgreSQL CRUD and external 3rd-party vendor APIs. Vendor secrets (like <code>calculator2026</code>) are automatically injected and cloaked by the gateway.
            </div>
          </div>
        </div>

        <!-- Relationships Card -->
        <div class="card" style="margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div>
              <h3 style="font-size: 16px; margin-bottom: 4px; color: #10b981;">🔗 Entity Relationships & Database Foreign Keys</h3>
              <p style="font-size: 12px; color: var(--text-muted);">
                Foreign key constraints and domain entity references across permitted PostgreSQL tables.
              </p>
            </div>
            <span class="badge healthy">${relationships.length} Relations</span>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Source Table & Field</th>
                  <th>Target Reference</th>
                  <th>Relation Type</th>
                  <th>Domain Meaning / Context</th>
                </tr>
              </thead>
              <tbody id="relationshipsTableBody">
                ${relationships.length === 0 ? `
                <tr><td colspan="4" style="text-align:center; padding: 16px; color: var(--text-muted)">No cross-table foreign key constraints defined for these tables.</td></tr>
                ` : relationships.map(r => `
                <tr>
                  <td style="font-weight: 600; font-family: var(--font-mono); font-size: 13px; color: #10b981;">
                    ${escapeHtml(r.sourceTable)}.<span style="color: #38bdf8;">${escapeHtml(r.sourceColumn)}</span>
                  </td>
                  <td style="font-family: var(--font-mono); font-size: 13px;">
                    👉 <b>${escapeHtml(r.targetTable)}</b>.${escapeHtml(r.targetColumn)}
                  </td>
                  <td>
                    <span class="badge ${r.type === 'foreign_key' ? 'healthy' : 'degraded'}">
                      ${r.type === 'foreign_key' ? 'Foreign Key (DB)' : 'Logical Reference'}
                    </span>
                  </td>
                  <td style="font-size: 12px; color: var(--text-muted);">
                    ${escapeHtml(r.description || 'Reference relation')}
                  </td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Ready-to-copy AI System Prompt -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <h3 style="font-size: 16px; margin-bottom: 4px;">📋 Pre-Formatted AI Agent System Prompt</h3>
              <p style="font-size: 12px; color: var(--text-muted);">
                Ready to copy into <code>.cursorrules</code>, custom instructions, or AI prompt chat.
              </p>
            </div>
            <button class="btn primary sm" onclick="copyAiPrompt()">Copy Full Prompt</button>
          </div>
          <pre id="aiSystemPromptBox" style="max-height: 420px; white-space: pre-wrap; font-size: 12px; font-family: var(--font-mono); color: #cbd5e1;"><code>${escapeHtml(aiPrompt)}</code></pre>
        </div>
      </section>

      <!-- SECTION 4: CODE SAMPLES & TESTER -->
      <section id="testerSec" class="sec-pane">
        <div class="card" style="margin-bottom: 24px;">
          <h3 style="font-size: 16px; margin-bottom: 12px;">Ready-to-Use Code Samples</h3>
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button class="code-tab-btn active" onclick="switchCodeSnippet('curl')">cURL</button>
            <button class="code-tab-btn" onclick="switchCodeSnippet('js')">JavaScript (Node / Browser)</button>
            <button class="code-tab-btn" onclick="switchCodeSnippet('python')">Python</button>
          </div>
          <pre id="activeSnippetCode" style="max-height: 350px;"><code># 1. List records from database
curl "${escapeHtml(host)}/v1/data/${escapeHtml(tables[0]?.table || 'product')}?limit=20&offset=0&sort=id&order=asc" \\
  -H "x-api-key: ${escapeHtml(keyToUse)}"

# 2. Retrieve single record by ID
curl "${escapeHtml(host)}/v1/data/${escapeHtml(tables[0]?.table || 'product')}/1" \\
  -H "x-api-key: ${escapeHtml(keyToUse)}"</code></pre>
        </div>

        <div class="card">
          <h3 style="font-size: 16px; margin-bottom: 12px;">Interactive Endpoint Tester</h3>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
            Execute live GET queries through the gateway using this key.
          </p>
          <div style="display: grid; grid-template-columns: 240px 1fr auto; gap: 8px; margin-bottom: 12px;">
            <select id="testTableSelect" class="form-select" style="font-size: 13px;" onchange="handleTestTargetChange()">
              ${proxyServices.some(p => p.id === 'calculator') ? `
                <option value="/v1/settings/ats-addon-price">🌐 ATAP Solar ATS Addon Price</option>
              ` : ''}
              ${tables.map(t => `<option value="${escapeHtml(t.table)}">Table: ${escapeHtml(t.table)}</option>`).join('')}
            </select>
            <input type="text" id="testQueryInput" class="form-input" value="limit=2" placeholder="Query params or payload" style="font-family: var(--font-mono); font-size: 13px;">
            <button class="btn primary" onclick="executeLiveTest()">Send Request</button>
          </div>
          <pre id="testResponseBox" style="max-height: 350px;">Click "Send Request" to test your query.</pre>
        </div>
      </section>
    </main>
  </div>

  <!-- Embedded Spec for Zero-Latency Instant Client Hydration -->
  <script id="initial-spec" type="application/json">
    ${JSON.stringify(data).replace(/</g, '\\u003c')}
  </script>

  <script>
    const INITIAL_DATA = JSON.parse(document.getElementById('initial-spec').textContent);
    let currentCodeLang = 'curl';

    document.addEventListener('DOMContentLoaded', () => {
      initSectionTabs();
    });

    function initSectionTabs() {
      const tabs = document.querySelectorAll('.sec-tab-btn');
      tabs.forEach(t => {
        t.addEventListener('click', () => {
          tabs.forEach(btn => btn.classList.remove('active'));
          document.querySelectorAll('.sec-pane').forEach(p => p.classList.remove('active'));

          t.classList.add('active');
          const target = t.getAttribute('data-sec');
          document.getElementById(target).classList.add('active');
        });
      });
    }

    function switchCodeSnippet(lang) {
      currentCodeLang = lang;
      document.querySelectorAll('.code-tab-btn').forEach(b => b.classList.remove('active'));
      event.currentTarget.classList.add('active');
      
      const host = INITIAL_DATA.host;
      const key = INITIAL_DATA.keyToUse;
      const tbl = INITIAL_DATA.tables[0] ? INITIAL_DATA.tables[0].table : 'product';
      let code = '';

      if (lang === 'curl') {
        code = \`# 1. List records with pagination
curl "\${host}/v1/data/\${tbl}?limit=20&offset=0&sort=id&order=asc" \\\\
  -H "x-api-key: \${key}"

# 2. Retrieve single record by ID
curl "\${host}/v1/data/\${tbl}/1" \\\\
  -H "x-api-key: \${key}"\`;
      } else if (lang === 'js') {
        code = \`// JavaScript / Node.js
async function fetch\${tbl}() {
  const response = await fetch("\${host}/v1/data/\${tbl}?limit=20", {
    headers: { "x-api-key": "\${key}" }
  });
  const json = await response.json();
  console.log(json);
}
fetch\${tbl}();\`;
      } else if (lang === 'python') {
        code = \`# Python requests
import requests

url = "\${host}/v1/data/\${tbl}"
headers = { "x-api-key": "\${key}" }
params = { "limit": 20 }

response = requests.get(url, headers=headers, params=params)
print(response.json())\`;
      }

      document.getElementById('activeSnippetCode').innerHTML = \`<code>\${escapeHtml(code)}</code>\`;
    }

    function handleTestTargetChange() {
      const val = document.getElementById('testTableSelect').value;
      const queryInput = document.getElementById('testQueryInput');
      if (val.startsWith('/')) {
        queryInput.value = '';
        queryInput.placeholder = 'Optional query params';
      } else {
        queryInput.value = 'limit=2';
        queryInput.placeholder = 'Query params (e.g. limit=5&sort=id)';
      }
    }

    async function executeLiveTest() {
      const target = document.getElementById('testTableSelect').value;
      const q = document.getElementById('testQueryInput').value.trim();
      const output = document.getElementById('testResponseBox');
      output.innerText = 'Executing query...';

      const keyToUse = INITIAL_DATA.keyToUse || prompt('Please enter your x-api-key to run test query:');
      if (!keyToUse) {
        output.innerText = 'Test aborted: No API Key provided.';
        return;
      }

      const targetUrl = target.startsWith('/')
        ? \`\${target}\${q ? (target.includes('?') ? '&' : '?') + q : ''}\`
        : \`/v1/data/\${target}?\${q}\`;

      try {
        const res = await fetch(targetUrl, {
          headers: { 'x-api-key': keyToUse }
        });
        const json = await res.json();
        output.innerText = JSON.stringify(json, null, 2);
      } catch (err) {
        output.innerText = 'Error: ' + err.message;
      }
    }

    function copyShareLink() {
      navigator.clipboard.writeText(window.location.href);
      alert('Dedicated Key Doc Link copied to clipboard!');
    }

    function copyAiPrompt() {
      const prompt = INITIAL_DATA.aiPrompt;
      navigator.clipboard.writeText(prompt);
      alert('AI Agent System Prompt copied! Paste it directly into Cursor, Windsurf, Claude Code, or your AI assistant chat.');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>
`;
}
