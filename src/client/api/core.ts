export class ApiRequestError extends Error {
  code: string;
  status: number;
  details?: unknown;
  requestId?: string;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

async function errorFromResponse(res: Response) {
  return res.json().catch(() => ({ error: 'http_error', message: res.statusText }));
}

/**
 * Multipart upload helper. Appends `file` (plus any extra string `fields`) and
 * POSTs as FormData. Generic over the response shape; defaults to `{ ok, url }`.
 */
export async function uploadFile<T = { ok: boolean; url: string }>(
  path: string,
  file: File,
  fields?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (fields) {
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
  }
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'include' });
  if (!res.ok) {
    const body: any = await errorFromResponse(res);
    throw new ApiRequestError({
      code: body?.error ?? 'http_error',
      message: body?.message ?? `HTTP ${res.status}`,
      status: res.status,
      details: body?.details,
      requestId: body?.requestId,
    });
  }
  return res.json();
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
  });
  if (!res.ok) {
    const body: any = await errorFromResponse(res);
    throw new ApiRequestError({
      code: body?.error ?? 'http_error',
      message: body?.message ?? body?.error ?? `HTTP ${res.status}`,
      status: res.status,
      details: body?.details,
      requestId: body?.requestId,
    });
  }
  return res.json();
}
