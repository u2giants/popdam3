// Folder shortening rule engine (u2giants/popdam3#963). Pure: no Node or Deno APIs.
// Used by the CLI planner (tools/folder-rename/plan.mjs) and the admin folder guard (Phase 6).
const SEP = "[\\s_\\-–,.()&+]";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same test as infer_path_attrs' SKU guard. */
export function looksLikeSku(name) {
  const head = name.split(/[_\s]/)[0];
  return !/\s/.test(head) && /^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$/.test(head) && head.length >= 8;
}

export function isProtected(name, rules) {
  return rules.never_touch.includes(name);
}

/** Remove separators left dangling after a strip. */
export function tidy(name) {
  let n = name
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*(?:-\s*)+/g, " - ")
    .replace(/_{2,}/g, "_")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+_/g, " ")
    .replace(/_\s+/g, " ");
  n = n.replace(/^[\s\-_,.&+]+/, "").replace(/[\s\-_,&+]+$/, "");
  return n.replace(/\s+/g, " ").trim();
}

/** Remove whole-word occurrences of each term (case-insensitive). */
export function stripTerms(name, terms) {
  let n = name;
  const sorted = [...terms].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    const re = new RegExp(`(^|${SEP})${escapeRe(t)}(?='?s?(?:$|${SEP}))('?s?)`, "gi");
    n = n.replace(re, (_m, pre) => (pre && /\s/.test(pre) ? " " : pre === "" ? "" : pre));
  }
  return n;
}

export function applyPhrases(name, phrases) {
  let n = name;
  for (const [from, to] of phrases) {
    const re = new RegExp(`(^|${SEP})${escapeRe(from)}(?=$|${SEP})`, "gi");
    n = n.replace(re, (_m, pre) => `${pre}${to}`);
  }
  return n;
}

export function applyPatterns(name, patterns) {
  for (const p of patterns) {
    const re = new RegExp(p.match, p.flags ?? "");
    if (re.test(name)) return { name: name.replace(re, p.replace), id: p.id };
  }
  return null;
}

/**
 * Build the context for a folder from its OLD ancestors (relative to root).
 * Returns { stageLevel, customer, underYear }.
 */
function contextFor(relSegs, rules) {
  // relSegs: ancestor names below root, old spelling (or already-new spelling).
  const ctx = { customer: null, yearParent: null, depthBelowCustomer: -1 };
  const containers = rules.customer_containers.map((c) => c.split("/"));
  for (const cont of containers) {
    const matches = (segs) => segs.length >= cont.length && cont.every((c, i) => sameStage(segs[i], c, rules));
    if (!matches(relSegs)) continue;
    const rest = relSegs.slice(cont.length);
    if (rest.length === 0) return ctx;
    let custSeg = rest[0];
    let restBelow = rest.slice(1);
    if (custSeg === rules.finished_bucket.folder) {
      if (rest.length < 2) return ctx;
      custSeg = finishedCustomer(rest[1], rules);
      if (!custSeg) return ctx;
      restBelow = rest.slice(2);
    } else if (custSeg.startsWith("_") || rules.not_customers.includes(custSeg)) {
      return ctx;
    }
    ctx.customer = canonicalCustomer(custSeg, rules);
    ctx.depthBelowCustomer = restBelow.length; // 0 = direct child of customer folder
    if (restBelow.length >= 1 && /^\d{4}$/.test(restBelow[restBelow.length - 1]) && restBelow.length === 1) {
      ctx.yearParent = restBelow[0];
    }
    return ctx;
  }
  return ctx;
}

/** Years standing alone in a name (not part of a date like 12.18.2023 or 2023-01). */
export function standaloneYears(seg) {
  return [...seg.matchAll(/(?<![\d.\-\/,])((?:19|20)\d\d)(?![\d.\-\/,])/g)].map((m) => m[1]);
}

/** Customer named by a `_FINISHED` child, with or without the suffix. */
function finishedCustomer(seg, rules) {
  const m = seg.match(new RegExp(`^(.*?)(${escapeRe(rules.finished_bucket.suffix)})?$`, "i"));
  if (!m[2] && !rules.finished_bucket.drop_suffix) return null;
  return m[1] || null;
}

