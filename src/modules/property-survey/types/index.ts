export interface Property {
  id: string;
  vc_id: string;
  property_id: string;
  property_type: string;
  owner_name: string;
  owner_contact: string;
  address: string;
  latitude: number;
  longitude: number;
  photo_url?: string;
  occupancy_status: 'occupied' | 'vacant' | 'under_construction' | 'other';
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface PropertySurveyFormData {
  property_type: string;
  owner_name: string;
  owner_contact: string;
  address: string;
  latitude: number;
  longitude: number;
  photo_file?: File;
  occupancy_status: Property['occupancy_status'];
}

export interface PropertySurveyState {
  properties: Property[];
  currentProperty: Property | null;
  loading: boolean;
  error: string | null;
}
