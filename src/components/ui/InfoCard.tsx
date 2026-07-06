export interface InfoCardProps {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}

export default function InfoCard({ items, className = "" }: InfoCardProps) {
  return (
    <div className={`bg-gray-50 rounded-xl p-5 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((item, index) => (
          <div key={index}>
            <div className="text-xs text-blue-600 font-semibold mb-1 uppercase tracking-wide">
              {item.label}
            </div>
            <div className="text-sm font-semibold text-gray-900">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
