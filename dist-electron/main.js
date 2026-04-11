import { dialog as W, app as T, net as xe, ipcMain as _, session as he, BrowserWindow as R, screen as Le, WebContentsView as Ue } from "electron";
import { fileURLToPath as Ie } from "node:url";
import y from "node:path";
import K, { existsSync as te, mkdirSync as we, readFileSync as Ne, writeFileSync as Fe } from "node:fs";
import D from "fs/promises";
import ge from "node:http";
import pe from "node:https";
import ye from "os";
import ne from "child_process";
import $e from "fs";
import We from "node:fs/promises";
const j = 6e4, ze = "Omniflow Inbox", Ve = 10 * 60 * 1e3, He = 2, ke = 2e3, ee = 12, V = /* @__PURE__ */ new Map();
function re(e) {
  const n = String(e || "");
  return !!(!n || n === ".DS_Store" || n.startsWith("._") || n === "Thumbs.db");
}
function H(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Ge(e) {
  const n = String(e || "").toLowerCase();
  return !n || n.startsWith(".") ? !0 : n.endsWith(".crdownload") || n.endsWith(".part") || n.endsWith(".tmp") || n.endsWith(".opdownload") || n.endsWith(".download");
}
function be() {
  return y.join(T.getPath("userData"), "auto-import-staging");
}
function je(e, n) {
  const s = y.resolve(e), a = y.resolve(n);
  return s === a ? !0 : s.startsWith(`${a}${y.sep}`);
}
function qe(e) {
  const n = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${n}`;
}
async function Xe(e, n) {
  try {
    await D.rename(e, n);
  } catch (s) {
    if ((s == null ? void 0 : s.code) !== "EXDEV")
      throw s;
    await D.copyFile(e, n), await D.rm(e, { force: !0 });
  }
}
function Ze(e) {
  const n = Date.now();
  for (const [s, a] of V.entries())
    e.has(s) || n - a.lastSeenAt <= Ve || V.delete(s);
}
async function Je(e, n = ee) {
  const s = String(e || "").trim(), a = s ? y.resolve(s) : y.join(T.getPath("downloads"), ze), i = await D.stat(a).catch(() => null);
  if (!(i != null && i.isDirectory()))
    return [];
  const d = await D.readdir(a, { withFileTypes: !0 }), m = /* @__PURE__ */ new Set(), p = Date.now(), b = [];
  for (const o of d) {
    if (!o.isFile() || re(o.name) || Ge(o.name)) continue;
    const t = y.join(a, o.name), r = await D.stat(t).catch(() => null);
    if (!(r != null && r.isFile())) continue;
    m.add(t);
    const c = V.get(t), f = (c ? c.size === r.size && c.mtimeMs === r.mtimeMs : !1) && c ? c.stableCount + 1 : 1;
    V.set(t, {
      size: r.size,
      mtimeMs: r.mtimeMs,
      stableCount: f,
      lastSeenAt: p
    }), !(f < He) && (p - r.mtimeMs < ke || b.push({
      sourcePath: t,
      name: o.name,
      size: r.size,
      mtimeMs: r.mtimeMs
    }));
  }
  if (Ze(m), b.length === 0)
    return [];
  b.sort((o, t) => o.mtimeMs - t.mtimeMs);
  const h = be();
  await D.mkdir(h, { recursive: !0 });
  const l = [], w = Math.max(1, Math.floor(Number(n) || ee));
  for (const o of b.slice(0, w)) {
    const t = y.join(h, qe(o.name));
    try {
      await Xe(o.sourcePath, t);
    } catch {
      continue;
    }
    V.delete(o.sourcePath), l.push({
      name: o.name,
      size: o.size,
      localPath: t,
      relativePath: H(o.name)
    });
  }
  return l;
}
async function Ye(e) {
  const n = y.resolve(String(e || "").trim()), s = be();
  return !n || !je(n, s) ? !1 : (await D.rm(n, { force: !0 }), !0);
}
function ae(e, n) {
  const s = H(n || "");
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
async function ve(e, n, s = {}, a = 0) {
  const d = new URL(e);
  if (d.protocol !== "http:" && d.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${d.protocol}`);
  const m = d.protocol === "https:" ? pe : ge;
  await D.mkdir(y.dirname(n), { recursive: !0 }), await new Promise((p, b) => {
    let h = !1;
    const l = () => {
      h || (h = !0, p());
    }, w = (t) => {
      h || (h = !0, b(t));
    }, o = m.request({
      protocol: d.protocol,
      hostname: d.hostname,
      port: d.port ? Number(d.port) : void 0,
      path: `${d.pathname}${d.search}`,
      method: "GET",
      headers: s
    }, (t) => {
      t.setTimeout(j, () => {
        t.destroy(new Error(`下载响应超时: ${j}ms`));
      });
      const r = Number(t.statusCode || 0), c = t.headers.location;
      if (r >= 300 && r < 400 && c) {
        if (t.resume(), a >= 3) {
          w(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const v = new URL(c, e).toString();
        ve(v, n, s, a + 1).then(l).catch(w);
        return;
      }
      if (r >= 400) {
        t.resume(), w(new Error(`下载失败: HTTP ${r} (${e})`));
        return;
      }
      const u = K.createWriteStream(n), f = async (v) => {
        try {
          u.destroy();
        } catch {
        }
        try {
          await D.rm(n, { force: !0 });
        } catch {
        }
        w(v);
      };
      t.on("error", (v) => {
        f(v);
      }), u.on("error", (v) => {
        f(v);
      }), u.on("finish", () => l()), t.pipe(u);
    });
    o.setTimeout(j, () => {
      o.destroy(new Error(`下载请求超时: ${j}ms`));
    }), o.on("error", (t) => w(t)), o.end();
  });
}
function Ee(e, n) {
  return e.relativePath.localeCompare(n.relativePath, "zh-Hans-CN");
}
async function Qe(e) {
  return (await Promise.all(e.map(async (s) => {
    const a = await D.stat(s);
    if (!a.isFile())
      return null;
    const i = y.basename(s);
    return re(i) ? null : {
      name: i,
      size: a.size,
      localPath: s,
      relativePath: H(i)
    };
  }))).filter((s) => !!s).sort(Ee);
}
async function Ke(e, n, s) {
  const a = [n], i = [];
  for (; a.length > 0; ) {
    const l = a.pop(), w = await D.readdir(l, { withFileTypes: !0 });
    for (const o of w) {
      if (o.name === "." || o.name === ".." || re(o.name) || o.isSymbolicLink())
        continue;
      const t = y.join(l, o.name);
      if (o.isDirectory()) {
        a.push(t);
        continue;
      }
      o.isFile() && i.push({
        absolutePath: t,
        name: o.name
      });
    }
  }
  const d = [], m = 48;
  let p = 0;
  const b = async () => {
    for (; ; ) {
      const l = p;
      if (p += 1, l >= i.length)
        return;
      const w = i[l], o = await D.stat(w.absolutePath).catch(() => null);
      if (!(o != null && o.isFile()))
        continue;
      const t = H(y.relative(e, w.absolutePath)), r = H(y.join(s, t));
      d.push({
        name: w.name,
        size: o.size,
        localPath: w.absolutePath,
        relativePath: r
      });
    }
  }, h = Math.min(m, Math.max(1, i.length));
  return await Promise.all(Array.from({ length: h }, () => b())), d;
}
async function et(e) {
  const n = [];
  for (const s of e) {
    if (!(await D.stat(s)).isDirectory())
      continue;
    const i = y.basename(s), d = await Ke(s, s, i);
    n.push(...d);
  }
  return n.sort(Ee);
}
function tt(e) {
  e.handle("file:open", async () => {
    const n = await W.showOpenDialog({ properties: ["openFile"] });
    return n.canceled || n.filePaths.length === 0 ? null : await D.readFile(n.filePaths[0], "utf-8");
  }), e.handle("file:save", async (n, s, a) => (await D.writeFile(s, a, "utf-8"), !0)), e.handle("dialog:pick-upload-files", async () => {
    const n = await W.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Qe(n.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const n = await W.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await et(n.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const n = await W.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: n.filePaths[0] };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const n = await W.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return n.canceled || n.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: n.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (n, s, a = ee) => ({ canceled: !1, files: await Je(s, a) })), e.handle("fs:cleanup-auto-import-staged-file", async (n, s) => {
    try {
      return await Ye(s);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (n, s, a = "") => {
    const i = ae(s, a);
    return await D.mkdir(i, { recursive: !0 }), i;
  }), e.handle("fs:download-url-to-path", async (n, s, a, i, d = {}) => {
    const m = ae(a, i);
    return await ve(s, m, d), m;
  });
}
var S = {}, x = ye;
S.platform = function() {
  return process.platform;
};
S.cpuCount = function() {
  return x.cpus().length;
};
S.sysUptime = function() {
  return x.uptime();
};
S.processUptime = function() {
  return process.uptime();
};
S.freemem = function() {
  return x.freemem() / (1024 * 1024);
};
S.totalmem = function() {
  return x.totalmem() / (1024 * 1024);
};
S.freememPercentage = function() {
  return x.freemem() / x.totalmem();
};
S.freeCommand = function(e) {
  ne.exec("free -m", function(n, s, a) {
    var i = s.split(`
`), d = i[1].replace(/[\s\n\r]+/g, " "), m = d.split(" ");
    total_mem = parseFloat(m[1]), free_mem = parseFloat(m[3]), buffers_mem = parseFloat(m[5]), cached_mem = parseFloat(m[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
S.harddrive = function(e) {
  ne.exec("df -k", function(n, s, a) {
    var i = 0, d = 0, m = 0, p = s.split(`
`), b = p[1].replace(/[\s\n\r]+/g, " "), h = b.split(" ");
    i = Math.ceil(h[1] * 1024 / Math.pow(1024, 2)), d = Math.ceil(h[2] * 1024 / Math.pow(1024, 2)), m = Math.ceil(h[3] * 1024 / Math.pow(1024, 2)), e(i, m, d);
  });
};
S.getProcesses = function(e, n) {
  typeof e == "function" && (n = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), ne.exec(command, function(s, a, i) {
    var d = a.split(`
`);
    d.shift(), d.pop();
    var m = "";
    d.forEach(function(p, b) {
      var h = p.replace(/[\s\n\r]+/g, " ");
      h = h.split(" "), m += h[1] + " " + h[2] + " " + h[3] + " " + h[4].substring(h[4].length - 25) + `
`;
    }), n(m);
  });
};
S.allLoadavg = function() {
  var e = x.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
S.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var n = x.loadavg(), s = 0;
  return e == 1 && (s = n[0]), e == 5 && (s = n[1]), e == 15 && (s = n[2]), s;
};
S.cpuFree = function(e) {
  _e(e, !0);
};
S.cpuUsage = function(e) {
  _e(e, !1);
};
function _e(e, n) {
  var s = de(), a = s.idle, i = s.total;
  setTimeout(function() {
    var d = de(), m = d.idle, p = d.total, b = m - a, h = p - i, l = b / h;
    e(n === !0 ? l : 1 - l);
  }, 1e3);
}
function de(e) {
  var n = x.cpus(), s = 0, a = 0, i = 0, d = 0, m = 0, b = 0;
  for (var p in n)
    s += n[p].times.user, a += n[p].times.nice, i += n[p].times.sys, m += n[p].times.irq, d += n[p].times.idle;
  var b = s + a + i + d + m;
  return {
    idle: d,
    total: b
  };
}
const nt = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", z = (e, ...n) => {
  nt && console[e](...n);
}, O = {
  debug: (...e) => z("debug", ...e),
  info: (...e) => z("info", ...e),
  log: (...e) => z("log", ...e),
  warn: (...e) => z("warn", ...e),
  error: (...e) => z("error", ...e)
};
function rt() {
  const e = ot().total, n = ye.cpus()[0].model, s = Math.floor(S.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: n,
    totalMemoryGB: s
  };
}
function ot() {
  const e = $e.statfsSync(process.platform === "win32" ? "C:" : "/"), n = e.blocks * e.bsize, s = e.bfree * e.bsize;
  return {
    total: Math.floor(n / 1e9),
    // 换算为 GB
    usage: 1 - s / n
    // 使用率计算
  };
}
function st(e) {
  e.handle("sys:get-static-data", rt);
}
const it = 10 * 1024 * 1024 * 1024, at = "10GB", dt = `上传失败：单文件最大支持 ${at}`;
function De(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function ct(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (n) => `%${n.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function lt(e) {
  const n = De(e), s = ct(e);
  return `Content-Disposition: form-data; name="file"; filename="${n}"; filename*=UTF-8''${s}\r
`;
}
function ut(e) {
  const n = /* @__PURE__ */ new Map(), s = (a, i = !1) => {
    const d = Date.now();
    if (!i && d - a.lastProgressAt < 80) return;
    a.lastProgressAt = d;
    const m = Math.max(d - a.startedAt, 1), p = Math.floor(a.uploadedBytes * 1e3 / m), b = a.totalBytes > 0 ? Math.min(a.uploadedBytes / a.totalBytes * 100, 100) : 0;
    a.sender.send("http:upload:progress", {
      uploadId: a.uploadId,
      uploadedBytes: a.uploadedBytes,
      totalBytes: a.totalBytes,
      percentage: b,
      speedBps: p
    });
  };
  e.handle("http:fetch", async (a, i, d = {}) => (O.debug("http:fetch start"), O.debug("http:fetch URL:", i), O.debug("http:fetch options:", d), new Promise((m, p) => {
    const b = xe.request({ url: i, method: d.method || "GET" });
    d.headers && Object.entries(d.headers).forEach(([l, w]) => {
      O.debug(`http:fetch set header ${l}: ${String(w)}`), b.setHeader(l, w);
    });
    let h = "";
    b.on("response", (l) => {
      O.debug("http:fetch response"), O.debug("http:fetch status:", l.statusCode), O.debug("http:fetch headers:", l.headers), l.on("data", (w) => {
        O.debug(`http:fetch chunk length: ${w.length}`), h += w;
      }), l.on("end", () => {
        O.debug("http:fetch body preview:", h.slice(0, 500));
        let w;
        try {
          w = JSON.parse(h);
        } catch {
          w = h;
        }
        m({
          status: l.statusCode,
          headers: l.headers,
          body: w
        });
      });
    }), b.on("error", (l) => {
      O.error("http:fetch error:", l), p(l);
    }), d.body && b.write(d.body), b.end();
  }))), e.handle("http:upload:abort", async (a, i) => {
    const d = n.get(i);
    if (!d) return !1;
    d.aborted = !0, n.delete(i);
    try {
      d.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      d.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (a, i, d, m = {}, p = {}, b) => new Promise((h, l) => {
    let w;
    try {
      w = K.statSync(d);
    } catch (E) {
      l(new Error(`读取上传文件失败: ${d} (${String(E)})`));
      return;
    }
    if (!w.isFile()) {
      l(new Error(`上传目标不是文件: ${d}`));
      return;
    }
    if (w.size > it) {
      l(new Error(dt));
      return;
    }
    const o = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), t = b || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, r = y.basename(d), c = Object.entries(m).map(([E, I]) => `--${o}\r
Content-Disposition: form-data; name="${De(E)}"\r
\r
${I}\r
`).join(""), u = `--${o}\r
` + lt(r) + `Content-Type: application/octet-stream\r
\r
`, f = `\r
--${o}--\r
`, v = Buffer.byteLength(c) + Buffer.byteLength(u) + w.size + Buffer.byteLength(f), A = {
      ...p,
      "Content-Type": `multipart/form-data; boundary=${o}`,
      "Content-Length": String(v)
    }, P = new URL(i), M = (P.protocol === "https:" ? pe : ge).request({
      protocol: P.protocol,
      hostname: P.hostname,
      port: P.port ? Number(P.port) : void 0,
      path: `${P.pathname}${P.search}`,
      method: "POST",
      headers: A
    }), N = K.createReadStream(d, {
      highWaterMark: 1024 * 1024
    }), L = {
      uploadId: t,
      request: M,
      fileStream: N,
      sender: a.sender,
      totalBytes: Math.max(0, w.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    n.set(t, L);
    let k = !1;
    const Oe = (E) => {
      k || (k = !0, n.delete(t), h(E));
    }, G = (E) => {
      k || (k = !0, n.delete(t), l(E));
    };
    let Y = "";
    M.on("response", (E) => {
      E.on("data", (I) => {
        Y += I.toString();
      }), E.on("end", () => {
        let I;
        try {
          I = JSON.parse(Y);
        } catch {
          I = Y;
        }
        Oe({
          status: E.statusCode,
          body: I
        });
      });
    }), M.on("error", (E) => {
      if (L.aborted) {
        G(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        N.destroy(E);
      } catch {
      }
      G(E);
    }), M.write(c), M.write(u), N.on("data", (E) => {
      L.aborted || (L.uploadedBytes += E.length, s(L));
    }), N.on("end", () => {
      L.aborted || (s(L, !0), M.write(f), M.end());
    }), N.on("error", (E) => {
      if (L.aborted) {
        G(new Error("UPLOAD_ABORTED"));
        return;
      }
      G(E);
      try {
        M.destroy(E);
      } catch {
      }
    }), N.pipe(M, { end: !1 });
  }));
}
function ft() {
  tt(_), st(_), ut(_);
}
const Te = "persist:omniflow-embedded-browser", mt = "embedded-browser-downloads";
let Q = null, ce = !1;
function Se() {
  return y.join(T.getPath("userData"), mt);
}
function ht() {
  const e = Se();
  return te(e) || we(e, { recursive: !0 }), e;
}
function wt() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function gt(e) {
  const n = String(e).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${n}`;
}
function q(e, n) {
  var s, a;
  return {
    downloadId: n.downloadId,
    fileName: n.fileName,
    mimeType: n.mimeType,
    pageUrl: n.pageUrl,
    receivedBytes: n.receivedBytes ?? Math.max(0, Number(((s = e.getReceivedBytes) == null ? void 0 : s.call(e)) || 0)),
    state: n.state,
    tabId: n.tabId,
    tempPath: n.tempPath,
    totalBytes: n.totalBytes ?? Math.max(0, Number(((a = e.getTotalBytes) == null ? void 0 : a.call(e)) || 0)),
    url: n.url,
    ...n.error ? { error: n.error } : {}
  };
}
function pt() {
  return Q || (Q = he.fromPartition(Te)), Q;
}
async function Re(e) {
  const n = y.resolve(String(e || "").trim());
  if (!n)
    return !1;
  const s = y.resolve(Se());
  return n !== s && !n.startsWith(`${s}${y.sep}`) ? !1 : (await We.rm(n, { force: !0 }), !0);
}
function yt(e) {
  if (ce)
    return;
  ce = !0;
  const n = (i, d, m) => {
    const p = e.resolveTabIdByWebContents(m) || void 0;
    if (!p)
      return;
    const b = ht(), h = wt(), l = d.getFilename() || "download", w = d.getURL() || "", o = m.getURL() || void 0, t = y.join(b, gt(l));
    d.setSavePath(t), e.emitDownload(q(d, {
      downloadId: h,
      fileName: l,
      mimeType: d.getMimeType() || void 0,
      pageUrl: o,
      state: "started",
      tabId: p,
      tempPath: t,
      url: w
    })), d.on("updated", (r, c) => {
      c === "progressing" && e.emitDownload(q(d, {
        downloadId: h,
        fileName: l,
        mimeType: d.getMimeType() || void 0,
        pageUrl: o,
        state: "progress",
        tabId: p,
        tempPath: t,
        url: w
      }));
    }), d.once("done", (r, c) => {
      if (c === "completed") {
        e.emitDownload(q(d, {
          downloadId: h,
          fileName: l,
          mimeType: d.getMimeType() || void 0,
          pageUrl: o,
          state: "completed",
          tabId: p,
          tempPath: t,
          url: w
        }));
        return;
      }
      Re(t).catch(() => {
      }), e.emitDownload(q(d, {
        downloadId: h,
        error: c === "cancelled" ? "下载已取消" : `下载失败：${c}`,
        fileName: l,
        mimeType: d.getMimeType() || void 0,
        pageUrl: o,
        state: c === "cancelled" ? "cancelled" : "failed",
        tabId: p,
        tempPath: t,
        url: w
      }));
    });
  }, s = /* @__PURE__ */ new Set();
  [he.defaultSession, pt()].filter(Boolean).forEach((i) => {
    s.has(i) || (s.add(i), i.on("will-download", n));
  });
}
const bt = y.dirname(Ie(import.meta.url));
process.env.APP_ROOT = y.join(bt, "..");
const J = process.env.VITE_DEV_SERVER_URL, vt = y.join(process.env.APP_ROOT, "dist-electron"), Ce = y.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = J ? y.join(process.env.APP_ROOT, "public") : Ce;
const le = y.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Et = "Omniflow", _t = "omniflow-app", Dt = 1400, Tt = 920, oe = 600, se = 400, St = "window-state.json", Rt = 200, ue = process.env.NODE_ENV === "test" || !!(J || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Ct = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
Ct || (T.commandLine.appendSwitch("disable-logging"), T.commandLine.appendSwitch("log-level", "3"));
T.setName(Et);
try {
  const e = y.join(T.getPath("appData"), _t);
  T.setPath("userData", e);
} catch {
}
function Pe() {
  return te(le) ? le : null;
}
let g = null, fe = !1, Me = !1;
const Pt = 240;
let X = null;
const F = /* @__PURE__ */ new Map(), C = /* @__PURE__ */ new Map();
let B = null, me = null;
function Mt(e) {
  !g || g.isDestroyed() || g.webContents.send("embedded-browser:download", e);
}
function Bt(e) {
  for (const [n, s] of F.entries())
    if (s.webContents === e)
      return n;
  return null;
}
function Be() {
  return y.join(T.getPath("userData"), St);
}
function U(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function At(e, n) {
  return e >= oe && n >= se;
}
function Ot(e) {
  return Le.getAllDisplays().some((s) => {
    const a = s.workArea;
    return e.x < a.x + a.width && e.x + e.width > a.x && e.y < a.y + a.height && e.y + e.height > a.y;
  });
}
function xt() {
  try {
    const e = Be();
    if (!te(e))
      return null;
    const n = Ne(e, "utf-8"), s = JSON.parse(n);
    if (!U(s.width) || !U(s.height) || !At(s.width, s.height))
      return null;
    const a = !!s.maximized, i = {
      width: s.width,
      height: s.height,
      maximized: a
    };
    return U(s.x) && U(s.y) && (i.x = s.x, i.y = s.y), U(i.x) && U(i.y) && (Ot({
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height
    }) || (delete i.x, delete i.y)), i;
  } catch {
    return null;
  }
}
function ie(e) {
  if (!e.isDestroyed())
    try {
      const n = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), s = {
        x: n.x,
        y: n.y,
        width: Math.max(Math.round(n.width), oe),
        height: Math.max(Math.round(n.height), se),
        maximized: e.isMaximized()
      }, a = Be();
      we(y.dirname(a), { recursive: !0 }), Fe(a, JSON.stringify(s), "utf-8");
    } catch {
    }
}
function Z(e) {
  X && clearTimeout(X), X = setTimeout(() => {
    X = null, ie(e);
  }, Rt);
}
function Lt(e) {
  if (e.type !== "keyDown")
    return !1;
  const n = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && n === "i";
}
function Ut() {
  if (fe)
    return;
  fe = !0, _.handle("zoom-adjust", (o, t) => {
    const r = R.fromWebContents(o.sender) ?? g;
    if (!r || r.isDestroyed())
      return null;
    const c = r.webContents.getZoomFactor(), u = Math.min(Math.max(c + t, 0.25), 3);
    return r.webContents.setZoomFactor(u), u;
  }), _.on("window-minimize", (o) => {
    const t = R.fromWebContents(o.sender) ?? g;
    t == null || t.minimize();
  }), _.on("window-maximize", (o) => {
    const t = R.fromWebContents(o.sender) ?? g;
    !t || t.isDestroyed() || (t.isMaximized() ? t.unmaximize() : t.maximize());
  }), _.on("window-close", (o) => {
    const t = R.fromWebContents(o.sender) ?? g;
    t == null || t.close();
  }), _.handle("window-activate", (o, t = !1) => {
    const r = R.fromWebContents(o.sender) ?? g;
    return !r || r.isDestroyed() ? !1 : (r.isMinimized() && r.restore(), r.isVisible() || r.show(), process.platform === "darwin" ? T.focus({ steal: !0 }) : T.focus(), typeof r.moveTop == "function" && r.moveTop(), r.focus(), t && !r.isAlwaysOnTop() && (r.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      r.isDestroyed() || r.setAlwaysOnTop(!1);
    }, Pt)), !0);
  });
  const e = (o) => {
    O.log("[embedded-browser:main]", o), !(!g || g.isDestroyed()) && g.webContents.send("embedded-browser:state", o);
  }, n = async (o) => {
    if (!ue || o.webContents.isDestroyed())
      return [];
    try {
      const t = await o.webContents.executeJavaScript(`
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
  }, s = (o) => {
    const t = o.webContents.getTitle().trim();
    if (t)
      return t;
  }, a = (o, t, r) => {
    e({
      canGoBack: t.webContents.canGoBack(),
      canGoForward: t.webContents.canGoForward(),
      tabId: o,
      title: r.title ?? s(t),
      ...r
    });
  }, i = (o, t, r) => {
    a(o, t, {
      state: "ready",
      url: (r == null ? void 0 : r.url) ?? (C.get(o) || t.webContents.getURL() || void 0),
      ...r
    });
  }, d = (o) => {
    const t = F.get(o);
    return !t || t.webContents.isDestroyed() ? (F.delete(o), C.delete(o), null) : t;
  }, m = (o) => {
    o.setBounds(me ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }, p = (o) => {
    if (!B)
      return;
    const t = d(B);
    if (!t) {
      B = null;
      return;
    }
    o.contentView.children.includes(t) && o.contentView.removeChildView(t), B = null;
  }, b = (o) => {
    if (!g || g.isDestroyed())
      return null;
    const t = d(o);
    if (t)
      return t;
    const r = new Ue({
      webPreferences: {
        devTools: !0,
        partition: Te
      }
    });
    r.webContents.setZoomFactor(1);
    const c = r.webContents.getUserAgent();
    return c.includes("Electron") && r.webContents.setUserAgent(
      c.replace(/\sElectron\/[^\s]+/g, "")
    ), m(r), F.set(o, r), r.webContents.on("did-start-loading", () => {
      a(o, r, {
        details: "did-start-loading",
        state: "loading",
        url: r.webContents.getURL() || C.get(o) || void 0
      });
    }), r.webContents.on("did-stop-loading", async () => {
      if (r.webContents.isDestroyed())
        return;
      const u = r.webContents.getURL() || "";
      C.set(o, u);
      const f = await n(r);
      a(o, r, {
        details: "did-stop-loading",
        ...f.length ? { meta: f } : {},
        state: "ready",
        url: u || void 0
      });
    }), r.webContents.on("did-navigate", (u, f) => {
      C.set(o, f), a(o, r, { details: "did-navigate", state: "ready", url: f });
    }), r.webContents.on("did-navigate-in-page", (u, f) => {
      C.set(o, f), a(o, r, { details: "did-navigate-in-page", state: "ready", url: f });
    }), r.webContents.on("page-title-updated", (u, f) => {
      a(o, r, {
        details: "page-title-updated",
        state: "ready",
        title: f || void 0,
        url: C.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("did-fail-load", (u, f, v, A) => {
      f !== -3 && a(o, r, {
        details: `did-fail-load(${f})`,
        state: "error",
        message: `页面加载失败：${v || "未知错误"}`,
        url: A
      });
    }), r.webContents.on("render-process-gone", (u, f) => {
      a(o, r, {
        details: `render-process-gone:${f.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${f.reason}`,
        url: C.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.on("console-message", (u, f, v, A, P) => {
      ue && f >= 2 && a(o, r, {
        details: `console:${P}:${A}`,
        state: "ready",
        message: v,
        meta: [`console-level=${f}`],
        url: C.get(o) || r.webContents.getURL() || void 0
      });
    }), r.webContents.setWindowOpenHandler(({ url: u }) => (r.webContents.loadURL(u), { action: "deny" })), r;
  }, h = (o, t, r) => {
    if (!o || o.isDestroyed())
      return null;
    if (!t)
      return p(o), null;
    const u = (r == null ? void 0 : r.createIfMissing) ?? !1 ? b(t) : d(t);
    return u ? !u || u.webContents.isDestroyed() ? null : (B && B !== t && p(o), m(u), o.contentView.children.includes(u) || o.contentView.addChildView(u), B = t, u) : (p(o), null);
  }, l = async (o, t, r, c, u = !1) => {
    if (!o || o.isDestroyed())
      return;
    const f = String(t || "").trim();
    if (!f)
      return;
    const v = h(o, f, { createIfMissing: !0 });
    if (!v || v.webContents.isDestroyed())
      return;
    const A = String(r || "").trim();
    if (!A) {
      a(f, v, {
        state: "ready",
        title: s(v) || "新标签页",
        url: C.get(f) || void 0
      });
      return;
    }
    const P = C.get(f) || v.webContents.getURL();
    if (u && P === A) {
      a(f, v, {
        state: "ready",
        url: P || void 0
      });
      return;
    }
    a(f, v, {
      details: "load-url",
      state: "loading",
      url: A
    });
    try {
      await v.webContents.loadURL(A);
    } catch ($) {
      const M = $ instanceof Error ? $.message : String($);
      if (M.includes("ERR_ABORTED"))
        return;
      throw a(f, v, {
        details: c,
        state: "error",
        message: `页面加载失败：${M}`,
        url: A
      }), $;
    }
  }, w = (o, t) => {
    if (!o || o.isDestroyed())
      return;
    const r = String(t || "").trim();
    if (!r)
      return;
    const c = d(r);
    c && (o.contentView.children.includes(c) && o.contentView.removeChildView(c), B === r && (B = null), F.delete(r), C.delete(r), c.webContents.isDestroyed() || c.webContents.close({ waitForBeforeUnload: !1 }));
  };
  _.handle("embedded-browser:open-tab", async (o, t, r) => {
    const c = R.fromWebContents(o.sender) ?? g, u = String(r || "").trim();
    if (!u) {
      e({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: t,
        title: "新标签页"
      });
      return;
    }
    await l(c, t, u, "open-exception", !0);
  }), _.handle("embedded-browser:activate-tab", (o, t) => {
    const r = R.fromWebContents(o.sender) ?? g;
    h(r, t, { createIfMissing: !1 });
  }), _.handle("embedded-browser:navigate", async (o, t, r) => {
    const c = R.fromWebContents(o.sender) ?? g;
    await l(c, t, r, "navigate-exception");
  }), _.handle("embedded-browser:reload", async (o, t) => {
    const r = String(t || "").trim();
    if (!r)
      return;
    const c = d(r);
    !c || c.webContents.isDestroyed() || (a(r, c, {
      details: "reload",
      state: "loading",
      url: C.get(r) || c.webContents.getURL() || void 0
    }), c.webContents.reload(), i(r, c, {
      details: "reload-requested"
    }));
  }), _.handle("embedded-browser:go-back", async (o, t) => {
    const r = String(t || "").trim();
    if (!r)
      return;
    const c = d(r);
    !c || c.webContents.isDestroyed() || (c.webContents.canGoBack() && c.webContents.goBack(), i(r, c, {
      details: "history-back"
    }));
  }), _.handle("embedded-browser:go-forward", async (o, t) => {
    const r = String(t || "").trim();
    if (!r)
      return;
    const c = d(r);
    !c || c.webContents.isDestroyed() || (c.webContents.canGoForward() && c.webContents.goForward(), i(r, c, {
      details: "history-forward"
    }));
  }), _.handle("embedded-browser:set-bounds", (o, t) => {
    const r = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, c = R.fromWebContents(o.sender) ?? g, u = c && !c.isDestroyed() ? Math.max(c.webContents.getZoomFactor(), 0.01) : 1;
    if (r.x = Math.max(0, Math.round(t.x * u)), r.y = Math.max(0, Math.round(t.y * u)), r.width = Math.max(0, Math.round(t.width * u)), r.height = Math.max(0, Math.round(t.height * u)), me = r, !B)
      return;
    const f = d(B);
    f && f.setBounds(r);
  }), _.handle("embedded-browser:close-tab", (o, t) => {
    const r = R.fromWebContents(o.sender) ?? g;
    w(r, t);
  }), _.handle("embedded-browser:cleanup-download-file", async (o, t) => {
    try {
      return await Re(t);
    } catch {
      return !1;
    }
  }), _.handle("embedded-browser:deactivate", (o) => {
    const t = R.fromWebContents(o.sender) ?? g;
    !t || t.isDestroyed() || p(t);
  }), _.handle("embedded-browser:close-all", (o) => {
    const t = R.fromWebContents(o.sender) ?? g;
    !t || t.isDestroyed() || (Array.from(F.keys()).forEach((r) => {
      w(t, r);
    }), B = null, e({ state: "idle" }));
  });
}
function Ae() {
  if (g && !g.isDestroyed())
    return g.show(), g.focus(), g;
  const e = Pe(), n = xt(), s = (n == null ? void 0 : n.width) ?? Dt, a = (n == null ? void 0 : n.height) ?? Tt, i = new R({
    width: s,
    height: a,
    minWidth: oe,
    minHeight: se,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...U(n == null ? void 0 : n.x) && U(n == null ? void 0 : n.y) ? { x: n.x, y: n.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: y.join(vt, "preload.mjs"),
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
  return g = i, n != null && n.maximized && i.maximize(), i.on("move", () => {
    Z(i);
  }), i.on("resize", () => {
    Z(i);
  }), i.on("maximize", () => {
    Z(i);
  }), i.on("unmaximize", () => {
    Z(i);
  }), i.on("close", (d) => {
    ie(i), process.platform === "darwin" && !Me && (d.preventDefault(), i.hide());
  }), i.on("closed", () => {
    g === i && (g = null);
  }), i.webContents.on("before-input-event", (d, m) => {
    Lt(m) && (d.preventDefault(), i.webContents.toggleDevTools());
  }), J ? i.loadURL(J) : i.loadFile(y.join(Ce, "index.html")), i;
}
T.on("before-quit", () => {
  Me = !0, g && !g.isDestroyed() && ie(g);
});
T.on("window-all-closed", () => {
  process.platform !== "darwin" && T.quit();
});
T.on("activate", () => {
  if (g && !g.isDestroyed()) {
    g.isMinimized() && g.restore(), g.show(), g.focus();
    return;
  }
  R.getAllWindows().length === 0 && Ae();
});
T.whenReady().then(() => {
  const e = Pe();
  e && process.platform === "darwin" && T.dock.setIcon(e), yt({
    emitDownload: Mt,
    resolveTabIdByWebContents: Bt
  }), ft(), Ut(), Ae();
});
export {
  vt as MAIN_DIST,
  Ce as RENDERER_DIST,
  J as VITE_DEV_SERVER_URL
};
