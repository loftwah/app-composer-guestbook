// MIT. Browser-safe view adapter owned by Here / there. Locations are supplied
// by the reviewed transport; this module never fetches or grants media access.
export interface PhotoRecord {
  id: string;
  caption: string;
  author: string;
  status: string;
  revision: number;
  synthetic?: number | boolean;
}
export function approvedPhoto(
  record: PhotoRecord | null | undefined,
): record is PhotoRecord {
  return record?.status === "approved";
}
export function publicPhotoView(
  record: PhotoRecord,
  location: { url: string; image: string },
) {
  if (!approvedPhoto(record)) return null;
  return {
    contract: 1 as const,
    provider: "guestbook" as const,
    id: record.id,
    revision: record.revision,
    title: record.caption,
    description: record.author,
    visibility: "public" as const,
    url: location.url,
    image: location.image,
    synthetic: !!record.synthetic,
  };
}
