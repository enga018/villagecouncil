"use client";

export interface Tab {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeTab === tab.id
              ? "bg-gray-100 text-gray-900 border border-gray-200"
              : "text-gray-500 hover:bg-gray-50"
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? ` (${tab.count})` : ""}
        </button>
      ))}
    </div>
  );
}
