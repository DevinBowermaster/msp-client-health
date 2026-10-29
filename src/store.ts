import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { Contract } from "./domain/contractHealth.js";
import type { SurveyAnswers } from "./domain/scoring.js";

export interface ClientRow {
  id: number;
  psaId: string;
  name: string;
  surveyFrequencyDays: number;
  nextSurveyOn: string | null;
  surveysEnabled: boolean;
}

export interface ContactRow {
  id: number;
  clientId: number;
  name: string;
  email: string | null;
  isPrimary: boolean;
}

export interface SurveyRecord {
  id: number;
  clientId: number;
  clientName: string;
  contactName: string;
  sentAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface ResponseRow extends SurveyAnswers {
  id: number;
  clientId: number;
  clientName: string;
  contactName: string;
  completedAt: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  detail: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  psa_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  survey_frequency_days INTEGER NOT NULL DEFAULT 90 CHECK (survey_frequency_days BETWEEN 7 AND 365),
  next_survey_on TEXT,
  surveys_enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  psa_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contracts (
  client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('block', 'unlimited')),
  monthly_fee REAL NOT NULL,
  included_hours REAL,
  overage_rate REAL
);
CREATE TABLE IF NOT EXISTS usage (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  hours_used REAL NOT NULL,
  PRIMARY KEY (client_id, month)
);
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  overall INTEGER,
  responsiveness INTEGER,
  expertise INTEGER,
  communication INTEGER,
  recommend INTEGER,
  comment_well TEXT,
  comment_improve TEXT
);
CREATE INDEX IF NOT EXISTS surveys_client ON surveys(client_id, completed_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
`;

const CLIENT_COLUMNS = `id, psa_id AS psaId, name, survey_frequency_days AS surveyFrequencyDays,
  next_survey_on AS nextSurveyOn, surveys_enabled AS surveysEnabled`;

const RESPONSE_COLUMNS = `s.id, s.client_id AS clientId, c.name AS clientName, ct.name AS contactName,
  s.completed_at AS completedAt, s.overall, s.responsiveness, s.expertise, s.communication, s.recommend,
  s.comment_well AS commentWell, s.comment_improve AS commentImprove`;

/** Thin typed wrapper over SQLite. All SQL lives here; nothing else builds queries. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // Clients ----------------------------------------------------------------

  upsertClient(psaId: string, name: string): number {
    const row = this.one<{ id: number }>(
      `INSERT INTO clients (psa_id, name) VALUES (?, ?)
       ON CONFLICT(psa_id) DO UPDATE SET name = excluded.name
       RETURNING id`,
      psaId,
      name,
    );
    return row!.id;
  }

  listClients(): ClientRow[] {
    return this.many<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY name`).map(toClient);
  }

  getClient(id: number): ClientRow | undefined {
    const row = this.one<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`, id);
    return row && toClient(row);
  }

  dueClients(today: string): ClientRow[] {
    return this.many<ClientRow>(
      `SELECT ${CLIENT_COLUMNS} FROM clients
       WHERE surveys_enabled = 1 AND (next_survey_on IS NULL OR next_survey_on <= ?)
       ORDER BY name`,
      today,
    ).map(toClient);
  }

  setNextSurvey(clientId: number, date: string): void {
    this.run("UPDATE clients SET next_survey_on = ? WHERE id = ?", date, clientId);
  }

  // Contacts ---------------------------------------------------------------

  upsertContact(clientId: number, c: { psaId: string; name: string; email: string | null; isPrimary: boolean }): void {
    this.run(
      `INSERT INTO contacts (client_id, psa_id, name, email, is_primary) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(psa_id) DO UPDATE SET client_id = excluded.client_id, name = excluded.name,
         email = excluded.email, is_primary = excluded.is_primary`,
      clientId,
      c.psaId,
      c.name,
      c.email,
      c.isPrimary ? 1 : 0,
    );
  }

  /** The contact who receives surveys: the primary one if it has an email, otherwise the first with an email. */
  surveyContact(clientId: number): ContactRow | undefined {
    const row = this.one<ContactRow>(
      `SELECT id, client_id AS clientId, name, email, is_primary AS isPrimary FROM contacts
       WHERE client_id = ? AND email IS NOT NULL AND email <> ''
       ORDER BY is_primary DESC, id LIMIT 1`,
      clientId,
    );
    return row && { ...row, isPrimary: Boolean(row.isPrimary) };
  }

  // Contracts and usage ----------------------------------------------------

  setContract(clientId: number, contract: Contract | null): void {
    if (contract === null) {
      this.run("DELETE FROM contracts WHERE client_id = ?", clientId);
      return;
    }
    const block = contract.kind === "block" ? contract : null;
    this.run(
      `INSERT INTO contracts (client_id, kind, monthly_fee, included_hours, overage_rate) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET kind = excluded.kind, monthly_fee = excluded.monthly_fee,
         included_hours = excluded.included_hours, overage_rate = excluded.overage_rate`,
      clientId,
      contract.kind,
      contract.monthlyFee,
      block?.includedHours ?? null,
      block?.overageRate ?? null,
    );
  }

  getContract(clientId: number): Contract | null {
    const row = this.one<{ kind: string; monthlyFee: number; includedHours: number | null; overageRate: number | null }>(
      `SELECT kind, monthly_fee AS monthlyFee, included_hours AS includedHours, overage_rate AS overageRate
       FROM contracts WHERE client_id = ?`,
      clientId,
    );
    if (!row) return null;
    if (row.kind === "block") {
      return { kind: "block", monthlyFee: row.monthlyFee, includedHours: row.includedHours ?? 0, overageRate: row.overageRate ?? 0 };
    }
    return { kind: "unlimited", monthlyFee: row.monthlyFee };
  }

  setUsage(clientId: number, month: string, hoursUsed: number): void {
    this.run(
      `INSERT INTO usage (client_id, month, hours_used) VALUES (?, ?, ?)
       ON CONFLICT(client_id, month) DO UPDATE SET hours_used = excluded.hours_used`,
      clientId,
      month,
      hoursUsed,
    );
  }

  hoursUsed(clientId: number, month: string): number {
    return this.one<{ h: number }>("SELECT hours_used AS h FROM usage WHERE client_id = ? AND month = ?", clientId, month)?.h ?? 0;
  }

  // Surveys ----------------------------------------------------------------

  createSurvey(s: { clientId: number; contactId: number; tokenHash: string; sentAt: string; expiresAt: string }): number {
    return this.one<{ id: number }>(
      `INSERT INTO surveys (client_id, contact_id, token_hash, sent_at, expires_at) VALUES (?, ?, ?, ?, ?) RETURNING id`,
      s.clientId,
      s.contactId,
      s.tokenHash,
      s.sentAt,
      s.expiresAt,
    )!.id;
  }

  deleteSurvey(id: number): void {
    this.run("DELETE FROM surveys WHERE id = ?", id);
  }

  findSurvey(tokenHash: string): SurveyRecord | undefined {
    return this.one<SurveyRecord>(
      `SELECT s.id, s.client_id AS clientId, c.name AS clientName, ct.name AS contactName,
         s.sent_at AS sentAt, s.expires_at AS expiresAt, s.completed_at AS completedAt
       FROM surveys s JOIN clients c ON c.id = s.client_id JOIN contacts ct ON ct.id = s.contact_id
       WHERE s.token_hash = ?`,
      tokenHash,
    );
  }

  /**
   * Records answers only if the survey is still open. The check and the write are one
   * statement, so two submissions racing each other cannot both succeed.
   */
  completeSurvey(tokenHash: string, a: SurveyAnswers, now: string): boolean {
    const result = this.run(
      `UPDATE surveys SET completed_at = ?, overall = ?, responsiveness = ?, expertise = ?, communication = ?,
         recommend = ?, comment_well = ?, comment_improve = ?
       WHERE token_hash = ? AND completed_at IS NULL AND expires_at > ?`,
      now,
      a.overall,
      a.responsiveness,
      a.expertise,
      a.communication,
      a.recommend,
      a.commentWell || null,
      a.commentImprove || null,
      tokenHash,
      now,
    );
    return result.changes === 1;
  }

  responsesSince(since: string, clientId?: number): ResponseRow[] {
    const rows = this.many<ResponseRow & { commentWell: string | null; commentImprove: string | null }>(
      `SELECT ${RESPONSE_COLUMNS}
       FROM surveys s JOIN clients c ON c.id = s.client_id JOIN contacts ct ON ct.id = s.contact_id
       WHERE s.completed_at IS NOT NULL AND s.completed_at >= ? AND (? IS NULL OR s.client_id = ?)
       ORDER BY s.completed_at DESC`,
      since,
      clientId ?? null,
      clientId ?? null,
    );
    return rows.map((r) => ({ ...r, commentWell: r.commentWell ?? undefined, commentImprove: r.commentImprove ?? undefined }));
  }

  surveyCountsSince(since: string): { sent: number; completed: number } {
    return this.one<{ sent: number; completed: number }>(
      `SELECT COUNT(*) AS sent, COUNT(completed_at) AS completed FROM surveys WHERE sent_at >= ?`,
      since,
    )!;
  }

  // Audit ------------------------------------------------------------------

  audit(actor: string, action: string, detail: string | null, at: string): void {
    this.run("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)", at, actor, action, detail);
  }

  listAudit(limit = 100): AuditRow[] {
    return this.many<AuditRow>("SELECT id, at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?", limit);
  }

  // Helpers ----------------------------------------------------------------

  private stmt(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  private many<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.stmt(sql).run(...params);
  }
}

function toClient(row: ClientRow): ClientRow {
  return { ...row, surveysEnabled: Boolean(row.surveysEnabled) };
}
