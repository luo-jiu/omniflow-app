import crypto from 'node:crypto';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, type WebContents } from 'electron';

import type { AgentMediaArtifactSaveResult } from '@/shared/agent/agent.types';
import type { AgentMediaArtifact } from './agent-media-artifact-store';

interface SaveAgentMediaArtifactInput {
  artifact: AgentMediaArtifact;
  copyArtifact: (temporaryPath: string, signal: AbortSignal) => Promise<void>;
  defaultFileName: string;
  sender: WebContents;
  signal: AbortSignal;
}

interface SaveAgentMediaArtifactDependencies {
  removeFile?: typeof rm;
  renameFile?: typeof rename;
  showSaveDialog?: typeof dialog.showSaveDialog;
  statFile?: typeof stat;
}

function abortError(): Error {
  const error = new Error('Agent 本机保存已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function normalizeDefaultFileName(input: string, fallback: string): string {
  const candidate = path.basename(String(input || '').trim());
  if (!candidate || candidate === '.' || candidate === '..') return path.basename(fallback);
  return candidate.slice(0, 255);
}

function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

async function replaceTemporaryFile(
  temporaryPath: string,
  targetPath: string,
  dependencies: SaveAgentMediaArtifactDependencies,
): Promise<void> {
  const renameFile = dependencies.renameFile || rename;
  const removeFile = dependencies.removeFile || rm;
  const statFile = dependencies.statFile || stat;
  try {
    await renameFile(temporaryPath, targetPath);
    return;
  } catch (initialError) {
    const targetStat = await statFile(targetPath).catch(() => null);
    if (!targetStat?.isFile()) throw initialError;
  }

  const backupPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.omniflow-${crypto.randomUUID()}.backup`,
  );
  await renameFile(targetPath, backupPath);
  try {
    await renameFile(temporaryPath, targetPath);
  } catch (replaceError) {
    try {
      await renameFile(backupPath, targetPath);
    } catch {
      throw new Error('本机目标文件替换失败，原文件已保留为同目录临时备份');
    }
    throw replaceError;
  }
  await removeFile(backupPath, { force: true }).catch(() => undefined);
}

export async function saveAgentMediaArtifactAs(
  input: SaveAgentMediaArtifactInput,
  dependencies: SaveAgentMediaArtifactDependencies = {},
): Promise<AgentMediaArtifactSaveResult> {
  const removeFile = dependencies.removeFile || rm;
  throwIfAborted(input.signal);

  const defaultFileName = normalizeDefaultFileName(
    input.defaultFileName,
    input.artifact.fileName,
  );
  const extension = path.extname(defaultFileName).replace(/^\./u, '').slice(0, 16);
  const options = {
    defaultPath: defaultFileName,
    ...(extension
      ? { filters: [{ extensions: [extension], name: `${extension.toUpperCase()} 音频` }] }
      : {}),
    title: '保存提取后的音频',
  };
  const showSaveDialog = dependencies.showSaveDialog || dialog.showSaveDialog;
  const ownerWindow = BrowserWindow.fromWebContents(input.sender);
  const selection = ownerWindow
    ? await showSaveDialog(ownerWindow, options)
    : await showSaveDialog(options);
  throwIfAborted(input.signal);
  if (selection.canceled || !selection.filePath) return { canceled: true };

  const targetPath = path.resolve(selection.filePath);
  if (isPathInsideOrEqual(input.artifact.directoryPath, targetPath)) {
    throw new Error('不能将 Agent 媒体产物保存到内部临时位置');
  }
  const targetDirectory = path.dirname(targetPath);
  const temporaryPath = path.join(
    targetDirectory,
    `.${path.basename(targetPath)}.omniflow-${crypto.randomUUID()}.tmp`,
  );
  try {
    await input.copyArtifact(temporaryPath, input.signal);
    throwIfAborted(input.signal);
    await replaceTemporaryFile(temporaryPath, targetPath, dependencies);
  } finally {
    await removeFile(temporaryPath, { force: true }).catch(() => undefined);
  }
  return { canceled: false, fileName: path.basename(targetPath) };
}
