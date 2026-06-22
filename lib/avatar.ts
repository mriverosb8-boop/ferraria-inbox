/** Paletas fijas para Tailwind (evita purgar clases dinámicas). Tonos suaves acordes a UI clara. */
export const AVATAR_GRADIENTS = [
  "from-[#b5a896] to-[#8f8274]",
  "from-[#a8b0b8] to-[#7d858f]",
  "from-[#c4b8a8] to-[#9a8f82]",
  "from-[#b8a99a] to-[#8c7f72]",
  "from-[#a3aeb8] to-[#76808a]",
  "from-[#c8a97e] to-[#9e8560]",
  "from-[#9eb0c4] to-[#6f7d8f]",
  "from-[#b9ada3] to-[#8a8078]",
] as const;

export function avatarGradientClass(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h + seed.charCodeAt(i) * (i + 1)) % 997;
  }
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

/** Paleta cálida plana (fondo, texto) para avatares cuadrados del rediseño (Dirección D). */
export const AVATAR_FLAT_COLORS = [
  { bg: "#f0d9b5", fg: "#8a6a36" },
  { bg: "#e8c9c4", fg: "#9c4f44" },
  { bg: "#d8d3c4", fg: "#6f6855" },
  { bg: "#e6d2bd", fg: "#8a6240" },
  { bg: "#cdd6cb", fg: "#4f6b56" },
  { bg: "#e2cdd6", fg: "#86566a" },
] as const;

/** Color de fondo/texto de avatar derivado por hash del `seed` (id de conversación/huésped). */
export function avatarFlatColors(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h + seed.charCodeAt(i) * (i + 1)) % 997;
  }
  return AVATAR_FLAT_COLORS[h % AVATAR_FLAT_COLORS.length]!;
}

const LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*️?)\s*/u;

/** Separa un emoji inicial del nombre real de WhatsApp (p.ej. "😎 JPC" → { emoji:"😎", rest:"JPC" }). */
export function splitLeadingEmoji(name: string): { emoji: string | null; rest: string } {
  const trimmed = name.trim();
  const match = trimmed.match(LEADING_EMOJI_RE);
  if (match) {
    return { emoji: match[1]!, rest: trimmed.slice(match[0].length).trim() || trimmed };
  }
  return { emoji: null, rest: trimmed };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
