import { api } from './api.js';
import { TRACKS, PAGE_SIZE } from './config.js';
import {
  el, createView, debounce, toast, confirmDialog, withBusy,
  showFormError, clearFieldErrors, fillSelect, badge, capitalize,
} from './ui.js';

const state = { page: 1, track: '', search: '', mentors: [], editingId: null };

const views = {
  stats: createView(document.getElementById('stats-view')),
  leaderboard: createView(document.getElementById('leaderboard-view')),
  projects: createView(document.getElementById('projects-view')),
  interns: createView(document.getElementById('interns-view')),
};

const dom = {
  tbody: document.getElementById('interns-tbody'),
  pagination: document.getElementById('pagination'),
  leaderboard: document.getElementById('leaderboard-list'),
  projectList: document.getElementById('project-list'),
  trackFilter: document.getElementById('track-filter'),
  searchInput: document.getElementById('search-input'),
  addButton: document.getElementById('add-intern-btn'),
  dialog: document.getElementById('intern-dialog'),
  form: document.getElementById('intern-form'),
  formTitle: document.getElementById('intern-form-title'),
  submitButton: document.getElementById('intern-submit'),
};

const trackOptions = TRACKS.map((t) => ({ value: t, label: capitalize(t) }));
const internsQuery = () => ({ page: state.page, limit: PAGE_SIZE, track: state.track, search: state.search });
const formatScore = (value) => (value === null || value === undefined ? '—' : String(value));

/* ---------- Loading ---------- */

// First paint: stats, interns, projects (and mentors for the form) in parallel.
async function loadDashboard() {
  const all = Object.values(views);
  all.forEach((view) => view.start());
  try {
    const [stats, interns, projects, mentors] = await Promise.all([
      api.getStats(),
      api.listInterns(internsQuery()),
      api.listProjects(),
      api.listMentors(),
    ]);
    state.mentors = mentors.data;
    presentStats(stats);
    views.projects.present(projects.data, projectsOptions);
    views.interns.present(interns, internsOptions());
  } catch (error) {
    all.forEach((view) => view.fail(error, loadDashboard));
  } finally {
    all.forEach((view) => view.finish());
  }
}

function presentStats(stats) {
  views.stats.present(stats, { render: renderStats });
  views.leaderboard.present(stats.leaderboard, {
    render: renderLeaderboard,
    isEmpty: (rows) => rows.length === 0,
    emptyMessage: 'No scored submissions yet.',
  });
}

// Stat cards and leaderboard share one request, so they load together.
async function loadStats() {
  const pair = [views.stats, views.leaderboard];
  pair.forEach((view) => view.start());
  try {
    presentStats(await api.getStats());
  } catch (error) {
    pair.forEach((view) => view.fail(error, loadStats));
  } finally {
    pair.forEach((view) => view.finish());
  }
}

const projectsOptions = {
  render: renderProjects,
  isEmpty: (rows) => rows.length === 0,
  emptyMessage: 'No projects yet.',
};

function loadProjects() {
  return views.projects.load({ fetcher: (signal) => api.listProjects({ signal }).then((r) => r.data), ...projectsOptions });
}

function internsOptions() {
  return {
    render: renderInterns,
    isEmpty: (result) => result.data.length === 0,
    emptyMessage: state.track || state.search ? 'No interns match your filters.' : 'No interns yet — add the first one.',
  };
}

function loadInterns() {
  return views.interns.load({ fetcher: (signal) => api.listInterns(internsQuery(), { signal }), ...internsOptions() });
}

/** After any write: refresh everything the change can affect, without a page reload. */
function refreshAfterChange() {
  return Promise.all([loadInterns(), loadStats(), loadProjects()]);
}

/* ---------- Rendering ---------- */

function renderStats(stats) {
  for (const node of document.querySelectorAll('[data-stat]')) {
    node.textContent = formatScore(stats[node.dataset.stat]);
  }
}

