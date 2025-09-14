// main.ts (Electron 主进程入口文件)

import { app, BrowserWindow, ipcMain, net } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import registerIpcHandlers from './ipc'

// __dirname 处理（因为 ESM 下没有内置 __dirname）
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 设置应用根路径（APP_ROOT = 项目根目录）
process.env.APP_ROOT = path.join(__dirname, '..')

// 渲染进程与主进程的打包产物路径
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

// 在开发环境使用 public，生产环境使用 dist
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

/**
 * 创建应用窗口
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: path.join(MAIN_DIST, 'preload.mjs'),

      // Electron 安全推荐配置
      webSecurity: false,
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: true, // 自动隐藏菜单栏
    frame: false
  })

  // 窗口缩放因子（默认 1.0）
  let zoomFactor = 1.0

  // 处理渲染进程发来的缩放请求
  ipcMain.handle('zoom-adjust', (_, delta: number) => {
    zoomFactor = Math.min(Math.max(zoomFactor + delta, 0.25), 3)
    win.webContents.setZoomFactor(zoomFactor)
  })

  // 加载页面：开发环境走 Vite Dev Server，生产环境加载 dist/index.html
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // 接收渲染进程的 IPC 调用
  ipcMain.on('window-minimize', () => {
    win.minimize();
  });
  ipcMain.on('window-maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on('window-close', () => {
    win.close();
  });

  // ipcMain.handle('http:fetch', async (_event, url: string, options: any = {}) => {
  //   return new Promise((resolve, reject) => {
  //     const request = net.request({ url, method: options.method || 'GET' });
  //     if (options.headers) {
  //       Object.entries(options.headers).forEach(([key, value]) => {
  //         request.setHeader(key, value as string);
  //       });
  //     }
  //     let body = '';
  //     request.on('response', (response) => {
  //       response.on('data', (chunk) => { body += chunk; });
  //       response.on('end', () => {
  //         resolve({
  //           status: response.statusCode,
  //           headers: response.headers,
  //           body,
  //         });
  //       });
  //     });
  //     request.on('error', (err) => reject(err));
  //     if (options.body) {
  //       request.write(options.body);
  //     }
  //     request.end();
  //   });
  // });
  ipcMain.handle("http:fetch", async (_event, url: string, options: any = {}) => {
    console.log("start...");
    console.log("URL:", url);
    console.log("Options:", options);
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });
      // 设置请求头
      request.setHeader('Authorization', 'Bearer 906cd400-707b-4528-a8f6-ae54c8f819d2');
      request.setHeader('username', 'LJ');

      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          console.log(`set head... ${key}: ${value}`);
          request.setHeader(key, value as string);
        });
      }
      let body = "";
      request.on("response", (response) => {
        console.log("return info...");
        console.log("Status:", response.statusCode);
        console.log("Headers:", response.headers);

        response.on("data", (chunk) => {
          console.log(`data len... ${chunk.length})`);
          body += chunk;
        });
        response.on("end", () => {
          console.log("ok...");
          console.log("Body info... ", body.slice(0, 500)); // 只打印前 500 字符
          let parsedBody: any;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = body;
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsedBody,
          });
        });
      });
      request.on("error", (err) => {
        console.error("err... ", err);
        reject(err);
      });
      if (options.body) {
        console.log("go go go... ", options.body);
        request.write(options.body);
      }
      request.end();
    });
  });
}

/**
 * 应用生命周期
 */
// 所有窗口关闭时退出（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 点击 Dock 图标时，如果没有窗口则重新创建
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// app 初始化完成后创建窗口
app.whenReady().then(() => {
  registerIpcHandlers() // 注册自定义 IPC 事件
  createWindow()        // 创建主窗口
})
