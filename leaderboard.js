// The browser submits evaluation references, never scores. The evaluator owns
// validation and ranking updates; see leaderboard_frontend_contract.md.
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const storageKey = 'react-manip.leaderboard.connection';
  const defaultBoard = $('meta[name="leaderboard-id"]')?.content || 'react-manip-season-2026';
  const demoMode = window.REACT_MANIP_LEADERBOARD_DEMO === true;
  const configuredApi = ($('meta[name="leaderboard-api"]')?.content || window.REACT_MANIP_LEADERBOARD_API || '').trim().replace(/\/+$/, '');
  const fixedApi = demoMode ? '' : configuredApi;
  const demoApi = String(window.REACT_MANIP_LEADERBOARD_DEMO_API || window.REACT_MANIP_DEMO_API || '').trim().replace(/\/+$/, '');
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {}; } catch { /* Storage may be unavailable. */ }
  const apiInput = $('#leaderboard-api-url');
  const tokenInput = $('#leaderboard-token');
  const boardInput = $('#leaderboard-id');
  const recordsBoardInput = $('#records-leaderboard-id');
  const form = $('#submission-form');
  const evaluationInput = $('#evaluation-id');
  const rankingBody = $('#leaderboard-body');
  const queryBoard = new URLSearchParams(location.search).get('leaderboard_id');
  const initialBoard = fixedApi ? defaultBoard : (queryBoard || saved.board || defaultBoard);
  const controllers = new Map();
  const timers = new Map();
  const activeEvaluations = new Map();
  let submitting = false;
  let records = [];
  let recordsConfig;
  let nextCursor = null;
  let submittedConfig;
  let submittedId;

  if (apiInput) { apiInput.value = demoMode ? demoApi : (fixedApi || saved.base || ''); apiInput.readOnly = Boolean(fixedApi && !demoMode); }
  if (tokenInput) {
    const demoToken = window.REACT_MANIP_LEADERBOARD_DEMO_TOKEN || '';
    tokenInput.value = demoMode ? demoToken : (saved.base === fixedApi ? saved.token || '' : '');
  }
  if (boardInput) { boardInput.value = initialBoard; boardInput.readOnly = Boolean(fixedApi && !demoMode); }
  if (recordsBoardInput) recordsBoardInput.value = queryBoard || initialBoard;
  if (demoMode && form) {
    if (evaluationInput) evaluationInput.value = window.REACT_MANIP_DEMO_EVALUATION_ID || 'react_manip_test';
    const demoType = form.querySelector('input[name="submission_type"][value="agent"]');
    if (demoType) demoType.checked = true;
  }
  if (fixedApi && apiInput) apiInput.closest('details')?.removeAttribute('open');
  apiInput?.addEventListener('invalid', () => { apiInput.closest('details').open = true; });
  const submitUrl = (board) => `submit.html?leaderboard_id=${encodeURIComponent(board)}${demoMode ? '&demo=1' : ''}`;
  if ($('#leaderboard-submit-link')) $('#leaderboard-submit-link').href = submitUrl(initialBoard);

  const escapeText = (value) => String(value ?? '—').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const typeLabel = (value) => ({ agent: 'Agent', model: 'Model' }[String(value).toLowerCase()] || '—');
  const statusOf = (item) => String(item.status || item.state || 'unknown').toLowerCase();
  const succeeded = (state) => ['completed', 'succeeded', 'finished', 'success'].includes(state);
  const failed = (state) => ['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(state);
  const terminal = (state) => succeeded(state) || failed(state);
  const badge = (state) => `<span class="evaluation-status" data-status="${succeeded(state) ? 'completed' : failed(state) ? 'failed' : 'pending'}">${escapeText(state)}</span>`;
  const setMessage = (element, message, state = '') => {
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  };
  const getConfig = (board = boardInput ? boardInput.value : initialBoard) => {
    const base = (fixedApi || (apiInput ? apiInput.value : saved.base) || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Enter the API base URL in Connection settings.');
    let url;
    try { url = new URL(base); } catch { throw new Error('Enter a valid HTTP or HTTPS API base URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Use an HTTP or HTTPS base URL without credentials, a query, or a fragment.');
    }
    if (!String(board).trim()) throw new Error('Enter a leaderboard ID.');
    const token = tokenInput ? tokenInput.value.trim() : (saved.base === base ? saved.token || '' : '');
    return { base, board: String(board).trim(), token };
  };
  const isDemoApi = (value) => {
    if (!demoApi) return false;
    try { return new URL(String(value).trim()).origin === new URL(demoApi).origin; } catch { return false; }
  };
  const remember = (config) => {
    saved = { ...config };
    // Session-only storage keeps navigation working for authenticated boards.
    // Credentials are never put in links or persistent localStorage.
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* The current page still works. */ }
  };
  const stop = (channel) => {
    clearTimeout(timers.get(channel));
    controllers.get(channel)?.abort();
    controllers.delete(channel);
  };
  const begin = (channel) => {
    stop(channel);
    const controller = new AbortController();
    controllers.set(channel, controller);
    return controller;
  };
  const cancelEvaluation = (target) => {
    activeEvaluations.delete(target);
    stop(`evaluation-${target}`);
  };
  const request = async (path, config, controller, body) => {
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    const headers = { Accept: 'application/json' };
    if (config.token) headers.Authorization = /^bearer /i.test(config.token) ? config.token : `Bearer ${config.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(`${config.base}/api/v1${path}`, {
        method: body ? 'POST' : 'GET', headers, cache: 'no-store', signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) {
        const hints = { 401: 'Authentication required. Check your bearer token.', 403: 'You do not have access to this leaderboard or evaluation.', 404: 'Leaderboard, evaluation, or service endpoint not found.', 409: 'This evaluation has already been submitted.', 429: 'Too many requests. Please try again shortly.' };
        throw new Error(hints[response.status] || `The evaluation service returned an error (${response.status}). Please try again.`);
      }
      try { return await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error('The evaluation service returned an invalid response.');
      }
    } catch (error) {
      if (timedOut) throw new Error('The evaluation service took too long to respond. Please try again.');
      if (error.name === 'TypeError') throw new Error('Could not reach the evaluation service. Check the API URL and connection.');
      throw error;
    } finally { clearTimeout(timeout); }
  };
  const listFrom = (payload, keys) => {
    const rows = Array.isArray(payload) ? payload : keys.map((key) => payload?.[key]).find(Array.isArray);
    if (!rows || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('The evaluation service returned an invalid list.');
    return rows;
  };
  const evaluationFrom = (payload) => {
    const item = payload?.evaluation || payload?.data || payload;
    if (!item || typeof item !== 'object' || Array.isArray(item) || (!item.status && !item.state)) throw new Error('The evaluation service returned an invalid evaluation.');
    return item;
  };
  const boardPath = (config) => `/leaderboards/${encodeURIComponent(config.board)}`;
  const rankingState = (state, message) => {
    $('.leaderboard-connection')?.setAttribute('data-state', state);
    setMessage($('#leaderboard-status'), message);
  };
  const loadRankings = async () => {
    if (!rankingBody || document.hidden) return;
    const controller = begin('rankings');
    try {
      const config = getConfig(fixedApi ? defaultBoard : saved.board || defaultBoard);
      rankingState('loading', 'Updating rankings');
      const rows = listFrom(await request(`${boardPath(config)}/rankings`, config, controller), ['rankings', 'entries', 'data']);
      if (controller.signal.aborted) return;
      $('#leaderboard-count').textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
      rankingBody.innerHTML = rows.length ? rows.map((row, index) => {
        const name = [row.leaderboard_id, row.nickname, row.display_name, row.name, row.model, row.agent, row.team, row.external_user_id, row.user_id]
          .find((value) => typeof value === 'string' && value.trim())?.trim() || 'Unnamed entry';
        const category = typeLabel(row.submission_type || row.type || row.category);
        return `<tr><td><span class="rank-value">${escapeText(row.rank ?? index + 1)}</span></td><td><span class="entry-category">${escapeText(category)}</span></td><td><div class="model-cell"><span class="model-name"><strong>${escapeText(name)}</strong></span></div></td><td><span class="score-value">${escapeText(row.score ?? row.value)}</span></td></tr>`;
      }).join('') : '<tr class="leaderboard-empty"><td colspan="4"><span>NO RESULTS YET</span><strong>Be the first on the leaderboard.</strong><small>Completed evaluations will appear here.</small></td></tr>';
      rankingState('connected', 'Live rankings');
    } catch (error) {
      if (error.name !== 'AbortError') rankingState('error', error.message);
    } finally {
      if (controllers.get('rankings') === controller && !document.hidden) timers.set('rankings', setTimeout(loadRankings, 8000));
    }
  };

  const showTab = (name, { focus = false, updateHash = true } = {}) => {
    const tabName = name === 'records' ? 'records' : 'submission';
    if (tabName !== 'records') document.dispatchEvent(new Event('evaluation-details-conceal'));
    document.querySelectorAll('[data-evaluation-tab]').forEach((tab) => {
      const active = tab.dataset.evaluationTab === tabName;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('is-active', active);
      if (active && focus) tab.focus();
    });
    for (const name of ['submission', 'records']) {
      if ($(`#${name}-panel`)) $(`#${name}-panel`).hidden = name !== tabName;
    }
    if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}${tabName === 'records' ? '#records' : '#submission'}`);
  };
  document.querySelectorAll('[data-evaluation-tab]').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.evaluationTab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const name = event.key === 'Home' ? 'submission' : event.key === 'End' ? 'records' : tab.dataset.evaluationTab === 'submission' ? 'records' : 'submission';
      showTab(name, { focus: true });
    });
  });
  if (form) showTab(location.hash === '#records' ? 'records' : 'submission', { updateHash: false });
  window.addEventListener('hashchange', () => { if (form) showTab(location.hash === '#records' ? 'records' : 'submission', { updateHash: false }); });

  const pollEvaluation = async (id, config, target) => {
    const channel = `evaluation-${target}`;
    const controller = begin(channel);
    activeEvaluations.set(target, { id, config });
    if (document.hidden) { timers.set(channel, setTimeout(() => pollEvaluation(id, config, target), 5000)); return; }
    const message = target === 'submission' ? $('#evaluation-state') : $('#record-detail-state');
    try {
      const result = evaluationFrom(await request(`/evaluations/${encodeURIComponent(id)}`, config, controller));
      if (controller.signal.aborted) return;
      const state = statusOf(result);
      if (target === 'submission') $('#submission-status').innerHTML = badge(state);
      setMessage(message, succeeded(state) ? 'Evaluation completed. Results are available on the leaderboard.' : failed(state) ? `Evaluation ${state}.` : `Evaluation status: ${state}.`, failed(state) ? 'error' : '');
      if (target === 'records') {
        records = records.map((record) => String(record.evaluation_id || record.id) === id ? { ...record, ...result } : record);
        renderRecords();
      }
      if (!terminal(state)) timers.set(channel, setTimeout(() => pollEvaluation(id, config, target), 5000));
      else activeEvaluations.delete(target);
    } catch (error) {
      if (error.name !== 'AbortError') {
        activeEvaluations.delete(target);
        setMessage(message, error.message, 'error');
      }
    }
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const message = $('#evaluation-state');
    let config;
    const evaluationId = $('#evaluation-id').value.trim();
    const type = form.querySelector('input[name="submission_type"]:checked')?.value;
    try {
      config = getConfig();
      if (!evaluationId) throw new Error('Enter the evaluation ID returned by the evaluation service.');
      if (!['agent', 'model'].includes(type)) throw new Error('Choose whether you are submitting an agent or a model.');
    } catch (error) { setMessage(message, error.message, 'error'); return; }
    submitting = true;
    cancelEvaluation('submission');
    const controller = begin('submit');
    const controls = [...form.elements].filter((element) => !element.disabled);
    controls.forEach((element) => { element.disabled = true; });
    const button = $('#submit-evaluation');
    const originalButton = button.innerHTML;
    button.textContent = 'Submitting…';
    $('#submission-result').hidden = true;
    setMessage(message, 'Submitting your evaluation…');
    try {
      const result = evaluationFrom(await request(`${boardPath(config)}/evaluations`, config, controller, { evaluation_id: evaluationId, submission_type: type }));
      if (controller.signal.aborted) return;
      remember(config);
      submittedConfig = config;
      submittedId = String(result.evaluation_id || result.id || evaluationId);
      const state = statusOf(result);
      $('#submitted-evaluation-id').textContent = submittedId;
      $('#submission-status').innerHTML = badge(state);
      $('#submission-result').hidden = false;
      setMessage(message, succeeded(state) ? 'Evaluation completed. Results are available on the leaderboard.' : failed(state) ? `Evaluation ${state}. Check the evaluation service for details.` : 'Evaluation submitted. Its status will update automatically.', failed(state) ? 'error' : 'success');
      if (!terminal(state)) {
        activeEvaluations.set('submission', { id: submittedId, config });
        timers.set('evaluation-submission', setTimeout(() => pollEvaluation(submittedId, config, 'submission'), 5000));
      }
    } catch (error) {
      setMessage(message, error.name === 'AbortError' ? 'Submission status could not be confirmed. Check Evaluation records before submitting again.' : error.message, 'error');
    } finally {
      submitting = false;
      controls.forEach((element) => { element.disabled = false; });
      button.innerHTML = originalButton;
    }
  });

  const renderRecords = () => {
    const body = $('#evaluation-records-body');
    if (!body) return;
    body.innerHTML = records.length ? records.map((record) => {
      const id = record.evaluation_id || record.id;
      return `<tr><td>${id ? `<button class="evaluation-record-link" type="button" data-evaluation-id="${escapeText(id)}">${escapeText(id)}</button>` : '—'}</td><td>${escapeText(typeLabel(record.submission_type || record.type))}</td><td>${badge(statusOf(record))}</td><td>${escapeText(record.score)}</td></tr>`;
    }).join('') : '<tr class="leaderboard-empty"><td colspan="4"><span>NO EVALUATIONS</span><strong>No records for this leaderboard yet.</strong><small>Try another leaderboard ID or submit an evaluation.</small></td></tr>';
    $('#records-count').textContent = `${records.length} ${records.length === 1 ? 'record' : 'records'}`;
    $('#records-load-more').hidden = !nextCursor;
  };
  const loadRecords = async (append = false, suppliedConfig) => {
    document.dispatchEvent(new Event('evaluation-details-reset'));
    const controller = begin('records');
    cancelEvaluation('records');
    const message = $('#records-state');
    const button = $('#load-evaluation-records');
    const more = $('#records-load-more');
    const body = $('#evaluation-records-body');
    $('#record-detail').hidden = true;
    button.disabled = true;
    more.disabled = true;
    if (!append) {
      records = [];
      nextCursor = null;
      recordsConfig = undefined;
      more.hidden = true;
      $('#records-count').textContent = '— records';
      body.innerHTML = '<tr class="leaderboard-empty"><td colspan="4"><strong>Looking up evaluations…</strong></td></tr>';
    }
    body.closest('table').setAttribute('aria-busy', 'true');
    try {
      const config = suppliedConfig || (append ? recordsConfig : getConfig(recordsBoardInput.value));
      if (!config) throw new Error('Search for a leaderboard before loading more records.');
      setMessage(message, `Loading evaluations for ${config.board}…`);
      const cursor = append && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : '';
      const payload = await request(`${boardPath(config)}/evaluations${cursor}`, config, controller);
      const rows = listFrom(payload, ['evaluations', 'records', 'data']);
      if (controller.signal.aborted) return;
      recordsConfig = config;
      records = append ? [...records, ...rows] : rows;
      nextCursor = typeof payload?.next_cursor === 'string' && payload.next_cursor ? payload.next_cursor : null;
      remember(config);
      renderRecords();
      setMessage(message, `Evaluation records for ${config.board}.`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setMessage(message, error.message, 'error');
        if (!append) body.innerHTML = '<tr class="leaderboard-empty"><td colspan="4"><strong>Could not load evaluation records.</strong><small>Check the connection settings and try again.</small></td></tr>';
      }
    } finally {
      if (controllers.get('records') === controller) {
        button.disabled = false;
        more.disabled = false;
        body.closest('table').removeAttribute('aria-busy');
      }
    }
  };
  $('#records-form')?.addEventListener('submit', (event) => { event.preventDefault(); loadRecords(); });
  $('#records-load-more')?.addEventListener('click', () => loadRecords(true));
  $('#view-evaluation-records')?.addEventListener('click', () => {
    if (!submittedConfig) return;
    recordsBoardInput.value = submittedConfig.board;
    showTab('records', { focus: true });
    loadRecords(false, submittedConfig);
  });
  $('#evaluation-records-body')?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-evaluation-id]');
    if (!trigger || !recordsConfig) return;
    const id = trigger.dataset.evaluationId;
    document.dispatchEvent(new CustomEvent('evaluation-details-select', { detail: { id, config: { ...recordsConfig } } }));
    $('#record-detail').hidden = false;
    $('#record-detail-title').textContent = id;
    $('#record-detail').focus();
    setMessage($('#record-detail-state'), 'Checking evaluation status…');
    pollEvaluation(id, recordsConfig, 'records');
  });
  if (demoMode && location.hash === '#records') {
    window.setTimeout(() => loadRecords(), 0);
  }
  for (const input of [apiInput, tokenInput, recordsBoardInput]) {
    input?.addEventListener('input', () => {
      document.dispatchEvent(new Event('evaluation-details-reset'));
      stop('records');
      cancelEvaluation('records');
      if (input !== recordsBoardInput) {
        cancelEvaluation('submission');
        $('#submission-result').hidden = true;
        if (input === apiInput) {
          const demoEndpoint = isDemoApi(apiInput.value);
          tokenInput.value = demoEndpoint ? window.REACT_MANIP_LEADERBOARD_DEMO_TOKEN || '' : '';
          if (demoEndpoint && evaluationInput && !evaluationInput.value.trim()) {
            evaluationInput.value = window.REACT_MANIP_DEMO_EVALUATION_ID || 'react_manip_test';
            const agent = form?.querySelector('input[name="submission_type"][value="agent"]');
            if (agent) agent.checked = true;
          }
        }
        saved.token = '';
        try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Storage may be unavailable. */ }
        setMessage($('#evaluation-state'), 'Connection settings changed. Submit your evaluation when ready.');
      }
      recordsConfig = undefined;
      nextCursor = null;
      $('#record-detail').hidden = true;
      $('#records-load-more').hidden = true;
      $('#load-evaluation-records').disabled = false;
      $('#evaluation-records-body').closest('table').removeAttribute('aria-busy');
      $('#evaluation-records-body').innerHTML = '<tr class="leaderboard-empty"><td colspan="4"><strong>Search to view evaluation records.</strong></td></tr>';
      $('#records-count').textContent = '— records';
      setMessage($('#records-state'), 'Enter a leaderboard ID to look up its evaluations.');
    });
  }
  const pause = () => {
    for (const channel of controllers.keys()) stop(channel);
    for (const timer of timers.values()) clearTimeout(timer);
  };
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', () => {
    if (rankingBody) {
      try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {}; } catch { /* Retain in-memory settings. */ }
      const board = fixedApi ? defaultBoard : saved.board || defaultBoard;
      $('#leaderboard-submit-link').href = submitUrl(board);
      if (fixedApi || saved.base) loadRankings();
    }
    for (const [target, { id, config }] of activeEvaluations) pollEvaluation(id, config, target);
    if (form && $('#load-evaluation-records').disabled) loadRecords();
  });
  document.addEventListener('visibilitychange', () => {
    if (rankingBody) { if (document.hidden) stop('rankings'); else if (fixedApi || saved.base) loadRankings(); }
  });
})();
