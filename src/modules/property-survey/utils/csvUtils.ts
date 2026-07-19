import { Property } from '../types';

export function exportPropertiesToCSV(properties: Property[], vcName: string): string {
  const headers = [
    'Property ID',
    'Property Type',
    'Owner Name',
    'Contact',
    'Address',
    'Latitude',
    'Longitude',
    'Occupancy Status',
    'Created Date',
  ];

  const rows = properties.map((prop) => [
    prop.property_id,
    prop.property_type,
    prop.owner_name,
    prop.owner_contact || '',
    prop.address,
    prop.latitude.toString(),
    prop.longitude.toString(),
    prop.occupancy_status,
    new Date(prop.created_at).toISOString().split('T')[0],
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row
        .map((cell) =>
          typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
            ? `"${cell.replace(/"/g, '""')}"`
            : cell
        )
        .join(',')
    ),
  ].join('\n');

  return '﻿' + csvContent; // UTF-8 BOM
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function importPropertiesFromCSV(file: File): Promise<Partial<Property>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.replace(/﻿/g, '').split('\n');

        if (lines.length < 2) {
          reject(new Error('CSV file must contain at least header and one data row'));
          return;
        }

        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const properties: Partial<Property>[] = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const values = parseCSVLine(line);
          const prop: Partial<Property> = {
            property_id: values[0],
            property_type: values[1],
            owner_name: values[2],
            owner_contact: values[3] || undefined,
            address: values[4],
            latitude: parseFloat(values[5]),
            longitude: parseFloat(values[6]),
            occupancy_status: values[7] as Property['occupancy_status'],
          };

          properties.push(prop);
        }

        resolve(properties);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}
