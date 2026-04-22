export const CITY_TO_GOVERNORATE: Record<string, string> = {
  // Tunis
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
  // La Manouba
  manouba: "La Manouba",
  "la manouba": "La Manouba",
  "den den": "La Manouba",
  "douar hicher": "La Manouba",
  "oued ellil": "La Manouba",
  tebourba: "La Manouba",
  jedaida: "La Manouba",
  // Nabeul
  nabeul: "Nabeul",
  hammamet: "Nabeul",
  korba: "Nabeul",
  kelibia: "Nabeul",
  "dar chaabane": "Nabeul",
  "menzel temime": "Nabeul",
  grombalia: "Nabeul",
  soliman: "Nabeul",
  // Zaghouan
  zaghouan: "Zaghouan",
  zriba: "Zaghouan",
  "el fahs": "Zaghouan",
  // Bizerte
  bizerte: "Bizerte",
  "menzel bourguiba": "Bizerte",
  mateur: "Bizerte",
  "ras jebel": "Bizerte",
  sejnane: "Bizerte",
  // Béja
  beja: "Béja",
  "medjez el bab": "Béja",
  testour: "Béja",
  // Jendouba
  jendouba: "Jendouba",
  "bou salem": "Jendouba",
  tabarka: "Jendouba",
  // Le Kef
  "le kef": "Le Kef",
  dahmani: "Le Kef",
  // Siliana
  siliana: "Siliana",
  makthar: "Siliana",
  // Sousse
  sousse: "Sousse",
  msaken: "Sousse",
  "kalaa kebira": "Sousse",
  "hammam sousse": "Sousse",
  akouda: "Sousse",
  enfidha: "Sousse",
  // Monastir
  monastir: "Monastir",
  moknine: "Monastir",
  jemmal: "Monastir",
  "ksar hellal": "Monastir",
  // Mahdia
  mahdia: "Mahdia",
  "el jem": "Mahdia",
  chebba: "Mahdia",
  // Sfax
  sfax: "Sfax",
  jebeniana: "Sfax",
  mahares: "Sfax",
  // Kairouan
  kairouan: "Kairouan",
  haffouz: "Kairouan",
  // Kasserine
  kasserine: "Kasserine",
  sbeitla: "Kasserine",
  thala: "Kasserine",
  feriana: "Kasserine",
  // Sidi Bouzid
  "sidi bouzid": "Sidi Bouzid",
  regueb: "Sidi Bouzid",
  // Gabès
  gabes: "Gabès",
  mareth: "Gabès",
  matmata: "Gabès",
  // Médenine
  medenine: "Médenine",
  zarzis: "Médenine",
  "ben guerdane": "Médenine",
  // Tataouine
  tataouine: "Tataouine",
  // Gafsa
  gafsa: "Gafsa",
  metlaoui: "Gafsa",
  redeyef: "Gafsa",
  // Tozeur
  tozeur: "Tozeur",
  nefta: "Tozeur",
  // Kébili
  kebili: "Kébili",
  douz: "Kébili",
};

export function mapCityToGovernorate(city: string): string {
  const key = city.trim().toLowerCase();
  return CITY_TO_GOVERNORATE[key] ?? city.trim();
}
