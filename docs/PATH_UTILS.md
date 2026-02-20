# PATH + NAS MAPPING RULES (Single Source of Truth)

This document defines the canonical path format stored in the database and the exact conversion/parsing rules used by:
- Web UI
- Bridge Agent (NAS Worker)
- Windows Render Agent (optional)

If any component implements its own ad-hoc path logic, it is a bug.

---

## 1) Canonical Stored Format (DB)
**Store ONLY a normalized relative path** from the NAS share root.

- Stored field name: `assets.relative_path`
- Format: POSIX style (forward slashes)
- No leading slash
- No trailing slash
- Collapse repeated separators
- Example: `Decor/Projects/Foo/bar.psd`

**Do NOT store hostname/IP as the canonical truth.**
Host/IP are display-time prefixes only.

---

## 2) Required Config Keys (Global)
These must exist in a single config source (admin_config or env) and be reused everywhere.

- `NAS_HOST` = hostname for UNC display (example: `edgesynology2`)
- `NAS_IP` = LAN IP for UNC-by-IP display (example: `192.168.3.100`)
- `NAS_SHARE` = share name (example: `mac`) — compare case-insensitively, normalize to lowercase
- `NAS_CONTAINER_MOUNT_ROOT` = mount root inside Bridge Agent container (example: `/mnt/nas/mac`)

Per-user (stored locally in browser):
- `USER_SYNC_ROOT` = local Synology Drive root folder path on that user’s machine  
  Example Windows: `C:\Users\Albert\SynologyDrive`  
  Example macOS: `/Users/albert/SynologyDrive`

---

## 3) Display Outputs (Must Produce Exact Copy/Paste Paths)

Given `relative_path = Decor/Projects/Foo/bar.psd`:

### 3.1 Office UNC (hostname)
`\\{NAS_HOST}\{NAS_SHARE}\Decor\Projects\Foo\bar.psd`

### 3.2 Office UNC (IP)
`\\{NAS_IP}\{NAS_SHARE}\Decor\Projects\Foo\bar.psd`

### 3.3 Remote (Synology Drive local path)
`{USER_SYNC_ROOT}\{NAS_SHARE}\Decor\Projects\Foo\bar.psd`

### 3.4 Container path (Bridge Agent internal)
`{NAS_CONTAINER_MOUNT_ROOT}/Decor/Projects/Foo/bar.psd`

Note:
- UI must show the three user-facing paths (UNC, IP UNC, Synology Drive).
- The container path is primarily for worker correctness and diagnostics.

---

## 4) Parsing Inputs (User Paste + Diagnostics “Path Tester”)
The system must accept pasted paths and normalize them into `relative_path`.

Supported inputs:

### 4.1 UNC path (hostname)
`\\edgesynology2\mac\Decor\Projects\Foo\bar.psd`

### 4.2 UNC path (IP)
`\\192.168.3.100\mac\Decor\Projects\Foo\bar.psd`

### 4.3 Container path
`/mnt/nas/mac/Decor/Projects/Foo/bar.psd`

### 4.4 Synology Drive local path (Windows example)
`C:\Users\Albert\SynologyDrive\mac\Decor\Projects\Foo\bar.psd`

### 4.5 Already-relative input
`Decor/Projects/Foo/bar.psd`

All parsing results must output:
- `relative_path` (normalized POSIX)
- A “valid/invalid + reason” status
- If valid, all conversions in Section 3

---

## 5) Share Matching and “Path Out of Scope”
`NAS_SHARE` matching is case-insensitive.

If a pasted path does not contain the configured `NAS_SHARE`:
- Return: **invalid**
- Error: **PATH_OUT_OF_SCOPE**
- Show a helpful message: “This path is not inside the configured NAS share ‘{NAS_SHARE}’.”

Do not silently “guess” or strip random segments.

---

## 6) Normalization Rules (Hard Requirements)
When producing or storing `relative_path`:
- Convert backslashes to forward slashes
- Collapse `//` to `/`
- Trim whitespace
- Remove any leading `/`
- Remove any trailing `/`
- Preserve internal folder name casing, but treat share matching case-insensitively
- Do not allow `..` path traversal segments in stored values
Prefix Literalism: Treat USER_SYNC_ROOT as a literal string. Never assume drive letters (e.g., C:).
- Separator Scrubbing: Always strip trailing slashes from both the prefix and the relative path before joining them.
---

## 7) Examples (Ground Truth)

### Example A
Input: `\\edgesynology2\mac\Decor\Foo\bar.psd`  
Output relative: `Decor/Foo/bar.psd`

### Example B
Input: `/mnt/nas/mac/Decor/Foo/bar.psd`  
Output relative: `Decor/Foo/bar.psd`

### Example C (Out of scope)
Input: `\\edgesynology2\WRONGSHARE\Decor\Foo\bar.psd`  
Output: invalid, PATH_OUT_OF_SCOPE

No Drive Letter Assumptions: When building the "Remote Synology Drive" path, treat the USER_SYNC_ROOT as a literal prefix. Do not assume C: or /Users/ exists.

Normalization: Always strip trailing slashes from both the prefix and the relative path before joining them to avoid // errors in the file path.