/** SGK kod listeleri (4A işe giriş / işten ayrılış kılavuzu) */
export const CIKIS_NEDENI: Record<string, string> = {
  "1": "Deneme süreli sözleşmenin işverence feshi", "2": "Deneme süreli sözleşmenin işçi tarafından feshi", "3": "Belirsiz süreli sözleşmenin işçi tarafından feshi (istifa)",
  "4": "Belirsiz süreli sözleşmenin işveren tarafından haklı sebep bildirilmeden feshi", "5": "Belirli süreli sözleşmenin sona ermesi", "8": "Emeklilik (yaşlılık) veya toptan ödeme",
  "9": "Malulen emeklilik", "10": "Ölüm", "11": "İş kazası sonucu ölüm", "12": "Askerlik", "13": "Kadın işçinin evlenmesi", "14": "Emeklilik için yaş dışında diğer şartların tamamlanması",
  "15": "Toplu işçi çıkarma", "16": "Aynı işverene ait diğer işyerine nakil", "17": "İşyerinin kapanması", "18": "İşin sona ermesi", "19": "Mevsim bitimi", "20": "Kampanya bitimi",
  "21": "Statü değişikliği", "22": "Diğer nedenler", "23": "İşçi tarafından zorunlu nedenle fesih", "24": "İşçi tarafından sağlık nedeniyle fesih",
  "25": "İşçi tarafından işverenin ahlak ve iyiniyet kurallarına aykırı davranışı nedeniyle fesih", "26": "Disiplin kurulu kararı ile fesih", "27": "İşveren tarafından zorunlu nedenlerle ve tutukluluk nedeniyle fesih",
  "28": "İşveren tarafından sağlık nedeniyle fesih", "29": "İşveren tarafından işçinin ahlak ve iyiniyet kurallarına aykırı davranışı nedeniyle fesih", "30": "Vize süresinin bitimi",
  "31": "Borçlar Kanunu, sendikalar ve toplu iş sözleşmesi kanunu kapsamında kendi istek ve kusuru dışında fesih", "32": "4046 sayılı Kanun md. 21 kapsamında özelleştirme nedeniyle fesih",
  "33": "Gazeteci tarafından sözleşmenin feshi", "34": "İşyerinin devri, işin veya işyerinin niteliğinin değişmesi nedeniyle fesih", "35": "6495 sayılı Kanun kapsamında devlet memurluğuna geçiş", "36": "KHK ile kamu görevinden çıkarma",
};
export const EKSIK_GUN: Record<string, string> = { "0": "Eksik gün yok", "1": "İstirahat", "2": "Ücretsiz izin", "3": "Disiplin cezası", "4": "Gözaltına alınma", "5": "Tutukluluk", "6": "Kısmi istihdam", "7": "Puantaj kayıtları", "8": "Grev", "9": "Lokavt", "10": "Genel hayatı etkileyen olaylar", "11": "Doğal afet", "12": "Birden fazla neden", "14": "Diğer", "15": "Devamsızlık", "16": "Fesih tarihinde çalışmamış", "17": "Ev hizmetlerinde 30 günden az", "18": "Kısa çalışma ödeneği" };
export const OGRENIM: Record<string, string> = { "0": "Bilinmeyen", "1": "Okur yazar değil", "2": "İlkokul", "3": "Ortaokul / İÖO", "4": "Lise / dengi", "5": "Yüksekokul / fakülte", "6": "Yüksek lisans", "7": "Doktora" };
export const GOREV: Record<string, string> = { "1": "İşveren veya vekili", "2": "İşçi", "3": "4/b kapsamında çalışan", "4": "4/c kapsamında çalışan", "5": "Çırak ve stajyer öğrenci", "6": "Diğer" };
export const SIGORTA_KOLU: Record<string, string> = { "0": "Tüm sigorta kolları", "7": "Çırak", "8": "Sosyal güvenlik destek primi (emekli)", "12": "Uluslararası sözleşmesi olmayan yabancı", "14": "Cezaevi çalışanı", "16": "İŞKUR kursiyeri", "17": "İş kaybı tazminatı alan", "18": "Kısmi istihdam (YÖK)", "19": "Stajyer öğrenci", "24": "İntörn öğrenci", "25": "Harp / vazife malulü", "32": "Bursiyer" };
export const IS_KOLU: Record<string, string> = { "1": "Tarım, ormancılık, avcılık ve balıkçılık", "2": "Madencilik", "3": "Petrol, kimya ve lastik", "4": "Gıda sanayii", "5": "Şeker", "6": "Dokuma", "7": "Deri", "8": "Ağaç", "9": "Kâğıt", "10": "Basın ve yayın", "11": "Banka ve sigorta", "12": "Çimento, toprak ve cam", "13": "Metal", "14": "Gemi", "15": "İnşaat", "16": "Enerji", "17": "Ticaret, büro, eğitim ve güzel sanatlar", "18": "Kara taşımacılığı", "19": "Demiryolu taşımacılığı", "20": "Deniz taşımacılığı", "21": "Hava taşımacılığı", "22": "Ardiye ve antrepoculuk", "23": "Haberleşme", "24": "Sağlık", "25": "Konaklama ve eğlence yerleri", "26": "Milli savunma", "27": "Gazetecilik", "28": "Genel işler" };

/** Özlükteki öğrenim metnini SGK koduna çevirir */
export function educationCode(v: string | null | undefined) {
  const s = (v ?? "").toLocaleLowerCase("tr");
  if (!s) return 0;
  if (s.includes("doktora")) return 7;
  if (s.includes("yüksek lisans") || s.includes("master")) return 6;
  if (s.includes("lisans") || s.includes("fakülte") || s.includes("üniversite") || s.includes("yüksekokul") || s.includes("meslek yüksek")) return 5;
  if (s.includes("lise")) return 4;
  if (s.includes("orta")) return 3;
  if (s.includes("ilk")) return 2;
  if (s.includes("okur")) return 1;
  return 0;
}

export const DEFAULT_URLS = {
  test: { giris: "https://sgkt.sgk.gov.tr/WS_SgkTescil4a/WS_SgkIseGirisService?wsdl", cikis: "https://sgkt.sgk.gov.tr/WS_SgkTescil4a/WS_SgkIstenCikisService?wsdl", vizite: "https://sgkt.sgk.gov.tr/Ws_Vizite/services/ViziteGonder" },
  canli: { giris: "https://uyg.sgk.gov.tr/WS_SgkTescil4a/WS_SgkIseGirisService?wsdl", cikis: "https://uyg.sgk.gov.tr/WS_SgkTescil4a/WS_SgkIstenCikisService?wsdl", vizite: "https://uyg.sgk.gov.tr/Ws_Vizite/services/ViziteGonder" },
};
export const SGK_LINKS = {
  tekilGiris: "https://uyg.sgk.gov.tr/SigortaliTescil/amp/loginldap",
  topluGiris: "https://uyg.sgk.gov.tr/SgkTescil4a/",
  isveren: "https://e.sgk.gov.tr/Uygulamalar/Isveren",
  isKazasi: "https://e.sgk.gov.tr/Uygulamalar/Isveren",
  ebildirge: "https://ebildirge.sgk.gov.tr/EBildirgeV2",
  vizite: "https://uyg.sgk.gov.tr/vizite/welcome.do",
};
