/** Finite single-window native adapter surface for main-process callers. */
export {
  AgentComputerInputError,
  getAgentComputerWindows,
  getAgentComputerWindowTarget,
  captureAgentComputerWindow,
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
} from './window-input';
export { showAgentComputerWindowIndicator } from './window-indicator';
export type { AgentComputerWindowIndicatorRequest, AgentComputerWindowIndicatorLease } from './window-indicator';
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
