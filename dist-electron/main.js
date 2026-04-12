import { dialog as G, app as P, net as qe, ipcMain as R, session as we, BrowserWindow as A, screen as Xe, WebContentsView as Je } from "electron";
import { Buffer as Ze } from "node:buffer";
import { fileURLToPath as Ye } from "node:url";
import y from "node:path";
import fe, { existsSync as ce, mkdirSync as pe, readFileSync as Ke, writeFileSync as Qe } from "node:fs";
import M from "fs/promises";
import ie from "node:fs/promises";
import Ue from "node:http";
import Ae from "node:https";
import xe from "os";
import ge from "child_process";
import et from "fs";
const K = 6e4;
async function be(e, t, s = {}, a = 0) {
  const c = new URL(e);
  if (c.protocol !== "http:" && c.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${c.protocol}`);
  const g = c.protocol === "https:" ? Ae : Ue;
  await ie.mkdir(y.dirname(t), { recursive: !0 }), await new Promise((v, S) => {
    let m = !1;
    const b = () => {
      m || (m = !0, v());
    }, w = (p) => {
      m || (m = !0, S(p));
    }, h = g.request({
      protocol: c.protocol,
      hostname: c.hostname,
      port: c.port ? Number(c.port) : void 0,
      path: `${c.pathname}${c.search}`,
      method: "GET",
      headers: s
    }, (p) => {
      p.setTimeout(K, () => {
        p.destroy(new Error(`下载响应超时: ${K}ms`));
      });
      const _ = Number(p.statusCode || 0), C = p.headers.location;
      if (_ >= 300 && _ < 400 && C) {
        if (p.resume(), a >= 3) {
          w(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const U = new URL(C, e).toString();
        be(U, t, s, a + 1).then(b).catch(w);
        return;
      }
      if (_ >= 400) {
        p.resume(), w(new Error(`下载失败: HTTP ${_} (${e})`));
        return;
      }
      const x = fe.createWriteStream(t), $ = async (U) => {
        try {
          x.destroy();
        } catch {
        }
        try {
          await ie.rm(t, { force: !0 });
        } catch {
        }
        w(U);
      };
      p.on("error", (U) => {
        $(U);
      }), x.on("error", (U) => {
        $(U);
      }), x.on("finish", () => b()), p.pipe(x);
    });
    h.setTimeout(K, () => {
      h.destroy(new Error(`下载请求超时: ${K}ms`));
    }), h.on("error", (p) => w(p)), h.end();
  });
}
const tt = "Omniflow Inbox", nt = 10 * 60 * 1e3, rt = 2, ot = 2e3, me = 12, J = /* @__PURE__ */ new Map();
function ye(e) {
  const t = String(e || "");
  return !!(!t || t === ".DS_Store" || t.startsWith("._") || t === "Thumbs.db");
}
function Z(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function st(e) {
  const t = String(e || "").toLowerCase();
  return !t || t.startsWith(".") ? !0 : t.endsWith(".crdownload") || t.endsWith(".part") || t.endsWith(".tmp") || t.endsWith(".opdownload") || t.endsWith(".download");
}
function Fe() {
  return y.join(P.getPath("userData"), "auto-import-staging");
}
function it(e, t) {
  const s = y.resolve(e), a = y.resolve(t);
  return s === a ? !0 : s.startsWith(`${a}${y.sep}`);
}
function at(e) {
  const t = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
async function ct(e, t) {
  try {
    await M.rename(e, t);
  } catch (s) {
    if ((s == null ? void 0 : s.code) !== "EXDEV")
      throw s;
    await M.copyFile(e, t), await M.rm(e, { force: !0 });
  }
}
function dt(e) {
  const t = Date.now();
  for (const [s, a] of J.entries())
    e.has(s) || t - a.lastSeenAt <= nt || J.delete(s);
}
async function lt(e, t = me) {
  const s = String(e || "").trim(), a = s ? y.resolve(s) : y.join(P.getPath("downloads"), tt), i = await M.stat(a).catch(() => null);
  if (!(i != null && i.isDirectory()))
    return [];
  const c = await M.readdir(a, { withFileTypes: !0 }), g = /* @__PURE__ */ new Set(), v = Date.now(), S = [];
  for (const h of c) {
    if (!h.isFile() || ye(h.name) || st(h.name)) continue;
    const p = y.join(a, h.name), _ = await M.stat(p).catch(() => null);
    if (!(_ != null && _.isFile())) continue;
    g.add(p);
    const C = J.get(p), $ = (C ? C.size === _.size && C.mtimeMs === _.mtimeMs : !1) && C ? C.stableCount + 1 : 1;
    J.set(p, {
      size: _.size,
      mtimeMs: _.mtimeMs,
      stableCount: $,
      lastSeenAt: v
    }), !($ < rt) && (v - _.mtimeMs < ot || S.push({
      sourcePath: p,
      name: h.name,
      size: _.size,
      mtimeMs: _.mtimeMs
    }));
  }
  if (dt(g), S.length === 0)
    return [];
  S.sort((h, p) => h.mtimeMs - p.mtimeMs);
  const m = Fe();
  await M.mkdir(m, { recursive: !0 });
  const b = [], w = Math.max(1, Math.floor(Number(t) || me));
  for (const h of S.slice(0, w)) {
    const p = y.join(m, at(h.name));
    try {
      await ct(h.sourcePath, p);
    } catch {
      continue;
    }
    J.delete(h.sourcePath), b.push({
      name: h.name,
      size: h.size,
      localPath: p,
      relativePath: Z(h.name)
    });
  }
  return b;
}
async function ut(e) {
  const t = y.resolve(String(e || "").trim()), s = Fe();
  return !t || !it(t, s) ? !1 : (await M.rm(t, { force: !0 }), !0);
}
function _e(e, t) {
  const s = Z(t || "");
  if (!s)
    return e;
  const a = s.split("/").filter(Boolean);
  for (const i of a) {
    if (i === "." || i === "..")
      throw new Error(`非法下载路径片段: ${i}`);
    if (i.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return y.join(e, ...a);
}
function Le(e, t) {
  return e.relativePath.localeCompare(t.relativePath, "zh-Hans-CN");
}
async function ft(e) {
  return (await Promise.all(e.map(async (s) => {
    const a = await M.stat(s);
    if (!a.isFile())
      return null;
    const i = y.basename(s);
    return ye(i) ? null : {
      name: i,
      size: a.size,
      localPath: s,
      relativePath: Z(i)
    };
  }))).filter((s) => !!s).sort(Le);
}
async function mt(e, t, s) {
  const a = [t], i = [];
  for (; a.length > 0; ) {
    const b = a.pop(), w = await M.readdir(b, { withFileTypes: !0 });
    for (const h of w) {
      if (h.name === "." || h.name === ".." || ye(h.name) || h.isSymbolicLink())
        continue;
      const p = y.join(b, h.name);
      if (h.isDirectory()) {
        a.push(p);
        continue;
      }
      h.isFile() && i.push({
        absolutePath: p,
        name: h.name
      });
    }
  }
  const c = [], g = 48;
  let v = 0;
  const S = async () => {
    for (; v < i.length; ) {
      const b = v;
      if (v += 1, b >= i.length)
        return;
      const w = i[b], h = await M.stat(w.absolutePath).catch(() => null);
      if (!(h != null && h.isFile()))
        continue;
      const p = Z(y.relative(e, w.absolutePath)), _ = Z(y.join(s, p));
      c.push({
        name: w.name,
        size: h.size,
        localPath: w.absolutePath,
        relativePath: _
      });
    }
  }, m = Math.min(g, Math.max(1, i.length));
  return await Promise.all(Array.from({ length: m }, () => S())), c;
}
async function ht(e) {
  const t = [];
  for (const s of e) {
    if (!(await M.stat(s)).isDirectory())
      continue;
    const i = y.basename(s), c = await mt(s, s, i);
    t.push(...c);
  }
  return t.sort(Le);
}
function wt(e) {
  e.handle("file:open", async () => {
    const t = await G.showOpenDialog({ properties: ["openFile"] });
    return t.canceled || t.filePaths.length === 0 ? null : await M.readFile(t.filePaths[0], "utf-8");
  }), e.handle("file:save", async (t, s, a) => (await M.writeFile(s, a, "utf-8"), !0)), e.handle("dialog:pick-upload-files", async () => {
    const t = await G.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await ft(t.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const t = await G.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await ht(t.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const t = await G.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const t = await G.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (t, s, a = me) => ({ canceled: !1, files: await lt(s, a) })), e.handle("fs:cleanup-auto-import-staged-file", async (t, s) => {
    try {
      return await ut(s);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (t, s, a = "") => {
    const i = _e(s, a);
    return await M.mkdir(i, { recursive: !0 }), i;
  }), e.handle("fs:download-url-to-path", async (t, s, a, i, c = {}) => {
    const g = _e(a, i);
    return await be(s, g, c), g;
  });
}
var O = {}, k = xe;
O.platform = function() {
  return process.platform;
};
O.cpuCount = function() {
  return k.cpus().length;
};
O.sysUptime = function() {
  return k.uptime();
};
O.processUptime = function() {
  return process.uptime();
};
O.freemem = function() {
  return k.freemem() / (1024 * 1024);
};
O.totalmem = function() {
  return k.totalmem() / (1024 * 1024);
};
O.freememPercentage = function() {
  return k.freemem() / k.totalmem();
};
O.freeCommand = function(e) {
  ge.exec("free -m", function(t, s, a) {
    var i = s.split(`
`), c = i[1].replace(/[\s\n\r]+/g, " "), g = c.split(" ");
    total_mem = parseFloat(g[1]), free_mem = parseFloat(g[3]), buffers_mem = parseFloat(g[5]), cached_mem = parseFloat(g[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
O.harddrive = function(e) {
  ge.exec("df -k", function(t, s, a) {
    var i = 0, c = 0, g = 0, v = s.split(`
`), S = v[1].replace(/[\s\n\r]+/g, " "), m = S.split(" ");
    i = Math.ceil(m[1] * 1024 / Math.pow(1024, 2)), c = Math.ceil(m[2] * 1024 / Math.pow(1024, 2)), g = Math.ceil(m[3] * 1024 / Math.pow(1024, 2)), e(i, g, c);
  });
};
O.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), ge.exec(command, function(s, a, i) {
    var c = a.split(`
`);
    c.shift(), c.pop();
    var g = "";
    c.forEach(function(v, S) {
      var m = v.replace(/[\s\n\r]+/g, " ");
      m = m.split(" "), g += m[1] + " " + m[2] + " " + m[3] + " " + m[4].substring(m[4].length - 25) + `
`;
    }), t(g);
  });
};
O.allLoadavg = function() {
  var e = k.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
O.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var t = k.loadavg(), s = 0;
  return e == 1 && (s = t[0]), e == 5 && (s = t[1]), e == 15 && (s = t[2]), s;
};
O.cpuFree = function(e) {
  Ne(e, !0);
};
O.cpuUsage = function(e) {
  Ne(e, !1);
};
function Ne(e, t) {
  var s = Te(), a = s.idle, i = s.total;
  setTimeout(function() {
    var c = Te(), g = c.idle, v = c.total, S = g - a, m = v - i, b = S / m;
    e(t === !0 ? b : 1 - b);
  }, 1e3);
}
function Te(e) {
  var t = k.cpus(), s = 0, a = 0, i = 0, c = 0, g = 0, S = 0;
  for (var v in t)
    s += t[v].times.user, a += t[v].times.nice, i += t[v].times.sys, g += t[v].times.irq, c += t[v].times.idle;
  var S = s + a + i + c + g;
  return {
    idle: c,
    total: S
  };
}
const pt = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", q = (e, ...t) => {
  pt && console[e](...t);
}, F = {
  debug: (...e) => q("debug", ...e),
  info: (...e) => q("info", ...e),
  log: (...e) => q("log", ...e),
  warn: (...e) => q("warn", ...e),
  error: (...e) => q("error", ...e)
};
function gt() {
  const e = bt().total, t = xe.cpus()[0].model, s = Math.floor(O.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: t,
    totalMemoryGB: s
  };
}
function bt() {
  const e = et.statfsSync(process.platform === "win32" ? "C:" : "/"), t = e.blocks * e.bsize, s = e.bfree * e.bsize;
  return {
    total: Math.floor(t / 1e9),
    // 换算为 GB
    usage: 1 - s / t
    // 使用率计算
  };
}
function yt(e) {
  e.handle("sys:get-static-data", gt);
}
const vt = 10 * 1024 * 1024 * 1024, Et = "10GB", Dt = `上传失败：单文件最大支持 ${Et}`;
function $e(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function St(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (t) => `%${t.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function _t(e) {
  const t = $e(e), s = St(e);
  return `Content-Disposition: form-data; name="file"; filename="${t}"; filename*=UTF-8''${s}\r
`;
}
function Tt(e) {
  const t = /* @__PURE__ */ new Map(), s = (a, i = !1) => {
    const c = Date.now();
    if (!i && c - a.lastProgressAt < 80) return;
    a.lastProgressAt = c;
    const g = Math.max(c - a.startedAt, 1), v = Math.floor(a.uploadedBytes * 1e3 / g), S = a.totalBytes > 0 ? Math.min(a.uploadedBytes / a.totalBytes * 100, 100) : 0;
    a.sender.send("http:upload:progress", {
      uploadId: a.uploadId,
      uploadedBytes: a.uploadedBytes,
      totalBytes: a.totalBytes,
      percentage: S,
      speedBps: v
    });
  };
  e.handle("http:fetch", async (a, i, c = {}) => (F.debug("http:fetch start"), F.debug("http:fetch URL:", i), F.debug("http:fetch options:", c), new Promise((g, v) => {
    const S = qe.request({ url: i, method: c.method || "GET" });
    c.headers && Object.entries(c.headers).forEach(([b, w]) => {
      F.debug(`http:fetch set header ${b}: ${String(w)}`), S.setHeader(b, w);
    });
    let m = "";
    S.on("response", (b) => {
      F.debug("http:fetch response"), F.debug("http:fetch status:", b.statusCode), F.debug("http:fetch headers:", b.headers), b.on("data", (w) => {
        F.debug(`http:fetch chunk length: ${w.length}`), m += w;
      }), b.on("end", () => {
        F.debug("http:fetch body preview:", m.slice(0, 500));
        let w;
        try {
          w = JSON.parse(m);
        } catch {
          w = m;
        }
        g({
          status: b.statusCode,
          headers: b.headers,
          body: w
        });
      });
    }), S.on("error", (b) => {
      F.error("http:fetch error:", b), v(b);
    }), c.body && S.write(c.body), S.end();
  }))), e.handle("http:upload:abort", async (a, i) => {
    const c = t.get(i);
    if (!c) return !1;
    c.aborted = !0, t.delete(i);
    try {
      c.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      c.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (a, i, c, g = {}, v = {}, S) => new Promise((m, b) => {
    let w;
    try {
      w = fe.statSync(c);
    } catch (l) {
      b(new Error(`读取上传文件失败: ${c} (${String(l)})`));
      return;
    }
    if (!w.isFile()) {
      b(new Error(`上传目标不是文件: ${c}`));
      return;
    }
    if (w.size > vt) {
      b(new Error(Dt));
      return;
    }
    const h = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), p = S || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, _ = y.basename(c), C = Object.entries(g).map(([l, D]) => `--${h}\r
Content-Disposition: form-data; name="${$e(l)}"\r
\r
${D}\r
`).join(""), x = `--${h}\r
` + _t(_) + `Content-Type: application/octet-stream\r
\r
`, $ = `\r
--${h}--\r
`, U = Buffer.byteLength(C) + Buffer.byteLength(x) + w.size + Buffer.byteLength($), de = {
      ...v,
      "Content-Type": `multipart/form-data; boundary=${h}`,
      "Content-Length": String(U)
    }, I = new URL(i), L = (I.protocol === "https:" ? Ae : Ue).request({
      protocol: I.protocol,
      hostname: I.hostname,
      port: I.port ? Number(I.port) : void 0,
      path: `${I.pathname}${I.search}`,
      method: "POST",
      headers: de
    }), o = fe.createReadStream(c, {
      highWaterMark: 1024 * 1024
    }), n = {
      uploadId: p,
      request: L,
      fileStream: o,
      sender: a.sender,
      totalBytes: Math.max(0, w.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(p, n);
    let r = !1;
    const d = (l) => {
      r || (r = !0, t.delete(p), m(l));
    }, u = (l) => {
      r || (r = !0, t.delete(p), b(l));
    };
    let f = "";
    L.on("response", (l) => {
      l.on("data", (D) => {
        f += D.toString();
      }), l.on("end", () => {
        let D;
        try {
          D = JSON.parse(f);
        } catch {
          D = f;
        }
        d({
          status: l.statusCode,
          body: D
        });
      });
    }), L.on("error", (l) => {
      if (n.aborted) {
        u(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        o.destroy(l);
      } catch {
      }
      u(l);
    }), L.write(C), L.write(x), o.on("data", (l) => {
      n.aborted || (n.uploadedBytes += l.length, s(n));
    }), o.on("end", () => {
      n.aborted || (s(n, !0), L.write($), L.end());
    }), o.on("error", (l) => {
      if (n.aborted) {
        u(new Error("UPLOAD_ABORTED"));
        return;
      }
      u(l);
      try {
        L.destroy(l);
      } catch {
      }
    }), o.pipe(L, { end: !1 });
  }));
}
function Ct() {
  wt(R), yt(R), Tt(R);
}
const he = "persist:omniflow-embedded-browser", Rt = "embedded-browser-downloads";
let le = null, Ce = !1;
function Ie() {
  return y.join(P.getPath("userData"), Rt);
}
function Pt() {
  const e = Ie();
  return ce(e) || pe(e, { recursive: !0 }), e;
}
function Bt() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function Mt(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function Q(e, t) {
  var s, a;
  return {
    downloadId: t.downloadId,
    fileName: t.fileName,
    mimeType: t.mimeType,
    pageUrl: t.pageUrl,
    receivedBytes: t.receivedBytes ?? Math.max(0, Number(((s = e.getReceivedBytes) == null ? void 0 : s.call(e)) || 0)),
    state: t.state,
    tabId: t.tabId,
    tempPath: t.tempPath,
    totalBytes: t.totalBytes ?? Math.max(0, Number(((a = e.getTotalBytes) == null ? void 0 : a.call(e)) || 0)),
    url: t.url,
    ...t.error ? { error: t.error } : {}
  };
}
function Ot() {
  return le || (le = we.fromPartition(he)), le;
}
async function We(e) {
  const t = y.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const s = y.resolve(Ie());
  return t !== s && !t.startsWith(`${s}${y.sep}`) ? !1 : (await ie.rm(t, { force: !0 }), !0);
}
function Ut(e) {
  if (Ce)
    return;
  Ce = !0;
  const t = (i, c, g) => {
    const v = e.resolveTabIdByWebContents(g) || void 0;
    if (!v)
      return;
    const S = Pt(), m = Bt(), b = c.getFilename() || "download", w = c.getURL() || "", h = g.getURL() || void 0, p = y.join(S, Mt(b));
    c.setSavePath(p), e.emitDownload(Q(c, {
      downloadId: m,
      fileName: b,
      mimeType: c.getMimeType() || void 0,
      pageUrl: h,
      state: "started",
      tabId: v,
      tempPath: p,
      url: w
    })), c.on("updated", (_, C) => {
      C === "progressing" && e.emitDownload(Q(c, {
        downloadId: m,
        fileName: b,
        mimeType: c.getMimeType() || void 0,
        pageUrl: h,
        state: "progress",
        tabId: v,
        tempPath: p,
        url: w
      }));
    }), c.once("done", (_, C) => {
      if (C === "completed") {
        e.emitDownload(Q(c, {
          downloadId: m,
          fileName: b,
          mimeType: c.getMimeType() || void 0,
          pageUrl: h,
          state: "completed",
          tabId: v,
          tempPath: p,
          url: w
        }));
        return;
      }
      We(p).catch(() => {
      }), e.emitDownload(Q(c, {
        downloadId: m,
        error: C === "cancelled" ? "下载已取消" : `下载失败：${C}`,
        fileName: b,
        mimeType: c.getMimeType() || void 0,
        pageUrl: h,
        state: C === "cancelled" ? "cancelled" : "failed",
        tabId: v,
        tempPath: p,
        url: w
      }));
    });
  }, s = /* @__PURE__ */ new Set();
  [we.defaultSession, Ot()].filter(Boolean).forEach((i) => {
    s.has(i) || (s.add(i), i.on("will-download", t));
  });
}
const At = "embedded-browser-open-files", Re = 'input[data-omniflow-browser-open-fallback="true"]';
function ke() {
  return y.join(P.getPath("userData"), At);
}
function xt() {
  const e = ke();
  return ce(e) || pe(e, { recursive: !0 }), e;
}
function Ft(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function Lt(e, t) {
  const s = y.resolve(e), a = y.resolve(t);
  return s === a ? !0 : s.startsWith(`${a}${y.sep}`);
}
async function Nt(e) {
  const t = await e.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${Re}') 
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
      return '${Re}'
    })()
  `, !0);
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
async function $t(e, t, s) {
  var v;
  if (!t || s.length === 0)
    return !1;
  try {
    e.webContents.debugger.isAttached() || e.webContents.debugger.attach("1.3");
  } catch (S) {
    if (!String(S).includes("Already attached"))
      throw S;
  }
  const a = await e.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), i = Number(((v = a == null ? void 0 : a.root) == null ? void 0 : v.nodeId) || 0);
  if (!Number.isFinite(i) || i <= 0)
    return !1;
  const c = await e.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: i,
    selector: t
  }), g = Number((c == null ? void 0 : c.nodeId) || 0);
  return !Number.isFinite(g) || g <= 0 ? !1 : (await e.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: g,
    files: s
  }), !0);
}
async function It(e, t) {
  const s = await e.webContents.executeJavaScript(`
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
  return !!(s != null && s.ok);
}
async function Wt(e, t, s = {}) {
  const a = xt(), i = y.join(a, Ft(t));
  return await be(e, i, s), i;
}
async function ee(e) {
  const t = y.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const s = y.resolve(ke());
  return Lt(t, s) ? (await ie.rm(t, { force: !0 }), !0) : !1;
}
async function kt(e, t) {
  if (!e || e.webContents.isDestroyed())
    return !1;
  const s = await Nt(e);
  return !s || !await $t(e, s, [t]) ? !1 : It(e, s);
}
const zt = y.dirname(Ye(import.meta.url));
process.env.APP_ROOT = y.join(zt, "..");
const ae = process.env.VITE_DEV_SERVER_URL, Vt = y.join(process.env.APP_ROOT, "dist-electron"), ze = y.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ae ? y.join(process.env.APP_ROOT, "public") : ze;
const Pe = y.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Ht = "Omniflow", jt = "omniflow-app", Gt = 1400, qt = 920, ve = 600, Ee = 400, Xt = "window-state.json", Jt = 200, Be = process.env.NODE_ENV === "test" || !!(ae || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Zt = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
Zt || (P.commandLine.appendSwitch("disable-logging"), P.commandLine.appendSwitch("log-level", "3"));
P.setName(Ht);
try {
  const e = y.join(P.getPath("appData"), jt);
  P.setPath("userData", e);
} catch {
}
function Ve() {
  return ce(Pe) ? Pe : null;
}
let E = null, Me = !1, He = !1;
const Yt = 240;
let te = null;
const H = /* @__PURE__ */ new Map(), B = /* @__PURE__ */ new Map(), ne = /* @__PURE__ */ new Map(), re = /* @__PURE__ */ new Map(), X = /* @__PURE__ */ new Map(), oe = /* @__PURE__ */ new Map(), ue = /* @__PURE__ */ new Map();
let N = null, Oe = null;
function Kt(e) {
  !E || E.isDestroyed() || E.webContents.send("embedded-browser:download", e);
}
function Qt(e) {
  for (const [t, s] of H.entries())
    if (s.webContents === e)
      return t;
  return null;
}
function je() {
  return y.join(P.getPath("userData"), Xt);
}
function V(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function en(e, t) {
  return e >= ve && t >= Ee;
}
function tn(e) {
  return Xe.getAllDisplays().some((s) => {
    const a = s.workArea;
    return e.x < a.x + a.width && e.x + e.width > a.x && e.y < a.y + a.height && e.y + e.height > a.y;
  });
}
function nn() {
  try {
    const e = je();
    if (!ce(e))
      return null;
    const t = Ke(e, "utf-8"), s = JSON.parse(t);
    if (!V(s.width) || !V(s.height) || !en(s.width, s.height))
      return null;
    const a = !!s.maximized, i = {
      width: s.width,
      height: s.height,
      maximized: a
    };
    return V(s.x) && V(s.y) && (i.x = s.x, i.y = s.y), V(i.x) && V(i.y) && (tn({
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height
    }) || (delete i.x, delete i.y)), i;
  } catch {
    return null;
  }
}
function De(e) {
  if (!e.isDestroyed())
    try {
      const t = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), s = {
        x: t.x,
        y: t.y,
        width: Math.max(Math.round(t.width), ve),
        height: Math.max(Math.round(t.height), Ee),
        maximized: e.isMaximized()
      }, a = je();
      pe(y.dirname(a), { recursive: !0 }), Qe(a, JSON.stringify(s), "utf-8");
    } catch {
    }
}
function se(e) {
  te && clearTimeout(te), te = setTimeout(() => {
    te = null, De(e);
  }, Jt);
}
function rn(e) {
  if (e.type !== "keyDown")
    return !1;
  const t = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && t === "i";
}
function on(e) {
  if (e.type !== "keyDown" || !(e.meta || e.control))
    return !1;
  const t = (e.key || "").toLowerCase();
  return t === "+" || t === "=" || t === "-" || t === "_" || t === "0";
}
function sn() {
  if (Me)
    return;
  Me = !0, R.on("window-minimize", (o) => {
    const n = A.fromWebContents(o.sender) ?? E;
    n == null || n.minimize();
  }), R.on("window-maximize", (o) => {
    const n = A.fromWebContents(o.sender) ?? E;
    !n || n.isDestroyed() || (n.isMaximized() ? n.unmaximize() : n.maximize());
  }), R.on("window-close", (o) => {
    const n = A.fromWebContents(o.sender) ?? E;
    n == null || n.close();
  }), R.handle("window-activate", (o, n = !1) => {
    const r = A.fromWebContents(o.sender) ?? E;
    return !r || r.isDestroyed() ? !1 : (r.isMinimized() && r.restore(), r.isVisible() || r.show(), process.platform === "darwin" ? P.focus({ steal: !0 }) : P.focus(), typeof r.moveTop == "function" && r.moveTop(), r.focus(), n && !r.isAlwaysOnTop() && (r.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      r.isDestroyed() || r.setAlwaysOnTop(!1);
    }, Yt)), !0);
  });
  const e = (o) => {
    F.log("[embedded-browser:main]", o), !(!E || E.isDestroyed()) && E.webContents.send("embedded-browser:state", o);
  }, t = async (o) => {
    if (!Be || o.webContents.isDestroyed())
      return [];
    try {
      const n = await o.webContents.executeJavaScript(`
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
      `, !0), r = [];
      return n != null && n.title && r.push(`title=${n.title}`), n != null && n.readyState && r.push(`readyState=${n.readyState}`), typeof (n == null ? void 0 : n.bodyHtmlLength) == "number" && r.push(`bodyHtml=${n.bodyHtmlLength}`), typeof (n == null ? void 0 : n.innerWidth) == "number" && typeof (n == null ? void 0 : n.innerHeight) == "number" && r.push(`viewport=${n.innerWidth}x${n.innerHeight}`), typeof (n == null ? void 0 : n.clientWidth) == "number" && typeof (n == null ? void 0 : n.clientHeight) == "number" && r.push(`client=${n.clientWidth}x${n.clientHeight}`), typeof (n == null ? void 0 : n.devicePixelRatio) == "number" && r.push(`dpr=${n.devicePixelRatio}`), n != null && n.bodyTextPreview && r.push(`preview=${n.bodyTextPreview}`), n != null && n.userAgent && r.push(`ua=${n.userAgent}`), r;
    } catch (n) {
      return [`inspect=${n instanceof Error ? n.message : String(n)}`];
    }
  }, s = (o) => {
    const n = o.webContents.getTitle().trim();
    if (n)
      return n;
  }, a = (o, n) => {
    const r = o.trim();
    if (!r)
      return "";
    if (r.startsWith("data:"))
      return r;
    try {
      return new URL(r, n || void 0).toString();
    } catch {
      return r;
    }
  }, i = (o, n) => {
    var u;
    const r = (u = String(n || "").split(";")[0]) == null ? void 0 : u.trim();
    if (r != null && r.startsWith("image/"))
      return r;
    const d = (() => {
      try {
        return new URL(o).pathname.toLowerCase();
      } catch {
        return o.toLowerCase();
      }
    })();
    return d.endsWith(".svg") ? "image/svg+xml" : d.endsWith(".ico") ? "image/x-icon" : d.endsWith(".webp") ? "image/webp" : d.endsWith(".jpg") || d.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  }, c = async (o, n) => {
    if (!n || n.startsWith("data:"))
      return n;
    try {
      const r = await o.fetch(n);
      if (!r.ok)
        return "";
      const d = Ze.from(await r.arrayBuffer());
      return d.length === 0 ? "" : `data:${i(n, r.headers.get("content-type"))};base64,${d.toString("base64")}`;
    } catch (r) {
      return F.warn("embedded browser favicon load failed", {
        error: r instanceof Error ? r.message : String(r),
        iconUrl: n
      }), "";
    }
  }, g = async (o, n) => c(o.webContents.session, n), v = (o, n) => {
    const r = [], d = /<link\b[^>]*>/gi, u = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let f;
    for (; f = d.exec(o); ) {
      const l = f[0], D = /* @__PURE__ */ new Map();
      let T;
      for (u.lastIndex = 0; T = u.exec(l); )
        D.set(T[1].toLowerCase(), T[2] || T[3] || T[4] || "");
      const W = D.get("rel") || "", z = D.get("href") || "";
      if (!z || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(W))
        continue;
      const j = a(z, n);
      j && r.push(j);
    }
    return r;
  }, S = async (o) => {
    const n = String((o == null ? void 0 : o.pageUrl) || "").trim(), r = we.fromPartition(he), d = [], u = a(String((o == null ? void 0 : o.iconUrl) || ""), n || void 0);
    if (u && !u.startsWith("data:") && d.push(u), n) {
      try {
        const l = await r.fetch(n), D = l.headers.get("content-type") || "";
        l.ok && /text\/html|application\/xhtml\+xml/i.test(D) && d.push(...v(await l.text(), n));
      } catch (l) {
        F.warn("embedded browser favicon page inspect failed", {
          error: l instanceof Error ? l.message : String(l),
          pageUrl: n
        });
      }
      try {
        const l = new URL(n).origin;
        d.push(`${l}/favicon.ico`);
      } catch {
      }
    }
    const f = /* @__PURE__ */ new Set();
    for (const l of d) {
      if (!l || f.has(l))
        continue;
      f.add(l);
      const D = await c(r, l);
      if (D)
        return {
          dataUrl: D,
          iconUrl: l
        };
    }
    return {
      dataUrl: u.startsWith("data:") ? u : "",
      iconUrl: ""
    };
  }, m = (o, n, r) => {
    e({
      canGoBack: n.webContents.canGoBack(),
      canGoForward: n.webContents.canGoForward(),
      iconSourceUrl: r.iconSourceUrl ?? re.get(o),
      iconUrl: r.iconUrl ?? ne.get(o),
      tabId: o,
      title: r.title ?? s(n),
      ...r
    });
  }, b = (o, n, r) => {
    m(o, n, {
      state: "ready",
      url: (r == null ? void 0 : r.url) ?? (B.get(o) || n.webContents.getURL() || void 0),
      ...r
    });
  }, w = (o) => {
    const n = H.get(o);
    return !n || n.webContents.isDestroyed() ? (H.delete(o), B.delete(o), ne.delete(o), re.delete(o), null) : n;
  }, h = (o) => {
    const n = X.get(o);
    n != null && n.stagedPath && ee(n.stagedPath).catch(() => {
    }), X.delete(o);
    const r = oe.get(o);
    r && ee(r).catch(() => {
    }), oe.delete(o);
  }, p = (o) => {
    const n = (ue.get(o) ?? 0) + 1;
    return ue.set(o, n), n;
  }, _ = (o, n) => ue.get(o) === n, C = (o, n) => {
    try {
      const r = new URL(o), d = new URL(n);
      if (r.origin !== d.origin)
        return !1;
      const u = r.pathname.replace(/\/+$/, "") || "/", f = d.pathname.replace(/\/+$/, "") || "/";
      return f === "/" ? !0 : u === f || u.startsWith(`${f}/`);
    } catch {
      return !1;
    }
  }, x = async (o, n) => {
    const r = X.get(o);
    if (!r || n.webContents.isDestroyed())
      return !1;
    const d = n.webContents.getURL() || B.get(o) || "";
    if (!d || !C(d, r.pageUrl))
      return !1;
    try {
      if (!await kt(n, r.stagedPath))
        return !1;
      const f = oe.get(o);
      return f && f !== r.stagedPath && ee(f).catch(() => {
      }), oe.set(o, r.stagedPath), X.delete(o), !0;
    } catch {
      return !1;
    }
  }, $ = (o) => {
    o.setBounds(Oe ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }, U = (o) => {
    if (!N)
      return;
    const n = w(N);
    if (!n) {
      N = null;
      return;
    }
    o.contentView.children.includes(n) && o.contentView.removeChildView(n), N = null;
  }, de = (o) => {
    if (!E || E.isDestroyed())
      return null;
    const n = w(o);
    if (n)
      return n;
    const r = new Je({
      webPreferences: {
        devTools: !0,
        partition: he
      }
    });
    r.webContents.setZoomFactor(1);
    const d = r.webContents.getUserAgent();
    return d.includes("Electron") && r.webContents.setUserAgent(
      d.replace(/\sElectron\/[^\s]+/g, "")
    ), $(r), H.set(o, r), r.webContents.on("did-start-loading", () => {
      m(o, r, {
        details: "did-start-loading",
        state: "loading",
        url: r.webContents.getURL() || B.get(o) || void 0
      });
    }), r.webContents.on("did-stop-loading", async () => {
      if (r.webContents.isDestroyed())
        return;
      const u = r.webContents.getURL() || "";
      B.set(o, u), await x(o, r);
      const f = await t(r);
      m(o, r, {
        details: "did-stop-loading",
        ...f.length ? { meta: f } : {},
        state: "ready",
        url: u || void 0
      });
    }), r.webContents.on("did-navigate", (u, f) => {
      B.set(o, f), m(o, r, { details: "did-navigate", state: "ready", url: f }), x(o, r);
    }), r.webContents.on("did-navigate-in-page", (u, f) => {
      B.set(o, f), m(o, r, { details: "did-navigate-in-page", state: "ready", url: f }), x(o, r);
    }), r.webContents.on("page-title-updated", (u, f) => {
      m(o, r, {
        details: "page-title-updated",
        state: "ready",
        title: f || void 0,
        url: B.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("page-favicon-updated", (u, f) => {
      const l = B.get(o) || r.webContents.getURL() || void 0, D = f.map((T) => a(String(T || ""), l)).find((T) => T.trim()) || "";
      D && g(r, D).then((T) => {
        !T || r.webContents.isDestroyed() || (re.set(o, D), ne.set(o, T), m(o, r, {
          details: "page-favicon-updated",
          iconSourceUrl: D,
          iconUrl: T,
          state: "ready",
          url: B.get(o) || r.webContents.getURL() || void 0
        }));
      });
    }), r.webContents.on("did-fail-load", (u, f, l, D) => {
      f !== -3 && m(o, r, {
        details: `did-fail-load(${f})`,
        state: "error",
        message: `页面加载失败：${l || "未知错误"}`,
        url: D
      });
    }), r.webContents.on("render-process-gone", (u, f) => {
      m(o, r, {
        details: `render-process-gone:${f.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${f.reason}`,
        url: B.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("console-message", (u, f, l, D, T) => {
      Be && f >= 2 && m(o, r, {
        details: `console:${T}:${D}`,
        state: "ready",
        message: l,
        meta: [`console-level=${f}`],
        url: B.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.setWindowOpenHandler(({ url: u }) => (r.webContents.loadURL(u), { action: "deny" })), r;
  }, I = (o, n, r) => {
    if (!o || o.isDestroyed())
      return null;
    if (!n)
      return U(o), null;
    const u = (r == null ? void 0 : r.createIfMissing) ?? !1 ? de(n) : w(n);
    return u ? !u || u.webContents.isDestroyed() ? null : (N && N !== n && U(o), $(u), o.contentView.children.includes(u) || o.contentView.addChildView(u), N = n, u) : (U(o), null);
  }, Y = async (o, n, r, d, u = !1) => {
    if (!o || o.isDestroyed())
      return;
    const f = String(n || "").trim();
    if (!f)
      return;
    const l = I(o, f, { createIfMissing: !0 });
    if (!l || l.webContents.isDestroyed())
      return;
    const D = String(r || "").trim();
    if (!D) {
      m(f, l, {
        state: "ready",
        title: s(l) || "新标签页",
        url: B.get(f) || void 0
      });
      return;
    }
    const T = B.get(f) || l.webContents.getURL();
    if (u && T === D) {
      m(f, l, {
        state: "ready",
        url: T || void 0
      });
      return;
    }
    m(f, l, {
      details: "load-url",
      state: "loading",
      url: D
    });
    try {
      await l.webContents.loadURL(D);
    } catch (W) {
      const z = W instanceof Error ? W.message : String(W);
      if (z.includes("ERR_ABORTED"))
        return;
      throw m(f, l, {
        details: d,
        state: "error",
        message: `页面加载失败：${z}`,
        url: D
      }), W;
    }
  }, L = (o, n) => {
    if (!o || o.isDestroyed())
      return;
    const r = String(n || "").trim();
    if (!r)
      return;
    const d = w(r);
    d && (o.contentView.children.includes(d) && o.contentView.removeChildView(d), N === r && (N = null), H.delete(r), B.delete(r), ne.delete(r), re.delete(r), p(r), h(r), d.webContents.isDestroyed() || d.webContents.close({ waitForBeforeUnload: !1 }));
  };
  R.handle("embedded-browser:open-tab", async (o, n, r) => {
    const d = A.fromWebContents(o.sender) ?? E;
    p(String(n || "").trim()), h(String(n || "").trim());
    const u = String(r || "").trim();
    if (!u) {
      e({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: n,
        title: "新标签页"
      });
      return;
    }
    await Y(d, n, u, "open-exception", !0);
  }), R.handle("embedded-browser:activate-tab", (o, n) => {
    const r = A.fromWebContents(o.sender) ?? E;
    I(r, n, { createIfMissing: !1 });
  }), R.handle("embedded-browser:navigate", async (o, n, r) => {
    const d = A.fromWebContents(o.sender) ?? E, u = String(n || "").trim();
    p(u), h(u), await Y(d, u, r, "navigate-exception");
  }), R.handle("embedded-browser:resolve-favicon", async (o, n) => S(n)), R.handle("embedded-browser:open-mapped-file", async (o, n, r, d, u) => {
    const f = A.fromWebContents(o.sender) ?? E, l = String(n || "").trim(), D = String(r || "").trim(), T = String(d || "").trim(), W = String(u || "").trim() || "file";
    if (!l || !D || !T)
      return;
    const z = p(l);
    h(l);
    const j = await Wt(T, W);
    if (!_(l, z)) {
      ee(j).catch(() => {
      });
      return;
    }
    if (X.set(l, {
      fileName: W,
      pageUrl: D,
      stagedPath: j
    }), await Y(f, l, D, "navigate-exception"), !_(l, z))
      return;
    const Se = w(l);
    Se && x(l, Se);
  }), R.handle("embedded-browser:reload", async (o, n) => {
    const r = String(n || "").trim();
    if (!r)
      return;
    const d = w(r);
    !d || d.webContents.isDestroyed() || (m(r, d, {
      details: "reload",
      state: "loading",
      url: B.get(r) || d.webContents.getURL() || void 0
    }), d.webContents.reload(), b(r, d, {
      details: "reload-requested"
    }));
  }), R.handle("embedded-browser:go-back", async (o, n) => {
    const r = String(n || "").trim();
    if (!r)
      return;
    const d = w(r);
    !d || d.webContents.isDestroyed() || (d.webContents.canGoBack() && d.webContents.goBack(), b(r, d, {
      details: "history-back"
    }));
  }), R.handle("embedded-browser:go-forward", async (o, n) => {
    const r = String(n || "").trim();
    if (!r)
      return;
    const d = w(r);
    !d || d.webContents.isDestroyed() || (d.webContents.canGoForward() && d.webContents.goForward(), b(r, d, {
      details: "history-forward"
    }));
  }), R.handle("embedded-browser:set-bounds", (o, n) => {
    const r = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, d = A.fromWebContents(o.sender) ?? E, u = d && !d.isDestroyed() ? Math.max(d.webContents.getZoomFactor(), 0.01) : 1;
    if (r.x = Math.max(0, Math.round(n.x * u)), r.y = Math.max(0, Math.round(n.y * u)), r.width = Math.max(0, Math.round(n.width * u)), r.height = Math.max(0, Math.round(n.height * u)), Oe = r, !N)
      return;
    const f = w(N);
    f && f.setBounds(r);
  }), R.handle("embedded-browser:close-tab", (o, n) => {
    const r = A.fromWebContents(o.sender) ?? E;
    L(r, n);
  }), R.handle("embedded-browser:cleanup-download-file", async (o, n) => {
    try {
      return await We(n);
    } catch {
      return !1;
    }
  }), R.handle("embedded-browser:deactivate", (o) => {
    const n = A.fromWebContents(o.sender) ?? E;
    !n || n.isDestroyed() || U(n);
  }), R.handle("embedded-browser:close-all", (o) => {
    const n = A.fromWebContents(o.sender) ?? E;
    !n || n.isDestroyed() || (Array.from(H.keys()).forEach((r) => {
      L(n, r);
    }), N = null, e({ state: "idle" }));
  });
}
function Ge() {
  if (E && !E.isDestroyed())
    return E.show(), E.focus(), E;
  const e = Ve(), t = nn(), s = (t == null ? void 0 : t.width) ?? Gt, a = (t == null ? void 0 : t.height) ?? qt, i = new A({
    width: s,
    height: a,
    minWidth: ve,
    minHeight: Ee,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...V(t == null ? void 0 : t.x) && V(t == null ? void 0 : t.y) ? { x: t.x, y: t.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: y.join(Vt, "preload.mjs"),
      // Electron 安全推荐配置
      devTools: !0
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: !0,
    // 自动隐藏菜单栏
    ...e ? { icon: e } : {}
  });
  return E = i, t != null && t.maximized && i.maximize(), i.on("move", () => {
    se(i);
  }), i.on("resize", () => {
    se(i);
  }), i.on("maximize", () => {
    se(i);
  }), i.on("unmaximize", () => {
    se(i);
  }), i.on("close", (c) => {
    De(i), process.platform === "darwin" && !He && (c.preventDefault(), i.hide());
  }), i.on("closed", () => {
    E === i && (E = null);
  }), i.webContents.setZoomFactor(1), i.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), i.webContents.on("before-input-event", (c, g) => {
    if (on(g)) {
      c.preventDefault();
      return;
    }
    rn(g) && (c.preventDefault(), i.webContents.toggleDevTools());
  }), ae ? i.loadURL(ae) : i.loadFile(y.join(ze, "index.html")), i;
}
P.on("before-quit", () => {
  He = !0, E && !E.isDestroyed() && De(E);
});
P.on("window-all-closed", () => {
  process.platform !== "darwin" && P.quit();
});
P.on("activate", () => {
  if (E && !E.isDestroyed()) {
    E.isMinimized() && E.restore(), E.show(), E.focus();
    return;
  }
  A.getAllWindows().length === 0 && Ge();
});
P.whenReady().then(() => {
  const e = Ve();
  e && process.platform === "darwin" && P.dock.setIcon(e), Ut({
    emitDownload: Kt,
    resolveTabIdByWebContents: Qt
  }), Ct(), sn(), Ge();
});
export {
  Vt as MAIN_DIST,
  ze as RENDERER_DIST,
  ae as VITE_DEV_SERVER_URL
};
