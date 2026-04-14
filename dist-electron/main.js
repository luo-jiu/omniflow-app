import { dialog as X, app as N, net as Jt, ipcMain as _, session as me, webContents as Gt, BrowserWindow as z, WebContentsView as Xt, screen as Zt } from "electron";
import { fileURLToPath as Yt } from "node:url";
import T from "node:path";
import Ae, { existsSync as Oe, mkdirSync as $e, constants as Qt, readFileSync as er, writeFileSync as tr } from "node:fs";
import $ from "fs/promises";
import Te, { mkdtemp as rr, writeFile as nr, rm as or, access as ar } from "node:fs/promises";
import lt from "node:http";
import ut from "node:https";
import ft from "os";
import ze from "child_process";
import ir from "fs";
import { Buffer as mt } from "node:buffer";
import { spawn as pt } from "node:child_process";
import sr from "node:os";
const be = 6e4;
async function He(e, t, r = {}, n = 0) {
  const a = new URL(e);
  if (a.protocol !== "http:" && a.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${a.protocol}`);
  const c = a.protocol === "https:" ? ut : lt;
  await Te.mkdir(T.dirname(t), { recursive: !0 }), await new Promise((m, w) => {
    let y = !1;
    const b = () => {
      y || (y = !0, m());
    }, S = (C) => {
      y || (y = !0, w(C));
    }, h = c.request({
      protocol: a.protocol,
      hostname: a.hostname,
      port: a.port ? Number(a.port) : void 0,
      path: `${a.pathname}${a.search}`,
      method: "GET",
      headers: r
    }, (C) => {
      C.setTimeout(be, () => {
        C.destroy(new Error(`下载响应超时: ${be}ms`));
      });
      const I = Number(C.statusCode || 0), F = C.headers.location;
      if (I >= 300 && I < 400 && F) {
        if (C.resume(), n >= 3) {
          S(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const s = new URL(F, e).toString();
        He(s, t, r, n + 1).then(b).catch(S);
        return;
      }
      if (I >= 400) {
        C.resume(), S(new Error(`下载失败: HTTP ${I} (${e})`));
        return;
      }
      const j = Ae.createWriteStream(t), u = async (s) => {
        try {
          j.destroy();
        } catch {
        }
        try {
          await Te.rm(t, { force: !0 });
        } catch {
        }
        S(s);
      };
      C.on("error", (s) => {
        u(s);
      }), j.on("error", (s) => {
        u(s);
      }), j.on("finish", () => b()), C.pipe(j);
    });
    h.setTimeout(be, () => {
      h.destroy(new Error(`下载请求超时: ${be}ms`));
    }), h.on("error", (C) => S(C)), h.end();
  });
}
const cr = "Omniflow Inbox", dr = 10 * 60 * 1e3, lr = 2, ur = 2e3, Le = 12, fr = T.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), ue = /* @__PURE__ */ new Map();
function je(e) {
  const t = String(e || "");
  return !!(!t || t === ".DS_Store" || t.startsWith("._") || t === "Thumbs.db");
}
function fe(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function mr(e) {
  const t = String(e || "").toLowerCase();
  return !t || t.startsWith(".") ? !0 : t.endsWith(".crdownload") || t.endsWith(".part") || t.endsWith(".tmp") || t.endsWith(".opdownload") || t.endsWith(".download");
}
function gt() {
  return T.join(N.getPath("userData"), "auto-import-staging");
}
function pr() {
  return T.join(N.getPath("userData"), "embedded-browser-downloads");
}
function bt(e, t) {
  const r = T.resolve(e), n = T.resolve(t);
  return r === n ? !0 : r.startsWith(`${n}${T.sep}`);
}
function gr(e) {
  const t = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
async function br(e, t) {
  try {
    await $.rename(e, t);
  } catch (r) {
    if ((r == null ? void 0 : r.code) !== "EXDEV")
      throw r;
    await $.copyFile(e, t), await $.rm(e, { force: !0 });
  }
}
function yr(e) {
  const t = Date.now();
  for (const [r, n] of ue.entries())
    e.has(r) || t - n.lastSeenAt <= dr || ue.delete(r);
}
async function hr(e, t = Le) {
  const r = String(e || "").trim(), n = r ? T.resolve(r) : T.join(N.getPath("downloads"), cr), o = await $.stat(n).catch(() => null);
  if (!(o != null && o.isDirectory()))
    return [];
  const a = await $.readdir(n, { withFileTypes: !0 }), c = /* @__PURE__ */ new Set(), m = Date.now(), w = [];
  for (const h of a) {
    if (!h.isFile() || je(h.name) || mr(h.name)) continue;
    const C = T.join(n, h.name), I = await $.stat(C).catch(() => null);
    if (!(I != null && I.isFile())) continue;
    c.add(C);
    const F = ue.get(C), u = (F ? F.size === I.size && F.mtimeMs === I.mtimeMs : !1) && F ? F.stableCount + 1 : 1;
    ue.set(C, {
      size: I.size,
      mtimeMs: I.mtimeMs,
      stableCount: u,
      lastSeenAt: m
    }), !(u < lr) && (m - I.mtimeMs < ur || w.push({
      sourcePath: C,
      name: h.name,
      size: I.size,
      mtimeMs: I.mtimeMs
    }));
  }
  if (yr(c), w.length === 0)
    return [];
  w.sort((h, C) => h.mtimeMs - C.mtimeMs);
  const y = gt();
  await $.mkdir(y, { recursive: !0 });
  const b = [], S = Math.max(1, Math.floor(Number(t) || Le));
  for (const h of w.slice(0, S)) {
    const C = T.join(y, gr(h.name));
    try {
      await br(h.sourcePath, C);
    } catch {
      continue;
    }
    ue.delete(h.sourcePath), b.push({
      name: h.name,
      size: h.size,
      localPath: C,
      relativePath: fe(h.name)
    });
  }
  return b;
}
async function wr(e) {
  const t = T.resolve(String(e || "").trim()), r = gt();
  return !t || !bt(t, r) ? !1 : (await $.rm(t, { force: !0 }), !0);
}
function Ye(e, t) {
  const r = fe(t || "");
  if (!r)
    return e;
  const n = r.split("/").filter(Boolean);
  for (const o of n) {
    if (o === "." || o === "..")
      throw new Error(`非法下载路径片段: ${o}`);
    if (o.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return T.join(e, ...n);
}
function yt(e, t) {
  return e.relativePath.localeCompare(t.relativePath, "zh-Hans-CN");
}
async function Sr(e) {
  return (await Promise.all(e.map(async (r) => {
    const n = await $.stat(r);
    if (!n.isFile())
      return null;
    const o = T.basename(r);
    return je(o) ? null : {
      name: o,
      size: n.size,
      localPath: r,
      relativePath: fe(o)
    };
  }))).filter((r) => !!r).sort(yt);
}
async function vr(e, t, r) {
  const n = [t], o = [];
  for (; n.length > 0; ) {
    const b = n.pop(), S = await $.readdir(b, { withFileTypes: !0 });
    for (const h of S) {
      if (h.name === "." || h.name === ".." || je(h.name) || h.isSymbolicLink())
        continue;
      const C = T.join(b, h.name);
      if (h.isDirectory()) {
        n.push(C);
        continue;
      }
      h.isFile() && o.push({
        absolutePath: C,
        name: h.name
      });
    }
  }
  const a = [], c = 48;
  let m = 0;
  const w = async () => {
    for (; m < o.length; ) {
      const b = m;
      if (m += 1, b >= o.length)
        return;
      const S = o[b], h = await $.stat(S.absolutePath).catch(() => null);
      if (!(h != null && h.isFile()))
        continue;
      const C = fe(T.relative(e, S.absolutePath)), I = fe(T.join(r, C));
      a.push({
        name: S.name,
        size: h.size,
        localPath: S.absolutePath,
        relativePath: I
      });
    }
  }, y = Math.min(c, Math.max(1, o.length));
  return await Promise.all(Array.from({ length: y }, () => w())), a;
}
async function Er(e) {
  const t = [];
  for (const r of e) {
    if (!(await $.stat(r)).isDirectory())
      continue;
    const o = T.basename(r), a = await vr(r, r, o);
    t.push(...a);
  }
  return t.sort(yt);
}
function Tr(e) {
  e.handle("file:open", async () => {
    const t = await X.showOpenDialog({
      properties: ["openFile", "dontAddToRecent"],
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (t.canceled || t.filePaths.length === 0)
      return { canceled: !0, content: "", filePath: "" };
    const r = t.filePaths[0];
    return {
      canceled: !1,
      content: await $.readFile(r, "utf-8"),
      filePath: r
    };
  }), e.handle("file:save", async (t, r, n) => (await $.writeFile(r, n, "utf-8"), !0)), e.handle("file:read-text", async (t, r) => {
    const n = T.resolve(String(r || "").trim());
    return {
      canceled: !1,
      content: await $.readFile(n, "utf-8"),
      filePath: n
    };
  }), e.handle("file:read-local-chrome-bookmarks", async () => {
    const t = T.join(N.getPath("home"), fr);
    return {
      canceled: !1,
      content: await $.readFile(t, "utf-8"),
      filePath: t
    };
  }), e.handle("dialog:pick-upload-files", async () => {
    const t = await X.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Sr(t.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const t = await X.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Er(t.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const t = await X.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("dialog:save-download-file", async (t, r) => {
    const n = await X.showSaveDialog({
      defaultPath: String(r || "download"),
      showsTagField: !1
    });
    return n.canceled || !n.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: n.filePath };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const t = await X.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (t, r, n = Le) => ({ canceled: !1, files: await hr(r, n) })), e.handle("fs:cleanup-auto-import-staged-file", async (t, r) => {
    try {
      return await wr(r);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (t, r, n = "") => {
    const o = Ye(r, n);
    return await $.mkdir(o, { recursive: !0 }), o;
  }), e.handle("fs:download-url-to-path", async (t, r, n, o, a = {}) => {
    const c = Ye(n, o);
    return await He(r, c, a), c;
  }), e.handle("fs:save-staged-download-file", async (t, r, n) => {
    const o = T.resolve(String(r || "").trim()), a = T.resolve(String(n || "").trim()), c = pr();
    if (!o || !bt(o, c))
      throw new Error("无效的下载临时文件");
    if (!a)
      throw new Error("无效的保存路径");
    return await $.mkdir(T.dirname(a), { recursive: !0 }), await $.copyFile(o, a), a;
  });
}
var q = {}, Q = ft;
q.platform = function() {
  return process.platform;
};
q.cpuCount = function() {
  return Q.cpus().length;
};
q.sysUptime = function() {
  return Q.uptime();
};
q.processUptime = function() {
  return process.uptime();
};
q.freemem = function() {
  return Q.freemem() / (1024 * 1024);
};
q.totalmem = function() {
  return Q.totalmem() / (1024 * 1024);
};
q.freememPercentage = function() {
  return Q.freemem() / Q.totalmem();
};
q.freeCommand = function(e) {
  ze.exec("free -m", function(t, r, n) {
    var o = r.split(`
`), a = o[1].replace(/[\s\n\r]+/g, " "), c = a.split(" ");
    total_mem = parseFloat(c[1]), free_mem = parseFloat(c[3]), buffers_mem = parseFloat(c[5]), cached_mem = parseFloat(c[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
q.harddrive = function(e) {
  ze.exec("df -k", function(t, r, n) {
    var o = 0, a = 0, c = 0, m = r.split(`
`), w = m[1].replace(/[\s\n\r]+/g, " "), y = w.split(" ");
    o = Math.ceil(y[1] * 1024 / Math.pow(1024, 2)), a = Math.ceil(y[2] * 1024 / Math.pow(1024, 2)), c = Math.ceil(y[3] * 1024 / Math.pow(1024, 2)), e(o, c, a);
  });
};
q.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), ze.exec(command, function(r, n, o) {
    var a = n.split(`
`);
    a.shift(), a.pop();
    var c = "";
    a.forEach(function(m, w) {
      var y = m.replace(/[\s\n\r]+/g, " ");
      y = y.split(" "), c += y[1] + " " + y[2] + " " + y[3] + " " + y[4].substring(y[4].length - 25) + `
`;
    }), t(c);
  });
};
q.allLoadavg = function() {
  var e = Q.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
q.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var t = Q.loadavg(), r = 0;
  return e == 1 && (r = t[0]), e == 5 && (r = t[1]), e == 15 && (r = t[2]), r;
};
q.cpuFree = function(e) {
  ht(e, !0);
};
q.cpuUsage = function(e) {
  ht(e, !1);
};
function ht(e, t) {
  var r = Qe(), n = r.idle, o = r.total;
  setTimeout(function() {
    var a = Qe(), c = a.idle, m = a.total, w = c - n, y = m - o, b = w / y;
    e(t === !0 ? b : 1 - b);
  }, 1e3);
}
function Qe(e) {
  var t = Q.cpus(), r = 0, n = 0, o = 0, a = 0, c = 0, w = 0;
  for (var m in t)
    r += t[m].times.user, n += t[m].times.nice, o += t[m].times.sys, c += t[m].times.irq, a += t[m].times.idle;
  var w = r + n + o + a + c;
  return {
    idle: a,
    total: w
  };
}
const Cr = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", le = (e, ...t) => {
  Cr && console[e](...t);
}, k = {
  debug: (...e) => le("debug", ...e),
  info: (...e) => le("info", ...e),
  log: (...e) => le("log", ...e),
  warn: (...e) => le("warn", ...e),
  error: (...e) => le("error", ...e)
};
function Rr() {
  const e = Br().total, t = ft.cpus()[0].model, r = Math.floor(q.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: t,
    totalMemoryGB: r
  };
}
function Br() {
  const e = ir.statfsSync(process.platform === "win32" ? "C:" : "/"), t = e.blocks * e.bsize, r = e.bfree * e.bsize;
  return {
    total: Math.floor(t / 1e9),
    // 换算为 GB
    usage: 1 - r / t
    // 使用率计算
  };
}
function Or(e) {
  e.handle("sys:get-static-data", Rr);
}
const Mr = 10 * 1024 * 1024 * 1024, _r = "10GB", xr = `上传失败：单文件最大支持 ${_r}`;
function wt(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Dr(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (t) => `%${t.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Pr(e) {
  const t = wt(e), r = Dr(e);
  return `Content-Disposition: form-data; name="file"; filename="${t}"; filename*=UTF-8''${r}\r
`;
}
function Ir(e) {
  const t = /* @__PURE__ */ new Map(), r = (n, o = !1) => {
    const a = Date.now();
    if (!o && a - n.lastProgressAt < 80) return;
    n.lastProgressAt = a;
    const c = Math.max(a - n.startedAt, 1), m = Math.floor(n.uploadedBytes * 1e3 / c), w = n.totalBytes > 0 ? Math.min(n.uploadedBytes / n.totalBytes * 100, 100) : 0;
    n.sender.send("http:upload:progress", {
      uploadId: n.uploadId,
      uploadedBytes: n.uploadedBytes,
      totalBytes: n.totalBytes,
      percentage: w,
      speedBps: m
    });
  };
  e.handle("http:fetch", async (n, o, a = {}) => (k.debug("http:fetch start"), k.debug("http:fetch URL:", o), k.debug("http:fetch options:", a), new Promise((c, m) => {
    const w = Jt.request({ url: o, method: a.method || "GET" });
    a.headers && Object.entries(a.headers).forEach(([b, S]) => {
      k.debug(`http:fetch set header ${b}: ${String(S)}`), w.setHeader(b, S);
    });
    let y = "";
    w.on("response", (b) => {
      k.debug("http:fetch response"), k.debug("http:fetch status:", b.statusCode), k.debug("http:fetch headers:", b.headers), b.on("data", (S) => {
        k.debug(`http:fetch chunk length: ${S.length}`), y += S;
      }), b.on("end", () => {
        k.debug("http:fetch body preview:", y.slice(0, 500));
        let S;
        try {
          S = JSON.parse(y);
        } catch {
          S = y;
        }
        c({
          status: b.statusCode,
          headers: b.headers,
          body: S
        });
      });
    }), w.on("error", (b) => {
      k.error("http:fetch error:", b), m(b);
    }), a.body && w.write(a.body), w.end();
  }))), e.handle("http:upload:abort", async (n, o) => {
    const a = t.get(o);
    if (!a) return !1;
    a.aborted = !0, t.delete(o);
    try {
      a.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      a.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (n, o, a, c = {}, m = {}, w) => new Promise((y, b) => {
    let S;
    try {
      S = Ae.statSync(a);
    } catch (P) {
      b(new Error(`读取上传文件失败: ${a} (${String(P)})`));
      return;
    }
    if (!S.isFile()) {
      b(new Error(`上传目标不是文件: ${a}`));
      return;
    }
    if (S.size > Mr) {
      b(new Error(xr));
      return;
    }
    const h = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), C = w || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, I = T.basename(a), F = Object.entries(c).map(([P, L]) => `--${h}\r
Content-Disposition: form-data; name="${wt(P)}"\r
\r
${L}\r
`).join(""), j = `--${h}\r
` + Pr(I) + `Content-Type: application/octet-stream\r
\r
`, u = `\r
--${h}--\r
`, s = Buffer.byteLength(F) + Buffer.byteLength(j) + S.size + Buffer.byteLength(u), v = {
      ...m,
      "Content-Type": `multipart/form-data; boundary=${h}`,
      "Content-Length": String(s)
    }, l = new URL(o), g = (l.protocol === "https:" ? ut : lt).request({
      protocol: l.protocol,
      hostname: l.hostname,
      port: l.port ? Number(l.port) : void 0,
      path: `${l.pathname}${l.search}`,
      method: "POST",
      headers: v
    }), B = Ae.createReadStream(a, {
      highWaterMark: 1024 * 1024
    }), R = {
      uploadId: C,
      request: g,
      fileStream: B,
      sender: n.sender,
      totalBytes: Math.max(0, S.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(C, R);
    let M = !1;
    const D = (P) => {
      M || (M = !0, t.delete(C), y(P));
    }, A = (P) => {
      M || (M = !0, t.delete(C), b(P));
    };
    let H = "";
    g.on("response", (P) => {
      P.on("data", (L) => {
        H += L.toString();
      }), P.on("end", () => {
        let L;
        try {
          L = JSON.parse(H);
        } catch {
          L = H;
        }
        D({
          status: P.statusCode,
          body: L
        });
      });
    }), g.on("error", (P) => {
      if (R.aborted) {
        A(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        B.destroy(P);
      } catch {
      }
      A(P);
    }), g.write(F), g.write(j), B.on("data", (P) => {
      R.aborted || (R.uploadedBytes += P.length, r(R));
    }), B.on("end", () => {
      R.aborted || (r(R, !0), g.write(u), g.end());
    }), B.on("error", (P) => {
      if (R.aborted) {
        A(new Error("UPLOAD_ABORTED"));
        return;
      }
      A(P);
      try {
        g.destroy(P);
      } catch {
      }
    }), B.pipe(g, { end: !1 });
  }));
}
function Fr() {
  Tr(_), Or(_), Ir(_);
}
function Ur() {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.getCatchToolkitState === 'function'
        ? probe.getCatchToolkitState
        : null
      return handler ? handler() : null
    })()
  `;
}
function kr(e) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.updateCatchToolkitState === 'function'
        ? probe.updateCatchToolkitState
        : null
      return handler ? handler(${JSON.stringify(e)}) : null
    })()
  `;
}
function Ar(e) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(e)}] === 'function'
        ? probe[${JSON.stringify(e)}]
        : null
      return handler ? handler() : false
    })()
  `;
}
function St(e) {
  if (!e || typeof e != "object")
    return null;
  const t = e;
  return typeof t.autoSeekToBufferedEnd != "boolean" || typeof t.autoDownloadOnComplete != "boolean" || typeof t.capturedMediaSizeBytes != "number" || typeof t.clearCacheOnComplete != "boolean" || typeof t.currentFileName != "string" || typeof t.isCaptureComplete != "boolean" || typeof t.manualFileName != "string" || typeof t.regexWarning != "string" || typeof t.regexRule != "string" || typeof t.restartAlwaysFromBeginning != "boolean" || typeof t.selectorWarning != "string" || typeof t.selectorRule != "string" || typeof t.streamCount != "number" || typeof t.trimExtraMediaHeaders != "boolean" ? null : {
    autoSeekToBufferedEnd: t.autoSeekToBufferedEnd,
    autoDownloadOnComplete: t.autoDownloadOnComplete,
    capturedMediaSizeBytes: t.capturedMediaSizeBytes,
    clearCacheOnComplete: t.clearCacheOnComplete,
    currentFileName: t.currentFileName,
    isCaptureComplete: t.isCaptureComplete,
    manualFileName: t.manualFileName,
    regexWarning: t.regexWarning,
    regexRule: t.regexRule,
    restartAlwaysFromBeginning: t.restartAlwaysFromBeginning,
    selectorWarning: t.selectorWarning,
    selectorRule: t.selectorRule,
    streamCount: t.streamCount,
    trimExtraMediaHeaders: t.trimExtraMediaHeaders
  };
}
async function Lr(e) {
  const t = await e(Ur());
  return St(t);
}
async function Nr(e, t) {
  const r = await e(
    kr(t)
  );
  return St(r);
}
async function Wr(e, t) {
  return !!await e(
    Ar(t)
  );
}
function $r(e) {
  _.handle("embedded-browser:open-tab", async (t, r, n) => e.openTab(t.sender, r, n)), _.handle("embedded-browser:activate-tab", (t, r) => e.activateTab(t.sender, r)), _.handle("embedded-browser:navigate", async (t, r, n) => e.navigate(t.sender, r, n)), _.handle("embedded-browser:resolve-favicon", async (t, r) => e.resolveFavicon(r)), _.handle(
    "embedded-browser:open-mapped-file",
    async (t, r, n, o, a) => e.openMappedFile(t.sender, r, n, o, a)
  ), _.handle("embedded-browser:reload", async (t, r) => e.reload(r)), _.handle("embedded-browser:go-back", async (t, r) => e.goBack(r)), _.handle("embedded-browser:go-forward", async (t, r) => e.goForward(r)), _.handle("embedded-browser:resource:list", (t, r) => e.listCapturedResources(r)), _.handle("embedded-browser:resource:start", (t, r) => e.startCapturedResources(r)), _.handle("embedded-browser:resource:stop", (t, r) => e.stopCapturedResources(r)), _.handle("embedded-browser:resource:clear", (t, r) => e.clearCapturedResources(r)), _.handle("embedded-browser:resource:open", async (t, r, n) => e.openResource(r, n)), _.handle("embedded-browser:resource:export", async (t, r, n) => e.exportResource(r, n)), _.handle(
    "embedded-browser:resource:preview",
    async (t, r, n) => e.previewResource(r, n)
  ), _.handle("embedded-browser:resource:catch-toolkit:get-state", async (t, r) => e.getCatchToolkitState(r)), _.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (t, r, n) => e.updateCatchToolkitState(r, n)
  ), _.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (t, r) => e.clearCatchMediaCache(r)), _.handle("embedded-browser:resource:catch-toolkit:download", async (t, r) => e.downloadCatchMedia(r)), _.handle("embedded-browser:resource:catch-toolkit:restart", async (t, r) => e.restartCatchMediaCapture(r)), _.handle(
    "embedded-browser:resource:merge-mse",
    async (t, r, n) => e.mergeMseResources(r, n)
  ), _.handle("embedded-browser:resource:start-deep-capture", async (t, r) => e.startDeepResourceCapture(r)), _.handle("embedded-browser:set-bounds", (t, r) => e.setBounds(t.sender, r)), _.handle("embedded-browser:close-tab", (t, r) => e.closeTab(t.sender, r)), _.handle("embedded-browser:cleanup-download-file", async (t, r) => e.cleanupDownloadFile(r)), _.handle("embedded-browser:deactivate", (t) => e.deactivate(t.sender)), _.handle("embedded-browser:close-all", (t) => e.closeAll(t.sender));
}
const pe = "persist:omniflow-embedded-browser", zr = "embedded-browser-downloads";
let Ie = null, et = !1;
function vt() {
  return T.join(N.getPath("userData"), zr);
}
function Hr() {
  const e = vt();
  return Oe(e) || $e(e, { recursive: !0 }), e;
}
function jr() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function Vr(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function ye(e, t) {
  var r, n;
  return {
    downloadId: t.downloadId,
    fileName: t.fileName,
    mimeType: t.mimeType,
    pageUrl: t.pageUrl,
    receivedBytes: t.receivedBytes ?? Math.max(0, Number(((r = e.getReceivedBytes) == null ? void 0 : r.call(e)) || 0)),
    state: t.state,
    tabId: t.tabId,
    tempPath: t.tempPath,
    totalBytes: t.totalBytes ?? Math.max(0, Number(((n = e.getTotalBytes) == null ? void 0 : n.call(e)) || 0)),
    url: t.url,
    ...t.error ? { error: t.error } : {}
  };
}
function qr() {
  return Ie || (Ie = me.fromPartition(pe)), Ie;
}
async function Et(e) {
  const t = T.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const r = T.resolve(vt());
  return t !== r && !t.startsWith(`${r}${T.sep}`) ? !1 : (await Te.rm(t, { force: !0 }), !0);
}
function Kr(e) {
  if (et)
    return;
  et = !0;
  const t = (o, a, c) => {
    const m = e.resolveTabIdByWebContents(c) || void 0;
    if (!m)
      return;
    const w = Hr(), y = jr(), b = a.getFilename() || "download", S = a.getURL() || "", h = c.getURL() || void 0, C = T.join(w, Vr(b));
    a.setSavePath(C), e.emitDownload(ye(a, {
      downloadId: y,
      fileName: b,
      mimeType: a.getMimeType() || void 0,
      pageUrl: h,
      state: "started",
      tabId: m,
      tempPath: C,
      url: S
    })), a.on("updated", (I, F) => {
      F === "progressing" && e.emitDownload(ye(a, {
        downloadId: y,
        fileName: b,
        mimeType: a.getMimeType() || void 0,
        pageUrl: h,
        state: "progress",
        tabId: m,
        tempPath: C,
        url: S
      }));
    }), a.once("done", (I, F) => {
      if (F === "completed") {
        e.emitDownload(ye(a, {
          downloadId: y,
          fileName: b,
          mimeType: a.getMimeType() || void 0,
          pageUrl: h,
          state: "completed",
          tabId: m,
          tempPath: C,
          url: S
        }));
        return;
      }
      Et(C).catch(() => {
      }), e.emitDownload(ye(a, {
        downloadId: y,
        error: F === "cancelled" ? "下载已取消" : `下载失败：${F}`,
        fileName: b,
        mimeType: a.getMimeType() || void 0,
        pageUrl: h,
        state: F === "cancelled" ? "cancelled" : "failed",
        tabId: m,
        tempPath: C,
        url: S
      }));
    });
  }, r = /* @__PURE__ */ new Set();
  [me.defaultSession, qr()].filter(Boolean).forEach((o) => {
    r.has(o) || (r.add(o), o.on("will-download", t));
  });
}
const Jr = /* @__PURE__ */ new Set(["m3u8", "mpd"]), Gr = /* @__PURE__ */ new Set([
  "mp4",
  "m4v",
  "m4a",
  "m4s",
  "mp3",
  "aac",
  "flac",
  "wav",
  "ogg",
  "oga",
  "ogv",
  "webm",
  "mkv",
  "mov",
  "avi",
  "ts",
  "flv"
]), Xr = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), Zr = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), Yr = /* @__PURE__ */ new Set(["key", "base64key"]), Qr = /* @__PURE__ */ new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
]);
function Fe(e, t) {
  if (!e)
    return "";
  const r = t.toLowerCase();
  for (const [n, o] of Object.entries(e))
    if (n.toLowerCase() === r)
      return Array.isArray(o) ? String(o[0] || "") : String(o || "");
  return "";
}
function Me(e) {
  var t;
  return ((t = String(e || "").split(";")[0]) == null ? void 0 : t.trim().toLowerCase()) || "";
}
function Ve(e) {
  try {
    const r = new URL(e).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (r == null ? void 0 : r[1]) || "";
  } catch {
    const t = String(e || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (t == null ? void 0 : t[1]) || "";
  }
}
function Tt(e) {
  const t = Me(e.mimeType), r = Ve(e.url);
  return Jr.has(r) || t.includes("mpegurl") || t.includes("dash+xml") ? "manifest" : Gr.has(r) || t.startsWith("video/") || t.startsWith("audio/") || e.resourceType === "media" || String(e.url || "").startsWith("blob:") ? "media" : Xr.has(r) || t.startsWith("image/") ? "image" : Zr.has(r) || t.includes("text/vtt") ? "subtitle" : r === "pdf" || t === "application/pdf" ? "document" : Yr.has(r) || e.resourceType === "key" || t === "application/octet-stream" ? "key" : "other";
}
function Ct(e) {
  return !e.url || e.url.startsWith("data:") ? !1 : e.kind !== "other" ? !0 : e.resourceType === "media" || e.url.startsWith("blob:");
}
function en(e) {
  const t = Number(e);
  return Number.isFinite(t) && t > 0 ? t : void 0;
}
function tn(e) {
  const t = String(e || "").trim();
  if (!t)
    return;
  const r = t.match(/\/(\d+)\s*$/);
  if (!(r != null && r[1]))
    return;
  const n = Number(r[1]);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
function Rt(e) {
  if (e.streamType)
    return e.streamType;
  const t = Me(e.mimeType);
  if (t.startsWith("audio/"))
    return "audio";
  if (t.startsWith("video/"))
    return "video";
  const r = String(e.url || "").toLowerCase();
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(r))
    return "audio";
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(r) || e.resourceType === "media")
    return "video";
}
function rn(e) {
  if (!e)
    return;
  const t = {};
  return Object.entries(e).forEach(([r, n]) => {
    const o = r.toLowerCase();
    if (!Qr.has(o))
      return;
    const a = String(n || "").trim();
    a && (t[o] = a);
  }), Object.keys(t).length ? t : void 0;
}
const Ce = /* @__PURE__ */ new Map();
let Ee = null;
function se() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function _e(e) {
  const t = String(e || "").trim();
  if (!t)
    return null;
  const r = Ce.get(t);
  if (r)
    return r;
  const n = se();
  return Ce.set(t, n), n;
}
function ge(e) {
  const t = String(e || "").trim();
  return t && Ce.get(t) || null;
}
function Bt(e, t, r, n) {
  return n ? `${e}::${t}::${n}` : `${e}::${t}::${r}`;
}
function nn(e, t, r, n) {
  return Bt(e, t, r, n);
}
function on(e) {
  return Array.from(e.values()).sort((t, r) => r.capturedAt - t.capturedAt);
}
function Z(e) {
  return {
    deepCaptureEnabled: e.deepCaptureEnabled,
    enabled: e.enabled,
    resources: on(e.resources)
  };
}
function an(e) {
  Ee = e;
}
function Ot(e, t) {
  const r = ge(e);
  if (!(r != null && r.enabled))
    return null;
  const n = String(t.url || "").trim();
  if (!n)
    return null;
  const o = String(t.resourceKey || "").trim() || void 0, a = Bt(e, t.source, n, o), c = r.resources.get(a), m = {
    ...c,
    ...t,
    ext: t.ext || (c == null ? void 0 : c.ext) || Ve(n) || void 0,
    id: nn(e, t.source, n, o),
    kind: t.kind,
    resourceKey: o,
    tabId: e,
    url: n
  };
  return JSON.stringify(c) !== JSON.stringify(m) ? (r.resources.set(a, m), Ee == null || Ee(m), m) : c || null;
}
function sn(e) {
  const t = ge(e);
  return Z(t || se());
}
function cn(e) {
  const t = _e(e);
  return t ? (t.enabled = !0, Z(t)) : Z(se());
}
function dn(e) {
  const t = _e(e);
  return t ? (t.enabled = !0, t.deepCaptureEnabled = !0, Z(t)) : Z(se());
}
function ln(e) {
  const t = _e(e);
  return t ? (t.enabled = !1, t.deepCaptureEnabled = !1, Z(t)) : Z(se());
}
function un(e) {
  const t = _e(e);
  return t ? (t.resources.clear(), Z(t)) : Z(se());
}
function tt(e) {
  Ce.delete(String(e || "").trim());
}
function fn(e) {
  var t;
  return !!((t = ge(e)) != null && t.deepCaptureEnabled);
}
const te = /* @__PURE__ */ new Map();
let rt = !1;
function mn(e) {
  rt || (rt = !0, an(e.emitResource), e.browserSession.webRequest.onBeforeSendHeaders((t, r) => {
    te.set(t.id, {
      referer: t.referrer || void 0,
      requestHeaders: rn(t.requestHeaders)
    }), r({ cancel: !1, requestHeaders: t.requestHeaders });
  }), e.browserSession.webRequest.onCompleted((t) => {
    if (!t.webContentsId) {
      te.delete(t.id);
      return;
    }
    const r = e.resolveTabIdByWebContentsId(t.webContentsId), n = r ? ge(r) : null;
    if (!r || !(n != null && n.enabled)) {
      te.delete(t.id);
      return;
    }
    if (t.statusCode < 200 || t.statusCode >= 400) {
      te.delete(t.id);
      return;
    }
    const o = Gt.fromId(t.webContentsId), a = String(t.url || "").trim(), c = te.get(t.id), m = Me(Fe(t.responseHeaders, "content-type")), w = Tt({
      mimeType: m,
      resourceType: t.resourceType,
      url: a
    });
    if (!Ct({ kind: w, resourceType: t.resourceType, url: a })) {
      te.delete(t.id);
      return;
    }
    Ot(r, {
      capturedAt: Date.now(),
      contentLength: tn(Fe(t.responseHeaders, "content-range")) || en(Fe(t.responseHeaders, "content-length")),
      ext: Ve(a) || void 0,
      kind: w,
      method: t.method || void 0,
      mimeType: m,
      pageUrl: (o == null ? void 0 : o.getURL()) || void 0,
      referer: (c == null ? void 0 : c.referer) || t.referrer || void 0,
      requestHeaders: c == null ? void 0 : c.requestHeaders,
      resourceType: t.resourceType || void 0,
      source: "network",
      statusCode: t.statusCode || void 0,
      streamType: Rt({
        mimeType: m,
        resourceType: t.resourceType,
        url: a
      }),
      url: a
    }), te.delete(t.id);
  }), e.browserSession.webRequest.onErrorOccurred((t) => {
    te.delete(t.id);
  }));
}
function pn(e, t) {
  const r = ge(e);
  if (!(r != null && r.enabled) || !r.deepCaptureEnabled)
    return null;
  const n = String(t.url || "").trim();
  if (!n)
    return null;
  const o = t.kind || Tt({
    mimeType: t.mimeType,
    resourceType: t.resourceType,
    url: n
  });
  return Ct({ kind: o, resourceType: t.resourceType, url: n }) ? Ot(e, {
    capturedAt: Number(t.capturedAt) || Date.now(),
    contentLength: t.contentLength,
    ext: t.ext,
    kind: o,
    method: t.method,
    mimeType: Me(t.mimeType),
    pageUrl: t.pageUrl,
    resourceType: t.resourceType,
    resourceKey: t.resourceKey,
    source: t.source || "probe",
    statusCode: t.statusCode,
    streamType: Rt({
      mimeType: t.mimeType,
      resourceType: t.resourceType,
      streamType: t.streamType,
      url: n
    }),
    url: n
  }) : null;
}
function Mt(e) {
  const t = String(e || "").trim();
  if (!t)
    return "";
  try {
    return new URL(t).origin;
  } catch {
    return "";
  }
}
function gn(e) {
  return e === "fileSystem";
}
async function bn(e, t) {
  const r = Mt(t);
  if (!r)
    return !1;
  const n = e.decisionCache.get(r);
  if (typeof n == "boolean")
    return n;
  const o = z.getFocusedWindow() ?? e.options.getMainWindow() ?? z.getAllWindows()[0] ?? void 0, { response: a } = await X.showMessageBox(o, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${r} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), c = a === 1;
  return e.decisionCache.set(r, c), c;
}
async function yn(e, t) {
  const r = Mt(t.origin);
  if (!r)
    return "deny";
  const n = z.getFocusedWindow() ?? e.getMainWindow() ?? z.getAllWindows()[0] ?? void 0, { response: o } = await X.showMessageBox(n, {
    type: "question",
    buttons: ["换个目录", "允许这次访问", "拒绝"],
    defaultId: 0,
    cancelId: 2,
    title: "网页请求访问受限路径",
    message: `${r} 想要访问受限路径。`,
    detail: String(t.path || ""),
    noLink: !0
  });
  return o === 0 ? "tryAgain" : o === 1 ? "allow" : "deny";
}
function hn(e) {
  const t = me.fromPartition(pe);
  t.setPermissionRequestHandler((r, n, o, a) => {
    if (!gn(String(n))) {
      o(!1);
      return;
    }
    bn(e, a.requestingUrl || "").then((c) => {
      o(c);
    }).catch(() => {
      o(!1);
    });
  }), t.on("file-system-access-restricted", (r, n, o) => {
    r.preventDefault(), yn(e.options, n).then((a) => {
      o(a);
    }).catch(() => {
      o("deny");
    });
  });
}
function wn(e) {
  Kr({
    emitDownload: e.emitDownload,
    resolveTabIdByWebContents: e.resolveTabIdByWebContents
  }), mn({
    browserSession: me.fromPartition(pe),
    emitResource: e.emitResource,
    resolveTabIdByWebContentsId: e.resolveTabIdByWebContentsId
  });
}
async function Sn(e, t) {
  if (!t || e.webContents.isDestroyed())
    return [];
  try {
    const r = await e.webContents.executeJavaScript(`
      (() => {
        const bodyText = document.body?.innerText?.trim() || ''
        const bodyHtmlLength = document.body?.innerHTML?.length || 0
        return {
          title: document.title || '',
          readyState: document.readyState || '',
          bodyTextPreview: bodyText.slice(0, 120),
          bodyHtmlLength,
          innerWidth: window.innerWidth || 0,
          innerHeight: window.innerHeight || 0,
          clientWidth: document.documentElement?.clientWidth || 0,
          clientHeight: document.documentElement?.clientHeight || 0,
          devicePixelRatio: window.devicePixelRatio || 0,
          userAgent: navigator.userAgent || '',
        }
      })()
    `, !0), n = [];
    return r != null && r.title && n.push(`title=${r.title}`), r != null && r.readyState && n.push(`readyState=${r.readyState}`), typeof (r == null ? void 0 : r.bodyHtmlLength) == "number" && n.push(`bodyHtml=${r.bodyHtmlLength}`), typeof (r == null ? void 0 : r.innerWidth) == "number" && typeof (r == null ? void 0 : r.innerHeight) == "number" && n.push(`viewport=${r.innerWidth}x${r.innerHeight}`), typeof (r == null ? void 0 : r.clientWidth) == "number" && typeof (r == null ? void 0 : r.clientHeight) == "number" && n.push(`client=${r.clientWidth}x${r.clientHeight}`), typeof (r == null ? void 0 : r.devicePixelRatio) == "number" && n.push(`dpr=${r.devicePixelRatio}`), r != null && r.bodyTextPreview && n.push(`preview=${r.bodyTextPreview}`), r != null && r.userAgent && n.push(`ua=${r.userAgent}`), n;
  } catch (r) {
    return [`inspect=${r instanceof Error ? r.message : String(r)}`];
  }
}
function _t(e, t) {
  const r = e.trim();
  if (!r)
    return "";
  if (r.startsWith("data:"))
    return r;
  try {
    return new URL(r, t || void 0).toString();
  } catch {
    return r;
  }
}
function vn(e, t) {
  var o;
  const r = (o = String(t || "").split(";")[0]) == null ? void 0 : o.trim();
  if (r != null && r.startsWith("image/"))
    return r;
  const n = (() => {
    try {
      return new URL(e).pathname.toLowerCase();
    } catch {
      return e.toLowerCase();
    }
  })();
  return n.endsWith(".svg") ? "image/svg+xml" : n.endsWith(".ico") ? "image/x-icon" : n.endsWith(".webp") ? "image/webp" : n.endsWith(".jpg") || n.endsWith(".jpeg") ? "image/jpeg" : "image/png";
}
async function xt(e, t) {
  if (!t || t.startsWith("data:"))
    return t;
  try {
    const r = await e.fetch(t);
    if (!r.ok)
      return "";
    const n = mt.from(await r.arrayBuffer());
    return n.length === 0 ? "" : `data:${vn(t, r.headers.get("content-type"))};base64,${n.toString("base64")}`;
  } catch (r) {
    return k.warn("embedded browser favicon load failed", {
      error: r instanceof Error ? r.message : String(r),
      iconUrl: t
    }), "";
  }
}
function En(e, t) {
  return xt(e.webContents.session, t);
}
function Tn(e, t) {
  const r = [], n = /<link\b[^>]*>/gi, o = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let a;
  for (; a = n.exec(e); ) {
    const c = a[0], m = /* @__PURE__ */ new Map();
    let w;
    for (o.lastIndex = 0; w = o.exec(c); )
      m.set(w[1].toLowerCase(), w[2] || w[3] || w[4] || "");
    const y = m.get("rel") || "", b = m.get("href") || "";
    if (!b || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(y))
      continue;
    const S = _t(b, t);
    S && r.push(S);
  }
  return r;
}
async function Cn(e) {
  const t = String((e == null ? void 0 : e.pageUrl) || "").trim(), r = me.fromPartition(pe), n = [], o = _t(String((e == null ? void 0 : e.iconUrl) || ""), t || void 0);
  if (o && !o.startsWith("data:") && n.push(o), t) {
    try {
      const c = await r.fetch(t), m = c.headers.get("content-type") || "";
      c.ok && /text\/html|application\/xhtml\+xml/i.test(m) && n.push(...Tn(await c.text(), t));
    } catch (c) {
      k.warn("embedded browser favicon page inspect failed", {
        error: c instanceof Error ? c.message : String(c),
        pageUrl: t
      });
    }
    try {
      const c = new URL(t).origin;
      n.push(`${c}/favicon.ico`);
    } catch {
    }
  }
  const a = /* @__PURE__ */ new Set();
  for (const c of n) {
    if (!c || a.has(c))
      continue;
    a.add(c);
    const m = await xt(r, c);
    if (m)
      return {
        dataUrl: m,
        iconUrl: c
      };
  }
  return {
    dataUrl: o.startsWith("data:") ? o : "",
    iconUrl: ""
  };
}
const Rn = "embedded-browser-open-files", nt = 'input[data-omniflow-browser-open-fallback="true"]';
function Dt() {
  return T.join(N.getPath("userData"), Rn);
}
function Bn() {
  const e = Dt();
  return Oe(e) || $e(e, { recursive: !0 }), e;
}
function On(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function Mn(e, t) {
  const r = T.resolve(e), n = T.resolve(t);
  return r === n ? !0 : r.startsWith(`${n}${T.sep}`);
}
async function _n(e) {
  const t = await e.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${nt}')
      if (!(fallback instanceof HTMLInputElement)) {
        fallback = document.createElement('input')
        fallback.type = 'file'
        fallback.multiple = false
        fallback.setAttribute('data-omniflow-browser-open-fallback', 'true')
        fallback.style.position = 'fixed'
        fallback.style.left = '-9999px'
        fallback.style.top = '-9999px'
        fallback.style.width = '1px'
        fallback.style.height = '1px'
        fallback.style.opacity = '0'
        fallback.style.pointerEvents = 'none'
        document.body.appendChild(fallback)
      }
      return '${nt}'
    })()
  `, !0);
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
async function xn(e, t, r) {
  var m;
  if (!t || r.length === 0)
    return !1;
  try {
    e.webContents.debugger.isAttached() || e.webContents.debugger.attach("1.3");
  } catch (w) {
    if (!String(w).includes("Already attached"))
      throw w;
  }
  const n = await e.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), o = Number(((m = n == null ? void 0 : n.root) == null ? void 0 : m.nodeId) || 0);
  if (!Number.isFinite(o) || o <= 0)
    return !1;
  const a = await e.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: o,
    selector: t
  }), c = Number((a == null ? void 0 : a.nodeId) || 0);
  return !Number.isFinite(c) || c <= 0 ? !1 : (await e.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: c,
    files: r
  }), !0);
}
async function Dn(e, t) {
  const r = await e.webContents.executeJavaScript(`
    (() => {
      const inputSelector = ${JSON.stringify(t)}
      const input = document.querySelector(inputSelector)
      if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
        return { ok: false }
      }

      const dataTransfer = new DataTransfer()
      Array.from(input.files).forEach((file) => dataTransfer.items.add(file))

      const centerX = Math.max(1, Math.floor(window.innerWidth / 2))
      const centerY = Math.max(1, Math.floor(window.innerHeight / 2))
      const centerTarget = document.elementFromPoint(centerX, centerY)

      const candidates = []
      const pushCandidate = (candidate) => {
        if (!(candidate instanceof Element)) {
          return
        }
        if (candidates.includes(candidate)) {
          return
        }
        candidates.push(candidate)
      }

      pushCandidate(input)
      pushCandidate(input.closest('label'))
      pushCandidate(centerTarget)
      pushCandidate(document.querySelector('[data-testid*="drop"], [class*="drop"], [class*="upload"], [data-upload], main, [role="main"]'))
      pushCandidate(document.body)
      pushCandidate(document.documentElement)

      candidates.forEach((target) => {
        ['dragenter', 'dragover', 'drop'].forEach((eventType) => {
          const event = new DragEvent(eventType, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          })
          target.dispatchEvent(event)
        })
      })

      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))

      return {
        ok: true,
        candidateCount: candidates.length,
      }
    })()
  `, !0);
  return !!(r != null && r.ok);
}
async function Pn(e, t, r = {}) {
  const n = Bn(), o = T.join(n, On(t));
  return await He(e, o, r), o;
}
async function Re(e) {
  const t = T.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const r = T.resolve(Dt());
  return Mn(t, r) ? (await Te.rm(t, { force: !0 }), !0) : !1;
}
async function In(e, t) {
  if (!e || e.webContents.isDestroyed())
    return !1;
  const r = await _n(e);
  return !r || !await xn(e, r, [t]) ? !1 : Dn(e, r);
}
function he(e) {
  const t = e.pendingOpenFiles.get(e.tabId);
  t != null && t.stagedPath && Re(t.stagedPath).catch(() => {
  }), e.pendingOpenFiles.delete(e.tabId);
  const r = e.attachedOpenFiles.get(e.tabId);
  r && Re(r).catch(() => {
  }), e.attachedOpenFiles.delete(e.tabId);
}
function we(e) {
  const t = (e.requestVersions.get(e.tabId) ?? 0) + 1;
  return e.requestVersions.set(e.tabId, t), t;
}
function ot(e) {
  return e.requestVersions.get(e.tabId) === e.version;
}
function Fn(e, t) {
  try {
    const r = new URL(e), n = new URL(t);
    if (r.origin !== n.origin)
      return !1;
    const o = r.pathname.replace(/\/+$/, "") || "/", a = n.pathname.replace(/\/+$/, "") || "/";
    return a === "/" ? !0 : o === a || o.startsWith(`${a}/`);
  } catch {
    return !1;
  }
}
async function at(e) {
  const t = e.pendingOpenFiles.get(e.tabId);
  if (!t || e.view.webContents.isDestroyed())
    return !1;
  const r = e.view.webContents.getURL() || e.currentUrls.get(e.tabId) || "";
  if (!r || !Fn(r, t.pageUrl))
    return !1;
  try {
    if (!await In(e.view, t.stagedPath))
      return !1;
    const o = e.attachedOpenFiles.get(e.tabId);
    return o && o !== t.stagedPath && Re(o).catch(() => {
    }), e.attachedOpenFiles.set(e.tabId, t.stagedPath), e.pendingOpenFiles.delete(e.tabId), !0;
  } catch {
    return !1;
  }
}
function Un(e, t) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(e)}] === 'function'
        ? probe[${JSON.stringify(e)}]
        : null
      return handler ? Boolean(handler(${JSON.stringify(t)})) : false
    })()
  `;
}
function kn(e) {
  return `
    (() => {
      const preview = ${JSON.stringify(e)}
      const overlayId = '__omniflow_embedded_browser_resource_preview__'
      const previous = document.getElementById(overlayId)
      if (previous) {
        previous.remove()
      }

      const root = document.body || document.documentElement
      if (!root) {
        return false
      }

      const mimeType = String(preview.mimeType || '').toLowerCase()
      const streamType = preview.streamType === 'audio' || mimeType.startsWith('audio/')
        ? 'audio'
        : 'video'

      const overlay = document.createElement('div')
      overlay.id = overlayId
      overlay.style.position = 'fixed'
      overlay.style.inset = '0'
      overlay.style.zIndex = '2147483647'
      overlay.style.background = 'rgba(3, 7, 18, 0.78)'
      overlay.style.backdropFilter = 'blur(6px)'
      overlay.style.display = 'flex'
      overlay.style.alignItems = 'center'
      overlay.style.justifyContent = 'center'
      overlay.style.padding = '24px'

      const panel = document.createElement('div')
      panel.style.width = streamType === 'audio' ? 'min(640px, 96vw)' : 'min(1080px, 96vw)'
      panel.style.maxHeight = '88vh'
      panel.style.background = 'rgba(15, 23, 42, 0.96)'
      panel.style.border = '1px solid rgba(148, 163, 184, 0.28)'
      panel.style.borderRadius = '18px'
      panel.style.boxShadow = '0 32px 80px rgba(15, 23, 42, 0.45)'
      panel.style.display = 'flex'
      panel.style.flexDirection = 'column'
      panel.style.gap = '12px'
      panel.style.padding = '16px'

      const header = document.createElement('div')
      header.style.display = 'flex'
      header.style.alignItems = 'center'
      header.style.justifyContent = 'space-between'
      header.style.gap = '12px'

      const title = document.createElement('div')
      title.textContent = preview.title || (streamType === 'audio' ? '音频预览' : '视频预览')
      title.style.color = '#e2e8f0'
      title.style.fontSize = '14px'
      title.style.fontWeight = '600'
      title.style.wordBreak = 'break-all'
      header.appendChild(title)

      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = '关闭'
      close.style.border = '1px solid rgba(148, 163, 184, 0.28)'
      close.style.background = 'transparent'
      close.style.color = '#cbd5e1'
      close.style.borderRadius = '999px'
      close.style.padding = '6px 12px'
      close.style.cursor = 'pointer'
      close.addEventListener('click', () => {
        overlay.remove()
      })
      header.appendChild(close)

      const media = document.createElement(streamType === 'audio' ? 'audio' : 'video')
      media.controls = true
      media.autoplay = true
      media.preload = 'auto'
      media.src = preview.url
      if (streamType === 'video') {
        media.setAttribute('playsinline', 'true')
        media.style.width = '100%'
        media.style.maxHeight = '72vh'
        media.style.background = '#000'
        media.style.borderRadius = '14px'
      } else {
        media.style.width = '100%'
      }

      const meta = document.createElement('div')
      meta.textContent = preview.url
      meta.style.color = 'rgba(191, 219, 254, 0.78)'
      meta.style.fontSize = '12px'
      meta.style.lineHeight = '1.6'
      meta.style.wordBreak = 'break-all'

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          overlay.remove()
        }
      })

      panel.appendChild(header)
      panel.appendChild(media)
      panel.appendChild(meta)
      overlay.appendChild(panel)
      root.appendChild(overlay)

      media.play().catch(() => undefined)
      return true
    })()
  `;
}
function An(e) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.readResource === 'function'
        ? probe.readResource
        : null
      return handler ? handler(${JSON.stringify(e)}) : null
    })()
  `;
}
async function it(e, t, r) {
  const n = String(r || "").trim();
  return n ? !!await e(
    Un(t, n)
  ) : !1;
}
async function Ln(e, t) {
  return String(t.url || "").trim() ? !!await e(
    kn(t)
  ) : !1;
}
async function st(e, t) {
  const r = String(t || "").trim();
  if (!r)
    return null;
  const n = await e(
    An(r)
  );
  if (!n || typeof n != "object")
    return null;
  const o = n;
  return typeof o.base64 != "string" || typeof o.fileName != "string" ? null : {
    base64: o.base64,
    fileName: o.fileName,
    mimeType: typeof o.mimeType == "string" ? o.mimeType : void 0,
    resourceKey: typeof o.resourceKey == "string" ? o.resourceKey : r,
    streamType: o.streamType === "audio" || o.streamType === "video" ? o.streamType : void 0
  };
}
function Nn() {
  function e(u) {
    if (trackedMediaElements.has(u))
      return;
    trackedMediaElements.add(u), u.addEventListener("progress", () => {
      if (catchToolkitState.autoSeekToBufferedEnd)
        try {
          if (!u.buffered || u.buffered.length === 0)
            return;
          const l = u.buffered.end(u.buffered.length - 1), p = Math.max(l - 5, 0), g = Number.isFinite(u.duration) ? u.duration : 0;
          if (g > 0 && l >= g)
            return;
          Math.abs(u.currentTime - p) > 1 && (u.currentTime = p);
        } catch {
        }
    });
    const s = () => {
      if (!(!catchToolkitState.restartAlwaysFromBeginning || autoRestartHandledMediaElements.has(u)))
        try {
          autoRestartHandledMediaElements.add(u), n(), u.currentTime = 0;
        } catch {
        }
    };
    u.addEventListener("play", () => {
      s();
    }, { once: !0 });
    const v = window.setInterval(() => {
      if (autoRestartHandledMediaElements.has(u) || !catchToolkitState.restartAlwaysFromBeginning) {
        window.clearInterval(v);
        return;
      }
      u.paused || (s(), window.clearInterval(v));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(v);
    }, 5e3);
  }
  function t() {
    typeof document > "u" || document.querySelectorAll("video, audio").forEach((u) => {
      u instanceof HTMLMediaElement && e(u);
    });
  }
  function r() {
    isWorkerScope || typeof MutationObserver > "u" || trackedMediaObserver || typeof document > "u" || (t(), trackedMediaObserver = new MutationObserver((u) => {
      u.forEach((s) => {
        s.addedNodes.forEach((v) => {
          if (v instanceof Element) {
            if (v instanceof HTMLMediaElement) {
              e(v);
              return;
            }
            v.querySelectorAll("video, audio").forEach((l) => {
              l instanceof HTMLMediaElement && e(l);
            });
          }
        });
      });
    }), trackedMediaObserver.observe(document.body || document.documentElement, {
      childList: !0,
      subtree: !0
    }));
  }
  function n() {
    let u = !1;
    return mseStreams.forEach((s) => {
      if (s.blobUrl && (URL.revokeObjectURL(s.blobUrl), s.blobUrl = ""), isCaptureComplete) {
        u = u || s.buffers.length > 0, s.buffers = [], s.bufferCount = 0, s.lastReportedBufferCount = 0, s.lastReportedBytes = 0, s.totalBytes = 0, m(s.streamId);
        return;
      }
      if (s.buffers.length > 1) {
        const v = s.buffers[0];
        s.buffers = v ? [v] : [], s.bufferCount = s.buffers.length, s.totalBytes = (v == null ? void 0 : v.byteLength) || 0, s.lastReportedBufferCount = s.bufferCount, s.lastReportedBytes = s.totalBytes, u = !0, m(s.streamId);
      }
    }), isCaptureComplete = !1, u;
  }
  function o() {
    if (typeof document > "u")
      return !1;
    const u = Array.from(mseStreams.values()).filter((v) => v.buffers.length > 0);
    if (u.length === 0)
      return !1;
    const s = resolveCatchToolkitFileName();
    return u.forEach((v) => {
      const l = normalizeBuffersForPlayback(v.buffers), p = new Blob(l, { type: v.mimeType }), g = document.createElement("a"), B = URL.createObjectURL(p), R = guessExtensionFromMimeType(v.mimeType, v.streamType), M = u.length > 1 && v.streamType ? `-${v.streamType}` : "";
      g.href = B, g.download = `${s}${M}.${R}`, g.click(), g.remove(), setTimeout(() => {
        URL.revokeObjectURL(B);
      }, 1e3);
    }), catchToolkitState.clearCacheOnComplete && setTimeout(() => {
      n();
    }, 0), !0;
  }
  function a() {
    if (typeof document > "u")
      return !1;
    n();
    let u = !1;
    return document.querySelectorAll("video, audio").forEach((s) => {
      if (s instanceof HTMLMediaElement)
        try {
          s.currentTime = 0, s.play().catch(() => {
          }), u = !0;
        } catch {
        }
    }), u;
  }
  function c(u) {
    return `mse-stream:${u}`;
  }
  function m(u) {
    const s = mseStreams.get(u);
    s && emit({
      contentLength: s.totalBytes,
      ext: guessExtensionFromMimeType(s.mimeType, s.streamType),
      kind: "media",
      mimeType: s.mimeType,
      resourceKey: c(u),
      resourceType: "mse-stream",
      source: "probe",
      streamType: s.streamType,
      url: s.blobUrl || `mse://capturing/${u}`
    });
  }
  function w(u) {
    const s = mseStreams.get(u);
    if (!s || s.buffers.length === 0)
      return !1;
    s.blobUrl && (URL.revokeObjectURL(s.blobUrl), s.blobUrl = "");
    try {
      const v = normalizeBuffersForPlayback(s.buffers);
      return s.blobUrl = URL.createObjectURL(new Blob(v, { type: s.mimeType })), m(u), !0;
    } catch {
      return !1;
    }
  }
  function y(u) {
    const s = mseStreams.get(u);
    return s ? (s.blobUrl || w(u), s.blobUrl) : "";
  }
  function b(u) {
    const s = mseStreams.get(u);
    if (!s)
      return "media.bin";
    const v = resolveCatchToolkitFileName(), l = s.streamType ? `-${s.streamType}` : "", p = guessExtensionFromMimeType(s.mimeType, s.streamType);
    return `${v}${l}.${p}`;
  }
  function S(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), v = y(s);
    if (!v || typeof document > "u")
      return !1;
    const l = document.createElement("a");
    return l.href = v, l.download = b(s), l.click(), l.remove(), catchToolkitState.clearCacheOnComplete && setTimeout(() => {
      n();
    }, 0), !0;
  }
  function h(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), v = y(s);
    return !v || !openWindow ? !1 : (openWindow(v, "_blank", "noopener,noreferrer"), !0);
  }
  async function C(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), v = mseStreams.get(s);
    if (!v || v.buffers.length === 0)
      return null;
    try {
      const l = normalizeBuffersForPlayback(v.buffers), g = await new Blob(l, { type: v.mimeType }).arrayBuffer();
      return {
        base64: arrayBufferToBase64(g),
        fileName: b(s),
        mimeType: v.mimeType,
        resourceKey: u,
        streamType: v.streamType
      };
    } catch {
      return null;
    }
  }
  function I(u) {
    const s = probeResources.get(u);
    return !(s != null && s.blobUrl) || !openWindow ? !1 : (openWindow(s.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function F(u) {
    const s = probeResources.get(u);
    if (!(s != null && s.blobUrl) || typeof document > "u")
      return !1;
    const v = document.createElement("a");
    return v.href = s.blobUrl, v.download = s.fileName, v.click(), v.remove(), !0;
  }
  function j(u) {
    const s = probeResources.get(u);
    return s ? Promise.resolve({
      base64: s.base64,
      fileName: s.fileName,
      mimeType: s.mimeType,
      resourceKey: u,
      streamType: s.streamType
    }) : Promise.resolve(null);
  }
  isWorkerScope || r(), globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return n();
    },
    downloadCatchMedia() {
      return o();
    },
    exportResource(u) {
      const s = String(u || "");
      return s.startsWith("mse-stream:") ? S(s) : s.startsWith("probe-resource:") ? F(s) : !1;
    },
    getCatchToolkitState() {
      return buildCatchToolkitState();
    },
    installedAt: Date.now(),
    openResource(u) {
      const s = String(u || "");
      return s.startsWith("mse-stream:") ? h(s) : s.startsWith("probe-resource:") ? I(s) : !1;
    },
    readResource(u) {
      const s = String(u || "");
      return s.startsWith("mse-stream:") ? C(s) : s.startsWith("probe-resource:") ? j(s) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return a();
    },
    seen,
    updateCatchToolkitState(u) {
      return typeof u.autoSeekToBufferedEnd == "boolean" && (catchToolkitState.autoSeekToBufferedEnd = u.autoSeekToBufferedEnd), typeof u.autoDownloadOnComplete == "boolean" && (catchToolkitState.autoDownloadOnComplete = u.autoDownloadOnComplete), typeof u.clearCacheOnComplete == "boolean" && (catchToolkitState.clearCacheOnComplete = u.clearCacheOnComplete), typeof u.manualFileName == "string" && (catchToolkitState.manualFileName = u.manualFileName), typeof u.regexRule == "string" && (catchToolkitState.regexRule = evaluateRegexRule(u.regexRule).rule), typeof u.restartAlwaysFromBeginning == "boolean" && (catchToolkitState.restartAlwaysFromBeginning = u.restartAlwaysFromBeginning), typeof u.selectorRule == "string" && (catchToolkitState.selectorRule = evaluateSelectorRule(u.selectorRule).rule), typeof u.trimExtraMediaHeaders == "boolean" && (catchToolkitState.trimExtraMediaHeaders = u.trimExtraMediaHeaders), persistCatchToolkitState(), isWorkerScope || r(), buildCatchToolkitState();
    }
  };
}
function Wn() {
  const e = globalThis, t = typeof document > "u" && typeof e.importScripts == "function";
  if (typeof e.open == "function" && e.open.bind(e), e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)
    return "already-installed";
  JSON.parse.bind(JSON), typeof console.info == "function" ? console.info.bind(console) : console.log.bind(console);
  const r = {
    autoDownloadOnComplete: "OmniflowCatchToolkit:autoDownloadOnComplete",
    autoSeekToBufferedEnd: "OmniflowCatchToolkit:autoSeekToBufferedEnd",
    clearCacheOnComplete: "OmniflowCatchToolkit:clearCacheOnComplete",
    manualFileName: "OmniflowCatchToolkit:manualFileName",
    regexRule: "OmniflowCatchToolkit:regexRule",
    restartAlwaysFromBeginning: "OmniflowCatchToolkit:restartAlwaysFromBeginning",
    selectorRule: "OmniflowCatchToolkit:selectorRule",
    trimExtraMediaHeaders: "OmniflowCatchToolkit:trimExtraMediaHeaders"
  }, n = {
    autoSeekToBufferedEnd: !1,
    autoDownloadOnComplete: !1,
    clearCacheOnComplete: !1,
    manualFileName: "",
    regexRule: "",
    restartAlwaysFromBeginning: !1,
    selectorRule: "",
    trimExtraMediaHeaders: !0
  };
  function o(y) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(y) || "").trim();
    } catch {
      return "";
    }
  }
  function a(y, b = !1) {
    try {
      return typeof localStorage > "u" ? b : localStorage.getItem(y) === "checked";
    } catch {
      return b;
    }
  }
  function c(y) {
    var S;
    const b = String(y || "").trim();
    if (!b)
      return {
        rule: "",
        warning: ""
      };
    if (typeof document > "u")
      return {
        rule: b,
        warning: ""
      };
    try {
      const h = document.querySelector(b), C = ((S = h == null ? void 0 : h.textContent) == null ? void 0 : S.trim()) || "";
      return {
        rule: b,
        warning: C ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function m(y) {
    const b = String(y || "").trim();
    if (!b)
      return {
        rule: "",
        warning: ""
      };
    try {
      return new RegExp(b, "g"), {
        rule: b,
        warning: ""
      };
    } catch {
      return {
        rule: "",
        warning: "正则表达式错误"
      };
    }
  }
  function w() {
    t || (n.autoDownloadOnComplete = a(
      r.autoDownloadOnComplete,
      n.autoDownloadOnComplete
    ), n.autoSeekToBufferedEnd = a(
      r.autoSeekToBufferedEnd,
      n.autoSeekToBufferedEnd
    ), n.clearCacheOnComplete = a(
      r.clearCacheOnComplete,
      n.clearCacheOnComplete
    ), n.manualFileName = o(r.manualFileName), n.restartAlwaysFromBeginning = a(
      r.restartAlwaysFromBeginning,
      n.restartAlwaysFromBeginning
    ), n.trimExtraMediaHeaders = a(
      r.trimExtraMediaHeaders,
      n.trimExtraMediaHeaders
    ), n.selectorRule = c(
      o(r.selectorRule)
    ).rule, n.regexRule = m(
      o(r.regexRule)
    ).rule);
  }
  w();
}
function $n() {
  var s, v;
  const e = globalScope.Worker;
  typeof e == "function" && (globalScope.Worker = new Proxy(e, {
    construct(l, p, g) {
      const [B, R] = p, M = () => {
        const H = typeof B == "string" ? B : String(B), P = toAbsoluteUrl(H) || H;
        if (!P)
          return "";
        const L = createProbeBootstrapSource(consolePrefix);
        let Y = "";
        if ((R == null ? void 0 : R.type) === "module")
          Y = `${L}import ${JSON.stringify(P)};
`;
        else {
          const G = new XMLHttpRequest();
          if (G.open("GET", P, !1), G.send(), G.status < 200 || G.status >= 300 || !G.responseText)
            return "";
          Y = `${L}${G.responseText}`;
        }
        return URL.createObjectURL(new Blob([Y], { type: "text/javascript" }));
      };
      let D = "";
      try {
        D = M();
      } catch {
        D = "";
      }
      const A = D ? Reflect.construct(l, [D, R], g) : Reflect.construct(l, p, g);
      return A.addEventListener("message", (H) => {
        consumeWorkerRelayMessage(H.data) && H.stopImmediatePropagation();
      }, { capture: !0 }), D && setTimeout(() => {
        URL.revokeObjectURL(D);
      }, 6e4), A;
    }
  }), globalScope.Worker.toString = function() {
    return e.toString();
  });
  const t = globalScope.MediaSource;
  if ((s = t == null ? void 0 : t.prototype) != null && s.addSourceBuffer) {
    const l = t.prototype.addSourceBuffer;
    t.prototype.addSourceBuffer = new Proxy(l, {
      apply(p, g, B) {
        var M;
        const R = Reflect.apply(p, g, B);
        try {
          ensureTrackedMediaObserver(), isCaptureComplete = !1;
          const D = g, A = String((B == null ? void 0 : B[0]) || "").trim(), H = ((M = A.split(";")[0]) == null ? void 0 : M.trim().toLowerCase()) || "", P = H.startsWith("audio/") ? "audio" : H.startsWith("video/") ? "video" : void 0, L = `${Date.now()}-${++mseSequence}`, Y = mediaSourceStreams.get(D) || [];
          if (Y.push(L), mediaSourceStreams.set(D, Y), mseStreams.set(L, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: A || (P === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: L,
            streamType: P,
            totalBytes: 0
          }), emitMseStream(L), R && typeof R.appendBuffer == "function") {
            const G = R.appendBuffer;
            R.appendBuffer = new Proxy(G, {
              apply(xe, De, oe) {
                const ce = Reflect.apply(xe, De, oe), V = mseStreams.get(L);
                if (!V)
                  return ce;
                const ae = cloneChunk(oe == null ? void 0 : oe[0]);
                return !ae || ae.byteLength === 0 || (V.buffers.push(ae), V.bufferCount += 1, V.totalBytes += ae.byteLength, (V.bufferCount <= 3 || V.bufferCount - V.lastReportedBufferCount >= 8 || V.totalBytes - V.lastReportedBytes >= 1024 * 512) && (V.lastReportedBufferCount = V.bufferCount, V.lastReportedBytes = V.totalBytes, emitMseStream(L))), ce;
              }
            });
          }
        } catch {
        }
        return R;
      }
    });
  }
  if ((v = t == null ? void 0 : t.prototype) != null && v.endOfStream) {
    const l = t.prototype.endOfStream;
    t.prototype.endOfStream = new Proxy(l, {
      apply(p, g, B) {
        const R = Reflect.apply(p, g, B);
        try {
          if (isCaptureComplete = !0, (mediaSourceStreams.get(g) || []).forEach((D) => {
            finalizeMseStream(D);
          }), catchToolkitState.autoDownloadOnComplete)
            return setTimeout(() => {
              downloadCatchMediaInternal();
            }, 500), R;
          catchToolkitState.clearCacheOnComplete && setTimeout(() => {
            clearCatchMediaCacheInternal();
          }, 0);
        } catch {
        }
        return R;
      }
    });
  }
  function r(l, p) {
    if (typeof l != "string")
      return;
    const g = l.trim();
    if (!g || emitKeyCandidateFromBase64(g))
      return;
    const B = g.split("").join("").trim();
    if (emitKeyCandidateFromHex(B))
      return;
    if (dataUrlPattern.test(g)) {
      const A = decodeDataUrlText(g);
      A && r(A, p);
      return;
    }
    const R = parseMaybeJson(g);
    if (R) {
      n(R);
      return;
    }
    const M = g.toUpperCase();
    if (M.startsWith("#EXTM3U") || M.includes("#EXTINF:")) {
      emitInlineManifest(g, "m3u8", p == null ? void 0 : p.baseUrl);
      return;
    }
    if (g.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || g.includes("<MPD") && g.includes("</MPD>")) {
      emitInlineManifest(g, "mpd", p == null ? void 0 : p.baseUrl);
      return;
    }
    const D = toAbsoluteUrl(g);
    D && emit({
      kind: classifyKind(D, p == null ? void 0 : p.mimeType),
      mimeType: p == null ? void 0 : p.mimeType,
      resourceType: p == null ? void 0 : p.resourceType,
      source: "probe",
      streamType: p == null ? void 0 : p.streamType,
      url: D
    });
  }
  function n(l, p = 0, g = /* @__PURE__ */ new WeakSet(), B = []) {
    if (p > 6 || l == null)
      return;
    if (l instanceof ArrayBuffer) {
      emitKeyCandidateFromBuffer(l);
      return;
    }
    if (ArrayBuffer.isView(l)) {
      emitKeyCandidateFromBuffer(l.buffer.slice(l.byteOffset, l.byteOffset + l.byteLength));
      return;
    }
    if (typeof l == "string") {
      r(l, {
        baseUrl: currentLocationHref,
        resourceType: "json",
        streamType: inferStreamTypeFromPath(B)
      });
      return;
    }
    if (typeof l != "object")
      return;
    const R = l;
    if (!g.has(R)) {
      if (g.add(R), Array.isArray(l)) {
        if (l.length === 16 && l.every((M) => typeof M == "number" && Number.isFinite(M) && M >= 0 && M <= 255)) {
          emitKeyCandidateFromBuffer(Uint8Array.from(l).buffer);
          return;
        }
        l.slice(0, 80).forEach((M, D) => {
          n(M, p + 1, g, B.concat(String(D)));
        });
        return;
      }
      Object.keys(l).slice(0, 80).forEach((M) => {
        n(l[M], p + 1, g, B.concat(M));
      });
    }
  }
  const o = typeof globalScope.fetch == "function" ? globalScope.fetch.bind(globalScope) : null;
  o && (globalScope.fetch = async function(l, p) {
    const g = typeof l == "string" ? l : l instanceof Request ? l.url : String(l);
    r(g, { resourceType: "fetch" });
    const B = await o(l, p);
    return r(B.url || g, {
      mimeType: B.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), B.clone().arrayBuffer().then((M) => {
      if (!M.byteLength || emitKeyCandidateFromBuffer(M))
        return;
      const D = new TextDecoder().decode(M);
      D.trim() && r(D, {
        baseUrl: B.url || g,
        mimeType: B.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), B;
  }, globalScope.fetch.toString = function() {
    return o.toString();
  });
  const a = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", c = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(l, p) {
    return this[a] = typeof p == "string" ? p : String(p), c.apply(this, arguments);
  };
  const m = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const l = this[a], p = this.responseURL || (typeof l == "string" ? l : "");
      if (r(p, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (emitKeyCandidateFromBuffer(this.response))
          return;
        const g = new TextDecoder().decode(this.response);
        g && r(g, {
          baseUrl: p,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        r(this.response, {
          baseUrl: p,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (this.response && typeof this.response == "object") {
        n(this.response);
        return;
      }
      typeof this.responseText == "string" && this.responseText.trim() && r(this.responseText, {
        baseUrl: p,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), m.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return c.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return m.toString();
  }, JSON.parse = function() {
    const l = originalJSONParse.apply(this, arguments);
    return n(l), l;
  }, JSON.parse.toString = function() {
    return originalJSONParse.toString();
  };
  const w = btoa;
  globalScope.btoa = function(l) {
    const p = w.apply(this, arguments);
    return emitKeyCandidateFromBase64(p), r(l, { baseUrl: currentLocationHref, resourceType: "btoa" }), p;
  }, btoa.toString = function() {
    return w.toString();
  };
  const y = atob;
  globalScope.atob = function(l) {
    const p = y.apply(this, arguments);
    return emitKeyCandidateFromBase64(l), r(p, { baseUrl: currentLocationHref, resourceType: "atob" }), p;
  }, atob.toString = function() {
    return y.toString();
  };
  const b = String.fromCharCode;
  String.fromCharCode = new Proxy(b, {
    apply(l, p, g) {
      const B = Reflect.apply(l, p, g);
      if (B.length >= 7) {
        if ((B.startsWith("#EXTM3U") || B.includes("#EXTINF:")) && (m3u8Accumulator += B, m3u8Accumulator.includes("#EXT-X-ENDLIST"))) {
          const M = m3u8Accumulator.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          emitInlineManifest(M, "m3u8", currentLocationHref), m3u8Accumulator = "";
        }
        const R = B.split("").join("").trim();
        emitKeyCandidateFromHex(R);
      }
      return B;
    }
  }), String.fromCharCode.toString = function() {
    return b.toString();
  };
  const S = Array.prototype.slice;
  Array.prototype.slice = function() {
    const l = S.apply(this, arguments);
    return Array.isArray(l) && l.length === 16 && l.every((p) => typeof p == "number" && Number.isFinite(p) && p >= 0 && p <= 255) && emitKeyCandidateFromBuffer(Uint8Array.from(l).buffer), l;
  }, Array.prototype.slice.toString = function() {
    return S.toString();
  };
  const h = Array.prototype.join;
  Array.prototype.join = function() {
    const l = h.apply(this, arguments);
    return typeof l == "string" && ((l.startsWith("#EXTM3U") || l.includes("#EXTINF:")) && r(l, { baseUrl: currentLocationHref, resourceType: "array-join" }), emitKeyCandidateFromBase64(l)), l;
  }, Array.prototype.join.toString = function() {
    return h.toString();
  };
  const C = globalScope.DataView;
  if (typeof C == "function") {
    const l = function(p, g, B) {
      const R = new C(p, g, B), M = () => {
        const D = R.buffer.slice(R.byteOffset, R.byteOffset + R.byteLength);
        emitKeyCandidateFromBuffer(D);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((D) => {
        const A = R[D];
        typeof A == "function" && (R[D] = function() {
          const H = A.apply(this, arguments);
          return M(), H;
        });
      }), M(), R;
    };
    l.prototype = C.prototype, l.toString = function() {
      return C.toString();
    }, globalScope.DataView = l;
  }
  function I(l) {
    return function() {
      const p = l.apply(this, arguments);
      return (p == null ? void 0 : p.byteLength) === 16 && emitKeyCandidateFromBuffer(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)), p;
    };
  }
  const F = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = I(F), Int8Array.prototype.subarray.toString = function() {
    return F.toString();
  };
  const j = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = I(j), Uint8Array.prototype.subarray.toString = function() {
    return j.toString();
  };
  const u = String.prototype.indexOf;
  String.prototype.indexOf = function(l, p) {
    const g = u.apply(this, arguments);
    if (l === "#EXTM3U" && g !== -1) {
      const B = String(this);
      r(B.slice(Math.max(p ?? 0, 0)), {
        baseUrl: currentLocationHref,
        resourceType: "string-indexof"
      });
    }
    return g;
  }, String.prototype.indexOf.toString = function() {
    return u.toString();
  };
}
const Ne = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function Ue(e) {
  const t = e.toString(), r = t.indexOf("{"), n = t.lastIndexOf("}");
  return r === -1 || n === -1 || n <= r ? "" : t.slice(r + 1, n).trim();
}
function zn() {
  return `function createProbeBootstrapSource(nextConsolePrefix) {
  return [
    ';(() => {',
    'const consolePrefix = ' + JSON.stringify(String(nextConsolePrefix || '')) + ';',
    'const probeRuntimeCoreBodySource = ' + JSON.stringify(probeRuntimeCoreBodySource) + ';',
    'const probePageActionsBodySource = ' + JSON.stringify(probePageActionsBodySource) + ';',
    'const probeRuntimeHooksBodySource = ' + JSON.stringify(probeRuntimeHooksBodySource) + ';',
    createProbeBootstrapSource.toString(),
    probeRuntimeCoreBodySource,
    probeRuntimeHooksBodySource,
    probePageActionsBodySource,
    "return 'installed';",
    '})();',
  ].join('\\n')
}`;
}
function Hn(e) {
  return [
    ";(() => {",
    `const consolePrefix = ${JSON.stringify(e.consolePrefix)};`,
    `const probeRuntimeCoreBodySource = ${JSON.stringify(e.runtimeCoreBodySource)};`,
    `const probePageActionsBodySource = ${JSON.stringify(e.pageActionsBodySource)};`,
    `const probeRuntimeHooksBodySource = ${JSON.stringify(e.runtimeHooksBodySource)};`,
    zn(),
    e.runtimeCoreBodySource,
    e.runtimeHooksBodySource,
    e.pageActionsBodySource,
    "return 'installed';",
    "})();"
  ].join(`
`);
}
function jn() {
  return Hn({
    consolePrefix: Ne,
    pageActionsBodySource: Ue(Nn),
    runtimeCoreBodySource: Ue(Wn),
    runtimeHooksBodySource: Ue($n)
  });
}
function Vn(e) {
  const t = e.views.get(e.tabId);
  if (t && !t.webContents.isDestroyed())
    return t;
  const r = new Xt({
    webPreferences: {
      devTools: !0,
      partition: pe
    }
  });
  r.webContents.setZoomFactor(1);
  const n = r.webContents.getUserAgent();
  return n.includes("Electron") && r.webContents.setUserAgent(
    n.replace(/\sElectron\/[^\s]+/g, "")
  ), e.syncBounds(r), e.views.set(e.tabId, r), r.webContents.on("did-start-loading", () => {
    e.emitTabState(e.tabId, r, {
      details: "did-start-loading",
      state: "loading",
      url: r.webContents.getURL() || e.currentUrls.get(e.tabId) || void 0
    });
  }), r.webContents.on("dom-ready", () => {
    e.createIfMissingProbe(e.tabId, r);
  }), r.webContents.on("did-stop-loading", async () => {
    if (r.webContents.isDestroyed())
      return;
    const o = r.webContents.getURL() || "";
    e.currentUrls.set(e.tabId, o), await e.tryDispatchPendingOpenFile(e.tabId, r);
    const a = await Sn(r, e.debugEnabled);
    e.emitTabState(e.tabId, r, {
      details: "did-stop-loading",
      ...a.length ? { meta: a } : {},
      state: "ready",
      url: o || void 0
    });
  }), r.webContents.on("did-navigate", (o, a) => {
    e.currentUrls.set(e.tabId, a), e.emitTabState(e.tabId, r, { details: "did-navigate", state: "ready", url: a }), e.tryDispatchPendingOpenFile(e.tabId, r);
  }), r.webContents.on("did-navigate-in-page", (o, a) => {
    e.currentUrls.set(e.tabId, a), e.emitTabState(e.tabId, r, { details: "did-navigate-in-page", state: "ready", url: a }), e.tryDispatchPendingOpenFile(e.tabId, r);
  }), r.webContents.on("page-title-updated", (o, a) => {
    e.emitTabState(e.tabId, r, {
      details: "page-title-updated",
      state: "ready",
      title: a || void 0,
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("page-favicon-updated", (o, a) => {
    const c = a.map((m) => String(m || "").trim()).find((m) => m) || "";
    c && En(r, c).then((m) => {
      !m || r.webContents.isDestroyed() || (e.iconSourceUrls.set(e.tabId, c), e.iconUrls.set(e.tabId, m), e.emitTabState(e.tabId, r, {
        details: "page-favicon-updated",
        iconSourceUrl: c,
        iconUrl: m,
        state: "ready",
        url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
      }));
    });
  }), r.webContents.on("did-fail-load", (o, a, c, m) => {
    a !== -3 && e.emitTabState(e.tabId, r, {
      details: `did-fail-load(${a})`,
      state: "error",
      message: `页面加载失败：${c || "未知错误"}`,
      url: m
    });
  }), r.webContents.on("render-process-gone", (o, a) => {
    e.emitTabState(e.tabId, r, {
      details: `render-process-gone:${a.reason}`,
      state: "error",
      message: `页面渲染进程异常退出：${a.reason}`,
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("console-message", (o, a, c, m, w) => {
    if (typeof c == "string" && c.startsWith(Ne)) {
      const y = c.slice(Ne.length);
      try {
        e.onProbePayload(JSON.parse(y));
      } catch (b) {
        k.warn("embedded browser resource payload parse failed", {
          error: b instanceof Error ? b.message : String(b),
          tabId: e.tabId
        });
      }
      return;
    }
    e.debugEnabled && a >= 2 && e.emitTabState(e.tabId, r, {
      details: `console:${w}:${m}`,
      state: "ready",
      message: c,
      meta: [`console-level=${a}`],
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.setWindowOpenHandler(({ url: o }) => (r.webContents.loadURL(o), { action: "deny" })), r;
}
function qn(e) {
  return (t) => {
    pn(e, {
      capturedAt: Number(t.capturedAt) || Date.now(),
      contentLength: typeof t.contentLength == "number" ? t.contentLength : void 0,
      ext: typeof t.ext == "string" ? t.ext : void 0,
      kind: typeof t.kind == "string" ? t.kind : void 0,
      mimeType: typeof t.mimeType == "string" ? t.mimeType : void 0,
      pageUrl: typeof t.pageUrl == "string" ? t.pageUrl : void 0,
      resourceKey: typeof t.resourceKey == "string" ? t.resourceKey : void 0,
      resourceType: typeof t.resourceType == "string" ? t.resourceType : void 0,
      source: "probe",
      streamType: t.streamType === "audio" || t.streamType === "video" ? t.streamType : void 0,
      url: typeof t.url == "string" ? t.url : ""
    });
  };
}
async function Kn(e, t, r) {
  if (!r(e) || t.webContents.isDestroyed())
    return !1;
  try {
    return await t.webContents.executeJavaScript(jn(), !0), !0;
  } catch (n) {
    return k.warn("embedded browser resource probe install failed", {
      error: n instanceof Error ? n.message : String(n),
      tabId: e,
      url: t.webContents.getURL() || ""
    }), !1;
  }
}
const Jn = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((e) => !!e);
function We(e) {
  return String(e || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function Gn(e) {
  if (!e || e === "ffmpeg")
    return !1;
  try {
    return await ar(e, Qt.X_OK), !0;
  } catch {
    return !1;
  }
}
async function Xn(e) {
  return new Promise((t) => {
    const r = pt(e, ["-version"], {
      stdio: "ignore"
    });
    r.once("error", () => t(!1)), r.once("exit", (n) => t(n === 0));
  });
}
async function Zn(e) {
  const t = [
    String(e || "").trim() || void 0,
    ...Jn
  ].filter((r, n, o) => !!r && o.indexOf(r) === n);
  for (const r of t) {
    if (r === "ffmpeg") {
      if (await Xn(r))
        return r;
      continue;
    }
    if (await Gn(r))
      return r;
  }
  return null;
}
function Yn(e) {
  return [
    "-y",
    "-i",
    e.videoPath,
    "-i",
    e.audioPath,
    "-c",
    "copy",
    e.outputPath
  ];
}
function Qn(e, t) {
  const r = We(T.parse(e).name), n = We(T.parse(t).name);
  return `${r.replace(/-video$/i, "").replace(/_video$/i, "") || n.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function eo() {
  return rr(T.join(sr.tmpdir(), "omniflow-resource-merge-"));
}
async function to(e) {
  e && await or(e, {
    force: !0,
    recursive: !0
  });
}
async function ct(e, t) {
  const r = T.join(e, We(t.fileName));
  return await nr(r, mt.from(t.base64, "base64")), r;
}
async function ro(e) {
  const t = await Zn(e.ffmpegPath);
  if (!t)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const r = await eo();
  try {
    const [n, o] = await Promise.all([
      ct(r, e.audio),
      ct(r, e.video)
    ]), a = Yn({
      audioPath: n,
      outputPath: e.outputPath,
      videoPath: o
    });
    return await new Promise((m, w) => {
      const y = [], b = [], S = pt(t, a, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      S.stdout.on("data", (h) => {
        y.push(String(h));
      }), S.stderr.on("data", (h) => {
        b.push(String(h));
      }), S.once("error", (h) => {
        w(h);
      }), S.once("exit", (h) => {
        if (h === 0) {
          m({
            commandArgs: a,
            ffmpegPath: t,
            outputPath: e.outputPath,
            stderr: b.join(""),
            stdout: y.join("")
          });
          return;
        }
        w(new Error(b.join("").trim() || `ffmpeg 退出码异常: ${h}`));
      });
    });
  } finally {
    await to(r).catch(() => {
    });
  }
}
function no(e) {
  const t = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map(), m = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new Map();
  let y = null, b = null, S = !1;
  function h(i) {
    k.log("[embedded-browser:main]", i);
    const d = e.getMainWindow();
    !d || d.isDestroyed() || d.webContents.send("embedded-browser:state", i);
  }
  function C(i) {
    const d = e.getMainWindow();
    !d || d.isDestroyed() || d.webContents.send("embedded-browser:download", i);
  }
  function I(i) {
    const d = e.getMainWindow();
    !d || d.isDestroyed() || d.webContents.send("embedded-browser:resource", i);
  }
  function F(i) {
    for (const [d, f] of t.entries())
      if (f.webContents === i)
        return d;
    return null;
  }
  function j(i) {
    for (const [d, f] of t.entries())
      if (f.webContents.id === i)
        return d;
    return null;
  }
  function u() {
    S || (S = !0, hn({
      decisionCache: w,
      options: e
    }));
  }
  function s() {
    wn({
      emitDownload: C,
      emitResource: I,
      resolveTabIdByWebContents: F,
      resolveTabIdByWebContentsId: j
    });
  }
  function v(i) {
    const d = i.webContents.getTitle().trim();
    if (d)
      return d;
  }
  function l(i, d, f) {
    h({
      canGoBack: d.webContents.canGoBack(),
      canGoForward: d.webContents.canGoForward(),
      iconSourceUrl: f.iconSourceUrl ?? o.get(i),
      iconUrl: f.iconUrl ?? n.get(i),
      tabId: i,
      title: f.title ?? v(d),
      ...f
    });
  }
  function p(i, d, f) {
    l(i, d, {
      state: "ready",
      url: (f == null ? void 0 : f.url) ?? (r.get(i) || d.webContents.getURL() || void 0),
      ...f
    });
  }
  function g(i) {
    const d = t.get(i);
    return !d || d.webContents.isDestroyed() ? (t.delete(i), r.delete(i), n.delete(i), o.delete(i), tt(i), null) : d;
  }
  async function B(i, d) {
    return Kn(
      i,
      d,
      fn
    );
  }
  async function R(i, d) {
    const f = String(i || "").trim();
    if (!f)
      return null;
    const E = g(f);
    return !E || E.webContents.isDestroyed() ? null : d((x) => E.webContents.executeJavaScript(x, !0), E);
  }
  async function M(i, d) {
    const f = String(i || "").trim(), E = String(d.audioResourceKey || "").trim(), O = String(d.videoResourceKey || "").trim();
    if (!f || !E || !O)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const x = await R(
        f,
        async (Ze) => Promise.all([
          st(Ze, E),
          st(Ze, O)
        ])
      ), [U, K] = x || [];
      if (!U || !K)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const ne = String(d.suggestedFileName || "").trim() || Qn(K.fileName, U.fileName), J = e.getMainWindow(), ee = J && !J.isDestroyed() ? J : void 0, de = {
        defaultPath: T.join(N.getPath("downloads"), ne),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, ie = ee ? await X.showSaveDialog(ee, de) : await X.showSaveDialog(de);
      if (ie.canceled || !ie.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const Xe = await ro({
        audio: U,
        ffmpegPath: d.ffmpegPath,
        outputPath: ie.filePath,
        video: K
      });
      return {
        ffmpegPath: Xe.ffmpegPath,
        ok: !0,
        outputPath: Xe.outputPath
      };
    } catch (x) {
      return k.warn("embedded browser resource merge failed", {
        audioResourceKey: E,
        error: x instanceof Error ? x.message : String(x),
        tabId: f,
        videoResourceKey: O
      }), {
        error: x instanceof Error ? x.message : String(x),
        ok: !1
      };
    }
  }
  function D(i) {
    i.setBounds(b ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function A(i) {
    if (!y)
      return;
    const d = g(y);
    if (!d) {
      y = null;
      return;
    }
    i.contentView.children.includes(d) && i.contentView.removeChildView(d), y = null;
  }
  function H(i) {
    const d = e.getMainWindow();
    return !d || d.isDestroyed() ? null : Vn({
      createIfMissingProbe: B,
      currentUrls: r,
      debugEnabled: e.debugEnabled,
      emitTabState: l,
      iconSourceUrls: o,
      iconUrls: n,
      onProbePayload: qn(i),
      syncBounds: D,
      tabId: i,
      tryDispatchPendingOpenFile: async (f, E) => at({
        attachedOpenFiles: c,
        currentUrls: r,
        pendingOpenFiles: a,
        tabId: f,
        view: E
      }),
      views: t
    });
  }
  function P(i, d, f = {}) {
    if (!i || i.isDestroyed())
      return null;
    if (!d)
      return A(i), null;
    const O = f.createIfMissing ?? !1 ? H(d) : g(d);
    return O ? (y && y !== d && A(i), D(O), i.contentView.children.includes(O) || i.contentView.addChildView(O), y = d, O) : (A(i), null);
  }
  async function L(i, d, f, E, O = !1) {
    if (!i || i.isDestroyed())
      return;
    const x = String(d || "").trim();
    if (!x)
      return;
    const U = P(i, x, { createIfMissing: !0 });
    if (!U || U.webContents.isDestroyed())
      return;
    const K = String(f || "").trim();
    if (!K) {
      l(x, U, {
        state: "ready",
        title: v(U) || "新标签页",
        url: r.get(x) || void 0
      });
      return;
    }
    const ne = r.get(x) || U.webContents.getURL();
    if (O && ne === K) {
      l(x, U, {
        state: "ready",
        url: ne || void 0
      });
      return;
    }
    l(x, U, {
      details: "load-url",
      state: "loading",
      url: K
    });
    try {
      await U.webContents.loadURL(K);
    } catch (J) {
      const ee = J instanceof Error ? J.message : String(J);
      if (ee.includes("ERR_ABORTED"))
        return;
      throw l(x, U, {
        details: E,
        state: "error",
        message: `页面加载失败：${ee}`,
        url: K
      }), J;
    }
  }
  function Y(i, d) {
    if (!i || i.isDestroyed())
      return;
    const f = String(d || "").trim();
    if (!f)
      return;
    const E = g(f);
    E && (i.contentView.children.includes(E) && i.contentView.removeChildView(E), y === f && (y = null), t.delete(f), r.delete(f), n.delete(f), o.delete(f), tt(f), we({
      requestVersions: m,
      tabId: f
    }), he({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: f
    }), E.webContents.isDestroyed() || E.webContents.close({ waitForBeforeUnload: !1 }));
  }
  async function G(i, d, f) {
    const E = z.fromWebContents(i) ?? e.getMainWindow(), O = String(d || "").trim();
    we({
      requestVersions: m,
      tabId: O
    }), he({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: O
    });
    const x = String(f || "").trim();
    if (!x) {
      h({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: O,
        title: "新标签页"
      });
      return;
    }
    await L(E, O, x, "open-exception", !0);
  }
  function xe(i, d) {
    const f = z.fromWebContents(i) ?? e.getMainWindow();
    P(f, d, { createIfMissing: !1 });
  }
  async function De(i, d, f) {
    const E = z.fromWebContents(i) ?? e.getMainWindow(), O = String(d || "").trim();
    we({
      requestVersions: m,
      tabId: O
    }), he({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: O
    }), await L(E, O, f, "navigate-exception");
  }
  async function oe(i, d, f, E, O) {
    const x = z.fromWebContents(i) ?? e.getMainWindow(), U = String(d || "").trim(), K = String(f || "").trim(), ne = String(E || "").trim(), J = String(O || "").trim() || "file";
    if (!U || !K || !ne)
      return;
    const ee = we({
      requestVersions: m,
      tabId: U
    });
    he({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: U
    });
    const de = await Pn(ne, J);
    if (!ot({
      requestVersions: m,
      tabId: U,
      version: ee
    })) {
      Re(de).catch(() => {
      });
      return;
    }
    if (a.set(U, {
      fileName: J,
      pageUrl: K,
      stagedPath: de
    }), await L(x, U, K, "navigate-exception"), !ot({
      requestVersions: m,
      tabId: U,
      version: ee
    }))
      return;
    const ie = g(U);
    ie && at({
      attachedOpenFiles: c,
      currentUrls: r,
      pendingOpenFiles: a,
      tabId: U,
      view: ie
    });
  }
  async function ce(i) {
    const d = String(i || "").trim();
    if (!d)
      return;
    const f = g(d);
    !f || f.webContents.isDestroyed() || (l(d, f, {
      details: "reload",
      state: "loading",
      url: r.get(d) || f.webContents.getURL() || void 0
    }), f.webContents.reload(), p(d, f, {
      details: "reload-requested"
    }));
  }
  async function V(i) {
    const d = String(i || "").trim();
    if (!d)
      return;
    const f = g(d);
    !f || f.webContents.isDestroyed() || (f.webContents.canGoBack() && f.webContents.goBack(), p(d, f, {
      details: "history-back"
    }));
  }
  async function ae(i) {
    const d = String(i || "").trim();
    if (!d)
      return;
    const f = g(d);
    !f || f.webContents.isDestroyed() || (f.webContents.canGoForward() && f.webContents.goForward(), p(d, f, {
      details: "history-forward"
    }));
  }
  async function Ge(i, d) {
    return R(i, async (f, E) => {
      try {
        return await it(f, "openResource", d);
      } catch (O) {
        return k.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: O instanceof Error ? O.message : String(O),
          resourceKey: String(d || "").trim(),
          tabId: String(i || "").trim(),
          url: E.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((f) => !!f);
  }
  async function At(i, d) {
    return R(i, async (f, E) => {
      try {
        return await it(f, "exportResource", d);
      } catch (O) {
        return k.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: O instanceof Error ? O.message : String(O),
          resourceKey: String(d || "").trim(),
          tabId: String(i || "").trim(),
          url: E.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((f) => !!f);
  }
  async function Lt(i, d) {
    return R(i, async (f) => {
      try {
        return await Ln(f, d);
      } catch (E) {
        return k.warn("embedded browser network resource preview failed", {
          error: E instanceof Error ? E.message : String(E),
          tabId: String(i || "").trim(),
          url: String(d.url || "").trim()
        }), !1;
      }
    }).then((f) => !!f);
  }
  async function Nt(i) {
    return R(i, async (d, f) => {
      try {
        return await Lr(d);
      } catch (E) {
        return k.warn("embedded browser catch toolkit get state failed", {
          error: E instanceof Error ? E.message : String(E),
          tabId: String(i || "").trim(),
          url: f.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), null;
      }
    });
  }
  async function Wt(i, d) {
    return R(i, async (f, E) => {
      try {
        return await Nr(f, d);
      } catch (O) {
        return k.warn("embedded browser catch toolkit update state failed", {
          error: O instanceof Error ? O.message : String(O),
          payload: d,
          tabId: String(i || "").trim(),
          url: E.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), null;
      }
    });
  }
  async function Pe(i, d, f) {
    return R(i, async (E, O) => {
      try {
        return await Wr(E, d);
      } catch (x) {
        return k.warn(`embedded browser catch toolkit ${f} failed`, {
          error: x instanceof Error ? x.message : String(x),
          tabId: String(i || "").trim(),
          url: O.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((E) => !!E);
  }
  async function $t(i) {
    const d = String(i || "").trim(), f = dn(d), E = g(d);
    return E && !E.webContents.isDestroyed() && (E.webContents.getURL() ? E.webContents.reload() : await B(d, E)), f;
  }
  function zt(i, d) {
    const f = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, E = z.fromWebContents(i) ?? e.getMainWindow(), O = E && !E.isDestroyed() ? Math.max(E.webContents.getZoomFactor(), 0.01) : 1;
    if (f.x = Math.max(0, Math.round(d.x * O)), f.y = Math.max(0, Math.round(d.y * O)), f.width = Math.max(0, Math.round(d.width * O)), f.height = Math.max(0, Math.round(d.height * O)), b = f, !y)
      return;
    const x = g(y);
    x && x.setBounds(f);
  }
  function Ht(i, d) {
    const f = z.fromWebContents(i) ?? e.getMainWindow();
    Y(f, d);
  }
  async function jt(i) {
    try {
      return await Et(i);
    } catch {
      return !1;
    }
  }
  function Vt(i) {
    const d = z.fromWebContents(i) ?? e.getMainWindow();
    !d || d.isDestroyed() || A(d);
  }
  function qt(i) {
    const d = z.fromWebContents(i) ?? e.getMainWindow();
    !d || d.isDestroyed() || (Array.from(t.keys()).forEach((f) => {
      Y(d, f);
    }), y = null, h({ state: "idle" }));
  }
  function Kt() {
    $r({
      activateTab: xe,
      cleanupDownloadFile: jt,
      clearCapturedResources: (i) => un(String(i || "").trim()),
      clearCatchMediaCache: (i) => Pe(i, "clearCatchMediaCache", "clear cache"),
      closeAll: qt,
      closeTab: Ht,
      deactivate: Vt,
      downloadCatchMedia: (i) => Pe(i, "downloadCatchMedia", "download"),
      exportResource: At,
      getCatchToolkitState: Nt,
      goBack: V,
      goForward: ae,
      listCapturedResources: (i) => sn(String(i || "").trim()),
      mergeMseResources: M,
      navigate: De,
      openMappedFile: oe,
      openResource: Ge,
      openTab: G,
      previewResource: Lt,
      reload: ce,
      resolveFavicon: Cn,
      restartCatchMediaCapture: (i) => Pe(i, "restartCatchMediaCapture", "restart"),
      setBounds: zt,
      startCapturedResources: (i) => cn(String(i || "").trim()),
      startDeepResourceCapture: $t,
      stopCapturedResources: (i) => ln(String(i || "").trim()),
      updateCatchToolkitState: Wt
    });
  }
  return {
    configureSession: u,
    initializeBridges: s,
    registerIpcHandlers: Kt
  };
}
const oo = 240;
function ao(e) {
  _.on("window-minimize", (t) => {
    const r = z.fromWebContents(t.sender) ?? e.getMainWindow();
    r == null || r.minimize();
  }), _.on("window-maximize", (t) => {
    const r = z.fromWebContents(t.sender) ?? e.getMainWindow();
    !r || r.isDestroyed() || (r.isMaximized() ? r.unmaximize() : r.maximize());
  }), _.on("window-close", (t) => {
    const r = z.fromWebContents(t.sender) ?? e.getMainWindow();
    r == null || r.close();
  }), _.handle("window-activate", (t, r = !1) => {
    const n = z.fromWebContents(t.sender) ?? e.getMainWindow();
    return !n || n.isDestroyed() ? !1 : (n.isMinimized() && n.restore(), n.isVisible() || n.show(), process.platform === "darwin" ? N.focus({ steal: !0 }) : N.focus(), typeof n.moveTop == "function" && n.moveTop(), n.focus(), r && !n.isAlwaysOnTop() && (n.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      n.isDestroyed() || n.setAlwaysOnTop(!1);
    }, oo)), !0);
  });
}
const io = T.dirname(Yt(import.meta.url));
process.env.APP_ROOT = T.join(io, "..");
const Be = process.env.VITE_DEV_SERVER_URL, so = T.join(process.env.APP_ROOT, "dist-electron"), Pt = T.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Be ? T.join(process.env.APP_ROOT, "public") : Pt;
const dt = T.join(process.env.APP_ROOT, "build", "icons", "icon.png"), co = "Omniflow", lo = "omniflow-app", uo = 1400, fo = 920, qe = 600, Ke = 400, mo = "window-state.json", po = 200, go = process.env.NODE_ENV === "test" || !!(Be || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", bo = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
bo || (N.commandLine.appendSwitch("disable-logging"), N.commandLine.appendSwitch("log-level", "3"));
N.setName(co);
try {
  const e = T.join(N.getPath("appData"), lo);
  N.setPath("userData", e);
} catch {
}
function It() {
  return Oe(dt) ? dt : null;
}
let W = null, Ft = !1, Se = null;
function Ut() {
  return T.join(N.getPath("userData"), mo);
}
function re(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function yo(e, t) {
  return e >= qe && t >= Ke;
}
function ho(e) {
  return Zt.getAllDisplays().some((r) => {
    const n = r.workArea;
    return e.x < n.x + n.width && e.x + e.width > n.x && e.y < n.y + n.height && e.y + e.height > n.y;
  });
}
function wo() {
  try {
    const e = Ut();
    if (!Oe(e))
      return null;
    const t = er(e, "utf-8"), r = JSON.parse(t);
    if (!re(r.width) || !re(r.height) || !yo(r.width, r.height))
      return null;
    const n = !!r.maximized, o = {
      width: r.width,
      height: r.height,
      maximized: n
    };
    return re(r.x) && re(r.y) && (o.x = r.x, o.y = r.y), re(o.x) && re(o.y) && (ho({
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height
    }) || (delete o.x, delete o.y)), o;
  } catch {
    return null;
  }
}
function Je(e) {
  if (!e.isDestroyed())
    try {
      const t = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), r = {
        x: t.x,
        y: t.y,
        width: Math.max(Math.round(t.width), qe),
        height: Math.max(Math.round(t.height), Ke),
        maximized: e.isMaximized()
      }, n = Ut();
      $e(T.dirname(n), { recursive: !0 }), tr(n, JSON.stringify(r), "utf-8");
    } catch {
    }
}
function ve(e) {
  Se && clearTimeout(Se), Se = setTimeout(() => {
    Se = null, Je(e);
  }, po);
}
function So(e) {
  if (e.type !== "keyDown")
    return !1;
  const t = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && t === "i";
}
function vo(e) {
  if (e.type !== "keyDown" || !(e.meta || e.control))
    return !1;
  const t = (e.key || "").toLowerCase();
  return t === "+" || t === "=" || t === "-" || t === "_" || t === "0";
}
const ke = no({
  debugEnabled: go,
  getMainWindow: () => W
});
function kt() {
  if (W && !W.isDestroyed())
    return W.show(), W.focus(), W;
  const e = It(), t = wo(), r = (t == null ? void 0 : t.width) ?? uo, n = (t == null ? void 0 : t.height) ?? fo, o = new z({
    width: r,
    height: n,
    minWidth: qe,
    minHeight: Ke,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...re(t == null ? void 0 : t.x) && re(t == null ? void 0 : t.y) ? { x: t.x, y: t.y } : {},
    webPreferences: {
      preload: T.join(so, "preload.mjs"),
      devTools: !0
    },
    autoHideMenuBar: !0,
    ...e ? { icon: e } : {}
  });
  return W = o, t != null && t.maximized && o.maximize(), o.on("move", () => {
    ve(o);
  }), o.on("resize", () => {
    ve(o);
  }), o.on("maximize", () => {
    ve(o);
  }), o.on("unmaximize", () => {
    ve(o);
  }), o.on("close", (a) => {
    Je(o), process.platform === "darwin" && !Ft && (a.preventDefault(), o.hide());
  }), o.on("closed", () => {
    W === o && (W = null);
  }), o.webContents.setZoomFactor(1), o.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), o.webContents.on("before-input-event", (a, c) => {
    if (vo(c)) {
      a.preventDefault();
      return;
    }
    So(c) && (a.preventDefault(), o.webContents.toggleDevTools());
  }), o.on("app-command", (a, c) => {
    (c === "browser-backward" || c === "browser-forward") && a.preventDefault();
  }), o.on("swipe", (a, c) => {
    (c === "left" || c === "right") && a.preventDefault();
  }), Be ? o.loadURL(Be) : o.loadFile(T.join(Pt, "index.html")), o;
}
N.on("before-quit", () => {
  Ft = !0, W && !W.isDestroyed() && Je(W);
});
N.on("window-all-closed", () => {
  process.platform !== "darwin" && N.quit();
});
N.on("activate", () => {
  if (W && !W.isDestroyed()) {
    W.isMinimized() && W.restore(), W.show(), W.focus();
    return;
  }
  z.getAllWindows().length === 0 && kt();
});
N.whenReady().then(() => {
  const e = It();
  e && process.platform === "darwin" && N.dock.setIcon(e), ke.configureSession(), ke.initializeBridges(), Fr(), ao({
    getMainWindow: () => W
  }), ke.registerIpcHandlers(), kt();
});
export {
  so as MAIN_DIST,
  Pt as RENDERER_DIST,
  Be as VITE_DEV_SERVER_URL
};
