/** İş dosyası türleri */
export type FileKind = "photo" | "scan" | "design" | "doc" | "other";
export function kindOf(name: string): FileKind {
  if (/\.(jpe?g|png|webp|heic)$/i.test(name)) return "photo";
  if (/\.(stl|ply|obj|3mf|dcm|zip|7z|rar)$/i.test(name)) return "scan";
  if (/\.pdf$/i.test(name)) return "doc";
  return "other";
}

export const KIND_LABEL: Record<FileKind, string> = { photo: "Fotoğraf", scan: "Tarama", design: "Tasarım", doc: "Belge", other: "Dosya" };
export const MODEL_RE = /\.(stl|ply|obj)$/i;
export const fmtBytes = (n: number | null | undefined) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
