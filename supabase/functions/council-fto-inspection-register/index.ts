import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://villagecouncil.enga.in",
  "https://enga018.github.io",
]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors(origin) });
  }
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return reply({ error: "Authentication required." }, 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = (
    Deno.env.get("SUPABASE_SECRET_KEYS")
      ? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default
      : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  ) || "";

  if (!supabaseUrl || !anonKey || !secretKey) {
    return reply({ error: "Server configuration is incomplete." }, 500, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return reply({ error: "Invalid or expired session." }, 401, origin);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: membership, error: membershipError } = await admin
    .from("council_memberships")
    .select("village_council_id")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError) {
    return reply({ error: "Could not verify the active Council assignment." }, 500, origin);
  }
  if (!membership) return reply({ error: "No active Village Council assignment." }, 403, origin);

  const { data, error } = await admin
    .from("council_fto_inspections")
    .select("fto_number,last_inspected_at,inspection_result,matching_transaction_count,unresolved_transaction_count,last_error,import_activated_at")
    .eq("village_council_id", membership.village_council_id)
    .order("last_inspected_at", { ascending: false });

  if (error) {
    return reply({ error: "Could not load FTO inspection history." }, 500, origin);
  }

  return reply({ inspections: data || [] }, 200, origin);
});
