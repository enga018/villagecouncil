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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  let payload: { name?: unknown; slug?: unknown; adminEmail?: unknown; onboardingRequestId?: unknown };
  try { payload = await req.json(); }
  catch { return response({ error: "Invalid JSON request." }, 400, origin); }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const slug = typeof payload.slug === "string" ? payload.slug.trim().toLowerCase() : "";
  const requestId = typeof payload.onboardingRequestId === "string" ? payload.onboardingRequestId : "";
  if (name.length < 3 || name.length > 120) return response({ error: "Village Council name must be between 3 and 120 characters." }, 400, origin);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return response({ error: "Use a URL-safe slug with lowercase letters, numbers and hyphens." }, 400, origin);
  if (requestId && !UUID_PATTERN.test(requestId)) return response({ error: "Invalid onboarding request." }, 400, origin);

  let requestRecord: {
    id: string;
    state_id: string;
    district_id: string;
    block_id: string;
    location_panchayat_id: string;
    state: string;
    district: string;
    block: string;
    village: string;
    administrator_email: string;
    status: string;
    created_council_id: string | null;
  } | null = null;
  let requestLocked = false;
  let administratorEmail = typeof payload.adminEmail === "string" ? payload.adminEmail.trim().toLowerCase() : "";

  if (requestId) {
    const { data, error } = await adminClient
      .from("council_onboarding_requests")
      .select("id,state_id,district_id,block_id,location_panchayat_id,state,district,block,village,administrator_email,status,created_council_id")
      .eq("id", requestId)
      .maybeSingle();
    if (error) return response({ error: "Unable to load the onboarding request." }, 500, origin);
    if (!data) return response({ error: "The onboarding request was not found." }, 404, origin);
    if (data.status !== "pending" || data.created_council_id) {
      return response({ error: "This request is no longer pending approval." }, 409, origin);
    }
    requestRecord = data;
    administratorEmail = data.administrator_email;

    const [stateResult, districtResult, blockResult, panchayatResult] = await Promise.all([
      adminClient.from("location_states").select("id,official_name").eq("id", data.state_id).eq("is_active", true).maybeSingle(),
      adminClient.from("location_districts").select("id,state_id,official_name").eq("id", data.district_id).eq("is_active", true).maybeSingle(),
      adminClient.from("location_blocks").select("id,district_id,official_name").eq("id", data.block_id).eq("is_active", true).maybeSingle(),
      adminClient.from("location_panchayats").select("id,block_id,official_name,navigation_url").eq("id", data.location_panchayat_id).eq("is_active", true).maybeSingle(),
    ]);
    if (stateResult.error || districtResult.error || blockResult.error || panchayatResult.error) {
      return response({ error: "Unable to verify the requested Government location." }, 500, origin);
    }
    const state = stateResult.data;
    const district = districtResult.data;
    const block = blockResult.data;
    const panchayat = panchayatResult.data;
    if (!state || !district || !block || !panchayat
      || district.state_id !== state.id
      || block.district_id !== district.id
      || panchayat.block_id !== block.id
      || state.official_name !== data.state
      || district.official_name !== data.district
      || block.official_name !== data.block
      || panchayat.official_name !== data.village) {
      return response({ error: "The requested Government location is no longer valid. Review the request before approval." }, 409, origin);
    }

    const { data: assignedCouncil, error: assignedError } = await adminClient
      .from("council_tenants").select("id")
      .eq("location_panchayat_id", data.location_panchayat_id).eq("is_active", true).maybeSingle();
    if (assignedError) return response({ error: "Unable to verify whether this location is already assigned." }, 500, origin);
    if (assignedCouncil) return response({ error: "This Panchayat / Village is already assigned to an active Village Council." }, 409, origin);

    const { data: lockedRequest, error: lockError } = await adminClient
      .from("council_onboarding_requests")
      .update({ status: "under_review", reviewed_by: userData.user.id, reviewed_at: new Date().toISOString() })
      .eq("id", requestId).eq("status", "pending").is("created_council_id", null)
      .select("id").maybeSingle();
    if (lockError) return response({ error: "Unable to reserve this request for approval." }, 500, origin);
    if (!lockedRequest) return response({ error: "Another administrator is already processing this request." }, 409, origin);
    requestLocked = true;

    // Retain the official panchayat URL for later Register navigation.
    requestRecord = { ...data, status: "under_review" };
    (requestRecord as typeof requestRecord & { panchayat_url?: string }).panchayat_url = panchayat.navigation_url ?? undefined;
  }

  const { data: existingCouncil, error: slugLookupError } = await adminClient
    .from("council_tenants").select("id").eq("slug", slug).maybeSingle();
  if (slugLookupError) {
    if (requestLocked) await adminClient.from("council_onboarding_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", requestId);
    return response({ error: "Unable to verify the requested URL slug." }, 500, origin);
  }
  if (existingCouncil) {
    if (requestLocked) await adminClient.from("council_onboarding_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", requestId);
    return response({ error: "That Village Council slug is already in use." }, 409, origin);
  }

  if (administratorEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(administratorEmail)) {
    if (requestLocked) await adminClient.from("council_onboarding_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", requestId);
    return response({ error: "Enter a valid administrator email address." }, 400, origin);
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(administratorEmail);
  if (inviteError || !inviteData.user) {
    if (requestLocked) await adminClient.from("council_onboarding_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", requestId);
    return response({ error: inviteError?.message ?? "Unable to invite the VC administrator." }, 400, origin);
  }

  const councilPayload: Record<string, unknown> = { name, slug, is_active: true };
  if (requestRecord) {
    councilPayload.state = requestRecord.state;
    councilPayload.district = requestRecord.district;
    councilPayload.block = requestRecord.block;
    councilPayload.village = requestRecord.village;
    councilPayload.location_panchayat_id = requestRecord.location_panchayat_id;
    councilPayload.panchayat_url = (requestRecord as typeof requestRecord & { panchayat_url?: string }).panchayat_url ?? null;
    councilPayload.onboarding_completed_at = new Date().toISOString();
  }

  const { data: council, error: councilError } = await adminClient
    .from("council_tenants").insert(councilPayload)
    .select("id,name,slug,is_active,created_at").single();
  if (councilError || !council) {
    await adminClient.auth.admin.deleteUser(inviteData.user.id);
    if (requestLocked) await adminClient.from("council_onboarding_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", requestId);
    return response({ error: councilError?.message ?? "Unable to create the Village Council." }, 500, origin);
  }

  const { error: membershipError } = await adminClient.from("council_memberships")
    .insert({ user_id: inviteData.user.id, village_council_id: council.id, is_active: true });
  if (membershipError) {
    await adminClient.from("council_tenants").delete().eq("id", council.id);
    await adminClient.auth.admin.deleteUser(inviteData.user.id);
    if (requestLocked) await adminClient.from("council_onboarding_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", requestId);
    return response({ error: membershipError.message }, 500, origin);
  }

  if (requestRecord) {
    const { data: approvedRequest, error: approvalError } = await adminClient.from("council_onboarding_requests")
      .update({
        status: "approved",
        reviewed_by: userData.user.id,
        reviewed_at: new Date().toISOString(),
        created_council_id: council.id,
      })
      .eq("id", requestId).eq("status", "under_review")
      .select("id").maybeSingle();
    if (approvalError || !approvedRequest) {
      await adminClient.from("council_memberships").delete().eq("village_council_id", council.id);
      await adminClient.from("council_tenants").delete().eq("id", council.id);
      await adminClient.auth.admin.deleteUser(inviteData.user.id);
      await adminClient.from("council_onboarding_requests")
        .update({ status: "pending", reviewed_by: null, reviewed_at: null, created_council_id: null })
        .eq("id", requestId).eq("status", "under_review");
      return response({ error: "The council was not finalized because the request could not be marked approved." }, 500, origin);
    }
  }

  return response({
    success: true,
    villageCouncil: council,
    invitedEmail: administratorEmail,
    onboardingComplete: Boolean(requestRecord),
    message: requestRecord
      ? "Village Council approved, Government location saved, and administrator invitation sent."
      : "Village Council created and administrator invitation sent.",
  }, 201, origin);
});
