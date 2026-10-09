import { getPublicSupabaseConfig, getSupabaseBrowser } from "@/lib/supabase/client";

const SIGNED_URL_SECONDS = 24 * 60 * 60;

const signedCache=new Map<string,{url:string;expires:number}>();
export async function signMediaPath(path?:string|null,force=false){
  if(!path)return undefined;
  const supabase=getSupabaseBrowser();if(!supabase)return undefined;
  const userId=(await supabase.auth.getSession()).data.session?.user.id;if(!userId)return undefined;
  const key=`${userId}:${path}`,cached=signedCache.get(key);
  if(!force&&cached&&cached.expires>Date.now())return cached.url;
  const {data,error}=await supabase.storage.from("couple-media").createSignedUrl(path,SIGNED_URL_SECONDS);
  if(error)return undefined;
  if(data?.signedUrl){if(signedCache.size>1000)signedCache.clear();signedCache.set(key,{url:data.signedUrl,expires:Date.now()+23*60*60*1000});}
  return data?.signedUrl;
}

export async function resolveMediaReference(value?: string | null) {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return signMediaPath(value);
}

export async function prepareProfilePhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for your profile photo.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Profile photo must be smaller than 15 MB.");

  // HEIC/HEIF decoding support varies by browser. Keep the original when it is
  // already within the Storage limit instead of risking a failed conversion.
  if (/heic|heif/i.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1024;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    if (scale === 1 && file.size <= 1.25 * 1024 * 1024 && /image\/(jpeg|webp)/i.test(file.type)) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not prepare this image.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not compress this image.")), "image/jpeg", 0.84);
    });
    return new File([blob], `profile-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    if (file.size <= 8 * 1024 * 1024) return file;
    throw new Error("This image could not be optimized. Choose a JPG, PNG or WebP smaller than 8 MB.");
  }
}

export function mediaExtension(file: File, fallback: string) {
  const extension = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  return (extension || fallback).toLowerCase();
}

export function storagePath(coupleId: string, userId: string, folder: "messages" | "memories" | "story" | "profile", extension: string) {
  return `${coupleId}/${userId}/${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

function storageObjectUrl(baseUrl: string, bucket: string, path: string) {
  const encodedPath = path.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function responseError(xhr: XMLHttpRequest) {
  try {
    const payload = JSON.parse(xhr.responseText || "{}") as { message?: string; error?: string };
    return payload.message || payload.error || `Upload failed (${xhr.status}).`;
  } catch {
    return `Upload failed (${xhr.status}).`;
  }
}

/**
 * Browser upload with real byte progress. Supabase's high-level upload helper
 * does not currently expose progress callbacks, so chat media uses the same
 * authenticated Storage REST endpoint through XHR. Other uploads can continue
 * using the regular Supabase client.
 */
export async function uploadChatMedia(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) {
  if(signal?.aborted)throw new DOMException("Upload cancelled","AbortError");
  const supabase = getSupabaseBrowser();
  const config = getPublicSupabaseConfig();
  if (!supabase || !config) throw new Error("Supabase is not configured.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let finished = false;

    const cleanup = () => signal?.removeEventListener("abort", abort);
    const done = (action: () => void) => {
      if (finished) return;
      finished = true;
      cleanup();
      action();
    };
    const abort = () => {
      if (finished) return;
      xhr.abort();
    };

    xhr.timeout=120000;
    xhr.ontimeout=()=>done(()=>reject(new Error("Upload timed out. Try again.")));
    xhr.open("POST", storageObjectUrl(config.url, "couple-media", path));
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", config.key);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100)));
      onProgress?.(percent);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        done(resolve);
      } else {
        done(() => reject(new Error(responseError(xhr))));
      }
    };
    xhr.onerror = () => done(() => reject(new Error("Network error while uploading media.")));
    xhr.onabort = () => done(() => reject(new DOMException("Upload cancelled", "AbortError")));

    if(signal?.aborted){done(()=>reject(new DOMException("Upload cancelled","AbortError")));return;}
    signal?.addEventListener("abort", abort, { once: true });
    onProgress?.(0);
    xhr.send(file);
  });
}
