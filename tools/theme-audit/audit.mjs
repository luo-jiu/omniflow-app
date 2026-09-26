import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.less']);
const variableName = /^--app-[\w-]+$/;
const colorLiteral = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi;

function family(file) {
  if (file.startsWith('src/features/appearance/') || file.startsWith('src/assets/')) return '主题与静态资产';
  if (file.startsWith('src/components/ui/')) return '通用 UI';
  if (file.startsWith('src/features/archive-viewer/')) return '归档卡片';
  if (file.startsWith('src/features/file-viewer/') || file.startsWith('src/features/audio-viewer/')) return '阅读与媒体';
  if (file.startsWith('src/features/agent/')) return 'Agent';
  if (file.startsWith('src/features/tool-workspace/')) return '工具工作区';
  if (file.startsWith('src/features/plugin-')) return '插件宿主';
  if (file.startsWith('src/overlay/')) return '独立浮窗';
  if (file.startsWith('src/features/embedded-browser/')) return '内置浏览器';
  if (file.startsWith('src/features/file-explorer/') || file.startsWith('src/views/library/')) return '资源库与文件树';
  if (file.startsWith('src/views/') || file.startsWith('src/features/system-workspace/')) return '设置与管理页面';
  return '其他共享与业务模块';
}

// Keep source offsets intact. A URL or quoted CSS value is not a comment.
function maskStyleComments(text) {
  return text.replace(
    /url\((?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^)])*\)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\/|(?<![:\w/])\/\/[^\r\n]*/gi,
    match => match.startsWith('/*') || match.startsWith('//') ? match.replace(/[^\r\n]/g, ' ') : match,
  );
}

// A non-name sentinel prevents a dynamic suffix from looking like a static name.
const maskInterpolation = text => text.replace(/[^\r\n]/g, '?');

