export const LIST_PAGE_SIZE = 20;

export function pageCount(total: number, pageSize = LIST_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function pageSlice<T>(items: T[], page: number, pageSize = LIST_PAGE_SIZE) {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

export function pageRange(total: number, page: number, pageSize = LIST_PAGE_SIZE) {
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return { from, to: Math.min(page * pageSize, total) };
}

export function ListPagination({ page, total, onPage, label, pageSize = LIST_PAGE_SIZE, className = "" }: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
  pageSize?: number;
  className?: string;
}) {
  const count = pageCount(total, pageSize);
  const { from, to } = pageRange(total, page, pageSize);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-3 ${className}`}>
      <div className="min-w-0 text-[10px] leading-4 text-slate-400">
        <span className="block">Showing {from}–{to} of {total}</span>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <button type="button" onClick={() => onPage(Math.min(count, page + 1))} disabled={page >= count} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
