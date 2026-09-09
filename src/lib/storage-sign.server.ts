import { adminClient } from "@/lib/tenant-integrations.server";

/**
 * Stored file references may be an object path (new uploads) or a legacy
 * public URL. Both reduce to the object path inside the bucket.
 */
export function storageObjectPath(bucket: string, value: string): string {
  const marker = `/${bucket}/`;
  const i = value.indexOf(marker);
  const raw = i === -1 ? value : value.slice(i + marker.length);
  return decodeURIComponent(raw.split("?")[0]);
}

/**
 * Signed download link for a private bucket. Generated server-side so the
 * merchant portal (which has no Supabase session) can still open its own files.
 */
export async function signStorageUrl(
  bucket: string,
  value: string | null | undefined,
  expiresIn = 3600,
): Promise<string | null> {
  if (!value) return null;
  try {
    const { data } = await adminClient()
      .storage.from(bucket)
      .createSignedUrl(storageObjectPath(bucket, value), expiresIn);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
