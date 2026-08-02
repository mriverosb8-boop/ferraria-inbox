import { getSupabaseServerClient } from "@/lib/supabase-server";
import { WUBBY_TABLE } from "@/lib/wubby-schema";

/**
 * `Wubby_Whatsapp.wamid` es la ÚNICA clave que cruza una fila saliente con
 * `message_statuses` (donde `conversation_id` viene NULL en el 100 % de las
 * filas y `hotel_id` en un 16 %). Sin él, un `failed` de Meta —p. ej. 131026
 * "Message Undeliverable"— no se puede atribuir a ninguna burbuja del inbox.
 *
 * Quién puede poblarlo, por camino de envío:
 *
 * - `POST /api/send-whatsapp-media`: llama a Graph directo y hace el insert.
 *   Guarda el id en el propio insert; no necesita nada de este módulo.
 * - `POST /api/send-human-message` y `POST /api/send-whatsapp-template`:
 *   delegan en ferraria-engine, que es quien inserta la fila. El engine ya
 *   escribe `wamid` en el insert Y lo devuelve en el cuerpo de la respuesta;
 *   el update de acá es un backstop barato para las filas que quedaran sin él.
 * - Los mismos dos endpoints cuando el hotel tiene `engine_enabled = false`:
 *   el engine hace proxy a n8n y devuelve el cuerpo de n8n TAL CUAL. n8n
 *   inserta la fila SIN wamid y responde `{ success, meta_response }` con la
 *   respuesta de Meta interpolada dentro de un string (o sea, "[object
 *   Object]"). En ese camino NO hay id que capturar y estas funciones no
 *   escriben nada. Es un límite conocido: se cierra migrando el hotel al
 *   engine, no desde el inbox.
 */

/** Prefijo de todo id de mensaje de la Cloud API (112/112 filas en producción). */
const WAMID_PREFIX = "wamid.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asWamid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.startsWith(WAMID_PREFIX) ? trimmed : null;
}

/**
 * Saca el id de mensaje de Meta de un cuerpo de respuesta arbitrario.
 *
 * Cubre las tres formas que llegan hoy: `{ wamid }` (engine), `{ messages: [{
 * id }] }` (Graph directo, por si algún camino lo propaga sin envolver) y un
 * nivel de anidamiento bajo `result` / `meta_response` / `data`.
 *
 * Exige el prefijo `wamid.` a propósito: el proxy a n8n devuelve strings
 * basura como "[object Object]" en `meta_response`, y guardar eso en la
 * columna sería peor que dejarla NULL —cruzaría con nada y aparentaría que el
 * mensaje sí es rastreable—.
 */
export function extractWamid(payload: unknown, depth = 0): string | null {
  const record = asRecord(payload);
  if (!record) return null;

  const direct = asWamid(record.wamid) ?? asWamid(record.messageId);
  if (direct) return direct;

  const messages = record.messages;
  if (Array.isArray(messages)) {
    for (const entry of messages) {
      const id = asWamid(asRecord(entry)?.id);
      if (id) return id;
    }
  }

  if (depth >= 2) return null;
  for (const key of ["result", "meta_response", "data", "response"]) {
    const nested = extractWamid(record[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

/**
 * Escribe el `wamid` en la fila que el engine acaba de insertar, identificada
 * por el `client_temp_id` que el inbox generó para el optimista.
 *
 * Nunca pisa un wamid ya escrito (`.is("wamid", null)`) y siempre acota por
 * `hotel_id`: `client_temp_id` es un UUID de cliente, no una clave con unicidad
 * garantizada en DB.
 *
 * No lanza. Llegados acá el mensaje YA salió al huésped: fallar el update solo
 * significa que ese mensaje no será rastreable, nunca que el envío se deshaga.
 */
export async function attachWamidByClientTempId(params: {
  wamid: string;
  clientTempId: string;
  hotelId: string;
}): Promise<void> {
  const { wamid, clientTempId, hotelId } = params;
  if (!wamid || !clientTempId || !hotelId) return;

  try {
    const { error } = await getSupabaseServerClient()
      .from(WUBBY_TABLE)
      .update({ wamid })
      .eq("client_temp_id", clientTempId)
      .eq("hotel_id", hotelId)
      .is("wamid", null);

    if (error) {
      console.error("[outbound-wamid] update por client_temp_id falló", error.message);
    }
  } catch (e) {
    console.error("[outbound-wamid] update por client_temp_id excepción", e);
  }
}

/**
 * Escribe el `wamid` en la fila saliente más reciente de un destinatario.
 *
 * Es el camino de las plantillas: el engine no acepta `clientTempId` en
 * `/inbox/send-template`, así que no hay ancla exacta. Se acota todo lo posible
 * —hotel, `sender` sintético, destinatario, `wamid IS NULL`— y se toma la más
 * reciente, que es la que se acaba de insertar milisegundos antes.
 *
 * El peor caso de una carrera (dos plantillas al MISMO número, del MISMO hotel,
 * en el mismo instante) es que dos filas gemelas se lleven el wamid cruzado: el
 * mensaje se marcaría "no entregado" en la burbuja hermana. Se prefiere eso a
 * no marcar nada; y `.is("wamid", null)` evita que la segunda pise a la primera.
 */
export async function attachWamidToLatestOutbound(params: {
  wamid: string;
  hotelId: string;
  sender: string;
  recipientCandidates: string[];
}): Promise<void> {
  const { wamid, hotelId, sender, recipientCandidates } = params;
  const recipients = recipientCandidates.map((r) => r.trim()).filter(Boolean);
  if (!wamid || !hotelId || !sender || recipients.length === 0) return;

  try {
    const supabase = getSupabaseServerClient();
    // PostgREST no admite order+limit en un UPDATE: se localiza el id primero.
    const { data: row, error: selectError } = await supabase
      .from(WUBBY_TABLE)
      .select("id")
      .eq("hotel_id", hotelId)
      .eq("sender", sender)
      .in("recipient", recipients)
      .is("wamid", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      console.error("[outbound-wamid] lookup de fila saliente falló", selectError.message);
      return;
    }
    if (!row) return;

    const { error: updateError } = await supabase
      .from(WUBBY_TABLE)
      .update({ wamid })
      .eq("id", row.id)
      .is("wamid", null);

    if (updateError) {
      console.error("[outbound-wamid] update de fila saliente falló", updateError.message);
    }
  } catch (e) {
    console.error("[outbound-wamid] update de fila saliente excepción", e);
  }
}
