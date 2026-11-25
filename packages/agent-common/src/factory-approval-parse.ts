/**
 * Parsers for factory approval forms read by the Indra worker
 * (core.factory_approval_form, shared-db#7070):
 *   - Disney FAMA ("FACILITY AND MERCHANDISE AUTHORIZATION")
 *   - NBCUniversal LMS letters (e.g. "WAIVER APPROVAL")
 * Input is page text (embedded PDF text or Indra OCR), output feeds
 * core.record_factory_approval_form_ocr.
 */

export interface FactoryApprovalFields {
  name: string | null;
  number: string | null;
  issuedOn: string | null; // YYYY-MM-DD
  expiresOn: string | null; // YYYY-MM-DD
  formReference: string | null;
  aliases: string[] | null;
}

export type FactoryApprovalProgram = "disney" | "nbcu";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parses MM/DD/YYYY, YYYY-MM-DD, "May 28, 2027" and "28 May 2027". */
export function parseFormDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.trim();
  let m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m &&MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return null;
}

function lines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim());
}

const LABEL_LIKE = /^[A-Z][A-Za-z0-9 ()/&'.-]{1,60}:\s*/;

/**
 * Value for a label: text after the label on the same line, else the next
 * non-empty line (when that line is not itself another label).
 */
function valueAfter(ls: string[], label: RegExp): string | null {
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(label);
    if (!m) continue;
    const rest = ls[i].slice((m.index ?? 0) + m[0].length).trim();
    if (rest) return rest;
    for (let j = i + 1; j < ls.length && j <= i + 3; j++) {
      if (!ls[j]) continue;
      if (LABEL_LIKE.test(ls[j])) break;
      return ls[j];
    }
  }
  return null;
}

/** Lines under a heading until the next label-looking line or blank gap. */
function linesAfter(ls: string[], label: RegExp, stop: RegExp): string[] {
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(label);
    if (!m) continue;
    const rest = ls[i].slice((m.index ?? 0) + m[0].length).trim();
    if (rest) out.push(rest);
    for (let j = i + 1; j < ls.length; j++) {
      const l = ls[j];
      if (!l) { if (out.length) break; continue; }
      if (stop.test(l) || LABEL_LIKE.test(l)) break;
      out.push(l);
    }
    break;
  }
  return out;
}

export function detectFactoryApprovalProgram(text: string): FactoryApprovalProgram | null {
  if (/FACILITY\s+AND\s+MERCHANDISE\s+AUTHORI[SZ]ATION|FAMA\s+ID|\bFAC-\d{4,}/i.test(text)) return "disney";
  if (/Manufacturer\s+Code|NBC\s*Universal|\bNBCU\b|Universal\s+Products/i.test(text)) return "nbcu";
  return null;
}

export function parseFamaForm(text: string): FactoryApprovalFields {
  const ls = lines(text);
  let name: string | null = null;
  let number: string | null = null;
  const rawName = valueAfter(ls, /FACILITY\s+NAME\s*:/i);
  if (rawName) {
    const fac = rawName.match(/\(?\s*(FAC\s*-\s*\d{4,})\s*\)?\s*$/i);
    if (fac) number = fac[1].replace(/\s+/g, "").toUpperCase();
    name = rawName.replace(/\(?\s*FAC\s*-\s*\d{4,}\s*\)?\s*$/i, "").trim() || null;
  }
  if (!number) {
    const fac = text.match(/\bFAC\s*-\s*(\d{4,})\b/i);
    if (fac) number = `FAC-${fac[1]}`;
  }
  const aliasLines = linesAfter(ls, /FACILITY\s+ALIAS\s+NAME\(?S?\)?\s*:/i, /^(FACILITY|FAMA|ISSUANCE|LICENSEE|VENDOR|ADDRESS)\b/i)
    .filter((l) => !/^(N\/?A|none)$/i.test(l));
  const refRaw = valueAfter(ls, /FAMA\s+ID\s*(?:#|NO\.?|NUMBER)?\s*:?/i);
  const formReference = refRaw?.match(/[A-Z0-9]{6,}/)?.[0] ?? null;
  const issuedRaw = valueAfter(ls, /Issu(?:ance|ed)\s+Date\s*:/i);
  return {
    name,
    number,
    issuedOn: parseFormDate(issuedRaw),
    expiresOn: parseFormDate(valueAfter(ls, /Expir(?:ation|y|es)\s+Date\s*:/i)),
    formReference,
    aliases: aliasLines.length ? aliasLines : null,
  };
}

export function parseNbcuLmsForm(text: string): FactoryApprovalFields {
  const ls = lines(text);
  const name = valueAfter(ls, /Manufacturer\s+Name\s*:/i) ?? valueAfter(ls, /Factory\s+Name\s*:/i);
  const codeRaw = valueAfter(ls, /Manufacturer\s+(?:Code|ID|Number)\s*:/i) ?? valueAfter(ls, /Factory\s+(?:Code|ID)\s*:/i);
  const number = codeRaw?.match(/[A-Z]{1,3}\s*-\s*\d+|\d{3,}/i)?.[0].replace(/\s+/g, "") ?? null;
  const issued = valueAfter(ls, /Issue(?:d)?\s+Date\s*:/i) ?? valueAfter(ls, /Date\s+Issued\s*:/i);
  const expires = valueAfter(ls, /(?:Approval\s+)?Expir(?:ation|y)\s+Date\s*:/i) ?? valueAfter(ls, /Expires\s*(?:on)?\s*:/i);
  return {
    name: name?.trim() || null,
    number,
    issuedOn: parseFormDate(issued),
    expiresOn: parseFormDate(expires),
    formReference: null,
    aliases: null,
  };
}

/** Parse by the program the form was uploaded under; null name and number means unreadable. */
export function parseFactoryApprovalForm(program: FactoryApprovalProgram, text: string): FactoryApprovalFields {
  return program === "disney" ? parseFamaForm(text) : parseNbcuLmsForm(text);
}
