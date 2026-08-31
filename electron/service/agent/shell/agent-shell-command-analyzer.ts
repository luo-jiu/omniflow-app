import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import TreeSitter from '@vscode/tree-sitter-wasm';
import type { Node } from '@vscode/tree-sitter-wasm';

import type {
  AgentShellDialect,
  AgentShellPreparedAssessment,
  AgentShellPreparedOperation,
  AgentShellRisk,
  AgentShellRiskFacet,
} from '../../../../src/shared/agent/shell/agent-shell.types';

export const AGENT_SHELL_COMMAND_ANALYZER_REVISION =
  'tree-sitter-command-analyzer-v1+vscode-wasm-0.3.1';

const MAX_AST_NODES = 8_192;
const MAX_OPERATIONS = 128;
const MAX_OPERATION_PREFIX = 32;
const WORKSPACE_ROOTS = new Set(['home', 'input', 'output', 'tmp', 'work']);

const FACET_ORDER: readonly AgentShellRiskFacet[] = Object.freeze([
  'command_substitution',
  'detached',
  'dynamic_command_head',
  'environment_change',
  'external_path',
  'filesystem.delete',
  'filesystem.read',
  'filesystem.write',
  'interactive',
  'nested_shell',
  'network',
  'package_install',
  'privilege_escalation',
  'process_launch',
  'redirection',
  'system_configuration',
  'unknown_syntax',
]);

const BASH_ALLOWED_NAMED_NODES = new Set([
  'command',
  'command_name',
  'comment',
  'file_descriptor',
  'file_redirect',
  'list',
  'negated_command',
  'number',
  'pipeline',
  'program',
  'raw_string',
  'redirected_statement',
  'string',
  'string_content',
  'variable_assignment',
  'variable_name',
  'word',
]);

const POWERSHELL_ALLOWED_NAMED_NODES = new Set([
  'array_literal_expression',
  'command',
  'command_argument_sep',
  'command_elements',
  'command_invokation_operator',
  'command_name',
  'command_name_expr',
  'command_parameter',
  'comment',
  'decimal_integer_literal',
  'empty_statement',
  'expandable_string_literal',
  'file_redirection_operator',
  'generic_token',
  'integer_literal',
  'merging_redirection_operator',
  'pipeline',
  'pipeline_chain',
  'program',
  'redirected_file_name',
  'redirection',
  'statement_list',
  'string_literal',
  'unary_expression',
  'verbatim_string_characters',
]);

const BASH_DYNAMIC_NODE_TYPES = new Map<string, AgentShellRiskFacet>([
  ['arithmetic_expansion', 'unknown_syntax'],
  ['command_substitution', 'command_substitution'],
  ['expansion', 'unknown_syntax'],
  ['process_substitution', 'command_substitution'],
  ['simple_expansion', 'unknown_syntax'],
]);

const POWERSHELL_DYNAMIC_NODE_TYPES = new Map<string, AgentShellRiskFacet>([
  ['braced_variable', 'unknown_syntax'],
  ['invokation_expression', 'dynamic_command_head'],
  ['script_block_expression', 'unknown_syntax'],
  ['sub_expression', 'command_substitution'],
  ['variable', 'unknown_syntax'],
]);

const PRIVILEGE_COMMANDS = new Set([
  'doas',
  'pkexec',
  'runas',
  'runas.exe',
  'su',
  'sudo',
]);

const DETACHED_COMMANDS = new Set([
  'disown',
  'nohup',
  'setsid',
  'start-process',
]);

const INTERACTIVE_COMMANDS = new Set([
  'emacs',
  'htop',
  'less',
  'man',
  'more',
  'nano',
  'top',
  'vi',
  'vim',
]);

const NESTED_SHELL_COMMANDS = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'env',
  'fish',
  'node',
  'perl',
  'powershell',
  'powershell.exe',
  'pwsh',
  'python',
  'python3',
  'ruby',
  'sh',
  'zsh',
]);

const NETWORK_COMMANDS = new Set([
  'curl',
  'dig',
  'git',
  'invoke-restmethod',
  'invoke-webrequest',
  'nc',
  'netcat',
  'nslookup',
  'ping',
  'rsync',
  'scp',
  'sftp',
  'ssh',
  'test-netconnection',
  'wget',
]);

