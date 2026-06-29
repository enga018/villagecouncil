const supabaseUrl = "https://ebfasxnaabcutcrpwpxp.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// expose single client
window.supabaseClient = supabase;

console.log("Supabase client loaded");
