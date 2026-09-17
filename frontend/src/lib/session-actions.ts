import { clearSession, request } from "@/lib/auth";
import { closeSocket } from "@/lib/chat";

export async function signOut() {
  await request("/auth/logout", { method: "POST" }).catch(() => undefined);
  closeSocket();
  clearSession();
  window.location.assign("/login");
}
