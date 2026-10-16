import type { AgentTool, AgentToolMainPreparationResult, AgentToolSnapshot } from '../agent-tool-registry';
import type { AgentPreparedActionPublic } from '../../../../src/shared/agent/agent.types';
import { agentComputerRuntime } from '../computer/agent-computer-service-runtime';
import { equalAgentPreparedActionPublic } from '../../../../src/shared/agent/agent-prepared-action';
import { COMPUTER_ELEMENT_OPERATIONS, COMPUTER_TEXT_MAX_UNICODE_SCALARS } from '../../../../src/shared/computer-use/computer-use-contract';
import { WINDOW_INPUT_MODIFIERS, WINDOW_INPUT_NAMED_KEYS, WINDOW_INPUT_DRAG_MIN_DURATION_MS,
  WINDOW_INPUT_DRAG_MAX_DURATION_MS, WINDOW_INPUT_SCROLL_MAX_DELTA, WINDOW_INPUT_OPERATIONS } from '../../../../src/shared/computer-use/window-input-contract';
import { AGENT_COMPUTER_STEP_TITLE_MAX_LENGTH } from '../../../../src/shared/agent/agent-computer-step-title';
import { WINDOW_MENU_OPERATIONS } from '../../../../src/shared/computer-use/window-menu-contract';

// Shared lifecycle/title guidance lives in agentComputerRoutingPrompt. Repeating
// it in every serialized schema can crowd out the task on smaller model windows.
const stepTitleSchema = { type: 'string', maxLength: AGENT_COMPUTER_STEP_TITLE_MAX_LENGTH,
  description: '本步目的，仅用于展示；规则见系统说明。' };

/** A model step label is display metadata, never part of a prepared host action. */
function withoutStepTitle(input: unknown): Record<string, unknown> {
  const actionInput = { ...input as Record<string, unknown> };
  delete actionInput.title;
  return actionInput;
}

const elementIdentitySchema = {
  observationId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' },
  elementId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' },
};

function inputOperationSchema(operation: string | string[], fields: string[]) {
  return { additionalProperties: false, properties: { observationId: {}, title: {}, operation: Array.isArray(operation) ? { enum: operation } : { const: operation },
    ...Object.fromEntries(fields.map(field => [field, {}])) },
    required: fields };
}

function checkRequestedAction(prepared: AgentToolMainPreparationResult, requested?: AgentPreparedActionPublic) {
  if (requested && !equalAgentPreparedActionPublic(requested, prepared.publicAction)) {
    throw new Error('屏幕操作不支持更改已准备的目标，请重新查看屏幕');
  }
  return prepared;
}

export function isBuiltinComputerHidePointerTool(tool?: AgentToolSnapshot | null): tool is AgentToolSnapshot {
  return !!tool && tool.name === 'computer.hidePointer' && tool.registrationId === 'builtin:computer.hidePointer@1'
    && tool.executor === 'main' && tool.kind === 'business' && tool.risk === 'read'
    && !tool.pluginSource && !tool.pluginOperation && typeof tool.execute === 'function'
    && !tool.prepareMain && !tool.preparedRisk && !tool.createRendererRequest
    && !tool.createRendererPrepareRequest && !tool.finalizeRendererPreparation;
}

