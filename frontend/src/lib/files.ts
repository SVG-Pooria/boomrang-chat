import { readSession } from "@/lib/auth";

export type FileVariant = "original" | "compressed" | "thumbnail";

export function fileUrl(fileId: number, variant: FileVariant) {
  return `/api/files/${fileId}/${variant}`;
}

async function authorizedBlob(url: string) {
  const session = readSession();
  const response = await fetch(url, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!response.ok) throw new Error(`FILE_${response.status}`);
  return response.blob();
}

export async function fetchBlobUrl(url: string) {
  return URL.createObjectURL(await authorizedBlob(url));
}

export async function saveFile(url: string, name: string) {
  const objectUrl = URL.createObjectURL(await authorizedBlob(url));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

export function isVisualMedia(mimeType: string | null | undefined) {
  const mime = mimeType ?? "";
  return mime.startsWith("image/") || mime.startsWith("video/");
}

export function formatBytes(bytes: number | null | undefined, digits: (value: string) => string) {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${digits(mb.toFixed(1))} MB`;
  return `${digits(String(Math.max(1, Math.round(bytes / 1024))))} KB`;
}
