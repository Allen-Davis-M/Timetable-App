/**
 * Thin wrapper around fetch() for the backend API.
 *
 * All calls go through the `/api` prefix, which vite.config.js proxies to
 * the FastAPI backend during local dev. Every function returns parsed JSON
 * and throws an Error with a readable message on non-2xx responses, so
 * components can just try/catch or let it bubble to a state.error field.
 *
 * Auth: the JWT from login/signup is kept in localStorage (this is a real
 * standalone app, not a sandboxed artifact, so persisting it across page
 * reloads is expected) and attached to every request automatically.
 */

const TOKEN_KEY = "timetable_auth_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ? JSON.stringify(body.detail) : detail;
    } catch {
      // response wasn't JSON; fall back to statusText
    }
    const error = new Error(`${res.status} ${detail}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });
const put = (path, body) => request(path, { method: "PUT", body: JSON.stringify(body) });
const del = (path) => request(path, { method: "DELETE" });

export const api = {
  // Auth
  signup: (data) => post("/auth/signup", data),
  login: (data) => post("/auth/login", data),
  me: () => get("/auth/me"),

  // Schools
  listSchools: () => get("/schools"),
  createSchool: (data) => post("/schools", data),

  // Subjects
  listSubjects: (schoolId) => get(`/subjects?school_id=${schoolId}`),
  createSubject: (data) => post("/subjects", data),
  updateSubject: (id, data) => put(`/subjects/${id}`, data),
  deleteSubject: (id) => del(`/subjects/${id}`),

  // Rooms
  listRooms: (schoolId) => get(`/rooms?school_id=${schoolId}`),
  createRoom: (data) => post("/rooms", data),
  deleteRoom: (id) => del(`/rooms/${id}`),

  // Periods
  listPeriods: (schoolId) => get(`/periods?school_id=${schoolId}`),
  createPeriod: (data) => post("/periods", data),
  deletePeriod: (id) => del(`/periods/${id}`),

  // Teachers
  listTeachers: (schoolId) => get(`/teachers?school_id=${schoolId}`),
  createTeacher: (data) => post("/teachers", data),
  updateTeacher: (id, data) => put(`/teachers/${id}`, data),
  deleteTeacher: (id) => del(`/teachers/${id}`),

  // Class groups (sections, grouped by `grade` for the sidebar tree)
  listClassGroups: (schoolId) => get(`/class-groups?school_id=${schoolId}`),
  createClassGroup: (data) => post("/class-groups", data),
  deleteClassGroup: (id) => del(`/class-groups/${id}`),

  // Subject requirements (nested under class groups)
  listRequirements: (classGroupId) => get(`/class-groups/${classGroupId}/requirements`),
  createRequirement: (classGroupId, data) =>
    post(`/class-groups/${classGroupId}/requirements`, data),
  updateRequirement: (id, data) => put(`/class-groups/requirements/${id}`, data),
  deleteRequirement: (id) => del(`/class-groups/requirements/${id}`),

  // Constraints
  listConstraints: (schoolId) => get(`/constraints?school_id=${schoolId}`),
  parseConstraint: (schoolId, text) => post("/constraints/parse", { school_id: schoolId, text }),
  deleteConstraint: (id) => del(`/constraints/${id}`),

  // Timetables
  generateTimetable: (schoolId) => post(`/timetables/generate?school_id=${schoolId}`),
  listTimetables: (schoolId) => get(`/timetables?school_id=${schoolId}`),
};
