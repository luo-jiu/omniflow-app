import { dialog as $, app as _, net as Ee, ipcMain as E, BrowserWindow as R, WebContentsView as Te, screen as De } from "electron";
import { fileURLToPath as Pe } from "node:url";
import g from "node:path";
import G, { existsSync as se, readFileSync as Se, mkdirSync as Re, writeFileSync as Ae } from "node:fs";
import v from "fs/promises";
import ae from "node:http";
import ce from "node:https";
import le from "os";
import J from "child_process";
import Ce from "fs";
const k = 6e4, Me = "Omniflow Inbox", xe = 10 * 60 * 1e3, Oe = 2, Ie = 2e3, X = 12, N = /* @__PURE__ */ new Map();
function Y(e) {
  const n = String(e || "");
  return !!(!n || n === ".DS_Store" || n.startsWith("._") || n === "Thumbs.db");
}
function z(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Le(e) {
  const n = String(e || "").toLowerCase();
  return !n || n.startsWith(".") ? !0 : n.endsWith(".crdownload") || n.endsWith(".part") || n.endsWith(".tmp") || n.endsWith(".opdownload") || n.endsWith(".download");
}
function de() {
  return g.join(_.getPath("userData"), "auto-import-staging");
}
function Ue(e, n) {
  const i = g.resolve(e), t = g.resolve(n);
  return i === t ? !0 : i.startsWith(`${t}${g.sep}`);
}
function Fe(e) {
  const n = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${n}`;
}
async function $e(e, n) {
  try {
    await v.rename(e, n);
  } catch (i) {
    if ((i == null ? void 0 : i.code) !== "EXDEV")
      throw i;
    await v.copyFile(e, n), await v.rm(e, { force: !0 });
  }
}
function We(e) {
  const n = Date.now();
  for (const [i, t] of N.entries())
    e.has(i) || n - t.lastSeenAt <= xe || N.delete(i);
}
async function Ne(e, n = X) {
  const i = String(e || "").trim(), t = i ? g.resolve(i) : g.join(_.getPath("downloads"), Me), r = await v.stat(t).catch(() => null);
  if (!(r != null && r.isDirectory()))
    return [];
  const o = await v.readdir(t, { withFileTypes: !0 }), a = /* @__PURE__ */ new Set(), c = Date.now(), m = [];
  for (const l of o) {
    if (!l.isFile() || Y(l.name) || Le(l.name)) continue;
    const d = g.join(t, l.name), y = await v.stat(d).catch(() => null);
    if (!(y != null && y.isFile())) continue;
    a.add(d);
    const T = N.get(d), M = (T ? T.size === y.size && T.mtimeMs === y.mtimeMs : !1) && T ? T.stableCount + 1 : 1;
    N.set(d, {
      size: y.size,
      mtimeMs: y.mtimeMs,
      stableCount: M,
      lastSeenAt: c
    }), !(M < Oe) && (c - y.mtimeMs < Ie || m.push({
      sourcePath: d,
      name: l.name,
      size: y.size,
      mtimeMs: y.mtimeMs
    }));
  }
  if (We(a), m.length === 0)
    return [];
  m.sort((l, d) => l.mtimeMs - d.mtimeMs);
  const h = de();
  await v.mkdir(h, { recursive: !0 });
  const f = [], p = Math.max(1, Math.floor(Number(n) || X));
  for (const l of m.slice(0, p)) {
    const d = g.join(h, Fe(l.name));
    try {
      await $e(l.sourcePath, d);
    } catch {
      continue;
    }
    N.delete(l.sourcePath), f.push({
      name: l.name,
      size: l.size,
      localPath: d,
      relativePath: z(l.name)
    });
  }
  return f;
}
async function ze(e) {
  const n = g.resolve(String(e || "").trim()), i = de();
  return !n || !Ue(n, i) ? !1 : (await v.rm(n, { force: !0 }), !0);
}
function te(e, n) {
  const i = z(n || "");
  if (!i)
    return e;
  const t = i.split("/").filter(Boolean);
  for (const r of t) {
    if (r === "." || r === "..")
      throw new Error(`非法下载路径片段: ${r}`);
    if (r.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return g.join(e, ...t);
}
async function ue(e, n, i = {}, t = 0) {
  const o = new URL(e);
  if (o.protocol !== "http:" && o.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${o.protocol}`);
  const a = o.protocol === "https:" ? ce : ae;
  await v.mkdir(g.dirname(n), { recursive: !0 }), await new Promise((c, m) => {
    let h = !1;
    const f = () => {
      h || (h = !0, c());
    }, p = (d) => {
      h || (h = !0, m(d));
    }, l = a.request({
      protocol: o.protocol,
      hostname: o.hostname,
      port: o.port ? Number(o.port) : void 0,
      path: `${o.pathname}${o.search}`,
      method: "GET",
      headers: i
    }, (d) => {
      d.setTimeout(k, () => {
        d.destroy(new Error(`下载响应超时: ${k}ms`));
      });
      const y = Number(d.statusCode || 0), T = d.headers.location;
      if (y >= 300 && y < 400 && T) {
        if (d.resume(), t >= 3) {
          p(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const P = new URL(T, e).toString();
        ue(P, n, i, t + 1).then(f).catch(p);
        return;
      }
      if (y >= 400) {
        d.resume(), p(new Error(`下载失败: HTTP ${y} (${e})`));
        return;
      }
      const C = G.createWriteStream(n), M = async (P) => {
        try {
          C.destroy();
        } catch {
        }
        try {
          await v.rm(n, { force: !0 });
        } catch {
        }
        p(P);
      };
      d.on("error", (P) => {
        M(P);
      }), C.on("error", (P) => {
        M(P);
      }), C.on("finish", () => f()), d.pipe(C);
    });
    l.setTimeout(k, () => {
      l.destroy(new Error(`下载请求超时: ${k}ms`));
    }), l.on("error", (d) => p(d)), l.end();
  });
}
function fe(e, n) {
  return e.relativePath.localeCompare(n.relativePath, "zh-Hans-CN");
}
async function Be(e) {
  return (await Promise.all(e.map(async (i) => {
    const t = await v.stat(i);
    if (!t.isFile())
      return null;
    const r = g.basename(i);
    return Y(r) ? null : {
      name: r,
      size: t.size,
      localPath: i,
      relativePath: z(r)
    };
  }))).filter((i) => !!i).sort(fe);
}
async function He(e, n, i) {
  const t = [n], r = [];
  for (; t.length > 0; ) {
    const f = t.pop(), p = await v.readdir(f, { withFileTypes: !0 });
    for (const l of p) {
      if (l.name === "." || l.name === ".." || Y(l.name) || l.isSymbolicLink())
        continue;
      const d = g.join(f, l.name);
      if (l.isDirectory()) {
        t.push(d);
        continue;
      }
      l.isFile() && r.push({
        absolutePath: d,
        name: l.name
      });
    }
  }
  const o = [], a = 48;
  let c = 0;
  const m = async () => {
    for (; ; ) {
      const f = c;
      if (c += 1, f >= r.length)
        return;
      const p = r[f], l = await v.stat(p.absolutePath).catch(() => null);
      if (!(l != null && l.isFile()))
        continue;
      const d = z(g.relative(e, p.absolutePath)), y = z(g.join(i, d));
      o.push({
        name: p.name,
        size: l.size,
        localPath: p.absolutePath,
        relativePath: y
      });
    }
  }, h = Math.min(a, Math.max(1, r.length));
  return await Promise.all(Array.from({ length: h }, () => m())), o;
}
async function ke(e) {
  const n = [];
  for (const i of e) {
    if (!(await v.stat(i)).isDirectory())
      continue;
    const r = g.basename(i), o = await He(i, i, r);
    n.push(...o);
  }
  return n.sort(fe);
}
function je(e) {
  e.handle("file:open", async () => {
    const n = await $.showOpenDialog({ properties: ["openFile"] });
    return n.canceled || n.filePaths.length === 0 ? null : await v.readFile(n.filePaths[0], "utf-8");
  }), e.handle("file:save", async (n, i, t) => (await v.writeFile(i, t, "utf-8"), !0)), e.handle("dialog:pick-upload-files", async () => {
    const n = await $.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Be(n.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const n = await $.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await ke(n.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const n = await $.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: n.filePaths[0] };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const n = await $.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: n.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (n, i, t = X) => ({ canceled: !1, files: await Ne(i, t) })), e.handle("fs:cleanup-auto-import-staged-file", async (n, i) => {
    try {
      return await ze(i);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (n, i, t = "") => {
    const r = te(i, t);
    return await v.mkdir(r, { recursive: !0 }), r;
  }), e.handle("fs:download-url-to-path", async (n, i, t, r, o = {}) => {
    const a = te(t, r);
    return await ue(i, a, o), a;
  });
}
var b = {}, A = le;
b.platform = function() {
  return process.platform;
};
b.cpuCount = function() {
  return A.cpus().length;
};
b.sysUptime = function() {
  return A.uptime();
};
b.processUptime = function() {
  return process.uptime();
};
b.freemem = function() {
  return A.freemem() / (1024 * 1024);
};
b.totalmem = function() {
  return A.totalmem() / (1024 * 1024);
};
b.freememPercentage = function() {
  return A.freemem() / A.totalmem();
};
b.freeCommand = function(e) {
  J.exec("free -m", function(n, i, t) {
    var r = i.split(`
`), o = r[1].replace(/[\s\n\r]+/g, " "), a = o.split(" ");
    total_mem = parseFloat(a[1]), free_mem = parseFloat(a[3]), buffers_mem = parseFloat(a[5]), cached_mem = parseFloat(a[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
b.harddrive = function(e) {
  J.exec("df -k", function(n, i, t) {
    var r = 0, o = 0, a = 0, c = i.split(`
`), m = c[1].replace(/[\s\n\r]+/g, " "), h = m.split(" ");
    r = Math.ceil(h[1] * 1024 / Math.pow(1024, 2)), o = Math.ceil(h[2] * 1024 / Math.pow(1024, 2)), a = Math.ceil(h[3] * 1024 / Math.pow(1024, 2)), e(r, a, o);
  });
};
b.getProcesses = function(e, n) {
  typeof e == "function" && (n = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), J.exec(command, function(i, t, r) {
    var o = t.split(`
`);
    o.shift(), o.pop();
    var a = "";
    o.forEach(function(c, m) {
      var h = c.replace(/[\s\n\r]+/g, " ");
      h = h.split(" "), a += h[1] + " " + h[2] + " " + h[3] + " " + h[4].substring(h[4].length - 25) + `
`;
    }), n(a);
  });
};
b.allLoadavg = function() {
  var e = A.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
b.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var n = A.loadavg(), i = 0;
  return e == 1 && (i = n[0]), e == 5 && (i = n[1]), e == 15 && (i = n[2]), i;
};
b.cpuFree = function(e) {
  me(e, !0);
};
b.cpuUsage = function(e) {
  me(e, !1);
};
function me(e, n) {
  var i = ne(), t = i.idle, r = i.total;
  setTimeout(function() {
    var o = ne(), a = o.idle, c = o.total, m = a - t, h = c - r, f = m / h;
    e(n === !0 ? f : 1 - f);
  }, 1e3);
}
function ne(e) {
  var n = A.cpus(), i = 0, t = 0, r = 0, o = 0, a = 0, m = 0;
  for (var c in n)
    i += n[c].times.user, t += n[c].times.nice, r += n[c].times.sys, a += n[c].times.irq, o += n[c].times.idle;
  var m = i + t + r + o + a;
  return {
    idle: o,
    total: m
  };
}
const Ve = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", W = (e, ...n) => {
  Ve && console[e](...n);
}, D = {
  debug: (...e) => W("debug", ...e),
  info: (...e) => W("info", ...e),
  log: (...e) => W("log", ...e),
  warn: (...e) => W("warn", ...e),
  error: (...e) => W("error", ...e)
};
function qe() {
  const e = Ge().total, n = le.cpus()[0].model, i = Math.floor(b.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: n,
    totalMemoryGB: i
  };
}
function Ge() {
  const e = Ce.statfsSync(process.platform === "win32" ? "C:" : "/"), n = e.blocks * e.bsize, i = e.bfree * e.bsize;
  return {
    total: Math.floor(n / 1e9),
    // 换算为 GB
    usage: 1 - i / n
    // 使用率计算
  };
}
function Xe(e) {
  e.handle("sys:get-static-data", qe);
}
const Ze = 10 * 1024 * 1024 * 1024, Je = "10GB", Ye = `上传失败：单文件最大支持 ${Je}`;
function he(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Qe(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (n) => `%${n.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Ke(e) {
  const n = he(e), i = Qe(e);
  return `Content-Disposition: form-data; name="file"; filename="${n}"; filename*=UTF-8''${i}\r
`;
}
function et(e) {
  const n = /* @__PURE__ */ new Map(), i = (t, r = !1) => {
    const o = Date.now();
    if (!r && o - t.lastProgressAt < 80) return;
    t.lastProgressAt = o;
    const a = Math.max(o - t.startedAt, 1), c = Math.floor(t.uploadedBytes * 1e3 / a), m = t.totalBytes > 0 ? Math.min(t.uploadedBytes / t.totalBytes * 100, 100) : 0;
    t.sender.send("http:upload:progress", {
      uploadId: t.uploadId,
      uploadedBytes: t.uploadedBytes,
      totalBytes: t.totalBytes,
      percentage: m,
      speedBps: c
    });
  };
  e.handle("http:fetch", async (t, r, o = {}) => (D.debug("http:fetch start"), D.debug("http:fetch URL:", r), D.debug("http:fetch options:", o), new Promise((a, c) => {
    const m = Ee.request({ url: r, method: o.method || "GET" });
    o.headers && Object.entries(o.headers).forEach(([f, p]) => {
      D.debug(`http:fetch set header ${f}: ${String(p)}`), m.setHeader(f, p);
    });
    let h = "";
    m.on("response", (f) => {
      D.debug("http:fetch response"), D.debug("http:fetch status:", f.statusCode), D.debug("http:fetch headers:", f.headers), f.on("data", (p) => {
        D.debug(`http:fetch chunk length: ${p.length}`), h += p;
      }), f.on("end", () => {
        D.debug("http:fetch body preview:", h.slice(0, 500));
        let p;
        try {
          p = JSON.parse(h);
        } catch {
          p = h;
        }
        a({
          status: f.statusCode,
          headers: f.headers,
          body: p
        });
      });
    }), m.on("error", (f) => {
      D.error("http:fetch error:", f), c(f);
    }), o.body && m.write(o.body), m.end();
  }))), e.handle("http:upload:abort", async (t, r) => {
    const o = n.get(r);
    if (!o) return !1;
    o.aborted = !0, n.delete(r);
    try {
      o.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      o.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (t, r, o, a = {}, c = {}, m) => new Promise((h, f) => {
    let p;
    try {
      p = G.statSync(o);
    } catch (w) {
      f(new Error(`读取上传文件失败: ${o} (${String(w)})`));
      return;
    }
    if (!p.isFile()) {
      f(new Error(`上传目标不是文件: ${o}`));
      return;
    }
    if (p.size > Ze) {
      f(new Error(Ye));
      return;
    }
    const l = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), d = m || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, y = g.basename(o), T = Object.entries(a).map(([w, L]) => `--${l}\r
Content-Disposition: form-data; name="${he(w)}"\r
\r
${L}\r
`).join(""), C = `--${l}\r
` + Ke(y) + `Content-Type: application/octet-stream\r
\r
`, M = `\r
--${l}--\r
`, P = Buffer.byteLength(T) + Buffer.byteLength(C) + p.size + Buffer.byteLength(M), be = {
      ...c,
      "Content-Type": `multipart/form-data; boundary=${l}`,
      "Content-Length": String(P)
    }, I = new URL(r), S = (I.protocol === "https:" ? ce : ae).request({
      protocol: I.protocol,
      hostname: I.hostname,
      port: I.port ? Number(I.port) : void 0,
      path: `${I.pathname}${I.search}`,
      method: "POST",
      headers: be
    }), U = G.createReadStream(o, {
      highWaterMark: 1024 * 1024
    }), x = {
      uploadId: d,
      request: S,
      fileStream: U,
      sender: t.sender,
      totalBytes: Math.max(0, p.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    n.set(d, x);
    let B = !1;
    const _e = (w) => {
      B || (B = !0, n.delete(d), h(w));
    }, H = (w) => {
      B || (B = !0, n.delete(d), f(w));
    };
    let q = "";
    S.on("response", (w) => {
      w.on("data", (L) => {
        q += L.toString();
      }), w.on("end", () => {
        let L;
        try {
          L = JSON.parse(q);
        } catch {
          L = q;
        }
        _e({
          status: w.statusCode,
          body: L
        });
      });
    }), S.on("error", (w) => {
      if (x.aborted) {
        H(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        U.destroy(w);
      } catch {
      }
      H(w);
    }), S.write(T), S.write(C), U.on("data", (w) => {
      x.aborted || (x.uploadedBytes += w.length, i(x));
    }), U.on("end", () => {
      x.aborted || (i(x, !0), S.write(M), S.end());
    }), U.on("error", (w) => {
      if (x.aborted) {
        H(new Error("UPLOAD_ABORTED"));
        return;
      }
      H(w);
      try {
        S.destroy(w);
      } catch {
      }
    }), U.pipe(S, { end: !1 });
  }));
}
function tt() {
  je(E), Xe(E), et(E);
}
const nt = g.dirname(Pe(import.meta.url));
process.env.APP_ROOT = g.join(nt, "..");
const Z = process.env.VITE_DEV_SERVER_URL, rt = g.join(process.env.APP_ROOT, "dist-electron"), pe = g.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Z ? g.join(process.env.APP_ROOT, "public") : pe;
const re = g.join(process.env.APP_ROOT, "build", "icons", "icon.png"), ot = "Omniflow", it = "omniflow-app", st = 1400, at = 920, Q = 600, K = 400, ct = "window-state.json", lt = 200;
_.setName(ot);
try {
  const e = g.join(_.getPath("appData"), it);
  _.setPath("userData", e);
} catch {
}
function ge() {
  return se(re) ? re : null;
}
let u = null, oe = !1, ye = !1;
const dt = 240;
let j = null, s = null, F = "", ie = null;
function we() {
  return g.join(_.getPath("userData"), ct);
}
function O(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function ut(e, n) {
  return e >= Q && n >= K;
}
function ft(e) {
  return De.getAllDisplays().some((i) => {
    const t = i.workArea;
    return e.x < t.x + t.width && e.x + e.width > t.x && e.y < t.y + t.height && e.y + e.height > t.y;
  });
}
function mt() {
  try {
    const e = we();
    if (!se(e))
      return null;
    const n = Se(e, "utf-8"), i = JSON.parse(n);
    if (!O(i.width) || !O(i.height) || !ut(i.width, i.height))
      return null;
    const t = !!i.maximized, r = {
      width: i.width,
      height: i.height,
      maximized: t
    };
    return O(i.x) && O(i.y) && (r.x = i.x, r.y = i.y), O(r.x) && O(r.y) && (ft({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height
    }) || (delete r.x, delete r.y)), r;
  } catch {
    return null;
  }
}
function ee(e) {
  if (!e.isDestroyed())
    try {
      const n = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), i = {
        x: n.x,
        y: n.y,
        width: Math.max(Math.round(n.width), Q),
        height: Math.max(Math.round(n.height), K),
        maximized: e.isMaximized()
      }, t = we();
      Re(g.dirname(t), { recursive: !0 }), Ae(t, JSON.stringify(i), "utf-8");
    } catch {
    }
}
function V(e) {
  j && clearTimeout(j), j = setTimeout(() => {
    j = null, ee(e);
  }, lt);
}
function ht(e) {
  if (e.type !== "keyDown")
    return !1;
  const n = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && n === "i";
}
function pt() {
  if (oe)
    return;
  oe = !0, E.handle("zoom-adjust", (t, r) => {
    const o = R.fromWebContents(t.sender) ?? u;
    if (!o || o.isDestroyed())
      return null;
    const a = o.webContents.getZoomFactor(), c = Math.min(Math.max(a + r, 0.25), 3);
    return o.webContents.setZoomFactor(c), c;
  }), E.on("window-minimize", (t) => {
    const r = R.fromWebContents(t.sender) ?? u;
    r == null || r.minimize();
  }), E.on("window-maximize", (t) => {
    const r = R.fromWebContents(t.sender) ?? u;
    !r || r.isDestroyed() || (r.isMaximized() ? r.unmaximize() : r.maximize());
  }), E.on("window-close", (t) => {
    const r = R.fromWebContents(t.sender) ?? u;
    r == null || r.close();
  }), E.handle("window-activate", (t, r = !1) => {
    const o = R.fromWebContents(t.sender) ?? u;
    return !o || o.isDestroyed() ? !1 : (o.isMinimized() && o.restore(), o.isVisible() || o.show(), process.platform === "darwin" ? _.focus({ steal: !0 }) : _.focus(), typeof o.moveTop == "function" && o.moveTop(), o.focus(), r && !o.isAlwaysOnTop() && (o.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      o.isDestroyed() || o.setAlwaysOnTop(!1);
    }, dt)), !0);
  });
  const e = (t) => {
    console.log("[embedded-browser:main]", t), !(!u || u.isDestroyed()) && u.webContents.send("embedded-browser:state", t);
  }, n = async () => {
    if (!s || s.webContents.isDestroyed())
      return [];
    try {
      const t = await s.webContents.executeJavaScript(`
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
      return t != null && t.title && r.push(`title=${t.title}`), t != null && t.readyState && r.push(`readyState=${t.readyState}`), typeof (t == null ? void 0 : t.bodyHtmlLength) == "number" && r.push(`bodyHtml=${t.bodyHtmlLength}`), typeof (t == null ? void 0 : t.innerWidth) == "number" && typeof (t == null ? void 0 : t.innerHeight) == "number" && r.push(`viewport=${t.innerWidth}x${t.innerHeight}`), typeof (t == null ? void 0 : t.clientWidth) == "number" && typeof (t == null ? void 0 : t.clientHeight) == "number" && r.push(`client=${t.clientWidth}x${t.clientHeight}`), typeof (t == null ? void 0 : t.devicePixelRatio) == "number" && r.push(`dpr=${t.devicePixelRatio}`), t != null && t.bodyTextPreview && r.push(`preview=${t.bodyTextPreview}`), t != null && t.userAgent && r.push(`ua=${t.userAgent}`), r;
    } catch (t) {
      return [`inspect=${t instanceof Error ? t.message : String(t)}`];
    }
  }, i = () => {
    if (!u || u.isDestroyed())
      return null;
    if (s && !s.webContents.isDestroyed())
      return s;
    s = new Te({
      webPreferences: {
        devTools: !0
      }
    }), s.webContents.setZoomFactor(1);
    const t = s.webContents.getUserAgent();
    return t.includes("Electron") && s.webContents.setUserAgent(
      t.replace(/\sElectron\/[^\s]+/g, "")
    ), s.setBounds(ie ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }), u.contentView.addChildView(s), s.webContents.on("did-start-loading", () => {
      e({
        details: "did-start-loading",
        state: "loading",
        url: (s == null ? void 0 : s.webContents.getURL()) || void 0
      });
    }), s.webContents.on("did-stop-loading", async () => {
      F = (s == null ? void 0 : s.webContents.getURL()) || "";
      const r = await n();
      e({
        details: "did-stop-loading",
        meta: r,
        state: "ready",
        url: F || void 0
      });
    }), s.webContents.on("did-navigate", (r, o) => {
      F = o, e({ details: "did-navigate", state: "ready", url: o });
    }), s.webContents.on("did-navigate-in-page", (r, o) => {
      F = o, e({ details: "did-navigate-in-page", state: "ready", url: o });
    }), s.webContents.on("did-fail-load", (r, o, a, c) => {
      o !== -3 && e({
        details: `did-fail-load(${o})`,
        state: "error",
        message: `页面加载失败：${a || "未知错误"}`,
        url: c
      });
    }), s.webContents.on("render-process-gone", (r, o) => {
      e({
        details: `render-process-gone:${o.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${o.reason}`,
        url: (s == null ? void 0 : s.webContents.getURL()) || void 0
      });
    }), s.webContents.on("console-message", (r, o, a, c, m) => {
      o >= 2 && e({
        details: `console:${m}:${c}`,
        state: "ready",
        message: a,
        meta: [`console-level=${o}`],
        url: F || (s == null ? void 0 : s.webContents.getURL()) || void 0
      });
    }), s.webContents.setWindowOpenHandler(({ url: r }) => (s == null || s.webContents.loadURL(r), { action: "deny" })), s;
  };
  E.handle("embedded-browser:open", async (t, r) => {
    const o = R.fromWebContents(t.sender) ?? u;
    if (!o || o.isDestroyed())
      return;
    const a = String(r || "").trim();
    if (a) {
      (!s || s.webContents.isDestroyed()) && i(), s && !o.contentView.children.includes(s) && o.contentView.addChildView(s), e({ state: "loading", url: a });
      try {
        await (s == null ? void 0 : s.webContents.loadURL(a));
      } catch (c) {
        const m = c instanceof Error ? c.message : String(c);
        if (m.includes("ERR_ABORTED"))
          return;
        throw e({
          details: "open-exception",
          state: "error",
          message: `页面加载失败：${m}`,
          url: a
        }), c;
      }
    }
  }), E.handle("embedded-browser:navigate", async (t, r) => {
    const o = String(r || "").trim();
    if (o) {
      (!s || s.webContents.isDestroyed()) && i(), e({ state: "loading", url: o });
      try {
        await (s == null ? void 0 : s.webContents.loadURL(o));
      } catch (a) {
        const c = a instanceof Error ? a.message : String(a);
        if (c.includes("ERR_ABORTED"))
          return;
        throw e({
          details: "navigate-exception",
          state: "error",
          message: `页面加载失败：${c}`,
          url: o
        }), a;
      }
    }
  }), E.handle("embedded-browser:reload", async () => {
    s == null || s.webContents.reload();
  }), E.handle("embedded-browser:set-bounds", (t, r) => {
    const o = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, a = R.fromWebContents(t.sender) ?? u, c = a && !a.isDestroyed() ? Math.max(a.webContents.getZoomFactor(), 0.01) : 1;
    o.x = Math.max(0, Math.round(r.x * c)), o.y = Math.max(0, Math.round(r.y * c)), o.width = Math.max(0, Math.round(r.width * c)), o.height = Math.max(0, Math.round(r.height * c)), ie = o, console.log("[embedded-browser:bounds]", { raw: r, zoomFactor: c, applied: o }), s && s.setBounds(o);
  }), E.handle("embedded-browser:close", () => {
    !u || u.isDestroyed() || !s || (u.contentView.removeChildView(s), F = "", e({ state: "idle" }));
  });
}
function ve() {
  if (u && !u.isDestroyed())
    return u.show(), u.focus(), u;
  const e = ge(), n = mt(), i = (n == null ? void 0 : n.width) ?? st, t = (n == null ? void 0 : n.height) ?? at, r = new R({
    width: i,
    height: t,
    minWidth: Q,
    minHeight: K,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...O(n == null ? void 0 : n.x) && O(n == null ? void 0 : n.y) ? { x: n.x, y: n.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: g.join(rt, "preload.mjs"),
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
  return u = r, n != null && n.maximized && r.maximize(), r.on("move", () => {
    V(r);
  }), r.on("resize", () => {
    V(r);
  }), r.on("maximize", () => {
    V(r);
  }), r.on("unmaximize", () => {
    V(r);
  }), r.on("close", (o) => {
    ee(r), process.platform === "darwin" && !ye && (o.preventDefault(), r.hide());
  }), r.on("closed", () => {
    u === r && (u = null);
  }), r.webContents.session.webRequest.onHeadersReceived((o, a) => {
    a({
      responseHeaders: {
        ...o.responseHeaders,
        "Content-Security-Policy": [""]
        // 将其置为空
      }
    });
  }), r.webContents.on("before-input-event", (o, a) => {
    ht(a) && (o.preventDefault(), r.webContents.toggleDevTools());
  }), Z ? r.loadURL(Z) : r.loadFile(g.join(pe, "index.html")), r;
}
_.on("before-quit", () => {
  ye = !0, u && !u.isDestroyed() && ee(u);
});
_.on("window-all-closed", () => {
  process.platform !== "darwin" && _.quit();
});
_.on("activate", () => {
  if (u && !u.isDestroyed()) {
    u.isMinimized() && u.restore(), u.show(), u.focus();
    return;
  }
  R.getAllWindows().length === 0 && ve();
});
_.whenReady().then(() => {
  const e = ge();
  e && process.platform === "darwin" && _.dock.setIcon(e), tt(), pt(), ve();
});
export {
  rt as MAIN_DIST,
  pe as RENDERER_DIST,
  Z as VITE_DEV_SERVER_URL
};
