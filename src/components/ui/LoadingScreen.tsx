"use client";

export default function LoadingScreen({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Village Council</h1>
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}
