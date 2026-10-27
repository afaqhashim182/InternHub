import { api, ApiError } from './api.js';
import { STATUSES } from './config.js';
import {
  el, createView, toast, confirmDialog, withBusy, showFormError,
  clearFieldErrors, fillSelect, badge, capitalize, externalLink,
} from './ui.js';

const internId = Number(new URLSearchParams(window.location.search).get('id'));
const view = createView(document.getElementById('intern-view'));

const dom = {
  name: document.getElementById('intern-name'),
  subtitle: document.getElementById('intern-subtitle'),
  details: document.getElementById('intern-details'),
  profile: document.getElementById('intern-profile'),
  assignForm: document.getElementById('assign-form'),
  assignSubmit: document.getElementById('assign-submit'),
  submissions: document.getElementById('submission-list'),
};

const statusOptions = STATUSES.map((s) => ({ value: s, label: capitalize(s) }));

/* ---------- Loading ---------- */

function loadIntern() {
  return view.load({
    fetcher: async (signal) => {
      if (!Number.isInteger(internId) || internId < 1) {
        throw new ApiError(400, 'This page needs a valid intern id, e.g. intern.html?id=1');
      }
      const [intern, projects] = await Promise.all([
        api.getIntern(internId, { signal }),
        api.listProjects({ signal }),
      ]);
      return { intern, projects: projects.data };
    },
    render: renderPage,
  });
}

/* ---------- Rendering ---------- */

function renderPage({ intern, projects }) {
  document.title = `${intern.name} · InternHub`;
  dom.name.textContent = intern.name;
  dom.subtitle.textContent = `${capitalize(intern.track)} intern`;

  renderDetails(intern);
  renderProfile(intern.profile);
  renderAssignForm(intern, projects);
  renderSubmissions(intern.submissions);
}

function detailRow(term, value) {
  return [el('dt', { text: term }), el('dd', {}, [value])];
}

function renderDetails(intern) {
  const mentor = intern.mentor
    ? el('span', {}, [intern.mentor.name, el('span', { className: 'muted small', text: ` · ${intern.mentor.email}` })])
    : el('span', { className: 'muted', text: 'No mentor assigned' });

  dom.details.replaceChildren(
    ...detailRow('Email', el('span', { className: 'break', text: intern.email })),
    ...detailRow('Phone', intern.phone || el('span', { className: 'muted', text: '—' })),
    ...detailRow('Track', badge(intern.track)),
    ...detailRow('Mentor', mentor),
    ...detailRow('Joined', new Date(intern.created_at).toLocaleDateString())
  );
}

function renderProfile(profile) {
  if (!profile || (!profile.bio && !profile.linkedin_url)) {
    dom.profile.replaceChildren(el('p', { className: 'muted', text: 'No profile details yet.' }));
    return;
  }
  dom.profile.replaceChildren(
    profile.bio ? el('p', { className: 'bio', text: profile.bio }) : el('p', { className: 'muted', text: 'No bio.' }),
    profile.linkedin_url ? el('p', {}, [externalLink(profile.linkedin_url, 'LinkedIn profile ↗')]) : null
  );
}

function renderAssignForm(intern, projects) {
  const assigned = new Set(intern.submissions.map((s) => s.project_id));
  const available = projects.filter((p) => !assigned.has(p.id));
  const select = dom.assignForm.elements.namedItem('project_id');

  clearFieldErrors(dom.assignForm);
  if (available.length === 0) {
    fillSelect(select, [], { placeholder: 'All projects are already assigned' });
  } else {
    fillSelect(select, available.map((p) => ({ value: p.id, label: `${p.title} (max ${p.max_score})` })), { placeholder: 'Choose a project…' });
  }
  select.disabled = available.length === 0;
  dom.assignSubmit.disabled = available.length === 0;
}

function renderSubmissions(submissions) {
  if (submissions.length === 0) {
    dom.submissions.replaceChildren(
      el('div', { className: 'state state--empty' }, [el('p', { className: 'state__message', text: 'No projects assigned yet.' })])
    );
    return;
  }
  dom.submissions.replaceChildren(...submissions.map(renderSubmission));
}

/** One submission as an editable form: status, score and GitHub URL (PATCH). */
function renderSubmission(submission) {
  const fieldBlock = (label, name, control, suffix) =>
    el('label', { className: 'field' }, [
      el('span', { className: 'field__label', text: label }),
      suffix ? el('span', { className: 'input-suffix' }, [control, el('span', { className: 'muted', text: suffix })]) : control,
      el('span', { className: 'field__error', attrs: { 'data-error-for': name } }),
    ]);

  const status = el('select', { attrs: { name: 'status' } });
  fillSelect(status, statusOptions);
  status.value = submission.status;

  const score = el('input', {
    attrs: { name: 'score', type: 'number', min: 0, max: submission.max_score, step: 1, inputmode: 'numeric', value: submission.score ?? '' },
  });
  const githubUrl = el('input', {
    attrs: { name: 'github_url', type: 'url', placeholder: 'https://github.com/…', value: submission.github_url ?? '' },
  });

  const save = el('button', { className: 'btn btn--primary btn--small', text: 'Save', attrs: { type: 'submit' } });
  const remove = el('button', { className: 'btn btn--danger-ghost btn--small', text: 'Unassign', attrs: { type: 'button' } });

  const form = el('form', { className: 'submission', attrs: { novalidate: true } }, [
    el('div', { className: 'submission__head' }, [
      el('h3', { className: 'submission__title', text: submission.project_title }),
      badge(submission.status),
    ]),
    submission.github_url ? el('p', { className: 'small break' }, [externalLink(submission.github_url)]) : null,
    el('div', { className: 'submission__fields' }, [
      fieldBlock('Status', 'status', status),
      fieldBlock('Score', 'score', score, `/ ${submission.max_score}`),
      fieldBlock('GitHub URL', 'github_url', githubUrl),
    ]),
    el('div', { className: 'submission__actions' }, [remove, save]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const data = {
      status: status.value,
      score: score.value === '' ? null : Number(score.value),
      github_url: githubUrl.value.trim() || null,
    };
    try {
      const updated = await withBusy(save, () => api.updateSubmission(submission.id, data));
      form.replaceWith(renderSubmission(updated));
      toast(`Saved "${updated.project_title}"`, 'success');
    } catch (error) {
      showFormError(form, error);
    }
  });

  remove.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Unassign project?',
      message: `"${submission.project_title}" and its score will be removed from this intern.`,
      confirmLabel: 'Unassign',
    });
    if (!confirmed) return;
    try {
      await withBusy(remove, () => api.deleteSubmission(submission.id));
      toast('Project unassigned', 'success');
      await loadIntern();
    } catch (error) {
      toast(error.message);
    }
  });

  return form;
}

/* ---------- Assign (POST /submissions) ---------- */

dom.assignForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(dom.assignForm);
  const projectId = dom.assignForm.elements.namedItem('project_id').value;
  try {
    await withBusy(dom.assignSubmit, () =>
      api.createSubmission({ intern_id: internId, project_id: projectId ? Number(projectId) : null })
    );
    toast('Project assigned', 'success');
    await loadIntern();
  } catch (error) {
    showFormError(dom.assignForm, error);
  }
});

loadIntern();
