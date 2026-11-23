import { shouldRefetchFto, type FtoInspectionSnapshot } from "./fto-refetch.ts";

const fingerprint = "listing-hash-1";
const completed: FtoInspectionSnapshot = {
  listingFingerprint: fingerprint,
  inspectionResult: "matched",
  matchingTransactionCount: 4,
  unresolvedTransactionCount: 0,
  importActivatedAt: "2026-11-23T05:00:00.000Z",
};

Deno.test("fetches a newly discovered FTO", () => {
  if (shouldRefetchFto({ forceRefresh: false, fingerprint, inspection: null }) !== "fetch") {
    throw new Error("A new FTO must be fetched.");
  }
});

Deno.test("force refresh overrides every skip condition", () => {
  const noMatch = { ...completed, inspectionResult: "no_match", matchingTransactionCount: 0 };
  if (shouldRefetchFto({ forceRefresh: true, fingerprint, inspection: noMatch }) !== "fetch") {
    throw new Error("Force refresh must include a previously no-match FTO.");
  }
  if (shouldRefetchFto({ forceRefresh: true, fingerprint, inspection: completed }) !== "fetch") {
    throw new Error("Force refresh must include completed FTOs.");
  }
});

Deno.test("refetches when the listing fingerprint changes", () => {
  if (shouldRefetchFto({ forceRefresh: false, fingerprint: "listing-hash-2", inspection: completed }) !== "fetch") {
    throw new Error("A changed listing fingerprint must trigger a refetch.");
  }
});

Deno.test("skips successfully inspected FTOs with no Council transactions", () => {
  const noMatch = { ...completed, inspectionResult: "no_match", matchingTransactionCount: 0, unresolvedTransactionCount: 0 };
  if (shouldRefetchFto({ forceRefresh: false, fingerprint, inspection: noMatch }) !== "skip_no_match") {
    throw new Error("A stable no-match FTO should be skipped.");
  }
});

Deno.test("refetches a staged but not activated FTO", () => {
  const unactivated = { ...completed, importActivatedAt: null };
  if (shouldRefetchFto({ forceRefresh: false, fingerprint, inspection: unactivated }) !== "fetch") {
    throw new Error("An unactivated inspection must remain eligible for recovery.");
  }
});

Deno.test("refetches FTOs with unresolved or zero matching transactions", () => {
  const unresolved = { ...completed, unresolvedTransactionCount: 1 };
  const zeroMatching = { ...completed, matchingTransactionCount: 0 };
  if (shouldRefetchFto({ forceRefresh: false, fingerprint, inspection: unresolved }) !== "fetch") {
    throw new Error("Unresolved transactions must trigger a refetch.");
  }
  if (shouldRefetchFto({ forceRefresh: false, fingerprint, inspection: zeroMatching }) !== "fetch") {
    throw new Error("A matched inspection with zero matches must trigger a refetch.");
  }
});

Deno.test("skips only activated FTOs with all matching transactions terminal", () => {
  if (shouldRefetchFto({ forceRefresh: false, fingerprint, inspection: completed }) !== "skip_completed") {
    throw new Error("A completed activated FTO should be skipped.");
  }
});
