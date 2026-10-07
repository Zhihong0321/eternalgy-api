// Eternalgy API Gateway Admin UI Client

let adminSecret = localStorage.getItem('eter_admin_secret') || '';
let availableTables = [];
let allKeys = [];
let logInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTabs();
  fetchHealth();
  fetchTables();
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

// Load and render keys
async function loadKeys() {
  if (!adminSecret) {
    document.getElementById('keysTableBody').innerHTML = `
      <tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--text-muted)">
        Enter your <b>x-admin-secret</b> in the top right header to load API Keys.
      </td></tr>`;
    return;
  }

  try {
    const res = await fetch('/api/admin/keys', { headers: getHeaders() });
    if (!res.ok) {
      document.getElementById('keysTableBody').innerHTML = `
        <tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--danger)">
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--text-muted)">No API Keys configured. Click "+ Create API Key" to add one.</td></tr>`;
    return;
  }

  tbody.innerHTML = keys
    .map((k) => {
      const tableCount = k.allowedTables ? k.allowedTables.length : Object.keys(k.tables || {}).length;
      const tablesList = (k.allowedTables || Object.keys(k.tables || {}))
        .slice(0, 3)
        .map((t) => `<span class="code">${t}</span>`)
        .join(' ');
      const moreBadge = tableCount > 3 ? `<span class="code">+${tableCount - 3}</span>` : '';

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
            ${tablesList} ${moreBadge}
          </div>
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">
          ${k.lastUsedAt ? formatTime(k.lastUsedAt) : 'Never'}
        </td>
        <td>
          <div style="display:flex; gap: 6px; flex-wrap: wrap;">
            <a href="/docs/keys/${k.id}" target="_blank" class="btn sm primary">📄 Dedicated Doc</a>
            <button class="btn sm" onclick="copyKeyDocLink('${k.id}')">Copy Link</button>
            <button class="btn sm" onclick="viewPermissions('${k.id}')">Inspect</button>
            <button class="btn sm danger" onclick="deleteKey('${k.id}')">Revoke</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

// Toggle key active/inactive status
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

// View permissions modal
function viewPermissions(id) {
  const key = allKeys.find((k) => k.id === id);
  if (!key) return;

  document.getElementById('viewPermTitle').innerText = `${key.name} (${key.id})`;
  document.getElementById('viewPermContent').innerText = JSON.stringify(key.tables, null, 2);
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

  const tables = {};
  const rows = document.querySelectorAll('.table-rule-row');
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

  if (Object.keys(tables).length === 0) {
    alert('Please select at least one table to authorize for this API key.');
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

// Audit Logs
async function loadLogs() {
  if (!adminSecret) return;
  try {
    const statusFilter = document.getElementById('logStatusFilter').value;
    let url = '/api/admin/audit-logs?limit=100';
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) return;

    const data = await res.json();
    let logs = data.logs || [];

    if (statusFilter === '2xx') logs = logs.filter((l) => l.statusCode >= 200 && l.statusCode < 300);
    if (statusFilter === '4xx') logs = logs.filter((l) => l.statusCode >= 400 && l.statusCode < 500);
    if (statusFilter === '5xx') logs = logs.filter((l) => l.statusCode >= 500);

    const tbody = document.getElementById('logsTableBody');
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted)">No logs recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs
      .map((l) => {
        let statusClass = 's2xx';
        if (l.statusCode >= 400 && l.statusCode < 500) statusClass = 's4xx';
        if (l.statusCode >= 500) statusClass = 's5xx';

        return `
        <tr>
          <td style="color: var(--text-muted); font-size: 12px;">${formatTime(l.timestamp)}</td>
          <td><span class="method ${l.method.toLowerCase()}">${l.method}</span></td>
          <td><span class="status-code ${statusClass}">${l.statusCode}</span></td>
          <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(l.url)}</td>
          <td><span class="code">${escapeHtml(l.keyId || 'anonymous')}</span></td>
          <td>${l.durationMs}ms</td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load logs', err);
  }
}

function startLogPolling() {
  if (logInterval) clearInterval(logInterval);
  logInterval = setInterval(loadLogs, 3000);
}

function stopLogPolling() {
  if (logInterval) clearInterval(logInterval);
  logInterval = null;
}

// Diagnostics
async function loadDiagnostics() {
  if (!adminSecret) return;
  try {
    const res = await fetch('/api/debug/diagnostics', { headers: getHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('diagUptime').innerText = `${Math.floor(data.system.uptimeSeconds / 60)} mins`;
    document.getElementById('diagMemory').innerText = `${data.system.memory.rssMb} MB RSS (${data.system.memory.heapUsedMb} MB Heap)`;
    document.getElementById('diagPool').innerText = `${data.database.pool.totalCount} active / ${data.database.pool.idleCount} idle (max ${data.database.pool.maxConnections})`;
    document.getElementById('diagRawJson').innerText = JSON.stringify(data, null, 2);
  } catch (err) {
    console.error('Failed to load diagnostics', err);
  }
}

// Run Query Explain
async function handleRunExplain() {
  const sql = document.getElementById('explainSqlInput').value.trim();
  if (!sql) return;

  try {
    const res = await fetch('/api/debug/explain', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();
    document.getElementById('explainResultOutput').innerText = JSON.stringify(data.plan || data, null, 2);
  } catch (err) {
    document.getElementById('explainResultOutput').innerText = 'Error: ' + err.message;
  }
}

// Modal helpers
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function copyToClipboard(elementId) {
  const copyText = document.getElementById(elementId);
  copyText.select();
  navigator.clipboard.writeText(copyText.value);
  alert('Copied to clipboard!');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
