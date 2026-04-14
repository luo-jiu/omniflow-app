import { dialog as ie, app as L, net as ln, ipcMain as x, session as He, webContents as fn, BrowserWindow as z, WebContentsView as mn, screen as pn } from "electron";
import { fileURLToPath as gn } from "node:url";
import T from "node:path";
import _t, { existsSync as ft, mkdirSync as Ut, constants as yn, readFileSync as hn, writeFileSync as bn } from "node:fs";
import W from "fs/promises";
import ct, { mkdtemp as wn, writeFile as Sn, rm as vn, access as Tn } from "node:fs/promises";
import vr from "node:http";
import Tr from "node:https";
import Er from "os";
import Pt from "child_process";
import En from "fs";
import { Buffer as Cr } from "node:buffer";
import { spawn as Rr } from "node:child_process";
import Cn from "node:os";
const tt = 6e4;
async function Ft(t, e, r = {}, i = 0) {
  const c = new URL(t);
  if (c.protocol !== "http:" && c.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${c.protocol}`);
  const f = c.protocol === "https:" ? Tr : vr;
  await ct.mkdir(T.dirname(e), { recursive: !0 }), await new Promise((p, w) => {
    let g = !1;
    const b = () => {
      g || (g = !0, p());
    }, C = (R) => {
      g || (g = !0, w(R));
    }, h = f.request({
      protocol: c.protocol,
      hostname: c.hostname,
      port: c.port ? Number(c.port) : void 0,
      path: `${c.pathname}${c.search}`,
      method: "GET",
      headers: r
    }, (R) => {
      R.setTimeout(tt, () => {
        R.destroy(new Error(`下载响应超时: ${tt}ms`));
      });
      const D = Number(R.statusCode || 0), U = R.headers.location;
      if (D >= 300 && D < 400 && U) {
        if (R.resume(), i >= 3) {
          C(new Error(`下载重定向次数过多: ${t}`));
          return;
        }
        const J = new URL(U, t).toString();
        Ft(J, e, r, i + 1).then(b).catch(C);
        return;
      }
      if (D >= 400) {
        R.resume(), C(new Error(`下载失败: HTTP ${D} (${t})`));
        return;
      }
      const Q = _t.createWriteStream(e), ee = async (J) => {
        try {
          Q.destroy();
        } catch {
        }
        try {
          await ct.rm(e, { force: !0 });
        } catch {
        }
        C(J);
      };
      R.on("error", (J) => {
        ee(J);
      }), Q.on("error", (J) => {
        ee(J);
      }), Q.on("finish", () => b()), R.pipe(Q);
    });
    h.setTimeout(tt, () => {
      h.destroy(new Error(`下载请求超时: ${tt}ms`));
    }), h.on("error", (R) => C(R)), h.end();
  });
}
const Rn = "Omniflow Inbox", Bn = 10 * 60 * 1e3, On = 2, xn = 2e3, Mt = 12, _n = T.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), $e = /* @__PURE__ */ new Map();
function kt(t) {
  const e = String(t || "");
  return !!(!e || e === ".DS_Store" || e.startsWith("._") || e === "Thumbs.db");
}
function ze(t) {
  return t.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Mn(t) {
  const e = String(t || "").toLowerCase();
  return !e || e.startsWith(".") ? !0 : e.endsWith(".crdownload") || e.endsWith(".part") || e.endsWith(".tmp") || e.endsWith(".opdownload") || e.endsWith(".download");
}
function Br() {
  return T.join(L.getPath("userData"), "auto-import-staging");
}
function Dn() {
  return T.join(L.getPath("userData"), "embedded-browser-downloads");
}
function Or(t, e) {
  const r = T.resolve(t), i = T.resolve(e);
  return r === i ? !0 : r.startsWith(`${i}${T.sep}`);
}
function In(t) {
  const e = String(t || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
async function Un(t, e) {
  try {
    await W.rename(t, e);
  } catch (r) {
    if ((r == null ? void 0 : r.code) !== "EXDEV")
      throw r;
    await W.copyFile(t, e), await W.rm(t, { force: !0 });
  }
}
function Pn(t) {
  const e = Date.now();
  for (const [r, i] of $e.entries())
    t.has(r) || e - i.lastSeenAt <= Bn || $e.delete(r);
}
async function Fn(t, e = Mt) {
  const r = String(t || "").trim(), i = r ? T.resolve(r) : T.join(L.getPath("downloads"), Rn), a = await W.stat(i).catch(() => null);
  if (!(a != null && a.isDirectory()))
    return [];
  const c = await W.readdir(i, { withFileTypes: !0 }), f = /* @__PURE__ */ new Set(), p = Date.now(), w = [];
  for (const h of c) {
    if (!h.isFile() || kt(h.name) || Mn(h.name)) continue;
    const R = T.join(i, h.name), D = await W.stat(R).catch(() => null);
    if (!(D != null && D.isFile())) continue;
    f.add(R);
    const U = $e.get(R), ee = (U ? U.size === D.size && U.mtimeMs === D.mtimeMs : !1) && U ? U.stableCount + 1 : 1;
    $e.set(R, {
      size: D.size,
      mtimeMs: D.mtimeMs,
      stableCount: ee,
      lastSeenAt: p
    }), !(ee < On) && (p - D.mtimeMs < xn || w.push({
      sourcePath: R,
      name: h.name,
      size: D.size,
      mtimeMs: D.mtimeMs
    }));
  }
  if (Pn(f), w.length === 0)
    return [];
  w.sort((h, R) => h.mtimeMs - R.mtimeMs);
  const g = Br();
  await W.mkdir(g, { recursive: !0 });
  const b = [], C = Math.max(1, Math.floor(Number(e) || Mt));
  for (const h of w.slice(0, C)) {
    const R = T.join(g, In(h.name));
    try {
      await Un(h.sourcePath, R);
    } catch {
      continue;
    }
    $e.delete(h.sourcePath), b.push({
      name: h.name,
      size: h.size,
      localPath: R,
      relativePath: ze(h.name)
    });
  }
  return b;
}
async function kn(t) {
  const e = T.resolve(String(t || "").trim()), r = Br();
  return !e || !Or(e, r) ? !1 : (await W.rm(e, { force: !0 }), !0);
}
function dr(t, e) {
  const r = ze(e || "");
  if (!r)
    return t;
  const i = r.split("/").filter(Boolean);
  for (const a of i) {
    if (a === "." || a === "..")
      throw new Error(`非法下载路径片段: ${a}`);
    if (a.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return T.join(t, ...i);
}
function xr(t, e) {
  return t.relativePath.localeCompare(e.relativePath, "zh-Hans-CN");
}
async function Ln(t) {
  return (await Promise.all(t.map(async (r) => {
    const i = await W.stat(r);
    if (!i.isFile())
      return null;
    const a = T.basename(r);
    return kt(a) ? null : {
      name: a,
      size: i.size,
      localPath: r,
      relativePath: ze(a)
    };
  }))).filter((r) => !!r).sort(xr);
}
async function An(t, e, r) {
  const i = [e], a = [];
  for (; i.length > 0; ) {
    const b = i.pop(), C = await W.readdir(b, { withFileTypes: !0 });
    for (const h of C) {
      if (h.name === "." || h.name === ".." || kt(h.name) || h.isSymbolicLink())
        continue;
      const R = T.join(b, h.name);
      if (h.isDirectory()) {
        i.push(R);
        continue;
      }
      h.isFile() && a.push({
        absolutePath: R,
        name: h.name
      });
    }
  }
  const c = [], f = 48;
  let p = 0;
  const w = async () => {
    for (; p < a.length; ) {
      const b = p;
      if (p += 1, b >= a.length)
        return;
      const C = a[b], h = await W.stat(C.absolutePath).catch(() => null);
      if (!(h != null && h.isFile()))
        continue;
      const R = ze(T.relative(t, C.absolutePath)), D = ze(T.join(r, R));
      c.push({
        name: C.name,
        size: h.size,
        localPath: C.absolutePath,
        relativePath: D
      });
    }
  }, g = Math.min(f, Math.max(1, a.length));
  return await Promise.all(Array.from({ length: g }, () => w())), c;
}
async function Wn(t) {
  const e = [];
  for (const r of t) {
    if (!(await W.stat(r)).isDirectory())
      continue;
    const a = T.basename(r), c = await An(r, r, a);
    e.push(...c);
  }
  return e.sort(xr);
}
function Nn(t) {
  t.handle("file:open", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openFile", "dontAddToRecent"],
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (e.canceled || e.filePaths.length === 0)
      return { canceled: !0, content: "", filePath: "" };
    const r = e.filePaths[0];
    return {
      canceled: !1,
      content: await W.readFile(r, "utf-8"),
      filePath: r
    };
  }), t.handle("file:save", async (e, r, i) => (await W.writeFile(r, i, "utf-8"), !0)), t.handle("file:read-text", async (e, r) => {
    const i = T.resolve(String(r || "").trim());
    return {
      canceled: !1,
      content: await W.readFile(i, "utf-8"),
      filePath: i
    };
  }), t.handle("file:read-local-chrome-bookmarks", async () => {
    const e = T.join(L.getPath("home"), _n);
    return {
      canceled: !1,
      content: await W.readFile(e, "utf-8"),
      filePath: e
    };
  }), t.handle("dialog:pick-upload-files", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Ln(e.filePaths) };
  }), t.handle("dialog:pick-upload-folders", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Wn(e.filePaths) };
  }), t.handle("dialog:pick-download-directory", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("dialog:save-download-file", async (e, r) => {
    const i = await ie.showSaveDialog({
      defaultPath: String(r || "download"),
      showsTagField: !1
    });
    return i.canceled || !i.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: i.filePath };
  }), t.handle("dialog:pick-auto-import-directory", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("fs:claim-auto-import-files", async (e, r, i = Mt) => ({ canceled: !1, files: await Fn(r, i) })), t.handle("fs:cleanup-auto-import-staged-file", async (e, r) => {
    try {
      return await kn(r);
    } catch {
      return !1;
    }
  }), t.handle("fs:ensure-directory", async (e, r, i = "") => {
    const a = dr(r, i);
    return await W.mkdir(a, { recursive: !0 }), a;
  }), t.handle("fs:download-url-to-path", async (e, r, i, a, c = {}) => {
    const f = dr(i, a);
    return await Ft(r, f, c), f;
  }), t.handle("fs:save-staged-download-file", async (e, r, i) => {
    const a = T.resolve(String(r || "").trim()), c = T.resolve(String(i || "").trim()), f = Dn();
    if (!a || !Or(a, f))
      throw new Error("无效的下载临时文件");
    if (!c)
      throw new Error("无效的保存路径");
    return await W.mkdir(T.dirname(c), { recursive: !0 }), await W.copyFile(a, c), c;
  });
}
var q = {}, ue = Er;
q.platform = function() {
  return process.platform;
};
q.cpuCount = function() {
  return ue.cpus().length;
};
q.sysUptime = function() {
  return ue.uptime();
};
q.processUptime = function() {
  return process.uptime();
};
q.freemem = function() {
  return ue.freemem() / (1024 * 1024);
};
q.totalmem = function() {
  return ue.totalmem() / (1024 * 1024);
};
q.freememPercentage = function() {
  return ue.freemem() / ue.totalmem();
};
q.freeCommand = function(t) {
  Pt.exec("free -m", function(e, r, i) {
    var a = r.split(`
`), c = a[1].replace(/[\s\n\r]+/g, " "), f = c.split(" ");
    total_mem = parseFloat(f[1]), free_mem = parseFloat(f[3]), buffers_mem = parseFloat(f[5]), cached_mem = parseFloat(f[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), t(used_mem - 2);
  });
};
q.harddrive = function(t) {
  Pt.exec("df -k", function(e, r, i) {
    var a = 0, c = 0, f = 0, p = r.split(`
`), w = p[1].replace(/[\s\n\r]+/g, " "), g = w.split(" ");
    a = Math.ceil(g[1] * 1024 / Math.pow(1024, 2)), c = Math.ceil(g[2] * 1024 / Math.pow(1024, 2)), f = Math.ceil(g[3] * 1024 / Math.pow(1024, 2)), t(a, f, c);
  });
};
q.getProcesses = function(t, e) {
  typeof t == "function" && (e = t, t = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", t > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (t + 1)), Pt.exec(command, function(r, i, a) {
    var c = i.split(`
`);
    c.shift(), c.pop();
    var f = "";
    c.forEach(function(p, w) {
      var g = p.replace(/[\s\n\r]+/g, " ");
      g = g.split(" "), f += g[1] + " " + g[2] + " " + g[3] + " " + g[4].substring(g[4].length - 25) + `
`;
    }), e(f);
  });
};
q.allLoadavg = function() {
  var t = ue.loadavg();
  return t[0].toFixed(4) + "," + t[1].toFixed(4) + "," + t[2].toFixed(4);
};
q.loadavg = function(t) {
  (t === void 0 || t !== 5 && t !== 15) && (t = 1);
  var e = ue.loadavg(), r = 0;
  return t == 1 && (r = e[0]), t == 5 && (r = e[1]), t == 15 && (r = e[2]), r;
};
q.cpuFree = function(t) {
  _r(t, !0);
};
q.cpuUsage = function(t) {
  _r(t, !1);
};
function _r(t, e) {
  var r = ur(), i = r.idle, a = r.total;
  setTimeout(function() {
    var c = ur(), f = c.idle, p = c.total, w = f - i, g = p - a, b = w / g;
    t(e === !0 ? b : 1 - b);
  }, 1e3);
}
function ur(t) {
  var e = ue.cpus(), r = 0, i = 0, a = 0, c = 0, f = 0, w = 0;
  for (var p in e)
    r += e[p].times.user, i += e[p].times.nice, a += e[p].times.sys, f += e[p].times.irq, c += e[p].times.idle;
  var w = r + i + a + c + f;
  return {
    idle: c,
    total: w
  };
}
const $n = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Ne = (t, ...e) => {
  $n && console[t](...e);
}, k = {
  debug: (...t) => Ne("debug", ...t),
  info: (...t) => Ne("info", ...t),
  log: (...t) => Ne("log", ...t),
  warn: (...t) => Ne("warn", ...t),
  error: (...t) => Ne("error", ...t)
};
function zn() {
  const t = Hn().total, e = Er.cpus()[0].model, r = Math.floor(q.totalmem() / 1024);
  return {
    totalStorage: t,
    cpuModel: e,
    totalMemoryGB: r
  };
}
function Hn() {
  const t = En.statfsSync(process.platform === "win32" ? "C:" : "/"), e = t.blocks * t.bsize, r = t.bfree * t.bsize;
  return {
    total: Math.floor(e / 1e9),
    // 换算为 GB
    usage: 1 - r / e
    // 使用率计算
  };
}
function jn(t) {
  t.handle("sys:get-static-data", zn);
}
const Vn = 10 * 1024 * 1024 * 1024, qn = "10GB", Kn = `上传失败：单文件最大支持 ${qn}`;
function Mr(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Gn(t) {
  return encodeURIComponent(t).replace(
    /['()*]/g,
    (e) => `%${e.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Jn(t) {
  const e = Mr(t), r = Gn(t);
  return `Content-Disposition: form-data; name="file"; filename="${e}"; filename*=UTF-8''${r}\r
`;
}
function Xn(t) {
  const e = /* @__PURE__ */ new Map(), r = (i, a = !1) => {
    const c = Date.now();
    if (!a && c - i.lastProgressAt < 80) return;
    i.lastProgressAt = c;
    const f = Math.max(c - i.startedAt, 1), p = Math.floor(i.uploadedBytes * 1e3 / f), w = i.totalBytes > 0 ? Math.min(i.uploadedBytes / i.totalBytes * 100, 100) : 0;
    i.sender.send("http:upload:progress", {
      uploadId: i.uploadId,
      uploadedBytes: i.uploadedBytes,
      totalBytes: i.totalBytes,
      percentage: w,
      speedBps: p
    });
  };
  t.handle("http:fetch", async (i, a, c = {}) => (k.debug("http:fetch start"), k.debug("http:fetch URL:", a), k.debug("http:fetch options:", c), new Promise((f, p) => {
    const w = ln.request({ url: a, method: c.method || "GET" });
    c.headers && Object.entries(c.headers).forEach(([b, C]) => {
      k.debug(`http:fetch set header ${b}: ${String(C)}`), w.setHeader(b, C);
    });
    let g = "";
    w.on("response", (b) => {
      k.debug("http:fetch response"), k.debug("http:fetch status:", b.statusCode), k.debug("http:fetch headers:", b.headers), b.on("data", (C) => {
        k.debug(`http:fetch chunk length: ${C.length}`), g += C;
      }), b.on("end", () => {
        k.debug("http:fetch body preview:", g.slice(0, 500));
        let C;
        try {
          C = JSON.parse(g);
        } catch {
          C = g;
        }
        f({
          status: b.statusCode,
          headers: b.headers,
          body: C
        });
      });
    }), w.on("error", (b) => {
      k.error("http:fetch error:", b), p(b);
    }), c.body && w.write(c.body), w.end();
  }))), t.handle("http:upload:abort", async (i, a) => {
    const c = e.get(a);
    if (!c) return !1;
    c.aborted = !0, e.delete(a);
    try {
      c.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      c.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), t.handle("http:upload", async (i, a, c, f = {}, p = {}, w) => new Promise((g, b) => {
    let C;
    try {
      C = _t.statSync(c);
    } catch (M) {
      b(new Error(`读取上传文件失败: ${c} (${String(M)})`));
      return;
    }
    if (!C.isFile()) {
      b(new Error(`上传目标不是文件: ${c}`));
      return;
    }
    if (C.size > Vn) {
      b(new Error(Kn));
      return;
    }
    const h = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), R = w || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, D = T.basename(c), U = Object.entries(f).map(([M, j]) => `--${h}\r
Content-Disposition: form-data; name="${Mr(M)}"\r
\r
${j}\r
`).join(""), Q = `--${h}\r
` + Jn(D) + `Content-Type: application/octet-stream\r
\r
`, ee = `\r
--${h}--\r
`, J = Buffer.byteLength(U) + Buffer.byteLength(Q) + C.size + Buffer.byteLength(ee), be = {
      ...p,
      "Content-Type": `multipart/form-data; boundary=${h}`,
      "Content-Length": String(J)
    }, H = new URL(a), P = (H.protocol === "https:" ? Tr : vr).request({
      protocol: H.protocol,
      hostname: H.hostname,
      port: H.port ? Number(H.port) : void 0,
      path: `${H.pathname}${H.search}`,
      method: "POST",
      headers: be
    }), te = _t.createReadStream(c, {
      highWaterMark: 1024 * 1024
    }), N = {
      uploadId: R,
      request: P,
      fileStream: te,
      sender: i.sender,
      totalBytes: Math.max(0, C.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    e.set(R, N);
    let le = !1;
    const fe = (M) => {
      le || (le = !0, e.delete(R), g(M));
    }, re = (M) => {
      le || (le = !0, e.delete(R), b(M));
    };
    let F = "";
    P.on("response", (M) => {
      M.on("data", (j) => {
        F += j.toString();
      }), M.on("end", () => {
        let j;
        try {
          j = JSON.parse(F);
        } catch {
          j = F;
        }
        fe({
          status: M.statusCode,
          body: j
        });
      });
    }), P.on("error", (M) => {
      if (N.aborted) {
        re(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        te.destroy(M);
      } catch {
      }
      re(M);
    }), P.write(U), P.write(Q), te.on("data", (M) => {
      N.aborted || (N.uploadedBytes += M.length, r(N));
    }), te.on("end", () => {
      N.aborted || (r(N, !0), P.write(ee), P.end());
    }), te.on("error", (M) => {
      if (N.aborted) {
        re(new Error("UPLOAD_ABORTED"));
        return;
      }
      re(M);
      try {
        P.destroy(M);
      } catch {
      }
    }), te.pipe(P, { end: !1 });
  }));
}
function Zn() {
  Nn(x), jn(x), Xn(x);
}
function Yn() {
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
function Qn(t) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.updateCatchToolkitState === 'function'
        ? probe.updateCatchToolkitState
        : null
      return handler ? handler(${JSON.stringify(t)}) : null
    })()
  `;
}
function eo(t) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(t)}] === 'function'
        ? probe[${JSON.stringify(t)}]
        : null
      return handler ? handler() : false
    })()
  `;
}
function Dr(t) {
  if (!t || typeof t != "object")
    return null;
  const e = t;
  return typeof e.autoSeekToBufferedEnd != "boolean" || typeof e.autoDownloadOnComplete != "boolean" || typeof e.capturedMediaSizeBytes != "number" || typeof e.clearCacheOnComplete != "boolean" || typeof e.currentFileName != "string" || typeof e.isCaptureComplete != "boolean" || typeof e.manualFileName != "string" || typeof e.regexWarning != "string" || typeof e.regexRule != "string" || typeof e.restartAlwaysFromBeginning != "boolean" || typeof e.selectorWarning != "string" || typeof e.selectorRule != "string" || typeof e.streamCount != "number" || typeof e.trimExtraMediaHeaders != "boolean" ? null : {
    autoSeekToBufferedEnd: e.autoSeekToBufferedEnd,
    autoDownloadOnComplete: e.autoDownloadOnComplete,
    capturedMediaSizeBytes: e.capturedMediaSizeBytes,
    clearCacheOnComplete: e.clearCacheOnComplete,
    currentFileName: e.currentFileName,
    isCaptureComplete: e.isCaptureComplete,
    manualFileName: e.manualFileName,
    regexWarning: e.regexWarning,
    regexRule: e.regexRule,
    restartAlwaysFromBeginning: e.restartAlwaysFromBeginning,
    selectorWarning: e.selectorWarning,
    selectorRule: e.selectorRule,
    streamCount: e.streamCount,
    trimExtraMediaHeaders: e.trimExtraMediaHeaders
  };
}
async function to(t) {
  const e = await t(Yn());
  return Dr(e);
}
async function ro(t, e) {
  const r = await t(
    Qn(e)
  );
  return Dr(r);
}
async function no(t, e) {
  return !!await t(
    eo(e)
  );
}
function oo(t) {
  x.handle("embedded-browser:open-tab", async (e, r, i) => t.openTab(e.sender, r, i)), x.handle("embedded-browser:activate-tab", (e, r) => t.activateTab(e.sender, r)), x.handle("embedded-browser:navigate", async (e, r, i) => t.navigate(e.sender, r, i)), x.handle("embedded-browser:resolve-favicon", async (e, r) => t.resolveFavicon(r)), x.handle(
    "embedded-browser:open-mapped-file",
    async (e, r, i, a, c) => t.openMappedFile(e.sender, r, i, a, c)
  ), x.handle("embedded-browser:reload", async (e, r) => t.reload(r)), x.handle("embedded-browser:go-back", async (e, r) => t.goBack(r)), x.handle("embedded-browser:go-forward", async (e, r) => t.goForward(r)), x.handle("embedded-browser:resource:list", (e, r) => t.listCapturedResources(r)), x.handle("embedded-browser:resource:start", (e, r) => t.startCapturedResources(r)), x.handle("embedded-browser:resource:stop", (e, r) => t.stopCapturedResources(r)), x.handle("embedded-browser:resource:clear", (e, r) => t.clearCapturedResources(r)), x.handle("embedded-browser:resource:open", async (e, r, i) => t.openResource(r, i)), x.handle("embedded-browser:resource:export", async (e, r, i) => t.exportResource(r, i)), x.handle(
    "embedded-browser:resource:preview",
    async (e, r, i) => t.previewResource(r, i)
  ), x.handle("embedded-browser:resource:catch-toolkit:get-state", async (e, r) => t.getCatchToolkitState(r)), x.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (e, r, i) => t.updateCatchToolkitState(r, i)
  ), x.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (e, r) => t.clearCatchMediaCache(r)), x.handle("embedded-browser:resource:catch-toolkit:download", async (e, r) => t.downloadCatchMedia(r)), x.handle("embedded-browser:resource:catch-toolkit:restart", async (e, r) => t.restartCatchMediaCapture(r)), x.handle(
    "embedded-browser:resource:merge-mse",
    async (e, r, i) => t.mergeMseResources(r, i)
  ), x.handle("embedded-browser:resource:start-deep-capture", async (e, r) => t.startDeepResourceCapture(r)), x.handle("embedded-browser:set-bounds", (e, r) => t.setBounds(e.sender, r)), x.handle("embedded-browser:close-tab", (e, r) => t.closeTab(e.sender, r)), x.handle("embedded-browser:cleanup-download-file", async (e, r) => t.cleanupDownloadFile(r)), x.handle("embedded-browser:deactivate", (e) => t.deactivate(e.sender)), x.handle("embedded-browser:close-all", (e) => t.closeAll(e.sender));
}
const je = "persist:omniflow-embedded-browser", io = "embedded-browser-downloads";
let Bt = null, lr = !1;
function Ir() {
  return T.join(L.getPath("userData"), io);
}
function ao() {
  const t = Ir();
  return ft(t) || Ut(t, { recursive: !0 }), t;
}
function so() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function co(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function rt(t, e) {
  var r, i;
  return {
    downloadId: e.downloadId,
    fileName: e.fileName,
    mimeType: e.mimeType,
    pageUrl: e.pageUrl,
    receivedBytes: e.receivedBytes ?? Math.max(0, Number(((r = t.getReceivedBytes) == null ? void 0 : r.call(t)) || 0)),
    state: e.state,
    tabId: e.tabId,
    tempPath: e.tempPath,
    totalBytes: e.totalBytes ?? Math.max(0, Number(((i = t.getTotalBytes) == null ? void 0 : i.call(t)) || 0)),
    url: e.url,
    ...e.error ? { error: e.error } : {}
  };
}
function uo() {
  return Bt || (Bt = He.fromPartition(je)), Bt;
}
async function Ur(t) {
  const e = T.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const r = T.resolve(Ir());
  return e !== r && !e.startsWith(`${r}${T.sep}`) ? !1 : (await ct.rm(e, { force: !0 }), !0);
}
function lo(t) {
  if (lr)
    return;
  lr = !0;
  const e = (a, c, f) => {
    const p = t.resolveTabIdByWebContents(f) || void 0;
    if (!p)
      return;
    const w = ao(), g = so(), b = c.getFilename() || "download", C = c.getURL() || "", h = f.getURL() || void 0, R = T.join(w, co(b));
    c.setSavePath(R), t.emitDownload(rt(c, {
      downloadId: g,
      fileName: b,
      mimeType: c.getMimeType() || void 0,
      pageUrl: h,
      state: "started",
      tabId: p,
      tempPath: R,
      url: C
    })), c.on("updated", (D, U) => {
      U === "progressing" && t.emitDownload(rt(c, {
        downloadId: g,
        fileName: b,
        mimeType: c.getMimeType() || void 0,
        pageUrl: h,
        state: "progress",
        tabId: p,
        tempPath: R,
        url: C
      }));
    }), c.once("done", (D, U) => {
      if (U === "completed") {
        t.emitDownload(rt(c, {
          downloadId: g,
          fileName: b,
          mimeType: c.getMimeType() || void 0,
          pageUrl: h,
          state: "completed",
          tabId: p,
          tempPath: R,
          url: C
        }));
        return;
      }
      Ur(R).catch(() => {
      }), t.emitDownload(rt(c, {
        downloadId: g,
        error: U === "cancelled" ? "下载已取消" : `下载失败：${U}`,
        fileName: b,
        mimeType: c.getMimeType() || void 0,
        pageUrl: h,
        state: U === "cancelled" ? "cancelled" : "failed",
        tabId: p,
        tempPath: R,
        url: C
      }));
    });
  }, r = /* @__PURE__ */ new Set();
  [He.defaultSession, uo()].filter(Boolean).forEach((a) => {
    r.has(a) || (r.add(a), a.on("will-download", e));
  });
}
const fo = /* @__PURE__ */ new Set(["m3u8", "mpd"]), mo = /* @__PURE__ */ new Set([
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
]), po = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), go = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), yo = /* @__PURE__ */ new Set(["key", "base64key"]), ho = /* @__PURE__ */ new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
]), dt = /* @__PURE__ */ new Map(), ye = /* @__PURE__ */ new Map();
let fr = !1, st = null;
function Oe() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function mt(t) {
  const e = String(t || "").trim();
  if (!e)
    return null;
  const r = dt.get(e);
  if (r)
    return r;
  const i = Oe();
  return dt.set(e, i), i;
}
function Ve(t) {
  const e = String(t || "").trim();
  return e && dt.get(e) || null;
}
function Ot(t, e) {
  if (!t)
    return "";
  const r = e.toLowerCase();
  for (const [i, a] of Object.entries(t))
    if (i.toLowerCase() === r)
      return Array.isArray(a) ? String(a[0] || "") : String(a || "");
  return "";
}
function pt(t) {
  var e;
  return ((e = String(t || "").split(";")[0]) == null ? void 0 : e.trim().toLowerCase()) || "";
}
function Lt(t) {
  try {
    const r = new URL(t).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (r == null ? void 0 : r[1]) || "";
  } catch {
    const e = String(t || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (e == null ? void 0 : e[1]) || "";
  }
}
function Pr(t) {
  const e = pt(t.mimeType), r = Lt(t.url);
  return fo.has(r) || e.includes("mpegurl") || e.includes("dash+xml") ? "manifest" : mo.has(r) || e.startsWith("video/") || e.startsWith("audio/") || t.resourceType === "media" || String(t.url || "").startsWith("blob:") ? "media" : po.has(r) || e.startsWith("image/") ? "image" : go.has(r) || e.includes("text/vtt") ? "subtitle" : r === "pdf" || e === "application/pdf" ? "document" : yo.has(r) || t.resourceType === "key" || e === "application/octet-stream" ? "key" : "other";
}
function Fr(t) {
  return !t.url || t.url.startsWith("data:") ? !1 : t.kind !== "other" ? !0 : t.resourceType === "media" || t.url.startsWith("blob:");
}
function kr(t, e, r, i) {
  return i ? `${t}::${e}::${i}` : `${t}::${e}::${r}`;
}
function bo(t, e, r, i) {
  return kr(t, e, r, i);
}
function wo(t) {
  return Array.from(t.values()).sort((e, r) => r.capturedAt - e.capturedAt);
}
function ae(t) {
  return {
    deepCaptureEnabled: t.deepCaptureEnabled,
    enabled: t.enabled,
    resources: wo(t.resources)
  };
}
function Lr(t, e) {
  const r = Ve(t);
  if (!(r != null && r.enabled))
    return null;
  const i = String(e.url || "").trim();
  if (!i)
    return null;
  const a = String(e.resourceKey || "").trim() || void 0, c = kr(t, e.source, i, a), f = r.resources.get(c), p = {
    ...f,
    ...e,
    ext: e.ext || (f == null ? void 0 : f.ext) || Lt(i) || void 0,
    id: bo(t, e.source, i, a),
    kind: e.kind,
    resourceKey: a,
    tabId: t,
    url: i
  };
  return JSON.stringify(f) !== JSON.stringify(p) ? (r.resources.set(c, p), st == null || st(p), p) : f || null;
}
function So(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? e : void 0;
}
function vo(t) {
  const e = String(t || "").trim();
  if (!e)
    return;
  const r = e.match(/\/(\d+)\s*$/);
  if (!(r != null && r[1]))
    return;
  const i = Number(r[1]);
  return Number.isFinite(i) && i > 0 ? i : void 0;
}
function Ar(t) {
  if (t.streamType)
    return t.streamType;
  const e = pt(t.mimeType);
  if (e.startsWith("audio/"))
    return "audio";
  if (e.startsWith("video/"))
    return "video";
  const r = String(t.url || "").toLowerCase();
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(r))
    return "audio";
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(r) || t.resourceType === "media")
    return "video";
}
function To(t) {
  if (!t)
    return;
  const e = {};
  return Object.entries(t).forEach(([r, i]) => {
    const a = r.toLowerCase();
    if (!ho.has(a))
      return;
    const c = String(i || "").trim();
    c && (e[a] = c);
  }), Object.keys(e).length ? e : void 0;
}
function Eo(t) {
  const e = Ve(t);
  return ae(e || Oe());
}
function Co(t) {
  const e = mt(t);
  return e ? (e.enabled = !0, ae(e)) : ae(Oe());
}
function Ro(t) {
  const e = mt(t);
  return e ? (e.enabled = !0, e.deepCaptureEnabled = !0, ae(e)) : ae(Oe());
}
function Bo(t) {
  const e = mt(t);
  return e ? (e.enabled = !1, e.deepCaptureEnabled = !1, ae(e)) : ae(Oe());
}
function Oo(t) {
  const e = mt(t);
  return e ? (e.resources.clear(), ae(e)) : ae(Oe());
}
function mr(t) {
  dt.delete(String(t || "").trim());
}
function xo(t) {
  var e;
  return !!((e = Ve(t)) != null && e.deepCaptureEnabled);
}
function _o(t, e) {
  const r = Ve(t);
  if (!(r != null && r.enabled) || !r.deepCaptureEnabled)
    return null;
  const i = String(e.url || "").trim();
  if (!i)
    return null;
  const a = e.kind || Pr({
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    url: i
  });
  return Fr({ kind: a, resourceType: e.resourceType, url: i }) ? Lr(t, {
    capturedAt: Number(e.capturedAt) || Date.now(),
    contentLength: e.contentLength,
    ext: e.ext,
    kind: a,
    method: e.method,
    mimeType: pt(e.mimeType),
    pageUrl: e.pageUrl,
    resourceType: e.resourceType,
    resourceKey: e.resourceKey,
    source: e.source || "probe",
    statusCode: e.statusCode,
    streamType: Ar({
      mimeType: e.mimeType,
      resourceType: e.resourceType,
      streamType: e.streamType,
      url: i
    }),
    url: i
  }) : null;
}
function Mo(t) {
  fr || (fr = !0, st = t.emitResource, t.browserSession.webRequest.onBeforeSendHeaders((e, r) => {
    ye.set(e.id, {
      referer: e.referrer || void 0,
      requestHeaders: To(e.requestHeaders)
    }), r({ cancel: !1, requestHeaders: e.requestHeaders });
  }), t.browserSession.webRequest.onCompleted((e) => {
    if (!e.webContentsId) {
      ye.delete(e.id);
      return;
    }
    const r = t.resolveTabIdByWebContentsId(e.webContentsId), i = r ? Ve(r) : null;
    if (!r || !(i != null && i.enabled)) {
      ye.delete(e.id);
      return;
    }
    if (e.statusCode < 200 || e.statusCode >= 400) {
      ye.delete(e.id);
      return;
    }
    const a = fn.fromId(e.webContentsId), c = String(e.url || "").trim(), f = ye.get(e.id), p = pt(Ot(e.responseHeaders, "content-type")), w = Pr({
      mimeType: p,
      resourceType: e.resourceType,
      url: c
    });
    if (!Fr({ kind: w, resourceType: e.resourceType, url: c })) {
      ye.delete(e.id);
      return;
    }
    Lr(r, {
      capturedAt: Date.now(),
      contentLength: vo(Ot(e.responseHeaders, "content-range")) || So(Ot(e.responseHeaders, "content-length")),
      ext: Lt(c) || void 0,
      kind: w,
      method: e.method || void 0,
      mimeType: p,
      pageUrl: (a == null ? void 0 : a.getURL()) || void 0,
      referer: (f == null ? void 0 : f.referer) || e.referrer || void 0,
      requestHeaders: f == null ? void 0 : f.requestHeaders,
      resourceType: e.resourceType || void 0,
      source: "network",
      statusCode: e.statusCode || void 0,
      streamType: Ar({
        mimeType: p,
        resourceType: e.resourceType,
        url: c
      }),
      url: c
    }), ye.delete(e.id);
  }), t.browserSession.webRequest.onErrorOccurred((e) => {
    ye.delete(e.id);
  }));
}
function Wr(t) {
  const e = String(t || "").trim();
  if (!e)
    return "";
  try {
    return new URL(e).origin;
  } catch {
    return "";
  }
}
function Do(t) {
  return t === "fileSystem";
}
async function Io(t, e) {
  const r = Wr(e);
  if (!r)
    return !1;
  const i = t.decisionCache.get(r);
  if (typeof i == "boolean")
    return i;
  const a = z.getFocusedWindow() ?? t.options.getMainWindow() ?? z.getAllWindows()[0] ?? void 0, { response: c } = await ie.showMessageBox(a, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${r} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), f = c === 1;
  return t.decisionCache.set(r, f), f;
}
async function Uo(t, e) {
  const r = Wr(e.origin);
  if (!r)
    return "deny";
  const i = z.getFocusedWindow() ?? t.getMainWindow() ?? z.getAllWindows()[0] ?? void 0, { response: a } = await ie.showMessageBox(i, {
    type: "question",
    buttons: ["换个目录", "允许这次访问", "拒绝"],
    defaultId: 0,
    cancelId: 2,
    title: "网页请求访问受限路径",
    message: `${r} 想要访问受限路径。`,
    detail: String(e.path || ""),
    noLink: !0
  });
  return a === 0 ? "tryAgain" : a === 1 ? "allow" : "deny";
}
function Po(t) {
  const e = He.fromPartition(je);
  e.setPermissionRequestHandler((r, i, a, c) => {
    if (!Do(String(i))) {
      a(!1);
      return;
    }
    Io(t, c.requestingUrl || "").then((f) => {
      a(f);
    }).catch(() => {
      a(!1);
    });
  }), e.on("file-system-access-restricted", (r, i, a) => {
    r.preventDefault(), Uo(t.options, i).then((c) => {
      a(c);
    }).catch(() => {
      a("deny");
    });
  });
}
function Fo(t) {
  lo({
    emitDownload: t.emitDownload,
    resolveTabIdByWebContents: t.resolveTabIdByWebContents
  }), Mo({
    browserSession: He.fromPartition(je),
    emitResource: t.emitResource,
    resolveTabIdByWebContentsId: t.resolveTabIdByWebContentsId
  });
}
async function ko(t, e) {
  if (!e || t.webContents.isDestroyed())
    return [];
  try {
    const r = await t.webContents.executeJavaScript(`
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
    return r != null && r.title && i.push(`title=${r.title}`), r != null && r.readyState && i.push(`readyState=${r.readyState}`), typeof (r == null ? void 0 : r.bodyHtmlLength) == "number" && i.push(`bodyHtml=${r.bodyHtmlLength}`), typeof (r == null ? void 0 : r.innerWidth) == "number" && typeof (r == null ? void 0 : r.innerHeight) == "number" && i.push(`viewport=${r.innerWidth}x${r.innerHeight}`), typeof (r == null ? void 0 : r.clientWidth) == "number" && typeof (r == null ? void 0 : r.clientHeight) == "number" && i.push(`client=${r.clientWidth}x${r.clientHeight}`), typeof (r == null ? void 0 : r.devicePixelRatio) == "number" && i.push(`dpr=${r.devicePixelRatio}`), r != null && r.bodyTextPreview && i.push(`preview=${r.bodyTextPreview}`), r != null && r.userAgent && i.push(`ua=${r.userAgent}`), i;
  } catch (r) {
    return [`inspect=${r instanceof Error ? r.message : String(r)}`];
  }
}
function Nr(t, e) {
  const r = t.trim();
  if (!r)
    return "";
  if (r.startsWith("data:"))
    return r;
  try {
    return new URL(r, e || void 0).toString();
  } catch {
    return r;
  }
}
function Lo(t, e) {
  var a;
  const r = (a = String(e || "").split(";")[0]) == null ? void 0 : a.trim();
  if (r != null && r.startsWith("image/"))
    return r;
  const i = (() => {
    try {
      return new URL(t).pathname.toLowerCase();
    } catch {
      return t.toLowerCase();
    }
  })();
  return i.endsWith(".svg") ? "image/svg+xml" : i.endsWith(".ico") ? "image/x-icon" : i.endsWith(".webp") ? "image/webp" : i.endsWith(".jpg") || i.endsWith(".jpeg") ? "image/jpeg" : "image/png";
}
async function $r(t, e) {
  if (!e || e.startsWith("data:"))
    return e;
  try {
    const r = await t.fetch(e);
    if (!r.ok)
      return "";
    const i = Cr.from(await r.arrayBuffer());
    return i.length === 0 ? "" : `data:${Lo(e, r.headers.get("content-type"))};base64,${i.toString("base64")}`;
  } catch (r) {
    return k.warn("embedded browser favicon load failed", {
      error: r instanceof Error ? r.message : String(r),
      iconUrl: e
    }), "";
  }
}
function Ao(t, e) {
  return $r(t.webContents.session, e);
}
function Wo(t, e) {
  const r = [], i = /<link\b[^>]*>/gi, a = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let c;
  for (; c = i.exec(t); ) {
    const f = c[0], p = /* @__PURE__ */ new Map();
    let w;
    for (a.lastIndex = 0; w = a.exec(f); )
      p.set(w[1].toLowerCase(), w[2] || w[3] || w[4] || "");
    const g = p.get("rel") || "", b = p.get("href") || "";
    if (!b || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(g))
      continue;
    const C = Nr(b, e);
    C && r.push(C);
  }
  return r;
}
async function No(t) {
  const e = String((t == null ? void 0 : t.pageUrl) || "").trim(), r = He.fromPartition(je), i = [], a = Nr(String((t == null ? void 0 : t.iconUrl) || ""), e || void 0);
  if (a && !a.startsWith("data:") && i.push(a), e) {
    try {
      const f = await r.fetch(e), p = f.headers.get("content-type") || "";
      f.ok && /text\/html|application\/xhtml\+xml/i.test(p) && i.push(...Wo(await f.text(), e));
    } catch (f) {
      k.warn("embedded browser favicon page inspect failed", {
        error: f instanceof Error ? f.message : String(f),
        pageUrl: e
      });
    }
    try {
      const f = new URL(e).origin;
      i.push(`${f}/favicon.ico`);
    } catch {
    }
  }
  const c = /* @__PURE__ */ new Set();
  for (const f of i) {
    if (!f || c.has(f))
      continue;
    c.add(f);
    const p = await $r(r, f);
    if (p)
      return {
        dataUrl: p,
        iconUrl: f
      };
  }
  return {
    dataUrl: a.startsWith("data:") ? a : "",
    iconUrl: ""
  };
}
const $o = "embedded-browser-open-files", pr = 'input[data-omniflow-browser-open-fallback="true"]';
function zr() {
  return T.join(L.getPath("userData"), $o);
}
function zo() {
  const t = zr();
  return ft(t) || Ut(t, { recursive: !0 }), t;
}
function Ho(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function jo(t, e) {
  const r = T.resolve(t), i = T.resolve(e);
  return r === i ? !0 : r.startsWith(`${i}${T.sep}`);
}
async function Vo(t) {
  const e = await t.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${pr}')
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
      return '${pr}'
    })()
  `, !0);
  return typeof e == "string" && e.trim() ? e.trim() : null;
}
async function qo(t, e, r) {
  var p;
  if (!e || r.length === 0)
    return !1;
  try {
    t.webContents.debugger.isAttached() || t.webContents.debugger.attach("1.3");
  } catch (w) {
    if (!String(w).includes("Already attached"))
      throw w;
  }
  const i = await t.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), a = Number(((p = i == null ? void 0 : i.root) == null ? void 0 : p.nodeId) || 0);
  if (!Number.isFinite(a) || a <= 0)
    return !1;
  const c = await t.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: a,
    selector: e
  }), f = Number((c == null ? void 0 : c.nodeId) || 0);
  return !Number.isFinite(f) || f <= 0 ? !1 : (await t.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: f,
    files: r
  }), !0);
}
async function Ko(t, e) {
  const r = await t.webContents.executeJavaScript(`
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
  return !!(r != null && r.ok);
}
async function Go(t, e, r = {}) {
  const i = zo(), a = T.join(i, Ho(e));
  return await Ft(t, a, r), a;
}
async function ut(t) {
  const e = T.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const r = T.resolve(zr());
  return jo(e, r) ? (await ct.rm(e, { force: !0 }), !0) : !1;
}
async function Jo(t, e) {
  if (!t || t.webContents.isDestroyed())
    return !1;
  const r = await Vo(t);
  return !r || !await qo(t, r, [e]) ? !1 : Ko(t, r);
}
function nt(t) {
  const e = t.pendingOpenFiles.get(t.tabId);
  e != null && e.stagedPath && ut(e.stagedPath).catch(() => {
  }), t.pendingOpenFiles.delete(t.tabId);
  const r = t.attachedOpenFiles.get(t.tabId);
  r && ut(r).catch(() => {
  }), t.attachedOpenFiles.delete(t.tabId);
}
function ot(t) {
  const e = (t.requestVersions.get(t.tabId) ?? 0) + 1;
  return t.requestVersions.set(t.tabId, e), e;
}
function gr(t) {
  return t.requestVersions.get(t.tabId) === t.version;
}
function Xo(t, e) {
  try {
    const r = new URL(t), i = new URL(e);
    if (r.origin !== i.origin)
      return !1;
    const a = r.pathname.replace(/\/+$/, "") || "/", c = i.pathname.replace(/\/+$/, "") || "/";
    return c === "/" ? !0 : a === c || a.startsWith(`${c}/`);
  } catch {
    return !1;
  }
}
async function yr(t) {
  const e = t.pendingOpenFiles.get(t.tabId);
  if (!e || t.view.webContents.isDestroyed())
    return !1;
  const r = t.view.webContents.getURL() || t.currentUrls.get(t.tabId) || "";
  if (!r || !Xo(r, e.pageUrl))
    return !1;
  try {
    if (!await Jo(t.view, e.stagedPath))
      return !1;
    const a = t.attachedOpenFiles.get(t.tabId);
    return a && a !== e.stagedPath && ut(a).catch(() => {
    }), t.attachedOpenFiles.set(t.tabId, e.stagedPath), t.pendingOpenFiles.delete(t.tabId), !0;
  } catch {
    return !1;
  }
}
function Zo(t, e) {
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
function Yo(t) {
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
function Qo(t) {
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
async function hr(t, e, r) {
  const i = String(r || "").trim();
  return i ? !!await t(
    Zo(e, i)
  ) : !1;
}
async function ei(t, e) {
  return String(e.url || "").trim() ? !!await t(
    Yo(e)
  ) : !1;
}
async function br(t, e) {
  const r = String(e || "").trim();
  if (!r)
    return null;
  const i = await t(
    Qo(r)
  );
  if (!i || typeof i != "object")
    return null;
  const a = i;
  return typeof a.base64 != "string" || typeof a.fileName != "string" ? null : {
    base64: a.base64,
    fileName: a.fileName,
    mimeType: typeof a.mimeType == "string" ? a.mimeType : void 0,
    resourceKey: typeof a.resourceKey == "string" ? a.resourceKey : r,
    streamType: a.streamType === "audio" || a.streamType === "video" ? a.streamType : void 0
  };
}
const Dt = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function ti() {
  return `(${Hr.toString()})(${JSON.stringify(Dt)});`;
}
function Hr(t) {
  var or, ir, ar, sr, cr;
  const e = globalThis, r = typeof document > "u" && typeof e.importScripts == "function", i = typeof ((or = e.location) == null ? void 0 : or.href) == "string" ? e.location.href : "", a = typeof ((ir = e.location) == null ? void 0 : ir.hostname) == "string" ? e.location.hostname : "resource", c = typeof ((ar = e.location) == null ? void 0 : ar.protocol) == "string" ? e.location.protocol : "https:", f = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__", p = typeof e.open == "function" ? e.open.bind(e) : null;
  if (e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)
    return "already-installed";
  const w = /* @__PURE__ */ new Set(), g = /* @__PURE__ */ new Map(), b = /* @__PURE__ */ new Map(), C = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new WeakMap();
  let R = 0, D = 0;
  const U = /* @__PURE__ */ new Set(["m3u8", "mpd"]), Q = /* @__PURE__ */ new Set([
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
  ]), ee = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), J = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), be = /^data:(application|video|audio)\//i, H = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i, Ee = /(m3u8|mpd)(\?|$)/i, P = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv)(\?|$)/i, te = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|$)/i, N = /\.(vtt|srt|ass|ssa|ttml)(\?|$)/i, le = /\.pdf(\?|$)/i, fe = JSON.parse.bind(JSON), re = typeof console.info == "function" ? console.info.bind(console) : console.log.bind(console), F = {
    autoDownloadOnComplete: "OmniflowCatchToolkit:autoDownloadOnComplete",
    autoSeekToBufferedEnd: "OmniflowCatchToolkit:autoSeekToBufferedEnd",
    clearCacheOnComplete: "OmniflowCatchToolkit:clearCacheOnComplete",
    manualFileName: "OmniflowCatchToolkit:manualFileName",
    regexRule: "OmniflowCatchToolkit:regexRule",
    restartAlwaysFromBeginning: "OmniflowCatchToolkit:restartAlwaysFromBeginning",
    selectorRule: "OmniflowCatchToolkit:selectorRule",
    trimExtraMediaHeaders: "OmniflowCatchToolkit:trimExtraMediaHeaders"
  };
  let M = "", j = !1;
  const E = {
    autoSeekToBufferedEnd: !1,
    autoDownloadOnComplete: !1,
    clearCacheOnComplete: !1,
    manualFileName: "",
    regexRule: "",
    restartAlwaysFromBeginning: !1,
    selectorRule: "",
    trimExtraMediaHeaders: !0
  }, qe = /* @__PURE__ */ new WeakSet(), xe = /* @__PURE__ */ new WeakSet();
  let _e = null;
  function Me(n) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(n) || "").trim();
    } catch {
      return "";
    }
  }
  function we(n, o = !1) {
    try {
      return typeof localStorage > "u" ? o : localStorage.getItem(n) === "checked";
    } catch {
      return o;
    }
  }
  function De(n, o) {
    try {
      if (typeof localStorage > "u")
        return;
      const s = String(o || "").trim();
      if (!s) {
        localStorage.removeItem(n);
        return;
      }
      localStorage.setItem(n, s);
    } catch {
    }
  }
  function Se(n, o) {
    try {
      if (typeof localStorage > "u")
        return;
      localStorage.setItem(n, o ? "checked" : "");
    } catch {
    }
  }
  function Ie(n) {
    var s;
    const o = String(n || "").trim();
    if (!o)
      return {
        rule: "",
        warning: ""
      };
    if (typeof document > "u")
      return {
        rule: o,
        warning: ""
      };
    try {
      const l = document.querySelector(o), y = ((s = l == null ? void 0 : l.textContent) == null ? void 0 : s.trim()) || "";
      return {
        rule: o,
        warning: y ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function Ue(n) {
    const o = String(n || "").trim();
    if (!o)
      return {
        rule: "",
        warning: ""
      };
    try {
      return new RegExp(o, "g"), {
        rule: o,
        warning: ""
      };
    } catch {
      return {
        rule: "",
        warning: "正则表达式错误"
      };
    }
  }
  function gt() {
    r || (E.autoDownloadOnComplete = we(
      F.autoDownloadOnComplete,
      E.autoDownloadOnComplete
    ), E.autoSeekToBufferedEnd = we(
      F.autoSeekToBufferedEnd,
      E.autoSeekToBufferedEnd
    ), E.clearCacheOnComplete = we(
      F.clearCacheOnComplete,
      E.clearCacheOnComplete
    ), E.manualFileName = Me(F.manualFileName), E.restartAlwaysFromBeginning = we(
      F.restartAlwaysFromBeginning,
      E.restartAlwaysFromBeginning
    ), E.trimExtraMediaHeaders = we(
      F.trimExtraMediaHeaders,
      E.trimExtraMediaHeaders
    ), E.selectorRule = Ie(
      Me(F.selectorRule)
    ).rule, E.regexRule = Ue(
      Me(F.regexRule)
    ).rule);
  }
  function yt() {
    r || (Se(
      F.autoDownloadOnComplete,
      E.autoDownloadOnComplete
    ), Se(
      F.autoSeekToBufferedEnd,
      E.autoSeekToBufferedEnd
    ), Se(
      F.clearCacheOnComplete,
      E.clearCacheOnComplete
    ), De(
      F.manualFileName,
      E.manualFileName
    ), De(
      F.regexRule,
      E.regexRule
    ), Se(
      F.restartAlwaysFromBeginning,
      E.restartAlwaysFromBeginning
    ), De(
      F.selectorRule,
      E.selectorRule
    ), Se(
      F.trimExtraMediaHeaders,
      E.trimExtraMediaHeaders
    ));
  }
  gt();
  function Pe() {
    return typeof document > "u" || typeof document.title != "string" ? "" : document.title.trim();
  }
  function ve() {
    var y, v;
    const n = ke(E.manualFileName);
    if (n !== "media")
      return n;
    let o = "";
    const s = String(E.selectorRule || "").trim();
    if (s && typeof document < "u")
      try {
        const O = document.querySelector(s), $ = ((y = O == null ? void 0 : O.textContent) == null ? void 0 : y.trim()) || "";
        $ && (o = $);
      } catch {
      }
    const l = String(E.regexRule || "").trim();
    if (l && typeof document < "u")
      try {
        const O = o || ((v = document.documentElement) == null ? void 0 : v.outerHTML) || "";
        if (O) {
          const $ = new RegExp(l, "g"), ce = Array.from(O.matchAll($)).flatMap((G) => G.length > 1 ? G.slice(1).filter((de) => typeof de == "string" && de.trim()) : G[0] ? [G[0]] : []);
          ce.length > 0 && (o = ce.join("_"));
        }
      } catch {
      }
    return ke(o || Pe() || a || "media");
  }
  function Ce(n) {
    if (typeof n != "string")
      return "";
    const o = n.trim();
    if (!o || o.startsWith("data:"))
      return "";
    if (o.startsWith("//"))
      return `${c}${o}`;
    if (o.startsWith("blob:"))
      return o;
    try {
      if (H.test(o))
        return new URL(o, i).toString();
      if (/^https?:\/\//i.test(o))
        return o;
    } catch {
      return "";
    }
    return "";
  }
  function ht(n) {
    try {
      const s = (new URL(n, i).pathname || "").toLowerCase().match(/\.([a-z0-9]+)$/i);
      return (s == null ? void 0 : s[1]) || "";
    } catch {
      const o = n.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      return (o == null ? void 0 : o[1]) || "";
    }
  }
  function Ke(n, o) {
    var y;
    const s = ht(n), l = (y = String(o || "").split(";")[0]) == null ? void 0 : y.trim().toLowerCase();
    return U.has(s) || l.includes("mpegurl") || l.includes("dash+xml") || Ee.test(n) ? "manifest" : Q.has(s) || l.startsWith("video/") || l.startsWith("audio/") || P.test(n) || n.startsWith("blob:") ? "media" : ee.has(s) || l.startsWith("image/") || te.test(n) ? "image" : J.has(s) || l.includes("text/vtt") || N.test(n) ? "subtitle" : s === "pdf" || l === "application/pdf" || le.test(n) ? "document" : "other";
  }
  function Fe(n, o) {
    var l;
    const s = (l = String(n || "").split(";")[0]) == null ? void 0 : l.trim().toLowerCase();
    return s === "audio/mp4" ? "m4a" : s === "video/mp4" ? "mp4" : s === "audio/mpeg" ? "mp3" : s === "audio/aac" ? "aac" : s.endsWith("/webm") ? "webm" : s.endsWith("/ogg") ? "ogg" : s.endsWith("/wav") ? "wav" : o === "audio" ? "m4a" : "mp4";
  }
  function ke(n) {
    return String(n || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "media";
  }
  function Ge() {
    const n = Ie(E.selectorRule), o = Ue(E.regexRule), s = Array.from(g.values()).reduce((l, y) => l + Math.max(0, Number(y.totalBytes || 0)), 0);
    return {
      autoSeekToBufferedEnd: E.autoSeekToBufferedEnd,
      autoDownloadOnComplete: E.autoDownloadOnComplete,
      capturedMediaSizeBytes: s,
      clearCacheOnComplete: E.clearCacheOnComplete,
      currentFileName: ve(),
      isCaptureComplete: j,
      manualFileName: E.manualFileName,
      regexWarning: o.warning,
      regexRule: o.rule,
      restartAlwaysFromBeginning: E.restartAlwaysFromBeginning,
      selectorWarning: n.warning,
      selectorRule: n.rule,
      streamCount: g.size,
      trimExtraMediaHeaders: E.trimExtraMediaHeaders
    };
  }
  function bt(n) {
    return n instanceof ArrayBuffer ? n.slice(0) : ArrayBuffer.isView(n) ? n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength) : null;
  }
  function d(n) {
    const o = new Uint8Array(n), s = 32768;
    let l = "";
    for (let y = 0; y < o.length; y += s) {
      const v = o.subarray(y, Math.min(y + s, o.length));
      l += String.fromCharCode(...v);
    }
    return btoa(l);
  }
  function u(n) {
    return d(new TextEncoder().encode(n).buffer);
  }
  function m(n) {
    const o = atob(n), s = new Uint8Array(o.length);
    for (let l = 0; l < o.length; l += 1)
      s[l] = o.charCodeAt(l);
    return s.buffer;
  }
  function S(n) {
    const o = String(n || "").trim();
    return o.length === 24 && o.endsWith("==") && /^[A-Za-z0-9+/]+={0,2}$/.test(o);
  }
  function B(n) {
    return /^[A-Fa-f0-9]{32}$/.test(String(n || "").trim());
  }
  function _(n) {
    try {
      const s = new URL(n, i).toString().split("/");
      return s.pop(), `${s.join("/")}/`;
    } catch {
      return "";
    }
  }
  function I(n, o) {
    return !n || !o ? o : o.split(`
`).map((s) => {
      const l = s.trim();
      if (!l || l.startsWith("#"))
        return l.includes('URI="') ? l.replace(/URI="(.*)"/, (y, v) => Ce(v) ? `URI="${v}"` : `URI="${n}${v}"`) : s;
      if (Ce(l))
        return l;
      if (l.startsWith("/"))
        try {
          const y = new URL(n);
          return `${y.protocol}//${y.host}${l}`;
        } catch {
          return `${n}${l.replace(/^\//, "")}`;
        }
      return `${n}${l}`;
    }).join(`
`);
  }
  function V(n) {
    const o = String(n || "").trim();
    if (!o || !/^[\[{]/.test(o))
      return null;
    try {
      return fe(o);
    } catch {
      return null;
    }
  }
  function se(n) {
    const o = String(n || "").trim();
    if (!be.test(o))
      return "";
    const s = o.indexOf(",");
    if (s === -1)
      return "";
    const l = o.slice(0, s), y = o.slice(s + 1);
    try {
      return /;base64/i.test(l) ? new TextDecoder().decode(m(y)) : decodeURIComponent(y);
    } catch {
      return "";
    }
  }
  function K(n, o = 16) {
    if (n.byteLength <= o || n.byteLength % o !== 0)
      return null;
    const s = new Uint8Array(n), l = s.slice(0, o);
    for (let y = o; y < s.length; y += o)
      for (let v = 0; v < o; v += 1)
        if (s[y + v] !== l[v])
          return null;
    return l.buffer;
  }
  function ne(n) {
    return n.byteLength === 16 ? n.slice(0) : n.byteLength === 32 ? K(n, 16) || n.slice(0, 16) : n.byteLength === 128 || n.byteLength === 256 ? K(n, 16) : null;
  }
  function Te() {
    return D += 1, `probe-resource:${Date.now()}-${D}`;
  }
  function me(n, o) {
    const s = n === "key" ? `${Pe() || a || "resource"}-key` : Pe() || a || "resource";
    return `${ke(s)}.${o}`;
  }
  function Je(n) {
    const o = C.get(n.signature);
    if (o) {
      const O = b.get(o);
      if (O)
        return {
          contentLength: O.contentLength,
          fileName: O.fileName,
          resourceKey: o,
          url: O.blobUrl
        };
    }
    const s = new Blob([m(n.base64)], { type: n.mimeType }), l = Te(), y = me(n.kind, n.ext), v = URL.createObjectURL(s);
    return C.set(n.signature, l), b.set(l, {
      base64: n.base64,
      blobUrl: v,
      contentLength: s.size,
      fileName: y,
      mimeType: n.mimeType,
      streamType: n.streamType
    }), {
      contentLength: s.size,
      fileName: y,
      resourceKey: l,
      url: v
    };
  }
  function Re(n) {
    if (!r || typeof e.postMessage != "function")
      return !1;
    try {
      return e.postMessage({ [f]: n }), !0;
    } catch {
      return !1;
    }
  }
  function Le(n, o = !1) {
    if (r && !o) {
      Re({ payload: n, type: "generated-resource" });
      return;
    }
    const s = Je(n);
    Ze({
      contentLength: s.contentLength,
      ext: n.ext,
      kind: n.kind,
      mimeType: n.mimeType,
      resourceKey: s.resourceKey,
      resourceType: n.resourceType,
      source: "probe",
      streamType: n.streamType,
      url: s.url
    }, o);
  }
  function pe(n, o = "key") {
    const s = ne(n);
    if (!s)
      return !1;
    const l = d(s);
    return Le({
      base64: l,
      ext: o,
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${l}`
    }), !0;
  }
  function Xe(n) {
    if (!S(n))
      return !1;
    try {
      return m(n).byteLength !== 16 ? !1 : (Le({
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
  function $t(n) {
    const o = String(n || "").trim().toLowerCase();
    if (!B(o))
      return !1;
    const s = new Uint8Array(16);
    for (let l = 0; l < 16; l += 1)
      s[l] = Number.parseInt(o.slice(l * 2, l * 2 + 2), 16);
    return Le({
      base64: d(s.buffer),
      ext: "key",
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${o}`
    }), !0;
  }
  function wt(n, o, s) {
    const l = o === "m3u8" ? I(_(s || i), n) : n;
    Le({
      base64: u(l),
      ext: o,
      kind: "manifest",
      mimeType: o === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml",
      resourceType: "inline-manifest",
      signature: `${o}:${l}`
    });
  }
  function Jr(n) {
    const o = new Uint8Array(n);
    return o.length > 8 && o[4] === 102 && o[5] === 116 && o[6] === 121 && o[7] === 112;
  }
  function Xr(n) {
    const o = new Uint8Array(n);
    return o.length > 4 && o[0] === 26 && o[1] === 69 && o[2] === 223 && o[3] === 163;
  }
  function St(n) {
    if (!E.trimExtraMediaHeaders || !Array.isArray(n) || n.length <= 1)
      return n;
    let o = -1;
    return n.forEach((s, l) => {
      (Jr(s) || Xr(s)) && (o = l);
    }), o > 0 ? n.slice(o) : n;
  }
  function Ze(n, o = !1) {
    if (n.url) {
      if (n.resourceType !== "mse-stream") {
        const s = `${n.resourceKey || n.source}:${n.resourceType || "unknown"}:${n.url}`;
        if (w.has(s))
          return;
        w.add(s), w.size > 2e3 && (w.clear(), w.add(s));
      }
      if (r && !o) {
        Re({ payload: n, type: "capture" });
        return;
      }
      try {
        re(t + JSON.stringify({
          capturedAt: Date.now(),
          contentLength: n.contentLength,
          ext: n.ext,
          kind: n.kind || Ke(n.url, n.mimeType),
          mimeType: n.mimeType,
          pageUrl: i,
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
  function Zr(n) {
    const o = n.map((s) => String(s || "").toLowerCase());
    if (o.some((s) => s === "audio" || s.includes("audio")))
      return "audio";
    if (o.some((s) => s === "video" || s.includes("video")))
      return "video";
  }
  function vt(n) {
    if (qe.has(n))
      return;
    qe.add(n), n.addEventListener("progress", () => {
      if (E.autoSeekToBufferedEnd)
        try {
          if (!n.buffered || n.buffered.length === 0)
            return;
          const l = n.buffered.end(n.buffered.length - 1), y = Math.max(l - 5, 0), v = Number.isFinite(n.duration) ? n.duration : 0;
          if (v > 0 && l >= v)
            return;
          Math.abs(n.currentTime - y) > 1 && (n.currentTime = y);
        } catch {
        }
    });
    const o = () => {
      if (!(!E.restartAlwaysFromBeginning || xe.has(n)))
        try {
          xe.add(n), Be(), n.currentTime = 0;
        } catch {
        }
    };
    n.addEventListener("play", () => {
      o();
    }, { once: !0 });
    const s = window.setInterval(() => {
      if (xe.has(n) || !E.restartAlwaysFromBeginning) {
        window.clearInterval(s);
        return;
      }
      n.paused || (o(), window.clearInterval(s));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(s);
    }, 5e3);
  }
  function Yr() {
    typeof document > "u" || document.querySelectorAll("video, audio").forEach((n) => {
      n instanceof HTMLMediaElement && vt(n);
    });
  }
  function Tt() {
    r || typeof MutationObserver > "u" || _e || typeof document > "u" || (Yr(), _e = new MutationObserver((n) => {
      n.forEach((o) => {
        o.addedNodes.forEach((s) => {
          if (s instanceof Element) {
            if (s instanceof HTMLMediaElement) {
              vt(s);
              return;
            }
            s.querySelectorAll("video, audio").forEach((l) => {
              l instanceof HTMLMediaElement && vt(l);
            });
          }
        });
      });
    }), _e.observe(document.body || document.documentElement, {
      childList: !0,
      subtree: !0
    }));
  }
  function Be() {
    let n = !1;
    return g.forEach((o) => {
      if (o.blobUrl && (URL.revokeObjectURL(o.blobUrl), o.blobUrl = ""), j) {
        n = n || o.buffers.length > 0, o.buffers = [], o.bufferCount = 0, o.lastReportedBufferCount = 0, o.lastReportedBytes = 0, o.totalBytes = 0, Ae(o.streamId);
        return;
      }
      if (o.buffers.length > 1) {
        const s = o.buffers[0];
        o.buffers = s ? [s] : [], o.bufferCount = o.buffers.length, o.totalBytes = (s == null ? void 0 : s.byteLength) || 0, o.lastReportedBufferCount = o.bufferCount, o.lastReportedBytes = o.totalBytes, n = !0, Ae(o.streamId);
      }
    }), j = !1, n;
  }
  function zt() {
    if (typeof document > "u")
      return !1;
    const n = Array.from(g.values()).filter((s) => s.buffers.length > 0);
    if (n.length === 0)
      return !1;
    const o = ve();
    return n.forEach((s) => {
      const l = St(s.buffers), y = new Blob(l, { type: s.mimeType }), v = document.createElement("a"), O = URL.createObjectURL(y), $ = Fe(s.mimeType, s.streamType), Z = n.length > 1 && s.streamType ? `-${s.streamType}` : "";
      v.href = O, v.download = `${o}${Z}.${$}`, v.click(), v.remove(), setTimeout(() => {
        URL.revokeObjectURL(O);
      }, 1e3);
    }), E.clearCacheOnComplete && setTimeout(() => {
      Be();
    }, 0), !0;
  }
  function Qr() {
    if (typeof document > "u")
      return !1;
    Be();
    let n = !1;
    return document.querySelectorAll("video, audio").forEach((o) => {
      if (o instanceof HTMLMediaElement)
        try {
          o.currentTime = 0, o.play().catch(() => {
          }), n = !0;
        } catch {
        }
    }), n;
  }
  function en(n) {
    return `mse-stream:${n}`;
  }
  function Ae(n) {
    const o = g.get(n);
    o && Ze({
      contentLength: o.totalBytes,
      ext: Fe(o.mimeType, o.streamType),
      kind: "media",
      mimeType: o.mimeType,
      resourceKey: en(n),
      resourceType: "mse-stream",
      source: "probe",
      streamType: o.streamType,
      url: o.blobUrl || `mse://capturing/${n}`
    });
  }
  function Ht(n) {
    const o = g.get(n);
    if (!o || o.buffers.length === 0)
      return !1;
    o.blobUrl && (URL.revokeObjectURL(o.blobUrl), o.blobUrl = "");
    try {
      const s = St(o.buffers);
      return o.blobUrl = URL.createObjectURL(new Blob(s, { type: o.mimeType })), Ae(n), !0;
    } catch {
      return !1;
    }
  }
  function jt(n) {
    const o = g.get(n);
    return o ? (o.blobUrl || Ht(n), o.blobUrl) : "";
  }
  function Vt(n) {
    const o = g.get(n);
    if (!o)
      return "media.bin";
    const s = ve(), l = o.streamType ? `-${o.streamType}` : "", y = Fe(o.mimeType, o.streamType);
    return `${s}${l}.${y}`;
  }
  function tn(n) {
    const o = String(n || "").replace(/^mse-stream:/, ""), s = jt(o);
    if (!s || typeof document > "u")
      return !1;
    const l = document.createElement("a");
    return l.href = s, l.download = Vt(o), l.click(), l.remove(), E.clearCacheOnComplete && setTimeout(() => {
      Be();
    }, 0), !0;
  }
  function rn(n) {
    const o = String(n || "").replace(/^mse-stream:/, ""), s = jt(o);
    return !s || !p ? !1 : (p(s, "_blank", "noopener,noreferrer"), !0);
  }
  async function nn(n) {
    const o = String(n || "").replace(/^mse-stream:/, ""), s = g.get(o);
    if (!s || s.buffers.length === 0)
      return null;
    try {
      const l = St(s.buffers), v = await new Blob(l, { type: s.mimeType }).arrayBuffer();
      return {
        base64: d(v),
        fileName: Vt(o),
        mimeType: s.mimeType,
        resourceKey: n,
        streamType: s.streamType
      };
    } catch {
      return null;
    }
  }
  function on(n) {
    const o = b.get(n);
    return !(o != null && o.blobUrl) || !p ? !1 : (p(o.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function an(n) {
    const o = b.get(n);
    if (!(o != null && o.blobUrl) || typeof document > "u")
      return !1;
    const s = document.createElement("a");
    return s.href = o.blobUrl, s.download = o.fileName, s.click(), s.remove(), !0;
  }
  function sn(n) {
    const o = b.get(n);
    return o ? Promise.resolve({
      base64: o.base64,
      fileName: o.fileName,
      mimeType: o.mimeType,
      resourceKey: n,
      streamType: o.streamType
    }) : Promise.resolve(null);
  }
  function cn(n) {
    if (!n || typeof n != "object")
      return !1;
    const o = n[f];
    return !o || typeof o != "object" || !("type" in o) ? !1 : r ? Re(o) : o.type === "capture" ? (Ze(o.payload, !0), !0) : o.type === "generated-resource" ? (Le(o.payload, !0), !0) : !1;
  }
  const Et = e.Worker;
  typeof Et == "function" && (e.Worker = new Proxy(Et, {
    construct(n, o, s) {
      const [l, y] = o, v = () => {
        const Z = typeof l == "string" ? l : String(l), ce = Ce(Z) || Z;
        if (!ce)
          return "";
        const G = `;(${Hr.toString()})(${JSON.stringify(t)});
`;
        let de = "";
        if ((y == null ? void 0 : y.type) === "module")
          de = `${G}import ${JSON.stringify(ce)};
`;
        else {
          const ge = new XMLHttpRequest();
          if (ge.open("GET", ce, !1), ge.send(), ge.status < 200 || ge.status >= 300 || !ge.responseText)
            return "";
          de = `${G}${ge.responseText}`;
        }
        return URL.createObjectURL(new Blob([de], { type: "text/javascript" }));
      };
      let O = "";
      try {
        O = v();
      } catch {
        O = "";
      }
      const $ = O ? Reflect.construct(n, [O, y], s) : Reflect.construct(n, o, s);
      return $.addEventListener("message", (Z) => {
        cn(Z.data) && Z.stopImmediatePropagation();
      }, { capture: !0 }), O && setTimeout(() => {
        URL.revokeObjectURL(O);
      }, 6e4), $;
    }
  }), e.Worker.toString = function() {
    return Et.toString();
  });
  const oe = e.MediaSource;
  if ((sr = oe == null ? void 0 : oe.prototype) != null && sr.addSourceBuffer) {
    const n = oe.prototype.addSourceBuffer;
    oe.prototype.addSourceBuffer = new Proxy(n, {
      apply(o, s, l) {
        var v;
        const y = Reflect.apply(o, s, l);
        try {
          Tt(), j = !1;
          const O = s, $ = String((l == null ? void 0 : l[0]) || "").trim(), Z = ((v = $.split(";")[0]) == null ? void 0 : v.trim().toLowerCase()) || "", ce = Z.startsWith("audio/") ? "audio" : Z.startsWith("video/") ? "video" : void 0, G = `${Date.now()}-${++R}`, de = h.get(O) || [];
          if (de.push(G), h.set(O, de), g.set(G, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: $ || (ce === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: G,
            streamType: ce,
            totalBytes: 0
          }), Ae(G), y && typeof y.appendBuffer == "function") {
            const ge = y.appendBuffer;
            y.appendBuffer = new Proxy(ge, {
              apply(dn, un, Qe) {
                const Rt = Reflect.apply(dn, un, Qe), Y = g.get(G);
                if (!Y)
                  return Rt;
                const et = bt(Qe == null ? void 0 : Qe[0]);
                return !et || et.byteLength === 0 || (Y.buffers.push(et), Y.bufferCount += 1, Y.totalBytes += et.byteLength, (Y.bufferCount <= 3 || Y.bufferCount - Y.lastReportedBufferCount >= 8 || Y.totalBytes - Y.lastReportedBytes >= 1024 * 512) && (Y.lastReportedBufferCount = Y.bufferCount, Y.lastReportedBytes = Y.totalBytes, Ae(G))), Rt;
              }
            });
          }
        } catch {
        }
        return y;
      }
    });
  }
  if ((cr = oe == null ? void 0 : oe.prototype) != null && cr.endOfStream) {
    const n = oe.prototype.endOfStream;
    oe.prototype.endOfStream = new Proxy(n, {
      apply(o, s, l) {
        const y = Reflect.apply(o, s, l);
        try {
          if (j = !0, (h.get(s) || []).forEach((O) => {
            Ht(O);
          }), E.autoDownloadOnComplete)
            return setTimeout(() => {
              zt();
            }, 500), y;
          E.clearCacheOnComplete && setTimeout(() => {
            Be();
          }, 0);
        } catch {
        }
        return y;
      }
    });
  }
  function X(n, o) {
    if (typeof n != "string")
      return;
    const s = n.trim();
    if (!s || Xe(s))
      return;
    const l = s.split("").join("").trim();
    if ($t(l))
      return;
    if (be.test(s)) {
      const $ = se(s);
      $ && X($, o);
      return;
    }
    const y = V(s);
    if (y) {
      We(y);
      return;
    }
    const v = s.toUpperCase();
    if (v.startsWith("#EXTM3U") || v.includes("#EXTINF:")) {
      wt(s, "m3u8", o == null ? void 0 : o.baseUrl);
      return;
    }
    if (s.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || s.includes("<MPD") && s.includes("</MPD>")) {
      wt(s, "mpd", o == null ? void 0 : o.baseUrl);
      return;
    }
    const O = Ce(s);
    O && Ze({
      kind: Ke(O, o == null ? void 0 : o.mimeType),
      mimeType: o == null ? void 0 : o.mimeType,
      resourceType: o == null ? void 0 : o.resourceType,
      source: "probe",
      streamType: o == null ? void 0 : o.streamType,
      url: O
    });
  }
  function We(n, o = 0, s = /* @__PURE__ */ new WeakSet(), l = []) {
    if (o > 6 || n == null)
      return;
    if (n instanceof ArrayBuffer) {
      pe(n);
      return;
    }
    if (ArrayBuffer.isView(n)) {
      pe(n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength));
      return;
    }
    if (typeof n == "string") {
      X(n, {
        baseUrl: i,
        resourceType: "json",
        streamType: Zr(l)
      });
      return;
    }
    if (typeof n != "object")
      return;
    const y = n;
    if (!s.has(y)) {
      if (s.add(y), Array.isArray(n)) {
        if (n.length === 16 && n.every((v) => typeof v == "number" && Number.isFinite(v) && v >= 0 && v <= 255)) {
          pe(Uint8Array.from(n).buffer);
          return;
        }
        n.slice(0, 80).forEach((v, O) => {
          We(v, o + 1, s, l.concat(String(O)));
        });
        return;
      }
      Object.keys(n).slice(0, 80).forEach((v) => {
        We(n[v], o + 1, s, l.concat(v));
      });
    }
  }
  const Ct = typeof e.fetch == "function" ? e.fetch.bind(e) : null;
  Ct && (e.fetch = async function(n, o) {
    const s = typeof n == "string" ? n : n instanceof Request ? n.url : String(n);
    X(s, { resourceType: "fetch" });
    const l = await Ct(n, o);
    return X(l.url || s, {
      mimeType: l.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), l.clone().arrayBuffer().then((v) => {
      if (!v.byteLength || pe(v))
        return;
      const O = new TextDecoder().decode(v);
      O.trim() && X(O, {
        baseUrl: l.url || s,
        mimeType: l.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), l;
  }, e.fetch.toString = function() {
    return Ct.toString();
  });
  const qt = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", Kt = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(n, o) {
    return this[qt] = typeof o == "string" ? o : String(o), Kt.apply(this, arguments);
  };
  const Gt = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const n = this[qt], o = this.responseURL || (typeof n == "string" ? n : "");
      if (X(o, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (pe(this.response))
          return;
        const s = new TextDecoder().decode(this.response);
        s && X(s, {
          baseUrl: o,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        X(this.response, {
          baseUrl: o,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (this.response && typeof this.response == "object") {
        We(this.response);
        return;
      }
      typeof this.responseText == "string" && this.responseText.trim() && X(this.responseText, {
        baseUrl: o,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), Gt.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return Kt.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return Gt.toString();
  }, JSON.parse = function() {
    const n = fe.apply(this, arguments);
    return We(n), n;
  }, JSON.parse.toString = function() {
    return fe.toString();
  };
  const Jt = btoa;
  e.btoa = function(n) {
    const o = Jt.apply(this, arguments);
    return Xe(o), X(n, { baseUrl: i, resourceType: "btoa" }), o;
  }, btoa.toString = function() {
    return Jt.toString();
  };
  const Xt = atob;
  e.atob = function(n) {
    const o = Xt.apply(this, arguments);
    return Xe(n), X(o, { baseUrl: i, resourceType: "atob" }), o;
  }, atob.toString = function() {
    return Xt.toString();
  };
  const Zt = String.fromCharCode;
  String.fromCharCode = new Proxy(Zt, {
    apply(n, o, s) {
      const l = Reflect.apply(n, o, s);
      if (l.length >= 7) {
        if ((l.startsWith("#EXTM3U") || l.includes("#EXTINF:")) && (M += l, M.includes("#EXT-X-ENDLIST"))) {
          const v = M.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          wt(v, "m3u8", i), M = "";
        }
        const y = l.split("").join("").trim();
        $t(y);
      }
      return l;
    }
  }), String.fromCharCode.toString = function() {
    return Zt.toString();
  };
  const Yt = Array.prototype.slice;
  Array.prototype.slice = function() {
    const n = Yt.apply(this, arguments);
    return Array.isArray(n) && n.length === 16 && n.every((o) => typeof o == "number" && Number.isFinite(o) && o >= 0 && o <= 255) && pe(Uint8Array.from(n).buffer), n;
  }, Array.prototype.slice.toString = function() {
    return Yt.toString();
  };
  const Qt = Array.prototype.join;
  Array.prototype.join = function() {
    const n = Qt.apply(this, arguments);
    return typeof n == "string" && ((n.startsWith("#EXTM3U") || n.includes("#EXTINF:")) && X(n, { baseUrl: i, resourceType: "array-join" }), Xe(n)), n;
  }, Array.prototype.join.toString = function() {
    return Qt.toString();
  };
  const Ye = e.DataView;
  if (typeof Ye == "function") {
    const n = function(o, s, l) {
      const y = new Ye(o, s, l), v = () => {
        const O = y.buffer.slice(y.byteOffset, y.byteOffset + y.byteLength);
        pe(O);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((O) => {
        const $ = y[O];
        typeof $ == "function" && (y[O] = function() {
          const Z = $.apply(this, arguments);
          return v(), Z;
        });
      }), v(), y;
    };
    n.prototype = Ye.prototype, n.toString = function() {
      return Ye.toString();
    }, e.DataView = n;
  }
  function er(n) {
    return function() {
      const o = n.apply(this, arguments);
      return (o == null ? void 0 : o.byteLength) === 16 && pe(o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength)), o;
    };
  }
  const tr = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = er(tr), Int8Array.prototype.subarray.toString = function() {
    return tr.toString();
  };
  const rr = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = er(rr), Uint8Array.prototype.subarray.toString = function() {
    return rr.toString();
  };
  const nr = String.prototype.indexOf;
  return String.prototype.indexOf = function(n, o) {
    const s = nr.apply(this, arguments);
    if (n === "#EXTM3U" && s !== -1) {
      const l = String(this);
      X(l.slice(Math.max(o ?? 0, 0)), {
        baseUrl: i,
        resourceType: "string-indexof"
      });
    }
    return s;
  }, String.prototype.indexOf.toString = function() {
    return nr.toString();
  }, r || Tt(), e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return Be();
    },
    downloadCatchMedia() {
      return zt();
    },
    exportResource(n) {
      const o = String(n || "");
      return o.startsWith("mse-stream:") ? tn(o) : o.startsWith("probe-resource:") ? an(o) : !1;
    },
    getCatchToolkitState() {
      return Ge();
    },
    installedAt: Date.now(),
    openResource(n) {
      const o = String(n || "");
      return o.startsWith("mse-stream:") ? rn(o) : o.startsWith("probe-resource:") ? on(o) : !1;
    },
    readResource(n) {
      const o = String(n || "");
      return o.startsWith("mse-stream:") ? nn(o) : o.startsWith("probe-resource:") ? sn(o) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return Qr();
    },
    seen: w,
    updateCatchToolkitState(n) {
      return typeof n.autoSeekToBufferedEnd == "boolean" && (E.autoSeekToBufferedEnd = n.autoSeekToBufferedEnd), typeof n.autoDownloadOnComplete == "boolean" && (E.autoDownloadOnComplete = n.autoDownloadOnComplete), typeof n.clearCacheOnComplete == "boolean" && (E.clearCacheOnComplete = n.clearCacheOnComplete), typeof n.manualFileName == "string" && (E.manualFileName = n.manualFileName), typeof n.regexRule == "string" && (E.regexRule = Ue(n.regexRule).rule), typeof n.restartAlwaysFromBeginning == "boolean" && (E.restartAlwaysFromBeginning = n.restartAlwaysFromBeginning), typeof n.selectorRule == "string" && (E.selectorRule = Ie(n.selectorRule).rule), typeof n.trimExtraMediaHeaders == "boolean" && (E.trimExtraMediaHeaders = n.trimExtraMediaHeaders), yt(), r || Tt(), Ge();
    }
  }, "installed";
}
function ri(t) {
  const e = t.views.get(t.tabId);
  if (e && !e.webContents.isDestroyed())
    return e;
  const r = new mn({
    webPreferences: {
      devTools: !0,
      partition: je
    }
  });
  r.webContents.setZoomFactor(1);
  const i = r.webContents.getUserAgent();
  return i.includes("Electron") && r.webContents.setUserAgent(
    i.replace(/\sElectron\/[^\s]+/g, "")
  ), t.syncBounds(r), t.views.set(t.tabId, r), r.webContents.on("did-start-loading", () => {
    t.emitTabState(t.tabId, r, {
      details: "did-start-loading",
      state: "loading",
      url: r.webContents.getURL() || t.currentUrls.get(t.tabId) || void 0
    });
  }), r.webContents.on("dom-ready", () => {
    t.createIfMissingProbe(t.tabId, r);
  }), r.webContents.on("did-stop-loading", async () => {
    if (r.webContents.isDestroyed())
      return;
    const a = r.webContents.getURL() || "";
    t.currentUrls.set(t.tabId, a), await t.tryDispatchPendingOpenFile(t.tabId, r);
    const c = await ko(r, t.debugEnabled);
    t.emitTabState(t.tabId, r, {
      details: "did-stop-loading",
      ...c.length ? { meta: c } : {},
      state: "ready",
      url: a || void 0
    });
  }), r.webContents.on("did-navigate", (a, c) => {
    t.currentUrls.set(t.tabId, c), t.emitTabState(t.tabId, r, { details: "did-navigate", state: "ready", url: c }), t.tryDispatchPendingOpenFile(t.tabId, r);
  }), r.webContents.on("did-navigate-in-page", (a, c) => {
    t.currentUrls.set(t.tabId, c), t.emitTabState(t.tabId, r, { details: "did-navigate-in-page", state: "ready", url: c }), t.tryDispatchPendingOpenFile(t.tabId, r);
  }), r.webContents.on("page-title-updated", (a, c) => {
    t.emitTabState(t.tabId, r, {
      details: "page-title-updated",
      state: "ready",
      title: c || void 0,
      url: t.currentUrls.get(t.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("page-favicon-updated", (a, c) => {
    const f = c.map((p) => String(p || "").trim()).find((p) => p) || "";
    f && Ao(r, f).then((p) => {
      !p || r.webContents.isDestroyed() || (t.iconSourceUrls.set(t.tabId, f), t.iconUrls.set(t.tabId, p), t.emitTabState(t.tabId, r, {
        details: "page-favicon-updated",
        iconSourceUrl: f,
        iconUrl: p,
        state: "ready",
        url: t.currentUrls.get(t.tabId) || r.webContents.getURL() || void 0
      }));
    });
  }), r.webContents.on("did-fail-load", (a, c, f, p) => {
    c !== -3 && t.emitTabState(t.tabId, r, {
      details: `did-fail-load(${c})`,
      state: "error",
      message: `页面加载失败：${f || "未知错误"}`,
      url: p
    });
  }), r.webContents.on("render-process-gone", (a, c) => {
    t.emitTabState(t.tabId, r, {
      details: `render-process-gone:${c.reason}`,
      state: "error",
      message: `页面渲染进程异常退出：${c.reason}`,
      url: t.currentUrls.get(t.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("console-message", (a, c, f, p, w) => {
    if (typeof f == "string" && f.startsWith(Dt)) {
      const g = f.slice(Dt.length);
      try {
        t.onProbePayload(JSON.parse(g));
      } catch (b) {
        k.warn("embedded browser resource payload parse failed", {
          error: b instanceof Error ? b.message : String(b),
          tabId: t.tabId
        });
      }
      return;
    }
    t.debugEnabled && c >= 2 && t.emitTabState(t.tabId, r, {
      details: `console:${w}:${p}`,
      state: "ready",
      message: f,
      meta: [`console-level=${c}`],
      url: t.currentUrls.get(t.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.setWindowOpenHandler(({ url: a }) => (r.webContents.loadURL(a), { action: "deny" })), r;
}
function ni(t) {
  return (e) => {
    _o(t, {
      capturedAt: Number(e.capturedAt) || Date.now(),
      contentLength: typeof e.contentLength == "number" ? e.contentLength : void 0,
      ext: typeof e.ext == "string" ? e.ext : void 0,
      kind: typeof e.kind == "string" ? e.kind : void 0,
      mimeType: typeof e.mimeType == "string" ? e.mimeType : void 0,
      pageUrl: typeof e.pageUrl == "string" ? e.pageUrl : void 0,
      resourceKey: typeof e.resourceKey == "string" ? e.resourceKey : void 0,
      resourceType: typeof e.resourceType == "string" ? e.resourceType : void 0,
      source: "probe",
      streamType: e.streamType === "audio" || e.streamType === "video" ? e.streamType : void 0,
      url: typeof e.url == "string" ? e.url : ""
    });
  };
}
async function oi(t, e, r) {
  if (!r(t) || e.webContents.isDestroyed())
    return !1;
  try {
    return await e.webContents.executeJavaScript(ti(), !0), !0;
  } catch (i) {
    return k.warn("embedded browser resource probe install failed", {
      error: i instanceof Error ? i.message : String(i),
      tabId: t,
      url: e.webContents.getURL() || ""
    }), !1;
  }
}
const ii = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((t) => !!t);
function It(t) {
  return String(t || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function ai(t) {
  if (!t || t === "ffmpeg")
    return !1;
  try {
    return await Tn(t, yn.X_OK), !0;
  } catch {
    return !1;
  }
}
async function si(t) {
  return new Promise((e) => {
    const r = Rr(t, ["-version"], {
      stdio: "ignore"
    });
    r.once("error", () => e(!1)), r.once("exit", (i) => e(i === 0));
  });
}
async function ci(t) {
  const e = [
    String(t || "").trim() || void 0,
    ...ii
  ].filter((r, i, a) => !!r && a.indexOf(r) === i);
  for (const r of e) {
    if (r === "ffmpeg") {
      if (await si(r))
        return r;
      continue;
    }
    if (await ai(r))
      return r;
  }
  return null;
}
function di(t) {
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
function ui(t, e) {
  const r = It(T.parse(t).name), i = It(T.parse(e).name);
  return `${r.replace(/-video$/i, "").replace(/_video$/i, "") || i.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function li() {
  return wn(T.join(Cn.tmpdir(), "omniflow-resource-merge-"));
}
async function fi(t) {
  t && await vn(t, {
    force: !0,
    recursive: !0
  });
}
async function wr(t, e) {
  const r = T.join(t, It(e.fileName));
  return await Sn(r, Cr.from(e.base64, "base64")), r;
}
async function mi(t) {
  const e = await ci(t.ffmpegPath);
  if (!e)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const r = await li();
  try {
    const [i, a] = await Promise.all([
      wr(r, t.audio),
      wr(r, t.video)
    ]), c = di({
      audioPath: i,
      outputPath: t.outputPath,
      videoPath: a
    });
    return await new Promise((p, w) => {
      const g = [], b = [], C = Rr(e, c, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      C.stdout.on("data", (h) => {
        g.push(String(h));
      }), C.stderr.on("data", (h) => {
        b.push(String(h));
      }), C.once("error", (h) => {
        w(h);
      }), C.once("exit", (h) => {
        if (h === 0) {
          p({
            commandArgs: c,
            ffmpegPath: e,
            outputPath: t.outputPath,
            stderr: b.join(""),
            stdout: g.join("")
          });
          return;
        }
        w(new Error(b.join("").trim() || `ffmpeg 退出码异常: ${h}`));
      });
    });
  } finally {
    await fi(r).catch(() => {
    });
  }
}
function pi(t) {
  const e = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new Map();
  let g = null, b = null, C = !1;
  function h(d) {
    k.log("[embedded-browser:main]", d);
    const u = t.getMainWindow();
    !u || u.isDestroyed() || u.webContents.send("embedded-browser:state", d);
  }
  function R(d) {
    const u = t.getMainWindow();
    !u || u.isDestroyed() || u.webContents.send("embedded-browser:download", d);
  }
  function D(d) {
    const u = t.getMainWindow();
    !u || u.isDestroyed() || u.webContents.send("embedded-browser:resource", d);
  }
  function U(d) {
    for (const [u, m] of e.entries())
      if (m.webContents === d)
        return u;
    return null;
  }
  function Q(d) {
    for (const [u, m] of e.entries())
      if (m.webContents.id === d)
        return u;
    return null;
  }
  function ee() {
    C || (C = !0, Po({
      decisionCache: w,
      options: t
    }));
  }
  function J() {
    Fo({
      emitDownload: R,
      emitResource: D,
      resolveTabIdByWebContents: U,
      resolveTabIdByWebContentsId: Q
    });
  }
  function be(d) {
    const u = d.webContents.getTitle().trim();
    if (u)
      return u;
  }
  function H(d, u, m) {
    h({
      canGoBack: u.webContents.canGoBack(),
      canGoForward: u.webContents.canGoForward(),
      iconSourceUrl: m.iconSourceUrl ?? a.get(d),
      iconUrl: m.iconUrl ?? i.get(d),
      tabId: d,
      title: m.title ?? be(u),
      ...m
    });
  }
  function Ee(d, u, m) {
    H(d, u, {
      state: "ready",
      url: (m == null ? void 0 : m.url) ?? (r.get(d) || u.webContents.getURL() || void 0),
      ...m
    });
  }
  function P(d) {
    const u = e.get(d);
    return !u || u.webContents.isDestroyed() ? (e.delete(d), r.delete(d), i.delete(d), a.delete(d), mr(d), null) : u;
  }
  async function te(d, u) {
    return oi(
      d,
      u,
      xo
    );
  }
  async function N(d, u) {
    const m = String(d || "").trim();
    if (!m)
      return null;
    const S = P(m);
    return !S || S.webContents.isDestroyed() ? null : u((_) => S.webContents.executeJavaScript(_, !0), S);
  }
  async function le(d, u) {
    const m = String(d || "").trim(), S = String(u.audioResourceKey || "").trim(), B = String(u.videoResourceKey || "").trim();
    if (!m || !S || !B)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const _ = await N(
        m,
        async (Re) => Promise.all([
          br(Re, S),
          br(Re, B)
        ])
      ), [I, V] = _ || [];
      if (!I || !V)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const se = String(u.suggestedFileName || "").trim() || ui(V.fileName, I.fileName), K = t.getMainWindow(), ne = K && !K.isDestroyed() ? K : void 0, Te = {
        defaultPath: T.join(L.getPath("downloads"), se),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, me = ne ? await ie.showSaveDialog(ne, Te) : await ie.showSaveDialog(Te);
      if (me.canceled || !me.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const Je = await mi({
        audio: I,
        ffmpegPath: u.ffmpegPath,
        outputPath: me.filePath,
        video: V
      });
      return {
        ffmpegPath: Je.ffmpegPath,
        ok: !0,
        outputPath: Je.outputPath
      };
    } catch (_) {
      return k.warn("embedded browser resource merge failed", {
        audioResourceKey: S,
        error: _ instanceof Error ? _.message : String(_),
        tabId: m,
        videoResourceKey: B
      }), {
        error: _ instanceof Error ? _.message : String(_),
        ok: !1
      };
    }
  }
  function fe(d) {
    d.setBounds(b ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function re(d) {
    if (!g)
      return;
    const u = P(g);
    if (!u) {
      g = null;
      return;
    }
    d.contentView.children.includes(u) && d.contentView.removeChildView(u), g = null;
  }
  function F(d) {
    const u = t.getMainWindow();
    return !u || u.isDestroyed() ? null : ri({
      createIfMissingProbe: te,
      currentUrls: r,
      debugEnabled: t.debugEnabled,
      emitTabState: H,
      iconSourceUrls: a,
      iconUrls: i,
      onProbePayload: ni(d),
      syncBounds: fe,
      tabId: d,
      tryDispatchPendingOpenFile: async (m, S) => yr({
        attachedOpenFiles: f,
        currentUrls: r,
        pendingOpenFiles: c,
        tabId: m,
        view: S
      }),
      views: e
    });
  }
  function M(d, u, m = {}) {
    if (!d || d.isDestroyed())
      return null;
    if (!u)
      return re(d), null;
    const B = m.createIfMissing ?? !1 ? F(u) : P(u);
    return B ? (g && g !== u && re(d), fe(B), d.contentView.children.includes(B) || d.contentView.addChildView(B), g = u, B) : (re(d), null);
  }
  async function j(d, u, m, S, B = !1) {
    if (!d || d.isDestroyed())
      return;
    const _ = String(u || "").trim();
    if (!_)
      return;
    const I = M(d, _, { createIfMissing: !0 });
    if (!I || I.webContents.isDestroyed())
      return;
    const V = String(m || "").trim();
    if (!V) {
      H(_, I, {
        state: "ready",
        title: be(I) || "新标签页",
        url: r.get(_) || void 0
      });
      return;
    }
    const se = r.get(_) || I.webContents.getURL();
    if (B && se === V) {
      H(_, I, {
        state: "ready",
        url: se || void 0
      });
      return;
    }
    H(_, I, {
      details: "load-url",
      state: "loading",
      url: V
    });
    try {
      await I.webContents.loadURL(V);
    } catch (K) {
      const ne = K instanceof Error ? K.message : String(K);
      if (ne.includes("ERR_ABORTED"))
        return;
      throw H(_, I, {
        details: S,
        state: "error",
        message: `页面加载失败：${ne}`,
        url: V
      }), K;
    }
  }
  function E(d, u) {
    if (!d || d.isDestroyed())
      return;
    const m = String(u || "").trim();
    if (!m)
      return;
    const S = P(m);
    S && (d.contentView.children.includes(S) && d.contentView.removeChildView(S), g === m && (g = null), e.delete(m), r.delete(m), i.delete(m), a.delete(m), mr(m), ot({
      requestVersions: p,
      tabId: m
    }), nt({
      attachedOpenFiles: f,
      pendingOpenFiles: c,
      tabId: m
    }), S.webContents.isDestroyed() || S.webContents.close({ waitForBeforeUnload: !1 }));
  }
  async function qe(d, u, m) {
    const S = z.fromWebContents(d) ?? t.getMainWindow(), B = String(u || "").trim();
    ot({
      requestVersions: p,
      tabId: B
    }), nt({
      attachedOpenFiles: f,
      pendingOpenFiles: c,
      tabId: B
    });
    const _ = String(m || "").trim();
    if (!_) {
      h({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: B,
        title: "新标签页"
      });
      return;
    }
    await j(S, B, _, "open-exception", !0);
  }
  function xe(d, u) {
    const m = z.fromWebContents(d) ?? t.getMainWindow();
    M(m, u, { createIfMissing: !1 });
  }
  async function _e(d, u, m) {
    const S = z.fromWebContents(d) ?? t.getMainWindow(), B = String(u || "").trim();
    ot({
      requestVersions: p,
      tabId: B
    }), nt({
      attachedOpenFiles: f,
      pendingOpenFiles: c,
      tabId: B
    }), await j(S, B, m, "navigate-exception");
  }
  async function Me(d, u, m, S, B) {
    const _ = z.fromWebContents(d) ?? t.getMainWindow(), I = String(u || "").trim(), V = String(m || "").trim(), se = String(S || "").trim(), K = String(B || "").trim() || "file";
    if (!I || !V || !se)
      return;
    const ne = ot({
      requestVersions: p,
      tabId: I
    });
    nt({
      attachedOpenFiles: f,
      pendingOpenFiles: c,
      tabId: I
    });
    const Te = await Go(se, K);
    if (!gr({
      requestVersions: p,
      tabId: I,
      version: ne
    })) {
      ut(Te).catch(() => {
      });
      return;
    }
    if (c.set(I, {
      fileName: K,
      pageUrl: V,
      stagedPath: Te
    }), await j(_, I, V, "navigate-exception"), !gr({
      requestVersions: p,
      tabId: I,
      version: ne
    }))
      return;
    const me = P(I);
    me && yr({
      attachedOpenFiles: f,
      currentUrls: r,
      pendingOpenFiles: c,
      tabId: I,
      view: me
    });
  }
  async function we(d) {
    const u = String(d || "").trim();
    if (!u)
      return;
    const m = P(u);
    !m || m.webContents.isDestroyed() || (H(u, m, {
      details: "reload",
      state: "loading",
      url: r.get(u) || m.webContents.getURL() || void 0
    }), m.webContents.reload(), Ee(u, m, {
      details: "reload-requested"
    }));
  }
  async function De(d) {
    const u = String(d || "").trim();
    if (!u)
      return;
    const m = P(u);
    !m || m.webContents.isDestroyed() || (m.webContents.canGoBack() && m.webContents.goBack(), Ee(u, m, {
      details: "history-back"
    }));
  }
  async function Se(d) {
    const u = String(d || "").trim();
    if (!u)
      return;
    const m = P(u);
    !m || m.webContents.isDestroyed() || (m.webContents.canGoForward() && m.webContents.goForward(), Ee(u, m, {
      details: "history-forward"
    }));
  }
  async function Ie(d, u) {
    return N(d, async (m, S) => {
      try {
        return await hr(m, "openResource", u);
      } catch (B) {
        return k.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: B instanceof Error ? B.message : String(B),
          resourceKey: String(u || "").trim(),
          tabId: String(d || "").trim(),
          url: S.webContents.getURL() || r.get(String(d || "").trim()) || ""
        }), !1;
      }
    }).then((m) => !!m);
  }
  async function Ue(d, u) {
    return N(d, async (m, S) => {
      try {
        return await hr(m, "exportResource", u);
      } catch (B) {
        return k.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: B instanceof Error ? B.message : String(B),
          resourceKey: String(u || "").trim(),
          tabId: String(d || "").trim(),
          url: S.webContents.getURL() || r.get(String(d || "").trim()) || ""
        }), !1;
      }
    }).then((m) => !!m);
  }
  async function gt(d, u) {
    return N(d, async (m) => {
      try {
        return await ei(m, u);
      } catch (S) {
        return k.warn("embedded browser network resource preview failed", {
          error: S instanceof Error ? S.message : String(S),
          tabId: String(d || "").trim(),
          url: String(u.url || "").trim()
        }), !1;
      }
    }).then((m) => !!m);
  }
  async function yt(d) {
    return N(d, async (u, m) => {
      try {
        return await to(u);
      } catch (S) {
        return k.warn("embedded browser catch toolkit get state failed", {
          error: S instanceof Error ? S.message : String(S),
          tabId: String(d || "").trim(),
          url: m.webContents.getURL() || r.get(String(d || "").trim()) || ""
        }), null;
      }
    });
  }
  async function Pe(d, u) {
    return N(d, async (m, S) => {
      try {
        return await ro(m, u);
      } catch (B) {
        return k.warn("embedded browser catch toolkit update state failed", {
          error: B instanceof Error ? B.message : String(B),
          payload: u,
          tabId: String(d || "").trim(),
          url: S.webContents.getURL() || r.get(String(d || "").trim()) || ""
        }), null;
      }
    });
  }
  async function ve(d, u, m) {
    return N(d, async (S, B) => {
      try {
        return await no(S, u);
      } catch (_) {
        return k.warn(`embedded browser catch toolkit ${m} failed`, {
          error: _ instanceof Error ? _.message : String(_),
          tabId: String(d || "").trim(),
          url: B.webContents.getURL() || r.get(String(d || "").trim()) || ""
        }), !1;
      }
    }).then((S) => !!S);
  }
  async function Ce(d) {
    const u = String(d || "").trim(), m = Ro(u), S = P(u);
    return S && !S.webContents.isDestroyed() && (S.webContents.getURL() ? S.webContents.reload() : await te(u, S)), m;
  }
  function ht(d, u) {
    const m = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, S = z.fromWebContents(d) ?? t.getMainWindow(), B = S && !S.isDestroyed() ? Math.max(S.webContents.getZoomFactor(), 0.01) : 1;
    if (m.x = Math.max(0, Math.round(u.x * B)), m.y = Math.max(0, Math.round(u.y * B)), m.width = Math.max(0, Math.round(u.width * B)), m.height = Math.max(0, Math.round(u.height * B)), b = m, !g)
      return;
    const _ = P(g);
    _ && _.setBounds(m);
  }
  function Ke(d, u) {
    const m = z.fromWebContents(d) ?? t.getMainWindow();
    E(m, u);
  }
  async function Fe(d) {
    try {
      return await Ur(d);
    } catch {
      return !1;
    }
  }
  function ke(d) {
    const u = z.fromWebContents(d) ?? t.getMainWindow();
    !u || u.isDestroyed() || re(u);
  }
  function Ge(d) {
    const u = z.fromWebContents(d) ?? t.getMainWindow();
    !u || u.isDestroyed() || (Array.from(e.keys()).forEach((m) => {
      E(u, m);
    }), g = null, h({ state: "idle" }));
  }
  function bt() {
    oo({
      activateTab: xe,
      cleanupDownloadFile: Fe,
      clearCapturedResources: (d) => Oo(String(d || "").trim()),
      clearCatchMediaCache: (d) => ve(d, "clearCatchMediaCache", "clear cache"),
      closeAll: Ge,
      closeTab: Ke,
      deactivate: ke,
      downloadCatchMedia: (d) => ve(d, "downloadCatchMedia", "download"),
      exportResource: Ue,
      getCatchToolkitState: yt,
      goBack: De,
      goForward: Se,
      listCapturedResources: (d) => Eo(String(d || "").trim()),
      mergeMseResources: le,
      navigate: _e,
      openMappedFile: Me,
      openResource: Ie,
      openTab: qe,
      previewResource: gt,
      reload: we,
      resolveFavicon: No,
      restartCatchMediaCapture: (d) => ve(d, "restartCatchMediaCapture", "restart"),
      setBounds: ht,
      startCapturedResources: (d) => Co(String(d || "").trim()),
      startDeepResourceCapture: Ce,
      stopCapturedResources: (d) => Bo(String(d || "").trim()),
      updateCatchToolkitState: Pe
    });
  }
  return {
    configureSession: ee,
    initializeBridges: J,
    registerIpcHandlers: bt
  };
}
const gi = 240;
function yi(t) {
  x.on("window-minimize", (e) => {
    const r = z.fromWebContents(e.sender) ?? t.getMainWindow();
    r == null || r.minimize();
  }), x.on("window-maximize", (e) => {
    const r = z.fromWebContents(e.sender) ?? t.getMainWindow();
    !r || r.isDestroyed() || (r.isMaximized() ? r.unmaximize() : r.maximize());
  }), x.on("window-close", (e) => {
    const r = z.fromWebContents(e.sender) ?? t.getMainWindow();
    r == null || r.close();
  }), x.handle("window-activate", (e, r = !1) => {
    const i = z.fromWebContents(e.sender) ?? t.getMainWindow();
    return !i || i.isDestroyed() ? !1 : (i.isMinimized() && i.restore(), i.isVisible() || i.show(), process.platform === "darwin" ? L.focus({ steal: !0 }) : L.focus(), typeof i.moveTop == "function" && i.moveTop(), i.focus(), r && !i.isAlwaysOnTop() && (i.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      i.isDestroyed() || i.setAlwaysOnTop(!1);
    }, gi)), !0);
  });
}
const hi = T.dirname(gn(import.meta.url));
process.env.APP_ROOT = T.join(hi, "..");
const lt = process.env.VITE_DEV_SERVER_URL, bi = T.join(process.env.APP_ROOT, "dist-electron"), jr = T.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = lt ? T.join(process.env.APP_ROOT, "public") : jr;
const Sr = T.join(process.env.APP_ROOT, "build", "icons", "icon.png"), wi = "Omniflow", Si = "omniflow-app", vi = 1400, Ti = 920, At = 600, Wt = 400, Ei = "window-state.json", Ci = 200, Ri = process.env.NODE_ENV === "test" || !!(lt || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Bi = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
Bi || (L.commandLine.appendSwitch("disable-logging"), L.commandLine.appendSwitch("log-level", "3"));
L.setName(wi);
try {
  const t = T.join(L.getPath("appData"), Si);
  L.setPath("userData", t);
} catch {
}
function Vr() {
  return ft(Sr) ? Sr : null;
}
let A = null, qr = !1, it = null;
function Kr() {
  return T.join(L.getPath("userData"), Ei);
}
function he(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function Oi(t, e) {
  return t >= At && e >= Wt;
}
function xi(t) {
  return pn.getAllDisplays().some((r) => {
    const i = r.workArea;
    return t.x < i.x + i.width && t.x + t.width > i.x && t.y < i.y + i.height && t.y + t.height > i.y;
  });
}
function _i() {
  try {
    const t = Kr();
    if (!ft(t))
      return null;
    const e = hn(t, "utf-8"), r = JSON.parse(e);
    if (!he(r.width) || !he(r.height) || !Oi(r.width, r.height))
      return null;
    const i = !!r.maximized, a = {
      width: r.width,
      height: r.height,
      maximized: i
    };
    return he(r.x) && he(r.y) && (a.x = r.x, a.y = r.y), he(a.x) && he(a.y) && (xi({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height
    }) || (delete a.x, delete a.y)), a;
  } catch {
    return null;
  }
}
function Nt(t) {
  if (!t.isDestroyed())
    try {
      const e = t.isMaximized() ? t.getNormalBounds() : t.getBounds(), r = {
        x: e.x,
        y: e.y,
        width: Math.max(Math.round(e.width), At),
        height: Math.max(Math.round(e.height), Wt),
        maximized: t.isMaximized()
      }, i = Kr();
      Ut(T.dirname(i), { recursive: !0 }), bn(i, JSON.stringify(r), "utf-8");
    } catch {
    }
}
function at(t) {
  it && clearTimeout(it), it = setTimeout(() => {
    it = null, Nt(t);
  }, Ci);
}
function Mi(t) {
  if (t.type !== "keyDown")
    return !1;
  const e = (t.key || "").toLowerCase();
  return (t.meta || t.control) && t.shift && e === "i";
}
function Di(t) {
  if (t.type !== "keyDown" || !(t.meta || t.control))
    return !1;
  const e = (t.key || "").toLowerCase();
  return e === "+" || e === "=" || e === "-" || e === "_" || e === "0";
}
const xt = pi({
  debugEnabled: Ri,
  getMainWindow: () => A
});
function Gr() {
  if (A && !A.isDestroyed())
    return A.show(), A.focus(), A;
  const t = Vr(), e = _i(), r = (e == null ? void 0 : e.width) ?? vi, i = (e == null ? void 0 : e.height) ?? Ti, a = new z({
    width: r,
    height: i,
    minWidth: At,
    minHeight: Wt,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...he(e == null ? void 0 : e.x) && he(e == null ? void 0 : e.y) ? { x: e.x, y: e.y } : {},
    webPreferences: {
      preload: T.join(bi, "preload.mjs"),
      devTools: !0
    },
    autoHideMenuBar: !0,
    ...t ? { icon: t } : {}
  });
  return A = a, e != null && e.maximized && a.maximize(), a.on("move", () => {
    at(a);
  }), a.on("resize", () => {
    at(a);
  }), a.on("maximize", () => {
    at(a);
  }), a.on("unmaximize", () => {
    at(a);
  }), a.on("close", (c) => {
    Nt(a), process.platform === "darwin" && !qr && (c.preventDefault(), a.hide());
  }), a.on("closed", () => {
    A === a && (A = null);
  }), a.webContents.setZoomFactor(1), a.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), a.webContents.on("before-input-event", (c, f) => {
    if (Di(f)) {
      c.preventDefault();
      return;
    }
    Mi(f) && (c.preventDefault(), a.webContents.toggleDevTools());
  }), a.on("app-command", (c, f) => {
    (f === "browser-backward" || f === "browser-forward") && c.preventDefault();
  }), a.on("swipe", (c, f) => {
    (f === "left" || f === "right") && c.preventDefault();
  }), lt ? a.loadURL(lt) : a.loadFile(T.join(jr, "index.html")), a;
}
L.on("before-quit", () => {
  qr = !0, A && !A.isDestroyed() && Nt(A);
});
L.on("window-all-closed", () => {
  process.platform !== "darwin" && L.quit();
});
L.on("activate", () => {
  if (A && !A.isDestroyed()) {
    A.isMinimized() && A.restore(), A.show(), A.focus();
    return;
  }
  z.getAllWindows().length === 0 && Gr();
});
L.whenReady().then(() => {
  const t = Vr();
  t && process.platform === "darwin" && L.dock.setIcon(t), xt.configureSession(), xt.initializeBridges(), Zn(), yi({
    getMainWindow: () => A
  }), xt.registerIpcHandlers(), Gr();
});
export {
  bi as MAIN_DIST,
  jr as RENDERER_DIST,
  lt as VITE_DEV_SERVER_URL
};
