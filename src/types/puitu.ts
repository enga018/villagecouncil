/**
 * VC Puitu domain types.
 *
 * These types describe the first Job Cards module contract only.
 * They are not a database schema; tenant-safe persistence and import
 * reconciliation rules will be implemented after the model is reviewed.
 */

export interface PuituJobCard {
  id: string;
  villageCouncilId: string;
  jobCardNumber: string;
  headOfHousehold: string;
  status: "active" | "inactive" | "deleted";
  source: "official_mis" | "manual";
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

export interface JobCardImportBatch {
  id: string;
  villageCouncilId: string;
  source: "official_mis";
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
