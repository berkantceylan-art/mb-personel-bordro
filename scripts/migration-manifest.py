#!/usr/bin/env python3
"""Her SQL güncellemesinin oluşturduğu bir nesneyi apps/web/src/lib/migration-manifest.ts dosyasına yazar.
Kontrol Merkezi bu listeyle Supabase'de çalıştırılmamış güncellemeleri bulur. Yeni migration ekleyince çalıştırın."""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "supabase", "migrations")
out = []
for f in sorted(os.listdir(D)):
    if not f.endswith(".sql"):
        continue
    s = re.sub(r"--[^\n]*", "", open(os.path.join(D, f), encoding="utf-8").read())
    t = re.findall(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)", s, re.I)
    fn = re.findall(r"create\s+or\s+replace\s+function\s+(?:public\.)?([a-z_0-9]+)\s*\(", s, re.I)
    en = re.findall(r"alter\s+type\s+([a-z_]+)\s+add\s+value\s+if\s+not\s+exists\s+'([^']+)'", s, re.I)
    col = re.findall(r"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+add\s+column\s+if\s+not\s+exists\s+([a-z_0-9]+)", s, re.I)
    obj = ("t:" + t[-1]) if t else ("f:" + fn[-1]) if fn else ("e:%s.%s" % en[-1]) if en else ("k:%s.%s" % col[-1]) if col else None
    if obj:
        out.append((f, obj))
ts = "// Otomatik üretildi: her SQL güncellemesinin oluşturduğu bir nesne. Kontrol Merkezi bununla eksik güncellemeyi bulur.\n// Yeniden üretmek için: python3 scripts/migration-manifest.py\nexport const MIGRATION_MANIFEST: Array<[file: string, object: string]> = [\n"
ts += "".join("  [%s, %s],\n" % (json.dumps(a), json.dumps(b)) for a, b in out) + "];\n"
open(os.path.join(ROOT, "apps", "web", "src", "lib", "migration-manifest.ts"), "w", encoding="utf-8").write(ts)
print(len(out), "migration")
