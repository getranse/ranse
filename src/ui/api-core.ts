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

export async function uploadFile(
  path: string,
  file: File,
): Promise<{ ok: boolean; url: string }> {
  const form = new FormData();
  form.append('file', file);
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

export async function uploadKnowledgePdf(
  file: File,
  title?: string,
): Promise<{ ok: boolean; id: string; chunks: number; vectorized: boolean }> {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);
  const res = await fetch('/api/knowledge/pdf', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
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