function scanSource({ file, text }) {
  const definitions = new Set();
  const fragments = [];
  const sharedEntrypoints = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (/\.(css|less)$/.test(file)) {
    fragments.push({ text, start: 0, style: true });
  } else {
    const visit = node => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        const entry = node.moduleSpecifier.text;
        const clause = node.importClause;
        const onlyNamedTypes = !clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.every(element => element.isTypeOnly);
        if (!onlyNamedTypes && /\/(?:theme-foundation(?:-styles)?|context-menu|menu-content|workspace-scrollbar)(?:\/index)?$/.test(entry)) sharedEntrypoints.push(entry);
      }
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && variableName.test(node.name.text)) definitions.add(node.name.text);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setProperty') {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first) && variableName.test(first.text)) definitions.add(first.text);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'COLOR_CSS_VARIABLES' && node.initializer) {
        const readMap = child => {
          if (ts.isStringLiteral(child) && variableName.test(child.text)) definitions.add(child.text);
          ts.forEachChild(child, readMap);
        };
        readMap(node.initializer);
      }
      if (ts.isTemplateExpression(node)) {
        // Scan one template so a CSS comment can span interpolations. Visit the
        // JS expressions separately, without guessing their rendered CSS value.
        const start = node.getStart(source) + 1;
        let cursor = start;
        let literal = node.head;
        let template = '';
        for (const span of node.templateSpans) {
          const expressionStart = literal.end - 2;
          const expressionEnd = span.literal.getStart(source) + 1;
          template += text.slice(cursor, expressionStart) + maskInterpolation(text.slice(expressionStart, expressionEnd));
          cursor = expressionEnd;
          literal = span.literal;
        }
        template += text.slice(cursor, node.end - 1);
        fragments.push({ text: template, start, style: true });
        for (const span of node.templateSpans) visit(span.expression);
        return;
      }
      if (ts.isStringLiteralLike(node)) {
        const start = node.getStart(source) + 1;
        fragments.push({ text: text.slice(start, node.end - 1), start, style: ts.isNoSubstitutionTemplateLiteral(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const variables = [];
  const literalColors = [];
  let semiReferences = 0;
  for (const fragment of fragments) {
    const styleText = maskStyleComments(fragment.text);
    if (fragment.style) {
      for (const match of styleText.matchAll(/(--app-[\w-]+)\s*:/g)) definitions.add(match[1]);
    }
    for (const match of styleText.matchAll(/var\(\s*(--app-[\w-]+)\s*([,)])/g)) {
      variables.push({ name: match[1], line: source.getLineAndCharacterOfPosition(fragment.start + match.index).line + 1, fallback: match[2] === ',' });
    }
    semiReferences += [...styleText.matchAll(/var\(\s*--semi-[\w-]+/g)].length;
    for (const match of styleText.matchAll(colorLiteral)) {
      literalColors.push({ value: match[0], line: source.getLineAndCharacterOfPosition(fragment.start + match.index).line + 1 });
    }
  }
  return { file, family: family(file), variables, literalColors, semiReferences, sharedEntrypoints: [...new Set(sharedEntrypoints)].sort(), definitions: [...definitions].sort() };
}

/** Static evidence only: import counts and literal colors do not establish visual coverage. */
export function analyzeThemeSources(sources) {
  const files = sources.map(scanSource).sort((a, b) => a.file.localeCompare(b.file));
  const definitions = new Set(files.flatMap(file => file.definitions));
  const unresolved = files.flatMap(file => file.variables.filter(item => !definitions.has(item.name)).map(item => ({ file: file.file, ...item })));
  const groups = new Map();
  for (const file of files) {
    if (!file.variables.length && !file.literalColors.length && !file.semiReferences && !file.sharedEntrypoints.length) continue;
    const current = groups.get(file.family) ?? { family: file.family, files: 0, appReferences: 0, semiReferences: 0, sharedFiles: 0, literalColors: 0 };
    current.files += 1;
    current.appReferences += file.variables.length;
    current.semiReferences += file.semiReferences;
    current.sharedFiles += Number(file.sharedEntrypoints.length > 0);
    current.literalColors += file.literalColors.length;
    groups.set(file.family, current);
  }
  return { scannedFiles: files.length, definitions: [...definitions].sort(), unresolved, groups: [...groups.values()].sort((a, b) => a.family.localeCompare(b.family)), files };
}

async function readSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.map(async entry => {
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'dist', 'generated', '__generated__', '__tests__', '__fixtures__'].includes(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return readSources(absolute);
    if (!supportedExtensions.has(path.extname(entry.name)) || /\.(?:test|spec)\.|\.d\.ts$/.test(entry.name)) return [];
    return [{ file: path.relative(projectRoot, absolute).split(path.sep).join('/'), text: await readFile(absolute, 'utf8') }];
  }));
  return results.flat();
}

function markdown(report) {
  const lines = [
    '# 主题源码审计', '',
    `扫描 src 下 ${report.scannedFiles} 个源码文件（排除测试、声明文件、生成目录和符号链接）。`, '',
    '这是静态线索，不是视觉验收或迁移百分比。固定颜色可能属于媒体、品牌、用户内容或主题定义；共享入口统计仅含直接导入，间接消费者另看覆盖地图。', '',
    '## 未找到定义的 app 变量', '',
  ];
  if (!report.unresolved.length) lines.push('未发现未定义的静态 app 变量引用。');
  else for (const item of report.unresolved) lines.push(`- \`${item.file}:${item.line}\`：\`${item.name}\`${item.fallback ? '（有 fallback，仍需核对是否为错名）' : ''}`);
  lines.push('', '## 按页面家族汇总', '', '| 家族 | 含主题线索的文件 | app 引用 | Semi 引用 | 直接共享入口文件 | 固定色线索 |', '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const item of report.groups) lines.push(`| ${item.family} | ${item.files} | ${item.appReferences} | ${item.semiReferences} | ${item.sharedFiles} | ${item.literalColors} |`);
  lines.push('', '## 优先人工归类的固定色集中位置', '', '仅按静态固定色数量排序，排除主题/资产定义；不能据此批量替换。', '');
  const candidates = report.files.filter(file => file.family !== '主题与静态资产' && file.literalColors.length).sort((a, b) => b.literalColors.length - a.literalColors.length || a.file.localeCompare(b.file)).slice(0, 20);
  for (const item of candidates) lines.push(`- \`${item.file}\`：${item.literalColors.length} 处；首个位置 ${item.literalColors[0].line} 行。`);
  lines.push('', '边界：只检查静态 var(--app-...)；动态变量名、作用域/级联、fallback是否合适、Semi库默认值、隔离插件和Electron页面不由本检查证明。定义只作源码可达性线索，不证明运行时已应用。', '');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !['--json', '--check'].includes(arg))) throw new Error('Usage: node tools/theme-audit/audit.mjs [--json] [--check]');
  const report = analyzeThemeSources(await readSources(path.join(projectRoot, 'src')));
  process.stdout.write(args.has('--json') ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
  if (args.has('--check') && report.unresolved.length) process.exitCode = 1;
}
