/** Visible Workspace drawing policy only; no Session, Run, capture or input grant. */
export interface WorkspaceRenderingRegistrationInput {
  instanceId: string;
  ownerScope: { accountScope: string; backendScope: string };
  libraryId: number;
}
export interface WorkspaceRenderingRegistrationToken {
  registrationId: string;
  documentGeneration: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function fields(input: unknown, required: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Agent 工作区绘制协议无效');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || !required.includes(key) || !descriptors[key].enumerable || !('value' in descriptors[key]))) {
    throw new Error('Agent 工作区绘制字段无效');
  }
  return Object.fromEntries(keys.map(key => [key, descriptors[key as string].value]));
}
function uuid(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new Error('Agent 工作区绘制引用无效');
  return input;
}
export function normalizeWorkspaceRenderingRegistration(input: unknown): WorkspaceRenderingRegistrationInput {
  const data = fields(input, ['instanceId', 'ownerScope', 'libraryId']);
  const ownerScope = fields(data.ownerScope, ['accountScope', 'backendScope']);
  for (const value of Object.values(ownerScope)) {
    if (typeof value !== 'string' || !value || value.length > 512
      || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new Error('Agent 工作区绘制归属无效');
    }
  }
  if (typeof data.libraryId !== 'number' || !Number.isSafeInteger(data.libraryId) || data.libraryId <= 0) {
    throw new Error('Agent 工作区绘制资料库无效');
  }
  return { instanceId: uuid(data.instanceId), ownerScope: ownerScope as WorkspaceRenderingRegistrationInput['ownerScope'], libraryId: data.libraryId };
}
export function normalizeWorkspaceRenderingRegistrationToken(input: unknown): WorkspaceRenderingRegistrationToken {
  const data = fields(input, ['registrationId', 'documentGeneration']);
  return { registrationId: uuid(data.registrationId), documentGeneration: uuid(data.documentGeneration) };
}
