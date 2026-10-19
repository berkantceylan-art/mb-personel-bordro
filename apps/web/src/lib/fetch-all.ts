/**
 * Supabase (PostgREST) tek sorguda en çok 1000 satır döndürür; .limit(20000) bu sınırı aşmaz.
 * Sayfalayarak tüm satırları getirir. Sorgu kararlı bir sıralama içermeli (.order(...)).
 */
export async function allRows<T = Record<string, unknown>>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  max = 200000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) return { data: out, error: { message: String((error as { message?: string }).message ?? error) } };
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
