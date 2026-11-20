import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://villagecouncil.enga.in",
  "https://enga018.github.io",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origin not allowed." }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publishableKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) return response({ error: "Server configuration is incomplete." }, 500, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return response({ error: "Authentication required." }, 401, origin);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "Invalid or expired session." }, 401, origin);

  const { data: superadmin, error: roleError } = await adminClient
    .from("platform_superadmins").select("id").eq("user_id", userData.user.id).maybeSingle();
  if (roleError) return response({ error: "Unable to verify platform administrator role." }, 500, origin);
  if (!superadmin) return response({ error: "Platform administrator access required." }, 403, origin);

  let payload: { name?: unknown; slug?: unknown; adminEmail?: unknown };
  try { payload = await req.json(); }
  catch { return response({ error: "Invalid JSON request." }, 400, origin); }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const slug = typeof payload.slug === "string" ? payload.slug.trim().toLowerCase() : "";
  const adminEmail = typeof payload.adminEmail === "string" ? payload.adminEmail.trim().toLowerCase() : "";
  if (name.length < 3 || name.length > 120) return response({ error: "Village Council name must be between 3 and 120 characters." }, 400, origin);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return response({ error: "Use a URL-safe slug with lowercase letters, numbers and hyphens." }, 400, origin);
  if (adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return response({ error: "Enter a valid administrator email address." }, 400, origin);

  const { data: existingCouncil } = await adminClient.from("village_councils").select("id").eq("slug", slug).maybeSingle();
  if (existingCouncil) return response({ error: "That Village Council slug is already in use." }, 409, origin);

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(adminEmail);
  if (inviteError || !inviteData.user) return response({ error: inviteError?.message ?? "Unable to invite the VC administrator." }, 400, origin);

  const { data: council, error: councilError } = await adminClient
    .from("village_councils").insert({ name, slug, is_active: true })
    .select("id,name,slug,is_active,created_at").single();
  if (councilError || !council) {
    await adminClient.auth.admin.deleteUser(inviteData.user.id);
    return response({ error: councilError?.message ?? "Unable to create the Village Council." }, 500, origin);
  }

  const { error: membershipError } = await adminClient.from("memberships")
    .insert({ user_id: inviteData.user.id, village_council_id: council.id, is_active: true });
  if (membershipError) {
    await adminClient.from("village_councils").delete().eq("id", council.id);
    await adminClient.auth.admin.deleteUser(inviteData.user.id);
    return response({ error: membershipError.message }, 500, origin);
  }

  return response({ success: true, villageCouncil: council, invitedEmail: adminEmail, message: "Village Council created and administrator invitation sent." }, 201, origin);
});
