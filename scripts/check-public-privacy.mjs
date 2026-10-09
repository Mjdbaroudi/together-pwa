import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ignoredDirectories = new Set(['.git', 'node_modules', '.next', 'out', 'dist', 'coverage']);
const genericImages = new Set(['public/icons/icon-192.png', 'public/icons/icon-512.png']);
const privatePath = /(^|\/)(?:\.env[^/]*|\.vercel|\.supabase|\.openai|\.codex|uploads?|exports?|backups?|screenshots?|credentials[^/]*|service-account[^/]*)(?:\/|$)|\.(?:pem|key|p12|pfx|dump|sqlite\d*|db|har|zip|pdf|log)$/i;
const privateDirectory = /(^|\/)(?:\.git|node_modules|\.next|out|dist|coverage|\.cache)(?:\/|$)|(^|\/)supabase\/\.temp(?:\/|$)/;

const patterns = [
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['JWT-shaped credential', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['provider token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/],
  ['configured backend or deployment URL', /https?:\/\/[a-z0-9-]+\.(?:supabase\.(?:co|in)|vercel\.app)\b/i],
  ['access-bearing signed media URL', /https?:\/\/[^\s"'<>]+(?:[?&](?:token|x-amz-signature|signature)=)[^\s"'<>]+/i],
  ['literal private credential', /\b(?:VAPID_PRIVATE_KEY|TURN_SHARED_SECRET|TURN_CREDENTIAL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)\s*[:=]\s*["'][A-Za-z0-9_+\/=.-]{20,}["']/],
];

// Reports categories and relative paths only. Never echo matched secret values.
export function auditPublicFiles(files) {
  const problems = [];
  for (const { name, bytes, symlink = false } of files) {
    if (name.startsWith('/') || name.split('/').includes('..') || symlink) {
      problems.push({ name, reason: 'unsafe path or symbolic link' });
      continue;
    }
    if (name !== '.env.example' && (privatePath.test(name) || privateDirectory.test(name) || /\.tsbuildinfo$/.test(name))) {
      problems.push({ name, reason: 'private, generated or unsupported publication file' });
      continue;
    }
    if (genericImages.has(name)) continue;
    if (/\.(?:png|jpe?g|webp|gif|avif|heic|heif|mp4|mov|mp3|wav|m4a)$/i.test(name)) {
      problems.push({ name, reason: 'media requires separate publication review' });
      continue;
    }
    if (bytes.includes(0)) {
      problems.push({ name, reason: 'unreviewed binary content' });
      continue;
    }
    const text = bytes.toString('utf8');
    if (name === '.env.example') {
      for (const line of text.split(/\r?\n/)) {
        const setting = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
        if (!setting) continue;
        const [, key, value] = setting;
        if (value && !(key === 'VAPID_SUBJECT' && value === 'mailto:together@example.com') && !(key === 'CALLS_RELAY_ONLY' && value === 'true')) {
          problems.push({ name, reason: 'nonempty environment template setting' });
        }
      }
    }
    for (const [reason, pattern] of patterns) if (pattern.test(text)) problems.push({ name, reason });
    const emails = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
    if (emails.some(email => !/@(?:example\.(?:com|org|net)|[^@]+\.(?:test|example|invalid))$/i.test(email))) {
      problems.push({ name, reason: 'non-example email address' });
    }
  }
  return problems;
}

function publicationFiles(root) {
  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (gitRoot.status === 0 && path.resolve(gitRoot.stdout.trim()) === root) {
    const index = spawnSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (index.status !== 0) throw new Error('Cannot inspect Git index.');
    const rows = index.stdout.split('\0').filter(Boolean);
    if (!rows.length) throw new Error('Git index is empty. Stage the intended public files first.');
    const files = rows.map(row => {
      const match = row.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
      if (!match || match[3] !== '0') throw new Error('Resolve Git index conflicts before publication.');
      const [, mode, hash, , name] = match;
      const blob = spawnSync('git', ['cat-file', 'blob', hash], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
      if (blob.status !== 0) throw new Error('Cannot read a staged Git blob.');
      return { name, bytes: blob.stdout, symlink: mode === '120000' || mode === '160000' };
    });
    return { files, mode: 'Git index (not commit history)' };
  }
  const files = [];
  const walk = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const location = path.join(directory, item.name), name = path.relative(root, location).split(path.sep).join('/');
      if (item.isDirectory() && ignoredDirectories.has(item.name)) continue;
      if (item.isDirectory()) walk(location);
      else files.push({ name, bytes: item.isSymbolicLink() ? Buffer.alloc(0) : fs.readFileSync(location), symlink: item.isSymbolicLink() });
    }
  };
  walk(root);
  // The .gitignore excludes TypeScript's incremental cache during ordinary checks.
  return { files: files.filter(file => !/\.tsbuildinfo$/.test(file.name)), mode: 'source directory (no Git index)' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { files, mode } = publicationFiles(path.resolve(process.cwd()));
    const problems = auditPublicFiles(files);
    for (const item of problems) console.error(`Blocked: ${JSON.stringify(item.name)} — ${item.reason}`);
    if (problems.length) process.exitCode = 1;
    else console.log(`Publication privacy check passed: ${files.length} files; ${mode}. Heuristic scan; review future personal content manually.`);
  } catch {
    console.error('Publication check could not inspect files safely. Check the repository root and Git index.');
    process.exitCode = 1;
  }
}
