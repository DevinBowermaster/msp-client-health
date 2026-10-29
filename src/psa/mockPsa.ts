import type { Contract } from "../domain/contractHealth.js";
import type { PsaAdapter, PsaCompany, PsaContact } from "./types.js";

interface MockCompany extends PsaCompany {
  contacts: PsaContact[];
  contract: Contract | null;
  /** Hours for the current month, then each month before it. */
  hoursByMonthsAgo: number[];
}

/** Made-up companies covering every contract state the dashboard shows. */
export const MOCK_COMPANIES: MockCompany[] = [
  {
    id: "100",
    name: "Acme Dental",
    contacts: [{ id: "100-1", name: "Priya Shah", email: "priya@acme-dental.example", isPrimary: true }],
    contract: { kind: "block", monthlyFee: 1800, includedHours: 12, overageRate: 165 },
    hoursByMonthsAgo: [14.5, 11, 9.5],
  },
  {
    id: "101",
    name: "Beta Builders",
    contacts: [
      { id: "101-1", name: "Marcus Lee", email: "marcus@betabuilders.example", isPrimary: false },
      { id: "101-2", name: "Dana Ortiz", email: "dana@betabuilders.example", isPrimary: true },
    ],
    contract: { kind: "unlimited", monthlyFee: 2400 },
    hoursByMonthsAgo: [26, 19, 22],
  },
  {
    id: "102",
    name: "Cedar Law Group",
    contacts: [{ id: "102-1", name: "Helen Park", email: "helen@cedarlaw.example", isPrimary: true }],
    contract: { kind: "unlimited", monthlyFee: 3200 },
    hoursByMonthsAgo: [17, 15.5, 18],
  },
  {
    id: "103",
    name: "Delta Logistics",
    contacts: [{ id: "103-1", name: "Sam Whitaker", email: "sam@deltalogistics.example", isPrimary: true }],
    contract: { kind: "block", monthlyFee: 2600, includedHours: 20, overageRate: 150 },
    hoursByMonthsAgo: [17.5, 12, 14],
  },
  {
    id: "104",
    name: "Evergreen Veterinary",
    contacts: [{ id: "104-1", name: "Rosa Jimenez", email: "rosa@evergreenvet.example", isPrimary: true }],
    contract: { kind: "block", monthlyFee: 950, includedHours: 8, overageRate: 155 },
    hoursByMonthsAgo: [4.5, 6, 5],
  },
  {
    id: "105",
    name: "Falcon Machining",
    contacts: [{ id: "105-1", name: "Tom Becker", email: null, isPrimary: true }],
    contract: { kind: "unlimited", monthlyFee: 1900 },
    hoursByMonthsAgo: [12, 21, 9],
  },
];

/** In-memory PSA for the demo and tests. `currentMonth` anchors hoursByMonthsAgo. */
export class MockPsa implements PsaAdapter {
  constructor(
    private readonly currentMonth: string,
    private readonly companies: MockCompany[] = MOCK_COMPANIES,
  ) {}

  async listManagedCompanies(): Promise<PsaCompany[]> {
    return this.companies.map(({ id, name }) => ({ id, name }));
  }

  async listContacts(companyId: string): Promise<PsaContact[]> {
    return this.find(companyId).contacts;
  }

  async getActiveContract(companyId: string): Promise<Contract | null> {
    return this.find(companyId).contract;
  }

  async hoursForMonth(companyId: string, month: string): Promise<number> {
    const monthsAgo = monthsBetween(month, this.currentMonth);
    return this.find(companyId).hoursByMonthsAgo[monthsAgo] ?? 0;
  }

  private find(companyId: string): MockCompany {
    const company = this.companies.find((c) => c.id === companyId);
    if (!company) throw new Error(`Unknown company ${companyId}`);
    return company;
  }
}

function monthsBetween(earlier: string, later: string): number {
  const [y1, m1] = earlier.split("-").map(Number) as [number, number];
  const [y2, m2] = later.split("-").map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
}
