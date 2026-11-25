"use client";

import { useRouter } from "next/navigation";

type Action = {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
};

export default function OnboardingActions({
  back,
  next,
  note,
}: {
  back?: Action;
  next: Action;
  note?: string;
}) {
  const router = useRouter();

  const run = (action: Action) => {
    if (action.onClick) action.onClick();
    else if (action.href) router.push(action.href);
  };

  return (
    <footer className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        {back ? (
          <button
            type="button"
            disabled={back.disabled}
            onClick={() => run(back)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="mr-1.5">←</span>
            {back.label}
          </button>
        ) : null}
        {note ? <p className="text-xs text-slate-400">{note}</p> : null}
      </div>
      <button
        type={next.type ?? "button"}
        form={next.form}
        disabled={next.disabled}
        onClick={() => {
          if (next.type !== "submit") run(next);
        }}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {next.label}
        <span aria-hidden="true">→</span>
      </button>
    </footer>
  );
}
