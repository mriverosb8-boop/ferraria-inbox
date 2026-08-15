@AGENTS.md

# ferraria-inbox

## Qué es este repo

Bandeja de entrada de FerrarIA para el personal del hotel: ver conversaciones en vivo, responder como humano, enviar plantillas. Usa Supabase Realtime.
Stack: Next.js App Router + TypeScript + Supabase.
FerrarIA es una plataforma B2B SaaS de recepcionistas de IA 24/7 por WhatsApp para hoteles.
**Hay hoteles en producción atendiendo huéspedes reales ahora mismo: un error acá es visible para un huésped en segundos.**

## Reglas de git (no negociables)

- `git add` siempre explícito, archivo por archivo, por nombre. **Nunca** `git add .`, `git add -A` ni `git add --all`.
- **Nunca** commitear `.claude/` ni ningún archivo `.env`.
- Commits de una sola línea, formato conventional (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`). Sin cuerpo. Sin `Co-Authored-By`.
- **Nunca** hacer `git push`. Eso lo autoriza y ejecuta Matías.

## Verificación antes de cada commit

- `tsc --noEmit` y ESLint deben pasar limpios antes de todo commit. Sin excepciones.

## Reglas de dominio

- El sistema se llama **"agente"**, nunca "bot". La marca se escribe **"FerrarIA"** (con esa capitalización exacta).
- Toda la UI va en español colombiano, con tuteo.
- Todo lo importante se muestra como texto visible en pantalla: nada de esconder información en tooltips.
- **El LLM extrae y formatea; el código determinista calcula y decide.** Nunca dejar que un modelo haga aritmética con precios, fechas, noches o cupos.
- Aislamiento multi-tenant: todo query filtra por `hotel_id` en el query mismo. No apoyarse en RLS para el aislamiento entre hoteles.
- Nada de datos de huéspedes ni de hoteles (nombres, teléfonos, payloads, contenido de mensajes) en `console.log` de producción.
