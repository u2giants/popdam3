/**
 * Factory approval form reader (shared-db#7070): Disney FAMA and NBCU LMS PDFs
 * uploaded in DesignFlow. Claims pending forms, reads embedded PDF text (or Indra
 * OCR when a page has none), parses the fields, and records the result. A form
 * that cannot be read goes to `failed` with the reason.
 */
import { logger } from "./common/logger.js";
import { indraPython, ocrPngsWithIndra } from "./common/indra-ocr.js";
import { parseFactoryApprovalForm } from "./common/factory-approval-parse.js";
import * as api from "./api-client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

const MAX_PAGES = 6;
const MAX_BYTES = 50 * 1024 * 1024;
const MIN_EMBEDDED_CHARS = 80;

async function readPdfText(pdf: Buffer): Promise<string> {
  const mupdf = await dynamicImport("mupdf");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const texts: string[] = [];
  const pngs: Buffer[] = [];
  try {
    const n = Math.min(doc.countPages(), MAX_PAGES);
    for (let p = 0; p < n; p++) {
      const page = doc.loadPage(p);
      texts.push(String(page.toStructuredText("preserve-whitespace").asText() ?? ""));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pix = page.toPixmap([2, 0, 0, 2, 0, 0] as any, mupdf.ColorSpace.DeviceRGB, false);
      pngs.push(Buffer.from(pix.asPNG() as Uint8Array));
      pix.destroy?.();
      page.destroy?.();
    }
  } finally {
    doc.destroy?.();
  }
  const embedded = texts.join("\n").trim();
  if (embedded.replace(/\s+/g, "").length >= MIN_EMBEDDED_CHARS) return embedded;
  const indra = indraPython();
  if (!indra) throw new Error("no embedded text and Indra OCR is not available on this agent");
  return (await ocrPngsWithIndra(indra, pngs)).join("\n").trim();
}

async function processForm(job: api.FactoryApprovalFormJob): Promise<void> {
  let ocrText: string | null = null;
  try {
    const res = await fetch(job.download_url);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("file over 50 MB");
    ocrText = await readPdfText(buf);
    if (!ocrText) throw new Error("no text found in form");
    const f = parseFactoryApprovalForm(job.program, ocrText);
    if (!f.name && !f.number) throw new Error(`could not find the ${job.program === "disney" ? "FAMA facility" : "LMS manufacturer"} name or number`);
    await api.completeFactoryApprovalForm({
      form_id: job.id, ocr_text: ocrText, name: f.name, number: f.number, expires_on: f.expiresOn,
      issued_on: f.issuedOn, form_reference: f.formReference, aliases: f.aliases, error: null,
    });
    logger.info("Factory approval form read", { formId: job.id, program: job.program, number: f.number });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 1000);
    logger.warn("Factory approval form failed", { formId: job.id, error: msg });
    await api.completeFactoryApprovalForm({
      form_id: job.id, ocr_text: ocrText, name: null, number: null, expires_on: null,
      issued_on: null, form_reference: null, aliases: null, error: msg,
    });
  }
}

let running = false;

/** One pass: drain pending forms, 10 at a time. Never throws. */
export async function runFactoryApprovalOcr(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let round = 0; round < 20; round++) {
      const jobs = await api.claimFactoryApprovalForms(10);
      if (jobs.length === 0) break;
      for (const job of jobs) await processForm(job);
    }
  } catch (e) {
    logger.warn("Factory approval OCR pass failed (will retry)", { error: (e as Error).message });
  } finally {
    running = false;
  }
}
