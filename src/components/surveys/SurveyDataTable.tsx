'use client';

import { useState } from 'react';
import type { Property } from '@/modules/property-survey/types';

interface SurveyDataTableProps {
  properties: Property[];
  onEdit?: (property: Property) => void;
  onDelete?: (id: string) => void;
}

export function SurveyDataTable({
  properties,
  onEdit,
  onDelete,
}: SurveyDataTableProps) {
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'type'>('date');
  const [filterType, setFilterType] = useState<string>('all');

  const filteredProperties = filterType === 'all'
    ? properties
    : properties.filter((p) => p.property_type === filterType);

  const sortedProperties = [...filteredProperties].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'name':
        return a.owner_name.localeCompare(b.owner_name);
      case 'type':
        return a.property_type.localeCompare(b.property_type);
      default:
        return 0;
    }
  });

  const propertyTypes = Array.from(new Set(properties.map((p) => p.property_type)));

  return (
    <div className="space-y-4">
      <div className="flex gap-4 justify-between items-center">
        <div className="flex gap-4">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2"
          >
            <option value="all">All Types</option>
            {propertyTypes.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'type')}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2"
          >
            <option value="date">Sort by Date</option>
            <option value="name">Sort by Owner</option>
            <option value="type">Sort by Type</option>
          </select>
        </div>
        <div className="text-sm text-gray-600">
          {sortedProperties.length} properties
        </div>
      </div>

      {sortedProperties.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-600">
          No properties found
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Property ID</th>
                <th className="px-4 py-3 text-left font-medium">Owner</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Address</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-center font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedProperties.map((property) => (
                <tr key={property.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{property.property_id}</td>
                  <td className="px-4 py-3">{property.owner_name}</td>
                  <td className="px-4 py-3 capitalize">{property.property_type}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-xs">
                    {property.address}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      {property.occupancy_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(property.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-2 justify-center">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(property)}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(property.id)}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
