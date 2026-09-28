# Delivery-audit evidence validation — September 27, 2026

Owner: [#3597](https://github.com/popcre/shared-db/issues/3597), non-orchestrator work. This repeatable validation checks the archived values with limited redactions and protects the audit's captured counts, route classes, owner markers, issue-to-PR provenance, dependency graph, check totals, cohort calculations, superseded heads and stage claims. It is superseded with the audit by a later workflow-refactor acceptance report; it makes no live database or production claim.

Run from the repository root with `python3` using the code block below. The recorded local result was `Audit snapshot, provenance, graph, routes and plan reconcile`. The command `node --test scripts/check-current-workflow-policy.test.mjs` passed 7/7 tests (0 failed), and `git diff --check` passed. The paths were classified as six lightweight prose documents by `classifyLightweightMergePaths`. A new capture needs updated expected counts; do not reinterpret this dated snapshot as current GitHub state.

```python
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
from statistics import median
from zoneinfo import ZoneInfo
import hashlib, json, re

root = Path('docs/verification')
report = (root / 'workflow-refactor-delivery-audit-20260928.md').read_text()
source = json.loads((root / 'workflow-refactor-source-inventory-20260928.md').read_text().split('```json\n', 1)[1].split('\n```', 1)[0])
runs = json.loads((root / 'workflow-refactor-run-snapshot-20260928.md').read_text().split('```json\n', 1)[1].split('\n```', 1)[0])
plan = Path('plan_shared_db_workflow_refactor.md').read_text()
raw_capture = (root / 'workflow-refactor-raw-capture-20260928.md').read_text()
original = {}
for name in ('open-issues', 'open-prs', 'closed-issues', 'merged-prs', 'runs'):
    section = raw_capture.split('## ' + name + '\n', 1)[1].split('\n## ', 1)[0]
    payload = section.split('```json\n', 1)[1].split('\n```', 1)[0] + '\n'
    assert hashlib.sha256(payload.encode()).hexdigest() == source['raw_query_sha256'][name]
    original[name] = json.loads(payload)
supplemental = {}
for name in ('pr-heads-supplemental', 'pr-discussion-complete'):
    heading = 'supplemental-pr-heads' if name == 'pr-heads-supplemental' else name
    section = raw_capture.split('## ' + heading + '\n', 1)[1].split('\n## ', 1)[0]
    payload = section.split('```json\n', 1)[1].split('\n```', 1)[0]
    assert hashlib.sha256(payload.encode()).hexdigest() == source['supplemental_query_sha256'][name]
    supplemental[name] = json.loads(payload)
issues = source['open_issues']
prs = source['open_pull_requests']
closed = source['closed_issues']
merged = source['merged_pull_requests']
assert tuple(map(len, (issues, prs, closed, merged, runs['runs']))) == (89, 28, 1651, 500, 100)
assert tuple(len(original[name]) for name in ('open-issues', 'open-prs', 'closed-issues', 'merged-prs', 'runs')) == (89, 28, 1651, 500, 100)
assert [x['number'] for x in original['open-issues']] == [x['number'] for x in issues]
assert [x['number'] for x in original['open-prs']] == [x['number'] for x in prs]
assert [x['number'] for x in original['closed-issues']] == [x['number'] for x in closed]
assert [x['number'] for x in original['merged-prs']] == [x['number'] for x in merged]
assert [x['databaseId'] for x in original['runs']] == [x['databaseId'] for x in runs['runs']]
assert all(raw['headRefOid'] == pr['headRefOid'] for raw, pr in zip(original['open-prs'], prs))
for raw, saved in zip(original['open-issues'], issues):
    assert all(raw[key] == saved[key] for key in ('number', 'url', 'title', 'createdAt', 'updatedAt'))
    assert hashlib.sha256((raw['body'] or '').encode()).hexdigest() == saved['body_sha256']
    assert (raw['body'] or '') == saved['source_body']
    assert [label['name'] for label in raw['labels']] == saved['labels']
    assert [user['login'] for user in raw['assignees']] == saved['assignees']
    assert len(raw['comments']) == saved['comments_count'] == len(saved['source_comments'])
    assert all(all(left[key] == right[key] for key in ('id', 'body', 'createdAt', 'url')) for left, right in zip(raw['comments'], saved['source_comments']))
for raw, saved in zip(original['open-prs'], prs):
    assert all(raw[key] == saved[key] for key in ('number', 'url', 'title', 'createdAt', 'updatedAt', 'headRefOid', 'mergeStateStatus'))
    assert raw['author']['login'] == saved['author']
    assert (raw['body'] or '') == saved['source_body']
    assert hashlib.sha256((raw['body'] or '').encode()).hexdigest() == saved['body_sha256']
    assert [item['path'] for item in raw['files']] == saved['files']
    assert len(raw['statusCheckRollup']) == len(saved['checks'])
    assert all(all(check.get(key) == derived.get(key) for key in check) for check, derived in zip(raw['statusCheckRollup'], saved['checks']))
for raw, saved in zip(original['closed-issues'], closed):
    assert all(raw[key] == saved[key] for key in ('number', 'title', 'createdAt', 'closedAt'))
    assert (raw['body'] or '') == saved['source_body']
    assert hashlib.sha256((raw['body'] or '').encode()).hexdigest() == saved['body_sha256']
for raw, saved in zip(original['merged-prs'], merged):
    assert all(raw[key] == saved[key] for key in ('number', 'title', 'headRefOid', 'mergedAt'))
    assert (raw['body'] or '') == saved['source_body']
for raw, saved in zip(original['runs'], runs['runs']):
    assert all(raw[key] == saved[key] for key in saved)
run_counts = Counter((run['conclusion'] or run['status']) for run in runs['runs'])
assert run_counts == {'success':71, 'queued':17, 'in_progress':7, 'failure':3, 'cancelled':2}
assert '71 success, 17 queued, 7 in_progress, 3 failure, 2 cancelled' in report
terminal_non_success = [run for run in runs['runs'] if run['conclusion'] in {'failure', 'cancelled'}]
assert len(terminal_non_success) == 5
assert all(run['url'] in report and run['workflowName'] in report for run in terminal_non_success)
open_ids = {i['number'] for i in issues}
closed_ids = {i['number'] for i in closed}
assert not open_ids & closed_ids

issue_table = report.split('## Every open issue', 1)[1].split('## Every open pull request', 1)[0]
rows = {}
for line in issue_table.splitlines():
    match = re.match(r'^\| \[#(\d+)\]', line)
    if match:
        rows[int(match.group(1))] = line.split(' | ')
assert set(rows) == open_ids
assert len(re.findall(r'^\| \[#\d+\]\(https://github.com/popcre/shared-db/pull/', report.split('## Every open pull request', 1)[1].split('## Comparable completed-issue cohorts', 1)[0], re.M)) == 28
pr_table = report.split('## Every open pull request', 1)[1].split('## Comparable completed-issue cohorts', 1)[0]
pr_rows = {int(m.group(1)): m.group(2).split(' | ') for m in re.finditer(r'^\| \[#(\d+)\][^\n]*? \| ([^\n]+) \|$', pr_table, re.M)}
assert set(pr_rows) == {p['number'] for p in prs}

def check_counts(pr):
    failed = pending = unknown = 0
    for check in pr['checks']:
        state = check.get('state')
        conclusion = check.get('conclusion')
        status = check.get('status')
        if conclusion in {'FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'} or state in {'FAILURE', 'ERROR'}:
            failed += 1
        elif status in {'QUEUED', 'IN_PROGRESS', 'PENDING', 'REQUESTED', 'WAITING'} or state in {'PENDING', 'EXPECTED'} or (status and status != 'COMPLETED'):
            pending += 1
        elif conclusion not in {'SUCCESS', 'SKIPPED', 'NEUTRAL'} and state not in {'SUCCESS'}:
            unknown += 1
    return failed, pending, unknown

for pr in prs:
    failed, pending, unknown = check_counts(pr)
    row = pr_rows[pr['number']]
    if pr['head_recheck']['state'] != 'MERGED':
        assert f'{failed} failed, {pending} nonterminal, {unknown} unknown reported checks' in row[2], pr['number']
    moved = pr['head_recheck']['headRefOid'] != pr['headRefOid']
    raw_head = supplemental['pr-heads-supplemental'][str(pr['number'])]
    assert all(pr['head_recheck'][key] == raw_head[key] for key in ('headRefOid', 'state', 'updatedAt', 'mergeStateStatus'))
    if moved:
        assert f'captured head {pr["headRefOid"][:8]} superseded by {pr["head_recheck"]["headRefOid"][:8]}' in row[2]
        if pr['head_recheck']['state'] == 'MERGED':
            assert 'merged by supplemental state check' in row[2]
        else:
            assert pr['head_recheck']['state'] == 'OPEN' and 'current checks unverified' in row[2]
    else:
        assert row[2].startswith('open;')
    linked = sorted(set(pr['title_issue_refs']) | {m['issue'] for m in pr['body_issue_markers']})
    issue_index = {i['number']: i for i in issues + closed}
    types = sorted(set((issue_index[n]['work_type_claim'] or 'unclassified') for n in linked if n in issue_index)) or ['unclassified']
    assert types == pr['linked_issue_work_types'] and row[0] == '/'.join(types)
    live_holders = [n for n in linked if n in open_ids and issue_index[n]['owner_disposition'] in {'current_user_directed', 'declared_holder_current_acceptance_unverified'}]
    assert pr['accountable_holder_from_issue'] == (live_holders[0] if len(live_holders) == 1 else None)
    discussion = pr['discussion']
    raw_discussion = supplemental['pr-discussion-complete'][str(pr['number'])]
    assert all(discussion[kind]['total_count'] == raw_discussion[kind]['total_count'] for kind in discussion)
    for kind in discussion:
        assert raw_discussion[kind]['page_count'] == discussion[kind]['page_count']
        for saved, raw in zip(discussion[kind]['records'], raw_discussion[kind]['records']):
            assert saved['id'] == raw['id'] and saved['body'] == (raw.get('body') or '')
            assert saved['createdAt'] == (raw.get('created_at') or raw.get('submitted_at'))
            assert saved['author'] == (raw['user']['login'] if raw.get('user') else None)
    assert set(discussion) == {'issue_comments', 'reviews', 'review_comments'}
    assert all(v['per_page'] == 100 and v['page_count'] == 1 and v['total_count'] == len(v['records']) < 100 and v['last_page_count'] == len(v['records']) for v in discussion.values())
    comments = [c for stream in discussion.values() for c in stream['records'] if c['author'] not in {'blacksmith-sh', 'blacksmith-sh[bot]', 'github-actions[bot]'} and not c['body'].lstrip().startswith(('<!-- ai-blocker-watch:', '<!-- issue-orch-label-sync:', 'Work contract published', 'stale-place-nudge:')) and c['createdAt']]
    latest = max(comments, key=lambda c: c['createdAt']) if comments else None
    saved = pr['last_substantive_comment']
    assert bool(latest) == bool(saved)
    if latest:
        assert (latest['id'], latest['createdAt'], latest['url']) == (saved['id'], saved['createdAt'], saved['url'])
        shown = datetime.fromisoformat(latest['createdAt'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York')).strftime('%Y-%m-%d %I:%M %p %Z')
        assert row[3] == shown, (pr['number'], row[3], shown)
    else:
        assert row[3] == 'none verified'
    assert row[1].startswith('issue #' + str(pr['accountable_holder_from_issue'])) if pr['accountable_holder_from_issue'] else row[1] == 'unverified'
    action = row[5]
    if moved and pr['head_recheck']['state'] == 'MERGED': assert action.startswith('verify linked issue acceptance')
    elif moved: assert action.startswith('refresh exact head and checks')
    elif failed: assert action.startswith('resolve named failed checks')
    elif pending: assert action.startswith('wait for nonterminal checks')
    else: assert action.startswith('verify exact-head approval')

def route_class(work_type, route):
    if route == 'owner-only': return 'owner-only decision'
    if work_type == 'curated-master-data': return 'curated Master Data'
    if work_type == 'coordination': return 'coordination'
    if route == 'self-service-additive': return 'self-service additive'
    return {'structural':'structural', 'repo-maintenance':'repo maintenance',
            'documentation':'documentation', 'security-settings':'owner-only settings'}.get(work_type, 'unclassified')

classes = Counter(route_class(i['work_type_claim'], i['route_claim']) for i in issues)
assert classes == {'structural':34, 'repo maintenance':30, 'unclassified':15,
                   'curated Master Data':6, 'owner-only decision':2,
                   'coordination':1, 'documentation':1}
all_prs = prs + merged
for issue in issues:
    number = issue['number']
    row = rows[number]
    assert issue['related_target_prs_from_title'] == [int(n) for n in re.findall(r'\bPR\s*#(\d+)\b', issue['title'], re.I) if int(n) in {p['number'] for p in all_prs}]
    if number in {3594, 3585}:
        target = {3594:3515, 3585:3521}[number]
        assert target in issue['related_target_prs_from_title'] and next(p for p in prs if p['number'] == target)['head_recheck']['state'] == 'MERGED'
        assert f'target PR #{target} merged after capture, repair acceptance unverified' in row[3]
    body = issue['source_body']
    assert hashlib.sha256(body.encode()).hexdigest() == issue['body_sha256']
    assert len(issue['source_comments']) == issue['comments_count']
    comments = [c for c in issue['source_comments'] if c.get('author', {}).get('login') not in {'github-actions[bot]', 'app/ai-blocker-watch'} and not (c['body'] or '').lstrip().startswith(('Work contract published', '<!-- ai-blocker-watch:', '<!-- issue-orch-label-sync:'))]
    latest = comments[-1] if comments else None
    saved = issue['last_non_contract_comment']
    assert bool(latest) == bool(saved)
    if latest:
        assert latest['id'] == saved['id'] and latest['createdAt'] == saved['createdAt']
        assert hashlib.sha256((latest['body'] or '').encode()).hexdigest() == saved['body_sha256']
    activity_time = latest['createdAt'] if latest else issue['createdAt']
    shown_activity = datetime.fromisoformat(activity_time.replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York')).strftime('%Y-%m-%d %I:%M %p %Z')
    assert row[4] == shown_activity, number
    for field, value in [('work_type', issue['work_type_claim']), ('route', issue['route_claim']), ('depends_on', issue['depends_on_claim'])]:
        match = re.search(r'^[ \t]*' + field + r'[ \t]*:[ \t]*(.*?)[ \t]*$', body, re.I | re.M)
        assert ((match.group(1).strip() or None) if match else None) == (value or None), (number, field)
    assert row[1] == issue['route_classification'] == route_class(issue['work_type_claim'], issue['route_claim'])
    shown_owner = row[2]
    markers = issue['owner_markers_outside_fences']
    unfenced, inside = [], False
    for line in body.splitlines():
        if line.lstrip().startswith('```'):
            inside = not inside
        elif not inside and re.match(r'^\s*owner\s*:', line, re.I):
            unfenced.append(line)
    assert [m['line'] for m in markers] == unfenced
    assert all(hashlib.sha256(m['line'].encode()).hexdigest() == m['line_sha256'] for m in markers)
    assert all(re.match(r'^\s*owner\s*:', m['line'], re.I) and m['value'] == m['line'].split(':',1)[1].strip() for m in markers)
    disposition = issue['owner_disposition']
    if shown_owner.startswith('unowned'):
        assert disposition in {'no_marker','future_successor_not_started','overlong_ambiguous',
                               'watcher_not_task_owner','signature_not_owner','outgoing_owner','stale_marker'}
        if disposition == 'no_marker': assert not markers and not issue['assignees']
        if disposition == 'stale_marker':
            assert any(int(n) in closed_ids for m in markers for n in re.findall(r'current marker #(\d+)|marker #(\d+)', m['value']) for n in n if n)
        if disposition == 'watcher_not_task_owner': assert any(m['value'].startswith('ai-blocker-watch') for m in markers)
        if disposition == 'signature_not_owner': assert any(m['value'].startswith('Posted by') for m in markers)
        if disposition == 'future_successor_not_started': assert any('assignment is pending' in m['value'] for m in markers)
        if disposition == 'outgoing_owner': assert any('outgoing' in m['value'] for m in markers)
        if disposition == 'overlong_ambiguous': assert any(len(m['value']) > 110 for m in markers)
    elif number == 3597:
        assert disposition == 'current_user_directed'
        assert '01a0e5e6-efa9-7b02-b51c-315859d606ca' in issue['current_owner_override']
        assert '01a0e5e6-efa9-7b02-b51c-315859d606ca' in shown_owner
    else:
        assert disposition == 'declared_holder_current_acceptance_unverified'
        assert shown_owner in {m['value'] for m in markers} or shown_owner in issue['assignees']
        assert not any(int(n) in closed_ids for m in markers for n in re.findall(r'marker #(\d+)', m['value'], re.I))
    shown_links = re.findall(r'#\d+', row[6])
    derived_links = [p['number'] for p in all_prs if number in p['title_issue_refs'] or
                     any(m['issue'] == number for m in p['body_issue_markers'])]
    saved_links = [link['pr'] for link in issue['candidate_pr_links']]
    assert shown_links == ['#' + str(n) for n in derived_links] and derived_links == saved_links, number
    for link in issue['candidate_pr_links']:
        pr = next((p for p in prs if p['number'] == link['pr']), None)
        if pr:
            failed, pending, unknown = check_counts(pr)
            if pr['head_recheck']['headRefOid'] != pr['headRefOid']:
                if pr['head_recheck']['state'] == 'MERGED':
                    assert f'#{pr["number"]} (merged after capture; live acceptance unverified)' in row[3]
                else:
                    assert f'#{pr["number"]} (captured head superseded; current checks unverified)' in row[3]
            else:
                assert f'#{pr["number"]} ({failed} failed, {pending} nonterminal, {unknown} unknown checks)' in row[3]
assert sum(rows[n][2].startswith('unowned') for n in rows) == 74

for p in all_prs:
    assert p['title_issue_refs'] == [int(n) for n in re.findall(r'(?<!\w)#(\d{3,5})\b', p['title'])]
    assert all(m['marker'] in p['source_body'] and int(re.search(r'\d{3,5}', m['marker']).group()) == m['issue'] for m in p['body_issue_markers'])
    for issue in issues:
        n = issue['number']
        pattern = re.compile(r'(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|work_issue\s*[:=]|issue\s*[:=])\s*[#" ]*' + str(n) + r'\b')
        assert (n in p['title_issue_refs'] or bool(pattern.search(p['source_body']))) == (any(link['pr'] == p['number'] for link in issue['candidate_pr_links'])), (p['number'], n)
for issue in closed:
    assert hashlib.sha256(issue['source_body'].encode()).hexdigest() == issue['body_sha256']
    match = re.search(r'^[ \t]*work_type[ \t]*:[ \t]*(.*?)[ \t]*$', issue['source_body'], re.I | re.M)
    assert (match.group(1).strip() if match else None) == issue['work_type_claim'], issue['number']
for issue in source['selected_closed_issue_details']:
    n = issue['number']
    assert [link['pr'] for link in issue['candidate_pr_links']] == [p['number'] for p in all_prs if n in p['title_issue_refs'] or any(m['issue'] == n for m in p['body_issue_markers'])], n
for issue in issues:
    claimed = issue['depends_on_claim'] or ''
    parsed = [int(n) for n in re.findall(r'(?<!\d)\d{3,5}(?!\d)', claimed)]
    assert parsed == issue['declared_dependency_issues']
edges = [(i['number'], n) for i in issues for n in i['declared_dependency_issues']]
assert len(edges) == 55 and len({a for a, _ in edges}) == 28
assert sum(b in open_ids for _, b in edges) == 14
assert sum(b in closed_ids for _, b in edges) == 41
assert all(b in open_ids | closed_ids for _, b in edges)
graph_section = report.split('## Explicit dependency edges in open issues', 1)[1].split('## Causal timelines and limits', 1)[0]
shown_edges = []
for line in graph_section.splitlines():
    match = re.match(r'^\| \[#(\d+)\]', line)
    if match:
        shown_edges.extend((int(match.group(1)), int(n)) for n in re.findall(r'\[#(\d+)\]', line)[1:])
assert sorted(shown_edges) == sorted(edges)
graph = defaultdict(list)
for a, b in edges:
    if b in open_ids: graph[a].append(b)
seen, active = set(), set()
def visit(node):
    assert node not in active, 'cycle in declared open graph'
    if node in seen: return
    active.add(node)
    for child in graph[node]: visit(child)
    active.remove(node)
    seen.add(node)
for node in list(graph): visit(node)

for heading, work_type, expected_median, expected_p90 in [
    ('structural', 'structural', 0.6, 3.1),
    ('non-orchestrator maintenance', 'repo-maintenance', 0.1, 0.7),
]:
    section = report.split('### ' + heading + ':', 1)[1].split('\n### ', 1)[0].split('\n## ', 1)[0]
    shown = [int(n) for n in re.findall(r'^\| \[#(\d+)\]\(https://github.com/popcre/shared-db/issues/', section, re.M)]
    selected = [q for q in source['selected_closed_issue_details'] if q['work_type_claim'] == work_type][:20]
    open_outcomes = {(q['title'], q['body_sha256']) for q in issues}
    eligible = [q for q in closed if q['work_type_claim'] == work_type and not re.search(r'^(?:HANDOVER|HANDOFF|CLAIM|BLOCKER|DECISION)\s*:', q['title'], re.I) and (q['title'], q['body_sha256']) not in open_outcomes][:20]
    assert [q['number'] for q in selected] == [q['number'] for q in eligible]
    assert shown == [q['number'] for q in selected]
    intervals = [(datetime.fromisoformat(q['closedAt'].replace('Z', '+00:00')) - datetime.fromisoformat(q['createdAt'].replace('Z', '+00:00'))).total_seconds()/86400 for q in selected]
    assert round(median(intervals), 1) == expected_median
    assert round(sorted(intervals)[int(.9 * (len(intervals)-1))], 1) == expected_p90
    assert f'median {expected_median:.1f} days, p90 {expected_p90:.1f} days' in report
    for q in selected:
        line = next(line for line in section.splitlines() if line.startswith(f'| [#{q["number"]}]('))
        assert [int(n) for n in re.findall(r'https://github.com/popcre/shared-db/pull/(\d+)', line)] == [link['pr'] for link in q['candidate_pr_links'] if link['state_at_capture'] == 'MERGED']

assert all(re.fullmatch(r'[0-9a-f]{40}', p['headRefOid']) for p in prs)
assert all(c.get('detailsUrl') for p in prs for c in p['checks'] if c.get('conclusion') == 'FAILURE')
failed_checks = Counter(c['name'] for p in prs for c in p['checks'] if c.get('conclusion') == 'FAILURE')
assert (failed_checks['Agent work contract'], failed_checks['Cross-PR object collision'], failed_checks['Migration author lease']) == (6, 9, 4)
assert 'six PRs in the initial snapshot report this check failed' in report
assert 'nine and four PRs in the initial snapshot report failures respectively' in report
assert len(re.findall(r'^\| (?:Curated Master Data|Self-service additive schema|Documents only|Application return|Security settings|Ordinary structural|Repository maintenance) \|', report, re.M)) == 7
status_rows = re.findall(r'^\| (\d{1,2}) \| [^\n]*? \| (Complete|Partial|Open|Ready) \|', plan, re.M)
assert {int(n): status for n, status in status_rows} == {
    0:'Partial',1:'Partial',2:'Partial',3:'Partial',4:'Partial',5:'Partial',
    6:'Partial',7:'Partial',8:'Partial',9:'Open',10:'Open',11:'Partial',
    12:'Partial',13:'Partial',14:'Partial'}
stages = {q['number']: q.get('stage_evidence_comments') for q in source['selected_closed_issue_details']}
assert any(all(v[k] == expected for k, expected in {'id':'IC_kwDOTAehpM8AAAABVsIu9A',
                 'createdAt':'2026-09-20T14:50:45Z',
                 'url':'https://github.com/popcre/shared-db/issues/2794#issuecomment-5750533876',
                 'stage':'live_verified',
                 'body_sha256':'5f344078b1a7291668e5898763bf071eb381472a2d375f5a44e7350c96e6c8d5'}.items()) and hashlib.sha256(v['source_body'].encode()).hexdigest() == v['body_sha256'] and json.loads(v['source_body'].split('```db-work-completion\n',1)[1].split('\n```',1)[0])['outcome'] == 'live_verified' for v in stages[2794])
assert any(all(v[k] == expected for k, expected in {'id':'IC_kwDOTAehpM8AAAABT5kqWw',
                 'createdAt':'2026-09-11T06:26:32Z',
                 'url':'https://github.com/popcre/shared-db/issues/2419#issuecomment-5630405211',
                 'stage':'preview_ready',
                 'body_sha256':'44d2095530f18f6dacfaa54e715dfff80878a86bb6d76b82167bf3cd28144ffd'}.items()) and hashlib.sha256(v['source_body'].encode()).hexdigest() == v['body_sha256'] and json.loads(v['source_body'].split('```db-coordination-event\n',1)[1].split('\n```',1)[0])['event_type'] == 'preview_ready' for v in stages[2419])
print('Audit snapshot, provenance, graph, routes and plan reconcile')
```
