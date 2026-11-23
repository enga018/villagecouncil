import {
  extractJobCard,
  extractVillage,
  normalizeGovernmentStatus,
  normalizeVillage,
  parseGovernmentAmount,
  parseGovernmentDate,
} from "./fto-domain.ts";

Deno.test("extracts supported Mizoram Job Card formats", () => {
  if (extractJobCard("New Serchhip North MZ-07-001-005-001/835") !== "MZ-07-001-005-001/835") {
    throw new Error("Did not extract the standard Job Card number.");
  }
  if (extractJobCard("MZ-07-001-005-001/835-OLD") !== "MZ-07-001-005-001/835-OLD") {
    throw new Error("Did not extract the suffixed Job Card number.");
  }
  if (extractJobCard("No valid job card") !== "") throw new Error("Accepted an invalid Job Card number.");
});

Deno.test("extracts Panchayat text without using Job Card ownership", () => {
  const card = "MZ-07-001-005-001/835";
  const panchayat = extractVillage("New Serchhip North " + card, card);
  if (panchayat !== "New Serchhip North") throw new Error("Unexpected Panchayat text: " + panchayat);
  if (normalizeVillage(panchayat) !== normalizeVillage("NEW SERCHHIP NORTH")) {
    throw new Error("Panchayat normalization did not match case-insensitively.");
  }
});

Deno.test("normalizes Unicode and punctuation in Panchayat names", () => {
  const actual = normalizeVillage("  New-Serchhip North (VC) ");
  if (actual !== "new serchhip north vc") throw new Error("Unexpected normalized Panchayat: " + actual);
});

Deno.test("maps only the recognized Government statuses", () => {
  const cases: Array<[string, string]> = [
    ["Processed", "processed"],
    [" processed ", "processed"],
    ["REJECTED", "rejected"],
    ["", "blank"],
    ["Pending", "other"],
  ];
  for (const [input, expected] of cases) {
    if (normalizeGovernmentStatus(input) !== expected) {
      throw new Error("Unexpected status mapping for " + JSON.stringify(input));
    }
  }
});

Deno.test("parses Government amounts and rejects malformed values", () => {
  if (parseGovernmentAmount("₹1,234.50") !== "1234.5") throw new Error("Amount normalization failed.");
  if (parseGovernmentAmount("0") !== "0") throw new Error("Zero amount should be valid.");
  if (parseGovernmentAmount("-10") !== "") throw new Error("Negative amount should be rejected.");
  if (parseGovernmentAmount("N/A") !== "") throw new Error("Non-numeric amount should be rejected.");
});

Deno.test("normalizes supported Government date formats", () => {
  if (parseGovernmentDate("7/3/2026") !== "2026-03-07") throw new Error("Slash date parsing failed.");
  if (parseGovernmentDate("07-11-2026") !== "2026-11-07") throw new Error("Dash date parsing failed.");
  if (parseGovernmentDate("2026-11-07") !== "2026-11-07") throw new Error("ISO date parsing failed.");
  if (parseGovernmentDate("not a date") !== "") throw new Error("Invalid date should be rejected.");
});
