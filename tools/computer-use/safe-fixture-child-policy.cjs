'use strict';
const path = require('node:path');
const { realpathSync } = require('node:fs');

// Accidental process recursion is stopped before the OS spawn. This is a guard
// for our trusted fixture scripts, not a sandbox for arbitrary JavaScript.
function hardenFixtureChildren(childProcess, allowedExecutables, executable, canonicalize = realpathSync) {
  const allowed = new Set(allowedExecutables);
  const ownExecutable = canonicalize(executable);
  for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = childProcess[method];
    childProcess[method] = function guarded(command, ...args) {
      const options = args.find(value => value && typeof value === 'object' && !Array.isArray(value));
      let canonical;
      try { if (typeof command === 'string' && path.isAbsolute(command)) canonical = canonicalize(command); } catch { /* Refuse unresolved helpers. */ }
      if (!canonical || !allowed.has(canonical)
          || canonical === ownExecutable || /^(?:electron|node)(?:\.exe)?$/i.test(path.basename(canonical))
          || options?.detached || options?.shell) {
        throw new Error(`Fixture child process refused (${method}): only declared native helpers in the owned process group may run.`);
      }
      return original.call(this, canonical, ...args);
    };
  }
  for (const method of ['exec', 'execSync', 'fork']) childProcess[method] = () => {
    throw new Error(`Fixture ${method} is disabled; declare an absolute native helper and use execFile/spawn.`);
  };
}
module.exports = { hardenFixtureChildren };
