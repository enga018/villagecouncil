import Link from "next/link";
import type { ReactNode } from "react";

type Accent = "blue" | "indigo";
type Tone = "neutral" | "blue" | "indigo" | "success" | "warning" | "danger";

const accentStyles: Record<Accent, string> = {
  blue: "border-blue-200 hover:border-blue-300",
  indigo: "border-indigo-200 hover:border-indigo-300",
};

const iconStyles: Record<Accent, string> = {
  blue: "bg-blue-50 text-blue-700",
  indigo: "bg-indigo-50 text-indigo-700",
};

const actionStyles: Record<Accent, string> = {
  blue: "text-blue-700 focus-visible:outline-blue-600",
  indigo: "text-indigo-700 focus-visible:outline-indigo-600",
};

const toneStyles: Record<Tone, string> = {
  neutral: "text-slate-900",
  blue: "text-blue-700",
  indigo: "text-indigo-700",
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
};

export function StatusBadge({ status }: { status: "Available" | "Active" | "Processed" | "Deferred" | "Pending" | "Rejected" | "Inactive" }) {
  const styles: Record<typeof status, string> = {
    Available: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Active: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Processed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Deferred: "border-amber-200 bg-amber-50 text-amber-700",
    Pending: "border-amber-200 bg-amber-50 text-amber-700",
    Rejected: "border-rose-200 bg-rose-50 text-rose-700",
    Inactive: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${styles[status]}`}>{status}</span>;
}

export function MiniKpi({ label, value, context, tone = "neutral" }: {
  label: string;
  value: number | null;
  context: string;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[.08em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-bold tracking-tight tabular-nums ${toneStyles[tone]}`}>
        {value === null ? "—" : value.toLocaleString("en-IN")}
      </p>
      <p className="mt-1 truncate text-[10px] leading-4 text-slate-500">{context}</p>
    </div>
  );
}

export function ModuleCard({ title, description, href, mark, eyebrow, action, accent, children }: {
  title: string;
  description: string;
  href: string;
  mark: string;
  eyebrow: string;
  action: string;
  accent: Accent;
  children?: ReactNode;
}) {
  return (
    <Link href={href} className={`group flex min-h-[250px] flex-col rounded-2xl border bg-white p-5 shadow-[var(--vc-shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 ${actionStyles[accent]} sm:p-6 ${accentStyles[accent]}`}>
      <div className="flex items-start justify-between gap-4">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-xs font-bold tracking-wide ${iconStyles[accent]}`}>{mark}</span>
        <StatusBadge status="Available" />
      </div>
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">{eyebrow}</p>
      <h3 className="mt-1 text-base font-bold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-slate-600">{description}</p>
      {children && <div className="mt-4">{children}</div>}
      <span className={`mt-auto inline-flex items-center gap-2 pt-5 text-xs font-bold ${actionStyles[accent]}`}>
        {action}<span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
      </span>
    </Link>
  );
}
