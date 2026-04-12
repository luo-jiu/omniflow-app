import { dialog as H, app as R, net as We, ipcMain as P, session as Te, BrowserWindow as M, screen as ze, WebContentsView as ke } from "electron";
import { fileURLToPath as Ve } from "node:url";
import g from "node:path";
import ie, { existsSync as re, mkdirSync as de, readFileSync as He, writeFileSync as je } from "node:fs";
import B from "fs/promises";
import te from "node:fs/promises";
import _e from "node:http";
import Se from "node:https";
import Ce from "os";
import ce from "child_process";
import Ge from "fs";
const J = 6e4;
async function le(e, t, o = {}, i = 0) {
  const d = new URL(e);
  if (d.protocol !== "http:" && d.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${d.protocol}`);
  const f = d.protocol === "https:" ? Se : _e;
  await te.mkdir(g.dirname(t), { recursive: !0 }), await new Promise((p, E) => {
    let v = !1;
    const m = () => {
      v || (v = !0, p());
    }, y = (h) => {
      v || (v = !0, E(h));
    }, u = f.request({
      protocol: d.protocol,
      hostname: d.hostname,
      port: d.port ? Number(d.port) : void 0,
      path: `${d.pathname}${d.search}`,
      method: "GET",
      headers: o
    }, (h) => {
      h.setTimeout(J, () => {
        h.destroy(new Error(`下载响应超时: ${J}ms`));
      });
      const T = Number(h.statusCode || 0), _ = h.headers.location;
      if (T >= 300 && T < 400 && _) {
        if (h.resume(), i >= 3) {
          y(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const n = new URL(_, e).toString();
        le(n, t, o, i + 1).then(m).catch(y);
        return;
      }
      if (T >= 400) {
        h.resume(), y(new Error(`下载失败: HTTP ${T} (${e})`));
        return;
      }
      const L = ie.createWriteStream(t), s = async (n) => {
        try {
          L.destroy();
        } catch {
        }
        try {
          await te.rm(t, { force: !0 });
        } catch {
        }
        y(n);
      };
      h.on("error", (n) => {
        s(n);
      }), L.on("error", (n) => {
        s(n);
      }), L.on("finish", () => m()), h.pipe(L);
    });
    u.setTimeout(J, () => {
      u.destroy(new Error(`下载请求超时: ${J}ms`));
    }), u.on("error", (h) => y(h)), u.end();
  });
}
const qe = "Omniflow Inbox", Xe = 10 * 60 * 1e3, Je = 2, Ye = 2e3, ae = 12, q = /* @__PURE__ */ new Map();
function ue(e) {
  const t = String(e || "");
  return !!(!t || t === ".DS_Store" || t.startsWith("._") || t === "Thumbs.db");
}
function X(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Ze(e) {
  const t = String(e || "").toLowerCase();
  return !t || t.startsWith(".") ? !0 : t.endsWith(".crdownload") || t.endsWith(".part") || t.endsWith(".tmp") || t.endsWith(".opdownload") || t.endsWith(".download");
}
function Pe() {
  return g.join(R.getPath("userData"), "auto-import-staging");
}
function Ke(e, t) {
  const o = g.resolve(e), i = g.resolve(t);
  return o === i ? !0 : o.startsWith(`${i}${g.sep}`);
}
function Qe(e) {
  const t = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
async function et(e, t) {
  try {
    await B.rename(e, t);
  } catch (o) {
    if ((o == null ? void 0 : o.code) !== "EXDEV")
      throw o;
    await B.copyFile(e, t), await B.rm(e, { force: !0 });
  }
}
function tt(e) {
  const t = Date.now();
  for (const [o, i] of q.entries())
    e.has(o) || t - i.lastSeenAt <= Xe || q.delete(o);
}
async function nt(e, t = ae) {
  const o = String(e || "").trim(), i = o ? g.resolve(o) : g.join(R.getPath("downloads"), qe), a = await B.stat(i).catch(() => null);
  if (!(a != null && a.isDirectory()))
    return [];
  const d = await B.readdir(i, { withFileTypes: !0 }), f = /* @__PURE__ */ new Set(), p = Date.now(), E = [];
  for (const u of d) {
    if (!u.isFile() || ue(u.name) || Ze(u.name)) continue;
    const h = g.join(i, u.name), T = await B.stat(h).catch(() => null);
    if (!(T != null && T.isFile())) continue;
    f.add(h);
    const _ = q.get(h), s = (_ ? _.size === T.size && _.mtimeMs === T.mtimeMs : !1) && _ ? _.stableCount + 1 : 1;
    q.set(h, {
      size: T.size,
      mtimeMs: T.mtimeMs,
      stableCount: s,
      lastSeenAt: p
    }), !(s < Je) && (p - T.mtimeMs < Ye || E.push({
      sourcePath: h,
      name: u.name,
      size: T.size,
      mtimeMs: T.mtimeMs
    }));
  }
  if (tt(f), E.length === 0)
    return [];
  E.sort((u, h) => u.mtimeMs - h.mtimeMs);
  const v = Pe();
  await B.mkdir(v, { recursive: !0 });
  const m = [], y = Math.max(1, Math.floor(Number(t) || ae));
  for (const u of E.slice(0, y)) {
    const h = g.join(v, Qe(u.name));
    try {
      await et(u.sourcePath, h);
    } catch {
      continue;
    }
    q.delete(u.sourcePath), m.push({
      name: u.name,
      size: u.size,
      localPath: h,
      relativePath: X(u.name)
    });
  }
  return m;
}
async function rt(e) {
  const t = g.resolve(String(e || "").trim()), o = Pe();
  return !t || !Ke(t, o) ? !1 : (await B.rm(t, { force: !0 }), !0);
}
function we(e, t) {
  const o = X(t || "");
  if (!o)
    return e;
  const i = o.split("/").filter(Boolean);
  for (const a of i) {
    if (a === "." || a === "..")
      throw new Error(`非法下载路径片段: ${a}`);
    if (a.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return g.join(e, ...i);
}
function Re(e, t) {
  return e.relativePath.localeCompare(t.relativePath, "zh-Hans-CN");
}
async function ot(e) {
  return (await Promise.all(e.map(async (o) => {
    const i = await B.stat(o);
    if (!i.isFile())
      return null;
    const a = g.basename(o);
    return ue(a) ? null : {
      name: a,
      size: i.size,
      localPath: o,
      relativePath: X(a)
    };
  }))).filter((o) => !!o).sort(Re);
}
async function st(e, t, o) {
  const i = [t], a = [];
  for (; i.length > 0; ) {
    const m = i.pop(), y = await B.readdir(m, { withFileTypes: !0 });
    for (const u of y) {
      if (u.name === "." || u.name === ".." || ue(u.name) || u.isSymbolicLink())
        continue;
      const h = g.join(m, u.name);
      if (u.isDirectory()) {
        i.push(h);
        continue;
      }
      u.isFile() && a.push({
        absolutePath: h,
        name: u.name
      });
    }
  }
  const d = [], f = 48;
  let p = 0;
  const E = async () => {
    for (; p < a.length; ) {
      const m = p;
      if (p += 1, m >= a.length)
        return;
      const y = a[m], u = await B.stat(y.absolutePath).catch(() => null);
      if (!(u != null && u.isFile()))
        continue;
      const h = X(g.relative(e, y.absolutePath)), T = X(g.join(o, h));
      d.push({
        name: y.name,
        size: u.size,
        localPath: y.absolutePath,
        relativePath: T
      });
    }
  }, v = Math.min(f, Math.max(1, a.length));
  return await Promise.all(Array.from({ length: v }, () => E())), d;
}
async function it(e) {
  const t = [];
  for (const o of e) {
    if (!(await B.stat(o)).isDirectory())
      continue;
    const a = g.basename(o), d = await st(o, o, a);
    t.push(...d);
  }
  return t.sort(Re);
}
function at(e) {
  e.handle("file:open", async () => {
    const t = await H.showOpenDialog({ properties: ["openFile"] });
    return t.canceled || t.filePaths.length === 0 ? null : await B.readFile(t.filePaths[0], "utf-8");
  }), e.handle("file:save", async (t, o, i) => (await B.writeFile(o, i, "utf-8"), !0)), e.handle("dialog:pick-upload-files", async () => {
    const t = await H.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await ot(t.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const t = await H.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await it(t.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const t = await H.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const t = await H.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (t, o, i = ae) => ({ canceled: !1, files: await nt(o, i) })), e.handle("fs:cleanup-auto-import-staged-file", async (t, o) => {
    try {
      return await rt(o);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (t, o, i = "") => {
    const a = we(o, i);
    return await B.mkdir(a, { recursive: !0 }), a;
  }), e.handle("fs:download-url-to-path", async (t, o, i, a, d = {}) => {
    const f = we(i, a);
    return await le(o, f, d), f;
  });
}
var O = {}, $ = Ce;
O.platform = function() {
  return process.platform;
};
O.cpuCount = function() {
  return $.cpus().length;
};
O.sysUptime = function() {
  return $.uptime();
};
O.processUptime = function() {
  return process.uptime();
};
O.freemem = function() {
  return $.freemem() / (1024 * 1024);
};
O.totalmem = function() {
  return $.totalmem() / (1024 * 1024);
};
O.freememPercentage = function() {
  return $.freemem() / $.totalmem();
};
O.freeCommand = function(e) {
  ce.exec("free -m", function(t, o, i) {
    var a = o.split(`
`), d = a[1].replace(/[\s\n\r]+/g, " "), f = d.split(" ");
    total_mem = parseFloat(f[1]), free_mem = parseFloat(f[3]), buffers_mem = parseFloat(f[5]), cached_mem = parseFloat(f[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
O.harddrive = function(e) {
  ce.exec("df -k", function(t, o, i) {
    var a = 0, d = 0, f = 0, p = o.split(`
`), E = p[1].replace(/[\s\n\r]+/g, " "), v = E.split(" ");
    a = Math.ceil(v[1] * 1024 / Math.pow(1024, 2)), d = Math.ceil(v[2] * 1024 / Math.pow(1024, 2)), f = Math.ceil(v[3] * 1024 / Math.pow(1024, 2)), e(a, f, d);
  });
};
O.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), ce.exec(command, function(o, i, a) {
    var d = i.split(`
`);
    d.shift(), d.pop();
    var f = "";
    d.forEach(function(p, E) {
      var v = p.replace(/[\s\n\r]+/g, " ");
      v = v.split(" "), f += v[1] + " " + v[2] + " " + v[3] + " " + v[4].substring(v[4].length - 25) + `
`;
    }), t(f);
  });
};
O.allLoadavg = function() {
  var e = $.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
O.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var t = $.loadavg(), o = 0;
  return e == 1 && (o = t[0]), e == 5 && (o = t[1]), e == 15 && (o = t[2]), o;
};
O.cpuFree = function(e) {
  Me(e, !0);
};
O.cpuUsage = function(e) {
  Me(e, !1);
};
function Me(e, t) {
  var o = pe(), i = o.idle, a = o.total;
  setTimeout(function() {
    var d = pe(), f = d.idle, p = d.total, E = f - i, v = p - a, m = E / v;
    e(t === !0 ? m : 1 - m);
  }, 1e3);
}
function pe(e) {
  var t = $.cpus(), o = 0, i = 0, a = 0, d = 0, f = 0, E = 0;
  for (var p in t)
    o += t[p].times.user, i += t[p].times.nice, a += t[p].times.sys, f += t[p].times.irq, d += t[p].times.idle;
  var E = o + i + a + d + f;
  return {
    idle: d,
    total: E
  };
}
const dt = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", j = (e, ...t) => {
  dt && console[e](...t);
}, U = {
  debug: (...e) => j("debug", ...e),
  info: (...e) => j("info", ...e),
  log: (...e) => j("log", ...e),
  warn: (...e) => j("warn", ...e),
  error: (...e) => j("error", ...e)
};
function ct() {
  const e = lt().total, t = Ce.cpus()[0].model, o = Math.floor(O.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: t,
    totalMemoryGB: o
  };
}
function lt() {
  const e = Ge.statfsSync(process.platform === "win32" ? "C:" : "/"), t = e.blocks * e.bsize, o = e.bfree * e.bsize;
  return {
    total: Math.floor(t / 1e9),
    // 换算为 GB
    usage: 1 - o / t
    // 使用率计算
  };
}
function ut(e) {
  e.handle("sys:get-static-data", ct);
}
const ft = 10 * 1024 * 1024 * 1024, mt = "10GB", ht = `上传失败：单文件最大支持 ${mt}`;
function Be(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function wt(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (t) => `%${t.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function pt(e) {
  const t = Be(e), o = wt(e);
  return `Content-Disposition: form-data; name="file"; filename="${t}"; filename*=UTF-8''${o}\r
`;
}
function gt(e) {
  const t = /* @__PURE__ */ new Map(), o = (i, a = !1) => {
    const d = Date.now();
    if (!a && d - i.lastProgressAt < 80) return;
    i.lastProgressAt = d;
    const f = Math.max(d - i.startedAt, 1), p = Math.floor(i.uploadedBytes * 1e3 / f), E = i.totalBytes > 0 ? Math.min(i.uploadedBytes / i.totalBytes * 100, 100) : 0;
    i.sender.send("http:upload:progress", {
      uploadId: i.uploadId,
      uploadedBytes: i.uploadedBytes,
      totalBytes: i.totalBytes,
      percentage: E,
      speedBps: p
    });
  };
  e.handle("http:fetch", async (i, a, d = {}) => (U.debug("http:fetch start"), U.debug("http:fetch URL:", a), U.debug("http:fetch options:", d), new Promise((f, p) => {
    const E = We.request({ url: a, method: d.method || "GET" });
    d.headers && Object.entries(d.headers).forEach(([m, y]) => {
      U.debug(`http:fetch set header ${m}: ${String(y)}`), E.setHeader(m, y);
    });
    let v = "";
    E.on("response", (m) => {
      U.debug("http:fetch response"), U.debug("http:fetch status:", m.statusCode), U.debug("http:fetch headers:", m.headers), m.on("data", (y) => {
        U.debug(`http:fetch chunk length: ${y.length}`), v += y;
      }), m.on("end", () => {
        U.debug("http:fetch body preview:", v.slice(0, 500));
        let y;
        try {
          y = JSON.parse(v);
        } catch {
          y = v;
        }
        f({
          status: m.statusCode,
          headers: m.headers,
          body: y
        });
      });
    }), E.on("error", (m) => {
      U.error("http:fetch error:", m), p(m);
    }), d.body && E.write(d.body), E.end();
  }))), e.handle("http:upload:abort", async (i, a) => {
    const d = t.get(a);
    if (!d) return !1;
    d.aborted = !0, t.delete(a);
    try {
      d.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      d.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (i, a, d, f = {}, p = {}, E) => new Promise((v, m) => {
    let y;
    try {
      y = ie.statSync(d);
    } catch (C) {
      m(new Error(`读取上传文件失败: ${d} (${String(C)})`));
      return;
    }
    if (!y.isFile()) {
      m(new Error(`上传目标不是文件: ${d}`));
      return;
    }
    if (y.size > ft) {
      m(new Error(ht));
      return;
    }
    const u = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), h = E || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, T = g.basename(d), _ = Object.entries(f).map(([C, z]) => `--${u}\r
Content-Disposition: form-data; name="${Be(C)}"\r
\r
${z}\r
`).join(""), L = `--${u}\r
` + pt(T) + `Content-Type: application/octet-stream\r
\r
`, s = `\r
--${u}--\r
`, n = Buffer.byteLength(_) + Buffer.byteLength(L) + y.size + Buffer.byteLength(s), r = {
      ...p,
      "Content-Type": `multipart/form-data; boundary=${u}`,
      "Content-Length": String(n)
    }, c = new URL(a), l = (c.protocol === "https:" ? Se : _e).request({
      protocol: c.protocol,
      hostname: c.hostname,
      port: c.port ? Number(c.port) : void 0,
      path: `${c.pathname}${c.search}`,
      method: "POST",
      headers: r
    }), D = ie.createReadStream(d, {
      highWaterMark: 1024 * 1024
    }), S = {
      uploadId: h,
      request: l,
      fileStream: D,
      sender: i.sender,
      totalBytes: Math.max(0, y.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(h, S);
    let F = !1;
    const N = (C) => {
      F || (F = !0, t.delete(h), v(C));
    }, I = (C) => {
      F || (F = !0, t.delete(h), m(C));
    };
    let k = "";
    l.on("response", (C) => {
      C.on("data", (z) => {
        k += z.toString();
      }), C.on("end", () => {
        let z;
        try {
          z = JSON.parse(k);
        } catch {
          z = k;
        }
        N({
          status: C.statusCode,
          body: z
        });
      });
    }), l.on("error", (C) => {
      if (S.aborted) {
        I(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        D.destroy(C);
      } catch {
      }
      I(C);
    }), l.write(_), l.write(L), D.on("data", (C) => {
      S.aborted || (S.uploadedBytes += C.length, o(S));
    }), D.on("end", () => {
      S.aborted || (o(S, !0), l.write(s), l.end());
    }), D.on("error", (C) => {
      if (S.aborted) {
        I(new Error("UPLOAD_ABORTED"));
        return;
      }
      I(C);
      try {
        l.destroy(C);
      } catch {
      }
    }), D.pipe(l, { end: !1 });
  }));
}
function yt() {
  at(P), ut(P), gt(P);
}
const Oe = "persist:omniflow-embedded-browser", bt = "embedded-browser-downloads";
let oe = null, ge = !1;
function Ae() {
  return g.join(R.getPath("userData"), bt);
}
function vt() {
  const e = Ae();
  return re(e) || de(e, { recursive: !0 }), e;
}
function Et() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function Dt(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function Y(e, t) {
  var o, i;
  return {
    downloadId: t.downloadId,
    fileName: t.fileName,
    mimeType: t.mimeType,
    pageUrl: t.pageUrl,
    receivedBytes: t.receivedBytes ?? Math.max(0, Number(((o = e.getReceivedBytes) == null ? void 0 : o.call(e)) || 0)),
    state: t.state,
    tabId: t.tabId,
    tempPath: t.tempPath,
    totalBytes: t.totalBytes ?? Math.max(0, Number(((i = e.getTotalBytes) == null ? void 0 : i.call(e)) || 0)),
    url: t.url,
    ...t.error ? { error: t.error } : {}
  };
}
function Tt() {
  return oe || (oe = Te.fromPartition(Oe)), oe;
}
async function Fe(e) {
  const t = g.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const o = g.resolve(Ae());
  return t !== o && !t.startsWith(`${o}${g.sep}`) ? !1 : (await te.rm(t, { force: !0 }), !0);
}
function _t(e) {
  if (ge)
    return;
  ge = !0;
  const t = (a, d, f) => {
    const p = e.resolveTabIdByWebContents(f) || void 0;
    if (!p)
      return;
    const E = vt(), v = Et(), m = d.getFilename() || "download", y = d.getURL() || "", u = f.getURL() || void 0, h = g.join(E, Dt(m));
    d.setSavePath(h), e.emitDownload(Y(d, {
      downloadId: v,
      fileName: m,
      mimeType: d.getMimeType() || void 0,
      pageUrl: u,
      state: "started",
      tabId: p,
      tempPath: h,
      url: y
    })), d.on("updated", (T, _) => {
      _ === "progressing" && e.emitDownload(Y(d, {
        downloadId: v,
        fileName: m,
        mimeType: d.getMimeType() || void 0,
        pageUrl: u,
        state: "progress",
        tabId: p,
        tempPath: h,
        url: y
      }));
    }), d.once("done", (T, _) => {
      if (_ === "completed") {
        e.emitDownload(Y(d, {
          downloadId: v,
          fileName: m,
          mimeType: d.getMimeType() || void 0,
          pageUrl: u,
          state: "completed",
          tabId: p,
          tempPath: h,
          url: y
        }));
        return;
      }
      Fe(h).catch(() => {
      }), e.emitDownload(Y(d, {
        downloadId: v,
        error: _ === "cancelled" ? "下载已取消" : `下载失败：${_}`,
        fileName: m,
        mimeType: d.getMimeType() || void 0,
        pageUrl: u,
        state: _ === "cancelled" ? "cancelled" : "failed",
        tabId: p,
        tempPath: h,
        url: y
      }));
    });
  }, o = /* @__PURE__ */ new Set();
  [Te.defaultSession, Tt()].filter(Boolean).forEach((a) => {
    o.has(a) || (o.add(a), a.on("will-download", t));
  });
}
const St = "embedded-browser-open-files", ye = 'input[data-omniflow-browser-open-fallback="true"]';
function xe() {
  return g.join(R.getPath("userData"), St);
}
function Ct() {
  const e = xe();
  return re(e) || de(e, { recursive: !0 }), e;
}
function Pt(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function Rt(e, t) {
  const o = g.resolve(e), i = g.resolve(t);
  return o === i ? !0 : o.startsWith(`${i}${g.sep}`);
}
async function Mt(e) {
  const t = await e.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${ye}') 
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
      return '${ye}'
    })()
  `, !0);
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
async function Bt(e, t, o) {
  var p;
  if (!t || o.length === 0)
    return !1;
  try {
    e.webContents.debugger.isAttached() || e.webContents.debugger.attach("1.3");
  } catch (E) {
    if (!String(E).includes("Already attached"))
      throw E;
  }
  const i = await e.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), a = Number(((p = i == null ? void 0 : i.root) == null ? void 0 : p.nodeId) || 0);
  if (!Number.isFinite(a) || a <= 0)
    return !1;
  const d = await e.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: a,
    selector: t
  }), f = Number((d == null ? void 0 : d.nodeId) || 0);
  return !Number.isFinite(f) || f <= 0 ? !1 : (await e.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: f,
    files: o
  }), !0);
}
async function Ot(e, t) {
  const o = await e.webContents.executeJavaScript(`
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
  return !!(o != null && o.ok);
}
async function At(e, t, o = {}) {
  const i = Ct(), a = g.join(i, Pt(t));
  return await le(e, a, o), a;
}
async function Z(e) {
  const t = g.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const o = g.resolve(xe());
  return Rt(t, o) ? (await te.rm(t, { force: !0 }), !0) : !1;
}
async function Ft(e, t) {
  if (!e || e.webContents.isDestroyed())
    return !1;
  const o = await Mt(e);
  return !o || !await Bt(e, o, [t]) ? !1 : Ot(e, o);
}
const xt = g.dirname(Ve(import.meta.url));
process.env.APP_ROOT = g.join(xt, "..");
const ne = process.env.VITE_DEV_SERVER_URL, Lt = g.join(process.env.APP_ROOT, "dist-electron"), Le = g.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ne ? g.join(process.env.APP_ROOT, "public") : Le;
const be = g.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Ut = "Omniflow", It = "omniflow-app", Nt = 1400, $t = 920, fe = 600, me = 400, Wt = "window-state.json", zt = 200, ve = process.env.NODE_ENV === "test" || !!(ne || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", kt = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
kt || (R.commandLine.appendSwitch("disable-logging"), R.commandLine.appendSwitch("log-level", "3"));
R.setName(Ut);
try {
  const e = g.join(R.getPath("appData"), It);
  R.setPath("userData", e);
} catch {
}
function Ue() {
  return re(be) ? be : null;
}
let b = null, Ee = !1, Ie = !1;
const Vt = 240;
let K = null;
const V = /* @__PURE__ */ new Map(), A = /* @__PURE__ */ new Map(), G = /* @__PURE__ */ new Map(), Q = /* @__PURE__ */ new Map(), se = /* @__PURE__ */ new Map();
let x = null, De = null;
function Ht(e) {
  !b || b.isDestroyed() || b.webContents.send("embedded-browser:download", e);
}
function jt(e) {
  for (const [t, o] of V.entries())
    if (o.webContents === e)
      return t;
  return null;
}
function Ne() {
  return g.join(R.getPath("userData"), Wt);
}
function W(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function Gt(e, t) {
  return e >= fe && t >= me;
}
function qt(e) {
  return ze.getAllDisplays().some((o) => {
    const i = o.workArea;
    return e.x < i.x + i.width && e.x + e.width > i.x && e.y < i.y + i.height && e.y + e.height > i.y;
  });
}
function Xt() {
  try {
    const e = Ne();
    if (!re(e))
      return null;
    const t = He(e, "utf-8"), o = JSON.parse(t);
    if (!W(o.width) || !W(o.height) || !Gt(o.width, o.height))
      return null;
    const i = !!o.maximized, a = {
      width: o.width,
      height: o.height,
      maximized: i
    };
    return W(o.x) && W(o.y) && (a.x = o.x, a.y = o.y), W(a.x) && W(a.y) && (qt({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height
    }) || (delete a.x, delete a.y)), a;
  } catch {
    return null;
  }
}
function he(e) {
  if (!e.isDestroyed())
    try {
      const t = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), o = {
        x: t.x,
        y: t.y,
        width: Math.max(Math.round(t.width), fe),
        height: Math.max(Math.round(t.height), me),
        maximized: e.isMaximized()
      }, i = Ne();
      de(g.dirname(i), { recursive: !0 }), je(i, JSON.stringify(o), "utf-8");
    } catch {
    }
}
function ee(e) {
  K && clearTimeout(K), K = setTimeout(() => {
    K = null, he(e);
  }, zt);
}
function Jt(e) {
  if (e.type !== "keyDown")
    return !1;
  const t = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && t === "i";
}
function Yt() {
  if (Ee)
    return;
  Ee = !0, P.handle("zoom-adjust", (s, n) => {
    const r = M.fromWebContents(s.sender) ?? b;
    if (!r || r.isDestroyed())
      return null;
    const c = r.webContents.getZoomFactor(), w = Math.min(Math.max(c + n, 0.25), 3);
    return r.webContents.setZoomFactor(w), w;
  }), P.on("window-minimize", (s) => {
    const n = M.fromWebContents(s.sender) ?? b;
    n == null || n.minimize();
  }), P.on("window-maximize", (s) => {
    const n = M.fromWebContents(s.sender) ?? b;
    !n || n.isDestroyed() || (n.isMaximized() ? n.unmaximize() : n.maximize());
  }), P.on("window-close", (s) => {
    const n = M.fromWebContents(s.sender) ?? b;
    n == null || n.close();
  }), P.handle("window-activate", (s, n = !1) => {
    const r = M.fromWebContents(s.sender) ?? b;
    return !r || r.isDestroyed() ? !1 : (r.isMinimized() && r.restore(), r.isVisible() || r.show(), process.platform === "darwin" ? R.focus({ steal: !0 }) : R.focus(), typeof r.moveTop == "function" && r.moveTop(), r.focus(), n && !r.isAlwaysOnTop() && (r.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      r.isDestroyed() || r.setAlwaysOnTop(!1);
    }, Vt)), !0);
  });
  const e = (s) => {
    U.log("[embedded-browser:main]", s), !(!b || b.isDestroyed()) && b.webContents.send("embedded-browser:state", s);
  }, t = async (s) => {
    if (!ve || s.webContents.isDestroyed())
      return [];
    try {
      const n = await s.webContents.executeJavaScript(`
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
  }, o = (s) => {
    const n = s.webContents.getTitle().trim();
    if (n)
      return n;
  }, i = (s, n, r) => {
    e({
      canGoBack: n.webContents.canGoBack(),
      canGoForward: n.webContents.canGoForward(),
      tabId: s,
      title: r.title ?? o(n),
      ...r
    });
  }, a = (s, n, r) => {
    i(s, n, {
      state: "ready",
      url: (r == null ? void 0 : r.url) ?? (A.get(s) || n.webContents.getURL() || void 0),
      ...r
    });
  }, d = (s) => {
    const n = V.get(s);
    return !n || n.webContents.isDestroyed() ? (V.delete(s), A.delete(s), null) : n;
  }, f = (s) => {
    const n = G.get(s);
    n != null && n.stagedPath && Z(n.stagedPath).catch(() => {
    }), G.delete(s);
    const r = Q.get(s);
    r && Z(r).catch(() => {
    }), Q.delete(s);
  }, p = (s) => {
    const n = (se.get(s) ?? 0) + 1;
    return se.set(s, n), n;
  }, E = (s, n) => se.get(s) === n, v = (s, n) => {
    try {
      const r = new URL(s), c = new URL(n);
      if (r.origin !== c.origin)
        return !1;
      const w = r.pathname.replace(/\/+$/, "") || "/", l = c.pathname.replace(/\/+$/, "") || "/";
      return l === "/" ? !0 : w === l || w.startsWith(`${l}/`);
    } catch {
      return !1;
    }
  }, m = async (s, n) => {
    const r = G.get(s);
    if (!r || n.webContents.isDestroyed())
      return !1;
    const c = n.webContents.getURL() || A.get(s) || "";
    if (!c || !v(c, r.pageUrl))
      return !1;
    try {
      if (!await Ft(n, r.stagedPath))
        return !1;
      const l = Q.get(s);
      return l && l !== r.stagedPath && Z(l).catch(() => {
      }), Q.set(s, r.stagedPath), G.delete(s), !0;
    } catch {
      return !1;
    }
  }, y = (s) => {
    s.setBounds(De ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }, u = (s) => {
    if (!x)
      return;
    const n = d(x);
    if (!n) {
      x = null;
      return;
    }
    s.contentView.children.includes(n) && s.contentView.removeChildView(n), x = null;
  }, h = (s) => {
    if (!b || b.isDestroyed())
      return null;
    const n = d(s);
    if (n)
      return n;
    const r = new ke({
      webPreferences: {
        devTools: !0,
        partition: Oe
      }
    });
    r.webContents.setZoomFactor(1);
    const c = r.webContents.getUserAgent();
    return c.includes("Electron") && r.webContents.setUserAgent(
      c.replace(/\sElectron\/[^\s]+/g, "")
    ), y(r), V.set(s, r), r.webContents.on("did-start-loading", () => {
      i(s, r, {
        details: "did-start-loading",
        state: "loading",
        url: r.webContents.getURL() || A.get(s) || void 0
      });
    }), r.webContents.on("did-stop-loading", async () => {
      if (r.webContents.isDestroyed())
        return;
      const w = r.webContents.getURL() || "";
      A.set(s, w), await m(s, r);
      const l = await t(r);
      i(s, r, {
        details: "did-stop-loading",
        ...l.length ? { meta: l } : {},
        state: "ready",
        url: w || void 0
      });
    }), r.webContents.on("did-navigate", (w, l) => {
      A.set(s, l), i(s, r, { details: "did-navigate", state: "ready", url: l }), m(s, r);
    }), r.webContents.on("did-navigate-in-page", (w, l) => {
      A.set(s, l), i(s, r, { details: "did-navigate-in-page", state: "ready", url: l }), m(s, r);
    }), r.webContents.on("page-title-updated", (w, l) => {
      i(s, r, {
        details: "page-title-updated",
        state: "ready",
        title: l || void 0,
        url: A.get(s) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("did-fail-load", (w, l, D, S) => {
      l !== -3 && i(s, r, {
        details: `did-fail-load(${l})`,
        state: "error",
        message: `页面加载失败：${D || "未知错误"}`,
        url: S
      });
    }), r.webContents.on("render-process-gone", (w, l) => {
      i(s, r, {
        details: `render-process-gone:${l.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${l.reason}`,
        url: A.get(s) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("console-message", (w, l, D, S, F) => {
      ve && l >= 2 && i(s, r, {
        details: `console:${F}:${S}`,
        state: "ready",
        message: D,
        meta: [`console-level=${l}`],
        url: A.get(s) || r.webContents.getURL() || void 0
      });
    }), r.webContents.setWindowOpenHandler(({ url: w }) => (r.webContents.loadURL(w), { action: "deny" })), r;
  }, T = (s, n, r) => {
    if (!s || s.isDestroyed())
      return null;
    if (!n)
      return u(s), null;
    const w = (r == null ? void 0 : r.createIfMissing) ?? !1 ? h(n) : d(n);
    return w ? !w || w.webContents.isDestroyed() ? null : (x && x !== n && u(s), y(w), s.contentView.children.includes(w) || s.contentView.addChildView(w), x = n, w) : (u(s), null);
  }, _ = async (s, n, r, c, w = !1) => {
    if (!s || s.isDestroyed())
      return;
    const l = String(n || "").trim();
    if (!l)
      return;
    const D = T(s, l, { createIfMissing: !0 });
    if (!D || D.webContents.isDestroyed())
      return;
    const S = String(r || "").trim();
    if (!S) {
      i(l, D, {
        state: "ready",
        title: o(D) || "新标签页",
        url: A.get(l) || void 0
      });
      return;
    }
    const F = A.get(l) || D.webContents.getURL();
    if (w && F === S) {
      i(l, D, {
        state: "ready",
        url: F || void 0
      });
      return;
    }
    i(l, D, {
      details: "load-url",
      state: "loading",
      url: S
    });
    try {
      await D.webContents.loadURL(S);
    } catch (N) {
      const I = N instanceof Error ? N.message : String(N);
      if (I.includes("ERR_ABORTED"))
        return;
      throw i(l, D, {
        details: c,
        state: "error",
        message: `页面加载失败：${I}`,
        url: S
      }), N;
    }
  }, L = (s, n) => {
    if (!s || s.isDestroyed())
      return;
    const r = String(n || "").trim();
    if (!r)
      return;
    const c = d(r);
    c && (s.contentView.children.includes(c) && s.contentView.removeChildView(c), x === r && (x = null), V.delete(r), A.delete(r), p(r), f(r), c.webContents.isDestroyed() || c.webContents.close({ waitForBeforeUnload: !1 }));
  };
  P.handle("embedded-browser:open-tab", async (s, n, r) => {
    const c = M.fromWebContents(s.sender) ?? b;
    p(String(n || "").trim()), f(String(n || "").trim());
    const w = String(r || "").trim();
    if (!w) {
      e({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: n,
        title: "新标签页"
      });
      return;
    }
    await _(c, n, w, "open-exception", !0);
  }), P.handle("embedded-browser:activate-tab", (s, n) => {
    const r = M.fromWebContents(s.sender) ?? b;
    T(r, n, { createIfMissing: !1 });
  }), P.handle("embedded-browser:navigate", async (s, n, r) => {
    const c = M.fromWebContents(s.sender) ?? b, w = String(n || "").trim();
    p(w), f(w), await _(c, w, r, "navigate-exception");
  }), P.handle("embedded-browser:open-mapped-file", async (s, n, r, c, w) => {
    const l = M.fromWebContents(s.sender) ?? b, D = String(n || "").trim(), S = String(r || "").trim(), F = String(c || "").trim(), N = String(w || "").trim() || "file";
    if (!D || !S || !F)
      return;
    const I = p(D);
    f(D);
    const k = await At(F, N);
    if (!E(D, I)) {
      Z(k).catch(() => {
      });
      return;
    }
    if (G.set(D, {
      fileName: N,
      pageUrl: S,
      stagedPath: k
    }), await _(l, D, S, "navigate-exception"), !E(D, I))
      return;
    const C = d(D);
    C && m(D, C);
  }), P.handle("embedded-browser:reload", async (s, n) => {
    const r = String(n || "").trim();
    if (!r)
      return;
    const c = d(r);
    !c || c.webContents.isDestroyed() || (i(r, c, {
      details: "reload",
      state: "loading",
      url: A.get(r) || c.webContents.getURL() || void 0
    }), c.webContents.reload(), a(r, c, {
      details: "reload-requested"
    }));
  }), P.handle("embedded-browser:go-back", async (s, n) => {
    const r = String(n || "").trim();
    if (!r)
      return;
    const c = d(r);
    !c || c.webContents.isDestroyed() || (c.webContents.canGoBack() && c.webContents.goBack(), a(r, c, {
      details: "history-back"
    }));
  }), P.handle("embedded-browser:go-forward", async (s, n) => {
    const r = String(n || "").trim();
    if (!r)
      return;
    const c = d(r);
    !c || c.webContents.isDestroyed() || (c.webContents.canGoForward() && c.webContents.goForward(), a(r, c, {
      details: "history-forward"
    }));
  }), P.handle("embedded-browser:set-bounds", (s, n) => {
    const r = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, c = M.fromWebContents(s.sender) ?? b, w = c && !c.isDestroyed() ? Math.max(c.webContents.getZoomFactor(), 0.01) : 1;
    if (r.x = Math.max(0, Math.round(n.x * w)), r.y = Math.max(0, Math.round(n.y * w)), r.width = Math.max(0, Math.round(n.width * w)), r.height = Math.max(0, Math.round(n.height * w)), De = r, !x)
      return;
    const l = d(x);
    l && l.setBounds(r);
  }), P.handle("embedded-browser:close-tab", (s, n) => {
    const r = M.fromWebContents(s.sender) ?? b;
    L(r, n);
  }), P.handle("embedded-browser:cleanup-download-file", async (s, n) => {
    try {
      return await Fe(n);
    } catch {
      return !1;
    }
  }), P.handle("embedded-browser:deactivate", (s) => {
    const n = M.fromWebContents(s.sender) ?? b;
    !n || n.isDestroyed() || u(n);
  }), P.handle("embedded-browser:close-all", (s) => {
    const n = M.fromWebContents(s.sender) ?? b;
    !n || n.isDestroyed() || (Array.from(V.keys()).forEach((r) => {
      L(n, r);
    }), x = null, e({ state: "idle" }));
  });
}
function $e() {
  if (b && !b.isDestroyed())
    return b.show(), b.focus(), b;
  const e = Ue(), t = Xt(), o = (t == null ? void 0 : t.width) ?? Nt, i = (t == null ? void 0 : t.height) ?? $t, a = new M({
    width: o,
    height: i,
    minWidth: fe,
    minHeight: me,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...W(t == null ? void 0 : t.x) && W(t == null ? void 0 : t.y) ? { x: t.x, y: t.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: g.join(Lt, "preload.mjs"),
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
  return b = a, t != null && t.maximized && a.maximize(), a.on("move", () => {
    ee(a);
  }), a.on("resize", () => {
    ee(a);
  }), a.on("maximize", () => {
    ee(a);
  }), a.on("unmaximize", () => {
    ee(a);
  }), a.on("close", (d) => {
    he(a), process.platform === "darwin" && !Ie && (d.preventDefault(), a.hide());
  }), a.on("closed", () => {
    b === a && (b = null);
  }), a.webContents.on("before-input-event", (d, f) => {
    Jt(f) && (d.preventDefault(), a.webContents.toggleDevTools());
  }), ne ? a.loadURL(ne) : a.loadFile(g.join(Le, "index.html")), a;
}
R.on("before-quit", () => {
  Ie = !0, b && !b.isDestroyed() && he(b);
});
R.on("window-all-closed", () => {
  process.platform !== "darwin" && R.quit();
});
R.on("activate", () => {
  if (b && !b.isDestroyed()) {
    b.isMinimized() && b.restore(), b.show(), b.focus();
    return;
  }
  M.getAllWindows().length === 0 && $e();
});
R.whenReady().then(() => {
  const e = Ue();
  e && process.platform === "darwin" && R.dock.setIcon(e), _t({
    emitDownload: Ht,
    resolveTabIdByWebContents: jt
  }), yt(), Yt(), $e();
});
export {
  Lt as MAIN_DIST,
  Le as RENDERER_DIST,
  ne as VITE_DEV_SERVER_URL
};
