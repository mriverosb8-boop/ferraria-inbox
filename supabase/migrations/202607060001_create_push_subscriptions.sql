-- Batch 1 — Suscripciones Web Push (una fila por endpoint del navegador).
-- Escritura exclusiva vía service_role desde /api/push/*; RLS deniega todo
-- acceso directo con las claves anon/authenticated.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id UUID REFERENCES hotels(id) ON DELETE SET NULL,

  -- Datos crudos de la PushSubscription del navegador.
  endpoint TEXT NOT NULL UNIQUE,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,

  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Routing de notificaciones: por hotel activo y/o por usuario.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_hotel
  ON push_subscriptions(hotel_id);

-- (endpoint ya queda indexado por la restricción UNIQUE, usada en el upsert.)

-- RLS estricto: se habilita SIN políticas => deny-all para anon y
-- authenticated. Solo service_role (que bypassa RLS) puede operar la tabla.
-- NO se usa el patrón TEMP_open_during_migration de las tablas legacy.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
