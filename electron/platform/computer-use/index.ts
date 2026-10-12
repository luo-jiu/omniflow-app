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
