import { dialog as ie, app as N, net as wn, ipcMain as U, session as Oe, webContents as bn, BrowserWindow as z, screen as Sn, WebContentsView as En } from "electron";
import { Buffer as gr } from "node:buffer";
import { fileURLToPath as vn } from "node:url";
import B from "node:path";
import ht, { existsSync as Xe, mkdirSync as Et, constants as Tn, readFileSync as Rn, writeFileSync as Cn } from "node:fs";
import $ from "fs/promises";
import qe, { mkdtemp as Bn, writeFile as xn, rm as _n, access as On } from "node:fs/promises";
import yr from "node:http";
import hr from "node:https";
import wr from "os";
import vt from "child_process";
import Dn from "fs";
import { spawn as br } from "node:child_process";
import Mn from "node:os";
const Ne = 6e4;
async function Tt(t, e, o = {}, c = 0) {
  const m = new URL(t);
  if (m.protocol !== "http:" && m.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${m.protocol}`);
  const y = m.protocol === "https:" ? hr : yr;
  await qe.mkdir(B.dirname(e), { recursive: !0 }), await new Promise((v, x) => {
    let w = !1;
    const R = () => {
      w || (w = !0, v());
    }, S = (C) => {
      w || (w = !0, x(C));
    }, b = y.request({
      protocol: m.protocol,
      hostname: m.hostname,
      port: m.port ? Number(m.port) : void 0,
      path: `${m.pathname}${m.search}`,
      method: "GET",
      headers: o
    }, (C) => {
      C.setTimeout(Ne, () => {
        C.destroy(new Error(`下载响应超时: ${Ne}ms`));
      });
      const k = Number(C.statusCode || 0), L = C.headers.location;
      if (k >= 300 && k < 400 && L) {
        if (C.resume(), c >= 3) {
          S(new Error(`下载重定向次数过多: ${t}`));
          return;
        }
        const J = new URL(L, t).toString();
        Tt(J, e, o, c + 1).then(R).catch(S);
        return;
      }
      if (k >= 400) {
        C.resume(), S(new Error(`下载失败: HTTP ${k} (${t})`));
        return;
      }
      const H = ht.createWriteStream(e), q = async (J) => {
        try {
          H.destroy();
        } catch {
        }
        try {
          await qe.rm(e, { force: !0 });
        } catch {
        }
        S(J);
      };
      C.on("error", (J) => {
        q(J);
      }), H.on("error", (J) => {
        q(J);
      }), H.on("finish", () => R()), C.pipe(H);
    });
    b.setTimeout(Ne, () => {
      b.destroy(new Error(`下载请求超时: ${Ne}ms`));
    }), b.on("error", (C) => S(C)), b.end();
  });
}
const Un = "Omniflow Inbox", Pn = 10 * 60 * 1e3, kn = 2, Ln = 2e3, wt = 12, An = B.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), Be = /* @__PURE__ */ new Map();
function Rt(t) {
  const e = String(t || "");
  return !!(!e || e === ".DS_Store" || e.startsWith("._") || e === "Thumbs.db");
}
function xe(t) {
  return t.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Fn(t) {
  const e = String(t || "").toLowerCase();
  return !e || e.startsWith(".") ? !0 : e.endsWith(".crdownload") || e.endsWith(".part") || e.endsWith(".tmp") || e.endsWith(".opdownload") || e.endsWith(".download");
}
function Sr() {
  return B.join(N.getPath("userData"), "auto-import-staging");
}
function Nn() {
  return B.join(N.getPath("userData"), "embedded-browser-downloads");
}
function Er(t, e) {
  const o = B.resolve(t), c = B.resolve(e);
  return o === c ? !0 : o.startsWith(`${c}${B.sep}`);
}
function $n(t) {
  const e = String(t || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
async function Wn(t, e) {
  try {
    await $.rename(t, e);
  } catch (o) {
    if ((o == null ? void 0 : o.code) !== "EXDEV")
      throw o;
    await $.copyFile(t, e), await $.rm(t, { force: !0 });
  }
}
function In(t) {
  const e = Date.now();
  for (const [o, c] of Be.entries())
    t.has(o) || e - c.lastSeenAt <= Pn || Be.delete(o);
}
async function zn(t, e = wt) {
  const o = String(t || "").trim(), c = o ? B.resolve(o) : B.join(N.getPath("downloads"), Un), u = await $.stat(c).catch(() => null);
  if (!(u != null && u.isDirectory()))
    return [];
  const m = await $.readdir(c, { withFileTypes: !0 }), y = /* @__PURE__ */ new Set(), v = Date.now(), x = [];
  for (const b of m) {
    if (!b.isFile() || Rt(b.name) || Fn(b.name)) continue;
    const C = B.join(c, b.name), k = await $.stat(C).catch(() => null);
    if (!(k != null && k.isFile())) continue;
    y.add(C);
    const L = Be.get(C), q = (L ? L.size === k.size && L.mtimeMs === k.mtimeMs : !1) && L ? L.stableCount + 1 : 1;
    Be.set(C, {
      size: k.size,
      mtimeMs: k.mtimeMs,
      stableCount: q,
      lastSeenAt: v
    }), !(q < kn) && (v - k.mtimeMs < Ln || x.push({
      sourcePath: C,
      name: b.name,
      size: k.size,
      mtimeMs: k.mtimeMs
    }));
  }
  if (In(y), x.length === 0)
    return [];
  x.sort((b, C) => b.mtimeMs - C.mtimeMs);
  const w = Sr();
  await $.mkdir(w, { recursive: !0 });
  const R = [], S = Math.max(1, Math.floor(Number(e) || wt));
  for (const b of x.slice(0, S)) {
    const C = B.join(w, $n(b.name));
    try {
      await Wn(b.sourcePath, C);
    } catch {
      continue;
    }
    Be.delete(b.sourcePath), R.push({
      name: b.name,
      size: b.size,
      localPath: C,
      relativePath: xe(b.name)
    });
  }
  return R;
}
async function Hn(t) {
  const e = B.resolve(String(t || "").trim()), o = Sr();
  return !e || !Er(e, o) ? !1 : (await $.rm(e, { force: !0 }), !0);
}
function er(t, e) {
  const o = xe(e || "");
  if (!o)
    return t;
  const c = o.split("/").filter(Boolean);
  for (const u of c) {
    if (u === "." || u === "..")
      throw new Error(`非法下载路径片段: ${u}`);
    if (u.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return B.join(t, ...c);
}
function vr(t, e) {
  return t.relativePath.localeCompare(e.relativePath, "zh-Hans-CN");
}
async function jn(t) {
  return (await Promise.all(t.map(async (o) => {
    const c = await $.stat(o);
    if (!c.isFile())
      return null;
    const u = B.basename(o);
    return Rt(u) ? null : {
      name: u,
      size: c.size,
      localPath: o,
      relativePath: xe(u)
    };
  }))).filter((o) => !!o).sort(vr);
}
async function Vn(t, e, o) {
  const c = [e], u = [];
  for (; c.length > 0; ) {
    const R = c.pop(), S = await $.readdir(R, { withFileTypes: !0 });
    for (const b of S) {
      if (b.name === "." || b.name === ".." || Rt(b.name) || b.isSymbolicLink())
        continue;
      const C = B.join(R, b.name);
      if (b.isDirectory()) {
        c.push(C);
        continue;
      }
      b.isFile() && u.push({
        absolutePath: C,
        name: b.name
      });
    }
  }
  const m = [], y = 48;
  let v = 0;
  const x = async () => {
    for (; v < u.length; ) {
      const R = v;
      if (v += 1, R >= u.length)
        return;
      const S = u[R], b = await $.stat(S.absolutePath).catch(() => null);
      if (!(b != null && b.isFile()))
        continue;
      const C = xe(B.relative(t, S.absolutePath)), k = xe(B.join(o, C));
      m.push({
        name: S.name,
        size: b.size,
        localPath: S.absolutePath,
        relativePath: k
      });
    }
  }, w = Math.min(y, Math.max(1, u.length));
  return await Promise.all(Array.from({ length: w }, () => x())), m;
}
async function Kn(t) {
  const e = [];
  for (const o of t) {
    if (!(await $.stat(o)).isDirectory())
      continue;
    const u = B.basename(o), m = await Vn(o, o, u);
    e.push(...m);
  }
  return e.sort(vr);
}
function qn(t) {
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
    const o = e.filePaths[0];
    return {
      canceled: !1,
      content: await $.readFile(o, "utf-8"),
      filePath: o
    };
  }), t.handle("file:save", async (e, o, c) => (await $.writeFile(o, c, "utf-8"), !0)), t.handle("file:read-text", async (e, o) => {
    const c = B.resolve(String(o || "").trim());
    return {
      canceled: !1,
      content: await $.readFile(c, "utf-8"),
      filePath: c
    };
  }), t.handle("file:read-local-chrome-bookmarks", async () => {
    const e = B.join(N.getPath("home"), An);
    return {
      canceled: !1,
      content: await $.readFile(e, "utf-8"),
      filePath: e
    };
  }), t.handle("dialog:pick-upload-files", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await jn(e.filePaths) };
  }), t.handle("dialog:pick-upload-folders", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Kn(e.filePaths) };
  }), t.handle("dialog:pick-download-directory", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("dialog:save-download-file", async (e, o) => {
    const c = await ie.showSaveDialog({
      defaultPath: String(o || "download"),
      showsTagField: !1
    });
    return c.canceled || !c.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: c.filePath };
  }), t.handle("dialog:pick-auto-import-directory", async () => {
    const e = await ie.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("fs:claim-auto-import-files", async (e, o, c = wt) => ({ canceled: !1, files: await zn(o, c) })), t.handle("fs:cleanup-auto-import-staged-file", async (e, o) => {
    try {
      return await Hn(o);
    } catch {
      return !1;
    }
  }), t.handle("fs:ensure-directory", async (e, o, c = "") => {
    const u = er(o, c);
    return await $.mkdir(u, { recursive: !0 }), u;
  }), t.handle("fs:download-url-to-path", async (e, o, c, u, m = {}) => {
    const y = er(c, u);
    return await Tt(o, y, m), y;
  }), t.handle("fs:save-staged-download-file", async (e, o, c) => {
    const u = B.resolve(String(o || "").trim()), m = B.resolve(String(c || "").trim()), y = Nn();
    if (!u || !Er(u, y))
      throw new Error("无效的下载临时文件");
    if (!m)
      throw new Error("无效的保存路径");
    return await $.mkdir(B.dirname(m), { recursive: !0 }), await $.copyFile(u, m), m;
  });
}
var j = {}, de = wr;
j.platform = function() {
  return process.platform;
};
j.cpuCount = function() {
  return de.cpus().length;
};
j.sysUptime = function() {
  return de.uptime();
};
j.processUptime = function() {
  return process.uptime();
};
j.freemem = function() {
  return de.freemem() / (1024 * 1024);
};
j.totalmem = function() {
  return de.totalmem() / (1024 * 1024);
};
j.freememPercentage = function() {
  return de.freemem() / de.totalmem();
};
j.freeCommand = function(t) {
  vt.exec("free -m", function(e, o, c) {
    var u = o.split(`
`), m = u[1].replace(/[\s\n\r]+/g, " "), y = m.split(" ");
    total_mem = parseFloat(y[1]), free_mem = parseFloat(y[3]), buffers_mem = parseFloat(y[5]), cached_mem = parseFloat(y[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), t(used_mem - 2);
  });
};
j.harddrive = function(t) {
  vt.exec("df -k", function(e, o, c) {
    var u = 0, m = 0, y = 0, v = o.split(`
`), x = v[1].replace(/[\s\n\r]+/g, " "), w = x.split(" ");
    u = Math.ceil(w[1] * 1024 / Math.pow(1024, 2)), m = Math.ceil(w[2] * 1024 / Math.pow(1024, 2)), y = Math.ceil(w[3] * 1024 / Math.pow(1024, 2)), t(u, y, m);
  });
};
j.getProcesses = function(t, e) {
  typeof t == "function" && (e = t, t = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", t > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (t + 1)), vt.exec(command, function(o, c, u) {
    var m = c.split(`
`);
    m.shift(), m.pop();
    var y = "";
    m.forEach(function(v, x) {
      var w = v.replace(/[\s\n\r]+/g, " ");
      w = w.split(" "), y += w[1] + " " + w[2] + " " + w[3] + " " + w[4].substring(w[4].length - 25) + `
`;
    }), e(y);
  });
};
j.allLoadavg = function() {
  var t = de.loadavg();
  return t[0].toFixed(4) + "," + t[1].toFixed(4) + "," + t[2].toFixed(4);
};
j.loadavg = function(t) {
  (t === void 0 || t !== 5 && t !== 15) && (t = 1);
  var e = de.loadavg(), o = 0;
  return t == 1 && (o = e[0]), t == 5 && (o = e[1]), t == 15 && (o = e[2]), o;
};
j.cpuFree = function(t) {
  Tr(t, !0);
};
j.cpuUsage = function(t) {
  Tr(t, !1);
};
function Tr(t, e) {
  var o = tr(), c = o.idle, u = o.total;
  setTimeout(function() {
    var m = tr(), y = m.idle, v = m.total, x = y - c, w = v - u, R = x / w;
    t(e === !0 ? R : 1 - R);
  }, 1e3);
}
function tr(t) {
  var e = de.cpus(), o = 0, c = 0, u = 0, m = 0, y = 0, x = 0;
  for (var v in e)
    o += e[v].times.user, c += e[v].times.nice, u += e[v].times.sys, y += e[v].times.irq, m += e[v].times.idle;
  var x = o + c + u + m + y;
  return {
    idle: m,
    total: x
  };
}
const Jn = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", Re = (t, ...e) => {
  Jn && console[t](...e);
}, F = {
  debug: (...t) => Re("debug", ...t),
  info: (...t) => Re("info", ...t),
  log: (...t) => Re("log", ...t),
  warn: (...t) => Re("warn", ...t),
  error: (...t) => Re("error", ...t)
};
function Gn() {
  const t = Xn().total, e = wr.cpus()[0].model, o = Math.floor(j.totalmem() / 1024);
  return {
    totalStorage: t,
    cpuModel: e,
    totalMemoryGB: o
  };
}
function Xn() {
  const t = Dn.statfsSync(process.platform === "win32" ? "C:" : "/"), e = t.blocks * t.bsize, o = t.bfree * t.bsize;
  return {
    total: Math.floor(e / 1e9),
    // 换算为 GB
    usage: 1 - o / e
    // 使用率计算
  };
}
function Zn(t) {
  t.handle("sys:get-static-data", Gn);
}
const Yn = 10 * 1024 * 1024 * 1024, Qn = "10GB", eo = `上传失败：单文件最大支持 ${Qn}`;
function Rr(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function to(t) {
  return encodeURIComponent(t).replace(
    /['()*]/g,
    (e) => `%${e.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function ro(t) {
  const e = Rr(t), o = to(t);
  return `Content-Disposition: form-data; name="file"; filename="${e}"; filename*=UTF-8''${o}\r
`;
}
function no(t) {
  const e = /* @__PURE__ */ new Map(), o = (c, u = !1) => {
    const m = Date.now();
    if (!u && m - c.lastProgressAt < 80) return;
    c.lastProgressAt = m;
    const y = Math.max(m - c.startedAt, 1), v = Math.floor(c.uploadedBytes * 1e3 / y), x = c.totalBytes > 0 ? Math.min(c.uploadedBytes / c.totalBytes * 100, 100) : 0;
    c.sender.send("http:upload:progress", {
      uploadId: c.uploadId,
      uploadedBytes: c.uploadedBytes,
      totalBytes: c.totalBytes,
      percentage: x,
      speedBps: v
    });
  };
  t.handle("http:fetch", async (c, u, m = {}) => (F.debug("http:fetch start"), F.debug("http:fetch URL:", u), F.debug("http:fetch options:", m), new Promise((y, v) => {
    const x = wn.request({ url: u, method: m.method || "GET" });
    m.headers && Object.entries(m.headers).forEach(([R, S]) => {
      F.debug(`http:fetch set header ${R}: ${String(S)}`), x.setHeader(R, S);
    });
    let w = "";
    x.on("response", (R) => {
      F.debug("http:fetch response"), F.debug("http:fetch status:", R.statusCode), F.debug("http:fetch headers:", R.headers), R.on("data", (S) => {
        F.debug(`http:fetch chunk length: ${S.length}`), w += S;
      }), R.on("end", () => {
        F.debug("http:fetch body preview:", w.slice(0, 500));
        let S;
        try {
          S = JSON.parse(w);
        } catch {
          S = w;
        }
        y({
          status: R.statusCode,
          headers: R.headers,
          body: S
        });
      });
    }), x.on("error", (R) => {
      F.error("http:fetch error:", R), v(R);
    }), m.body && x.write(m.body), x.end();
  }))), t.handle("http:upload:abort", async (c, u) => {
    const m = e.get(u);
    if (!m) return !1;
    m.aborted = !0, e.delete(u);
    try {
      m.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      m.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), t.handle("http:upload", async (c, u, m, y = {}, v = {}, x) => new Promise((w, R) => {
    let S;
    try {
      S = ht.statSync(m);
    } catch (f) {
      R(new Error(`读取上传文件失败: ${m} (${String(f)})`));
      return;
    }
    if (!S.isFile()) {
      R(new Error(`上传目标不是文件: ${m}`));
      return;
    }
    if (S.size > Yn) {
      R(new Error(eo));
      return;
    }
    const b = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), C = x || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, k = B.basename(m), L = Object.entries(y).map(([f, g]) => `--${b}\r
Content-Disposition: form-data; name="${Rr(f)}"\r
\r
${g}\r
`).join(""), H = `--${b}\r
` + ro(k) + `Content-Type: application/octet-stream\r
\r
`, q = `\r
--${b}--\r
`, J = Buffer.byteLength(L) + Buffer.byteLength(H) + S.size + Buffer.byteLength(q), ae = {
      ...v,
      "Content-Type": `multipart/form-data; boundary=${b}`,
      "Content-Length": String(J)
    }, ee = new URL(u), G = (ee.protocol === "https:" ? hr : yr).request({
      protocol: ee.protocol,
      hostname: ee.hostname,
      port: ee.port ? Number(ee.port) : void 0,
      path: `${ee.pathname}${ee.search}`,
      method: "POST",
      headers: ae
    }), re = ht.createReadStream(m, {
      highWaterMark: 1024 * 1024
    }), V = {
      uploadId: C,
      request: G,
      fileStream: re,
      sender: c.sender,
      totalBytes: Math.max(0, S.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    e.set(C, V);
    let ce = !1;
    const l = (f) => {
      ce || (ce = !0, e.delete(C), w(f));
    }, s = (f) => {
      ce || (ce = !0, e.delete(C), R(f));
    };
    let i = "";
    G.on("response", (f) => {
      f.on("data", (g) => {
        i += g.toString();
      }), f.on("end", () => {
        let g;
        try {
          g = JSON.parse(i);
        } catch {
          g = i;
        }
        l({
          status: f.statusCode,
          body: g
        });
      });
    }), G.on("error", (f) => {
      if (V.aborted) {
        s(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        re.destroy(f);
      } catch {
      }
      s(f);
    }), G.write(L), G.write(H), re.on("data", (f) => {
      V.aborted || (V.uploadedBytes += f.length, o(V));
    }), re.on("end", () => {
      V.aborted || (o(V, !0), G.write(q), G.end());
    }), re.on("error", (f) => {
      if (V.aborted) {
        s(new Error("UPLOAD_ABORTED"));
        return;
      }
      s(f);
      try {
        G.destroy(f);
      } catch {
      }
    }), re.pipe(G, { end: !1 });
  }));
}
function oo() {
  qn(U), Zn(U), no(U);
}
const _e = "persist:omniflow-embedded-browser", io = "embedded-browser-downloads";
let mt = null, rr = !1;
function Cr() {
  return B.join(N.getPath("userData"), io);
}
function so() {
  const t = Cr();
  return Xe(t) || Et(t, { recursive: !0 }), t;
}
function ao() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function co(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function $e(t, e) {
  var o, c;
  return {
    downloadId: e.downloadId,
    fileName: e.fileName,
    mimeType: e.mimeType,
    pageUrl: e.pageUrl,
    receivedBytes: e.receivedBytes ?? Math.max(0, Number(((o = t.getReceivedBytes) == null ? void 0 : o.call(t)) || 0)),
    state: e.state,
    tabId: e.tabId,
    tempPath: e.tempPath,
    totalBytes: e.totalBytes ?? Math.max(0, Number(((c = t.getTotalBytes) == null ? void 0 : c.call(t)) || 0)),
    url: e.url,
    ...e.error ? { error: e.error } : {}
  };
}
function lo() {
  return mt || (mt = Oe.fromPartition(_e)), mt;
}
async function Br(t) {
  const e = B.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const o = B.resolve(Cr());
  return e !== o && !e.startsWith(`${o}${B.sep}`) ? !1 : (await qe.rm(e, { force: !0 }), !0);
}
function uo(t) {
  if (rr)
    return;
  rr = !0;
  const e = (u, m, y) => {
    const v = t.resolveTabIdByWebContents(y) || void 0;
    if (!v)
      return;
    const x = so(), w = ao(), R = m.getFilename() || "download", S = m.getURL() || "", b = y.getURL() || void 0, C = B.join(x, co(R));
    m.setSavePath(C), t.emitDownload($e(m, {
      downloadId: w,
      fileName: R,
      mimeType: m.getMimeType() || void 0,
      pageUrl: b,
      state: "started",
      tabId: v,
      tempPath: C,
      url: S
    })), m.on("updated", (k, L) => {
      L === "progressing" && t.emitDownload($e(m, {
        downloadId: w,
        fileName: R,
        mimeType: m.getMimeType() || void 0,
        pageUrl: b,
        state: "progress",
        tabId: v,
        tempPath: C,
        url: S
      }));
    }), m.once("done", (k, L) => {
      if (L === "completed") {
        t.emitDownload($e(m, {
          downloadId: w,
          fileName: R,
          mimeType: m.getMimeType() || void 0,
          pageUrl: b,
          state: "completed",
          tabId: v,
          tempPath: C,
          url: S
        }));
        return;
      }
      Br(C).catch(() => {
      }), t.emitDownload($e(m, {
        downloadId: w,
        error: L === "cancelled" ? "下载已取消" : `下载失败：${L}`,
        fileName: R,
        mimeType: m.getMimeType() || void 0,
        pageUrl: b,
        state: L === "cancelled" ? "cancelled" : "failed",
        tabId: v,
        tempPath: C,
        url: S
      }));
    });
  }, o = /* @__PURE__ */ new Set();
  [Oe.defaultSession, lo()].filter(Boolean).forEach((u) => {
    o.has(u) || (o.add(u), u.on("will-download", e));
  });
}
function fo(t, e) {
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
function mo(t) {
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
function po(t) {
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
async function nr(t, e, o) {
  const c = String(o || "").trim();
  return c ? !!await t(
    fo(e, c)
  ) : !1;
}
async function go(t, e) {
  return String(e.url || "").trim() ? !!await t(
    mo(e)
  ) : !1;
}
async function or(t, e) {
  const o = String(e || "").trim();
  if (!o)
    return null;
  const c = await t(
    po(o)
  );
  if (!c || typeof c != "object")
    return null;
  const u = c;
  return typeof u.base64 != "string" || typeof u.fileName != "string" ? null : {
    base64: u.base64,
    fileName: u.fileName,
    mimeType: typeof u.mimeType == "string" ? u.mimeType : void 0,
    resourceKey: typeof u.resourceKey == "string" ? u.resourceKey : o,
    streamType: u.streamType === "audio" || u.streamType === "video" ? u.streamType : void 0
  };
}
function yo() {
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
function ho(t) {
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
function wo(t) {
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
function xr(t) {
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
async function bo(t) {
  const e = await t(yo());
  return xr(e);
}
async function So(t, e) {
  const o = await t(
    ho(e)
  );
  return xr(o);
}
async function pt(t, e) {
  return !!await t(
    wo(e)
  );
}
const bt = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function Eo() {
  return `(${_r.toString()})(${JSON.stringify(bt)});`;
}
function _r(t) {
  var Gt, Xt, Zt, Yt, Qt;
  const e = globalThis, o = typeof document > "u" && typeof e.importScripts == "function", c = typeof ((Gt = e.location) == null ? void 0 : Gt.href) == "string" ? e.location.href : "", u = typeof ((Xt = e.location) == null ? void 0 : Xt.hostname) == "string" ? e.location.hostname : "resource", m = typeof ((Zt = e.location) == null ? void 0 : Zt.protocol) == "string" ? e.location.protocol : "https:", y = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__", v = typeof e.open == "function" ? e.open.bind(e) : null;
  if (e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)
    return "already-installed";
  const x = /* @__PURE__ */ new Set(), w = /* @__PURE__ */ new Map(), R = /* @__PURE__ */ new Map(), S = /* @__PURE__ */ new Map(), b = /* @__PURE__ */ new WeakMap();
  let C = 0, k = 0;
  const L = /* @__PURE__ */ new Set(["m3u8", "mpd"]), H = /* @__PURE__ */ new Set([
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
  ]), q = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), J = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), ae = /^data:(application|video|audio)\//i, ee = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i, ye = /(m3u8|mpd)(\?|$)/i, G = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv)(\?|$)/i, re = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|$)/i, V = /\.(vtt|srt|ass|ssa|ttml)(\?|$)/i, ce = /\.pdf(\?|$)/i, l = JSON.parse.bind(JSON), s = typeof console.info == "function" ? console.info.bind(console) : console.log.bind(console), i = {
    autoDownloadOnComplete: "OmniflowCatchToolkit:autoDownloadOnComplete",
    autoSeekToBufferedEnd: "OmniflowCatchToolkit:autoSeekToBufferedEnd",
    clearCacheOnComplete: "OmniflowCatchToolkit:clearCacheOnComplete",
    manualFileName: "OmniflowCatchToolkit:manualFileName",
    regexRule: "OmniflowCatchToolkit:regexRule",
    restartAlwaysFromBeginning: "OmniflowCatchToolkit:restartAlwaysFromBeginning",
    selectorRule: "OmniflowCatchToolkit:selectorRule",
    trimExtraMediaHeaders: "OmniflowCatchToolkit:trimExtraMediaHeaders"
  };
  let f = "", g = !1;
  const d = {
    autoSeekToBufferedEnd: !1,
    autoDownloadOnComplete: !1,
    clearCacheOnComplete: !1,
    manualFileName: "",
    regexRule: "",
    restartAlwaysFromBeginning: !1,
    selectorRule: "",
    trimExtraMediaHeaders: !0
  }, T = /* @__PURE__ */ new WeakSet(), M = /* @__PURE__ */ new WeakSet();
  let P = null;
  function W(r) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(r) || "").trim();
    } catch {
      return "";
    }
  }
  function O(r, n = !1) {
    try {
      return typeof localStorage > "u" ? n : localStorage.getItem(r) === "checked";
    } catch {
      return n;
    }
  }
  function X(r, n) {
    try {
      if (typeof localStorage > "u")
        return;
      const a = String(n || "").trim();
      if (!a) {
        localStorage.removeItem(r);
        return;
      }
      localStorage.setItem(r, a);
    } catch {
    }
  }
  function ne(r, n) {
    try {
      if (typeof localStorage > "u")
        return;
      localStorage.setItem(r, n ? "checked" : "");
    } catch {
    }
  }
  function we(r) {
    var a;
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
      const p = document.querySelector(n), h = ((a = p == null ? void 0 : p.textContent) == null ? void 0 : a.trim()) || "";
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
  function Qe(r) {
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
  function Ir() {
    o || (d.autoDownloadOnComplete = O(
      i.autoDownloadOnComplete,
      d.autoDownloadOnComplete
    ), d.autoSeekToBufferedEnd = O(
      i.autoSeekToBufferedEnd,
      d.autoSeekToBufferedEnd
    ), d.clearCacheOnComplete = O(
      i.clearCacheOnComplete,
      d.clearCacheOnComplete
    ), d.manualFileName = W(i.manualFileName), d.restartAlwaysFromBeginning = O(
      i.restartAlwaysFromBeginning,
      d.restartAlwaysFromBeginning
    ), d.trimExtraMediaHeaders = O(
      i.trimExtraMediaHeaders,
      d.trimExtraMediaHeaders
    ), d.selectorRule = we(
      W(i.selectorRule)
    ).rule, d.regexRule = Qe(
      W(i.regexRule)
    ).rule);
  }
  function zr() {
    o || (ne(
      i.autoDownloadOnComplete,
      d.autoDownloadOnComplete
    ), ne(
      i.autoSeekToBufferedEnd,
      d.autoSeekToBufferedEnd
    ), ne(
      i.clearCacheOnComplete,
      d.clearCacheOnComplete
    ), X(
      i.manualFileName,
      d.manualFileName
    ), X(
      i.regexRule,
      d.regexRule
    ), ne(
      i.restartAlwaysFromBeginning,
      d.restartAlwaysFromBeginning
    ), X(
      i.selectorRule,
      d.selectorRule
    ), ne(
      i.trimExtraMediaHeaders,
      d.trimExtraMediaHeaders
    ));
  }
  Ir();
  function et() {
    return typeof document > "u" || typeof document.title != "string" ? "" : document.title.trim();
  }
  function tt() {
    var h, E;
    const r = nt(d.manualFileName);
    if (r !== "media")
      return r;
    let n = "";
    const a = String(d.selectorRule || "").trim();
    if (a && typeof document < "u")
      try {
        const D = document.querySelector(a), I = ((h = D == null ? void 0 : D.textContent) == null ? void 0 : h.trim()) || "";
        I && (n = I);
      } catch {
      }
    const p = String(d.regexRule || "").trim();
    if (p && typeof document < "u")
      try {
        const D = n || ((E = document.documentElement) == null ? void 0 : E.outerHTML) || "";
        if (D) {
          const I = new RegExp(p, "g"), le = Array.from(D.matchAll(I)).flatMap((K) => K.length > 1 ? K.slice(1).filter((ue) => typeof ue == "string" && ue.trim()) : K[0] ? [K[0]] : []);
          le.length > 0 && (n = le.join("_"));
        }
      } catch {
      }
    return nt(n || et() || u || "media");
  }
  function Me(r) {
    if (typeof r != "string")
      return "";
    const n = r.trim();
    if (!n || n.startsWith("data:"))
      return "";
    if (n.startsWith("//"))
      return `${m}${n}`;
    if (n.startsWith("blob:"))
      return n;
    try {
      if (ee.test(n))
        return new URL(n, c).toString();
      if (/^https?:\/\//i.test(n))
        return n;
    } catch {
      return "";
    }
    return "";
  }
  function Hr(r) {
    try {
      const a = (new URL(r, c).pathname || "").toLowerCase().match(/\.([a-z0-9]+)$/i);
      return (a == null ? void 0 : a[1]) || "";
    } catch {
      const n = r.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      return (n == null ? void 0 : n[1]) || "";
    }
  }
  function Ot(r, n) {
    var h;
    const a = Hr(r), p = (h = String(n || "").split(";")[0]) == null ? void 0 : h.trim().toLowerCase();
    return L.has(a) || p.includes("mpegurl") || p.includes("dash+xml") || ye.test(r) ? "manifest" : H.has(a) || p.startsWith("video/") || p.startsWith("audio/") || G.test(r) || r.startsWith("blob:") ? "media" : q.has(a) || p.startsWith("image/") || re.test(r) ? "image" : J.has(a) || p.includes("text/vtt") || V.test(r) ? "subtitle" : a === "pdf" || p === "application/pdf" || ce.test(r) ? "document" : "other";
  }
  function rt(r, n) {
    var p;
    const a = (p = String(r || "").split(";")[0]) == null ? void 0 : p.trim().toLowerCase();
    return a === "audio/mp4" ? "m4a" : a === "video/mp4" ? "mp4" : a === "audio/mpeg" ? "mp3" : a === "audio/aac" ? "aac" : a.endsWith("/webm") ? "webm" : a.endsWith("/ogg") ? "ogg" : a.endsWith("/wav") ? "wav" : n === "audio" ? "m4a" : "mp4";
  }
  function nt(r) {
    return String(r || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "media";
  }
  function Dt() {
    const r = we(d.selectorRule), n = Qe(d.regexRule), a = Array.from(w.values()).reduce((p, h) => p + Math.max(0, Number(h.totalBytes || 0)), 0);
    return {
      autoSeekToBufferedEnd: d.autoSeekToBufferedEnd,
      autoDownloadOnComplete: d.autoDownloadOnComplete,
      capturedMediaSizeBytes: a,
      clearCacheOnComplete: d.clearCacheOnComplete,
      currentFileName: tt(),
      isCaptureComplete: g,
      manualFileName: d.manualFileName,
      regexWarning: n.warning,
      regexRule: n.rule,
      restartAlwaysFromBeginning: d.restartAlwaysFromBeginning,
      selectorWarning: r.warning,
      selectorRule: r.rule,
      streamCount: w.size,
      trimExtraMediaHeaders: d.trimExtraMediaHeaders
    };
  }
  function jr(r) {
    return r instanceof ArrayBuffer ? r.slice(0) : ArrayBuffer.isView(r) ? r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) : null;
  }
  function Ue(r) {
    const n = new Uint8Array(r), a = 32768;
    let p = "";
    for (let h = 0; h < n.length; h += a) {
      const E = n.subarray(h, Math.min(h + a, n.length));
      p += String.fromCharCode(...E);
    }
    return btoa(p);
  }
  function Vr(r) {
    return Ue(new TextEncoder().encode(r).buffer);
  }
  function ot(r) {
    const n = atob(r), a = new Uint8Array(n.length);
    for (let p = 0; p < n.length; p += 1)
      a[p] = n.charCodeAt(p);
    return a.buffer;
  }
  function Kr(r) {
    const n = String(r || "").trim();
    return n.length === 24 && n.endsWith("==") && /^[A-Za-z0-9+/]+={0,2}$/.test(n);
  }
  function qr(r) {
    return /^[A-Fa-f0-9]{32}$/.test(String(r || "").trim());
  }
  function Jr(r) {
    try {
      const a = new URL(r, c).toString().split("/");
      return a.pop(), `${a.join("/")}/`;
    } catch {
      return "";
    }
  }
  function Gr(r, n) {
    return !r || !n ? n : n.split(`
`).map((a) => {
      const p = a.trim();
      if (!p || p.startsWith("#"))
        return p.includes('URI="') ? p.replace(/URI="(.*)"/, (h, E) => Me(E) ? `URI="${E}"` : `URI="${r}${E}"`) : a;
      if (Me(p))
        return p;
      if (p.startsWith("/"))
        try {
          const h = new URL(r);
          return `${h.protocol}//${h.host}${p}`;
        } catch {
          return `${r}${p.replace(/^\//, "")}`;
        }
      return `${r}${p}`;
    }).join(`
`);
  }
  function Xr(r) {
    const n = String(r || "").trim();
    if (!n || !/^[\[{]/.test(n))
      return null;
    try {
      return l(n);
    } catch {
      return null;
    }
  }
  function Zr(r) {
    const n = String(r || "").trim();
    if (!ae.test(n))
      return "";
    const a = n.indexOf(",");
    if (a === -1)
      return "";
    const p = n.slice(0, a), h = n.slice(a + 1);
    try {
      return /;base64/i.test(p) ? new TextDecoder().decode(ot(h)) : decodeURIComponent(h);
    } catch {
      return "";
    }
  }
  function Mt(r, n = 16) {
    if (r.byteLength <= n || r.byteLength % n !== 0)
      return null;
    const a = new Uint8Array(r), p = a.slice(0, n);
    for (let h = n; h < a.length; h += n)
      for (let E = 0; E < n; E += 1)
        if (a[h + E] !== p[E])
          return null;
    return p.buffer;
  }
  function Yr(r) {
    return r.byteLength === 16 ? r.slice(0) : r.byteLength === 32 ? Mt(r, 16) || r.slice(0, 16) : r.byteLength === 128 || r.byteLength === 256 ? Mt(r, 16) : null;
  }
  function Qr() {
    return k += 1, `probe-resource:${Date.now()}-${k}`;
  }
  function en(r, n) {
    const a = r === "key" ? `${et() || u || "resource"}-key` : et() || u || "resource";
    return `${nt(a)}.${n}`;
  }
  function tn(r) {
    const n = S.get(r.signature);
    if (n) {
      const D = R.get(n);
      if (D)
        return {
          contentLength: D.contentLength,
          fileName: D.fileName,
          resourceKey: n,
          url: D.blobUrl
        };
    }
    const a = new Blob([ot(r.base64)], { type: r.mimeType }), p = Qr(), h = en(r.kind, r.ext), E = URL.createObjectURL(a);
    return S.set(r.signature, p), R.set(p, {
      base64: r.base64,
      blobUrl: E,
      contentLength: a.size,
      fileName: h,
      mimeType: r.mimeType,
      streamType: r.streamType
    }), {
      contentLength: a.size,
      fileName: h,
      resourceKey: p,
      url: E
    };
  }
  function it(r) {
    if (!o || typeof e.postMessage != "function")
      return !1;
    try {
      return e.postMessage({ [y]: r }), !0;
    } catch {
      return !1;
    }
  }
  function Ee(r, n = !1) {
    if (o && !n) {
      it({ payload: r, type: "generated-resource" });
      return;
    }
    const a = tn(r);
    ke({
      contentLength: a.contentLength,
      ext: r.ext,
      kind: r.kind,
      mimeType: r.mimeType,
      resourceKey: a.resourceKey,
      resourceType: r.resourceType,
      source: "probe",
      streamType: r.streamType,
      url: a.url
    }, n);
  }
  function fe(r, n = "key") {
    const a = Yr(r);
    if (!a)
      return !1;
    const p = Ue(a);
    return Ee({
      base64: p,
      ext: n,
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${p}`
    }), !0;
  }
  function Pe(r) {
    if (!Kr(r))
      return !1;
    try {
      return ot(r).byteLength !== 16 ? !1 : (Ee({
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
  function Ut(r) {
    const n = String(r || "").trim().toLowerCase();
    if (!qr(n))
      return !1;
    const a = new Uint8Array(16);
    for (let p = 0; p < 16; p += 1)
      a[p] = Number.parseInt(n.slice(p * 2, p * 2 + 2), 16);
    return Ee({
      base64: Ue(a.buffer),
      ext: "key",
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${n}`
    }), !0;
  }
  function st(r, n, a) {
    const p = n === "m3u8" ? Gr(Jr(a || c), r) : r;
    Ee({
      base64: Vr(p),
      ext: n,
      kind: "manifest",
      mimeType: n === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml",
      resourceType: "inline-manifest",
      signature: `${n}:${p}`
    });
  }
  function rn(r) {
    const n = new Uint8Array(r);
    return n.length > 8 && n[4] === 102 && n[5] === 116 && n[6] === 121 && n[7] === 112;
  }
  function nn(r) {
    const n = new Uint8Array(r);
    return n.length > 4 && n[0] === 26 && n[1] === 69 && n[2] === 223 && n[3] === 163;
  }
  function at(r) {
    if (!d.trimExtraMediaHeaders || !Array.isArray(r) || r.length <= 1)
      return r;
    let n = -1;
    return r.forEach((a, p) => {
      (rn(a) || nn(a)) && (n = p);
    }), n > 0 ? r.slice(n) : r;
  }
  function ke(r, n = !1) {
    if (r.url) {
      if (r.resourceType !== "mse-stream") {
        const a = `${r.resourceKey || r.source}:${r.resourceType || "unknown"}:${r.url}`;
        if (x.has(a))
          return;
        x.add(a), x.size > 2e3 && (x.clear(), x.add(a));
      }
      if (o && !n) {
        it({ payload: r, type: "capture" });
        return;
      }
      try {
        s(t + JSON.stringify({
          capturedAt: Date.now(),
          contentLength: r.contentLength,
          ext: r.ext,
          kind: r.kind || Ot(r.url, r.mimeType),
          mimeType: r.mimeType,
          pageUrl: c,
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
  function on(r) {
    const n = r.map((a) => String(a || "").toLowerCase());
    if (n.some((a) => a === "audio" || a.includes("audio")))
      return "audio";
    if (n.some((a) => a === "video" || a.includes("video")))
      return "video";
  }
  function ct(r) {
    if (T.has(r))
      return;
    T.add(r), r.addEventListener("progress", () => {
      if (d.autoSeekToBufferedEnd)
        try {
          if (!r.buffered || r.buffered.length === 0)
            return;
          const p = r.buffered.end(r.buffered.length - 1), h = Math.max(p - 5, 0), E = Number.isFinite(r.duration) ? r.duration : 0;
          if (E > 0 && p >= E)
            return;
          Math.abs(r.currentTime - h) > 1 && (r.currentTime = h);
        } catch {
        }
    });
    const n = () => {
      if (!(!d.restartAlwaysFromBeginning || M.has(r)))
        try {
          M.add(r), be(), r.currentTime = 0;
        } catch {
        }
    };
    r.addEventListener("play", () => {
      n();
    }, { once: !0 });
    const a = window.setInterval(() => {
      if (M.has(r) || !d.restartAlwaysFromBeginning) {
        window.clearInterval(a);
        return;
      }
      r.paused || (n(), window.clearInterval(a));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(a);
    }, 5e3);
  }
  function sn() {
    typeof document > "u" || document.querySelectorAll("video, audio").forEach((r) => {
      r instanceof HTMLMediaElement && ct(r);
    });
  }
  function lt() {
    o || typeof MutationObserver > "u" || P || typeof document > "u" || (sn(), P = new MutationObserver((r) => {
      r.forEach((n) => {
        n.addedNodes.forEach((a) => {
          if (a instanceof Element) {
            if (a instanceof HTMLMediaElement) {
              ct(a);
              return;
            }
            a.querySelectorAll("video, audio").forEach((p) => {
              p instanceof HTMLMediaElement && ct(p);
            });
          }
        });
      });
    }), P.observe(document.body || document.documentElement, {
      childList: !0,
      subtree: !0
    }));
  }
  function be() {
    let r = !1;
    return w.forEach((n) => {
      if (n.blobUrl && (URL.revokeObjectURL(n.blobUrl), n.blobUrl = ""), g) {
        r = r || n.buffers.length > 0, n.buffers = [], n.bufferCount = 0, n.lastReportedBufferCount = 0, n.lastReportedBytes = 0, n.totalBytes = 0, ve(n.streamId);
        return;
      }
      if (n.buffers.length > 1) {
        const a = n.buffers[0];
        n.buffers = a ? [a] : [], n.bufferCount = n.buffers.length, n.totalBytes = (a == null ? void 0 : a.byteLength) || 0, n.lastReportedBufferCount = n.bufferCount, n.lastReportedBytes = n.totalBytes, r = !0, ve(n.streamId);
      }
    }), g = !1, r;
  }
  function Pt() {
    if (typeof document > "u")
      return !1;
    const r = Array.from(w.values()).filter((a) => a.buffers.length > 0);
    if (r.length === 0)
      return !1;
    const n = tt();
    return r.forEach((a) => {
      const p = at(a.buffers), h = new Blob(p, { type: a.mimeType }), E = document.createElement("a"), D = URL.createObjectURL(h), I = rt(a.mimeType, a.streamType), Y = r.length > 1 && a.streamType ? `-${a.streamType}` : "";
      E.href = D, E.download = `${n}${Y}.${I}`, E.click(), E.remove(), setTimeout(() => {
        URL.revokeObjectURL(D);
      }, 1e3);
    }), d.clearCacheOnComplete && setTimeout(() => {
      be();
    }, 0), !0;
  }
  function an() {
    if (typeof document > "u")
      return !1;
    be();
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
  function cn(r) {
    return `mse-stream:${r}`;
  }
  function ve(r) {
    const n = w.get(r);
    n && ke({
      contentLength: n.totalBytes,
      ext: rt(n.mimeType, n.streamType),
      kind: "media",
      mimeType: n.mimeType,
      resourceKey: cn(r),
      resourceType: "mse-stream",
      source: "probe",
      streamType: n.streamType,
      url: n.blobUrl || `mse://capturing/${r}`
    });
  }
  function kt(r) {
    const n = w.get(r);
    if (!n || n.buffers.length === 0)
      return !1;
    n.blobUrl && (URL.revokeObjectURL(n.blobUrl), n.blobUrl = "");
    try {
      const a = at(n.buffers);
      return n.blobUrl = URL.createObjectURL(new Blob(a, { type: n.mimeType })), ve(r), !0;
    } catch {
      return !1;
    }
  }
  function Lt(r) {
    const n = w.get(r);
    return n ? (n.blobUrl || kt(r), n.blobUrl) : "";
  }
  function At(r) {
    const n = w.get(r);
    if (!n)
      return "media.bin";
    const a = tt(), p = n.streamType ? `-${n.streamType}` : "", h = rt(n.mimeType, n.streamType);
    return `${a}${p}.${h}`;
  }
  function ln(r) {
    const n = String(r || "").replace(/^mse-stream:/, ""), a = Lt(n);
    if (!a || typeof document > "u")
      return !1;
    const p = document.createElement("a");
    return p.href = a, p.download = At(n), p.click(), p.remove(), d.clearCacheOnComplete && setTimeout(() => {
      be();
    }, 0), !0;
  }
  function un(r) {
    const n = String(r || "").replace(/^mse-stream:/, ""), a = Lt(n);
    return !a || !v ? !1 : (v(a, "_blank", "noopener,noreferrer"), !0);
  }
  async function dn(r) {
    const n = String(r || "").replace(/^mse-stream:/, ""), a = w.get(n);
    if (!a || a.buffers.length === 0)
      return null;
    try {
      const p = at(a.buffers), E = await new Blob(p, { type: a.mimeType }).arrayBuffer();
      return {
        base64: Ue(E),
        fileName: At(n),
        mimeType: a.mimeType,
        resourceKey: r,
        streamType: a.streamType
      };
    } catch {
      return null;
    }
  }
  function fn(r) {
    const n = R.get(r);
    return !(n != null && n.blobUrl) || !v ? !1 : (v(n.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function mn(r) {
    const n = R.get(r);
    if (!(n != null && n.blobUrl) || typeof document > "u")
      return !1;
    const a = document.createElement("a");
    return a.href = n.blobUrl, a.download = n.fileName, a.click(), a.remove(), !0;
  }
  function pn(r) {
    const n = R.get(r);
    return n ? Promise.resolve({
      base64: n.base64,
      fileName: n.fileName,
      mimeType: n.mimeType,
      resourceKey: r,
      streamType: n.streamType
    }) : Promise.resolve(null);
  }
  function gn(r) {
    if (!r || typeof r != "object")
      return !1;
    const n = r[y];
    return !n || typeof n != "object" || !("type" in n) ? !1 : o ? it(n) : n.type === "capture" ? (ke(n.payload, !0), !0) : n.type === "generated-resource" ? (Ee(n.payload, !0), !0) : !1;
  }
  const ut = e.Worker;
  typeof ut == "function" && (e.Worker = new Proxy(ut, {
    construct(r, n, a) {
      const [p, h] = n, E = () => {
        const Y = typeof p == "string" ? p : String(p), le = Me(Y) || Y;
        if (!le)
          return "";
        const K = `;(${_r.toString()})(${JSON.stringify(t)});
`;
        let ue = "";
        if ((h == null ? void 0 : h.type) === "module")
          ue = `${K}import ${JSON.stringify(le)};
`;
        else {
          const me = new XMLHttpRequest();
          if (me.open("GET", le, !1), me.send(), me.status < 200 || me.status >= 300 || !me.responseText)
            return "";
          ue = `${K}${me.responseText}`;
        }
        return URL.createObjectURL(new Blob([ue], { type: "text/javascript" }));
      };
      let D = "";
      try {
        D = E();
      } catch {
        D = "";
      }
      const I = D ? Reflect.construct(r, [D, h], a) : Reflect.construct(r, n, a);
      return I.addEventListener("message", (Y) => {
        gn(Y.data) && Y.stopImmediatePropagation();
      }, { capture: !0 }), D && setTimeout(() => {
        URL.revokeObjectURL(D);
      }, 6e4), I;
    }
  }), e.Worker.toString = function() {
    return ut.toString();
  });
  const oe = e.MediaSource;
  if ((Yt = oe == null ? void 0 : oe.prototype) != null && Yt.addSourceBuffer) {
    const r = oe.prototype.addSourceBuffer;
    oe.prototype.addSourceBuffer = new Proxy(r, {
      apply(n, a, p) {
        var E;
        const h = Reflect.apply(n, a, p);
        try {
          lt(), g = !1;
          const D = a, I = String((p == null ? void 0 : p[0]) || "").trim(), Y = ((E = I.split(";")[0]) == null ? void 0 : E.trim().toLowerCase()) || "", le = Y.startsWith("audio/") ? "audio" : Y.startsWith("video/") ? "video" : void 0, K = `${Date.now()}-${++C}`, ue = b.get(D) || [];
          if (ue.push(K), b.set(D, ue), w.set(K, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: I || (le === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: K,
            streamType: le,
            totalBytes: 0
          }), ve(K), h && typeof h.appendBuffer == "function") {
            const me = h.appendBuffer;
            h.appendBuffer = new Proxy(me, {
              apply(yn, hn, Ae) {
                const ft = Reflect.apply(yn, hn, Ae), Q = w.get(K);
                if (!Q)
                  return ft;
                const Fe = jr(Ae == null ? void 0 : Ae[0]);
                return !Fe || Fe.byteLength === 0 || (Q.buffers.push(Fe), Q.bufferCount += 1, Q.totalBytes += Fe.byteLength, (Q.bufferCount <= 3 || Q.bufferCount - Q.lastReportedBufferCount >= 8 || Q.totalBytes - Q.lastReportedBytes >= 1024 * 512) && (Q.lastReportedBufferCount = Q.bufferCount, Q.lastReportedBytes = Q.totalBytes, ve(K))), ft;
              }
            });
          }
        } catch {
        }
        return h;
      }
    });
  }
  if ((Qt = oe == null ? void 0 : oe.prototype) != null && Qt.endOfStream) {
    const r = oe.prototype.endOfStream;
    oe.prototype.endOfStream = new Proxy(r, {
      apply(n, a, p) {
        const h = Reflect.apply(n, a, p);
        try {
          if (g = !0, (b.get(a) || []).forEach((D) => {
            kt(D);
          }), d.autoDownloadOnComplete)
            return setTimeout(() => {
              Pt();
            }, 500), h;
          d.clearCacheOnComplete && setTimeout(() => {
            be();
          }, 0);
        } catch {
        }
        return h;
      }
    });
  }
  function Z(r, n) {
    if (typeof r != "string")
      return;
    const a = r.trim();
    if (!a || Pe(a))
      return;
    const p = a.split("").join("").trim();
    if (Ut(p))
      return;
    if (ae.test(a)) {
      const I = Zr(a);
      I && Z(I, n);
      return;
    }
    const h = Xr(a);
    if (h) {
      Te(h);
      return;
    }
    const E = a.toUpperCase();
    if (E.startsWith("#EXTM3U") || E.includes("#EXTINF:")) {
      st(a, "m3u8", n == null ? void 0 : n.baseUrl);
      return;
    }
    if (a.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || a.includes("<MPD") && a.includes("</MPD>")) {
      st(a, "mpd", n == null ? void 0 : n.baseUrl);
      return;
    }
    const D = Me(a);
    D && ke({
      kind: Ot(D, n == null ? void 0 : n.mimeType),
      mimeType: n == null ? void 0 : n.mimeType,
      resourceType: n == null ? void 0 : n.resourceType,
      source: "probe",
      streamType: n == null ? void 0 : n.streamType,
      url: D
    });
  }
  function Te(r, n = 0, a = /* @__PURE__ */ new WeakSet(), p = []) {
    if (n > 6 || r == null)
      return;
    if (r instanceof ArrayBuffer) {
      fe(r);
      return;
    }
    if (ArrayBuffer.isView(r)) {
      fe(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength));
      return;
    }
    if (typeof r == "string") {
      Z(r, {
        baseUrl: c,
        resourceType: "json",
        streamType: on(p)
      });
      return;
    }
    if (typeof r != "object")
      return;
    const h = r;
    if (!a.has(h)) {
      if (a.add(h), Array.isArray(r)) {
        if (r.length === 16 && r.every((E) => typeof E == "number" && Number.isFinite(E) && E >= 0 && E <= 255)) {
          fe(Uint8Array.from(r).buffer);
          return;
        }
        r.slice(0, 80).forEach((E, D) => {
          Te(E, n + 1, a, p.concat(String(D)));
        });
        return;
      }
      Object.keys(r).slice(0, 80).forEach((E) => {
        Te(r[E], n + 1, a, p.concat(E));
      });
    }
  }
  const dt = typeof e.fetch == "function" ? e.fetch.bind(e) : null;
  dt && (e.fetch = async function(r, n) {
    const a = typeof r == "string" ? r : r instanceof Request ? r.url : String(r);
    Z(a, { resourceType: "fetch" });
    const p = await dt(r, n);
    return Z(p.url || a, {
      mimeType: p.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), p.clone().arrayBuffer().then((E) => {
      if (!E.byteLength || fe(E))
        return;
      const D = new TextDecoder().decode(E);
      D.trim() && Z(D, {
        baseUrl: p.url || a,
        mimeType: p.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), p;
  }, e.fetch.toString = function() {
    return dt.toString();
  });
  const Ft = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", Nt = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(r, n) {
    return this[Ft] = typeof n == "string" ? n : String(n), Nt.apply(this, arguments);
  };
  const $t = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const r = this[Ft], n = this.responseURL || (typeof r == "string" ? r : "");
      if (Z(n, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (fe(this.response))
          return;
        const a = new TextDecoder().decode(this.response);
        a && Z(a, {
          baseUrl: n,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        Z(this.response, {
          baseUrl: n,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (this.response && typeof this.response == "object") {
        Te(this.response);
        return;
      }
      typeof this.responseText == "string" && this.responseText.trim() && Z(this.responseText, {
        baseUrl: n,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), $t.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return Nt.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return $t.toString();
  }, JSON.parse = function() {
    const r = l.apply(this, arguments);
    return Te(r), r;
  }, JSON.parse.toString = function() {
    return l.toString();
  };
  const Wt = btoa;
  e.btoa = function(r) {
    const n = Wt.apply(this, arguments);
    return Pe(n), Z(r, { baseUrl: c, resourceType: "btoa" }), n;
  }, btoa.toString = function() {
    return Wt.toString();
  };
  const It = atob;
  e.atob = function(r) {
    const n = It.apply(this, arguments);
    return Pe(r), Z(n, { baseUrl: c, resourceType: "atob" }), n;
  }, atob.toString = function() {
    return It.toString();
  };
  const zt = String.fromCharCode;
  String.fromCharCode = new Proxy(zt, {
    apply(r, n, a) {
      const p = Reflect.apply(r, n, a);
      if (p.length >= 7) {
        if ((p.startsWith("#EXTM3U") || p.includes("#EXTINF:")) && (f += p, f.includes("#EXT-X-ENDLIST"))) {
          const E = f.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          st(E, "m3u8", c), f = "";
        }
        const h = p.split("").join("").trim();
        Ut(h);
      }
      return p;
    }
  }), String.fromCharCode.toString = function() {
    return zt.toString();
  };
  const Ht = Array.prototype.slice;
  Array.prototype.slice = function() {
    const r = Ht.apply(this, arguments);
    return Array.isArray(r) && r.length === 16 && r.every((n) => typeof n == "number" && Number.isFinite(n) && n >= 0 && n <= 255) && fe(Uint8Array.from(r).buffer), r;
  }, Array.prototype.slice.toString = function() {
    return Ht.toString();
  };
  const jt = Array.prototype.join;
  Array.prototype.join = function() {
    const r = jt.apply(this, arguments);
    return typeof r == "string" && ((r.startsWith("#EXTM3U") || r.includes("#EXTINF:")) && Z(r, { baseUrl: c, resourceType: "array-join" }), Pe(r)), r;
  }, Array.prototype.join.toString = function() {
    return jt.toString();
  };
  const Le = e.DataView;
  if (typeof Le == "function") {
    const r = function(n, a, p) {
      const h = new Le(n, a, p), E = () => {
        const D = h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
        fe(D);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((D) => {
        const I = h[D];
        typeof I == "function" && (h[D] = function() {
          const Y = I.apply(this, arguments);
          return E(), Y;
        });
      }), E(), h;
    };
    r.prototype = Le.prototype, r.toString = function() {
      return Le.toString();
    }, e.DataView = r;
  }
  function Vt(r) {
    return function() {
      const n = r.apply(this, arguments);
      return (n == null ? void 0 : n.byteLength) === 16 && fe(n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength)), n;
    };
  }
  const Kt = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = Vt(Kt), Int8Array.prototype.subarray.toString = function() {
    return Kt.toString();
  };
  const qt = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = Vt(qt), Uint8Array.prototype.subarray.toString = function() {
    return qt.toString();
  };
  const Jt = String.prototype.indexOf;
  return String.prototype.indexOf = function(r, n) {
    const a = Jt.apply(this, arguments);
    if (r === "#EXTM3U" && a !== -1) {
      const p = String(this);
      Z(p.slice(Math.max(n ?? 0, 0)), {
        baseUrl: c,
        resourceType: "string-indexof"
      });
    }
    return a;
  }, String.prototype.indexOf.toString = function() {
    return Jt.toString();
  }, o || lt(), e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return be();
    },
    downloadCatchMedia() {
      return Pt();
    },
    exportResource(r) {
      const n = String(r || "");
      return n.startsWith("mse-stream:") ? ln(n) : n.startsWith("probe-resource:") ? mn(n) : !1;
    },
    getCatchToolkitState() {
      return Dt();
    },
    installedAt: Date.now(),
    openResource(r) {
      const n = String(r || "");
      return n.startsWith("mse-stream:") ? un(n) : n.startsWith("probe-resource:") ? fn(n) : !1;
    },
    readResource(r) {
      const n = String(r || "");
      return n.startsWith("mse-stream:") ? dn(n) : n.startsWith("probe-resource:") ? pn(n) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return an();
    },
    seen: x,
    updateCatchToolkitState(r) {
      return typeof r.autoSeekToBufferedEnd == "boolean" && (d.autoSeekToBufferedEnd = r.autoSeekToBufferedEnd), typeof r.autoDownloadOnComplete == "boolean" && (d.autoDownloadOnComplete = r.autoDownloadOnComplete), typeof r.clearCacheOnComplete == "boolean" && (d.clearCacheOnComplete = r.clearCacheOnComplete), typeof r.manualFileName == "string" && (d.manualFileName = r.manualFileName), typeof r.regexRule == "string" && (d.regexRule = Qe(r.regexRule).rule), typeof r.restartAlwaysFromBeginning == "boolean" && (d.restartAlwaysFromBeginning = r.restartAlwaysFromBeginning), typeof r.selectorRule == "string" && (d.selectorRule = we(r.selectorRule).rule), typeof r.trimExtraMediaHeaders == "boolean" && (d.trimExtraMediaHeaders = r.trimExtraMediaHeaders), zr(), o || lt(), Dt();
    }
  }, "installed";
}
const vo = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((t) => !!t);
function St(t) {
  return String(t || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function To(t) {
  if (!t || t === "ffmpeg")
    return !1;
  try {
    return await On(t, Tn.X_OK), !0;
  } catch {
    return !1;
  }
}
async function Ro(t) {
  return new Promise((e) => {
    const o = br(t, ["-version"], {
      stdio: "ignore"
    });
    o.once("error", () => e(!1)), o.once("exit", (c) => e(c === 0));
  });
}
async function Co(t) {
  const e = [
    String(t || "").trim() || void 0,
    ...vo
  ].filter((o, c, u) => !!o && u.indexOf(o) === c);
  for (const o of e) {
    if (o === "ffmpeg") {
      if (await Ro(o))
        return o;
      continue;
    }
    if (await To(o))
      return o;
  }
  return null;
}
function Bo(t) {
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
function xo(t, e) {
  const o = St(B.parse(t).name), c = St(B.parse(e).name);
  return `${o.replace(/-video$/i, "").replace(/_video$/i, "") || c.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function _o() {
  return Bn(B.join(Mn.tmpdir(), "omniflow-resource-merge-"));
}
async function Oo(t) {
  t && await _n(t, {
    force: !0,
    recursive: !0
  });
}
async function ir(t, e) {
  const o = B.join(t, St(e.fileName));
  return await xn(o, gr.from(e.base64, "base64")), o;
}
async function Do(t) {
  const e = await Co(t.ffmpegPath);
  if (!e)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const o = await _o();
  try {
    const [c, u] = await Promise.all([
      ir(o, t.audio),
      ir(o, t.video)
    ]), m = Bo({
      audioPath: c,
      outputPath: t.outputPath,
      videoPath: u
    });
    return await new Promise((v, x) => {
      const w = [], R = [], S = br(e, m, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      S.stdout.on("data", (b) => {
        w.push(String(b));
      }), S.stderr.on("data", (b) => {
        R.push(String(b));
      }), S.once("error", (b) => {
        x(b);
      }), S.once("exit", (b) => {
        if (b === 0) {
          v({
            commandArgs: m,
            ffmpegPath: e,
            outputPath: t.outputPath,
            stderr: R.join(""),
            stdout: w.join("")
          });
          return;
        }
        x(new Error(R.join("").trim() || `ffmpeg 退出码异常: ${b}`));
      });
    });
  } finally {
    await Oo(o).catch(() => {
    });
  }
}
const Mo = /* @__PURE__ */ new Set(["m3u8", "mpd"]), Uo = /* @__PURE__ */ new Set([
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
]), Po = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), ko = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), Lo = /* @__PURE__ */ new Set(["key", "base64key"]), Ao = /* @__PURE__ */ new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
]), Je = /* @__PURE__ */ new Map(), pe = /* @__PURE__ */ new Map();
let sr = !1, Ke = null;
function Se() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function Ze(t) {
  const e = String(t || "").trim();
  if (!e)
    return null;
  const o = Je.get(e);
  if (o)
    return o;
  const c = Se();
  return Je.set(e, c), c;
}
function De(t) {
  const e = String(t || "").trim();
  return e && Je.get(e) || null;
}
function gt(t, e) {
  if (!t)
    return "";
  const o = e.toLowerCase();
  for (const [c, u] of Object.entries(t))
    if (c.toLowerCase() === o)
      return Array.isArray(u) ? String(u[0] || "") : String(u || "");
  return "";
}
function Ye(t) {
  var e;
  return ((e = String(t || "").split(";")[0]) == null ? void 0 : e.trim().toLowerCase()) || "";
}
function Ct(t) {
  try {
    const o = new URL(t).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (o == null ? void 0 : o[1]) || "";
  } catch {
    const e = String(t || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (e == null ? void 0 : e[1]) || "";
  }
}
function Or(t) {
  const e = Ye(t.mimeType), o = Ct(t.url);
  return Mo.has(o) || e.includes("mpegurl") || e.includes("dash+xml") ? "manifest" : Uo.has(o) || e.startsWith("video/") || e.startsWith("audio/") || t.resourceType === "media" || String(t.url || "").startsWith("blob:") ? "media" : Po.has(o) || e.startsWith("image/") ? "image" : ko.has(o) || e.includes("text/vtt") ? "subtitle" : o === "pdf" || e === "application/pdf" ? "document" : Lo.has(o) || t.resourceType === "key" || e === "application/octet-stream" ? "key" : "other";
}
function Dr(t) {
  return !t.url || t.url.startsWith("data:") ? !1 : t.kind !== "other" ? !0 : t.resourceType === "media" || t.url.startsWith("blob:");
}
function Mr(t, e, o, c) {
  return c ? `${t}::${e}::${c}` : `${t}::${e}::${o}`;
}
function Fo(t, e, o, c) {
  return Mr(t, e, o, c);
}
function No(t) {
  return Array.from(t.values()).sort((e, o) => o.capturedAt - e.capturedAt);
}
function se(t) {
  return {
    deepCaptureEnabled: t.deepCaptureEnabled,
    enabled: t.enabled,
    resources: No(t.resources)
  };
}
function Ur(t, e) {
  const o = De(t);
  if (!(o != null && o.enabled))
    return null;
  const c = String(e.url || "").trim();
  if (!c)
    return null;
  const u = String(e.resourceKey || "").trim() || void 0, m = Mr(t, e.source, c, u), y = o.resources.get(m), v = {
    ...y,
    ...e,
    ext: e.ext || (y == null ? void 0 : y.ext) || Ct(c) || void 0,
    id: Fo(t, e.source, c, u),
    kind: e.kind,
    resourceKey: u,
    tabId: t,
    url: c
  };
  return JSON.stringify(y) !== JSON.stringify(v) ? (o.resources.set(m, v), Ke == null || Ke(v), v) : y || null;
}
function $o(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? e : void 0;
}
function Wo(t) {
  const e = String(t || "").trim();
  if (!e)
    return;
  const o = e.match(/\/(\d+)\s*$/);
  if (!(o != null && o[1]))
    return;
  const c = Number(o[1]);
  return Number.isFinite(c) && c > 0 ? c : void 0;
}
function Pr(t) {
  if (t.streamType)
    return t.streamType;
  const e = Ye(t.mimeType);
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
function Io(t) {
  if (!t)
    return;
  const e = {};
  return Object.entries(t).forEach(([o, c]) => {
    const u = o.toLowerCase();
    if (!Ao.has(u))
      return;
    const m = String(c || "").trim();
    m && (e[u] = m);
  }), Object.keys(e).length ? e : void 0;
}
function zo(t) {
  const e = De(t);
  return se(e || Se());
}
function Ho(t) {
  const e = Ze(t);
  return e ? (e.enabled = !0, se(e)) : se(Se());
}
function jo(t) {
  const e = Ze(t);
  return e ? (e.enabled = !0, e.deepCaptureEnabled = !0, se(e)) : se(Se());
}
function Vo(t) {
  const e = Ze(t);
  return e ? (e.enabled = !1, e.deepCaptureEnabled = !1, se(e)) : se(Se());
}
function Ko(t) {
  const e = Ze(t);
  return e ? (e.resources.clear(), se(e)) : se(Se());
}
function ar(t) {
  Je.delete(String(t || "").trim());
}
function qo(t) {
  var e;
  return !!((e = De(t)) != null && e.deepCaptureEnabled);
}
function Jo(t, e) {
  const o = De(t);
  if (!(o != null && o.enabled) || !o.deepCaptureEnabled)
    return null;
  const c = String(e.url || "").trim();
  if (!c)
    return null;
  const u = e.kind || Or({
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    url: c
  });
  return Dr({ kind: u, resourceType: e.resourceType, url: c }) ? Ur(t, {
    capturedAt: Number(e.capturedAt) || Date.now(),
    contentLength: e.contentLength,
    ext: e.ext,
    kind: u,
    method: e.method,
    mimeType: Ye(e.mimeType),
    pageUrl: e.pageUrl,
    resourceType: e.resourceType,
    resourceKey: e.resourceKey,
    source: e.source || "probe",
    statusCode: e.statusCode,
    streamType: Pr({
      mimeType: e.mimeType,
      resourceType: e.resourceType,
      streamType: e.streamType,
      url: c
    }),
    url: c
  }) : null;
}
function Go(t) {
  sr || (sr = !0, Ke = t.emitResource, t.browserSession.webRequest.onBeforeSendHeaders((e, o) => {
    pe.set(e.id, {
      referer: e.referrer || void 0,
      requestHeaders: Io(e.requestHeaders)
    }), o({ cancel: !1, requestHeaders: e.requestHeaders });
  }), t.browserSession.webRequest.onCompleted((e) => {
    if (!e.webContentsId) {
      pe.delete(e.id);
      return;
    }
    const o = t.resolveTabIdByWebContentsId(e.webContentsId), c = o ? De(o) : null;
    if (!o || !(c != null && c.enabled)) {
      pe.delete(e.id);
      return;
    }
    if (e.statusCode < 200 || e.statusCode >= 400) {
      pe.delete(e.id);
      return;
    }
    const u = bn.fromId(e.webContentsId), m = String(e.url || "").trim(), y = pe.get(e.id), v = Ye(gt(e.responseHeaders, "content-type")), x = Or({
      mimeType: v,
      resourceType: e.resourceType,
      url: m
    });
    if (!Dr({ kind: x, resourceType: e.resourceType, url: m })) {
      pe.delete(e.id);
      return;
    }
    Ur(o, {
      capturedAt: Date.now(),
      contentLength: Wo(gt(e.responseHeaders, "content-range")) || $o(gt(e.responseHeaders, "content-length")),
      ext: Ct(m) || void 0,
      kind: x,
      method: e.method || void 0,
      mimeType: v,
      pageUrl: (u == null ? void 0 : u.getURL()) || void 0,
      referer: (y == null ? void 0 : y.referer) || e.referrer || void 0,
      requestHeaders: y == null ? void 0 : y.requestHeaders,
      resourceType: e.resourceType || void 0,
      source: "network",
      statusCode: e.statusCode || void 0,
      streamType: Pr({
        mimeType: v,
        resourceType: e.resourceType,
        url: m
      }),
      url: m
    }), pe.delete(e.id);
  }), t.browserSession.webRequest.onErrorOccurred((e) => {
    pe.delete(e.id);
  }));
}
const Xo = "embedded-browser-open-files", cr = 'input[data-omniflow-browser-open-fallback="true"]';
function kr() {
  return B.join(N.getPath("userData"), Xo);
}
function Zo() {
  const t = kr();
  return Xe(t) || Et(t, { recursive: !0 }), t;
}
function Yo(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function Qo(t, e) {
  const o = B.resolve(t), c = B.resolve(e);
  return o === c ? !0 : o.startsWith(`${c}${B.sep}`);
}
async function ei(t) {
  const e = await t.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${cr}') 
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
      return '${cr}'
    })()
  `, !0);
  return typeof e == "string" && e.trim() ? e.trim() : null;
}
async function ti(t, e, o) {
  var v;
  if (!e || o.length === 0)
    return !1;
  try {
    t.webContents.debugger.isAttached() || t.webContents.debugger.attach("1.3");
  } catch (x) {
    if (!String(x).includes("Already attached"))
      throw x;
  }
  const c = await t.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), u = Number(((v = c == null ? void 0 : c.root) == null ? void 0 : v.nodeId) || 0);
  if (!Number.isFinite(u) || u <= 0)
    return !1;
  const m = await t.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: u,
    selector: e
  }), y = Number((m == null ? void 0 : m.nodeId) || 0);
  return !Number.isFinite(y) || y <= 0 ? !1 : (await t.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: y,
    files: o
  }), !0);
}
async function ri(t, e) {
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
async function ni(t, e, o = {}) {
  const c = Zo(), u = B.join(c, Yo(e));
  return await Tt(t, u, o), u;
}
async function We(t) {
  const e = B.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const o = B.resolve(kr());
  return Qo(e, o) ? (await qe.rm(e, { force: !0 }), !0) : !1;
}
async function oi(t, e) {
  if (!t || t.webContents.isDestroyed())
    return !1;
  const o = await ei(t);
  return !o || !await ti(t, o, [e]) ? !1 : ri(t, o);
}
const ii = B.dirname(vn(import.meta.url));
process.env.APP_ROOT = B.join(ii, "..");
const Ge = process.env.VITE_DEV_SERVER_URL, si = B.join(process.env.APP_ROOT, "dist-electron"), Lr = B.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Ge ? B.join(process.env.APP_ROOT, "public") : Lr;
const lr = B.join(process.env.APP_ROOT, "build", "icons", "icon.png"), ai = "Omniflow", ci = "omniflow-app", li = 1400, ui = 920, Bt = 600, xt = 400, di = "window-state.json", fi = 200, ur = process.env.NODE_ENV === "test" || !!(Ge || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", mi = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
mi || (N.commandLine.appendSwitch("disable-logging"), N.commandLine.appendSwitch("log-level", "3"));
N.setName(ai);
try {
  const t = B.join(N.getPath("appData"), ci);
  N.setPath("userData", t);
} catch {
}
function Ar() {
  return Xe(lr) ? lr : null;
}
let _ = null, dr = !1, Fr = !1;
const pi = 240;
let Ie = null;
const he = /* @__PURE__ */ new Map(), A = /* @__PURE__ */ new Map(), ze = /* @__PURE__ */ new Map(), He = /* @__PURE__ */ new Map(), Ce = /* @__PURE__ */ new Map(), je = /* @__PURE__ */ new Map(), yt = /* @__PURE__ */ new Map();
let te = null, fr = null, mr = !1;
const pr = /* @__PURE__ */ new Map();
function gi(t) {
  !_ || _.isDestroyed() || _.webContents.send("embedded-browser:download", t);
}
function yi(t) {
  for (const [e, o] of he.entries())
    if (o.webContents === t)
      return e;
  return null;
}
function hi(t) {
  for (const [e, o] of he.entries())
    if (o.webContents.id === t)
      return e;
  return null;
}
function wi(t) {
  !_ || _.isDestroyed() || _.webContents.send("embedded-browser:resource", t);
}
function Nr() {
  return B.join(N.getPath("userData"), di);
}
function ge(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function bi(t, e) {
  return t >= Bt && e >= xt;
}
function Si(t) {
  return Sn.getAllDisplays().some((o) => {
    const c = o.workArea;
    return t.x < c.x + c.width && t.x + t.width > c.x && t.y < c.y + c.height && t.y + t.height > c.y;
  });
}
function Ei() {
  try {
    const t = Nr();
    if (!Xe(t))
      return null;
    const e = Rn(t, "utf-8"), o = JSON.parse(e);
    if (!ge(o.width) || !ge(o.height) || !bi(o.width, o.height))
      return null;
    const c = !!o.maximized, u = {
      width: o.width,
      height: o.height,
      maximized: c
    };
    return ge(o.x) && ge(o.y) && (u.x = o.x, u.y = o.y), ge(u.x) && ge(u.y) && (Si({
      x: u.x,
      y: u.y,
      width: u.width,
      height: u.height
    }) || (delete u.x, delete u.y)), u;
  } catch {
    return null;
  }
}
function _t(t) {
  if (!t.isDestroyed())
    try {
      const e = t.isMaximized() ? t.getNormalBounds() : t.getBounds(), o = {
        x: e.x,
        y: e.y,
        width: Math.max(Math.round(e.width), Bt),
        height: Math.max(Math.round(e.height), xt),
        maximized: t.isMaximized()
      }, c = Nr();
      Et(B.dirname(c), { recursive: !0 }), Cn(c, JSON.stringify(o), "utf-8");
    } catch {
    }
}
function Ve(t) {
  Ie && clearTimeout(Ie), Ie = setTimeout(() => {
    Ie = null, _t(t);
  }, fi);
}
function vi(t) {
  if (t.type !== "keyDown")
    return !1;
  const e = (t.key || "").toLowerCase();
  return (t.meta || t.control) && t.shift && e === "i";
}
function Ti(t) {
  if (t.type !== "keyDown" || !(t.meta || t.control))
    return !1;
  const e = (t.key || "").toLowerCase();
  return e === "+" || e === "=" || e === "-" || e === "_" || e === "0";
}
function $r(t) {
  const e = String(t || "").trim();
  if (!e)
    return "";
  try {
    return new URL(e).origin;
  } catch {
    return "";
  }
}
function Ri(t) {
  return t === "fileSystem";
}
async function Ci(t) {
  const e = $r(t);
  if (!e)
    return !1;
  const o = pr.get(e);
  if (typeof o == "boolean")
    return o;
  const c = z.getFocusedWindow() ?? _ ?? z.getAllWindows()[0] ?? void 0, { response: u } = await ie.showMessageBox(c, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${e} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), m = u === 1;
  return pr.set(e, m), m;
}
async function Bi(t) {
  const e = $r(t.origin);
  if (!e)
    return "deny";
  const o = z.getFocusedWindow() ?? _ ?? z.getAllWindows()[0] ?? void 0, { response: c } = await ie.showMessageBox(o, {
    type: "question",
    buttons: ["换个目录", "允许这次访问", "拒绝"],
    defaultId: 0,
    cancelId: 2,
    title: "网页请求访问受限路径",
    message: `${e} 想要访问受限路径。`,
    detail: String(t.path || ""),
    noLink: !0
  });
  return c === 0 ? "tryAgain" : c === 1 ? "allow" : "deny";
}
function xi() {
  if (mr)
    return;
  mr = !0;
  const t = Oe.fromPartition(_e);
  t.setPermissionRequestHandler((e, o, c, u) => {
    if (!Ri(String(o))) {
      c(!1);
      return;
    }
    Ci(u.requestingUrl || "").then((m) => {
      c(m);
    }).catch(() => {
      c(!1);
    });
  }), t.on("file-system-access-restricted", (e, o, c) => {
    e.preventDefault(), Bi(o).then((u) => {
      c(u);
    }).catch(() => {
      c("deny");
    });
  });
}
function _i() {
  if (dr)
    return;
  dr = !0, U.on("window-minimize", (l) => {
    const s = z.fromWebContents(l.sender) ?? _;
    s == null || s.minimize();
  }), U.on("window-maximize", (l) => {
    const s = z.fromWebContents(l.sender) ?? _;
    !s || s.isDestroyed() || (s.isMaximized() ? s.unmaximize() : s.maximize());
  }), U.on("window-close", (l) => {
    const s = z.fromWebContents(l.sender) ?? _;
    s == null || s.close();
  }), U.handle("window-activate", (l, s = !1) => {
    const i = z.fromWebContents(l.sender) ?? _;
    return !i || i.isDestroyed() ? !1 : (i.isMinimized() && i.restore(), i.isVisible() || i.show(), process.platform === "darwin" ? N.focus({ steal: !0 }) : N.focus(), typeof i.moveTop == "function" && i.moveTop(), i.focus(), s && !i.isAlwaysOnTop() && (i.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      i.isDestroyed() || i.setAlwaysOnTop(!1);
    }, pi)), !0);
  });
  const t = (l) => {
    F.log("[embedded-browser:main]", l), !(!_ || _.isDestroyed()) && _.webContents.send("embedded-browser:state", l);
  }, e = async (l) => {
    if (!ur || l.webContents.isDestroyed())
      return [];
    try {
      const s = await l.webContents.executeJavaScript(`
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
  }, o = (l) => {
    const s = l.webContents.getTitle().trim();
    if (s)
      return s;
  }, c = (l, s) => {
    const i = l.trim();
    if (!i)
      return "";
    if (i.startsWith("data:"))
      return i;
    try {
      return new URL(i, s || void 0).toString();
    } catch {
      return i;
    }
  }, u = (l, s) => {
    var g;
    const i = (g = String(s || "").split(";")[0]) == null ? void 0 : g.trim();
    if (i != null && i.startsWith("image/"))
      return i;
    const f = (() => {
      try {
        return new URL(l).pathname.toLowerCase();
      } catch {
        return l.toLowerCase();
      }
    })();
    return f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".ico") ? "image/x-icon" : f.endsWith(".webp") ? "image/webp" : f.endsWith(".jpg") || f.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  }, m = async (l, s) => {
    if (!s || s.startsWith("data:"))
      return s;
    try {
      const i = await l.fetch(s);
      if (!i.ok)
        return "";
      const f = gr.from(await i.arrayBuffer());
      return f.length === 0 ? "" : `data:${u(s, i.headers.get("content-type"))};base64,${f.toString("base64")}`;
    } catch (i) {
      return F.warn("embedded browser favicon load failed", {
        error: i instanceof Error ? i.message : String(i),
        iconUrl: s
      }), "";
    }
  }, y = async (l, s) => m(l.webContents.session, s), v = (l, s) => {
    const i = [], f = /<link\b[^>]*>/gi, g = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let d;
    for (; d = f.exec(l); ) {
      const T = d[0], M = /* @__PURE__ */ new Map();
      let P;
      for (g.lastIndex = 0; P = g.exec(T); )
        M.set(P[1].toLowerCase(), P[2] || P[3] || P[4] || "");
      const W = M.get("rel") || "", O = M.get("href") || "";
      if (!O || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(W))
        continue;
      const X = c(O, s);
      X && i.push(X);
    }
    return i;
  }, x = async (l) => {
    const s = String((l == null ? void 0 : l.pageUrl) || "").trim(), i = Oe.fromPartition(_e), f = [], g = c(String((l == null ? void 0 : l.iconUrl) || ""), s || void 0);
    if (g && !g.startsWith("data:") && f.push(g), s) {
      try {
        const T = await i.fetch(s), M = T.headers.get("content-type") || "";
        T.ok && /text\/html|application\/xhtml\+xml/i.test(M) && f.push(...v(await T.text(), s));
      } catch (T) {
        F.warn("embedded browser favicon page inspect failed", {
          error: T instanceof Error ? T.message : String(T),
          pageUrl: s
        });
      }
      try {
        const T = new URL(s).origin;
        f.push(`${T}/favicon.ico`);
      } catch {
      }
    }
    const d = /* @__PURE__ */ new Set();
    for (const T of f) {
      if (!T || d.has(T))
        continue;
      d.add(T);
      const M = await m(i, T);
      if (M)
        return {
          dataUrl: M,
          iconUrl: T
        };
    }
    return {
      dataUrl: g.startsWith("data:") ? g : "",
      iconUrl: ""
    };
  }, w = (l, s, i) => {
    t({
      canGoBack: s.webContents.canGoBack(),
      canGoForward: s.webContents.canGoForward(),
      iconSourceUrl: i.iconSourceUrl ?? He.get(l),
      iconUrl: i.iconUrl ?? ze.get(l),
      tabId: l,
      title: i.title ?? o(s),
      ...i
    });
  }, R = (l, s, i) => {
    w(l, s, {
      state: "ready",
      url: (i == null ? void 0 : i.url) ?? (A.get(l) || s.webContents.getURL() || void 0),
      ...i
    });
  }, S = (l) => {
    const s = he.get(l);
    return !s || s.webContents.isDestroyed() ? (he.delete(l), A.delete(l), ze.delete(l), He.delete(l), ar(l), null) : s;
  }, b = async (l, s) => {
    if (!qo(l) || s.webContents.isDestroyed())
      return !1;
    try {
      return await s.webContents.executeJavaScript(Eo(), !0), !0;
    } catch (i) {
      return F.warn("embedded browser resource probe install failed", {
        error: i instanceof Error ? i.message : String(i),
        tabId: l,
        url: s.webContents.getURL() || A.get(l) || ""
      }), !1;
    }
  }, C = async (l, s) => {
    const i = String(l || "").trim();
    if (!i)
      return null;
    const f = S(i);
    return !f || f.webContents.isDestroyed() ? null : s((d) => f.webContents.executeJavaScript(d, !0), f);
  }, k = async (l, s) => {
    const i = String(l || "").trim(), f = String(s.audioResourceKey || "").trim(), g = String(s.videoResourceKey || "").trim();
    if (!i || !f || !g)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const d = await C(
        i,
        async (we) => Promise.all([
          or(we, f),
          or(we, g)
        ])
      ), [T, M] = d || [];
      if (!T || !M)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const P = String(s.suggestedFileName || "").trim() || xo(M.fileName, T.fileName), W = _ && !_.isDestroyed() ? _ : void 0, O = {
        defaultPath: B.join(N.getPath("downloads"), P),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, X = W ? await ie.showSaveDialog(W, O) : await ie.showSaveDialog(O);
      if (X.canceled || !X.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const ne = await Do({
        audio: T,
        ffmpegPath: s.ffmpegPath,
        outputPath: X.filePath,
        video: M
      });
      return {
        ffmpegPath: ne.ffmpegPath,
        ok: !0,
        outputPath: ne.outputPath
      };
    } catch (d) {
      return F.warn("embedded browser resource merge failed", {
        audioResourceKey: f,
        error: d instanceof Error ? d.message : String(d),
        tabId: i,
        videoResourceKey: g
      }), {
        error: d instanceof Error ? d.message : String(d),
        ok: !1
      };
    }
  }, L = (l) => {
    const s = Ce.get(l);
    s != null && s.stagedPath && We(s.stagedPath).catch(() => {
    }), Ce.delete(l);
    const i = je.get(l);
    i && We(i).catch(() => {
    }), je.delete(l);
  }, H = (l) => {
    const s = (yt.get(l) ?? 0) + 1;
    return yt.set(l, s), s;
  }, q = (l, s) => yt.get(l) === s, J = (l, s) => {
    try {
      const i = new URL(l), f = new URL(s);
      if (i.origin !== f.origin)
        return !1;
      const g = i.pathname.replace(/\/+$/, "") || "/", d = f.pathname.replace(/\/+$/, "") || "/";
      return d === "/" ? !0 : g === d || g.startsWith(`${d}/`);
    } catch {
      return !1;
    }
  }, ae = async (l, s) => {
    const i = Ce.get(l);
    if (!i || s.webContents.isDestroyed())
      return !1;
    const f = s.webContents.getURL() || A.get(l) || "";
    if (!f || !J(f, i.pageUrl))
      return !1;
    try {
      if (!await oi(s, i.stagedPath))
        return !1;
      const d = je.get(l);
      return d && d !== i.stagedPath && We(d).catch(() => {
      }), je.set(l, i.stagedPath), Ce.delete(l), !0;
    } catch {
      return !1;
    }
  }, ee = (l) => {
    l.setBounds(fr ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }, ye = (l) => {
    if (!te)
      return;
    const s = S(te);
    if (!s) {
      te = null;
      return;
    }
    l.contentView.children.includes(s) && l.contentView.removeChildView(s), te = null;
  }, G = (l) => {
    if (!_ || _.isDestroyed())
      return null;
    const s = S(l);
    if (s)
      return s;
    const i = new En({
      webPreferences: {
        devTools: !0,
        partition: _e
      }
    });
    i.webContents.setZoomFactor(1);
    const f = i.webContents.getUserAgent();
    return f.includes("Electron") && i.webContents.setUserAgent(
      f.replace(/\sElectron\/[^\s]+/g, "")
    ), ee(i), he.set(l, i), i.webContents.on("did-start-loading", () => {
      w(l, i, {
        details: "did-start-loading",
        state: "loading",
        url: i.webContents.getURL() || A.get(l) || void 0
      });
    }), i.webContents.on("dom-ready", () => {
      b(l, i);
    }), i.webContents.on("did-stop-loading", async () => {
      if (i.webContents.isDestroyed())
        return;
      const g = i.webContents.getURL() || "";
      A.set(l, g), await ae(l, i);
      const d = await e(i);
      w(l, i, {
        details: "did-stop-loading",
        ...d.length ? { meta: d } : {},
        state: "ready",
        url: g || void 0
      });
    }), i.webContents.on("did-navigate", (g, d) => {
      A.set(l, d), w(l, i, { details: "did-navigate", state: "ready", url: d }), ae(l, i);
    }), i.webContents.on("did-navigate-in-page", (g, d) => {
      A.set(l, d), w(l, i, { details: "did-navigate-in-page", state: "ready", url: d }), ae(l, i);
    }), i.webContents.on("page-title-updated", (g, d) => {
      w(l, i, {
        details: "page-title-updated",
        state: "ready",
        title: d || void 0,
        url: A.get(l) || i.webContents.getURL() || void 0
      });
    }), i.webContents.on("page-favicon-updated", (g, d) => {
      const T = A.get(l) || i.webContents.getURL() || void 0, M = d.map((P) => c(String(P || ""), T)).find((P) => P.trim()) || "";
      M && y(i, M).then((P) => {
        !P || i.webContents.isDestroyed() || (He.set(l, M), ze.set(l, P), w(l, i, {
          details: "page-favicon-updated",
          iconSourceUrl: M,
          iconUrl: P,
          state: "ready",
          url: A.get(l) || i.webContents.getURL() || void 0
        }));
      });
    }), i.webContents.on("did-fail-load", (g, d, T, M) => {
      d !== -3 && w(l, i, {
        details: `did-fail-load(${d})`,
        state: "error",
        message: `页面加载失败：${T || "未知错误"}`,
        url: M
      });
    }), i.webContents.on("render-process-gone", (g, d) => {
      w(l, i, {
        details: `render-process-gone:${d.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${d.reason}`,
        url: A.get(l) || i.webContents.getURL() || void 0
      });
    }), i.webContents.on("console-message", (g, d, T, M, P) => {
      if (typeof T == "string" && T.startsWith(bt)) {
        const W = T.slice(bt.length);
        try {
          const O = JSON.parse(W);
          Jo(l, {
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
            tabId: l
          });
        }
        return;
      }
      ur && d >= 2 && w(l, i, {
        details: `console:${P}:${M}`,
        state: "ready",
        message: T,
        meta: [`console-level=${d}`],
        url: A.get(l) || i.webContents.getURL() || void 0
      });
    }), i.webContents.setWindowOpenHandler(({ url: g }) => (i.webContents.loadURL(g), { action: "deny" })), i;
  }, re = (l, s, i) => {
    if (!l || l.isDestroyed())
      return null;
    if (!s)
      return ye(l), null;
    const g = (i == null ? void 0 : i.createIfMissing) ?? !1 ? G(s) : S(s);
    return g ? !g || g.webContents.isDestroyed() ? null : (te && te !== s && ye(l), ee(g), l.contentView.children.includes(g) || l.contentView.addChildView(g), te = s, g) : (ye(l), null);
  }, V = async (l, s, i, f, g = !1) => {
    if (!l || l.isDestroyed())
      return;
    const d = String(s || "").trim();
    if (!d)
      return;
    const T = re(l, d, { createIfMissing: !0 });
    if (!T || T.webContents.isDestroyed())
      return;
    const M = String(i || "").trim();
    if (!M) {
      w(d, T, {
        state: "ready",
        title: o(T) || "新标签页",
        url: A.get(d) || void 0
      });
      return;
    }
    const P = A.get(d) || T.webContents.getURL();
    if (g && P === M) {
      w(d, T, {
        state: "ready",
        url: P || void 0
      });
      return;
    }
    w(d, T, {
      details: "load-url",
      state: "loading",
      url: M
    });
    try {
      await T.webContents.loadURL(M);
    } catch (W) {
      const O = W instanceof Error ? W.message : String(W);
      if (O.includes("ERR_ABORTED"))
        return;
      throw w(d, T, {
        details: f,
        state: "error",
        message: `页面加载失败：${O}`,
        url: M
      }), W;
    }
  }, ce = (l, s) => {
    if (!l || l.isDestroyed())
      return;
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = S(i);
    f && (l.contentView.children.includes(f) && l.contentView.removeChildView(f), te === i && (te = null), he.delete(i), A.delete(i), ze.delete(i), He.delete(i), ar(i), H(i), L(i), f.webContents.isDestroyed() || f.webContents.close({ waitForBeforeUnload: !1 }));
  };
  U.handle("embedded-browser:open-tab", async (l, s, i) => {
    const f = z.fromWebContents(l.sender) ?? _;
    H(String(s || "").trim()), L(String(s || "").trim());
    const g = String(i || "").trim();
    if (!g) {
      t({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: s,
        title: "新标签页"
      });
      return;
    }
    await V(f, s, g, "open-exception", !0);
  }), U.handle("embedded-browser:activate-tab", (l, s) => {
    const i = z.fromWebContents(l.sender) ?? _;
    re(i, s, { createIfMissing: !1 });
  }), U.handle("embedded-browser:navigate", async (l, s, i) => {
    const f = z.fromWebContents(l.sender) ?? _, g = String(s || "").trim();
    H(g), L(g), await V(f, g, i, "navigate-exception");
  }), U.handle("embedded-browser:resolve-favicon", async (l, s) => x(s)), U.handle("embedded-browser:open-mapped-file", async (l, s, i, f, g) => {
    const d = z.fromWebContents(l.sender) ?? _, T = String(s || "").trim(), M = String(i || "").trim(), P = String(f || "").trim(), W = String(g || "").trim() || "file";
    if (!T || !M || !P)
      return;
    const O = H(T);
    L(T);
    const X = await ni(P, W);
    if (!q(T, O)) {
      We(X).catch(() => {
      });
      return;
    }
    if (Ce.set(T, {
      fileName: W,
      pageUrl: M,
      stagedPath: X
    }), await V(d, T, M, "navigate-exception"), !q(T, O))
      return;
    const ne = S(T);
    ne && ae(T, ne);
  }), U.handle("embedded-browser:reload", async (l, s) => {
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = S(i);
    !f || f.webContents.isDestroyed() || (w(i, f, {
      details: "reload",
      state: "loading",
      url: A.get(i) || f.webContents.getURL() || void 0
    }), f.webContents.reload(), R(i, f, {
      details: "reload-requested"
    }));
  }), U.handle("embedded-browser:go-back", async (l, s) => {
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = S(i);
    !f || f.webContents.isDestroyed() || (f.webContents.canGoBack() && f.webContents.goBack(), R(i, f, {
      details: "history-back"
    }));
  }), U.handle("embedded-browser:go-forward", async (l, s) => {
    const i = String(s || "").trim();
    if (!i)
      return;
    const f = S(i);
    !f || f.webContents.isDestroyed() || (f.webContents.canGoForward() && f.webContents.goForward(), R(i, f, {
      details: "history-forward"
    }));
  }), U.handle("embedded-browser:resource:list", (l, s) => zo(String(s || "").trim())), U.handle("embedded-browser:resource:start", (l, s) => Ho(String(s || "").trim())), U.handle("embedded-browser:resource:stop", (l, s) => Vo(String(s || "").trim())), U.handle("embedded-browser:resource:clear", (l, s) => Ko(String(s || "").trim())), U.handle("embedded-browser:resource:open", async (l, s, i) => C(s, async (f, g) => {
    try {
      return await nr(f, "openResource", i);
    } catch (d) {
      return F.warn("embedded browser resource probe action failed", {
        action: "openResource",
        error: d instanceof Error ? d.message : String(d),
        resourceKey: String(i || "").trim(),
        tabId: String(s || "").trim(),
        url: g.webContents.getURL() || A.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((f) => !!f)), U.handle("embedded-browser:resource:export", async (l, s, i) => C(s, async (f, g) => {
    try {
      return await nr(f, "exportResource", i);
    } catch (d) {
      return F.warn("embedded browser resource probe action failed", {
        action: "exportResource",
        error: d instanceof Error ? d.message : String(d),
        resourceKey: String(i || "").trim(),
        tabId: String(s || "").trim(),
        url: g.webContents.getURL() || A.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((f) => !!f)), U.handle("embedded-browser:resource:preview", async (l, s, i) => C(s, async (f) => {
    try {
      return await go(f, i);
    } catch (g) {
      return F.warn("embedded browser network resource preview failed", {
        error: g instanceof Error ? g.message : String(g),
        tabId: String(s || "").trim(),
        url: String(i.url || "").trim()
      }), !1;
    }
  }).then((f) => !!f)), U.handle("embedded-browser:resource:catch-toolkit:get-state", async (l, s) => C(s, async (i, f) => {
    try {
      return await bo(i);
    } catch (g) {
      return F.warn("embedded browser catch toolkit get state failed", {
        error: g instanceof Error ? g.message : String(g),
        tabId: String(s || "").trim(),
        url: f.webContents.getURL() || A.get(String(s || "").trim()) || ""
      }), null;
    }
  })), U.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (l, s, i) => C(s, async (f, g) => {
      try {
        return await So(f, i);
      } catch (d) {
        return F.warn("embedded browser catch toolkit update state failed", {
          error: d instanceof Error ? d.message : String(d),
          payload: i,
          tabId: String(s || "").trim(),
          url: g.webContents.getURL() || A.get(String(s || "").trim()) || ""
        }), null;
      }
    })
  ), U.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (l, s) => C(s, async (i, f) => {
    try {
      return await pt(i, "clearCatchMediaCache");
    } catch (g) {
      return F.warn("embedded browser catch toolkit clear cache failed", {
        error: g instanceof Error ? g.message : String(g),
        tabId: String(s || "").trim(),
        url: f.webContents.getURL() || A.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((i) => !!i)), U.handle("embedded-browser:resource:catch-toolkit:download", async (l, s) => C(s, async (i, f) => {
    try {
      return await pt(i, "downloadCatchMedia");
    } catch (g) {
      return F.warn("embedded browser catch toolkit download failed", {
        error: g instanceof Error ? g.message : String(g),
        tabId: String(s || "").trim(),
        url: f.webContents.getURL() || A.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((i) => !!i)), U.handle("embedded-browser:resource:catch-toolkit:restart", async (l, s) => C(s, async (i, f) => {
    try {
      return await pt(i, "restartCatchMediaCapture");
    } catch (g) {
      return F.warn("embedded browser catch toolkit restart failed", {
        error: g instanceof Error ? g.message : String(g),
        tabId: String(s || "").trim(),
        url: f.webContents.getURL() || A.get(String(s || "").trim()) || ""
      }), !1;
    }
  }).then((i) => !!i)), U.handle(
    "embedded-browser:resource:merge-mse",
    async (l, s, i) => k(s, i)
  ), U.handle("embedded-browser:resource:start-deep-capture", async (l, s) => {
    const i = String(s || "").trim(), f = jo(i), g = S(i);
    return g && !g.webContents.isDestroyed() && (g.webContents.getURL() ? g.webContents.reload() : await b(i, g)), f;
  }), U.handle("embedded-browser:set-bounds", (l, s) => {
    const i = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, f = z.fromWebContents(l.sender) ?? _, g = f && !f.isDestroyed() ? Math.max(f.webContents.getZoomFactor(), 0.01) : 1;
    if (i.x = Math.max(0, Math.round(s.x * g)), i.y = Math.max(0, Math.round(s.y * g)), i.width = Math.max(0, Math.round(s.width * g)), i.height = Math.max(0, Math.round(s.height * g)), fr = i, !te)
      return;
    const d = S(te);
    d && d.setBounds(i);
  }), U.handle("embedded-browser:close-tab", (l, s) => {
    const i = z.fromWebContents(l.sender) ?? _;
    ce(i, s);
  }), U.handle("embedded-browser:cleanup-download-file", async (l, s) => {
    try {
      return await Br(s);
    } catch {
      return !1;
    }
  }), U.handle("embedded-browser:deactivate", (l) => {
    const s = z.fromWebContents(l.sender) ?? _;
    !s || s.isDestroyed() || ye(s);
  }), U.handle("embedded-browser:close-all", (l) => {
    const s = z.fromWebContents(l.sender) ?? _;
    !s || s.isDestroyed() || (Array.from(he.keys()).forEach((i) => {
      ce(s, i);
    }), te = null, t({ state: "idle" }));
  });
}
function Wr() {
  if (_ && !_.isDestroyed())
    return _.show(), _.focus(), _;
  const t = Ar(), e = Ei(), o = (e == null ? void 0 : e.width) ?? li, c = (e == null ? void 0 : e.height) ?? ui, u = new z({
    width: o,
    height: c,
    minWidth: Bt,
    minHeight: xt,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...ge(e == null ? void 0 : e.x) && ge(e == null ? void 0 : e.y) ? { x: e.x, y: e.y } : {},
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: B.join(si, "preload.mjs"),
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
  return _ = u, e != null && e.maximized && u.maximize(), u.on("move", () => {
    Ve(u);
  }), u.on("resize", () => {
    Ve(u);
  }), u.on("maximize", () => {
    Ve(u);
  }), u.on("unmaximize", () => {
    Ve(u);
  }), u.on("close", (m) => {
    _t(u), process.platform === "darwin" && !Fr && (m.preventDefault(), u.hide());
  }), u.on("closed", () => {
    _ === u && (_ = null);
  }), u.webContents.setZoomFactor(1), u.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), u.webContents.on("before-input-event", (m, y) => {
    if (Ti(y)) {
      m.preventDefault();
      return;
    }
    vi(y) && (m.preventDefault(), u.webContents.toggleDevTools());
  }), u.on("app-command", (m, y) => {
    (y === "browser-backward" || y === "browser-forward") && m.preventDefault();
  }), u.on("swipe", (m, y) => {
    (y === "left" || y === "right") && m.preventDefault();
  }), Ge ? u.loadURL(Ge) : u.loadFile(B.join(Lr, "index.html")), u;
}
N.on("before-quit", () => {
  Fr = !0, _ && !_.isDestroyed() && _t(_);
});
N.on("window-all-closed", () => {
  process.platform !== "darwin" && N.quit();
});
N.on("activate", () => {
  if (_ && !_.isDestroyed()) {
    _.isMinimized() && _.restore(), _.show(), _.focus();
    return;
  }
  z.getAllWindows().length === 0 && Wr();
});
N.whenReady().then(() => {
  const t = Ar();
  t && process.platform === "darwin" && N.dock.setIcon(t), xi(), uo({
    emitDownload: gi,
    resolveTabIdByWebContents: yi
  }), Go({
    browserSession: Oe.fromPartition(_e),
    emitResource: wi,
    resolveTabIdByWebContentsId: hi
  }), oo(), _i(), Wr();
});
export {
  si as MAIN_DIST,
  Lr as RENDERER_DIST,
  Ge as VITE_DEV_SERVER_URL
};
