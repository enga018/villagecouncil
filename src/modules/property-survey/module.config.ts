import { ModuleConfig } from '@/lib/moduleLoader';

export const propertyModuleConfig: ModuleConfig = {
  id: 'property-survey',
  name: 'Property Survey',
  description: 'Collect property details including location and photos',
  version: '1.0.0',
  icon: 'home',
  enabled: true,
  permissions: ['survey:read', 'survey:write'],
  dataSchema: {
    property_id: 'string',
    vc_id: 'string',
    property_type: 'string',
    owner_name: 'string',
    owner_contact: 'string',
    address: 'string',
    latitude: 'number',
    longitude: 'number',
    photo_url: 'string',
    occupancy_status: 'string',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
};
