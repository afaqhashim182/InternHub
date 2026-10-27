import { api } from './api.js';
import { el, createView, toast, confirmDialog, withBusy, showFormError, clearFieldErrors } from './ui.js';

const view = createView(document.getElementById('projects-view'));
let editingId = null;

const dom = {
  tbody: document.getElementById('projects-tbody'),
  addButton: document.getElementById('add-project-btn'),
  dialog: document.getElementById('project-dialog'),
  form: document.getElementById('project-form'),
  formTitle: document.getElementById('project-form-title'),
  submitButton: document.getElementById('project-submit'),
};

const field = (name) => dom.form.elements.namedItem(name);
const cell = (label, ...children) => el('td', { attrs: { 'data-label': label } }, children);

function loadProjects() {
  return view.load({
    fetcher: (signal) => api.listProjects({ signal }).then((result) => result.data),
    render: renderProjects,
    isEmpty: (projects) => projects.length === 0,
    emptyMessage: 'No projects yet — create the first one.',
  });
}

function renderProjects(projects) {
  dom.tbody.replaceChildren(...projects.map(renderRow));
}

function renderRow(project) {
  const editButton = el('button', { className: 'btn btn--small', text: 'Edit', attrs: { type: 'button' } });
  const deleteButton = el('button', { className: 'btn btn--small btn--danger-ghost', text: 'Delete', attrs: { type: 'button' } });
  editButton.addEventListener('click', () => openForm(project));
  deleteButton.addEventListener('click', () => deleteProject(project, deleteButton));

  return el('tr', {}, [
    cell('Title', el('strong', { text: project.title })),
    cell('Description', project.description || el('span', { className: 'muted', text: '—' })),
    cell('Max score', String(project.max_score)),
    cell('Assigned', String(project.submission_count)),
    cell('Avg score', project.average_score === null ? el('span', { className: 'muted', text: '—' }) : String(project.average_score)),
    el('td', { className: 'table__actions', attrs: { 'data-label': 'Actions' } }, [editButton, deleteButton]),
  ]);
}

/** Opens the dialog for a new project (no argument) or to edit `project` (PUT). */
function openForm(project = null) {
  editingId = project ? project.id : null;
  dom.form.reset();
  clearFieldErrors(dom.form);
  dom.formTitle.textContent = project ? `Edit "${project.title}"` : 'New project';
  dom.submitButton.textContent = project ? 'Save changes' : 'Create project';
  if (project) {
    field('title').value = project.title;
    field('description').value = project.description || '';
    field('max_score').value = project.max_score;
  }
  dom.dialog.showModal();
  field('title').focus();
}

async function submitForm(event) {
  event.preventDefault();
  clearFieldErrors(dom.form);
  const id = editingId;
  const maxScore = field('max_score').value;
  const data = {
    title: field('title').value.trim(),
    description: field('description').value.trim() || null,
    max_score: maxScore === '' ? null : Number(maxScore),
  };
  try {
    await withBusy(dom.submitButton, () => (id ? api.replaceProject(id, data) : api.createProject(data)));
    dom.dialog.close();
    toast(id ? 'Project updated' : 'Project created', 'success');
    await loadProjects();
  } catch (error) {
    showFormError(dom.form, error);
  }
}

async function deleteProject(project, button) {
  const count = project.submission_count;
  const confirmed = await confirmDialog({
    title: 'Delete project?',
    message: count > 0
      ? `"${project.title}" and its ${count} submission${count === 1 ? '' : 's'} will be permanently removed.`
      : `"${project.title}" will be permanently removed.`,
    confirmLabel: 'Delete project',
  });
  if (!confirmed) return;

  try {
    await withBusy(button, () => api.deleteProject(project.id));
    toast(`"${project.title}" was deleted`, 'success');
    await loadProjects();
  } catch (error) {
    toast(error.message);
  }
}

dom.addButton.addEventListener('click', () => openForm());
dom.form.addEventListener('submit', submitForm);
dom.form.querySelector('[data-action="cancel"]').addEventListener('click', () => dom.dialog.close());

loadProjects();
