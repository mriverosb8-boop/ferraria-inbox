import assert from "node:assert/strict";
import test from "node:test";

import { describeInboundTranslationLabel, describeLanguage } from "./language-names.ts";

test("mapea los códigos ISO más comunes a su nombre en español", () => {
  assert.equal(describeLanguage("en"), "inglés");
  assert.equal(describeLanguage("fr"), "francés");
  assert.equal(describeLanguage("pt"), "portugués");
  assert.equal(describeLanguage("de"), "alemán");
});

test("tolera región y mayúsculas en el código", () => {
  assert.equal(describeLanguage("en-US"), "inglés");
  assert.equal(describeLanguage("pt_BR"), "portugués");
  assert.equal(describeLanguage("ZH-Hans"), "chino");
  assert.equal(describeLanguage("  fr  "), "francés");
});

test("devuelve null cuando no hay dato o el idioma no está mapeado", () => {
  assert.equal(describeLanguage(null), null);
  assert.equal(describeLanguage(undefined), null);
  assert.equal(describeLanguage(""), null);
  assert.equal(describeLanguage("qq"), null);
});

test("la marca de la burbuja nunca muestra el código crudo", () => {
  assert.equal(describeInboundTranslationLabel("en"), "Traducido del inglés");
  // Sin idioma detectado la marca sigue siendo legible: el asesor tiene que
  // saber que está leyendo una traducción aunque no sepamos de qué idioma.
  assert.equal(describeInboundTranslationLabel(null), "Traducido al español");
  assert.equal(describeInboundTranslationLabel("qq"), "Traducido al español");
});
