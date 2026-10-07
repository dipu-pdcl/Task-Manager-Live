import { trackApiRequest } from './activityTracker';

export function getToken(): string | null {
  return null;
}

export function setToken(_token: string | null) {
  // No-op — JWT is now stored as HttpOnly cookie, not in localStorage
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, retries = 2): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!isForm && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  // Track API request as activity
  const method = options.method || 'GET';
  trackApiRequest(method, path);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  } catch (err: any) {
    // If it's a transient network glitch or dev server restart, retry idempotent/GET requests
    const isIdempotent = !options.method || options.method === 'GET' || path.includes('overview') || path.includes('heartbeat');
    if (retries > 0 && isIdempotent) {
      await new Promise((r) => setTimeout(r, 600));
      return request<T>(path, options, retries - 1);
    }
    throw new ApiError(err?.message || 'Network connection unavailable', 0);
  }

  const ct = res.headers.get('content-type') || '';
  let body: any = null;
  if (ct.includes('application/json')) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.blob().catch(() => null);
  }

  if (res.status === 401) {
    // If it's the login endpoint, throw exact credential error and do NOT dispatch logout
    if (path.startsWith('/auth/login')) {
      throw new ApiError(body?.error || 'Invalid email or password', 401);
    }
    window.dispatchEvent(new Event('auth:logout'));
    throw new ApiError(body?.error || 'Session expired. Please log in again.', 401);
  }

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | string[] | number | undefined>) => {
    const qs = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) v.forEach((x) => x !== undefined && qs.append(k, String(x)));
        else qs.append(k, String(v));
      }
    }
    const q = qs.toString();
    return request<T>(`${path}${q ? '?' + q : ''}`);
  },
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', body: formData }),
};

export async function downloadExport(path: string, filename: string) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:logout'));
    throw new ApiError('Session expired. Please log in again.', 401);
  }
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status);
  }

  // Get filename from Content-Disposition header if present
  let resolvedFilename = filename;
  const disposition = res.headers.get('content-disposition');
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match && match[1]) {
      resolvedFilename = match[1].replace(/['"]/g, '').trim();
    }
  }

  const blob = await res.blob();
  if (blob.size === 0) {
    throw new ApiError('Downloaded file is empty', 500);
  }

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = resolvedFilename;
  document.body.appendChild(a);
  a.click();

  // Defer cleanup so browser download manager has adequate time to claim the blob URL
  setTimeout(() => {
    try {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      window.URL.revokeObjectURL(url);
    } catch {
      /* ignore cleanup error */
    }
  }, 3000);
}
