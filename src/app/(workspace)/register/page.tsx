import JobCardRegisterImport from "@/components/register/JobCardRegisterImport";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Data centre</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Register</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Import, validate and maintain the official Government registers used by this Village Council.
        </p>
      </section>

      <JobCardRegisterImport />

      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-500">Next workflow</p>
        <h2 className="mt-2 text-lg font-bold text-slate-900">FTO Register</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          FTO discovery, detail fetching, Job Card matching, exception review and import activation will be brought into this Register after the Job Card workflow is verified.
        </p>
        <span className="mt-4 inline-flex rounded-full bg-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-600">Not yet migrated</span>
      </section>
    </div>
  );
}
