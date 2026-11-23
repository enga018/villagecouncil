export type NormalizedGovernmentStatus = "processed" | "rejected" | "blank" | "other";

export function parseGovernmentAmount(value: string): string {
  const raw = String(value || "").trim().replace(/[₹,\s]/g, "");
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return "";
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? String(amount) : "";
}

export function parseGovernmentDate(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return match[3] + "-" + match[2].padStart(2, "0") + "-" + match[1].padStart(2, "0");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return "";
}

export function normalizeGovernmentStatus(value: string): NormalizedGovernmentStatus {
  const raw = String(value || "").trim();
  if (!raw) return "blank";
  if (/^processed$/i.test(raw)) return "processed";
  if (/^rejected$/i.test(raw)) return "rejected";
  return "other";
}

export function extractJobCard(value: string): string {
  const match = String(value || "").match(/\bMZ-\d{2}-(?:\d{3}-){2,3}\d{3}\/\d+(?:-[A-Z]+)?\b/i);
  return match ? match[0].toUpperCase() : "";
}

export function normalizeVillage(value: string): string {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function extractVillage(value: string, jobCardNumber: string): string {
  const source = String(value || "");
  const card = String(jobCardNumber || "");
  const cardIndex = source.toLowerCase().indexOf(card.toLowerCase());
  const withoutCard = cardIndex >= 0
    ? source.slice(0, cardIndex) + " " + source.slice(cardIndex + card.length)
    : source;
  return withoutCard.replace(/[()\\[\\]{}]/g, " ").replace(/\\s+/g, " ").trim();
}
