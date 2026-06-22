This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.




# Handoff: Inbox FerrarIA — Dirección D (Combinada)

## Resumen
Rediseño del **Inbox de FerrarIA** (recepción virtual con IA para hoteles, canal WhatsApp).
Pantalla única de 3 columnas: lista de conversaciones · hilo de chat · panel de contexto/acciones.
Objetivo: mayor contraste, jerarquía clara de "qué chat necesita atención humana YA",
distinción inconfundible IA vs agente humano, y acciones rápidas evidentes. Tema claro y oscuro.

La dirección **D** combina lo mejor de tres exploraciones:
- **Izquierda** (lista): estilo editorial "Cola operativa".
- **Centro** (hilo): mensajería cálida con avatares y burbujas grandes.
- **Derecha** (panel): cockpit operativo con acciones + atajos y datos en mono.

## Sobre los archivos de diseño
Los archivos de este paquete son **referencias de diseño hechas en HTML/React** (prototipos que
muestran el aspecto y comportamiento buscados), **no código de producción para copiar tal cual**.
La tarea es **recrear estos diseños en el entorno de tu inbox real** usando sus patrones y librerías
ya establecidos (el framework que uses). Los `.jsx` aquí usan `React.createElement` plano (sin JSX)
porque corrían en un canvas de previsualización; en tu app puedes escribirlos como JSX normal.

## Fidelidad
**Alta fidelidad (hifi).** Colores, tipografía, espaciado e interacciones están definidos.
Recrear la UI fielmente con las librerías/patrones de tu codebase. Donde tu app ya tenga un
componente equivalente (botón, avatar, input), úsalo y aplícale estos tokens.

---

## Pantalla: Inbox (vista única, 3 columnas)

**Layout raíz** — columna vertical:
- Contenedor `.ibx`: `width:100%; height:100%`, `font-family: Archivo`, `background: var(--bg)`, `color: var(--ink)`, `display:flex; flex-direction:column; overflow:hidden`.
- **Header** (altura fija 62px) + **Body** (grid que ocupa el resto).
- **Body**: `display:grid; grid-template-columns: 344px 1fr 312px; min-height:0`.
  - IMPORTANTE: la columna central (`main`) y las laterales (`aside`) llevan `min-width:0` y `min-height:0` para que el `1fr` no desborde y el panel derecho no se corte.

### Header (62px)
`background: var(--panel)`, `border-bottom: 1px solid var(--line)`, `padding: 0 22px`, `display:flex; align-items:center; gap:22px`.
- **Logo**: destello (SVG, ver Assets) 24px en `var(--red)` + wordmark "Ferrar**IA**" (Space Grotesk, 19px, 700, letter-spacing -0.02em; "IA" en `var(--red)`).
- **Tabs** (segmented, fondo `var(--panel-2)`, radio 10px, padding 3): "Conversaciones" (activa: fondo `var(--panel)`, sombra `--shadow-sm`) · "Reservas 0" (inactiva: texto `var(--ink-2)`). 13.5px/600.
- **Derecha** (`margin-left:auto`, gap 8):
  - Pill **"Conectado"**: fondo `var(--live-soft)`, texto `var(--live)`, dot 7px `var(--live)`, radio 999, padding 6/13, 12.5px/600. (Texto literal: solo "Conectado", sin "Realtime:".)
  - Botón fantasma **"Ayuda"** (icono help 16px + texto, `var(--ink-2)`).
  - **Avatar** del agente (iniciales "YO", 32px).

