import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** Sunucu eyleminden kullanıcıya mesaj: geldiği sayfaya ?hata= / ?tamam= ile döner (FlashMessage gösterir) */
async function back(kind: "hata" | "tamam", message: string): Promise<never> {
  const ref = (await headers()).get("referer");
  let path = "/";
  try {
    if (ref) {
      const u = new URL(ref);
      u.searchParams.delete("hata");
      u.searchParams.delete("tamam");
      u.searchParams.set(kind, message.slice(0, 300));
      path = u.pathname + u.search;
    }
  } catch {
    path = "/";
  }
  redirect(path);
}

export const fail = (message: string) => back("hata", message);
export const done = (message: string) => back("tamam", message);

/** Supabase hatası varsa kullanıcıya gösterip durur */
export async function must<T extends { error: { message: string } | null }>(res: T | PromiseLike<T>, prefix = ""): Promise<T> {
  const r = await res;
  if (r.error) await fail(`${prefix}${r.error.message}`);
  return r;
}
