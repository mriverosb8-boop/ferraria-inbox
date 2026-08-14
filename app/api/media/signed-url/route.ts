import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { requireCapability } from "@/lib/auth/require-capability";
import { assertStoragePathInHotel } from "@/lib/auth/require-hotel";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 3600;
const VALID_BUCKET_RE = /^[A-Za-z0-9_-]+$/;

export async function GET(request: Request) {
  const auth = await requireSessionUser();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path")?.trim();
  const bucketParam = searchParams.get("bucket")?.trim();

  if (!path) {
    return NextResponse.json({ error: "path es obligatorio" }, { status: 400 });
  }

  if (bucketParam && !VALID_BUCKET_RE.test(bucketParam)) {
    return NextResponse.json({ error: "bucket inválido" }, { status: 400 });
  }

  const bucket =
    bucketParam ||
    process.env.WHATSAPP_MEDIA_BUCKET ||
    process.env.NEXT_PUBLIC_WHATSAPP_MEDIA_BUCKET ||
    "hotel-media";

  try {
    const supabase = getSupabaseServerClient();

    // Ownership: el objeto debe pertenecer a una conversación de un hotel permitido.
    const gate = await requireCapability(supabase, auth.user, "verConversacionesHuespedes");
    if (gate.response) return gate.response;
    const allowedHotelIds = gate.allowedHotelIds;
    const ownership = await assertStoragePathInHotel(supabase, path, allowedHotelIds);
    if (ownership.response) return ownership.response;

    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json({ signedUrl: data.signedUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
