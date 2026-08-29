import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_LANGUAGE_OPTIONS,
  DEFAULT_COMPOSER_LANGUAGE,
  describeInboundTranslationLabel,
  describeLanguage,
  languageOptionLabel,
  languageShortLabel,
  normalizeLanguageCode,
} from "./language-names.ts";

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

test("normaliza el código a la raíz ISO 639-1 y rechaza lo que no lo es", () => {
  assert.equal(normalizeLanguageCode("EN"), "en");
  assert.equal(normalizeLanguageCode("en-US"), "en");
  assert.equal(normalizeLanguageCode(" pt_BR "), "pt");
  assert.equal(normalizeLanguageCode("ingles"), null);
  assert.equal(normalizeLanguageCode("e"), null);
  assert.equal(normalizeLanguageCode(""), null);
  assert.equal(normalizeLanguageCode(null), null);
});

test("el selector ofrece español primero y nombres legibles", () => {
  assert.equal(COMPOSER_LANGUAGE_OPTIONS[0], DEFAULT_COMPOSER_LANGUAGE);
  assert.deepEqual([...COMPOSER_LANGUAGE_OPTIONS], ["es", "en", "pt", "fr", "de", "it"]);
  assert.equal(languageOptionLabel("es"), "Español");
  assert.equal(languageOptionLabel("en"), "Inglés");
  // Un idioma fuera del mapa no deja la opción en blanco.
  assert.equal(languageOptionLabel("qq"), "QQ");
});

test("el chip del composer muestra el código en mayúsculas", () => {
  assert.equal(languageShortLabel("en"), "EN");
  assert.equal(languageShortLabel("pt-BR"), "PT");
});
