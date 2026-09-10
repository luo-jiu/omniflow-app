import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { terminateDesktopProcessTree } from '../../../platform/processTree';

export async function findOfficeRenderer(): Promise<string | undefined> {
  const names = process.platform === 'win32' ? ['soffice.exe'] : ['soffice', 'libreoffice'];
  const candidates = [process.env.OMNIFLOW_LIBREOFFICE_PATH,
    ...(process.platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/Applications/LibreOfficeDev.app/Contents/MacOS/soffice'] : []),
    ...(process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(base => path.join(base!, 'LibreOffice/program/soffice.exe')) : []),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(base => names.map(name => path.resolve(base, name))),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of new Set(candidates)) {
    try { if ((await stat(candidate)).isFile()) { await access(candidate, constants.X_OK); return candidate; } } catch { /* Try the next configured installation. */ }
  }
  return undefined;
}

export async function convertPresentationToPdf(bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const executable = await findOfficeRenderer();
  if (!executable) throw new Error('未找到 LibreOffice，PPTX 仍可读取文字和备注；页面查看需要安装 LibreOffice');
  const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-office-'));
  try {
    const profile = path.join(directory, 'profile');
    await mkdir(path.join(profile, 'user'), { recursive: true });
    await writeFile(path.join(profile, 'user/registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    const source = path.join(directory, 'source.pptx');
    await writeFile(source, bytes);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const environment = { ...process.env };
      const child = spawn(executable, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard',
        '--convert-to', 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"},"ExportNotesPages":{"type":"boolean","value":"false"}}',
        '--outdir', directory, source], { cwd: directory, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore', env: environment });
      let failure: Error | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (error: Error) => {
        if (failure) return; failure = error;
        terminateDesktopProcessTree(child, { environment, force: false });
        forceTimer = setTimeout(() => terminateDesktopProcessTree(child, { environment, force: true }), 1500);
      };
      const abort = () => stop(Object.assign(new Error('页面转换已取消'), { name: 'AbortError' }));
      const timer = setTimeout(() => stop(new Error('PPTX 页面转换超时')), 45000);
      const cleanup = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); signal.removeEventListener('abort', abort); };
      child.once('error', () => { cleanup(); reject(new Error('无法启动 LibreOffice 页面转换')); });
      child.once('close', code => { cleanup(); failure ? reject(failure) : code === 0 ? resolve() : reject(new Error('LibreOffice 页面转换失败')); });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    const destination = path.join(directory, 'source.pdf');
    const info = await stat(destination).catch(() => null);
    if (!info || info.size > 32 * 1024 * 1024) throw new Error('PPTX 转换未生成有效 PDF，或输出超过 32 MiB');
    return await readFile(destination);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
