import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

/**
 * Bankaların kendi yükleme dosyası formatları (MB Dental'in gönderdiği örneklerle birebir).
 * Şirkete ait kodlar Vercel ortam değişkenlerinden okunur:
 *   GARANTI_KURUM_KODU, GARANTI_SUBE_KODU, GARANTI_HESAP_NO
 *   GARANTI_EMEKLILIK_GRUP_KODU, SGK_ISYERI_SICIL
 */

const MONTHS = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
const periodUpper = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const numOrText = (v: string) => (/^\d{1,15}$/.test(v) ? Number(v) : v);

export interface BankRow { tckn: string; ad: string; iban: string; tutar: number /* kuruş */ }

/** Garanti BBVA "TGB Yeni Maaş Dosyası" (.xlsx) — bankanın şablonu doldurulur */
export async function garantiMaasXlsx(rows: BankRow[], period: string, payDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), "src/templates/garanti-maas.xlsx"));
  const ws = wb.worksheets[0]!;
  const env = process.env;
  if (env.GARANTI_KURUM_KODU) ws.getCell("B1").value = Number(env.GARANTI_KURUM_KODU);
  if (env.GARANTI_SUBE_KODU) ws.getCell("B2").value = Number(env.GARANTI_SUBE_KODU);
  if (env.GARANTI_HESAP_NO) ws.getCell("B3").value = Number(env.GARANTI_HESAP_NO);
  const b7 = ws.getCell("B7");
  b7.numFmt = "@";
  b7.value = ddmmyyyy(payDate);
  ws.getCell("B8").value = "M";
  ws.getCell("B9").value = "MAAŞ ÖDEMESİ";
  const alacak = `${periodUpper(period)} MAAŞ ÖDEME`;
  rows.forEach((r, i) => {
    const n = 13 + i;
    ws.getCell(`A${n}`).value = r.ad.toLocaleUpperCase("tr");
    if (r.tckn) ws.getCell(`B${n}`).value = numOrText(r.tckn);
    const iban = r.iban.replace(/\s/g, "").toUpperCase();
    const f = ws.getCell(`F${n}`);
    f.value = iban;
    const g = ws.getCell(`G${n}`);
    g.value = Math.round(r.tutar) / 100;
    g.numFmt = '_-* #,##0.00\\ _T_L_-;\\-* #,##0.00\\ _T_L_-;_-* "-"??\\ _T_L_-;_-@_-';
    ws.getCell(`H${n}`).value = { formula: `CONCATENATE(A${n}," ",I${n})`, result: `${r.ad.toLocaleUpperCase("tr")} ${alacak}` };
    ws.getCell(`I${n}`).value = alacak;
  });
  // Toplamlar formülle hesaplanıyor; açılışta yeniden hesaplansın
  wb.calcProperties = { fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface BesRow { tckn: string; ad: string; soyad: string; oran: number /* % */; tutar: number /* kuruş */ }

/** Garanti BBVA Emeklilik otomatik katılım ödeme dosyası (.xls) */
export function garantiEmeklilikXls(rows: BesRow[], period: string, payDate: string): Buffer {
  const env = process.env;
  // Excel tarih seri numarası (saat dilimi kayması olmasın diye elle)
  const d = (Date.parse(`${payDate}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const total = rows.reduce((a, r) => a + Math.round(r.tutar), 0) / 100;
  const info =
    "Herhangi bir hataya yol açmamak için dosyanın formatını değiştirmeyiniz, açıklamalara uyunuz. \n" +
    "Bir Önceki Dönemden Mahsup Edilecek Tutar alanında bir tutar belirtilmeyecek ise bu alanı 0 ile doldurunuz. Boş bırakmayınız.\n" +
    "Katkı Payının Matraha Oranı (Kesinti Oranı) alanına % işareti koymadan sadece tutar giriniz.\n" +
    "Ad Soyad alanı doldurulması zorunlu alanlar değildir, bu alana girdiğiniz değerler için format kontrolleri yapılmamaktadır. Ödemeler dosyada girdiğiniz Ad Soyad bilgisine göre değil TCKN/Mavi Kart No bilgisine ait sözleşmeler için yapılmaktadır.";
  const aoa: unknown[][] = [
    ["Grup Kodu", env.GARANTI_EMEKLILIK_GRUP_KODU ?? "", "Garanti BBVA Emeklilik tarafından grubunuza verilen kod bilgisidir."],
    ["SGK Sicil / Saymanlık / Kimlik Numarası", env.SGK_ISYERI_SICIL ?? "", "Şirketinize ait SGK sicil/saymanlık numarasıdır. Şahıs firmalarının TC Kimlik Numarasını bu alana girmeleri gerekmektedir."],
    ["Ödeme Tipi", "K", "K: Katkı Payı C: Ceza"],
    ["Tahsilat İşlem Tarihi", d, "Para transferinin yapılacağı tarih bilgisidir. (GG.AA.YYYY)"],
    ["Ödeme Dönemi", Number(period.replace("-", "")), "Otomatik katılım ödemesinin ait olduğu ödeme döneminin yıl ve ay bilgisidir. (YYYYAA)"],
    ["Ücret Ödeme Günü", d, "Otomatik katılım ödemesinin emeklilik şirketine yapılması gereken ödeme günü bilgisidir. (GG.AA.YYYY)"],
    ["Toplam Kayıt Adedi", rows.length, "Toplam Bireysel Emeklilik ödemesi yapacağınız çalışan sayısıdır."],
    ["Toplam Tahsilat Tutarı", total, "Çalışanlarınıza yapacağınız toplam Bireysel Emeklilik ödeme tutarıdır."],
    ["BİLGİLENDİRME:"],
    [info],
    ["TCKN/Mavi Kart No", "Ödenecek Tutar (TL)", "Bir Önceki Dönemden Mahsup Edilecek Tutar", "Katkı Payının Matraha Oranı (%)", "Ad", "Soyad"],
    ...rows.map((r) => [numOrText(r.tckn), Math.round(r.tutar) / 100, 0, r.oran, r.ad.toLocaleUpperCase("tr"), r.soyad.toLocaleUpperCase("tr")]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Bankanın örneğindeki biçimler: tarih (Excel'in yerel kısa tarihi), TCKN tam sayı, oran 0.00
  for (const ref of ["B4", "B6"]) if (ws[ref]) ws[ref].z = "m/d/yy";
  rows.forEach((_, i) => {
    const r = 12 + i;
    const a = ws[`A${r}`];
    if (a && a.t === "n") a.z = "0";
    const d = ws[`D${r}`];
    if (d) d.z = "0.00";
  });
  if (ws.B1) ws.B1.t = "s";
  if (ws.B2) ws.B2.t = "s";
  ws["!cols"] = [{ wch: 38 }, { wch: 28 }, { wch: 40 }, { wch: 30 }, { wch: 16 }, { wch: 16 }];
  ws["!merges"] = [{ s: { r: 9, c: 0 }, e: { r: 9, c: 5 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ödeme");
  return XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
}
