import { BrowserWindow, webContents } from 'electron';
import { captureAgentComputerWindow, captureAgentComputerWindowWithPointer, clickAgentComputerPoint, getAgentComputerWindows, getAgentComputerWindowTarget,
  requestAgentComputerClickPermission, statusAgentComputerClick, setAgentComputerText, scrollAgentComputerControl,
  getAgentComputerWindowInputStatus, inputAgentComputerWindow, showAgentComputerWindowIndicator } from '../../../platform/computer-use';
import { getAgentAttachmentStore } from '../agent-attachment-runtime';
import { createAgentComputerRuntime } from './agent-computer-runtime';
import { agentRenderingLeases } from './agent-computer-rendering-service-runtime';
import { agentFirstPartyControls } from './agent-first-party-controls';
import type { AgentComputerWindowIndicatorLease, AgentComputerWindowIndicatorRequest } from '../../../platform/computer-use/window-indicator';
import { resolveComputerPointerAccent } from '../../../../src/shared/computer-use/pointer-appearance';
import { createAgentComputerMenuSession } from '../../../platform/computer-use/window-menu';
import { createAgentComputerWindowInputSession } from '../../../platform/computer-use/window-input-session';

let getAccentColor: () => string | undefined = () => undefined;

/** Binds a read-only projection of main's existing validated appearance cache. */
export function configureAgentComputerAppearance(readAccentColor: () => string | undefined): void {
  getAccentColor = readAccentColor;
}

async function indicatePointer(request: AgentComputerWindowIndicatorRequest, signal: AbortSignal): Promise<AgentComputerWindowIndicatorLease> {
  const withAppearance = (next: AgentComputerWindowIndicatorRequest): AgentComputerWindowIndicatorRequest => ({
    ...next, accentColor: resolveComputerPointerAccent(getAccentColor()),
  });
  const lease = await showAgentComputerWindowIndicator(withAppearance(request), signal);
  return {
    get shown() { return lease.shown; },
    closed: lease.closed,
    dispose: () => lease.dispose(),
    ...(lease.hide ? { hide: lease.hide.bind(lease) } : {}),
    ...(lease.update ? { update: (next: AgentComputerWindowIndicatorRequest) => lease.update!(withAppearance(next)) } : {}),
    ...(lease.syncTarget ? { syncTarget: lease.syncTarget.bind(lease) } : {}),
    ...(lease.pointerEvent ? { pointerEvent: lease.pointerEvent.bind(lease) } : {}),
    ...(lease.inputSettled ? { inputSettled: lease.inputSettled.bind(lease) } : {}),
    ...(lease.snapshot ? { snapshot: lease.snapshot.bind(lease) } : {}),
  };
}

/** Only main's validated Agent Run owner calls this; no renderer lease IPC. */
export const keepAgentOwnerRendering = agentRenderingLeases.keepOwnerRendering;

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
  captureWithPointer: captureAgentComputerWindowWithPointer,
  targets: getAgentComputerWindowTarget,
  click: clickAgentComputerPoint,
  setText: setAgentComputerText,
  scroll: scrollAgentComputerControl,
  inputStatus: getAgentComputerWindowInputStatus,
  input: inputAgentComputerWindow,
  inputSession: createAgentComputerWindowInputSession,
  menuSession: createAgentComputerMenuSession,
  indicatePointer,
  clickStatus: statusAgentComputerClick,
  requestClickPermission: requestAgentComputerClickPermission,
  images: getAgentAttachmentStore,
  keepWindowRendering: agentRenderingLeases.keepApprovedWindowRendering,
  firstPartyControls: agentFirstPartyControls,
});

export function releaseAgentComputerRun(runId: string, mode: 'normal' | 'immediate' = 'immediate'): Promise<void> {
  const closed = agentComputerRuntime.releaseRun(runId, mode);
  agentFirstPartyControls.releaseRun(runId);
  return Promise.resolve(closed);
}