### Columna IZQUIERDA — Lista "Cola operativa" (344px)
`aside`: `background: var(--panel)`, `border-right: 1px solid var(--line)`, `display:flex; flex-direction:column`.
- **Cabecera** (padding 18/20/14):
  - Título "COLA OPERATIVA" (Space Grotesk, 13px, 700, `letter-spacing:.13em`, `text-transform:uppercase`, `var(--ink-2)`) + contador "196" en mono a la derecha (`var(--ink-3)`).
  - **Buscador**: input con icono lupa 16px a la izquierda. Padding `11px 14px 11px 38px`, radio 11, `border:1px solid var(--line)`, `background: var(--panel-3)`, 13.5px. Placeholder "Buscar huésped o mensaje…".
  - **Filtros** (pills, flex-wrap gap 7): "Todas 196" (activa: `background:var(--ink)`, `color:var(--panel)`), "Sin leer 0", "IA activa 44", "Atención 3" (inactivas: `background:var(--panel-2)`, `color:var(--ink-2)`). Texto 12.5px/600; contador en mono 11px.
  - **Selector de hotel**: botón ancho "🏨 ibis Barranquilla" + chevron a la derecha. `border:1px solid var(--line)`, `background:var(--panel-2)`, radio 11.
- **Lista** (scroll vertical, `border-top:1px solid var(--line)`): filas `Row` (ver Componentes).

### Columna CENTRO — Hilo (1fr)
`main`: `background: var(--bg)`, `display:flex; flex-direction:column; min-width:0; min-height:0`.
- **Cabecera del hilo** (padding 14/26, `background:var(--panel)`, `border-bottom:1px solid var(--line)`):
  - Avatar 44px con **anillo rojo** (`ring`) + nombre "😎 JPC" (Space Grotesk 17px/700) + subtítulo "● Requiere atención humana" (dot 7px + texto `var(--red)` 12.5px/600).
  - Botón circular "bloquear" a la derecha (icono block 17px, 40×40, `border:1px solid var(--line)`, radio 999).
- **Mensajes** (scroll, padding 24/40/8): burbujas `Bubble` (ver Componentes).
- **Pie** (padding 0/26/20):
  - **Chips de acción rápida** (fila scroll-x, gap 9, padding 14/2): ver `ActionChip`. Orden: "Asunto resuelto" (primario rojo), "Tomar control humano", "Reactivar IA", "Marcar como completado", "Crear resumen del chat".
  - **Compositor píldora**: contenedor `border-radius:999`, `background:var(--panel)`, `border:1px solid var(--line)`, `box-shadow: var(--shadow)`, padding `9px 10px 9px 18px`, `display:flex; align-items:center; gap:12`.
    - Botón imagen (icono 20px, 38×38, transparente).
    - Input flex `min-width:0`, placeholder "Escribe como agente humano…", 15px.
    - Botón enviar circular 44×44, `background:var(--red)`, icono send 19px blanco.

### Columna DERECHA — Panel cockpit (312px)
`aside`: scroll vertical, `background:var(--panel)`, `border-left:1px solid var(--line)`, padding 18/16, `min-width:0`.
- **Cabecera** (gap 12, padding-bottom 16, `border-bottom:1px solid var(--line)`): avatar 50px + nombre "😎 JPC" (16px/700) + teléfono en mono "+57 301 372 0223" 11px `var(--ink-3)`.
- **Bloque "ACCIONES"** (padding 16/0, borde inferior):
  - Etiqueta mono 10px/700 `letter-spacing:.14em` uppercase `var(--ink-3)`.
  - Botón primario ancho **"Asunto resuelto"** (icono check 17px, `background:var(--red)`, blanco, radio 11, 14px/700).
  - Grid 2×2 de `CmdAction`: "Tomar control humano ⌘H", "Reactivar IA ⌘R", "Marcar como completado ⌘D", "Crear resumen del chat ⌘S".
- **Bloque "RESUMEN DEL CHAT"** (padding 16/0, borde inferior): etiqueta + botón "✦ Generar" (borde, texto `var(--red)`) a la derecha. Cuerpo mono 12px `var(--ink-3)`: "Sin resumen aún.".
- **Bloque "DATOS"** (padding 16/0): filas mono 12px (clave `var(--ink-3)` izquierda, valor `var(--ink)` derecha, `border-bottom:1px solid var(--line-2)`):
  - Teléfono → +57 301 372 0223 · Canal → WhatsApp · Hotel → ibis Barranquilla · Estado IA → En pausa.

---

## Componentes

