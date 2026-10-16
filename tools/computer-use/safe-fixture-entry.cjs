// Electron-only entry. No code path in this file starts Electron.
'use strict';
const token = process.env.OMNIFLOW_GUI_FIXTURE_TOKEN;
if (!process.versions.electron || process.type !== 'browser'
    || process.env.OMNIFLOW_GUI_FIXTURE_CHILD !== '1'
    || process.env.OMNIFLOW_GUI_FIXTURE_DEPTH !== '1'
    || !token || process.argv.at(-1) !== `--fixture-token=${token}`
    || typeof process.send !== 'function') {
  throw new Error('This entry requires the safe Node fixture supervisor.');
}
// This must be the Electron builtin, never an absolute node_modules path.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const { hardenFixtureChildren } = require('./safe-fixture-child-policy.cjs');
let started = false;
const startupTimer = setTimeout(() => app.exit(1), 3000);
process.once('disconnect', () => app.exit(1));
process.on('message', async message => {
  if (started || message?.type !== 'run' || message.token !== token) return;
  started = true;
  clearTimeout(startupTimer);
  try {
    if (typeof message.fixture !== 'string' || !path.isAbsolute(message.fixture)
        || !path.isAbsolute(message.profile)) throw new Error('Invalid supervised fixture configuration.');
    fs.mkdirSync(message.profile, { recursive: true, mode: 0o700 });
    app.setPath('userData', message.profile);
    app.setPath('sessionData', message.profile);
    hardenFixtureChildren(require('node:child_process'), message.allowedExecutables, process.execPath);
    syncBuiltinESMExports();
    app.relaunch = () => { throw new Error('Fixture relaunch is disabled.'); };
    await import(pathToFileURL(message.fixture).href);
  } catch (error) {
    console.error(String(error).slice(0, 2000));
    app.exit(1);
  }
});
process.send({ type: 'entry-ready', token });
