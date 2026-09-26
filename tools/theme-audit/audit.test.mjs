import { describe, expect, it } from 'vitest';
import { analyzeThemeSources } from './audit.mjs';

describe('theme source audit', () => {
  it('finds missing variables even when a fallback hides the mistake, and resolves token maps and local declarations', () => {
    const report = analyzeThemeSources([
      { file: 'src/features/appearance/color-theme.ts', text: "const COLOR_CSS_VARIABLES = Object.freeze({ 'text.primary': '--app-text' });" },
      { file: 'src/example.tsx', text: "const Box = styled.div`--app-local: var(--app-text); color: var(--app-local); background: var(--app-bg-typo, #fff);`;" },
    ]);
    expect(report.unresolved).toEqual([{ file: 'src/example.tsx', name: '--app-bg-typo', line: 1, fallback: true }]);
  });

  it('ignores source comments and dynamic variable names instead of reporting guessed references', () => {
    const report = analyzeThemeSources([
      { file: 'src/example.tsx', text: '// var(--app-comment) #fff\nconst Box = styled.div`color: var(--app-${tone}-text); background: var(--app-status-${tone}); border-color: var(--app-syntax-${kind}, red);`;' },
      { file: 'src/example.less', text: '/* var(--app-comment) #fff */\n// var(--app-other)\n.a { color: var(--app-missing); }' },
    ]);
    expect(report.unresolved).toEqual([{ file: 'src/example.less', name: '--app-missing', line: 3, fallback: false }]);
    expect(report.files.flatMap(file => file.literalColors)).toEqual([]);
  });

  it('recognizes runtime setProperty definitions, fallback references, and direct value imports', () => {
    const report = analyzeThemeSources([
      { file: 'src/example.tsx', text: "import { ThemeButton } from '@/components/ui/theme-foundation';\nbody.style.setProperty('--app-runtime', value);\nconst inline = { color: 'var(--app-runtime, var(--app-absent))' };" },
    ]);
    expect(report.unresolved).toEqual([{ file: 'src/example.tsx', name: '--app-absent', line: 3, fallback: false }]);
    expect(report.files[0].sharedEntrypoints).toEqual(['@/components/ui/theme-foundation']);
  });

  it('ignores comments inside style templates without swallowing declarations after URLs', () => {
    const report = analyzeThemeSources([
      { file: 'src/example.tsx', text: 'const Box = styled.div`\n/* var(--app-comment) #fff */\ncolor: var(--app-missing);\n`;' },
      { file: 'src/example.less', text: '.a { background: url(https://example.test/image.png); color: var(--app-after-url); }\n.b { background: url(//example.test/image.png); color: var(--app-after-relative-url); }\n// --app-missing: #fff;' },
    ]);
    expect(report.unresolved).toEqual([
      { file: 'src/example.less', name: '--app-after-url', line: 1, fallback: false },
      { file: 'src/example.less', name: '--app-after-relative-url', line: 2, fallback: false },
      { file: 'src/example.tsx', name: '--app-missing', line: 3, fallback: false },
    ]);
    expect(report.files.flatMap(file => file.literalColors)).toEqual([]);
  });

  it('preserves comments across interpolations and inspects real references inside expressions', () => {
    const report = analyzeThemeSources([
      { file: 'src/example.tsx', text: 'const Box = styled.div`\n/* ${value} var(--app-comment) */\ncolor: ${active ? "var(--app-active)" : "var(--app-rest)"};\nbackground: var(--app-missing);\n`;' },
    ]);
    expect(report.unresolved).toEqual([
      { file: 'src/example.tsx', name: '--app-missing', line: 4, fallback: false },
      { file: 'src/example.tsx', name: '--app-active', line: 3, fallback: false },
      { file: 'src/example.tsx', name: '--app-rest', line: 3, fallback: false },
    ]);
  });

  it('does not count type imports as consumers or arbitrary strings as CSS declarations', () => {
    const report = analyzeThemeSources([
      { file: 'src/example.tsx', text: 'import { type ThemeSurfaceRole } from "@/components/ui/theme-foundation-styles";\nconst description = "--app-missing: description";\nconst color = "var(--app-missing)";' },
    ]);
    expect(report.files[0].sharedEntrypoints).toEqual([]);
    expect(report.unresolved).toEqual([{ file: 'src/example.tsx', name: '--app-missing', line: 3, fallback: false }]);
  });
});
