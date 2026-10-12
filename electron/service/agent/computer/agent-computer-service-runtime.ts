import { BrowserWindow, webContents } from 'electron';
import { captureAgentComputerWindow, clickAgentComputerPoint, getAgentComputerWindows, getAgentComputerWindowTarget,
  requestAgentComputerClickPermission, statusAgentComputerClick, setAgentComputerText, scrollAgentComputerControl } from '../../../platform/computer-use';
import { getAgentAttachmentStore } from '../agent-attachment-runtime';
import { createAgentComputerRuntime } from './agent-computer-runtime';
import { createAgentRenderingLeaseManager } from './agent-computer-rendering-lease';
import { agentFirstPartyControls } from './agent-first-party-controls';

const renderingLeases = createAgentRenderingLeaseManager({
  processId: process.pid,
  ownerWindow: ownerWebContentsId => {
    const sender = webContents.fromId(ownerWebContentsId);
    return sender && BrowserWindow.fromWebContents(sender) || undefined;
  },
});

/** Only main's validated Agent Run owner calls this; no renderer lease IPC. */
export const keepAgentOwnerRendering = renderingLeases.keepOwnerRendering;

export const agentComputerRuntime = createAgentComputerRuntime({
  windows: getAgentComputerWindows,
  ownerWindowId: ownerWebContentsId => {
    const sender = webContents.fromId(ownerWebContentsId);
    const window = sender && BrowserWindow.fromWebContents(sender);
    const match = window && /^window:([1-9][0-9]*):[0-9]+$/u.exec(window.getMediaSourceId());
    if (!match) throw new Error('当前 OmniFlow 窗口不可共享');
    return Number(match[1]);
  },
  capture: captureAgentComputerWindow,
  targets: getAgentComputerWindowTarget,
  click: clickAgentComputerPoint,
  setText: setAgentComputerText,
  scroll: scrollAgentComputerControl,
  clickStatus: statusAgentComputerClick,
  requestClickPermission: requestAgentComputerClickPermission,
  images: getAgentAttachmentStore,
  keepWindowRendering: renderingLeases.keepApprovedWindowRendering,
  firstPartyControls: agentFirstPartyControls,
});

export function releaseAgentComputerRun(runId: string): void {
  agentComputerRuntime.releaseRun(runId);
  agentFirstPartyControls.releaseRun(runId);
}
