/** Finite single-window native adapter surface for main-process callers. */
export {
  AgentComputerInputError,
  getAgentComputerWindows,
  getAgentComputerWindowTarget,
  captureAgentComputerWindow,
  captureAgentComputerWindowWithPointer,
  clickAgentComputerPoint,
  setAgentComputerText,
  scrollAgentComputerControl,
  statusAgentComputerClick,
  getAgentComputerParentActivity,
  requestAgentComputerClickPermission,
} from './desktop-computer';
export {
  AgentComputerWindowInputError,
  getAgentComputerWindowInputStatus,
  inputAgentComputerWindow,
} from './window-input';
export type {
  AgentComputerWindowInputStatus,
  AgentComputerWindowInputRequest,
  AgentComputerWindowInputReceipt,
  AgentComputerWindowInputPointerEvent,
} from './window-input';
export { createAgentComputerWindowInputSession, AgentComputerWindowInputSessionCloseError } from './window-input-session';
export type { AgentComputerWindowInputSessionLease } from './window-input-session';
export { showAgentComputerWindowIndicator } from './window-indicator';
export { createAgentComputerMenuSession } from './window-menu';
export type { AgentComputerMenuSessionLease, AgentComputerMenuObservation, AgentComputerMenuCapture, AgentComputerMenuPointer } from './window-menu';
export type { AgentComputerWindowIndicatorRequest, AgentComputerWindowIndicatorLease, AgentComputerWindowPointerEvent } from './window-indicator';
export type {
  AgentComputerCandidate,
  AgentComputerRect,
  AgentComputerTarget,
  AgentComputerWindowIdentity,
  AgentComputerSharedWindow,
  AgentComputerWindowTargetObservation,
  AgentComputerObservationScope,
  AgentComputerPoint,
  AgentComputerSetTextRequest,
  AgentComputerScrollRequest,
} from './desktop-computer';
