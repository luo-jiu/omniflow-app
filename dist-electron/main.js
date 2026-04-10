import { dialog as C, app as v, net as _e, ipcMain as I, BrowserWindow as x, screen as ve } from "electron";
import { fileURLToPath as Te } from "node:url";
import f from "node:path";
import V, { existsSync as re, readFileSync as Ee, mkdirSync as De, writeFileSync as Pe } from "node:fs";
import g from "fs/promises";
import oe from "node:http";
import se from "node:https";
import ae from "os";
import X from "child_process";
import Se from "fs";
const $ = 6e4, be = "Omniflow Inbox", Ae = 10 * 60 * 1e3, Re = 2, Oe = 2e3, q = 12, U = /* @__PURE__ */ new Map();
function J(e) {
  const t = String(e || "");
  return !!(!t || t === ".DS_Store" || t.startsWith("._") || t === "Thumbs.db");
}
function z(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Ie(e) {
  const t = String(e || "").toLowerCase();
  return !t || t.startsWith(".") ? !0 : t.endsWith(".crdownload") || t.endsWith(".part") || t.endsWith(".tmp") || t.endsWith(".opdownload") || t.endsWith(".download");
}
function ie() {
  return f.join(v.getPath("userData"), "auto-import-staging");
}
function Me(e, t) {
  const n = f.resolve(e), o = f.resolve(t);
  return n === o ? !0 : n.startsWith(`${o}${f.sep}`);
}
function Fe(e) {
  const t = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
async function xe(e, t) {
  try {
    await g.rename(e, t);
  } catch (n) {
    if ((n == null ? void 0 : n.code) !== "EXDEV")
      throw n;
    await g.copyFile(e, t), await g.rm(e, { force: !0 });
  }
}
function Ne(e) {
  const t = Date.now();
  for (const [n, o] of U.entries())
    e.has(n) || t - o.lastSeenAt <= Ae || U.delete(n);
}
async function Ce(e, t = q) {
  const n = String(e || "").trim(), o = n ? f.resolve(n) : f.join(v.getPath("downloads"), be), r = await g.stat(o).catch(() => null);
  if (!(r != null && r.isDirectory()))
    return [];
  const s = await g.readdir(o, { withFileTypes: !0 }), i = /* @__PURE__ */ new Set(), h = Date.now(), m = [];
  for (const a of s) {
    if (!a.isFile() || J(a.name) || Ie(a.name)) continue;
    const c = f.join(o, a.name), w = await g.stat(c).catch(() => null);
    if (!(w != null && w.isFile())) continue;
    i.add(c);
    const T = U.get(c), A = (T ? T.size === w.size && T.mtimeMs === w.mtimeMs : !1) && T ? T.stableCount + 1 : 1;
    U.set(c, {
      size: w.size,
      mtimeMs: w.mtimeMs,
      stableCount: A,
      lastSeenAt: h
    }), !(A < Re) && (h - w.mtimeMs < Oe || m.push({
      sourcePath: c,
      name: a.name,
      size: w.size,
      mtimeMs: w.mtimeMs
    }));
  }
  if (Ne(i), m.length === 0)
    return [];
  m.sort((a, c) => a.mtimeMs - c.mtimeMs);
  const d = ie();
  await g.mkdir(d, { recursive: !0 });
  const l = [], u = Math.max(1, Math.floor(Number(t) || q));
  for (const a of m.slice(0, u)) {
    const c = f.join(d, Fe(a.name));
    try {
      await xe(a.sourcePath, c);
    } catch {
      continue;
    }
    U.delete(a.sourcePath), l.push({
      name: a.name,
      size: a.size,
      localPath: c,
      relativePath: z(a.name)
    });
  }
  return l;
}
async function Le(e) {
  const t = f.resolve(String(e || "").trim()), n = ie();
  return !t || !Me(t, n) ? !1 : (await g.rm(t, { force: !0 }), !0);
}
function K(e, t) {
  const n = z(t || "");
  if (!n)
    return e;
  const o = n.split("/").filter(Boolean);
  for (const r of o) {
    if (r === "." || r === "..")
      throw new Error(`非法下载路径片段: ${r}`);
    if (r.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return f.join(e, ...o);
}
async function ce(e, t, n = {}, o = 0) {
  const s = new URL(e);
  if (s.protocol !== "http:" && s.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${s.protocol}`);
  const i = s.protocol === "https:" ? se : oe;
  await g.mkdir(f.dirname(t), { recursive: !0 }), await new Promise((h, m) => {
    let d = !1;
    const l = () => {
      d || (d = !0, h());
    }, u = (c) => {
      d || (d = !0, m(c));
    }, a = i.request({
      protocol: s.protocol,
      hostname: s.hostname,
      port: s.port ? Number(s.port) : void 0,
      path: `${s.pathname}${s.search}`,
      method: "GET",
      headers: n
    }, (c) => {
      c.setTimeout($, () => {
        c.destroy(new Error(`下载响应超时: ${$}ms`));
      });
      const w = Number(c.statusCode || 0), T = c.headers.location;
      if (w >= 300 && w < 400 && T) {
        if (c.resume(), o >= 3) {
          u(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const D = new URL(T, e).toString();
        ce(D, t, n, o + 1).then(l).catch(u);
        return;
      }
      if (w >= 400) {
        c.resume(), u(new Error(`下载失败: HTTP ${w} (${e})`));
        return;
      }
      const b = V.createWriteStream(t), A = async (D) => {
        try {
          b.destroy();
        } catch {
        }
        try {
          await g.rm(t, { force: !0 });
        } catch {
        }
        u(D);
      };
      c.on("error", (D) => {
        A(D);
      }), b.on("error", (D) => {
        A(D);
      }), b.on("finish", () => l()), c.pipe(b);
    });
    a.setTimeout($, () => {
      a.destroy(new Error(`下载请求超时: ${$}ms`));
    }), a.on("error", (c) => u(c)), a.end();
  });
}
function le(e, t) {
  return e.relativePath.localeCompare(t.relativePath, "zh-Hans-CN");
}
async function Ue(e) {
  return (await Promise.all(e.map(async (n) => {
    const o = await g.stat(n);
    if (!o.isFile())
      return null;
    const r = f.basename(n);
    return J(r) ? null : {
      name: r,
      size: o.size,
      localPath: n,
      relativePath: z(r)
    };
  }))).filter((n) => !!n).sort(le);
}
async function ze(e, t, n) {
  const o = [t], r = [];
  for (; o.length > 0; ) {
    const l = o.pop(), u = await g.readdir(l, { withFileTypes: !0 });
    for (const a of u) {
      if (a.name === "." || a.name === ".." || J(a.name) || a.isSymbolicLink())
        continue;
      const c = f.join(l, a.name);
      if (a.isDirectory()) {
        o.push(c);
        continue;
      }
      a.isFile() && r.push({
        absolutePath: c,
        name: a.name
      });
    }
  }
  const s = [], i = 48;
  let h = 0;
  const m = async () => {
    for (; ; ) {
      const l = h;
      if (h += 1, l >= r.length)
        return;
      const u = r[l], a = await g.stat(u.absolutePath).catch(() => null);
      if (!(a != null && a.isFile()))
        continue;
      const c = z(f.relative(e, u.absolutePath)), w = z(f.join(n, c));
      s.push({
        name: u.name,
        size: a.size,
        localPath: u.absolutePath,
        relativePath: w
      });
    }
  }, d = Math.min(i, Math.max(1, r.length));
  return await Promise.all(Array.from({ length: d }, () => m())), s;
}
async function Be(e) {
  const t = [];
  for (const n of e) {
    if (!(await g.stat(n)).isDirectory())
      continue;
    const r = f.basename(n), s = await ze(n, n, r);
    t.push(...s);
  }
  return t.sort(le);
}
function We(e) {
  e.handle("file:open", async () => {
    const t = await C.showOpenDialog({ properties: ["openFile"] });
    return t.canceled || t.filePaths.length === 0 ? null : await g.readFile(t.filePaths[0], "utf-8");
  }), e.handle("file:save", async (t, n, o) => (await g.writeFile(n, o, "utf-8"), !0)), e.handle("dialog:pick-upload-files", async () => {
    const t = await C.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Ue(t.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const t = await C.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Be(t.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const t = await C.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const t = await C.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (t, n, o = q) => ({ canceled: !1, files: await Ce(n, o) })), e.handle("fs:cleanup-auto-import-staged-file", async (t, n) => {
    try {
      return await Le(n);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (t, n, o = "") => {
    const r = K(n, o);
    return await g.mkdir(r, { recursive: !0 }), r;
  }), e.handle("fs:download-url-to-path", async (t, n, o, r, s = {}) => {
    const i = K(o, r);
    return await ce(n, i, s), i;
  });
}
var _ = {}, S = ae;
_.platform = function() {
  return process.platform;
};
_.cpuCount = function() {
  return S.cpus().length;
};
_.sysUptime = function() {
  return S.uptime();
};
_.processUptime = function() {
  return process.uptime();
};
_.freemem = function() {
  return S.freemem() / (1024 * 1024);
};
_.totalmem = function() {
  return S.totalmem() / (1024 * 1024);
};
_.freememPercentage = function() {
  return S.freemem() / S.totalmem();
};
_.freeCommand = function(e) {
  X.exec("free -m", function(t, n, o) {
    var r = n.split(`
`), s = r[1].replace(/[\s\n\r]+/g, " "), i = s.split(" ");
    total_mem = parseFloat(i[1]), free_mem = parseFloat(i[3]), buffers_mem = parseFloat(i[5]), cached_mem = parseFloat(i[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
_.harddrive = function(e) {
  X.exec("df -k", function(t, n, o) {
    var r = 0, s = 0, i = 0, h = n.split(`
`), m = h[1].replace(/[\s\n\r]+/g, " "), d = m.split(" ");
    r = Math.ceil(d[1] * 1024 / Math.pow(1024, 2)), s = Math.ceil(d[2] * 1024 / Math.pow(1024, 2)), i = Math.ceil(d[3] * 1024 / Math.pow(1024, 2)), e(r, i, s);
  });
};
_.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), X.exec(command, function(n, o, r) {
    var s = o.split(`
`);
    s.shift(), s.pop();
    var i = "";
    s.forEach(function(h, m) {
      var d = h.replace(/[\s\n\r]+/g, " ");
      d = d.split(" "), i += d[1] + " " + d[2] + " " + d[3] + " " + d[4].substring(d[4].length - 25) + `
`;
    }), t(i);
  });
};
_.allLoadavg = function() {
  var e = S.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
_.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var t = S.loadavg(), n = 0;
  return e == 1 && (n = t[0]), e == 5 && (n = t[1]), e == 15 && (n = t[2]), n;
};
_.cpuFree = function(e) {
  de(e, !0);
};
_.cpuUsage = function(e) {
  de(e, !1);
};
function de(e, t) {
  var n = ee(), o = n.idle, r = n.total;
  setTimeout(function() {
    var s = ee(), i = s.idle, h = s.total, m = i - o, d = h - r, l = m / d;
    e(t === !0 ? l : 1 - l);
  }, 1e3);
}
function ee(e) {
  var t = S.cpus(), n = 0, o = 0, r = 0, s = 0, i = 0, m = 0;
  for (var h in t)
    n += t[h].times.user, o += t[h].times.nice, r += t[h].times.sys, i += t[h].times.irq, s += t[h].times.idle;
  var m = n + o + r + s + i;
  return {
    idle: s,
    total: m
  };
}
const $e = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", L = (e, ...t) => {
  $e && console[e](...t);
}, E = {
  debug: (...e) => L("debug", ...e),
  info: (...e) => L("info", ...e),
  log: (...e) => L("log", ...e),
  warn: (...e) => L("warn", ...e),
  error: (...e) => L("error", ...e)
};
function ke() {
  const e = je().total, t = ae.cpus()[0].model, n = Math.floor(_.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: t,
    totalMemoryGB: n
  };
}
function je() {
  const e = Se.statfsSync(process.platform === "win32" ? "C:" : "/"), t = e.blocks * e.bsize, n = e.bfree * e.bsize;
  return {
    total: Math.floor(t / 1e9),
    // 换算为 GB
    usage: 1 - n / t
    // 使用率计算
  };
}
function He(e) {
  e.handle("sys:get-static-data", ke);
}
const Ve = 10 * 1024 * 1024 * 1024, qe = "10GB", Ge = `上传失败：单文件最大支持 ${qe}`;
function ue(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Xe(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (t) => `%${t.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Je(e) {
  const t = ue(e), n = Xe(e);
  return `Content-Disposition: form-data; name="file"; filename="${t}"; filename*=UTF-8''${n}\r
`;
}
function Ye(e) {
  const t = /* @__PURE__ */ new Map(), n = (o, r = !1) => {
    const s = Date.now();
    if (!r && s - o.lastProgressAt < 80) return;
    o.lastProgressAt = s;
    const i = Math.max(s - o.startedAt, 1), h = Math.floor(o.uploadedBytes * 1e3 / i), m = o.totalBytes > 0 ? Math.min(o.uploadedBytes / o.totalBytes * 100, 100) : 0;
    o.sender.send("http:upload:progress", {
      uploadId: o.uploadId,
      uploadedBytes: o.uploadedBytes,
      totalBytes: o.totalBytes,
      percentage: m,
      speedBps: h
    });
  };
  e.handle("http:fetch", async (o, r, s = {}) => (E.debug("http:fetch start"), E.debug("http:fetch URL:", r), E.debug("http:fetch options:", s), new Promise((i, h) => {
    const m = _e.request({ url: r, method: s.method || "GET" });
    s.headers && Object.entries(s.headers).forEach(([l, u]) => {
      E.debug(`http:fetch set header ${l}: ${String(u)}`), m.setHeader(l, u);
    });
    let d = "";
    m.on("response", (l) => {
      E.debug("http:fetch response"), E.debug("http:fetch status:", l.statusCode), E.debug("http:fetch headers:", l.headers), l.on("data", (u) => {
        E.debug(`http:fetch chunk length: ${u.length}`), d += u;
      }), l.on("end", () => {
        E.debug("http:fetch body preview:", d.slice(0, 500));
        let u;
        try {
          u = JSON.parse(d);
        } catch {
          u = d;
        }
        i({
          status: l.statusCode,
          headers: l.headers,
          body: u
        });
      });
    }), m.on("error", (l) => {
      E.error("http:fetch error:", l), h(l);
    }), s.body && m.write(s.body), m.end();
  }))), e.handle("http:upload:abort", async (o, r) => {
    const s = t.get(r);
    if (!s) return !1;
    s.aborted = !0, t.delete(r);
    try {
      s.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      s.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (o, r, s, i = {}, h = {}, m) => new Promise((d, l) => {
    let u;
    try {
      u = V.statSync(s);
    } catch (y) {
      l(new Error(`读取上传文件失败: ${s} (${String(y)})`));
      return;
    }
    if (!u.isFile()) {
      l(new Error(`上传目标不是文件: ${s}`));
      return;
    }
    if (u.size > Ve) {
      l(new Error(Ge));
      return;
    }
    const a = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), c = m || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, w = f.basename(s), T = Object.entries(i).map(([y, F]) => `--${a}\r
Content-Disposition: form-data; name="${ue(y)}"\r
\r
${F}\r
`).join(""), b = `--${a}\r
` + Je(w) + `Content-Type: application/octet-stream\r
\r
`, A = `\r
--${a}--\r
`, D = Buffer.byteLength(T) + Buffer.byteLength(b) + u.size + Buffer.byteLength(A), ye = {
      ...h,
      "Content-Type": `multipart/form-data; boundary=${a}`,
      "Content-Length": String(D)
    }, M = new URL(r), P = (M.protocol === "https:" ? se : oe).request({
      protocol: M.protocol,
      hostname: M.hostname,
      port: M.port ? Number(M.port) : void 0,
      path: `${M.pathname}${M.search}`,
      method: "POST",
      headers: ye
    }), N = V.createReadStream(s, {
      highWaterMark: 1024 * 1024
    }), R = {
      uploadId: c,
      request: P,
      fileStream: N,
      sender: o.sender,
      totalBytes: Math.max(0, u.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(c, R);
    let B = !1;
    const ge = (y) => {
      B || (B = !0, t.delete(c), d(y));
    }, W = (y) => {
      B || (B = !0, t.delete(c), l(y));
    };
    let H = "";
    P.on("response", (y) => {
      y.on("data", (F) => {
        H += F.toString();
      }), y.on("end", () => {
        let F;
        try {
          F = JSON.parse(H);
        } catch {
          F = H;
        }
        ge({
          status: y.statusCode,
          body: F
        });
      });
    }), P.on("error", (y) => {
      if (R.aborted) {
        W(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        N.destroy(y);
      } catch {
      }
      W(y);
    }), P.write(T), P.write(b), N.on("data", (y) => {
      R.aborted || (R.uploadedBytes += y.length, n(R));
    }), N.on("end", () => {
      R.aborted || (n(R, !0), P.write(A), P.end());
    }), N.on("error", (y) => {
      if (R.aborted) {
        W(new Error("UPLOAD_ABORTED"));
        return;
      }
      W(y);
      try {
        P.destroy(y);
      } catch {
      }
    }), N.pipe(P, { end: !1 });
  }));
}
function Ze() {
  We(I), He(I), Ye(I);
}
const Qe = f.dirname(Te(import.meta.url));
process.env.APP_ROOT = f.join(Qe, "..");
const G = process.env.VITE_DEV_SERVER_URL, Ke = f.join(process.env.APP_ROOT, "dist-electron"), fe = f.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = G ? f.join(process.env.APP_ROOT, "public") : fe;
const te = f.join(process.env.APP_ROOT, "build", "icons", "icon.png"), et = "Omniflow", tt = "omniflow-app", nt = 1400, rt = 920, Y = 600, Z = 400, ot = "window-state.json", st = 200;
v.setName(et);
try {
  const e = f.join(v.getPath("appData"), tt);
  v.setPath("userData", e);
} catch {
}
function me() {
  return re(te) ? te : null;
}
let p = null, ne = !1, he = !1;
const at = 240;
let k = null;
function pe() {
  return f.join(v.getPath("userData"), ot);
}
function O(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function it(e, t) {
  return e >= Y && t >= Z;
}
function ct(e) {
  return ve.getAllDisplays().some((n) => {
    const o = n.workArea;
    return e.x < o.x + o.width && e.x + e.width > o.x && e.y < o.y + o.height && e.y + e.height > o.y;
  });
}
function lt() {
  try {
    const e = pe();
    if (!re(e))
      return null;
    const t = Ee(e, "utf-8"), n = JSON.parse(t);
    if (!O(n.width) || !O(n.height) || !it(n.width, n.height))
      return null;
    const o = !!n.maximized, r = {
      width: n.width,
      height: n.height,
      maximized: o
    };
    return O(n.x) && O(n.y) && (r.x = n.x, r.y = n.y), O(r.x) && O(r.y) && (ct({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height
    }) || (delete r.x, delete r.y)), r;
  } catch {
    return null;
  }
}
function Q(e) {
  if (!e.isDestroyed())
    try {
      const t = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), n = {
        x: t.x,
        y: t.y,
        width: Math.max(Math.round(t.width), Y),
        height: Math.max(Math.round(t.height), Z),
        maximized: e.isMaximized()
      }, o = pe();
      De(f.dirname(o), { recursive: !0 }), Pe(o, JSON.stringify(n), "utf-8");
    } catch {
    }
}
function j(e) {
  k && clearTimeout(k), k = setTimeout(() => {
    k = null, Q(e);
  }, st);
}
function dt(e) {
  if (e.type !== "keyDown")
    return !1;
  const t = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && t === "i";
}
function ut() {
  ne || (ne = !0, I.handle("zoom-adjust", (e, t) => {
    const n = x.fromWebContents(e.sender) ?? p;
    if (!n || n.isDestroyed())
      return null;
    const o = n.webContents.getZoomFactor(), r = Math.min(Math.max(o + t, 0.25), 3);
    return n.webContents.setZoomFactor(r), r;
  }), I.on("window-minimize", (e) => {
    const t = x.fromWebContents(e.sender) ?? p;
    t == null || t.minimize();
  }), I.on("window-maximize", (e) => {
    const t = x.fromWebContents(e.sender) ?? p;
    !t || t.isDestroyed() || (t.isMaximized() ? t.unmaximize() : t.maximize());
  }), I.on("window-close", (e) => {
    const t = x.fromWebContents(e.sender) ?? p;
    t == null || t.close();
  }), I.handle("window-activate", (e, t = !1) => {
    const n = x.fromWebContents(e.sender) ?? p;
    return !n || n.isDestroyed() ? !1 : (n.isMinimized() && n.restore(), n.isVisible() || n.show(), process.platform === "darwin" ? v.focus({ steal: !0 }) : v.focus(), typeof n.moveTop == "function" && n.moveTop(), n.focus(), t && !n.isAlwaysOnTop() && (n.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      n.isDestroyed() || n.setAlwaysOnTop(!1);
    }, at)), !0);
  }));
}
function we() {
  if (p && !p.isDestroyed())
    return p.show(), p.focus(), p;
  const e = me(), t = lt(), n = (t == null ? void 0 : t.width) ?? nt, o = (t == null ? void 0 : t.height) ?? rt, r = new x({
    width: n,
    height: o,
    minWidth: Y,
    minHeight: Z,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...O(t == null ? void 0 : t.x) && O(t == null ? void 0 : t.y) ? { x: t.x, y: t.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: f.join(Ke, "preload.mjs"),
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
  return p = r, t != null && t.maximized && r.maximize(), r.on("move", () => {
    j(r);
  }), r.on("resize", () => {
    j(r);
  }), r.on("maximize", () => {
    j(r);
  }), r.on("unmaximize", () => {
    j(r);
  }), r.on("close", (s) => {
    Q(r), process.platform === "darwin" && !he && (s.preventDefault(), r.hide());
  }), r.on("closed", () => {
    p === r && (p = null);
  }), r.webContents.session.webRequest.onHeadersReceived((s, i) => {
    i({
      responseHeaders: {
        ...s.responseHeaders,
        "Content-Security-Policy": [""]
        // 将其置为空
      }
    });
  }), r.webContents.on("before-input-event", (s, i) => {
    dt(i) && (s.preventDefault(), r.webContents.toggleDevTools());
  }), G ? r.loadURL(G) : r.loadFile(f.join(fe, "index.html")), r;
}
v.on("before-quit", () => {
  he = !0, p && !p.isDestroyed() && Q(p);
});
v.on("window-all-closed", () => {
  process.platform !== "darwin" && v.quit();
});
v.on("activate", () => {
  if (p && !p.isDestroyed()) {
    p.isMinimized() && p.restore(), p.show(), p.focus();
    return;
  }
  x.getAllWindows().length === 0 && we();
});
v.whenReady().then(() => {
  const e = me();
  e && process.platform === "darwin" && v.dock.setIcon(e), Ze(), ut(), we();
});
export {
  Ke as MAIN_DIST,
  fe as RENDERER_DIST,
  G as VITE_DEV_SERVER_URL
};
