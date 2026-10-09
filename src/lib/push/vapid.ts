export function normalizeVapidBase64Url(value: string | undefined | null) {
  if (!value) return "";
  let v = value.trim();

  // Be forgiving if a whole KEY=value line or a quoted value was pasted into Vercel.
  for (const prefix of ["NEXT_PUBLIC_VAPID_PUBLIC_KEY=", "VAPID_PRIVATE_KEY="]) {
    if (v.startsWith(prefix)) v = v.slice(prefix.length).trim();
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }

  // RFC 8292 / web-push expects unpadded Base64URL.
  return v
    .replace(/\s+/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function normalizeVapidSubject(value: string | undefined | null) {
  if (!value) return "";
  let v = value.trim();
  if (v.startsWith("VAPID_SUBJECT=")) v = v.slice("VAPID_SUBJECT=".length).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function vapidDiagnostics(rawPublic: string | undefined, rawPrivate: string | undefined) {
  const publicKey = normalizeVapidBase64Url(rawPublic);
  const privateKey = normalizeVapidBase64Url(rawPrivate);
  const safeChars = /^[A-Za-z0-9_-]+$/;
  return {
    publicConfigured: Boolean(rawPublic),
    privateConfigured: Boolean(rawPrivate),
    publicLength: publicKey.length,
    privateLength: privateKey.length,
    publicBase64UrlShape: Boolean(publicKey) && safeChars.test(publicKey) && !publicKey.includes("="),
    privateBase64UrlShape: Boolean(privateKey) && safeChars.test(privateKey) && !privateKey.includes("="),
    // web-push generated P-256 VAPID keys are normally 87 / 43 chars unpadded.
    publicExpectedLength: publicKey.length === 87,
    privateExpectedLength: privateKey.length === 43,
  };
}
