// Owner-scoped task and video APIs. Production media always uses the website gateway.
(() => {
  'use strict';
  const api = window.ReactManipAPI, $ = selector => document.querySelector(selector);
  const taskRoot = $('#task-records'), videoRoot = $('#video-records');
  if (!taskRoot || !videoRoot) return;
  let selection = null, generation = 0, tasksLoaded = false, videosLoaded = false, nextCursor = null;
  const controllers = new Map(), expiryTimers = new Set(), videoIds = new Set();
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const message = (element, text, error = false) => { element.textContent = text; element.dataset.state = error ? 'error' : ''; };
  const stop = key => { controllers.get(key)?.abort(); controllers.delete(key); };
  const begin = key => { stop(key); const controller = new AbortController(); controllers.set(key, controller); return controller; };
  const release = video => { video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true; };
  const releaseAll = () => { videoRoot.querySelectorAll('video').forEach(release); for (const timer of expiryTimers) clearTimeout(timer); expiryTimers.clear(); };
  const reset = () => {
    generation++; selection = null;
    for (const key of controllers.keys()) stop(key);
    releaseAll(); taskRoot.open = false; videoRoot.open = false;
    $('#task-records-list').replaceChildren(); $('#video-records-list').replaceChildren();
    message($('#tasks-state'), 'Open to view task results.'); message($('#videos-state'), 'Open to view private video records.');
    tasksLoaded = false; videosLoaded = false; nextCursor = null; videoIds.clear();
    $('#record-submission-info')?.replaceChildren();
    $('#videos-load-more').hidden = true; $('#videos-load-more').disabled = false;
  };
  const current = context => selection && selection.id === context.id && generation === context.generation;
  const expires = item => api.date(item.expires_at ?? item.videos_expires_at ?? selection?.evaluation?.videos_expires_at);
  const expired = item => { const value = expires(item); return value !== null && value.getTime() <= Date.now(); };
  const loadTasks = async () => {
    if (!selection || !taskRoot.open) return;
    const context = { id: selection.id, generation }, controller = begin('tasks');
    message($('#tasks-state'), 'Loading task results…');
    try {
      const payload = await api.request(`/evaluations/${encodeURIComponent(context.id)}/tasks`, { signal: controller.signal });
      if (!current(context) || controller.signal.aborted) return;
      const rows = api.rows(payload, 'tasks'), table = node('table', undefined, 'task-results-table');
      const head = node('thead'), headRow = node('tr');
      for (const label of ['Task', 'Status', 'Episodes', 'Protocol score']) { const th = node('th', label); th.scope = 'col'; headRow.append(th); }
      head.append(headRow); table.append(head); const body = node('tbody');
      for (const task of rows) {
        const row = node('tr'); const count = Number.isInteger(task.completed_episodes) ? `${task.completed_episodes}/45` : '—';
        const score = api.status(task) === 'COMPLETED' && selection.evaluation.score_kind === 'protocol' && typeof task.score === 'number' && Number.isFinite(task.score) ? task.score.toFixed(2) : '—';
        for (const value of [task.task_id ?? task.task_name ?? 'Task', api.status(task) || 'UNKNOWN', count, score]) row.append(node('td', value));
        body.append(row);
      }
      table.append(body); const wrap = node('div', undefined, 'leaderboard-table-wrap'); wrap.append(table);
      $('#task-records-list').replaceChildren(wrap); tasksLoaded = true;
      message($('#tasks-state'), rows.length ? 'Task scores aggregate the exam episodes. Practice episodes do not count toward the score.' : 'Task results are not available yet.');
    } catch (error) { if (error.name !== 'AbortError' && current(context)) message($('#tasks-state'), error.message, true); }
  };
  const createVideo = (item, context) => {
    const id = String(item.artifact_id ?? item.id ?? '');
    if (!id) throw new api.ApiError('Invalid video record.');
    const details = node('details', undefined, 'private-video'), summary = node('summary', `${item.task_id ?? 'Task'} · ${item.phase ?? 'Episode'} · ${item.episode_index ?? '—'}`);
    const state = node('p', '', 'evaluation-message'); state.setAttribute('role', 'status');
    const video = node('video'); video.controls = true; video.playsInline = true; video.preload = 'none'; video.hidden = true;
    if (!api.demo) video.crossOrigin = 'use-credentials';
    video.setAttribute('aria-label', `Evaluation video for ${item.task_id ?? 'task'}`);
    const markExpired = () => { release(video); message(state, 'This video has expired. Evaluation scores remain available.', true); };
    const describe = () => {
      const expiry = expires(item);
      if (expired(item)) { markExpired(); return false; }
      if (String(item.status || '').toUpperCase() === 'ERROR') { message(state, 'This video could not be encoded. The evaluation result is still available.', true); return false; }
      message(state, expiry ? `Private video · expires ${expiry.toLocaleString()}` : 'Private video · retained for seven days after the evaluation finishes.');
      return true;
    };
    let expiryTimer;
    const stopTimer = () => { clearTimeout(expiryTimer); expiryTimers.delete(expiryTimer); };
    details.addEventListener('toggle', () => {
      stopTimer();
      if (!details.open || !videoRoot.open || !current(context)) { release(video); return; }
      if (!describe()) return;
      try {
        video.src = api.mediaUrl(id); video.hidden = false; video.preload = 'metadata'; video.load();
        const expiry = expires(item);
        if (expiry) { expiryTimer = setTimeout(markExpired, Math.max(0, Math.min(2147483647, expiry.getTime() - Date.now()))); expiryTimers.add(expiryTimer); }
      } catch { message(state, 'This video is unavailable.', true); }
    });
    video.addEventListener('play', () => { if (expired(item)) markExpired(); });
    video.addEventListener('error', () => {
      if (!video.hasAttribute('src')) return;
      if (expired(item)) markExpired();
      else { release(video); message(state, 'This private video is unavailable. Your session may have expired; sign in again before retrying.', true); }
    });
    describe(); details.append(summary, state, video); return details;
  };
  const loadVideos = async (append = false) => {
    if (!selection || !videoRoot.open || (append && nextCursor === null)) return;
    const context = { id: selection.id, generation }, controller = begin('videos');
    const after = append ? nextCursor : '0';
    if (!append) { releaseAll(); $('#video-records-list').replaceChildren(); videoIds.clear(); }
    $('#videos-load-more').disabled = true; message($('#videos-state'), 'Loading private video records…');
    if (expired(selection.evaluation)) { message($('#videos-state'), 'These videos have expired. Evaluation scores remain available.', true); $('#videos-load-more').hidden = true; $('#videos-load-more').disabled = false; videosLoaded = true; return; }
    try {
      const payload = await api.request(`/evaluations/${encodeURIComponent(context.id)}/videos?after=${encodeURIComponent(after)}&limit=100`, { signal: controller.signal });
      if (!current(context) || controller.signal.aborted) return;
      const rows = api.rows(payload, 'videos'); nextCursor = api.cursor(payload);
      if (nextCursor === after) throw new api.ApiError('The video cursor did not advance.');
      for (const item of rows) {
        const id = String(item.artifact_id ?? item.id ?? ''); if (videoIds.has(id)) continue;
        $('#video-records-list').append(createVideo(item, context)); videoIds.add(id);
      }
      videosLoaded = true; $('#videos-load-more').hidden = nextCursor === null;
      message($('#videos-state'), videoIds.size ? 'Open a video to load it. Videos are private and expire seven days after the evaluation finishes.' : 'No videos are available on this page.');
    } catch (error) { if (error.name !== 'AbortError' && current(context)) { message($('#videos-state'), error.message, true); if (error.status === 410) { videosLoaded = true; $('#videos-load-more').hidden = true; } } }
    finally { if (current(context)) $('#videos-load-more').disabled = false; }
  };
  const updateMetadata = item => {
    let list = $('#record-submission-info');
    if (!list) { list = node('dl'); list.id = 'record-submission-info'; $('#record-detail-state').after(list); }
    list.replaceChildren();
    const metadata = item.website_metadata || {};
    for (const [label, value] of [['Profile', item.profile_id], ['Organization', metadata.organization], ['Category', metadata.submission_type], ['Email', metadata.email], [metadata.contact_method === 'wechat' ? 'WeChat' : 'Phone', metadata.contact_value]]) {
      if (value !== undefined && value !== null && value !== '') list.append(node('dt', label), node('dd', String(value)));
    }
  };
  document.addEventListener('evaluation-details-select', event => { reset(); selection = { id: event.detail.id, evaluation: event.detail.evaluation }; updateMetadata(selection.evaluation); });
  document.addEventListener('evaluation-details-update', event => {
    if (!selection || String(event.detail.evaluation_id ?? event.detail.id) !== selection.id) return;
    const changed = api.status(selection.evaluation) !== api.status(event.detail) || selection.evaluation.videos_expires_at !== event.detail.videos_expires_at;
    selection.evaluation = { ...selection.evaluation, ...event.detail }; updateMetadata(selection.evaluation);
    if (expired(selection.evaluation)) { releaseAll(); message($('#videos-state'), 'These videos have expired. Evaluation scores remain available.', true); }
    if (taskRoot.open && api.terminal(selection.evaluation)) { tasksLoaded = false; loadTasks(); }
    if (changed) { videosLoaded = false; if (videoRoot.open && !expired(selection.evaluation)) loadVideos(); }
  });
  document.addEventListener('evaluation-details-reset', reset);
  taskRoot.addEventListener('toggle', () => { if (taskRoot.open && !tasksLoaded) loadTasks(); else if (!taskRoot.open) stop('tasks'); });
  videoRoot.addEventListener('toggle', () => {
    if (!videoRoot.open) { stop('videos'); releaseAll(); videoRoot.querySelectorAll('details').forEach(details => { details.open = false; }); }
    else if (!videosLoaded) loadVideos();
  });
  $('#videos-load-more').addEventListener('click', () => loadVideos(true));
  window.addEventListener('pagehide', reset);
})();