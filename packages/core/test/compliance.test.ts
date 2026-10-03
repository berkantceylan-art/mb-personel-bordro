import { describe, expect, it } from "vitest";
import { addMonths, alertLevel, complianceStatus, type ComplianceType } from "../src";

const temelIsg: ComplianceType = { id: "t", name: "Temel İSG", validityMonths: 36, validityByClass: { COK: 12, TEHLIKELI: 24, AZ: 36 }, required: true };
const giris: ComplianceType = { id: "g", name: "İşe giriş muayenesi", validityMonths: null, required: true };

describe("süre hesabı", () => {
  it("ay ekleme ay sonunu korur", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-11-14", 12)).toBe("2026-11-14");
  });

  it("çok tehlikeli sınıfta temel İSG yılda bir", () => {
    const r = complianceStatus([{ doneOn: "2025-11-14" }], temelIsg, "COK", "2026-10-04");
    expect(r).toMatchObject({ status: "VALID", expiresOn: "2026-11-14", daysLeft: 41 });
    expect(complianceStatus([{ doneOn: "2025-11-01" }], temelIsg, "COK", "2026-10-04").status).toBe("SOON");
  });

  it("tehlikeli sınıfta 2 yıl → geçerli; süresi geçen; hiç yok", () => {
    expect(complianceStatus([{ doneOn: "2025-11-14" }], temelIsg, "TEHLIKELI", "2026-10-04").status).toBe("VALID");
    expect(complianceStatus([{ doneOn: "2025-09-01" }], temelIsg, "COK", "2026-10-04").status).toBe("EXPIRED");
    expect(complianceStatus([], temelIsg, "COK", "2026-10-04").status).toBe("MISSING");
  });

  it("bir kez yapılan ve elle girilen bitiş tarihi", () => {
    expect(complianceStatus([{ doneOn: "2024-01-01" }], giris, "COK", "2026-10-04").status).toBe("ONCE");
    expect(complianceStatus([{ doneOn: "2026-01-01", expiresOn: "2026-10-10" }], giris, "COK", "2026-10-04")).toMatchObject({ status: "SOON", daysLeft: 6 });
  });

  it("en son kayıt esas alınır", () => {
    const r = complianceStatus([{ doneOn: "2024-01-01" }, { doneOn: "2026-05-01" }], temelIsg, "COK", "2026-10-04");
    expect(r.expiresOn).toBe("2027-05-01");
  });

  it("uyarı kademeleri", () => {
    expect([alertLevel(-1), alertLevel(5), alertLevel(12), alertLevel(29), alertLevel(60)]).toEqual(["EXPIRED", "D7", "D15", "D30", null]);
  });
});
