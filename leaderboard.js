// Website metadata is stored by the website; evaluation contains the evaluator's six fields.
(() => {
  'use strict';
  const api = window.ReactManipAPI, $ = selector => document.querySelector(selector);
  const form = $('#submission-form'), teamSearch = $('#records-team-name');
  const controllers = new Map(), timers = new Map(), active = new Map(), profiles = new Set();
  let records = [], nextCursor = null, searchedTeam = '', selected = null, submittedTeam = '', submitting = false, memoryAttempt, sessionGeneration = 0;
  const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const category = value => ({ agent: 'Agent', model: 'Model' }[value] || '—');
  const message = (node, text, error = false) => { if (node) { node.textContent = text; node.dataset.state = error ? 'error' : ''; } };
  const awaitingRelay = item => ['PREPARED', 'UNCERTAIN'].includes(item.relay_state);
  const relayNeedsAttention = item => awaitingRelay(item) && item.relay_can_retry === false;
  const hasProblem = item => relayNeedsAttention(item) || ['INVALID', 'FAILED', 'CANCELLED'].includes(api.status(item));
  const badge = item => `<span class="evaluation-status" data-status="${escape(api.status(item).toLowerCase())}">${escape(relayNeedsAttention(item) ? 'CONFIRMATION NEEDED' : awaitingRelay(item) ? 'AWAITING CONFIRMATION' : api.status(item) || 'UNKNOWN')}</span>`;
  // Keep the website reference stable while a queued relay acquires its evaluator ID.
  const idOf = item => String(item?.submission_id || item?.evaluation_id || item?.id || '');
  const stop = name => { clearTimeout(timers.get(name)); controllers.get(name)?.abort(); controllers.delete(name); };
  const begin = name => { stop(name); const controller = new AbortController(); controllers.set(name, controller); return controller; };
  const clearDetail = () => {
    selected = null; active.delete('detail'); stop('detail'); stop('cancel');
    if ($('#record-detail')) $('#record-detail').hidden = true;
    document.dispatchEvent(new Event('evaluation-details-reset'));
  };
  const unwrap = payload => {
    const item = payload?.evaluation ?? payload;
    if (!item || typeof item !== 'object' || !idOf(item)) throw new api.ApiError('The service did not return an evaluation reference. Check your records before retrying.');
    if (!['QUEUED', 'RUNNING', 'COMPLETED', 'INVALID', 'FAILED', 'CANCELLED'].includes(api.status(item))) throw new api.ApiError('The service returned an unknown evaluation status.');
    return item;
  };
  const resultText = item => {
    if (item.relay_state === 'REJECTED') return 'The evaluator rejected this submission. Review the submission settings before trying again.';
    if (relayNeedsAttention(item)) return 'Forwarding could not be confirmed. Contact the organizer before starting a new submission.';
    if (awaitingRelay(item)) return 'Submission saved. Waiting for the evaluator to confirm receipt; you can check your records for updates.';
    const count = item.completed_episodes ?? item.episodes_completed ?? item.progress?.completed_episodes;
    const progress = Number.isInteger(count) && count >= 0 && count <= 720 ? ` · ${count}/720 episodes` : '';
    return `${api.status(item)}${progress}${api.score(item) !== '—' ? ` · Protocol score: ${api.score(item)}` : ''}`;
  };
  const updateDetail = item => {
    message($('#record-detail-state'), resultText(item), hasProblem(item));
    const expiry = api.date(item.videos_expires_at);
    message($('#record-media-expiry'), expiry ? `${expiry <= new Date() ? 'Videos expired' : 'Videos expire'}: ${expiry.toLocaleString()}. Scores remain available.` : 'Videos remain private and expire seven days after the evaluation reaches a terminal state.');
    $('#cancel-evaluation').hidden = api.terminal(item) || awaitingRelay(item);
    document.dispatchEvent(new CustomEvent('evaluation-details-update', { detail: item }));
  };
  const renderRecords = () => {
    $('#evaluation-records-body').innerHTML = records.length ? records.map(item => `<tr>
      <td><button type="button" class="evaluation-record-link" data-evaluation-id="${escape(idOf(item))}">${escape(item.team_display_name)}</button></td>
      <td>${escape(item.model_id)}<small class="record-version">${escape(item.model_version)}</small></td><td>${escape(item.profile_id)}</td>
      <td>${escape(category(item.website_metadata?.submission_type))}</td><td>${escape(item.website_metadata?.organization)}</td>
      <td>${badge(item)}</td><td>${escape(api.score(item))}</td></tr>`).join('') : `<tr class="leaderboard-empty"><td colspan="7"><strong>No matching records on the pages searched.</strong><small>${nextCursor !== null ? 'Search the next page to continue.' : 'Check the team name and the account you are signed in to.'}</small></td></tr>`;
    $('#records-count').textContent = `${records.length} matching ${records.length === 1 ? 'record' : 'records'}`;
  };
  const poll = async (id, target) => {
    active.set(target, id);
    const controller = begin(target);
    if (document.hidden) { timers.set(target, setTimeout(() => poll(id, target), 5000)); return; }
    try {
      const item = unwrap(await api.request(`/evaluations/${encodeURIComponent(id)}`, { signal: controller.signal }));
      if (controller.signal.aborted || active.get(target) !== id) return;
      if (target === 'detail') {
        if (selected !== id) return;
        updateDetail(item); records = records.map(record => idOf(record) === id ? { ...record, ...item } : record); renderRecords();
      } else {
        $('#submission-status').innerHTML = badge(item);
        $('#submission-result-label').textContent = awaitingRelay(item) ? 'Submission saved' : 'Evaluation submitted';
        message($('#evaluation-state'), resultText(item), hasProblem(item));
      }
      if (api.terminal(item) || relayNeedsAttention(item)) active.delete(target);
      else timers.set(target, setTimeout(() => poll(id, target), 5000));
    } catch (error) {
      if (error.name === 'AbortError') return;
      message($(target === 'detail' ? '#record-detail-state' : '#evaluation-state'), error.message, true);
      if ([401, 403, 404].includes(error.status)) {
        active.delete(target);
        if (target === 'detail') { clearDetail(); message($('#records-state'), error.message, true); }
      }
      else if (active.get(target) === id) timers.set(target, setTimeout(() => poll(id, target), 8000));
    }
  };
  const showTab = (name, focus = false, updateHash = true) => {
    const current = name === 'records' ? 'records' : 'submission';
    document.querySelectorAll('[data-evaluation-tab]').forEach(tab => {
      const chosen = tab.dataset.evaluationTab === current;
      tab.setAttribute('aria-selected', String(chosen)); tab.tabIndex = chosen ? 0 : -1;
      if (chosen && focus) tab.focus();
    });
    if (!form) return;
    $('#submission-panel').hidden = current !== 'submission'; $('#records-panel').hidden = current !== 'records';
    if (current !== 'records') clearDetail();
    if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}#${current}`);
  };
  document.querySelectorAll('[data-evaluation-tab]').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.evaluationTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      showTab(event.key === 'Home' ? 'submission' : event.key === 'End' ? 'records' : tab.dataset.evaluationTab === 'records' ? 'submission' : 'records', true);
    });
  });
  if (form) {
    showTab(location.hash === '#records' ? 'records' : 'submission', false, false);
    window.addEventListener('hashchange', () => showTab(location.hash === '#records' ? 'records' : 'submission', false, false));
  }
  const loadProfiles = async () => {
    if (!form) return;
    const controller = begin('profiles');
    try {
      const list = api.rows(await api.request('/profiles', { signal: controller.signal }), 'profiles');
      if (controller.signal.aborted) return;
      const select = $('#evaluation-profile');
      select.replaceChildren(new Option('Choose a published profile', '')); profiles.clear();
      for (const item of list) {
        const id = item.profile_id ?? item.id;
        if (typeof id !== 'string' || !id) throw new api.ApiError('The service returned an invalid profile.');
        if (profiles.has(id)) continue;
        profiles.add(id); select.add(new Option(id, id));
      }
      if (profiles.size === 1) select.value = [...profiles][0];
      select.disabled = profiles.size === 0; $('#submit-evaluation').disabled = profiles.size === 0;
      message($('#evaluation-state'), profiles.size ? 'Complete the required fields to submit your evaluation.' : 'No evaluation profiles are currently published.');
    } catch (error) { if (error.name !== 'AbortError') message($('#evaluation-state'), error.message, true); }
  };
  const setupContact = () => {
    const method = $('#contact-method'), input = $('#contact-value');
    let previous = method.value; const drafts = {};
    const update = () => {
      const phone = method.value === 'phone';
      input.type = phone ? 'tel' : 'text'; input.inputMode = phone ? 'tel' : 'text'; input.autocomplete = phone ? 'tel' : 'off';
      input.maxLength = phone ? 40 : 64; input.placeholder = phone ? '+86 138 0000 0000' : 'Your WeChat ID';
      $('#contact-value-label').textContent = phone ? 'Phone number' : 'WeChat ID';
      $('#contact-value-hint').textContent = phone ? 'Include the country code for international numbers.' : 'Enter your WeChat ID without spaces.';
      input.setCustomValidity('');
    };
    method.addEventListener('change', () => { drafts[previous] = input.value; input.value = drafts[method.value] || ''; previous = method.value; update(); });
    update();
  };
  if (form) {
    setupContact();
    if (api.demo) {
      const values = { team_display_name: 'Demo team', model_id: 'sample-policy', model_version: 'v1', model_endpoint: 'https://model.example/evaluate', model_api_key: 'demo-key-not-a-secret', organization: 'Demo lab', email: 'demo@example.com', submission_type: 'agent', contact_value: '+8613800000000' };
      for (const [name, value] of Object.entries(values)) form.elements.namedItem(name).value = value;
      teamSearch.value = 'Demo team'; message($('#service-state'), 'Demo mode · illustrative sample data only. No real model is contacted.');
    } else if (!api.configured) message($('#service-state'), 'Online evaluation is not available yet.');
    form.addEventListener('input', event => event.target.setCustomValidity?.(''));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submitting) return;
      const value = name => form.elements.namedItem(name).value.trim();
      for (const input of form.querySelectorAll('input[required]')) if (!input.value.trim()) input.setCustomValidity('Complete this required field.');
      const contact = value('contact_value');
      if (value('contact_method') === 'phone' ? !/^\+?\d{7,15}$/.test(contact.replace(/[\s().-]/g, '')) : /\s/.test(contact)) $('#contact-value').setCustomValidity('Enter a valid phone number or WeChat ID.');
      try {
        const endpoint = new URL(value('model_endpoint'));
        if (endpoint.protocol !== 'https:' || (endpoint.port && endpoint.port !== '443') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
      } catch { $('#participant-api-url').setCustomValidity('Use a public HTTPS URL on port 443, without credentials, a query, or a fragment.'); }
      $('#evaluation-profile').setCustomValidity(profiles.has(value('profile_id')) ? '' : 'Choose a published evaluation profile.');
      if (!form.reportValidity()) return;
      const evaluation = Object.fromEntries(['profile_id', 'team_display_name', 'model_id', 'model_version', 'model_endpoint', 'model_api_key'].map(name => [name, value(name)]));
      const website_metadata = Object.fromEntries(['organization', 'email', 'contact_method', 'contact_value', 'submission_type'].map(name => [name, value(name)]));
      if (website_metadata.contact_method === 'phone') website_metadata.contact_value = contact.replace(/[\s().-]/g, '');
      const body = { evaluation, website_metadata }, controller = begin('submit'), generation = sessionGeneration; submitting = true;
      const controls = [...form.elements].filter(node => !node.disabled); controls.forEach(node => { node.disabled = true; });
      message($('#evaluation-state'), 'Submitting your evaluation…');
      try {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
        const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        let attempt = memoryAttempt;
        try { attempt = JSON.parse(sessionStorage.getItem('react-manip.v1.attempt') || 'null') || attempt; } catch { /* Optional storage. */ }
        if (attempt?.fingerprint !== fingerprint || typeof attempt?.key !== 'string') attempt = { fingerprint, key: crypto.randomUUID() };
        memoryAttempt = attempt;
        try { sessionStorage.setItem('react-manip.v1.attempt', JSON.stringify(attempt)); } catch { /* Keep the in-memory attempt. */ }
        const item = unwrap(await api.mutate('/evaluations', { body, idempotencyKey: attempt.key, signal: controller.signal }));
        if (controller.signal.aborted || generation !== sessionGeneration) return;
        memoryAttempt = null;
        try { sessionStorage.removeItem('react-manip.v1.attempt'); } catch { /* Optional storage. */ }
        $('#participant-api-key').value = '';
        submittedTeam = evaluation.team_display_name; $('#submitted-team-name').textContent = submittedTeam;
        $('#submission-result-label').textContent = awaitingRelay(item) ? 'Submission saved' : 'Evaluation submitted';
        $('#submission-status').innerHTML = badge(item); $('#submission-result').hidden = false;
        message($('#evaluation-state'), resultText(item), hasProblem(item)); active.delete('submission'); stop('submission');
        if (!api.terminal(item) && !relayNeedsAttention(item)) { active.set('submission', idOf(item)); timers.set('submission', setTimeout(() => poll(idOf(item), 'submission'), 5000)); }
      } catch (error) { if (error.name !== 'AbortError') message($('#evaluation-state'), error.message, true); }
      finally { submitting = false; controls.forEach(node => { node.disabled = false; }); }
    });
    loadProfiles();
  }
  const loadRecords = async (append = false) => {
    if (!teamSearch || !teamSearch.value.trim() || !$('#records-form').reportValidity() || (append && nextCursor === null)) return;
    clearDetail(); const controller = begin('records');
    if (!append) { records = []; nextCursor = null; searchedTeam = api.normalizeTeam(teamSearch.value); $('#records-load-more').hidden = true; }
    const after = append ? nextCursor : '0';
    $('#load-evaluation-records').disabled = true; $('#records-load-more').disabled = true;
    message($('#records-state'), 'Searching your authorized evaluation records…');
    try {
      // The evaluator supports owner-scoped pagination, not a team_name query parameter.
      const payload = await api.request(`/evaluations?after=${encodeURIComponent(after)}&limit=50`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const list = api.rows(payload, 'evaluations'); nextCursor = list.length ? api.cursor(payload) : null;
      if (nextCursor === after) throw new api.ApiError('The service returned a pagination cursor that did not advance.');
      const seen = new Set(records.map(idOf));
      for (const item of list) {
        if (api.normalizeTeam(item.team_display_name) !== searchedTeam || seen.has(idOf(item))) continue;
        records.push(unwrap(item)); seen.add(idOf(item));
      }
      renderRecords(); $('#records-load-more').hidden = nextCursor === null;
      message($('#records-state'), `Records for ${teamSearch.value.trim()}.${nextCursor !== null ? ' More pages are available; search the next page to continue.' : ' All available pages have been searched.'}`);
    } catch (error) { if (error.name !== 'AbortError') message($('#records-state'), error.message, true); }
    finally { if (controllers.get('records') === controller) { $('#load-evaluation-records').disabled = false; $('#records-load-more').disabled = false; } }
  };
  $('#records-form')?.addEventListener('submit', event => { event.preventDefault(); loadRecords(); });
  document.addEventListener('react-manip-session-change', event => {
    if (!form || event.detail.initial) return;
    const session = event.detail.session;
    sessionGeneration++;
    clearDetail(); stop('records'); stop('submission'); active.delete('submission');
    records = []; nextCursor = null; memoryAttempt = null; submittedTeam = '';
    $('#participant-api-key').value = ''; $('#submission-result').hidden = true;
    $('#records-load-more').hidden = true; $('#records-count').textContent = '— records';
    $('#evaluation-records-body').innerHTML = '<tr class="leaderboard-empty"><td colspan="7"><strong>Search by team name to view your records.</strong></td></tr>';
    message($('#records-state'), session ? 'Enter a team name to search your records.' : 'Sign in to view your private records.');
    try { sessionStorage.removeItem('react-manip.v1.attempt'); } catch { /* Optional storage. */ }
    if (session) loadProfiles();
  });
  $('#records-load-more')?.addEventListener('click', () => loadRecords(true));
  teamSearch?.addEventListener('input', () => {
    stop('records'); clearDetail(); records = []; nextCursor = null;
    $('#records-load-more').hidden = true; $('#load-evaluation-records').disabled = false;
    $('#evaluation-records-body').innerHTML = '<tr class="leaderboard-empty"><td colspan="7"><strong>Search by team name to view your records.</strong></td></tr>';
    $('#records-count').textContent = '— records'; message($('#records-state'), 'Enter a team name to search your records.');
  });
  $('#view-evaluation-records')?.addEventListener('click', () => { teamSearch.value = submittedTeam; showTab('records', true); loadRecords(); });
  $('#evaluation-records-body')?.addEventListener('click', event => {
    const button = event.target.closest('[data-evaluation-id]'); if (!button) return;
    clearDetail(); selected = button.dataset.evaluationId;
    const item = records.find(row => idOf(row) === selected); if (!item) return;
    $('#record-detail').hidden = false; $('#record-detail-title').textContent = `${item.team_display_name} · ${item.model_id} · ${item.model_version}`;
    $('#record-detail').focus(); updateDetail(item);
    document.dispatchEvent(new CustomEvent('evaluation-details-select', { detail: { id: selected, evaluation: item } })); poll(selected, 'detail');
  });
  $('#cancel-evaluation')?.addEventListener('click', async () => {
    if (!selected) return;
    const id = selected, controller = begin('cancel'); $('#cancel-evaluation').disabled = true;
    try { await api.mutate(`/evaluations/${encodeURIComponent(id)}/cancel`, { signal: controller.signal }); if (selected === id && !controller.signal.aborted) await poll(id, 'detail'); }
    catch (error) { if (error.name !== 'AbortError') message($('#record-detail-state'), error.message, true); }
    finally { $('#cancel-evaluation').disabled = false; }
  });
  const loadRankings = async () => {
    if (!$('#leaderboard-body') || document.hidden) return;
    const controller = begin('rankings'), chosen = $('#ranking-profile').value;
    try {
      const payload = await api.request(`/rankings${chosen ? `?profile_id=${encodeURIComponent(chosen)}` : ''}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const options = api.rows(payload, 'profiles'), profile = payload.profile_id;
      if (chosen && profile !== chosen) throw new api.ApiError('Results do not match the selected profile.');
      const rows = api.rows(payload, 'rankings');
      if (rows.length && (!profile || rows.some(row => row.profile_id !== profile || api.status(row) !== 'COMPLETED' || row.score_kind !== 'protocol' || row.eligible_for_ranking !== true || typeof row.score !== 'number' || !Number.isFinite(row.score)))) throw new api.ApiError('The service returned incompatible ranking results.');
      const select = $('#ranking-profile'); select.replaceChildren(new Option('Select an evaluation profile', ''));
      for (const option of options) if (typeof option.profile_id === 'string') select.add(new Option(option.profile_id, option.profile_id));
      if (profile) { if (![...select.options].some(option => option.value === profile)) throw new api.ApiError('The ranking profile is missing from the published list.'); select.value = profile; }
      select.disabled = options.length === 0;
      $('#leaderboard-body').innerHTML = rows.length ? rows.map((row, index) => `<tr><td><span class="rank-value">${index + 1}</span></td><td>${escape(row.team_display_name)}</td><td>${escape(row.model_id)}<small class="record-version">${escape(row.model_version)}</small></td><td>${escape(category(row.website_metadata?.submission_type))}</td><td class="score-value">${escape(api.score(row))}</td></tr>`).join('') : '<tr class="leaderboard-empty"><td colspan="5"><strong>No protocol results are available for this profile yet.</strong></td></tr>';
      $('#leaderboard-count').textContent = `${rows.length} entries`;
      message($('#leaderboard-status'), api.demo ? 'Demo rankings · illustrative sample data' : 'Protocol trial rankings'); $('.leaderboard-connection').dataset.state = 'connected';
      timers.set('rankings', setTimeout(loadRankings, 15000));
    } catch (error) {
      if (error.name === 'AbortError') return;
      $('#leaderboard-body').innerHTML = '<tr class="leaderboard-empty"><td colspan="5"><strong>Rankings are not available yet.</strong></td></tr>'; $('#leaderboard-count').textContent = '— entries';
      message($('#leaderboard-status'), error.message, true); $('.leaderboard-connection').dataset.state = 'error';
      if (api.configured) timers.set('rankings', setTimeout(loadRankings, 15000));
    }
  };
  $('#ranking-profile')?.addEventListener('change', loadRankings);
  if ($('#leaderboard-submit-link') && api.demo) $('#leaderboard-submit-link').href = 'submit.html?demo=1';
  if (form && api.demo && location.hash === '#records') loadRecords();
  loadRankings();
  const pause = () => { for (const key of controllers.keys()) stop(key); for (const timer of timers.values()) clearTimeout(timer); };
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', event => { if (event.persisted) { loadRankings(); if (form) loadProfiles(); for (const [target, id] of active) poll(id, target); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop('rankings'); else { loadRankings(); for (const [target, id] of active) poll(id, target); } });
})();
