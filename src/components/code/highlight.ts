import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import type { TextEditorLanguage } from './language';

export interface CodeToken { text: string; className?: string }

export function highlightCodeText(code: string, language: TextEditorLanguage): CodeToken[] {
  if (!language.extension || code.length > 64000) return [{ text: code }];
  try {
    const state = EditorState.create({ doc: code, extensions: [language.extension] });
    const tree = ensureSyntaxTree(state, code.length, 20);
    if (!tree) return [{ text: code }];
    const tokens: CodeToken[] = [];
    let offset = 0;
    highlightTree(tree, classHighlighter, (from, to, className) => {
      if (from > offset) tokens.push({ text: code.slice(offset, from) });
      tokens.push({ text: code.slice(from, to), className });
      offset = to;
    });
    if (offset < code.length) tokens.push({ text: code.slice(offset) });
    return tokens;
  } catch { return [{ text: code }]; }
}
