import {
  AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND,
  AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION,
  AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION_V2,
  AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND,
  AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION,
  AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V2,
  AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V3,
  AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_KIND,
  AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_VERSION,
  AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_KIND,
  AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_VERSION,
  AGENT_COMPUTER_SCROLL_PREPARED_ACTION_KIND,
  AGENT_COMPUTER_SCROLL_PREPARED_ACTION_VERSION,
  AGENT_COMPUTER_INPUT_PREPARED_ACTION_KIND,
  AGENT_COMPUTER_INPUT_PREPARED_ACTION_VERSION,
  AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
  AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
  AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
  AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  AGENT_PLUGIN_RENAME_PREPARED_ACTION_KIND,
  AGENT_PLUGIN_RENAME_PREPARED_ACTION_VERSION,
  AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_KIND,
  AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_VERSION,
  AGENT_SHELL_PREPARED_ACTION_VERSION,
  AGENT_SHELL_RUN_TOOL_NAME,
  type AgentFilePublishPreparedActionPublicV1,
  type AgentComputerObservePreparedActionPublicV1,
  type AgentComputerObservePreparedActionPublicV2,
  type AgentComputerClickPreparedActionPublicV1,
  type AgentComputerClickPreparedActionPublicV2,
  type AgentComputerClickPreparedActionPublicV3,
  type AgentComputerWindowsPreparedActionPublicV1,
  type AgentComputerSetTextPreparedActionPublicV1,
  type AgentComputerScrollPreparedActionPublicV1,
  type AgentComputerInputPreparedActionPublicV1,
  type AgentFileStagePreparedActionPublicV1,
  type AgentFileUploadPreparedActionPublicV1,
  type AgentMediaExtractAudioOutputFormat,
  type AgentMediaExtractAudioPreparedActionPublicV1,
  type AgentPreparedActionPublic,
  type AgentPluginRenamePreparedActionPublicV1,
  type AgentPluginFileOutputPreparedActionPublicV1,
} from './agent.types';
import { normalizeAgentShellPreparedActionPublicV1 } from './shell/agent-shell.types';
import {
  COMPUTER_TEXT_MAX_UNICODE_SCALARS,
  COMPUTER_TEXT_MAX_UTF8_BYTES,
  normalizeComputerElementOperations,
} from '../computer-use/computer-use-contract';
import {
  WINDOW_INPUT_DRAG_MIN_DURATION_MS,
  WINDOW_INPUT_DRAG_MAX_DURATION_MS,
  normalizeWindowInputOperations,
  normalizeWindowInputPoint,
  normalizeWindowInputShortcut,
} from '../computer-use/window-input-contract';

