/** Yapay zekâ modeli: Vercel'de ANTHROPIC_MODEL ile değiştirilebilir (görsel okuma destekleyen bir model olmalı) */
export const aiModel = () => process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
