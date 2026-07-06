import type { Metadata, Viewport } from "next";
import { Archivo, Space_Grotesk, Space_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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
  appleWebApp: {
    capable: true,
    title: "FerrarIA",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

/** Sin tocar maximumScale: el zoom al enfocar se evita con input ≥16px en móvil. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#17130f" },
  ],
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-x-hidden overflow-y-hidden bg-[var(--bg)] font-sans text-[var(--ink)] antialiased">
        {children}
      </body>
    </html>
  );
}
