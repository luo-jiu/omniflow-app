import { dialog as ne, app as $, net as qr, ipcMain as O, session as _e, webContents as Xr, BrowserWindow as W, screen as Gr, WebContentsView as Jr } from "electron";
import { Buffer as er } from "node:buffer";
import { fileURLToPath as Zr } from "node:url";
import T from "node:path";
import ot, { existsSync as Ke, mkdirSync as ct, constants as Yr, readFileSync as Qr, writeFileSync as en } from "node:fs";
import N from "fs/promises";
import He, { mkdtemp as tn, writeFile as rn, rm as nn, access as on } from "node:fs/promises";
import tr from "node:http";
import rr from "node:https";
import nr from "os";
import dt from "child_process";
import sn from "fs";
import { spawn as or } from "node:child_process";
import an from "node:os";
const Me = 6e4;
async function ut(t, e, o = {}, a = 0) {
  const l = new URL(t);
  if (l.protocol !== "http:" && l.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${l.protocol}`);
  const y = l.protocol === "https:" ? rr : tr;
  await He.mkdir(T.dirname(e), { recursive: !0 }), await new Promise((R, _) => {
    let h = !1;
    const v = () => {
      h || (h = !0, R());
    }, w = (B) => {
      h || (h = !0, _(B));
    }, b = y.request({
      protocol: l.protocol,
      hostname: l.hostname,
      port: l.port ? Number(l.port) : void 0,
      path: `${l.pathname}${l.search}`,
      method: "GET",
      headers: o
    }, (B) => {
      B.setTimeout(Me, () => {
        B.destroy(new Error(`下载响应超时: ${Me}ms`));
      });
      const A = Number(B.statusCode || 0), L = B.headers.location;
      if (A >= 300 && A < 400 && L) {
        if (B.resume(), a >= 3) {
          w(new Error(`下载重定向次数过多: ${t}`));
          return;
        }
        const K = new URL(L, t).toString();
        ut(K, e, o, a + 1).then(v).catch(w);
        return;
      }
      if (A >= 400) {
        B.resume(), w(new Error(`下载失败: HTTP ${A} (${t})`));
        return;
      }
      const z = ot.createWriteStream(e), V = async (K) => {
        try {
          z.destroy();
        } catch {
        }
        try {
          await He.rm(e, { force: !0 });
        } catch {
        }
        w(K);
      };
      B.on("error", (K) => {
        V(K);
      }), z.on("error", (K) => {
        V(K);
      }), z.on("finish", () => v()), B.pipe(z);
    });
    b.setTimeout(Me, () => {
      b.destroy(new Error(`下载请求超时: ${Me}ms`));
    }), b.on("error", (B) => w(B)), b.end();
  });
}
const cn = "Omniflow Inbox", dn = 10 * 60 * 1e3, un = 2, ln = 2e3, st = 12, fn = T.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), Te = /* @__PURE__ */ new Map();
function lt(t) {
  const e = String(t || "");
  return !!(!e || e === ".DS_Store" || e.startsWith("._") || e === "Thumbs.db");
}
function Re(t) {
  return t.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function mn(t) {
  const e = String(t || "").toLowerCase();
  return !e || e.startsWith(".") ? !0 : e.endsWith(".crdownload") || e.endsWith(".part") || e.endsWith(".tmp") || e.endsWith(".opdownload") || e.endsWith(".download");
}
function sr() {
  return T.join($.getPath("userData"), "auto-import-staging");
}
function pn() {
  return T.join($.getPath("userData"), "embedded-browser-downloads");
}
function ir(t, e) {
  const o = T.resolve(t), a = T.resolve(e);
  return o === a ? !0 : o.startsWith(`${a}${T.sep}`);
}
function yn(t) {
  const e = String(t || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
async function gn(t, e) {
  try {
    await N.rename(t, e);
  } catch (o) {
    if ((o == null ? void 0 : o.code) !== "EXDEV")
      throw o;
    await N.copyFile(t, e), await N.rm(t, { force: !0 });
  }
}
function hn(t) {
  const e = Date.now();
  for (const [o, a] of Te.entries())
    t.has(o) || e - a.lastSeenAt <= dn || Te.delete(o);
}
async function wn(t, e = st) {
  const o = String(t || "").trim(), a = o ? T.resolve(o) : T.join($.getPath("downloads"), cn), d = await N.stat(a).catch(() => null);
  if (!(d != null && d.isDirectory()))
    return [];
  const l = await N.readdir(a, { withFileTypes: !0 }), y = /* @__PURE__ */ new Set(), R = Date.now(), _ = [];
  for (const b of l) {
    if (!b.isFile() || lt(b.name) || mn(b.name)) continue;
    const B = T.join(a, b.name), A = await N.stat(B).catch(() => null);
    if (!(A != null && A.isFile())) continue;
    y.add(B);
    const L = Te.get(B), V = (L ? L.size === A.size && L.mtimeMs === A.mtimeMs : !1) && L ? L.stableCount + 1 : 1;
    Te.set(B, {
      size: A.size,
      mtimeMs: A.mtimeMs,
      stableCount: V,
      lastSeenAt: R
    }), !(V < un) && (R - A.mtimeMs < ln || _.push({
      sourcePath: B,
      name: b.name,
      size: A.size,
      mtimeMs: A.mtimeMs
    }));
  }
  if (hn(y), _.length === 0)
    return [];
  _.sort((b, B) => b.mtimeMs - B.mtimeMs);
  const h = sr();
  await N.mkdir(h, { recursive: !0 });
  const v = [], w = Math.max(1, Math.floor(Number(e) || st));
  for (const b of _.slice(0, w)) {
    const B = T.join(h, yn(b.name));
    try {
      await gn(b.sourcePath, B);
    } catch {
      continue;
    }
    Te.delete(b.sourcePath), v.push({
      name: b.name,
      size: b.size,
      localPath: B,
      relativePath: Re(b.name)
    });
  }
  return v;
}
async function bn(t) {
  const e = T.resolve(String(t || "").trim()), o = sr();
  return !e || !ir(e, o) ? !1 : (await N.rm(e, { force: !0 }), !0);
}
function Nt(t, e) {
  const o = Re(e || "");
  if (!o)
    return t;
  const a = o.split("/").filter(Boolean);
  for (const d of a) {
    if (d === "." || d === "..")
      throw new Error(`非法下载路径片段: ${d}`);
    if (d.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return T.join(t, ...a);
}
function ar(t, e) {
  return t.relativePath.localeCompare(e.relativePath, "zh-Hans-CN");
}
async function vn(t) {
  return (await Promise.all(t.map(async (o) => {
    const a = await N.stat(o);
    if (!a.isFile())
      return null;
    const d = T.basename(o);
    return lt(d) ? null : {
      name: d,
      size: a.size,
      localPath: o,
      relativePath: Re(d)
    };
  }))).filter((o) => !!o).sort(ar);
}
async function Sn(t, e, o) {
  const a = [e], d = [];
  for (; a.length > 0; ) {
    const v = a.pop(), w = await N.readdir(v, { withFileTypes: !0 });
    for (const b of w) {
      if (b.name === "." || b.name === ".." || lt(b.name) || b.isSymbolicLink())
        continue;
      const B = T.join(v, b.name);
      if (b.isDirectory()) {
        a.push(B);
        continue;
      }
      b.isFile() && d.push({
        absolutePath: B,
        name: b.name
      });
    }
  }
  const l = [], y = 48;
  let R = 0;
  const _ = async () => {
    for (; R < d.length; ) {
      const v = R;
      if (R += 1, v >= d.length)
        return;
      const w = d[v], b = await N.stat(w.absolutePath).catch(() => null);
      if (!(b != null && b.isFile()))
        continue;
      const B = Re(T.relative(t, w.absolutePath)), A = Re(T.join(o, B));
      l.push({
        name: w.name,
        size: b.size,
        localPath: w.absolutePath,
        relativePath: A
      });
    }
  }, h = Math.min(y, Math.max(1, d.length));
  return await Promise.all(Array.from({ length: h }, () => _())), l;
}
async function En(t) {
  const e = [];
  for (const o of t) {
    if (!(await N.stat(o)).isDirectory())
      continue;
    const d = T.basename(o), l = await Sn(o, o, d);
    e.push(...l);
  }
  return e.sort(ar);
}
function Tn(t) {
  t.handle("file:open", async () => {
    const e = await ne.showOpenDialog({
      properties: ["openFile", "dontAddToRecent"],
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (e.canceled || e.filePaths.length === 0)
      return { canceled: !0, content: "", filePath: "" };
    const o = e.filePaths[0];
    return {
      canceled: !1,
      content: await N.readFile(o, "utf-8"),
      filePath: o
    };
  }), t.handle("file:save", async (e, o, a) => (await N.writeFile(o, a, "utf-8"), !0)), t.handle("file:read-text", async (e, o) => {
    const a = T.resolve(String(o || "").trim());
    return {
      canceled: !1,
      content: await N.readFile(a, "utf-8"),
      filePath: a
    };
  }), t.handle("file:read-local-chrome-bookmarks", async () => {
    const e = T.join($.getPath("home"), fn);
    return {
      canceled: !1,
      content: await N.readFile(e, "utf-8"),
      filePath: e
    };
  }), t.handle("dialog:pick-upload-files", async () => {
    const e = await ne.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await vn(e.filePaths) };
  }), t.handle("dialog:pick-upload-folders", async () => {
    const e = await ne.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await En(e.filePaths) };
  }), t.handle("dialog:pick-download-directory", async () => {
    const e = await ne.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("dialog:save-download-file", async (e, o) => {
    const a = await ne.showSaveDialog({
      defaultPath: String(o || "download"),
      showsTagField: !1
    });
    return a.canceled || !a.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: a.filePath };
  }), t.handle("dialog:pick-auto-import-directory", async () => {
    const e = await ne.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("fs:claim-auto-import-files", async (e, o, a = st) => ({ canceled: !1, files: await wn(o, a) })), t.handle("fs:cleanup-auto-import-staged-file", async (e, o) => {
    try {
      return await bn(o);
    } catch {
      return !1;
    }
  }), t.handle("fs:ensure-directory", async (e, o, a = "") => {
    const d = Nt(o, a);
    return await N.mkdir(d, { recursive: !0 }), d;
  }), t.handle("fs:download-url-to-path", async (e, o, a, d, l = {}) => {
    const y = Nt(a, d);
    return await ut(o, y, l), y;
  }), t.handle("fs:save-staged-download-file", async (e, o, a) => {
    const d = T.resolve(String(o || "").trim()), l = T.resolve(String(a || "").trim()), y = pn();
    if (!d || !ir(d, y))
      throw new Error("无效的下载临时文件");
    if (!l)
      throw new Error("无效的保存路径");
    return await N.mkdir(T.dirname(l), { recursive: !0 }), await N.copyFile(d, l), l;
  });
}
var H = {}, ce = nr;
H.platform = function() {
  return process.platform;
};
H.cpuCount = function() {
  return ce.cpus().length;
};
H.sysUptime = function() {
  return ce.uptime();
};
H.processUptime = function() {
  return process.uptime();
};
H.freemem = function() {
  return ce.freemem() / (1024 * 1024);
};
H.totalmem = function() {
  return ce.totalmem() / (1024 * 1024);
};
H.freememPercentage = function() {
  return ce.freemem() / ce.totalmem();
};
H.freeCommand = function(t) {
  dt.exec("free -m", function(e, o, a) {
    var d = o.split(`
`), l = d[1].replace(/[\s\n\r]+/g, " "), y = l.split(" ");
    total_mem = parseFloat(y[1]), free_mem = parseFloat(y[3]), buffers_mem = parseFloat(y[5]), cached_mem = parseFloat(y[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), t(used_mem - 2);
  });
};
H.harddrive = function(t) {
  dt.exec("df -k", function(e, o, a) {
    var d = 0, l = 0, y = 0, R = o.split(`
`), _ = R[1].replace(/[\s\n\r]+/g, " "), h = _.split(" ");
    d = Math.ceil(h[1] * 1024 / Math.pow(1024, 2)), l = Math.ceil(h[2] * 1024 / Math.pow(1024, 2)), y = Math.ceil(h[3] * 1024 / Math.pow(1024, 2)), t(d, y, l);
  });
};
H.getProcesses = function(t, e) {
  typeof t == "function" && (e = t, t = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", t > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (t + 1)), dt.exec(command, function(o, a, d) {
    var l = a.split(`
`);
    l.shift(), l.pop();
    var y = "";
    l.forEach(function(R, _) {
      var h = R.replace(/[\s\n\r]+/g, " ");
      h = h.split(" "), y += h[1] + " " + h[2] + " " + h[3] + " " + h[4].substring(h[4].length - 25) + `
`;
    }), e(y);
  });
};
H.allLoadavg = function() {
  var t = ce.loadavg();
  return t[0].toFixed(4) + "," + t[1].toFixed(4) + "," + t[2].toFixed(4);
};
H.loadavg = function(t) {
  (t === void 0 || t !== 5 && t !== 15) && (t = 1);
  var e = ce.loadavg(), o = 0;
  return t == 1 && (o = e[0]), t == 5 && (o = e[1]), t == 15 && (o = e[2]), o;
};
H.cpuFree = function(t) {
  cr(t, !0);
};
H.cpuUsage = function(t) {
  cr(t, !1);
};
function cr(t, e) {
  var o = Wt(), a = o.idle, d = o.total;
  setTimeout(function() {
    var l = Wt(), y = l.idle, R = l.total, _ = y - a, h = R - d, v = _ / h;
    t(e === !0 ? v : 1 - v);
  }, 1e3);
}
function Wt(t) {
  var e = ce.cpus(), o = 0, a = 0, d = 0, l = 0, y = 0, _ = 0;
  for (var R in e)
    o += e[R].times.user, a += e[R].times.nice, d += e[R].times.sys, y += e[R].times.irq, l += e[R].times.idle;
  var _ = o + a + d + l + y;
  return {
    idle: l,
    total: _
  };
}
const Rn = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Se = (t, ...e) => {
  Rn && console[t](...e);
}, F = {
  debug: (...t) => Se("debug", ...t),
  info: (...t) => Se("info", ...t),
  log: (...t) => Se("log", ...t),
  warn: (...t) => Se("warn", ...t),
  error: (...t) => Se("error", ...t)
};
function Bn() {
  const t = _n().total, e = nr.cpus()[0].model, o = Math.floor(H.totalmem() / 1024);
  return {
    totalStorage: t,
    cpuModel: e,
    totalMemoryGB: o
  };
}
function _n() {
  const t = sn.statfsSync(process.platform === "win32" ? "C:" : "/"), e = t.blocks * t.bsize, o = t.bfree * t.bsize;
  return {
    total: Math.floor(e / 1e9),
    // 换算为 GB
    usage: 1 - o / e
    // 使用率计算
  };
}
function Cn(t) {
  t.handle("sys:get-static-data", Bn);
}
const xn = 10 * 1024 * 1024 * 1024, Dn = "10GB", Pn = `上传失败：单文件最大支持 ${Dn}`;
function dr(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Un(t) {
  return encodeURIComponent(t).replace(
    /['()*]/g,
    (e) => `%${e.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function On(t) {
  const e = dr(t), o = Un(t);
  return `Content-Disposition: form-data; name="file"; filename="${e}"; filename*=UTF-8''${o}\r
`;
}
function Ln(t) {
  const e = /* @__PURE__ */ new Map(), o = (a, d = !1) => {
    const l = Date.now();
    if (!d && l - a.lastProgressAt < 80) return;
    a.lastProgressAt = l;
    const y = Math.max(l - a.startedAt, 1), R = Math.floor(a.uploadedBytes * 1e3 / y), _ = a.totalBytes > 0 ? Math.min(a.uploadedBytes / a.totalBytes * 100, 100) : 0;
    a.sender.send("http:upload:progress", {
      uploadId: a.uploadId,
      uploadedBytes: a.uploadedBytes,
      totalBytes: a.totalBytes,
      percentage: _,
      speedBps: R
    });
  };
  t.handle("http:fetch", async (a, d, l = {}) => (F.debug("http:fetch start"), F.debug("http:fetch URL:", d), F.debug("http:fetch options:", l), new Promise((y, R) => {
    const _ = qr.request({ url: d, method: l.method || "GET" });
    l.headers && Object.entries(l.headers).forEach(([v, w]) => {
      F.debug(`http:fetch set header ${v}: ${String(w)}`), _.setHeader(v, w);
    });
    let h = "";
    _.on("response", (v) => {
      F.debug("http:fetch response"), F.debug("http:fetch status:", v.statusCode), F.debug("http:fetch headers:", v.headers), v.on("data", (w) => {
        F.debug(`http:fetch chunk length: ${w.length}`), h += w;
      }), v.on("end", () => {
        F.debug("http:fetch body preview:", h.slice(0, 500));
        let w;
        try {
          w = JSON.parse(h);
        } catch {
          w = h;
        }
        y({
          status: v.statusCode,
          headers: v.headers,
          body: w
        });
      });
    }), _.on("error", (v) => {
      F.error("http:fetch error:", v), R(v);
    }), l.body && _.write(l.body), _.end();
  }))), t.handle("http:upload:abort", async (a, d) => {
    const l = e.get(d);
    if (!l) return !1;
    l.aborted = !0, e.delete(d);
    try {
      l.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      l.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), t.handle("http:upload", async (a, d, l, y = {}, R = {}, _) => new Promise((h, v) => {
    let w;
    try {
      w = ot.statSync(l);
    } catch (f) {
      v(new Error(`读取上传文件失败: ${l} (${String(f)})`));
      return;
    }
    if (!w.isFile()) {
      v(new Error(`上传目标不是文件: ${l}`));
      return;
    }
    if (w.size > xn) {
      v(new Error(Pn));
      return;
    }
    const b = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), B = _ || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, A = T.basename(l), L = Object.entries(y).map(([f, p]) => `--${b}\r
Content-Disposition: form-data; name="${dr(f)}"\r
\r
${p}\r
`).join(""), z = `--${b}\r
` + On(A) + `Content-Type: application/octet-stream\r
\r
`, V = `\r
--${b}--\r
`, K = Buffer.byteLength(L) + Buffer.byteLength(z) + w.size + Buffer.byteLength(V), de = {
      ...R,
      "Content-Type": `multipart/form-data; boundary=${b}`,
      "Content-Length": String(K)
    }, q = new URL(d), X = (q.protocol === "https:" ? rr : tr).request({
      protocol: q.protocol,
      hostname: q.hostname,
      port: q.port ? Number(q.port) : void 0,
      path: `${q.pathname}${q.search}`,
      method: "POST",
      headers: de
    }), Y = ot.createReadStream(l, {
      highWaterMark: 1024 * 1024
    }), j = {
      uploadId: B,
      request: X,
      fileStream: Y,
      sender: a.sender,
      totalBytes: Math.max(0, w.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    e.set(B, j);
    let se = !1;
    const c = (f) => {
      se || (se = !0, e.delete(B), h(f));
    }, s = (f) => {
      se || (se = !0, e.delete(B), v(f));
    };
    let i = "";
    X.on("response", (f) => {
      f.on("data", (p) => {
        i += p.toString();
      }), f.on("end", () => {
        let p;
        try {
          p = JSON.parse(i);
        } catch {
          p = i;
        }
        c({
          status: f.statusCode,
          body: p
        });
      });
    }), X.on("error", (f) => {
      if (j.aborted) {
        s(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        Y.destroy(f);
      } catch {
      }
      s(f);
    }), X.write(L), X.write(z), Y.on("data", (f) => {
      j.aborted || (j.uploadedBytes += f.length, o(j));
    }), Y.on("end", () => {
      j.aborted || (o(j, !0), X.write(V), X.end());
    }), Y.on("error", (f) => {
      if (j.aborted) {
        s(new Error("UPLOAD_ABORTED"));
        return;
      }
      s(f);
      try {
        X.destroy(f);
      } catch {
      }
    }), Y.pipe(X, { end: !1 });
  }));
}
function Mn() {
  Tn(O), Cn(O), Ln(O);
}
const Be = "persist:omniflow-embedded-browser", An = "embedded-browser-downloads";
let tt = null, It = !1;
function ur() {
  return T.join($.getPath("userData"), An);
}
function $n() {
  const t = ur();
  return Ke(t) || ct(t, { recursive: !0 }), t;
}
function kn() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function Fn(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function Ae(t, e) {
  var o, a;
  return {
    downloadId: e.downloadId,
    fileName: e.fileName,
    mimeType: e.mimeType,
    pageUrl: e.pageUrl,
    receivedBytes: e.receivedBytes ?? Math.max(0, Number(((o = t.getReceivedBytes) == null ? void 0 : o.call(t)) || 0)),
    state: e.state,
    tabId: e.tabId,
    tempPath: e.tempPath,
    totalBytes: e.totalBytes ?? Math.max(0, Number(((a = t.getTotalBytes) == null ? void 0 : a.call(t)) || 0)),
    url: e.url,
    ...e.error ? { error: e.error } : {}
  };
}
function Nn() {
  return tt || (tt = _e.fromPartition(Be)), tt;
}
async function lr(t) {
  const e = T.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const o = T.resolve(ur());
  return e !== o && !e.startsWith(`${o}${T.sep}`) ? !1 : (await He.rm(e, { force: !0 }), !0);
}
function Wn(t) {
  if (It)
    return;
  It = !0;
  const e = (d, l, y) => {
    const R = t.resolveTabIdByWebContents(y) || void 0;
    if (!R)
      return;
    const _ = $n(), h = kn(), v = l.getFilename() || "download", w = l.getURL() || "", b = y.getURL() || void 0, B = T.join(_, Fn(v));
    l.setSavePath(B), t.emitDownload(Ae(l, {
      downloadId: h,
      fileName: v,
      mimeType: l.getMimeType() || void 0,
      pageUrl: b,
      state: "started",
      tabId: R,
      tempPath: B,
      url: w
    })), l.on("updated", (A, L) => {
      L === "progressing" && t.emitDownload(Ae(l, {
        downloadId: h,
        fileName: v,
        mimeType: l.getMimeType() || void 0,
        pageUrl: b,
        state: "progress",
        tabId: R,
        tempPath: B,
        url: w
      }));
    }), l.once("done", (A, L) => {
      if (L === "completed") {
        t.emitDownload(Ae(l, {
          downloadId: h,
          fileName: v,
          mimeType: l.getMimeType() || void 0,
          pageUrl: b,
          state: "completed",
          tabId: R,
          tempPath: B,
          url: w
        }));
        return;
      }
      lr(B).catch(() => {
      }), t.emitDownload(Ae(l, {
        downloadId: h,
        error: L === "cancelled" ? "下载已取消" : `下载失败：${L}`,
        fileName: v,
        mimeType: l.getMimeType() || void 0,
        pageUrl: b,
        state: L === "cancelled" ? "cancelled" : "failed",
        tabId: R,
        tempPath: B,
        url: w
      }));
    });
  }, o = /* @__PURE__ */ new Set();
  [_e.defaultSession, Nn()].filter(Boolean).forEach((d) => {
    o.has(d) || (o.add(d), d.on("will-download", e));
  });
}
function In(t, e) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(t)}] === 'function'
        ? probe[${JSON.stringify(t)}]
        : null
      return handler ? Boolean(handler(${JSON.stringify(e)})) : false
    })()
  `;
}
function zn(t) {
  return `
    (() => {
      const preview = ${JSON.stringify(t)}
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
function Hn(t) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.readResource === 'function'
        ? probe.readResource
        : null
      return handler ? handler(${JSON.stringify(t)}) : null
    })()
  `;
}
async function zt(t, e, o) {
  const a = String(o || "").trim();
  return a ? !!await t(
    In(e, a)
  ) : !1;
}
async function jn(t, e) {
  return String(e.url || "").trim() ? !!await t(
    zn(e)
  ) : !1;
}
async function Ht(t, e) {
  const o = String(e || "").trim();
  if (!o)
    return null;
  const a = await t(
    Hn(o)
  );
  if (!a || typeof a != "object")
    return null;
  const d = a;
  return typeof d.base64 != "string" || typeof d.fileName != "string" ? null : {
    base64: d.base64,
    fileName: d.fileName,
    mimeType: typeof d.mimeType == "string" ? d.mimeType : void 0,
    resourceKey: typeof d.resourceKey == "string" ? d.resourceKey : o,
    streamType: d.streamType === "audio" || d.streamType === "video" ? d.streamType : void 0
  };
}
const it = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function Vn() {
  return `(${fr.toString()})(${JSON.stringify(it)});`;
}
function fr(t) {
  var Mt, At, $t, kt, Ft;
  const e = globalThis, o = typeof document > "u" && typeof e.importScripts == "function", a = typeof ((Mt = e.location) == null ? void 0 : Mt.href) == "string" ? e.location.href : "", d = typeof ((At = e.location) == null ? void 0 : At.hostname) == "string" ? e.location.hostname : "resource", l = typeof (($t = e.location) == null ? void 0 : $t.protocol) == "string" ? e.location.protocol : "https:", y = typeof document < "u" && typeof document.title == "string" ? document.title : "", R = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__", _ = typeof e.open == "function" ? e.open.bind(e) : null;
  if (e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)
    return "already-installed";
  const h = /* @__PURE__ */ new Set(), v = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new Map(), b = /* @__PURE__ */ new Map(), B = /* @__PURE__ */ new WeakMap();
  let A = 0, L = 0;
  const z = /* @__PURE__ */ new Set(["m3u8", "mpd"]), V = /* @__PURE__ */ new Set([
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
  ]), K = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), de = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), q = /^data:(application|video|audio)\//i, pe = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i, X = /(m3u8|mpd)(\?|$)/i, Y = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv)(\?|$)/i, j = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|$)/i, se = /\.(vtt|srt|ass|ssa|ttml)(\?|$)/i, c = /\.pdf(\?|$)/i, s = JSON.parse.bind(JSON), i = typeof console.info == "function" ? console.info.bind(console) : console.log.bind(console);
  let f = "";
  function p(n) {
    if (typeof n != "string")
      return "";
    const r = n.trim();
    if (!r || r.startsWith("data:"))
      return "";
    if (r.startsWith("//"))
      return `${l}${r}`;
    if (r.startsWith("blob:"))
      return r;
    try {
      if (pe.test(r))
        return new URL(r, a).toString();
      if (/^https?:\/\//i.test(r))
        return r;
    } catch {
      return "";
    }
    return "";
  }
  function g(n) {
    try {
      const u = (new URL(n, a).pathname || "").toLowerCase().match(/\.([a-z0-9]+)$/i);
      return (u == null ? void 0 : u[1]) || "";
    } catch {
      const r = n.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      return (r == null ? void 0 : r[1]) || "";
    }
  }
  function E(n, r) {
    var S;
    const u = g(n), m = (S = String(r || "").split(";")[0]) == null ? void 0 : S.trim().toLowerCase();
    return z.has(u) || m.includes("mpegurl") || m.includes("dash+xml") || X.test(n) ? "manifest" : V.has(u) || m.startsWith("video/") || m.startsWith("audio/") || Y.test(n) || n.startsWith("blob:") ? "media" : K.has(u) || m.startsWith("image/") || j.test(n) ? "image" : de.has(u) || m.includes("text/vtt") || se.test(n) ? "subtitle" : u === "pdf" || m === "application/pdf" || c.test(n) ? "document" : "other";
  }
  function P(n, r) {
    var m;
    const u = (m = String(n || "").split(";")[0]) == null ? void 0 : m.trim().toLowerCase();
    return u === "audio/mp4" ? "m4a" : u === "video/mp4" ? "mp4" : u === "audio/mpeg" ? "mp3" : u === "audio/aac" ? "aac" : u.endsWith("/webm") ? "webm" : u.endsWith("/ogg") ? "ogg" : u.endsWith("/wav") ? "wav" : r === "audio" ? "m4a" : "mp4";
  }
  function M(n) {
    return String(n || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "media";
  }
  function I(n) {
    return n instanceof ArrayBuffer ? n.slice(0) : ArrayBuffer.isView(n) ? n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength) : null;
  }
  function D(n) {
    const r = new Uint8Array(n), u = 32768;
    let m = "";
    for (let S = 0; S < r.length; S += u) {
      const x = r.subarray(S, Math.min(S + u, r.length));
      m += String.fromCharCode(...x);
    }
    return btoa(m);
  }
  function Q(n) {
    return D(new TextEncoder().encode(n).buffer);
  }
  function ie(n) {
    const r = atob(n), u = new Uint8Array(r.length);
    for (let m = 0; m < r.length; m += 1)
      u[m] = r.charCodeAt(m);
    return u.buffer;
  }
  function xe(n) {
    const r = String(n || "").trim();
    return r.length === 24 && r.endsWith("==") && /^[A-Za-z0-9+/]+={0,2}$/.test(r);
  }
  function Br(n) {
    return /^[A-Fa-f0-9]{32}$/.test(String(n || "").trim());
  }
  function _r(n) {
    try {
      const u = new URL(n, a).toString().split("/");
      return u.pop(), `${u.join("/")}/`;
    } catch {
      return "";
    }
  }
  function Cr(n, r) {
    return !n || !r ? r : r.split(`
`).map((u) => {
      const m = u.trim();
      if (!m || m.startsWith("#"))
        return m.includes('URI="') ? m.replace(/URI="(.*)"/, (S, x) => p(x) ? `URI="${x}"` : `URI="${n}${x}"`) : u;
      if (p(m))
        return m;
      if (m.startsWith("/"))
        try {
          const S = new URL(n);
          return `${S.protocol}//${S.host}${m}`;
        } catch {
          return `${n}${m.replace(/^\//, "")}`;
        }
      return `${n}${m}`;
    }).join(`
`);
  }
  function xr(n) {
    const r = String(n || "").trim();
    if (!r || !/^[\[{]/.test(r))
      return null;
    try {
      return s(r);
    } catch {
      return null;
    }
  }
  function Dr(n) {
    const r = String(n || "").trim();
    if (!q.test(r))
      return "";
    const u = r.indexOf(",");
    if (u === -1)
      return "";
    const m = r.slice(0, u), S = r.slice(u + 1);
    try {
      return /;base64/i.test(m) ? new TextDecoder().decode(ie(S)) : decodeURIComponent(S);
    } catch {
      return "";
    }
  }
  function gt(n, r = 16) {
    if (n.byteLength <= r || n.byteLength % r !== 0)
      return null;
    const u = new Uint8Array(n), m = u.slice(0, r);
    for (let S = r; S < u.length; S += r)
      for (let x = 0; x < r; x += 1)
        if (u[S + x] !== m[x])
          return null;
    return m.buffer;
  }
  function Pr(n) {
    return n.byteLength === 16 ? n.slice(0) : n.byteLength === 32 ? gt(n, 16) || n.slice(0, 16) : n.byteLength === 128 || n.byteLength === 256 ? gt(n, 16) : null;
  }
  function Ur() {
    return L += 1, `probe-resource:${Date.now()}-${L}`;
  }
  function Or(n, r) {
    const u = n === "key" ? `${y || d || "resource"}-key` : y || d || "resource";
    return `${M(u)}.${r}`;
  }
  function Lr(n) {
    const r = b.get(n.signature);
    if (r) {
      const U = w.get(r);
      if (U)
        return {
          contentLength: U.contentLength,
          fileName: U.fileName,
          resourceKey: r,
          url: U.blobUrl
        };
    }
    const u = new Blob([ie(n.base64)], { type: n.mimeType }), m = Ur(), S = Or(n.kind, n.ext), x = URL.createObjectURL(u);
    return b.set(n.signature, m), w.set(m, {
      base64: n.base64,
      blobUrl: x,
      contentLength: u.size,
      fileName: S,
      mimeType: n.mimeType,
      streamType: n.streamType
    }), {
      contentLength: u.size,
      fileName: S,
      resourceKey: m,
      url: x
    };
  }
  function Ge(n) {
    if (!o || typeof e.postMessage != "function")
      return !1;
    try {
      return e.postMessage({ [R]: n }), !0;
    } catch {
      return !1;
    }
  }
  function be(n, r = !1) {
    if (o && !r) {
      Ge({ payload: n, type: "generated-resource" });
      return;
    }
    const u = Lr(n);
    Pe({
      contentLength: u.contentLength,
      ext: n.ext,
      kind: n.kind,
      mimeType: n.mimeType,
      resourceKey: u.resourceKey,
      resourceType: n.resourceType,
      source: "probe",
      streamType: n.streamType,
      url: u.url
    }, r);
  }
  function ue(n, r = "key") {
    const u = Pr(n);
    if (!u)
      return !1;
    const m = D(u);
    return be({
      base64: m,
      ext: r,
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${m}`
    }), !0;
  }
  function De(n) {
    if (!xe(n))
      return !1;
    try {
      return ie(n).byteLength !== 16 ? !1 : (be({
        base64: n,
        ext: "base64key",
        kind: "key",
        mimeType: "application/octet-stream",
        resourceType: "key",
        signature: `key:${n}`
      }), !0);
    } catch {
      return !1;
    }
  }
  function ht(n) {
    const r = String(n || "").trim().toLowerCase();
    if (!Br(r))
      return !1;
    const u = new Uint8Array(16);
    for (let m = 0; m < 16; m += 1)
      u[m] = Number.parseInt(r.slice(m * 2, m * 2 + 2), 16);
    return be({
      base64: D(u.buffer),
      ext: "key",
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${r}`
    }), !0;
  }
  function Je(n, r, u) {
    const m = r === "m3u8" ? Cr(_r(u || a), n) : n;
    be({
      base64: Q(m),
      ext: r,
      kind: "manifest",
      mimeType: r === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml",
      resourceType: "inline-manifest",
      signature: `${r}:${m}`
    });
  }
  function Mr(n) {
    const r = new Uint8Array(n);
    return r.length > 8 && r[4] === 102 && r[5] === 116 && r[6] === 121 && r[7] === 112;
  }
  function Ar(n) {
    const r = new Uint8Array(n);
    return r.length > 4 && r[0] === 26 && r[1] === 69 && r[2] === 223 && r[3] === 163;
  }
  function wt(n) {
    if (!Array.isArray(n) || n.length <= 1)
      return n;
    let r = -1;
    return n.forEach((u, m) => {
      (Mr(u) || Ar(u)) && (r = m);
    }), r > 0 ? n.slice(r) : n;
  }
  function Pe(n, r = !1) {
    if (n.url) {
      if (n.resourceType !== "mse-stream") {
        const u = `${n.resourceKey || n.source}:${n.resourceType || "unknown"}:${n.url}`;
        if (h.has(u))
          return;
        h.add(u), h.size > 2e3 && (h.clear(), h.add(u));
      }
      if (o && !r) {
        Ge({ payload: n, type: "capture" });
        return;
      }
      try {
        i(t + JSON.stringify({
          capturedAt: Date.now(),
          contentLength: n.contentLength,
          ext: n.ext,
          kind: n.kind || E(n.url, n.mimeType),
          mimeType: n.mimeType,
          pageUrl: a,
          resourceKey: n.resourceKey,
          resourceType: n.resourceType || "probe",
          source: n.source,
          streamType: n.streamType,
          url: n.url
        }));
      } catch {
      }
    }
  }
  function $r(n) {
    const r = n.map((u) => String(u || "").toLowerCase());
    if (r.some((u) => u === "audio" || u.includes("audio")))
      return "audio";
    if (r.some((u) => u === "video" || u.includes("video")))
      return "video";
  }
  function kr(n) {
    return `mse-stream:${n}`;
  }
  function Ze(n) {
    const r = v.get(n);
    r && Pe({
      contentLength: r.totalBytes,
      ext: P(r.mimeType, r.streamType),
      kind: "media",
      mimeType: r.mimeType,
      resourceKey: kr(n),
      resourceType: "mse-stream",
      source: "probe",
      streamType: r.streamType,
      url: r.blobUrl || `mse://capturing/${n}`
    });
  }
  function bt(n) {
    const r = v.get(n);
    if (!r || r.buffers.length === 0)
      return !1;
    r.blobUrl && (URL.revokeObjectURL(r.blobUrl), r.blobUrl = "");
    try {
      const u = wt(r.buffers);
      return r.blobUrl = URL.createObjectURL(new Blob(u, { type: r.mimeType })), Ze(n), !0;
    } catch {
      return !1;
    }
  }
  function vt(n) {
    const r = v.get(n);
    return r ? (r.blobUrl || bt(n), r.blobUrl) : "";
  }
  function St(n) {
    const r = v.get(n);
    if (!r)
      return "media.bin";
    const u = M(y || d || "media"), m = r.streamType ? `-${r.streamType}` : "", S = P(r.mimeType, r.streamType);
    return `${u}${m}.${S}`;
  }
  function Fr(n) {
    const r = String(n || "").replace(/^mse-stream:/, ""), u = vt(r);
    if (!u || typeof document > "u")
      return !1;
    const m = document.createElement("a");
    return m.href = u, m.download = St(r), m.click(), m.remove(), !0;
  }
  function Nr(n) {
    const r = String(n || "").replace(/^mse-stream:/, ""), u = vt(r);
    return !u || !_ ? !1 : (_(u, "_blank", "noopener,noreferrer"), !0);
  }
  async function Wr(n) {
    const r = String(n || "").replace(/^mse-stream:/, ""), u = v.get(r);
    if (!u || u.buffers.length === 0)
      return null;
    try {
      const m = wt(u.buffers), x = await new Blob(m, { type: u.mimeType }).arrayBuffer();
      return {
        base64: D(x),
        fileName: St(r),
        mimeType: u.mimeType,
        resourceKey: n,
        streamType: u.streamType
      };
    } catch {
      return null;
    }
  }
  function Ir(n) {
    const r = w.get(n);
    return !(r != null && r.blobUrl) || !_ ? !1 : (_(r.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function zr(n) {
    const r = w.get(n);
    if (!(r != null && r.blobUrl) || typeof document > "u")
      return !1;
    const u = document.createElement("a");
    return u.href = r.blobUrl, u.download = r.fileName, u.click(), u.remove(), !0;
  }
  function Hr(n) {
    const r = w.get(n);
    return r ? Promise.resolve({
      base64: r.base64,
      fileName: r.fileName,
      mimeType: r.mimeType,
      resourceKey: n,
      streamType: r.streamType
    }) : Promise.resolve(null);
  }
  function jr(n) {
    if (!n || typeof n != "object")
      return !1;
    const r = n[R];
    return !r || typeof r != "object" || !("type" in r) ? !1 : o ? Ge(r) : r.type === "capture" ? (Pe(r.payload, !0), !0) : r.type === "generated-resource" ? (be(r.payload, !0), !0) : !1;
  }
  const Ye = e.Worker;
  typeof Ye == "function" && (e.Worker = new Proxy(Ye, {
    construct(n, r, u) {
      const [m, S] = r, x = () => {
        const re = typeof m == "string" ? m : String(m), ge = p(re) || re;
        if (!ge)
          return "";
        const ae = `;(${fr.toString()})(${JSON.stringify(t)});
`;
        let he = "";
        if ((S == null ? void 0 : S.type) === "module")
          he = `${ae}import ${JSON.stringify(ge)};
`;
        else {
          const le = new XMLHttpRequest();
          if (le.open("GET", ge, !1), le.send(), le.status < 200 || le.status >= 300 || !le.responseText)
            return "";
          he = `${ae}${le.responseText}`;
        }
        return URL.createObjectURL(new Blob([he], { type: "text/javascript" }));
      };
      let U = "";
      try {
        U = x();
      } catch {
        U = "";
      }
      const ee = U ? Reflect.construct(n, [U, S], u) : Reflect.construct(n, r, u);
      return ee.addEventListener("message", (re) => {
        jr(re.data) && re.stopImmediatePropagation();
      }, { capture: !0 }), U && setTimeout(() => {
        URL.revokeObjectURL(U);
      }, 6e4), ee;
    }
  }), e.Worker.toString = function() {
    return Ye.toString();
  });
  const te = e.MediaSource;
  if ((kt = te == null ? void 0 : te.prototype) != null && kt.addSourceBuffer) {
    const n = te.prototype.addSourceBuffer;
    te.prototype.addSourceBuffer = new Proxy(n, {
      apply(r, u, m) {
        var x;
        const S = Reflect.apply(r, u, m);
        try {
          const U = u, ee = String((m == null ? void 0 : m[0]) || "").trim(), re = ((x = ee.split(";")[0]) == null ? void 0 : x.trim().toLowerCase()) || "", ge = re.startsWith("audio/") ? "audio" : re.startsWith("video/") ? "video" : void 0, ae = `${Date.now()}-${++A}`, he = B.get(U) || [];
          if (he.push(ae), B.set(U, he), v.set(ae, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: ee || (ge === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: ae,
            streamType: ge,
            totalBytes: 0
          }), Ze(ae), S && typeof S.appendBuffer == "function") {
            const le = S.appendBuffer;
            S.appendBuffer = new Proxy(le, {
              apply(Vr, Kr, Oe) {
                const et = Reflect.apply(Vr, Kr, Oe), J = v.get(ae);
                if (!J)
                  return et;
                const Le = I(Oe == null ? void 0 : Oe[0]);
                return !Le || Le.byteLength === 0 || (J.buffers.push(Le), J.bufferCount += 1, J.totalBytes += Le.byteLength, (J.bufferCount <= 3 || J.bufferCount - J.lastReportedBufferCount >= 8 || J.totalBytes - J.lastReportedBytes >= 1024 * 512) && (J.lastReportedBufferCount = J.bufferCount, J.lastReportedBytes = J.totalBytes, Ze(ae))), et;
              }
            });
          }
        } catch {
        }
        return S;
      }
    });
  }
  if ((Ft = te == null ? void 0 : te.prototype) != null && Ft.endOfStream) {
    const n = te.prototype.endOfStream;
    te.prototype.endOfStream = new Proxy(n, {
      apply(r, u, m) {
        const S = Reflect.apply(r, u, m);
        try {
          (B.get(u) || []).forEach((U) => {
            bt(U);
          });
        } catch {
        }
        return S;
      }
    });
  }
  function G(n, r) {
    if (typeof n != "string")
      return;
    const u = n.trim();
    if (!u || De(u))
      return;
    const m = u.split("").join("").trim();
    if (ht(m))
      return;
    if (q.test(u)) {
      const ee = Dr(u);
      ee && G(ee, r);
      return;
    }
    const S = xr(u);
    if (S) {
      ve(S);
      return;
    }
    const x = u.toUpperCase();
    if (x.startsWith("#EXTM3U") || x.includes("#EXTINF:")) {
      Je(u, "m3u8", r == null ? void 0 : r.baseUrl);
      return;
    }
    if (u.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || u.includes("<MPD") && u.includes("</MPD>")) {
      Je(u, "mpd", r == null ? void 0 : r.baseUrl);
      return;
    }
    const U = p(u);
    U && Pe({
      kind: E(U, r == null ? void 0 : r.mimeType),
      mimeType: r == null ? void 0 : r.mimeType,
      resourceType: r == null ? void 0 : r.resourceType,
      source: "probe",
      streamType: r == null ? void 0 : r.streamType,
      url: U
    });
  }
  function ve(n, r = 0, u = /* @__PURE__ */ new WeakSet(), m = []) {
    if (r > 6 || n == null)
      return;
    if (n instanceof ArrayBuffer) {
      ue(n);
      return;
    }
    if (ArrayBuffer.isView(n)) {
      ue(n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength));
      return;
    }
    if (typeof n == "string") {
      G(n, {
        baseUrl: a,
        resourceType: "json",
        streamType: $r(m)
      });
      return;
    }
    if (typeof n != "object")
      return;
    const S = n;
    if (!u.has(S)) {
      if (u.add(S), Array.isArray(n)) {
        if (n.length === 16 && n.every((x) => typeof x == "number" && Number.isFinite(x) && x >= 0 && x <= 255)) {
          ue(Uint8Array.from(n).buffer);
          return;
        }
        n.slice(0, 80).forEach((x, U) => {
          ve(x, r + 1, u, m.concat(String(U)));
        });
        return;
      }
      Object.keys(n).slice(0, 80).forEach((x) => {
        ve(n[x], r + 1, u, m.concat(x));
      });
    }
  }
  const Qe = typeof e.fetch == "function" ? e.fetch.bind(e) : null;
  Qe && (e.fetch = async function(n, r) {
    const u = typeof n == "string" ? n : n instanceof Request ? n.url : String(n);
    G(u, { resourceType: "fetch" });
    const m = await Qe(n, r);
    return G(m.url || u, {
      mimeType: m.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), m.clone().arrayBuffer().then((x) => {
      if (!x.byteLength || ue(x))
        return;
      const U = new TextDecoder().decode(x);
      U.trim() && G(U, {
        baseUrl: m.url || u,
        mimeType: m.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), m;
  }, e.fetch.toString = function() {
    return Qe.toString();
  });
  const Et = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", Tt = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(n, r) {
    return this[Et] = typeof r == "string" ? r : String(r), Tt.apply(this, arguments);
  };
  const Rt = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const n = this[Et], r = this.responseURL || (typeof n == "string" ? n : "");
      if (G(r, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (ue(this.response))
          return;
        const u = new TextDecoder().decode(this.response);
        u && G(u, {
          baseUrl: r,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        G(this.response, {
          baseUrl: r,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (this.response && typeof this.response == "object") {
        ve(this.response);
        return;
      }
      typeof this.responseText == "string" && this.responseText.trim() && G(this.responseText, {
        baseUrl: r,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), Rt.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return Tt.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return Rt.toString();
  }, JSON.parse = function() {
    const n = s.apply(this, arguments);
    return ve(n), n;
  }, JSON.parse.toString = function() {
    return s.toString();
  };
  const Bt = btoa;
  e.btoa = function(n) {
    const r = Bt.apply(this, arguments);
    return De(r), G(n, { baseUrl: a, resourceType: "btoa" }), r;
  }, btoa.toString = function() {
    return Bt.toString();
  };
  const _t = atob;
  e.atob = function(n) {
    const r = _t.apply(this, arguments);
    return De(n), G(r, { baseUrl: a, resourceType: "atob" }), r;
  }, atob.toString = function() {
    return _t.toString();
  };
  const Ct = String.fromCharCode;
  String.fromCharCode = new Proxy(Ct, {
    apply(n, r, u) {
      const m = Reflect.apply(n, r, u);
      if (m.length >= 7) {
        if ((m.startsWith("#EXTM3U") || m.includes("#EXTINF:")) && (f += m, f.includes("#EXT-X-ENDLIST"))) {
          const x = f.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          Je(x, "m3u8", a), f = "";
        }
        const S = m.split("").join("").trim();
        ht(S);
      }
      return m;
    }
  }), String.fromCharCode.toString = function() {
    return Ct.toString();
  };
  const xt = Array.prototype.slice;
  Array.prototype.slice = function() {
    const n = xt.apply(this, arguments);
    return Array.isArray(n) && n.length === 16 && n.every((r) => typeof r == "number" && Number.isFinite(r) && r >= 0 && r <= 255) && ue(Uint8Array.from(n).buffer), n;
  }, Array.prototype.slice.toString = function() {
    return xt.toString();
  };
  const Dt = Array.prototype.join;
  Array.prototype.join = function() {
    const n = Dt.apply(this, arguments);
    return typeof n == "string" && ((n.startsWith("#EXTM3U") || n.includes("#EXTINF:")) && G(n, { baseUrl: a, resourceType: "array-join" }), De(n)), n;
  }, Array.prototype.join.toString = function() {
    return Dt.toString();
  };
  const Ue = e.DataView;
  if (typeof Ue == "function") {
    const n = function(r, u, m) {
      const S = new Ue(r, u, m), x = () => {
        const U = S.buffer.slice(S.byteOffset, S.byteOffset + S.byteLength);
        ue(U);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((U) => {
        const ee = S[U];
        typeof ee == "function" && (S[U] = function() {
          const re = ee.apply(this, arguments);
          return x(), re;
        });
      }), x(), S;
    };
    n.prototype = Ue.prototype, n.toString = function() {
      return Ue.toString();
    }, e.DataView = n;
  }
  function Pt(n) {
    return function() {
      const r = n.apply(this, arguments);
      return (r == null ? void 0 : r.byteLength) === 16 && ue(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength)), r;
    };
  }
  const Ut = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = Pt(Ut), Int8Array.prototype.subarray.toString = function() {
    return Ut.toString();
  };
  const Ot = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = Pt(Ot), Uint8Array.prototype.subarray.toString = function() {
    return Ot.toString();
  };
  const Lt = String.prototype.indexOf;
  return String.prototype.indexOf = function(n, r) {
    const u = Lt.apply(this, arguments);
    if (n === "#EXTM3U" && u !== -1) {
      const m = String(this);
      G(m.slice(Math.max(r ?? 0, 0)), {
        baseUrl: a,
        resourceType: "string-indexof"
      });
    }
    return u;
  }, String.prototype.indexOf.toString = function() {
    return Lt.toString();
  }, e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    exportResource(n) {
      const r = String(n || "");
      return r.startsWith("mse-stream:") ? Fr(r) : r.startsWith("probe-resource:") ? zr(r) : !1;
    },
    installedAt: Date.now(),
    openResource(n) {
      const r = String(n || "");
      return r.startsWith("mse-stream:") ? Nr(r) : r.startsWith("probe-resource:") ? Ir(r) : !1;
    },
    readResource(n) {
      const r = String(n || "");
      return r.startsWith("mse-stream:") ? Wr(r) : r.startsWith("probe-resource:") ? Hr(r) : Promise.resolve(null);
    },
    seen: h
  }, "installed";
}
const Kn = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((t) => !!t);
function at(t) {
  return String(t || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function qn(t) {
  if (!t || t === "ffmpeg")
    return !1;
  try {
    return await on(t, Yr.X_OK), !0;
  } catch {
    return !1;
  }
}
async function Xn(t) {
  return new Promise((e) => {
    const o = or(t, ["-version"], {
      stdio: "ignore"
    });
    o.once("error", () => e(!1)), o.once("exit", (a) => e(a === 0));
  });
}
async function Gn(t) {
  const e = [
    String(t || "").trim() || void 0,
    ...Kn
  ].filter((o, a, d) => !!o && d.indexOf(o) === a);
  for (const o of e) {
    if (o === "ffmpeg") {
      if (await Xn(o))
        return o;
      continue;
    }
    if (await qn(o))
      return o;
  }
  return null;
}
function Jn(t) {
  return [
    "-y",
    "-i",
    t.videoPath,
    "-i",
    t.audioPath,
    "-c",
    "copy",
    t.outputPath
  ];
}
function Zn(t, e) {
  const o = at(T.parse(t).name), a = at(T.parse(e).name);
  return `${o.replace(/-video$/i, "").replace(/_video$/i, "") || a.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function Yn() {
  return tn(T.join(an.tmpdir(), "omniflow-resource-merge-"));
}
async function Qn(t) {
  t && await nn(t, {
    force: !0,
    recursive: !0
  });
}
async function jt(t, e) {
  const o = T.join(t, at(e.fileName));
  return await rn(o, er.from(e.base64, "base64")), o;
}
async function eo(t) {
  const e = await Gn(t.ffmpegPath);
  if (!e)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const o = await Yn();
  try {
    const [a, d] = await Promise.all([
      jt(o, t.audio),
      jt(o, t.video)
    ]), l = Jn({
      audioPath: a,
      outputPath: t.outputPath,
      videoPath: d
    });
    return await new Promise((R, _) => {
      const h = [], v = [], w = or(e, l, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      w.stdout.on("data", (b) => {
        h.push(String(b));
      }), w.stderr.on("data", (b) => {
        v.push(String(b));
      }), w.once("error", (b) => {
        _(b);
      }), w.once("exit", (b) => {
        if (b === 0) {
          R({
            commandArgs: l,
            ffmpegPath: e,
            outputPath: t.outputPath,
            stderr: v.join(""),
            stdout: h.join("")
          });
          return;
        }
        _(new Error(v.join("").trim() || `ffmpeg 退出码异常: ${b}`));
      });
    });
  } finally {
    await Qn(o).catch(() => {
    });
  }
}
const to = /* @__PURE__ */ new Set(["m3u8", "mpd"]), ro = /* @__PURE__ */ new Set([
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
]), no = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), oo = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), so = /* @__PURE__ */ new Set(["key", "base64key"]), io = /* @__PURE__ */ new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
]), je = /* @__PURE__ */ new Map(), fe = /* @__PURE__ */ new Map();
let Vt = !1, ze = null;
function we() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function qe(t) {
  const e = String(t || "").trim();
  if (!e)
    return null;
  const o = je.get(e);
  if (o)
    return o;
  const a = we();
  return je.set(e, a), a;
}
function Ce(t) {
  const e = String(t || "").trim();
  return e && je.get(e) || null;
}
function rt(t, e) {
  if (!t)
    return "";
  const o = e.toLowerCase();
  for (const [a, d] of Object.entries(t))
    if (a.toLowerCase() === o)
      return Array.isArray(d) ? String(d[0] || "") : String(d || "");
  return "";
}
function Xe(t) {
  var e;
  return ((e = String(t || "").split(";")[0]) == null ? void 0 : e.trim().toLowerCase()) || "";
}
function ft(t) {
  try {
    const o = new URL(t).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (o == null ? void 0 : o[1]) || "";
  } catch {
    const e = String(t || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (e == null ? void 0 : e[1]) || "";
  }
}
function mr(t) {
  const e = Xe(t.mimeType), o = ft(t.url);
  return to.has(o) || e.includes("mpegurl") || e.includes("dash+xml") ? "manifest" : ro.has(o) || e.startsWith("video/") || e.startsWith("audio/") || t.resourceType === "media" || String(t.url || "").startsWith("blob:") ? "media" : no.has(o) || e.startsWith("image/") ? "image" : oo.has(o) || e.includes("text/vtt") ? "subtitle" : o === "pdf" || e === "application/pdf" ? "document" : so.has(o) || t.resourceType === "key" || e === "application/octet-stream" ? "key" : "other";
}
function pr(t) {
  return !t.url || t.url.startsWith("data:") ? !1 : t.kind !== "other" ? !0 : t.resourceType === "media" || t.url.startsWith("blob:");
}
function yr(t, e, o, a) {
  return a ? `${t}::${e}::${a}` : `${t}::${e}::${o}`;
}
function ao(t, e, o, a) {
  return yr(t, e, o, a);
}
function co(t) {
  return Array.from(t.values()).sort((e, o) => o.capturedAt - e.capturedAt);
}
function oe(t) {
  return {
    deepCaptureEnabled: t.deepCaptureEnabled,
    enabled: t.enabled,
    resources: co(t.resources)
  };
}
function gr(t, e) {
  const o = Ce(t);
  if (!(o != null && o.enabled))
    return null;
  const a = String(e.url || "").trim();
  if (!a)
    return null;
  const d = String(e.resourceKey || "").trim() || void 0, l = yr(t, e.source, a, d), y = o.resources.get(l), R = {
    ...y,
    ...e,
    ext: e.ext || (y == null ? void 0 : y.ext) || ft(a) || void 0,
    id: ao(t, e.source, a, d),
    kind: e.kind,
    resourceKey: d,
    tabId: t,
    url: a
  };
  return JSON.stringify(y) !== JSON.stringify(R) ? (o.resources.set(l, R), ze == null || ze(R), R) : y || null;
}
function uo(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? e : void 0;
}
function lo(t) {
  const e = String(t || "").trim();
  if (!e)
    return;
  const o = e.match(/\/(\d+)\s*$/);
  if (!(o != null && o[1]))
    return;
  const a = Number(o[1]);
  return Number.isFinite(a) && a > 0 ? a : void 0;
}
function hr(t) {
  if (t.streamType)
    return t.streamType;
  const e = Xe(t.mimeType);
  if (e.startsWith("audio/"))
    return "audio";
  if (e.startsWith("video/"))
    return "video";
  const o = String(t.url || "").toLowerCase();
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(o))
    return "audio";
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(o) || t.resourceType === "media")
    return "video";
}
function fo(t) {
  if (!t)
    return;
  const e = {};
  return Object.entries(t).forEach(([o, a]) => {
    const d = o.toLowerCase();
    if (!io.has(d))
      return;
    const l = String(a || "").trim();
    l && (e[d] = l);
  }), Object.keys(e).length ? e : void 0;
}
function mo(t) {
  const e = Ce(t);
  return oe(e || we());
}
function po(t) {
  const e = qe(t);
  return e ? (e.enabled = !0, oe(e)) : oe(we());
}
function yo(t) {
  const e = qe(t);
  return e ? (e.enabled = !0, e.deepCaptureEnabled = !0, oe(e)) : oe(we());
}
function go(t) {
  const e = qe(t);
  return e ? (e.enabled = !1, e.deepCaptureEnabled = !1, oe(e)) : oe(we());
}
function ho(t) {
  const e = qe(t);
  return e ? (e.resources.clear(), oe(e)) : oe(we());
}
function Kt(t) {
  je.delete(String(t || "").trim());
}
function wo(t) {
  var e;
  return !!((e = Ce(t)) != null && e.deepCaptureEnabled);
}
function bo(t, e) {
  const o = Ce(t);
  if (!(o != null && o.enabled) || !o.deepCaptureEnabled)
    return null;
  const a = String(e.url || "").trim();
  if (!a)
    return null;
  const d = e.kind || mr({
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    url: a
  });
  return pr({ kind: d, resourceType: e.resourceType, url: a }) ? gr(t, {
    capturedAt: Number(e.capturedAt) || Date.now(),
    contentLength: e.contentLength,
    ext: e.ext,
    kind: d,
    method: e.method,
    mimeType: Xe(e.mimeType),
    pageUrl: e.pageUrl,
    resourceType: e.resourceType,
    resourceKey: e.resourceKey,
    source: e.source || "probe",
    statusCode: e.statusCode,
    streamType: hr({
      mimeType: e.mimeType,
      resourceType: e.resourceType,
      streamType: e.streamType,
      url: a
    }),
    url: a
  }) : null;
}
function vo(t) {
  Vt || (Vt = !0, ze = t.emitResource, t.browserSession.webRequest.onBeforeSendHeaders((e, o) => {
    fe.set(e.id, {
      referer: e.referrer || void 0,
      requestHeaders: fo(e.requestHeaders)
    }), o({ cancel: !1, requestHeaders: e.requestHeaders });
  }), t.browserSession.webRequest.onCompleted((e) => {
    if (!e.webContentsId) {
      fe.delete(e.id);
      return;
    }
    const o = t.resolveTabIdByWebContentsId(e.webContentsId), a = o ? Ce(o) : null;
    if (!o || !(a != null && a.enabled)) {
      fe.delete(e.id);
      return;
    }
    if (e.statusCode < 200 || e.statusCode >= 400) {
      fe.delete(e.id);
      return;
    }
    const d = Xr.fromId(e.webContentsId), l = String(e.url || "").trim(), y = fe.get(e.id), R = Xe(rt(e.responseHeaders, "content-type")), _ = mr({
      mimeType: R,
      resourceType: e.resourceType,
      url: l
    });
    if (!pr({ kind: _, resourceType: e.resourceType, url: l })) {
      fe.delete(e.id);
      return;
    }
    gr(o, {
      capturedAt: Date.now(),
      contentLength: lo(rt(e.responseHeaders, "content-range")) || uo(rt(e.responseHeaders, "content-length")),
      ext: ft(l) || void 0,
      kind: _,
      method: e.method || void 0,
      mimeType: R,
      pageUrl: (d == null ? void 0 : d.getURL()) || void 0,
      referer: (y == null ? void 0 : y.referer) || e.referrer || void 0,
      requestHeaders: y == null ? void 0 : y.requestHeaders,
      resourceType: e.resourceType || void 0,
      source: "network",
      statusCode: e.statusCode || void 0,
      streamType: hr({
        mimeType: R,
        resourceType: e.resourceType,
        url: l
      }),
      url: l
    }), fe.delete(e.id);
  }), t.browserSession.webRequest.onErrorOccurred((e) => {
    fe.delete(e.id);
  }));
}
const So = "embedded-browser-open-files", qt = 'input[data-omniflow-browser-open-fallback="true"]';
function wr() {
  return T.join($.getPath("userData"), So);
}
function Eo() {
  const t = wr();
  return Ke(t) || ct(t, { recursive: !0 }), t;
}
function To(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function Ro(t, e) {
  const o = T.resolve(t), a = T.resolve(e);
  return o === a ? !0 : o.startsWith(`${a}${T.sep}`);
}
async function Bo(t) {
  const e = await t.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${qt}') 
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
      return '${qt}'
    })()
  `, !0);
  return typeof e == "string" && e.trim() ? e.trim() : null;
}
async function _o(t, e, o) {
  var R;
  if (!e || o.length === 0)
    return !1;
  try {
    t.webContents.debugger.isAttached() || t.webContents.debugger.attach("1.3");
  } catch (_) {
    if (!String(_).includes("Already attached"))
      throw _;
  }
  const a = await t.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), d = Number(((R = a == null ? void 0 : a.root) == null ? void 0 : R.nodeId) || 0);
  if (!Number.isFinite(d) || d <= 0)
    return !1;
  const l = await t.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: d,
    selector: e
  }), y = Number((l == null ? void 0 : l.nodeId) || 0);
  return !Number.isFinite(y) || y <= 0 ? !1 : (await t.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: y,
    files: o
  }), !0);
}
async function Co(t, e) {
  const o = await t.webContents.executeJavaScript(`
    (() => {
      const inputSelector = ${JSON.stringify(e)}
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
async function xo(t, e, o = {}) {
  const a = Eo(), d = T.join(a, To(e));
  return await ut(t, d, o), d;
}
async function $e(t) {
  const e = T.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const o = T.resolve(wr());
  return Ro(e, o) ? (await He.rm(e, { force: !0 }), !0) : !1;
}
async function Do(t, e) {
  if (!t || t.webContents.isDestroyed())
    return !1;
  const o = await Bo(t);
  return !o || !await _o(t, o, [e]) ? !1 : Co(t, o);
}
const Po = T.dirname(Zr(import.meta.url));
process.env.APP_ROOT = T.join(Po, "..");
const Ve = process.env.VITE_DEV_SERVER_URL, Uo = T.join(process.env.APP_ROOT, "dist-electron"), br = T.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Ve ? T.join(process.env.APP_ROOT, "public") : br;
const Xt = T.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Oo = "Omniflow", Lo = "omniflow-app", Mo = 1400, Ao = 920, mt = 600, pt = 400, $o = "window-state.json", ko = 200, Gt = process.env.NODE_ENV === "test" || !!(Ve || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Fo = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
Fo || ($.commandLine.appendSwitch("disable-logging"), $.commandLine.appendSwitch("log-level", "3"));
$.setName(Oo);
try {
  const t = T.join($.getPath("appData"), Lo);
  $.setPath("userData", t);
} catch {
}
function vr() {
  return Ke(Xt) ? Xt : null;
}
let C = null, Jt = !1, Sr = !1;
const No = 240;
let ke = null;
const ye = /* @__PURE__ */ new Map(), k = /* @__PURE__ */ new Map(), Fe = /* @__PURE__ */ new Map(), Ne = /* @__PURE__ */ new Map(), Ee = /* @__PURE__ */ new Map(), We = /* @__PURE__ */ new Map(), nt = /* @__PURE__ */ new Map();
let Z = null, Zt = null, Yt = !1;
const Qt = /* @__PURE__ */ new Map();
function Wo(t) {
  !C || C.isDestroyed() || C.webContents.send("embedded-browser:download", t);
}
function Io(t) {
  for (const [e, o] of ye.entries())
    if (o.webContents === t)
      return e;
  return null;
}
function zo(t) {
  for (const [e, o] of ye.entries())
    if (o.webContents.id === t)
      return e;
  return null;
}
function Ho(t) {
  !C || C.isDestroyed() || C.webContents.send("embedded-browser:resource", t);
}
function Er() {
  return T.join($.getPath("userData"), $o);
}
function me(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function jo(t, e) {
  return t >= mt && e >= pt;
}
function Vo(t) {
  return Gr.getAllDisplays().some((o) => {
    const a = o.workArea;
    return t.x < a.x + a.width && t.x + t.width > a.x && t.y < a.y + a.height && t.y + t.height > a.y;
  });
}
function Ko() {
  try {
    const t = Er();
    if (!Ke(t))
      return null;
    const e = Qr(t, "utf-8"), o = JSON.parse(e);
    if (!me(o.width) || !me(o.height) || !jo(o.width, o.height))
      return null;
    const a = !!o.maximized, d = {
      width: o.width,
      height: o.height,
      maximized: a
    };
    return me(o.x) && me(o.y) && (d.x = o.x, d.y = o.y), me(d.x) && me(d.y) && (Vo({
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height
    }) || (delete d.x, delete d.y)), d;
  } catch {
    return null;
  }
}
function yt(t) {
  if (!t.isDestroyed())
    try {
      const e = t.isMaximized() ? t.getNormalBounds() : t.getBounds(), o = {
        x: e.x,
        y: e.y,
        width: Math.max(Math.round(e.width), mt),
        height: Math.max(Math.round(e.height), pt),
        maximized: t.isMaximized()
      }, a = Er();
      ct(T.dirname(a), { recursive: !0 }), en(a, JSON.stringify(o), "utf-8");
    } catch {
    }
}
function Ie(t) {
  ke && clearTimeout(ke), ke = setTimeout(() => {
    ke = null, yt(t);
  }, ko);
}
function qo(t) {
  if (t.type !== "keyDown")
    return !1;
  const e = (t.key || "").toLowerCase();
  return (t.meta || t.control) && t.shift && e === "i";
}
function Xo(t) {
  if (t.type !== "keyDown" || !(t.meta || t.control))
    return !1;
  const e = (t.key || "").toLowerCase();
  return e === "+" || e === "=" || e === "-" || e === "_" || e === "0";
}
function Tr(t) {
  const e = String(t || "").trim();
  if (!e)
    return "";
  try {
    return new URL(e).origin;
  } catch {
    return "";
  }
}
function Go(t) {
  return t === "fileSystem";
}
async function Jo(t) {
  const e = Tr(t);
  if (!e)
    return !1;
  const o = Qt.get(e);
  if (typeof o == "boolean")
    return o;
  const a = W.getFocusedWindow() ?? C ?? W.getAllWindows()[0] ?? void 0, { response: d } = await ne.showMessageBox(a, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${e} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), l = d === 1;
  return Qt.set(e, l), l;
}
async function Zo(t) {
  const e = Tr(t.origin);
  if (!e)
    return "deny";
  const o = W.getFocusedWindow() ?? C ?? W.getAllWindows()[0] ?? void 0, { response: a } = await ne.showMessageBox(o, {
    type: "question",
    buttons: ["换个目录", "允许这次访问", "拒绝"],
    defaultId: 0,
    cancelId: 2,
    title: "网页请求访问受限路径",
    message: `${e} 想要访问受限路径。`,
    detail: String(t.path || ""),
    noLink: !0
  });
  return a === 0 ? "tryAgain" : a === 1 ? "allow" : "deny";
}
function Yo() {
  if (Yt)
    return;
  Yt = !0;
  const t = _e.fromPartition(Be);
  t.setPermissionRequestHandler((e, o, a, d) => {
    if (!Go(String(o))) {
      a(!1);
      return;
    }
    Jo(d.requestingUrl || "").then((l) => {
      a(l);
    }).catch(() => {
      a(!1);
    });
  }), t.on("file-system-access-restricted", (e, o, a) => {
    e.preventDefault(), Zo(o).then((d) => {
      a(d);
    }).catch(() => {
      a("deny");
    });
  });
}
function Qo() {
  if (Jt)
    return;
  Jt = !0, O.on("window-minimize", (c) => {
    const s = W.fromWebContents(c.sender) ?? C;
    s == null || s.minimize();
  }), O.on("window-maximize", (c) => {
    const s = W.fromWebContents(c.sender) ?? C;
    !s || s.isDestroyed() || (s.isMaximized() ? s.unmaximize() : s.maximize());
  }), O.on("window-close", (c) => {
    const s = W.fromWebContents(c.sender) ?? C;
    s == null || s.close();
  }), O.handle("window-activate", (c, s = !1) => {
    const i = W.fromWebContents(c.sender) ?? C;
    return !i || i.isDestroyed() ? !1 : (i.isMinimized() && i.restore(), i.isVisible() || i.show(), process.platform === "darwin" ? $.focus({ steal: !0 }) : $.focus(), typeof i.moveTop == "function" && i.moveTop(), i.focus(), s && !i.isAlwaysOnTop() && (i.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      i.isDestroyed() || i.setAlwaysOnTop(!1);
    }, No)), !0);
  });
  const t = (c) => {
    F.log("[embedded-browser:main]", c), !(!C || C.isDestroyed()) && C.webContents.send("embedded-browser:state", c);
  }, e = async (c) => {
    if (!Gt || c.webContents.isDestroyed())
      return [];
    try {
      const s = await c.webContents.executeJavaScript(`
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
      `, !0), i = [];
      return s != null && s.title && i.push(`title=${s.title}`), s != null && s.readyState && i.push(`readyState=${s.readyState}`), typeof (s == null ? void 0 : s.bodyHtmlLength) == "number" && i.push(`bodyHtml=${s.bodyHtmlLength}`), typeof (s == null ? void 0 : s.innerWidth) == "number" && typeof (s == null ? void 0 : s.innerHeight) == "number" && i.push(`viewport=${s.innerWidth}x${s.innerHeight}`), typeof (s == null ? void 0 : s.clientWidth) == "number" && typeof (s == null ? void 0 : s.clientHeight) == "number" && i.push(`client=${s.clientWidth}x${s.clientHeight}`), typeof (s == null ? void 0 : s.devicePixelRatio) == "number" && i.push(`dpr=${s.devicePixelRatio}`), s != null && s.bodyTextPreview && i.push(`preview=${s.bodyTextPreview}`), s != null && s.userAgent && i.push(`ua=${s.userAgent}`), i;
    } catch (s) {
      return [`inspect=${s instanceof Error ? s.message : String(s)}`];
    }
  }, o = (c) => {
    const s = c.webContents.getTitle().trim();
    if (s)
      return s;
  }, a = (c, s) => {
    const i = c.trim();
    if (!i)
      return "";
    if (i.startsWith("data:"))
      return i;
    try {
      return new URL(i, s || void 0).toString();
    } catch {
      return i;
    }
  }, d = (c, s) => {
    var p;
    const i = (p = String(s || "").split(";")[0]) == null ? void 0 : p.trim();
    if (i != null && i.startsWith("image/"))
      return i;
    const f = (() => {
      try {
        return new URL(c).pathname.toLowerCase();
      } catch {
        return c.toLowerCase();
      }
    })();
    return f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".ico") ? "image/x-icon" : f.endsWith(".webp") ? "image/webp" : f.endsWith(".jpg") || f.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  }, l = async (c, s) => {
    if (!s || s.startsWith("data:"))
      return s;
    try {
      const i = await c.fetch(s);
      if (!i.ok)
        return "";
      const f = er.from(await i.arrayBuffer());
      return f.length === 0 ? "" : `data:${d(s, i.headers.get("content-type"))};base64,${f.toString("base64")}`;
    } catch (i) {
      return F.warn("embedded browser favicon load failed", {
        error: i instanceof Error ? i.message : String(i),
        iconUrl: s
      }), "";
    }
  }, y = async (c, s) => l(c.webContents.session, s), R = (c, s) => {
    const i = [], f = /<link\b[^>]*>/gi, p = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let g;
    for (; g = f.exec(c); ) {
      const E = g[0], P = /* @__PURE__ */ new Map();
      let M;
      for (p.lastIndex = 0; M = p.exec(E); )
        P.set(M[1].toLowerCase(), M[2] || M[3] || M[4] || "");
      const I = P.get("rel") || "", D = P.get("href") || "";
      if (!D || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(I))
        continue;
      const Q = a(D, s);
      Q && i.push(Q);
    }
    return i;
  }, _ = async (c) => {
    const s = String((c == null ? void 0 : c.pageUrl) || "").trim(), i = _e.fromPartition(Be), f = [], p = a(String((c == null ? void 0 : c.iconUrl) || ""), s || void 0);
    if (p && !p.startsWith("data:") && f.push(p), s) {
      try {
        const E = await i.fetch(s), P = E.headers.get("content-type") || "";
        E.ok && /text\/html|application\/xhtml\+xml/i.test(P) && f.push(...R(await E.text(), s));
      } catch (E) {
        F.warn("embedded browser favicon page inspect failed", {
          error: E instanceof Error ? E.message : String(E),
          pageUrl: s
        });
      }
      try {
        const E = new URL(s).origin;
        f.push(`${E}/favicon.ico`);
      } catch {
      }
    }
    const g = /* @__PURE__ */ new Set();
    for (const E of f) {
      if (!E || g.has(E))
        continue;
      g.add(E);
      const P = await l(i, E);
      if (P)
        return {
          dataUrl: P,
          iconUrl: E
        };
    }
    return {
      dataUrl: p.startsWith("data:") ? p : "",
      iconUrl: ""
    };
  }, h = (c, s, i) => {
    t({
      canGoBack: s.webContents.canGoBack(),
      canGoForward: s.webContents.canGoForward(),
      iconSourceUrl: i.iconSourceUrl ?? Ne.get(c),
      iconUrl: i.iconUrl ?? Fe.get(c),
      tabId: c,
      title: i.title ?? o(s),
      ...i
    });
  }, v = (c, s, i) => {
    h(c, s, {
      state: "ready",
      url: (i == null ? void 0 : i.url) ?? (k.get(c) || s.webContents.getURL() || void 0),
      ...i
    });
  }, w = (c) => {
    const s = ye.get(c);
    return !s || s.webContents.isDestroyed() ? (ye.delete(c), k.delete(c), Fe.delete(c), Ne.delete(c), Kt(c), null) : s;
  }, b = async (c, s) => {
    if (!wo(c) || s.webContents.isDestroyed())
      return !1;
    try {
      return await s.webContents.executeJavaScript(Vn(), !0), !0;
    } catch (i) {
      return F.warn("embedded browser resource probe install failed", {
        error: i instanceof Error ? i.message : String(i),
        tabId: c,
        url: s.webContents.getURL() || k.get(c) || ""
      }), !1;
    }
  }, B = async (c, s) => {
    const i = String(c || "").trim();
    if (!i)
      return null;
    const f = w(i);
    return !f || f.webContents.isDestroyed() ? null : s((g) => f.webContents.executeJavaScript(g, !0), f);
  }, A = async (c, s) => {
    const i = String(c || "").trim(), f = String(s.audioResourceKey || "").trim(), p = String(s.videoResourceKey || "").trim();
    if (!i || !f || !p)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const g = await B(
        i,
        async (xe) => Promise.all([
          Ht(xe, f),
          Ht(xe, p)
        ])
      ), [E, P] = g || [];
      if (!E || !P)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const M = String(s.suggestedFileName || "").trim() || Zn(P.fileName, E.fileName), I = C && !C.isDestroyed() ? C : void 0, D = {
        defaultPath: T.join($.getPath("downloads"), M),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, Q = I ? await ne.showSaveDialog(I, D) : await ne.showSaveDialog(D);
      if (Q.canceled || !Q.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const ie = await eo({
        audio: E,
        ffmpegPath: s.ffmpegPath,
        outputPath: Q.filePath,
        video: P
      });
      return {
        ffmpegPath: ie.ffmpegPath,
        ok: !0,
        outputPath: ie.outputPath
      };
    } catch (g) {
      return F.warn("embedded browser resource merge failed", {
        audioResourceKey: f,
        error: g instanceof Error ? g.message : String(g),
        tabId: i,
        videoResourceKey: p
      }), {
        error: g instanceof Error ? g.message : String(g),
        ok: !1
      };
    }
  }, L = (c) => {
    const s = Ee.get(c);
    s != null && s.stagedPath && $e(s.stagedPath).catch(() => {
    }), Ee.delete(c);
    const i = We.get(c);
    i && $e(i).catch(() => {
    }), We.delete(c);
  }, z = (c) => {
    const s = (nt.get(c) ?? 0) + 1;
    return nt.set(c, s), s;
  }, V = (c, s) => nt.get(c) === s, K = (c, s) => {
    try {
      const i = new URL(c), f = new URL(s);
      if (i.origin !== f.origin)
        return !1;
      const p = i.pathname.replace(/\/+$/, "") || "/", g = f.pathname.replace(/\/+$/, "") || "/";
      return g === "/" ? !0 : p === g || p.startsWith(`${g}/`);
    } catch {
      return !1;
    }
  }, de = async (c, s) => {
    const i = Ee.get(c);
    if (!i || s.webContents.isDestroyed())
      return !1;
    const f = s.webContents.getURL() || k.get(c) || "";
    if (!f || !K(f, i.pageUrl))
      return !1;
    try {
      if (!await Do(s, i.stagedPath))
        return !1;
      const g = We.get(c);
      return g && g !== i.stagedPath && $e(g).catch(() => {
      }), We.set(c, i.stagedPath), Ee.delete(c), !0;
    } catch {
      return !1;
    }
  }, q = (c) => {
    c.setBounds(Zt ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }, pe = (c) => {
    if (!Z)
      return;
    const s = w(Z);
    if (!s) {
      Z = null;
      return;
    }
    c.contentView.children.includes(s) && c.contentView.removeChildView(s), Z = null;
  }, X = (c) => {
    if (!C || C.isDestroyed())
      return null;
    const s = w(c);
    if (s)
      return s;
    const i = new Jr({
      webPreferences: {
        devTools: !0,
        partition: Be
      }
    });
    i.webContents.setZoomFactor(1);
    const f = i.webContents.getUserAgent();
    return f.includes("Electron") && i.webContents.setUserAgent(
      f.replace(/\sElectron\/[^\s]+/g, "")
    ), q(i), ye.set(c, i), i.webContents.on("did-start-loading", () => {
      h(c, i, {
        details: "did-start-loading",
        state: "loading",
        url: i.webContents.getURL() || k.get(c) || void 0
      });
    }), i.webContents.on("dom-ready", () => {
      b(c, i);
    }), i.webContents.on("did-stop-loading", async () => {
      if (i.webContents.isDestroyed())
        return;
      const p = i.webContents.getURL() || "";
      k.set(c, p), await de(c, i);
      const g = await e(i);
      h(c, i, {
        details: "did-stop-loading",
        ...g.length ? { meta: g } : {},
        state: "ready",
        url: p || void 0
      });
    }), i.webContents.on("did-navigate", (p, g) => {
      k.set(c, g), h(c, i, { details: "did-navigate", state: "ready", url: g }), de(c, i);
    }), i.webContents.on("did-navigate-in-page", (p, g) => {
      k.set(c, g), h(c, i, { details: "did-navigate-in-page", state: "ready", url: g }), de(c, i);
    }), i.webContents.on("page-title-updated", (p, g) => {
      h(c, i, {
        details: "page-title-updated",
        state: "ready",
        title: g || void 0,
        url: k.get(c) || i.webContents.getURL() || void 0
      });
    }), i.webContents.on("page-favicon-updated", (p, g) => {
      const E = k.get(c) || i.webContents.getURL() || void 0, P = g.map((M) => a(String(M || ""), E)).find((M) => M.trim()) || "";
      P && y(i, P).then((M) => {
        !M || i.webContents.isDestroyed() || (Ne.set(c, P), Fe.set(c, M), h(c, i, {
          details: "page-favicon-updated",
          iconSourceUrl: P,
          iconUrl: M,
          state: "ready",
          url: k.get(c) || i.webContents.getURL() || void 0
        }));
      });
    }), i.webContents.on("did-fail-load", (p, g, E, P) => {
      g !== -3 && h(c, i, {
        details: `did-fail-load(${g})`,
        state: "error",
        message: `页面加载失败：${E || "未知错误"}`,
        url: P
      });
    }), i.webContents.on("render-process-gone", (p, g) => {
      h(c, i, {
        details: `render-process-gone:${g.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${g.reason}`,
        url: k.get(c) || i.webContents.getURL() || void 0
      });
    }), i.webContents.on("console-message", (p, g, E, P, M) => {
      if (typeof E == "string" && E.startsWith(it)) {
        const I = E.slice(it.length);
        try {
          const D = JSON.parse(I);
          bo(c, {
            capturedAt: Number(D.capturedAt) || Date.now(),
            contentLength: typeof D.contentLength == "number" ? D.contentLength : void 0,
            ext: typeof D.ext == "string" ? D.ext : void 0,
            kind: typeof D.kind == "string" ? D.kind : void 0,
            mimeType: typeof D.mimeType == "string" ? D.mimeType : void 0,
            pageUrl: typeof D.pageUrl == "string" ? D.pageUrl : void 0,
            resourceKey: typeof D.resourceKey == "string" ? D.resourceKey : void 0,
            resourceType: typeof D.resourceType == "string" ? D.resourceType : void 0,
            source: "probe",
            streamType: D.streamType === "audio" || D.streamType === "video" ? D.streamType : void 0,
            url: typeof D.url == "string" ? D.url : ""
          });
        } catch (D) {
          F.warn("embedded browser resource payload parse failed", {
            error: D instanceof Error ? D.message : String(D),
            tabId: c
          });
        }
        return;
      }
      Gt && g >= 2 && h(c, i, {
        details: `console:${M}:${P}`,
        state: "ready",
        message: E,
        meta: [`console-level=${g}`],
        url: k.get(c) || i.webContents.getURL() || void 0
      });
    }), i.webContents.setWindowOpenHandler(({ url: p }) => (i.webContents.loadURL(p), { action: "deny" })), i;
  }, Y = (c, s, i) => {
    if (!c || c.isDestroyed())
      return null;
    if (!s)
      return pe(c), null;
    const p = (i == null ? void 0 : i.createIfMissing) ?? !1 ? X(s) : w(s);
    return p ? !p || p.webContents.isDestroyed() ? null : (Z && Z !== s && pe(c), q(p), c.contentView.children.includes(p) || c.contentView.addChildView(p), Z = s, p) : (pe(c), null);
  }, j = async (c, s, i, f, p = !1) => {
    if (!c || c.isDestroyed())
      return;
    const g = String(s || "").trim();
    if (!g)
      return;
    const E = Y(c, g, { createIfMissing: !0 });
    if (!E || E.webContents.isDestroyed())
      return;
    const P = String(i || "").trim();
    if (!P) {
      h(g, E, {
        state: "ready",
        title: o(E) || "新标签页",
        url: k.get(g) || void 0
      });
      return;
    }
    const M = k.get(g) || E.webContents.getURL();
    if (p && M === P) {
      h(g, E, {
        state: "ready",
        url: M || void 0
      });
      return;
    }
    h(g, E, {
      details: "load-url",
      state: "loading",
      url: P
    });
    try {
      await E.webContents.loadURL(P);
    } catch (I) {
      const D = I instanceof Error ? I.message : String(I);
      if (D.includes("ERR_ABORTED"))
        return;
      throw h(g, E, {
        details: f,
        state: "error",
        message: `页面加载失败：${D}`,
        url: P
      }), I;
    }
  }, se = (c, s) => {
    if (!c || c.isDestroyed())
      return;
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = w(i);
    f && (c.contentView.children.includes(f) && c.contentView.removeChildView(f), Z === i && (Z = null), ye.delete(i), k.delete(i), Fe.delete(i), Ne.delete(i), Kt(i), z(i), L(i), f.webContents.isDestroyed() || f.webContents.close({ waitForBeforeUnload: !1 }));
  };
  O.handle("embedded-browser:open-tab", async (c, s, i) => {
    const f = W.fromWebContents(c.sender) ?? C;
    z(String(s || "").trim()), L(String(s || "").trim());
    const p = String(i || "").trim();
    if (!p) {
      t({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: s,
        title: "新标签页"
      });
      return;
    }
    await j(f, s, p, "open-exception", !0);
  }), O.handle("embedded-browser:activate-tab", (c, s) => {
    const i = W.fromWebContents(c.sender) ?? C;
    Y(i, s, { createIfMissing: !1 });
  }), O.handle("embedded-browser:navigate", async (c, s, i) => {
    const f = W.fromWebContents(c.sender) ?? C, p = String(s || "").trim();
    z(p), L(p), await j(f, p, i, "navigate-exception");
  }), O.handle("embedded-browser:resolve-favicon", async (c, s) => _(s)), O.handle("embedded-browser:open-mapped-file", async (c, s, i, f, p) => {
    const g = W.fromWebContents(c.sender) ?? C, E = String(s || "").trim(), P = String(i || "").trim(), M = String(f || "").trim(), I = String(p || "").trim() || "file";
    if (!E || !P || !M)
      return;
    const D = z(E);
    L(E);
    const Q = await xo(M, I);
    if (!V(E, D)) {
      $e(Q).catch(() => {
      });
      return;
    }
    if (Ee.set(E, {
      fileName: I,
      pageUrl: P,
      stagedPath: Q
    }), await j(g, E, P, "navigate-exception"), !V(E, D))
      return;
    const ie = w(E);
    ie && de(E, ie);
  }), O.handle("embedded-browser:reload", async (c, s) => {
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = w(i);
    !f || f.webContents.isDestroyed() || (h(i, f, {
      details: "reload",
      state: "loading",
      url: k.get(i) || f.webContents.getURL() || void 0
    }), f.webContents.reload(), v(i, f, {
      details: "reload-requested"
    }));
  }), O.handle("embedded-browser:go-back", async (c, s) => {
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = w(i);
    !f || f.webContents.isDestroyed() || (f.webContents.canGoBack() && f.webContents.goBack(), v(i, f, {
      details: "history-back"
    }));
  }), O.handle("embedded-browser:go-forward", async (c, s) => {
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = w(i);
    !f || f.webContents.isDestroyed() || (f.webContents.canGoForward() && f.webContents.goForward(), v(i, f, {
      details: "history-forward"
    }));
  }), O.handle("embedded-browser:resource:list", (c, s) => mo(String(s || "").trim())), O.handle("embedded-browser:resource:start", (c, s) => po(String(s || "").trim())), O.handle("embedded-browser:resource:stop", (c, s) => go(String(s || "").trim())), O.handle("embedded-browser:resource:clear", (c, s) => ho(String(s || "").trim())), O.handle("embedded-browser:resource:open", async (c, s, i) => B(s, async (f, p) => {
    try {
      return await zt(f, "openResource", i);
    } catch (g) {
      return F.warn("embedded browser resource probe action failed", {
        action: "openResource",
        error: g instanceof Error ? g.message : String(g),
        resourceKey: String(i || "").trim(),
        tabId: String(s || "").trim(),
        url: p.webContents.getURL() || k.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((f) => !!f)), O.handle("embedded-browser:resource:export", async (c, s, i) => B(s, async (f, p) => {
    try {
      return await zt(f, "exportResource", i);
    } catch (g) {
      return F.warn("embedded browser resource probe action failed", {
        action: "exportResource",
        error: g instanceof Error ? g.message : String(g),
        resourceKey: String(i || "").trim(),
        tabId: String(s || "").trim(),
        url: p.webContents.getURL() || k.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((f) => !!f)), O.handle("embedded-browser:resource:preview", async (c, s, i) => B(s, async (f) => {
    try {
      return await jn(f, i);
    } catch (p) {
      return F.warn("embedded browser network resource preview failed", {
        error: p instanceof Error ? p.message : String(p),
        tabId: String(s || "").trim(),
        url: String(i.url || "").trim()
      }), !1;
    }
  }).then((f) => !!f)), O.handle(
    "embedded-browser:resource:merge-mse",
    async (c, s, i) => A(s, i)
  ), O.handle("embedded-browser:resource:start-deep-capture", async (c, s) => {
    const i = String(s || "").trim(), f = yo(i), p = w(i);
    return p && !p.webContents.isDestroyed() && (p.webContents.getURL() ? p.webContents.reload() : await b(i, p)), f;
  }), O.handle("embedded-browser:set-bounds", (c, s) => {
    const i = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, f = W.fromWebContents(c.sender) ?? C, p = f && !f.isDestroyed() ? Math.max(f.webContents.getZoomFactor(), 0.01) : 1;
    if (i.x = Math.max(0, Math.round(s.x * p)), i.y = Math.max(0, Math.round(s.y * p)), i.width = Math.max(0, Math.round(s.width * p)), i.height = Math.max(0, Math.round(s.height * p)), Zt = i, !Z)
      return;
    const g = w(Z);
    g && g.setBounds(i);
  }), O.handle("embedded-browser:close-tab", (c, s) => {
    const i = W.fromWebContents(c.sender) ?? C;
    se(i, s);
  }), O.handle("embedded-browser:cleanup-download-file", async (c, s) => {
    try {
      return await lr(s);
    } catch {
      return !1;
    }
  }), O.handle("embedded-browser:deactivate", (c) => {
    const s = W.fromWebContents(c.sender) ?? C;
    !s || s.isDestroyed() || pe(s);
  }), O.handle("embedded-browser:close-all", (c) => {
    const s = W.fromWebContents(c.sender) ?? C;
    !s || s.isDestroyed() || (Array.from(ye.keys()).forEach((i) => {
      se(s, i);
    }), Z = null, t({ state: "idle" }));
  });
}
function Rr() {
  if (C && !C.isDestroyed())
    return C.show(), C.focus(), C;
  const t = vr(), e = Ko(), o = (e == null ? void 0 : e.width) ?? Mo, a = (e == null ? void 0 : e.height) ?? Ao, d = new W({
    width: o,
    height: a,
    minWidth: mt,
    minHeight: pt,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...me(e == null ? void 0 : e.x) && me(e == null ? void 0 : e.y) ? { x: e.x, y: e.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: T.join(Uo, "preload.mjs"),
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
  return C = d, e != null && e.maximized && d.maximize(), d.on("move", () => {
    Ie(d);
  }), d.on("resize", () => {
    Ie(d);
  }), d.on("maximize", () => {
    Ie(d);
  }), d.on("unmaximize", () => {
    Ie(d);
  }), d.on("close", (l) => {
    yt(d), process.platform === "darwin" && !Sr && (l.preventDefault(), d.hide());
  }), d.on("closed", () => {
    C === d && (C = null);
  }), d.webContents.setZoomFactor(1), d.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), d.webContents.on("before-input-event", (l, y) => {
    if (Xo(y)) {
      l.preventDefault();
      return;
    }
    qo(y) && (l.preventDefault(), d.webContents.toggleDevTools());
  }), d.on("app-command", (l, y) => {
    (y === "browser-backward" || y === "browser-forward") && l.preventDefault();
  }), d.on("swipe", (l, y) => {
    (y === "left" || y === "right") && l.preventDefault();
  }), Ve ? d.loadURL(Ve) : d.loadFile(T.join(br, "index.html")), d;
}
$.on("before-quit", () => {
  Sr = !0, C && !C.isDestroyed() && yt(C);
});
$.on("window-all-closed", () => {
  process.platform !== "darwin" && $.quit();
});
$.on("activate", () => {
  if (C && !C.isDestroyed()) {
    C.isMinimized() && C.restore(), C.show(), C.focus();
    return;
  }
  W.getAllWindows().length === 0 && Rr();
});
$.whenReady().then(() => {
  const t = vr();
  t && process.platform === "darwin" && $.dock.setIcon(t), Yo(), Wn({
    emitDownload: Wo,
    resolveTabIdByWebContents: Io
  }), vo({
    browserSession: _e.fromPartition(Be),
    emitResource: Ho,
    resolveTabIdByWebContentsId: zo
  }), Mn(), Qo(), Rr();
});
export {
  Uo as MAIN_DIST,
  br as RENDERER_DIST,
  Ve as VITE_DEV_SERVER_URL
};