### Avatar
Cuadrado redondeado. `width=height=size`, `border-radius: size*0.34`, `display:grid; place-items:center`.
- Si el huésped tiene **emoji** (viene del nombre real de WhatsApp), se muestra el emoji a `font-size: size*0.5`.
- Si no, **iniciales** (2 letras, Space Grotesk 700, `font-size: size*0.36`).
- Color de fondo/texto derivado por hash del `id` entre una paleta cálida (ver Tokens · Avatares). No inventar colores fuera de esa lista.
- Prop `ring`: si `true`, añade `box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--red)` (halo de atención).
- Estado IA en lista: badge inferior-derecha 16px circular `var(--live)` con destello blanco 8px (solo en filas con `state:'ia'` — opcional, ver C original).

### Row (fila de conversación) — izquierda
`position:relative; display:flex; gap:13; padding:15px 20px 15px 22px; border-bottom:1px solid var(--line-2)`.
- Si `state==='attention'`: barra vertical izquierda 3px `var(--red)` (absolute, top0 bottom0 left0). Fila seleccionada: `background: var(--sel)` + `box-shadow: var(--shadow-sm)`.
- Avatar 42px. A la derecha, columna `flex:1; min-width:0`:
  - Línea 1: nombre (emoji + nombre, Space Grotesk 14.5px/600, truncado con ellipsis) + hora en mono 11px `var(--ink-3)` (margin-left:auto).
  - Línea 2: preview 13px, truncado. Si `unread`: `color:var(--ink)` peso 600; si no, `var(--ink-2)` peso 400.
  - Línea 3: `StatusToken` + (si unread) punto rojo 8px a la derecha.

### StatusToken
- `attention`: pill rojo sólido "● Atención" (fondo `var(--red)`, blanco, 11px/700, dot 6px).
- `ia`: "● IA activa" (dot `var(--live)`), `pending`: "● Pendiente" (dot `var(--gold)`), `done`: "● Resuelto" (dot `var(--ink-3)`). Texto `var(--ink-3)` 11.5px/600.

### Bubble (mensaje) — centro
Distingue 4 emisores. `margin-bottom:18px`.
- **day** (separador de fecha): pill centrado, fondo `var(--panel-2)`, 11.5px/600 `var(--ink-3)`, radio 999.
- **system** (eventos, p.ej. "Se reenvió el formulario…"): pill centrado con icono doc, fondo `var(--panel-2)`, 12.5px `var(--ink-2)`.
- **guest** (huésped): fila normal (avatar 34px a la izquierda). Burbuja `background:var(--panel-2)`, `color:var(--ink)`, `border-radius: 6px 20px 20px 20px`.
- **ia** (FerrarIA): fila invertida (`flex-direction:row-reverse`). Icono 34px cuadrado-redondeado `background:var(--red-soft)` con **destello rojo**. Etiqueta "FerrarIA · IA" (`var(--red)` 11px/700). Burbuja `background:var(--red-soft)` con `border:1.5px solid color-mix(in srgb, var(--red) 35%, transparent)`, `color:var(--ink)`, `border-radius: 20px 20px 6px 20px`.
- **agent** (tú): fila invertida. Icono 34px `background:var(--red)` con icono usuario blanco. Etiqueta "Tú · agente" (`var(--ink-2)`). Burbuja **roja sólida** `background:var(--red)`, `color:#fff`, `border-radius: 20px 20px 6px 20px`.
- Todas: `max-width:70%`, padding `12px 17px`, 15px/`line-height:1.5`. Debajo, hora 10.5px `var(--ink-3)`.
- **Clave de diseño**: agente = rojo sólido relleno; IA = rojo suave con borde + destello. Nunca confundibles.

### ActionChip (chip de acción rápida) — pie del centro
- `primary` ("Asunto resuelto"): `background:var(--red)`, blanco, radio 999, `box-shadow:var(--shadow)`, 13.5px/700, icono 16px.
- Resto: `border:1px solid var(--line)`, `background:var(--panel)`, `color:var(--ink)`, radio 999, 13.5px/600, icono `var(--ink-2)`. `white-space:nowrap`.
- Hover: `transform: translateY(-1px)`.

