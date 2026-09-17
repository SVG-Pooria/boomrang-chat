import { useEffect, useState } from "react";

import { fetchBlobUrl, fileUrl, type FileVariant } from "@/lib/files";

export function useThumbnail(
  fileId: number | undefined | null,
  urlFor: (id: number, variant: FileVariant) => string = fileUrl,
) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!fileId) return undefined;
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    fetchBlobUrl(urlFor(fileId, "thumbnail"))
      .catch(() => fetchBlobUrl(urlFor(fileId, "compressed")))
      .then((url) => {
        objectUrl = url;
        if (active) setSource(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, urlFor]);

  return { source, failed };
}
