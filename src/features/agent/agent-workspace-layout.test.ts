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

function hookOptions(name: string): Record<string, string> {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(calls).toHaveLength(1);
  const options = calls[0].arguments[0];
  expect(ts.isObjectLiteralExpression(options)).toBe(true);
  return Object.fromEntries((options as ts.ObjectLiteralExpression).properties.flatMap(property => {
    if (ts.isPropertyAssignment(property)) return [[property.name.getText(file), property.initializer.getText(file)]];
    if (ts.isShorthandPropertyAssignment(property)) return [[property.name.text, property.name.text]];
    return [];
  }));
}

function componentExpressions(sourceFile: ts.SourceFile, name: string): Record<string, string> {
  const components: ts.JsxAttributes[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(sourceFile) === name) components.push(node.attributes);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  expect(components).toHaveLength(1);
  return Object.fromEntries(components[0].properties.flatMap(property => {
    if (!ts.isJsxAttribute(property) || !property.initializer || !ts.isJsxExpression(property.initializer)
      || !property.initializer.expression) return [];
    return [[property.name.getText(sourceFile), property.initializer.expression.getText(sourceFile)]];
  }));
}

describe('Agent workspace floating composer layout', () => {
  it('keeps session actions in the directory rather than the toolbar or composer', () => {
    const composer = jsxElements(file, 'Composer')[0].getText(file);
    expect(composer).not.toContain('管理 Agent 会话');
    expect(composer).not.toContain('管理 Agent 长期记忆');
    expect(composer).not.toContain('新建 Agent 会话');
    expect(source).not.toContain('createPortal(');
    expect(source).toContain('onMemories=');
    const page = readFileSync(new URL('../../views/library/detail/index.tsx', import.meta.url), 'utf8');
    expect(page).toContain("!browserModeOpen && workspaceDisplayMode !== 'search-home'");
    expect(page).not.toContain('toolbarTarget={agentToolbarTarget}');
  });

  it('keeps the composer outside the full-height message scroll surface', () => {
    const root = jsxElements(file, 'AgentRoot')[0];
    const scroll = jsxElements(root, 'AgentScroll')[0];
    expect(jsxElements(root, 'ComposerFrame')).toHaveLength(1);
    expect(jsxElements(scroll, 'ComposerFrame')).toHaveLength(0);
    const contents = jsxElements(scroll, 'AgentContent');
    expect(contents).toHaveLength(2);
    expect(contents.filter(content => content.getText(file).includes('archivedPreview.messages'))).toHaveLength(1);
    expect(contents.filter(content => content.getText(file).includes('messages={session.messages}'))).toHaveLength(1);
    for (const content of contents) expect(jsxElements(content, 'ComposerFrame')).toHaveLength(0);
  });

  it('reserves measured dock space and keeps the scrollbar outside the overlay', () => {
    expect(source).toContain('padding-bottom: var(--agent-dock-space, 18px)');
    expect(source).toContain('scroll-padding-bottom: var(--agent-dock-space, 18px)');
    expect(source).toContain('right: var(--agent-scrollbar-width, 8px)');
    expect(source).toContain('inset: calc((100% - 18px) / 2) 0 0');
  });

  it('pauses both visible composer measurements for tree animations and dragging while only animations freeze directory motion', () => {
    for (const name of ['useAgentComposerAutoHeight', 'useAgentComposerDockMetrics']) {
      expect(hookOptions(name)).toMatchObject({
        enabled: 'workspaceActive && !managerMode',
        layoutMotionPending: 'layoutMeasurementPending',
      });
    }
    expect(hookOptions('useAgentComposerDockMetrics')).toMatchObject({
      composerFrameRef: 'composerFrameRef',
      scrollRef: 'scrollRef',
      onHeightChange: 'setComposerDockHeight',
      onScrollbarWidth: 'setScrollbarWidth',
    });
    expect(componentExpressions(file, 'AgentSessionPeek').layoutMotionPending).toBe('layoutMotionPending');

    const pageSource = readFileSync(new URL('../../views/library/detail/index.tsx', import.meta.url), 'utf8');
    const page = ts.createSourceFile('index.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(componentExpressions(page, 'AgentWorkspace')).toMatchObject({
      layoutMotionPending: 'sidePanelMotion.pending',
      layoutMeasurementPending: 'sidePanelMotion.pending || sidePanelResizing',
    });
  });
});