const MAX_OUTPUT_FILE_NAME_CHARACTERS = 255;
const MAX_TARGET_LABEL_CHARACTERS = 500;
const MAX_LOGICAL_PATH_UTF8_BYTES = 1_024;
const UTF8_ENCODER = new TextEncoder();
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMPUTER_OBSERVE_FIELDS = new Set(['kind', 'version', 'libraryId', 'displayId', 'displayLabel']);
const COMPUTER_CLICK_FIELDS = new Set([
  'kind', 'version', 'libraryId', 'displayId', 'displayLabel', 'observationId',
  'screenshotWidth', 'screenshotHeight', 'x', 'y', 'button', 'clickCount',
]);
const COMPUTER_OBSERVE_V2_FIELDS = new Set(['kind', 'version', 'libraryId', 'targetId', 'applicationLabel', 'windowLabel']);
const COMPUTER_OBSERVE_V2_OPTIONAL_FIELDS = new Set(['operations', 'mode', 'inputOperations']);
const COMPUTER_INPUT_FIELDS = new Set([
  'kind', 'version', 'libraryId', 'targetId', 'applicationLabel', 'windowLabel', 'observationId', 'operation',
]);
const COMPUTER_CLICK_V2_FIELDS = new Set([
  ...COMPUTER_OBSERVE_V2_FIELDS, 'observationId', 'screenshotWidth', 'screenshotHeight', 'x', 'y', 'button', 'clickCount',
]);
const COMPUTER_CLICK_V2_OPTIONAL_FIELDS = new Set(['elementId']);
const COMPUTER_CLICK_V3_FIELDS = new Set([
  ...COMPUTER_OBSERVE_V2_FIELDS, 'observationId', 'elementId', 'button', 'clickCount',
]);
const COMPUTER_WINDOWS_FIELDS = new Set(['kind', 'version', 'libraryId']);
const COMPUTER_WINDOWS_OPTIONAL_FIELDS = new Set(['query', 'application']);
const COMPUTER_SET_TEXT_FIELDS = new Set([
  ...COMPUTER_OBSERVE_V2_FIELDS, 'observationId', 'elementId', 'mode', 'textLength', 'textBytes',
]);
const COMPUTER_SCROLL_FIELDS = new Set([
  ...COMPUTER_OBSERVE_V2_FIELDS, 'observationId', 'elementId', 'direction', 'unit',
]);
const COMPUTER_OBSERVATION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const FILE_STAGE_LOCAL_FIELDS = new Set(['kind', 'sourceKind', 'targetLabel', 'version']);
const FILE_STAGE_LOCAL_PATH_FIELDS = new Set([
  'kind', 'sourceDisplayName', 'sourceIdentity', 'sourceKind', 'sourcePath',
  'sourceSizeBytes', 'targetLabel', 'version',
]);
const FILE_STAGE_LIBRARY_FIELDS = new Set([
  'kind', 'libraryId', 'sourceDisplayName', 'sourceIdentity', 'sourceKind',
  'sourceNodeId', 'sourceSizeBytes', 'targetLabel', 'version',
]);
const FILE_PUBLISH_FIELDS = new Set([
  'conflictPolicy',
  'contentHash',
  'destinationKind',
  'displayName',
  'kind',
  'libraryId',
  'parentId',
  'providerId',
  'sizeBytes',
  'sourcePath',
  'suggestedFileName',
  'targetLabel',
  'version',
]);
const FILE_UPLOAD_FIELDS = new Set([
  'conflictPolicy', 'kind', 'libraryId', 'outputFileName', 'parentId', 'providerId',
  'sourceDisplayName', 'sourceIdentity', 'sourceKind', 'sourcePath', 'sourceSizeBytes',
  'targetLabel', 'version',
]);
const MEDIA_EXTRACT_AUDIO_FIELDS = new Set([
  'conflictPolicy',
  'destination',
  'fallbackPolicy',
  'kind',
  'libraryId',
  'outputFileName',
  'outputFormat',
  'parentId',
  'sourceNodeId',
  'targetLabel',
  'version',
]);
const MEDIA_EXTRACT_AUDIO_OUTPUT_FORMATS = new Set<AgentMediaExtractAudioOutputFormat>([
  'm4a',
  'mp3',
  'wav',
]);
const PLUGIN_RENAME_FIELDS = new Set(['kind', 'version', 'libraryId', 'operationId', 'pluginId', 'pluginVersion', 'packageFingerprint', 'items']);
const PLUGIN_RENAME_ITEM_FIELDS = new Set(['nodeId', 'parentId', 'oldName', 'newName']);
const PLUGIN_FILE_OUTPUT_FIELDS = new Set(['kind', 'version', 'libraryId', 'operationId', 'pluginId', 'pluginVersion',
  'packageFingerprint', 'sourceNodeId', 'parentId', 'fileName', 'providerId', 'mediaType', 'sizeBytes', 'sha256']);

export function normalizeAgentPluginFileOutputPreparedActionPublicV1(input: unknown): AgentPluginFileOutputPreparedActionPublicV1 {
  const source = strictRenameObject(input, PLUGIN_FILE_OUTPUT_FIELDS);
  if (source.kind !== AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_KIND || source.version !== AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_VERSION) throw new Error('Agent prepared action 类型或版本不受支持');
  if (typeof source.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(source.operationId)
    || typeof source.pluginId !== 'string' || source.pluginId.length > 96 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(source.pluginId)
    || typeof source.pluginVersion !== 'string' || !/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u.test(source.pluginVersion)
    || typeof source.packageFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(source.packageFingerprint)) throw new Error('Agent 文件产物提案来源无效');
  const fileName = renameFileName(source.fileName);
  if (/[<>:"|?*]/u.test(fileName) || fileName.endsWith('.')
    || (source.mediaType !== 'text/csv' && source.mediaType !== 'application/json')
    || fileName.length <= (source.mediaType === 'text/csv' ? 4 : 5) || !fileName.endsWith(source.mediaType === 'text/csv' ? '.csv' : '.json')
    || typeof source.providerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(source.providerId)
    || !Number.isSafeInteger(source.sizeBytes) || Number(source.sizeBytes) < 1 || Number(source.sizeBytes) > 1048576
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)) throw new Error('Agent 文件产物目标或摘要无效');
  return { kind: AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_KIND, version: AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_VERSION,
    libraryId: positiveId(source.libraryId, '资料库'), operationId: source.operationId, pluginId: source.pluginId,
    pluginVersion: source.pluginVersion, packageFingerprint: source.packageFingerprint, sourceNodeId: positiveId(source.sourceNodeId, '源文件'),
    parentId: positiveId(source.parentId, '目标目录'), fileName, providerId: source.providerId, mediaType: source.mediaType,
    sizeBytes: Number(source.sizeBytes), sha256: source.sha256 };
}

