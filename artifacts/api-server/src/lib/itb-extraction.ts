export type ExtractedField = { value: string | null; confidence: number; evidence: string };
export type Extraction = {
  issuer: ExtractedField;
  contactName: ExtractedField;
  contactEmail: ExtractedField;
  contactPhone: ExtractedField;
  projectName: ExtractedField;
  location: ExtractedField;
  dueDate: ExtractedField;
  scope: ExtractedField[];
  requirements: ExtractedField[];
  alternates: ExtractedField[];
  estimatedValue: ExtractedField;
};

export const extractionKeys = ["issuer", "contactName", "contactEmail", "contactPhone", "projectName", "location", "dueDate", "scope", "requirements", "alternates", "estimatedValue"] as const;
const EXTRACTION_TEXT_LIMIT = 50_000;
const clean = (value: string | undefined | null, max = 500) => value?.replace(/\s+/g, " ").trim().slice(0, max) || null;
const field = (value: string | null, confidence: number, source: string) => ({ value: clean(value), confidence, evidence: clean(source, 700) ?? "" });
const empty = (): ExtractedField => ({ value: null, confidence: 0, evidence: "Not detected in the source." });
const labeled = (text: string, labels: string[]) => {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labels.join("|")})\\s*[:\\-]\\s*([^\\n]+)`, "i"));
  return match ? { value: clean(match[1]), source: match[0] } : null;
};
const email = (text: string) => text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
const phone = (text: string) => text.match(/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/)?.[0] ?? null;
const parseDate = (value: string) => {
  const normalized = value.replace(/(\d)(st|nd|rd|th)\b/gi, "$1").trim();
  const iso = normalized.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = normalized.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
};
const money = (value: string | null) => {
  const match = value?.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return null;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1;
  return String(Math.round(Number(match[1]) * multiplier * 100) / 100);
};

export function extractItb(sourceSubject: string | null, sourceBody: string) {
  const text = `${sourceSubject ? `Subject: ${sourceSubject}\n` : ""}${sourceBody}`.slice(0, EXTRACTION_TEXT_LIMIT);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const issuer = labeled(text, ["issuer", "owner", "general contractor", "gc"]);
  const project = labeled(text, ["project", "project name", "job name"]);
  const location = labeled(text, ["location", "jobsite", "job site", "site address", "project address"]);
  const contact = labeled(text, ["contact", "contact name"]);
  const due = labeled(text, ["bid due", "due date", "proposal due", "bids due", "deadline"]);
  const value = labeled(text, ["estimated value", "project value", "budget", "estimate"]);
  const subjectProject = clean(sourceSubject?.replace(/^(re:\s*)?(itb|invitation to bid|request for proposal|rfp)\s*[:\-#]?\s*/i, ""));
  const dateMatch = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b|\b20\d{2}-\d{1,2}-\d{1,2}\b/i);
  const parsedEmail = email(text);
  const parsedPhone = phone(text);
  const dueDate = due ? parseDate(due.value ?? "") : dateMatch ? parseDate(dateMatch[0]) : null;
  const moneyMatch = value?.value ?? text.match(/\$\s*\d[\d,.]*(?:\s*[kmb])?/i)?.[0] ?? null;
  const scopeTerms = ["concrete", "masonry", "steel", "carpentry", "drywall", "flooring", "roofing", "glazing", "doors", "millwork", "painting", "plumbing", "hvac", "electrical", "sitework", "landscaping", "earthwork", "fire protection"];
  const scopes = scopeTerms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text)).slice(0, 12);
  const requirements = lines.filter((line) => /\b(require|must|submit|insurance|bond|warranty|prevailing|schedule|prequalification)\b/i.test(line)).slice(0, 8);
  const alternates = lines.filter((line) => /\b(alternate|option|additive|deduct)\b/i.test(line)).slice(0, 8);
  const list = (values: string[], confidence: number) => values.map((value) => field(value, confidence, value));
  const extraction: Extraction = {
    issuer: field(issuer?.value ?? null, issuer ? 0.93 : 0, issuer?.source ?? "No issuer label found."),
    contactName: field(contact?.value ?? null, contact ? 0.9 : 0, contact?.source ?? "No contact label found."),
    contactEmail: field(parsedEmail, parsedEmail ? 0.98 : 0, parsedEmail ?? "No email address found."),
    contactPhone: field(parsedPhone, parsedPhone ? 0.86 : 0, parsedPhone ?? "No phone number found."),
    projectName: field(project?.value ?? subjectProject, project ? 0.94 : subjectProject ? 0.72 : 0, project?.source ?? (subjectProject ? `Subject: ${subjectProject}` : "No project name found.")),
    location: field(location?.value ?? null, location ? 0.91 : 0, location?.source ?? "No location label found."),
    dueDate: field(dueDate, dueDate ? (due ? 0.97 : 0.7) : 0, due?.source ?? dateMatch?.[0] ?? "No bid deadline found."),
    scope: list(scopes, 0.67),
    requirements: list(requirements, 0.72),
    alternates: list(alternates, 0.72),
    estimatedValue: field(money(moneyMatch), moneyMatch ? (value ? 0.9 : 0.6) : 0, value?.source ?? moneyMatch ?? "No estimated value found."),
  };
  const warnings = extractionKeys.filter((key) => Array.isArray(extraction[key]) ? extraction[key].length === 0 : !extraction[key].value)
    .map((key) => `No ${key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)} was confidently detected.`);
  return { extraction, warnings };
}

export const emptyItbExtraction = (): Extraction => ({
  issuer: empty(), contactName: empty(), contactEmail: empty(), contactPhone: empty(),
  projectName: empty(), location: empty(), dueDate: empty(), scope: [], requirements: [], alternates: [], estimatedValue: empty(),
});