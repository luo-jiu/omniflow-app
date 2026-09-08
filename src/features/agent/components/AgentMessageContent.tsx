import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { IconCopy } from '@douyinfe/semi-icons';
import { Toast } from '@douyinfe/semi-ui';
import styled from 'styled-components';

const Content = styled.div`
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.65;
  h1, h2, h3, h4, h5, h6 { margin: 16px 0 8px; line-height: 1.4; }
  h1 { font-size: 22px; } h2 { font-size: 19px; } h3 { font-size: 16px; }
  h4, h5, h6 { font-size: 14px; }
  p { margin: 8px 0; }
  ul, ol { padding-left: 24px; }
  blockquote { margin: 12px 0; padding-left: 12px; border-left: 3px solid var(--app-border); }
  code { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
  :not(pre) > code { background: var(--app-bg); padding: 1px 4px; border-radius: 3px; }
  .agent-code { border: 1px solid var(--app-border); border-radius: 6px; margin: 12px 0; min-width: 0; }
  .agent-code-tools { display: flex; justify-content: flex-end; border-bottom: 1px solid var(--app-border); }
  pre { padding: 12px; margin: 0; overflow: auto; max-height: 520px; white-space: pre; }
  .agent-table { max-width: 100%; overflow: auto; }
  table { border-collapse: collapse; } th, td { border: 1px solid var(--app-border); padding: 6px 10px; }
  button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    border: 0; border-radius: 4px; background: transparent; color: var(--app-text-muted); cursor: pointer; }
  button:hover { background: var(--app-bg); color: var(--app-text); }
  button:focus-visible { outline: 2px solid var(--semi-color-primary); }
  > :first-child { margin-top: 0; }
`;

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return Array.isArray(node) ? node.map(nodeText).join('') : '';
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return <button type="button" aria-label={label} title={label} onClick={async () => {
    try { await navigator.clipboard.writeText(text); } catch { Toast.error('复制失败'); }
  }}><IconCopy aria-hidden="true" /></button>;
}

const components: React.ComponentProps<typeof Markdown>['components'] = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span>{alt}</span>,
  table: ({ children }) => <div className="agent-table"><table>{children}</table></div>,
  pre: ({ children }) => <div className="agent-code">
    <div className="agent-code-tools"><CopyButton text={nodeText(children)} label="复制代码" /></div>
    <pre>{children}</pre>
  </div>,
};

const AgentMessageContent = React.memo(function AgentMessageContent({ content }: { content: string }) {
  return <Content>
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={components}
      allowedElements={['p', 'br', 'hr', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li',
        'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img']}>
      {content}
    </Markdown>
    <CopyButton text={content} label="复制回答" />
  </Content>;
});

export default AgentMessageContent;
