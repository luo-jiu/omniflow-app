import { BrowserWindow, webContents } from 'electron';
import { createAgentRenderingLeaseManager } from './agent-computer-rendering-lease';

/** One main-owned policy for visible Workspace, active Run and approved capture references. */
export const agentRenderingLeases = createAgentRenderingLeaseManager({
  processId: process.pid,
  ownerWindow: ownerWebContentsId => {
    const sender = webContents.fromId(ownerWebContentsId);
    return sender && BrowserWindow.fromWebContents(sender) || undefined;
  },
});
