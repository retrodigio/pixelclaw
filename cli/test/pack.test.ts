// The build step: `pnpm pack` of the cli package gives a self-contained tarball (one bundled
// script, the built watch view, no dependencies), and `npx pixelclaw serve` from an install of it
// speaks MCP and serves the page. Needs `pnpm build` first (pnpm test runs it).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..');
const built = existsSync(join(CLI, 'dist', 'pixelclaw.js'));
const tmp = mkdtempSync(join(tmpdir(), 'pixelclaw-pack-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(!built)('the packed tarball (run pnpm build first)', () => {
  const app = join(tmp, 'app');
  let tgz = '';

  it('holds the bundle, the UI and licences, and no sources or dependencies', () => {
    execFileSync('pnpm', ['pack', '--pack-destination', tmp], { cwd: CLI, stdio: 'pipe' });
    tgz = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.tgz'))!);
    const files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).trim().split('\n').sort();
    expect(files).toContain('package/dist/pixelclaw.js');
    expect(files).toContain('package/dist/ui/index.html');
    expect(files).toContain('package/dist/THIRD_PARTY_LICENSES.txt');
    expect(files).toContain('package/dist/LICENSE');
    expect(files.filter((f) => f.endsWith('.ts'))).toEqual([]);
    const pkg = JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
    expect(pkg.bin).toEqual({ pixelclaw: './dist/pixelclaw.js' });
    expect(pkg.dependencies).toBeUndefined();
  });

  it('installs offline and npx pixelclaw serve works', async () => {
    mkdirSync(app);
    execFileSync('npm', ['install', tgz, '--offline', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: app, stdio: 'pipe' });
    expect(execFileSync('npx', ['--no-install', 'pixelclaw', 'help'], { cwd: app, encoding: 'utf8' })).toContain('pixelclaw serve --project');
    const transport = new StdioClientTransport({
      command: 'npx', args: ['--no-install', 'pixelclaw', 'serve', '--project', 'art.pclaw', '--port', '0'], cwd: app, stderr: 'pipe',
    });
    let stderr = '';
    (transport.stderr as PassThrough).on('data', (d: Buffer) => { stderr += d.toString(); });
    const client = new Client({ name: 'pack-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const r = (await client.callTool({ name: 'run', arguments: { asset: 'dot', commands: 'new icon dot 4x4 palette=none' } })) as { isError?: boolean };
      // The new project has no palettes yet, so this fails cleanly.
      expect(r.isError).toBe(true);
      const info = (await client.callTool({ name: 'project', arguments: {} })) as { content: { text: string }[] };
      const url = /watch live: (\S+)/.exec(info.content[0]!.text)![1]!;
      expect(stderr).toContain(`watch at ${url}`);
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const html = await page.text();
      const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)![1]!;
      expect((await fetch(new URL(script, url))).status).toBe(200);
    } finally {
      await client.close();
    }
  }, 60_000);
});
