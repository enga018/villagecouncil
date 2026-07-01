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
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const body = await req.json();
    const { new_email, new_password } = body;

    // Update email in auth if provided
    if (new_email) {
      const { error: emailError } = await adminClient.auth.admin.updateUserById(
        user.id,
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
        .eq("id", user.id);
    }

    // Update password in auth if provided
    if (new_password) {
      const { error: passwordError } = await adminClient.auth.admin.updateUserById(
        user.id,
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
      JSON.stringify({ success: true, message: "Profile updated successfully" }),
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
