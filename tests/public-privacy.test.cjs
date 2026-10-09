const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const loadAudit = () => import('../scripts/check-public-privacy.mjs');
const file = (name, text = '', extra = {}) => ({ name, bytes: Buffer.from(text), ...extra });

test('publication guard accepts empty environment template and synthetic test addresses', async () => {
  const { auditPublicFiles } = await loadAudit();
  const template = fs.readFileSync(path.join(__dirname, '../.env.example'));
  assert.deepEqual(auditPublicFiles([{ name: '.env.example', bytes: template }, file('tests/example.cjs', 'user@example.test https://fixture.invalid')]), []);
});
test('publication guard blocks secret/configuration/media paths and nonempty template values', async () => {
  const { auditPublicFiles } = await loadAudit();
  for (const name of ['.env.local', '.vercel/project.json', 'exports/messages.json', 'screenshots/chat.png', 'key.pem', 'backup.dump', 'node_modules/package/index.js', 'photo.jpg', 'private.pdf']) assert.ok(auditPublicFiles([file(name)]).length, name);
  assert.ok(auditPublicFiles([file('.env.example', 'TURN_SHARED_SECRET=not-a-publishable-value')]).length);
  assert.ok(auditPublicFiles([file('photo-link', '', { symlink: true })]).length);
});
test('publication guard detects credential patterns without printing their values', async () => {
  const { auditPublicFiles } = await loadAudit();
  const fakeToken = ['ghp', '_', 'z'.repeat(36)].join('');
  const fakeJWT = ['eyJ' + 'z'.repeat(20), 'z'.repeat(20), 'z'.repeat(20)].join('.');
  const fakePrivate = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const fakeURL = ['https://', 'synthetic-fixture', '.supabase.co'].join('');
  const fakeEmail = ['user', '@', 'synthetic-fixture', '.com'].join('');
  for (const value of [fakeToken, fakeJWT, fakePrivate, fakeURL, fakeEmail]) {
    const result = auditPublicFiles([file('src/fixture.ts', value)]);
    assert.ok(result.length);
    assert.ok(result.every(item => !JSON.stringify(item).includes(value)));
  }
});
test('publication ignores protect local secrets but preserve the empty template', () => {
  const ignores = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');
  for (const rule of ['.env*', '!.env.example', '.vercel/', 'uploads/', 'exports/', 'backups/', 'screenshots/', '*.dump']) assert.ok(ignores.split('\n').includes(rule), rule);
});
test('publication scans staged bytes, not a subsequently cleaned working file', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'together-public-index-'));
  const script = path.resolve(__dirname, '../scripts/check-public-privacy.mjs');
  const git = args => {
    const result = spawnSync('git', args, { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, 'local fixture Git operation');
  };
  try {
    git(['init', '--quiet']);
    const fake = ['ghp', '_', 'z'.repeat(36)].join('');
    fs.writeFileSync(path.join(temp, 'source.js'), fake);
    git(['add', 'source.js']);
    fs.writeFileSync(path.join(temp, 'source.js'), '// clean working copy');
    let result = spawnSync(process.execPath, [script], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /provider token/);
    assert.ok(!result.stderr.includes(fake));
    git(['add', 'source.js']);
    result = spawnSync(process.execPath, [script], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Git index/);
    fs.writeFileSync(path.join(temp, '.env.local'), 'EMPTY=');
    git(['add', '-f', '.env.local']);
    result = spawnSync(process.execPath, [script], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private, generated or unsupported publication file/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
