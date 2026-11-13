// Folder guard (u2giants/popdam3#963, plan Phase 6). Pure: no Node or Deno APIs.
// Given file paths (relative to the share root) and the frozen rules, report
// (a) folders whose name breaks the rules, with the suggested name, and
// (b) folders holding files whose path is over the target length.
// Never renames anything; renames go through the Phase 5 executor.
import { mapFile, planRenames } from "./core.mjs";

export function folderGuard(files, rules, { limit = 200 } = {}) {
  const max = rules.target_max_path;
  const root = rules.root;
  const inRoot = files.filter((f) => f.startsWith(`${root}/`));
  const dirs = new Set([root]);
  for (const f of inRoot) {
    let d = f.slice(0, f.lastIndexOf("/"));
    while (d.length > root.length && !dirs.has(d)) {
      dirs.add(d);
      d = d.slice(0, d.lastIndexOf("/"));
    }
  }
  const { renames, attention, map } = planRenames([...dirs], rules);
  const long = new Map();
  for (const f of inRoot) {
    if (f.length <= max) continue;
    const dir = f.slice(0, f.lastIndexOf("/"));
    const g = long.get(dir) ?? { folder: dir, files_over: 0, longest: 0, longest_after_rules: 0 };
    g.files_over += 1;
    g.longest = Math.max(g.longest, f.length);
    g.longest_after_rules = Math.max(g.longest_after_rules, mapFile(f, map).length);
    long.set(dir, g);
  }
  const overFolders = [...long.values()].map((g) => ({ ...g, suggested_path: map.get(g.folder) ?? g.folder }));
  overFolders.sort((a, b) => b.longest - a.longest || (a.folder < b.folder ? -1 : 1));
  renames.sort((a, b) => a.depth - b.depth || (a.old_path < b.old_path ? -1 : 1));
  return {
    target_max_path: max,
    files_checked: inRoot.length,
    folders_checked: dirs.size,
    files_over: overFolders.reduce((n, g) => n + g.files_over, 0),
    rule_breaking_total: renames.length,
    over_length_total: overFolders.length,
    attention_total: attention.length,
    rule_breaking: renames.slice(0, limit),
    over_length: overFolders.slice(0, limit),
    attention: attention.slice(0, limit),
  };
}
