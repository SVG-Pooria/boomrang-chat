import { useEffect, useState } from "react";

import { readSession } from "@/lib/auth";

const cache = new Map<string, Promise<string | null>>();

function loadImage(url: string) {
  const cached = cache.get(url);
  if (cached) return cached;
  const session = readSession();
  const pending = fetch(url, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  })
    .then(async (response) => {
      if (!response.ok) return null;
      return URL.createObjectURL(await response.blob());
    })
    .catch(() => null);
  cache.set(url, pending);
  return pending;
}

export function forgetImage(url: string | null | undefined) {
  if (!url) return;
  const cached = cache.get(url);
  cache.delete(url);
  void cached?.then((objectUrl) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
}

export function useAuthorizedImage(url: string | null | undefined) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setObjectUrl(null);
      return undefined;
    }
    let active = true;
    void loadImage(url).then((loaded) => {
      if (active) setObjectUrl(loaded);
    });
    return () => {
      active = false;
    };
  }, [url]);

  return url ? objectUrl : null;
}
