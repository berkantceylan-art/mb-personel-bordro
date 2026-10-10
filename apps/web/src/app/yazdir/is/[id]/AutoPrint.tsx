"use client";
import { useEffect } from "react";

/** ?yazdir=1 ile açılınca yazdırma penceresini kendiliğinden açar */
export function AutoPrint({ on }: { on: boolean }) {
  useEffect(() => {
    if (on) setTimeout(() => window.print(), 400);
  }, [on]);
  return null;
}
