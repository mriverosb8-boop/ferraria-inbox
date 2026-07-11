CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  hotel_id UUID REFERENCES hotels(id) ON DELETE SET NULL,

  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('suggestion', 'bug', 'other')),
  message TEXT NOT NULL
    CHECK (char_length(message) BETWEEN 1 AND 2000),
  rating SMALLINT
    CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),

  page_url TEXT,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
ON feedback(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_hotel
ON feedback(hotel_id);

-- El endpoint escribe con service role (bypassa RLS); activamos RLS para
-- bloquear cualquier acceso directo con la clave anon/authenticated.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
