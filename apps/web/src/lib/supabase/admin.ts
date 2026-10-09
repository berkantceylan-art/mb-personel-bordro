import { createClient } from "@supabase/supabase-js";

/**
 * Sunucu tarafı yönetici istemcisi (service role). YALNIZ sunucu kodunda (server action, route handler)
 * kullanılır; RLS'i atlar, bu yüzden çağıran her girdiyi kendisi doğrulamalıdır.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY tanımlı değil");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