function strictRenameObject(input: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  const source = strictObject(input);
  if (Reflect.ownKeys(source).length !== allowed.size || Object.getOwnPropertySymbols(source).length
    || Object.entries(Object.getOwnPropertyDescriptors(source)).some(([key, descriptor]) => !allowed.has(key) || !('value' in descriptor) || !descriptor.enumerable)) {
    throw new Error('Agent 重命名提案字段无效');
  }
  return source;
}

function renameFileName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value === '.' || value === '..'
    || UTF8_ENCODER.encode(value).byteLength > 240
    || Array.from(value).some(character => { const code = character.charCodeAt(0); return character === '/' || character === '\\'
      || code < 32 || code === 127 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff); })) {
    throw new Error('Agent 重命名文件名无效');
  }
  return value;
}

export function normalizeAgentPluginRenamePreparedActionPublicV1(input: unknown): AgentPluginRenamePreparedActionPublicV1 {
  const source = strictRenameObject(input, PLUGIN_RENAME_FIELDS);
  if (source.kind !== AGENT_PLUGIN_RENAME_PREPARED_ACTION_KIND || source.version !== AGENT_PLUGIN_RENAME_PREPARED_ACTION_VERSION) throw new Error('Agent prepared action 类型或版本不受支持');
  if (typeof source.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(source.operationId)
    || typeof source.pluginId !== 'string' || source.pluginId.length > 96 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(source.pluginId)
    || typeof source.pluginVersion !== 'string' || !/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u.test(source.pluginVersion)
    || typeof source.packageFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(source.packageFingerprint)) throw new Error('Agent 重命名提案来源无效');
  if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 50 || Object.keys(source.items).length !== source.items.length
    || Object.getOwnPropertySymbols(source.items).length || Object.values(Object.getOwnPropertyDescriptors(source.items)).some(descriptor => !('value' in descriptor))) throw new Error('Agent 重命名提案范围无效');
  const ids = new Set<number>(); const targets = new Set<string>();
  const items = source.items.map(raw => {
    const item = strictRenameObject(raw, PLUGIN_RENAME_ITEM_FIELDS);
    const nodeId = positiveId(item.nodeId, '文件 ID'), parentId = positiveId(item.parentId, '父目录 ID');
    const oldName = renameFileName(item.oldName), newName = renameFileName(item.newName);
    const target = JSON.stringify([parentId, newName]);
    if (ids.has(nodeId) || targets.has(target) || oldName === newName) throw new Error('Agent 重命名提案包含重复或未变化目标');
    ids.add(nodeId); targets.add(target);
    return { nodeId, parentId, oldName, newName };
  });
  return { kind: AGENT_PLUGIN_RENAME_PREPARED_ACTION_KIND, version: AGENT_PLUGIN_RENAME_PREPARED_ACTION_VERSION,
    libraryId: positiveId(source.libraryId, '资料库'), operationId: source.operationId, pluginId: source.pluginId,
    pluginVersion: source.pluginVersion, packageFingerprint: source.packageFingerprint, items };
}

function strictObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Agent prepared action 无效');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Agent prepared action 无效');
  }
  return input as Record<string, unknown>;
}

function assertExactFields(source: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new Error('Agent prepared action 包含未知字段');
  }
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function strictComputerObject(
  input: unknown,
  required: ReadonlySet<string>,
  optional?: ReadonlySet<string>,
): Record<string, unknown> {
  const source = strictObject(input);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  if (Array.from(required).some(key => !Object.prototype.hasOwnProperty.call(descriptors, key))
    || Object.getOwnPropertySymbols(source).length
    || Object.entries(descriptors).some(([key, descriptor]) => (
      (!required.has(key) && !optional?.has(key)) || !('value' in descriptor) || !descriptor.enumerable
    ))) throw new Error('Agent 屏幕动作字段无效');
  return source;
}

function computerLabel(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || Array.from(value).length > maximum
    || Array.from(value).some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159)
        || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
        || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) {
    throw new Error('Agent 屏幕标识或名称无效');
  }
  return value;
}

