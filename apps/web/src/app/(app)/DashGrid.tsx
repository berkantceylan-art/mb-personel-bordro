"use client";
import { useState, useTransition } from "react";
import { saveDashboard } from "@/lib/dashboard-actions";

export type DashCard = { id: string; title: string; wide?: boolean; node: React.ReactNode };

/** Kartlar: düzenle modunda gizle / göster ve sırala; kişiye özel kaydedilir */
export function DashGrid({ cards, hidden: h0, order: o0 }: { cards: DashCard[]; hidden: string[]; order: string[] }) {
  const [edit, setEdit] = useState(false);
  const [hidden, setHidden] = useState<string[]>(h0);
  const [order, setOrder] = useState<string[]>(() => [...o0.filter((id) => cards.some((c) => c.id === id)), ...cards.map((c) => c.id).filter((id) => !o0.includes(id))]);
  const [pending, start] = useTransition();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const list = order.map((id) => byId.get(id)).filter((c): c is DashCard => !!c);
  const move = (id: string, d: number) => {
    const i = order.indexOf(id), j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setOrder(n);
  };
  const save = () => start(async () => { await saveDashboard(hidden, order); setEdit(false); });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        {edit ? (
          <>
            <button type="button" onClick={() => { setHidden([]); }} className="text-xs font-semibold text-muted">Hepsini göster</button>
            <button type="button" onClick={save} disabled={pending} className="h-9 px-4 rounded-full bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">{pending ? "Kaydediliyor…" : "Bitti"}</button>
          </>
        ) : (
          <button type="button" onClick={() => setEdit(true)} className="h-9 px-4 rounded-full border border-line bg-white text-sm font-semibold text-muted hover:text-ink">Paneli düzenle</button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 auto-rows-min">
        {list.filter((c) => edit || !hidden.includes(c.id)).map((c) => {
          const off = hidden.includes(c.id);
          return (
            <div key={c.id} className={`relative ${c.wide ? "md:col-span-2" : ""} ${off ? "opacity-40" : ""}`}>
              {edit && (
                <div className="absolute -top-2 right-2 z-10 flex gap-1 rounded-full bg-ink p-1 shadow-lg">
                  <button type="button" onClick={() => move(c.id, -1)} className="w-7 h-7 rounded-full text-white hover:bg-white/20" aria-label={`${c.title} yukarı`}>↑</button>
                  <button type="button" onClick={() => move(c.id, 1)} className="w-7 h-7 rounded-full text-white hover:bg-white/20" aria-label={`${c.title} aşağı`}>↓</button>
                  <button type="button" onClick={() => setHidden(off ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} className="h-7 px-2 rounded-full text-xs font-semibold text-white hover:bg-white/20">{off ? "Göster" : "Gizle"}</button>
                </div>
              )}
              {c.node}
            </div>
          );
        })}
      </div>
    </div>
  );
}
