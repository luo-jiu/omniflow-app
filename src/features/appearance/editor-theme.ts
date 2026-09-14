import { EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { ThemeView } from './theme-view';

export function editorAppearanceExtension(view: ThemeView) {
  const c = view.colors;
  return [EditorView.theme({
    '&': { backgroundColor: c['editor.background'], color: c['editor.text'] },
    '.cm-gutters': { backgroundColor: c['editor.background'], color: c['editor.gutter'], borderRightColor: c['border.default'] },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c['editor.cursor'] },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: c['editor.selection'] },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: c['editor.activeLine'] },
  }, { dark: view.mode === 'dark' }), Prec.highest(syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: c['syntax.keyword'] }, { tag: tags.string, color: c['syntax.string'] },
    { tag: tags.number, color: c['syntax.number'] }, { tag: tags.comment, color: c['syntax.comment'] },
    { tag: tags.function(tags.variableName), color: c['syntax.function'] }, { tag: tags.typeName, color: c['syntax.type'] },
    { tag: tags.operator, color: c['syntax.operator'] }, { tag: tags.invalid, color: c['syntax.invalid'] },
  ])))];
}
