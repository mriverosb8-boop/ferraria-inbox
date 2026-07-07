import type { MetadataRoute } from "next";

/**
 * Web App Manifest (servido en /manifest.webmanifest por la convención de Next).
 * Excluido del middleware de Supabase en `middleware.ts` para que sea público.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FerrarIA Inbox",
    short_name: "FerrarIA",
    description: "Bandeja de conversaciones para recepción hotelera.",
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ee",
    theme_color: "#f7f4ee",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
