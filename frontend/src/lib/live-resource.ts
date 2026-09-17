import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getSocket } from "@/lib/chat";

export function useLiveResource<T>(
  load: () => Promise<T>,
  events: readonly string[],
  failureMessage: string,
) {
  const [data, setData] = useState<T | null>(null);

  const reload = useCallback(
    () =>
      load()
        .then(setData)
        .catch(() => toast.error(failureMessage)),
    [load, failureMessage],
  );

  useEffect(() => {
    let active = true;
    const run = () => {
      load()
        .then((value) => {
          if (active) setData(value);
        })
        .catch(() => {
          if (active) toast.error(failureMessage);
        });
    };
    run();
    const socket = getSocket();
    events.forEach((event) => socket?.on(event, run));
    socket?.io.on("reconnect", run);
    return () => {
      active = false;
      events.forEach((event) => socket?.off(event, run));
      socket?.io.off("reconnect", run);
    };
  }, [load, events, failureMessage]);

  return { data, reload };
}
