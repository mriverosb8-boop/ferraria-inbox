// Genera los íconos PWA desde app/icon.png (artwork rojo sobre transparente).
// Rasteriza sobre fondo blanco: el rojo sobre transparente quedaría invisible
// o negro al aplanar alpha (apple-touch) o al aplicar la máscara (maskable).
//
// Uso: node scripts/generate-pwa-icons.mjs
// Requiere `sharp` (resoluble vía las deps del proyecto).

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = "app/icon.png";
const OUT_DIR = "public/icons";
const BG = "#ffffff";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Íconos "any" + apple-touch: logo a sangre sobre blanco.
  const flat = [
    { file: "icon-192.png", size: 192 },
    { file: "icon-512.png", size: 512 },
    { file: "apple-touch-icon.png", size: 180 },
  ];
  for (const { file, size } of flat) {
    await sharp(SRC)
      .resize(size, size, { fit: "contain", background: BG })
      .flatten({ background: BG })
      .png()
      .toFile(path.join(OUT_DIR, file));
  }

  // Maskable: logo al 80% centrado (zona segura) sobre lienzo blanco 512.
  const MASK = 512;
  const inner = Math.round(MASK * 0.8); // 410px
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: MASK, height: MASK, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(OUT_DIR, "icon-512-maskable.png"));

  console.log("Íconos generados en", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
