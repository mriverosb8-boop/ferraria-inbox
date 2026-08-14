import assert from "node:assert/strict";
import test from "node:test";

import { normalizeArea, resolvePushAudience, type PushMemberRow } from "./audience.ts";

function miembro(userId: string, role: string | null, area: string | null = null): PushMemberRow {
  return { userId, role, area };
}

const RECEPCION = miembro("u-recep", "recepcionista");
const GERENTE = miembro("u-manager", "manager");
const OP_MANTENIMIENTO = miembro("u-mant", "operativo", "mantenimiento");
const OP_HOUSEKEEPING = miembro("u-hk", "operativo", "housekeeping");
const OP_ROOM_SERVICE = miembro("u-rs", "operativo", "room_service");
const ADMIN = miembro("u-admin", "super_admin");

const HOTEL = [RECEPCION, GERENTE, OP_MANTENIMIENTO, OP_HOUSEKEEPING, OP_ROOM_SERVICE];

function audiencia(type: string, categoria?: string | null, superAdmins: PushMemberRow[] = []) {
  return resolvePushAudience({
    hotelMembers: HOTEL,
    superAdmins,
    type,
    categoria,
  }).sort();
}

test("handoff NUNCA le llega a un operativo", () => {
  const ids = audiencia("handoff");
  assert.deepEqual(ids, ["u-manager", "u-recep"]);
  assert.ok(!ids.includes("u-mant"));
  assert.ok(!ids.includes("u-hk"));
  assert.ok(!ids.includes("u-rs"));
});

test("staff y reservation tampoco le llegan a un operativo", () => {
  for (const tipo of ["staff", "reservation"]) {
    const ids = audiencia(tipo);
    assert.deepEqual(ids, ["u-manager", "u-recep"], `falló para ${tipo}`);
  }
});

test("un tipo desconocido se comporta como los actuales: sin operativos", () => {
  assert.deepEqual(audiencia("lo-que-sea"), ["u-manager", "u-recep"]);
});

test("el ticket de mantenimiento va al operativo de mantenimiento y a recepción", () => {
  const ids = audiencia("ticket", "mantenimiento");
  assert.deepEqual(new Set(ids), new Set(["u-mant", "u-manager", "u-recep"]));
  assert.equal(ids.length, 3);
});

test("el operativo de mantenimiento NO recibe el ticket de housekeeping", () => {
  const ids = audiencia("ticket", "housekeeping");
  assert.ok(ids.includes("u-hk"));
  assert.ok(!ids.includes("u-mant"));
  assert.ok(!ids.includes("u-rs"));
});

test("recepción y gerencia reciben TODOS los tickets, sea cual sea el área", () => {
  for (const area of ["housekeeping", "mantenimiento", "room_service", "otro"]) {
    const ids = audiencia("ticket", area);
    assert.ok(ids.includes("u-recep"), `recepción debería recibir ${area}`);
    assert.ok(ids.includes("u-manager"), `gerencia debería recibir ${area}`);
  }
});

test("un ticket sin categoría cae en 'otro' y no despierta a nadie de un área concreta", () => {
  const ids = audiencia("ticket", null);
  assert.deepEqual(ids, ["u-manager", "u-recep"]);
});

test("un operativo con área 'otro' sí recibe los tickets sin categoría", () => {
  const ids = resolvePushAudience({
    hotelMembers: [RECEPCION, miembro("u-otro", "operativo", "otro")],
    superAdmins: [],
    type: "ticket",
    categoria: null,
  }).sort();
  assert.deepEqual(ids, ["u-otro", "u-recep"]);
});

/**
 * Regresión importante: el filtro es por EXCLUSIÓN del literal `operativo`. Si
 * alguien lo convirtiera en lista blanca, los usuarios viejos con `role` nulo
 * dejarían de recibir avisos sin que nadie se entere.
 */
test("un rol nulo o desconocido sigue recibiendo todo, como antes", () => {
  const ids = resolvePushAudience({
    hotelMembers: [miembro("u-viejo", null), miembro("u-raro", "coordinadora")],
    superAdmins: [],
    type: "handoff",
  }).sort();
  assert.deepEqual(ids, ["u-raro", "u-viejo"]);
});

test("los super_admin reciben todo, incluidos los tickets de cualquier área", () => {
  assert.ok(audiencia("handoff", null, [ADMIN]).includes("u-admin"));
  assert.ok(audiencia("ticket", "housekeeping", [ADMIN]).includes("u-admin"));
});

test("no se duplican user_id si alguien aparece en ambas listas", () => {
  const ids = resolvePushAudience({
    hotelMembers: [RECEPCION, ADMIN],
    superAdmins: [ADMIN],
    type: "handoff",
  });
  assert.equal(ids.filter((id) => id === "u-admin").length, 1);
});

test("las filas sin user_id se ignoran", () => {
  const ids = resolvePushAudience({
    hotelMembers: [miembro("", "recepcionista"), RECEPCION],
    superAdmins: [],
    type: "handoff",
  });
  assert.deepEqual(ids, ["u-recep"]);
});

test("el rol operativo se detecta con espacios sobrantes", () => {
  const ids = resolvePushAudience({
    hotelMembers: [miembro("u-x", " operativo ", "mantenimiento")],
    superAdmins: [],
    type: "handoff",
  });
  assert.deepEqual(ids, []);
});

test("normalizeArea: desconocido, vacío o ausente → otro", () => {
  assert.equal(normalizeArea("mantenimiento"), "mantenimiento");
  assert.equal(normalizeArea("MANTENIMIENTO"), "mantenimiento");
  assert.equal(normalizeArea(" housekeeping "), "housekeeping");
  assert.equal(normalizeArea("lavanderia"), "otro");
  assert.equal(normalizeArea(null), "otro");
  assert.equal(normalizeArea(undefined), "otro");
  assert.equal(normalizeArea(""), "otro");
  assert.equal(normalizeArea(42), "otro");
});
