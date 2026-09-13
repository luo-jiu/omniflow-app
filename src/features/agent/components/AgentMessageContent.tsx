import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import OutlineIcon from '@/components/ui/outline-icon';
import { Toast } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import { resolveCodeFenceLanguage } from '@/components/code/language';
import { highlightCodeText } from '@/components/code/highlight';
import { parseAgentFileLink } from '@/shared/agent/agent-file-link';
import { AgentFileLinkContext } from '../agent-file-link-context';

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
  .agent-code-tools { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 12px; min-height: 30px; border-bottom: 1px solid var(--app-border); }
  .agent-code-language { color: var(--app-text-muted); font-size: 11px; }
  .agent-code-body { color: var(--app-text); }
  .agent-code-body, .agent-code-body span { transition: none; }
  .agent-code-body .tok-keyword, .agent-code-body .tok-operator { color: #7850b8; }
  .agent-code-body .tok-string, .agent-code-body .tok-regexp { color: #27724b; }
  .agent-code-body .tok-number, .agent-code-body .tok-bool, .agent-code-body .tok-null { color: #a15b20; }
  .agent-code-body .tok-comment { color: #71777d; }
  .agent-code-body .tok-typeName, .agent-code-body .tok-propertyName { color: #236e92; }
  .agent-code-body .tok-meta { color: #a04766; }
  body[theme-mode='dark'] & {
    .agent-code-body .tok-keyword, .agent-code-body .tok-operator { color: #c5a3ee; }
    .agent-code-body .tok-string, .agent-code-body .tok-regexp { color: #9dc6a5; }
    .agent-code-body .tok-number, .agent-code-body .tok-bool, .agent-code-body .tok-null { color: #e1b88c; }
    .agent-code-body .tok-comment { color: #9a9fa6; }
    .agent-code-body .tok-typeName, .agent-code-body .tok-propertyName { color: #8bc4dc; }
    .agent-code-body .tok-meta { color: #dda1b8; }
  }
  pre { padding: 12px; margin: 0; overflow: auto; max-height: min(330px, 42vh); white-space: pre; }
  .agent-table { max-width: 100%; overflow: auto; }
  table { border-collapse: collapse; } th, td { border: 1px solid var(--app-border); padding: 6px 10px; }
  button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    border: 0; border-radius: 4px; background: transparent; color: var(--app-text-muted); cursor: pointer; }
  button:hover { background: var(--app-bg); color: var(--app-text); }
  button.agent-file-link { display: inline; width: auto; height: auto; padding: 0; font: inherit; color: var(--semi-color-primary); text-align: left; overflow-wrap: anywhere; }
  button.agent-file-link:hover { text-decoration: underline; }
  button:focus-visible { outline: 2px solid var(--semi-color-primary); }
  > :first-child { margin-top: 0; }
  > :last-child { margin-bottom: 0; }
`;

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return Array.isArray(node) ? node.map(nodeText).join('') : '';
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return <button type="button" aria-label={label} title={label} onClick={async () => {
    try { await navigator.clipboard.writeText(text); } catch { Toast.error('复制失败'); }
  }}><OutlineIcon name="copy" /></button>;
}

const AgentCodeBlock = React.memo(function AgentCodeBlock({ children }: { children?: React.ReactNode }) {
  const child = React.Children.toArray(children).find(node => React.isValidElement(node));
  const className = React.isValidElement<{ className?: string }>(child) ? child.props.className || '' : '';
  const info = /(?:^|\s)language-([^\s]+)/u.exec(className)?.[1] || '';
  const language = React.useMemo(() => resolveCodeFenceLanguage(info), [info]);
  const code = nodeText(children);
  const tokens = React.useMemo(() => highlightCodeText(code, language), [code, language]);
  return <div className="agent-code">
    <div className="agent-code-tools"><span className="agent-code-language">{language.label}</span><CopyButton text={code} label="复制代码" /></div>
    <pre><code className="agent-code-body">{tokens.map((token, index) => token.className
      ? <span key={index} className={token.className}>{token.text}</span> : token.text)}</code></pre>
  </div>;
});

const components: React.ComponentProps<typeof Markdown>['components'] = {
  a: ({ children, href }) => <FileLink href={href}>{children}</FileLink>,
  img: ({ alt }) => <span>{alt}</span>,
  table: ({ children }) => <div className="agent-table"><table>{children}</table></div>,
  pre: ({ children }) => <AgentCodeBlock>{children}</AgentCodeBlock>,
};

function FileLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const open = React.useContext(AgentFileLinkContext);
  const link = parseAgentFileLink(href || '');
  return link && open ? <button className="agent-file-link" type="button" title={link.path}
    onClick={() => open(link)}>{children}</button> : <span>{children}</span>;
}

const AgentMessageContent = React.memo(function AgentMessageContent({ content, showCopy = true }: { content: string; showCopy?: boolean }) {
  return <Content>
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={components}
      urlTransform={url => parseAgentFileLink(url) ? url : ''}
      allowedElements={['p', 'br', 'hr', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li',
        'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img']}>
      {content}
    </Markdown>
    {showCopy ? <CopyButton text={content} label="复制回答" /> : null}
  </Content>;
});

export default AgentMessageContent;
