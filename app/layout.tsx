import type { Metadata, Viewport } from "next";
import { Archivo, Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";

/** Cuerpo / texto base del rediseño (Dirección D). */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/** Nombres, títulos, botones y etiquetas UI. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/** Horas, teléfonos, contadores, badges de atajo, etiquetas de sección. */
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "FerrarIA Inbox",
  description: "Bandeja de conversaciones para recepción hotelera.",
};

/** Sin tocar maximumScale: el zoom al enfocar se evita con input ≥16px en móvil. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${spaceGrotesk.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-x-hidden overflow-y-hidden bg-[#f7f4ee] font-sans text-[#1f1f1c] antialiased">{children}</body>
    </html>
  );
}
