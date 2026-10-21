// Task thumbnails are served as local screenshots from image/.
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const visualCopy = {
  observe: 'Start with the visible scene and a nominal action path. The hidden physical quantities are still at their baseline values.',
  change: 'A hidden physical parameter changes during contact — for example friction, mass, compliance, or contact geometry. The camera and state signals reveal its effects.',
  adapt: 'The policy revises its next action using the new evidence, then continues toward the same task goal without a privileged reset.'
};
const visualState = {
  observe: { index: '01', title: 'Baseline observation', subtitle: 'Initial scene · nominal path', badge: 'nominal' },
  change: { index: '02', title: 'Hidden parameter changes', subtitle: 'Concept example: contact friction μ 0.42 → 0.24', badge: 'hidden Δ' },
  adapt: { index: '03', title: 'Action is replanned', subtitle: 'Action path: nominal → revised', badge: 'adaptive' }
};
const adaptationVisual = document.querySelector('.background-visual');
const visualExplainer = document.querySelector('[data-visual-copy]');
const visualIndex = document.querySelector('[data-visual-index]');
const visualTitle = document.querySelector('[data-visual-title]');
const visualSubtitle = document.querySelector('[data-visual-subtitle]');
const visualBadge = document.querySelector('[data-visual-badge]');
document.querySelectorAll('[data-visual-step]').forEach((tab) => {
  if (!tab.classList.contains('visual-tab')) return;
  tab.addEventListener('click', () => {
    const step = tab.dataset.visualStep || 'observe';
    adaptationVisual?.setAttribute('data-visual-step', step);
    document.querySelectorAll('.visual-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (visualExplainer) visualExplainer.textContent = visualCopy[step] || visualCopy.observe;
    const state = visualState[step] || visualState.observe;
    if (visualIndex) visualIndex.textContent = state.index;
    if (visualTitle) visualTitle.textContent = state.title;
    if (visualSubtitle) visualSubtitle.textContent = state.subtitle;
    if (visualBadge) visualBadge.textContent = state.badge;
    if (adaptationVisual) adaptationVisual.dataset.visualStep = step;
    adaptationVisual?.setAttribute('aria-label', `${state.title}. ${state.subtitle}`);
  });
});

document.querySelectorAll('.details-reveal').forEach((details) => {
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    document.querySelectorAll('.details-reveal').forEach((other) => {
      if (other !== details) other.removeAttribute('open');
    });
  });
});

const citationCopyButton = document.querySelector('[data-copy-citation]');
citationCopyButton?.addEventListener('click', async () => {
  const citation = document.querySelector('[data-citation-text]')?.textContent?.trim();
  if (!citation) return;
  try {
    await navigator.clipboard.writeText(citation);
    citationCopyButton.innerHTML = 'Copied <span>✓</span>';
    window.setTimeout(() => { citationCopyButton.innerHTML = 'Copy citation <span>↗</span>'; }, 1800);
  } catch {
    citationCopyButton.innerHTML = 'Copy unavailable <span>!</span>';
  }
});

const taskModal = document.querySelector('#task-modal');
const taskModalVideo = document.querySelector('#task-modal-video');
const taskVideoMessage = document.querySelector('#task-video-message');
const taskModalKicker = document.querySelector('#task-modal-kicker');
const taskModalTitle = document.querySelector('#task-modal-title');
const taskModalDescription = document.querySelector('#task-modal-description');
const taskModalTag = document.querySelector('#task-modal-tag');
let lastTaskTrigger;
const taskModalFocusableSelector = 'button, [href], input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])';

if (taskModal) {
  taskModal.hidden = true;
  taskModal.setAttribute('aria-hidden', 'true');
}

const closeTaskModal = () => {
  if (!taskModal) return;
  taskModal.hidden = true;
  taskModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('task-modal-open');
  if (taskModalVideo) {
    taskModalVideo.pause();
    taskModalVideo.removeAttribute('src');
    taskModalVideo.load();
  }
  if (lastTaskTrigger?.isConnected) lastTaskTrigger.focus();
};

const openTaskModal = (trigger) => {
  const card = trigger.closest('.task-spec');
  if (!card || !taskModal) return;
  lastTaskTrigger = trigger;
  const id = card.dataset.taskId || '01';
  const title = card.querySelector('h3')?.textContent?.trim() || 'Task detail';
  const tag = trigger.textContent.replace('↗', '').trim();
  if (taskModalKicker) taskModalKicker.textContent = `TASK ${id} · DEMO`;
  if (taskModalTitle) taskModalTitle.textContent = title;
  if (taskModalDescription) taskModalDescription.textContent = card.dataset.description || '';
  if (taskModalTag) taskModalTag.textContent = tag;
  taskModal.hidden = false;
  taskModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('task-modal-open');
  if (taskVideoMessage) taskVideoMessage.hidden = true;
  if (taskModalVideo) {
    taskModalVideo.addEventListener('error', () => {
      if (taskVideoMessage) taskVideoMessage.hidden = false;
    }, { once: true });
    taskModalVideo.src = card.dataset.video || '';
    taskModalVideo.load();
    if (!prefersReducedMotion) window.setTimeout(() => taskModalVideo.play().catch(() => {}), 0);
  }
  taskModal.querySelector('.task-modal-close')?.focus();
};

document.querySelectorAll('[data-open-task]').forEach((trigger) => {
  trigger.addEventListener('click', () => openTaskModal(trigger));
});
document.querySelectorAll('[data-close-task]').forEach((control) => {
  control.addEventListener('click', closeTaskModal);
});
document.addEventListener('keydown', (event) => {
  if (!taskModal || taskModal.hidden) return;
  if (event.key === 'Escape') {
    closeTaskModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...taskModal.querySelectorAll(taskModalFocusableSelector)]
    .filter((element) => !element.disabled && element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
