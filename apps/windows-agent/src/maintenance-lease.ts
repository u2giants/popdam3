import { lstatSync, readFileSync, realpathSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
export interface Lease { nonce: string; expires_at: number; host: string }
export class ClaimAccounting {
  inFlight = 0;
  async claim<T>(action: () => Promise<T>, accept: (result: T) => void): Promise<T> {
    this.inFlight++;
    try { const result = await action(); accept(result); return result; }
    finally { this.inFlight--; }
  }
}
export function inspectMaintenanceLease(raw: string, now: number, activeJobs: number, inFlight: number, exclusiveWork: boolean): { pause: boolean; nonce?: string; idle?: boolean } {
  const request = JSON.parse(raw) as Lease;
  if (!/^[a-f0-9]{32}$/.test(request.nonce) || request.host !== 'EDGE-ALIEN' || typeof request.expires_at !== 'number' || request.expires_at > now + 300_000) throw new Error('Invalid maintenance lease');
  if (request.expires_at <= now) return { pause: false };
  return { pause: true, nonce: request.nonce, idle: activeJobs === 0 && inFlight === 0 && !exclusiveWork };
}
function trustedRequest(): string | null {
  const root = path.join(process.env.ProgramData || 'C:\\ProgramData', 'PopDAM-managed-controller');
  const file = path.join(root, 'maintenance-request.json');
  try { lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (process.platform !== 'win32' || lstatSync(root).isSymbolicLink() || lstatSync(file).isSymbolicLink() || realpathSync(root).toLowerCase() !== root.toLowerCase()) throw new Error('Untrusted lease path');
  const literal = root.replace(/'/g, "''");
  // Verify owner and WRITE authority; ordinary users may read the control path.
  const script = `foreach($path in @('${literal}','${literal}\\maintenance-request.json')){$a=Get-Acl -LiteralPath $path; $o=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; if($o -notin @('S-1-5-18','S-1-5-32-544')){exit 1}; $w=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership; foreach($e in $a.Access){$s=$e.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($e.AccessControlType -eq 'Allow' -and ($e.FileSystemRights -band $w) -ne 0 -and $s -notin @('S-1-5-18','S-1-5-32-544')){exit 1}}}; 'trusted'`;
  const verdict = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], { timeout: 5000, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
  if (verdict !== 'trusted') throw new Error('Untrusted lease owner or write ACL');
  return readFileSync(file, 'utf8');
}
export function maintenancePausesClaims(activeJobs: number, inFlight: number, exclusiveWork: boolean, acknowledge = true): boolean {
  try {
    const raw = trustedRequest(); if (raw === null) return false;
    const lease = inspectMaintenanceLease(raw, Date.now(), activeJobs, inFlight, exclusiveWork);
    if (acknowledge && lease.pause && lease.idle) {
      const root = path.join(process.env.ProgramData || 'C:\\ProgramData', 'PopDAM-managed-controller');
      try { writeFileSync(path.join(root,'receipts','maintenance-idle.new'),JSON.stringify({nonce:lease.nonce,host:'EDGE-ALIEN',process_id:process.pid,active_jobs:0,in_flight:0,idle:true,verified_at:Date.now()}));
      renameSync(path.join(root,'receipts','maintenance-idle.new'),path.join(root,'receipts','maintenance-idle.json')); } catch { /* No new receipt; valid pause expires normally. */ }
    }
    return lease.pause;
  } catch { return false; } // Invalid/untrusted administrative input cannot disable normal claiming.
}
