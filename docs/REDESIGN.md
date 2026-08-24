# Rediseño de la bandeja — Spec visual, Fase 1

Este documento es el spec del rediseño visual de la bandeja de FerrarIA, Fase 1: principios estéticos, tokens de color y tipografía, layout de tres columnas y el detalle completo de la sección **Huéspedes** (lista, chat, composer y panel derecho).

---

## 1. Principios

- **Estética cálida editorial.** Nada de gris corporativo. La base es crema, las superficies de contenido son cards blancas redondeadas y el sidebar es un bloque sólido rojo terracota que ancla toda la pantalla.
- **Jerarquía por superficie, no por borde grueso.** Lo que importa se levanta con una card blanca sobre el crema; los bordes son suaves y las sombras muy sutiles.
- **La IA siempre se llama "agente" o "FerrarIA".** Nunca "bot", en ningún texto visible, label, placeholder ni aria-label. La marca se escribe exactamente **FerrarIA**.
- **Dos familias tipográficas con roles claros:**
  - **Metadata y números en monospace** — horas, teléfonos, contadores, labels de sección, IDs.
  - **Contenido en sans grotesk** — nombres, mensajes, títulos, copy de interfaz.
  - Se cargan con `next/font`: **Inter** para el sans y **JetBrains Mono** para el monospace.

---

## 2. Tokens

### 2.1 Superficies y bordes

| Token | Valor | Uso |
| --- | --- | --- |
| `--bg-app` | `#F2EEE6` | Fondo crema de toda la app |
| `--bg-card` | `#FFFFFF` | Cards, items seleccionados, superficies de contenido |
| `--border-soft` | `#E8E2D8` | Borde suave por defecto de cards y separadores |

### 2.2 Rojo terracota

| Token | Valor | Uso |
| --- | --- | --- |
| `--sidebar` | `#C7402D` | Fondo del sidebar |
| `--accent` | `#C7402D` | Botones primarios, badges de atención, burbuja humana, borde del item seleccionado |

- **Hover sobre el rojo:** overlay blanco al 10% encima del terracota. No se oscurece ni se cambia el tono.

### 2.3 Burbujas de conversación

| Token | Valor | Uso |
| --- | --- | --- |
| `--bubble-ai` | `#FBF3DC` (borde `#EFE4C8`) | Mensajes del agente |
| `--bubble-guest` | `#FFFFFF` | Mensajes del huésped |

### 2.4 Estado y texto

| Token | Valor | Uso |
| --- | --- | --- |
| `--success-bg` | `#DFF2E4` | Fondo de estados en verde |
| `--success-text` | `#2E7D4F` | Texto sobre `--success-bg`, punto "En línea", toggle de IA activa |
| `--text-primary` | `#1F1D1A` | Texto principal, chip activo "Todas" |
| `--text-secondary` | `#8A857C` | Previews, metadata, labels secundarios |

### 2.5 Radios y sombras

- **Cards:** 16px
- **Chips:** 10px
- **Burbujas:** 14px
- **Sombras:** muy sutiles. Sirven para despegar la card del crema, no para dibujar profundidad.

---

## 3. Layout

Tres columnas más un panel contextual, de izquierda a derecha:

1. **Sidebar rojo fijo, ~90px.**
   - Arriba: logo **✦** dentro de un card blanco.
   - Nav vertical, cada entrada con **icono + label + badge**: **Huéspedes**, **Staff**, **Reservas**, **Tickets**.
   - Abajo: campana de notificaciones con badge, indicador **● En línea** en verde, y avatar del usuario con sus iniciales.
   - Es fijo: no hace scroll con el contenido.
2. **Lista de conversaciones, ~360px.**
3. **Área principal** — el chat, ocupa el espacio restante.
4. **Panel derecho contextual, ~340px** — colapsable.

---

## 4. Huéspedes

### 4.1 Header de la lista

- Título **"Huéspedes"** con el contador al lado: **392/469** (leídas sobre total).
- Botón de **refresh**.
- Botón primario rojo **"Nueva"**.

### 4.2 Filtros y búsqueda

- Campo de **búsqueda** debajo del header.
- **Chips de filtro:**
  - **Todas** — cuando está activo se pinta en negro (`--text-primary`).
  - **Sin leer**
  - **Atención** — en rojo.
  - **Hechas**
- **Dropdown de hotel** para cambiar de propiedad.

### 4.3 Item de la lista

Cada conversación muestra:

- **Avatar** del huésped.
- **Nombre** en bold.
- **Hora** en monospace.
- **Preview** del último mensaje, con un prefijo que indica el estado:
  - **● rojo** → necesita atención.
  - **✦** → respondió la IA.
  - **✓** → conversación hecha.
- **Seleccionado:** el item se convierte en una card blanca con borde rojo.

### 4.4 Chat

- **Pill de fecha** centrada para separar los días.
- **Burbuja del agente:** fondo `--bubble-ai` con borde `#EFE4C8`, alineada a la **derecha**, con el label **"✦ FerrarIA"**.
- **Burbuja del huésped:** blanca, alineada a la **izquierda**.
- **Burbuja de respuesta humana:** roja con texto blanco, con el label **"👤 Tú · agente"**.
- **Eventos de sistema:** centrados, en gris, con **✓**.

### 4.5 Composer

- Campo redondeado con el placeholder **"Escribe para responder como humano…"**.
- **Botón de enviar rojo** y botón de **adjuntar**.
- Justo encima del composer, el aviso: **"✦ La IA está respondiendo · si escribes, tomas el control"**.

