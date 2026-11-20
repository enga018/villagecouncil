import Link from "next/link";
import { notFound } from "next/navigation";

const moduleDetails: Record<string, { title: string; description: string }> = {
  "job-cards": { title: "Job Cards", description: "Manage job cards, households and applicants for this Village Council." },
  register: { title: "Register", description: "Maintain and review the official registration register." },
  "fto-monitoring": { title: "FTO Monitoring", description: "Monitor FTO status using the Government First Signatory workflow." },
  contributions: { title: "Contributions", description: "Review contribution charges, payment history and outstanding balances." },
  "co-calculation": { title: "CO Calculation", description: "Prepare and review CO calculations." },
  payments: { title: "Payments", description: "Record and review payments." },
  reports: { title: "Reports", description: "Review and export Village Council reports." },
  settings: { title: "Settings", description: "Manage the configuration of this Village Council workspace." },
};

export function generateStaticParams() {
  return Object.keys(moduleDetails).map((module) => ({ module }));
}

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const details = moduleDetails[module];
  if (!details) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm font-medium text-blue-700 hover:text-blue-800">← Dashboard</Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{details.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{details.description}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">VC</div>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">Module foundation</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">This route is ready for implementation. No live records are displayed or modified yet. The module workflow and data model will be added in focused steps.</p>
      </div>
    </div>
  );
}
