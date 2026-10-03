/**
 * PDKS cihaz dosyası ayrıştırma ve giriş/çıkış eşleştirme.
 *
 * Satır biçimi: `cihaz,kartNo,yön,YYYY/MM/DD,HH:MM:SS`
 * örn. `002,35168,0,2026/10/02,12:11:00`
 * Varsayılan: cihaz 002 = giriş, 001 = çıkış (cihaz → yön eşlemesi ayarlanabilir).
 *
 * Saatler yerel (İstanbul) "duvar saati" olarak tutulur; dakika cinsinden
 * mutlak değer UTC hesabıyla üretilir ki saat dilimi kaymasın.
 */

export type Direction = "IN" | "OUT";

export interface Punch {
  device: string;
  cardNo: string;
  direction: Direction;
  /** "2026-10-02T12:11" yerel */
  at: string;
  /** Dakika (sıralama / fark için) */
  minute: number;
  line: number;
  source: "DEVICE" | "MANUAL" | "MOBILE";
}

export interface ParseOptions {
  deviceDirection?: Record<string, Direction>;
}

export interface ParseResult {
  punches: Punch[];
  errors: Array<{ line: number; raw: string; reason: string }>;
}

const DEFAULT_DEVICES: Record<string, Direction> = { "001": "OUT", "002": "IN" };

const toMinute = (y: number, mo: number, d: number, h: number, mi: number) =>
  Date.UTC(y, mo - 1, d, h, mi) / 60000;

const pad = (n: number) => String(n).padStart(2, "0");

export function minuteToLocal(m: number): string {
  const d = new Date(m * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function parseDeviceFile(text: string, opts: ParseOptions = {}): ParseResult {
  const map = opts.deviceDirection ?? DEFAULT_DEVICES;
  const punches: Punch[] = [];
  const errors: ParseResult["errors"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length < 5) {
      errors.push({ line: lineNo, raw, reason: "Eksik alan" });
      return;
    }
    const [device, cardNo, , date, time] = parts as [string, string, string, string, string];
    const direction = map[device];
    if (!direction) {
      errors.push({ line: lineNo, raw, reason: `Tanımsız cihaz: ${device}` });
      return;
    }
    const dm = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(date);
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (!dm || !tm) {
      errors.push({ line: lineNo, raw, reason: "Tarih/saat okunamadı" });
      return;
    }
    const minute = toMinute(+dm[1]!, +dm[2]!, +dm[3]!, +tm[1]!, +tm[2]!);
    punches.push({
      device,
      cardNo,
      direction,
      at: minuteToLocal(minute),
      minute,
      line: lineNo,
      source: "DEVICE",
    });
  });
  return { punches, errors };
}

/* ------------------------------------------------------------------ */

export type AnomalyKind =
  | "MISSING_OUT"
  | "MISSING_IN"
  | "DUPLICATE_MERGED"
  | "FREQUENT_EXITS"
  | "UNKNOWN_CARD";

export interface Anomaly {
  kind: AnomalyKind;
  cardNo: string;
  at: string;
  detail: string;
}

export interface WorkSession {
  cardNo: string;
  inAt: string;
  outAt: string;
  minutes: number;
  /** Oturumun ait olduğu iş günü = giriş tarihi (gece vardiyası dahil) */
  workDate: string;
}

export interface PairOptions {
  /** Aynı yönde bu kadar dakika içindeki tekrarlar tek sayılır */
  duplicateWindowMin?: number;
  /** Bir oturum bundan uzunsa eşleşme reddedilir (çıkış unutulmuş) */
  maxSessionMin?: number;
  /** Günde bu sayıda veya daha fazla çıkış "sık çıkış" uyarısı */
  frequentExitThreshold?: number;
  /** Tanımlı kart numaraları; verilirse dışındakiler UNKNOWN_CARD */
  knownCards?: Set<string>;
}

export interface PairResult {
  sessions: WorkSession[];
  anomalies: Anomaly[];
  dedupedCount: number;
}

