(() => {
  const KEY = 'ufc_admin_key';
  const state = { overview: null, editable: {}, entity: null };

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const key = () => sessionStorage.getItem(KEY) || '';

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'x-admin-key': key() }, opts.headers || {});
    if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    return data;
  }

  function setLocked() {
    const ok = !!key();
    $('lockState').textContent = ok ? 'Unlocked' : 'Locked';
    $('lockState').classList.toggle('ok', ok);
    $('adminKey').value = key();
  }

  function table(headers, rows) {
    const wrap = el('div', 'table-wrap');
    const t = el('table');
    const thead = el('thead');
    const tr = el('tr');
    headers.forEach(h => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    const tbody = el('tbody');
    rows.forEach(cells => {
      const r = el('tr');
      cells.forEach(cell => {
        const td = el('td');
        if (cell instanceof Node) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    t.append(thead, tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function pill(text, kind) {
    return el('span', `pill ${kind || ''}`, text);
  }

  function renderStatus(overview) {
    const host = $('statusStrip');
    host.replaceChildren();
    const stats = overview.db || {};
    const items = [
      ['Fighters', stats.fighters],
      ['Events', stats.events],
      ['Fights', stats.fights],
      ['Pending', (overview.queue_counts || {}).pending || 0],
      ['Latest Audit', overview.latest_run_id || 'none'],
      ['Backend', stats.backend || stats.dbPath || 'local'],
    ];
    items.forEach(([label, value]) => {
      const card = el('div', 'stat');
      card.append(el('div', 'stat__label', label), el('div', 'stat__value', value == null ? '--' : value));
      host.appendChild(card);
    });
  }

  function renderOverview(data) {
    state.overview = data;
    state.editable = data.editable || {};
    renderStatus(data);
    renderEditableTables();

    const worstRows = (data.worst_coverage || []).map(r => [
      r.table_name, r.column_name, r.scope, `${Math.round(Number(r.coverage_pct) * 1000) / 10}%`,
      `${r.non_null_rows}/${r.total_rows}`,
    ]);
    $('worstCoverage').replaceChildren(
      worstRows.length ? table(['Table', 'Column', 'Scope', 'Coverage', 'Rows'], worstRows) : el('div', 'muted', 'No coverage data yet.')
    );

    const regRows = (data.regressions || []).map(r => [
      r.table_name, r.column_name, r.scope, `${Math.round(Number(r.delta) * 1000) / 10}%`,
    ]);
    $('regressions').replaceChildren(
      regRows.length ? table(['Table', 'Column', 'Scope', 'Delta'], regRows) : el('div', 'muted', 'No regressions in last two complete runs.')
    );
  }

  async function loadOverview() {
    const data = await api('/api/admin/data/overview');
    renderOverview(data);
  }

  function renderIssueSection(host, title, rows, headers, mapper) {
    host.appendChild(el('h2', null, title));
    host.appendChild(rows.length ? table(headers, rows.map(mapper)) : el('div', 'muted', 'None.'));
  }

  async function loadIssues() {
    const data = await api('/api/admin/data/issues');
    const host = $('issuesBody');
    host.replaceChildren();
    renderIssueSection(host, 'Failed or Partial Audit Runs', data.failed_runs || [],
      ['Run', 'Status', 'Started', 'Trigger'], r => [r.run_id, r.status, r.started_at, r.trigger_source]);
    renderIssueSection(host, 'Coverage Regressions', data.regressions || [],
      ['Table', 'Column', 'Scope', 'Delta'], r => [r.table_name, r.column_name, r.scope, `${Math.round(Number(r.delta) * 1000) / 10}%`]);
    renderIssueSection(host, 'Low Coverage', data.low_coverage || [],
      ['Table', 'Column', 'Scope', 'Coverage'], r => [r.table_name, r.column_name, r.scope, `${Math.round(Number(r.coverage_pct) * 1000) / 10}%`]);
  }

  function renderQueue(rows) {
    const host = $('queueBody');
    host.replaceChildren();
    if (!rows.length) {
      host.appendChild(el('div', 'muted', 'Queue empty for this status.'));
      return;
    }
    rows.forEach(row => {
      const card = el('div', 'queue-card');
      const top = el('div', 'queue-card__top');
      top.append(el('strong', null, `${row.table_name}.${row.column_name} #${row.row_id}`), pill(row.status, row.status === 'pending' ? 'warn' : 'good'));
      card.appendChild(top);
      [
        ['Current', row.current_value == null ? 'NULL' : row.current_value],
        ['Proposed', row.proposed_value],
        ['Source', row.source_url ? `${row.source} ${row.source_url}` : row.source],
        ['Reason', row.reason || ''],
      ].forEach(([k, v]) => {
        const kv = el('div', 'kv');
        kv.append(el('b', null, k), el('span', null, v));
        card.appendChild(kv);
      });
      const actions = el('div', 'queue-actions');
      const open = el('button', null, 'Open Entity');
      open.addEventListener('click', () => {
        activateView('editor');
        $('entityTable').value = row.table_name;
        $('entityId').value = row.row_id;
        loadEntity();
      });
      actions.appendChild(open);
      if (row.status === 'pending') {
        const approve = el('button', null, 'Approve');
        approve.addEventListener('click', () => approveQueue(row.id));
        const reject = el('button', 'danger', 'Reject');
        reject.addEventListener('click', () => rejectQueue(row.id));
        actions.append(approve, reject);
      }
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  async function loadQueue() {
    renderQueue(await api(`/api/admin/data/backfill/queue?status=${encodeURIComponent($('queueStatus').value)}&limit=100`));
  }

  async function approveQueue(id) {
    const reason = prompt('Reason for approval?', 'Reviewed in local admin portal');
    if (reason === null) return;
    await api(`/api/admin/data/backfill/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
    toast('Approved and pushed.');
    await loadQueue();
    await loadOverview();
  }

  async function rejectQueue(id) {
    const reason = prompt('Reason for rejection?', 'Rejected in local admin portal');
    if (reason === null) return;
    await api(`/api/admin/data/backfill/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
    toast('Rejected.');
    await loadQueue();
  }

  function renderEditableTables() {
    const select = $('entityTable');
    select.replaceChildren();
    Object.keys(state.editable).forEach(name => {
      const o = el('option', null, name);
      o.value = name;
      select.appendChild(o);
    });
  }

  async function loadEntity() {
    const tableName = $('entityTable').value;
    const id = $('entityId').value.trim();
    if (!tableName || !id) return toast('Table and key are required.');
    const data = await api(`/api/admin/data/entity?table=${encodeURIComponent(tableName)}&id=${encodeURIComponent(id)}`);
    state.entity = data;
    renderEntity(data);
  }

  function renderEntity(data) {
    const host = $('entityBody');
    host.replaceChildren();
    const form = el('div', 'entity-form');
    const fields = ((data.editable || {}).fields || []);
    fields.forEach(name => {
      const label = el('label', null, name);
      const input = el('input');
      input.dataset.field = name;
      input.value = data.row[name] == null ? '' : String(data.row[name]);
      label.appendChild(input);
      form.appendChild(label);
    });
    const reason = el('label', null, 'Reason');
    const reasonInput = el('textarea');
    reasonInput.id = 'entityReason';
    reasonInput.rows = 3;
    reasonInput.placeholder = 'Required for every manual edit';
    reason.appendChild(reasonInput);
    const actions = el('div', 'entity-actions');
    const save = el('button', null, 'Push Changes');
    save.addEventListener('click', saveEntity);
    actions.appendChild(save);
    host.append(form, reason, actions);
  }

  async function saveEntity() {
    if (!state.entity) return;
    const changes = {};
    document.querySelectorAll('#entityBody [data-field]').forEach(input => {
      const before = state.entity.row[input.dataset.field] == null ? '' : String(state.entity.row[input.dataset.field]);
      if (input.value !== before) changes[input.dataset.field] = input.value;
    });
    if (!Object.keys(changes).length) return toast('No changes to push.');
    const reason = $('entityReason').value.trim();
    if (!reason) return toast('Reason is required.');
    const result = await api('/api/admin/data/entity', {
      method: 'PATCH',
      body: JSON.stringify({ table: state.entity.table, id: state.entity.id, changes, reason }),
    });
    toast(`Pushed ${result.changed.length} field(s).`);
    state.entity.row = result.after;
    renderEntity(state.entity);
    await loadOverview();
  }

  function printOps(data) {
    $('opsOutput').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  async function op(name) {
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    let result;
    if (name === 'runAudit') result = await post('/api/admin/data/audit/run', { scope: $('auditScope').value.trim() || null });
    if (name === 'runBackfillDry') result = await post('/api/admin/data/backfill/run', { dryRun: true });
    if (name === 'runBackfillApply') result = await post('/api/admin/data/backfill/run', { dryRun: false });
    if (name === 'saveDb') result = await post('/api/admin/save');
    if (name === 'importSeed') result = await post('/api/admin/import-seed');
    if (name === 'reconcileAll') result = await post('/api/admin/reconcile-all-picks');
    if (name === 'reconcileEvent') {
      const id = $('reconcileEventId').value.trim();
      if (!id) return toast('Event ID is required.');
      result = await post(`/api/admin/events/${encodeURIComponent(id)}/reconcile-picks`);
    }
    printOps(result);
    toast('Operation complete.');
    await loadOverview();
  }

  async function loadActions() {
    const rows = await api('/api/admin/data/actions?limit=100');
    $('actionsBody').replaceChildren(table(
      ['Time', 'Action', 'Target', 'Status', 'Reason'],
      rows.map(r => [r.created_at, r.action, [r.target_table, r.target_key, r.target_column].filter(Boolean).join(' / '), r.status, r.reason || ''])
    ));
  }

  function activateView(name) {
    document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
    if (name === 'issues') loadIssues().catch(e => toast(e.message));
    if (name === 'queue') loadQueue().catch(e => toast(e.message));
    if (name === 'history') loadActions().catch(e => toast(e.message));
  }

  function bind() {
    $('saveKeyBtn').addEventListener('click', async () => {
      sessionStorage.setItem(KEY, $('adminKey').value.trim());
      setLocked();
      try { await loadOverview(); toast('Unlocked.'); } catch (e) { toast(e.message); }
    });
    $('clearKeyBtn').addEventListener('click', () => {
      sessionStorage.removeItem(KEY);
      setLocked();
      toast('Key cleared.');
    });
    document.querySelectorAll('.admin-tabs button').forEach(btn => btn.addEventListener('click', () => activateView(btn.dataset.view)));
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        if (a === 'refresh') return loadOverview().catch(e => toast(e.message));
        if (a === 'loadIssues') return loadIssues().catch(e => toast(e.message));
        if (a === 'loadQueue') return loadQueue().catch(e => toast(e.message));
        if (a === 'loadActions') return loadActions().catch(e => toast(e.message));
        return op(a).catch(e => { printOps(e.message); toast(e.message); });
      });
    });
    $('loadEntityBtn').addEventListener('click', () => loadEntity().catch(e => toast(e.message)));
  }

  bind();
  setLocked();
  if (key()) loadOverview().catch(e => toast(e.message));
})();
