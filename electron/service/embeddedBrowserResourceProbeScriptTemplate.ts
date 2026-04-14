/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
import { embeddedBrowserResourceProbePageActionsBody } from './embeddedBrowserResourceProbePageActions'
import { embeddedBrowserResourceProbeRuntimeCoreBody } from './embeddedBrowserResourceProbeRuntimeCore'
import { embeddedBrowserResourceProbeRuntimeHooksBody } from './embeddedBrowserResourceProbeRuntimeHooks'

export const EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:'

function getScriptFunctionBody(fn: (...args: never[]) => unknown) {
  const source = fn.toString()
  const bodyStart = source.indexOf('{')
  const bodyEnd = source.lastIndexOf('}')
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    return ''
  }
  return source.slice(bodyStart + 1, bodyEnd).trim()
}

function createProbeBootstrapFunctionSource() {
  return `function createProbeBootstrapSource(nextConsolePrefix) {
  return [
    ';(() => {',
    'const consolePrefix = ' + JSON.stringify(String(nextConsolePrefix || '')) + ';',
    'const probeRuntimeCoreBodySource = ' + JSON.stringify(probeRuntimeCoreBodySource) + ';',
    'const probePageActionsBodySource = ' + JSON.stringify(probePageActionsBodySource) + ';',
    'const probeRuntimeHooksBodySource = ' + JSON.stringify(probeRuntimeHooksBodySource) + ';',
    createProbeBootstrapSource.toString(),
    probeRuntimeCoreBodySource,
    probeRuntimeHooksBodySource,
    probePageActionsBodySource,
    "return 'installed';",
    '})();',
  ].join('\\n')
}`
}

export function createProbeScriptTemplate(input: {
  consolePrefix: string
  pageActionsBodySource: string
  runtimeCoreBodySource: string
  runtimeHooksBodySource: string
}) {
  return [
    ';(() => {',
    `const consolePrefix = ${JSON.stringify(input.consolePrefix)};`,
    `const probeRuntimeCoreBodySource = ${JSON.stringify(input.runtimeCoreBodySource)};`,
    `const probePageActionsBodySource = ${JSON.stringify(input.pageActionsBodySource)};`,
    `const probeRuntimeHooksBodySource = ${JSON.stringify(input.runtimeHooksBodySource)};`,
    createProbeBootstrapFunctionSource(),
    input.runtimeCoreBodySource,
    input.runtimeHooksBodySource,
    input.pageActionsBodySource,
    "return 'installed';",
    '})();',
  ].join('\n')
}

export function createEmbeddedBrowserResourceProbeScript() {
  return createProbeScriptTemplate({
    consolePrefix: EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
    pageActionsBodySource: getScriptFunctionBody(embeddedBrowserResourceProbePageActionsBody),
    runtimeCoreBodySource: getScriptFunctionBody(embeddedBrowserResourceProbeRuntimeCoreBody),
    runtimeHooksBodySource: getScriptFunctionBody(embeddedBrowserResourceProbeRuntimeHooksBody),
  })
}
