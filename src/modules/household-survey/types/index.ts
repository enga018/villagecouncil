export interface FamilyMember {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'other';
  age: number;
  relation: 'head' | 'spouse' | 'child' | 'parent' | 'sibling' | 'other';
}

export interface Household {
  id: string;
  property_id: string;
  vc_id: string;
  family_id: string;
  members: FamilyMember[];
  head_of_household: string;
  total_members: number;
  children_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface HouseholdSurveyFormData {
  property_id: string;
  members: FamilyMember[];
  head_of_household: string;
}

export interface HouseholdSurveyState {
  households: Household[];
  currentHousehold: Household | null;
  currentMembers: FamilyMember[];
  loading: boolean;
  error: string | null;
}
