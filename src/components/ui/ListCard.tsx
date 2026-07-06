export interface ListCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: { text: string; className: string };
  actions?: React.ReactNode;
  onClick?: () => void;
}

export default function ListCard({ title, subtitle, meta, badge, actions, onClick }: ListCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg px-4 py-4 shadow-sm border border-gray-100 transition-all hover:shadow-md ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{title}</div>
          {subtitle && <div className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</div>}
          {meta && <div className="text-xs text-gray-400 mt-1">{meta}</div>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {badge && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
              {badge.text}
            </span>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
