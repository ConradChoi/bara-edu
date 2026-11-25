import 'server-only';
import { detectImageMimeType } from '@/lib/image-validation';
import { apiFetch } from './api';
import { readSession } from './session-cookie';

export type UploadError = 'too-large' | 'invalid' | 'failed';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// fileName is fixed: a DB trigger pins a member's profiles.photo_path to `<uid>/photo`
export async function uploadMemberPhoto(file: File): Promise<{ path: string } | { error: UploadError }> {
  if (file.size > MAX_BYTES) return { error: 'too-large' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectImageMimeType(bytes.subarray(0, 12));
  if (!contentType || !ALLOWED_TYPES.has(contentType)) return { error: 'invalid' };

  try {
    const r = await apiFetch<{ path: string }>('/v1/storage/member-photos', {
      method: 'POST',
      session: await readSession(),
      body: { fileName: 'photo', contentType, dataBase64: Buffer.from(bytes).toString('base64') },
    });
    return r.ok ? { path: r.data.path } : { error: 'failed' };
  } catch {
    return { error: 'failed' };
  }
}

export async function memberPhotoSignedUrl(path: string): Promise<string | null> {
  try {
    const r = await apiFetch<{ url: string }>('/v1/storage/member-photos/signed-url', {
      method: 'POST',
      session: await readSession(),
      body: { path },
    });
    return r.ok ? r.data.url : null;
  } catch {
    return null;
  }
}
