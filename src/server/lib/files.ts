import type { Context } from 'hono';
import { apiError } from './errors';

const ALLOWED_IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;

export function safeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'source.pdf';
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'PDF source';
}

export interface UploadOptions {
  maxBytes: number;
  /** Form field the file is posted under. Defaults to "file". */
  field?: string;
  /** Return an error message to reject the file, or null to accept it. */
  validate?: (file: File) => string | null;
}

export interface UploadedFile {
  form: FormData;
  file: File;
  bytes: ArrayBuffer;
  contentType: string;
  ext: string;
}

/**
 * Shared multipart upload reader for every file-upload endpoint. Parses the
 * form, validates the field is a File within `maxBytes`, runs an optional
 * type check, and returns the file + its bytes — or an `apiError` Response the
 * caller should return as-is.
 */
export async function readUploadedFile(
  c: Context<any>,
  { maxBytes, field = 'file', validate }: UploadOptions,
): Promise<UploadedFile | Response> {
  const form = await c.req.formData();
  const file = form.get(field);
  if (!(file instanceof File)) {
    return apiError(c, 'no_file', `Attach a file under the "${field}" field.`, 400);
  }
  if (file.size > maxBytes) {
    return apiError(c, 'too_large', `File must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`, 413);
  }
  if (validate) {
    const message = validate(file);
    if (message) return apiError(c, 'invalid_type', message, 400);
  }
  const contentType = file.type || 'application/octet-stream';
  return { form, file, bytes: await file.arrayBuffer(), contentType, ext: contentType.split('/')[1] ?? '' };
}

export async function readUploadedImage(
  c: Context<any>,
  maxBytes: number,
): Promise<{ bytes: ArrayBuffer; ext: string; contentType: string } | Response> {
  const result = await readUploadedFile(c, {
    maxBytes,
    validate: (file) =>
      ALLOWED_IMAGE_TYPES.test(file.type || '') ? null : 'Use PNG, JPEG, WebP, or GIF.',
  });
  if (result instanceof Response) return result;
  return { bytes: result.bytes, ext: result.ext, contentType: result.contentType };
}
