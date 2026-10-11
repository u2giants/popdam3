import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const ps=readFileSync(new URL('../install-scheduled-task.ps1',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../../.github/workflows/publish-windows-agent.yml',import.meta.url),'utf8');
test('standalone fresh install retains existing interactive capability and no escrow timer',()=>{
 assert.match(ps,/New-ScheduledTaskTrigger -AtLogOn -User \$Username/);
 assert.match(ps,/-LogonType Interactive/);
 assert.doesNotMatch(ps,/New-LocalUser|ProtectedData|Fresh Install Recovery|AddMinutes\(10\)/);
});
test('manual and published installers preserve canonical task before destructive legacy setup',()=>{
 assert.ok(ps.indexOf('Canonical boot task preserved')<ps.indexOf('Unregister-ScheduledTask'));
 for(const flag of ['Password','Limited','MSFT_TaskBootTrigger','IgnoreNew','Convert-TaskDuration'])assert.ok(ps.includes(flag));
 assert.equal((workflow.match(/-File "\$PLUGINSDIR\\setup-task.ps1"/g)||[]).length,3);
 assert.ok(workflow.indexOf('-PreflightOnly')<workflow.indexOf('; ── Install program files'));
 assert.doesNotMatch(workflow.slice(0,workflow.indexOf('Section "Uninstall"')),/New-ScheduledTaskPrincipal|schtasks \/delete \/tn/);
});

test('pre-copy refuses running task/service/process and retains stopped legacy migration',()=>{
 assert.ok(ps.indexOf('Running installation must update')<ps.indexOf('if ($PreflightOnly)'));
 assert.match(ps,/legacyService.Status -ne 'Stopped'/);
 assert.match(ps,/runningNode.Count -gt 0/);
 assert.doesNotMatch(ps,/Stop-Service|Stop-ScheduledTask/);
 assert.match(ps,/nssm remove PopDAMWindowsAgent/);
});

test('silent preflight and managed uninstall stop before destructive operations',()=>{
 assert.match(workflow,/Managed startup preflight failed[^\n]*\/SD IDOK/);
 const uninstall=workflow.slice(workflow.indexOf('Section "Uninstall"'));
 assert.ok(uninstall.indexOf('-UninstallPreflight')<uninstall.indexOf('schtasks /end'));
 assert.match(ps,/if \(\$UninstallPreflight\)/);
 assert.match(ps,/XmlConvert\]::ToTimeSpan/);
 assert.match(ps,/TimeSpan\]::FromMinutes\(1\)/);
});