export function getBuiltInAgentComputerTools(): AgentTool[] {
  if (process.platform !== 'darwin') return [];
  return [{
    name: 'computer.windows', registrationId: 'builtin:computer.windows@1', executor: 'main', risk: 'read', timeoutMs: 10_000,
    description: '查找可共享macOS普通窗，返回短期windowRef供observe，不读图/AX或授权。query搜应用/窗名，application筛应用，大小写无关；最多64项，truncated未全。最小化/隐藏/其他Space可能不可用，空结果≠无进程。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: stepTitleSchema,
      query: { type: 'string', minLength: 1, maxLength: 200 }, application: { type: 'string', minLength: 1, maxLength: 200 },
    } },
    presentation: { groupKind: 'resource-read', operationKind: 'read' },
    prepareMain: async (input, _requested, context) =>
      agentComputerRuntime.prepareWindows(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareWindows>[0], context),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('窗口查找缺少受控准备动作');
      return agentComputerRuntime.windows(context.preparation, context.signal);
    },
  }, {
    name: 'computer.observe', registrationId: 'builtin:computer.observe@1', executor: 'main', risk: 'read', timeoutMs: 60_000,
    description: '观察获准macOS窗；windows取windowRef，默认沿用，首次/换窗需授权。both默认图+AX，ax仅有界AX，screenshot仅图无动作。query筛label/description子串（忽略大小写）、role精确、operation、offset/limit；仅已扫控件，未列≠不存在。focus=原生ID自身/0..3父级，默认0，禁切窗/screenshot/第一方ID，失效不退全窗。scopeScanComplete局部、candidateScanComplete全窗；局部禁坐标/唯一性推断；axTreeTruncated仅摘要。includeChanges限同窗/mode/区域，差异不可操作，缺项≠删除。AX工具用elementId/operations；computer.input用availableInputOperations；匿名/坐标须both核对同imageId/screenshotBounds整图左上像素，禁顺序猜。labelSource:unique-actionable须全窗完整稳定唯一；native-scroll-button在ax须完整稳定、同轴父/方向按钮唯一，both须核对真实child bounds；重叠/不明停。omniflow-control仅固定Agent输入/对话区，非AX无press。scope=menu读本应用菜单/打开控件，默认ax，动作走computer.menu，截图不可用说明、不退整屏。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: stepTitleSchema,
      application: { type: 'string', minLength: 1, maxLength: 200 }, windowTitle: { type: 'string', minLength: 1, maxLength: 200 },
      mode: { enum: ['ax', 'screenshot', 'both'] },
      scope: { enum: ['menu'], description: '此应用菜单上下文，默认ax；不含其他普通窗口。' },
      includeChanges: { type: 'boolean' },
      focus: { type: 'object', additionalProperties: false, properties: {
        ...elementIdentitySchema, ancestorLevels: { type: 'integer', minimum: 0, maximum: 3 },
      }, required: ['observationId', 'elementId'] },
      query: { type: 'string', minLength: 1, maxLength: 200 }, role: { type: 'string', minLength: 1, maxLength: 80 },
      operation: { enum: [...COMPUTER_ELEMENT_OPERATIONS] },
      offset: { type: 'integer', minimum: 0, maximum: 128 }, limit: { type: 'integer', minimum: 1, maximum: 128 },
      windowRef: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' },
    }, not: { properties: { windowRef: {} }, required: ['windowRef'], anyOf: [
      { properties: { application: {} }, required: ['application'] }, { properties: { windowTitle: {} }, required: ['windowTitle'] },
    ] }, allOf: [{ not: { properties: { focus: {} }, required: ['focus'], anyOf: [
      { properties: { application: {} }, required: ['application'] },
      { properties: { windowTitle: {} }, required: ['windowTitle'] },
      { properties: { windowRef: {} }, required: ['windowRef'] },
      { properties: { mode: { const: 'screenshot' } }, required: ['mode'] },
    ] } }, { not: { properties: { scope: { const: 'menu' } }, required: ['scope'], anyOf: [
      { properties: { focus: {} }, required: ['focus'] },
      { properties: { operation: {} }, required: ['operation'] },
      { properties: { includeChanges: {} }, required: ['includeChanges'] },
    ] } }] },
    presentation: { groupKind: 'resource-read', operationKind: 'read' },
    // Recompute only from immutable Tool input; the orchestrator replaces approval if the window changed.
    prepareMain: async (input, _requested, context) =>
      agentComputerRuntime.prepareObserve(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareObserve>[0], context),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('屏幕共享缺少已批准的准备动作');
      return agentComputerRuntime.observe(context.preparation, context.signal);
    },
  }, {
    name: 'computer.click', registrationId: 'builtin:computer.click@1', executor: 'main', risk: 'write', timeoutMs: 10_000,
    cancellationSettleTimeoutMs: 6_000,
    description: '以AXPress激活声明press的按钮/控件；不移鼠标/置前。observationId+准确elementId优先；both可用x/y截图整数像素，ax仅ID，两种定位互斥。无AX动作的视觉单击、右键、双击用computer.input已声明的对应能力。',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { title: stepTitleSchema,
        observationId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' },
        elementId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' },
        x: { type: 'integer', minimum: 0, maximum: 2047 }, y: { type: 'integer', minimum: 0, maximum: 2047 },
        button: { enum: ['left'] }, clickCount: { type: 'integer', enum: [1] } },
      required: ['observationId'], oneOf: [
        { properties: { elementId: {} }, required: ['elementId'] },
        { properties: { x: {}, y: {} }, required: ['x', 'y'] },
      ], dependencies: { x: ['y'], y: ['x'] } },
    prepareMain: async (input, requested, context) => checkRequestedAction(
      await agentComputerRuntime.prepareClick(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareClick>[0], context), requested),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('屏幕点击缺少已批准的准备动作');
      return agentComputerRuntime.click(context.preparation, context.signal, context.commitSettlement);
    },
  }, {
    name: 'computer.setText', registrationId: 'builtin:computer.setText@1', executor: 'main', risk: 'write', timeoutMs: 10_000,
    cancellationSettleTimeoutMs: 6_000,
    description: '编辑声明replaceText/insertText的非安全原生控件或omniflow-control的Agent输入；不移鼠标/置前/全局键盘/剪贴板。replace全值替换，可清空；insert用冻结选区/光标，第一方仅草稿末尾折叠选区、复用owner、不自动发送，用户输入/IME时拒绝。原样Unicode≤4096字符/16KiB；禁凭据/密码/未知控件/网页/快捷键/IME。observationId+准确elementId，匿名both定位；第一方失败不转原生。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: stepTitleSchema,
      ...elementIdentitySchema, text: { type: 'string', maxLength: COMPUTER_TEXT_MAX_UNICODE_SCALARS }, mode: { enum: ['replace', 'insert'] },
    }, required: ['observationId', 'elementId', 'text', 'mode'] },
    prepareMain: async (input, requested, context) => checkRequestedAction(
      await agentComputerRuntime.prepareSetText(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareSetText>[0], context), requested),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('文字输入缺少已批准的准备动作');
      return agentComputerRuntime.setText(context.preparation, context.signal, context.commitSettlement);
    },
  }, {
    name: 'computer.scroll', registrationId: 'builtin:computer.scroll@1', executor: 'main', risk: 'write', timeoutMs: 10_000,
    cancellationSettleTimeoutMs: 6_000,
    description: '滚动elements.operations明确声明的方向/unit；无移鼠标/置前/全局滚轮。page=AX翻页或已确认原生页子按钮AXPress（仅对应方向page，禁click）；step=原生条增减；fraction=可写原生条已确认数值范围10%/截停，非页/视区比例。omniflow-control的Agent对话区域仅up/down：page视区高度，step40 CSS像素，fraction可滚范围（内容高度-视区高度）10%/截停；复用owner暂停跟随，内容/位置/范围漂移拒绝。observationId+准确elementId+direction+unit；无自定幅度/坐标猜测/点击键盘替代，失败不换unit。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: stepTitleSchema,
      ...elementIdentitySchema, direction: { enum: ['up', 'down', 'left', 'right'] }, unit: { enum: ['page', 'step', 'fraction'] },
    }, required: ['observationId', 'elementId', 'direction', 'unit'] },
    prepareMain: async (input, requested, context) => checkRequestedAction(
      await agentComputerRuntime.prepareScroll(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareScroll>[0], context), requested),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('滚动缺少已批准的准备动作');
      return agentComputerRuntime.scroll(context.preparation, context.signal, context.commitSettlement);
    },
  }, {
    name: 'computer.input', registrationId: 'builtin:computer.input@1', executor: 'main', risk: 'write', timeoutMs: 25_000,
    cancellationSettleTimeoutMs: 6_000,
    description: '按availableInputOperations向获准后台窗输入，AX优先。无置前/移真实指针/全局事件/剪贴板。click/rightClick/doubleClick=完整both图point；drag=不同point/endPoint+100..1000ms同窗；scroll=同图point+deltaX/Y像素，非同时0，Y正上负下。typeText=原样Unicode1..4096字符/16KiB，已确认焦点插入，不自动发送，正文main封存不入审计，禁凭据/安全控件。shortcut=key/modifiers，字母数字须command或control。全窗ax仅shortcut/typeText，局部/纯图无输入。操作后重观察，unknown禁重放/换路补发；新菜单先scope=menu。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: stepTitleSchema,
      observationId: elementIdentitySchema.observationId,
      operation: { enum: [...WINDOW_INPUT_OPERATIONS] },
      text: { type: 'string', minLength: 1, maxLength: COMPUTER_TEXT_MAX_UNICODE_SCALARS },
      deltaX: { type: 'integer', minimum: -WINDOW_INPUT_SCROLL_MAX_DELTA, maximum: WINDOW_INPUT_SCROLL_MAX_DELTA },
      deltaY: { type: 'integer', minimum: -WINDOW_INPUT_SCROLL_MAX_DELTA, maximum: WINDOW_INPUT_SCROLL_MAX_DELTA },
      shortcut: { type: 'object', additionalProperties: false, properties: {
        key: { type: 'string' },
        modifiers: { type: 'array', items: { enum: [...WINDOW_INPUT_MODIFIERS] }, maxItems: 4, uniqueItems: true },
      }, required: ['key', 'modifiers'], anyOf: [
        { properties: { key: { enum: [...WINDOW_INPUT_NAMED_KEYS] } } },
        { properties: { key: { type: 'string', pattern: '^[a-z0-9]$' }, modifiers: { type: 'array', contains: { enum: ['command', 'control'] } } } },
      ] },
      point: { type: 'object', additionalProperties: false, properties: {
        x: { type: 'integer', minimum: 0, maximum: 2047 }, y: { type: 'integer', minimum: 0, maximum: 2047 },
      }, required: ['x', 'y'] },
      endPoint: { type: 'object', additionalProperties: false, properties: {
        x: { type: 'integer', minimum: 0, maximum: 2047 }, y: { type: 'integer', minimum: 0, maximum: 2047 },
      }, required: ['x', 'y'] },
      durationMs: { type: 'integer', minimum: WINDOW_INPUT_DRAG_MIN_DURATION_MS, maximum: WINDOW_INPUT_DRAG_MAX_DURATION_MS },
    }, required: ['observationId', 'operation'], oneOf: [
      inputOperationSchema('shortcut', ['shortcut']),
      inputOperationSchema(['click', 'rightClick', 'doubleClick'], ['point']),
      inputOperationSchema('drag', ['point', 'endPoint', 'durationMs']),
      inputOperationSchema('typeText', ['text']),
      { ...inputOperationSchema('scroll', ['point', 'deltaX', 'deltaY']), allOf: [
        { not: { properties: { deltaX: { const: 0 }, deltaY: { const: 0 } }, required: ['deltaX', 'deltaY'] } },
      ] },
    ] },
    prepareMain: async (input, requested, context) => checkRequestedAction(
      await agentComputerRuntime.prepareInput(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareInput>[0], context), requested),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('后台输入缺少已批准的准备动作');
      return agentComputerRuntime.input(context.preparation, context.signal, context.commitSettlement);
    },
  }, {
    name: 'computer.menu', registrationId: 'builtin:computer.menu@1', executor: 'main', risk: 'write', timeoutMs: 10_000,
    cancellationSettleTimeoutMs: 6_000,
    description: '操作紧邻scope=menu观察的elementId及其menuOperations：open打开控件菜单/子菜单，press选择菜单项，cancel取消明确支持的菜单。此应用菜单以原获准窗口为锚点；不置前/移物理鼠标。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: stepTitleSchema, ...elementIdentitySchema, operation: { enum: [...WINDOW_MENU_OPERATIONS] },
    }, required: ['observationId', 'elementId', 'operation'] },
    prepareMain: async (input, requested, context) => checkRequestedAction(
      await agentComputerRuntime.prepareMenu(withoutStepTitle(input) as Parameters<typeof agentComputerRuntime.prepareMenu>[0], context), requested),
    execute: async (_input, context) => {
      if (!context.preparation) throw new Error('菜单操作缺少已批准的准备动作');
      return agentComputerRuntime.menu(context.preparation, context.signal, context.commitSettlement);
    },
  }, {
    name: 'computer.hidePointer', registrationId: 'builtin:computer.hidePointer@1', executor: 'main', kind: 'business',
    risk: 'read', timeoutMs: 10_000,
    description: '隐藏当前Run获准窗口上的AI箭头；点按/拖动后的箭头持续保留，确实不再需要时调用。只接受{}，不选择Run/窗口、不取消共享或输入能力、不读取屏幕；没有箭头时可重复调用。Run结束自动清理；closeConfirmed=false表示关闭未确认，不得声称已隐藏。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    assess: (_input, context) => context.hideComputerPointer
      ? { behavior: 'allow', risk: 'read' }
      : { behavior: 'deny', risk: 'read', message: 'AI箭头隐藏缺少当前Run的受控能力' },
    execute: async (_input, context) => {
      if (!context.hideComputerPointer) return { ok: false, message: 'AI箭头隐藏缺少当前Run的受控能力' };
      return context.hideComputerPointer(context.signal);
    },
  }];
}