const PACKAGE_COMMANDS = new Set([
  'apt',
  'apt-get',
  'brew',
  'bun',
  'choco',
  'dnf',
  'npm',
  'pacman',
  'pip',
  'pip3',
  'pnpm',
  'winget',
  'yarn',
  'yum',
]);

const SYSTEM_CONFIGURATION_COMMANDS = new Set([
  'defaults',
  'diskutil',
  'launchctl',
  'mount',
  'new-itemproperty',
  'reg',
  'remove-itemproperty',
  'sc',
  'service',
  'set-executionpolicy',
  'set-itemproperty',
  'set-service',
  'start-service',
  'stop-service',
  'sysctl',
  'systemctl',
  'umount',
]);

const PATHLESS_COMMANDS = new Set([
  'echo',
  'false',
  'id',
  'printf',
  'pwd',
  'sleep',
  'true',
  'uname',
  'whoami',
  'write-output',
]);

const READ_PATH_COMMANDS = new Set([
  'cat',
  'du',
  'file',
  'get-childitem',
  'get-content',
  'get-item',
  'head',
  'ls',
  'stat',
  'tail',
  'test-path',
  'type',
  'wc',
]);

const WRITE_PATH_COMMANDS = new Set([
  'add-content',
  'mkdir',
  'new-item',
  'out-file',
  'set-content',
  'tee',
  'touch',
]);

const DELETE_PATH_COMMANDS = new Set([
  'remove-item',
  'rm',
  'rmdir',
]);

const COPY_PATH_COMMANDS = new Set([
  'copy-item',
  'cp',
]);

const MOVE_PATH_COMMANDS = new Set([
  'move-item',
  'mv',
  'rename-item',
]);

const COMMON_POSIX_NO_VALUE_OPTIONS = new Set([
  '-1', '-A', '-E', '-F', '-G', '-H', '-L', '-P', '-R', '-S', '-T', '-a', '-b', '-d', '-f',
  '-h', '-i', '-l', '-n', '-p', '-r', '-s', '-u', '-v', '-x', '--', '--force',
  '--help', '--interactive', '--no-preserve-root', '--recursive', '--verbose', '--version',
]);

const COMMON_POSIX_VALUE_OPTIONS = new Set([
  '-I', '--block-size', '--ignore', '--time-style', '--format',
]);

const COMMON_POSIX_PATH_VALUE_OPTIONS = new Set([
  '-t', '--reference', '--target-directory',
]);

const COPY_LINK_OPTIONS = new Set([
  '--link',
  '--symbolic-link',
]);

const COMMON_POWERSHELL_SWITCHES = new Set([
  '-confirm', '-debug', '-force', '-nonewline', '-recurse', '-verbose', '-whatif',
]);

const COMMON_POWERSHELL_IGNORED_VALUE_PARAMETERS = new Set([
  '-exclude', '-filter', '-include',
]);

const COMMON_POWERSHELL_PATH_PARAMETERS = new Set([
  '-destination', '-literalpath', '-path',
]);

interface AnalyzerRuntime {
  readonly bash: InstanceType<typeof TreeSitter.Language>;
  readonly powershell: InstanceType<typeof TreeSitter.Language>;
}

interface StaticArgument {
  readonly value: string;
}

interface PathUse {
  readonly access: 'delete' | 'read' | 'write';
  readonly value: string;
}

interface CopyMoveOperands {
  readonly destinations: readonly string[];
  readonly sources: readonly string[];
}

interface MutableAnalysis {
  boundaryVerified: boolean;
  readonly facets: Set<AgentShellRiskFacet>;
  readonly operations: AgentShellPreparedOperation[];
  readonly unresolved: Set<string>;
}

export interface AgentShellCommandAnalysisInput {
  readonly command: string;
  readonly dialect: AgentShellDialect;
  readonly hasEnvironmentOverrides: boolean;
  readonly logicalCwd: string;
  readonly persistentRuleEligible: boolean;
  readonly providerAnalyzerRevision: string;
}

export interface AgentShellCommandAnalysis {
  readonly analysisIdentity: string | null;
  readonly analyzerRevision: string;
  readonly assessment: AgentShellPreparedAssessment;
  readonly workspaceBoundaryVerified: boolean;
}

let runtimePromise: Promise<AnalyzerRuntime> | null = null;

function hashIdentity(domain: string, value: unknown): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([domain, value])).digest('hex');
  return `v1:${digest}`;
}

