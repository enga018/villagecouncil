import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    // CORS headers
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
    }

    // Get the JWT token from the Authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the user is authenticated
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: caller },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the caller is an admin or super_admin
    const { data: callerProfile, error: callerError } = await adminClient
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", caller.id)
      .single();

    if (callerError || !callerProfile) {
      return new Response(JSON.stringify({ error: "Caller profile not found" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only admin and super_admin can impersonate workers
    if (!["admin", "super_admin"].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: "Only admins can impersonate workers" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const body = await req.json();
    const { worker_id } = body;

    if (!worker_id) {
      return new Response(
        JSON.stringify({ error: "Missing worker_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Verify the target is a worker in the same tenant (for admins) or any tenant (for super_admin)
    const { data: workerProfile, error: workerError } = await adminClient
      .from("profiles")
      .select("id, role, tenant_id")
      .eq("id", worker_id)
      .single();

    if (workerError || !workerProfile) {
      return new Response(
        JSON.stringify({ error: "Worker not found" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Verify worker is in a valid role
    if (!["worker", "supervisor"].includes(workerProfile.role)) {
      return new Response(
        JSON.stringify({ error: "Target is not a worker or supervisor" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // For regular admins, check they're in the same tenant
    if (
      callerProfile.role === "admin" &&
      callerProfile.tenant_id !== workerProfile.tenant_id
    ) {
      return new Response(
        JSON.stringify({ error: "Cannot impersonate workers from other tenants" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get worker's email
    const workerUser = await adminClient.auth.admin.getUserById(worker_id);
    if (workerUser.error || !workerUser.data?.user?.email) {
      return new Response(
        JSON.stringify({ error: "Failed to retrieve worker email" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Generate a magic link for the worker
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: workerUser.data.user.email,
      options: {
        redirectTo: `https://villagecouncil.enga.in/index.html`,
      },
    });

    if (linkError || !linkData) {
      return new Response(JSON.stringify({ error: linkError?.message || "Failed to generate link" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        link: linkData.properties?.action_link || "",
        message: "Magic link generated for worker impersonation",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
