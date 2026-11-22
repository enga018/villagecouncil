"use client";

import { useState } from "react";

type StatusFilter = "all" | "active" | "inactive";

export default function JobCardsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const visibleCount = 0;

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-blue-700">Core records</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Job Cards</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Manage job cards and their household applicants for the selected Village Council.</p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">Data model in progress</span>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Total Job Cards", "—"],
          ["Active Job Cards", "—"],
          ["Total Applicants", "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-3 text-2xl font-semibold text-slate-300">{value}</p>
            <p className="mt-1 text-xs text-slate-400">No live records connected</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">Search job cards</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Job Card No. or Head of Household"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>
          <label className="sm:w-48">
            <span className="sr-only">Filter job cards by status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-dashed border-slate-300">
          <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-lg font-semibold text-slate-500">JC</div>
            <h2 className="mt-4 font-semibold text-slate-900">No Job Cards loaded</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              Job Card records will appear here after the official MIS import and reconciliation workflow is connected.
            </p>
            <p className="mt-3 text-xs text-slate-400">Showing {visibleCount} records</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Record structure</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <li>• Job Card Number — unique within a Village Council</li>
            <li>• Head of Household — displayed as the primary record label</li>
            <li>• Applicants — linked to their parent Job Card</li>
            <li>• Record status — active, inactive or deleted</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Import safeguards</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <li>• Reconcile imported rows instead of blindly inserting duplicates</li>
            <li>• Preserve applicant identity when names or source rows change</li>
            <li>• Never reuse an applicant sequence after deletion</li>
            <li>• Keep an import history for audit and recovery</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
