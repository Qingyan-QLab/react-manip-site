// Published records use only anonymous GET requests. Media and logs load on demand.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const LIMIT = 256 * 1024, PAGE_SIZE = 30, ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
  const files = [
    ['result_path', 'Episode result'], ['actions_path', 'Actions'], ['feedback_path', 'Environment feedback'],
    ['states_path', 'Simulator states'], ['memory_before_path', 'Memory before'], ['memory_after_path', 'Memory after'],
    ['review_input_path', 'Review input'], ['review_result_path', 'Review result'], ['case_log_path', 'Setting log']
  ];
  const controllers = new Map();
  let base, record = null, filtered = [], selected = null, pageNumber = 0, mode = 'all', generation = 0, selection = 0, retry = null;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; };
  const message = (selector, text, error = false) => { const element = $(selector); element.textContent = text; element.dataset.state = error ? 'error' : ''; };
  const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
  const phaseName = episode => episode.phase === 'exam' ? 'Exam' : 'Practice';
  const setting = episode => /_(00[0-2])$/.exec(episode.instance)?.[1] || episode.instance;
  const settingName = episode => /^00[0-2]$/.test(setting(episode)) ? `Setting ${Number(setting(episode)) + 1}` : setting(episode);
  const normalizeTeam = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const abort = name => { controllers.get(name)?.controller.abort(); controllers.delete(name); };
  const begin = name => { abort(name); const operation = { controller: new AbortController(), timedOut: false }; controllers.set(name, operation); return operation; };
  const current = (name, operation) => controllers.get(name) === operation && !operation.controller.signal.aborted;
  const unavailable = status => ({
    400: 'The record request is invalid (400).',
    401: 'These records are not available for public access (401).',
    403: 'Access denied (403). These records are not publicly available.',
    404: 'Published records were not found (404).',
    410: 'These published records are no longer available (410).',
    429: 'Too many requests (429). Please try again shortly.'
  }[status] || `The records service returned an error (${status}).`);
  const errorText = (error, operation) => operation?.timedOut ? 'The request timed out. Please try again.'
    : error instanceof TypeError ? 'Could not reach the records service. Check your connection and try again.' : error.message;
  async function readBounded(response, maximum, signal) {
    if (!response.body?.getReader) throw new Error('This browser cannot preview streamed files. Use the download link instead.');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8');
    let text = '', bytes = 0, truncated = false;
    try {
      while (true) {
        if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        const part = await reader.read();
        if (part.done) break;
        const remaining = maximum - bytes, amount = Math.min(part.value.byteLength, remaining);
        text += decoder.decode(part.value.subarray(0, amount), { stream: true }); bytes += amount;
        if (bytes === maximum) {
          const length = response.headers.get('Content-Length');
          truncated = part.value.byteLength > amount || !length || Number(length) > maximum;
          await reader.cancel();
          break;
        }
      }
      return { text: text + decoder.decode(), bytes, truncated };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function responseError(response, signal, kind) {
    let detail = '';
    try { const value = await readBounded(response, 8192, signal); detail = JSON.parse(value.text)?.detail || ''; } catch { /* Status is sufficient if no small JSON error exists. */ }
    if (response.status === 503 && ['published_records_closed', 'published_records_not_published', 'records_not_published', 'rankings_not_published'].includes(detail)) {
      return new Error('Public records are currently closed. Please check again later.');
    }
    if (kind === 'file' || kind === 'video') {
      if (response.status === 403) return new Error(`Access denied (${response.status}). This ${kind} is not publicly available.`);
      if (response.status === 404) return new Error(`This ${kind} was not found (404).`);
      if (response.status === 410) return new Error(`This ${kind} is no longer available (410).`);
    }
    return new Error(unavailable(response.status));
  }
  async function get(url, operation, kind, maximum) {
    const signal = operation.controller.signal;
    const timer = setTimeout(() => { operation.timedOut = true; operation.controller.abort(); }, 30000);
    try {
      const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', signal,
        headers: kind === 'video' ? { Range: 'bytes=0-0' } : { Accept: kind === 'json' ? 'application/json' : 'text/plain, application/json' } });
      if (!response.ok) throw await responseError(response, signal, kind);
      if (kind === 'video') { await response.body?.cancel(); return; }
      const result = await readBounded(response, maximum, signal);
      if (kind === 'json') {
        if (result.truncated) throw new Error('The record index is too large to display.');
        try { return JSON.parse(result.text); } catch { throw new Error('The records service returned an invalid response.'); }
      }
      return result;
    } finally { clearTimeout(timer); }
  }
  const fileURL = (relative, download = false) => {
    if (!record || typeof relative !== 'string' || relative.length > 1600 || /[\\\u0000-\u001f\u007f:#?]/.test(relative)) return null;
    const segments = relative.split('/');
    if (segments.some(part => !part || part === '.' || part === '..')) return null;
    return `${base}/api/v1/published-records/${encodeURIComponent(record.record_id)}/files/${segments.map(encodeURIComponent).join('/')}${download ? '?download=1' : ''}`;
  };
  const setLink = (selector, relative) => { const link = $(selector), url = fileURL(relative, true); link.hidden = !url; if (url) link.href = url; else link.removeAttribute('href'); };
  function releaseVideo() {
    abort('video');
    const video = $('#published-video'); video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
    $('#published-load-video').disabled = false;
  }
  function closePreview() {
    abort('file'); $('#published-preview').hidden = true; $('#published-file-text').textContent = '';
    $('#published-preview-file').disabled = $('#published-file').options.length === 0;
    message('#published-file-state', '');
  }
  function clearEpisode() {
    selection++; selected = null; releaseVideo(); closePreview(); $('#published-episode-detail').hidden = true;
  }
  function clearRecord() {
    generation++; abort('index'); clearEpisode(); record = null; filtered = []; pageNumber = 0;
    $('#published-content').hidden = true; $('#published-episodes').replaceChildren();
  }
  function setLocation(values) {
    const url = new URL(location.href); url.search = '';
    for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
    history.pushState(null, '', url.pathname + url.search);
  }
  function validateRecord(value, id) {
    const invalid = () => { throw new Error('The published record index is incomplete or invalid.'); };
    if (!value || value.record_id !== id || value.episode_count !== 720 || value.practice_count !== 480 || value.exam_count !== 240
      || !Array.isArray(value.episodes) || value.episodes.length !== 720 || !Array.isArray(value.tasks) || value.tasks.length !== 16
      || value.tasks.some(task => typeof task !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(task)) || new Set(value.tasks).size !== 16) invalid();
    const keys = new Set(); let practice = 0, exam = 0;
    for (const episode of value.episodes) {
      if (!episode || !value.tasks.includes(episode.task) || typeof episode.instance !== 'string' || !episode.instance || episode.instance.length > 200
        || !['practice', 'exam'].includes(episode.phase) || !Number.isSafeInteger(episode.episode_index) || episode.episode_index < 0 || episode.episode_index > 14
        || !Number.isSafeInteger(episode.phase_episode_number) || episode.phase_episode_number < 1 || episode.phase_episode_number > (episode.phase === 'practice' ? 10 : 5)
        || typeof episode.score !== 'number' || !Number.isFinite(episode.score) || typeof episode.passed !== 'boolean') invalid();
      const key = `${episode.task}\n${episode.instance}\n${episode.phase}\n${episode.episode_index}`;
      if (keys.has(key)) invalid(); keys.add(key);
      if (episode.phase === 'practice') practice++; else exam++;
    }
    if (practice !== 480 || exam !== 240) invalid();
    return value;
  }
  function showSummary() {
    $('#published-content').hidden = false;
    $('#published-team-label').textContent = record.team_display_name;
    $('#published-model').textContent = record.model_id;
    $('#published-team').value = record.team_display_name || '';
    const version = String(record.model_version || '');
    $('#published-version').textContent = version.toLowerCase() === 'low' ? '' : version;
    $('#published-benchmark').textContent = record.profile_id === 'validation-attempt-20261104T062405Z-fb194c0cde95' ? 'ReAct-Manip v1.0' : record.profile_id || 'Benchmark version unavailable';
    $('#published-score').textContent = score(record.score);
    const passed = record.exam_passed;
    $('#published-success').replaceChildren(node('span', Number.isSafeInteger(passed) && passed >= 0 && passed <= 240 ? `${(passed / 240 * 100).toFixed(2)}%` : '—'));
    if (Number.isSafeInteger(passed) && passed >= 0 && passed <= 240) $('#published-success').append(node('small', `${passed} / 240 exams`));
    $('#published-total').replaceChildren(node('span', '720'), node('small', '480 practice · 240 exam'));
    $('#published-video-total').replaceChildren(node('span', number(record.video_count)), node('small', 'Exam episodes only'));
    const tasks = $('#published-task'); tasks.replaceChildren(new Option('All tasks', ''));
    for (const task of record.tasks) tasks.add(new Option(task, task));
    const settings = [...new Set(record.episodes.map(setting))].sort();
    const selector = $('#published-instance'); selector.replaceChildren(new Option('All settings', ''));
    for (const value of settings) selector.add(new Option(/^00[0-2]$/.test(value) ? `Setting ${Number(value) + 1}` : value, value));
    $('#published-phase').value = mode === 'videos' ? 'exam' : '';
    updateView(false);
  }
  function renderPage() {
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); pageNumber = Math.min(pageNumber, pages - 1);
    const rows = filtered.slice(pageNumber * PAGE_SIZE, (pageNumber + 1) * PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    for (const entry of rows) {
      const episode = entry.episode, row = node('tr'); row.dataset.selected = String(selected === entry.index);
      row.append(node('td', episode.task), node('td', settingName(episode)));
      const cell = node('td'), button = node('button', `${phaseName(episode)} ${episode.phase_episode_number}`, 'published-episode-button');
      button.type = 'button'; button.dataset.episode = String(entry.index); button.setAttribute('aria-pressed', String(selected === entry.index));
      button.setAttribute('aria-label', `${episode.task}, ${settingName(episode)}, ${phaseName(episode)} ${episode.phase_episode_number}`);
      cell.append(button); row.append(cell, node('td', score(episode.score)), node('td', episode.passed ? 'Passed' : 'Not passed'), node('td', episode.phase === 'exam' && fileURL(episode.video_path) ? 'Available' : '—')); fragment.append(row);
    }
    if (!rows.length) { const row = node('tr'), cell = node('td', 'No episodes match these filters.', 'published-empty'); cell.colSpan = 6; row.append(cell); fragment.append(row); }
    $('#published-episodes').replaceChildren(fragment);
    $('#published-filter-count').textContent = `${filtered.length} matching ${filtered.length === 1 ? 'episode' : 'episodes'}${filtered.length ? ` · Showing ${pageNumber * PAGE_SIZE + 1}–${pageNumber * PAGE_SIZE + rows.length}` : ''}`;
    $('#published-page').textContent = `Page ${pageNumber + 1} of ${pages}`;
    $('#published-previous').disabled = pageNumber === 0; $('#published-next').disabled = pageNumber + 1 >= pages;
  }
  function applyFilters() {
    if (!record) return;
    clearEpisode(); pageNumber = 0;
    const task = $('#published-task').value, instance = $('#published-instance').value, phase = $('#published-phase').value;
    filtered = record.episodes.map((episode, index) => ({ episode, index })).filter(({ episode }) =>
      (!task || episode.task === task) && (!instance || setting(episode) === instance) && (!phase || episode.phase === phase)
      && (mode !== 'videos' || episode.phase === 'exam' && fileURL(episode.video_path)));
    renderPage(); if (filtered.length) selectEpisode(filtered[0].index, false);
  }
  function updateView(updateURL = true) {
    $('#published-view-all').setAttribute('aria-pressed', String(mode === 'all'));
    $('#published-view-videos').setAttribute('aria-pressed', String(mode === 'videos'));
    $('#published-phase').disabled = mode === 'videos';
    $('#published-scope').textContent = mode === 'videos' ? 'Exam videos only: up to 240 videos from the scored exam episodes. Practice episodes have no published videos.'
      : 'All 720 episodes: 480 practice and 240 exam records. Videos cover exam episodes only.';
    if (updateURL && record) setLocation({ team: record.team_display_name, record: record.record_id, view: mode === 'videos' ? 'videos' : '' });
    applyFilters();
  }
  function selectEpisode(index, focus = true) {
    clearEpisode(); if (!record || !record.episodes[index]) return;
    selected = index; const episode = record.episodes[index];
    $('#published-episode-detail').hidden = false;
    $('#published-episode-phase').textContent = `${phaseName(episode)} ${episode.phase_episode_number}`;
    $('#published-episode-title').textContent = episode.task;
    $('#published-episode-instance').textContent = `${settingName(episode)} · ${episode.instance}`;
    $('#published-episode-result').textContent = episode.passed ? 'Passed' : 'Not passed'; $('#published-episode-result').dataset.passed = String(episode.passed);
    const values = [['Episode score', score(episode.score)], ['Steps', number(episode.steps)], ['Simulation time (s)', number(episode.sim_time_sec)],
      ['Wall time (s)', number(episode.wall_time_sec)], ['Video frames', number(episode.video_frames)], ['Termination', episode.termination_reason || '—']];
    const details = $('#published-episode-values'); details.replaceChildren();
    for (const [label, value] of values) { const group = node('div'); group.append(node('dt', label), node('dd', value)); details.append(group); }
    const hasVideo = episode.phase === 'exam' && fileURL(episode.video_path);
    $('#published-load-video').hidden = !hasVideo; setLink('#published-download-video', hasVideo ? episode.video_path : null);
    message('#published-video-state', episode.phase === 'practice' ? 'Practice videos are not included. This episode’s records are available below.'
      : hasVideo ? 'Select Load video to load this exam recording.' : 'No video is published for this exam episode.');
    const selector = $('#published-file'); selector.replaceChildren();
    for (const [key, label] of files) if (fileURL(episode[key])) selector.add(new Option(label, key));
    selector.disabled = !selector.options.length; $('#published-preview-file').disabled = !selector.options.length;
    setLink('#published-download-file', selector.value ? episode[selector.value] : null);
    message('#published-file-state', selector.options.length ? '' : 'No detailed files are published for this episode.');
    renderPage(); if (focus) $('#published-episode-detail').focus();
  }
  async function loadRecord(id, updateURL = false) {
    abort('search'); clearRecord(); $('#published-retry').hidden = true; $('#published-search-button').disabled = false;
    if (!ID.test(id)) { message('#published-state', 'The record link is missing or invalid.', true); return; }
    const operation = begin('index'); retry = () => loadRecord(id);
    message('#published-state', 'Loading published evaluation records…');
    try {
      const data = await get(`${base}/api/v1/published-records/${encodeURIComponent(id)}`, operation, 'json', 8 * 1024 * 1024);
      if (!current('index', operation)) return;
      record = validateRecord(data, id); showSummary();
      if (updateURL) setLocation({ team: record.team_display_name, record: id, view: mode === 'videos' ? 'videos' : '' });
      message('#published-state', 'Published records loaded. Video and log files load only when you request them.');
      $('#published-match-list').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.record === id)));
    } catch (error) {
      if (controllers.get('index') !== operation || error.name === 'AbortError' && !operation.timedOut) return;
      message('#published-state', errorText(error, operation), true); $('#published-retry').hidden = false;
    }
  }
  async function searchTeam(team, updateURL = true) {
    abort('search'); clearRecord(); $('#published-matches').hidden = true; $('#published-match-list').replaceChildren(); $('#published-retry').hidden = true;
    $('#published-search-button').disabled = false;
    team = String(team || '').trim(); $('#published-team').value = team;
    if (!team) { if (updateURL) setLocation({}); message('#published-state', 'Enter a team name to find its published records.'); return; }
    if (team.length > 120) { message('#published-state', 'Enter a team name of 120 characters or fewer.', true); return; }
    if (updateURL) setLocation({ team, view: mode === 'videos' ? 'videos' : '' });
    const operation = begin('search'); retry = () => searchTeam(team, false);
    $('#published-search-button').disabled = true; message('#published-state', 'Searching published evaluations…');
    try {
      const data = await get(`${base}/api/v1/published-records?team_name=${encodeURIComponent(team)}`, operation, 'json', 1024 * 1024);
      if (!current('search', operation)) return;
      if (!Array.isArray(data?.records) || data.records.some(item => !item || !ID.test(item.record_id) || normalizeTeam(item.team_display_name) !== normalizeTeam(team))) throw new Error('The records service returned an invalid team search response.');
      if (!data.records.length) { message('#published-state', `No published evaluations match “${team}”. Use the full team name shown on the leaderboard.`); return; }
      const list = $('#published-match-list');
      for (const item of data.records) {
        const button = node('button', undefined, 'published-match'), copy = node('span'); button.type = 'button'; button.dataset.record = item.record_id; button.setAttribute('aria-pressed', 'false');
        copy.append(node('strong', item.model_id), node('small', `${item.team_display_name} · ${item.episode_count ?? '—'} episodes · ${item.video_count ?? '—'} exam videos`));
        button.append(copy, node('span', score(item.score), 'published-match-score')); list.append(button);
      }
      $('#published-matches').hidden = false; message('#published-state', `${data.records.length} published ${data.records.length === 1 ? 'evaluation' : 'evaluations'} found. Choose a model to view its records.`);
      if (data.records.length === 1) await loadRecord(data.records[0].record_id);
    } catch (error) {
      if (controllers.get('search') !== operation || error.name === 'AbortError' && !operation.timedOut) return;
      message('#published-state', errorText(error, operation), true); $('#published-retry').hidden = false;
    } finally { if (controllers.get('search') === operation) $('#published-search-button').disabled = false; }
  }
  $('#published-team-form').addEventListener('submit', event => { event.preventDefault(); searchTeam($('#published-team').value); });
  $('#published-match-list').addEventListener('click', event => { const button = event.target.closest('[data-record]'); if (button) loadRecord(button.dataset.record, true); });
  $('#published-retry').addEventListener('click', () => retry?.());
  for (const id of ['#published-task', '#published-instance', '#published-phase']) $(id).addEventListener('change', applyFilters);
  $('#published-view-all').addEventListener('click', () => { mode = 'all'; $('#published-phase').value = ''; updateView(); });
  $('#published-view-videos').addEventListener('click', () => { mode = 'videos'; $('#published-phase').value = 'exam'; updateView(); });
  $('#published-previous').addEventListener('click', () => { clearEpisode(); pageNumber--; renderPage(); });
  $('#published-next').addEventListener('click', () => { clearEpisode(); pageNumber++; renderPage(); });
  $('#published-episodes').addEventListener('click', event => { const button = event.target.closest('[data-episode]'); if (button) selectEpisode(Number(button.dataset.episode)); });
  $('#published-file').addEventListener('change', () => { closePreview(); setLink('#published-download-file', record?.episodes[selected]?.[$('#published-file').value]); });
  $('#published-close-preview').addEventListener('click', closePreview);
  $('#published-preview-file').addEventListener('click', async () => {
    const episode = record?.episodes[selected], key = $('#published-file').value, url = fileURL(episode?.[key]); if (!url) return;
    const operation = begin('file'), snapshot = selection, version = generation;
    $('#published-preview-file').disabled = true; $('#published-preview').hidden = true;
    message('#published-file-state', 'Loading file preview…');
    try {
      const result = await get(url, operation, 'file', LIMIT);
      if (!current('file', operation) || snapshot !== selection || version !== generation) return;
      $('#published-file-text').textContent = result.text; $('#published-preview-name').textContent = $('#published-file option:checked').textContent;
      $('#published-preview').hidden = false;
      message('#published-file-state', result.truncated ? 'Showing only the first 256 KB. Download the complete file for the remaining content.' : `Complete file preview · ${result.bytes.toLocaleString()} bytes.`);
    } catch (error) {
      if (controllers.get('file') !== operation || snapshot !== selection || version !== generation || error.name === 'AbortError' && !operation.timedOut) return;
      message('#published-file-state', errorText(error, operation), true);
    } finally { if (controllers.get('file') === operation) $('#published-preview-file').disabled = false; }
  });
  $('#published-load-video').addEventListener('click', async () => {
    const episode = record?.episodes[selected], url = episode?.phase === 'exam' && fileURL(episode.video_path); if (!url) return;
    releaseVideo(); const operation = begin('video'), snapshot = selection, version = generation;
    $('#published-load-video').disabled = true; message('#published-video-state', 'Checking video availability…');
    try {
      await get(url, operation, 'video');
      if (!current('video', operation) || snapshot !== selection || version !== generation) return;
      const video = $('#published-video');
      video.onerror = () => { if (snapshot === selection && version === generation) message('#published-video-state', 'The video could not be played. Try loading it again or download the recording.', true); };
      video.src = url; video.hidden = false; video.load();
      message('#published-video-state', 'Video ready. Select Play to start the recording.');
    } catch (error) {
      if (controllers.get('video') !== operation || snapshot !== selection || version !== generation || error.name === 'AbortError' && !operation.timedOut) return;
      message('#published-video-state', errorText(error, operation), true);
    } finally { if (controllers.get('video') === operation) $('#published-load-video').disabled = false; }
  });
  function navigate() {
    const query = new URLSearchParams(location.search); mode = query.get('view') === 'videos' ? 'videos' : 'all';
    $('#published-matches').hidden = true; $('#published-match-list').replaceChildren();
    $('#published-team').value = (query.get('team') || '').trim();
    if (query.has('record')) loadRecord(query.get('record')); else searchTeam(query.get('team') || '', false);
  }
  window.addEventListener('popstate', navigate);
  window.addEventListener('pagehide', () => { for (const name of controllers.keys()) abort(name); releaseVideo(); });
  window.addEventListener('pageshow', event => { if (event.persisted) navigate(); });
  try {
    const configured = document.querySelector('meta[name="website-api"]')?.content.trim() || document.querySelector('meta[name="website-rankings"]')?.content.trim();
    const origin = new URL(configured);
    const localPreview = origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) && origin.origin === location.origin;
    if ((!localPreview && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error();
    base = origin.origin; navigate();
  } catch { $('#published-search-button').disabled = true; message('#published-state', 'The public records service is not configured correctly.', true); }
})();