### 4.6 Panel derecho

De arriba hacia abajo:

1. **Card de contacto** — nombre, teléfono en monospace y una **X** para cerrar el panel.
2. **Card "IA activa"** — toggle en verde más el texto **"FerrarIA responde automáticamente · última respuesta hace N min"**.
3. **Sección HUÉSPED** — labels en monospace uppercase: **Canal**, **Hotel**, **Última actividad**.
4. **Sección RESUMEN** — estado vacío con el texto **"Sin resumen aún."** y el botón **"✦ Generar resumen"**.
5. **Colapsable "Datos técnicos"** — cerrado por defecto.

---

## 5. Staff

Conversaciones internas del hotel. Acá la IA no participa: todo lo que se envía lo escribe una persona.

### 5.1 Header de la lista

- Título **"Staff"**.
- Subtítulo: **"Conversaciones con el personal del hotel. La IA no interviene acá."**

### 5.2 Item de la lista

- Formato **"Nombre · Cargo"** — el nombre de la persona y su cargo separados por un punto medio.

### 5.3 Header del chat

De izquierda a derecha:

- **Nombre** de la persona.
- **Badge STAFF** al lado del nombre.
- Botón **"✓ Completado"**.
- Menú **"…"** con las acciones secundarias.

### 5.4 Burbujas

- **Humano (nosotros):** burbuja **roja** con texto blanco.
- **Staff (la otra persona):** burbuja **blanca**.
- **PDFs:** no se pintan como burbuja de texto sino como un **chip**: **"📄 nombre.pdf · Documento PDF"**.

### 5.5 Panel derecho

De arriba hacia abajo:

1. **Aviso** de que la IA no interviene en estas conversaciones.
2. **Sección CONTACTO** — datos de la persona.
3. **Sección ARCHIVOS RECIENTES** — los PDFs de la conversación, cada uno con un botón **"Abrir"**.
4. **Link rojo "Bloquear contacto"** al final.

---

## 6. Reservas

Reservas capturadas por WhatsApp Flows que todavía hay que pasar al PMS.

### 6.1 Header de la lista

- Título **"Reservas"**.
- Subtítulo: **"Capturadas por WhatsApp Flows, listas para subir al PMS."**

### 6.2 Filtros y búsqueda

- **Tabs:** **Pendientes** (en rojo cuando está activo) / **Procesadas**.
- **Búsqueda por teléfono.**
- **Dropdown de hotel** para cambiar de propiedad.

### 6.3 Card de la lista

Cada reserva muestra:

- **Nombre** del titular.
- **COT-XXXX** en monospace.
- **"hace N h"** — cuánto pasó desde que se capturó.
- **Entrada / salida.**
- **Habitación.**
- **Total.**
- **Seleccionada:** la card se marca con **borde rojo**.

### 6.4 Detalle de la reserva

**Cuatro stat cards** arriba, con el label en monospace uppercase:

- **ENTRADA**
- **SALIDA**
- **HABITACIÓN**
- **TOTAL**

Debajo, dos cards:

1. **DATOS DEL TITULAR.**
2. **COTIZACIÓN** — desglose línea por línea:
   - Noches
   - Adultos · niños
   - Desayuno · mascotas
   - Subtotal
   - IVA 19%
   - Total

   Todos los **valores van en monospace y alineados a la derecha**, para que las cifras se lean en columna.

### 6.5 Acciones

- **"✓ Completar"** — botón rojo, la acción principal.
- **"Copiar datos"** — para pegarlos en el PMS.
- **"Volver a pendientes"**.
- **"Rechazar"** — en rojo.

### 6.6 Panel derecho

- **Chat de WhatsApp de solo lectura** — la conversación donde se capturó la reserva, sin composer.
- Abajo, botón de **ancho completo "Abrir en Huéspedes"**.

---

## 7. Tickets

### 7.1 Header

- Título **"Tickets de servicio"**.
- Subtítulo: **"Solicitudes de los huéspedes detectadas por la IA — mantenimiento, room service, housekeeping."**

### 7.2 Filtros

**Chips:** **Abiertas**, **En curso**, **Resueltas**, **Todas**.

### 7.3 Grid

Los tickets van en un **grid de 2 columnas**. Cada card muestra:

- **Icono del tipo** de solicitud (mantenimiento, room service, housekeeping).
- **"Nombre · hace N días"**.
- **Chip de habitación:** **"Hab. NNN"**, o **"Sin habitación"** cuando no se conoce.
- **Badge de estado:**
  - **Abierta** → rojo.
  - **En curso** → ámbar.
  - **Resuelta** → verde.
- **Descripción** de la solicitud.

### 7.4 Acciones por estado

- **Ticket abierto:** **"Tomar"**, **"✓ Resolver"** (rojo) y **"Cancelar"**.
- **Ticket resuelto:** **"Reabrir"**.
- **Siempre, en cualquier estado:** **"Ver conversación"**.

---

## 8. Menú de usuario

Popover que se abre desde el **avatar** del sidebar, de arriba hacia abajo:

1. **Email** del usuario.
2. **"✦ Novedades"** — con badge cuando hay algo sin leer.
3. **"Enviar feedback"**.
4. **"Ayuda"**.
5. **"Tema"** — con las dos opciones: **Claro** / **Oscuro**.
6. **"Cerrar sesión"** — en rojo.