function analyzerRuntime(): Promise<AnalyzerRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const require = createRequire(import.meta.url);
    const runtimePath = require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm');
    await TreeSitter.Parser.init({ locateFile: () => runtimePath });
    const [bash, powershell] = await Promise.all([
      TreeSitter.Language.load(
        require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm'),
      ),
      TreeSitter.Language.load(
        require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-powershell.wasm'),
      ),
    ]);
    return Object.freeze({ bash, powershell });
  })();
  runtimePromise.catch(() => {
    runtimePromise = null;
  });
  return runtimePromise;
}

function allNodes(root: Node): readonly Node[] {
  const result: Node[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    result.push(node);
    if (result.length > MAX_AST_NODES) throw new Error('Agent Shell AST 节点过多');
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) pending.push(child);
    }
  }
  return Object.freeze(result);
}

function normalizeCommandName(value: string, dialect: AgentShellDialect): string | null {
  const command = value.trim();
  if (!command || /[\s/\\$`'";&|(){}<>]/u.test(command)) return null;
  return dialect === 'powershell' ? command.toLowerCase() : command;
}

function restrictedCommandFacet(
  value: string,
  dialect: AgentShellDialect,
): AgentShellRiskFacet | null {
  const pathSegments = value.replace(/\\/gu, '/').split('/');
  const basename = pathSegments.at(-1) || '';
  const commandName = dialect === 'powershell' ? basename.toLowerCase() : basename;
  if (PRIVILEGE_COMMANDS.has(commandName)) return 'privilege_escalation';
  if (DETACHED_COMMANDS.has(commandName)) return 'detached';
  if (INTERACTIVE_COMMANDS.has(commandName)) return 'interactive';
  return null;
}

function decodeBashText(value: string): string | null {
  if (!value) return null;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('"') && value.endsWith('"')) {
    const body = value.slice(1, -1);
    if (/[$`]/u.test(body)) return null;
    return body.replace(/\\([\\"$`])/gu, '$1').replace(/\\\n/gu, '');
  }
  if (/[$`]/u.test(value)) return null;
  return value.replace(/\\(.)/gu, '$1');
}

function decodePowerShellText(value: string): string | null {
  if (!value) return null;
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    const body = value.slice(1, -1);
    if (/[$`]/u.test(body)) return null;
    return body.replace(/""/gu, '"');
  }
  if (/[$`,;]/u.test(value)) return null;
  return value;
}

function decodeStaticNode(node: Node, dialect: AgentShellDialect): string | null {
  const dynamicTypes = dialect === 'powershell'
    ? POWERSHELL_DYNAMIC_NODE_TYPES
    : BASH_DYNAMIC_NODE_TYPES;
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (dynamicTypes.has(current.type)) return null;
    for (let index = current.namedChildCount - 1; index >= 0; index -= 1) {
      const child = current.namedChild(index);
      if (child) pending.push(child);
    }
  }
  return dialect === 'powershell'
    ? decodePowerShellText(node.text.trim())
    : decodeBashText(node.text.trim());
}

function commandArguments(command: Node, dialect: AgentShellDialect): readonly StaticArgument[] {
  const nodes = dialect === 'powershell'
    ? (command.childForFieldName('command_elements')?.namedChildren || [])
        .filter((node): node is Node => node !== null)
        .filter(node => (
          node.type !== 'command_argument_sep'
          && node.type !== 'redirection'
        ))
    : command.childrenForFieldName('argument').filter((node): node is Node => Boolean(node));
  return Object.freeze(nodes.map((node) => {
    const value = decodeStaticNode(node, dialect);
    if (value === null) throw new Error('dynamic-argument');
    return Object.freeze({ value });
  }));
}

function addUnresolved(analysis: MutableAnalysis, reason: string): void {
  analysis.unresolved.add(reason);
  analysis.facets.add('unknown_syntax');
  analysis.boundaryVerified = false;
}

function pathWithinWorkspace(
  value: string,
  dialect: AgentShellDialect,
  logicalCwd: string,
): { readonly inside: boolean; readonly logicalPath: string | null } {
  let candidate = value.trim();
  if (!candidate || candidate === '-') return { inside: true, logicalPath: null };
  if (candidate.startsWith('~') && candidate !== '~' && !candidate.startsWith('~/')) {
    return { inside: false, logicalPath: null };
  }
  if (dialect === 'zsh' && candidate.startsWith('=')) {
    return { inside: false, logicalPath: null };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(candidate)) {
    return { inside: false, logicalPath: null };
  }
  if (dialect === 'powershell') {
    const provider = candidate.match(/^([A-Za-z]+)::(.*)$/u);
    if (provider) {
      if (provider[1].toLowerCase() !== 'filesystem') {
        return { inside: false, logicalPath: null };
      }
      candidate = provider[2];
    }
    candidate = candidate.replace(/\\/gu, '/');
    if (/^[A-Za-z][A-Za-z0-9_-]*:/u.test(candidate)) {
      return { inside: false, logicalPath: null };
    }
  } else if (candidate.includes('\\')) {
    return { inside: false, logicalPath: null };
  }
  if (/^(?:[A-Za-z]:|\/\/|\/)/u.test(candidate)) {
    return { inside: false, logicalPath: null };
  }

  const stack = candidate === '~' || candidate.startsWith('~/')
    ? ['home']
    : logicalCwd.split('/').filter(Boolean);
  const relative = candidate === '~'
    ? ''
    : candidate.startsWith('~/')
      ? candidate.slice(2)
      : candidate;
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return { inside: false, logicalPath: null };
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (stack.length > 0 && !WORKSPACE_ROOTS.has(stack[0])) {
    return { inside: false, logicalPath: null };
  }
  return { inside: true, logicalPath: stack.join('/') };
}

function applyPathUse(
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
  logicalCwd: string,
  use: PathUse,
): void {
  const resolved = pathWithinWorkspace(use.value, dialect, logicalCwd);
  if (!resolved.inside) {
    analysis.facets.add('external_path');
    analysis.boundaryVerified = false;
    return;
  }
  if (
    resolved.logicalPath
    && (use.access === 'delete' || use.access === 'write')
    && (resolved.logicalPath === 'input' || resolved.logicalPath.startsWith('input/'))
  ) {
    addUnresolved(analysis, 'read-only-input-mutation');
  }
}

function scanPosixOperands(
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
): readonly string[] {
  const operands: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    if (optionsEnded || value === '-' || !value.startsWith('-')) {
      operands.push(value);
      continue;
    }
    if (value === '--') {
      optionsEnded = true;
      continue;
    }
    const [name, inlineValue] = value.split('=', 2);
    if (COMMON_POSIX_NO_VALUE_OPTIONS.has(name)) continue;
    if (COMMON_POSIX_VALUE_OPTIONS.has(name)) {
      if (inlineValue === undefined) {
        index += 1;
        if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
      }
      continue;
    }
    if (COMMON_POSIX_PATH_VALUE_OPTIONS.has(name)) {
      if (inlineValue !== undefined) {
        operands.push(inlineValue);
      } else {
        index += 1;
        if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
        else operands.push(args[index].value);
      }
      continue;
    }
    if (/^-[1AEFGHLPRSTabcdfhilmnprstuvwx]+$/u.test(value)) continue;
    addUnresolved(analysis, 'unsupported-option');
  }
  return Object.freeze(operands);
}

function scanPowerShellOperands(
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
): readonly string[] {
  const operands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    const name = value.toLowerCase();
    if (!name.startsWith('-')) {
      operands.push(value);
      continue;
    }
    if (COMMON_POWERSHELL_SWITCHES.has(name)) continue;
    if (
      COMMON_POWERSHELL_PATH_PARAMETERS.has(name)
      || COMMON_POWERSHELL_IGNORED_VALUE_PARAMETERS.has(name)
    ) {
      index += 1;
      if (index >= args.length) {
        addUnresolved(analysis, 'missing-option-value');
      } else if (COMMON_POWERSHELL_PATH_PARAMETERS.has(name)) {
        operands.push(args[index].value);
      }
      continue;
    }
    addUnresolved(analysis, 'unsupported-option');
  }
  return Object.freeze(operands);
}

function pathOperands(
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
): readonly string[] {
  return dialect === 'powershell'
    ? scanPowerShellOperands(args, analysis)
    : scanPosixOperands(args, analysis);
}

function hasCompactPosixOption(value: string, option: string): boolean {
  return /^-[^-]/u.test(value) && value.slice(1).includes(option);
}

function copyMoveOperands(
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
): CopyMoveOperands {
  if (dialect === 'powershell') {
    const positional: string[] = [];
    const explicitSources: string[] = [];
    const explicitDestinations: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index].value;
      const name = value.toLowerCase();
      if (!name.startsWith('-')) {
        positional.push(value);
        continue;
      }
      if (COMMON_POWERSHELL_SWITCHES.has(name)) continue;
      if (
        COMMON_POWERSHELL_PATH_PARAMETERS.has(name)
        || COMMON_POWERSHELL_IGNORED_VALUE_PARAMETERS.has(name)
      ) {
        index += 1;
        if (index >= args.length) {
          addUnresolved(analysis, 'missing-option-value');
        } else if (name === '-destination') {
          explicitDestinations.push(args[index].value);
        } else if (name === '-path' || name === '-literalpath') {
          explicitSources.push(args[index].value);
        }
        continue;
      }
      addUnresolved(analysis, 'unsupported-option');
    }
    if (explicitDestinations.length > 0) {
      return Object.freeze({
        destinations: Object.freeze(explicitDestinations),
        sources: Object.freeze([...explicitSources, ...positional]),
      });
    }
    const combined = [...explicitSources, ...positional];
    return Object.freeze({
      destinations: Object.freeze(combined.slice(-1)),
      sources: Object.freeze(combined.slice(0, -1)),
    });
  }

  const operands: string[] = [];
  const targetDirectories: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    if (optionsEnded || value === '-' || !value.startsWith('-')) {
      operands.push(value);
      continue;
    }
    if (value === '--') {
      optionsEnded = true;
      continue;
    }
    const [name, inlineValue] = value.split('=', 2);
    if (name === '-t' || name === '--target-directory') {
      if (inlineValue !== undefined) {
        targetDirectories.push(inlineValue);
      } else {
        index += 1;
        if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
        else targetDirectories.push(args[index].value);
      }
      continue;
    }
    if (COMMON_POSIX_NO_VALUE_OPTIONS.has(name)) continue;
    if (COMMON_POSIX_VALUE_OPTIONS.has(name)) {
      if (inlineValue === undefined) {
        index += 1;
        if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
      }
      continue;
    }
    addUnresolved(analysis, 'unsupported-option');
  }
  if (targetDirectories.length > 0) {
    return Object.freeze({
      destinations: Object.freeze(targetDirectories),
      sources: Object.freeze(operands),
    });
  }
  return Object.freeze({
    destinations: Object.freeze(operands.slice(-1)),
    sources: Object.freeze(operands.slice(0, -1)),
  });
}

function applyOperands(
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
  logicalCwd: string,
  operands: readonly string[],
  access: PathUse['access'],
): void {
  for (const value of operands) applyPathUse(analysis, dialect, logicalCwd, { access, value });
}

function analyzeFfmpeg(
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
  logicalCwd: string,
): void {
  analysis.facets.add('filesystem.read');
  analysis.facets.add('filesystem.write');
  const noValue = new Set(['-hide_banner', '-n', '-nostdin', '-stats', '-vn', '-y']);
  const valueOptions = new Set([
    '-ac', '-af', '-ar', '-b:a', '-c', '-c:a', '-codec:a', '-f', '-loglevel', '-map', '-ss',
    '-t', '-threads', '-to',
  ]);
  const outputs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    if (value === '-i') {
      index += 1;
      if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
      else applyPathUse(analysis, dialect, logicalCwd, { access: 'read', value: args[index].value });
      continue;
    }
    if (noValue.has(value)) continue;
    if (valueOptions.has(value)) {
      index += 1;
      if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
      continue;
    }
    if (value.startsWith('-')) {
      addUnresolved(analysis, 'unsupported-option');
      continue;
    }
    outputs.push(value);
  }
  if (outputs.length === 0) addUnresolved(analysis, 'missing-output-path');
  applyOperands(analysis, dialect, logicalCwd, outputs, 'write');
}

function analyzeFfprobe(
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
  logicalCwd: string,
): void {
  analysis.facets.add('filesystem.read');
  const noValue = new Set(['-count_frames', '-count_packets', '-hide_banner', '-show_format', '-show_streams']);
  const valueOptions = new Set(['-of', '-print_format', '-select_streams', '-show_entries', '-v']);
  const inputs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].value;
    if (noValue.has(value)) continue;
    if (valueOptions.has(value)) {
      index += 1;
      if (index >= args.length) addUnresolved(analysis, 'missing-option-value');
      continue;
    }
    if (value.startsWith('-')) {
      addUnresolved(analysis, 'unsupported-option');
      continue;
    }
    inputs.push(value);
  }
  if (inputs.length === 0) addUnresolved(analysis, 'missing-input-path');
  applyOperands(analysis, dialect, logicalCwd, inputs, 'read');
}

function commandEffects(
  commandName: string,
  args: readonly StaticArgument[],
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
  logicalCwd: string,
): readonly AgentShellRiskFacet[] {
  analysis.facets.add('process_launch');

  if (
    dialect !== 'powershell'
    && (COPY_PATH_COMMANDS.has(commandName)
      || MOVE_PATH_COMMANDS.has(commandName)
      || DELETE_PATH_COMMANDS.has(commandName))
    && args.some(({ value }) => (
      value === '--interactive'
      || (value.startsWith('--interactive=') && value !== '--interactive=never')
      || hasCompactPosixOption(value, 'i')
      || (DELETE_PATH_COMMANDS.has(commandName) && value === '-I')
    ))
  ) {
    analysis.facets.add('interactive');
  }

  if (
    dialect !== 'powershell'
    && COPY_PATH_COMMANDS.has(commandName)
    && args.some(({ value }) => (
      COPY_LINK_OPTIONS.has(value)
      || hasCompactPosixOption(value, 'l')
      || hasCompactPosixOption(value, 's')
    ))
  ) {
    addUnresolved(analysis, 'link-creation');
  }

  if (PRIVILEGE_COMMANDS.has(commandName)) {
    analysis.facets.add('privilege_escalation');
  } else if (DETACHED_COMMANDS.has(commandName)) {
    analysis.facets.add('detached');
  } else if (INTERACTIVE_COMMANDS.has(commandName)) {
    analysis.facets.add('interactive');
  } else if (NESTED_SHELL_COMMANDS.has(commandName)) {
    analysis.facets.add('nested_shell');
    addUnresolved(analysis, 'nested-command-language');
  } else if (NETWORK_COMMANDS.has(commandName)) {
    analysis.facets.add('network');
    analysis.facets.add('external_path');
    analysis.boundaryVerified = false;
  } else if (PACKAGE_COMMANDS.has(commandName)) {
    analysis.facets.add('package_install');
    analysis.facets.add('external_path');
    analysis.boundaryVerified = false;
  } else if (SYSTEM_CONFIGURATION_COMMANDS.has(commandName)) {
    analysis.facets.add('system_configuration');
    analysis.facets.add('external_path');
    analysis.boundaryVerified = false;
  } else if (PATHLESS_COMMANDS.has(commandName)) {
    // Static arguments are data, not paths.
  } else if (READ_PATH_COMMANDS.has(commandName)) {
    analysis.facets.add('filesystem.read');
    applyOperands(
      analysis,
      dialect,
      logicalCwd,
      pathOperands(args, analysis, dialect),
      'read',
    );
  } else if (WRITE_PATH_COMMANDS.has(commandName)) {
    analysis.facets.add('filesystem.write');
    applyOperands(
      analysis,
      dialect,
      logicalCwd,
      pathOperands(args, analysis, dialect),
      'write',
    );
  } else if (DELETE_PATH_COMMANDS.has(commandName)) {
    analysis.facets.add('filesystem.delete');
    applyOperands(
      analysis,
      dialect,
      logicalCwd,
      pathOperands(args, analysis, dialect),
      'delete',
    );
  } else if (COPY_PATH_COMMANDS.has(commandName) || MOVE_PATH_COMMANDS.has(commandName)) {
    const operands = copyMoveOperands(args, analysis, dialect);
    if (operands.sources.length === 0 || operands.destinations.length === 0) {
      addUnresolved(analysis, 'missing-path-operand');
    }
    analysis.facets.add('filesystem.read');
    analysis.facets.add('filesystem.write');
    applyOperands(analysis, dialect, logicalCwd, operands.sources, 'read');
    applyOperands(analysis, dialect, logicalCwd, operands.destinations, 'write');
    if (MOVE_PATH_COMMANDS.has(commandName)) {
      analysis.facets.add('filesystem.delete');
      applyOperands(analysis, dialect, logicalCwd, operands.sources, 'delete');
    }
  } else if (commandName === 'ffmpeg') {
    analyzeFfmpeg(args, analysis, dialect, logicalCwd);
  } else if (commandName === 'ffprobe') {
    analyzeFfprobe(args, analysis, dialect, logicalCwd);
  } else if (commandName === 'cd' || commandName === 'set-location' || commandName === 'push-location') {
    analysis.facets.add('environment_change');
    addUnresolved(analysis, 'working-directory-mutation');
  } else {
    addUnresolved(analysis, 'unsupported-command');
  }

  return Object.freeze(FACET_ORDER.filter(facet => analysis.facets.has(facet)));
}

function mergeCommandAnalysis(
  target: MutableAnalysis,
  source: MutableAnalysis,
): void {
  for (const facet of source.facets) target.facets.add(facet);
  for (const reason of source.unresolved) target.unresolved.add(reason);
  if (!source.boundaryVerified) target.boundaryVerified = false;
}

function analyzeRedirections(
  nodes: readonly Node[],
  analysis: MutableAnalysis,
  dialect: AgentShellDialect,
  logicalCwd: string,
): void {
  const redirectType = dialect === 'powershell' ? 'redirection' : 'file_redirect';
  for (const redirect of nodes.filter(node => node.type === redirectType)) {
    analysis.facets.add('redirection');
    const destination = dialect === 'powershell'
      ? redirect.descendantsOfType(['generic_token', 'string_literal']).at(-1) || null
      : redirect.childForFieldName('destination');
    if (!destination || destination.type === 'number') continue;
    const value = decodeStaticNode(destination, dialect);
    if (value === null) {
      addUnresolved(analysis, 'dynamic-redirection');
      continue;
    }
    const access: PathUse['access'] = dialect === 'powershell'
      ? 'write'
      : redirect.text.includes('<') && !redirect.text.includes('>')
        ? 'read'
        : 'write';
    analysis.facets.add(access === 'read' ? 'filesystem.read' : 'filesystem.write');
    applyPathUse(analysis, dialect, logicalCwd, { access, value });
  }
}

function riskFor(
  facets: ReadonlySet<AgentShellRiskFacet>,
  unresolved: ReadonlySet<string>,
): AgentShellRisk {
  if (
    unresolved.size > 0
    || facets.has('detached')
    || facets.has('filesystem.delete')
    || facets.has('interactive')
    || facets.has('privilege_escalation')
    || facets.has('system_configuration')
  ) return 'destructive';
  if (
    facets.has('external_path')
    || facets.has('network')
    || facets.has('package_install')
  ) return 'external';
  if (facets.has('environment_change') || facets.has('filesystem.write')) return 'write';
  return 'read';
}

function operation(
  commandName: string,
  args: readonly StaticArgument[],
  effects: readonly AgentShellRiskFacet[],
): AgentShellPreparedOperation {
  return Object.freeze({
    argvPrefix: Object.freeze(
      args.slice(0, MAX_OPERATION_PREFIX - 1).map(argument => argument.value),
    ),
    effects: Object.freeze([...effects]),
    executable: commandName,
  });
}

async function analyzeCommand(
  input: AgentShellCommandAnalysisInput,
): Promise<AgentShellCommandAnalysis> {
  const runtime = await analyzerRuntime();
  const parser = new TreeSitter.Parser();
  let tree: ReturnType<InstanceType<typeof TreeSitter.Parser>['parse']> | null = null;
  try {
    parser.setLanguage(input.dialect === 'powershell' ? runtime.powershell : runtime.bash);
    tree = parser.parse(input.command);
    if (!tree) throw new Error('Agent Shell AST 解析失败');
    const nodes = allNodes(tree.rootNode);
    const analysis: MutableAnalysis = {
      boundaryVerified: true,
      facets: new Set<AgentShellRiskFacet>(),
      operations: [],
      unresolved: new Set<string>(),
    };
    if (tree.rootNode.hasError || nodes.some(node => node.isError || node.isMissing)) {
      addUnresolved(analysis, 'syntax-error');
    }
    const allowedNodes = input.dialect === 'powershell'
      ? POWERSHELL_ALLOWED_NAMED_NODES
      : BASH_ALLOWED_NAMED_NODES;
    const dynamicNodes = input.dialect === 'powershell'
      ? POWERSHELL_DYNAMIC_NODE_TYPES
      : BASH_DYNAMIC_NODE_TYPES;
    for (const node of nodes) {
      if (!node.isNamed) {
        if (node.type === '&') analysis.facets.add('detached');
        continue;
      }
      const dynamicFacet = dynamicNodes.get(node.type);
      if (dynamicFacet) {
        analysis.facets.add(dynamicFacet);
        addUnresolved(analysis, `dynamic-${node.type}`);
      }
      if (!allowedNodes.has(node.type)) addUnresolved(analysis, `unsupported-${node.type}`);
      if (node.type === 'variable_assignment') analysis.facets.add('environment_change');
      if (node.type === 'command_invokation_operator') {
        analysis.facets.add('dynamic_command_head');
        addUnresolved(analysis, 'dynamic-command-head');
      }
    }
    if (input.hasEnvironmentOverrides) analysis.facets.add('environment_change');

    const commands = nodes.filter(node => node.type === 'command');
    if (commands.length === 0) addUnresolved(analysis, 'no-command');
    if (commands.length > MAX_OPERATIONS) addUnresolved(analysis, 'operation-limit-exceeded');
    for (const commandNode of commands.slice(0, MAX_OPERATIONS)) {
      const nameNode = input.dialect === 'powershell'
        ? commandNode.childForFieldName('command_name')
        : commandNode.childForFieldName('name');
      const staticCommandName = nameNode
        ? decodeStaticNode(nameNode, input.dialect)
        : null;
      const commandName = staticCommandName
        ? normalizeCommandName(staticCommandName, input.dialect)
        : null;
      if (!commandName) {
        const restrictedFacet = staticCommandName
          ? restrictedCommandFacet(staticCommandName, input.dialect)
          : null;
        if (restrictedFacet) analysis.facets.add(restrictedFacet);
        analysis.facets.add('dynamic_command_head');
        addUnresolved(analysis, 'dynamic-command-head');
        continue;
      }
      let args: readonly StaticArgument[] = Object.freeze([]);
      const commandAnalysis: MutableAnalysis = {
        boundaryVerified: true,
        facets: new Set<AgentShellRiskFacet>(),
        operations: [],
        unresolved: new Set<string>(),
      };
      try {
        args = commandArguments(commandNode, input.dialect);
      } catch {
        addUnresolved(commandAnalysis, 'dynamic-argument');
      }
      const effects = commandEffects(
        commandName,
        args,
        commandAnalysis,
        input.dialect,
        input.logicalCwd,
      );
      mergeCommandAnalysis(analysis, commandAnalysis);
      analysis.operations.push(operation(commandName, args, effects));
    }
    analyzeRedirections(nodes, analysis, input.dialect, input.logicalCwd);

    const unresolved = Object.freeze([...analysis.unresolved].sort());
    const facets = Object.freeze(FACET_ORDER.filter(facet => analysis.facets.has(facet)));
    const workspaceBoundaryVerified = analysis.boundaryVerified && unresolved.length === 0;
    const persistentRuleEligible = input.persistentRuleEligible
      && workspaceBoundaryVerified
      && !facets.some(facet => (
        facet === 'environment_change'
        || facet === 'external_path'
        || facet === 'network'
        || facet === 'package_install'
        || facet === 'system_configuration'
      ));
    const assessment: AgentShellPreparedAssessment = Object.freeze({
      facets,
      operations: Object.freeze([...analysis.operations]),
      persistentRuleEligible,
      risk: riskFor(analysis.facets, analysis.unresolved),
      unresolved,
    });
    const analysisIdentity = unresolved.length === 0
      ? hashIdentity('omniflow.agent.shell.command-analysis-v1', {
          analyzerRevision: AGENT_SHELL_COMMAND_ANALYZER_REVISION,
          assessment,
          command: input.command,
          dialect: input.dialect,
          logicalCwd: input.logicalCwd,
          providerAnalyzerRevision: input.providerAnalyzerRevision,
          workspaceBoundaryVerified,
        })
      : null;
    return Object.freeze({
      analysisIdentity,
      analyzerRevision: AGENT_SHELL_COMMAND_ANALYZER_REVISION,
      assessment,
      workspaceBoundaryVerified,
    });
  } finally {
    tree?.delete();
    parser.delete();
  }
}

export function createAgentShellCommandAnalyzer() {
  return Object.freeze({ analyze: analyzeCommand });
}

export type AgentShellCommandAnalyzer = ReturnType<typeof createAgentShellCommandAnalyzer>;
