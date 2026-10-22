import type { ComponentProps, MouseEvent } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLibraryWorkspaceControls } from '@/contexts/library-workspace-controls.context';
import { normalizeWebUrl } from '@/shared/web-url';

function DocumentLink({ href, children, title }: ComponentProps<'a'>) {
  const { openWebUrl } = useLibraryWorkspaceControls();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const url = normalizeWebUrl(href);
    if (url && (event.button === 0 || event.button === 1)) openWebUrl?.(url);
  };
  return <a href={href} title={title} onClick={open}
    onAuxClick={event => { if (event.button === 1) open(event); }}>{children}</a>;
}

const components: Components = {
  a: DocumentLink,
};

export default function MarkdownDocument({ children }: { children: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={components}>{children}</Markdown>;
}
