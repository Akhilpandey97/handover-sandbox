import { supabase } from "@/integrations/supabase/client";

/**
 * File buckets are private, so stored values may be either an object path
 * (new uploads) or an old public URL. Both reduce to the same object path.
 */
export function storageObjectPath(bucket: string, value: string): string {
  const marker = `/${bucket}/`;
  const i = value.indexOf(marker);
  const raw = i === -1 ? value : value.slice(i + marker.length);
  return decodeURIComponent(raw.split("?")[0]);
}

/** Short-lived download link for a private file, for signed-in users. */
export async function getSignedFileUrl(
  bucket: string,
  value: string,
  expiresIn = 300,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storageObjectPath(bucket, value), expiresIn);
  return data?.signedUrl ?? null;
}

/** Opens a private file in a new tab using a freshly signed link. */
export async function openStorageFile(bucket: string, value: string): Promise<boolean> {
  const url = await getSignedFileUrl(bucket, value);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
