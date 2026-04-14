import { dialog as ue, app as $, net as on, ipcMain as D, session as He, webContents as sn, BrowserWindow as j, WebContentsView as an, screen as cn } from "electron";
import { fileURLToPath as ln } from "node:url";
import R from "node:path";
import Bt, { existsSync as dt, mkdirSync as Ot, constants as un, readFileSync as dn, writeFileSync as fn } from "node:fs";
import z from "fs/promises";
import ct, { mkdtemp as mn, writeFile as pn, rm as gn, access as yn } from "node:fs/promises";
import yr from "node:http";
import hr from "node:https";
import wr from "os";
import Dt from "child_process";
import hn from "fs";
import { Buffer as br } from "node:buffer";
import { spawn as Sr } from "node:child_process";
import wn from "node:os";
const rt = 6e4;
async function Ut(t, e, o = {}, a = 0) {
  const f = new URL(t);
  if (f.protocol !== "http:" && f.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${f.protocol}`);
  const g = f.protocol === "https:" ? hr : yr;
  await ct.mkdir(R.dirname(e), { recursive: !0 }), await new Promise((v, B) => {
    let S = !1;
    const C = () => {
      S || (S = !0, v());
    }, x = (_) => {
      S || (S = !0, B(_));
    }, E = g.request({
      protocol: f.protocol,
      hostname: f.hostname,
      port: f.port ? Number(f.port) : void 0,
      path: `${f.pathname}${f.search}`,
      method: "GET",
      headers: o
    }, (_) => {
      _.setTimeout(rt, () => {
        _.destroy(new Error(`下载响应超时: ${rt}ms`));
      });
      const P = Number(_.statusCode || 0), W = _.headers.location;
      if (P >= 300 && P < 400 && W) {
        if (_.resume(), a >= 3) {
          x(new Error(`下载重定向次数过多: ${t}`));
          return;
        }
        const Z = new URL(W, t).toString();
        Ut(Z, e, o, a + 1).then(C).catch(x);
        return;
      }
      if (P >= 400) {
        _.resume(), x(new Error(`下载失败: HTTP ${P} (${t})`));
        return;
      }
      const oe = Bt.createWriteStream(e), X = async (Z) => {
        try {
          oe.destroy();
        } catch {
        }
        try {
          await ct.rm(e, { force: !0 });
        } catch {
        }
        x(Z);
      };
      _.on("error", (Z) => {
        X(Z);
      }), oe.on("error", (Z) => {
        X(Z);
      }), oe.on("finish", () => C()), _.pipe(oe);
    });
    E.setTimeout(rt, () => {
      E.destroy(new Error(`下载请求超时: ${rt}ms`));
    }), E.on("error", (_) => x(_)), E.end();
  });
}
const bn = "Omniflow Inbox", Sn = 10 * 60 * 1e3, En = 2, vn = 2e3, xt = 12, Tn = R.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), je = /* @__PURE__ */ new Map();
function Pt(t) {
  const e = String(t || "");
  return !!(!e || e === ".DS_Store" || e.startsWith("._") || e === "Thumbs.db");
}
function Ve(t) {
  return t.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Rn(t) {
  const e = String(t || "").toLowerCase();
  return !e || e.startsWith(".") ? !0 : e.endsWith(".crdownload") || e.endsWith(".part") || e.endsWith(".tmp") || e.endsWith(".opdownload") || e.endsWith(".download");
}
function Er() {
  return R.join($.getPath("userData"), "auto-import-staging");
}
function Cn() {
  return R.join($.getPath("userData"), "embedded-browser-downloads");
}
function vr(t, e) {
  const o = R.resolve(t), a = R.resolve(e);
  return o === a ? !0 : o.startsWith(`${a}${R.sep}`);
}
function Bn(t) {
  const e = String(t || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
async function xn(t, e) {
  try {
    await z.rename(t, e);
  } catch (o) {
    if ((o == null ? void 0 : o.code) !== "EXDEV")
      throw o;
    await z.copyFile(t, e), await z.rm(t, { force: !0 });
  }
}
function _n(t) {
  const e = Date.now();
  for (const [o, a] of je.entries())
    t.has(o) || e - a.lastSeenAt <= Sn || je.delete(o);
}
async function Mn(t, e = xt) {
  const o = String(t || "").trim(), a = o ? R.resolve(o) : R.join($.getPath("downloads"), bn), d = await z.stat(a).catch(() => null);
  if (!(d != null && d.isDirectory()))
    return [];
  const f = await z.readdir(a, { withFileTypes: !0 }), g = /* @__PURE__ */ new Set(), v = Date.now(), B = [];
  for (const E of f) {
    if (!E.isFile() || Pt(E.name) || Rn(E.name)) continue;
    const _ = R.join(a, E.name), P = await z.stat(_).catch(() => null);
    if (!(P != null && P.isFile())) continue;
    g.add(_);
    const W = je.get(_), X = (W ? W.size === P.size && W.mtimeMs === P.mtimeMs : !1) && W ? W.stableCount + 1 : 1;
    je.set(_, {
      size: P.size,
      mtimeMs: P.mtimeMs,
      stableCount: X,
      lastSeenAt: v
    }), !(X < En) && (v - P.mtimeMs < vn || B.push({
      sourcePath: _,
      name: E.name,
      size: P.size,
      mtimeMs: P.mtimeMs
    }));
  }
  if (_n(g), B.length === 0)
    return [];
  B.sort((E, _) => E.mtimeMs - _.mtimeMs);
  const S = Er();
  await z.mkdir(S, { recursive: !0 });
  const C = [], x = Math.max(1, Math.floor(Number(e) || xt));
  for (const E of B.slice(0, x)) {
    const _ = R.join(S, Bn(E.name));
    try {
      await xn(E.sourcePath, _);
    } catch {
      continue;
    }
    je.delete(E.sourcePath), C.push({
      name: E.name,
      size: E.size,
      localPath: _,
      relativePath: Ve(E.name)
    });
  }
  return C;
}
async function On(t) {
  const e = R.resolve(String(t || "").trim()), o = Er();
  return !e || !vr(e, o) ? !1 : (await z.rm(e, { force: !0 }), !0);
}
function sr(t, e) {
  const o = Ve(e || "");
  if (!o)
    return t;
  const a = o.split("/").filter(Boolean);
  for (const d of a) {
    if (d === "." || d === "..")
      throw new Error(`非法下载路径片段: ${d}`);
    if (d.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return R.join(t, ...a);
}
function Tr(t, e) {
  return t.relativePath.localeCompare(e.relativePath, "zh-Hans-CN");
}
async function Dn(t) {
  return (await Promise.all(t.map(async (o) => {
    const a = await z.stat(o);
    if (!a.isFile())
      return null;
    const d = R.basename(o);
    return Pt(d) ? null : {
      name: d,
      size: a.size,
      localPath: o,
      relativePath: Ve(d)
    };
  }))).filter((o) => !!o).sort(Tr);
}
async function Un(t, e, o) {
  const a = [e], d = [];
  for (; a.length > 0; ) {
    const C = a.pop(), x = await z.readdir(C, { withFileTypes: !0 });
    for (const E of x) {
      if (E.name === "." || E.name === ".." || Pt(E.name) || E.isSymbolicLink())
        continue;
      const _ = R.join(C, E.name);
      if (E.isDirectory()) {
        a.push(_);
        continue;
      }
      E.isFile() && d.push({
        absolutePath: _,
        name: E.name
      });
    }
  }
  const f = [], g = 48;
  let v = 0;
  const B = async () => {
    for (; v < d.length; ) {
      const C = v;
      if (v += 1, C >= d.length)
        return;
      const x = d[C], E = await z.stat(x.absolutePath).catch(() => null);
      if (!(E != null && E.isFile()))
        continue;
      const _ = Ve(R.relative(t, x.absolutePath)), P = Ve(R.join(o, _));
      f.push({
        name: x.name,
        size: E.size,
        localPath: x.absolutePath,
        relativePath: P
      });
    }
  }, S = Math.min(g, Math.max(1, d.length));
  return await Promise.all(Array.from({ length: S }, () => B())), f;
}
async function Pn(t) {
  const e = [];
  for (const o of t) {
    if (!(await z.stat(o)).isDirectory())
      continue;
    const d = R.basename(o), f = await Un(o, o, d);
    e.push(...f);
  }
  return e.sort(Tr);
}
function kn(t) {
  t.handle("file:open", async () => {
    const e = await ue.showOpenDialog({
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
      content: await z.readFile(o, "utf-8"),
      filePath: o
    };
  }), t.handle("file:save", async (e, o, a) => (await z.writeFile(o, a, "utf-8"), !0)), t.handle("file:read-text", async (e, o) => {
    const a = R.resolve(String(o || "").trim());
    return {
      canceled: !1,
      content: await z.readFile(a, "utf-8"),
      filePath: a
    };
  }), t.handle("file:read-local-chrome-bookmarks", async () => {
    const e = R.join($.getPath("home"), Tn);
    return {
      canceled: !1,
      content: await z.readFile(e, "utf-8"),
      filePath: e
    };
  }), t.handle("dialog:pick-upload-files", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Dn(e.filePaths) };
  }), t.handle("dialog:pick-upload-folders", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Pn(e.filePaths) };
  }), t.handle("dialog:pick-download-directory", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("dialog:save-download-file", async (e, o) => {
    const a = await ue.showSaveDialog({
      defaultPath: String(o || "download"),
      showsTagField: !1
    });
    return a.canceled || !a.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: a.filePath };
  }), t.handle("dialog:pick-auto-import-directory", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("fs:claim-auto-import-files", async (e, o, a = xt) => ({ canceled: !1, files: await Mn(o, a) })), t.handle("fs:cleanup-auto-import-staged-file", async (e, o) => {
    try {
      return await On(o);
    } catch {
      return !1;
    }
  }), t.handle("fs:ensure-directory", async (e, o, a = "") => {
    const d = sr(o, a);
    return await z.mkdir(d, { recursive: !0 }), d;
  }), t.handle("fs:download-url-to-path", async (e, o, a, d, f = {}) => {
    const g = sr(a, d);
    return await Ut(o, g, f), g;
  }), t.handle("fs:save-staged-download-file", async (e, o, a) => {
    const d = R.resolve(String(o || "").trim()), f = R.resolve(String(a || "").trim()), g = Cn();
    if (!d || !vr(d, g))
      throw new Error("无效的下载临时文件");
    if (!f)
      throw new Error("无效的保存路径");
    return await z.mkdir(R.dirname(f), { recursive: !0 }), await z.copyFile(d, f), f;
  });
}
var J = {}, ye = wr;
J.platform = function() {
  return process.platform;
};
J.cpuCount = function() {
  return ye.cpus().length;
};
J.sysUptime = function() {
  return ye.uptime();
};
J.processUptime = function() {
  return process.uptime();
};
J.freemem = function() {
  return ye.freemem() / (1024 * 1024);
};
J.totalmem = function() {
  return ye.totalmem() / (1024 * 1024);
};
J.freememPercentage = function() {
  return ye.freemem() / ye.totalmem();
};
J.freeCommand = function(t) {
  Dt.exec("free -m", function(e, o, a) {
    var d = o.split(`
`), f = d[1].replace(/[\s\n\r]+/g, " "), g = f.split(" ");
    total_mem = parseFloat(g[1]), free_mem = parseFloat(g[3]), buffers_mem = parseFloat(g[5]), cached_mem = parseFloat(g[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), t(used_mem - 2);
  });
};
J.harddrive = function(t) {
  Dt.exec("df -k", function(e, o, a) {
    var d = 0, f = 0, g = 0, v = o.split(`
`), B = v[1].replace(/[\s\n\r]+/g, " "), S = B.split(" ");
    d = Math.ceil(S[1] * 1024 / Math.pow(1024, 2)), f = Math.ceil(S[2] * 1024 / Math.pow(1024, 2)), g = Math.ceil(S[3] * 1024 / Math.pow(1024, 2)), t(d, g, f);
  });
};
J.getProcesses = function(t, e) {
  typeof t == "function" && (e = t, t = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", t > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (t + 1)), Dt.exec(command, function(o, a, d) {
    var f = a.split(`
`);
    f.shift(), f.pop();
    var g = "";
    f.forEach(function(v, B) {
      var S = v.replace(/[\s\n\r]+/g, " ");
      S = S.split(" "), g += S[1] + " " + S[2] + " " + S[3] + " " + S[4].substring(S[4].length - 25) + `
`;
    }), e(g);
  });
};
J.allLoadavg = function() {
  var t = ye.loadavg();
  return t[0].toFixed(4) + "," + t[1].toFixed(4) + "," + t[2].toFixed(4);
};
J.loadavg = function(t) {
  (t === void 0 || t !== 5 && t !== 15) && (t = 1);
  var e = ye.loadavg(), o = 0;
  return t == 1 && (o = e[0]), t == 5 && (o = e[1]), t == 15 && (o = e[2]), o;
};
J.cpuFree = function(t) {
  Rr(t, !0);
};
J.cpuUsage = function(t) {
  Rr(t, !1);
};
function Rr(t, e) {
  var o = ar(), a = o.idle, d = o.total;
  setTimeout(function() {
    var f = ar(), g = f.idle, v = f.total, B = g - a, S = v - d, C = B / S;
    t(e === !0 ? C : 1 - C);
  }, 1e3);
}
function ar(t) {
  var e = ye.cpus(), o = 0, a = 0, d = 0, f = 0, g = 0, B = 0;
  for (var v in e)
    o += e[v].times.user, a += e[v].times.nice, d += e[v].times.sys, g += e[v].times.irq, f += e[v].times.idle;
  var B = o + a + d + f + g;
  return {
    idle: f,
    total: B
  };
}
const Ln = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Ie = (t, ...e) => {
  Ln && console[t](...e);
}, F = {
  debug: (...t) => Ie("debug", ...t),
  info: (...t) => Ie("info", ...t),
  log: (...t) => Ie("log", ...t),
  warn: (...t) => Ie("warn", ...t),
  error: (...t) => Ie("error", ...t)
};
function An() {
  const t = Fn().total, e = wr.cpus()[0].model, o = Math.floor(J.totalmem() / 1024);
  return {
    totalStorage: t,
    cpuModel: e,
    totalMemoryGB: o
  };
}
function Fn() {
  const t = hn.statfsSync(process.platform === "win32" ? "C:" : "/"), e = t.blocks * t.bsize, o = t.bfree * t.bsize;
  return {
    total: Math.floor(e / 1e9),
    // 换算为 GB
    usage: 1 - o / e
    // 使用率计算
  };
}
function Wn(t) {
  t.handle("sys:get-static-data", An);
}
const Nn = 10 * 1024 * 1024 * 1024, $n = "10GB", In = `上传失败：单文件最大支持 ${$n}`;
function Cr(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function zn(t) {
  return encodeURIComponent(t).replace(
    /['()*]/g,
    (e) => `%${e.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Hn(t) {
  const e = Cr(t), o = zn(t);
  return `Content-Disposition: form-data; name="file"; filename="${e}"; filename*=UTF-8''${o}\r
`;
}
function jn(t) {
  const e = /* @__PURE__ */ new Map(), o = (a, d = !1) => {
    const f = Date.now();
    if (!d && f - a.lastProgressAt < 80) return;
    a.lastProgressAt = f;
    const g = Math.max(f - a.startedAt, 1), v = Math.floor(a.uploadedBytes * 1e3 / g), B = a.totalBytes > 0 ? Math.min(a.uploadedBytes / a.totalBytes * 100, 100) : 0;
    a.sender.send("http:upload:progress", {
      uploadId: a.uploadId,
      uploadedBytes: a.uploadedBytes,
      totalBytes: a.totalBytes,
      percentage: B,
      speedBps: v
    });
  };
  t.handle("http:fetch", async (a, d, f = {}) => (F.debug("http:fetch start"), F.debug("http:fetch URL:", d), F.debug("http:fetch options:", f), new Promise((g, v) => {
    const B = on.request({ url: d, method: f.method || "GET" });
    f.headers && Object.entries(f.headers).forEach(([C, x]) => {
      F.debug(`http:fetch set header ${C}: ${String(x)}`), B.setHeader(C, x);
    });
    let S = "";
    B.on("response", (C) => {
      F.debug("http:fetch response"), F.debug("http:fetch status:", C.statusCode), F.debug("http:fetch headers:", C.headers), C.on("data", (x) => {
        F.debug(`http:fetch chunk length: ${x.length}`), S += x;
      }), C.on("end", () => {
        F.debug("http:fetch body preview:", S.slice(0, 500));
        let x;
        try {
          x = JSON.parse(S);
        } catch {
          x = S;
        }
        g({
          status: C.statusCode,
          headers: C.headers,
          body: x
        });
      });
    }), B.on("error", (C) => {
      F.error("http:fetch error:", C), v(C);
    }), f.body && B.write(f.body), B.end();
  }))), t.handle("http:upload:abort", async (a, d) => {
    const f = e.get(d);
    if (!f) return !1;
    f.aborted = !0, e.delete(d);
    try {
      f.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      f.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), t.handle("http:upload", async (a, d, f, g = {}, v = {}, B) => new Promise((S, C) => {
    let x;
    try {
      x = Bt.statSync(f);
    } catch (k) {
      C(new Error(`读取上传文件失败: ${f} (${String(k)})`));
      return;
    }
    if (!x.isFile()) {
      C(new Error(`上传目标不是文件: ${f}`));
      return;
    }
    if (x.size > Nn) {
      C(new Error(In));
      return;
    }
    const E = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), _ = B || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, P = R.basename(f), W = Object.entries(g).map(([k, V]) => `--${E}\r
Content-Disposition: form-data; name="${Cr(k)}"\r
\r
${V}\r
`).join(""), oe = `--${E}\r
` + Hn(P) + `Content-Type: application/octet-stream\r
\r
`, X = `\r
--${E}--\r
`, Z = Buffer.byteLength(W) + Buffer.byteLength(oe) + x.size + Buffer.byteLength(X), Be = {
      ...v,
      "Content-Type": `multipart/form-data; boundary=${E}`,
      "Content-Length": String(Z)
    }, ie = new URL(d), Y = (ie.protocol === "https:" ? hr : yr).request({
      protocol: ie.protocol,
      hostname: ie.hostname,
      port: ie.port ? Number(ie.port) : void 0,
      path: `${ie.pathname}${ie.search}`,
      method: "POST",
      headers: Be
    }), se = Bt.createReadStream(f, {
      highWaterMark: 1024 * 1024
    }), Q = {
      uploadId: _,
      request: Y,
      fileStream: se,
      sender: a.sender,
      totalBytes: Math.max(0, x.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    e.set(_, Q);
    let ae = !1;
    const Te = (k) => {
      ae || (ae = !0, e.delete(_), S(k));
    }, fe = (k) => {
      ae || (ae = !0, e.delete(_), C(k));
    };
    let N = "";
    Y.on("response", (k) => {
      k.on("data", (V) => {
        N += V.toString();
      }), k.on("end", () => {
        let V;
        try {
          V = JSON.parse(N);
        } catch {
          V = N;
        }
        Te({
          status: k.statusCode,
          body: V
        });
      });
    }), Y.on("error", (k) => {
      if (Q.aborted) {
        fe(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        se.destroy(k);
      } catch {
      }
      fe(k);
    }), Y.write(W), Y.write(oe), se.on("data", (k) => {
      Q.aborted || (Q.uploadedBytes += k.length, o(Q));
    }), se.on("end", () => {
      Q.aborted || (o(Q, !0), Y.write(X), Y.end());
    }), se.on("error", (k) => {
      if (Q.aborted) {
        fe(new Error("UPLOAD_ABORTED"));
        return;
      }
      fe(k);
      try {
        Y.destroy(k);
      } catch {
      }
    }), se.pipe(Y, { end: !1 });
  }));
}
function Vn() {
  kn(D), Wn(D), jn(D);
}
const ze = "persist:omniflow-embedded-browser", Kn = "embedded-browser-downloads";
let vt = null, cr = !1;
function Br() {
  return R.join($.getPath("userData"), Kn);
}
function qn() {
  const t = Br();
  return dt(t) || Ot(t, { recursive: !0 }), t;
}
function Jn() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function Gn(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function nt(t, e) {
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
function Xn() {
  return vt || (vt = He.fromPartition(ze)), vt;
}
async function xr(t) {
  const e = R.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const o = R.resolve(Br());
  return e !== o && !e.startsWith(`${o}${R.sep}`) ? !1 : (await ct.rm(e, { force: !0 }), !0);
}
function Zn(t) {
  if (cr)
    return;
  cr = !0;
  const e = (d, f, g) => {
    const v = t.resolveTabIdByWebContents(g) || void 0;
    if (!v)
      return;
    const B = qn(), S = Jn(), C = f.getFilename() || "download", x = f.getURL() || "", E = g.getURL() || void 0, _ = R.join(B, Gn(C));
    f.setSavePath(_), t.emitDownload(nt(f, {
      downloadId: S,
      fileName: C,
      mimeType: f.getMimeType() || void 0,
      pageUrl: E,
      state: "started",
      tabId: v,
      tempPath: _,
      url: x
    })), f.on("updated", (P, W) => {
      W === "progressing" && t.emitDownload(nt(f, {
        downloadId: S,
        fileName: C,
        mimeType: f.getMimeType() || void 0,
        pageUrl: E,
        state: "progress",
        tabId: v,
        tempPath: _,
        url: x
      }));
    }), f.once("done", (P, W) => {
      if (W === "completed") {
        t.emitDownload(nt(f, {
          downloadId: S,
          fileName: C,
          mimeType: f.getMimeType() || void 0,
          pageUrl: E,
          state: "completed",
          tabId: v,
          tempPath: _,
          url: x
        }));
        return;
      }
      xr(_).catch(() => {
      }), t.emitDownload(nt(f, {
        downloadId: S,
        error: W === "cancelled" ? "下载已取消" : `下载失败：${W}`,
        fileName: C,
        mimeType: f.getMimeType() || void 0,
        pageUrl: E,
        state: W === "cancelled" ? "cancelled" : "failed",
        tabId: v,
        tempPath: _,
        url: x
      }));
    });
  }, o = /* @__PURE__ */ new Set();
  [He.defaultSession, Xn()].filter(Boolean).forEach((d) => {
    o.has(d) || (o.add(d), d.on("will-download", e));
  });
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
function _r(t) {
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
  return _r(e);
}
async function ro(t, e) {
  const o = await t(
    Qn(e)
  );
  return _r(o);
}
async function Tt(t, e) {
  return !!await t(
    eo(e)
  );
}
function no(t, e) {
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
function oo(t) {
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
function io(t) {
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
async function lr(t, e, o) {
  const a = String(o || "").trim();
  return a ? !!await t(
    no(e, a)
  ) : !1;
}
async function so(t, e) {
  return String(e.url || "").trim() ? !!await t(
    oo(e)
  ) : !1;
}
async function ur(t, e) {
  const o = String(e || "").trim();
  if (!o)
    return null;
  const a = await t(
    io(o)
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
const _t = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function ao() {
  return `(${Mr.toString()})(${JSON.stringify(_t)});`;
}
function Mr(t) {
  var tr, rr, nr, or, ir;
  const e = globalThis, o = typeof document > "u" && typeof e.importScripts == "function", a = typeof ((tr = e.location) == null ? void 0 : tr.href) == "string" ? e.location.href : "", d = typeof ((rr = e.location) == null ? void 0 : rr.hostname) == "string" ? e.location.hostname : "resource", f = typeof ((nr = e.location) == null ? void 0 : nr.protocol) == "string" ? e.location.protocol : "https:", g = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__", v = typeof e.open == "function" ? e.open.bind(e) : null;
  if (e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)
    return "already-installed";
  const B = /* @__PURE__ */ new Set(), S = /* @__PURE__ */ new Map(), C = /* @__PURE__ */ new Map(), x = /* @__PURE__ */ new Map(), E = /* @__PURE__ */ new WeakMap();
  let _ = 0, P = 0;
  const W = /* @__PURE__ */ new Set(["m3u8", "mpd"]), oe = /* @__PURE__ */ new Set([
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
  ]), X = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), Z = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), Be = /^data:(application|video|audio)\//i, ie = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i, qe = /(m3u8|mpd)(\?|$)/i, Y = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv)(\?|$)/i, se = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|$)/i, Q = /\.(vtt|srt|ass|ssa|ttml)(\?|$)/i, ae = /\.pdf(\?|$)/i, Te = JSON.parse.bind(JSON), fe = typeof console.info == "function" ? console.info.bind(console) : console.log.bind(console), N = {
    autoDownloadOnComplete: "OmniflowCatchToolkit:autoDownloadOnComplete",
    autoSeekToBufferedEnd: "OmniflowCatchToolkit:autoSeekToBufferedEnd",
    clearCacheOnComplete: "OmniflowCatchToolkit:clearCacheOnComplete",
    manualFileName: "OmniflowCatchToolkit:manualFileName",
    regexRule: "OmniflowCatchToolkit:regexRule",
    restartAlwaysFromBeginning: "OmniflowCatchToolkit:restartAlwaysFromBeginning",
    selectorRule: "OmniflowCatchToolkit:selectorRule",
    trimExtraMediaHeaders: "OmniflowCatchToolkit:trimExtraMediaHeaders"
  };
  let k = "", V = !1;
  const b = {
    autoSeekToBufferedEnd: !1,
    autoDownloadOnComplete: !1,
    clearCacheOnComplete: !1,
    manualFileName: "",
    regexRule: "",
    restartAlwaysFromBeginning: !1,
    selectorRule: "",
    trimExtraMediaHeaders: !0
  }, xe = /* @__PURE__ */ new WeakSet(), K = /* @__PURE__ */ new WeakSet();
  let _e = null;
  function ee(r) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(r) || "").trim();
    } catch {
      return "";
    }
  }
  function Re(r, n = !1) {
    try {
      return typeof localStorage > "u" ? n : localStorage.getItem(r) === "checked";
    } catch {
      return n;
    }
  }
  function he(r, n) {
    try {
      if (typeof localStorage > "u")
        return;
      const c = String(n || "").trim();
      if (!c) {
        localStorage.removeItem(r);
        return;
      }
      localStorage.setItem(r, c);
    } catch {
    }
  }
  function ce(r, n) {
    try {
      if (typeof localStorage > "u")
        return;
      localStorage.setItem(r, n ? "checked" : "");
    } catch {
    }
  }
  function Me(r) {
    var c;
    const n = String(r || "").trim();
    if (!n)
      return {
        rule: "",
        warning: ""
      };
    if (typeof document > "u")
      return {
        rule: n,
        warning: ""
      };
    try {
      const m = document.querySelector(n), h = ((c = m == null ? void 0 : m.textContent) == null ? void 0 : c.trim()) || "";
      return {
        rule: n,
        warning: h ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function Pe(r) {
    const n = String(r || "").trim();
    if (!n)
      return {
        rule: "",
        warning: ""
      };
    try {
      return new RegExp(n, "g"), {
        rule: n,
        warning: ""
      };
    } catch {
      return {
        rule: "",
        warning: "正则表达式错误"
      };
    }
  }
  function Oe() {
    o || (b.autoDownloadOnComplete = Re(
      N.autoDownloadOnComplete,
      b.autoDownloadOnComplete
    ), b.autoSeekToBufferedEnd = Re(
      N.autoSeekToBufferedEnd,
      b.autoSeekToBufferedEnd
    ), b.clearCacheOnComplete = Re(
      N.clearCacheOnComplete,
      b.clearCacheOnComplete
    ), b.manualFileName = ee(N.manualFileName), b.restartAlwaysFromBeginning = Re(
      N.restartAlwaysFromBeginning,
      b.restartAlwaysFromBeginning
    ), b.trimExtraMediaHeaders = Re(
      N.trimExtraMediaHeaders,
      b.trimExtraMediaHeaders
    ), b.selectorRule = Me(
      ee(N.selectorRule)
    ).rule, b.regexRule = Pe(
      ee(N.regexRule)
    ).rule);
  }
  function Je() {
    o || (ce(
      N.autoDownloadOnComplete,
      b.autoDownloadOnComplete
    ), ce(
      N.autoSeekToBufferedEnd,
      b.autoSeekToBufferedEnd
    ), ce(
      N.clearCacheOnComplete,
      b.clearCacheOnComplete
    ), he(
      N.manualFileName,
      b.manualFileName
    ), he(
      N.regexRule,
      b.regexRule
    ), ce(
      N.restartAlwaysFromBeginning,
      b.restartAlwaysFromBeginning
    ), he(
      N.selectorRule,
      b.selectorRule
    ), ce(
      N.trimExtraMediaHeaders,
      b.trimExtraMediaHeaders
    ));
  }
  Oe();
  function we() {
    return typeof document > "u" || typeof document.title != "string" ? "" : document.title.trim();
  }
  function ke() {
    var h, T;
    const r = s(b.manualFileName);
    if (r !== "media")
      return r;
    let n = "";
    const c = String(b.selectorRule || "").trim();
    if (c && typeof document < "u")
      try {
        const M = document.querySelector(c), H = ((h = M == null ? void 0 : M.textContent) == null ? void 0 : h.trim()) || "";
        H && (n = H);
      } catch {
      }
    const m = String(b.regexRule || "").trim();
    if (m && typeof document < "u")
      try {
        const M = n || ((T = document.documentElement) == null ? void 0 : T.outerHTML) || "";
        if (M) {
          const H = new RegExp(m, "g"), pe = Array.from(M.matchAll(H)).flatMap((G) => G.length > 1 ? G.slice(1).filter((ge) => typeof ge == "string" && ge.trim()) : G[0] ? [G[0]] : []);
          pe.length > 0 && (n = pe.join("_"));
        }
      } catch {
      }
    return s(n || we() || d || "media");
  }
  function Ce(r) {
    if (typeof r != "string")
      return "";
    const n = r.trim();
    if (!n || n.startsWith("data:"))
      return "";
    if (n.startsWith("//"))
      return `${f}${n}`;
    if (n.startsWith("blob:"))
      return n;
    try {
      if (ie.test(n))
        return new URL(n, a).toString();
      if (/^https?:\/\//i.test(n))
        return n;
    } catch {
      return "";
    }
    return "";
  }
  function Le(r) {
    try {
      const c = (new URL(r, a).pathname || "").toLowerCase().match(/\.([a-z0-9]+)$/i);
      return (c == null ? void 0 : c[1]) || "";
    } catch {
      const n = r.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      return (n == null ? void 0 : n[1]) || "";
    }
  }
  function Ae(r, n) {
    var h;
    const c = Le(r), m = (h = String(n || "").split(";")[0]) == null ? void 0 : h.trim().toLowerCase();
    return W.has(c) || m.includes("mpegurl") || m.includes("dash+xml") || qe.test(r) ? "manifest" : oe.has(c) || m.startsWith("video/") || m.startsWith("audio/") || Y.test(r) || r.startsWith("blob:") ? "media" : X.has(c) || m.startsWith("image/") || se.test(r) ? "image" : Z.has(c) || m.includes("text/vtt") || Q.test(r) ? "subtitle" : c === "pdf" || m === "application/pdf" || ae.test(r) ? "document" : "other";
  }
  function Fe(r, n) {
    var m;
    const c = (m = String(r || "").split(";")[0]) == null ? void 0 : m.trim().toLowerCase();
    return c === "audio/mp4" ? "m4a" : c === "video/mp4" ? "mp4" : c === "audio/mpeg" ? "mp3" : c === "audio/aac" ? "aac" : c.endsWith("/webm") ? "webm" : c.endsWith("/ogg") ? "ogg" : c.endsWith("/wav") ? "wav" : n === "audio" ? "m4a" : "mp4";
  }
  function s(r) {
    return String(r || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "media";
  }
  function i() {
    const r = Me(b.selectorRule), n = Pe(b.regexRule), c = Array.from(S.values()).reduce((m, h) => m + Math.max(0, Number(h.totalBytes || 0)), 0);
    return {
      autoSeekToBufferedEnd: b.autoSeekToBufferedEnd,
      autoDownloadOnComplete: b.autoDownloadOnComplete,
      capturedMediaSizeBytes: c,
      clearCacheOnComplete: b.clearCacheOnComplete,
      currentFileName: ke(),
      isCaptureComplete: V,
      manualFileName: b.manualFileName,
      regexWarning: n.warning,
      regexRule: n.rule,
      restartAlwaysFromBeginning: b.restartAlwaysFromBeginning,
      selectorWarning: r.warning,
      selectorRule: r.rule,
      streamCount: S.size,
      trimExtraMediaHeaders: b.trimExtraMediaHeaders
    };
  }
  function l(r) {
    return r instanceof ArrayBuffer ? r.slice(0) : ArrayBuffer.isView(r) ? r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) : null;
  }
  function u(r) {
    const n = new Uint8Array(r), c = 32768;
    let m = "";
    for (let h = 0; h < n.length; h += c) {
      const T = n.subarray(h, Math.min(h + c, n.length));
      m += String.fromCharCode(...T);
    }
    return btoa(m);
  }
  function p(r) {
    return u(new TextEncoder().encode(r).buffer);
  }
  function y(r) {
    const n = atob(r), c = new Uint8Array(n.length);
    for (let m = 0; m < n.length; m += 1)
      c[m] = n.charCodeAt(m);
    return c.buffer;
  }
  function w(r) {
    const n = String(r || "").trim();
    return n.length === 24 && n.endsWith("==") && /^[A-Za-z0-9+/]+={0,2}$/.test(n);
  }
  function U(r) {
    return /^[A-Fa-f0-9]{32}$/.test(String(r || "").trim());
  }
  function A(r) {
    try {
      const c = new URL(r, a).toString().split("/");
      return c.pop(), `${c.join("/")}/`;
    } catch {
      return "";
    }
  }
  function L(r, n) {
    return !r || !n ? n : n.split(`
`).map((c) => {
      const m = c.trim();
      if (!m || m.startsWith("#"))
        return m.includes('URI="') ? m.replace(/URI="(.*)"/, (h, T) => Ce(T) ? `URI="${T}"` : `URI="${r}${T}"`) : c;
      if (Ce(m))
        return m;
      if (m.startsWith("/"))
        try {
          const h = new URL(r);
          return `${h.protocol}//${h.host}${m}`;
        } catch {
          return `${r}${m.replace(/^\//, "")}`;
        }
      return `${r}${m}`;
    }).join(`
`);
  }
  function q(r) {
    const n = String(r || "").trim();
    if (!n || !/^[\[{]/.test(n))
      return null;
    try {
      return Te(n);
    } catch {
      return null;
    }
  }
  function O(r) {
    const n = String(r || "").trim();
    if (!Be.test(n))
      return "";
    const c = n.indexOf(",");
    if (c === -1)
      return "";
    const m = n.slice(0, c), h = n.slice(c + 1);
    try {
      return /;base64/i.test(m) ? new TextDecoder().decode(y(h)) : decodeURIComponent(h);
    } catch {
      return "";
    }
  }
  function me(r, n = 16) {
    if (r.byteLength <= n || r.byteLength % n !== 0)
      return null;
    const c = new Uint8Array(r), m = c.slice(0, n);
    for (let h = n; h < c.length; h += n)
      for (let T = 0; T < n; T += 1)
        if (c[h + T] !== m[T])
          return null;
    return m.buffer;
  }
  function Ge(r) {
    return r.byteLength === 16 ? r.slice(0) : r.byteLength === 32 ? me(r, 16) || r.slice(0, 16) : r.byteLength === 128 || r.byteLength === 256 ? me(r, 16) : null;
  }
  function Xe() {
    return P += 1, `probe-resource:${Date.now()}-${P}`;
  }
  function Ir(r, n) {
    const c = r === "key" ? `${we() || d || "resource"}-key` : we() || d || "resource";
    return `${s(c)}.${n}`;
  }
  function zr(r) {
    const n = x.get(r.signature);
    if (n) {
      const M = C.get(n);
      if (M)
        return {
          contentLength: M.contentLength,
          fileName: M.fileName,
          resourceKey: n,
          url: M.blobUrl
        };
    }
    const c = new Blob([y(r.base64)], { type: r.mimeType }), m = Xe(), h = Ir(r.kind, r.ext), T = URL.createObjectURL(c);
    return x.set(r.signature, m), C.set(m, {
      base64: r.base64,
      blobUrl: T,
      contentLength: c.size,
      fileName: h,
      mimeType: r.mimeType,
      streamType: r.streamType
    }), {
      contentLength: c.size,
      fileName: h,
      resourceKey: m,
      url: T
    };
  }
  function pt(r) {
    if (!o || typeof e.postMessage != "function")
      return !1;
    try {
      return e.postMessage({ [g]: r }), !0;
    } catch {
      return !1;
    }
  }
  function We(r, n = !1) {
    if (o && !n) {
      pt({ payload: r, type: "generated-resource" });
      return;
    }
    const c = zr(r);
    Ye({
      contentLength: c.contentLength,
      ext: r.ext,
      kind: r.kind,
      mimeType: r.mimeType,
      resourceKey: c.resourceKey,
      resourceType: r.resourceType,
      source: "probe",
      streamType: r.streamType,
      url: c.url
    }, n);
  }
  function be(r, n = "key") {
    const c = Ge(r);
    if (!c)
      return !1;
    const m = u(c);
    return We({
      base64: m,
      ext: n,
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${m}`
    }), !0;
  }
  function Ze(r) {
    if (!w(r))
      return !1;
    try {
      return y(r).byteLength !== 16 ? !1 : (We({
        base64: r,
        ext: "base64key",
        kind: "key",
        mimeType: "application/octet-stream",
        resourceType: "key",
        signature: `key:${r}`
      }), !0);
    } catch {
      return !1;
    }
  }
  function Wt(r) {
    const n = String(r || "").trim().toLowerCase();
    if (!U(n))
      return !1;
    const c = new Uint8Array(16);
    for (let m = 0; m < 16; m += 1)
      c[m] = Number.parseInt(n.slice(m * 2, m * 2 + 2), 16);
    return We({
      base64: u(c.buffer),
      ext: "key",
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${n}`
    }), !0;
  }
  function gt(r, n, c) {
    const m = n === "m3u8" ? L(A(c || a), r) : r;
    We({
      base64: p(m),
      ext: n,
      kind: "manifest",
      mimeType: n === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml",
      resourceType: "inline-manifest",
      signature: `${n}:${m}`
    });
  }
  function Hr(r) {
    const n = new Uint8Array(r);
    return n.length > 8 && n[4] === 102 && n[5] === 116 && n[6] === 121 && n[7] === 112;
  }
  function jr(r) {
    const n = new Uint8Array(r);
    return n.length > 4 && n[0] === 26 && n[1] === 69 && n[2] === 223 && n[3] === 163;
  }
  function yt(r) {
    if (!b.trimExtraMediaHeaders || !Array.isArray(r) || r.length <= 1)
      return r;
    let n = -1;
    return r.forEach((c, m) => {
      (Hr(c) || jr(c)) && (n = m);
    }), n > 0 ? r.slice(n) : r;
  }
  function Ye(r, n = !1) {
    if (r.url) {
      if (r.resourceType !== "mse-stream") {
        const c = `${r.resourceKey || r.source}:${r.resourceType || "unknown"}:${r.url}`;
        if (B.has(c))
          return;
        B.add(c), B.size > 2e3 && (B.clear(), B.add(c));
      }
      if (o && !n) {
        pt({ payload: r, type: "capture" });
        return;
      }
      try {
        fe(t + JSON.stringify({
          capturedAt: Date.now(),
          contentLength: r.contentLength,
          ext: r.ext,
          kind: r.kind || Ae(r.url, r.mimeType),
          mimeType: r.mimeType,
          pageUrl: a,
          resourceKey: r.resourceKey,
          resourceType: r.resourceType || "probe",
          source: r.source,
          streamType: r.streamType,
          url: r.url
        }));
      } catch {
      }
    }
  }
  function Vr(r) {
    const n = r.map((c) => String(c || "").toLowerCase());
    if (n.some((c) => c === "audio" || c.includes("audio")))
      return "audio";
    if (n.some((c) => c === "video" || c.includes("video")))
      return "video";
  }
  function ht(r) {
    if (xe.has(r))
      return;
    xe.add(r), r.addEventListener("progress", () => {
      if (b.autoSeekToBufferedEnd)
        try {
          if (!r.buffered || r.buffered.length === 0)
            return;
          const m = r.buffered.end(r.buffered.length - 1), h = Math.max(m - 5, 0), T = Number.isFinite(r.duration) ? r.duration : 0;
          if (T > 0 && m >= T)
            return;
          Math.abs(r.currentTime - h) > 1 && (r.currentTime = h);
        } catch {
        }
    });
    const n = () => {
      if (!(!b.restartAlwaysFromBeginning || K.has(r)))
        try {
          K.add(r), De(), r.currentTime = 0;
        } catch {
        }
    };
    r.addEventListener("play", () => {
      n();
    }, { once: !0 });
    const c = window.setInterval(() => {
      if (K.has(r) || !b.restartAlwaysFromBeginning) {
        window.clearInterval(c);
        return;
      }
      r.paused || (n(), window.clearInterval(c));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(c);
    }, 5e3);
  }
  function Kr() {
    typeof document > "u" || document.querySelectorAll("video, audio").forEach((r) => {
      r instanceof HTMLMediaElement && ht(r);
    });
  }
  function wt() {
    o || typeof MutationObserver > "u" || _e || typeof document > "u" || (Kr(), _e = new MutationObserver((r) => {
      r.forEach((n) => {
        n.addedNodes.forEach((c) => {
          if (c instanceof Element) {
            if (c instanceof HTMLMediaElement) {
              ht(c);
              return;
            }
            c.querySelectorAll("video, audio").forEach((m) => {
              m instanceof HTMLMediaElement && ht(m);
            });
          }
        });
      });
    }), _e.observe(document.body || document.documentElement, {
      childList: !0,
      subtree: !0
    }));
  }
  function De() {
    let r = !1;
    return S.forEach((n) => {
      if (n.blobUrl && (URL.revokeObjectURL(n.blobUrl), n.blobUrl = ""), V) {
        r = r || n.buffers.length > 0, n.buffers = [], n.bufferCount = 0, n.lastReportedBufferCount = 0, n.lastReportedBytes = 0, n.totalBytes = 0, Ne(n.streamId);
        return;
      }
      if (n.buffers.length > 1) {
        const c = n.buffers[0];
        n.buffers = c ? [c] : [], n.bufferCount = n.buffers.length, n.totalBytes = (c == null ? void 0 : c.byteLength) || 0, n.lastReportedBufferCount = n.bufferCount, n.lastReportedBytes = n.totalBytes, r = !0, Ne(n.streamId);
      }
    }), V = !1, r;
  }
  function Nt() {
    if (typeof document > "u")
      return !1;
    const r = Array.from(S.values()).filter((c) => c.buffers.length > 0);
    if (r.length === 0)
      return !1;
    const n = ke();
    return r.forEach((c) => {
      const m = yt(c.buffers), h = new Blob(m, { type: c.mimeType }), T = document.createElement("a"), M = URL.createObjectURL(h), H = Fe(c.mimeType, c.streamType), re = r.length > 1 && c.streamType ? `-${c.streamType}` : "";
      T.href = M, T.download = `${n}${re}.${H}`, T.click(), T.remove(), setTimeout(() => {
        URL.revokeObjectURL(M);
      }, 1e3);
    }), b.clearCacheOnComplete && setTimeout(() => {
      De();
    }, 0), !0;
  }
  function qr() {
    if (typeof document > "u")
      return !1;
    De();
    let r = !1;
    return document.querySelectorAll("video, audio").forEach((n) => {
      if (n instanceof HTMLMediaElement)
        try {
          n.currentTime = 0, n.play().catch(() => {
          }), r = !0;
        } catch {
        }
    }), r;
  }
  function Jr(r) {
    return `mse-stream:${r}`;
  }
  function Ne(r) {
    const n = S.get(r);
    n && Ye({
      contentLength: n.totalBytes,
      ext: Fe(n.mimeType, n.streamType),
      kind: "media",
      mimeType: n.mimeType,
      resourceKey: Jr(r),
      resourceType: "mse-stream",
      source: "probe",
      streamType: n.streamType,
      url: n.blobUrl || `mse://capturing/${r}`
    });
  }
  function $t(r) {
    const n = S.get(r);
    if (!n || n.buffers.length === 0)
      return !1;
    n.blobUrl && (URL.revokeObjectURL(n.blobUrl), n.blobUrl = "");
    try {
      const c = yt(n.buffers);
      return n.blobUrl = URL.createObjectURL(new Blob(c, { type: n.mimeType })), Ne(r), !0;
    } catch {
      return !1;
    }
  }
  function It(r) {
    const n = S.get(r);
    return n ? (n.blobUrl || $t(r), n.blobUrl) : "";
  }
  function zt(r) {
    const n = S.get(r);
    if (!n)
      return "media.bin";
    const c = ke(), m = n.streamType ? `-${n.streamType}` : "", h = Fe(n.mimeType, n.streamType);
    return `${c}${m}.${h}`;
  }
  function Gr(r) {
    const n = String(r || "").replace(/^mse-stream:/, ""), c = It(n);
    if (!c || typeof document > "u")
      return !1;
    const m = document.createElement("a");
    return m.href = c, m.download = zt(n), m.click(), m.remove(), b.clearCacheOnComplete && setTimeout(() => {
      De();
    }, 0), !0;
  }
  function Xr(r) {
    const n = String(r || "").replace(/^mse-stream:/, ""), c = It(n);
    return !c || !v ? !1 : (v(c, "_blank", "noopener,noreferrer"), !0);
  }
  async function Zr(r) {
    const n = String(r || "").replace(/^mse-stream:/, ""), c = S.get(n);
    if (!c || c.buffers.length === 0)
      return null;
    try {
      const m = yt(c.buffers), T = await new Blob(m, { type: c.mimeType }).arrayBuffer();
      return {
        base64: u(T),
        fileName: zt(n),
        mimeType: c.mimeType,
        resourceKey: r,
        streamType: c.streamType
      };
    } catch {
      return null;
    }
  }
  function Yr(r) {
    const n = C.get(r);
    return !(n != null && n.blobUrl) || !v ? !1 : (v(n.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function Qr(r) {
    const n = C.get(r);
    if (!(n != null && n.blobUrl) || typeof document > "u")
      return !1;
    const c = document.createElement("a");
    return c.href = n.blobUrl, c.download = n.fileName, c.click(), c.remove(), !0;
  }
  function en(r) {
    const n = C.get(r);
    return n ? Promise.resolve({
      base64: n.base64,
      fileName: n.fileName,
      mimeType: n.mimeType,
      resourceKey: r,
      streamType: n.streamType
    }) : Promise.resolve(null);
  }
  function tn(r) {
    if (!r || typeof r != "object")
      return !1;
    const n = r[g];
    return !n || typeof n != "object" || !("type" in n) ? !1 : o ? pt(n) : n.type === "capture" ? (Ye(n.payload, !0), !0) : n.type === "generated-resource" ? (We(n.payload, !0), !0) : !1;
  }
  const bt = e.Worker;
  typeof bt == "function" && (e.Worker = new Proxy(bt, {
    construct(r, n, c) {
      const [m, h] = n, T = () => {
        const re = typeof m == "string" ? m : String(m), pe = Ce(re) || re;
        if (!pe)
          return "";
        const G = `;(${Mr.toString()})(${JSON.stringify(t)});
`;
        let ge = "";
        if ((h == null ? void 0 : h.type) === "module")
          ge = `${G}import ${JSON.stringify(pe)};
`;
        else {
          const Se = new XMLHttpRequest();
          if (Se.open("GET", pe, !1), Se.send(), Se.status < 200 || Se.status >= 300 || !Se.responseText)
            return "";
          ge = `${G}${Se.responseText}`;
        }
        return URL.createObjectURL(new Blob([ge], { type: "text/javascript" }));
      };
      let M = "";
      try {
        M = T();
      } catch {
        M = "";
      }
      const H = M ? Reflect.construct(r, [M, h], c) : Reflect.construct(r, n, c);
      return H.addEventListener("message", (re) => {
        tn(re.data) && re.stopImmediatePropagation();
      }, { capture: !0 }), M && setTimeout(() => {
        URL.revokeObjectURL(M);
      }, 6e4), H;
    }
  }), e.Worker.toString = function() {
    return bt.toString();
  });
  const le = e.MediaSource;
  if ((or = le == null ? void 0 : le.prototype) != null && or.addSourceBuffer) {
    const r = le.prototype.addSourceBuffer;
    le.prototype.addSourceBuffer = new Proxy(r, {
      apply(n, c, m) {
        var T;
        const h = Reflect.apply(n, c, m);
        try {
          wt(), V = !1;
          const M = c, H = String((m == null ? void 0 : m[0]) || "").trim(), re = ((T = H.split(";")[0]) == null ? void 0 : T.trim().toLowerCase()) || "", pe = re.startsWith("audio/") ? "audio" : re.startsWith("video/") ? "video" : void 0, G = `${Date.now()}-${++_}`, ge = E.get(M) || [];
          if (ge.push(G), E.set(M, ge), S.set(G, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: H || (pe === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: G,
            streamType: pe,
            totalBytes: 0
          }), Ne(G), h && typeof h.appendBuffer == "function") {
            const Se = h.appendBuffer;
            h.appendBuffer = new Proxy(Se, {
              apply(rn, nn, et) {
                const Et = Reflect.apply(rn, nn, et), ne = S.get(G);
                if (!ne)
                  return Et;
                const tt = l(et == null ? void 0 : et[0]);
                return !tt || tt.byteLength === 0 || (ne.buffers.push(tt), ne.bufferCount += 1, ne.totalBytes += tt.byteLength, (ne.bufferCount <= 3 || ne.bufferCount - ne.lastReportedBufferCount >= 8 || ne.totalBytes - ne.lastReportedBytes >= 1024 * 512) && (ne.lastReportedBufferCount = ne.bufferCount, ne.lastReportedBytes = ne.totalBytes, Ne(G))), Et;
              }
            });
          }
        } catch {
        }
        return h;
      }
    });
  }
  if ((ir = le == null ? void 0 : le.prototype) != null && ir.endOfStream) {
    const r = le.prototype.endOfStream;
    le.prototype.endOfStream = new Proxy(r, {
      apply(n, c, m) {
        const h = Reflect.apply(n, c, m);
        try {
          if (V = !0, (E.get(c) || []).forEach((M) => {
            $t(M);
          }), b.autoDownloadOnComplete)
            return setTimeout(() => {
              Nt();
            }, 500), h;
          b.clearCacheOnComplete && setTimeout(() => {
            De();
          }, 0);
        } catch {
        }
        return h;
      }
    });
  }
  function te(r, n) {
    if (typeof r != "string")
      return;
    const c = r.trim();
    if (!c || Ze(c))
      return;
    const m = c.split("").join("").trim();
    if (Wt(m))
      return;
    if (Be.test(c)) {
      const H = O(c);
      H && te(H, n);
      return;
    }
    const h = q(c);
    if (h) {
      $e(h);
      return;
    }
    const T = c.toUpperCase();
    if (T.startsWith("#EXTM3U") || T.includes("#EXTINF:")) {
      gt(c, "m3u8", n == null ? void 0 : n.baseUrl);
      return;
    }
    if (c.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || c.includes("<MPD") && c.includes("</MPD>")) {
      gt(c, "mpd", n == null ? void 0 : n.baseUrl);
      return;
    }
    const M = Ce(c);
    M && Ye({
      kind: Ae(M, n == null ? void 0 : n.mimeType),
      mimeType: n == null ? void 0 : n.mimeType,
      resourceType: n == null ? void 0 : n.resourceType,
      source: "probe",
      streamType: n == null ? void 0 : n.streamType,
      url: M
    });
  }
  function $e(r, n = 0, c = /* @__PURE__ */ new WeakSet(), m = []) {
    if (n > 6 || r == null)
      return;
    if (r instanceof ArrayBuffer) {
      be(r);
      return;
    }
    if (ArrayBuffer.isView(r)) {
      be(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength));
      return;
    }
    if (typeof r == "string") {
      te(r, {
        baseUrl: a,
        resourceType: "json",
        streamType: Vr(m)
      });
      return;
    }
    if (typeof r != "object")
      return;
    const h = r;
    if (!c.has(h)) {
      if (c.add(h), Array.isArray(r)) {
        if (r.length === 16 && r.every((T) => typeof T == "number" && Number.isFinite(T) && T >= 0 && T <= 255)) {
          be(Uint8Array.from(r).buffer);
          return;
        }
        r.slice(0, 80).forEach((T, M) => {
          $e(T, n + 1, c, m.concat(String(M)));
        });
        return;
      }
      Object.keys(r).slice(0, 80).forEach((T) => {
        $e(r[T], n + 1, c, m.concat(T));
      });
    }
  }
  const St = typeof e.fetch == "function" ? e.fetch.bind(e) : null;
  St && (e.fetch = async function(r, n) {
    const c = typeof r == "string" ? r : r instanceof Request ? r.url : String(r);
    te(c, { resourceType: "fetch" });
    const m = await St(r, n);
    return te(m.url || c, {
      mimeType: m.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), m.clone().arrayBuffer().then((T) => {
      if (!T.byteLength || be(T))
        return;
      const M = new TextDecoder().decode(T);
      M.trim() && te(M, {
        baseUrl: m.url || c,
        mimeType: m.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), m;
  }, e.fetch.toString = function() {
    return St.toString();
  });
  const Ht = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", jt = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(r, n) {
    return this[Ht] = typeof n == "string" ? n : String(n), jt.apply(this, arguments);
  };
  const Vt = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const r = this[Ht], n = this.responseURL || (typeof r == "string" ? r : "");
      if (te(n, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (be(this.response))
          return;
        const c = new TextDecoder().decode(this.response);
        c && te(c, {
          baseUrl: n,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        te(this.response, {
          baseUrl: n,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (this.response && typeof this.response == "object") {
        $e(this.response);
        return;
      }
      typeof this.responseText == "string" && this.responseText.trim() && te(this.responseText, {
        baseUrl: n,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), Vt.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return jt.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return Vt.toString();
  }, JSON.parse = function() {
    const r = Te.apply(this, arguments);
    return $e(r), r;
  }, JSON.parse.toString = function() {
    return Te.toString();
  };
  const Kt = btoa;
  e.btoa = function(r) {
    const n = Kt.apply(this, arguments);
    return Ze(n), te(r, { baseUrl: a, resourceType: "btoa" }), n;
  }, btoa.toString = function() {
    return Kt.toString();
  };
  const qt = atob;
  e.atob = function(r) {
    const n = qt.apply(this, arguments);
    return Ze(r), te(n, { baseUrl: a, resourceType: "atob" }), n;
  }, atob.toString = function() {
    return qt.toString();
  };
  const Jt = String.fromCharCode;
  String.fromCharCode = new Proxy(Jt, {
    apply(r, n, c) {
      const m = Reflect.apply(r, n, c);
      if (m.length >= 7) {
        if ((m.startsWith("#EXTM3U") || m.includes("#EXTINF:")) && (k += m, k.includes("#EXT-X-ENDLIST"))) {
          const T = k.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          gt(T, "m3u8", a), k = "";
        }
        const h = m.split("").join("").trim();
        Wt(h);
      }
      return m;
    }
  }), String.fromCharCode.toString = function() {
    return Jt.toString();
  };
  const Gt = Array.prototype.slice;
  Array.prototype.slice = function() {
    const r = Gt.apply(this, arguments);
    return Array.isArray(r) && r.length === 16 && r.every((n) => typeof n == "number" && Number.isFinite(n) && n >= 0 && n <= 255) && be(Uint8Array.from(r).buffer), r;
  }, Array.prototype.slice.toString = function() {
    return Gt.toString();
  };
  const Xt = Array.prototype.join;
  Array.prototype.join = function() {
    const r = Xt.apply(this, arguments);
    return typeof r == "string" && ((r.startsWith("#EXTM3U") || r.includes("#EXTINF:")) && te(r, { baseUrl: a, resourceType: "array-join" }), Ze(r)), r;
  }, Array.prototype.join.toString = function() {
    return Xt.toString();
  };
  const Qe = e.DataView;
  if (typeof Qe == "function") {
    const r = function(n, c, m) {
      const h = new Qe(n, c, m), T = () => {
        const M = h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
        be(M);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((M) => {
        const H = h[M];
        typeof H == "function" && (h[M] = function() {
          const re = H.apply(this, arguments);
          return T(), re;
        });
      }), T(), h;
    };
    r.prototype = Qe.prototype, r.toString = function() {
      return Qe.toString();
    }, e.DataView = r;
  }
  function Zt(r) {
    return function() {
      const n = r.apply(this, arguments);
      return (n == null ? void 0 : n.byteLength) === 16 && be(n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength)), n;
    };
  }
  const Yt = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = Zt(Yt), Int8Array.prototype.subarray.toString = function() {
    return Yt.toString();
  };
  const Qt = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = Zt(Qt), Uint8Array.prototype.subarray.toString = function() {
    return Qt.toString();
  };
  const er = String.prototype.indexOf;
  return String.prototype.indexOf = function(r, n) {
    const c = er.apply(this, arguments);
    if (r === "#EXTM3U" && c !== -1) {
      const m = String(this);
      te(m.slice(Math.max(n ?? 0, 0)), {
        baseUrl: a,
        resourceType: "string-indexof"
      });
    }
    return c;
  }, String.prototype.indexOf.toString = function() {
    return er.toString();
  }, o || wt(), e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return De();
    },
    downloadCatchMedia() {
      return Nt();
    },
    exportResource(r) {
      const n = String(r || "");
      return n.startsWith("mse-stream:") ? Gr(n) : n.startsWith("probe-resource:") ? Qr(n) : !1;
    },
    getCatchToolkitState() {
      return i();
    },
    installedAt: Date.now(),
    openResource(r) {
      const n = String(r || "");
      return n.startsWith("mse-stream:") ? Xr(n) : n.startsWith("probe-resource:") ? Yr(n) : !1;
    },
    readResource(r) {
      const n = String(r || "");
      return n.startsWith("mse-stream:") ? Zr(n) : n.startsWith("probe-resource:") ? en(n) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return qr();
    },
    seen: B,
    updateCatchToolkitState(r) {
      return typeof r.autoSeekToBufferedEnd == "boolean" && (b.autoSeekToBufferedEnd = r.autoSeekToBufferedEnd), typeof r.autoDownloadOnComplete == "boolean" && (b.autoDownloadOnComplete = r.autoDownloadOnComplete), typeof r.clearCacheOnComplete == "boolean" && (b.clearCacheOnComplete = r.clearCacheOnComplete), typeof r.manualFileName == "string" && (b.manualFileName = r.manualFileName), typeof r.regexRule == "string" && (b.regexRule = Pe(r.regexRule).rule), typeof r.restartAlwaysFromBeginning == "boolean" && (b.restartAlwaysFromBeginning = r.restartAlwaysFromBeginning), typeof r.selectorRule == "string" && (b.selectorRule = Me(r.selectorRule).rule), typeof r.trimExtraMediaHeaders == "boolean" && (b.trimExtraMediaHeaders = r.trimExtraMediaHeaders), Je(), o || wt(), i();
    }
  }, "installed";
}
const co = /* @__PURE__ */ new Set(["m3u8", "mpd"]), lo = /* @__PURE__ */ new Set([
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
]), uo = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), fo = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), mo = /* @__PURE__ */ new Set(["key", "base64key"]), po = /* @__PURE__ */ new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
]), lt = /* @__PURE__ */ new Map(), Ee = /* @__PURE__ */ new Map();
let dr = !1, at = null;
function Ue() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function ft(t) {
  const e = String(t || "").trim();
  if (!e)
    return null;
  const o = lt.get(e);
  if (o)
    return o;
  const a = Ue();
  return lt.set(e, a), a;
}
function Ke(t) {
  const e = String(t || "").trim();
  return e && lt.get(e) || null;
}
function Rt(t, e) {
  if (!t)
    return "";
  const o = e.toLowerCase();
  for (const [a, d] of Object.entries(t))
    if (a.toLowerCase() === o)
      return Array.isArray(d) ? String(d[0] || "") : String(d || "");
  return "";
}
function mt(t) {
  var e;
  return ((e = String(t || "").split(";")[0]) == null ? void 0 : e.trim().toLowerCase()) || "";
}
function kt(t) {
  try {
    const o = new URL(t).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (o == null ? void 0 : o[1]) || "";
  } catch {
    const e = String(t || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (e == null ? void 0 : e[1]) || "";
  }
}
function Or(t) {
  const e = mt(t.mimeType), o = kt(t.url);
  return co.has(o) || e.includes("mpegurl") || e.includes("dash+xml") ? "manifest" : lo.has(o) || e.startsWith("video/") || e.startsWith("audio/") || t.resourceType === "media" || String(t.url || "").startsWith("blob:") ? "media" : uo.has(o) || e.startsWith("image/") ? "image" : fo.has(o) || e.includes("text/vtt") ? "subtitle" : o === "pdf" || e === "application/pdf" ? "document" : mo.has(o) || t.resourceType === "key" || e === "application/octet-stream" ? "key" : "other";
}
function Dr(t) {
  return !t.url || t.url.startsWith("data:") ? !1 : t.kind !== "other" ? !0 : t.resourceType === "media" || t.url.startsWith("blob:");
}
function Ur(t, e, o, a) {
  return a ? `${t}::${e}::${a}` : `${t}::${e}::${o}`;
}
function go(t, e, o, a) {
  return Ur(t, e, o, a);
}
function yo(t) {
  return Array.from(t.values()).sort((e, o) => o.capturedAt - e.capturedAt);
}
function de(t) {
  return {
    deepCaptureEnabled: t.deepCaptureEnabled,
    enabled: t.enabled,
    resources: yo(t.resources)
  };
}
function Pr(t, e) {
  const o = Ke(t);
  if (!(o != null && o.enabled))
    return null;
  const a = String(e.url || "").trim();
  if (!a)
    return null;
  const d = String(e.resourceKey || "").trim() || void 0, f = Ur(t, e.source, a, d), g = o.resources.get(f), v = {
    ...g,
    ...e,
    ext: e.ext || (g == null ? void 0 : g.ext) || kt(a) || void 0,
    id: go(t, e.source, a, d),
    kind: e.kind,
    resourceKey: d,
    tabId: t,
    url: a
  };
  return JSON.stringify(g) !== JSON.stringify(v) ? (o.resources.set(f, v), at == null || at(v), v) : g || null;
}
function ho(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? e : void 0;
}
function wo(t) {
  const e = String(t || "").trim();
  if (!e)
    return;
  const o = e.match(/\/(\d+)\s*$/);
  if (!(o != null && o[1]))
    return;
  const a = Number(o[1]);
  return Number.isFinite(a) && a > 0 ? a : void 0;
}
function kr(t) {
  if (t.streamType)
    return t.streamType;
  const e = mt(t.mimeType);
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
function bo(t) {
  if (!t)
    return;
  const e = {};
  return Object.entries(t).forEach(([o, a]) => {
    const d = o.toLowerCase();
    if (!po.has(d))
      return;
    const f = String(a || "").trim();
    f && (e[d] = f);
  }), Object.keys(e).length ? e : void 0;
}
function So(t) {
  const e = Ke(t);
  return de(e || Ue());
}
function Eo(t) {
  const e = ft(t);
  return e ? (e.enabled = !0, de(e)) : de(Ue());
}
function vo(t) {
  const e = ft(t);
  return e ? (e.enabled = !0, e.deepCaptureEnabled = !0, de(e)) : de(Ue());
}
function To(t) {
  const e = ft(t);
  return e ? (e.enabled = !1, e.deepCaptureEnabled = !1, de(e)) : de(Ue());
}
function Ro(t) {
  const e = ft(t);
  return e ? (e.resources.clear(), de(e)) : de(Ue());
}
function fr(t) {
  lt.delete(String(t || "").trim());
}
function Co(t) {
  var e;
  return !!((e = Ke(t)) != null && e.deepCaptureEnabled);
}
function Bo(t, e) {
  const o = Ke(t);
  if (!(o != null && o.enabled) || !o.deepCaptureEnabled)
    return null;
  const a = String(e.url || "").trim();
  if (!a)
    return null;
  const d = e.kind || Or({
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    url: a
  });
  return Dr({ kind: d, resourceType: e.resourceType, url: a }) ? Pr(t, {
    capturedAt: Number(e.capturedAt) || Date.now(),
    contentLength: e.contentLength,
    ext: e.ext,
    kind: d,
    method: e.method,
    mimeType: mt(e.mimeType),
    pageUrl: e.pageUrl,
    resourceType: e.resourceType,
    resourceKey: e.resourceKey,
    source: e.source || "probe",
    statusCode: e.statusCode,
    streamType: kr({
      mimeType: e.mimeType,
      resourceType: e.resourceType,
      streamType: e.streamType,
      url: a
    }),
    url: a
  }) : null;
}
function xo(t) {
  dr || (dr = !0, at = t.emitResource, t.browserSession.webRequest.onBeforeSendHeaders((e, o) => {
    Ee.set(e.id, {
      referer: e.referrer || void 0,
      requestHeaders: bo(e.requestHeaders)
    }), o({ cancel: !1, requestHeaders: e.requestHeaders });
  }), t.browserSession.webRequest.onCompleted((e) => {
    if (!e.webContentsId) {
      Ee.delete(e.id);
      return;
    }
    const o = t.resolveTabIdByWebContentsId(e.webContentsId), a = o ? Ke(o) : null;
    if (!o || !(a != null && a.enabled)) {
      Ee.delete(e.id);
      return;
    }
    if (e.statusCode < 200 || e.statusCode >= 400) {
      Ee.delete(e.id);
      return;
    }
    const d = sn.fromId(e.webContentsId), f = String(e.url || "").trim(), g = Ee.get(e.id), v = mt(Rt(e.responseHeaders, "content-type")), B = Or({
      mimeType: v,
      resourceType: e.resourceType,
      url: f
    });
    if (!Dr({ kind: B, resourceType: e.resourceType, url: f })) {
      Ee.delete(e.id);
      return;
    }
    Pr(o, {
      capturedAt: Date.now(),
      contentLength: wo(Rt(e.responseHeaders, "content-range")) || ho(Rt(e.responseHeaders, "content-length")),
      ext: kt(f) || void 0,
      kind: B,
      method: e.method || void 0,
      mimeType: v,
      pageUrl: (d == null ? void 0 : d.getURL()) || void 0,
      referer: (g == null ? void 0 : g.referer) || e.referrer || void 0,
      requestHeaders: g == null ? void 0 : g.requestHeaders,
      resourceType: e.resourceType || void 0,
      source: "network",
      statusCode: e.statusCode || void 0,
      streamType: kr({
        mimeType: v,
        resourceType: e.resourceType,
        url: f
      }),
      url: f
    }), Ee.delete(e.id);
  }), t.browserSession.webRequest.onErrorOccurred((e) => {
    Ee.delete(e.id);
  }));
}
const _o = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((t) => !!t);
function Mt(t) {
  return String(t || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function Mo(t) {
  if (!t || t === "ffmpeg")
    return !1;
  try {
    return await yn(t, un.X_OK), !0;
  } catch {
    return !1;
  }
}
async function Oo(t) {
  return new Promise((e) => {
    const o = Sr(t, ["-version"], {
      stdio: "ignore"
    });
    o.once("error", () => e(!1)), o.once("exit", (a) => e(a === 0));
  });
}
async function Do(t) {
  const e = [
    String(t || "").trim() || void 0,
    ..._o
  ].filter((o, a, d) => !!o && d.indexOf(o) === a);
  for (const o of e) {
    if (o === "ffmpeg") {
      if (await Oo(o))
        return o;
      continue;
    }
    if (await Mo(o))
      return o;
  }
  return null;
}
function Uo(t) {
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
function Po(t, e) {
  const o = Mt(R.parse(t).name), a = Mt(R.parse(e).name);
  return `${o.replace(/-video$/i, "").replace(/_video$/i, "") || a.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function ko() {
  return mn(R.join(wn.tmpdir(), "omniflow-resource-merge-"));
}
async function Lo(t) {
  t && await gn(t, {
    force: !0,
    recursive: !0
  });
}
async function mr(t, e) {
  const o = R.join(t, Mt(e.fileName));
  return await pn(o, br.from(e.base64, "base64")), o;
}
async function Ao(t) {
  const e = await Do(t.ffmpegPath);
  if (!e)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const o = await ko();
  try {
    const [a, d] = await Promise.all([
      mr(o, t.audio),
      mr(o, t.video)
    ]), f = Uo({
      audioPath: a,
      outputPath: t.outputPath,
      videoPath: d
    });
    return await new Promise((v, B) => {
      const S = [], C = [], x = Sr(e, f, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      x.stdout.on("data", (E) => {
        S.push(String(E));
      }), x.stderr.on("data", (E) => {
        C.push(String(E));
      }), x.once("error", (E) => {
        B(E);
      }), x.once("exit", (E) => {
        if (E === 0) {
          v({
            commandArgs: f,
            ffmpegPath: e,
            outputPath: t.outputPath,
            stderr: C.join(""),
            stdout: S.join("")
          });
          return;
        }
        B(new Error(C.join("").trim() || `ffmpeg 退出码异常: ${E}`));
      });
    });
  } finally {
    await Lo(o).catch(() => {
    });
  }
}
const Fo = "embedded-browser-open-files", pr = 'input[data-omniflow-browser-open-fallback="true"]';
function Lr() {
  return R.join($.getPath("userData"), Fo);
}
function Wo() {
  const t = Lr();
  return dt(t) || Ot(t, { recursive: !0 }), t;
}
function No(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function $o(t, e) {
  const o = R.resolve(t), a = R.resolve(e);
  return o === a ? !0 : o.startsWith(`${a}${R.sep}`);
}
async function Io(t) {
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
async function zo(t, e, o) {
  var v;
  if (!e || o.length === 0)
    return !1;
  try {
    t.webContents.debugger.isAttached() || t.webContents.debugger.attach("1.3");
  } catch (B) {
    if (!String(B).includes("Already attached"))
      throw B;
  }
  const a = await t.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), d = Number(((v = a == null ? void 0 : a.root) == null ? void 0 : v.nodeId) || 0);
  if (!Number.isFinite(d) || d <= 0)
    return !1;
  const f = await t.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: d,
    selector: e
  }), g = Number((f == null ? void 0 : f.nodeId) || 0);
  return !Number.isFinite(g) || g <= 0 ? !1 : (await t.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: g,
    files: o
  }), !0);
}
async function Ho(t, e) {
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
async function jo(t, e, o = {}) {
  const a = Wo(), d = R.join(a, No(e));
  return await Ut(t, d, o), d;
}
async function ot(t) {
  const e = R.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const o = R.resolve(Lr());
  return $o(e, o) ? (await ct.rm(e, { force: !0 }), !0) : !1;
}
async function Vo(t, e) {
  if (!t || t.webContents.isDestroyed())
    return !1;
  const o = await Io(t);
  return !o || !await zo(t, o, [e]) ? !1 : Ho(t, o);
}
function Ko(t) {
  const e = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map(), g = /* @__PURE__ */ new Map(), v = /* @__PURE__ */ new Map(), B = /* @__PURE__ */ new Map();
  let S = null, C = null, x = !1;
  function E(s) {
    F.log("[embedded-browser:main]", s);
    const i = t.getMainWindow();
    !i || i.isDestroyed() || i.webContents.send("embedded-browser:state", s);
  }
  function _(s) {
    const i = t.getMainWindow();
    !i || i.isDestroyed() || i.webContents.send("embedded-browser:download", s);
  }
  function P(s) {
    const i = t.getMainWindow();
    !i || i.isDestroyed() || i.webContents.send("embedded-browser:resource", s);
  }
  function W(s) {
    for (const [i, l] of e.entries())
      if (l.webContents === s)
        return i;
    return null;
  }
  function oe(s) {
    for (const [i, l] of e.entries())
      if (l.webContents.id === s)
        return i;
    return null;
  }
  function X(s) {
    const i = String(s || "").trim();
    if (!i)
      return "";
    try {
      return new URL(i).origin;
    } catch {
      return "";
    }
  }
  function Z(s) {
    return s === "fileSystem";
  }
  async function Be(s) {
    const i = X(s);
    if (!i)
      return !1;
    const l = B.get(i);
    if (typeof l == "boolean")
      return l;
    const u = j.getFocusedWindow() ?? t.getMainWindow() ?? j.getAllWindows()[0] ?? void 0, { response: p } = await ue.showMessageBox(u, {
      type: "question",
      buttons: ["拒绝", "允许"],
      defaultId: 1,
      cancelId: 0,
      title: "允许网页访问本地目录",
      message: `${i} 想要访问你选择的本地目录。`,
      detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
      noLink: !0
    }), y = p === 1;
    return B.set(i, y), y;
  }
  async function ie(s) {
    const i = X(s.origin);
    if (!i)
      return "deny";
    const l = j.getFocusedWindow() ?? t.getMainWindow() ?? j.getAllWindows()[0] ?? void 0, { response: u } = await ue.showMessageBox(l, {
      type: "question",
      buttons: ["换个目录", "允许这次访问", "拒绝"],
      defaultId: 0,
      cancelId: 2,
      title: "网页请求访问受限路径",
      message: `${i} 想要访问受限路径。`,
      detail: String(s.path || ""),
      noLink: !0
    });
    return u === 0 ? "tryAgain" : u === 1 ? "allow" : "deny";
  }
  function qe() {
    if (x)
      return;
    x = !0;
    const s = He.fromPartition(ze);
    s.setPermissionRequestHandler((i, l, u, p) => {
      if (!Z(String(l))) {
        u(!1);
        return;
      }
      Be(p.requestingUrl || "").then((y) => {
        u(y);
      }).catch(() => {
        u(!1);
      });
    }), s.on("file-system-access-restricted", (i, l, u) => {
      i.preventDefault(), ie(l).then((p) => {
        u(p);
      }).catch(() => {
        u("deny");
      });
    });
  }
  function Y() {
    Zn({
      emitDownload: _,
      resolveTabIdByWebContents: W
    }), xo({
      browserSession: He.fromPartition(ze),
      emitResource: P,
      resolveTabIdByWebContentsId: oe
    });
  }
  async function se(s) {
    if (!t.debugEnabled || s.webContents.isDestroyed())
      return [];
    try {
      const i = await s.webContents.executeJavaScript(`
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
      `, !0), l = [];
      return i != null && i.title && l.push(`title=${i.title}`), i != null && i.readyState && l.push(`readyState=${i.readyState}`), typeof (i == null ? void 0 : i.bodyHtmlLength) == "number" && l.push(`bodyHtml=${i.bodyHtmlLength}`), typeof (i == null ? void 0 : i.innerWidth) == "number" && typeof (i == null ? void 0 : i.innerHeight) == "number" && l.push(`viewport=${i.innerWidth}x${i.innerHeight}`), typeof (i == null ? void 0 : i.clientWidth) == "number" && typeof (i == null ? void 0 : i.clientHeight) == "number" && l.push(`client=${i.clientWidth}x${i.clientHeight}`), typeof (i == null ? void 0 : i.devicePixelRatio) == "number" && l.push(`dpr=${i.devicePixelRatio}`), i != null && i.bodyTextPreview && l.push(`preview=${i.bodyTextPreview}`), i != null && i.userAgent && l.push(`ua=${i.userAgent}`), l;
    } catch (i) {
      return [`inspect=${i instanceof Error ? i.message : String(i)}`];
    }
  }
  function Q(s) {
    const i = s.webContents.getTitle().trim();
    if (i)
      return i;
  }
  function ae(s, i) {
    const l = s.trim();
    if (!l)
      return "";
    if (l.startsWith("data:"))
      return l;
    try {
      return new URL(l, i || void 0).toString();
    } catch {
      return l;
    }
  }
  function Te(s, i) {
    var p;
    const l = (p = String(i || "").split(";")[0]) == null ? void 0 : p.trim();
    if (l != null && l.startsWith("image/"))
      return l;
    const u = (() => {
      try {
        return new URL(s).pathname.toLowerCase();
      } catch {
        return s.toLowerCase();
      }
    })();
    return u.endsWith(".svg") ? "image/svg+xml" : u.endsWith(".ico") ? "image/x-icon" : u.endsWith(".webp") ? "image/webp" : u.endsWith(".jpg") || u.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  }
  async function fe(s, i) {
    if (!i || i.startsWith("data:"))
      return i;
    try {
      const l = await s.fetch(i);
      if (!l.ok)
        return "";
      const u = br.from(await l.arrayBuffer());
      return u.length === 0 ? "" : `data:${Te(i, l.headers.get("content-type"))};base64,${u.toString("base64")}`;
    } catch (l) {
      return F.warn("embedded browser favicon load failed", {
        error: l instanceof Error ? l.message : String(l),
        iconUrl: i
      }), "";
    }
  }
  function N(s, i) {
    return fe(s.webContents.session, i);
  }
  function k(s, i) {
    const l = [], u = /<link\b[^>]*>/gi, p = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let y;
    for (; y = u.exec(s); ) {
      const w = y[0], U = /* @__PURE__ */ new Map();
      let A;
      for (p.lastIndex = 0; A = p.exec(w); )
        U.set(A[1].toLowerCase(), A[2] || A[3] || A[4] || "");
      const L = U.get("rel") || "", q = U.get("href") || "";
      if (!q || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(L))
        continue;
      const O = ae(q, i);
      O && l.push(O);
    }
    return l;
  }
  async function V(s) {
    const i = String((s == null ? void 0 : s.pageUrl) || "").trim(), l = He.fromPartition(ze), u = [], p = ae(String((s == null ? void 0 : s.iconUrl) || ""), i || void 0);
    if (p && !p.startsWith("data:") && u.push(p), i) {
      try {
        const w = await l.fetch(i), U = w.headers.get("content-type") || "";
        w.ok && /text\/html|application\/xhtml\+xml/i.test(U) && u.push(...k(await w.text(), i));
      } catch (w) {
        F.warn("embedded browser favicon page inspect failed", {
          error: w instanceof Error ? w.message : String(w),
          pageUrl: i
        });
      }
      try {
        const w = new URL(i).origin;
        u.push(`${w}/favicon.ico`);
      } catch {
      }
    }
    const y = /* @__PURE__ */ new Set();
    for (const w of u) {
      if (!w || y.has(w))
        continue;
      y.add(w);
      const U = await fe(l, w);
      if (U)
        return {
          dataUrl: U,
          iconUrl: w
        };
    }
    return {
      dataUrl: p.startsWith("data:") ? p : "",
      iconUrl: ""
    };
  }
  function b(s, i, l) {
    E({
      canGoBack: i.webContents.canGoBack(),
      canGoForward: i.webContents.canGoForward(),
      iconSourceUrl: l.iconSourceUrl ?? d.get(s),
      iconUrl: l.iconUrl ?? a.get(s),
      tabId: s,
      title: l.title ?? Q(i),
      ...l
    });
  }
  function xe(s, i, l) {
    b(s, i, {
      state: "ready",
      url: (l == null ? void 0 : l.url) ?? (o.get(s) || i.webContents.getURL() || void 0),
      ...l
    });
  }
  function K(s) {
    const i = e.get(s);
    return !i || i.webContents.isDestroyed() ? (e.delete(s), o.delete(s), a.delete(s), d.delete(s), fr(s), null) : i;
  }
  async function _e(s, i) {
    if (!Co(s) || i.webContents.isDestroyed())
      return !1;
    try {
      return await i.webContents.executeJavaScript(ao(), !0), !0;
    } catch (l) {
      return F.warn("embedded browser resource probe install failed", {
        error: l instanceof Error ? l.message : String(l),
        tabId: s,
        url: i.webContents.getURL() || o.get(s) || ""
      }), !1;
    }
  }
  async function ee(s, i) {
    const l = String(s || "").trim();
    if (!l)
      return null;
    const u = K(l);
    return !u || u.webContents.isDestroyed() ? null : i((y) => u.webContents.executeJavaScript(y, !0), u);
  }
  async function Re(s, i) {
    const l = String(s || "").trim(), u = String(i.audioResourceKey || "").trim(), p = String(i.videoResourceKey || "").trim();
    if (!l || !u || !p)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const y = await ee(
        l,
        async (Xe) => Promise.all([
          ur(Xe, u),
          ur(Xe, p)
        ])
      ), [w, U] = y || [];
      if (!w || !U)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const A = String(i.suggestedFileName || "").trim() || Po(U.fileName, w.fileName), L = t.getMainWindow(), q = L && !L.isDestroyed() ? L : void 0, O = {
        defaultPath: R.join($.getPath("downloads"), A),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, me = q ? await ue.showSaveDialog(q, O) : await ue.showSaveDialog(O);
      if (me.canceled || !me.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const Ge = await Ao({
        audio: w,
        ffmpegPath: i.ffmpegPath,
        outputPath: me.filePath,
        video: U
      });
      return {
        ffmpegPath: Ge.ffmpegPath,
        ok: !0,
        outputPath: Ge.outputPath
      };
    } catch (y) {
      return F.warn("embedded browser resource merge failed", {
        audioResourceKey: u,
        error: y instanceof Error ? y.message : String(y),
        tabId: l,
        videoResourceKey: p
      }), {
        error: y instanceof Error ? y.message : String(y),
        ok: !1
      };
    }
  }
  function he(s) {
    const i = f.get(s);
    i != null && i.stagedPath && ot(i.stagedPath).catch(() => {
    }), f.delete(s);
    const l = g.get(s);
    l && ot(l).catch(() => {
    }), g.delete(s);
  }
  function ce(s) {
    const i = (v.get(s) ?? 0) + 1;
    return v.set(s, i), i;
  }
  function Me(s, i) {
    return v.get(s) === i;
  }
  function Pe(s, i) {
    try {
      const l = new URL(s), u = new URL(i);
      if (l.origin !== u.origin)
        return !1;
      const p = l.pathname.replace(/\/+$/, "") || "/", y = u.pathname.replace(/\/+$/, "") || "/";
      return y === "/" ? !0 : p === y || p.startsWith(`${y}/`);
    } catch {
      return !1;
    }
  }
  async function Oe(s, i) {
    const l = f.get(s);
    if (!l || i.webContents.isDestroyed())
      return !1;
    const u = i.webContents.getURL() || o.get(s) || "";
    if (!u || !Pe(u, l.pageUrl))
      return !1;
    try {
      if (!await Vo(i, l.stagedPath))
        return !1;
      const y = g.get(s);
      return y && y !== l.stagedPath && ot(y).catch(() => {
      }), g.set(s, l.stagedPath), f.delete(s), !0;
    } catch {
      return !1;
    }
  }
  function Je(s) {
    s.setBounds(C ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function we(s) {
    if (!S)
      return;
    const i = K(S);
    if (!i) {
      S = null;
      return;
    }
    s.contentView.children.includes(i) && s.contentView.removeChildView(i), S = null;
  }
  function ke(s) {
    const i = t.getMainWindow();
    if (!i || i.isDestroyed())
      return null;
    const l = K(s);
    if (l)
      return l;
    const u = new an({
      webPreferences: {
        devTools: !0,
        partition: ze
      }
    });
    u.webContents.setZoomFactor(1);
    const p = u.webContents.getUserAgent();
    return p.includes("Electron") && u.webContents.setUserAgent(
      p.replace(/\sElectron\/[^\s]+/g, "")
    ), Je(u), e.set(s, u), u.webContents.on("did-start-loading", () => {
      b(s, u, {
        details: "did-start-loading",
        state: "loading",
        url: u.webContents.getURL() || o.get(s) || void 0
      });
    }), u.webContents.on("dom-ready", () => {
      _e(s, u);
    }), u.webContents.on("did-stop-loading", async () => {
      if (u.webContents.isDestroyed())
        return;
      const y = u.webContents.getURL() || "";
      o.set(s, y), await Oe(s, u);
      const w = await se(u);
      b(s, u, {
        details: "did-stop-loading",
        ...w.length ? { meta: w } : {},
        state: "ready",
        url: y || void 0
      });
    }), u.webContents.on("did-navigate", (y, w) => {
      o.set(s, w), b(s, u, { details: "did-navigate", state: "ready", url: w }), Oe(s, u);
    }), u.webContents.on("did-navigate-in-page", (y, w) => {
      o.set(s, w), b(s, u, { details: "did-navigate-in-page", state: "ready", url: w }), Oe(s, u);
    }), u.webContents.on("page-title-updated", (y, w) => {
      b(s, u, {
        details: "page-title-updated",
        state: "ready",
        title: w || void 0,
        url: o.get(s) || u.webContents.getURL() || void 0
      });
    }), u.webContents.on("page-favicon-updated", (y, w) => {
      const U = o.get(s) || u.webContents.getURL() || void 0, A = w.map((L) => ae(String(L || ""), U)).find((L) => L.trim()) || "";
      A && N(u, A).then((L) => {
        !L || u.webContents.isDestroyed() || (d.set(s, A), a.set(s, L), b(s, u, {
          details: "page-favicon-updated",
          iconSourceUrl: A,
          iconUrl: L,
          state: "ready",
          url: o.get(s) || u.webContents.getURL() || void 0
        }));
      });
    }), u.webContents.on("did-fail-load", (y, w, U, A) => {
      w !== -3 && b(s, u, {
        details: `did-fail-load(${w})`,
        state: "error",
        message: `页面加载失败：${U || "未知错误"}`,
        url: A
      });
    }), u.webContents.on("render-process-gone", (y, w) => {
      b(s, u, {
        details: `render-process-gone:${w.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${w.reason}`,
        url: o.get(s) || u.webContents.getURL() || void 0
      });
    }), u.webContents.on("console-message", (y, w, U, A, L) => {
      if (typeof U == "string" && U.startsWith(_t)) {
        const q = U.slice(_t.length);
        try {
          const O = JSON.parse(q);
          Bo(s, {
            capturedAt: Number(O.capturedAt) || Date.now(),
            contentLength: typeof O.contentLength == "number" ? O.contentLength : void 0,
            ext: typeof O.ext == "string" ? O.ext : void 0,
            kind: typeof O.kind == "string" ? O.kind : void 0,
            mimeType: typeof O.mimeType == "string" ? O.mimeType : void 0,
            pageUrl: typeof O.pageUrl == "string" ? O.pageUrl : void 0,
            resourceKey: typeof O.resourceKey == "string" ? O.resourceKey : void 0,
            resourceType: typeof O.resourceType == "string" ? O.resourceType : void 0,
            source: "probe",
            streamType: O.streamType === "audio" || O.streamType === "video" ? O.streamType : void 0,
            url: typeof O.url == "string" ? O.url : ""
          });
        } catch (O) {
          F.warn("embedded browser resource payload parse failed", {
            error: O instanceof Error ? O.message : String(O),
            tabId: s
          });
        }
        return;
      }
      t.debugEnabled && w >= 2 && b(s, u, {
        details: `console:${L}:${A}`,
        state: "ready",
        message: U,
        meta: [`console-level=${w}`],
        url: o.get(s) || u.webContents.getURL() || void 0
      });
    }), u.webContents.setWindowOpenHandler(({ url: y }) => (u.webContents.loadURL(y), { action: "deny" })), u;
  }
  function Ce(s, i, l = {}) {
    if (!s || s.isDestroyed())
      return null;
    if (!i)
      return we(s), null;
    const p = l.createIfMissing ?? !1 ? ke(i) : K(i);
    return p ? (S && S !== i && we(s), Je(p), s.contentView.children.includes(p) || s.contentView.addChildView(p), S = i, p) : (we(s), null);
  }
  async function Le(s, i, l, u, p = !1) {
    if (!s || s.isDestroyed())
      return;
    const y = String(i || "").trim();
    if (!y)
      return;
    const w = Ce(s, y, { createIfMissing: !0 });
    if (!w || w.webContents.isDestroyed())
      return;
    const U = String(l || "").trim();
    if (!U) {
      b(y, w, {
        state: "ready",
        title: Q(w) || "新标签页",
        url: o.get(y) || void 0
      });
      return;
    }
    const A = o.get(y) || w.webContents.getURL();
    if (p && A === U) {
      b(y, w, {
        state: "ready",
        url: A || void 0
      });
      return;
    }
    b(y, w, {
      details: "load-url",
      state: "loading",
      url: U
    });
    try {
      await w.webContents.loadURL(U);
    } catch (L) {
      const q = L instanceof Error ? L.message : String(L);
      if (q.includes("ERR_ABORTED"))
        return;
      throw b(y, w, {
        details: u,
        state: "error",
        message: `页面加载失败：${q}`,
        url: U
      }), L;
    }
  }
  function Ae(s, i) {
    if (!s || s.isDestroyed())
      return;
    const l = String(i || "").trim();
    if (!l)
      return;
    const u = K(l);
    u && (s.contentView.children.includes(u) && s.contentView.removeChildView(u), S === l && (S = null), e.delete(l), o.delete(l), a.delete(l), d.delete(l), fr(l), ce(l), he(l), u.webContents.isDestroyed() || u.webContents.close({ waitForBeforeUnload: !1 }));
  }
  function Fe() {
    D.handle("embedded-browser:open-tab", async (s, i, l) => {
      const u = j.fromWebContents(s.sender) ?? t.getMainWindow();
      ce(String(i || "").trim()), he(String(i || "").trim());
      const p = String(l || "").trim();
      if (!p) {
        E({
          canGoBack: !1,
          canGoForward: !1,
          state: "ready",
          tabId: i,
          title: "新标签页"
        });
        return;
      }
      await Le(u, i, p, "open-exception", !0);
    }), D.handle("embedded-browser:activate-tab", (s, i) => {
      const l = j.fromWebContents(s.sender) ?? t.getMainWindow();
      Ce(l, i, { createIfMissing: !1 });
    }), D.handle("embedded-browser:navigate", async (s, i, l) => {
      const u = j.fromWebContents(s.sender) ?? t.getMainWindow(), p = String(i || "").trim();
      ce(p), he(p), await Le(u, p, l, "navigate-exception");
    }), D.handle("embedded-browser:resolve-favicon", async (s, i) => V(i)), D.handle("embedded-browser:open-mapped-file", async (s, i, l, u, p) => {
      const y = j.fromWebContents(s.sender) ?? t.getMainWindow(), w = String(i || "").trim(), U = String(l || "").trim(), A = String(u || "").trim(), L = String(p || "").trim() || "file";
      if (!w || !U || !A)
        return;
      const q = ce(w);
      he(w);
      const O = await jo(A, L);
      if (!Me(w, q)) {
        ot(O).catch(() => {
        });
        return;
      }
      if (f.set(w, {
        fileName: L,
        pageUrl: U,
        stagedPath: O
      }), await Le(y, w, U, "navigate-exception"), !Me(w, q))
        return;
      const me = K(w);
      me && Oe(w, me);
    }), D.handle("embedded-browser:reload", async (s, i) => {
      const l = String(i || "").trim();
      if (!l)
        return;
      const u = K(l);
      !u || u.webContents.isDestroyed() || (b(l, u, {
        details: "reload",
        state: "loading",
        url: o.get(l) || u.webContents.getURL() || void 0
      }), u.webContents.reload(), xe(l, u, {
        details: "reload-requested"
      }));
    }), D.handle("embedded-browser:go-back", async (s, i) => {
      const l = String(i || "").trim();
      if (!l)
        return;
      const u = K(l);
      !u || u.webContents.isDestroyed() || (u.webContents.canGoBack() && u.webContents.goBack(), xe(l, u, {
        details: "history-back"
      }));
    }), D.handle("embedded-browser:go-forward", async (s, i) => {
      const l = String(i || "").trim();
      if (!l)
        return;
      const u = K(l);
      !u || u.webContents.isDestroyed() || (u.webContents.canGoForward() && u.webContents.goForward(), xe(l, u, {
        details: "history-forward"
      }));
    }), D.handle("embedded-browser:resource:list", (s, i) => So(String(i || "").trim())), D.handle("embedded-browser:resource:start", (s, i) => Eo(String(i || "").trim())), D.handle("embedded-browser:resource:stop", (s, i) => To(String(i || "").trim())), D.handle("embedded-browser:resource:clear", (s, i) => Ro(String(i || "").trim())), D.handle("embedded-browser:resource:open", async (s, i, l) => ee(i, async (u, p) => {
      try {
        return await lr(u, "openResource", l);
      } catch (y) {
        return F.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: y instanceof Error ? y.message : String(y),
          resourceKey: String(l || "").trim(),
          tabId: String(i || "").trim(),
          url: p.webContents.getURL() || o.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((u) => !!u)), D.handle("embedded-browser:resource:export", async (s, i, l) => ee(i, async (u, p) => {
      try {
        return await lr(u, "exportResource", l);
      } catch (y) {
        return F.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: y instanceof Error ? y.message : String(y),
          resourceKey: String(l || "").trim(),
          tabId: String(i || "").trim(),
          url: p.webContents.getURL() || o.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((u) => !!u)), D.handle("embedded-browser:resource:preview", async (s, i, l) => ee(i, async (u) => {
      try {
        return await so(u, l);
      } catch (p) {
        return F.warn("embedded browser network resource preview failed", {
          error: p instanceof Error ? p.message : String(p),
          tabId: String(i || "").trim(),
          url: String(l.url || "").trim()
        }), !1;
      }
    }).then((u) => !!u)), D.handle("embedded-browser:resource:catch-toolkit:get-state", async (s, i) => ee(i, async (l, u) => {
      try {
        return await to(l);
      } catch (p) {
        return F.warn("embedded browser catch toolkit get state failed", {
          error: p instanceof Error ? p.message : String(p),
          tabId: String(i || "").trim(),
          url: u.webContents.getURL() || o.get(String(i || "").trim()) || ""
        }), null;
      }
    })), D.handle(
      "embedded-browser:resource:catch-toolkit:update-state",
      async (s, i, l) => ee(i, async (u, p) => {
        try {
          return await ro(u, l);
        } catch (y) {
          return F.warn("embedded browser catch toolkit update state failed", {
            error: y instanceof Error ? y.message : String(y),
            payload: l,
            tabId: String(i || "").trim(),
            url: p.webContents.getURL() || o.get(String(i || "").trim()) || ""
          }), null;
        }
      })
    ), D.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (s, i) => ee(i, async (l, u) => {
      try {
        return await Tt(l, "clearCatchMediaCache");
      } catch (p) {
        return F.warn("embedded browser catch toolkit clear cache failed", {
          error: p instanceof Error ? p.message : String(p),
          tabId: String(i || "").trim(),
          url: u.webContents.getURL() || o.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l)), D.handle("embedded-browser:resource:catch-toolkit:download", async (s, i) => ee(i, async (l, u) => {
      try {
        return await Tt(l, "downloadCatchMedia");
      } catch (p) {
        return F.warn("embedded browser catch toolkit download failed", {
          error: p instanceof Error ? p.message : String(p),
          tabId: String(i || "").trim(),
          url: u.webContents.getURL() || o.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l)), D.handle("embedded-browser:resource:catch-toolkit:restart", async (s, i) => ee(i, async (l, u) => {
      try {
        return await Tt(l, "restartCatchMediaCapture");
      } catch (p) {
        return F.warn("embedded browser catch toolkit restart failed", {
          error: p instanceof Error ? p.message : String(p),
          tabId: String(i || "").trim(),
          url: u.webContents.getURL() || o.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l)), D.handle(
      "embedded-browser:resource:merge-mse",
      async (s, i, l) => Re(i, l)
    ), D.handle("embedded-browser:resource:start-deep-capture", async (s, i) => {
      const l = String(i || "").trim(), u = vo(l), p = K(l);
      return p && !p.webContents.isDestroyed() && (p.webContents.getURL() ? p.webContents.reload() : await _e(l, p)), u;
    }), D.handle("embedded-browser:set-bounds", (s, i) => {
      const l = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      }, u = j.fromWebContents(s.sender) ?? t.getMainWindow(), p = u && !u.isDestroyed() ? Math.max(u.webContents.getZoomFactor(), 0.01) : 1;
      if (l.x = Math.max(0, Math.round(i.x * p)), l.y = Math.max(0, Math.round(i.y * p)), l.width = Math.max(0, Math.round(i.width * p)), l.height = Math.max(0, Math.round(i.height * p)), C = l, !S)
        return;
      const y = K(S);
      y && y.setBounds(l);
    }), D.handle("embedded-browser:close-tab", (s, i) => {
      const l = j.fromWebContents(s.sender) ?? t.getMainWindow();
      Ae(l, i);
    }), D.handle("embedded-browser:cleanup-download-file", async (s, i) => {
      try {
        return await xr(i);
      } catch {
        return !1;
      }
    }), D.handle("embedded-browser:deactivate", (s) => {
      const i = j.fromWebContents(s.sender) ?? t.getMainWindow();
      !i || i.isDestroyed() || we(i);
    }), D.handle("embedded-browser:close-all", (s) => {
      const i = j.fromWebContents(s.sender) ?? t.getMainWindow();
      !i || i.isDestroyed() || (Array.from(e.keys()).forEach((l) => {
        Ae(i, l);
      }), S = null, E({ state: "idle" }));
    });
  }
  return {
    configureSession: qe,
    initializeBridges: Y,
    registerIpcHandlers: Fe
  };
}
const qo = 240;
function Jo(t) {
  D.on("window-minimize", (e) => {
    const o = j.fromWebContents(e.sender) ?? t.getMainWindow();
    o == null || o.minimize();
  }), D.on("window-maximize", (e) => {
    const o = j.fromWebContents(e.sender) ?? t.getMainWindow();
    !o || o.isDestroyed() || (o.isMaximized() ? o.unmaximize() : o.maximize());
  }), D.on("window-close", (e) => {
    const o = j.fromWebContents(e.sender) ?? t.getMainWindow();
    o == null || o.close();
  }), D.handle("window-activate", (e, o = !1) => {
    const a = j.fromWebContents(e.sender) ?? t.getMainWindow();
    return !a || a.isDestroyed() ? !1 : (a.isMinimized() && a.restore(), a.isVisible() || a.show(), process.platform === "darwin" ? $.focus({ steal: !0 }) : $.focus(), typeof a.moveTop == "function" && a.moveTop(), a.focus(), o && !a.isAlwaysOnTop() && (a.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      a.isDestroyed() || a.setAlwaysOnTop(!1);
    }, qo)), !0);
  });
}
const Go = R.dirname(ln(import.meta.url));
process.env.APP_ROOT = R.join(Go, "..");
const ut = process.env.VITE_DEV_SERVER_URL, Xo = R.join(process.env.APP_ROOT, "dist-electron"), Ar = R.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ut ? R.join(process.env.APP_ROOT, "public") : Ar;
const gr = R.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Zo = "Omniflow", Yo = "omniflow-app", Qo = 1400, ei = 920, Lt = 600, At = 400, ti = "window-state.json", ri = 200, ni = process.env.NODE_ENV === "test" || !!(ut || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", oi = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
oi || ($.commandLine.appendSwitch("disable-logging"), $.commandLine.appendSwitch("log-level", "3"));
$.setName(Zo);
try {
  const t = R.join($.getPath("appData"), Yo);
  $.setPath("userData", t);
} catch {
}
function Fr() {
  return dt(gr) ? gr : null;
}
let I = null, Wr = !1, it = null;
function Nr() {
  return R.join($.getPath("userData"), ti);
}
function ve(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function ii(t, e) {
  return t >= Lt && e >= At;
}
function si(t) {
  return cn.getAllDisplays().some((o) => {
    const a = o.workArea;
    return t.x < a.x + a.width && t.x + t.width > a.x && t.y < a.y + a.height && t.y + t.height > a.y;
  });
}
function ai() {
  try {
    const t = Nr();
    if (!dt(t))
      return null;
    const e = dn(t, "utf-8"), o = JSON.parse(e);
    if (!ve(o.width) || !ve(o.height) || !ii(o.width, o.height))
      return null;
    const a = !!o.maximized, d = {
      width: o.width,
      height: o.height,
      maximized: a
    };
    return ve(o.x) && ve(o.y) && (d.x = o.x, d.y = o.y), ve(d.x) && ve(d.y) && (si({
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height
    }) || (delete d.x, delete d.y)), d;
  } catch {
    return null;
  }
}
function Ft(t) {
  if (!t.isDestroyed())
    try {
      const e = t.isMaximized() ? t.getNormalBounds() : t.getBounds(), o = {
        x: e.x,
        y: e.y,
        width: Math.max(Math.round(e.width), Lt),
        height: Math.max(Math.round(e.height), At),
        maximized: t.isMaximized()
      }, a = Nr();
      Ot(R.dirname(a), { recursive: !0 }), fn(a, JSON.stringify(o), "utf-8");
    } catch {
    }
}
function st(t) {
  it && clearTimeout(it), it = setTimeout(() => {
    it = null, Ft(t);
  }, ri);
}
function ci(t) {
  if (t.type !== "keyDown")
    return !1;
  const e = (t.key || "").toLowerCase();
  return (t.meta || t.control) && t.shift && e === "i";
}
function li(t) {
  if (t.type !== "keyDown" || !(t.meta || t.control))
    return !1;
  const e = (t.key || "").toLowerCase();
  return e === "+" || e === "=" || e === "-" || e === "_" || e === "0";
}
const Ct = Ko({
  debugEnabled: ni,
  getMainWindow: () => I
});
function $r() {
  if (I && !I.isDestroyed())
    return I.show(), I.focus(), I;
  const t = Fr(), e = ai(), o = (e == null ? void 0 : e.width) ?? Qo, a = (e == null ? void 0 : e.height) ?? ei, d = new j({
    width: o,
    height: a,
    minWidth: Lt,
    minHeight: At,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...ve(e == null ? void 0 : e.x) && ve(e == null ? void 0 : e.y) ? { x: e.x, y: e.y } : {},
    webPreferences: {
      preload: R.join(Xo, "preload.mjs"),
      devTools: !0
    },
    autoHideMenuBar: !0,
    ...t ? { icon: t } : {}
  });
  return I = d, e != null && e.maximized && d.maximize(), d.on("move", () => {
    st(d);
  }), d.on("resize", () => {
    st(d);
  }), d.on("maximize", () => {
    st(d);
  }), d.on("unmaximize", () => {
    st(d);
  }), d.on("close", (f) => {
    Ft(d), process.platform === "darwin" && !Wr && (f.preventDefault(), d.hide());
  }), d.on("closed", () => {
    I === d && (I = null);
  }), d.webContents.setZoomFactor(1), d.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), d.webContents.on("before-input-event", (f, g) => {
    if (li(g)) {
      f.preventDefault();
      return;
    }
    ci(g) && (f.preventDefault(), d.webContents.toggleDevTools());
  }), d.on("app-command", (f, g) => {
    (g === "browser-backward" || g === "browser-forward") && f.preventDefault();
  }), d.on("swipe", (f, g) => {
    (g === "left" || g === "right") && f.preventDefault();
  }), ut ? d.loadURL(ut) : d.loadFile(R.join(Ar, "index.html")), d;
}
$.on("before-quit", () => {
  Wr = !0, I && !I.isDestroyed() && Ft(I);
});
$.on("window-all-closed", () => {
  process.platform !== "darwin" && $.quit();
});
$.on("activate", () => {
  if (I && !I.isDestroyed()) {
    I.isMinimized() && I.restore(), I.show(), I.focus();
    return;
  }
  j.getAllWindows().length === 0 && $r();
});
$.whenReady().then(() => {
  const t = Fr();
  t && process.platform === "darwin" && $.dock.setIcon(t), Ct.configureSession(), Ct.initializeBridges(), Vn(), Jo({
    getMainWindow: () => I
  }), Ct.registerIpcHandlers(), $r();
});
export {
  Xo as MAIN_DIST,
  Ar as RENDERER_DIST,
  ut as VITE_DEV_SERVER_URL
};
