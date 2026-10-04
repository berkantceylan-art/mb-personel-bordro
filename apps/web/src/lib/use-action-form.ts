"use client";
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

/**
 * Sunucu eylemli formlar için:
 * - Hata olduğunda yazılanlar SİLİNMEZ (React 19 <form action> her gönderimden sonra formu sıfırlıyordu).
 * - Başarılı olunca ({ ok: true }) form temizlenir.
 * - İşlem sürerken ikinci gönderim engellenir (çift tıklama = çift kayıt olmaz).
 */
export function useActionForm<S>(fn: (prev: S | null, fd: FormData) => Promise<S>, opts: { prepare?: (fd: FormData) => void; onSuccess?: (s: S) => void } = {}) {
  const [state, dispatch, pending] = useActionState<S | null, FormData>(fn, null);
  const ref = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const o = useRef(opts);
  o.current = opts;
  busy.current = pending;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter ?? undefined);
    o.current.prepare?.(fd);
    startTransition(() => dispatch(fd));
  };
  useEffect(() => {
    if (state && typeof state === "object" && (state as { ok?: boolean }).ok === true) {
      ref.current?.reset();
      o.current.onSuccess?.(state);
    }
  }, [state]);
  return { state, pending, formProps: { ref, onSubmit } };
}
