import type { PsaAdapter } from "./psa/types.js";
import type { Store } from "./store.js";

export interface SyncResult {
  synced: number;
  errors: { company: string; error: string }[];
}

/**
 * Pulls companies, contacts, contracts, and hours for the given months from the PSA.
 * Each company is fetched first and written in one transaction, so a PSA error
 * partway through leaves that company's previous data intact.
 */
export async function syncFromPsa(psa: PsaAdapter, store: Store, months: string[]): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, errors: [] };

  for (const company of await psa.listManagedCompanies()) {
    try {
      const [contacts, contract, hours] = await Promise.all([
        psa.listContacts(company.id),
        psa.getActiveContract(company.id),
        Promise.all(months.map((m) => psa.hoursForMonth(company.id, m))),
      ]);

      store.transaction(() => {
        const clientId = store.upsertClient(company.id, company.name);
        for (const c of contacts) {
          store.upsertContact(clientId, { psaId: c.id, name: c.name, email: c.email, isPrimary: c.isPrimary });
        }
        store.setContract(clientId, contract);
        months.forEach((m, i) => store.setUsage(clientId, m, hours[i] ?? 0));
      });
      result.synced++;
    } catch (err) {
      result.errors.push({ company: company.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
