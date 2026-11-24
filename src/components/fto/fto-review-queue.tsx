"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

type ReviewTransaction = {
  jobCardNumber?: string;
  referenceNumber?: string;
  village?: string;
  creditAmount?: string;
  governmentStatus?: string;
  transactionDate?: string;
};

type ReviewRow = {
  row_data?: { scope?: string; fto_number?: string; transactions?: ReviewTransaction[] };
};

type ReviewItem = {
  key: string;
  ftoNumber: string;
  referenceNumber: string;
  jobCardNumber: string;
  amount: string;
  status: string;
  date: string;
};

type Decision = "in_village" | "not_in_village";

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && value !== "" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount) : "—";
}

function itemKey(ftoNumber: string, referenceNumber: string) {
  return ftoNumber + "|" + referenceNumber;
}

export default function FtoReviewQueue({ batchId }: { batchId: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [registerJobCards, setRegisterJobCards] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const rows: ReviewRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error: rowsError } = await supabase
          .from("council_fto_import_rows")
          .select("row_data")
          .eq("import_batch_id", batchId)
          .order("row_number", { ascending: true })
          .range(offset, offset + 999);
        if (rowsError) {
          if (active) { setError(rowsError.message); setLoading(false); }
          return;
        }
        rows.push(...((data || []) as ReviewRow[]));
        if (!data || data.length < 1000) break;
      }

      const reviewItems: ReviewItem[] = [];
      for (const row of rows) {
        const scope = row.row_data?.scope;
        if (scope !== "IN_SCOPE" && scope !== "NEEDS_REVIEW") continue;
        const ftoNumber = String(row.row_data?.fto_number || "");
        for (const tx of row.row_data?.transactions || []) {
          if (String(tx.village || "").trim()) continue;
          const referenceNumber = String(tx.referenceNumber || "");
          reviewItems.push({
            key: itemKey(ftoNumber, referenceNumber),
            ftoNumber,
            referenceNumber,
            jobCardNumber: String(tx.jobCardNumber || ""),
            amount: String(tx.creditAmount || ""),
            status: String(tx.governmentStatus || "blank"),
            date: String(tx.transactionDate || ""),
          });
        }
      }

      const { data: decisionRows, error: decisionError } = await supabase
        .from("council_fto_review_decisions")
        .select("fto_number,reference_number,decision");
      if (decisionError) {
        if (active) { setError(decisionError.message); setLoading(false); }
        return;
      }
      const decisionMap: Record<string, Decision> = {};
      for (const item of decisionRows || []) {
        decisionMap[itemKey(String(item.fto_number), String(item.reference_number))] = item.decision as Decision;
      }

      const jobCards = Array.from(new Set(reviewItems.map(item => item.jobCardNumber.trim().toUpperCase()).filter(Boolean)));
      const registered = new Set<string>();
      for (let offset = 0; offset < jobCards.length; offset += 200) {
        const { data: cards, error: cardError } = await supabase
          .from("council_job_cards")
          .select("job_card_number")
          .in("job_card_number", jobCards.slice(offset, offset + 200));
        if (cardError) break;
        for (const card of cards || []) registered.add(String(card.job_card_number || "").trim().toUpperCase());
      }

      if (!active) return;
      setItems(reviewItems);
      setDecisions(decisionMap);
      setRegisterJobCards(registered);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [batchId]);

  const pendingCount = useMemo(() => items.filter(item => !decisions[item.key]).length, [items, decisions]);

  async function decide(item: ReviewItem, decision: Decision) {
    setSaving(item.key);
    setError("");
    const { error: rpcError } = await createClient().rpc("set_council_fto_review_decision", {
      p_fto_number: item.ftoNumber,
      p_reference_number: item.referenceNumber,
      p_decision: decision,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setDecisions(current => ({ ...current, [item.key]: decision }));
    }
    setSaving("");
  }

  if (!loading && items.length === 0 && !error) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--vc-shadow-card)]">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="max-w-3xl">
            <h2 className="text-base font-bold tracking-tight text-slate-950">Manual review: Panchayat not shown</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Government did not show the Panchayat name for these transactions. Mark each one In village or Not in village. Job Card numbers do not decide ownership; the register hint is a reminder only. Undecided rows are not imported.
            </p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">{loading ? "Loading…" : `${pendingCount.toLocaleString("en-IN")} of ${items.length.toLocaleString("en-IN")} awaiting decision`}</span>
        </div>
      </div>

      {error && <p role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</p>}

      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500">Loading review rows…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[960px] divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">FTO</th>
                <th className="px-4 py-3">Job Card</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Register</th>
                <th className="px-4 py-3">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(item => {
                const decision = decisions[item.key];
                const busy = saving === item.key;
                const inRegister = registerJobCards.has(item.jobCardNumber.trim().toUpperCase());
                return (
                  <tr key={item.key}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{item.ftoNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{item.jobCardNumber || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.referenceNumber || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.date || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{money(item.amount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.status}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {inRegister ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">In your register</span> : <span className="text-[10px] text-slate-400">Not in register</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => decide(item, "in_village")}
                          className={"min-h-9 rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 " + (decision === "in_village" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                          In village
                        </button>
                        <button type="button" disabled={busy} onClick={() => decide(item, "not_in_village")}
                          className={"min-h-9 rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 " + (decision === "not_in_village" ? "border-slate-600 bg-slate-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                          Not in village
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
