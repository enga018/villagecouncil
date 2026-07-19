import { Household, FamilyMember } from '../types';

export function exportHouseholdsToCSV(households: Household[]): string {
  const headers = [
    'Property ID',
    'Family ID',
    'Head of Household',
    'Member Name',
    'Gender',
    'Age',
    'Relation',
    'Total Members',
    'Children Count',
    'Created Date',
  ];

  const rows: string[] = [];

  households.forEach((household) => {
    household.members.forEach((member, index) => {
      rows.push(
        [
          household.property_id,
          household.family_id,
          household.head_of_household,
          member.name,
          member.gender,
          member.age.toString(),
          member.relation,
          index === 0 ? household.total_members.toString() : '',
          index === 0 ? household.children_count.toString() : '',
          index === 0 ? new Date(household.created_at).toISOString().split('T')[0] : '',
        ].join(',')
      );
    });
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
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

export async function importHouseholdsFromCSV(
  file: File
): Promise<Array<{ property_id: string; family_id: string; head_of_household: string; members: FamilyMember[] }>> {
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

        const householdsMap = new Map<
          string,
          { property_id: string; family_id: string; head_of_household: string; members: FamilyMember[] }
        >();

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const values = parseCSVLine(line);
          const propertyId = values[0];
          const familyId = values[1];
          const headOfHousehold = values[2];
          const memberName = values[3];
          const gender = values[4] as FamilyMember['gender'];
          const age = parseInt(values[5]);
          const relation = values[6] as FamilyMember['relation'];

          const key = `${propertyId}:${familyId}`;

          if (!householdsMap.has(key)) {
            householdsMap.set(key, {
              property_id: propertyId,
              family_id: familyId,
              head_of_household: headOfHousehold,
              members: [],
            });
          }

          const household = householdsMap.get(key)!;
          household.members.push({
            id: `member-${Date.now()}-${Math.random()}`,
            name: memberName,
            gender,
            age,
            relation,
          });
        }

        resolve(Array.from(householdsMap.values()));
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
