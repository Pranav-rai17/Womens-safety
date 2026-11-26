export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

const USER_TOKEN_KEY = "safeguard_user_token";
const USER_PROFILE_KEY = "safeguard_user_profile";
const ADMIN_TOKEN_KEY = "safeguard_admin_token";

export interface EmergencyContact {
  name: string;
  phone: string;
  relation?: string;
}

export interface UserProfile {
  id: string;
  phone: string;
  full_name: string;
  has_safe_pin: boolean;
  has_duress_pin: boolean;
  emergency_contacts: EmergencyContact[];
}

export function getUserToken(): string | null {
  return localStorage.getItem(USER_TOKEN_KEY);
}

export function setUserSession(token: string, user: UserProfile) {
  localStorage.setItem(USER_TOKEN_KEY, token);
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
}

export function getStoredUser(): UserProfile | null {
  const raw = localStorage.getItem(USER_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function clearUserSession() {
  localStorage.removeItem(USER_TOKEN_KEY);
  localStorage.removeItem(USER_PROFILE_KEY);
}

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  role: "USER" | "ADMIN" | "NONE" = "USER"
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && !(options.body instanceof Blob)) {
    headers.set("Content-Type", "application/json");
  }

  if (role === "USER") {
    const token = getUserToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } else if (role === "ADMIN") {
    const token = getAdminToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.detail) detail = err.detail;
    } catch {
      // ignore json parse error
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}
