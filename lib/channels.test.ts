import assert from "node:assert/strict";
import test from "node:test";

import {
  channelLabel,
  isOtaChannel,
  normalizeChannel,
  otaReplyUnavailableCopy,
} from "./channels.ts";

test("los cuatro canales del engine se reconocen tal cual", () => {
  assert.equal(normalizeChannel("whatsapp"), "whatsapp");
  assert.equal(normalizeChannel("booking"), "booking");
  assert.equal(normalizeChannel("expedia"), "expedia");
  // El cuarto se olvida fácil: el engine lo escribe aunque casi nunca se
  // mencione junto a los otros.
  assert.equal(normalizeChannel("airbnb"), "airbnb");
});

test("un canal desconocido cae a WhatsApp en vez de romper la fila", () => {
  // Si el engine agrega un canal nuevo antes que el inbox, la conversación
  // tiene que seguir apareciendo en la bandeja. Degradar a WhatsApp es lo
  // conservador: como mucho se le aplica la ventana de 24 h de más.
  assert.equal(normalizeChannel("tripadvisor"), "whatsapp");
  assert.equal(normalizeChannel(null), "whatsapp");
  assert.equal(normalizeChannel(undefined), "whatsapp");
  assert.equal(normalizeChannel(""), "whatsapp");
  assert.equal(normalizeChannel(42), "whatsapp");
});

test("el valor de la columna se lee sin importar mayúsculas ni espacios", () => {
  assert.equal(normalizeChannel(" Booking "), "booking");
  assert.equal(normalizeChannel("EXPEDIA"), "expedia");
});

test("solo WhatsApp queda fuera de la frontera de OTA", () => {
  assert.equal(isOtaChannel("whatsapp"), false);
  assert.equal(isOtaChannel("booking"), true);
  assert.equal(isOtaChannel("expedia"), true);
  assert.equal(isOtaChannel("airbnb"), true);
});

test("las etiquetas son la marca, no el valor crudo de la columna", () => {
  assert.equal(channelLabel("whatsapp"), "WhatsApp");
  assert.equal(channelLabel("booking"), "Booking.com");
  assert.equal(channelLabel("expedia"), "Expedia");
  assert.equal(channelLabel("airbnb"), "Airbnb");
});

test("el aviso nombra el canal y no menciona el stack", () => {
  const copy = otaReplyUnavailableCopy("booking");
  assert.equal(copy, "Todavía no puedes responder por Booking.com desde aquí.");

  // Recepción no sabe qué es Channex ni el engine, y saberlo no la ayuda a
  // atender al huésped.
  for (const canal of ["whatsapp", "booking", "expedia", "airbnb"] as const) {
    const texto = otaReplyUnavailableCopy(canal).toLowerCase();
    for (const prohibido of ["channex", "engine", "supabase", "ota", "api", "uuid"]) {
      assert.equal(texto.includes(prohibido), false, `"${prohibido}" no puede salir en la UI`);
    }
  }
});
