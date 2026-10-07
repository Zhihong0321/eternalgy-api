// Eternalgy API Gateway Admin UI Client

let adminSecret = localStorage.getItem('eter_admin_secret') || '';
let availableTables = [];
let availableProxies = [];
let allKeys = [];
let logInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTabs();
  fetchHealth();
  fetchTables();
  fetchProxies();
  loadKeys();
  loadLogs();
  loadDiagnostics();
});

function initAuth() {
  const secretInput = document.getElementById('adminSecretInput');
  if (adminSecret) {
    secretInput.value = adminSecret;
    document.getElementById('authStatusBadge').innerText = 'Admin Key Loaded';
    document.getElementById('authStatusBadge').className = 'badge healthy';
  } else {
    document.getElementById('authStatusBadge').innerText = 'No Key Set';
    document.getElementById('authStatusBadge').className = 'badge degraded';
  }

  secretInput.addEventListener('change', () => {
    adminSecret = secretInput.value.trim();
    localStorage.setItem('eter_admin_secret', adminSecret);
    document.getElementById('authStatusBadge').innerText = adminSecret ? 'Admin Key Loaded' : 'No Key Set';
    document.getElementById('authStatusBadge').className = adminSecret ? 'badge healthy' : 'badge degraded';
    fetchTables();
    fetchProxies();
    loadKeys();
    loadLogs();
    loadDiagnostics();
  });
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-secret': adminSecret,
  };
}

// Tab navigation
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.getElementById(target).classList.add('active');

      if (target === 'proxiesTab') {
        fetchProxies();
      }

      if (target === 'logsTab') {
        loadLogs();
        startLogPolling();
      } else {
        stopLogPolling();
      }

      if (target === 'debugTab') {
        loadDiagnostics();
      }
    });
  });
}

// Fetch Health
async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const badge = document.getElementById('healthBadge');
    if (data.status === 'healthy') {
      badge.className = 'badge healthy';
      badge.innerHTML = `<span class="status-dot"></span> PostgreSQL Connected (${data.database.latencyMs}ms)`;
    } else {
      badge.className = 'badge degraded';
      badge.innerHTML = `<span class="status-dot"></span> Degraded: ${data.database.error || 'DB Down'}`;
    }
  } catch (err) {
    const badge = document.getElementById('healthBadge');
    badge.className = 'badge degraded';
    badge.innerHTML = `<span class="status-dot"></span> Gateway Unreachable`;
  }
}

// Fetch available tables from PostgreSQL schema
async function fetchTables() {
  if (!adminSecret) return;
  try {
    const res = await fetch('/api/admin/tables', { headers: getHeaders() });
    if (res.ok) {
      const data = await res.json();
      availableTables = data.tables || [];
      renderTableSelectors();
    }
  } catch (err) {
    console.error('Failed to fetch tables', err);
  }
}

// Fetch 3rd-Party Proxy Services
async function fetchProxies() {
  if (!adminSecret) return;
  try {
    const res = await fetch('/api/admin/proxy-services', { headers: getHeaders() });
    if (res.ok) {
      const data = await res.json();
      availableProxies = data.services || [];
      renderProxiesTable(availableProxies);
      renderProxySelectors();
    }
  } catch (err) {
    console.error('Failed to fetch proxy services', err);
  }
}

// Render Proxy Services Table
function renderProxiesTable(services) {
  const tbody = document.getElementById('proxiesTableBody');
  const statTotal = document.getElementById('statTotalProxies');
  const statActive = document.getElementById('statActiveProxies');

  if (statTotal) statTotal.innerText = services.length;
  if (statActive) statActive.innerText = services.filter((s) => s.isActive).length;

  if (!tbody) return;

  if (services.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px; color: var(--text-muted)">No 3rd-party APIs registered. Click "+ Register 3rd-Party API" to add one.</td></tr>`;
    return;
  }

  tbody.innerHTML = services
    .map((s) => {
      const headersSummary = Object.entries(s.headers || {})
        .map(([k, v]) => `<div><span class="code">${k}</span>: <code>${v}</code></div>`)
        .join('');

      return `
      <tr>
        <td>
          <span class="code" style="color: #38bdf8; font-weight: 600;">${escapeHtml(s.id)}</span>
        </td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(s.name)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(s.description || '')}</div>
        </td>
        <td>
          <a href="${s.baseUrl}" target="_blank" style="color: #60a5fa; text-decoration: none; font-family: var(--font-mono); font-size: 12px;">${escapeHtml(s.baseUrl)}</a>
        </td>
        <td style="font-size: 12px;">
          ${headersSummary || '<span style="color: var(--text-muted)">None (Public)</span>'}
        </td>
        <td>
          <span class="badge ${s.isActive ? 'healthy' : 'degraded'}">${s.isActive ? 'Active' : 'Disabled'}</span>
        </td>
        <td>
          <button class="btn sm" style="color: var(--danger);" onclick="deleteProxyService('${s.id}')">Delete</button>
        </td>
      </tr>
    `;
    })
    .join('');
}

