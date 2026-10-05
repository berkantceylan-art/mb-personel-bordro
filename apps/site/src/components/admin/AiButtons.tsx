"use client";

import { useState, useTransition } from "react";
import { aiSeo, aiTranslate } from "@/lib/ai-admin";

/** Form alanına değer yazar (React kontrolsüz alanlar için) */
function setField(form: HTMLFormElement | null, name: string, value: string) {
  const el = form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(name)}"]`);
  if (!el) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.classList.add("ai-filled");
  setTimeout(() => el.classList.remove("ai-filled"), 1600);
}
const getField = (form: HTMLFormElement | null, name: string) => form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(name)}"]`)?.value ?? "";

const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
  </svg>
);

/** I18nField: Türkçeden İngilizce ve Fransızcaya çevir */
export function AiTranslateButton({ name }: { name: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <span className="ml-2 inline-flex items-center gap-2 align-middle">
      <button
        type="button"
        disabled={pending}
        onClick={(e) => {
          const form = (e.currentTarget as HTMLButtonElement).closest("form");
          const tr = getField(form, `${name}.tr`);
          setErr(undefined);
          start(async () => {
            const res = await aiTranslate(tr);
            if (res.error || !res.data) return setErr(res.error);
            setField(form, `${name}.en`, res.data.en);
            setField(form, `${name}.fr`, res.data.fr);
          });
        }}
        className="inline-flex items-center gap-1 rounded-full bg-smile/15 px-2.5 py-0.5 text-[11px] font-semibold text-navy hover:bg-smile/30 disabled:opacity-60"
        title="Türkçe metni yapay zekâ ile İngilizce ve Fransızcaya çevirir"
      >
        <Spark />
        {pending ? "Çevriliyor…" : "YZ ile çevir"}
      </button>
      {err && <span className="text-[11px] font-normal text-bad">{err}</span>}
    </span>
  );
}

/** SEO alanlarını başlık / özet / metinden 3 dilde öner */
export function AiSeoButton({ source }: { source: { title: string; summary: string; body: string } }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={(e) => {
          const form = (e.currentTarget as HTMLButtonElement).closest("form");
          setErr(undefined);
          start(async () => {
            const res = await aiSeo({ title: getField(form, `${source.title}.tr`), summary: getField(form, `${source.summary}.tr`), body: getField(form, `${source.body}.tr`) });
            if (res.error || !res.data) return setErr(res.error);
            for (const l of ["tr", "en", "fr"] as const) {
              setField(form, `seo_title.${l}`, res.data.title[l]);
              setField(form, `seo_description.${l}`, res.data.description[l]);
            }
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-blue disabled:opacity-60"
      >
        <Spark />
        {pending ? "Hazırlanıyor…" : "Yapay zekâ ile 3 dilde öner"}
      </button>
      {err ? <span className="text-sm text-bad">{err}</span> : <span className="text-xs text-slate">Öneriyi kontrol edip istediğiniz gibi düzeltebilirsiniz.</span>}
    </div>
  );
}
