/**
 * Nombre en español de un idioma a partir de su código ISO 639-1, para la marca
 * "Traducido del inglés" en las burbujas del huésped.
 *
 * El código lo escribe el engine en `Wubby_Whatsapp.inbound_detected_lang`
 * (`null` = el mensaje ya venía en español). Puede llegar con región
 * (`en-US`, `pt-BR`) o con mayúsculas: solo importa la raíz.
 *
 * Mapa explícito a propósito, sin `Intl.DisplayNames`: los nombres que ve
 * recepción no pueden cambiar según el navegador o el locale del equipo, y un
 * idioma que no esté acá cae al copy genérico en vez de mostrar un código
 * críptico.
 */
const LANGUAGE_NAMES_ES: Record<string, string> = {
  af: "afrikáans",
  am: "amárico",
  ar: "árabe",
  az: "azerí",
  be: "bielorruso",
  bg: "búlgaro",
  bn: "bengalí",
  bs: "bosnio",
  ca: "catalán",
  cs: "checo",
  da: "danés",
  de: "alemán",
  el: "griego",
  en: "inglés",
  es: "español",
  et: "estonio",
  eu: "euskera",
  fa: "persa",
  fi: "finés",
  fr: "francés",
  ga: "irlandés",
  gl: "gallego",
  gu: "guyaratí",
  ha: "hausa",
  he: "hebreo",
  hi: "hindi",
  hr: "croata",
  hu: "húngaro",
  hy: "armenio",
  id: "indonesio",
  is: "islandés",
  it: "italiano",
  ja: "japonés",
  ka: "georgiano",
  kk: "kazajo",
  km: "jemer",
  kn: "canarés",
  ko: "coreano",
  lo: "lao",
  lt: "lituano",
  lv: "letón",
  mk: "macedonio",
  ml: "malayalam",
  mn: "mongol",
  mr: "maratí",
  ms: "malayo",
  my: "birmano",
  nb: "noruego",
  ne: "nepalí",
  nl: "neerlandés",
  nn: "noruego",
  no: "noruego",
  pa: "panyabí",
  pl: "polaco",
  ps: "pastún",
  pt: "portugués",
  ro: "rumano",
  ru: "ruso",
  si: "cingalés",
  sk: "eslovaco",
  sl: "esloveno",
  sq: "albanés",
  sr: "serbio",
  sv: "sueco",
  sw: "suajili",
  ta: "tamil",
  te: "telugu",
  th: "tailandés",
  tl: "tagalo",
  tr: "turco",
  uk: "ucraniano",
  ur: "urdu",
  uz: "uzbeko",
  vi: "vietnamita",
  yo: "yoruba",
  zh: "chino",
  zu: "zulú",
};

/**
 * Devuelve el nombre del idioma en español, o `null` si el código viene vacío o
 * no está en el mapa. El `null` NO es un error: significa "no sabemos de qué
 * idioma venía", y quien llame debe caer a un texto genérico.
 */
export function describeLanguage(code?: string | null): string | null {
  if (typeof code !== "string") return null;
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  if (!base) return null;
  return LANGUAGE_NAMES_ES[base] ?? null;
}

/**
 * Copy de la marca de traducción en la burbuja del huésped. Con idioma conocido
 * dice de dónde se tradujo; sin él, solo que está traducido.
 */
export function describeInboundTranslationLabel(code?: string | null): string {
  const name = describeLanguage(code);
  return name ? `Traducido del ${name}` : "Traducido al español";
}