// Render dynamic proxy selectors in Create Modal
function renderProxySelectors() {
  const container = document.getElementById('proxyRulesContainer');
  if (!container) return;

  if (availableProxies.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px;">No 3rd-party proxy services registered yet.</div>`;
    return;
  }

  container.innerHTML = availableProxies
    .map(
      (s) => `
    <div class="table-rule-row proxy-rule-row" style="margin-bottom: 8px;">
      <div class="table-rule-header">
        <label class="checkbox-label" style="font-weight: 600; color: #38bdf8;">
          <input type="checkbox" class="proxy-enable" data-service="${s.id}" onchange="toggleProxyRuleInputs('${s.id}', this.checked)">
          ${escapeHtml(s.name)} <span class="code" style="font-size: 11px;">${s.id}</span>
        </label>
        <div class="checkbox-group" id="proxy_methods_${s.id}" style="opacity: 0.4; pointer-events: none;">
          <label class="checkbox-label"><input type="checkbox" class="pact-get" checked> GET</label>
          <label class="checkbox-label"><input type="checkbox" class="pact-post" checked> POST</label>
          <label class="checkbox-label"><input type="checkbox" class="pact-put" checked> PUT</label>
          <label class="checkbox-label"><input type="checkbox" class="pact-patch" checked> PATCH</label>
          <label class="checkbox-label"><input type="checkbox" class="pact-delete" checked> DELETE</label>
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

function toggleProxyRuleInputs(slug, enabled) {
  const methodsGroup = document.getElementById(`proxy_methods_${slug}`);
  if (methodsGroup) {
    methodsGroup.style.opacity = enabled ? '1' : '0.4';
    methodsGroup.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

// Load and render keys
async function loadKeys() {
  if (!adminSecret) {
    document.getElementById('keysTableBody').innerHTML = `
      <tr><td colspan="8" style="text-align:center; padding: 30px; color: var(--text-muted)">
        Enter your <b>x-admin-secret</b> in the top right header to load API Keys.
      </td></tr>`;
    return;
  }

  try {
    const res = await fetch('/api/admin/keys', { headers: getHeaders() });
    if (!res.ok) {
      document.getElementById('keysTableBody').innerHTML = `
        <tr><td colspan="8" style="text-align:center; padding: 30px; color: var(--danger)">
          Unauthorized. Check your admin secret.
        </td></tr>`;
      return;
    }

    const data = await res.json();
    allKeys = data.keys || [];
    document.getElementById('statTotalKeys').innerText = allKeys.length;
    document.getElementById('statActiveKeys').innerText = allKeys.filter((k) => k.isActive).length;

    renderKeysTable(allKeys);
  } catch (err) {
    console.error('Failed to load keys', err);
  }
}

function renderKeysTable(keys) {
  const tbody = document.getElementById('keysTableBody');
  if (keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 30px; color: var(--text-muted)">No API Keys configured. Click "+ Create API Key" to add one.</td></tr>`;
    return;
  }

  tbody.innerHTML = keys
    .map((k) => {
      const tableCount = k.allowedTables ? k.allowedTables.length : Object.keys(k.tables || {}).length;
      const tablesList = (k.allowedTables || Object.keys(k.tables || {}))
        .slice(0, 3)
        .map((t) => `<span class="code">${t}</span>`)
        .join(' ');
      const moreTablesBadge = tableCount > 3 ? `<span class="code">+${tableCount - 3}</span>` : '';

      const proxyKeys = Object.keys(k.proxies || {});
      const proxiesList = proxyKeys.length > 0
        ? proxyKeys.map((p) => `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">${p}</span>`).join(' ')
        : '<span style="color: var(--text-muted); font-size: 12px;">None</span>';

      return `
      <tr>
        <td>
          <div style="font-weight: 600;">${escapeHtml(k.name)}</div>
          <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${k.id}</div>
        </td>
        <td>
          <span class="code">${escapeHtml(k.maskedApiKey)}</span>
        </td>
        <td>
          <label class="switch">
            <input type="checkbox" ${k.isActive ? 'checked' : ''} onchange="toggleKeyStatus('${k.id}', this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td>
          <span style="font-weight: 600;">${k.rateLimitRpm}</span> <span style="font-size: 11px; color: var(--text-muted);">rpm</span>
        </td>
        <td>
          <div style="display:flex; gap: 4px; align-items: center; flex-wrap: wrap;">
            ${tablesList || '<span style="color: var(--text-muted); font-size: 12px;">None</span>'} ${moreTablesBadge}
          </div>
        </td>
        <td>
          <div style="display:flex; gap: 4px; align-items: center; flex-wrap: wrap;">
            ${proxiesList}
          </div>
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">
          ${k.lastUsedAt ? formatTime(k.lastUsedAt) : 'Never'}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn sm" onclick="openKeyDocs('${k.id}')" title="Interactive Docs Portal">Docs</button>
            <button class="btn sm" onclick="copyKeyDocLink('${k.id}')" title="Copy shareable link">Link</button>
            <button class="btn sm" onclick="viewPermissions('${k.id}')">Rules</button>
            <button class="btn sm" style="color: var(--danger);" onclick="deleteKey('${k.id}')">Revoke</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

// Toggle key active state
async function toggleKeyStatus(id, isActive) {
  try {
    const res = await fetch(`/api/admin/keys/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) alert('Failed to update status');
    loadKeys();
  } catch (err) {
    alert('Error updating status: ' + err.message);
  }
}

