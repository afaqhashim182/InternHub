import { API_BASE_URL } from './config.js';

/** Error thrown for any failed API call. status 0 means the server was unreachable. */
export class ApiError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
  }
}

/**
 * The single entry point for talking to the backend.
 * Sends/receives JSON, returns the parsed body (null for 204) and throws
 * ApiError for network failures and non-2xx responses.
 */
export async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers, signal };
  if (body !== undefined) {
    // Only requests with a body declare JSON, so plain GETs stay "simple" (no preflight).
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err; // superseded request - callers ignore it
    throw new ApiError(0, 'Cannot reach the server. Check that the API is running and try again.');
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get('Content-Type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = payload && payload.error;
    throw new ApiError(
      response.status,
      (error && error.message) || `Request failed with status ${response.status}`,
      error && error.details
    );
  }
  return payload;
}

/** Builds "?a=1&b=2", skipping empty values. */
function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const id = (value) => encodeURIComponent(value);

// Thin, named wrappers - all of them go through request().
export const api = {
  getStats: (options) => request('/stats', options),

  listInterns: (params, options) => request(`/interns${toQuery(params)}`, options),
  getIntern: (internId, options) => request(`/interns/${id(internId)}`, options),
  createIntern: (data) => request('/interns', { method: 'POST', body: data }),
  replaceIntern: (internId, data) => request(`/interns/${id(internId)}`, { method: 'PUT', body: data }),
  patchIntern: (internId, data) => request(`/interns/${id(internId)}`, { method: 'PATCH', body: data }),
  deleteIntern: (internId) => request(`/interns/${id(internId)}`, { method: 'DELETE' }),

  listMentors: (options) => request('/mentors', options),

  listProjects: (options) => request('/projects', options),
  createProject: (data) => request('/projects', { method: 'POST', body: data }),
  replaceProject: (projectId, data) => request(`/projects/${id(projectId)}`, { method: 'PUT', body: data }),
  deleteProject: (projectId) => request(`/projects/${id(projectId)}`, { method: 'DELETE' }),

  createSubmission: (data) => request('/submissions', { method: 'POST', body: data }),
  updateSubmission: (submissionId, data) => request(`/submissions/${id(submissionId)}`, { method: 'PATCH', body: data }),
  deleteSubmission: (submissionId) => request(`/submissions/${id(submissionId)}`, { method: 'DELETE' }),
};
