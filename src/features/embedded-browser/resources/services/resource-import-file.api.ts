function assertDesktopSupport() {
  if (!window.electronAPI) {
    throw new Error('当前环境不支持资源导入到资源库')
  }
}

export async function createTempImportDirectory(): Promise<string> {
  assertDesktopSupport()
  return await window.electronAPI.createTempImportDirectory()
}

export async function getTempImportFileInfo(filePath: string): Promise<{
  filePath: string
  name: string
  size: number
}> {
  assertDesktopSupport()
  return await window.electronAPI.getTempImportFileInfo(filePath)
}

export async function cleanupTempImportPath(targetPath: string): Promise<boolean> {
  assertDesktopSupport()
  return Boolean(await window.electronAPI.cleanupTempImportPath(targetPath))
}