export function pairPunches(punches: Punch[], opts: PairOptions = {}): PairResult {
  const dupWin = opts.duplicateWindowMin ?? 3;
  const maxSession = opts.maxSessionMin ?? 16 * 60;
  const freqThreshold = opts.frequentExitThreshold ?? 5;
  const sessions: WorkSession[] = [];
  const anomalies: Anomaly[] = [];
  let dedupedCount = 0;

  const byCard = new Map<string, Punch[]>();
  for (const p of punches) {
    const list = byCard.get(p.cardNo) ?? [];
    list.push(p);
    byCard.set(p.cardNo, list);
  }

  for (const [cardNo, raw] of byCard) {
    if (opts.knownCards && !opts.knownCards.has(cardNo)) {
      anomalies.push({
        kind: "UNKNOWN_CARD",
        cardNo,
        at: raw[0]!.at,
        detail: `${raw.length} okutma, personele bağlı değil`,
      });
      continue;
    }

    const sorted = [...raw].sort((a, b) => a.minute - b.minute || a.line - b.line);
    const list: Punch[] = [];
    for (const p of sorted) {
      const prev = list[list.length - 1];
      if (prev && prev.direction === p.direction && p.minute - prev.minute <= dupWin) {
        dedupedCount++;
        anomalies.push({
          kind: "DUPLICATE_MERGED",
          cardNo,
          at: p.at,
          detail: `${prev.at.slice(11)} ve ${p.at.slice(11)} tek okutma sayıldı`,
        });
        continue;
      }
      list.push(p);
    }

    let open: Punch | null = null;
    for (const p of list) {
      if (p.direction === "IN") {
        if (open) {
          anomalies.push({
            kind: "MISSING_OUT",
            cardNo,
            at: open.at,
            detail: `${open.at} girişinden sonra çıkış yok (sonraki giriş ${p.at})`,
          });
        }
        open = p;
      } else {
        if (!open) {
          anomalies.push({
            kind: "MISSING_IN",
            cardNo,
            at: p.at,
            detail: `${p.at} çıkışından önce giriş yok`,
          });
          continue;
        }
        const minutes = p.minute - open.minute;
        if (minutes > maxSession) {
          anomalies.push({
            kind: "MISSING_OUT",
            cardNo,
            at: open.at,
            detail: `${open.at} girişi ile ${p.at} çıkışı arası çok uzun`,
          });
        } else {
          sessions.push({
            cardNo,
            inAt: open.at,
            outAt: p.at,
            minutes,
            workDate: open.at.slice(0, 10),
          });
        }
        open = null;
      }
    }
    if (open) {
      anomalies.push({
        kind: "MISSING_OUT",
        cardNo,
        at: open.at,
        detail: `${open.at} girişinin çıkışı yok`,
      });
    }

    const exitsByDay = new Map<string, number>();
    for (const p of list) {
      if (p.direction !== "OUT") continue;
      const d = p.at.slice(0, 10);
      exitsByDay.set(d, (exitsByDay.get(d) ?? 0) + 1);
    }
    for (const [d, n] of exitsByDay) {
      if (n >= freqThreshold) {
        anomalies.push({ kind: "FREQUENT_EXITS", cardNo, at: d, detail: `${d} günü ${n} çıkış` });
      }
    }
  }

  sessions.sort((a, b) => a.cardNo.localeCompare(b.cardNo) || a.inAt.localeCompare(b.inAt));
  return { sessions, anomalies, dedupedCount };
}

export interface DailyTotal {
  cardNo: string;
  workDate: string;
  firstIn: string;
  lastOut: string;
  workedMinutes: number;
  /** Oturumlar arası dışarıda geçen süre */
  outsideMinutes: number;
  sessionCount: number;
}

export function dailyTotals(sessions: WorkSession[]): DailyTotal[] {
  const map = new Map<string, WorkSession[]>();
  for (const s of sessions) {
    const k = `${s.cardNo}|${s.workDate}`;
    const l = map.get(k) ?? [];
    l.push(s);
    map.set(k, l);
  }
  const out: DailyTotal[] = [];
  for (const [, l] of map) {
    l.sort((a, b) => a.inAt.localeCompare(b.inAt));
    const worked = l.reduce((a, s) => a + s.minutes, 0);
    const first = l[0]!;
    const last = l[l.length - 1]!;
    const span =
      (Date.parse(last.outAt + ":00Z") - Date.parse(first.inAt + ":00Z")) / 60000;
    out.push({
      cardNo: first.cardNo,
      workDate: first.workDate,
      firstIn: first.inAt,
      lastOut: last.outAt,
      workedMinutes: worked,
      outsideMinutes: span - worked,
      sessionCount: l.length,
    });
  }
  return out.sort((a, b) => a.cardNo.localeCompare(b.cardNo) || a.workDate.localeCompare(b.workDate));
}
