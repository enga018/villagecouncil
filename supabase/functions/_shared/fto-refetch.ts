export type FtoInspectionSnapshot = {
  listingFingerprint: string;
  inspectionResult: string;
  matchingTransactionCount: number;
  unresolvedTransactionCount: number;
  importActivatedAt: string | null;
};

export type FtoRefetchDecision = "fetch" | "skip_no_match" | "skip_completed";

export function shouldRefetchFto(input: {
  forceRefresh: boolean;
  fingerprint: string;
  inspection: FtoInspectionSnapshot | null;
}): FtoRefetchDecision {
  const { forceRefresh, fingerprint, inspection } = input;
  if (forceRefresh || !inspection || inspection.listingFingerprint !== fingerprint) return "fetch";
  if (inspection.inspectionResult === "no_match") return "skip_no_match";
  if (!inspection.importActivatedAt ||
      inspection.unresolvedTransactionCount > 0 ||
      inspection.matchingTransactionCount === 0) return "fetch";
  return "skip_completed";
}