export function normalizeAgentComputerObservePreparedActionPublicV1(input: unknown): AgentComputerObservePreparedActionPublicV1 {
  const source = strictComputerObject(input, COMPUTER_OBSERVE_FIELDS);
  if (source.kind !== AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  return {
    kind: AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND,
    version: AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION,
    libraryId: positiveId(source.libraryId, '资料库'),
    displayId: computerLabel(source.displayId, 128),
    displayLabel: computerLabel(source.displayLabel, 200),
  };
}

export function normalizeAgentComputerClickPreparedActionPublicV1(input: unknown): AgentComputerClickPreparedActionPublicV1 {
  const source = strictComputerObject(input, COMPUTER_CLICK_FIELDS);
  if (source.kind !== AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  const screenshotWidth = positiveId(source.screenshotWidth, '截图宽度');
  const screenshotHeight = positiveId(source.screenshotHeight, '截图高度');
  if (screenshotWidth > 2048 || screenshotHeight > 2048
    || typeof source.observationId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(source.observationId)
    || typeof source.x !== 'number' || !Number.isSafeInteger(source.x) || source.x < 0 || source.x >= screenshotWidth
    || typeof source.y !== 'number' || !Number.isSafeInteger(source.y) || source.y < 0 || source.y >= screenshotHeight
    || (source.button !== 'left' && source.button !== 'right')
    || (source.clickCount !== 1 && source.clickCount !== 2)) {
    throw new Error('Agent 屏幕点击动作无效');
  }
  return {
    kind: AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND,
    version: AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION,
    libraryId: positiveId(source.libraryId, '资料库'),
    displayId: computerLabel(source.displayId, 128),
    displayLabel: computerLabel(source.displayLabel, 200),
    observationId: source.observationId,
    screenshotWidth,
    screenshotHeight,
    x: source.x,
    y: source.y,
    button: source.button,
    clickCount: source.clickCount,
  };
}

function computerTarget(source: Record<string, unknown>) {
  if (typeof source.targetId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(source.targetId)) {
    throw new Error('Agent 应用窗口目标无效');
  }
  return {
    libraryId: positiveId(source.libraryId, '资料库'),
    targetId: source.targetId,
    applicationLabel: computerLabel(source.applicationLabel, 200),
    windowLabel: computerLabel(source.windowLabel, 200),
  };
}

export function normalizeAgentComputerObservePreparedActionPublicV2(input: unknown): AgentComputerObservePreparedActionPublicV2 {
  const source = strictComputerObject(input, COMPUTER_OBSERVE_V2_FIELDS, COMPUTER_OBSERVE_V2_OPTIONAL_FIELDS);
  if (source.kind !== AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION_V2) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  const hasMode = Object.prototype.hasOwnProperty.call(source, 'mode');
  if (hasMode && source.mode !== 'ax' && source.mode !== 'screenshot' && source.mode !== 'both') {
    throw new Error('Agent 应用窗口观察方式无效');
  }
  return { kind: AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND, version: AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION_V2,
    ...computerTarget(source), ...(hasMode ? { mode: source.mode as AgentComputerObservePreparedActionPublicV2['mode'] } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'operations')
      ? { operations: normalizeComputerElementOperations(source.operations) } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'inputOperations')
      ? { inputOperations: normalizeWindowInputOperations(source.inputOperations) } : {}) };
}

export function normalizeAgentComputerInputPreparedActionPublicV1(input: unknown): AgentComputerInputPreparedActionPublicV1 {
  const base = strictComputerObject(input, COMPUTER_INPUT_FIELDS, new Set(['shortcut', 'point', 'endPoint', 'durationMs']));
  if (base.kind !== AGENT_COMPUTER_INPUT_PREPARED_ACTION_KIND
    || base.version !== AGENT_COMPUTER_INPUT_PREPARED_ACTION_VERSION
    || typeof base.observationId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(base.observationId)) {
    throw new Error('Agent 应用窗口输入动作无效');
  }
  const fields = base.operation === 'shortcut' ? ['shortcut']
    : base.operation === 'rightClick' || base.operation === 'doubleClick' ? ['point']
      : base.operation === 'drag' ? ['point', 'endPoint', 'durationMs'] : null;
  if (!fields) throw new Error('Agent 应用窗口输入操作无效');
  const source = strictComputerObject(base, new Set([...COMPUTER_INPUT_FIELDS, ...fields]));
  const target = { kind: AGENT_COMPUTER_INPUT_PREPARED_ACTION_KIND, version: AGENT_COMPUTER_INPUT_PREPARED_ACTION_VERSION,
    ...computerTarget(source), observationId: source.observationId as string };
  if (source.operation === 'shortcut') return { ...target, operation: 'shortcut', shortcut: normalizeWindowInputShortcut(source.shortcut) };
  if (source.operation === 'rightClick' || source.operation === 'doubleClick') {
    return { ...target, operation: source.operation, point: normalizeWindowInputPoint(source.point) };
  }
  if (typeof source.durationMs !== 'number' || !Number.isSafeInteger(source.durationMs)
    || source.durationMs < WINDOW_INPUT_DRAG_MIN_DURATION_MS || source.durationMs > WINDOW_INPUT_DRAG_MAX_DURATION_MS) {
    throw new Error('Agent 应用窗口拖拽时长无效');
  }
  const point = normalizeWindowInputPoint(source.point);
  const endPoint = normalizeWindowInputPoint(source.endPoint);
  if (point.x === endPoint.x && point.y === endPoint.y) throw new Error('Agent 应用窗口拖拽起终点必须不同');
  return { ...target, operation: 'drag', point, endPoint, durationMs: source.durationMs };
}

