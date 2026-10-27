// Task thumbnails are served as local screenshots from image/.
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

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
const taskModalImage = document.querySelector('#task-modal-image');
const taskModalVariation = document.querySelector('#task-modal-variation');
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

taskModalVideo?.addEventListener('error', () => {
  if (!taskModal?.hidden && !taskModalVideo.hidden && taskModalVideo.hasAttribute('src') && taskVideoMessage) {
    taskVideoMessage.hidden = false;
  }
});

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
  const tag = card.dataset.condition || '';
  const videoSource = card.dataset.video;
  const previewImage = card.querySelector('.task-preview-image');
  if (taskModalKicker) taskModalKicker.textContent = `TASK ${id} · ${videoSource ? 'DEMONSTRATION' : 'ILLUSTRATION'}`;
  if (taskModalTitle) taskModalTitle.textContent = title;
  if (taskModalDescription) taskModalDescription.textContent = card.dataset.description || '';
  if (taskModalTag) taskModalTag.textContent = tag;
  if (taskModalVariation) taskModalVariation.textContent = card.dataset.variation || '';
  if (taskModalImage) {
    taskModalImage.hidden = !!videoSource;
    taskModalImage.src = previewImage?.getAttribute('src') || '';
    taskModalImage.alt = previewImage?.alt || '';
  }
  taskModal.hidden = false;
  taskModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('task-modal-open');
  if (taskVideoMessage) taskVideoMessage.hidden = true;
  if (taskModalVideo) {
    taskModalVideo.pause();
    taskModalVideo.removeAttribute('src');
    taskModalVideo.hidden = !videoSource;
    if (videoSource) {
      taskModalVideo.src = videoSource;
      taskModalVideo.load();
      if (!prefersReducedMotion) {
        window.setTimeout(() => {
          if (!taskModal.hidden && taskModalVideo.getAttribute('src') === videoSource) taskModalVideo.play().catch(() => {});
        }, 0);
      }
    } else {
      taskModalVideo.load();
    }
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
