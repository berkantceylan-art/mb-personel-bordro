// Portal ek metinleri: tekrar sipariş, bildirimler, uygunluk beyanı, hesap (cari), ekip
import type { Locale } from "./i18n";

type X = {
  repeat: string;
  repeatTitle: string;
  drop: string;
  notifNav: string;
  notifTitle: string;
  notifEmpty: string;
  notifCase: string;
  notifShipment: string;
  notifMessage: string;
  declaration: string;
  decl: {
    title: string;
    subtitle: string;
    manufacturer: string;
    device: string;
    deviceText: string;
    patient: string;
    prescriber: string;
    teeth: string;
    product: string;
    materials: string;
    statement: string;
    statement2: string;
    date: string;
    sign: string;
    caseNo: string;
    print: string;
  };
};

export const PX: Record<Locale, X> = {
  tr: {
    repeat: "Bu vakayı tekrarla",
    repeatTitle: "Tekrar sipariş",
    drop: "Dosyaları buraya sürükleyip bırakabilirsiniz (STL, PLY, ZIP, foto; dosya başına 50 MB).",
    notifNav: "Bildirimler",
    notifTitle: "Bildirimler",
    notifEmpty: "Henüz bildirim yok.",
    notifCase: "Vaka",
    notifShipment: "Paket",
    notifMessage: "Laboratuvardan mesaj",
    declaration: "Uygunluk beyanı",
    decl: {
      title: "Ismarlama Tıbbi Cihaz Beyanı",
      subtitle: "Tıbbi Cihaz Yönetmeliği (AB) 2017/745 Ek XIII uyarınca",
      manufacturer: "İmalatçı",
      device: "Cihaz",
      deviceText: "Belirli bir hasta için yetkili sağlık profesyonelinin reçetesine göre üretilmiş ısmarlama diş protezi",
      patient: "Hasta kodu",
      prescriber: "Reçeteyi düzenleyen",
      teeth: "Diş numaraları",
      product: "Ürün",
      materials: "Renk",
      statement: "Bu cihazın yalnızca belirtilen hasta için üretildiğini ve Yönetmelik Ek I'deki genel güvenlik ve performans gerekliliklerine uygun olduğunu beyan ederiz.",
      statement2: "Uygun olmayan bir gereklilik varsa nedenleriyle birlikte üretim dosyasında belirtilmiştir.",
      date: "Tarih",
      sign: "Yetkili imza",
      caseNo: "Vaka no",
      print: "Yazdır / PDF",
    },
  },
  en: {
    repeat: "Repeat this case",
    repeatTitle: "Repeat order",
    drop: "You can drag and drop files here (STL, PLY, ZIP, photos; 50 MB per file).",
    notifNav: "Notifications",
    notifTitle: "Notifications",
    notifEmpty: "No notifications yet.",
    notifCase: "Case",
    notifShipment: "Parcel",
    notifMessage: "Message from the lab",
    declaration: "Declaration of conformity",
    decl: {
      title: "Statement for Custom-Made Devices",
      subtitle: "In accordance with Annex XIII of Regulation (EU) 2017/745",
      manufacturer: "Manufacturer",
      device: "Device",
      deviceText: "Custom-made dental prosthesis manufactured for a specific patient according to the written prescription of an authorised professional",
      patient: "Patient code",
      prescriber: "Prescriber",
      teeth: "Teeth",
      product: "Product",
      materials: "Shade",
      statement: "We declare that this device is intended exclusively for the patient identified above and conforms to the general safety and performance requirements set out in Annex I of the Regulation.",
      statement2: "Where any requirement has not been fully met, the reasons are stated in the technical documentation.",
      date: "Date",
      sign: "Authorised signature",
      caseNo: "Case no",
      print: "Print / PDF",
    },
  },
  fr: {
    repeat: "Renouveler ce cas",
    repeatTitle: "Nouvelle commande",
    drop: "Vous pouvez glisser-déposer vos fichiers ici (STL, PLY, ZIP, photos ; 50 Mo par fichier).",
    notifNav: "Notifications",
    notifTitle: "Notifications",
    notifEmpty: "Aucune notification pour le moment.",
    notifCase: "Cas",
    notifShipment: "Colis",
    notifMessage: "Message du laboratoire",
    declaration: "Déclaration de conformité",
    decl: {
      title: "Déclaration relative aux dispositifs sur mesure",
      subtitle: "Conformément à l’annexe XIII du règlement (UE) 2017/745",
      manufacturer: "Fabricant",
      device: "Dispositif",
      deviceText: "Prothèse dentaire sur mesure fabriquée pour un patient déterminé selon la prescription écrite d’un professionnel habilité",
      patient: "Code patient",
      prescriber: "Prescripteur",
      teeth: "Dents",
      product: "Produit",
      materials: "Teinte",
      statement: "Nous déclarons que ce dispositif est destiné à l’usage exclusif du patient identifié ci-dessus et qu’il est conforme aux exigences générales en matière de sécurité et de performances énoncées à l’annexe I du règlement.",
      statement2: "Le cas échéant, les exigences non entièrement satisfaites sont indiquées avec leur justification dans la documentation technique.",
      date: "Date",
      sign: "Signature autorisée",
      caseNo: "N° de cas",
      print: "Imprimer / PDF",
    },
  },
};
