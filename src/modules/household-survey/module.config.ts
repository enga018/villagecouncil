import { ModuleConfig } from '@/lib/moduleLoader';

export const householdModuleConfig: ModuleConfig = {
  id: 'household-survey',
  name: 'Household Survey',
  description: 'Collect family and household data linked to properties',
  version: '1.0.0',
  icon: 'users',
  enabled: true,
  permissions: ['survey:read', 'survey:write'],
  dataSchema: {
    family_id: 'string',
    property_id: 'string',
    vc_id: 'string',
    members: 'json',
    head_of_household: 'string',
    total_members: 'number',
    children_count: 'number',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
};
