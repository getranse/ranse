import type { Context } from 'hono';
import { apiError } from '../lib/errors';
import type { Ctx } from './context';

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

export async function readUploadedImage(
  c: Context<Ctx>,
  maxBytes: number,
): Promise<{ bytes: ArrayBuffer; ext: string; contentType: string } | Response> {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return apiError(c, 'no_file', 'Attach an image file under the "file" field.');
  if (file.size > maxBytes) {
    return apiError(c, 'too_large', `Image must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  }
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_IMAGE_TYPES.test(contentType)) {
    return apiError(c, 'invalid_type', 'Use PNG, JPEG, WebP, or GIF.');
  }
  return { bytes: await file.arrayBuffer(), ext: contentType.split('/')[1], contentType };
}
