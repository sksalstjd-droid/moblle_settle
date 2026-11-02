const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const python = process.env.PYTHON || 'python';

function runBuild() {
  const result = spawnSync(python, ['scripts/build_static.py'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function fileManifest(directory) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(directory, absolute).replaceAll(path.sep, '/');
    if (entry.isDirectory()) {
      for (const child of fileManifest(absolute)) entries.push(`${entry.name}/${child}`);
    } else {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      entries.push(`${relative}:${hash}`);
    }
  }
  return entries.sort();
}

test('static build emits only production assets and preserves template script order', () => {
  runBuild();
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\{%|\{\{/);
  assert.doesNotMatch(html, /dev-live-reload|png-review|__dev\//);
  for (const [, reference] of html.matchAll(/(?:href|src)="(\/static\/[^\"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(dist, reference.slice(1))), `Unresolved HTML resource ${reference}`);
  }
  const core = html.indexOf('/static/settlement-core.js');
  const share = html.indexOf('/static/share-report.js');
  const app = html.indexOf('/static/app.js');
  assert.ok(core >= 0 && core < share && share < app);

  const expected = [
    'static/style.css',
    'static/settlement-core.js',
    'static/share-report.js',
    'static/app.js',
    'static/images/calculator.svg',
    'static/images/credit-card.svg',
    'static/images/user.svg',
  ];
  for (const relative of expected) assert.ok(fs.statSync(path.join(dist, relative)).isFile(), relative);
  for (const forbidden of ['static/dev-live-reload.js', 'static/png-review.js', 'app.py', 'templates/png-review.html']) {
    assert.equal(fs.existsSync(path.join(dist, forbidden)), false, forbidden);
  }

  const css = fs.readFileSync(path.join(dist, 'static/style.css'), 'utf8');
  for (const [, reference] of css.matchAll(/url\(["']?(\/static\/[^"')]+)["']?\)/g)) {
    assert.ok(fs.existsSync(path.join(dist, reference.slice(1))), `Unresolved CSS resource ${reference}`);
  }
});

test('static builds are deterministic, remove stale output, and do not modify sources', () => {
  const trackedSources = [
    'templates/index.html',
    'static/style.css',
    'static/settlement-core.js',
    'static/share-report.js',
    'static/app.js',
    'static/images/calculator.svg',
    'static/images/credit-card.svg',
    'static/images/user.svg',
  ];
  const before = new Map(trackedSources.map((relative) => [
    relative,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'),
  ]));

  runBuild();
  const first = fileManifest(dist);
  fs.writeFileSync(path.join(dist, 'stale-file.tmp'), 'stale');
  runBuild();
  const second = fileManifest(dist);
  assert.deepEqual(second, first);
  assert.equal(fs.existsSync(path.join(dist, 'stale-file.tmp')), false);

  for (const [relative, hash] of before) {
    const current = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    assert.equal(current, hash, `${relative} changed during build`);
  }
});

test('generated dist directory is ignored by Git', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\/dist\/$/m);
});