function sameStage(seg, canonical, rules) {
  if (seg === canonical) return true;
  return rules.stage_abbreviations[canonical] === seg;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Short name for a customer folder, ignoring case and punctuation (Ollie's = Ollies). */
export function aliasFor(name, rules) {
  for (const [k, v] of Object.entries(rules.customer_aliases)) if (norm(k) === norm(name)) return v;
  return undefined;
}

/** Replace every customer's full name inside a folder name with its short name (owner: one spelling everywhere). */
export function replaceCustomerNames(n, rules) {
  const entries = Object.entries(rules.customer_aliases).sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of entries) {
    const pat = k.split(/[^A-Za-z0-9]+/).filter(Boolean).map(escapeRe).join("[^A-Za-z0-9]*");
    n = n.replace(new RegExp(`(?<![A-Za-z0-9])${pat}(?![A-Za-z0-9])`, "gi"), v);
  }
  return n;
}

/** Map either the long folder name or its alias back to the canonical key. */
function canonicalCustomer(seg, rules) {
  for (const [k, v] of Object.entries(rules.customer_aliases)) {
    if (norm(seg) === norm(k) || norm(seg) === norm(v)) return k;
  }
  return seg;
}

function stripTermsFor(customer, rules) {
  const terms = new Set([customer]);
  if (aliasFor(customer, rules)) terms.add(aliasFor(customer, rules));
  for (const t of rules.strip_from_descendants[customer] ?? []) terms.add(t);
  return [...terms];
}

/**
 * Propose a new name for one folder. Returns { name, rules: [] , flag? }.
 * relParents are the ancestor names below root (old spelling).
 */
export function proposeName(name, relParents, rules, opts = {}) {
  const applied = [];
  if (name.startsWith("@") || name.startsWith("#") || isProtected(name, rules)) return { name, applied };
  const stripYear = opts.stripYear ?? rules.strip_year_under_year_folder.enabled;
  let n = name;

  // 1. Stage abbreviations (top-level stage folders and containers).
  if (relParents.length <= 1 && rules.stage_abbreviations[n]) {
    n = rules.stage_abbreviations[n];
    applied.push("stage_abbreviation");
    return { name: n, applied };
  }

  const ctx = contextFor(relParents, rules);
  const isCustomerFolder = (() => {
    const segs = [...relParents, name];
    for (const cont of rules.customer_containers.map((c) => c.split("/"))) {
      if (segs.length === cont.length + 1 && cont.every((c, i) => sameStage(segs[i], c, rules))) return "customer";
      if (
        segs.length === cont.length + 2 &&
        cont.every((c, i) => sameStage(segs[i], c, rules)) &&
        segs[cont.length] === rules.finished_bucket.folder
      ) {
        return "finished";
      }
    }
    return null;
  })();

  // 2. Customer short names.
  if (isCustomerFolder === "customer") {
    const alias = aliasFor(name, rules);
    if (alias) applied.push("customer_alias");
    return { name: alias ?? name, applied };
  }
  if (isCustomerFolder === "finished") {
    const fb = rules.finished_bucket;
    const m = name.match(new RegExp(`^(.*?)(${escapeRe(fb.suffix)})?$`, "i"));
    let n = m[1];
    const alias = aliasFor(n, rules);
    if (alias) {
      n = alias;
      applied.push("customer_alias");
    }
    if (m[2] && fb.drop_suffix) applied.push("drop_finished_suffix");
    else if (m[2]) n += m[2];
    return { name: applied.length ? n : name, applied };
  }

  // 3. Explicit whole-name renames (step 4.3), allowed on `_` folders.
  if (rules.exact_folder_renames[name] !== undefined) {
    n = rules.exact_folder_renames[name];
    applied.push("exact_folder_rename");
  }

  const bucket = n.startsWith("_");
  const sku = looksLikeSku(n);

  // 4. Strip customer name / aliases / listed fluff from descendants.
  if (ctx.customer && !bucket && !sku) {
    const before = n;
    n = stripTerms(n, stripTermsFor(ctx.customer, rules));
    if (n !== before) applied.push("strip_customer");
  }

  // 4b. Any customer's full name left inside the name becomes its short name (SKU folders too).
  {
    const before = n;
    n = replaceCustomerNames(n, rules);
    if (n !== before) applied.push("customer_alias_in_name");
  }

  // 5. Repeated year under a year folder (O2, owner yes/no).
  // Owner 2026-11-13: any year already shown by a higher folder is dropped, also when
  // glued to a season code (FH2026 -> FH). Years inside dates (12.18.2023) are kept.
  if (stripYear && !bucket && !sku) {
    const before = n;
    const years = new Set(relParents.flatMap(standaloneYears));
    if (ctx.yearParent) years.add(ctx.yearParent);
    if (years.size) {
      n = stripTerms(n, [...years].filter((y) => standaloneYears(n).includes(y)));
      n = n.replace(/(?<![A-Za-z])(FH|FW|SS|SP|HO)((?:19|20)\d\d)(?![\d.\-\/,])/gi, (m, code, y) => (years.has(y) ? code : m));
      if (n !== before) n = tidy(n);
    }
    if (n !== before) applied.push("strip_year");
  }

  // 6. Phrase abbreviations and patterns (step 4.3), anywhere below root.
  if (!sku) {
    const before = n;
    n = applyPhrases(n, rules.phrase_abbreviations);
    if (n !== before) applied.push("phrase_abbreviation");
    const pat = applyPatterns(n, rules.pattern_rules);
    if (pat && pat.name !== n) {
      n = pat.name;
      applied.push(`pattern:${pat.id}`);
    }
  }

  if (applied.length === 0) return { name, applied };
  const tidied = tidy(n);
  // Preserve a leading underscore the original had (bucket marker).
  n = name.startsWith("_") && !tidied.startsWith("_") ? `_${tidied}` : tidied;
  if (n === name) return { name, applied: [] };
  return { name: n, applied };
}

/**
 * Plan renames for a full folder listing. dirs: array of paths relative to
 * the share, all under rules.root. Returns { renames, attention, map }.
 */
export function planRenames(dirs, rules, opts = {}) {
  const root = rules.root;
  const rel = dirs
    .filter((d) => d === root || d.startsWith(`${root}/`))
    .filter((d) => !d.split("/").some((s) => s === "@eaDir" || s === "#recycle" || s === "#snapshot"));
  const sorted = [...new Set(rel)].sort((a, b) => {
    const da = a.split("/").length;
    const db = b.split("/").length;
    return da - db || (a < b ? -1 : a > b ? 1 : 0);
  });
  const map = new Map([[root, root]]);
  const renames = [];
  const attention = [];
  // Group by parent so siblings can be checked for collisions.
  const byParent = new Map();
  for (const d of sorted) {
    if (d === root) continue;
    const parent = d.slice(0, d.lastIndexOf("/"));
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(d);
  }
  const parents = [...byParent.keys()].sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1));
  for (const parent of parents) {
    const newParent = map.get(parent) ?? parent;
    const relParents = parent === root ? [] : parent.slice(root.length + 1).split("/");
    const kids = byParent.get(parent);
    const proposals = kids.map((d) => {
      const name = d.slice(d.lastIndexOf("/") + 1);
      const p = proposeName(name, relParents, rules, opts);
      return { d, name, ...p };
    });
    // Validate each proposal.
    for (const p of proposals) {
      if (/[. ]$/.test(p.name)) {
        attention.push({ kind: "trailing_dot_or_space", old_path: p.d, proposed: p.name, note: "illegal on Windows" });
      }
      if (p.applied.length === 0) continue;
      const oldName = p.d.slice(p.d.lastIndexOf("/") + 1);
      if (
        p.name.replace(/^_/, "").trim().length < 3 && !(p.applied.length === 1 && p.applied[0] === "customer_alias") &&
        replaceCustomerNames(oldName, rules) !== oldName
      ) {
        p.name = replaceCustomerNames(oldName, rules);
        p.applied = ["customer_alias_in_name"];
      } else if (p.name.replace(/^_/, "").trim() === "") {
        attention.push({ kind: "would_be_empty", old_path: p.d, proposed: "", note: "kept old name" });
        p.name = p.d.slice(p.d.lastIndexOf("/") + 1);
        p.applied = [];
      } else if (p.name.replace(/^_/, "").length < 3 && !(p.applied.length === 1 && p.applied[0] === "customer_alias")) {
        attention.push({ kind: "fragment_under_3", old_path: p.d, proposed: p.name, note: "kept old name" });
        p.name = p.d.slice(p.d.lastIndexOf("/") + 1);
        p.applied = [];
      } else if (p.name.toLowerCase() === p.d.slice(p.d.lastIndexOf("/") + 1).toLowerCase()) {
        attention.push({ kind: "case_only", old_path: p.d, proposed: p.name, note: "kept old name" });
        p.name = p.d.slice(p.d.lastIndexOf("/") + 1);
        p.applied = [];
      }
    }
    // Collisions (case-insensitive, as Windows sees them). Never merged.
    const seen = new Map();
    for (const p of proposals) {
      const k = p.name.toLowerCase();
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(p);
    }
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const p of group) {
        if (p.applied.length === 0) continue;
        attention.push({
          kind: "collision",
          old_path: p.d,
          proposed: p.name,
          note: `same new name as: ${group.filter((g) => g !== p).map((g) => g.d.slice(g.d.lastIndexOf("/") + 1)).join(" | ")}; kept old name`,
        });
        p.name = p.d.slice(p.d.lastIndexOf("/") + 1);
        p.applied = [];
      }
    }
    for (const p of proposals) {
      const newPath = `${newParent}/${p.name}`;
      map.set(p.d, newPath);
      if (p.applied.length > 0) {
        renames.push({
          depth: p.d.split("/").length - root.split("/").length,
          old_path: p.d,
          new_path: newPath,
          rule: p.applied.join("+"),
          chars_saved: p.d.slice(p.d.lastIndexOf("/") + 1).length - p.name.length,
        });
      }
    }
  }
  return { renames, attention, map };
}

export function mapFile(file, map) {
  const dir = file.slice(0, file.lastIndexOf("/"));
  const nd = map.get(dir);
  return nd ? `${nd}${file.slice(dir.length)}` : file;
}
