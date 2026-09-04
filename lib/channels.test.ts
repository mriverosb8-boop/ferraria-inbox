import assert from "node:assert/strict";
import test from "node:test";

import {
  channelBrandColor,
  channelLabel,
  isOtaChannel,
  normalizeChannel,
  pickEngineIdentity,
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

test("en WhatsApp se le manda al engine la identidad normalizada", () => {
  assert.equal(pickEngineIdentity("whatsapp", "+573001112233", "573001112233"), "573001112233");
});

test("en OTA se le manda al engine el UUID del hilo SIN normalizar", () => {
  // Es lo que decide por qué canal sale el mensaje: el engine busca la
  // conversación con `guest_phone = ?` exacto. Con los dígitos mutilados no
  // encuentra nada y responde por WhatsApp a un número que no existe.
  const uuid = "e575ba18-3f4c-4a21-9b8e-7712d5aa0c3f";
  const mutilado = "5751834421987712503";
  assert.equal(pickEngineIdentity("booking", uuid, mutilado), uuid);
  assert.equal(pickEngineIdentity("expedia", uuid, mutilado), uuid);
  assert.equal(pickEngineIdentity("airbnb", uuid, mutilado), uuid);
});

test("sin identidad cruda se cae a la normalizada en vez de mandar vacío", () => {
  // El engine rechaza de plano un `guestPhone` vacío, así que un respaldo malo
  // es mejor que ninguno.
  assert.equal(pickEngineIdentity("booking", "", "573001112233"), "573001112233");
  assert.equal(pickEngineIdentity("booking", "   ", "573001112233"), "573001112233");
});

test("WhatsApp no tiene color de chip: el canal mayoritario no lleva distintivo", () => {
  // `null` es la señal de "no pintes chip", no un color que falte por poner. Si
  // todas las filas de la bandeja llevaran chip, el chip dejaría de distinguir.
  assert.equal(channelBrandColor("whatsapp"), null);
});

test("cada canal de OTA trae su color de marca", () => {
  assert.equal(channelBrandColor("booking"), "#003580");
  assert.equal(channelBrandColor("expedia"), "#00355F");
  assert.equal(channelBrandColor("airbnb"), "#FF5A5F");
});

test("los colores de marca son hex de 6 dígitos", () => {
  // El chip los mete directo en un `style`, así que un valor mal escrito no
  // rompe nada: simplemente el chip sale sin fondo y con texto blanco sobre
  // blanco, invisible.
  for (const canal of ["booking", "expedia", "airbnb"] as const) {
    assert.match(String(channelBrandColor(canal)), /^#[0-9A-Fa-f]{6}$/);
  }
});
