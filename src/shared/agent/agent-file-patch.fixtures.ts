import type { AgentFileFinalNewline } from './agent-file-patch-types';

/** Shared byte fixtures for core, library and host tests; never imported by production modules. */
export interface AgentFilePatchEofFixture {
  name: string;
  before: string;
  patch?: string;
  /** The reconstructed body for fixtures that deliberately do not exercise a production hunk. */
  reconstructed?: string;
  coreOnly?: boolean;
  expectedErrorCode?: string;
  expected: Record<AgentFileFinalNewline, string | null>;
}
export const AGENT_FILE_PATCH_EOF_FIXTURES: AgentFilePatchEofFixture[] = [
  { name: 'explicit EOF policies apply even when only the first line changes', before: 'a\nb', patch: '@@\n-a\n+A\n',
    expected: { preserve: 'A\nb', ensure: 'A\nb\n', remove: 'A\nb' } },
  { name: 'explicit remove also applies to an untouched terminated final line', before: 'a\nb\n', patch: '@@\n-a\n+A\n',
    expected: { preserve: 'A\nb\n', ensure: 'A\nb\n', remove: 'A\nb' } },
  { name: 'deleting an unterminated last line keeps the preceding empty line', before: 'a\n\nb', patch: '@@\n-b\n*** End of File\n',
    expected: { preserve: 'a\n\n', ensure: 'a\n\n', remove: null } },
  { name: 'deleting the last nonempty line preserves the surviving separator', before: 'a\nb', patch: '@@\n-b\n*** End of File\n',
    expected: { preserve: 'a\n', ensure: 'a\n', remove: 'a' } },
  { name: 'appending a nonempty line inherits the original unterminated EOF', before: 'a', patch: '@@\n+b\n',
    expected: { preserve: 'a\nb', ensure: 'a\nb\n', remove: 'a\nb' } },
  { name: 'appending a real empty line does not serialize it away', before: 'a', patch: '@@\n+\n',
    expected: { preserve: 'a\n\n', ensure: 'a\n\n', remove: null } },
  { name: 'EOF core never strips an existing empty final line implicitly', before: 'a\n\n', reconstructed: 'a\n\n', coreOnly: true,
    expected: { preserve: 'a\n\n', ensure: 'a\n\n', remove: null } },
  { name: 'explicit deletion permits removing the surviving nonempty ending', before: 'a\n\n', patch: '@@\n-\n*** End of File\n',
    expected: { preserve: 'a\n', ensure: 'a\n', remove: 'a' } },
  { name: 'CRLF empty-line boundaries are retained', before: 'a\r\n\r\nb', patch: '@@\n-b\n*** End of File\n',
    expected: { preserve: 'a\r\n\r\n', ensure: 'a\r\n\r\n', remove: null } },
  { name: 'ensure inherits CRLF while modifying an earlier line', before: 'a\r\nb', patch: '@@\n-a\n+A\n',
    expected: { preserve: 'A\r\nb', ensure: 'A\r\nb\r\n', remove: 'A\r\nb' } },
  { name: 'zero logical lines stay empty under every EOF policy', before: '', reconstructed: '', coreOnly: true,
    expected: { preserve: '', ensure: '', remove: '' } },
  { name: 'BOM-only text has zero logical content lines', before: '\uFEFF', reconstructed: '\uFEFF', coreOnly: true,
    expected: { preserve: '\uFEFF', ensure: '\uFEFF', remove: '\uFEFF' } },
  { name: 'insertion into empty text defaults to LF', before: '', patch: '@@\n+x\n',
    expected: { preserve: 'x\n', ensure: 'x\n', remove: 'x' } },
  { name: 'deleting all content retains only the independent BOM', before: '\uFEFFa', patch: '@@\n-a\n',
    expected: { preserve: '\uFEFF', ensure: '\uFEFF', remove: '\uFEFF' } },
  { name: 'replacement empty lines cannot merge generated CR and LF endings', before: 'row-0\rrow-1\n',
    patch: '@@\n-row-0\n-row-1\n+x\n+\n',
    expected: { preserve: 'x\r\n\n', ensure: 'x\r\n\n', remove: null } },
  { name: 'new empty LF after a retained CR keeps the retained bytes and both logical lines', before: 'a\rb\nc\n',
    patch: '@@\n-b\n+\n',
    expected: { preserve: 'a\r\r\nc\n', ensure: 'a\r\r\nc\n', remove: 'a\r\r\nc' } },
  { name: 'generated CR before a retained empty LF extends only the generated ending', before: 'a\rx\n\n',
    patch: '@@\n-a\n-x\n+A\n',
    expected: { preserve: 'A\r\n\n', ensure: 'A\r\n\n', remove: null } },
  { name: 'deletion cannot merge retained CR and empty LF lines', before: 'a\rx\n\n', patch: '@@\n-x\n',
    expectedErrorCode: 'PATCH_LINE_ENDING_CONFLICT', expected: { preserve: null, ensure: null, remove: null } },
  { name: 'deletion between retained CR and a nonempty LF line keeps exact source endings', before: 'a\rx\nb\n',
    patch: '@@\n-x\n', expected: { preserve: 'a\rb\n', ensure: 'a\rb\n', remove: 'a\rb' } },
];
