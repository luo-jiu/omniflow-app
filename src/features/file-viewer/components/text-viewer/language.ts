import type { Extension } from '@codemirror/state';
import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { xml } from '@codemirror/lang-xml';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { sql, MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { r } from '@codemirror/legacy-modes/mode/r';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { kotlin } from '@codemirror/legacy-modes/mode/clike';
import { less, sCSS } from '@codemirror/legacy-modes/mode/css';
import { sass } from '@codemirror/legacy-modes/mode/sass';
import { stylus } from '@codemirror/legacy-modes/mode/stylus';
import { normalizeFileExtension } from '@/utils/preview-file-type';

export type TextEditorHighlightSource = 'lezer' | 'legacy' | 'plain';

export interface TextEditorLanguage {
  key: string;
  label: string;
  source: TextEditorHighlightSource;
  extension: Extension | null;
}

interface LanguageDefinition {
  key: string;
  label: string;
  source: TextEditorHighlightSource;
  extensions?: string[];
  fileNames?: string[];
  createExtension?: () => Extension;
}

const legacy = (parser: StreamParser<unknown>) => StreamLanguage.define(parser);

const LANGUAGE_DEFINITIONS: LanguageDefinition[] = [
  {
    key: 'javascript',
    label: 'JavaScript',
    source: 'lezer',
    extensions: ['js', 'mjs', 'cjs'],
    createExtension: () => javascript(),
  },
  {
    key: 'jsx',
    label: 'JSX',
    source: 'lezer',
    extensions: ['jsx'],
    createExtension: () => javascript({ jsx: true }),
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    source: 'lezer',
    extensions: ['ts', 'mts', 'cts'],
    createExtension: () => javascript({ typescript: true }),
  },
  {
    key: 'tsx',
    label: 'TSX',
    source: 'lezer',
    extensions: ['tsx'],
    createExtension: () => javascript({ jsx: true, typescript: true }),
  },
  {
    key: 'json',
    label: 'JSON',
    source: 'lezer',
    extensions: ['json', 'json5', 'jsonc'],
    createExtension: () => json(),
  },
  {
    key: 'markdown',
    label: 'Markdown',
    source: 'lezer',
    extensions: ['md', 'markdown', 'mdx'],
    createExtension: () => markdown(),
  },
  {
    key: 'html',
    label: 'HTML',
    source: 'lezer',
    extensions: ['html', 'htm', 'vue', 'svelte'],
    createExtension: () => html(),
  },
  {
    key: 'css',
    label: 'CSS',
    source: 'lezer',
    extensions: ['css'],
    createExtension: () => css(),
  },
  {
    key: 'scss',
    label: 'SCSS',
    source: 'legacy',
    extensions: ['scss'],
    createExtension: () => legacy(sCSS),
  },
  {
    key: 'sass',
    label: 'Sass',
    source: 'legacy',
    extensions: ['sass'],
    createExtension: () => legacy(sass),
  },
  {
    key: 'less',
    label: 'Less',
    source: 'legacy',
    extensions: ['less'],
    createExtension: () => legacy(less),
  },
  {
    key: 'stylus',
    label: 'Stylus',
    source: 'legacy',
    extensions: ['styl', 'stylus'],
    createExtension: () => legacy(stylus),
  },
  {
    key: 'xml',
    label: 'XML',
    source: 'lezer',
    extensions: ['xml', 'svg', 'xhtml'],
    createExtension: () => xml(),
  },
  {
    key: 'python',
    label: 'Python',
    source: 'lezer',
    extensions: ['py', 'pyw'],
    createExtension: () => python(),
  },
  {
    key: 'go',
    label: 'Go',
    source: 'lezer',
    extensions: ['go'],
    createExtension: () => go(),
  },
  {
    key: 'rust',
    label: 'Rust',
    source: 'lezer',
    extensions: ['rs'],
    createExtension: () => rust(),
  },
  {
    key: 'java',
    label: 'Java',
    source: 'lezer',
    extensions: ['java'],
    createExtension: () => java(),
  },
  {
    key: 'kotlin',
    label: 'Kotlin',
    source: 'legacy',
    extensions: ['kt', 'kts'],
    createExtension: () => legacy(kotlin),
  },
  {
    key: 'cpp',
    label: 'C++',
    source: 'lezer',
    extensions: ['c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'hxx'],
    createExtension: () => cpp(),
  },
  {
    key: 'sql',
    label: 'SQL',
    source: 'lezer',
    extensions: ['sql'],
    createExtension: () => sql(),
  },
  {
    key: 'postgresql',
    label: 'PostgreSQL',
    source: 'lezer',
    extensions: ['pgsql', 'psql'],
    createExtension: () => sql({ dialect: PostgreSQL }),
  },
  {
    key: 'mysql',
    label: 'MySQL',
    source: 'lezer',
    extensions: ['mysql'],
    createExtension: () => sql({ dialect: MySQL }),
  },
  {
    key: 'sqlite',
    label: 'SQLite',
    source: 'lezer',
    extensions: ['sqlite'],
    createExtension: () => sql({ dialect: SQLite }),
  },
  {
    key: 'yaml',
    label: 'YAML',
    source: 'lezer',
    extensions: ['yaml', 'yml'],
    createExtension: () => yaml(),
  },
  {
    key: 'php',
    label: 'PHP',
    source: 'lezer',
    extensions: ['php', 'phtml'],
    createExtension: () => php(),
  },
  {
    key: 'shell',
    label: 'Shell',
    source: 'legacy',
    extensions: ['sh', 'bash', 'zsh', 'fish', 'bats'],
    fileNames: ['.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile'],
    createExtension: () => legacy(shell),
  },
  {
    key: 'powershell',
    label: 'PowerShell',
    source: 'legacy',
    extensions: ['ps1', 'psm1', 'psd1'],
    createExtension: () => legacy(powerShell),
  },
  {
    key: 'dockerfile',
    label: 'Dockerfile',
    source: 'legacy',
    extensions: ['dockerfile'],
    fileNames: ['dockerfile', 'containerfile'],
    createExtension: () => legacy(dockerFile),
  },
  {
    key: 'ini',
    label: 'Config',
    source: 'legacy',
    extensions: ['ini', 'cfg', 'conf', 'properties', 'editorconfig', 'env'],
    fileNames: ['.env', '.env.local', '.env.development', '.env.production', '.editorconfig'],
    createExtension: () => legacy(properties),
  },
  {
    key: 'toml',
    label: 'TOML',
    source: 'legacy',
    extensions: ['toml'],
    createExtension: () => legacy(toml),
  },
  {
    key: 'ruby',
    label: 'Ruby',
    source: 'legacy',
    extensions: ['rb', 'rake', 'gemspec'],
    fileNames: ['gemfile', 'rakefile'],
    createExtension: () => legacy(ruby),
  },
  {
    key: 'perl',
    label: 'Perl',
    source: 'legacy',
    extensions: ['pl', 'pm', 'pod'],
    createExtension: () => legacy(perl),
  },
  {
    key: 'lua',
    label: 'Lua',
    source: 'legacy',
    extensions: ['lua'],
    createExtension: () => legacy(lua),
  },
  {
    key: 'diff',
    label: 'Diff',
    source: 'legacy',
    extensions: ['diff', 'patch'],
    createExtension: () => legacy(diff),
  },
  {
    key: 'nginx',
    label: 'Nginx',
    source: 'legacy',
    extensions: ['nginx'],
    fileNames: ['nginx.conf'],
    createExtension: () => legacy(nginx),
  },
  {
    key: 'protobuf',
    label: 'Protocol Buffers',
    source: 'legacy',
    extensions: ['proto'],
    createExtension: () => legacy(protobuf),
  },
  {
    key: 'swift',
    label: 'Swift',
    source: 'legacy',
    extensions: ['swift'],
    createExtension: () => legacy(swift),
  },
  {
    key: 'r',
    label: 'R',
    source: 'legacy',
    extensions: ['r', 'rmd'],
    createExtension: () => legacy(r),
  },
  {
    key: 'cmake',
    label: 'CMake',
    source: 'legacy',
    extensions: ['cmake'],
    fileNames: ['cmakelists.txt'],
    createExtension: () => legacy(cmake),
  },
];

const FILE_NAME_MAP = new Map<string, LanguageDefinition>();
const EXTENSION_MAP = new Map<string, LanguageDefinition>();

LANGUAGE_DEFINITIONS.forEach((definition) => {
  definition.fileNames?.forEach((fileName) => {
    FILE_NAME_MAP.set(fileName, definition);
  });
  definition.extensions?.forEach((extension) => {
    EXTENSION_MAP.set(extension, definition);
  });
});

const PLAIN_TEXT_LABELS: Record<string, string> = {
  txt: 'Text',
  text: 'Text',
  log: 'Log',
  csv: 'CSV',
  tsv: 'TSV',
  lrc: 'LRC',
  srt: 'SRT',
  vtt: 'WebVTT',
  ass: 'ASS',
  ssa: 'SSA',
  gitignore: 'Git Ignore',
  dockerignore: 'Docker Ignore',
};

function getBaseName(fileName?: string | null): string {
  return String(fileName || '')
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .toLowerCase() || '';
}

function getExtension(baseName: string): string {
  if (!baseName) return '';
  if (baseName.startsWith('.env')) return 'env';
  if (baseName.startsWith('.') && !baseName.slice(1).includes('.')) {
    return normalizeFileExtension(baseName.slice(1));
  }
  return normalizeFileExtension(baseName.split('.').pop());
}

export function resolveTextEditorLanguage(fileName?: string | null): TextEditorLanguage {
  const baseName = getBaseName(fileName);
  const exactDefinition = FILE_NAME_MAP.get(baseName)
    || (baseName.startsWith('dockerfile.') ? FILE_NAME_MAP.get('dockerfile') : undefined);
  const extension = getExtension(baseName);
  const definition = exactDefinition || EXTENSION_MAP.get(extension);

  if (definition) {
    return {
      key: definition.key,
      label: definition.label,
      source: definition.source,
      extension: definition.createExtension?.() || null,
    };
  }

  return {
    key: extension || 'text',
    label: PLAIN_TEXT_LABELS[extension] || 'Text',
    source: 'plain',
    extension: null,
  };
}