### CmdAction (acción con atajo) — panel derecho
Botón columna: `border:1px solid var(--line)`, `background:var(--panel-2)`, radio 11, padding 12/13, `text-align:left`.
- Fila superior: icono 17px `var(--ink-2)` (izq) + badge de atajo en mono 10px (`border:1px solid var(--line)`, radio 5, p.ej. "⌘H") (der).
- Debajo: etiqueta Space Grotesk 12.5px/600.
- Hover: `background:var(--panel)`, `border-color:var(--ink-3)`.

---

## Interacciones y comportamiento
- **Seleccionar conversación**: clic en `Row` → carga su hilo en el centro y sus datos en el panel derecho. Fila activa: `background:var(--sel)` + sombra.
- **Filtros**: clic en pill filtra la lista (Todas / Sin leer / IA activa / Atención). El filtro activo va en `var(--ink)`.
- **Enviar mensaje**: Enter o botón enviar → agrega una burbuja `agent` (roja) y limpia el input.
- **Acciones rápidas / cockpit**: cada botón dispara la mutación correspondiente en tu backend (resolver, tomar control humano = pausar IA, reactivar IA, completar, generar resumen). Los atajos ⌘H/⌘R/⌘D/⌘S son sugeridos; cablearlos si tu app soporta shortcuts.
- **"Tomar control humano"** debe pausar la IA (Estado IA → "En pausa") y permitir respuestas del agente.
- **Generar resumen**: llama a tu IA y rellena el bloque "Resumen del chat".
- **Hover**: filas y botones aclaran/elevan levemente (ver cada componente). Transiciones 0.1–0.15s.
- **Tema claro/oscuro**: alternar el atributo `data-theme` en `:root` (`light`/`dark`) cambia todos los tokens. Persistir preferencia (p.ej. localStorage). Nota: en algunos motores, cambiar variables CSS en caliente no repinta `background` shorthand ya aplicado — si te pasa, fuerza re-render del subárbol o usa `background-color` en vez de `background`.
- **Scrollbars finos**: clase `ibx-scroll` (`scrollbar-width:thin`; en WebKit thumb 8px redondeado semitransparente). Evitar el look de scrollbar nativo grueso.

## Estado (state)
- `conversations[]`: lista (id, name, emoji, initials, time, preview, state, lastFrom, phone, channel, hotel, unread, selected).
- `selectedId`: conversación activa.
- `thread[]` de la activa: mensajes (type/from, text, time).
- `activeFilter`: 'all' | 'unread' | 'ia' | 'att'.
- `theme`: 'light' | 'dark' (persistido).
- `draft`: texto del compositor.
- `iaPaused`: bool por conversación (controla "Estado IA").
- `summary`: string | null.
- Estados de carga/envío y de generación de resumen según tu stack.

## Tokens de diseño

### Colores — tema CLARO
```
--ink:#211c18  --ink-2:#6b6259  --ink-3:#9c9085
--bg:#ece7e0   --panel:#fffdfb  --panel-2:#f5f0ea  --panel-3:#ece6df
--line:#e8dfd5 --line-2:#f1ebe3 --sel:#fffdfb
--red:#e5372a  --red-deep:#c42b20  --red-soft:#fbe9e6
--live:#1f9d63 --live-soft:#e6f3ec
--gold:#b07d2b
--shadow-sm: 0 1px 2px rgba(40,30,20,.06)
--shadow:    0 2px 8px rgba(40,30,20,.07), 0 1px 2px rgba(40,30,20,.05)
--shadow-lg: 0 12px 36px rgba(40,30,20,.14), 0 2px 8px rgba(40,30,20,.06)
```

### Colores — tema OSCURO
```
--ink:#f4efe9  --ink-2:#b4a99d  --ink-3:#7c7064
--bg:#15110e   --panel:#211b17  --panel-2:#2a231e  --panel-3:#1a1511
--line:#352c25 --line-2:#2a221c --sel:#2c2520
--red:#fb5142  --red-deep:#e5372a  --red-soft:#3a201b
--live:#39cf83 --live-soft:#16301f
--gold:#d3a04f
--shadow-sm: 0 1px 2px rgba(0,0,0,.3)
--shadow:    0 3px 12px rgba(0,0,0,.4)
--shadow-lg: 0 16px 44px rgba(0,0,0,.55), 0 4px 12px rgba(0,0,0,.4)
```

