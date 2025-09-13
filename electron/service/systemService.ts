import osUtils from 'os-utils'
import fs from 'fs'
import os from 'os'
import {BrowserWindow} from "electron";

const POLLING_INTERVAL = 1000;

export function pollResources(mainWindow: BrowserWindow) {
  setInterval(async () => {
    const cpuUsage = await getCpuUsage()
    const ramUsage = getRamUsage()
    const storageData = getStorageData()
    console.log(storageData)
    mainWindow.webContents.send('statistics', { cpuUsage, ramUsage, storageData })
  }, POLLING_INTERVAL)
}

export function getStaticData() {
  const totalStorage = getStorageData().total
  const cpuModel = os.cpus()[0].model
  const totalMemoryGB = Math.floor(osUtils.totalmem() / 1024)
  return {
    totalStorage,
    cpuModel,
    totalMemoryGB,
  }
}

function getCpuUsage() {
  return new Promise((resolve) => {
    osUtils.cpuUsage(resolve)
  })
}

function getRamUsage() {
  return 1 - osUtils.freememPercentage()
}

function getStorageData() {
  const stats = fs.statfsSync(process.platform === 'win32' ? 'C:' : '/');
  const total = stats.blocks * stats.bsize;
  const free = stats.bfree * stats.bsize;

  return {
    total: Math.floor(total / 1_000_000_000), // 换算为 GB
    usage: 1 - free / total,                  // 使用率计算
  };
}