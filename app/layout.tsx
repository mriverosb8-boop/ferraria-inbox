import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

/** Sans del rediseño: nombres, mensajes, títulos y copy de interfaz. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/** Mono del rediseño: horas, teléfonos, contadores, labels de sección, IDs. */
const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
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

/** Bloquea pinch-zoom para sensación nativa (PWA). El zoom al enfocar ya se evita con input ≥16px en móvil. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-x-hidden overflow-y-hidden bg-[var(--bg-app)] font-sans text-[var(--text-primary)] antialiased">
        {children}
      </body>
    </html>
  );
}
