import { dialog as te, app as W, net as Gt, ipcMain as D, session as Se, webContents as Xt, BrowserWindow as z, WebContentsView as Zt, screen as Yt } from "electron";
import { fileURLToPath as Qt } from "node:url";
import T from "node:path";
import je, { existsSync as Fe, mkdirSync as Je, constants as er, readFileSync as tr, writeFileSync as rr } from "node:fs";
import H from "fs/promises";
import De, { mkdtemp as nr, writeFile as or, rm as ir, access as ar } from "node:fs/promises";
import yt from "node:http";
import bt from "node:https";
import ht from "os";
import Ge from "child_process";
import sr from "fs";
import { Buffer as wt } from "node:buffer";
import { spawn as St } from "node:child_process";
import cr from "node:os";
const Ce = 6e4;
async function Xe(e, t, r = {}, n = 0) {
  const i = new URL(e);
  if (i.protocol !== "http:" && i.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${i.protocol}`);
  const d = i.protocol === "https:" ? bt : yt;
  await De.mkdir(T.dirname(t), { recursive: !0 }), await new Promise((p, w) => {
    let b = !1;
    const y = () => {
      b || (b = !0, p());
    }, v = (R) => {
      b || (b = !0, w(R));
    }, h = d.request({
      protocol: i.protocol,
      hostname: i.hostname,
      port: i.port ? Number(i.port) : void 0,
      path: `${i.pathname}${i.search}`,
      method: "GET",
      headers: r
    }, (R) => {
      R.setTimeout(Ce, () => {
        R.destroy(new Error(`下载响应超时: ${Ce}ms`));
      });
      const U = Number(R.statusCode || 0), F = R.headers.location;
      if (U >= 300 && U < 400 && F) {
        if (R.resume(), n >= 3) {
          v(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const s = new URL(F, e).toString();
        Xe(s, t, r, n + 1).then(y).catch(v);
        return;
      }
      if (U >= 400) {
        R.resume(), v(new Error(`下载失败: HTTP ${U} (${e})`));
        return;
      }
      const j = je.createWriteStream(t), u = async (s) => {
        try {
          j.destroy();
        } catch {
        }
        try {
          await De.rm(t, { force: !0 });
        } catch {
        }
        v(s);
      };
      R.on("error", (s) => {
        u(s);
      }), j.on("error", (s) => {
        u(s);
      }), j.on("finish", () => y()), R.pipe(j);
    });
    h.setTimeout(Ce, () => {
      h.destroy(new Error(`下载请求超时: ${Ce}ms`));
    }), h.on("error", (R) => v(R)), h.end();
  });
}
const dr = "Omniflow Inbox", ur = 10 * 60 * 1e3, lr = 2, fr = 2e3, Ve = 12, mr = T.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), he = /* @__PURE__ */ new Map();
function Ze(e) {
  const t = String(e || "");
  return !!(!t || t === ".DS_Store" || t.startsWith("._") || t === "Thumbs.db");
}
function we(e) {
  return e.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function pr(e) {
  const t = String(e || "").toLowerCase();
  return !t || t.startsWith(".") ? !0 : t.endsWith(".crdownload") || t.endsWith(".part") || t.endsWith(".tmp") || t.endsWith(".opdownload") || t.endsWith(".download");
}
function vt() {
  return T.join(W.getPath("userData"), "auto-import-staging");
}
function gr() {
  return T.join(W.getPath("userData"), "embedded-browser-downloads");
}
function Et(e, t) {
  const r = T.resolve(e), n = T.resolve(t);
  return r === n ? !0 : r.startsWith(`${n}${T.sep}`);
}
function yr(e) {
  const t = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
async function br(e, t) {
  try {
    await H.rename(e, t);
  } catch (r) {
    if ((r == null ? void 0 : r.code) !== "EXDEV")
      throw r;
    await H.copyFile(e, t), await H.rm(e, { force: !0 });
  }
}
function hr(e) {
  const t = Date.now();
  for (const [r, n] of he.entries())
    e.has(r) || t - n.lastSeenAt <= ur || he.delete(r);
}
async function wr(e, t = Ve) {
  const r = String(e || "").trim(), n = r ? T.resolve(r) : T.join(W.getPath("downloads"), dr), o = await H.stat(n).catch(() => null);
  if (!(o != null && o.isDirectory()))
    return [];
  const i = await H.readdir(n, { withFileTypes: !0 }), d = /* @__PURE__ */ new Set(), p = Date.now(), w = [];
  for (const h of i) {
    if (!h.isFile() || Ze(h.name) || pr(h.name)) continue;
    const R = T.join(n, h.name), U = await H.stat(R).catch(() => null);
    if (!(U != null && U.isFile())) continue;
    d.add(R);
    const F = he.get(R), u = (F ? F.size === U.size && F.mtimeMs === U.mtimeMs : !1) && F ? F.stableCount + 1 : 1;
    he.set(R, {
      size: U.size,
      mtimeMs: U.mtimeMs,
      stableCount: u,
      lastSeenAt: p
    }), !(u < lr) && (p - U.mtimeMs < fr || w.push({
      sourcePath: R,
      name: h.name,
      size: U.size,
      mtimeMs: U.mtimeMs
    }));
  }
  if (hr(d), w.length === 0)
    return [];
  w.sort((h, R) => h.mtimeMs - R.mtimeMs);
  const b = vt();
  await H.mkdir(b, { recursive: !0 });
  const y = [], v = Math.max(1, Math.floor(Number(t) || Ve));
  for (const h of w.slice(0, v)) {
    const R = T.join(b, yr(h.name));
    try {
      await br(h.sourcePath, R);
    } catch {
      continue;
    }
    he.delete(h.sourcePath), y.push({
      name: h.name,
      size: h.size,
      localPath: R,
      relativePath: we(h.name)
    });
  }
  return y;
}
async function Sr(e) {
  const t = T.resolve(String(e || "").trim()), r = vt();
  return !t || !Et(t, r) ? !1 : (await H.rm(t, { force: !0 }), !0);
}
function it(e, t) {
  const r = we(t || "");
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
function Ct(e, t) {
  return e.relativePath.localeCompare(t.relativePath, "zh-Hans-CN");
}
async function vr(e) {
  return (await Promise.all(e.map(async (r) => {
    const n = await H.stat(r);
    if (!n.isFile())
      return null;
    const o = T.basename(r);
    return Ze(o) ? null : {
      name: o,
      size: n.size,
      localPath: r,
      relativePath: we(o)
    };
  }))).filter((r) => !!r).sort(Ct);
}
async function Er(e, t, r) {
  const n = [t], o = [];
  for (; n.length > 0; ) {
    const y = n.pop(), v = await H.readdir(y, { withFileTypes: !0 });
    for (const h of v) {
      if (h.name === "." || h.name === ".." || Ze(h.name) || h.isSymbolicLink())
        continue;
      const R = T.join(y, h.name);
      if (h.isDirectory()) {
        n.push(R);
        continue;
      }
      h.isFile() && o.push({
        absolutePath: R,
        name: h.name
      });
    }
  }
  const i = [], d = 48;
  let p = 0;
  const w = async () => {
    for (; p < o.length; ) {
      const y = p;
      if (p += 1, y >= o.length)
        return;
      const v = o[y], h = await H.stat(v.absolutePath).catch(() => null);
      if (!(h != null && h.isFile()))
        continue;
      const R = we(T.relative(e, v.absolutePath)), U = we(T.join(r, R));
      i.push({
        name: v.name,
        size: h.size,
        localPath: v.absolutePath,
        relativePath: U
      });
    }
  }, b = Math.min(d, Math.max(1, o.length));
  return await Promise.all(Array.from({ length: b }, () => w())), i;
}
async function Cr(e) {
  const t = [];
  for (const r of e) {
    if (!(await H.stat(r)).isDirectory())
      continue;
    const o = T.basename(r), i = await Er(r, r, o);
    t.push(...i);
  }
  return t.sort(Ct);
}
function Tr(e) {
  e.handle("file:open", async () => {
    const t = await te.showOpenDialog({
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
      content: await H.readFile(r, "utf-8"),
      filePath: r
    };
  }), e.handle("file:save", async (t, r, n) => (await H.writeFile(r, n, "utf-8"), !0)), e.handle("file:read-text", async (t, r) => {
    const n = T.resolve(String(r || "").trim());
    return {
      canceled: !1,
      content: await H.readFile(n, "utf-8"),
      filePath: n
    };
  }), e.handle("file:read-local-chrome-bookmarks", async () => {
    const t = T.join(W.getPath("home"), mr);
    return {
      canceled: !1,
      content: await H.readFile(t, "utf-8"),
      filePath: t
    };
  }), e.handle("dialog:pick-upload-files", async () => {
    const t = await te.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await vr(t.filePaths) };
  }), e.handle("dialog:pick-upload-folders", async () => {
    const t = await te.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Cr(t.filePaths) };
  }), e.handle("dialog:pick-download-directory", async () => {
    const t = await te.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("dialog:save-download-file", async (t, r) => {
    const n = await te.showSaveDialog({
      defaultPath: String(r || "download"),
      showsTagField: !1
    });
    return n.canceled || !n.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: n.filePath };
  }), e.handle("dialog:pick-auto-import-directory", async () => {
    const t = await te.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return t.canceled || t.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: t.filePaths[0] };
  }), e.handle("fs:claim-auto-import-files", async (t, r, n = Ve) => ({ canceled: !1, files: await wr(r, n) })), e.handle("fs:cleanup-auto-import-staged-file", async (t, r) => {
    try {
      return await Sr(r);
    } catch {
      return !1;
    }
  }), e.handle("fs:ensure-directory", async (t, r, n = "") => {
    const o = it(r, n);
    return await H.mkdir(o, { recursive: !0 }), o;
  }), e.handle("fs:download-url-to-path", async (t, r, n, o, i = {}) => {
    const d = it(n, o);
    return await Xe(r, d, i), d;
  }), e.handle("fs:save-staged-download-file", async (t, r, n) => {
    const o = T.resolve(String(r || "").trim()), i = T.resolve(String(n || "").trim()), d = gr();
    if (!o || !Et(o, d))
      throw new Error("无效的下载临时文件");
    if (!i)
      throw new Error("无效的保存路径");
    return await H.mkdir(T.dirname(i), { recursive: !0 }), await H.copyFile(o, i), i;
  });
}
var J = {}, ne = ht;
J.platform = function() {
  return process.platform;
};
J.cpuCount = function() {
  return ne.cpus().length;
};
J.sysUptime = function() {
  return ne.uptime();
};
J.processUptime = function() {
  return process.uptime();
};
J.freemem = function() {
  return ne.freemem() / (1024 * 1024);
};
J.totalmem = function() {
  return ne.totalmem() / (1024 * 1024);
};
J.freememPercentage = function() {
  return ne.freemem() / ne.totalmem();
};
J.freeCommand = function(e) {
  Ge.exec("free -m", function(t, r, n) {
    var o = r.split(`
`), i = o[1].replace(/[\s\n\r]+/g, " "), d = i.split(" ");
    total_mem = parseFloat(d[1]), free_mem = parseFloat(d[3]), buffers_mem = parseFloat(d[5]), cached_mem = parseFloat(d[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
J.harddrive = function(e) {
  Ge.exec("df -k", function(t, r, n) {
    var o = 0, i = 0, d = 0, p = r.split(`
`), w = p[1].replace(/[\s\n\r]+/g, " "), b = w.split(" ");
    o = Math.ceil(b[1] * 1024 / Math.pow(1024, 2)), i = Math.ceil(b[2] * 1024 / Math.pow(1024, 2)), d = Math.ceil(b[3] * 1024 / Math.pow(1024, 2)), e(o, d, i);
  });
};
J.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), Ge.exec(command, function(r, n, o) {
    var i = n.split(`
`);
    i.shift(), i.pop();
    var d = "";
    i.forEach(function(p, w) {
      var b = p.replace(/[\s\n\r]+/g, " ");
      b = b.split(" "), d += b[1] + " " + b[2] + " " + b[3] + " " + b[4].substring(b[4].length - 25) + `
`;
    }), t(d);
  });
};
J.allLoadavg = function() {
  var e = ne.loadavg();
  return e[0].toFixed(4) + "," + e[1].toFixed(4) + "," + e[2].toFixed(4);
};
J.loadavg = function(e) {
  (e === void 0 || e !== 5 && e !== 15) && (e = 1);
  var t = ne.loadavg(), r = 0;
  return e == 1 && (r = t[0]), e == 5 && (r = t[1]), e == 15 && (r = t[2]), r;
};
J.cpuFree = function(e) {
  Tt(e, !0);
};
J.cpuUsage = function(e) {
  Tt(e, !1);
};
function Tt(e, t) {
  var r = at(), n = r.idle, o = r.total;
  setTimeout(function() {
    var i = at(), d = i.idle, p = i.total, w = d - n, b = p - o, y = w / b;
    e(t === !0 ? y : 1 - y);
  }, 1e3);
}
function at(e) {
  var t = ne.cpus(), r = 0, n = 0, o = 0, i = 0, d = 0, w = 0;
  for (var p in t)
    r += t[p].times.user, n += t[p].times.nice, o += t[p].times.sys, d += t[p].times.irq, i += t[p].times.idle;
  var w = r + n + o + i + d;
  return {
    idle: i,
    total: w
  };
}
const Rr = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", be = (e, ...t) => {
  Rr && console[e](...t);
}, A = {
  debug: (...e) => be("debug", ...e),
  info: (...e) => be("info", ...e),
  log: (...e) => be("log", ...e),
  warn: (...e) => be("warn", ...e),
  error: (...e) => be("error", ...e)
};
function Br() {
  const e = Mr().total, t = ht.cpus()[0].model, r = Math.floor(J.totalmem() / 1024);
  return {
    totalStorage: e,
    cpuModel: t,
    totalMemoryGB: r
  };
}
function Mr() {
  const e = sr.statfsSync(process.platform === "win32" ? "C:" : "/"), t = e.blocks * e.bsize, r = e.bfree * e.bsize;
  return {
    total: Math.floor(t / 1e9),
    // 换算为 GB
    usage: 1 - r / t
    // 使用率计算
  };
}
function Or(e) {
  e.handle("sys:get-static-data", Br);
}
const _r = 10 * 1024 * 1024 * 1024, xr = "10GB", Dr = `上传失败：单文件最大支持 ${xr}`;
function Rt(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Pr(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (t) => `%${t.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Ir(e) {
  const t = Rt(e), r = Pr(e);
  return `Content-Disposition: form-data; name="file"; filename="${t}"; filename*=UTF-8''${r}\r
`;
}
function Ur(e) {
  const t = /* @__PURE__ */ new Map(), r = (n, o = !1) => {
    const i = Date.now();
    if (!o && i - n.lastProgressAt < 80) return;
    n.lastProgressAt = i;
    const d = Math.max(i - n.startedAt, 1), p = Math.floor(n.uploadedBytes * 1e3 / d), w = n.totalBytes > 0 ? Math.min(n.uploadedBytes / n.totalBytes * 100, 100) : 0;
    n.sender.send("http:upload:progress", {
      uploadId: n.uploadId,
      uploadedBytes: n.uploadedBytes,
      totalBytes: n.totalBytes,
      percentage: w,
      speedBps: p
    });
  };
  e.handle("http:fetch", async (n, o, i = {}) => (A.debug("http:fetch start"), A.debug("http:fetch URL:", o), A.debug("http:fetch options:", i), new Promise((d, p) => {
    const w = Gt.request({ url: o, method: i.method || "GET" });
    i.headers && Object.entries(i.headers).forEach(([y, v]) => {
      A.debug(`http:fetch set header ${y}: ${String(v)}`), w.setHeader(y, v);
    });
    let b = "";
    w.on("response", (y) => {
      A.debug("http:fetch response"), A.debug("http:fetch status:", y.statusCode), A.debug("http:fetch headers:", y.headers), y.on("data", (v) => {
        A.debug(`http:fetch chunk length: ${v.length}`), b += v;
      }), y.on("end", () => {
        A.debug("http:fetch body preview:", b.slice(0, 500));
        let v;
        try {
          v = JSON.parse(b);
        } catch {
          v = b;
        }
        d({
          status: y.statusCode,
          headers: y.headers,
          body: v
        });
      });
    }), w.on("error", (y) => {
      A.error("http:fetch error:", y), p(y);
    }), i.body && w.write(i.body), w.end();
  }))), e.handle("http:upload:abort", async (n, o) => {
    const i = t.get(o);
    if (!i) return !1;
    i.aborted = !0, t.delete(o);
    try {
      i.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      i.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (n, o, i, d = {}, p = {}, w) => new Promise((b, y) => {
    let v;
    try {
      v = je.statSync(i);
    } catch (g) {
      y(new Error(`读取上传文件失败: ${i} (${String(g)})`));
      return;
    }
    if (!v.isFile()) {
      y(new Error(`上传目标不是文件: ${i}`));
      return;
    }
    if (v.size > _r) {
      y(new Error(Dr));
      return;
    }
    const h = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), R = w || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, U = T.basename(i), F = Object.entries(d).map(([g, B]) => `--${h}\r
Content-Disposition: form-data; name="${Rt(g)}"\r
\r
${B}\r
`).join(""), j = `--${h}\r
` + Ir(U) + `Content-Type: application/octet-stream\r
\r
`, u = `\r
--${h}--\r
`, s = Buffer.byteLength(F) + Buffer.byteLength(j) + v.size + Buffer.byteLength(u), E = {
      ...p,
      "Content-Type": `multipart/form-data; boundary=${h}`,
      "Content-Length": String(s)
    }, x = new URL(o), P = (x.protocol === "https:" ? bt : yt).request({
      protocol: x.protocol,
      hostname: x.hostname,
      port: x.port ? Number(x.port) : void 0,
      path: `${x.pathname}${x.search}`,
      method: "POST",
      headers: E
    }), q = je.createReadStream(i, {
      highWaterMark: 1024 * 1024
    }), L = {
      uploadId: R,
      request: P,
      fileStream: q,
      sender: n.sender,
      totalBytes: Math.max(0, v.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(R, L);
    let Z = !1;
    const ue = (g) => {
      Z || (Z = !0, t.delete(R), b(g));
    }, f = (g) => {
      Z || (Z = !0, t.delete(R), y(g));
    };
    let m = "";
    P.on("response", (g) => {
      g.on("data", (B) => {
        m += B.toString();
      }), g.on("end", () => {
        let B;
        try {
          B = JSON.parse(m);
        } catch {
          B = m;
        }
        ue({
          status: g.statusCode,
          body: B
        });
      });
    }), P.on("error", (g) => {
      if (L.aborted) {
        f(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        q.destroy(g);
      } catch {
      }
      f(g);
    }), P.write(F), P.write(j), q.on("data", (g) => {
      L.aborted || (L.uploadedBytes += g.length, r(L));
    }), q.on("end", () => {
      L.aborted || (r(L, !0), P.write(u), P.end());
    }), q.on("error", (g) => {
      if (L.aborted) {
        f(new Error("UPLOAD_ABORTED"));
        return;
      }
      f(g);
      try {
        P.destroy(g);
      } catch {
      }
    }), q.pipe(P, { end: !1 });
  }));
}
function Fr() {
  Tr(D), Or(D), Ur(D);
}
function kr() {
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
function Ar(e) {
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
function Lr(e) {
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
function Bt(e) {
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
async function Wr(e) {
  const t = await e(kr());
  return Bt(t);
}
async function Nr(e, t) {
  const r = await e(
    Ar(t)
  );
  return Bt(r);
}
async function $r(e, t) {
  return !!await e(
    Lr(t)
  );
}
function Hr(e) {
  D.handle("embedded-browser:open-tab", async (t, r, n) => e.openTab(t.sender, r, n)), D.handle("embedded-browser:activate-tab", (t, r) => e.activateTab(t.sender, r)), D.handle("embedded-browser:navigate", async (t, r, n) => e.navigate(t.sender, r, n)), D.handle("embedded-browser:resolve-favicon", async (t, r) => e.resolveFavicon(r)), D.handle(
    "embedded-browser:open-mapped-file",
    async (t, r, n, o, i) => e.openMappedFile(t.sender, r, n, o, i)
  ), D.handle("embedded-browser:reload", async (t, r) => e.reload(r)), D.handle("embedded-browser:go-back", async (t, r) => e.goBack(r)), D.handle("embedded-browser:go-forward", async (t, r) => e.goForward(r)), D.handle("embedded-browser:resource:list", (t, r) => e.listCapturedResources(r)), D.handle("embedded-browser:resource:start", (t, r) => e.startCapturedResources(r)), D.handle("embedded-browser:resource:stop", (t, r) => e.stopCapturedResources(r)), D.handle("embedded-browser:resource:clear", (t, r) => e.clearCapturedResources(r)), D.handle("embedded-browser:resource:open", async (t, r, n) => e.openResource(r, n)), D.handle("embedded-browser:resource:export", async (t, r, n) => e.exportResource(r, n)), D.handle("embedded-browser:resource:read", async (t, r, n) => e.readResource(r, n)), D.handle(
    "embedded-browser:resource:preview",
    async (t, r, n) => e.previewResource(r, n)
  ), D.handle("embedded-browser:resource:catch-toolkit:get-state", async (t, r) => e.getCatchToolkitState(r)), D.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (t, r, n) => e.updateCatchToolkitState(r, n)
  ), D.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (t, r) => e.clearCatchMediaCache(r)), D.handle("embedded-browser:resource:catch-toolkit:download", async (t, r) => e.downloadCatchMedia(r)), D.handle("embedded-browser:resource:catch-toolkit:restart", async (t, r) => e.restartCatchMediaCapture(r)), D.handle(
    "embedded-browser:resource:merge-mse",
    async (t, r, n) => e.mergeMseResources(r, n)
  ), D.handle("embedded-browser:resource:start-deep-capture", async (t, r) => e.startDeepResourceCapture(r)), D.handle("embedded-browser:set-bounds", (t, r) => e.setBounds(t.sender, r)), D.handle("embedded-browser:close-tab", (t, r) => e.closeTab(t.sender, r)), D.handle("embedded-browser:cleanup-download-file", async (t, r) => e.cleanupDownloadFile(r)), D.handle("embedded-browser:deactivate", (t) => e.deactivate(t.sender)), D.handle("embedded-browser:close-all", (t) => e.closeAll(t.sender));
}
const ve = "persist:omniflow-embedded-browser", zr = "embedded-browser-downloads";
let Ne = null, st = !1;
function Mt() {
  return T.join(W.getPath("userData"), zr);
}
function jr() {
  const e = Mt();
  return Fe(e) || Je(e, { recursive: !0 }), e;
}
function Vr() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function qr(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function Te(e, t) {
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
function Kr() {
  return Ne || (Ne = Se.fromPartition(ve)), Ne;
}
async function Ot(e) {
  const t = T.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const r = T.resolve(Mt());
  return t !== r && !t.startsWith(`${r}${T.sep}`) ? !1 : (await De.rm(t, { force: !0 }), !0);
}
function Jr(e) {
  if (st)
    return;
  st = !0;
  const t = (o, i, d) => {
    const p = e.resolveTabIdByWebContents(d) || void 0;
    if (!p)
      return;
    const w = jr(), b = Vr(), y = i.getFilename() || "download", v = i.getURL() || "", h = d.getURL() || void 0, R = T.join(w, qr(y));
    i.setSavePath(R), e.emitDownload(Te(i, {
      downloadId: b,
      fileName: y,
      mimeType: i.getMimeType() || void 0,
      pageUrl: h,
      state: "started",
      tabId: p,
      tempPath: R,
      url: v
    })), i.on("updated", (U, F) => {
      F === "progressing" && e.emitDownload(Te(i, {
        downloadId: b,
        fileName: y,
        mimeType: i.getMimeType() || void 0,
        pageUrl: h,
        state: "progress",
        tabId: p,
        tempPath: R,
        url: v
      }));
    }), i.once("done", (U, F) => {
      if (F === "completed") {
        e.emitDownload(Te(i, {
          downloadId: b,
          fileName: y,
          mimeType: i.getMimeType() || void 0,
          pageUrl: h,
          state: "completed",
          tabId: p,
          tempPath: R,
          url: v
        }));
        return;
      }
      Ot(R).catch(() => {
      }), e.emitDownload(Te(i, {
        downloadId: b,
        error: F === "cancelled" ? "下载已取消" : `下载失败：${F}`,
        fileName: y,
        mimeType: i.getMimeType() || void 0,
        pageUrl: h,
        state: F === "cancelled" ? "cancelled" : "failed",
        tabId: p,
        tempPath: R,
        url: v
      }));
    });
  }, r = /* @__PURE__ */ new Set();
  [Se.defaultSession, Kr()].filter(Boolean).forEach((o) => {
    r.has(o) || (r.add(o), o.on("will-download", t));
  });
}
const Gr = [
  "m3u8",
  "m3u",
  "mpd"
], Xr = [
  "flv",
  "hlv",
  "f4v",
  "mp4",
  "m4v",
  "m4a",
  "m4s",
  "mp3",
  "wma",
  "wav",
  "aac",
  "flac",
  "ts",
  "webm",
  "ogg",
  "oga",
  "ogv",
  "mov",
  "mkv",
  "mpeg",
  "avi",
  "wmv",
  "asf",
  "movie",
  "divx",
  "mpeg4",
  "vid",
  "weba",
  "opus",
  "acc",
  "3gp"
], Zr = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico"
], Yr = [
  "vtt",
  "srt",
  "ass",
  "ssa",
  "ttml"
], Qr = [
  "key",
  "base64key"
], en = [
  "application/ogg",
  "application/m4s"
], tn = [
  "mpegurl",
  "dash+xml"
], rn = [
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
], nn = new Set(Gr), on = new Set(Xr), an = new Set(Zr), sn = new Set(Yr), cn = new Set(Qr), dn = new Set(en), un = new Set(rn);
function ln(e) {
  return tn.some((t) => e.includes(t));
}
function fn(e) {
  return e.startsWith("video/") || e.startsWith("audio/") || dn.has(e);
}
function mn(e) {
  return nn.has(e) ? "manifest" : on.has(e) ? "media" : an.has(e) ? "image" : sn.has(e) ? "subtitle" : cn.has(e) ? "key" : null;
}
function $e(e, t) {
  if (!e)
    return "";
  const r = t.toLowerCase();
  for (const [n, o] of Object.entries(e))
    if (n.toLowerCase() === r)
      return Array.isArray(o) ? String(o[0] || "") : String(o || "");
  return "";
}
function ke(e) {
  var t;
  return ((t = String(e || "").split(";")[0]) == null ? void 0 : t.trim().toLowerCase()) || "";
}
function Ye(e) {
  try {
    const r = new URL(e).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (r == null ? void 0 : r[1]) || "";
  } catch {
    const t = String(e || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (t == null ? void 0 : t[1]) || "";
  }
}
function _t(e) {
  const t = ke(e.mimeType), r = Ye(e.url), n = mn(r);
  return n === "manifest" || ln(t) ? "manifest" : n === "media" || fn(t) || e.resourceType === "media" || String(e.url || "").startsWith("blob:") ? "media" : n === "image" || t.startsWith("image/") ? "image" : n === "subtitle" || t.includes("text/vtt") ? "subtitle" : r === "pdf" || t === "application/pdf" ? "document" : n === "key" || e.resourceType === "key" || t === "application/octet-stream" ? "key" : "other";
}
function xt(e) {
  return !e.url || e.url.startsWith("data:") ? !1 : e.kind !== "other" ? !0 : e.resourceType === "media" || e.url.startsWith("blob:");
}
function pn(e) {
  const t = Number(e);
  return Number.isFinite(t) && t > 0 ? t : void 0;
}
function gn(e) {
  const t = String(e || "").trim();
  if (!t)
    return;
  const r = t.match(/\/(\d+)\s*$/);
  if (!(r != null && r[1]))
    return;
  const n = Number(r[1]);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
function Dt(e) {
  if (e.streamType)
    return e.streamType;
  const t = ke(e.mimeType);
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
function yn(e) {
  if (!e)
    return;
  const t = {};
  return Object.entries(e).forEach(([r, n]) => {
    const o = r.toLowerCase();
    if (!un.has(o))
      return;
    const i = String(n || "").trim();
    i && (t[o] = i);
  }), Object.keys(t).length ? t : void 0;
}
const Pe = /* @__PURE__ */ new Map();
let xe = null;
function pe() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function Ae(e) {
  const t = String(e || "").trim();
  if (!t)
    return null;
  const r = Pe.get(t);
  if (r)
    return r;
  const n = pe();
  return Pe.set(t, n), n;
}
function Ee(e) {
  const t = String(e || "").trim();
  return t && Pe.get(t) || null;
}
function Pt(e, t, r, n) {
  return n ? `${e}::${t}::${n}` : `${e}::${t}::${r}`;
}
function bn(e, t, r, n) {
  return Pt(e, t, r, n);
}
function hn(e) {
  return Array.from(e.values()).sort((t, r) => r.capturedAt - t.capturedAt);
}
function re(e) {
  return {
    deepCaptureEnabled: e.deepCaptureEnabled,
    enabled: e.enabled,
    resources: hn(e.resources)
  };
}
function wn(e) {
  xe = e;
}
function It(e, t) {
  const r = Ee(e);
  if (!(r != null && r.enabled))
    return null;
  const n = String(t.url || "").trim();
  if (!n)
    return null;
  const o = String(t.resourceKey || "").trim() || void 0, i = Pt(e, t.source, n, o), d = r.resources.get(i), p = {
    ...d,
    ...t,
    ext: t.ext || (d == null ? void 0 : d.ext) || Ye(n) || void 0,
    id: bn(e, t.source, n, o),
    kind: t.kind,
    resourceKey: o,
    tabId: e,
    url: n
  };
  return JSON.stringify(d) !== JSON.stringify(p) ? (r.resources.set(i, p), xe == null || xe(p), p) : d || null;
}
function Sn(e) {
  const t = Ee(e);
  return re(t || pe());
}
function vn(e) {
  const t = Ae(e);
  return t ? (t.enabled = !0, re(t)) : re(pe());
}
function En(e) {
  const t = Ae(e);
  return t ? (t.enabled = !0, t.deepCaptureEnabled = !0, re(t)) : re(pe());
}
function Cn(e) {
  const t = Ae(e);
  return t ? (t.enabled = !1, t.deepCaptureEnabled = !1, re(t)) : re(pe());
}
function Tn(e) {
  const t = Ae(e);
  return t ? (t.resources.clear(), re(t)) : re(pe());
}
function ct(e) {
  Pe.delete(String(e || "").trim());
}
function Rn(e) {
  var t;
  return !!((t = Ee(e)) != null && t.deepCaptureEnabled);
}
const ce = /* @__PURE__ */ new Map();
let dt = !1;
function Bn(e) {
  dt || (dt = !0, wn(e.emitResource), e.browserSession.webRequest.onBeforeSendHeaders((t, r) => {
    ce.set(t.id, {
      referer: t.referrer || void 0,
      requestHeaders: yn(t.requestHeaders)
    }), r({ cancel: !1, requestHeaders: t.requestHeaders });
  }), e.browserSession.webRequest.onCompleted((t) => {
    if (!t.webContentsId) {
      ce.delete(t.id);
      return;
    }
    const r = e.resolveTabIdByWebContentsId(t.webContentsId), n = r ? Ee(r) : null;
    if (!r || !(n != null && n.enabled)) {
      ce.delete(t.id);
      return;
    }
    if (t.statusCode < 200 || t.statusCode >= 400) {
      ce.delete(t.id);
      return;
    }
    const o = Xt.fromId(t.webContentsId), i = String(t.url || "").trim(), d = ce.get(t.id), p = ke($e(t.responseHeaders, "content-type")), w = _t({
      mimeType: p,
      resourceType: t.resourceType,
      url: i
    });
    if (!xt({ kind: w, resourceType: t.resourceType, url: i })) {
      ce.delete(t.id);
      return;
    }
    It(r, {
      capturedAt: Date.now(),
      contentLength: gn($e(t.responseHeaders, "content-range")) || pn($e(t.responseHeaders, "content-length")),
      ext: Ye(i) || void 0,
      kind: w,
      method: t.method || void 0,
      mimeType: p,
      pageUrl: (o == null ? void 0 : o.getURL()) || void 0,
      referer: (d == null ? void 0 : d.referer) || t.referrer || void 0,
      requestHeaders: d == null ? void 0 : d.requestHeaders,
      resourceType: t.resourceType || void 0,
      source: "network",
      statusCode: t.statusCode || void 0,
      streamType: Dt({
        mimeType: p,
        resourceType: t.resourceType,
        url: i
      }),
      url: i
    }), ce.delete(t.id);
  }), e.browserSession.webRequest.onErrorOccurred((t) => {
    ce.delete(t.id);
  }));
}
function Mn(e, t) {
  const r = Ee(e);
  if (!(r != null && r.enabled) || !r.deepCaptureEnabled)
    return null;
  const n = String(t.url || "").trim();
  if (!n)
    return null;
  const o = t.kind || _t({
    mimeType: t.mimeType,
    resourceType: t.resourceType,
    url: n
  });
  return xt({ kind: o, resourceType: t.resourceType, url: n }) ? It(e, {
    capturedAt: Number(t.capturedAt) || Date.now(),
    contentLength: t.contentLength,
    ext: t.ext,
    kind: o,
    method: t.method,
    mimeType: ke(t.mimeType),
    pageUrl: t.pageUrl,
    resourceType: t.resourceType,
    resourceKey: t.resourceKey,
    source: t.source || "probe",
    statusCode: t.statusCode,
    streamType: Dt({
      mimeType: t.mimeType,
      resourceType: t.resourceType,
      streamType: t.streamType,
      url: n
    }),
    url: n
  }) : null;
}
function Ut(e) {
  const t = String(e || "").trim();
  if (!t)
    return "";
  try {
    return new URL(t).origin;
  } catch {
    return "";
  }
}
function On(e) {
  return e === "fileSystem";
}
async function _n(e, t) {
  const r = Ut(t);
  if (!r)
    return !1;
  const n = e.decisionCache.get(r);
  if (typeof n == "boolean")
    return n;
  const o = z.getFocusedWindow() ?? e.options.getMainWindow() ?? z.getAllWindows()[0] ?? void 0, { response: i } = await te.showMessageBox(o, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${r} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), d = i === 1;
  return e.decisionCache.set(r, d), d;
}
async function xn(e, t) {
  const r = Ut(t.origin);
  if (!r)
    return "deny";
  const n = z.getFocusedWindow() ?? e.getMainWindow() ?? z.getAllWindows()[0] ?? void 0, { response: o } = await te.showMessageBox(n, {
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
function Dn(e) {
  const t = Se.fromPartition(ve);
  t.setPermissionRequestHandler((r, n, o, i) => {
    if (!On(String(n))) {
      o(!1);
      return;
    }
    _n(e, i.requestingUrl || "").then((d) => {
      o(d);
    }).catch(() => {
      o(!1);
    });
  }), t.on("file-system-access-restricted", (r, n, o) => {
    r.preventDefault(), xn(e.options, n).then((i) => {
      o(i);
    }).catch(() => {
      o("deny");
    });
  });
}
function Pn(e) {
  Jr({
    emitDownload: e.emitDownload,
    resolveTabIdByWebContents: e.resolveTabIdByWebContents
  }), Bn({
    browserSession: Se.fromPartition(ve),
    emitResource: e.emitResource,
    resolveTabIdByWebContentsId: e.resolveTabIdByWebContentsId
  });
}
async function In(e, t) {
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
function Ft(e, t) {
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
function Un(e, t) {
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
async function kt(e, t) {
  if (!t || t.startsWith("data:"))
    return t;
  try {
    const r = await e.fetch(t);
    if (!r.ok)
      return "";
    const n = wt.from(await r.arrayBuffer());
    return n.length === 0 ? "" : `data:${Un(t, r.headers.get("content-type"))};base64,${n.toString("base64")}`;
  } catch (r) {
    return A.warn("embedded browser favicon load failed", {
      error: r instanceof Error ? r.message : String(r),
      iconUrl: t
    }), "";
  }
}
function Fn(e, t) {
  return kt(e.webContents.session, t);
}
function kn(e, t) {
  const r = [], n = /<link\b[^>]*>/gi, o = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let i;
  for (; i = n.exec(e); ) {
    const d = i[0], p = /* @__PURE__ */ new Map();
    let w;
    for (o.lastIndex = 0; w = o.exec(d); )
      p.set(w[1].toLowerCase(), w[2] || w[3] || w[4] || "");
    const b = p.get("rel") || "", y = p.get("href") || "";
    if (!y || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(b))
      continue;
    const v = Ft(y, t);
    v && r.push(v);
  }
  return r;
}
async function An(e) {
  const t = String((e == null ? void 0 : e.pageUrl) || "").trim(), r = Se.fromPartition(ve), n = [], o = Ft(String((e == null ? void 0 : e.iconUrl) || ""), t || void 0);
  if (o && !o.startsWith("data:") && n.push(o), t) {
    try {
      const d = await r.fetch(t), p = d.headers.get("content-type") || "";
      d.ok && /text\/html|application\/xhtml\+xml/i.test(p) && n.push(...kn(await d.text(), t));
    } catch (d) {
      A.warn("embedded browser favicon page inspect failed", {
        error: d instanceof Error ? d.message : String(d),
        pageUrl: t
      });
    }
    try {
      const d = new URL(t).origin;
      n.push(`${d}/favicon.ico`);
    } catch {
    }
  }
  const i = /* @__PURE__ */ new Set();
  for (const d of n) {
    if (!d || i.has(d))
      continue;
    i.add(d);
    const p = await kt(r, d);
    if (p)
      return {
        dataUrl: p,
        iconUrl: d
      };
  }
  return {
    dataUrl: o.startsWith("data:") ? o : "",
    iconUrl: ""
  };
}
const Ln = "embedded-browser-open-files", ut = 'input[data-omniflow-browser-open-fallback="true"]';
function At() {
  return T.join(W.getPath("userData"), Ln);
}
function Wn() {
  const e = At();
  return Fe(e) || Je(e, { recursive: !0 }), e;
}
function Nn(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function $n(e, t) {
  const r = T.resolve(e), n = T.resolve(t);
  return r === n ? !0 : r.startsWith(`${n}${T.sep}`);
}
async function Hn(e) {
  const t = await e.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${ut}')
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
      return '${ut}'
    })()
  `, !0);
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
async function zn(e, t, r) {
  var p;
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
  }), o = Number(((p = n == null ? void 0 : n.root) == null ? void 0 : p.nodeId) || 0);
  if (!Number.isFinite(o) || o <= 0)
    return !1;
  const i = await e.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: o,
    selector: t
  }), d = Number((i == null ? void 0 : i.nodeId) || 0);
  return !Number.isFinite(d) || d <= 0 ? !1 : (await e.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: d,
    files: r
  }), !0);
}
async function jn(e, t) {
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
async function Vn(e, t, r = {}) {
  const n = Wn(), o = T.join(n, Nn(t));
  return await Xe(e, o, r), o;
}
async function Ie(e) {
  const t = T.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const r = T.resolve(At());
  return $n(t, r) ? (await De.rm(t, { force: !0 }), !0) : !1;
}
async function qn(e, t) {
  if (!e || e.webContents.isDestroyed())
    return !1;
  const r = await Hn(e);
  return !r || !await zn(e, r, [t]) ? !1 : jn(e, r);
}
function Re(e) {
  const t = e.pendingOpenFiles.get(e.tabId);
  t != null && t.stagedPath && Ie(t.stagedPath).catch(() => {
  }), e.pendingOpenFiles.delete(e.tabId);
  const r = e.attachedOpenFiles.get(e.tabId);
  r && Ie(r).catch(() => {
  }), e.attachedOpenFiles.delete(e.tabId);
}
function Be(e) {
  const t = (e.requestVersions.get(e.tabId) ?? 0) + 1;
  return e.requestVersions.set(e.tabId, t), t;
}
function lt(e) {
  return e.requestVersions.get(e.tabId) === e.version;
}
function Kn(e, t) {
  try {
    const r = new URL(e), n = new URL(t);
    if (r.origin !== n.origin)
      return !1;
    const o = r.pathname.replace(/\/+$/, "") || "/", i = n.pathname.replace(/\/+$/, "") || "/";
    return i === "/" ? !0 : o === i || o.startsWith(`${i}/`);
  } catch {
    return !1;
  }
}
async function ft(e) {
  const t = e.pendingOpenFiles.get(e.tabId);
  if (!t || e.view.webContents.isDestroyed())
    return !1;
  const r = e.view.webContents.getURL() || e.currentUrls.get(e.tabId) || "";
  if (!r || !Kn(r, t.pageUrl))
    return !1;
  try {
    if (!await qn(e.view, t.stagedPath))
      return !1;
    const o = e.attachedOpenFiles.get(e.tabId);
    return o && o !== t.stagedPath && Ie(o).catch(() => {
    }), e.attachedOpenFiles.set(e.tabId, t.stagedPath), e.pendingOpenFiles.delete(e.tabId), !0;
  } catch {
    return !1;
  }
}
function Jn(e, t) {
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
function Gn(e) {
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
function Xn(e) {
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
async function mt(e, t, r) {
  const n = String(r || "").trim();
  return n ? !!await e(
    Jn(t, n)
  ) : !1;
}
async function Zn(e, t) {
  return String(t.url || "").trim() ? !!await e(
    Gn(t)
  ) : !1;
}
async function He(e, t) {
  const r = String(t || "").trim();
  if (!r)
    return null;
  const n = await e(
    Xn(r)
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
function Yn() {
  function e(u) {
    if (trackedMediaElements.has(u))
      return;
    trackedMediaElements.add(u), u.addEventListener("progress", () => {
      if (catchToolkitState.autoSeekToBufferedEnd)
        try {
          if (!u.buffered || u.buffered.length === 0)
            return;
          const x = u.buffered.end(u.buffered.length - 1), V = Math.max(x - 5, 0), P = Number.isFinite(u.duration) ? u.duration : 0;
          if (P > 0 && x >= P)
            return;
          Math.abs(u.currentTime - V) > 1 && (u.currentTime = V);
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
    const E = window.setInterval(() => {
      if (autoRestartHandledMediaElements.has(u) || !catchToolkitState.restartAlwaysFromBeginning) {
        window.clearInterval(E);
        return;
      }
      u.paused || (s(), window.clearInterval(E));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(E);
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
        s.addedNodes.forEach((E) => {
          if (E instanceof Element) {
            if (E instanceof HTMLMediaElement) {
              e(E);
              return;
            }
            E.querySelectorAll("video, audio").forEach((x) => {
              x instanceof HTMLMediaElement && e(x);
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
        u = u || s.buffers.length > 0, s.buffers = [], s.bufferCount = 0, s.lastReportedBufferCount = 0, s.lastReportedBytes = 0, s.totalBytes = 0, p(s.streamId);
        return;
      }
      if (s.buffers.length > 1) {
        const E = s.buffers[0];
        s.buffers = E ? [E] : [], s.bufferCount = s.buffers.length, s.totalBytes = (E == null ? void 0 : E.byteLength) || 0, s.lastReportedBufferCount = s.bufferCount, s.lastReportedBytes = s.totalBytes, u = !0, p(s.streamId);
      }
    }), isCaptureComplete = !1, u;
  }
  function o() {
    if (typeof document > "u")
      return !1;
    const u = Array.from(mseStreams.values()).filter((E) => E.buffers.length > 0);
    if (u.length === 0)
      return !1;
    const s = resolveCatchToolkitFileName();
    return u.forEach((E) => {
      const x = normalizeBuffersForPlayback(E.buffers), V = new Blob(x, { type: E.mimeType }), P = document.createElement("a"), q = URL.createObjectURL(V), L = guessExtensionFromMimeType(E.mimeType, E.streamType), Z = u.length > 1 && E.streamType ? `-${E.streamType}` : "";
      P.href = q, P.download = `${s}${Z}.${L}`, P.click(), P.remove(), setTimeout(() => {
        URL.revokeObjectURL(q);
      }, 1e3);
    }), catchToolkitState.clearCacheOnComplete && setTimeout(() => {
      n();
    }, 0), !0;
  }
  function i() {
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
  function d(u) {
    return `mse-stream:${u}`;
  }
  function p(u) {
    const s = mseStreams.get(u);
    s && emit({
      contentLength: s.totalBytes,
      ext: guessExtensionFromMimeType(s.mimeType, s.streamType),
      kind: "media",
      mimeType: s.mimeType,
      resourceKey: d(u),
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
      const E = normalizeBuffersForPlayback(s.buffers);
      return s.blobUrl = URL.createObjectURL(new Blob(E, { type: s.mimeType })), p(u), !0;
    } catch {
      return !1;
    }
  }
  function b(u) {
    const s = mseStreams.get(u);
    return s ? (s.blobUrl || w(u), s.blobUrl) : "";
  }
  function y(u) {
    const s = mseStreams.get(u);
    if (!s)
      return "media.bin";
    const E = resolveCatchToolkitFileName(), x = s.streamType ? `-${s.streamType}` : "", V = guessExtensionFromMimeType(s.mimeType, s.streamType);
    return `${E}${x}.${V}`;
  }
  function v(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), E = b(s);
    if (!E || typeof document > "u")
      return !1;
    const x = document.createElement("a");
    return x.href = E, x.download = y(s), x.click(), x.remove(), catchToolkitState.clearCacheOnComplete && setTimeout(() => {
      n();
    }, 0), !0;
  }
  function h(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), E = b(s);
    return !E || !openWindow ? !1 : (openWindow(E, "_blank", "noopener,noreferrer"), !0);
  }
  async function R(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), E = mseStreams.get(s);
    if (!E || E.buffers.length === 0)
      return null;
    try {
      const x = normalizeBuffersForPlayback(E.buffers), P = await new Blob(x, { type: E.mimeType }).arrayBuffer();
      return {
        base64: arrayBufferToBase64(P),
        fileName: y(s),
        mimeType: E.mimeType,
        resourceKey: u,
        streamType: E.streamType
      };
    } catch {
      return null;
    }
  }
  function U(u) {
    const s = probeResources.get(u);
    return !(s != null && s.blobUrl) || !openWindow ? !1 : (openWindow(s.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function F(u) {
    const s = probeResources.get(u);
    if (!(s != null && s.blobUrl) || typeof document > "u")
      return !1;
    const E = document.createElement("a");
    return E.href = s.blobUrl, E.download = s.fileName, E.click(), E.remove(), !0;
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
      return s.startsWith("mse-stream:") ? v(s) : s.startsWith("probe-resource:") ? F(s) : !1;
    },
    getCatchToolkitState() {
      return buildCatchToolkitState();
    },
    installedAt: Date.now(),
    openResource(u) {
      const s = String(u || "");
      return s.startsWith("mse-stream:") ? h(s) : s.startsWith("probe-resource:") ? U(s) : !1;
    },
    readResource(u) {
      const s = String(u || "");
      return s.startsWith("mse-stream:") ? R(s) : s.startsWith("probe-resource:") ? j(s) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return i();
    },
    seen,
    updateCatchToolkitState(u) {
      return typeof u.autoSeekToBufferedEnd == "boolean" && (catchToolkitState.autoSeekToBufferedEnd = u.autoSeekToBufferedEnd), typeof u.autoDownloadOnComplete == "boolean" && (catchToolkitState.autoDownloadOnComplete = u.autoDownloadOnComplete), typeof u.clearCacheOnComplete == "boolean" && (catchToolkitState.clearCacheOnComplete = u.clearCacheOnComplete), typeof u.manualFileName == "string" && (catchToolkitState.manualFileName = u.manualFileName), typeof u.regexRule == "string" && (catchToolkitState.regexRule = evaluateRegexRule(u.regexRule).rule), typeof u.restartAlwaysFromBeginning == "boolean" && (catchToolkitState.restartAlwaysFromBeginning = u.restartAlwaysFromBeginning), typeof u.selectorRule == "string" && (catchToolkitState.selectorRule = evaluateSelectorRule(u.selectorRule).rule), typeof u.trimExtraMediaHeaders == "boolean" && (catchToolkitState.trimExtraMediaHeaders = u.trimExtraMediaHeaders), persistCatchToolkitState(), isWorkerScope || r(), buildCatchToolkitState();
    }
  };
}
function Qn() {
}
function eo() {
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
  function o(b) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(b) || "").trim();
    } catch {
      return "";
    }
  }
  function i(b, y = !1) {
    try {
      return typeof localStorage > "u" ? y : localStorage.getItem(b) === "checked";
    } catch {
      return y;
    }
  }
  function d(b) {
    var v;
    const y = String(b || "").trim();
    if (!y)
      return {
        rule: "",
        warning: ""
      };
    if (typeof document > "u")
      return {
        rule: y,
        warning: ""
      };
    try {
      const h = document.querySelector(y), R = ((v = h == null ? void 0 : h.textContent) == null ? void 0 : v.trim()) || "";
      return {
        rule: y,
        warning: R ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function p(b) {
    const y = String(b || "").trim();
    if (!y)
      return {
        rule: "",
        warning: ""
      };
    try {
      return new RegExp(y, "g"), {
        rule: y,
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
    t || (n.autoDownloadOnComplete = i(
      r.autoDownloadOnComplete,
      n.autoDownloadOnComplete
    ), n.autoSeekToBufferedEnd = i(
      r.autoSeekToBufferedEnd,
      n.autoSeekToBufferedEnd
    ), n.clearCacheOnComplete = i(
      r.clearCacheOnComplete,
      n.clearCacheOnComplete
    ), n.manualFileName = o(r.manualFileName), n.restartAlwaysFromBeginning = i(
      r.restartAlwaysFromBeginning,
      n.restartAlwaysFromBeginning
    ), n.trimExtraMediaHeaders = i(
      r.trimExtraMediaHeaders,
      n.trimExtraMediaHeaders
    ), n.selectorRule = d(
      o(r.selectorRule)
    ).rule, n.regexRule = p(
      o(r.regexRule)
    ).rule);
  }
  w();
}
function to() {
  var Z, ue;
  const e = globalScope.Worker;
  typeof e == "function" && (globalScope.Worker = new Proxy(e, {
    construct(f, m, g) {
      const [B, C] = m, _ = () => {
        const X = typeof B == "string" ? B : String(B), oe = toAbsoluteUrl(X) || X;
        if (!oe)
          return "";
        const Y = createProbeBootstrapSource(consolePrefix);
        let ie = "";
        if ((C == null ? void 0 : C.type) === "module")
          ie = `${Y}import ${JSON.stringify(oe)};
`;
        else {
          const ee = new XMLHttpRequest();
          if (ee.open("GET", oe, !1), ee.send(), ee.status < 200 || ee.status >= 300 || !ee.responseText)
            return "";
          ie = `${Y}${ee.responseText}`;
        }
        return URL.createObjectURL(new Blob([ie], { type: "text/javascript" }));
      };
      let O = "";
      try {
        O = _();
      } catch {
        O = "";
      }
      const N = O ? Reflect.construct(f, [O, C], g) : Reflect.construct(f, m, g);
      return N.addEventListener("message", (X) => {
        consumeWorkerRelayMessage(X.data) && X.stopImmediatePropagation();
      }, { capture: !0 }), O && setTimeout(() => {
        URL.revokeObjectURL(O);
      }, 6e4), N;
    }
  }), globalScope.Worker.toString = function() {
    return e.toString();
  });
  const t = globalScope.MediaSource;
  if ((Z = t == null ? void 0 : t.prototype) != null && Z.addSourceBuffer) {
    const f = t.prototype.addSourceBuffer;
    t.prototype.addSourceBuffer = new Proxy(f, {
      apply(m, g, B) {
        var _;
        const C = Reflect.apply(m, g, B);
        try {
          ensureTrackedMediaObserver(), isCaptureComplete = !1;
          const O = g, N = String((B == null ? void 0 : B[0]) || "").trim(), X = ((_ = N.split(";")[0]) == null ? void 0 : _.trim().toLowerCase()) || "", oe = X.startsWith("audio/") ? "audio" : X.startsWith("video/") ? "video" : void 0, Y = `${Date.now()}-${++mseSequence}`, ie = mediaSourceStreams.get(O) || [];
          if (ie.push(Y), mediaSourceStreams.set(O, ie), mseStreams.set(Y, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: N || (oe === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: Y,
            streamType: oe,
            totalBytes: 0
          }), emitMseStream(Y), C && typeof C.appendBuffer == "function") {
            const ee = C.appendBuffer;
            C.appendBuffer = new Proxy(ee, {
              apply(Le, We, fe) {
                const ge = Reflect.apply(Le, We, fe), K = mseStreams.get(Y);
                if (!K)
                  return ge;
                const ae = cloneChunk(fe == null ? void 0 : fe[0]);
                return !ae || ae.byteLength === 0 || (K.buffers.push(ae), K.bufferCount += 1, K.totalBytes += ae.byteLength, (K.bufferCount <= 3 || K.bufferCount - K.lastReportedBufferCount >= 8 || K.totalBytes - K.lastReportedBytes >= 1024 * 512) && (K.lastReportedBufferCount = K.bufferCount, K.lastReportedBytes = K.totalBytes, emitMseStream(Y))), ge;
              }
            });
          }
        } catch {
        }
        return C;
      }
    });
  }
  if ((ue = t == null ? void 0 : t.prototype) != null && ue.endOfStream) {
    const f = t.prototype.endOfStream;
    t.prototype.endOfStream = new Proxy(f, {
      apply(m, g, B) {
        const C = Reflect.apply(m, g, B);
        try {
          if (isCaptureComplete = !0, (mediaSourceStreams.get(g) || []).forEach((O) => {
            finalizeMseStream(O);
          }), catchToolkitState.autoDownloadOnComplete)
            return setTimeout(() => {
              downloadCatchMediaInternal();
            }, 500), C;
          catchToolkitState.clearCacheOnComplete && setTimeout(() => {
            clearCatchMediaCacheInternal();
          }, 0);
        } catch {
        }
        return C;
      }
    });
  }
  function r(f, m) {
    if (typeof f != "string")
      return;
    const g = f.trim();
    if (!g || emitKeyCandidateFromBase64(g))
      return;
    const B = g.split("").join("").trim();
    if (emitKeyCandidateFromHex(B))
      return;
    if (dataUrlPattern.test(g)) {
      const N = decodeDataUrlText(g);
      N && r(N, m);
      return;
    }
    const C = parseMaybeJson(g);
    if (C) {
      if (emitVimeoPlaylistManifest((m == null ? void 0 : m.baseUrl) || currentLocationHref, C))
        return;
      n(C, 0, /* @__PURE__ */ new WeakSet(), [], (m == null ? void 0 : m.baseUrl) || currentLocationHref);
      return;
    }
    const _ = g.toUpperCase();
    if (_.startsWith("#EXTM3U") || _.includes("#EXTINF:")) {
      emitInlineManifest(g, "m3u8", m == null ? void 0 : m.baseUrl);
      return;
    }
    if (g.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || g.includes("<MPD") && g.includes("</MPD>")) {
      emitInlineManifest(g, "mpd", m == null ? void 0 : m.baseUrl);
      return;
    }
    const O = toAbsoluteUrl(g);
    O && (registerManifestBaseUrl(O), emit({
      kind: classifyKind(O, m == null ? void 0 : m.mimeType),
      mimeType: m == null ? void 0 : m.mimeType,
      resourceType: m == null ? void 0 : m.resourceType,
      source: "probe",
      streamType: m == null ? void 0 : m.streamType,
      url: O
    }));
  }
  function n(f, m = 0, g = /* @__PURE__ */ new WeakSet(), B = [], C = currentLocationHref) {
    if (m > 6 || f == null)
      return;
    if (f instanceof ArrayBuffer) {
      emitKeyCandidateFromBuffer(f);
      return;
    }
    if (ArrayBuffer.isView(f)) {
      emitKeyCandidateFromBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
      return;
    }
    if (typeof f == "string") {
      r(f, {
        baseUrl: C,
        resourceType: "json",
        streamType: inferStreamTypeFromPath(B)
      });
      return;
    }
    if (typeof f != "object")
      return;
    const _ = f;
    if (!g.has(_)) {
      if (g.add(_), Array.isArray(f)) {
        if (f.length === 16 && f.every((O) => typeof O == "number" && Number.isFinite(O) && O >= 0 && O <= 255)) {
          emitKeyCandidateFromBuffer(Uint8Array.from(f).buffer);
          return;
        }
        f.slice(0, 80).forEach((O, N) => {
          n(O, m + 1, g, B.concat(String(N)), C);
        });
        return;
      }
      Object.keys(f).slice(0, 80).forEach((O) => {
        n(f[O], m + 1, g, B.concat(O), C);
      });
    }
  }
  const o = typeof globalScope.fetch == "function" ? globalScope.fetch.bind(globalScope) : null;
  o && (globalScope.fetch = async function(f, m) {
    const g = typeof f == "string" ? f : f instanceof Request ? f.url : String(f);
    r(g, { resourceType: "fetch" });
    const B = await o(f, m);
    return r(B.url || g, {
      mimeType: B.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), B.clone().arrayBuffer().then((_) => {
      if (!_.byteLength || emitKeyCandidateFromBuffer(_))
        return;
      const O = new TextDecoder().decode(_);
      O.trim() && r(O, {
        baseUrl: B.url || g,
        mimeType: B.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), B;
  }, globalScope.fetch.toString = function() {
    return o.toString();
  });
  const i = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", d = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(f, m) {
    return this[i] = typeof m == "string" ? m : String(m), d.apply(this, arguments);
  };
  const p = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const f = this[i], m = this.responseURL || (typeof f == "string" ? f : "");
      if (r(m, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (emitKeyCandidateFromBuffer(this.response))
          return;
        const g = new TextDecoder().decode(this.response);
        g && r(g, {
          baseUrl: m,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        r(this.response, {
          baseUrl: m,
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
        baseUrl: m,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), p.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return d.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return p.toString();
  }, JSON.parse = function() {
    const f = originalJSONParse.apply(this, arguments);
    return n(f), f;
  }, JSON.parse.toString = function() {
    return originalJSONParse.toString();
  };
  const w = btoa;
  globalScope.btoa = function(f) {
    const m = w.apply(this, arguments);
    return emitKeyCandidateFromBase64(m), r(f, { baseUrl: currentLocationHref, resourceType: "btoa" }), m;
  }, btoa.toString = function() {
    return w.toString();
  };
  const b = atob;
  globalScope.atob = function(f) {
    const m = b.apply(this, arguments);
    return emitKeyCandidateFromBase64(f), r(m, { baseUrl: currentLocationHref, resourceType: "atob" }), m;
  }, atob.toString = function() {
    return b.toString();
  };
  const y = String.fromCharCode;
  String.fromCharCode = new Proxy(y, {
    apply(f, m, g) {
      const B = Reflect.apply(f, m, g);
      if (B.length >= 7) {
        if ((B.startsWith("#EXTM3U") || B.includes("#EXTINF:")) && (m3u8Accumulator += B, m3u8Accumulator.includes("#EXT-X-ENDLIST"))) {
          const _ = m3u8Accumulator.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          emitInlineManifest(_, "m3u8", currentLocationHref), m3u8Accumulator = "";
        }
        const C = B.split("").join("").trim();
        emitKeyCandidateFromHex(C);
      }
      return B;
    }
  }), String.fromCharCode.toString = function() {
    return y.toString();
  };
  const v = Array.prototype.slice;
  Array.prototype.slice = function() {
    const f = v.apply(this, arguments);
    return Array.isArray(f) && f.length === 16 && f.every((m) => typeof m == "number" && Number.isFinite(m) && m >= 0 && m <= 255) && emitKeyCandidateFromBuffer(Uint8Array.from(f).buffer), f;
  }, Array.prototype.slice.toString = function() {
    return v.toString();
  };
  const h = Array.prototype.join;
  Array.prototype.join = function() {
    const f = h.apply(this, arguments);
    return typeof f == "string" && ((f.startsWith("#EXTM3U") || f.includes("#EXTINF:")) && r(f, { baseUrl: currentLocationHref, resourceType: "array-join" }), emitKeyCandidateFromBase64(f)), f;
  }, Array.prototype.join.toString = function() {
    return h.toString();
  };
  const R = globalScope.DataView;
  if (typeof R == "function") {
    const f = function(m, g, B) {
      const C = new R(m, g, B), _ = () => {
        const O = C.buffer.slice(C.byteOffset, C.byteOffset + C.byteLength);
        emitKeyCandidateFromBuffer(O);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((O) => {
        const N = C[O];
        typeof N == "function" && (C[O] = function() {
          const X = N.apply(this, arguments);
          return _(), X;
        });
      }), _(), C;
    };
    f.prototype = R.prototype, f.toString = function() {
      return R.toString();
    }, globalScope.DataView = f;
  }
  function U(f) {
    return new Proxy(f, {
      construct(m, g, B) {
        const C = Reflect.construct(m, g, B);
        try {
          if (isEmittingKeyCandidate)
            return C;
          const _ = g == null ? void 0 : g[0];
          if (Array.isArray(_) && _.length === 16 && _.every((N) => typeof N == "number" && Number.isFinite(N) && N >= 0 && N <= 255))
            return emitKeyCandidateFromBuffer(new j(_).buffer), C;
          if (_ instanceof ArrayBuffer && _.byteLength === 16)
            return emitKeyCandidateFromBuffer(_), C;
          C.byteLength === 16 && (m.name === "Uint32Array" && C.length === 4 ? emitKeyCandidateFromBuffer(uint32ArrayToUint8Array(C).buffer) : m.name === "Uint16Array" && C.length === 8 ? emitKeyCandidateFromBuffer(uint16ArrayToUint8Array(C).buffer) : emitKeyCandidateFromBuffer(C.buffer.slice(C.byteOffset, C.byteOffset + C.byteLength)));
        } catch {
        }
        return C;
      }
    });
  }
  const F = globalScope.Int8Array, j = globalScope.Uint8Array, u = globalScope.Uint16Array, s = globalScope.Uint32Array;
  typeof F == "function" && (globalScope.Int8Array = U(F), globalScope.Int8Array.toString = function() {
    return F.toString();
  }), typeof j == "function" && (globalScope.Uint8Array = U(j), globalScope.Uint8Array.toString = function() {
    return j.toString();
  }), typeof u == "function" && (globalScope.Uint16Array = U(u), globalScope.Uint16Array.toString = function() {
    return u.toString();
  }), typeof s == "function" && (globalScope.Uint32Array = U(s), globalScope.Uint32Array.toString = function() {
    return s.toString();
  });
  const E = typeof globalScope.escape == "function" ? globalScope.escape.bind(globalScope) : null;
  E && (globalScope.escape = function(f) {
    return emitKeyCandidateFromBase64(f), E.apply(this, arguments);
  }, globalScope.escape.toString = function() {
    return E.toString();
  });
  function x(f) {
    return function() {
      const m = f.apply(this, arguments);
      return (m == null ? void 0 : m.byteLength) === 16 && emitKeyCandidateFromBuffer(m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength)), m;
    };
  }
  const V = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = x(V), Int8Array.prototype.subarray.toString = function() {
    return V.toString();
  };
  const P = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = x(P), Uint8Array.prototype.subarray.toString = function() {
    return P.toString();
  };
  const q = String.prototype.indexOf;
  String.prototype.indexOf = function(f, m) {
    const g = q.apply(this, arguments);
    if (f === "#EXTM3U" && g !== -1) {
      const B = String(this);
      r(B.slice(Math.max(m ?? 0, 0)), {
        baseUrl: currentLocationHref,
        resourceType: "string-indexof"
      });
    }
    return g;
  }, String.prototype.indexOf.toString = function() {
    return q.toString();
  };
  function L() {
    if (!(isWorkerScope || typeof document > "u"))
      try {
        const f = [
          /["']((?:(?:https?:)?\/\/)?[^"'\s]*?\.(?:m3u8|mp4|flv)(?:\?[^"'\s]*)?)["']/gi
        ];
        document.querySelectorAll("script:not([src])").forEach((m) => {
          const g = m.textContent || "";
          g && f.forEach((B) => {
            let C = B.exec(g);
            for (; C; ) {
              const _ = String(C[1] || C[0] || "").replace(/['"]/g, "").trim(), O = _ && !/^https?:\/\//i.test(_) && _.startsWith("//") ? `${currentLocationProtocol}${_}` : _;
              r(O, {
                baseUrl: currentLocationHref,
                resourceType: "inline-script"
              }), C = B.exec(g);
            }
          });
        });
      } catch {
      }
  }
  !isWorkerScope && typeof document < "u" && (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", L, { once: !0 }) : setTimeout(L, 0));
}
const qe = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function Me(e) {
  const t = e.toString(), r = t.indexOf("{"), n = t.lastIndexOf("}");
  return r === -1 || n === -1 || n <= r ? "" : t.slice(r + 1, n).trim();
}
function ro() {
  return `function createProbeBootstrapSource(nextConsolePrefix) {
  return [
    ';(() => {',
    'const consolePrefix = ' + JSON.stringify(String(nextConsolePrefix || '')) + ';',
    'const probeRuntimeCoreBodySource = ' + JSON.stringify(probeRuntimeCoreBodySource) + ';',
    'const probeManifestHeuristicsBodySource = ' + JSON.stringify(probeManifestHeuristicsBodySource) + ';',
    'const probePageActionsBodySource = ' + JSON.stringify(probePageActionsBodySource) + ';',
    'const probeRuntimeHooksBodySource = ' + JSON.stringify(probeRuntimeHooksBodySource) + ';',
    createProbeBootstrapSource.toString(),
    probeRuntimeCoreBodySource,
    probeManifestHeuristicsBodySource,
    probeRuntimeHooksBodySource,
    probePageActionsBodySource,
    "return 'installed';",
    '})();',
  ].join('\\n')
}`;
}
function no(e) {
  return [
    ";(() => {",
    `const consolePrefix = ${JSON.stringify(e.consolePrefix)};`,
    `const probeRuntimeCoreBodySource = ${JSON.stringify(e.runtimeCoreBodySource)};`,
    `const probeManifestHeuristicsBodySource = ${JSON.stringify(e.manifestHeuristicsBodySource)};`,
    `const probePageActionsBodySource = ${JSON.stringify(e.pageActionsBodySource)};`,
    `const probeRuntimeHooksBodySource = ${JSON.stringify(e.runtimeHooksBodySource)};`,
    ro(),
    e.runtimeCoreBodySource,
    e.manifestHeuristicsBodySource,
    e.runtimeHooksBodySource,
    e.pageActionsBodySource,
    "return 'installed';",
    "})();"
  ].join(`
`);
}
function oo() {
  return no({
    consolePrefix: qe,
    manifestHeuristicsBodySource: Me(Qn),
    pageActionsBodySource: Me(Yn),
    runtimeCoreBodySource: Me(eo),
    runtimeHooksBodySource: Me(to)
  });
}
function io(e) {
  const t = e.views.get(e.tabId);
  if (t && !t.webContents.isDestroyed())
    return t;
  const r = new Zt({
    webPreferences: {
      devTools: !0,
      partition: ve
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
    const i = await In(r, e.debugEnabled);
    e.emitTabState(e.tabId, r, {
      details: "did-stop-loading",
      ...i.length ? { meta: i } : {},
      state: "ready",
      url: o || void 0
    });
  }), r.webContents.on("did-navigate", (o, i) => {
    e.currentUrls.set(e.tabId, i), e.emitTabState(e.tabId, r, { details: "did-navigate", state: "ready", url: i }), e.tryDispatchPendingOpenFile(e.tabId, r);
  }), r.webContents.on("did-navigate-in-page", (o, i) => {
    e.currentUrls.set(e.tabId, i), e.emitTabState(e.tabId, r, { details: "did-navigate-in-page", state: "ready", url: i }), e.tryDispatchPendingOpenFile(e.tabId, r);
  }), r.webContents.on("page-title-updated", (o, i) => {
    e.emitTabState(e.tabId, r, {
      details: "page-title-updated",
      state: "ready",
      title: i || void 0,
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("page-favicon-updated", (o, i) => {
    const d = i.map((p) => String(p || "").trim()).find((p) => p) || "";
    d && Fn(r, d).then((p) => {
      !p || r.webContents.isDestroyed() || (e.iconSourceUrls.set(e.tabId, d), e.iconUrls.set(e.tabId, p), e.emitTabState(e.tabId, r, {
        details: "page-favicon-updated",
        iconSourceUrl: d,
        iconUrl: p,
        state: "ready",
        url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
      }));
    });
  }), r.webContents.on("did-fail-load", (o, i, d, p) => {
    i !== -3 && e.emitTabState(e.tabId, r, {
      details: `did-fail-load(${i})`,
      state: "error",
      message: `页面加载失败：${d || "未知错误"}`,
      url: p
    });
  }), r.webContents.on("render-process-gone", (o, i) => {
    e.emitTabState(e.tabId, r, {
      details: `render-process-gone:${i.reason}`,
      state: "error",
      message: `页面渲染进程异常退出：${i.reason}`,
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("console-message", (o, i, d, p, w) => {
    if (typeof d == "string" && d.startsWith(qe)) {
      const b = d.slice(qe.length);
      try {
        e.onProbePayload(JSON.parse(b));
      } catch (y) {
        A.warn("embedded browser resource payload parse failed", {
          error: y instanceof Error ? y.message : String(y),
          tabId: e.tabId
        });
      }
      return;
    }
    e.debugEnabled && i >= 2 && e.emitTabState(e.tabId, r, {
      details: `console:${w}:${p}`,
      state: "ready",
      message: d,
      meta: [`console-level=${i}`],
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.setWindowOpenHandler(({ url: o }) => (r.webContents.loadURL(o), { action: "deny" })), r;
}
function ao(e) {
  return (t) => {
    Mn(e, {
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
async function so(e, t, r) {
  if (!r(e) || t.webContents.isDestroyed())
    return !1;
  try {
    return await t.webContents.executeJavaScript(oo(), !0), !0;
  } catch (n) {
    return A.warn("embedded browser resource probe install failed", {
      error: n instanceof Error ? n.message : String(n),
      tabId: e,
      url: t.webContents.getURL() || ""
    }), !1;
  }
}
const co = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((e) => !!e);
function Ke(e) {
  return String(e || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function uo(e) {
  if (!e || e === "ffmpeg")
    return !1;
  try {
    return await ar(e, er.X_OK), !0;
  } catch {
    return !1;
  }
}
async function lo(e) {
  return new Promise((t) => {
    const r = St(e, ["-version"], {
      stdio: "ignore"
    });
    r.once("error", () => t(!1)), r.once("exit", (n) => t(n === 0));
  });
}
async function fo(e) {
  const t = [
    String(e || "").trim() || void 0,
    ...co
  ].filter((r, n, o) => !!r && o.indexOf(r) === n);
  for (const r of t) {
    if (r === "ffmpeg") {
      if (await lo(r))
        return r;
      continue;
    }
    if (await uo(r))
      return r;
  }
  return null;
}
function mo(e) {
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
function po(e, t) {
  const r = Ke(T.parse(e).name), n = Ke(T.parse(t).name);
  return `${r.replace(/-video$/i, "").replace(/_video$/i, "") || n.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function go() {
  return nr(T.join(cr.tmpdir(), "omniflow-resource-merge-"));
}
async function yo(e) {
  e && await ir(e, {
    force: !0,
    recursive: !0
  });
}
async function pt(e, t) {
  const r = T.join(e, Ke(t.fileName));
  return await or(r, wt.from(t.base64, "base64")), r;
}
async function bo(e) {
  const t = await fo(e.ffmpegPath);
  if (!t)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const r = await go();
  try {
    const [n, o] = await Promise.all([
      pt(r, e.audio),
      pt(r, e.video)
    ]), i = mo({
      audioPath: n,
      outputPath: e.outputPath,
      videoPath: o
    });
    return await new Promise((p, w) => {
      const b = [], y = [], v = St(t, i, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      v.stdout.on("data", (h) => {
        b.push(String(h));
      }), v.stderr.on("data", (h) => {
        y.push(String(h));
      }), v.once("error", (h) => {
        w(h);
      }), v.once("exit", (h) => {
        if (h === 0) {
          p({
            commandArgs: i,
            ffmpegPath: t,
            outputPath: e.outputPath,
            stderr: y.join(""),
            stdout: b.join("")
          });
          return;
        }
        w(new Error(y.join("").trim() || `ffmpeg 退出码异常: ${h}`));
      });
    });
  } finally {
    await yo(r).catch(() => {
    });
  }
}
function ho(e) {
  const t = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new Map();
  let b = null, y = null, v = !1;
  function h(a) {
    A.log("[embedded-browser:main]", a);
    const c = e.getMainWindow();
    !c || c.isDestroyed() || c.webContents.send("embedded-browser:state", a);
  }
  function R(a) {
    const c = e.getMainWindow();
    !c || c.isDestroyed() || c.webContents.send("embedded-browser:download", a);
  }
  function U(a) {
    const c = e.getMainWindow();
    !c || c.isDestroyed() || c.webContents.send("embedded-browser:resource", a);
  }
  function F(a) {
    for (const [c, l] of t.entries())
      if (l.webContents === a)
        return c;
    return null;
  }
  function j(a) {
    for (const [c, l] of t.entries())
      if (l.webContents.id === a)
        return c;
    return null;
  }
  function u() {
    v || (v = !0, Dn({
      decisionCache: w,
      options: e
    }));
  }
  function s() {
    Pn({
      emitDownload: R,
      emitResource: U,
      resolveTabIdByWebContents: F,
      resolveTabIdByWebContentsId: j
    });
  }
  function E(a) {
    const c = a.webContents.getTitle().trim();
    if (c)
      return c;
  }
  function x(a, c, l) {
    h({
      canGoBack: c.webContents.canGoBack(),
      canGoForward: c.webContents.canGoForward(),
      iconSourceUrl: l.iconSourceUrl ?? o.get(a),
      iconUrl: l.iconUrl ?? n.get(a),
      tabId: a,
      title: l.title ?? E(c),
      ...l
    });
  }
  function V(a, c, l) {
    x(a, c, {
      state: "ready",
      url: (l == null ? void 0 : l.url) ?? (r.get(a) || c.webContents.getURL() || void 0),
      ...l
    });
  }
  function P(a) {
    const c = t.get(a);
    return !c || c.webContents.isDestroyed() ? (t.delete(a), r.delete(a), n.delete(a), o.delete(a), ct(a), null) : c;
  }
  async function q(a, c) {
    return so(
      a,
      c,
      Rn
    );
  }
  async function L(a, c) {
    const l = String(a || "").trim();
    if (!l)
      return null;
    const S = P(l);
    return !S || S.webContents.isDestroyed() ? null : c((I) => S.webContents.executeJavaScript(I, !0), S);
  }
  async function Z(a, c) {
    const l = String(a || "").trim(), S = String(c.audioResourceKey || "").trim(), M = String(c.videoResourceKey || "").trim();
    if (!l || !S || !M)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const I = await L(
        l,
        async (ot) => Promise.all([
          He(ot, S),
          He(ot, M)
        ])
      ), [k, G] = I || [];
      if (!k || !G)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const le = String(c.suggestedFileName || "").trim() || po(G.fileName, k.fileName), Q = e.getMainWindow(), se = Q && !Q.isDestroyed() ? Q : void 0, ye = {
        defaultPath: T.join(W.getPath("downloads"), le),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, me = se ? await te.showSaveDialog(se, ye) : await te.showSaveDialog(ye);
      if (me.canceled || !me.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const nt = await bo({
        audio: k,
        ffmpegPath: c.ffmpegPath,
        outputPath: me.filePath,
        video: G
      });
      return {
        ffmpegPath: nt.ffmpegPath,
        ok: !0,
        outputPath: nt.outputPath
      };
    } catch (I) {
      return A.warn("embedded browser resource merge failed", {
        audioResourceKey: S,
        error: I instanceof Error ? I.message : String(I),
        tabId: l,
        videoResourceKey: M
      }), {
        error: I instanceof Error ? I.message : String(I),
        ok: !1
      };
    }
  }
  function ue(a) {
    a.setBounds(y ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function f(a) {
    if (!b)
      return;
    const c = P(b);
    if (!c) {
      b = null;
      return;
    }
    a.contentView.children.includes(c) && a.contentView.removeChildView(c), b = null;
  }
  function m(a) {
    const c = e.getMainWindow();
    return !c || c.isDestroyed() ? null : io({
      createIfMissingProbe: q,
      currentUrls: r,
      debugEnabled: e.debugEnabled,
      emitTabState: x,
      iconSourceUrls: o,
      iconUrls: n,
      onProbePayload: ao(a),
      syncBounds: ue,
      tabId: a,
      tryDispatchPendingOpenFile: async (l, S) => ft({
        attachedOpenFiles: d,
        currentUrls: r,
        pendingOpenFiles: i,
        tabId: l,
        view: S
      }),
      views: t
    });
  }
  function g(a, c, l = {}) {
    if (!a || a.isDestroyed())
      return null;
    if (!c)
      return f(a), null;
    const M = l.createIfMissing ?? !1 ? m(c) : P(c);
    return M ? (b && b !== c && f(a), ue(M), a.contentView.children.includes(M) || a.contentView.addChildView(M), b = c, M) : (f(a), null);
  }
  async function B(a, c, l, S, M = !1) {
    if (!a || a.isDestroyed())
      return;
    const I = String(c || "").trim();
    if (!I)
      return;
    const k = g(a, I, { createIfMissing: !0 });
    if (!k || k.webContents.isDestroyed())
      return;
    const G = String(l || "").trim();
    if (!G) {
      x(I, k, {
        state: "ready",
        title: E(k) || "新标签页",
        url: r.get(I) || void 0
      });
      return;
    }
    const le = r.get(I) || k.webContents.getURL();
    if (M && le === G) {
      x(I, k, {
        state: "ready",
        url: le || void 0
      });
      return;
    }
    x(I, k, {
      details: "load-url",
      state: "loading",
      url: G
    });
    try {
      await k.webContents.loadURL(G);
    } catch (Q) {
      const se = Q instanceof Error ? Q.message : String(Q);
      if (se.includes("ERR_ABORTED"))
        return;
      throw x(I, k, {
        details: S,
        state: "error",
        message: `页面加载失败：${se}`,
        url: G
      }), Q;
    }
  }
  function C(a, c) {
    if (!a || a.isDestroyed())
      return;
    const l = String(c || "").trim();
    if (!l)
      return;
    const S = P(l);
    S && (a.contentView.children.includes(S) && a.contentView.removeChildView(S), b === l && (b = null), t.delete(l), r.delete(l), n.delete(l), o.delete(l), ct(l), Be({
      requestVersions: p,
      tabId: l
    }), Re({
      attachedOpenFiles: d,
      pendingOpenFiles: i,
      tabId: l
    }), S.webContents.isDestroyed() || S.webContents.close({ waitForBeforeUnload: !1 }));
  }
  async function _(a, c, l) {
    const S = z.fromWebContents(a) ?? e.getMainWindow(), M = String(c || "").trim();
    Be({
      requestVersions: p,
      tabId: M
    }), Re({
      attachedOpenFiles: d,
      pendingOpenFiles: i,
      tabId: M
    });
    const I = String(l || "").trim();
    if (!I) {
      h({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: M,
        title: "新标签页"
      });
      return;
    }
    await B(S, M, I, "open-exception", !0);
  }
  function O(a, c) {
    const l = z.fromWebContents(a) ?? e.getMainWindow();
    g(l, c, { createIfMissing: !1 });
  }
  async function N(a, c, l) {
    const S = z.fromWebContents(a) ?? e.getMainWindow(), M = String(c || "").trim();
    Be({
      requestVersions: p,
      tabId: M
    }), Re({
      attachedOpenFiles: d,
      pendingOpenFiles: i,
      tabId: M
    }), await B(S, M, l, "navigate-exception");
  }
  async function X(a, c, l, S, M) {
    const I = z.fromWebContents(a) ?? e.getMainWindow(), k = String(c || "").trim(), G = String(l || "").trim(), le = String(S || "").trim(), Q = String(M || "").trim() || "file";
    if (!k || !G || !le)
      return;
    const se = Be({
      requestVersions: p,
      tabId: k
    });
    Re({
      attachedOpenFiles: d,
      pendingOpenFiles: i,
      tabId: k
    });
    const ye = await Vn(le, Q);
    if (!lt({
      requestVersions: p,
      tabId: k,
      version: se
    })) {
      Ie(ye).catch(() => {
      });
      return;
    }
    if (i.set(k, {
      fileName: Q,
      pageUrl: G,
      stagedPath: ye
    }), await B(I, k, G, "navigate-exception"), !lt({
      requestVersions: p,
      tabId: k,
      version: se
    }))
      return;
    const me = P(k);
    me && ft({
      attachedOpenFiles: d,
      currentUrls: r,
      pendingOpenFiles: i,
      tabId: k,
      view: me
    });
  }
  async function oe(a) {
    const c = String(a || "").trim();
    if (!c)
      return;
    const l = P(c);
    !l || l.webContents.isDestroyed() || (x(c, l, {
      details: "reload",
      state: "loading",
      url: r.get(c) || l.webContents.getURL() || void 0
    }), l.webContents.reload(), V(c, l, {
      details: "reload-requested"
    }));
  }
  async function Y(a) {
    const c = String(a || "").trim();
    if (!c)
      return;
    const l = P(c);
    !l || l.webContents.isDestroyed() || (l.webContents.canGoBack() && l.webContents.goBack(), V(c, l, {
      details: "history-back"
    }));
  }
  async function ie(a) {
    const c = String(a || "").trim();
    if (!c)
      return;
    const l = P(c);
    !l || l.webContents.isDestroyed() || (l.webContents.canGoForward() && l.webContents.goForward(), V(c, l, {
      details: "history-forward"
    }));
  }
  async function ee(a, c) {
    return L(a, async (l, S) => {
      try {
        return await mt(l, "openResource", c);
      } catch (M) {
        return A.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: M instanceof Error ? M.message : String(M),
          resourceKey: String(c || "").trim(),
          tabId: String(a || "").trim(),
          url: S.webContents.getURL() || r.get(String(a || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l);
  }
  async function Le(a, c) {
    return L(a, async (l, S) => {
      try {
        return await mt(l, "exportResource", c);
      } catch (M) {
        return A.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: M instanceof Error ? M.message : String(M),
          resourceKey: String(c || "").trim(),
          tabId: String(a || "").trim(),
          url: S.webContents.getURL() || r.get(String(a || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l);
  }
  async function We(a, c) {
    return L(a, async (l, S) => {
      try {
        return await He(l, c);
      } catch (M) {
        return A.warn("embedded browser resource read failed", {
          error: M instanceof Error ? M.message : String(M),
          resourceKey: String(c || "").trim(),
          tabId: String(a || "").trim(),
          url: S.webContents.getURL() || r.get(String(a || "").trim()) || ""
        }), null;
      }
    });
  }
  async function fe(a, c) {
    return L(a, async (l) => {
      try {
        return await Zn(l, c);
      } catch (S) {
        return A.warn("embedded browser network resource preview failed", {
          error: S instanceof Error ? S.message : String(S),
          tabId: String(a || "").trim(),
          url: String(c.url || "").trim()
        }), !1;
      }
    }).then((l) => !!l);
  }
  async function ge(a) {
    return L(a, async (c, l) => {
      try {
        return await Wr(c);
      } catch (S) {
        return A.warn("embedded browser catch toolkit get state failed", {
          error: S instanceof Error ? S.message : String(S),
          tabId: String(a || "").trim(),
          url: l.webContents.getURL() || r.get(String(a || "").trim()) || ""
        }), null;
      }
    });
  }
  async function K(a, c) {
    return L(a, async (l, S) => {
      try {
        return await Nr(l, c);
      } catch (M) {
        return A.warn("embedded browser catch toolkit update state failed", {
          error: M instanceof Error ? M.message : String(M),
          payload: c,
          tabId: String(a || "").trim(),
          url: S.webContents.getURL() || r.get(String(a || "").trim()) || ""
        }), null;
      }
    });
  }
  async function ae(a, c, l) {
    return L(a, async (S, M) => {
      try {
        return await $r(S, c);
      } catch (I) {
        return A.warn(`embedded browser catch toolkit ${l} failed`, {
          error: I instanceof Error ? I.message : String(I),
          tabId: String(a || "").trim(),
          url: M.webContents.getURL() || r.get(String(a || "").trim()) || ""
        }), !1;
      }
    }).then((S) => !!S);
  }
  async function rt(a) {
    const c = String(a || "").trim(), l = En(c), S = P(c);
    return S && !S.webContents.isDestroyed() && (S.webContents.getURL() ? S.webContents.reload() : await q(c, S)), l;
  }
  function zt(a, c) {
    const l = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, S = z.fromWebContents(a) ?? e.getMainWindow(), M = S && !S.isDestroyed() ? Math.max(S.webContents.getZoomFactor(), 0.01) : 1;
    if (l.x = Math.max(0, Math.round(c.x * M)), l.y = Math.max(0, Math.round(c.y * M)), l.width = Math.max(0, Math.round(c.width * M)), l.height = Math.max(0, Math.round(c.height * M)), y = l, !b)
      return;
    const I = P(b);
    I && I.setBounds(l);
  }
  function jt(a, c) {
    const l = z.fromWebContents(a) ?? e.getMainWindow();
    C(l, c);
  }
  async function Vt(a) {
    try {
      return await Ot(a);
    } catch {
      return !1;
    }
  }
  function qt(a) {
    const c = z.fromWebContents(a) ?? e.getMainWindow();
    !c || c.isDestroyed() || f(c);
  }
  function Kt(a) {
    const c = z.fromWebContents(a) ?? e.getMainWindow();
    !c || c.isDestroyed() || (Array.from(t.keys()).forEach((l) => {
      C(c, l);
    }), b = null, h({ state: "idle" }));
  }
  function Jt() {
    Hr({
      activateTab: O,
      cleanupDownloadFile: Vt,
      clearCapturedResources: (a) => Tn(String(a || "").trim()),
      clearCatchMediaCache: (a) => ae(a, "clearCatchMediaCache", "clear cache"),
      closeAll: Kt,
      closeTab: jt,
      deactivate: qt,
      downloadCatchMedia: (a) => ae(a, "downloadCatchMedia", "download"),
      exportResource: Le,
      getCatchToolkitState: ge,
      goBack: Y,
      goForward: ie,
      listCapturedResources: (a) => Sn(String(a || "").trim()),
      mergeMseResources: Z,
      navigate: N,
      openMappedFile: X,
      openResource: ee,
      openTab: _,
      previewResource: fe,
      readResource: We,
      reload: oe,
      resolveFavicon: An,
      restartCatchMediaCapture: (a) => ae(a, "restartCatchMediaCapture", "restart"),
      setBounds: zt,
      startCapturedResources: (a) => vn(String(a || "").trim()),
      startDeepResourceCapture: rt,
      stopCapturedResources: (a) => Cn(String(a || "").trim()),
      updateCatchToolkitState: K
    });
  }
  return {
    configureSession: u,
    initializeBridges: s,
    registerIpcHandlers: Jt
  };
}
const wo = 240;
function So(e) {
  D.on("window-minimize", (t) => {
    const r = z.fromWebContents(t.sender) ?? e.getMainWindow();
    r == null || r.minimize();
  }), D.on("window-maximize", (t) => {
    const r = z.fromWebContents(t.sender) ?? e.getMainWindow();
    !r || r.isDestroyed() || (r.isMaximized() ? r.unmaximize() : r.maximize());
  }), D.on("window-close", (t) => {
    const r = z.fromWebContents(t.sender) ?? e.getMainWindow();
    r == null || r.close();
  }), D.handle("window-activate", (t, r = !1) => {
    const n = z.fromWebContents(t.sender) ?? e.getMainWindow();
    return !n || n.isDestroyed() ? !1 : (n.isMinimized() && n.restore(), n.isVisible() || n.show(), process.platform === "darwin" ? W.focus({ steal: !0 }) : W.focus(), typeof n.moveTop == "function" && n.moveTop(), n.focus(), r && !n.isAlwaysOnTop() && (n.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      n.isDestroyed() || n.setAlwaysOnTop(!1);
    }, wo)), !0);
  });
}
const vo = T.dirname(Qt(import.meta.url));
process.env.APP_ROOT = T.join(vo, "..");
const Ue = process.env.VITE_DEV_SERVER_URL, Eo = T.join(process.env.APP_ROOT, "dist-electron"), Lt = T.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Ue ? T.join(process.env.APP_ROOT, "public") : Lt;
const gt = T.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Co = "Omniflow", To = "omniflow-app", Ro = 1400, Bo = 920, Qe = 600, et = 400, Mo = "window-state.json", Oo = 200, _o = process.env.NODE_ENV === "test" || !!(Ue || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", xo = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
xo || (W.commandLine.appendSwitch("disable-logging"), W.commandLine.appendSwitch("log-level", "3"));
W.setName(Co);
try {
  const e = T.join(W.getPath("appData"), To);
  W.setPath("userData", e);
} catch {
}
function Wt() {
  return Fe(gt) ? gt : null;
}
let $ = null, Nt = !1, Oe = null;
function $t() {
  return T.join(W.getPath("userData"), Mo);
}
function de(e) {
  return typeof e == "number" && Number.isFinite(e);
}
function Do(e, t) {
  return e >= Qe && t >= et;
}
function Po(e) {
  return Yt.getAllDisplays().some((r) => {
    const n = r.workArea;
    return e.x < n.x + n.width && e.x + e.width > n.x && e.y < n.y + n.height && e.y + e.height > n.y;
  });
}
function Io() {
  try {
    const e = $t();
    if (!Fe(e))
      return null;
    const t = tr(e, "utf-8"), r = JSON.parse(t);
    if (!de(r.width) || !de(r.height) || !Do(r.width, r.height))
      return null;
    const n = !!r.maximized, o = {
      width: r.width,
      height: r.height,
      maximized: n
    };
    return de(r.x) && de(r.y) && (o.x = r.x, o.y = r.y), de(o.x) && de(o.y) && (Po({
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height
    }) || (delete o.x, delete o.y)), o;
  } catch {
    return null;
  }
}
function tt(e) {
  if (!e.isDestroyed())
    try {
      const t = e.isMaximized() ? e.getNormalBounds() : e.getBounds(), r = {
        x: t.x,
        y: t.y,
        width: Math.max(Math.round(t.width), Qe),
        height: Math.max(Math.round(t.height), et),
        maximized: e.isMaximized()
      }, n = $t();
      Je(T.dirname(n), { recursive: !0 }), rr(n, JSON.stringify(r), "utf-8");
    } catch {
    }
}
function _e(e) {
  Oe && clearTimeout(Oe), Oe = setTimeout(() => {
    Oe = null, tt(e);
  }, Oo);
}
function Uo(e) {
  if (e.type !== "keyDown")
    return !1;
  const t = (e.key || "").toLowerCase();
  return (e.meta || e.control) && e.shift && t === "i";
}
function Fo(e) {
  if (e.type !== "keyDown" || !(e.meta || e.control))
    return !1;
  const t = (e.key || "").toLowerCase();
  return t === "+" || t === "=" || t === "-" || t === "_" || t === "0";
}
const ze = ho({
  debugEnabled: _o,
  getMainWindow: () => $
});
function Ht() {
  if ($ && !$.isDestroyed())
    return $.show(), $.focus(), $;
  const e = Wt(), t = Io(), r = (t == null ? void 0 : t.width) ?? Ro, n = (t == null ? void 0 : t.height) ?? Bo, o = new z({
    width: r,
    height: n,
    minWidth: Qe,
    minHeight: et,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...de(t == null ? void 0 : t.x) && de(t == null ? void 0 : t.y) ? { x: t.x, y: t.y } : {},
    webPreferences: {
      preload: T.join(Eo, "preload.mjs"),
      devTools: !0
    },
    autoHideMenuBar: !0,
    ...e ? { icon: e } : {}
  });
  return $ = o, t != null && t.maximized && o.maximize(), o.on("move", () => {
    _e(o);
  }), o.on("resize", () => {
    _e(o);
  }), o.on("maximize", () => {
    _e(o);
  }), o.on("unmaximize", () => {
    _e(o);
  }), o.on("close", (i) => {
    tt(o), process.platform === "darwin" && !Nt && (i.preventDefault(), o.hide());
  }), o.on("closed", () => {
    $ === o && ($ = null);
  }), o.webContents.setZoomFactor(1), o.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), o.webContents.on("before-input-event", (i, d) => {
    if (Fo(d)) {
      i.preventDefault();
      return;
    }
    Uo(d) && (i.preventDefault(), o.webContents.toggleDevTools());
  }), o.on("app-command", (i, d) => {
    (d === "browser-backward" || d === "browser-forward") && i.preventDefault();
  }), o.on("swipe", (i, d) => {
    (d === "left" || d === "right") && i.preventDefault();
  }), Ue ? o.loadURL(Ue) : o.loadFile(T.join(Lt, "index.html")), o;
}
W.on("before-quit", () => {
  Nt = !0, $ && !$.isDestroyed() && tt($);
});
W.on("window-all-closed", () => {
  process.platform !== "darwin" && W.quit();
});
W.on("activate", () => {
  if ($ && !$.isDestroyed()) {
    $.isMinimized() && $.restore(), $.show(), $.focus();
    return;
  }
  z.getAllWindows().length === 0 && Ht();
});
W.whenReady().then(() => {
  const e = Wt();
  e && process.platform === "darwin" && W.dock.setIcon(e), ze.configureSession(), ze.initializeBridges(), Fr(), So({
    getMainWindow: () => $
  }), ze.registerIpcHandlers(), Ht();
});
export {
  Eo as MAIN_DIST,
  Lt as RENDERER_DIST,
  Ue as VITE_DEV_SERVER_URL
};
