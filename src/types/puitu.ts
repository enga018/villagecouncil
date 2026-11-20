/**
 * VC Puitu domain types.
 *
 * Tenant types mirror the isolated Puitu account mapping.
 * Job Card and Applicant types are the initial Register-import data contract;
 * they are not yet backed by database tables.
 */

export interface PuituVillageCouncil {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PuituMembership {
  id: string;
  user_id: string;
  village_council_id: string;
  is_active: boolean;
  created_at: string;
}

export interface PuituJobCard {
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

export interface PuituApplicant {
  id: string;
  villageCouncilId: string;
  jobCardId: string;
  applicantNumber: string;
  applicantName: string;
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
