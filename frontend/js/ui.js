// Shared DOM helpers. Everything here builds nodes with createElement and sets
// text with textContent - API/user data never goes through innerHTML.
import { ApiError } from './api.js';

/**
 * Create an element. `options`: className, text, attrs (setAttribute), on (event listeners).
 * `children` may contain nodes or strings (strings are inserted as text, not HTML).
 */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs || {})) {
    if (value !== undefined && value !== null && value !== false) node.setAttribute(name, value === true ? '' : value);
  }
  for (const [event, handler] of Object.entries(options.on || {})) node.addEventListener(event, handler);
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/** Only allow http(s) links, so a stored "javascript:" URL can never become clickable. */
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** An <a> for a safe URL, or plain text if the URL is not http(s). */
export function externalLink(url, label = url) {
  const href = safeUrl(url);
  if (!href) return el('span', { text: url });
  return el('a', { text: label, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

export function badge(text, variant = text) {
  return el('span', { className: `badge badge--${variant}`, text: capitalize(text) });
}

/* ---------- Toasts ---------- */

export function toast(message, type = 'error') {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = el('div', { className: 'toast-region', attrs: { id: 'toast-region', 'aria-live': 'polite' } });
    document.body.append(region);
  }
  const item = el('div', { className: `toast toast--${type}`, text: message, attrs: { role: type === 'error' ? 'alert' : 'status' } });
  region.append(item);
  setTimeout(() => {
    item.classList.add('toast--leaving');
    setTimeout(() => item.remove(), 300);
  }, 4000);
}

/* ---------- In-page confirm dialog (replaces window.confirm) ---------- */

export function confirmDialog({ title, message, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    const cancelButton = el('button', { className: 'btn btn--ghost', text: 'Cancel', attrs: { type: 'button' } });
    const confirmButton = el('button', { className: 'btn btn--danger', text: confirmLabel, attrs: { type: 'button' } });
    const dialog = el('dialog', { className: 'modal modal--small', attrs: { 'aria-labelledby': 'confirm-title' } }, [
      el('h2', { className: 'modal__title', text: title, attrs: { id: 'confirm-title' } }),
      el('p', { className: 'modal__text', text: message }),
      el('div', { className: 'modal__actions' }, [cancelButton, confirmButton]),
    ]);

    const finish = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault(); // Esc key
      finish(false);
    });

    document.body.append(dialog);
    dialog.showModal();
    cancelButton.focus();
  });
}

/* ---------- Forms ---------- */

/** Disable `button` while `task` runs so a request can't be sent twice. */
export async function withBusy(button, task) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function clearFieldErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((slot) => { slot.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((field) => field.removeAttribute('aria-invalid'));
}

/**
 * 422/409 errors with field details are shown next to the matching inputs
 * (elements with data-error-for="<field>"); anything else becomes a toast.
 */
export function showFormError(form, error) {
  clearFieldErrors(form);
  if (error instanceof ApiError && (error.status === 422 || error.status === 409)) {
    let firstInvalid = null;
    for (const { field, message } of error.details) {
      const slot = field && form.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
      if (!slot) continue;
      slot.textContent = message;
      const input = form.elements.namedItem(field);
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        firstInvalid = firstInvalid || input;
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
  }
  toast(error.message || 'Something went wrong');
}

/** <option> elements from [{ value, label }] - text set safely. */
export function fillSelect(select, options, { placeholder } = {}) {
  select.replaceChildren();
  if (placeholder !== undefined) select.append(el('option', { text: placeholder, attrs: { value: '' } }));
  for (const { value, label } of options) select.append(el('option', { text: label, attrs: { value } }));
}

/* ---------- Data views: loading / empty / error / content ---------- */

/**
 * Manages one data region. The root must contain:
 *   [data-role="spinner"], [data-role="status"], [data-role="content"]
 * Every load shows the spinner, then exactly one of: content, empty message, or
 * error with a Retry button. The spinner is always hidden again in `finally`.
 */
export function createView(root) {
  const spinner = root.querySelector('[data-role="spinner"]');
  const status = root.querySelector('[data-role="status"]');
  const content = root.querySelector('[data-role="content"]');
  let controller = null;

  function showStatus(kind, message, onRetry) {
    const children = [el('p', { className: 'state__message', text: message })];
    if (onRetry) {
      children.push(el('button', { className: 'btn', text: 'Retry', attrs: { type: 'button' }, on: { click: onRetry } }));
    }
    status.className = `state state--${kind}`;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    status.replaceChildren(el('div', { className: 'state__icon', attrs: { 'aria-hidden': 'true' } }), ...children);
    status.hidden = false;
    content.hidden = true;
  }

  function start() {
    root.classList.add('is-loading');
    spinner.hidden = false;
  }

  function finish() {
    root.classList.remove('is-loading');
    spinner.hidden = true;
  }

  /** Show already-fetched data (or the empty state). */
  function present(data, { render, isEmpty = () => false, emptyMessage = 'Nothing here yet.' }) {
    if (isEmpty(data)) {
      showStatus('empty', emptyMessage);
      return;
    }
    status.hidden = true;
    content.hidden = false;
    render(data);
  }

  function fail(error, onRetry) {
    showStatus('error', error.message || 'Something went wrong.', onRetry);
  }

  /** Fetch + present. A newer load() aborts an older one still in flight. */
  async function load(options) {
    if (controller) controller.abort();
    const current = (controller = new AbortController());
    start();
    try {
      const data = await options.fetcher(current.signal);
      if (current.signal.aborted) return;
      present(data, options);
    } catch (error) {
      if (error.name === 'AbortError') return;
      fail(error, () => load(options));
    } finally {
      if (controller === current) {
        controller = null;
        finish();
      }
    }
  }

  return { load, start, finish, present, fail };
}
