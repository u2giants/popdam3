import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {BROWSER_PACKAGE,openQualifiedBlankBrowser,fixedBrowserEnvironment} from './rls-browser-custody.mjs';

export const ORIGIN = 'https://dam.designflow.app';
export const HOST = 'qsllyeztdwjgirsysgai.supabase.co';
const GET_ORIGINS = new Set([ORIGIN, `https://${HOST}`, 'https://popdam.nyc3.digitaloceanspaces.com']);
const FACETS = new Set(['get_filter_counts', 'get_path_facets', 'get_dam_material_facets', 'get_dam_customer_facets']);
export function browserEnvironment(env) {
  if(env.POPDAM_PLAYWRIGHT_PACKAGE!==BROWSER_PACKAGE)throw new Error('fixed browser package required');
  return fixedBrowserEnvironment();
}
export function permittedRequest({ url, method, body }) {
  const u = new URL(url), verb = method.toUpperCase();
  // The app's exact src/index.css font import; no Google auth or arbitrary API.
  if (u.origin === 'https://fonts.googleapis.com') return verb === 'GET' && u.pathname === '/css2' && !u.username && !u.password;
  if (u.origin === 'https://fonts.gstatic.com') return verb === 'GET' && u.pathname.startsWith('/s/') && !u.username && !u.password;
  if (u.protocol !== 'https:' || u.username || u.password || !GET_ORIGINS.has(u.origin)) return false;
  if (u.hostname === HOST && verb === 'OPTIONS' && u.pathname === '/functions/v1/admin-api' && u.search === '') return true;
  if (['GET', 'HEAD', 'OPTIONS'].includes(verb)) {
    if (u.origin === ORIGIN) return !u.pathname.startsWith('/auth/');
    if (u.hostname === HOST) return u.pathname === '/auth/v1/user' || u.pathname.startsWith('/rest/v1/') || u.pathname.startsWith('/storage/v1/object/public/');
    return u.pathname.startsWith('/thumbnails/');
  }
  if (u.hostname !== HOST) return false;
  if (verb === 'POST' && u.pathname === '/auth/v1/token') return u.search === '?grant_type=password';
  if (verb === 'POST' && u.pathname === '/auth/v1/logout') return u.search === '' || u.search === '?scope=global';
  // Existing default library filter lookup is a read-only edge handler. Never
  // allow another admin action, extra body field or a selected-licensor variant.
  if (verb === 'POST' && u.pathname === '/functions/v1/admin-api' && u.search === '') {
    return Boolean(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && body.action === 'get-filter-options');
  }
  const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(u.pathname);
  return Boolean(verb === 'POST' && rpc && FACETS.has(rpc[1]));
}

export function diagnosticRoute(raw) {
  const u = new URL(raw);
  if (u.origin === ORIGIN) return ['/', '/login', '/library'].includes(u.pathname) ? 'app-page' : 'app-static';
  if (u.hostname === HOST) {
    if (u.pathname === '/auth/v1/token') return 'password-auth';
    if (u.pathname === '/auth/v1/logout') return 'logout';
    if (u.pathname === '/rest/v1/style_groups') return 'library';
    if (u.pathname.startsWith('/rest/v1/rpc/')) return 'facets';
    if (u.pathname === '/functions/v1/admin-api') return 'filter-options';
    return 'supabase-read';
  }
  return 'static-other';
}
export function errorClass(error) {
  return ['Error','TypeError','ReferenceError','SyntaxError','RangeError','URIError','EvalError'].includes(error?.name) ? error.name : 'OtherError';
}
export function incrementStatus(counts, raw, status) {
  if (!Number.isInteger(status) || status < 100 || status > 599) return;
  const key = `${diagnosticRoute(raw)}:${status}`;
  counts[key] = Math.min(10000, (counts[key] || 0) + 1);
}
export function requireReadonlyDiagnosticEnvironment(env) {
  if (env.PROD_DB_PASSWORD || env.DATABASE_URL || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ACCESS_TOKEN || Object.keys(env).some(k => /(?:DB_PASSWORD|SERVICE_ROLE)/.test(k) && env[k])) throw new Error('readonly diagnostic forbids database credentials');
}

