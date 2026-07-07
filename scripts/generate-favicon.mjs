// Genera app/favicon.ico (16/32/48) desde app/icon.png (spark rojo sobre transparente).
// Mantiene la transparencia (fondo alpha 0). Ensambla el contenedor ICO a mano con
// PNG-in-ICO, así no necesita ImageMagick ni una dependencia extra: solo `sharp`,
// que ya es dep del proyecto.
//
// NO toca app/icon.png ni public/icons/* (esos son los íconos PWA y se generan
// aparte con scripts/generate-pwa-icons.mjs).
//
// Uso: node scripts/generate-favicon.mjs

import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const SRC = "app/icon.png";
const OUT = "app/favicon.ico";
const SIZES = [16, 32, 48];
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function main() {
  // Un PNG por tamaño, con el spark centrado sobre lienzo transparente.
  const pngs = await Promise.all(
    SIZES.map((size) =>
      sharp(SRC)
        .resize(size, size, { fit: "contain", background: TRANSPARENT })
        .png()
        .toBuffer()
    )
  );

  // Cabecera ICONDIR (6 bytes) + una ICONDIRENTRY (16 bytes) por imagen.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // type = 1 (icono)
  header.writeUInt16LE(pngs.length, 4); // número de imágenes

  const entries = [];
  let offset = 6 + 16 * pngs.length; // los datos empiezan tras todas las entradas
  pngs.forEach((png, i) => {
    const entry = Buffer.alloc(16);
    const dim = SIZES[i] >= 256 ? 0 : SIZES[i]; // 0 significa 256 en el formato ICO
    entry.writeUInt8(dim, 0); // ancho
    entry.writeUInt8(dim, 1); // alto
    entry.writeUInt8(0, 2); // colores en paleta (0 = sin paleta)
    entry.writeUInt8(0, 3); // reservado
    entry.writeUInt16LE(1, 4); // planos de color
    entry.writeUInt16LE(32, 6); // bits por píxel (RGBA)
    entry.writeUInt32LE(png.length, 8); // tamaño de los datos de la imagen
    entry.writeUInt32LE(offset, 12); // offset a los datos
    offset += png.length;
    entries.push(entry);
  });

  const ico = Buffer.concat([header, ...entries, ...pngs]);
  await writeFile(OUT, ico);
  console.log(`✓ ${OUT} generado (${SIZES.join("/")}px, ${ico.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
