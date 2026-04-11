import { dialog as $, app as D, net as Se, ipcMain as E, BrowserWindow as C, screen as Ce, WebContentsView as Re } from "electron";
import { fileURLToPath as Pe } from "node:url";
import b from "node:path";
import Y, { existsSync as de, readFileSync as Me, mkdirSync as Ae, writeFileSync as Oe } from "node:fs";
import T from "fs/promises";
import ue from "node:http";
import fe from "node:https";
import me from "os";
import K from "child_process";
import xe from "fs";
const j = 6e4, Le = "Omniflow Inbox", Be = 10 * 60 * 1e3, Ue = 2, Fe = 2e3, Q = 12, V = /* @__PURE__ */ new Map();
function ee(t) {
  const n = String(t || "");
  return !!(!n || n === ".DS_Store" || n.startsWith("._") || n === "Thumbs.db");
}
function H(t) {
  return t.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Ie(t) {
  const n = String(t || "").toLowerCase();
  return !n || n.startsWith(".") ? !0 : n.endsWith(".crdownload") || n.endsWith(".part") || n.endsWith(".tmp") || n.endsWith(".opdownload") || n.endsWith(".download");
}
function he() {
  return b.join(D.getPath("userData"), "auto-import-staging");
}
function Ne(t, n) {
  const s = b.resolve(t), i = b.resolve(n);
  return s === i ? !0 : s.startsWith(`${i}${b.sep}`);
}
function $e(t) {
  const n = String(t || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${n}`;
}
async function We(t, n) {
  try {
    await T.rename(t, n);
  } catch (s) {
    if ((s == null ? void 0 : s.code) !== "EXDEV")
      throw s;
    await T.copyFile(t, n), await T.rm(t, { force: !0 });
  }
}
function ze(t) {
  const n = Date.now();
  for (const [s, i] of V.entries())
    t.has(s) || n - i.lastSeenAt <= Be || V.delete(s);
}
async function Ve(t, n = Q) {
  const s = String(t || "").trim(), i = s ? b.resolve(s) : b.join(D.getPath("downloads"), Le), a = await T.stat(i).catch(() => null);
  if (!(a != null && a.isDirectory()))
    return [];
  const c = await T.readdir(i, { withFileTypes: !0 }), f = /* @__PURE__ */ new Set(), p = Date.now(), y = [];
  for (const o of c) {
    if (!o.isFile() || ee(o.name) || Ie(o.name)) continue;
    const e = b.join(i, o.name), r = await T.stat(e).catch(() => null);
    if (!(r != null && r.isFile())) continue;
    f.add(e);
    const l = V.get(e), u = (l ? l.size === r.size && l.mtimeMs === r.mtimeMs : !1) && l ? l.stableCount + 1 : 1;
    V.set(e, {
      size: r.size,
      mtimeMs: r.mtimeMs,
      stableCount: u,
      lastSeenAt: p
    }), !(u < Ue) && (p - r.mtimeMs < Fe || y.push({
      sourcePath: e,
      name: o.name,
      size: r.size,
      mtimeMs: r.mtimeMs
    }));
  }
  if (ze(f), y.length === 0)
    return [];
  y.sort((o, e) => o.mtimeMs - e.mtimeMs);
  const w = he();
  await T.mkdir(w, { recursive: !0 });
  const m = [], g = Math.max(1, Math.floor(Number(n) || Q));
  for (const o of y.slice(0, g)) {
    const e = b.join(w, $e(o.name));
    try {
      await We(o.sourcePath, e);
    } catch {
      continue;
    }
    V.delete(o.sourcePath), m.push({
      name: o.name,
      size: o.size,
      localPath: e,
      relativePath: H(o.name)
    });
  }
  return m;
}
async function He(t) {
  const n = b.resolve(String(t || "").trim()), s = he();
  return !n || !Ne(n, s) ? !1 : (await T.rm(n, { force: !0 }), !0);
}
function oe(t, n) {
  const s = H(n || "");
  if (!s)
    return t;
  const i = s.split("/").filter(Boolean);
  for (const a of i) {
    if (a === "." || a === "..")
      throw new Error(`非法下载路径片段: ${a}`);
    if (a.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return b.join(t, ...i);
}
async function we(t, n, s = {}, i = 0) {
  const c = new URL(t);
  if (c.protocol !== "http:" && c.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${c.protocol}`);
  const f = c.protocol === "https:" ? fe : ue;
  await T.mkdir(b.dirname(n), { recursive: !0 }), await new Promise((p, y) => {
    let w = !1;
    const m = () => {
      w || (w = !0, p());
    }, g = (e) => {
      w || (w = !0, y(e));
    }, o = f.request({
      protocol: c.protocol,
      hostname: c.hostname,
      port: c.port ? Number(c.port) : void 0,
      path: `${c.pathname}${c.search}`,
      method: "GET",
      headers: s
    }, (e) => {
      e.setTimeout(j, () => {
        e.destroy(new Error(`下载响应超时: ${j}ms`));
      });
      const r = Number(e.statusCode || 0), l = e.headers.location;
      if (r >= 300 && r < 400 && l) {
        if (e.resume(), i >= 3) {
          g(new Error(`下载重定向次数过多: ${t}`));
          return;
        }
        const v = new URL(l, t).toString();
        we(v, n, s, i + 1).then(m).catch(g);
        return;
      }
      if (r >= 400) {
        e.resume(), g(new Error(`下载失败: HTTP ${r} (${t})`));
        return;
      }
      const d = Y.createWriteStream(n), u = async (v) => {
        try {
          d.destroy();
        } catch {
        }
        try {
          await T.rm(n, { force: !0 });
        } catch {
        }
        g(v);
      };
      e.on("error", (v) => {
        u(v);
      }), d.on("error", (v) => {
        u(v);
      }), d.on("finish", () => m()), e.pipe(d);
    });
    o.setTimeout(j, () => {
      o.destroy(new Error(`下载请求超时: ${j}ms`));
    }), o.on("error", (e) => g(e)), o.end();
  });
}
function ge(t, n) {
  return t.relativePath.localeCompare(n.relativePath, "zh-Hans-CN");
}
async function ke(t) {
  return (await Promise.all(t.map(async (s) => {
    const i = await T.stat(s);
    if (!i.isFile())
      return null;
    const a = b.basename(s);
    return ee(a) ? null : {
      name: a,
      size: i.size,
      localPath: s,
      relativePath: H(a)
    };
  }))).filter((s) => !!s).sort(ge);
}
async function Ge(t, n, s) {
  const i = [n], a = [];
  for (; i.length > 0; ) {
    const m = i.pop(), g = await T.readdir(m, { withFileTypes: !0 });
    for (const o of g) {
      if (o.name === "." || o.name === ".." || ee(o.name) || o.isSymbolicLink())
        continue;
      const e = b.join(m, o.name);
      if (o.isDirectory()) {
        i.push(e);
        continue;
      }
      o.isFile() && a.push({
        absolutePath: e,
        name: o.name
      });
    }
  }
  const c = [], f = 48;
  let p = 0;
  const y = async () => {
    for (; ; ) {
      const m = p;
      if (p += 1, m >= a.length)
        return;
      const g = a[m], o = await T.stat(g.absolutePath).catch(() => null);
      if (!(o != null && o.isFile()))
        continue;
      const e = H(b.relative(t, g.absolutePath)), r = H(b.join(s, e));
      c.push({
        name: g.name,
        size: o.size,
        localPath: g.absolutePath,
        relativePath: r
      });
    }
  }, w = Math.min(f, Math.max(1, a.length));
  return await Promise.all(Array.from({ length: w }, () => y())), c;
}
async function je(t) {
  const n = [];
  for (const s of t) {
    if (!(await T.stat(s)).isDirectory())
      continue;
    const a = b.basename(s), c = await Ge(s, s, a);
    n.push(...c);
  }
  return n.sort(ge);
}
function qe(t) {
  t.handle("file:open", async () => {
    const n = await $.showOpenDialog({ properties: ["openFile"] });
    return n.canceled || n.filePaths.length === 0 ? null : await T.readFile(n.filePaths[0], "utf-8");
  }), t.handle("file:save", async (n, s, i) => (await T.writeFile(s, i, "utf-8"), !0)), t.handle("dialog:pick-upload-files", async () => {
    const n = await $.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await ke(n.filePaths) };
  }), t.handle("dialog:pick-upload-folders", async () => {
    const n = await $.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await je(n.filePaths) };
  }), t.handle("dialog:pick-download-directory", async () => {
    const n = await $.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: n.filePaths[0] };
  }), t.handle("dialog:pick-auto-import-directory", async () => {
    const n = await $.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: n.filePaths[0] };
  }), t.handle("fs:claim-auto-import-files", async (n, s, i = Q) => ({ canceled: !1, files: await Ve(s, i) })), t.handle("fs:cleanup-auto-import-staged-file", async (n, s) => {
    try {
      return await He(s);
    } catch {
      return !1;
    }
  }), t.handle("fs:ensure-directory", async (n, s, i = "") => {
    const a = oe(s, i);
    return await T.mkdir(a, { recursive: !0 }), a;
  }), t.handle("fs:download-url-to-path", async (n, s, i, a, c = {}) => {
    const f = oe(i, a);
    return await we(s, f, c), f;
  });
}
var S = {}, L = me;
S.platform = function() {
  return process.platform;
};
S.cpuCount = function() {
  return L.cpus().length;
};
S.sysUptime = function() {
  return L.uptime();
};
S.processUptime = function() {
  return process.uptime();
};
S.freemem = function() {
  return L.freemem() / (1024 * 1024);
};
S.totalmem = function() {
  return L.totalmem() / (1024 * 1024);
};
S.freememPercentage = function() {
  return L.freemem() / L.totalmem();
};
S.freeCommand = function(t) {
  K.exec("free -m", function(n, s, i) {
    var a = s.split(`
`), c = a[1].replace(/[\s\n\r]+/g, " "), f = c.split(" ");
    total_mem = parseFloat(f[1]), free_mem = parseFloat(f[3]), buffers_mem = parseFloat(f[5]), cached_mem = parseFloat(f[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), t(used_mem - 2);
  });
};
S.harddrive = function(t) {
  K.exec("df -k", function(n, s, i) {
    var a = 0, c = 0, f = 0, p = s.split(`
`), y = p[1].replace(/[\s\n\r]+/g, " "), w = y.split(" ");
    a = Math.ceil(w[1] * 1024 / Math.pow(1024, 2)), c = Math.ceil(w[2] * 1024 / Math.pow(1024, 2)), f = Math.ceil(w[3] * 1024 / Math.pow(1024, 2)), t(a, f, c);
  });
};
S.getProcesses = function(t, n) {
  typeof t == "function" && (n = t, t = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", t > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (t + 1)), K.exec(command, function(s, i, a) {
    var c = i.split(`
`);
    c.shift(), c.pop();
    var f = "";
    c.forEach(function(p, y) {
      var w = p.replace(/[\s\n\r]+/g, " ");
      w = w.split(" "), f += w[1] + " " + w[2] + " " + w[3] + " " + w[4].substring(w[4].length - 25) + `
`;
    }), n(f);
  });
};
S.allLoadavg = function() {
  var t = L.loadavg();
  return t[0].toFixed(4) + "," + t[1].toFixed(4) + "," + t[2].toFixed(4);
};
S.loadavg = function(t) {
  (t === void 0 || t !== 5 && t !== 15) && (t = 1);
  var n = L.loadavg(), s = 0;
  return t == 1 && (s = n[0]), t == 5 && (s = n[1]), t == 15 && (s = n[2]), s;
};
S.cpuFree = function(t) {
  pe(t, !0);
};
S.cpuUsage = function(t) {
  pe(t, !1);
};
function pe(t, n) {
  var s = se(), i = s.idle, a = s.total;
  setTimeout(function() {
    var c = se(), f = c.idle, p = c.total, y = f - i, w = p - a, m = y / w;
    t(n === !0 ? m : 1 - m);
  }, 1e3);
}
function se(t) {
  var n = L.cpus(), s = 0, i = 0, a = 0, c = 0, f = 0, y = 0;
  for (var p in n)
    s += n[p].times.user, i += n[p].times.nice, a += n[p].times.sys, f += n[p].times.irq, c += n[p].times.idle;
  var y = s + i + a + c + f;
  return {
    idle: c,
    total: y
  };
}
const Xe = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", W = (t, ...n) => {
  Xe && console[t](...n);
}, O = {
  debug: (...t) => W("debug", ...t),
  info: (...t) => W("info", ...t),
  log: (...t) => W("log", ...t),
  warn: (...t) => W("warn", ...t),
  error: (...t) => W("error", ...t)
};
function Ze() {
  const t = Je().total, n = me.cpus()[0].model, s = Math.floor(S.totalmem() / 1024);
  return {
    totalStorage: t,
    cpuModel: n,
    totalMemoryGB: s
  };
}
function Je() {
  const t = xe.statfsSync(process.platform === "win32" ? "C:" : "/"), n = t.blocks * t.bsize, s = t.bfree * t.bsize;
  return {
    total: Math.floor(n / 1e9),
    // 换算为 GB
    usage: 1 - s / n
    // 使用率计算
  };
}
function Ye(t) {
  t.handle("sys:get-static-data", Ze);
}
const Qe = 10 * 1024 * 1024 * 1024, Ke = "10GB", et = `上传失败：单文件最大支持 ${Ke}`;
function ye(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function tt(t) {
  return encodeURIComponent(t).replace(
    /['()*]/g,
    (n) => `%${n.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function nt(t) {
  const n = ye(t), s = tt(t);
  return `Content-Disposition: form-data; name="file"; filename="${n}"; filename*=UTF-8''${s}\r
`;
}
function rt(t) {
  const n = /* @__PURE__ */ new Map(), s = (i, a = !1) => {
    const c = Date.now();
    if (!a && c - i.lastProgressAt < 80) return;
    i.lastProgressAt = c;
    const f = Math.max(c - i.startedAt, 1), p = Math.floor(i.uploadedBytes * 1e3 / f), y = i.totalBytes > 0 ? Math.min(i.uploadedBytes / i.totalBytes * 100, 100) : 0;
    i.sender.send("http:upload:progress", {
      uploadId: i.uploadId,
      uploadedBytes: i.uploadedBytes,
      totalBytes: i.totalBytes,
      percentage: y,
      speedBps: p
    });
  };
  t.handle("http:fetch", async (i, a, c = {}) => (O.debug("http:fetch start"), O.debug("http:fetch URL:", a), O.debug("http:fetch options:", c), new Promise((f, p) => {
    const y = Se.request({ url: a, method: c.method || "GET" });
    c.headers && Object.entries(c.headers).forEach(([m, g]) => {
      O.debug(`http:fetch set header ${m}: ${String(g)}`), y.setHeader(m, g);
    });
    let w = "";
    y.on("response", (m) => {
      O.debug("http:fetch response"), O.debug("http:fetch status:", m.statusCode), O.debug("http:fetch headers:", m.headers), m.on("data", (g) => {
        O.debug(`http:fetch chunk length: ${g.length}`), w += g;
      }), m.on("end", () => {
        O.debug("http:fetch body preview:", w.slice(0, 500));
        let g;
        try {
          g = JSON.parse(w);
        } catch {
          g = w;
        }
        f({
          status: m.statusCode,
          headers: m.headers,
          body: g
        });
      });
    }), y.on("error", (m) => {
      O.error("http:fetch error:", m), p(m);
    }), c.body && y.write(c.body), y.end();
  }))), t.handle("http:upload:abort", async (i, a) => {
    const c = n.get(a);
    if (!c) return !1;
    c.aborted = !0, n.delete(a);
    try {
      c.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      c.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), t.handle("http:upload", async (i, a, c, f = {}, p = {}, y) => new Promise((w, m) => {
    let g;
    try {
      g = Y.statSync(c);
    } catch (_) {
      m(new Error(`读取上传文件失败: ${c} (${String(_)})`));
      return;
    }
    if (!g.isFile()) {
      m(new Error(`上传目标不是文件: ${c}`));
      return;
    }
    if (g.size > Qe) {
      m(new Error(et));
      return;
    }
    const o = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), e = y || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, r = b.basename(c), l = Object.entries(f).map(([_, F]) => `--${o}\r
Content-Disposition: form-data; name="${ye(_)}"\r
\r
${F}\r
`).join(""), d = `--${o}\r
` + nt(r) + `Content-Type: application/octet-stream\r
\r
`, u = `\r
--${o}--\r
`, v = Buffer.byteLength(l) + Buffer.byteLength(d) + g.size + Buffer.byteLength(u), x = {
      ...p,
      "Content-Type": `multipart/form-data; boundary=${o}`,
      "Content-Length": String(v)
    }, P = new URL(a), M = (P.protocol === "https:" ? fe : ue).request({
      protocol: P.protocol,
      hostname: P.hostname,
      port: P.port ? Number(P.port) : void 0,
      path: `${P.pathname}${P.search}`,
      method: "POST",
      headers: x
    }), I = Y.createReadStream(c, {
      highWaterMark: 1024 * 1024
    }), B = {
      uploadId: e,
      request: M,
      fileStream: I,
      sender: i.sender,
      totalBytes: Math.max(0, g.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    n.set(e, B);
    let k = !1;
    const De = (_) => {
      k || (k = !0, n.delete(e), w(_));
    }, G = (_) => {
      k || (k = !0, n.delete(e), m(_));
    };
    let J = "";
    M.on("response", (_) => {
      _.on("data", (F) => {
        J += F.toString();
      }), _.on("end", () => {
        let F;
        try {
          F = JSON.parse(J);
        } catch {
          F = J;
        }
        De({
          status: _.statusCode,
          body: F
        });
      });
    }), M.on("error", (_) => {
      if (B.aborted) {
        G(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        I.destroy(_);
      } catch {
      }
      G(_);
    }), M.write(l), M.write(d), I.on("data", (_) => {
      B.aborted || (B.uploadedBytes += _.length, s(B));
    }), I.on("end", () => {
      B.aborted || (s(B, !0), M.write(u), M.end());
    }), I.on("error", (_) => {
      if (B.aborted) {
        G(new Error("UPLOAD_ABORTED"));
        return;
      }
      G(_);
      try {
        M.destroy(_);
      } catch {
      }
    }), I.pipe(M, { end: !1 });
  }));
}
function ot() {
  qe(E), Ye(E), rt(E);
}
const st = b.dirname(Pe(import.meta.url));
process.env.APP_ROOT = b.join(st, "..");
const Z = process.env.VITE_DEV_SERVER_URL, it = b.join(process.env.APP_ROOT, "dist-electron"), be = b.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Z ? b.join(process.env.APP_ROOT, "public") : be;
const ie = b.join(process.env.APP_ROOT, "build", "icons", "icon.png"), at = "Omniflow", ct = "omniflow-app", lt = 1400, dt = 920, te = 600, ne = 400, ut = "window-state.json", ft = 200, ae = process.env.NODE_ENV === "test" || !!(Z || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", mt = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
mt || (D.commandLine.appendSwitch("disable-logging"), D.commandLine.appendSwitch("log-level", "3"));
D.setName(at);
try {
  const t = b.join(D.getPath("appData"), ct);
  D.setPath("userData", t);
} catch {
}
function ve() {
  return de(ie) ? ie : null;
}
let h = null, ce = !1, _e = !1;
const ht = 240;
let q = null;
const z = /* @__PURE__ */ new Map(), R = /* @__PURE__ */ new Map();
let A = null, le = null;
function Ee() {
  return b.join(D.getPath("userData"), ut);
}
function U(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function wt(t, n) {
  return t >= te && n >= ne;
}
function gt(t) {
  return Ce.getAllDisplays().some((s) => {
    const i = s.workArea;
    return t.x < i.x + i.width && t.x + t.width > i.x && t.y < i.y + i.height && t.y + t.height > i.y;
  });
}
function pt() {
  try {
    const t = Ee();
    if (!de(t))
      return null;
    const n = Me(t, "utf-8"), s = JSON.parse(n);
    if (!U(s.width) || !U(s.height) || !wt(s.width, s.height))
      return null;
    const i = !!s.maximized, a = {
      width: s.width,
      height: s.height,
      maximized: i
    };
    return U(s.x) && U(s.y) && (a.x = s.x, a.y = s.y), U(a.x) && U(a.y) && (gt({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height
    }) || (delete a.x, delete a.y)), a;
  } catch {
    return null;
  }
}
function re(t) {
  if (!t.isDestroyed())
    try {
      const n = t.isMaximized() ? t.getNormalBounds() : t.getBounds(), s = {
        x: n.x,
        y: n.y,
        width: Math.max(Math.round(n.width), te),
        height: Math.max(Math.round(n.height), ne),
        maximized: t.isMaximized()
      }, i = Ee();
      Ae(b.dirname(i), { recursive: !0 }), Oe(i, JSON.stringify(s), "utf-8");
    } catch {
    }
}
function X(t) {
  q && clearTimeout(q), q = setTimeout(() => {
    q = null, re(t);
  }, ft);
}
function yt(t) {
  if (t.type !== "keyDown")
    return !1;
  const n = (t.key || "").toLowerCase();
  return (t.meta || t.control) && t.shift && n === "i";
}
function bt() {
  if (ce)
    return;
  ce = !0, E.handle("zoom-adjust", (o, e) => {
    const r = C.fromWebContents(o.sender) ?? h;
    if (!r || r.isDestroyed())
      return null;
    const l = r.webContents.getZoomFactor(), d = Math.min(Math.max(l + e, 0.25), 3);
    return r.webContents.setZoomFactor(d), d;
  }), E.on("window-minimize", (o) => {
    const e = C.fromWebContents(o.sender) ?? h;
    e == null || e.minimize();
  }), E.on("window-maximize", (o) => {
    const e = C.fromWebContents(o.sender) ?? h;
    !e || e.isDestroyed() || (e.isMaximized() ? e.unmaximize() : e.maximize());
  }), E.on("window-close", (o) => {
    const e = C.fromWebContents(o.sender) ?? h;
    e == null || e.close();
  }), E.handle("window-activate", (o, e = !1) => {
    const r = C.fromWebContents(o.sender) ?? h;
    return !r || r.isDestroyed() ? !1 : (r.isMinimized() && r.restore(), r.isVisible() || r.show(), process.platform === "darwin" ? D.focus({ steal: !0 }) : D.focus(), typeof r.moveTop == "function" && r.moveTop(), r.focus(), e && !r.isAlwaysOnTop() && (r.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      r.isDestroyed() || r.setAlwaysOnTop(!1);
    }, ht)), !0);
  });
  const t = (o) => {
    O.log("[embedded-browser:main]", o), !(!h || h.isDestroyed()) && h.webContents.send("embedded-browser:state", o);
  }, n = async (o) => {
    if (!ae || o.webContents.isDestroyed())
      return [];
    try {
      const e = await o.webContents.executeJavaScript(`
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
      return e != null && e.title && r.push(`title=${e.title}`), e != null && e.readyState && r.push(`readyState=${e.readyState}`), typeof (e == null ? void 0 : e.bodyHtmlLength) == "number" && r.push(`bodyHtml=${e.bodyHtmlLength}`), typeof (e == null ? void 0 : e.innerWidth) == "number" && typeof (e == null ? void 0 : e.innerHeight) == "number" && r.push(`viewport=${e.innerWidth}x${e.innerHeight}`), typeof (e == null ? void 0 : e.clientWidth) == "number" && typeof (e == null ? void 0 : e.clientHeight) == "number" && r.push(`client=${e.clientWidth}x${e.clientHeight}`), typeof (e == null ? void 0 : e.devicePixelRatio) == "number" && r.push(`dpr=${e.devicePixelRatio}`), e != null && e.bodyTextPreview && r.push(`preview=${e.bodyTextPreview}`), e != null && e.userAgent && r.push(`ua=${e.userAgent}`), r;
    } catch (e) {
      return [`inspect=${e instanceof Error ? e.message : String(e)}`];
    }
  }, s = (o) => {
    const e = o.webContents.getTitle().trim();
    if (e)
      return e;
  }, i = (o, e, r) => {
    t({
      canGoBack: e.webContents.canGoBack(),
      canGoForward: e.webContents.canGoForward(),
      tabId: o,
      title: r.title ?? s(e),
      ...r
    });
  }, a = (o, e, r) => {
    i(o, e, {
      state: "ready",
      url: (r == null ? void 0 : r.url) ?? (R.get(o) || e.webContents.getURL() || void 0),
      ...r
    });
  }, c = (o) => {
    const e = z.get(o);
    return !e || e.webContents.isDestroyed() ? (z.delete(o), R.delete(o), null) : e;
  }, f = (o) => {
    o.setBounds(le ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }, p = (o) => {
    if (!A)
      return;
    const e = c(A);
    if (!e) {
      A = null;
      return;
    }
    o.contentView.children.includes(e) && o.contentView.removeChildView(e), A = null;
  }, y = (o) => {
    if (!h || h.isDestroyed())
      return null;
    const e = c(o);
    if (e)
      return e;
    const r = new Re({
      webPreferences: {
        devTools: !0
      }
    });
    r.webContents.setZoomFactor(1);
    const l = r.webContents.getUserAgent();
    return l.includes("Electron") && r.webContents.setUserAgent(
      l.replace(/\sElectron\/[^\s]+/g, "")
    ), f(r), z.set(o, r), r.webContents.on("did-start-loading", () => {
      i(o, r, {
        details: "did-start-loading",
        state: "loading",
        url: r.webContents.getURL() || R.get(o) || void 0
      });
    }), r.webContents.on("did-stop-loading", async () => {
      if (r.webContents.isDestroyed())
        return;
      const d = r.webContents.getURL() || "";
      R.set(o, d);
      const u = await n(r);
      i(o, r, {
        details: "did-stop-loading",
        ...u.length ? { meta: u } : {},
        state: "ready",
        url: d || void 0
      });
    }), r.webContents.on("did-navigate", (d, u) => {
      R.set(o, u), i(o, r, { details: "did-navigate", state: "ready", url: u });
    }), r.webContents.on("did-navigate-in-page", (d, u) => {
      R.set(o, u), i(o, r, { details: "did-navigate-in-page", state: "ready", url: u });
    }), r.webContents.on("page-title-updated", (d, u) => {
      i(o, r, {
        details: "page-title-updated",
        state: "ready",
        title: u || void 0,
        url: R.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("did-fail-load", (d, u, v, x) => {
      u !== -3 && i(o, r, {
        details: `did-fail-load(${u})`,
        state: "error",
        message: `页面加载失败：${v || "未知错误"}`,
        url: x
      });
    }), r.webContents.on("render-process-gone", (d, u) => {
      i(o, r, {
        details: `render-process-gone:${u.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${u.reason}`,
        url: R.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("console-message", (d, u, v, x, P) => {
      ae && u >= 2 && i(o, r, {
        details: `console:${P}:${x}`,
        state: "ready",
        message: v,
        meta: [`console-level=${u}`],
        url: R.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.setWindowOpenHandler(({ url: d }) => (r.webContents.loadURL(d), { action: "deny" })), r;
  }, w = (o, e, r) => {
    if (!o || o.isDestroyed())
      return null;
    if (!e)
      return p(o), null;
    const d = (r == null ? void 0 : r.createIfMissing) ?? !1 ? y(e) : c(e);
    return d ? !d || d.webContents.isDestroyed() ? null : (A && A !== e && p(o), f(d), o.contentView.children.includes(d) || o.contentView.addChildView(d), A = e, d) : (p(o), null);
  }, m = async (o, e, r, l, d = !1) => {
    if (!o || o.isDestroyed())
      return;
    const u = String(e || "").trim();
    if (!u)
      return;
    const v = w(o, u, { createIfMissing: !0 });
    if (!v || v.webContents.isDestroyed())
      return;
    const x = String(r || "").trim();
    if (!x) {
      i(u, v, {
        state: "ready",
        title: s(v) || "新标签页",
        url: R.get(u) || void 0
      });
      return;
    }
    const P = R.get(u) || v.webContents.getURL();
    if (d && P === x) {
      i(u, v, {
        state: "ready",
        url: P || void 0
      });
      return;
    }
    i(u, v, {
      details: "load-url",
      state: "loading",
      url: x
    });
    try {
      await v.webContents.loadURL(x);
    } catch (N) {
      const M = N instanceof Error ? N.message : String(N);
      if (M.includes("ERR_ABORTED"))
        return;
      throw i(u, v, {
        details: l,
        state: "error",
        message: `页面加载失败：${M}`,
        url: x
      }), N;
    }
  }, g = (o, e) => {
    if (!o || o.isDestroyed())
      return;
    const r = String(e || "").trim();
    if (!r)
      return;
    const l = c(r);
    l && (o.contentView.children.includes(l) && o.contentView.removeChildView(l), A === r && (A = null), z.delete(r), R.delete(r), l.webContents.isDestroyed() || l.webContents.close({ waitForBeforeUnload: !1 }));
  };
  E.handle("embedded-browser:open-tab", async (o, e, r) => {
    const l = C.fromWebContents(o.sender) ?? h, d = String(r || "").trim();
    if (!d) {
      t({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: e,
        title: "新标签页"
      });
      return;
    }
    await m(l, e, d, "open-exception", !0);
  }), E.handle("embedded-browser:activate-tab", (o, e) => {
    const r = C.fromWebContents(o.sender) ?? h;
    w(r, e, { createIfMissing: !1 });
  }), E.handle("embedded-browser:navigate", async (o, e, r) => {
    const l = C.fromWebContents(o.sender) ?? h;
    await m(l, e, r, "navigate-exception");
  }), E.handle("embedded-browser:reload", async (o, e) => {
    const r = String(e || "").trim();
    if (!r)
      return;
    const l = c(r);
    !l || l.webContents.isDestroyed() || (i(r, l, {
      details: "reload",
      state: "loading",
      url: R.get(r) || l.webContents.getURL() || void 0
    }), l.webContents.reload(), a(r, l, {
      details: "reload-requested"
    }));
  }), E.handle("embedded-browser:go-back", async (o, e) => {
    const r = String(e || "").trim();
    if (!r)
      return;
    const l = c(r);
    !l || l.webContents.isDestroyed() || (l.webContents.canGoBack() && l.webContents.goBack(), a(r, l, {
      details: "history-back"
    }));
  }), E.handle("embedded-browser:go-forward", async (o, e) => {
    const r = String(e || "").trim();
    if (!r)
      return;
    const l = c(r);
    !l || l.webContents.isDestroyed() || (l.webContents.canGoForward() && l.webContents.goForward(), a(r, l, {
      details: "history-forward"
    }));
  }), E.handle("embedded-browser:set-bounds", (o, e) => {
    const r = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, l = C.fromWebContents(o.sender) ?? h, d = l && !l.isDestroyed() ? Math.max(l.webContents.getZoomFactor(), 0.01) : 1;
    if (r.x = Math.max(0, Math.round(e.x * d)), r.y = Math.max(0, Math.round(e.y * d)), r.width = Math.max(0, Math.round(e.width * d)), r.height = Math.max(0, Math.round(e.height * d)), le = r, O.log("[embedded-browser:bounds]", { raw: e, zoomFactor: d, applied: r }), !A)
      return;
    const u = c(A);
    u && u.setBounds(r);
  }), E.handle("embedded-browser:close-tab", (o, e) => {
    const r = C.fromWebContents(o.sender) ?? h;
    g(r, e);
  }), E.handle("embedded-browser:deactivate", (o) => {
    const e = C.fromWebContents(o.sender) ?? h;
    !e || e.isDestroyed() || p(e);
  }), E.handle("embedded-browser:close-all", (o) => {
    const e = C.fromWebContents(o.sender) ?? h;
    !e || e.isDestroyed() || (Array.from(z.keys()).forEach((r) => {
      g(e, r);
    }), A = null, t({ state: "idle" }));
  });
}
function Te() {
  if (h && !h.isDestroyed())
    return h.show(), h.focus(), h;
  const t = ve(), n = pt(), s = (n == null ? void 0 : n.width) ?? lt, i = (n == null ? void 0 : n.height) ?? dt, a = new C({
    width: s,
    height: i,
    minWidth: te,
    minHeight: ne,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...U(n == null ? void 0 : n.x) && U(n == null ? void 0 : n.y) ? { x: n.x, y: n.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: b.join(it, "preload.mjs"),
      // Electron 安全推荐配置
      devTools: !0
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: !0,
    // 自动隐藏菜单栏
    ...t ? { icon: t } : {}
  });
  return h = a, n != null && n.maximized && a.maximize(), a.on("move", () => {
    X(a);
  }), a.on("resize", () => {
    X(a);
  }), a.on("maximize", () => {
    X(a);
  }), a.on("unmaximize", () => {
    X(a);
  }), a.on("close", (c) => {
    re(a), process.platform === "darwin" && !_e && (c.preventDefault(), a.hide());
  }), a.on("closed", () => {
    h === a && (h = null);
  }), a.webContents.on("before-input-event", (c, f) => {
    yt(f) && (c.preventDefault(), a.webContents.toggleDevTools());
  }), Z ? a.loadURL(Z) : a.loadFile(b.join(be, "index.html")), a;
}
D.on("before-quit", () => {
  _e = !0, h && !h.isDestroyed() && re(h);
});
D.on("window-all-closed", () => {
  process.platform !== "darwin" && D.quit();
});
D.on("activate", () => {
  if (h && !h.isDestroyed()) {
    h.isMinimized() && h.restore(), h.show(), h.focus();
    return;
  }
  C.getAllWindows().length === 0 && Te();
});
D.whenReady().then(() => {
  const t = ve();
  t && process.platform === "darwin" && D.dock.setIcon(t), ot(), bt(), Te();
});
export {
  it as MAIN_DIST,
  be as RENDERER_DIST,
  Z as VITE_DEV_SERVER_URL
};