function computerElementTarget(source: Record<string, unknown>) {
  if (typeof source.observationId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(source.observationId)
    || typeof source.elementId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(source.elementId)) {
    throw new Error('Agent 应用窗口控件身份无效');
  }
  return { ...computerTarget(source), observationId: source.observationId, elementId: source.elementId };
}

export function normalizeAgentComputerClickPreparedActionPublicV3(input: unknown): AgentComputerClickPreparedActionPublicV3 {
  const source = strictComputerObject(input, COMPUTER_CLICK_V3_FIELDS);
  if (source.kind !== AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V3) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  if (source.button !== 'left' || source.clickCount !== 1) throw new Error('Agent 应用窗口点击动作无效');
  return { kind: AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND, version: AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V3,
    ...computerElementTarget(source), button: 'left', clickCount: 1 };
}

export function normalizeAgentComputerSetTextPreparedActionPublicV1(input: unknown): AgentComputerSetTextPreparedActionPublicV1 {
  const source = strictComputerObject(input, COMPUTER_SET_TEXT_FIELDS);
  if (source.kind !== AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_VERSION) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  if ((source.mode !== 'replace' && source.mode !== 'insert')
    || typeof source.textLength !== 'number' || !Number.isSafeInteger(source.textLength)
    || source.textLength < 0 || source.textLength > COMPUTER_TEXT_MAX_UNICODE_SCALARS
    || typeof source.textBytes !== 'number' || !Number.isSafeInteger(source.textBytes)
    || source.textBytes < source.textLength || source.textBytes > source.textLength * 4
    || source.textBytes > COMPUTER_TEXT_MAX_UTF8_BYTES
    || (source.mode === 'insert' && source.textLength === 0)) {
    throw new Error('Agent 应用窗口文字输入动作无效');
  }
  return { kind: AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_KIND, version: AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_VERSION,
    ...computerElementTarget(source), mode: source.mode, textLength: source.textLength, textBytes: source.textBytes };
}

export function normalizeAgentComputerScrollPreparedActionPublicV1(input: unknown): AgentComputerScrollPreparedActionPublicV1 {
  const source = strictComputerObject(input, COMPUTER_SCROLL_FIELDS);
  if (source.kind !== AGENT_COMPUTER_SCROLL_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_SCROLL_PREPARED_ACTION_VERSION) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  if ((source.direction !== 'up' && source.direction !== 'down' && source.direction !== 'left' && source.direction !== 'right')
    || (source.unit !== 'page' && source.unit !== 'step' && source.unit !== 'fraction')) {
    throw new Error('Agent 应用窗口滚动动作无效');
  }
  return { kind: AGENT_COMPUTER_SCROLL_PREPARED_ACTION_KIND, version: AGENT_COMPUTER_SCROLL_PREPARED_ACTION_VERSION,
    ...computerElementTarget(source), direction: source.direction, unit: source.unit };
}

export function normalizeAgentComputerClickPreparedActionPublicV2(input: unknown): AgentComputerClickPreparedActionPublicV2 {
  const source = strictComputerObject(input, COMPUTER_CLICK_V2_FIELDS, COMPUTER_CLICK_V2_OPTIONAL_FIELDS);
  if (source.kind !== AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V2) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  const screenshotWidth = positiveId(source.screenshotWidth, '截图宽度');
  const screenshotHeight = positiveId(source.screenshotHeight, '截图高度');
  const hasElementId = Object.prototype.hasOwnProperty.call(source, 'elementId');
  if (screenshotWidth > 2048 || screenshotHeight > 2048
    || typeof source.observationId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(source.observationId)
    || (hasElementId && (typeof source.elementId !== 'string' || !COMPUTER_OBSERVATION_ID_PATTERN.test(source.elementId)))
    || typeof source.x !== 'number' || !Number.isSafeInteger(source.x) || source.x < 0 || source.x >= screenshotWidth
    || typeof source.y !== 'number' || !Number.isSafeInteger(source.y) || source.y < 0 || source.y >= screenshotHeight
    || source.button !== 'left' || source.clickCount !== 1) {
    throw new Error('Agent 应用窗口点击动作无效');
  }
  return { kind: AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND, version: AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V2,
    ...computerTarget(source), observationId: source.observationId, screenshotWidth, screenshotHeight,
    ...(hasElementId ? { elementId: source.elementId as string } : {}),
    x: source.x, y: source.y, button: 'left', clickCount: 1 };
}

