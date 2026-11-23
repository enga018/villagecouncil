import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://villagecouncil.enga.in",
  "https://enga018.github.io",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !secretKey) return reply({ error: "Server configuration is incomplete." }, 500, origin);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return reply({ error: "Invalid JSON request." }, 400, origin);
  }

  const councilName = typeof payload.councilName === "string" ? payload.councilName.trim() : "";
  const stateId = typeof payload.stateId === "string" ? payload.stateId : "";
  const districtId = typeof payload.districtId === "string" ? payload.districtId : "";
  const blockId = typeof payload.blockId === "string" ? payload.blockId : "";
  const panchayatId = typeof payload.panchayatId === "string" ? payload.panchayatId : "";
  const administratorEmail = typeof payload.administratorEmail === "string" ? payload.administratorEmail.trim().toLowerCase() : "";
  const requesterName = typeof payload.requesterName === "string" ? payload.requesterName.trim() : "";
  const requesterDesignation = typeof payload.requesterDesignation === "string" ? payload.requesterDesignation.trim() : "";
  const requesterPhone = typeof payload.requesterPhone === "string" ? payload.requesterPhone.trim() : "";
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

  if (councilName.length < 3 || councilName.length > 120) {
    return reply({ error: "Village Council name must be between 3 and 120 characters." }, 400, origin);
  }
  if (![stateId, districtId, blockId, panchayatId].every((id) => UUID_PATTERN.test(id))) {
    return reply({ error: "Select a complete official Government location." }, 400, origin);
  }
  if (administratorEmail.length > 254 || !EMAIL_PATTERN.test(administratorEmail)) {
    return reply({ error: "Enter a valid administrator email address." }, 400, origin);
  }
  if (requesterName.length < 2 || requesterName.length > 120) {
    return reply({ error: "Enter the requester's full name." }, 400, origin);
  }
  if (requesterDesignation.length < 2 || requesterDesignation.length > 80) {
    return reply({ error: "Enter the requester's designation." }, 400, origin);
  }
  if (requesterPhone.length < 6 || requesterPhone.length > 30) {
    return reply({ error: "Enter a valid mobile number." }, 400, origin);
  }
  if (reason.length > 1000) return reply({ error: "The reason must be 1,000 characters or fewer." }, 400, origin);

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [stateResult, districtResult, blockResult, panchayatResult] = await Promise.all([
    adminClient.from("location_states").select("id,official_name").eq("id", stateId).eq("is_active", true).maybeSingle(),
    adminClient.from("location_districts").select("id,state_id,official_name").eq("id", districtId).eq("is_active", true).maybeSingle(),
    adminClient.from("location_blocks").select("id,district_id,official_name").eq("id", blockId).eq("is_active", true).maybeSingle(),
    adminClient.from("location_panchayats").select("id,block_id,official_name").eq("id", panchayatId).eq("is_active", true).maybeSingle(),
  ]);

  if (stateResult.error || districtResult.error || blockResult.error || panchayatResult.error) {
    return reply({ error: "Unable to validate the selected Government location." }, 500, origin);
  }

  const state = stateResult.data;
  const district = districtResult.data;
  const block = blockResult.data;
  const panchayat = panchayatResult.data;
  if (!state || !district || !block || !panchayat
    || district.state_id !== state.id
    || block.district_id !== district.id
    || panchayat.block_id !== block.id) {
    return reply({ error: "The selected location hierarchy is invalid. Please select the location again." }, 400, origin);
  }

  const { data: assignedCouncil, error: assignedError } = await adminClient
    .from("council_tenants")
    .select("id")
    .eq("location_panchayat_id", panchayat.id)
    .eq("is_active", true)
    .maybeSingle();
  if (assignedError) return reply({ error: "Unable to verify whether this location is already registered." }, 500, origin);
  if (assignedCouncil) {
    return reply({ error: "This Panchayat / Village is already registered with a Village Council on the platform." }, 409, origin);
  }

  const { data: existingRequest, error: existingError } = await adminClient
    .from("council_onboarding_requests")
    .select("id,status")
    .eq("location_panchayat_id", panchayat.id)
    .in("status", ["pending", "under_review", "more_information_required"])
    .maybeSingle();
  if (existingError) return reply({ error: "Unable to check for an existing onboarding request." }, 500, origin);
  if (existingRequest) {
    return reply({ error: "An onboarding request for this Panchayat / Village is already being reviewed." }, 409, origin);
  }

  // Basic abuse control without a CAPTCHA: cap repeated submissions per
  // administrator email and contact phone in a rolling one-hour window.
  const rateLimitSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [emailRate, phoneRate] = await Promise.all([
    adminClient.from("council_onboarding_requests").select("id", { count: "exact", head: true })
      .eq("administrator_email", administratorEmail).gte("created_at", rateLimitSince),
    adminClient.from("council_onboarding_requests").select("id", { count: "exact", head: true })
      .eq("requester_phone", requesterPhone).gte("created_at", rateLimitSince),
  ]);
  if (emailRate.error || phoneRate.error) {
    return reply({ error: "Unable to validate the submission rate. Please try again." }, 500, origin);
  }
  if ((emailRate.count ?? 0) >= 3 || (phoneRate.count ?? 0) >= 3) {
    return reply({ error: "Too many requests have been submitted using these contact details. Please try again later." }, 429, origin);
  }

  const { data: request, error: insertError } = await adminClient
    .from("council_onboarding_requests")
    .insert({
      council_name: councilName,
      state_id: state.id,
      district_id: district.id,
      block_id: block.id,
      location_panchayat_id: panchayat.id,
      state: state.official_name,
      district: district.official_name,
      block: block.official_name,
      village: panchayat.official_name,
      administrator_email: administratorEmail,
      requester_name: requesterName,
      requester_designation: requesterDesignation,
      requester_phone: requesterPhone,
      reason: reason || null,
      status: "pending",
    })
    .select("id,status,created_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return reply({ error: "An onboarding request for this Panchayat / Village is already being reviewed." }, 409, origin);
    }
    return reply({ error: "Unable to submit the onboarding request. Please try again." }, 500, origin);
  }

  return reply({
    success: true,
    requestId: request.id,
    status: request.status,
    createdAt: request.created_at,
    message: "Your Village Council onboarding request has been submitted for review.",
  }, 201, origin);
});
