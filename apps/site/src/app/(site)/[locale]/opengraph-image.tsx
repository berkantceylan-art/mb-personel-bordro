import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { DICTS, isLocale } from "@/lib/i18n";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "MB Dental";

/** Paylaşım görseli (WhatsApp, LinkedIn, Facebook, X önizlemeleri) */
export default async function OgImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const d = DICTS[isLocale(locale) ? locale : "tr"];
  const dir = join(process.cwd(), "assets/fonts");
  const [b1, b2, f1, f2] = await Promise.all(
    ["bricolage-grotesque-latin-700-normal.woff", "bricolage-grotesque-latin-ext-700-normal.woff", "figtree-latin-500-normal.woff", "figtree-latin-ext-500-normal.woff"].map((f) => readFile(join(dir, f))),
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#072a50",
          backgroundImage: "radial-gradient(circle at 85% 15%, rgba(43,196,238,0.55), transparent 45%), radial-gradient(circle at 0% 100%, #0e4c8c, transparent 55%)",
          color: "white",
          fontFamily: "Figtree",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "#2bc4ee", color: "#072a50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 700, fontFamily: "Bricolage" }}>MB</div>
          <div style={{ fontSize: 40, fontWeight: 700, fontFamily: "Bricolage" }}>MB Dental</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.02, maxWidth: 1000, fontFamily: "Bricolage", letterSpacing: -2 }}>{d.hero.title}</div>
          <div style={{ fontSize: 28, color: "rgba(255,255,255,0.75)", maxWidth: 960 }}>{d.meta.description}</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#2bc4ee" }}>mbdentaire.com</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: b1, weight: 700, style: "normal" },
        { name: "Bricolage Ext", data: b2, weight: 700, style: "normal" },
        { name: "Figtree", data: f1, weight: 500, style: "normal" },
        { name: "Figtree Ext", data: f2, weight: 500, style: "normal" },
      ],
    },
  );
}
