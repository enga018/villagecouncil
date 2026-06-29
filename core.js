
// =========================
// CORE ENGINE
// =========================

// PROPERTY
async function addProperty(houseNumber, location, ward = null, type = "residential") {
  const { data, error } = await supabaseClient
    .from("properties")
    .insert([{ house_number: houseNumber, location, ward, type, status: "active" }])
    .select();

  return error ? { success: false, error } : { success: true, data };
}

// FAMILY
async function addFamily(headName, propertyId, phone = null, membersCount = 1) {
  const { data, error } = await supabaseClient
    .from("families")
    .insert([{ head_name: headName, property_id: propertyId, phone, members_count: membersCount }])
    .select();

  return error ? { success: false, error } : { success: true, data };
}

// TAX
async function generateTax(propertyId, familyId, year, amount) {
  const { data, error } = await supabaseClient
    .from("tax_records")
    .insert([{
      property_id: propertyId,
      family_id: familyId,
      tax_year: year,
      amount_due: amount,
      amount_paid: 0,
      status: "pending"
    }])
    .select();

  return error ? { success: false, error } : { success: true, data };
}

// DASHBOARD STATS
async function getDashboardStats() {
  const [p, f, t] = await Promise.all([
    supabaseClient.from("properties").select("*", { count: "exact", head: true }),
    supabaseClient.from("families").select("*", { count: "exact", head: true }),
    supabaseClient.from("tax_records").select("amount_due, amount_paid")
  ]);

  let pending = 0;

  if (t.data) {
    t.data.forEach(x => {
      pending += (x.amount_due || 0) - (x.amount_paid || 0);
    });
  }

  return {
    properties: p.count || 0,
    families: f.count || 0,
    pendingTax: pending
  };
}

// UPDATE UI
async function refreshDashboard() {
  const s = await getDashboardStats();

  document.getElementById("totalProperties").innerText = s.properties;
  document.getElementById("totalFamilies").innerText = s.families;
  document.getElementById("pendingTax").innerText = "₹" + s.pendingTax;
}

// auto load
window.addEventListener("load", refreshDashboard);
