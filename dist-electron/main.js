import { dialog as X, net as Y, ipcMain as b, app as _, BrowserWindow as R } from "electron";
import { fileURLToPath as ee } from "node:url";
import w from "node:path";
import x, { existsSync as te } from "node:fs";
import F from "fs/promises";
import V from "os";
import M from "child_process";
import re from "fs";
import oe from "node:http";
import ne from "node:https";
function se(e) {
  e.handle("file:open", async () => {
    const t = await X.showOpenDialog({ properties: ["openFile"] });
    return t.canceled || t.filePaths.length === 0 ? null : await F.readFile(t.filePaths[0], "utf-8");
  }), e.handle("file:save", async (t, r, n) => (await F.writeFile(r, n, "utf-8"), !0));
}
var p = {}, y = V;
p.platform = function() {
  return process.platform;
};
p.cpuCount = function() {
  return y.cpus().length;
};
p.sysUptime = function() {
  return y.uptime();
};
p.processUptime = function() {
  return process.uptime();
};
p.freemem = function() {
  return y.freemem() / (1024 * 1024);
};
p.totalmem = function() {
  return y.totalmem() / (1024 * 1024);
};
p.freememPercentage = function() {
  return y.freemem() / y.totalmem();
};
p.freeCommand = function(e) {
  M.exec("free -m", function(t, r, n) {
    var s = r.split(`
`), o = s[1].replace(/[\s\n\r]+/g, " "), a = o.split(" ");
    total_mem = parseFloat(a[1]), free_mem = parseFloat(a[3]), buffers_mem = parseFloat(a[5]), cached_mem = parseFloat(a[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
p.harddrive = function(e) {
  M.exec("df -k", function(t, r, n) {
    var s = 0, o = 0, a = 0, f = r.split(`
`), u = f[1].replace(/[\s\n\r]+/g, " "), i = u.split(" ");
    s = Math.ceil(i[1] * 1024 / Math.pow(1024, 2)), o = Math.ceil(i[2] * 1024 / Math.pow(1024, 2)), a = Math.ceil(i[3] * 1024 / Math.pow(1024, 2)), e(s, a, o);
  });
};
p.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), M.exec(command, function(r, n, s) {
    var o = n.split(`
`);
    o.shift(), o.pop();
    var a = "";
    o.forEach(function(f, u) {
      var i = f.replace(/[\s\n\r]+/g, " ");
      i = i.split(" "), a += i[1] + " " + i[2] + " " + i[3] + " " + i[4].substring(i[4].length - 25) + `
`;
    }), t(a);
  });
};
p.allLoadavg = function() {
  var e = y.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
p.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var t = y.loadavg(), r = 0;
  return e == 1 && (r = t[0]), e == 5 && (r = t[1]), e == 15 && (r = t[2]), r;
};
p.cpuFree = function(e) {
  q(e, !0);
};
p.cpuUsage = function(e) {
  q(e, !1);
};
function q(e, t) {
  var r = N(), n = r.idle, s = r.total;
  setTimeout(function() {
    var o = N(), a = o.idle, f = o.total, u = a - n, i = f - s, d = u / i;
    e(t === !0 ? d : 1 - d);
  }, 1e3);
}
function N(e) {
  var t = y.cpus(), r = 0, n = 0, s = 0, o = 0, a = 0, u = 0;
  for (var f in t)
    r += t[f].times.user, n += t[f].times.nice, s += t[f].times.sys, a += t[f].times.irq, o += t[f].times.idle;
  var u = r + n + s + o + a;
  return {
    idle: o,
    total: u
  };
}
const ae = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", D = (e, ...t) => {
  ae && console[e](...t);
}, h = {
  debug: (...e) => D("debug", ...e),
  info: (...e) => D("info", ...e),
  log: (...e) => D("log", ...e),
  warn: (...e) => D("warn", ...e),
  error: (...e) => D("error", ...e)
};
function ie() {
  const e = de().total, t = V.cpus()[0].model, r = Math.floor(p.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: t,
    totalMemoryGB: r
  };
}
function de() {
  const e = re.statfsSync(process.platform === "win32" ? "C:" : "/"), t = e.blocks * e.bsize, r = e.bfree * e.bsize;
  return {
    total: Math.floor(t / 1e9),
    // 换算为 GB
    usage: 1 - r / t
    // 使用率计算
  };
}
function ce(e) {
  e.handle("sys:get-static-data", ie);
}
function le(e) {
  const t = /* @__PURE__ */ new Map(), r = (n, s = !1) => {
    const o = Date.now();
    if (!s && o - n.lastProgressAt < 80) return;
    n.lastProgressAt = o;
    const a = Math.max(o - n.startedAt, 1), f = Math.floor(n.uploadedBytes * 1e3 / a), u = n.totalBytes > 0 ? Math.min(n.uploadedBytes / n.totalBytes * 100, 100) : 0;
    n.sender.send("http:upload:progress", {
      uploadId: n.uploadId,
      uploadedBytes: n.uploadedBytes,
      totalBytes: n.totalBytes,
      percentage: u,
      speedBps: f
    });
  };
  e.handle("http:fetch", async (n, s, o = {}) => (h.debug("http:fetch start"), h.debug("http:fetch URL:", s), h.debug("http:fetch options:", o), new Promise((a, f) => {
    const u = Y.request({ url: s, method: o.method || "GET" });
    o.headers && Object.entries(o.headers).forEach(([d, m]) => {
      h.debug(`http:fetch set header ${d}: ${String(m)}`), u.setHeader(d, m);
    });
    let i = "";
    u.on("response", (d) => {
      h.debug("http:fetch response"), h.debug("http:fetch status:", d.statusCode), h.debug("http:fetch headers:", d.headers), d.on("data", (m) => {
        h.debug(`http:fetch chunk length: ${m.length}`), i += m;
      }), d.on("end", () => {
        h.debug("http:fetch body preview:", i.slice(0, 500));
        let m;
        try {
          m = JSON.parse(i);
        } catch {
          m = i;
        }
        a({
          status: d.statusCode,
          headers: d.headers,
          body: m
        });
      });
    }), u.on("error", (d) => {
      h.error("http:fetch error:", d), f(d);
    }), o.body && u.write(o.body), u.end();
  }))), e.handle("http:upload:abort", async (n, s) => {
    const o = t.get(s);
    if (!o) return !1;
    o.aborted = !0, t.delete(s);
    try {
      o.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      o.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (n, s, o, a = {}, f = {}, u) => new Promise((i, d) => {
    let m;
    try {
      m = x.statSync(o);
    } catch (c) {
      d(new Error(`读取上传文件失败: ${o} (${String(c)})`));
      return;
    }
    if (!m.isFile()) {
      d(new Error(`上传目标不是文件: ${o}`));
      return;
    }
    const S = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), P = u || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, Z = w.basename(o), L = Object.entries(a).map(([c, T]) => `--${S}\r
Content-Disposition: form-data; name="${c}"\r
\r
${T}\r
`).join(""), U = `--${S}\r
Content-Disposition: form-data; name="file"; filename="${Z}"\r
Content-Type: application/octet-stream\r
\r
`, $ = `\r
--${S}--\r
`, J = Buffer.byteLength(L) + Buffer.byteLength(U) + m.size + Buffer.byteLength($), K = {
      ...f,
      "Content-Type": `multipart/form-data; boundary=${S}`,
      "Content-Length": String(J)
    }, E = new URL(s), g = (E.protocol === "https:" ? ne : oe).request({
      protocol: E.protocol,
      hostname: E.hostname,
      port: E.port ? Number(E.port) : void 0,
      path: `${E.pathname}${E.search}`,
      method: "POST",
      headers: K
    }), O = x.createReadStream(o, {
      highWaterMark: 1024 * 1024
    }), v = {
      uploadId: P,
      request: g,
      fileStream: O,
      sender: n.sender,
      totalBytes: Math.max(0, m.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(P, v);
    let A = !1;
    const Q = (c) => {
      A || (A = !0, t.delete(P), i(c));
    }, B = (c) => {
      A || (A = !0, t.delete(P), d(c));
    };
    let I = "";
    g.on("response", (c) => {
      c.on("data", (T) => {
        I += T.toString();
      }), c.on("end", () => {
        let T;
        try {
          T = JSON.parse(I);
        } catch {
          T = I;
        }
        Q({
          status: c.statusCode,
          body: T
        });
      });
    }), g.on("error", (c) => {
      if (v.aborted) {
        B(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        O.destroy(c);
      } catch {
      }
      B(c);
    }), g.write(L), g.write(U), O.on("data", (c) => {
      v.aborted || (v.uploadedBytes += c.length, r(v));
    }), O.on("end", () => {
      v.aborted || (r(v, !0), g.write($), g.end());
    }), O.on("error", (c) => {
      if (v.aborted) {
        B(new Error("UPLOAD_ABORTED"));
        return;
      }
      B(c);
      try {
        g.destroy(c);
      } catch {
      }
    }), O.pipe(g, { end: !1 });
  }));
}
function fe() {
  se(b), ce(b), le(b);
}
const ue = w.dirname(ee(import.meta.url));
process.env.APP_ROOT = w.join(ue, "..");
const C = process.env.VITE_DEV_SERVER_URL, pe = w.join(process.env.APP_ROOT, "dist-electron"), H = w.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = C ? w.join(process.env.APP_ROOT, "public") : H;
const W = w.join(process.env.APP_ROOT, "build", "icons", "icon.png");
function j() {
  return te(W) ? W : null;
}
let l = null, z = !1, k = !1;
const me = 240;
function he(e) {
  if (e.type !== "keyDown")
    return !1;
  const t = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && t === "i";
}
function ge() {
  z || (z = !0, b.handle("zoom-adjust", (e, t) => {
    const r = R.fromWebContents(e.sender) ?? l;
    if (!r || r.isDestroyed())
      return null;
    const n = r.webContents.getZoomFactor(), s = Math.min(Math.max(n + t, 0.25), 3);
    return r.webContents.setZoomFactor(s), s;
  }), b.on("window-minimize", (e) => {
    const t = R.fromWebContents(e.sender) ?? l;
    t == null || t.minimize();
  }), b.on("window-maximize", (e) => {
    const t = R.fromWebContents(e.sender) ?? l;
    !t || t.isDestroyed() || (t.isMaximized() ? t.unmaximize() : t.maximize());
  }), b.on("window-close", (e) => {
    const t = R.fromWebContents(e.sender) ?? l;
    t == null || t.close();
  }), b.handle("window-activate", (e, t = !1) => {
    const r = R.fromWebContents(e.sender) ?? l;
    return !r || r.isDestroyed() ? !1 : (r.isMinimized() && r.restore(), r.isVisible() || r.show(), process.platform === "darwin" ? _.focus({ steal: !0 }) : _.focus(), typeof r.moveTop == "function" && r.moveTop(), r.focus(), t && !r.isAlwaysOnTop() && (r.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      r.isDestroyed() || r.setAlwaysOnTop(!1);
    }, me)), !0);
  }));
}
function G() {
  if (l && !l.isDestroyed())
    return l.show(), l.focus(), l;
  const e = j(), t = new R({
    width: 1200,
    height: 800,
    minWidth: 600,
    // 最小宽度
    minHeight: 400,
    // 最小高度
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: w.join(pe, "preload.mjs"),
      // Electron 安全推荐配置
      devTools: !0,
      webSecurity: !1
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: !0,
    // 自动隐藏菜单栏
    ...e ? { icon: e } : {}
  });
  return l = t, t.on("close", (r) => {
    process.platform === "darwin" && !k && (r.preventDefault(), t.hide());
  }), t.on("closed", () => {
    l === t && (l = null);
  }), t.webContents.session.webRequest.onHeadersReceived((r, n) => {
    n({
      responseHeaders: {
        ...r.responseHeaders,
        "Content-Security-Policy": [""]
        // 将其置为空
      }
    });
  }), t.webContents.on("before-input-event", (r, n) => {
    he(n) && (r.preventDefault(), t.webContents.toggleDevTools());
  }), C ? t.loadURL(C) : t.loadFile(w.join(H, "index.html")), t;
}
_.on("before-quit", () => {
  k = !0;
});
_.on("window-all-closed", () => {
  process.platform !== "darwin" && _.quit();
});
_.on("activate", () => {
  if (l && !l.isDestroyed()) {
    l.isMinimized() && l.restore(), l.show(), l.focus();
    return;
  }
  R.getAllWindows().length === 0 && G();
});
_.whenReady().then(() => {
  const e = j();
  e && process.platform === "darwin" && _.dock.setIcon(e), fe(), ge(), G();
});
export {
  pe as MAIN_DIST,
  H as RENDERER_DIST,
  C as VITE_DEV_SERVER_URL
};
