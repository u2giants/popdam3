import { createRequire } from 'node:module';
import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://dam.designflow.app';
export const HOST = 'qsllyeztdwjgirsysgai.supabase.co';
const FACETS = new Set(['get_filter_counts', 'get_path_facets', 'get_dam_material_facets', 'get_dam_customer_facets']);
export function permittedRequest({ url, method }) {
  const u = new URL(url), verb = method.toUpperCase();
  if (u.protocol !== 'https:') return false;
  if (['login.microsoftonline.com', 'login.live.com', 'auth.designflow.app'].includes(u.hostname)) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(verb)) {
    if (u.pathname.startsWith('/auth/') && u.hostname === HOST) return u.pathname === '/auth/v1/user';
    return true;
  }
  if (u.hostname !== HOST) return false;
  if (verb === 'POST' && u.pathname === '/auth/v1/token') return u.search === '?grant_type=password';
  if (verb === 'POST' && u.pathname === '/auth/v1/logout') return u.search === '' || u.search === '?scope=global';
  const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(u.pathname);
  return Boolean(verb === 'POST' && rpc && FACETS.has(rpc[1]));
}

export async function run(env = process.env) {
  if (env.POPDAM_ACCEPTANCE_BASE_URL !== ORIGIN || env.SUPABASE_PROJECT_ID !== HOST.split('.')[0]) throw new Error('target');
  if (env.POPDAM_TEST_USER !== 'ai-admin@designflow.app' || !env.POPDAM_TEST_PASSWORD) throw new Error('existing dedicated identity');
  if (!/^[a-f0-9]{40}$/.test(env.DEPLOYED_FRONTEND_SHA || '')) throw new Error('build binding');
  if (!isAbsolute(env.POPDAM_PLAYWRIGHT_PACKAGE || '') || !isAbsolute(env.POPDAM_PROOF_FILE || '')) throw new Error('private paths');
  const require = createRequire(import.meta.url);
  const runtime = require(resolve(env.POPDAM_PLAYWRIGHT_PACKAGE, 'package.json'));
  if (runtime.name !== 'playwright' || runtime.version !== '1.56.1') throw new Error('app runtime pin');
  const { chromium } = require(env.POPDAM_PLAYWRIGHT_PACKAGE);
  const report = { schema_version: 1, issue: 4427, passed: false, target: ORIGIN, project: HOST.split('.')[0],
    deployed_frontend_sha: env.DEPLOYED_FRONTEND_SHA, password_login: false, library_read: false,
    library_reloaded: false, library_rendered: false, logout: false, context_closed: false, browser_closed: false, blocked_requests: 0 };
  let browser, context, page, output;
  const reads = new Set();
  let tokenCalls = 0, logoutCalls = 0, tokenIssued = false;
  try {
    const directory = dirname(env.POPDAM_PROOF_FILE);
    await mkdir(directory, {recursive: true, mode: 0o700});
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || await realpath(directory) !== directory || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('private directory');
    output = await open(env.POPDAM_PROOF_FILE, 'wx', 0o600);
    browser = await chromium.launch({headless: true});
    context = await browser.newContext({viewport: {width: 1600, height: 1000}, serviceWorkers: 'block'});
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      let allowed = permittedRequest({url: request.url(), method: request.method()});
      if (url.hostname === HOST && request.method() === 'POST' && url.pathname === '/auth/v1/token') allowed &&= ++tokenCalls === 1;
      if (url.hostname === HOST && request.method() === 'POST' && url.pathname === '/auth/v1/logout') allowed &&= ++logoutCalls === 1;
      if (!allowed) { report.blocked_requests++; return route.abort('blockedbyclient'); }
      return route.continue();
    });
    page = await context.newPage();
    page.on('response', response => {
      const u = new URL(response.url());
      if (u.hostname !== HOST) return;
      if (u.pathname === '/auth/v1/token' && response.status() === 200) tokenIssued = true;
      if (u.pathname === '/auth/v1/logout' && response.status() >= 200 && response.status() < 300) report.logout = true;
      if (response.request().method() === 'GET' && response.status() === 200 && u.pathname === '/rest/v1/style_groups') reads.add(response);
    });
    await page.goto(`${ORIGIN}/login`, {waitUntil: 'domcontentloaded'});
    await page.locator('input[type="email"]').fill(env.POPDAM_TEST_USER);
    await page.locator('input[type="password"]').fill(env.POPDAM_TEST_PASSWORD);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.waitForURL(`${ORIGIN}/library`, {timeout: 30000});
    report.password_login = true;
    await page.waitForFunction(sha => [...document.querySelectorAll('header span.font-mono')].some(e => {
      const token = e.textContent?.trim().split(/\s+/)[0];
      return /^[a-f0-9]{7,40}$/.test(token || '') && sha.startsWith(token);
    }), env.DEPLOYED_FRONTEND_SHA, {timeout: 20000});
    if (await page.getByText(/Connected to a non-production database/).count()) throw new Error('database banner');
    // Retain no response bodies, rows, URLs with identifiers, screenshots or cookies.
    await page.waitForResponse(r => reads.has(r), {timeout: 20000}).catch(() => {
      if (!reads.size) throw new Error('library read');
    });
    report.library_read = reads.size > 0;
    const response = [...reads].at(-1);
    if (!response.request().headers().authorization?.startsWith('Bearer ')) throw new Error('authenticated read');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || typeof rows[0].sku !== 'string' || !rows[0].sku) throw new Error('bounded nonempty library');
    await page.getByText(rows[0].sku, {exact: true}).first().waitFor({state: 'visible', timeout: 15000});
    report.library_rendered = true;
    const before = reads.size;
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForResponse(r => reads.has(r), {timeout: 20000}).catch(() => {
      if (reads.size <= before) throw new Error('library reload');
    });
    report.library_reloaded = reads.size > before;
  } catch { /* No provider error, credential, account name or licensed row is emitted. */ }
  finally {
    if (page && tokenIssued) {
      try {
        const userMenu = page.locator('header button.rounded-full[aria-haspopup="menu"]');
        if (await userMenu.count() !== 1) throw new Error('ambiguous user menu');
        await userMenu.click();
        await page.getByRole('menuitem', {name: 'Sign out', exact: true}).click();
        await page.waitForURL(`${ORIGIN}/login`, {timeout: 15000});
      } catch { report.logout = false; }
    }
    if (context) { try { await context.close(); report.context_closed = true; } catch {} }
    if (browser) { try { await browser.close(); report.browser_closed = true; } catch {} }
    report.passed = report.password_login && report.library_read && report.library_rendered && report.library_reloaded && report.logout && report.context_closed && report.browser_closed && report.blocked_requests === 0;
    if (output) { try { await output.writeFile(JSON.stringify(report) + '\n'); await output.sync(); } finally { await output.close(); } }
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = await run(); console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 1; }
  catch { console.error('FAIL: bounded library proof or private receipt'); process.exitCode = 1; }
}