export function normalizeAgentComputerWindowsPreparedActionPublicV1(input: unknown): AgentComputerWindowsPreparedActionPublicV1 {
  const source = strictComputerObject(input, COMPUTER_WINDOWS_FIELDS, COMPUTER_WINDOWS_OPTIONAL_FIELDS);
  if (source.kind !== AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_KIND
    || source.version !== AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_VERSION) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  return {
    kind: AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_KIND,
    version: AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_VERSION,
    libraryId: positiveId(source.libraryId, '资料库'),
    ...(Object.prototype.hasOwnProperty.call(source, 'query') ? { query: computerLabel(source.query, 200) } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'application') ? { application: computerLabel(source.application, 200) } : {}),
  };
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label}无效`);
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > maximum) throw new Error(`${label}无效`);
  return normalized;
}

function safeFileName(value: unknown): string {
  const normalized = boundedText(value, '输出文件名', MAX_OUTPUT_FILE_NAME_CHARACTERS);
  if (
    normalized === '.'
    || normalized === '..'
    || Array.from(normalized).some(character => (
      character === '/'
      || character === '\\'
      || character.charCodeAt(0) < 32
    ))
  ) {
    throw new Error('输出文件名无效');
  }
  return normalized;
}

function safeTargetLabel(value: unknown): string {
  const normalized = boundedText(value, '目标位置', MAX_TARGET_LABEL_CHARACTERS);
  if (Array.from(normalized).some(character => character.charCodeAt(0) < 32)) {
    throw new Error('目标位置无效');
  }
  return normalized;
}

function safeLocalPathLabel(value: unknown): string {
  const normalized = boundedText(value, '本机文件路径', 4_096);
  if (
    UTF8_ENCODER.encode(normalized).byteLength > 4_096
    || Array.from(normalized).some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('本机文件路径无效');
  }
  return normalized;
}

function safeLogicalOutputPath(value: unknown): string {
  const normalized = boundedText(value, '工作区输出路径', MAX_LOGICAL_PATH_UTF8_BYTES);
  if (
    UTF8_ENCODER.encode(normalized).byteLength > MAX_LOGICAL_PATH_UTF8_BYTES
    || !normalized.startsWith('output/')
    || normalized.includes('\\')
    || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || Array.from(normalized).some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('工作区输出路径无效');
  }
  return normalized;
}

function safeContentHash(value: unknown): string {
  const normalized = boundedText(value, '文件内容摘要', 80);
  if (!CONTENT_HASH_PATTERN.test(normalized)) throw new Error('文件内容摘要无效');
  return normalized;
}

function safeSizeBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('文件大小无效');
  }
  return value;
}

export function normalizeAgentFileStagePreparedActionPublicV1(
  input: unknown,
): AgentFileStagePreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_FILE_STAGE_PREPARED_ACTION_KIND
    || source.version !== AGENT_FILE_STAGE_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  if (source.sourceKind === 'local-picker') {
    assertExactFields(source, FILE_STAGE_LOCAL_FIELDS);
    return {
      kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
      sourceKind: 'local-picker',
      targetLabel: safeTargetLabel(source.targetLabel),
      version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    };
  }
  if (source.sourceKind === 'local-path') {
    assertExactFields(source, FILE_STAGE_LOCAL_PATH_FIELDS);
    return {
      kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
      sourceDisplayName: safeFileName(source.sourceDisplayName),
      sourceIdentity: safeContentHash(source.sourceIdentity),
      sourceKind: 'local-path',
      sourcePath: safeLocalPathLabel(source.sourcePath),
      sourceSizeBytes: safeSizeBytes(source.sourceSizeBytes),
      targetLabel: safeTargetLabel(source.targetLabel),
      version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    };
  }
  if (source.sourceKind !== 'library-node') throw new Error('文件来源无效');
  assertExactFields(source, FILE_STAGE_LIBRARY_FIELDS);
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    libraryId: positiveId(source.libraryId, '资料库'),
    sourceDisplayName: safeFileName(source.sourceDisplayName),
    sourceIdentity: safeContentHash(source.sourceIdentity),
    sourceKind: 'library-node',
    sourceNodeId: positiveId(source.sourceNodeId, '资料库节点'),
    sourceSizeBytes: safeSizeBytes(source.sourceSizeBytes),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  };
}

export function normalizeAgentFileUploadPreparedActionPublicV1(
  input: unknown,
): AgentFileUploadPreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND
    || source.version !== AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, FILE_UPLOAD_FIELDS);
  const conflictPolicy = source.conflictPolicy === 'fail' || source.conflictPolicy === 'rename'
    ? source.conflictPolicy
    : null;
  const providerId = boundedText(source.providerId, '存储服务', 128);
  if (
    !conflictPolicy
    || source.sourceKind !== 'local-path'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(providerId)
  ) {
    throw new Error('本机文件上传动作无效');
  }
  return {
    conflictPolicy,
    kind: AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND,
    libraryId: positiveId(source.libraryId, '资料库'),
    outputFileName: safeFileName(source.outputFileName),
    parentId: positiveId(source.parentId, '目标目录'),
    providerId,
    sourceDisplayName: safeFileName(source.sourceDisplayName),
    sourceIdentity: safeContentHash(source.sourceIdentity),
    sourceKind: 'local-path',
    sourcePath: safeLocalPathLabel(source.sourcePath),
    sourceSizeBytes: safeSizeBytes(source.sourceSizeBytes),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION,
  };
}

export function normalizeAgentFilePublishPreparedActionPublicV1(
  input: unknown,
): AgentFilePublishPreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND
    || source.version !== AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, FILE_PUBLISH_FIELDS);
  if (source.destinationKind !== 'local-save-as' && source.destinationKind !== 'library') {
    throw new Error('文件发布目标无效');
  }
  const base = {
    contentHash: safeContentHash(source.contentHash),
    displayName: safeFileName(source.displayName),
    kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
    sizeBytes: safeSizeBytes(source.sizeBytes),
    sourcePath: safeLogicalOutputPath(source.sourcePath),
    suggestedFileName: safeFileName(source.suggestedFileName),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  };
  if (source.destinationKind === 'local-save-as') {
    if (
      source.conflictPolicy !== undefined
      || source.libraryId !== undefined
      || source.parentId !== undefined
      || source.providerId !== undefined
    ) {
      throw new Error('本机文件发布目标包含资料库字段');
    }
    return { ...base, destinationKind: 'local-save-as' };
  }
  const conflictPolicy = source.conflictPolicy === 'fail' || source.conflictPolicy === 'rename'
    ? source.conflictPolicy
    : null;
  const providerId = boundedText(source.providerId, '存储服务', 128);
  if (!conflictPolicy || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(providerId)) {
    throw new Error('资料库文件发布目标无效');
  }
  return {
    ...base,
    conflictPolicy,
    destinationKind: 'library',
    libraryId: positiveId(source.libraryId, '资料库'),
    parentId: positiveId(source.parentId, '目标目录'),
    providerId,
  };
}

function outputFormat(value: unknown): AgentMediaExtractAudioOutputFormat {
  const normalized = boundedText(value, '输出格式', 32).toLowerCase();
  if (!MEDIA_EXTRACT_AUDIO_OUTPUT_FORMATS.has(normalized as AgentMediaExtractAudioOutputFormat)) {
    throw new Error('输出格式无效');
  }
  return normalized as AgentMediaExtractAudioOutputFormat;
}

export function normalizeAgentMediaExtractAudioPreparedActionPublicV1(
  input: unknown,
): AgentMediaExtractAudioPreparedActionPublicV1 {
  const source = strictObject(input);
  if (
    source.kind !== AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND
    || source.version !== AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, MEDIA_EXTRACT_AUDIO_FIELDS);
  const destination = source.destination === 'library' || source.destination === 'local'
    ? source.destination
    : null;
  const fallbackPolicy = source.fallbackPolicy === 'prompt_local' || source.fallbackPolicy === 'none'
    ? source.fallbackPolicy
    : null;
  const conflictPolicy = source.conflictPolicy === 'auto_rename'
    || source.conflictPolicy === 'error'
    || source.conflictPolicy === 'replace'
    ? source.conflictPolicy
    : null;
  if (!destination || !fallbackPolicy || !conflictPolicy) {
    throw new Error('Agent prepared action 策略无效');
  }
  const hasParentId = Object.prototype.hasOwnProperty.call(source, 'parentId');
  const parentId = !hasParentId
    ? undefined
    : positiveId(source.parentId, '目标目录');
  if (destination === 'library' && !parentId) {
    throw new Error('资料库目标目录无效');
  }
  if (destination === 'local' && hasParentId) {
    throw new Error('本机目标不能包含资料库目录');
  }
  return {
    conflictPolicy,
    destination,
    fallbackPolicy: destination === 'local' ? 'none' : fallbackPolicy,
    kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
    libraryId: positiveId(source.libraryId, '资料库'),
    outputFileName: safeFileName(source.outputFileName),
    outputFormat: outputFormat(source.outputFormat),
    ...(destination === 'library' && parentId ? { parentId } : {}),
    sourceNodeId: positiveId(source.sourceNodeId, '源文件'),
    targetLabel: safeTargetLabel(source.targetLabel),
    version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
  };
}

export function normalizeAgentPreparedActionPublic(
  input: unknown,
): AgentPreparedActionPublic {
  const source = strictObject(input);
  const kind = Object.getOwnPropertyDescriptor(source, 'kind')?.value;
  const version = Object.getOwnPropertyDescriptor(source, 'version')?.value;
  if (kind === undefined || version === undefined) throw new Error('Agent prepared action 类型或版本不受支持');
  if (kind === AGENT_COMPUTER_INPUT_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_INPUT_PREPARED_ACTION_VERSION) {
    return normalizeAgentComputerInputPreparedActionPublicV1(source);
  }
  if (kind === AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_WINDOWS_PREPARED_ACTION_VERSION) {
    return normalizeAgentComputerWindowsPreparedActionPublicV1(source);
  }
  if (kind === AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_SET_TEXT_PREPARED_ACTION_VERSION) {
    return normalizeAgentComputerSetTextPreparedActionPublicV1(source);
  }
  if (kind === AGENT_COMPUTER_SCROLL_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_SCROLL_PREPARED_ACTION_VERSION) {
    return normalizeAgentComputerScrollPreparedActionPublicV1(source);
  }
  if (kind === AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION_V2) {
    return normalizeAgentComputerObservePreparedActionPublicV2(source);
  }
  if (kind === AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V2) {
    return normalizeAgentComputerClickPreparedActionPublicV2(source);
  }
  if (kind === AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION_V3) {
    return normalizeAgentComputerClickPreparedActionPublicV3(source);
  }
  if (kind === AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_OBSERVE_PREPARED_ACTION_VERSION) {
    return normalizeAgentComputerObservePreparedActionPublicV1(source);
  }
  if (kind === AGENT_COMPUTER_CLICK_PREPARED_ACTION_KIND && version === AGENT_COMPUTER_CLICK_PREPARED_ACTION_VERSION) {
    return normalizeAgentComputerClickPreparedActionPublicV1(source);
  }
  if (source.kind === AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_KIND && source.version === AGENT_PLUGIN_FILE_OUTPUT_PREPARED_ACTION_VERSION) {
    return normalizeAgentPluginFileOutputPreparedActionPublicV1(source);
  }
  if (source.kind === AGENT_PLUGIN_RENAME_PREPARED_ACTION_KIND && source.version === AGENT_PLUGIN_RENAME_PREPARED_ACTION_VERSION) {
    return normalizeAgentPluginRenamePreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_FILE_STAGE_PREPARED_ACTION_KIND
    && source.version === AGENT_FILE_STAGE_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentFileStagePreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND
    && source.version === AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentFilePublishPreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_FILE_UPLOAD_PREPARED_ACTION_KIND
    && source.version === AGENT_FILE_UPLOAD_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentFileUploadPreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND
    && source.version === AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentMediaExtractAudioPreparedActionPublicV1(source);
  }
  if (
    source.kind === AGENT_SHELL_RUN_TOOL_NAME
    && source.version === AGENT_SHELL_PREPARED_ACTION_VERSION
  ) {
    return normalizeAgentShellPreparedActionPublicV1(source);
  }
  throw new Error('Agent prepared action 类型或版本不受支持');
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(source[key])}`
    )).join(',')}}`;
  }
  return 'null';
}

export function equalAgentPreparedActionPublic(
  left: unknown,
  right: unknown,
): boolean {
  try {
    const normalizedLeft = normalizeAgentPreparedActionPublic(left);
    const normalizedRight = normalizeAgentPreparedActionPublic(right);
    return stableSerialize(normalizedLeft) === stableSerialize(normalizedRight);
  } catch {
    return false;
  }
}
