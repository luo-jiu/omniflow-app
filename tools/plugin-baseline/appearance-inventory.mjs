import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Lexical inventory only: counts references, not effective cascade or visible colors.
const root = fileURLToPath(new URL('../../', import.meta.url));
const tokens = new Map();
const hardcoded = [];
async function visit(directory) {
  for (const entry of (await readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (relative === 'src/assets/icons') continue;
      await visit(relative);
    } else if (entry.isFile() && /\.(tsx?|css|less)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      const lines = (await readFile(path.join(root, relative), 'utf8')).split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(/--app-[a-z0-9-]+/g)) {
          const refs = tokens.get(match[0]) ?? [];
          refs.push({ file: relative, line: index + 1 });
          tokens.set(match[0], refs);
        }
        if (/(?:color|background|border|shadow|fill|stroke)/i.test(line) && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(line)) {
          hardcoded.push({ file: relative, line: index + 1 });
        }
      });
    }
  }
}
await visit('src');
const definitions = (await readFile(path.join(root, 'src/assets/css/reset.less'), 'utf8'));
console.log(JSON.stringify({
  schemaVersion: 1,
  method: 'Lexical --app-* occurrences; hardcoded color candidates exclude SVG assets and tests. No runtime coverage claim.',
  resetTokens: [...new Set(definitions.match(/--app-[a-z0-9-]+(?=\s*:)/g))].sort(),
  tokens: Object.fromEntries([...tokens.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))),
  hardcodedColorCandidates: hardcoded,
}, null, 2));
