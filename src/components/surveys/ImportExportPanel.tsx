'use client';

import { useState } from 'react';

interface ImportExportPanelProps {
  fileName: string;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  isLoading?: boolean;
}

export function ImportExportPanel({
  fileName,
  onExport,
  onImport,
  isLoading = false,
}: ImportExportPanelProps) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);
    setImportSuccess(false);

    try {
      await onImport(file);
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 3000);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      // Reset input
      e.target.value = '';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-bold mb-4">Import / Export</h3>

      <div className="space-y-4">
        {/* Export Section */}
        <div className="border-b pb-4">
          <h4 className="font-medium mb-3">Export Data</h4>
          <p className="text-sm text-gray-600 mb-3">
            Download all data as CSV file for analysis or backup
          </p>
          <button
            onClick={onExport}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download CSV
          </button>
        </div>

        {/* Import Section */}
        <div>
          <h4 className="font-medium mb-3">Import Data</h4>
          <p className="text-sm text-gray-600 mb-3">
            Upload a CSV file to import data in bulk
          </p>

          {importSuccess && (
            <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              ✓ Data imported successfully
            </div>
          )}

          {importError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              ✗ {importError}
            </div>
          )}

          <div className="relative">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              disabled={importing || isLoading}
              className="hidden"
              id="csv-import"
            />
            <label
              htmlFor="csv-import"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {importing ? 'Importing...' : 'Upload CSV'}
            </label>
          </div>

          <p className="text-xs text-gray-500 mt-2">
            CSV must include headers: Property ID, Owner Name, Address, etc.
          </p>
        </div>
      </div>
    </div>
  );
}