function renderLeaderboard(rows) {
  dom.leaderboard.replaceChildren(
    ...rows.map((row, index) =>
      el('li', { className: 'leaderboard__item' }, [
        el('span', { className: 'leaderboard__rank', text: index + 1 }),
        el('a', { className: 'leaderboard__name', text: row.name, attrs: { href: `intern.html?id=${encodeURIComponent(row.id)}` } }),
        badge(row.track),
        el('span', { className: 'leaderboard__score', text: row.averageScore }),
      ])
    )
  );
}

function renderProjects(projects) {
  dom.projectList.replaceChildren(
    ...projects.map((project) =>
      el('li', { className: 'project-list__item' }, [
        el('span', { className: 'project-list__title', text: project.title }),
        el('span', {
          className: 'muted small',
          text: `max ${project.max_score} · ${project.submission_count} assigned · avg ${formatScore(project.average_score)}`,
        }),
      ])
    )
  );
}

const cell = (label, ...children) => el('td', { attrs: { 'data-label': label } }, children);

function renderInterns(result) {
  dom.tbody.replaceChildren(...result.data.map(renderInternRow));
  renderPagination(result);
}

function renderInternRow(intern) {
  const editButton = el('button', { className: 'btn btn--small', text: 'Edit', attrs: { type: 'button' } });
  const deleteButton = el('button', { className: 'btn btn--small btn--danger-ghost', text: 'Delete', attrs: { type: 'button' } });
  editButton.addEventListener('click', () => openEditForm(intern.id, editButton));
  deleteButton.addEventListener('click', () => deleteIntern(intern, deleteButton));

  return el('tr', {}, [
    cell('Name', el('a', { text: intern.name, attrs: { href: `intern.html?id=${encodeURIComponent(intern.id)}` } })),
    cell('Email', el('span', { className: 'break', text: intern.email })),
    cell('Phone', phoneCell(intern)),
    cell('Track', badge(intern.track)),
    cell('Mentor', intern.mentor_name || el('span', { className: 'muted', text: 'Unassigned' })),
    el('td', { className: 'table__actions', attrs: { 'data-label': 'Actions' } }, [editButton, deleteButton]),
  ]);
}

/** Phone with an inline "quick edit" that sends PATCH { phone } only. */
function phoneCell(intern) {
  const wrapper = el('div', { className: 'phone-cell' });

  const showValue = () => {
    const editButton = el('button', {
      className: 'link-button',
      text: 'edit',
      attrs: { type: 'button', 'aria-label': `Edit phone for ${intern.name}` },
      on: { click: showEditor },
    });
    wrapper.replaceChildren(
      intern.phone ? el('span', { text: intern.phone }) : el('span', { className: 'muted', text: '—' }),
      editButton
    );
  };

  function showEditor() {
    const input = el('input', {
      attrs: { name: 'phone', type: 'tel', maxlength: 20, value: intern.phone || '', 'aria-label': 'Phone', placeholder: 'e.g. +1 555 0100' },
    });
    const save = el('button', { className: 'btn btn--small btn--primary', text: 'Save', attrs: { type: 'submit' } });
    const cancel = el('button', { className: 'btn btn--small btn--ghost', text: 'Cancel', attrs: { type: 'button' }, on: { click: showValue } });
    const form = el('form', { className: 'inline-form', attrs: { novalidate: true } }, [
      input, save, cancel, el('span', { className: 'field__error', attrs: { 'data-error-for': 'phone' } }),
    ]);

    form.addEventListener('keydown', (event) => { if (event.key === 'Escape') showValue(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const updated = await withBusy(save, () => api.patchIntern(intern.id, { phone: input.value.trim() || null }));
        intern.phone = updated.phone;
        toast('Phone updated', 'success');
        showValue();
      } catch (error) {
        showFormError(form, error);
      }
    });

    wrapper.replaceChildren(form);
    input.focus();
    input.select();
  }

  showValue();
  return wrapper;
}

