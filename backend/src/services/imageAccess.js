import { supabaseAdmin } from '../config/supabase.js';

/**
 * Access to stored clinical photographs.
 *
 * The injury-photos bucket is private, deliberately. These are photographs of
 * identifiable patients, and a public bucket means anyone holding the URL can
 * view them indefinitely with no authentication — including after the case is
 * closed, the staff member leaves, or the link is forwarded.
 *
 * So nothing durable is stored except the storage path, and readers mint a
 * short-lived signed URL. An hour is long enough to open a case and read it,
 * short enough that a copied link is not a lasting disclosure.
 */
const DEFAULT_BUCKET = 'injury-photos';
const DEFAULT_TTL_SECONDS = 3600;

export const signedImageUrl = async (storagePath, bucket = DEFAULT_BUCKET, seconds = DEFAULT_TTL_SECONDS) => {
  if (!storagePath) return null;
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(storagePath, seconds);
    if (error) {
      console.warn('could not sign image url:', error.message);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn('could not sign image url:', err.message);
    return null;
  }
};

/** Attach a freshly signed URL to each stored image row. */
export const withSignedUrls = async (rows = []) =>
  Promise.all((rows || []).map(async (img) => ({
    ...img,
    image_url: img.image_url || await signedImageUrl(img.storage_path, img.storage_bucket || DEFAULT_BUCKET)
  })));