// Delete key
async function deleteKey(id) {
  if (!confirm(`Are you sure you want to permanently revoke API Key '${id}'? This cannot be undone.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/keys/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) alert('Failed to delete key');
    loadKeys();
  } catch (err) {
    alert('Error deleting key: ' + err.message);
  }
}

// Delete 3rd-Party Proxy Service
async function deleteProxyService(id) {
  if (!confirm(`Are you sure you want to remove 3rd-party proxy service '${id}'? Existing keys will no longer be able to route to it.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/proxy-services/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) alert('Failed to remove proxy service');
    fetchProxies();
  } catch (err) {
    alert('Error removing proxy service: ' + err.message);
  }
}

// Register new 3rd-party proxy service
async function handleRegisterProxy(e) {
  e.preventDefault();
  const id = document.getElementById('proxySlugInput').value.trim();
  const name = document.getElementById('proxyNameInput').value.trim();
  const baseUrl = document.getElementById('proxyBaseUrlInput').value.trim();
  const headerKey = document.getElementById('proxyHeaderKeyInput').value.trim();
  const headerVal = document.getElementById('proxyHeaderValInput').value.trim();
  const desc = document.getElementById('proxyDescInput').value.trim();

  const headers = {};
  if (headerKey && headerVal) {
    headers[headerKey] = headerVal;
  }

  try {
    const res = await fetch('/api/admin/proxy-services', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        id,
        name,
        baseUrl,
        headers,
        description: desc || undefined,
        isActive: true,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    closeModal('registerProxyModal');
    // Clear form
    document.getElementById('proxySlugInput').value = '';
    document.getElementById('proxyNameInput').value = '';
    document.getElementById('proxyBaseUrlInput').value = '';
    document.getElementById('proxyHeaderValInput').value = '';
    document.getElementById('proxyDescInput').value = '';

    fetchProxies();
    alert(`3rd-Party API '${name}' registered successfully!`);
  } catch (err) {
    alert('Failed to register service: ' + err.message);
  }
}

// View permissions modal
function viewPermissions(id) {
  const key = allKeys.find((k) => k.id === id);
  if (!key) return;

  document.getElementById('viewPermTitle').innerText = `${key.name} (${key.id})`;
  const fullRules = {
    databaseTables: key.tables || {},
    proxyServices: key.proxies || {},
  };
  document.getElementById('viewPermContent').innerText = JSON.stringify(fullRules, null, 2);
  openModal('viewPermModal');
}

// Render dynamic table selectors in Create Modal
function renderTableSelectors() {
  const container = document.getElementById('tableRulesContainer');
  if (availableTables.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px;">Loading database tables...</div>`;
    return;
  }

  container.innerHTML = availableTables
    .map(
      (tbl) => `
    <div class="table-rule-row">
      <div class="table-rule-header">
        <label class="checkbox-label" style="font-weight: 600;">
          <input type="checkbox" class="tbl-enable" data-table="${tbl}" onchange="toggleTableRuleInputs('${tbl}', this.checked)">
          ${tbl}
        </label>
        <div class="checkbox-group" id="actions_${tbl}" style="opacity: 0.4; pointer-events: none;">
          <label class="checkbox-label"><input type="checkbox" class="act-read" checked> Read</label>
          <label class="checkbox-label"><input type="checkbox" class="act-create"> Create</label>
          <label class="checkbox-label"><input type="checkbox" class="act-update"> Update</label>
          <label class="checkbox-label"><input type="checkbox" class="act-delete"> Delete</label>
        </div>
      </div>
      <div id="cols_${tbl}" style="display: none; margin-top: 8px;">
        <input type="text" class="form-input col-whitelist" placeholder="Allowed columns (optional comma-separated, e.g. id,name,price)" style="font-size: 12px; padding: 6px 10px;">
      </div>
    </div>
  `
    )
    .join('');
}

function toggleTableRuleInputs(tbl, enabled) {
  const actionsGroup = document.getElementById(`actions_${tbl}`);
  const colsGroup = document.getElementById(`cols_${tbl}`);
  if (enabled) {
    actionsGroup.style.opacity = '1';
    actionsGroup.style.pointerEvents = 'auto';
    colsGroup.style.display = 'block';
  } else {
    actionsGroup.style.opacity = '0.4';
    actionsGroup.style.pointerEvents = 'none';
    colsGroup.style.display = 'none';
  }
}

// Create new key handler
async function handleCreateKey(e) {
  e.preventDefault();
  const name = document.getElementById('newKeyName').value.trim();
  const rpm = Number(document.getElementById('newKeyRpm').value) || 120;
  const customKey = document.getElementById('newCustomKey').value.trim() || undefined;

  // 1. Collect table permissions
  const tables = {};
  const rows = document.querySelectorAll('.table-rule-row:not(.proxy-rule-row)');
  rows.forEach((row) => {
    const enableCheck = row.querySelector('.tbl-enable');
    if (enableCheck && enableCheck.checked) {
      const tbl = enableCheck.getAttribute('data-table');
      const actions = [];
      if (row.querySelector('.act-read').checked) actions.push('read');
      if (row.querySelector('.act-create').checked) actions.push('create');
      if (row.querySelector('.act-update').checked) actions.push('update');
      if (row.querySelector('.act-delete').checked) actions.push('delete');

      const colsVal = row.querySelector('.col-whitelist').value.trim();
      const allowedColumns = colsVal ? colsVal.split(',').map((c) => c.trim()).filter(Boolean) : undefined;

      tables[tbl] = {
        actions: actions.length > 0 ? actions : ['read'],
        allowedColumns,
      };
    }
  });

  // 2. Collect 3rd-party proxy permissions
  const proxies = {};
  const proxyRows = document.querySelectorAll('.proxy-rule-row');
  proxyRows.forEach((row) => {
    const enableCheck = row.querySelector('.proxy-enable');
    if (enableCheck && enableCheck.checked) {
      const slug = enableCheck.getAttribute('data-service');
      const methods = [];
      if (row.querySelector('.pact-get').checked) methods.push('GET');
      if (row.querySelector('.pact-post').checked) methods.push('POST');
      if (row.querySelector('.pact-put').checked) methods.push('PUT');
      if (row.querySelector('.pact-patch').checked) methods.push('PATCH');
      if (row.querySelector('.pact-delete').checked) methods.push('DELETE');

      proxies[slug] = {
        methods: methods.length > 0 ? methods : undefined,
      };
    }
  });

  if (Object.keys(tables).length === 0 && Object.keys(proxies).length === 0) {
    alert('Please select at least one database table OR one 3rd-party proxy service to authorize for this API key.');
    return;
  }

  try {
    const res = await fetch('/api/admin/keys', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name,
        apiKey: customKey,
        rateLimitRpm: rpm,
        tables,
        proxies,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    closeModal('createKeyModal');
    loadKeys();

    // Show created secret modal
    const keySecret = data.key.apiKey;
    document.getElementById('createdKeySecret').value = keySecret;
    const docUrl = `${window.location.origin}/docs/keys/${data.key.id}?secret=${encodeURIComponent(keySecret)}`;
    document.getElementById('createdDocUrl').value = docUrl;
    document.getElementById('createdDocOpenLink').href = docUrl;

    openModal('keyCreatedSuccessModal');
  } catch (err) {
    alert('Failed to create key: ' + err.message);
  }
}

function copyKeyDocLink(id) {
  const url = `${window.location.origin}/docs/keys/${id}`;
  navigator.clipboard.writeText(url);
  alert(`Dedicated Key Documentation Link copied:\n${url}`);
}

function openKeyDocs(id) {
  window.open(`/docs/keys/${id}`, '_blank');
}

// Live Audit Logs
async function loadLogs() {
  if (!adminSecret) return;
  try {
    const filter = document.getElementById('logStatusFilter').value;
    const res = await fetch('/api/admin/audit-logs?limit=50', { headers: getHeaders() });
    if (!res.ok) return;

    const data = await res.json();
    let logs = data.logs || [];

    if (filter === '2xx') logs = logs.filter((l) => l.statusCode >= 200 && l.statusCode < 300);
    if (filter === '4xx') logs = logs.filter((l) => l.statusCode >= 400 && l.statusCode < 500);
    if (filter === '5xx') logs = logs.filter((l) => l.statusCode >= 500);

    renderLogsTable(logs);
  } catch (err) {
    console.error('Failed to load logs', err);
  }
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logsTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--text-muted)">No audit logs recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs
    .map((l) => {
      let statusClass = 'healthy';
      if (l.statusCode >= 400 && l.statusCode < 500) statusClass = 'warning';
      if (l.statusCode >= 500) statusClass = 'degraded';

      return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${formatTime(l.timestamp)}</td>
        <td><span class="badge ${statusClass}">${l.statusCode}</span></td>
        <td><span class="code">${l.method}</span></td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(l.url)}</td>
        <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);">${escapeHtml(l.keyId || 'anonymous')}</td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${l.durationMs}ms</td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${escapeHtml(l.ip)}</td>
      </tr>
    `;
    })
    .join('');
}

function startLogPolling() {
  if (logInterval) clearInterval(logInterval);
  logInterval = setInterval(loadLogs, 3000);
}

function stopLogPolling() {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
}

// Diagnostics
async function loadDiagnostics() {
  if (!adminSecret) return;
  try {
    const res = await fetch('/api/debug/diagnostics', { headers: getHeaders() });
    if (!res.ok) return;

    const data = await res.json();
    document.getElementById('diagUptime').innerText = `${Math.floor(data.uptimeSeconds / 60)} mins`;
    document.getElementById('diagMemory').innerText = `${data.processMemory.heapUsedMb} MB / ${data.processMemory.rssMb} MB`;
    document.getElementById('diagPool').innerText = `${data.databasePool.idleCount} idle / ${data.databasePool.totalCount} total`;

    document.getElementById('diagRawJson').innerText = JSON.stringify(data, null, 2);
  } catch (err) {
    console.error('Failed to load diagnostics', err);
  }
}

// Query EXPLAIN tool
async function handleRunExplain() {
  const sql = document.getElementById('explainSqlInput').value.trim();
  if (!sql) return;

  const out = document.getElementById('explainResultOutput');
  out.innerText = 'Executing PostgreSQL EXPLAIN ANALYZE...';

  try {
    const res = await fetch('/api/debug/explain', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ sql }),
    });

    const data = await res.json();
    if (!res.ok) {
      out.innerText = `Error: ${data.message}`;
      return;
    }

    out.innerText = JSON.stringify(data.plan, null, 2);
  } catch (err) {
    out.innerText = `Network error: ${err.message}`;
  }
}

// Modal helpers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.select();
  navigator.clipboard.writeText(el.value);
  alert('Copied to clipboard!');
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
