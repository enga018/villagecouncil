import {
  extractJobCard,
  extractVillage,
  normalizeGovernmentStatus,
  parseGovernmentAmount,
  parseGovernmentDate,
} from "./fto-domain.ts";

export type GovernmentFtoTransaction = {
  ftoNumber: string;
  jobCardNumber: string;
  referenceNumber: string;
  status: "processed" | "rejected" | "deferred" | "other";
  normalizedStatus: "processed" | "rejected" | "blank" | "other";
  governmentStatus: string;
  amount: string;
  jobCardNo: string;
  referenceNo: string;
  amountToBeCredited: string;
  creditAmount: string;
  transactionDate: string;
  processedDate: string;
  rejectionReason: string;
  village: string;
  villageName: string;
  personName: string;
  primaryAccountHolder: string;
  sourceRow: Array<{ name: string; value: string }>;
};

function decodeHtml(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, " ").replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function textOf(value: string) {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();
}

function rowsOf(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => textOf(c[1])))
    .filter(row => row.some(Boolean));
}

/**
 * Parses the Government FTO transaction-detail table.
 * Synthetic fixtures may exercise this function, but only captured Government HTML
 * can establish compatibility with the live portal.
 */
export function parseGovernmentFtoDetailHtml(html: string, ftoNumber: string): GovernmentFtoTransaction[] {
  const tableRows = rowsOf(html), pageText = textOf(html);
  const header = tableRows.find(row => row.some(cell => /job\s*card\s*no/i.test(cell)) && row.some(cell => /reference\s*no/i.test(cell)));
  if (!header || !/FTO\s+Transaction\s+Details/i.test(pageText)) {
    throw new Error("FTO " + ftoNumber + " did not return a valid FTO Transaction Details page.");
  }
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const names = header.map(normalize);
  const find = (...exactNames: string[]) => names.findIndex(name => exactNames.includes(name));
  const job = find("job card no panchayat name", "job card no", "job card number");
  const reference = find("reference no", "reference number");
  const transactionDate = find("transaction date");
  const applicant = find("applicant name", "name of applicant", "name of person");
  const primaryHolder = find("name of primary account holder");
  const amountToBeCredited = find("amount to be credited in rs", "amount to be credited");
  const creditAmount = find("credit amount in rs", "credit amount");
  const status = find("status");
  const processedDate = find("processed date");
  const rejectionReason = find("rejection reason");
  if (job < 0 || reference < 0 || amountToBeCredited < 0 || creditAmount < 0 || status < 0) {
    throw new Error("FTO " + ftoNumber + " has an unexpected transaction table structure.");
  }

  const headerIndex = tableRows.indexOf(header), transactions: GovernmentFtoTransaction[] = [];
  for (const row of tableRows.slice(headerIndex + 1)) {
    const jobCell = row[job] || "", jobCardNumber = extractJobCard(jobCell);
    const referenceNumber = (row[reference] || "").trim();
    const rawStatus = (row[status] || "").trim(), normalizedStatus = normalizeGovernmentStatus(rawStatus);
    const personName = (row[applicant >= 0 ? applicant : primaryHolder] || "").trim();
    const primaryAccountHolder = primaryHolder >= 0 ? (row[primaryHolder] || "").trim() : "";
    const village = extractVillage(jobCell, jobCardNumber);
    const sourceRow = header.map((name, index) => ({ name, value: row[index] || "" }));
    transactions.push({
      ftoNumber,
      jobCardNumber,
      referenceNumber,
      status: normalizedStatus === "blank" ? "deferred" : normalizedStatus,
      normalizedStatus,
      governmentStatus: rawStatus || "blank",
      amount: row[creditAmount] || "",
      jobCardNo: jobCardNumber,
      referenceNo: referenceNumber,
      amountToBeCredited: parseGovernmentAmount(row[amountToBeCredited] || ""),
      creditAmount: parseGovernmentAmount(row[creditAmount] || ""),
      transactionDate: transactionDate >= 0 ? parseGovernmentDate(row[transactionDate] || "") : "",
      processedDate: processedDate >= 0 ? parseGovernmentDate(row[processedDate] || "") : "",
      rejectionReason: rejectionReason >= 0 ? (row[rejectionReason] || "").trim() : "",
      village,
      villageName: village,
      personName,
      primaryAccountHolder,
      sourceRow,
    });
  }
  if (!transactions.length) throw new Error("FTO " + ftoNumber + " contains no transaction rows.");
  return transactions;
}
