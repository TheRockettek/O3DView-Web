const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

async function main() {
  const browser = process.argv[2];
  if (!browser || !['firefox', 'chromium'].includes(path.basename(browser))) {
    throw new Error('Provide the path to firefox or chromium');
  }
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'o3dview-dropdown-browser-'));
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/test-result') {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.end('received');
      finish(body);
      return;
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const contents = await fs.readFile(filename);
      const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[path.extname(filename)];
      res.writeHead(200, { 'content-type': type || 'application/octet-stream' }).end(contents);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/browser-checks/dropdowns.html`;
  const args = path.basename(browser) === 'firefox'
    ? ['--headless', '--no-remote', '--profile', profile, url]
    : ['--headless', '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, url];
  const child = spawn(browser, args, { stdio: 'ignore', env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
  child.on('error', error => finish(`FAIL browser launch: ${error.message}`));
  child.on('exit', (code, signal) => finish(`FAIL browser exited: ${code ?? signal}`));
  const timer = setTimeout(() => finish('FAIL timed out waiting for browser'), 45000);
  try {
    const output = await result;
    console.log(`${path.basename(browser)}: ${output}`);
    if (output !== 'PASS') process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
