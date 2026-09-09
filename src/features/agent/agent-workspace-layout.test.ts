import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AgentWorkspace.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('AgentWorkspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxElements(node: ts.Node, name: string): ts.JsxElement[] {
  const found: ts.JsxElement[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isJsxElement(child) && child.openingElement.tagName.getText(file) === name) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

describe('Agent workspace floating composer layout', () => {
  it('keeps session actions in a toolbar portal rather than the composer', () => {
    const composer = jsxElements(file, 'Composer')[0].getText(file);
    expect(composer).not.toContain('管理 Agent 会话');
    expect(composer).not.toContain('管理 Agent 长期记忆');
    expect(composer).not.toContain('新建 Agent 会话');
    expect(source).toContain('createPortal(');
    expect(source).toContain('</>, toolbarTarget)');
    const page = readFileSync(new URL('../../views/library/detail/index.tsx', import.meta.url), 'utf8');
    expect(page).toContain("!browserModeOpen && workspaceDisplayMode !== 'search-home'");
    expect(page).toContain('toolbarTarget={agentToolbarTarget}');
  });

  it('keeps the composer outside the full-height message scroll surface', () => {
    const root = jsxElements(file, 'AgentRoot')[0];
    const scroll = jsxElements(root, 'AgentScroll')[0];
    expect(jsxElements(root, 'ComposerFrame')).toHaveLength(1);
    expect(jsxElements(scroll, 'ComposerFrame')).toHaveLength(0);
    expect(jsxElements(scroll, 'AgentContent')).toHaveLength(1);
  });

  it('reserves measured dock space and keeps the scrollbar outside the overlay', () => {
    expect(source).toContain('padding-bottom: var(--agent-dock-space, 18px)');
    expect(source).toContain('scroll-padding-bottom: var(--agent-dock-space, 18px)');
    expect(source).toContain('right: var(--agent-scrollbar-width, 8px)');
    expect(source).toContain('scroll.offsetWidth - scroll.clientWidth');
    expect(source).toContain('frame.getBoundingClientRect().height');
    expect(source).toContain('observer.disconnect()');
    expect(source).toContain('inset: calc((100% - 18px) / 2) 0 0');
  });
});
