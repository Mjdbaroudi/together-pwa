import { signMediaPath } from "@/lib/together/media";

const types: Record<string, string> = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif", "image/avif":"avif", "image/heic":"heic", "image/heif":"heif", "image/svg+xml":"svg", "image/bmp":"bmp", "image/tiff":"tiff" };
export function datePhotoFilename(day: string | undefined, mime: string, path: string) {
  const extension = types[mime.toLowerCase()] || (path.split('.').pop()?.toLowerCase().match(/^(jpg|jpeg|png|webp|gif|avif|heic|heif|svg|bmp|tiff)$/)?.[0]) || 'img';
  const date = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'photo';
  return `together-date-${date}.${extension}`;
}

/** Resolve through the authenticated private bucket. Never expose a signed URL to sharing. */
export async function loadDatePhotoFile(path: string, day?: string, signal?: AbortSignal) {
  let url = await signMediaPath(path);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!url) throw new Error('This photo is unavailable. Please try again.');
  let response = await fetch(url, { signal });
  if (response.status === 401 || response.status === 403) {
    url = await signMediaPath(path, true);
    if (!url) throw new Error('This photo is unavailable. Please try again.');
    response = await fetch(url, { signal });
  }
  if (!response.ok) throw new Error('Could not prepare this photo. Check your connection and try again.');
  if (Number(response.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('This photo is too large to save here.');
  const blob = await response.blob();
  if (!blob.size || blob.size > 50 * 1024 * 1024 || !blob.type.startsWith('image/')) throw new Error('This photo could not be downloaded as an image.');
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return new File([blob], datePhotoFilename(day, blob.type, path), { type: blob.type });
}

export function downloadPhotoFile(file: File) {
  const url = URL.createObjectURL(file), anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.name;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
