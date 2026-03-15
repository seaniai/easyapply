// src/auth/auth_manager_types.ts

/* -----------------------------------------------------------
User Management – Shared Frontend Types
Used by AuthManager.tsx and Tauri invoke responses.
----------------------------------------------------------- */

/**
 * A single user record used in CSV export/import.
 * Corresponds to auth.db logical fields.
 */
export interface UserRow {
  role: string;      // role name (case-insensitive input)
  id: number;        // unique integer identifier
  username: string;  // unique username
}


/**
 * Row-level validation error during CSV parsing.
 */
export interface ValidationError {
  line: number;      // CSV line number (starting from 2 if header present)
  message: string;   // human-readable error message
}


/**
 * Validation result returned before applying CSV changes.
 */
export interface ValidationReport {
  valid: boolean;

  totalRows: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;

  errors: ValidationError[];
}


/**
 * Result returned by bulk import after execution.
 */
export interface BulkApplyResult {
  created: number;
  updated: number;
  deleted: number;
}


/**
 * Result returned by export command.
 */
export interface ExportResult {
  savedPath: string;
}


/**
 * Parameters for single-user upsert/delete.
 */
export interface UpsertUserParams {
  username: string;
  role: string; // Admin/User/Delete (case-insensitive)
}


/**
 * Response after single-user operation.
 */
export interface UpsertUserResult {
  id: number;
  username: string;
  role: string;
}


/**
 * Bulk CSV apply parameters.
 */
export interface BulkApplyParams {
  rows: UserRow[];
}