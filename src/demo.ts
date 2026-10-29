// `npm run demo`: sample data, no sign-in, and survey links printed to the console.
// Config refuses all three when NODE_ENV=production.
process.env.AUTH_MODE ??= "demo";
process.env.MAIL_MODE ??= "console";
process.env.DEMO_DATA ??= "true";
process.env.DATABASE_FILE ??= ":memory:";
process.env.COMPANY_NAME ??= "Example IT";

await import("./index.js");
