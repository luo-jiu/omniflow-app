const MAX_FILES = 50;
const MAX_NAME_BYTES = 240;
// Rejecting control characters is part of the portable filename contract.
// eslint-disable-next-line no-control-regex
const forbidden = /[\u0000-\u001f\u007f<>:"/\\|?*]/u;
const utf8 = new TextEncoder();

export class RenameProposalError extends Error {}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..'
    && name.trim() === name && !name.endsWith('.') && !forbidden.test(name)
    && utf8.encode(name).byteLength <= MAX_NAME_BYTES;
}

/** Pure proposal calculation. IDs are invocation-local tokens, never node IDs or paths. */
export function createRenameProposal(input) {
  if (!object(input) || Object.keys(input).some(key => !['parameters', 'files'].includes(key))
    || !object(input.parameters) || Object.keys(input.parameters).some(key => !['prefix', 'suffix'].includes(key))
    || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > MAX_FILES) {
    throw new RenameProposalError('无效的提案输入');
  }
  const { prefix = '', suffix = '' } = input.parameters;
  if ([prefix, suffix].some(value => typeof value !== 'string' || [...value].length > 80 || forbidden.test(value))) {
    throw new RenameProposalError('前后缀最多 80 字符且不能含路径或控制字符');
  }
  const changes = [];
  const ids = new Set();
  for (const file of input.files) {
    if (!object(file) || Object.keys(file).some(key => !['id', 'name'].includes(key))
      || typeof file.id !== 'string' || file.id.length < 1 || file.id.length > 64 || ids.has(file.id)
      || !validName(file.name)) throw new RenameProposalError('无效的授权文件');
    ids.add(file.id);
    const dot = file.name.lastIndexOf('.');
    const hasExtension = dot > 0 && dot < file.name.length - 1;
    const stem = hasExtension ? file.name.slice(0, dot) : file.name;
    const extension = hasExtension ? file.name.slice(dot) : '';
    const name = `${prefix}${stem}${suffix}${extension}`;
    if (!validName(name)) throw new RenameProposalError('生成的名称无效或超过 240 UTF-8 字节');
    if (name !== file.name) changes.push({ id: file.id, name });
  }
  return { changes };
}
