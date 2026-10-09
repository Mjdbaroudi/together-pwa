const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

test('application version and direct dependency declarations agree with the lockfile', () => {
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  for (const group of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][group], manifest[group], group);
  }
});

test('locked transitive dependency ranges agree with installed package metadata', () => {
  let checked = 0;
  for (const [name, row] of Object.entries(lock.packages)) {
    if (!name) continue;
    const metadataPath = path.join(root, name, 'package.json');
    if (!fs.existsSync(metadataPath)) continue; // Platform-specific optional packages may be absent.
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(row.version, metadata.version, `${name}: installed version`);
    assert.deepEqual(row.dependencies || {}, metadata.dependencies || {}, `${name}: dependency ranges`);
    checked++;
  }
  assert.ok(checked > 0, 'Must verify installed dependency metadata');
});
