/** Hata kodları ve Türkçe karşılıkları */
export const ISSUE: Record<string, { label: string; tone: "red" | "amber" | "blue" | "gray" }> = {
  MISSING_OUT: { label: "Çıkış okutması yok", tone: "red" },
  MISSING_IN: { label: "Giriş okutması yok", tone: "red" },
  ABSENT: { label: "Gelmedi", tone: "red" },
  LATE: { label: "Geç geldi", tone: "amber" },
  EARLY: { label: "Erken çıktı", tone: "amber" },
  OVERTIME: { label: "Fazla mesai işlenmedi", tone: "blue" },
  LEAVE_PRESENT: { label: "İzinliyken geldi", tone: "amber" },
  NO_SHIFT: { label: "Vardiyası yok ama geldi", tone: "amber" },
  LONG_DAY: { label: "11 saati aştı", tone: "red" },
};

