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

    // Verify the user is authenticated and is a super_admin
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the user is a super_admin
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return new Response(
        JSON.stringify({ error: "Only super admins can update tenant admin credentials" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const body = await req.json();
    const { admin_user_id, new_email, new_password } = body;

    if (!admin_user_id) {
      return new Response(
        JSON.stringify({ error: "Missing admin_user_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Verify the target user exists and is an admin
    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", admin_user_id)
      .single();

    if (targetError || !targetProfile || targetProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Target user is not an admin" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update email in auth if provided
    if (new_email) {
      const { error: emailError } = await adminClient.auth.admin.updateUserById(
        admin_user_id,
        { email: new_email }
      );

      if (emailError) {
        return new Response(JSON.stringify({ error: emailError.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update email in profiles table
      await adminClient
        .from("profiles")
        .update({ email: new_email })
        .eq("id", admin_user_id);
    }

    // Update password in auth if provided
    if (new_password) {
      const { error: passwordError } = await adminClient.auth.admin.updateUserById(
        admin_user_id,
        { password: new_password }
      );

      if (passwordError) {
        return new Response(JSON.stringify({ error: passwordError.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Tenant admin credentials updated successfully",
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
