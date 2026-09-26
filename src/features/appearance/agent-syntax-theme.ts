import type { ResolvedThemeMode } from '@/contexts/theme.context';

// Internal adapter for the existing Agent code palette, not public theme tokens.
const light = Object.freeze({
  '--app-agent-syntax-keyword': '#7850b8',
  '--app-agent-syntax-string': '#27724b',
  '--app-agent-syntax-number': '#a15b20',
  '--app-agent-syntax-comment': '#71777d',
  '--app-agent-syntax-type': '#236e92',
  '--app-agent-syntax-meta': '#a04766',
});
const dark = Object.freeze({
  '--app-agent-syntax-keyword': '#c5a3ee',
  '--app-agent-syntax-string': '#9dc6a5',
  '--app-agent-syntax-number': '#e1b88c',
  '--app-agent-syntax-comment': '#9a9fa6',
  '--app-agent-syntax-type': '#8bc4dc',
  '--app-agent-syntax-meta': '#dda1b8',
});

export function toAgentSyntaxThemeVariables(mode: ResolvedThemeMode): Readonly<Record<string, string>> {
  return mode === 'dark' ? dark : light;
}
