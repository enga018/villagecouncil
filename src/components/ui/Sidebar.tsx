"use client";

import { useState } from "react";

export interface SidebarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
}

export interface SidebarProps {
  brand: {
    name: string;
    subtitle?: string;
    logo?: React.ReactNode;
  };
  items: SidebarItem[];
  footer: {
    userName: string;
    userRole?: string;
    onLogout: () => void;
  };
}

export default function Sidebar({ brand, items, footer }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <div className="h-full flex flex-col">
      <div className="px-4 py-5">
        {brand.logo ? (
          <div className="flex items-center gap-3">
            {brand.logo}
            <div>
              <div className="font-bold text-sm text-gray-900">{brand.name}</div>
              {brand.subtitle && <div className="text-xs text-gray-500">{brand.subtitle}</div>}
            </div>
          </div>
        ) : (
          <div>
            <div className="font-bold text-sm text-gray-900">{brand.name}</div>
            {brand.subtitle && <div className="text-xs text-gray-500">{brand.subtitle}</div>}
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              item.onClick?.();
              setMobileOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
              item.active
                ? "bg-gray-200/70 text-gray-900 font-medium"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span className="text-gray-500 flex-shrink-0">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-medium flex-shrink-0">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">{footer.userName}</div>
            {footer.userRole && (
              <div className="text-xs text-gray-500 capitalize">{footer.userRole}</div>
            )}
          </div>
          <button
            onClick={footer.onLogout}
            className="text-xs text-gray-500 hover:text-gray-800 font-medium"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <button onClick={() => setMobileOpen(true)} className="text-gray-600">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="font-semibold text-sm text-gray-900">{brand.name}</div>
        <div className="w-6" />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 bg-gray-50 z-50 lg:hidden shadow-xl">
            {sidebarContent}
          </div>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-gray-50 border-r border-gray-100 h-screen sticky top-0 flex-shrink-0">
        {sidebarContent}
      </aside>
    </>
  );
}
