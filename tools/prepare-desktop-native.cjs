const prepareSQLite = require('./prepare-sqlite3-native.cjs');
const { prepareRipgrep } = require('./prepare-ripgrep.cjs');
const { Arch } = require('builder-util');

module.exports = async function prepareDesktopNative(context, dependencies = {}) {
  // electron-builder 24 passes Arch[arch] strings; also accept its numeric enum
  // for direct hook callers without passing numbers to either native preparer.
  const normalizedContext = { ...context, arch: typeof context.arch === 'number' ? Arch[context.arch] : context.arch };
  await (dependencies.prepareRipgrep ?? prepareRipgrep)(normalizedContext.appDir, normalizedContext.platform?.nodeName, normalizedContext.arch);
  // Preserve the existing SQLite N-API preparation and skip-rebuild return value.
  return (dependencies.prepareSQLite ?? prepareSQLite)(normalizedContext);
};
