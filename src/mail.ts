import nodemailer, { type Transporter } from "nodemailer";

export interface SurveyEmail {
  to: { name: string; email: string };
  clientName: string;
  link: string;
  expiresOn: string;
}

export interface Mailer {
  sendSurvey(email: SurveyEmail): Promise<void>;
}

/** Development only: prints the link instead of sending it. Refused in production by config. */
export class ConsoleMailer implements Mailer {
  async sendSurvey(e: SurveyEmail): Promise<void> {
    console.log(`[mail] survey for ${e.clientName} -> ${e.to.email}: ${e.link}`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly companyName: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendSurvey(e: SurveyEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: { name: e.to.name, address: e.to.email },
      subject: `How are we doing, ${e.clientName}?`,
      text: surveyText(e, this.companyName),
    });
  }
}

export function surveyText(e: SurveyEmail, companyName: string): string {
  const firstName = e.to.name.split(" ")[0] ?? e.to.name;
  return [
    `Hi ${firstName},`,
    "",
    `Could you take two minutes to tell us how ${companyName} is doing for ${e.clientName}?`,
    "Five quick ratings and an optional comment. We read every one.",
    "",
    e.link,
    "",
    `The link works once and expires on ${e.expiresOn}.`,
    "",
    "Thank you,",
    companyName,
  ].join("\n");
}
