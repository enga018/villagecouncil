import JobCardRegisterImport from "@/components/register/JobCardRegisterImport";
import FtoRegisterImport from "@/components/register/FtoRegisterImport";

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

      <FtoRegisterImport />
    </div>
  );
}