export async function run(env = process.env, fixture = null) {
  if (env.POPDAM_ACCEPTANCE_BASE_URL !== ORIGIN || env.SUPABASE_PROJECT_ID !== HOST.split('.')[0]) throw new Error('target');
  if (env.POPDAM_TEST_USER !== 'ai-admin@designflow.app' || !env.POPDAM_TEST_PASSWORD) throw new Error('existing dedicated identity');
  if (!/^[a-f0-9]{40}$/.test(env.DEPLOYED_FRONTEND_SHA || '')) throw new Error('build binding');
  if (!isAbsolute(env.POPDAM_PLAYWRIGHT_PACKAGE || '') || !isAbsolute(env.POPDAM_PROOF_FILE || '')) throw new Error('private paths');
  browserEnvironment(env);
  const report = { schema_version: 1, issue: 4427, passed: false, target: ORIGIN, project: HOST.split('.')[0],
    deployed_frontend_sha: env.DEPLOYED_FRONTEND_SHA, password_login: false, library_read: false,
    library_reloaded: false, library_rendered: false, logout: false, context_closed: false, browser_closed: false, blocked_requests: 0, blocked_hostnames: [], diagnostics: {stage: 'private-output', failed_stage: null, page_error_classes: {}, header_count: null, header_commit_match: false, public_commit_match: false, http_status_counts: {}} };
  const diagnostic = report.diagnostics;
  let browser, context, page, output;
  const reads = new Set();
  let tokenCalls = 0, logoutCalls = 0, tokenIssued = false;
  try {
    const directory = dirname(env.POPDAM_PROOF_FILE);
    await mkdir(directory, {recursive: true, mode: 0o700});
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || await realpath(directory) !== directory || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('private directory');
    output = await open(env.POPDAM_PROOF_FILE, 'wx', 0o600);
    diagnostic.stage = 'local-browser';
    const local = await openQualifiedBlankBrowser(process.env);
    browser=local.browser;context=local.context;page=local.page;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      let body;
      if (url.hostname === HOST && url.pathname === '/functions/v1/admin-api' && request.method() === 'POST') {
        try { body = request.postDataJSON(); } catch { /* malformed is refused */ }
      }
      let allowed = permittedRequest({url: request.url(), method: request.method(), body});
      if (fixture && url.hostname === HOST && request.method() === 'PATCH' && url.pathname === '/rest/v1/style_groups') {
        try { allowed = fixture.permitPatch(url, request.postDataJSON()); } catch { allowed = false; }
      }
      if (url.hostname === HOST && request.method() === 'POST' && url.pathname === '/auth/v1/token') allowed &&= ++tokenCalls === 1;
      if (url.hostname === HOST && request.method() === 'POST' && url.pathname === '/auth/v1/logout') allowed &&= ++logoutCalls === 1;
      if (!allowed) {
        report.blocked_requests++;
        if (/^[a-z0-9.-]{1,253}$/.test(url.hostname) && !report.blocked_hostnames.includes(url.hostname) && report.blocked_hostnames.length < 10) report.blocked_hostnames.push(url.hostname);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    page.on('pageerror', error => { const name = errorClass(error); diagnostic.page_error_classes[name] = Math.min(10000, (diagnostic.page_error_classes[name] || 0) + 1); });
    await local.releaseProbeGuard();
    // SDK authentication, PG checks and fixture INSERT start only after the
    // fixed local browser/context/DOM capability succeeded and guards exist.
    diagnostic.stage = 'fixture-prepare';
    if (fixture) await fixture.prepare();
    page.on('response', response => {
      incrementStatus(diagnostic.http_status_counts, response.url(), response.status());
      const u = new URL(response.url());
      if (u.hostname !== HOST) return;
      if (u.pathname === '/auth/v1/token' && response.status() === 200) tokenIssued = true;
      if (u.pathname === '/auth/v1/logout' && response.status() >= 200 && response.status() < 300) report.logout = true;
      if (response.request().method() === 'GET' && response.status() === 200 && u.pathname === '/rest/v1/style_groups') reads.add(response);
    });
    diagnostic.stage = 'login-page';
    await page.goto(`${ORIGIN}/login`, {waitUntil: 'domcontentloaded'});
    diagnostic.stage = 'login-form';
    await page.locator('input[type="email"]').fill(env.POPDAM_TEST_USER);
    await page.locator('input[type="password"]').fill(env.POPDAM_TEST_PASSWORD);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    diagnostic.stage = 'login-navigation';
    await page.waitForURL(`${ORIGIN}/library`, {timeout: 30000});
    report.password_login = true;
    diagnostic.stage = 'header-build';
    await page.waitForFunction(sha => [...document.querySelectorAll('header span.font-mono')].some(e => {
      const token = e.textContent?.trim().split(/\s+/)[0];
      return /^[a-f0-9]{7,40}$/.test(token || '') && sha.startsWith(token);
    }), env.DEPLOYED_FRONTEND_SHA, {timeout: 20000});
    diagnostic.stage = 'database-banner';
    if (await page.getByText(/Connected to a non-production database/).count()) throw new Error('database banner');
    diagnostic.stage = 'library-read';
    // Retain no response bodies, rows, URLs with identifiers, screenshots or cookies.
    await page.waitForResponse(r => reads.has(r), {timeout: 20000}).catch(() => {
      if (!reads.size) throw new Error('library read');
    });
    report.library_read = reads.size > 0;
    diagnostic.stage = 'library-body';
    const response = [...reads].at(-1);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || typeof rows[0].sku !== 'string' || !rows[0].sku) throw new Error('bounded nonempty library');
    diagnostic.stage = 'library-render';
    await page.getByText(rows[0].sku, {exact: true}).first().waitFor({state: 'visible', timeout: 15000});
    report.library_rendered = true;
    const before = reads.size;
    diagnostic.stage = 'library-reload';
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForResponse(r => reads.has(r), {timeout: 20000}).catch(() => {
      if (reads.size <= before) throw new Error('library reload');
    });
    report.library_reloaded = reads.size > before;
    diagnostic.stage = 'fixture-exercise';
    if (fixture) await fixture.exercise(page);
    diagnostic.stage = 'complete';
  } catch { diagnostic.failed_stage = diagnostic.stage; /* No raw error is emitted. */ }
  finally {
    if (page) {
      try {
        const facts = await page.evaluate(sha => {
          const elements = [...document.querySelectorAll('header span.font-mono')];
          const matches = e => { const token = e.textContent?.trim().split(/\s+/)[0]; return /^[a-f0-9]{7,40}$/.test(token || '') && sha.startsWith(token); };
          return {header_count: elements.length, header_commit_match: elements.some(matches), public_commit_match: [...document.querySelectorAll('span.font-mono')].some(matches)};
        }, env.DEPLOYED_FRONTEND_SHA);
        Object.assign(diagnostic, facts);
      } catch { /* Closed/unavailable DOM retains unknown header count. */ }
    }
    if (fixture) {
      try { await fixture.cleanup(); } catch { /* preserve pending fixture truth */ }
      report.fixture = fixture.summary();
    }
    if (page && tokenIssued) {
      try {
        const userMenu = page.locator('header button.rounded-full[aria-haspopup="menu"]');
        if (await userMenu.count() !== 1) throw new Error('ambiguous user menu');
        await userMenu.click();
        await page.getByRole('menuitem', {name: 'Sign out', exact: true}).click();
        await page.waitForURL(`${ORIGIN}/login`, {timeout: 15000});
      } catch { report.logout = false; diagnostic.failed_stage ||= 'logout'; }
    }
    if (context) { try { await context.close(); report.context_closed = true; } catch { diagnostic.failed_stage ||= 'context-close'; } }
    if (browser) { try { await browser.close(); report.browser_closed = true; } catch { diagnostic.failed_stage ||= 'browser-close'; } }
    report.passed = report.password_login && report.library_read && report.library_rendered && report.library_reloaded && report.logout && report.context_closed && report.browser_closed && report.blocked_requests === 0 && (!fixture || report.fixture.passed);
    if (output) { try { await output.writeFile(JSON.stringify(report) + '\n'); await output.sync(); } finally { await output.close(); } }
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = await run(); console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 1; }
  catch { console.error('FAIL: bounded library proof or private receipt'); process.exitCode = 1; }
}
