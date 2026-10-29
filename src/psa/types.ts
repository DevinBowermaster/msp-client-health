import type { Contract } from "../domain/contractHealth.js";

export interface PsaCompany {
  id: string;
  name: string;
}

export interface PsaContact {
  id: string;
  name: string;
  email: string | null;
  isPrimary: boolean;
}

/**
 * The read-only slice of a PSA (Autotask, ConnectWise, HaloPSA...) this app needs.
 * Give the adapter an API account that can read companies, contacts, contracts,
 * and time entries, and nothing else.
 */
export interface PsaAdapter {
  /** Companies on a managed-services agreement. */
  listManagedCompanies(): Promise<PsaCompany[]>;
  listContacts(companyId: string): Promise<PsaContact[]>;
  /** The agreement currently in force, or null if the company has none. */
  getActiveContract(companyId: string): Promise<Contract | null>;
  /** Billable hours logged against the company in a YYYY-MM month. */
  hoursForMonth(companyId: string, month: string): Promise<number>;
}
