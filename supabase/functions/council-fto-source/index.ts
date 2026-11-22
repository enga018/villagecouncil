import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publishableKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !secretKey) return reply({ error: "Server configuration is incomplete." }, 500, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401, origin);
  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);

  const { data: membership, error: membershipError } = await adminClient
    .from("council_memberships").select("village_council_id")
    .eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (membershipError) return reply({ error: "Unable to verify Village Council access." }, 500, origin);
  if (!membership) return reply({ error: "An active Village Council assignment is required." }, 403, origin);

  const { data: council, error: councilError } = await adminClient
    .from("council_tenants")
    .select("id,state,district,block,village,panchayat_url,onboarding_completed_at")
    .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
  if (councilError) return reply({ error: "Unable to load the Village Council." }, 500, origin);
  if (!council) return reply({ error: "The assigned Village Council is unavailable." }, 403, origin);
  if (!council.state || !council.district || !council.block || !council.village) {
    return reply({ error: "Complete the Government location step before FTO discovery." }, 400, origin);
  }

  const { data: blockUrl, error: blockUrlError } = await adminClient
    .rpc("get_block_navigation_url", { p_state: council.state, p_district: council.district, p_block: council.block });
  if (blockUrlError || !blockUrl) {
    return reply({ error: "The shared Block navigation URL is unavailable. Re-save the Government location in Step 1." }, 409, origin);
  }

  let body: { action?: string; batchId?: string };
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON request." }, 400, origin); }
  if (!["prepare-preview", "activate"].includes(body.action || "")) return reply({ error: "Unsupported action." }, 400, origin);

  if (body.action === "activate") {
    if (!body.batchId) return reply({ error: "A batch ID is required for activation." }, 400, origin);
    // Activation writes staged FTO records into council_ftos atomically.
    // This is exercised only after prepare-preview successfully stages a batch.
    return reply({ success: false, error: "FTO activation is not yet wired to a staged import batch." }, 400, origin);
  }

  // --- prepare-preview -----------------------------------------------------
  // The FTO tracking report navigation starts from the saved block_url
  // (chosen in Step 1): block_url → FTO Status → First Signatory →
  // individual FTO records.
  //
  // This navigation has NOT yet been reverse-engineered against the live
  // VBGRAMG portal. The established register importer (council-register-source)
  // documents the session/cookie handling and ASP.NET postback pattern that
  // the FTO importer must follow, but the FTO menu item on the block page,
  // the FTO Status filter values, the First Signatory selection, and the FTO
  // report table headings must be confirmed first.
  return reply({
    success: false,
    error: "FTO discovery is not yet wired to the VBGRAMG portal. The FTO tracking navigation (block_url → FTO Status → First Signatory) still needs to be reverse-engineered.",
    noDataChanged: true,
  }, 501, origin);
});
