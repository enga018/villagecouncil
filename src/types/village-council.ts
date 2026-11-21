/**
 * Village Council domain types.
 * Register import record types are a contract, not database tables yet.
 */

export interface VillageCouncil {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  state: string | null;
  district: string | null;
  block: string | null;
  village: string | null;
  block_url: string | null;
  panchayat_url: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  village_council_id: string;
  is_active: boolean;
  created_at: string;
}

export interface JobCard {
  id: string;
  villageCouncilId: string;
  jobCardNumber: string;
  headOfHousehold: string;
  status: "active" | "inactive" | "deleted";
  source: "official_register" | "manual";
  sourceRecordKey: string | null;
  firstImportedAt: string;
  lastSeenInImportAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Applicant {
  id: string;
  villageCouncilId: string;
  jobCardId: string;
  applicantNumber: string;
  applicantName: string;
  officialUniqueId: string | null;
  sourceRecordKey: string;
  status: "active" | "inactive" | "deleted";
  sourceSequence: number;
  firstImportedAt: string;
  lastSeenInImportAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterImportBatch {
  id: string;
  villageCouncilId: string;
  source: "official_registration_register";
  status: "pending" | "processing" | "completed" | "failed";
  sourcePeriod: string | null;
  sourceLocationKey: string | null;
  startedAt: string;
  completedAt: string | null;
  totalRows: number;
  insertedJobCards: number;
  updatedJobCards: number;
  insertedApplicants: number;
  updatedApplicants: number;
  missingRecords: number;
  errorMessage: string | null;
}
