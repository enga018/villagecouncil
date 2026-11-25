import {
  countUnresolvedTransactions,
  extractJobCard,
  extractVillage,
  normalizeGovernmentStatus,
  normalizeVillage,
  parseGovernmentAmount,
  parseGovernmentDate,
} from "./fto-domain.ts";

Deno.test("counts only undecided blank-name rows and non-terminal named rows as unresolved", () => {
  const rows = [
    { normalizedStatus: "processed", village: "New Serchhip North", referenceNumber: "R1" },
    { normalizedStatus: "deferred", village: "New Serchhip North", referenceNumber: "R2" },
    { normalizedStatus: "blank", village: "", referenceNumber: "R3" },
    { normalizedStatus: "blank", village: "", referenceNumber: "R4" },
    { normalizedStatus: "rejected", village: "", referenceNumber: "R5" },
  ];
  const decided = new Set(["FTO-1|R3"]);
  const unresolved = countUnresolvedTransactions(rows, "FTO-1", decided);
  if (unresolved !== 2) throw new Error("Expected 2 unresolved (R2 named deferred, R4 undecided), got " + unresolved);
  if (countUnresolvedTransactions(rows, "FTO-2", decided) !== 3) {
    throw new Error("Decisions for another FTO must not count.");
  }
});

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
  if (parseGovernmentDate("7/3/2026") !== "2026-07-03") throw new Error("Slash date parsing failed.");
  if (parseGovernmentDate("07-11-2026") !== "2026-07-11") throw new Error("Dash date parsing failed.");
  if (parseGovernmentDate("2026-11-07") !== "2026-11-07") throw new Error("ISO date parsing failed.");
  if (parseGovernmentDate("29/08/2026") !== "2026-08-29") throw new Error("Day-first date parsing failed.");
  if (parseGovernmentDate("not a date") !== "") throw new Error("Invalid date should be rejected.");
});