function renderPagination({ page, limit, total }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  const goTo = (target) => {
    state.page = target;
    loadInterns();
  };
  const prev = el('button', { className: 'btn btn--small', text: '← Prev', attrs: { type: 'button', disabled: page <= 1 }, on: { click: () => goTo(page - 1) } });
  const next = el('button', { className: 'btn btn--small', text: 'Next →', attrs: { type: 'button', disabled: page >= totalPages }, on: { click: () => goTo(page + 1) } });

  dom.pagination.replaceChildren(
    el('span', { className: 'muted small', text: `Showing ${first}–${last} of ${total}` }),
    el('div', { className: 'pagination__controls' }, [
      prev,
      el('span', { className: 'small', text: `Page ${page} of ${totalPages}` }),
      next,
    ])
  );
}

/* ---------- Create / edit (POST / PUT) ---------- */

function field(name) {
  return dom.form.elements.namedItem(name);
}

function openForm({ title, submitLabel, values = {} }) {
  dom.form.reset();
  clearFieldErrors(dom.form);
  fillSelect(field('mentor_id'), state.mentors.map((m) => ({ value: m.id, label: m.name })), { placeholder: 'No mentor' });
  dom.formTitle.textContent = title;
  dom.submitButton.textContent = submitLabel;

  for (const name of ['name', 'email', 'phone', 'track', 'mentor_id', 'bio', 'linkedin_url']) {
    if (values[name] !== undefined && values[name] !== null) field(name).value = values[name];
  }
  dom.dialog.showModal();
  field('name').focus();
}

function openCreateForm() {
  state.editingId = null;
  openForm({ title: 'Add intern', submitLabel: 'Create intern', values: { track: TRACKS[0] } });
}

async function openEditForm(id, trigger) {
  try {
    // The list has no profile fields, so fetch the full record before editing.
    const intern = await withBusy(trigger, () => api.getIntern(id));
    state.editingId = id;
    openForm({
      title: `Edit ${intern.name}`,
      submitLabel: 'Save changes',
      values: { ...intern, bio: intern.profile?.bio, linkedin_url: intern.profile?.linkedin_url },
    });
  } catch (error) {
    toast(error.message);
  }
}

function readForm() {
  const text = (name) => field(name).value.trim();
  return {
    name: text('name'),
    email: text('email'),
    phone: text('phone') || null,
    track: field('track').value,
    mentor_id: field('mentor_id').value ? Number(field('mentor_id').value) : null,
    bio: text('bio') || null,
    linkedin_url: text('linkedin_url') || null,
  };
}

async function submitForm(event) {
  event.preventDefault();
  clearFieldErrors(dom.form);
  const editingId = state.editingId;
  const data = readForm();
  try {
    await withBusy(dom.submitButton, () => (editingId ? api.replaceIntern(editingId, data) : api.createIntern(data)));
    dom.dialog.close();
    toast(editingId ? 'Intern updated' : 'Intern created', 'success');
    if (!editingId) state.page = 1; // newest interns are listed first
    await refreshAfterChange();
  } catch (error) {
    showFormError(dom.form, error);
  }
}

/* ---------- Delete ---------- */

async function deleteIntern(intern, button) {
  const confirmed = await confirmDialog({
    title: 'Delete intern?',
    message: `${intern.name}, their profile and all of their submissions will be permanently removed.`,
    confirmLabel: 'Delete intern',
  });
  if (!confirmed) return;

  try {
    await withBusy(button, () => api.deleteIntern(intern.id));
    toast(`${intern.name} was deleted`, 'success');
    // Step back if we just removed the last row of the last page.
    if (dom.tbody.children.length === 1 && state.page > 1) state.page -= 1;
    await refreshAfterChange();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- Wiring ---------- */

fillSelect(dom.trackFilter, trackOptions, { placeholder: 'All tracks' });
fillSelect(field('track'), trackOptions);

dom.trackFilter.addEventListener('change', () => {
  state.track = dom.trackFilter.value;
  state.page = 1;
  loadInterns();
});

dom.searchInput.addEventListener('input', debounce(() => {
  const search = dom.searchInput.value.trim();
  if (search === state.search) return;
  state.search = search;
  state.page = 1;
  loadInterns();
}, 350));

dom.addButton.addEventListener('click', openCreateForm);
dom.form.addEventListener('submit', submitForm);
dom.form.querySelector('[data-action="cancel"]').addEventListener('click', () => dom.dialog.close());

loadDashboard();
