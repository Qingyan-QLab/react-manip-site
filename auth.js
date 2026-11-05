// Session cookies are managed by the browser; account passwords stay in memory only.
(() => {
  'use strict';
  const api = window.ReactManipAPI, $ = selector => document.querySelector(selector);
  const portal = $('#evaluation-portal');
  if (portal) portal.hidden = api.configured || api.demo;
  const panel = $('#account-panel'), form = $('#login-form');
  if (!panel || !api.configured || api.demo) return;
  panel.hidden = false;
  let principal = undefined, busy = false, generation = 0;
  const message = (text, error = false) => {
    $('#account-state').textContent = text;
    $('#account-state').dataset.state = error ? 'error' : '';
  };
  const showSession = session => {
    const signedIn = session?.authenticated === true && typeof session.team_display_name === 'string';
    const next = signedIn ? session.owner_id || session.team_display_name : null;
    form.hidden = signedIn; $('#account-help').hidden = signedIn; $('#sign-out').hidden = !signedIn;
    $('#login-password').value = '';
    message(signedIn ? `Signed in as ${session.team_display_name}.` : 'Sign in to submit an evaluation or view your private records.');
    if (signedIn) {
      $('#team-name').value = session.team_display_name;
      if (!$('#records-team-name').value) $('#records-team-name').value = session.team_display_name;
    }
    if (next !== principal) {
      const initial = principal === undefined;
      principal = next;
      document.dispatchEvent(new CustomEvent('react-manip-session-change', { detail: { session: signedIn ? session : null, initial } }));
    }
  };
  const refresh = async () => {
    const current = ++generation;
    try { const session = await api.request('/session'); if (current === generation) showSession(session); }
    catch (error) {
      if (current !== generation) return;
      showSession(null);
      if (error.status !== 401) message(error.message, true);
    }
  };
  document.addEventListener('react-manip-session-expired', () => { generation++; showSession(null); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; const current = ++generation; $('#sign-in').disabled = true;
    const password = $('#login-password').value;
    $('#login-password').value = ''; message('Signing in…');
    try {
      await api.request('/login', { method: 'POST', body: { team_name: $('#login-team').value.trim(), password } });
      if (current === generation) await refresh();
    } catch (error) {
      if (current === generation) message(error.status === 401 ? 'The team name or password is incorrect.' : error.message, true);
    } finally { busy = false; $('#sign-in').disabled = false; }
  });
  $('#sign-out').addEventListener('click', async () => {
    if (busy) return;
    busy = true; $('#sign-out').disabled = true; message('Signing out…');
    try { await api.mutate('/logout'); generation++; showSession(null); }
    catch (error) { if (error.status !== 401) message(error.message, true); }
    finally { busy = false; $('#sign-out').disabled = false; }
  });
  window.addEventListener('pagehide', () => { generation++; $('#login-password').value = ''; });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  refresh();
})();
