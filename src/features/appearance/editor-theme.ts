import { EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { COLOR_CSS_VARIABLES, type ColorToken } from './color-theme';
import type { ThemeView } from './theme-view';

const colorVariable = (token: ColorToken) => `var(${COLOR_CSS_VARIABLES[token]})`;

export function editorAppearanceExtension(view: ThemeView) {
  return [EditorView.theme({
    '&': { backgroundColor: colorVariable('editor.background'), color: colorVariable('editor.text') },
    '.cm-gutters': { backgroundColor: colorVariable('editor.background'), color: colorVariable('editor.gutter'), borderRightColor: colorVariable('border.default') },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: colorVariable('editor.cursor') },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: colorVariable('editor.selection') },
    // Match CodeMirror's focused selection selector so its built-in theme
    // cannot win on specificity and silently replace the application color.
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: `${colorVariable('editor.selection')} !important`,
    },
    // The host-wide ::selection color would flatten syntax highlighting to a
    // single foreground color. Let CodeMirror keep each token's own color;
    // its selection layer supplies the blue/purple background.
    '.cm-content ::selection, .cm-content::selection': {
      backgroundColor: 'transparent !important',
      color: 'inherit !important',
    },
    // CodeMirror paints the selection layer below the content line. Keep the
    // active-line wash translucent so a text selection on the current line
    // remains visible instead of being covered by an opaque row background.
    '.cm-activeLine': { backgroundColor: `color-mix(in srgb, ${colorVariable('editor.activeLine')} 58%, transparent)` },
    '.cm-activeLineGutter': { backgroundColor: colorVariable('editor.activeLine') },
    // While a range is selected, the active-line wash must not blend with
    // the selection rectangle. Otherwise the row under the drag pointer gets
    // a different shade from the rest of the selected range.
    '&:has(.cm-selectionLayer .cm-selectionBackground) .cm-activeLine': { backgroundColor: 'transparent' },
    '&:has(.cm-selectionLayer .cm-selectionBackground) .cm-activeLineGutter': { backgroundColor: 'transparent' },
  }, { dark: view.mode === 'dark' }), Prec.highest(syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: colorVariable('syntax.keyword') }, { tag: tags.string, color: colorVariable('syntax.string') },
    { tag: tags.number, color: colorVariable('syntax.number') }, { tag: tags.comment, color: colorVariable('syntax.comment') },
    { tag: tags.function(tags.variableName), color: colorVariable('syntax.function') }, { tag: tags.typeName, color: colorVariable('syntax.type') },
    { tag: tags.operator, color: colorVariable('syntax.operator') }, { tag: tags.invalid, color: colorVariable('syntax.invalid') },
  ])))];
}