### Avatares (fondo, texto) — paleta cálida, asignada por hash del id
```
[#f0d9b5,#8a6a36] [#e8c9c4,#9c4f44] [#d8d3c4,#6f6855]
[#e6d2bd,#8a6240] [#cdd6cb,#4f6b56] [#e2cdd6,#86566a]
```

### Tipografía
- **Space Grotesk** (400–700): nombres, títulos, botones, etiquetas UI. Titulares con `letter-spacing:-0.01em a -0.02em`.
- **Archivo** (400–800): texto base / cuerpo (`font-family` del contenedor).
- **Space Mono** (400/700): horas, teléfonos, contadores, badges de atajo, etiquetas de sección uppercase.
- Escala usada: 10 (mono labels) · 11–11.5 · 12–12.5 · 13–13.5 (UI) · 14–14.5 · 15 (mensajes) · 16–17 (nombres) · 19 (wordmark).
- Etiquetas de sección: uppercase, 700, `letter-spacing:.13em–.14em`.

### Radios
- Inputs / botones-acción: 11. Tarjetas pequeñas: 12. Avatares: `size*0.34`. Pills / circulares: 999.
- Burbujas: 6px en la esquina del emisor, 20px en las demás.

### Espaciado
Múltiplos usados: 2, 4, 6, 7, 8, 9, 10, 12, 13, 14, 16, 18, 20, 22, 24, 26, 40. (Equivalen a una escala de 4/8 con ajustes ópticos.)

### Columnas
`344px | 1fr | 312px` (centro con `min-width:0`). Header 62px.

## Assets
- **Logo "destello"** (chispa de IA, 4 puntas) — SVG path, `viewBox 0 0 100 100`:
  ```
  M50,18 C53,40 60,47 82,50 C60,53 53,60 50,82 C47,60 40,53 18,50 C40,47 47,40 50,18 Z
  ```
  Úsalo en `var(--red)` (header), blanco sobre rojo (icono IA en burbujas), etc. Está en `inbox-data.js` como `SPARK`.
- **Iconos de línea** (stroke 1.7, 24×24): check, user, flag, doc, search, chevron, phone, whatsapp, block, send, image, spark, help, dot, refresh. Definidos en `inbox-shared.jsx` (objeto `Icons`). Sustituibles por los de tu librería (Lucide/Heroicons equivalentes).
- **Emojis** de huésped: provienen del nombre real de WhatsApp; renderizar como están.
- **Fuentes**: Google Fonts — Archivo, Space Grotesk, Space Mono.

## Archivos en este paquete
- `FerrarIA Inbox Rediseño.html` — documento contenedor (canvas con las 4 direcciones; D es la combinada recomendada). Muestra el montaje y el toggle de tema.
- `inbox-dir-d.jsx` — **la dirección D completa** (componente `InboxD` + Row, StatusToken, FilterPill, Bubble, ActionChip, CmdAction). Punto de partida principal.
- `inbox-shared.jsx` — tokens de tema (claro/oscuro), `Spark`, `Avatar`, `Icons`, `ThemeToggle`.
- `inbox-data.js` — datos de ejemplo (conversaciones, hilo, acciones, filtros) + el path del destello.
- `inbox-dir-a.jsx`, `inbox-dir-b.jsx`, `inbox-dir-c.jsx` — las tres exploraciones origen (referencia de dónde salió cada zona de D).

## Notas
- El código `.jsx` usa `React.createElement` (no JSX) por el entorno de previsualización; reescríbelo como JSX o como componentes de tu framework. La estructura, estilos y tokens son lo que importa.
- Reusar componentes existentes de tu inbox donde los haya, aplicándoles estos tokens, en vez de duplicar.
- Mantener literalmente: "Conectado" (sin "Realtime:"), y NO mostrar microtextos redundantes tipo "Estado IA/prioridad" o "Recepción IA + agente humano".
