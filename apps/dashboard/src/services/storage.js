export function readSession() {
  try {
    return JSON.parse(localStorage.getItem("brayano_session") || "null");
  } catch {
    return null;
  }
}

export function writeSession(session) {
  localStorage.setItem("brayano_session", JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem("brayano_session");
}

export function readOrganizationId() {
  return localStorage.getItem("brayano_org") || null;
}

export function writeOrganizationId(id) {
  if (id) {
    localStorage.setItem("brayano_org", id);
  }
}
