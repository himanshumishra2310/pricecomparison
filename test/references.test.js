import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards against a helper being dropped during an edit: every `await name(` in the crawler must be defined or imported.
test('browser provider references only functions it defines or imports', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'providers', 'browser.js');
  const src = fs.readFileSync(file, 'utf8');
  const defined = new Set([...src.matchAll(/(?:async )?function (\w+)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/import \{([^}]+)\}/g)) m[1].split(',').forEach((n) => defined.add(n.trim()));
  // Local bindings such as `const [name, run] of ...` or `const fetch = ...` are fine too.
  for (const m of src.matchAll(/(?:const|let|var)\s+(?:\[([^\]]+)\]|(\w+))/g)) (m[1] || m[2]).split(',').forEach((n) => defined.add(n.trim()));
  const called = [...src.matchAll(/await (\w+)\(/g)].map((m) => m[1]);
  const missing = called.filter((n) => !defined.has(n) && !['page', 'context', 'browser', 'chromium'].includes(n));
  assert.deepEqual([...new Set(missing)], []);
});
