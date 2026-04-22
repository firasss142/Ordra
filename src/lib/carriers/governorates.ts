export const TUNISIAN_GOVERNORATES = [
  "Tunis",
  "Ariana",
  "Ben Arous",
  "Manouba",
  "Nabeul",
  "Zaghouan",
  "Bizerte",
  "Béja",
  "Jendouba",
  "Le Kef",
  "Siliana",
  "Sousse",
  "Monastir",
  "Mahdia",
  "Sfax",
  "Kairouan",
  "Kasserine",
  "Sidi Bouzid",
  "Gabès",
  "Médenine",
  "Tataouine",
  "Gafsa",
  "Tozeur",
  "Kébili",
] as const;

// Libyan governorates (shaʿbiyāt). Arabic names included for RTL market.
export const LIBYAN_GOVERNORATES: ReadonlyArray<{ fr: string; ar: string }> = [
  { fr: "Tripoli", ar: "طرابلس" },
  { fr: "Benghazi", ar: "بنغازي" },
  { fr: "Misrata", ar: "مصراتة" },
  { fr: "Zawiya", ar: "الزاوية" },
  { fr: "Zliten", ar: "زليتن" },
  { fr: "Al Khums", ar: "الخمس" },
  { fr: "Tarhuna", ar: "ترهونة" },
  { fr: "Sabratha", ar: "صبراتة" },
  { fr: "Sirte", ar: "سرت" },
  { fr: "Ajdabiya", ar: "أجدابيا" },
  { fr: "Tobruk", ar: "طبرق" },
  { fr: "Derna", ar: "درنة" },
  { fr: "Al Bayda", ar: "البيضاء" },
  { fr: "Al Marj", ar: "المرج" },
  { fr: "Sabha", ar: "سبها" },
  { fr: "Ghat", ar: "غات" },
  { fr: "Murzuq", ar: "مرزق" },
  { fr: "Ubari", ar: "أوباري" },
  { fr: "Kufra", ar: "الكفرة" },
  { fr: "Jufra", ar: "الجفرة" },
  { fr: "Nalut", ar: "نالوت" },
  { fr: "Gharyan", ar: "غريان" },
] as const;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const CITY_TO_GOVERNORATE: Record<string, string> = {
  // Tunis governorate
  tunis: "Tunis",
  "la marsa": "Tunis",
  "le bardo": "Tunis",
  "la goulette": "Tunis",
  carthage: "Tunis",
  "sidi bou said": "Tunis",
  "le kram": "Tunis",
  "sidi hassine": "Tunis",
  ettadhamen: "Tunis",
  medina: "Tunis",
  // Ariana
  ariana: "Ariana",
  raoued: "Ariana",
  "la soukra": "Ariana",
  "sidi thabet": "Ariana",
  mnihla: "Ariana",
  "kalaat el andalous": "Ariana",
  // Ben Arous
  "ben arous": "Ben Arous",
  "hammam lif": "Ben Arous",
  "hammam chott": "Ben Arous",
  rades: "Ben Arous",
  ezzahra: "Ben Arous",
  megrine: "Ben Arous",
  mourouj: "Ben Arous",
  fouchana: "Ben Arous",
  mornag: "Ben Arous",
  boumhel: "Ben Arous",
  // Manouba
  manouba: "Manouba",
  "den den": "Manouba",
  "douar hicher": "Manouba",
  "oued ellil": "Manouba",
  tebourba: "Manouba",
  jedaida: "Manouba",
  "borj el amri": "Manouba",
  // Nabeul
  nabeul: "Nabeul",
  hammamet: "Nabeul",
  korba: "Nabeul",
  kelibia: "Nabeul",
  "dar chaabane": "Nabeul",
  "menzel temime": "Nabeul",
  grombalia: "Nabeul",
  soliman: "Nabeul",
  "beni khiar": "Nabeul",
  "el haouaria": "Nabeul",
  // Zaghouan
  zaghouan: "Zaghouan",
  zriba: "Zaghouan",
  "el fahs": "Zaghouan",
  "bir mcherga": "Zaghouan",
  // Bizerte
  bizerte: "Bizerte",
  "menzel bourguiba": "Bizerte",
  "menzel jemil": "Bizerte",
  mateur: "Bizerte",
  "ras jebel": "Bizerte",
  sejnane: "Bizerte",
  utique: "Bizerte",
  // Béja
  beja: "Béja",
  "medjez el bab": "Béja",
  nefza: "Béja",
  testour: "Béja",
  teboursouk: "Béja",
  // Jendouba
  jendouba: "Jendouba",
  "bou salem": "Jendouba",
  tabarka: "Jendouba",
  "ain draham": "Jendouba",
  ghardimaou: "Jendouba",
  fernana: "Jendouba",
  // Le Kef
  "le kef": "Le Kef",
  dahmani: "Le Kef",
  tajerouine: "Le Kef",
  sers: "Le Kef",
  // Siliana
  siliana: "Siliana",
  "bou arada": "Siliana",
  gaafour: "Siliana",
  makthar: "Siliana",
  // Sousse
  sousse: "Sousse",
  msaken: "Sousse",
  "kalaa kebira": "Sousse",
  "hammam sousse": "Sousse",
  akouda: "Sousse",
  "kalaa sghira": "Sousse",
  enfidha: "Sousse",
  hergla: "Sousse",
  // Monastir
  monastir: "Monastir",
  moknine: "Monastir",
  jemmal: "Monastir",
  "ksar hellal": "Monastir",
  teboulba: "Monastir",
  sahline: "Monastir",
  zeramdine: "Monastir",
  // Mahdia
  mahdia: "Mahdia",
  "ksour essef": "Mahdia",
  "el jem": "Mahdia",
  chebba: "Mahdia",
  // Sfax
  sfax: "Sfax",
  "sakiet ezzit": "Sfax",
  "sakiet eddaier": "Sfax",
  thyna: "Sfax",
  agareb: "Sfax",
  jebeniana: "Sfax",
  mahares: "Sfax",
  kerkennah: "Sfax",
  // Kairouan
  kairouan: "Kairouan",
  haffouz: "Kairouan",
  sbikha: "Kairouan",
  nasrallah: "Kairouan",
  oueslatia: "Kairouan",
  // Kasserine
  kasserine: "Kasserine",
  sbeitla: "Kasserine",
  thala: "Kasserine",
  feriana: "Kasserine",
  foussana: "Kasserine",
  // Sidi Bouzid
  "sidi bouzid": "Sidi Bouzid",
  regueb: "Sidi Bouzid",
  jelma: "Sidi Bouzid",
  meknassy: "Sidi Bouzid",
  // Gabès
  gabes: "Gabès",
  mareth: "Gabès",
  ghannouch: "Gabès",
  "el hamma": "Gabès",
  matmata: "Gabès",
  // Médenine
  medenine: "Médenine",
  "djerba houmt souk": "Médenine",
  "djerba midoun": "Médenine",
  zarzis: "Médenine",
  "ben guerdane": "Médenine",
  // Tataouine
  tataouine: "Tataouine",
  ghomrassen: "Tataouine",
  remada: "Tataouine",
  // Gafsa
  gafsa: "Gafsa",
  metlaoui: "Gafsa",
  redeyef: "Gafsa",
  moulares: "Gafsa",
  "el guettar": "Gafsa",
  // Tozeur
  tozeur: "Tozeur",
  nefta: "Tozeur",
  degache: "Tozeur",
  // Kébili
  kebili: "Kébili",
  douz: "Kébili",
  "souk lahad": "Kébili",
};

export function resolveGovernorate(city: string | null): string | null {
  if (!city || !city.trim()) return null;
  const normalized = normalize(city.trim());
  return CITY_TO_GOVERNORATE[normalized] ?? city;
}
