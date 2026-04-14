import { dialog as te, app as N, net as at, ipcMain as P, session as Se, webContents as Xt, BrowserWindow as j, WebContentsView as Zt, screen as Yt } from "electron";
import { fileURLToPath as Qt } from "node:url";
import R from "node:path";
import je, { existsSync as Fe, mkdirSync as Je, constants as er, readFileSync as tr, writeFileSync as rr } from "node:fs";
import z from "fs/promises";
import De, { mkdtemp as nr, writeFile as or, rm as ar, access as ir } from "node:fs/promises";
import bt from "node:http";
import ht from "node:https";
import wt from "os";
import Ge from "child_process";
import sr from "fs";
import { Buffer as St } from "node:buffer";
import { spawn as vt } from "node:child_process";
import cr from "node:os";
const Ce = 6e4;
async function Xe(e, t, r = {}, n = 0) {
  const a = new URL(e);
  if (a.protocol !== "http:" && a.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${a.protocol}`);
  const c = a.protocol === "https:" ? ht : bt;
  await De.mkdir(R.dirname(t), { recursive: !0 }), await new Promise((m, w) => {
    let y = !1;
    const g = () => {
      y || (y = !0, m());
    }, S = (E) => {
      y || (y = !0, w(E));
    }, h = c.request({
      protocol: a.protocol,
      hostname: a.hostname,
      port: a.port ? Number(a.port) : void 0,
      path: `${a.pathname}${a.search}`,
      method: "GET",
      headers: r
    }, (E) => {
      E.setTimeout(Ce, () => {
        E.destroy(new Error(`下载响应超时: ${Ce}ms`));
      });
      const U = Number(E.statusCode || 0), O = E.headers.location;
      if (U >= 300 && U < 400 && O) {
        if (E.resume(), n >= 3) {
          S(new Error(`下载重定向次数过多: ${e}`));
          return;
        }
        const s = new URL(O, e).toString();
        Xe(s, t, r, n + 1).then(g).catch(S);
        return;
      }
      if (U >= 400) {
        E.resume(), S(new Error(`下载失败: HTTP ${U} (${e})`));
        return;
      }
      const A = je.createWriteStream(t), u = async (s) => {
        try {
          A.destroy();
        } catch {
        }
        try {
          await De.rm(t, { force: !0 });
        } catch {
        }
        S(s);
      };
      E.on("error", (s) => {
        u(s);
      }), A.on("error", (s) => {
        u(s);
      }), A.on("finish", () => g()), E.pipe(A);
    });
    h.setTimeout(Ce, () => {
      h.destroy(new Error(`下载请求超时: ${Ce}ms`));
    }), h.on("error", (E) => S(E)), h.end();
  });
}
const dr = "Omniflow Inbox", ur = 10 * 60 * 1e3, lr = 2, fr = 2e3, Ve = 12, mr = R.join(
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
function Et() {
  return R.join(N.getPath("userData"), "auto-import-staging");
}
function gr() {
  return R.join(N.getPath("userData"), "embedded-browser-downloads");
}
function Ct(e, t) {
  const r = R.resolve(e), n = R.resolve(t);
  return r === n ? !0 : r.startsWith(`${n}${R.sep}`);
}
function yr(e) {
  const t = String(e || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
async function br(e, t) {
  try {
    await z.rename(e, t);
  } catch (r) {
    if ((r == null ? void 0 : r.code) !== "EXDEV")
      throw r;
    await z.copyFile(e, t), await z.rm(e, { force: !0 });
  }
}
function hr(e) {
  const t = Date.now();
  for (const [r, n] of he.entries())
    e.has(r) || t - n.lastSeenAt <= ur || he.delete(r);
}
async function wr(e, t = Ve) {
  const r = String(e || "").trim(), n = r ? R.resolve(r) : R.join(N.getPath("downloads"), dr), o = await z.stat(n).catch(() => null);
  if (!(o != null && o.isDirectory()))
    return [];
  const a = await z.readdir(n, { withFileTypes: !0 }), c = /* @__PURE__ */ new Set(), m = Date.now(), w = [];
  for (const h of a) {
    if (!h.isFile() || Ze(h.name) || pr(h.name)) continue;
    const E = R.join(n, h.name), U = await z.stat(E).catch(() => null);
    if (!(U != null && U.isFile())) continue;
    c.add(E);
    const O = he.get(E), u = (O ? O.size === U.size && O.mtimeMs === U.mtimeMs : !1) && O ? O.stableCount + 1 : 1;
    he.set(E, {
      size: U.size,
      mtimeMs: U.mtimeMs,
      stableCount: u,
      lastSeenAt: m
    }), !(u < lr) && (m - U.mtimeMs < fr || w.push({
      sourcePath: E,
      name: h.name,
      size: U.size,
      mtimeMs: U.mtimeMs
    }));
  }
  if (hr(c), w.length === 0)
    return [];
  w.sort((h, E) => h.mtimeMs - E.mtimeMs);
  const y = Et();
  await z.mkdir(y, { recursive: !0 });
  const g = [], S = Math.max(1, Math.floor(Number(t) || Ve));
  for (const h of w.slice(0, S)) {
    const E = R.join(y, yr(h.name));
    try {
      await br(h.sourcePath, E);
    } catch {
      continue;
    }
    he.delete(h.sourcePath), g.push({
      name: h.name,
      size: h.size,
      localPath: E,
      relativePath: we(h.name)
    });
  }
  return g;
}
async function Sr(e) {
  const t = R.resolve(String(e || "").trim()), r = Et();
  return !t || !Ct(t, r) ? !1 : (await z.rm(t, { force: !0 }), !0);
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
  return R.join(e, ...n);
}
function Tt(e, t) {
  return e.relativePath.localeCompare(t.relativePath, "zh-Hans-CN");
}
async function vr(e) {
  return (await Promise.all(e.map(async (r) => {
    const n = await z.stat(r);
    if (!n.isFile())
      return null;
    const o = R.basename(r);
    return Ze(o) ? null : {
      name: o,
      size: n.size,
      localPath: r,
      relativePath: we(o)
    };
  }))).filter((r) => !!r).sort(Tt);
}
async function Er(e, t, r) {
  const n = [t], o = [];
  for (; n.length > 0; ) {
    const g = n.pop(), S = await z.readdir(g, { withFileTypes: !0 });
    for (const h of S) {
      if (h.name === "." || h.name === ".." || Ze(h.name) || h.isSymbolicLink())
        continue;
      const E = R.join(g, h.name);
      if (h.isDirectory()) {
        n.push(E);
        continue;
      }
      h.isFile() && o.push({
        absolutePath: E,
        name: h.name
      });
    }
  }
  const a = [], c = 48;
  let m = 0;
  const w = async () => {
    for (; m < o.length; ) {
      const g = m;
      if (m += 1, g >= o.length)
        return;
      const S = o[g], h = await z.stat(S.absolutePath).catch(() => null);
      if (!(h != null && h.isFile()))
        continue;
      const E = we(R.relative(e, S.absolutePath)), U = we(R.join(r, E));
      a.push({
        name: S.name,
        size: h.size,
        localPath: S.absolutePath,
        relativePath: U
      });
    }
  }, y = Math.min(c, Math.max(1, o.length));
  return await Promise.all(Array.from({ length: y }, () => w())), a;
}
async function Cr(e) {
  const t = [];
  for (const r of e) {
    if (!(await z.stat(r)).isDirectory())
      continue;
    const o = R.basename(r), a = await Er(r, r, o);
    t.push(...a);
  }
  return t.sort(Tt);
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
      content: await z.readFile(r, "utf-8"),
      filePath: r
    };
  }), e.handle("file:save", async (t, r, n) => (await z.writeFile(r, n, "utf-8"), !0)), e.handle("file:read-text", async (t, r) => {
    const n = R.resolve(String(r || "").trim());
    return {
      canceled: !1,
      content: await z.readFile(n, "utf-8"),
      filePath: n
    };
  }), e.handle("file:read-local-chrome-bookmarks", async () => {
    const t = R.join(N.getPath("home"), mr);
    return {
      canceled: !1,
      content: await z.readFile(t, "utf-8"),
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
    return await z.mkdir(o, { recursive: !0 }), o;
  }), e.handle("fs:download-url-to-path", async (t, r, n, o, a = {}) => {
    const c = it(n, o);
    return await Xe(r, c, a), c;
  }), e.handle("fs:save-staged-download-file", async (t, r, n) => {
    const o = R.resolve(String(r || "").trim()), a = R.resolve(String(n || "").trim()), c = gr();
    if (!o || !Ct(o, c))
      throw new Error("无效的下载临时文件");
    if (!a)
      throw new Error("无效的保存路径");
    return await z.mkdir(R.dirname(a), { recursive: !0 }), await z.copyFile(o, a), a;
  });
}
var J = {}, ne = wt;
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
`), a = o[1].replace(/[\s\n\r]+/g, " "), c = a.split(" ");
    total_mem = parseFloat(c[1]), free_mem = parseFloat(c[3]), buffers_mem = parseFloat(c[5]), cached_mem = parseFloat(c[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), e(used_mem - 2);
  });
};
J.harddrive = function(e) {
  Ge.exec("df -k", function(t, r, n) {
    var o = 0, a = 0, c = 0, m = r.split(`
`), w = m[1].replace(/[\s\n\r]+/g, " "), y = w.split(" ");
    o = Math.ceil(y[1] * 1024 / Math.pow(1024, 2)), a = Math.ceil(y[2] * 1024 / Math.pow(1024, 2)), c = Math.ceil(y[3] * 1024 / Math.pow(1024, 2)), e(o, c, a);
  });
};
J.getProcesses = function(e, t) {
  typeof e == "function" && (t = e, e = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", e > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (e + 1)), Ge.exec(command, function(r, n, o) {
    var a = n.split(`
`);
    a.shift(), a.pop();
    var c = "";
    a.forEach(function(m, w) {
      var y = m.replace(/[\s\n\r]+/g, " ");
      y = y.split(" "), c += y[1] + " " + y[2] + " " + y[3] + " " + y[4].substring(y[4].length - 25) + `
`;
    }), t(c);
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
  Rt(e, !0);
};
J.cpuUsage = function(e) {
  Rt(e, !1);
};
function Rt(e, t) {
  var r = st(), n = r.idle, o = r.total;
  setTimeout(function() {
    var a = st(), c = a.idle, m = a.total, w = c - n, y = m - o, g = w / y;
    e(t === !0 ? g : 1 - g);
  }, 1e3);
}
function st(e) {
  var t = ne.cpus(), r = 0, n = 0, o = 0, a = 0, c = 0, w = 0;
  for (var m in t)
    r += t[m].times.user, n += t[m].times.nice, o += t[m].times.sys, c += t[m].times.irq, a += t[m].times.idle;
  var w = r + n + o + a + c;
  return {
    idle: a,
    total: w
  };
}
const Rr = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", be = (e, ...t) => {
  Rr && console[e](...t);
}, k = {
  debug: (...e) => be("debug", ...e),
  info: (...e) => be("info", ...e),
  log: (...e) => be("log", ...e),
  warn: (...e) => be("warn", ...e),
  error: (...e) => be("error", ...e)
};
function Br() {
  const e = Mr().total, t = wt.cpus()[0].model, r = Math.floor(J.totalmem() / 1024);
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
function Bt(e) {
  return String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function Pr(e) {
  return encodeURIComponent(e).replace(
    /['()*]/g,
    (t) => `%${t.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Ir(e) {
  const t = Bt(e), r = Pr(e);
  return `Content-Disposition: form-data; name="file"; filename="${t}"; filename*=UTF-8''${r}\r
`;
}
function Ur(e) {
  const t = /* @__PURE__ */ new Map(), r = (n, o = !1) => {
    const a = Date.now();
    if (!o && a - n.lastProgressAt < 80) return;
    n.lastProgressAt = a;
    const c = Math.max(a - n.startedAt, 1), m = Math.floor(n.uploadedBytes * 1e3 / c), w = n.totalBytes > 0 ? Math.min(n.uploadedBytes / n.totalBytes * 100, 100) : 0;
    n.sender.send("http:upload:progress", {
      uploadId: n.uploadId,
      uploadedBytes: n.uploadedBytes,
      totalBytes: n.totalBytes,
      percentage: w,
      speedBps: m
    });
  };
  e.handle("http:fetch", async (n, o, a = {}) => (k.debug("http:fetch start"), k.debug("http:fetch URL:", o), k.debug("http:fetch options:", a), new Promise((c, m) => {
    const w = at.request({ url: o, method: a.method || "GET" });
    a.headers && Object.entries(a.headers).forEach(([g, S]) => {
      k.debug(`http:fetch set header ${g}: ${String(S)}`), w.setHeader(g, S);
    });
    let y = "";
    w.on("response", (g) => {
      k.debug("http:fetch response"), k.debug("http:fetch status:", g.statusCode), k.debug("http:fetch headers:", g.headers), g.on("data", (S) => {
        k.debug(`http:fetch chunk length: ${S.length}`), y += S;
      }), g.on("end", () => {
        k.debug("http:fetch body preview:", y.slice(0, 500));
        let S;
        try {
          S = JSON.parse(y);
        } catch {
          S = y;
        }
        c({
          status: g.statusCode,
          headers: g.headers,
          body: S
        });
      });
    }), w.on("error", (g) => {
      k.error("http:fetch error:", g), m(g);
    }), a.body && w.write(a.body), w.end();
  }))), e.handle("http:fetch-binary", async (n, o, a = {}) => (k.debug("http:fetch-binary start"), k.debug("http:fetch-binary URL:", o), new Promise((c, m) => {
    const w = at.request({ url: o, method: a.method || "GET" }), y = Math.max(0, Number(a.maxBytes || 0)), g = [];
    let S = 0, h = !1;
    const E = (O) => {
      h || (h = !0, c(O));
    }, U = (O) => {
      h || (h = !0, m(O));
    };
    a.headers && Object.entries(a.headers).forEach(([O, A]) => {
      w.setHeader(O, A);
    }), w.on("response", (O) => {
      O.on("data", (A) => {
        if (h)
          return;
        let u = A, s = !1;
        if (y > 0 && S + A.length > y && (u = A.subarray(0, Math.max(0, y - S)), s = !0), u.length > 0 && (g.push(u), S += u.length), s) {
          try {
            w.abort();
          } catch {
          }
          E({
            base64: Buffer.concat(g).toString("base64"),
            headers: O.headers,
            receivedBytes: S,
            status: O.statusCode,
            truncated: !0
          });
        }
      }), O.on("end", () => {
        E({
          base64: Buffer.concat(g).toString("base64"),
          headers: O.headers,
          receivedBytes: S,
          status: O.statusCode,
          truncated: !1
        });
      });
    }), w.on("error", (O) => {
      h || (k.error("http:fetch-binary error:", O), U(O));
    }), a.body && w.write(a.body), w.end();
  }))), e.handle("http:upload:abort", async (n, o) => {
    const a = t.get(o);
    if (!a) return !1;
    a.aborted = !0, t.delete(o);
    try {
      a.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      a.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), e.handle("http:upload", async (n, o, a, c = {}, m = {}, w) => new Promise((y, g) => {
    let S;
    try {
      S = je.statSync(a);
    } catch (b) {
      g(new Error(`读取上传文件失败: ${a} (${String(b)})`));
      return;
    }
    if (!S.isFile()) {
      g(new Error(`上传目标不是文件: ${a}`));
      return;
    }
    if (S.size > _r) {
      g(new Error(Dr));
      return;
    }
    const h = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), E = w || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, U = R.basename(a), O = Object.entries(c).map(([b, B]) => `--${h}\r
Content-Disposition: form-data; name="${Bt(b)}"\r
\r
${B}\r
`).join(""), A = `--${h}\r
` + Ir(U) + `Content-Type: application/octet-stream\r
\r
`, u = `\r
--${h}--\r
`, s = Buffer.byteLength(O) + Buffer.byteLength(A) + S.size + Buffer.byteLength(u), C = {
      ...m,
      "Content-Type": `multipart/form-data; boundary=${h}`,
      "Content-Length": String(s)
    }, D = new URL(o), I = (D.protocol === "https:" ? ht : bt).request({
      protocol: D.protocol,
      hostname: D.hostname,
      port: D.port ? Number(D.port) : void 0,
      path: `${D.pathname}${D.search}`,
      method: "POST",
      headers: C
    }), q = je.createReadStream(a, {
      highWaterMark: 1024 * 1024
    }), W = {
      uploadId: E,
      request: I,
      fileStream: q,
      sender: n.sender,
      totalBytes: Math.max(0, S.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    t.set(E, W);
    let Z = !1;
    const ue = (b) => {
      Z || (Z = !0, t.delete(E), y(b));
    }, f = (b) => {
      Z || (Z = !0, t.delete(E), g(b));
    };
    let p = "";
    I.on("response", (b) => {
      b.on("data", (B) => {
        p += B.toString();
      }), b.on("end", () => {
        let B;
        try {
          B = JSON.parse(p);
        } catch {
          B = p;
        }
        ue({
          status: b.statusCode,
          body: B
        });
      });
    }), I.on("error", (b) => {
      if (W.aborted) {
        f(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        q.destroy(b);
      } catch {
      }
      f(b);
    }), I.write(O), I.write(A), q.on("data", (b) => {
      W.aborted || (W.uploadedBytes += b.length, r(W));
    }), q.on("end", () => {
      W.aborted || (r(W, !0), I.write(u), I.end());
    }), q.on("error", (b) => {
      if (W.aborted) {
        f(new Error("UPLOAD_ABORTED"));
        return;
      }
      f(b);
      try {
        I.destroy(b);
      } catch {
      }
    }), q.pipe(I, { end: !1 });
  }));
}
function Fr() {
  Tr(P), Or(P), Ur(P);
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
function Mt(e) {
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
  return Mt(t);
}
async function Nr(e, t) {
  const r = await e(
    Ar(t)
  );
  return Mt(r);
}
async function $r(e, t) {
  return !!await e(
    Lr(t)
  );
}
function Hr(e) {
  P.handle("embedded-browser:open-tab", async (t, r, n) => e.openTab(t.sender, r, n)), P.handle("embedded-browser:activate-tab", (t, r) => e.activateTab(t.sender, r)), P.handle("embedded-browser:navigate", async (t, r, n) => e.navigate(t.sender, r, n)), P.handle("embedded-browser:resolve-favicon", async (t, r) => e.resolveFavicon(r)), P.handle(
    "embedded-browser:open-mapped-file",
    async (t, r, n, o, a) => e.openMappedFile(t.sender, r, n, o, a)
  ), P.handle("embedded-browser:reload", async (t, r) => e.reload(r)), P.handle("embedded-browser:go-back", async (t, r) => e.goBack(r)), P.handle("embedded-browser:go-forward", async (t, r) => e.goForward(r)), P.handle("embedded-browser:resource:list", (t, r) => e.listCapturedResources(r)), P.handle("embedded-browser:resource:start", (t, r) => e.startCapturedResources(r)), P.handle("embedded-browser:resource:stop", (t, r) => e.stopCapturedResources(r)), P.handle("embedded-browser:resource:clear", (t, r) => e.clearCapturedResources(r)), P.handle("embedded-browser:resource:open", async (t, r, n) => e.openResource(r, n)), P.handle("embedded-browser:resource:export", async (t, r, n) => e.exportResource(r, n)), P.handle("embedded-browser:resource:read", async (t, r, n) => e.readResource(r, n)), P.handle(
    "embedded-browser:resource:preview",
    async (t, r, n) => e.previewResource(r, n)
  ), P.handle("embedded-browser:resource:catch-toolkit:get-state", async (t, r) => e.getCatchToolkitState(r)), P.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (t, r, n) => e.updateCatchToolkitState(r, n)
  ), P.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (t, r) => e.clearCatchMediaCache(r)), P.handle("embedded-browser:resource:catch-toolkit:download", async (t, r) => e.downloadCatchMedia(r)), P.handle("embedded-browser:resource:catch-toolkit:restart", async (t, r) => e.restartCatchMediaCapture(r)), P.handle(
    "embedded-browser:resource:merge-mse",
    async (t, r, n) => e.mergeMseResources(r, n)
  ), P.handle("embedded-browser:resource:start-deep-capture", async (t, r) => e.startDeepResourceCapture(r)), P.handle("embedded-browser:set-bounds", (t, r) => e.setBounds(t.sender, r)), P.handle("embedded-browser:close-tab", (t, r) => e.closeTab(t.sender, r)), P.handle("embedded-browser:cleanup-download-file", async (t, r) => e.cleanupDownloadFile(r)), P.handle("embedded-browser:deactivate", (t) => e.deactivate(t.sender)), P.handle("embedded-browser:close-all", (t) => e.closeAll(t.sender));
}
const ve = "persist:omniflow-embedded-browser", zr = "embedded-browser-downloads";
let Ne = null, ct = !1;
function Ot() {
  return R.join(N.getPath("userData"), zr);
}
function jr() {
  const e = Ot();
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
async function _t(e) {
  const t = R.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const r = R.resolve(Ot());
  return t !== r && !t.startsWith(`${r}${R.sep}`) ? !1 : (await De.rm(t, { force: !0 }), !0);
}
function Jr(e) {
  if (ct)
    return;
  ct = !0;
  const t = (o, a, c) => {
    const m = e.resolveTabIdByWebContents(c) || void 0;
    if (!m)
      return;
    const w = jr(), y = Vr(), g = a.getFilename() || "download", S = a.getURL() || "", h = c.getURL() || void 0, E = R.join(w, qr(g));
    a.setSavePath(E), e.emitDownload(Te(a, {
      downloadId: y,
      fileName: g,
      mimeType: a.getMimeType() || void 0,
      pageUrl: h,
      state: "started",
      tabId: m,
      tempPath: E,
      url: S
    })), a.on("updated", (U, O) => {
      O === "progressing" && e.emitDownload(Te(a, {
        downloadId: y,
        fileName: g,
        mimeType: a.getMimeType() || void 0,
        pageUrl: h,
        state: "progress",
        tabId: m,
        tempPath: E,
        url: S
      }));
    }), a.once("done", (U, O) => {
      if (O === "completed") {
        e.emitDownload(Te(a, {
          downloadId: y,
          fileName: g,
          mimeType: a.getMimeType() || void 0,
          pageUrl: h,
          state: "completed",
          tabId: m,
          tempPath: E,
          url: S
        }));
        return;
      }
      _t(E).catch(() => {
      }), e.emitDownload(Te(a, {
        downloadId: y,
        error: O === "cancelled" ? "下载已取消" : `下载失败：${O}`,
        fileName: g,
        mimeType: a.getMimeType() || void 0,
        pageUrl: h,
        state: O === "cancelled" ? "cancelled" : "failed",
        tabId: m,
        tempPath: E,
        url: S
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
function xt(e) {
  const t = ke(e.mimeType), r = Ye(e.url), n = mn(r);
  return n === "manifest" || ln(t) ? "manifest" : n === "media" || fn(t) || e.resourceType === "media" || String(e.url || "").startsWith("blob:") ? "media" : n === "image" || t.startsWith("image/") ? "image" : n === "subtitle" || t.includes("text/vtt") ? "subtitle" : r === "pdf" || t === "application/pdf" ? "document" : n === "key" || e.resourceType === "key" || t === "application/octet-stream" ? "key" : "other";
}
function Dt(e) {
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
function Pt(e) {
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
    const a = String(n || "").trim();
    a && (t[o] = a);
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
function It(e, t, r, n) {
  return n ? `${e}::${t}::${n}` : `${e}::${t}::${r}`;
}
function bn(e, t, r, n) {
  return It(e, t, r, n);
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
function Ut(e, t) {
  const r = Ee(e);
  if (!(r != null && r.enabled))
    return null;
  const n = String(t.url || "").trim();
  if (!n)
    return null;
  const o = String(t.resourceKey || "").trim() || void 0, a = It(e, t.source, n, o), c = r.resources.get(a), m = {
    ...c,
    ...t,
    ext: t.ext || (c == null ? void 0 : c.ext) || Ye(n) || void 0,
    id: bn(e, t.source, n, o),
    kind: t.kind,
    resourceKey: o,
    tabId: e,
    url: n
  };
  return JSON.stringify(c) !== JSON.stringify(m) ? (r.resources.set(a, m), xe == null || xe(m), m) : c || null;
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
function dt(e) {
  Pe.delete(String(e || "").trim());
}
function Rn(e) {
  var t;
  return !!((t = Ee(e)) != null && t.deepCaptureEnabled);
}
const ce = /* @__PURE__ */ new Map();
let ut = !1;
function Bn(e) {
  ut || (ut = !0, wn(e.emitResource), e.browserSession.webRequest.onBeforeSendHeaders((t, r) => {
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
    const o = Xt.fromId(t.webContentsId), a = String(t.url || "").trim(), c = ce.get(t.id), m = ke($e(t.responseHeaders, "content-type")), w = xt({
      mimeType: m,
      resourceType: t.resourceType,
      url: a
    });
    if (!Dt({ kind: w, resourceType: t.resourceType, url: a })) {
      ce.delete(t.id);
      return;
    }
    Ut(r, {
      capturedAt: Date.now(),
      contentLength: gn($e(t.responseHeaders, "content-range")) || pn($e(t.responseHeaders, "content-length")),
      ext: Ye(a) || void 0,
      kind: w,
      method: t.method || void 0,
      mimeType: m,
      pageUrl: (o == null ? void 0 : o.getURL()) || void 0,
      referer: (c == null ? void 0 : c.referer) || t.referrer || void 0,
      requestHeaders: c == null ? void 0 : c.requestHeaders,
      resourceType: t.resourceType || void 0,
      source: "network",
      statusCode: t.statusCode || void 0,
      streamType: Pt({
        mimeType: m,
        resourceType: t.resourceType,
        url: a
      }),
      url: a
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
  const o = t.kind || xt({
    mimeType: t.mimeType,
    resourceType: t.resourceType,
    url: n
  });
  return Dt({ kind: o, resourceType: t.resourceType, url: n }) ? Ut(e, {
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
    streamType: Pt({
      mimeType: t.mimeType,
      resourceType: t.resourceType,
      streamType: t.streamType,
      url: n
    }),
    url: n
  }) : null;
}
function Ft(e) {
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
  const r = Ft(t);
  if (!r)
    return !1;
  const n = e.decisionCache.get(r);
  if (typeof n == "boolean")
    return n;
  const o = j.getFocusedWindow() ?? e.options.getMainWindow() ?? j.getAllWindows()[0] ?? void 0, { response: a } = await te.showMessageBox(o, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${r} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), c = a === 1;
  return e.decisionCache.set(r, c), c;
}
async function xn(e, t) {
  const r = Ft(t.origin);
  if (!r)
    return "deny";
  const n = j.getFocusedWindow() ?? e.getMainWindow() ?? j.getAllWindows()[0] ?? void 0, { response: o } = await te.showMessageBox(n, {
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
  t.setPermissionRequestHandler((r, n, o, a) => {
    if (!On(String(n))) {
      o(!1);
      return;
    }
    _n(e, a.requestingUrl || "").then((c) => {
      o(c);
    }).catch(() => {
      o(!1);
    });
  }), t.on("file-system-access-restricted", (r, n, o) => {
    r.preventDefault(), xn(e.options, n).then((a) => {
      o(a);
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
function kt(e, t) {
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
async function At(e, t) {
  if (!t || t.startsWith("data:"))
    return t;
  try {
    const r = await e.fetch(t);
    if (!r.ok)
      return "";
    const n = St.from(await r.arrayBuffer());
    return n.length === 0 ? "" : `data:${Un(t, r.headers.get("content-type"))};base64,${n.toString("base64")}`;
  } catch (r) {
    return k.warn("embedded browser favicon load failed", {
      error: r instanceof Error ? r.message : String(r),
      iconUrl: t
    }), "";
  }
}
function Fn(e, t) {
  return At(e.webContents.session, t);
}
function kn(e, t) {
  const r = [], n = /<link\b[^>]*>/gi, o = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let a;
  for (; a = n.exec(e); ) {
    const c = a[0], m = /* @__PURE__ */ new Map();
    let w;
    for (o.lastIndex = 0; w = o.exec(c); )
      m.set(w[1].toLowerCase(), w[2] || w[3] || w[4] || "");
    const y = m.get("rel") || "", g = m.get("href") || "";
    if (!g || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(y))
      continue;
    const S = kt(g, t);
    S && r.push(S);
  }
  return r;
}
async function An(e) {
  const t = String((e == null ? void 0 : e.pageUrl) || "").trim(), r = Se.fromPartition(ve), n = [], o = kt(String((e == null ? void 0 : e.iconUrl) || ""), t || void 0);
  if (o && !o.startsWith("data:") && n.push(o), t) {
    try {
      const c = await r.fetch(t), m = c.headers.get("content-type") || "";
      c.ok && /text\/html|application\/xhtml\+xml/i.test(m) && n.push(...kn(await c.text(), t));
    } catch (c) {
      k.warn("embedded browser favicon page inspect failed", {
        error: c instanceof Error ? c.message : String(c),
        pageUrl: t
      });
    }
    try {
      const c = new URL(t).origin;
      n.push(`${c}/favicon.ico`);
    } catch {
    }
  }
  const a = /* @__PURE__ */ new Set();
  for (const c of n) {
    if (!c || a.has(c))
      continue;
    a.add(c);
    const m = await At(r, c);
    if (m)
      return {
        dataUrl: m,
        iconUrl: c
      };
  }
  return {
    dataUrl: o.startsWith("data:") ? o : "",
    iconUrl: ""
  };
}
const Ln = "embedded-browser-open-files", lt = 'input[data-omniflow-browser-open-fallback="true"]';
function Lt() {
  return R.join(N.getPath("userData"), Ln);
}
function Wn() {
  const e = Lt();
  return Fe(e) || Je(e, { recursive: !0 }), e;
}
function Nn(e) {
  const t = String(e).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${t}`;
}
function $n(e, t) {
  const r = R.resolve(e), n = R.resolve(t);
  return r === n ? !0 : r.startsWith(`${n}${R.sep}`);
}
async function Hn(e) {
  const t = await e.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${lt}')
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
      return '${lt}'
    })()
  `, !0);
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
async function zn(e, t, r) {
  var m;
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
  }), o = Number(((m = n == null ? void 0 : n.root) == null ? void 0 : m.nodeId) || 0);
  if (!Number.isFinite(o) || o <= 0)
    return !1;
  const a = await e.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: o,
    selector: t
  }), c = Number((a == null ? void 0 : a.nodeId) || 0);
  return !Number.isFinite(c) || c <= 0 ? !1 : (await e.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: c,
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
  const n = Wn(), o = R.join(n, Nn(t));
  return await Xe(e, o, r), o;
}
async function Ie(e) {
  const t = R.resolve(String(e || "").trim());
  if (!t)
    return !1;
  const r = R.resolve(Lt());
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
function ft(e) {
  return e.requestVersions.get(e.tabId) === e.version;
}
function Kn(e, t) {
  try {
    const r = new URL(e), n = new URL(t);
    if (r.origin !== n.origin)
      return !1;
    const o = r.pathname.replace(/\/+$/, "") || "/", a = n.pathname.replace(/\/+$/, "") || "/";
    return a === "/" ? !0 : o === a || o.startsWith(`${a}/`);
  } catch {
    return !1;
  }
}
async function mt(e) {
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
async function pt(e, t, r) {
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
          const D = u.buffered.end(u.buffered.length - 1), V = Math.max(D - 5, 0), I = Number.isFinite(u.duration) ? u.duration : 0;
          if (I > 0 && D >= I)
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
    const C = window.setInterval(() => {
      if (autoRestartHandledMediaElements.has(u) || !catchToolkitState.restartAlwaysFromBeginning) {
        window.clearInterval(C);
        return;
      }
      u.paused || (s(), window.clearInterval(C));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(C);
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
        s.addedNodes.forEach((C) => {
          if (C instanceof Element) {
            if (C instanceof HTMLMediaElement) {
              e(C);
              return;
            }
            C.querySelectorAll("video, audio").forEach((D) => {
              D instanceof HTMLMediaElement && e(D);
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
        u = u || s.buffers.length > 0, s.buffers = [], s.bufferCount = 0, s.lastReportedBufferCount = 0, s.lastReportedBytes = 0, s.totalBytes = 0, m(s.streamId);
        return;
      }
      if (s.buffers.length > 1) {
        const C = s.buffers[0];
        s.buffers = C ? [C] : [], s.bufferCount = s.buffers.length, s.totalBytes = (C == null ? void 0 : C.byteLength) || 0, s.lastReportedBufferCount = s.bufferCount, s.lastReportedBytes = s.totalBytes, u = !0, m(s.streamId);
      }
    }), isCaptureComplete = !1, u;
  }
  function o() {
    if (typeof document > "u")
      return !1;
    const u = Array.from(mseStreams.values()).filter((C) => C.buffers.length > 0);
    if (u.length === 0)
      return !1;
    const s = resolveCatchToolkitFileName();
    return u.forEach((C) => {
      const D = normalizeBuffersForPlayback(C.buffers), V = new Blob(D, { type: C.mimeType }), I = document.createElement("a"), q = URL.createObjectURL(V), W = guessExtensionFromMimeType(C.mimeType, C.streamType), Z = u.length > 1 && C.streamType ? `-${C.streamType}` : "";
      I.href = q, I.download = `${s}${Z}.${W}`, I.click(), I.remove(), setTimeout(() => {
        URL.revokeObjectURL(q);
      }, 1e3);
    }), catchToolkitState.clearCacheOnComplete && setTimeout(() => {
      n();
    }, 0), !0;
  }
  function a() {
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
  function c(u) {
    return `mse-stream:${u}`;
  }
  function m(u) {
    const s = mseStreams.get(u);
    s && emit({
      contentLength: s.totalBytes,
      ext: guessExtensionFromMimeType(s.mimeType, s.streamType),
      kind: "media",
      mimeType: s.mimeType,
      resourceKey: c(u),
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
      const C = normalizeBuffersForPlayback(s.buffers);
      return s.blobUrl = URL.createObjectURL(new Blob(C, { type: s.mimeType })), m(u), !0;
    } catch {
      return !1;
    }
  }
  function y(u) {
    const s = mseStreams.get(u);
    return s ? (s.blobUrl || w(u), s.blobUrl) : "";
  }
  function g(u) {
    const s = mseStreams.get(u);
    if (!s)
      return "media.bin";
    const C = resolveCatchToolkitFileName(), D = s.streamType ? `-${s.streamType}` : "", V = guessExtensionFromMimeType(s.mimeType, s.streamType);
    return `${C}${D}.${V}`;
  }
  function S(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), C = y(s);
    if (!C || typeof document > "u")
      return !1;
    const D = document.createElement("a");
    return D.href = C, D.download = g(s), D.click(), D.remove(), catchToolkitState.clearCacheOnComplete && setTimeout(() => {
      n();
    }, 0), !0;
  }
  function h(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), C = y(s);
    return !C || !openWindow ? !1 : (openWindow(C, "_blank", "noopener,noreferrer"), !0);
  }
  async function E(u) {
    const s = String(u || "").replace(/^mse-stream:/, ""), C = mseStreams.get(s);
    if (!C || C.buffers.length === 0)
      return null;
    try {
      const D = normalizeBuffersForPlayback(C.buffers), I = await new Blob(D, { type: C.mimeType }).arrayBuffer();
      return {
        base64: arrayBufferToBase64(I),
        fileName: g(s),
        mimeType: C.mimeType,
        resourceKey: u,
        streamType: C.streamType
      };
    } catch {
      return null;
    }
  }
  function U(u) {
    const s = probeResources.get(u);
    return !(s != null && s.blobUrl) || !openWindow ? !1 : (openWindow(s.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function O(u) {
    const s = probeResources.get(u);
    if (!(s != null && s.blobUrl) || typeof document > "u")
      return !1;
    const C = document.createElement("a");
    return C.href = s.blobUrl, C.download = s.fileName, C.click(), C.remove(), !0;
  }
  function A(u) {
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
      return s.startsWith("mse-stream:") ? S(s) : s.startsWith("probe-resource:") ? O(s) : !1;
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
      return s.startsWith("mse-stream:") ? E(s) : s.startsWith("probe-resource:") ? A(s) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return a();
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
  function o(y) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(y) || "").trim();
    } catch {
      return "";
    }
  }
  function a(y, g = !1) {
    try {
      return typeof localStorage > "u" ? g : localStorage.getItem(y) === "checked";
    } catch {
      return g;
    }
  }
  function c(y) {
    var S;
    const g = String(y || "").trim();
    if (!g)
      return {
        rule: "",
        warning: ""
      };
    if (typeof document > "u")
      return {
        rule: g,
        warning: ""
      };
    try {
      const h = document.querySelector(g), E = ((S = h == null ? void 0 : h.textContent) == null ? void 0 : S.trim()) || "";
      return {
        rule: g,
        warning: E ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function m(y) {
    const g = String(y || "").trim();
    if (!g)
      return {
        rule: "",
        warning: ""
      };
    try {
      return new RegExp(g, "g"), {
        rule: g,
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
    t || (n.autoDownloadOnComplete = a(
      r.autoDownloadOnComplete,
      n.autoDownloadOnComplete
    ), n.autoSeekToBufferedEnd = a(
      r.autoSeekToBufferedEnd,
      n.autoSeekToBufferedEnd
    ), n.clearCacheOnComplete = a(
      r.clearCacheOnComplete,
      n.clearCacheOnComplete
    ), n.manualFileName = o(r.manualFileName), n.restartAlwaysFromBeginning = a(
      r.restartAlwaysFromBeginning,
      n.restartAlwaysFromBeginning
    ), n.trimExtraMediaHeaders = a(
      r.trimExtraMediaHeaders,
      n.trimExtraMediaHeaders
    ), n.selectorRule = c(
      o(r.selectorRule)
    ).rule, n.regexRule = m(
      o(r.regexRule)
    ).rule);
  }
  w();
}
function to() {
  var Z, ue;
  const e = globalScope.Worker;
  typeof e == "function" && (globalScope.Worker = new Proxy(e, {
    construct(f, p, b) {
      const [B, T] = p, x = () => {
        const X = typeof B == "string" ? B : String(B), oe = toAbsoluteUrl(X) || X;
        if (!oe)
          return "";
        const Y = createProbeBootstrapSource(consolePrefix);
        let ae = "";
        if ((T == null ? void 0 : T.type) === "module")
          ae = `${Y}import ${JSON.stringify(oe)};
`;
        else {
          const ee = new XMLHttpRequest();
          if (ee.open("GET", oe, !1), ee.send(), ee.status < 200 || ee.status >= 300 || !ee.responseText)
            return "";
          ae = `${Y}${ee.responseText}`;
        }
        return URL.createObjectURL(new Blob([ae], { type: "text/javascript" }));
      };
      let _ = "";
      try {
        _ = x();
      } catch {
        _ = "";
      }
      const $ = _ ? Reflect.construct(f, [_, T], b) : Reflect.construct(f, p, b);
      return $.addEventListener("message", (X) => {
        consumeWorkerRelayMessage(X.data) && X.stopImmediatePropagation();
      }, { capture: !0 }), _ && setTimeout(() => {
        URL.revokeObjectURL(_);
      }, 6e4), $;
    }
  }), globalScope.Worker.toString = function() {
    return e.toString();
  });
  const t = globalScope.MediaSource;
  if ((Z = t == null ? void 0 : t.prototype) != null && Z.addSourceBuffer) {
    const f = t.prototype.addSourceBuffer;
    t.prototype.addSourceBuffer = new Proxy(f, {
      apply(p, b, B) {
        var x;
        const T = Reflect.apply(p, b, B);
        try {
          ensureTrackedMediaObserver(), isCaptureComplete = !1;
          const _ = b, $ = String((B == null ? void 0 : B[0]) || "").trim(), X = ((x = $.split(";")[0]) == null ? void 0 : x.trim().toLowerCase()) || "", oe = X.startsWith("audio/") ? "audio" : X.startsWith("video/") ? "video" : void 0, Y = `${Date.now()}-${++mseSequence}`, ae = mediaSourceStreams.get(_) || [];
          if (ae.push(Y), mediaSourceStreams.set(_, ae), mseStreams.set(Y, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: $ || (oe === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: Y,
            streamType: oe,
            totalBytes: 0
          }), emitMseStream(Y), T && typeof T.appendBuffer == "function") {
            const ee = T.appendBuffer;
            T.appendBuffer = new Proxy(ee, {
              apply(Le, We, fe) {
                const ge = Reflect.apply(Le, We, fe), K = mseStreams.get(Y);
                if (!K)
                  return ge;
                const ie = cloneChunk(fe == null ? void 0 : fe[0]);
                return !ie || ie.byteLength === 0 || (K.buffers.push(ie), K.bufferCount += 1, K.totalBytes += ie.byteLength, (K.bufferCount <= 3 || K.bufferCount - K.lastReportedBufferCount >= 8 || K.totalBytes - K.lastReportedBytes >= 1024 * 512) && (K.lastReportedBufferCount = K.bufferCount, K.lastReportedBytes = K.totalBytes, emitMseStream(Y))), ge;
              }
            });
          }
        } catch {
        }
        return T;
      }
    });
  }
  if ((ue = t == null ? void 0 : t.prototype) != null && ue.endOfStream) {
    const f = t.prototype.endOfStream;
    t.prototype.endOfStream = new Proxy(f, {
      apply(p, b, B) {
        const T = Reflect.apply(p, b, B);
        try {
          if (isCaptureComplete = !0, (mediaSourceStreams.get(b) || []).forEach((_) => {
            finalizeMseStream(_);
          }), catchToolkitState.autoDownloadOnComplete)
            return setTimeout(() => {
              downloadCatchMediaInternal();
            }, 500), T;
          catchToolkitState.clearCacheOnComplete && setTimeout(() => {
            clearCatchMediaCacheInternal();
          }, 0);
        } catch {
        }
        return T;
      }
    });
  }
  function r(f, p) {
    if (typeof f != "string")
      return;
    const b = f.trim();
    if (!b || emitKeyCandidateFromBase64(b))
      return;
    const B = b.split("").join("").trim();
    if (emitKeyCandidateFromHex(B))
      return;
    if (dataUrlPattern.test(b)) {
      const $ = decodeDataUrlText(b);
      $ && r($, p);
      return;
    }
    const T = parseMaybeJson(b);
    if (T) {
      if (emitVimeoPlaylistManifest((p == null ? void 0 : p.baseUrl) || currentLocationHref, T))
        return;
      n(T, 0, /* @__PURE__ */ new WeakSet(), [], (p == null ? void 0 : p.baseUrl) || currentLocationHref);
      return;
    }
    const x = b.toUpperCase();
    if (x.startsWith("#EXTM3U") || x.includes("#EXTINF:")) {
      emitInlineManifest(b, "m3u8", p == null ? void 0 : p.baseUrl);
      return;
    }
    if (b.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || b.includes("<MPD") && b.includes("</MPD>")) {
      emitInlineManifest(b, "mpd", p == null ? void 0 : p.baseUrl);
      return;
    }
    const _ = toAbsoluteUrl(b);
    _ && (registerManifestBaseUrl(_), emit({
      kind: classifyKind(_, p == null ? void 0 : p.mimeType),
      mimeType: p == null ? void 0 : p.mimeType,
      resourceType: p == null ? void 0 : p.resourceType,
      source: "probe",
      streamType: p == null ? void 0 : p.streamType,
      url: _
    }));
  }
  function n(f, p = 0, b = /* @__PURE__ */ new WeakSet(), B = [], T = currentLocationHref) {
    if (p > 6 || f == null)
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
        baseUrl: T,
        resourceType: "json",
        streamType: inferStreamTypeFromPath(B)
      });
      return;
    }
    if (typeof f != "object")
      return;
    const x = f;
    if (!b.has(x)) {
      if (b.add(x), Array.isArray(f)) {
        if (f.length === 16 && f.every((_) => typeof _ == "number" && Number.isFinite(_) && _ >= 0 && _ <= 255)) {
          emitKeyCandidateFromBuffer(Uint8Array.from(f).buffer);
          return;
        }
        f.slice(0, 80).forEach((_, $) => {
          n(_, p + 1, b, B.concat(String($)), T);
        });
        return;
      }
      Object.keys(f).slice(0, 80).forEach((_) => {
        n(f[_], p + 1, b, B.concat(_), T);
      });
    }
  }
  const o = typeof globalScope.fetch == "function" ? globalScope.fetch.bind(globalScope) : null;
  o && (globalScope.fetch = async function(f, p) {
    const b = typeof f == "string" ? f : f instanceof Request ? f.url : String(f);
    r(b, { resourceType: "fetch" });
    const B = await o(f, p);
    return r(B.url || b, {
      mimeType: B.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), B.clone().arrayBuffer().then((x) => {
      if (!x.byteLength || emitKeyCandidateFromBuffer(x))
        return;
      const _ = new TextDecoder().decode(x);
      _.trim() && r(_, {
        baseUrl: B.url || b,
        mimeType: B.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), B;
  }, globalScope.fetch.toString = function() {
    return o.toString();
  });
  const a = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", c = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(f, p) {
    return this[a] = typeof p == "string" ? p : String(p), c.apply(this, arguments);
  };
  const m = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const f = this[a], p = this.responseURL || (typeof f == "string" ? f : "");
      if (r(p, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (emitKeyCandidateFromBuffer(this.response))
          return;
        const b = new TextDecoder().decode(this.response);
        b && r(b, {
          baseUrl: p,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        r(this.response, {
          baseUrl: p,
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
        baseUrl: p,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), m.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return c.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return m.toString();
  }, JSON.parse = function() {
    const f = originalJSONParse.apply(this, arguments);
    return n(f), f;
  }, JSON.parse.toString = function() {
    return originalJSONParse.toString();
  };
  const w = btoa;
  globalScope.btoa = function(f) {
    const p = w.apply(this, arguments);
    return emitKeyCandidateFromBase64(p), r(f, { baseUrl: currentLocationHref, resourceType: "btoa" }), p;
  }, btoa.toString = function() {
    return w.toString();
  };
  const y = atob;
  globalScope.atob = function(f) {
    const p = y.apply(this, arguments);
    return emitKeyCandidateFromBase64(f), r(p, { baseUrl: currentLocationHref, resourceType: "atob" }), p;
  }, atob.toString = function() {
    return y.toString();
  };
  const g = String.fromCharCode;
  String.fromCharCode = new Proxy(g, {
    apply(f, p, b) {
      const B = Reflect.apply(f, p, b);
      if (B.length >= 7) {
        if ((B.startsWith("#EXTM3U") || B.includes("#EXTINF:")) && (m3u8Accumulator += B, m3u8Accumulator.includes("#EXT-X-ENDLIST"))) {
          const x = m3u8Accumulator.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          emitInlineManifest(x, "m3u8", currentLocationHref), m3u8Accumulator = "";
        }
        const T = B.split("").join("").trim();
        emitKeyCandidateFromHex(T);
      }
      return B;
    }
  }), String.fromCharCode.toString = function() {
    return g.toString();
  };
  const S = Array.prototype.slice;
  Array.prototype.slice = function() {
    const f = S.apply(this, arguments);
    return Array.isArray(f) && f.length === 16 && f.every((p) => typeof p == "number" && Number.isFinite(p) && p >= 0 && p <= 255) && emitKeyCandidateFromBuffer(Uint8Array.from(f).buffer), f;
  }, Array.prototype.slice.toString = function() {
    return S.toString();
  };
  const h = Array.prototype.join;
  Array.prototype.join = function() {
    const f = h.apply(this, arguments);
    return typeof f == "string" && ((f.startsWith("#EXTM3U") || f.includes("#EXTINF:")) && r(f, { baseUrl: currentLocationHref, resourceType: "array-join" }), emitKeyCandidateFromBase64(f)), f;
  }, Array.prototype.join.toString = function() {
    return h.toString();
  };
  const E = globalScope.DataView;
  if (typeof E == "function") {
    const f = function(p, b, B) {
      const T = new E(p, b, B), x = () => {
        const _ = T.buffer.slice(T.byteOffset, T.byteOffset + T.byteLength);
        emitKeyCandidateFromBuffer(_);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((_) => {
        const $ = T[_];
        typeof $ == "function" && (T[_] = function() {
          const X = $.apply(this, arguments);
          return x(), X;
        });
      }), x(), T;
    };
    f.prototype = E.prototype, f.toString = function() {
      return E.toString();
    }, globalScope.DataView = f;
  }
  function U(f) {
    return new Proxy(f, {
      construct(p, b, B) {
        const T = Reflect.construct(p, b, B);
        try {
          if (isEmittingKeyCandidate)
            return T;
          const x = b == null ? void 0 : b[0];
          if (Array.isArray(x) && x.length === 16 && x.every(($) => typeof $ == "number" && Number.isFinite($) && $ >= 0 && $ <= 255))
            return emitKeyCandidateFromBuffer(new A(x).buffer), T;
          if (x instanceof ArrayBuffer && x.byteLength === 16)
            return emitKeyCandidateFromBuffer(x), T;
          T.byteLength === 16 && (p.name === "Uint32Array" && T.length === 4 ? emitKeyCandidateFromBuffer(uint32ArrayToUint8Array(T).buffer) : p.name === "Uint16Array" && T.length === 8 ? emitKeyCandidateFromBuffer(uint16ArrayToUint8Array(T).buffer) : emitKeyCandidateFromBuffer(T.buffer.slice(T.byteOffset, T.byteOffset + T.byteLength)));
        } catch {
        }
        return T;
      }
    });
  }
  const O = globalScope.Int8Array, A = globalScope.Uint8Array, u = globalScope.Uint16Array, s = globalScope.Uint32Array;
  typeof O == "function" && (globalScope.Int8Array = U(O), globalScope.Int8Array.toString = function() {
    return O.toString();
  }), typeof A == "function" && (globalScope.Uint8Array = U(A), globalScope.Uint8Array.toString = function() {
    return A.toString();
  }), typeof u == "function" && (globalScope.Uint16Array = U(u), globalScope.Uint16Array.toString = function() {
    return u.toString();
  }), typeof s == "function" && (globalScope.Uint32Array = U(s), globalScope.Uint32Array.toString = function() {
    return s.toString();
  });
  const C = typeof globalScope.escape == "function" ? globalScope.escape.bind(globalScope) : null;
  C && (globalScope.escape = function(f) {
    return emitKeyCandidateFromBase64(f), C.apply(this, arguments);
  }, globalScope.escape.toString = function() {
    return C.toString();
  });
  function D(f) {
    return function() {
      const p = f.apply(this, arguments);
      return (p == null ? void 0 : p.byteLength) === 16 && emitKeyCandidateFromBuffer(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)), p;
    };
  }
  const V = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = D(V), Int8Array.prototype.subarray.toString = function() {
    return V.toString();
  };
  const I = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = D(I), Uint8Array.prototype.subarray.toString = function() {
    return I.toString();
  };
  const q = String.prototype.indexOf;
  String.prototype.indexOf = function(f, p) {
    const b = q.apply(this, arguments);
    if (f === "#EXTM3U" && b !== -1) {
      const B = String(this);
      r(B.slice(Math.max(p ?? 0, 0)), {
        baseUrl: currentLocationHref,
        resourceType: "string-indexof"
      });
    }
    return b;
  }, String.prototype.indexOf.toString = function() {
    return q.toString();
  };
  function W() {
    if (!(isWorkerScope || typeof document > "u"))
      try {
        const f = [
          /["']((?:(?:https?:)?\/\/)?[^"'\s]*?\.(?:m3u8|mp4|flv)(?:\?[^"'\s]*)?)["']/gi
        ];
        document.querySelectorAll("script:not([src])").forEach((p) => {
          const b = p.textContent || "";
          b && f.forEach((B) => {
            let T = B.exec(b);
            for (; T; ) {
              const x = String(T[1] || T[0] || "").replace(/['"]/g, "").trim(), _ = x && !/^https?:\/\//i.test(x) && x.startsWith("//") ? `${currentLocationProtocol}${x}` : x;
              r(_, {
                baseUrl: currentLocationHref,
                resourceType: "inline-script"
              }), T = B.exec(b);
            }
          });
        });
      } catch {
      }
  }
  !isWorkerScope && typeof document < "u" && (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", W, { once: !0 }) : setTimeout(W, 0));
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
function ao(e) {
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
    const a = await In(r, e.debugEnabled);
    e.emitTabState(e.tabId, r, {
      details: "did-stop-loading",
      ...a.length ? { meta: a } : {},
      state: "ready",
      url: o || void 0
    });
  }), r.webContents.on("did-navigate", (o, a) => {
    e.currentUrls.set(e.tabId, a), e.emitTabState(e.tabId, r, { details: "did-navigate", state: "ready", url: a }), e.tryDispatchPendingOpenFile(e.tabId, r);
  }), r.webContents.on("did-navigate-in-page", (o, a) => {
    e.currentUrls.set(e.tabId, a), e.emitTabState(e.tabId, r, { details: "did-navigate-in-page", state: "ready", url: a }), e.tryDispatchPendingOpenFile(e.tabId, r);
  }), r.webContents.on("page-title-updated", (o, a) => {
    e.emitTabState(e.tabId, r, {
      details: "page-title-updated",
      state: "ready",
      title: a || void 0,
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("page-favicon-updated", (o, a) => {
    const c = a.map((m) => String(m || "").trim()).find((m) => m) || "";
    c && Fn(r, c).then((m) => {
      !m || r.webContents.isDestroyed() || (e.iconSourceUrls.set(e.tabId, c), e.iconUrls.set(e.tabId, m), e.emitTabState(e.tabId, r, {
        details: "page-favicon-updated",
        iconSourceUrl: c,
        iconUrl: m,
        state: "ready",
        url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
      }));
    });
  }), r.webContents.on("did-fail-load", (o, a, c, m) => {
    a !== -3 && e.emitTabState(e.tabId, r, {
      details: `did-fail-load(${a})`,
      state: "error",
      message: `页面加载失败：${c || "未知错误"}`,
      url: m
    });
  }), r.webContents.on("render-process-gone", (o, a) => {
    e.emitTabState(e.tabId, r, {
      details: `render-process-gone:${a.reason}`,
      state: "error",
      message: `页面渲染进程异常退出：${a.reason}`,
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.on("console-message", (o, a, c, m, w) => {
    if (typeof c == "string" && c.startsWith(qe)) {
      const y = c.slice(qe.length);
      try {
        e.onProbePayload(JSON.parse(y));
      } catch (g) {
        k.warn("embedded browser resource payload parse failed", {
          error: g instanceof Error ? g.message : String(g),
          tabId: e.tabId
        });
      }
      return;
    }
    e.debugEnabled && a >= 2 && e.emitTabState(e.tabId, r, {
      details: `console:${w}:${m}`,
      state: "ready",
      message: c,
      meta: [`console-level=${a}`],
      url: e.currentUrls.get(e.tabId) || r.webContents.getURL() || void 0
    });
  }), r.webContents.setWindowOpenHandler(({ url: o }) => (r.webContents.loadURL(o), { action: "deny" })), r;
}
function io(e) {
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
    return k.warn("embedded browser resource probe install failed", {
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
    return await ir(e, er.X_OK), !0;
  } catch {
    return !1;
  }
}
async function lo(e) {
  return new Promise((t) => {
    const r = vt(e, ["-version"], {
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
  const r = Ke(R.parse(e).name), n = Ke(R.parse(t).name);
  return `${r.replace(/-video$/i, "").replace(/_video$/i, "") || n.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function go() {
  return nr(R.join(cr.tmpdir(), "omniflow-resource-merge-"));
}
async function yo(e) {
  e && await ar(e, {
    force: !0,
    recursive: !0
  });
}
async function gt(e, t) {
  const r = R.join(e, Ke(t.fileName));
  return await or(r, St.from(t.base64, "base64")), r;
}
async function bo(e) {
  const t = await fo(e.ffmpegPath);
  if (!t)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const r = await go();
  try {
    const [n, o] = await Promise.all([
      gt(r, e.audio),
      gt(r, e.video)
    ]), a = mo({
      audioPath: n,
      outputPath: e.outputPath,
      videoPath: o
    });
    return await new Promise((m, w) => {
      const y = [], g = [], S = vt(t, a, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      S.stdout.on("data", (h) => {
        y.push(String(h));
      }), S.stderr.on("data", (h) => {
        g.push(String(h));
      }), S.once("error", (h) => {
        w(h);
      }), S.once("exit", (h) => {
        if (h === 0) {
          m({
            commandArgs: a,
            ffmpegPath: t,
            outputPath: e.outputPath,
            stderr: g.join(""),
            stdout: y.join("")
          });
          return;
        }
        w(new Error(g.join("").trim() || `ffmpeg 退出码异常: ${h}`));
      });
    });
  } finally {
    await yo(r).catch(() => {
    });
  }
}
function ho(e) {
  const t = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map(), m = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new Map();
  let y = null, g = null, S = !1;
  function h(i) {
    k.log("[embedded-browser:main]", i);
    const d = e.getMainWindow();
    !d || d.isDestroyed() || d.webContents.send("embedded-browser:state", i);
  }
  function E(i) {
    const d = e.getMainWindow();
    !d || d.isDestroyed() || d.webContents.send("embedded-browser:download", i);
  }
  function U(i) {
    const d = e.getMainWindow();
    !d || d.isDestroyed() || d.webContents.send("embedded-browser:resource", i);
  }
  function O(i) {
    for (const [d, l] of t.entries())
      if (l.webContents === i)
        return d;
    return null;
  }
  function A(i) {
    for (const [d, l] of t.entries())
      if (l.webContents.id === i)
        return d;
    return null;
  }
  function u() {
    S || (S = !0, Dn({
      decisionCache: w,
      options: e
    }));
  }
  function s() {
    Pn({
      emitDownload: E,
      emitResource: U,
      resolveTabIdByWebContents: O,
      resolveTabIdByWebContentsId: A
    });
  }
  function C(i) {
    const d = i.webContents.getTitle().trim();
    if (d)
      return d;
  }
  function D(i, d, l) {
    h({
      canGoBack: d.webContents.canGoBack(),
      canGoForward: d.webContents.canGoForward(),
      iconSourceUrl: l.iconSourceUrl ?? o.get(i),
      iconUrl: l.iconUrl ?? n.get(i),
      tabId: i,
      title: l.title ?? C(d),
      ...l
    });
  }
  function V(i, d, l) {
    D(i, d, {
      state: "ready",
      url: (l == null ? void 0 : l.url) ?? (r.get(i) || d.webContents.getURL() || void 0),
      ...l
    });
  }
  function I(i) {
    const d = t.get(i);
    return !d || d.webContents.isDestroyed() ? (t.delete(i), r.delete(i), n.delete(i), o.delete(i), dt(i), null) : d;
  }
  async function q(i, d) {
    return so(
      i,
      d,
      Rn
    );
  }
  async function W(i, d) {
    const l = String(i || "").trim();
    if (!l)
      return null;
    const v = I(l);
    return !v || v.webContents.isDestroyed() ? null : d((F) => v.webContents.executeJavaScript(F, !0), v);
  }
  async function Z(i, d) {
    const l = String(i || "").trim(), v = String(d.audioResourceKey || "").trim(), M = String(d.videoResourceKey || "").trim();
    if (!l || !v || !M)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const F = await W(
        l,
        async (ot) => Promise.all([
          He(ot, v),
          He(ot, M)
        ])
      ), [L, G] = F || [];
      if (!L || !G)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const le = String(d.suggestedFileName || "").trim() || po(G.fileName, L.fileName), Q = e.getMainWindow(), se = Q && !Q.isDestroyed() ? Q : void 0, ye = {
        defaultPath: R.join(N.getPath("downloads"), le),
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
        audio: L,
        ffmpegPath: d.ffmpegPath,
        outputPath: me.filePath,
        video: G
      });
      return {
        ffmpegPath: nt.ffmpegPath,
        ok: !0,
        outputPath: nt.outputPath
      };
    } catch (F) {
      return k.warn("embedded browser resource merge failed", {
        audioResourceKey: v,
        error: F instanceof Error ? F.message : String(F),
        tabId: l,
        videoResourceKey: M
      }), {
        error: F instanceof Error ? F.message : String(F),
        ok: !1
      };
    }
  }
  function ue(i) {
    i.setBounds(g ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function f(i) {
    if (!y)
      return;
    const d = I(y);
    if (!d) {
      y = null;
      return;
    }
    i.contentView.children.includes(d) && i.contentView.removeChildView(d), y = null;
  }
  function p(i) {
    const d = e.getMainWindow();
    return !d || d.isDestroyed() ? null : ao({
      createIfMissingProbe: q,
      currentUrls: r,
      debugEnabled: e.debugEnabled,
      emitTabState: D,
      iconSourceUrls: o,
      iconUrls: n,
      onProbePayload: io(i),
      syncBounds: ue,
      tabId: i,
      tryDispatchPendingOpenFile: async (l, v) => mt({
        attachedOpenFiles: c,
        currentUrls: r,
        pendingOpenFiles: a,
        tabId: l,
        view: v
      }),
      views: t
    });
  }
  function b(i, d, l = {}) {
    if (!i || i.isDestroyed())
      return null;
    if (!d)
      return f(i), null;
    const M = l.createIfMissing ?? !1 ? p(d) : I(d);
    return M ? (y && y !== d && f(i), ue(M), i.contentView.children.includes(M) || i.contentView.addChildView(M), y = d, M) : (f(i), null);
  }
  async function B(i, d, l, v, M = !1) {
    if (!i || i.isDestroyed())
      return;
    const F = String(d || "").trim();
    if (!F)
      return;
    const L = b(i, F, { createIfMissing: !0 });
    if (!L || L.webContents.isDestroyed())
      return;
    const G = String(l || "").trim();
    if (!G) {
      D(F, L, {
        state: "ready",
        title: C(L) || "新标签页",
        url: r.get(F) || void 0
      });
      return;
    }
    const le = r.get(F) || L.webContents.getURL();
    if (M && le === G) {
      D(F, L, {
        state: "ready",
        url: le || void 0
      });
      return;
    }
    D(F, L, {
      details: "load-url",
      state: "loading",
      url: G
    });
    try {
      await L.webContents.loadURL(G);
    } catch (Q) {
      const se = Q instanceof Error ? Q.message : String(Q);
      if (se.includes("ERR_ABORTED"))
        return;
      throw D(F, L, {
        details: v,
        state: "error",
        message: `页面加载失败：${se}`,
        url: G
      }), Q;
    }
  }
  function T(i, d) {
    if (!i || i.isDestroyed())
      return;
    const l = String(d || "").trim();
    if (!l)
      return;
    const v = I(l);
    v && (i.contentView.children.includes(v) && i.contentView.removeChildView(v), y === l && (y = null), t.delete(l), r.delete(l), n.delete(l), o.delete(l), dt(l), Be({
      requestVersions: m,
      tabId: l
    }), Re({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: l
    }), v.webContents.isDestroyed() || v.webContents.close({ waitForBeforeUnload: !1 }));
  }
  async function x(i, d, l) {
    const v = j.fromWebContents(i) ?? e.getMainWindow(), M = String(d || "").trim();
    Be({
      requestVersions: m,
      tabId: M
    }), Re({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: M
    });
    const F = String(l || "").trim();
    if (!F) {
      h({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: M,
        title: "新标签页"
      });
      return;
    }
    await B(v, M, F, "open-exception", !0);
  }
  function _(i, d) {
    const l = j.fromWebContents(i) ?? e.getMainWindow();
    b(l, d, { createIfMissing: !1 });
  }
  async function $(i, d, l) {
    const v = j.fromWebContents(i) ?? e.getMainWindow(), M = String(d || "").trim();
    Be({
      requestVersions: m,
      tabId: M
    }), Re({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: M
    }), await B(v, M, l, "navigate-exception");
  }
  async function X(i, d, l, v, M) {
    const F = j.fromWebContents(i) ?? e.getMainWindow(), L = String(d || "").trim(), G = String(l || "").trim(), le = String(v || "").trim(), Q = String(M || "").trim() || "file";
    if (!L || !G || !le)
      return;
    const se = Be({
      requestVersions: m,
      tabId: L
    });
    Re({
      attachedOpenFiles: c,
      pendingOpenFiles: a,
      tabId: L
    });
    const ye = await Vn(le, Q);
    if (!ft({
      requestVersions: m,
      tabId: L,
      version: se
    })) {
      Ie(ye).catch(() => {
      });
      return;
    }
    if (a.set(L, {
      fileName: Q,
      pageUrl: G,
      stagedPath: ye
    }), await B(F, L, G, "navigate-exception"), !ft({
      requestVersions: m,
      tabId: L,
      version: se
    }))
      return;
    const me = I(L);
    me && mt({
      attachedOpenFiles: c,
      currentUrls: r,
      pendingOpenFiles: a,
      tabId: L,
      view: me
    });
  }
  async function oe(i) {
    const d = String(i || "").trim();
    if (!d)
      return;
    const l = I(d);
    !l || l.webContents.isDestroyed() || (D(d, l, {
      details: "reload",
      state: "loading",
      url: r.get(d) || l.webContents.getURL() || void 0
    }), l.webContents.reload(), V(d, l, {
      details: "reload-requested"
    }));
  }
  async function Y(i) {
    const d = String(i || "").trim();
    if (!d)
      return;
    const l = I(d);
    !l || l.webContents.isDestroyed() || (l.webContents.canGoBack() && l.webContents.goBack(), V(d, l, {
      details: "history-back"
    }));
  }
  async function ae(i) {
    const d = String(i || "").trim();
    if (!d)
      return;
    const l = I(d);
    !l || l.webContents.isDestroyed() || (l.webContents.canGoForward() && l.webContents.goForward(), V(d, l, {
      details: "history-forward"
    }));
  }
  async function ee(i, d) {
    return W(i, async (l, v) => {
      try {
        return await pt(l, "openResource", d);
      } catch (M) {
        return k.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: M instanceof Error ? M.message : String(M),
          resourceKey: String(d || "").trim(),
          tabId: String(i || "").trim(),
          url: v.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l);
  }
  async function Le(i, d) {
    return W(i, async (l, v) => {
      try {
        return await pt(l, "exportResource", d);
      } catch (M) {
        return k.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: M instanceof Error ? M.message : String(M),
          resourceKey: String(d || "").trim(),
          tabId: String(i || "").trim(),
          url: v.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((l) => !!l);
  }
  async function We(i, d) {
    return W(i, async (l, v) => {
      try {
        return await He(l, d);
      } catch (M) {
        return k.warn("embedded browser resource read failed", {
          error: M instanceof Error ? M.message : String(M),
          resourceKey: String(d || "").trim(),
          tabId: String(i || "").trim(),
          url: v.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), null;
      }
    });
  }
  async function fe(i, d) {
    return W(i, async (l) => {
      try {
        return await Zn(l, d);
      } catch (v) {
        return k.warn("embedded browser network resource preview failed", {
          error: v instanceof Error ? v.message : String(v),
          tabId: String(i || "").trim(),
          url: String(d.url || "").trim()
        }), !1;
      }
    }).then((l) => !!l);
  }
  async function ge(i) {
    return W(i, async (d, l) => {
      try {
        return await Wr(d);
      } catch (v) {
        return k.warn("embedded browser catch toolkit get state failed", {
          error: v instanceof Error ? v.message : String(v),
          tabId: String(i || "").trim(),
          url: l.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), null;
      }
    });
  }
  async function K(i, d) {
    return W(i, async (l, v) => {
      try {
        return await Nr(l, d);
      } catch (M) {
        return k.warn("embedded browser catch toolkit update state failed", {
          error: M instanceof Error ? M.message : String(M),
          payload: d,
          tabId: String(i || "").trim(),
          url: v.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), null;
      }
    });
  }
  async function ie(i, d, l) {
    return W(i, async (v, M) => {
      try {
        return await $r(v, d);
      } catch (F) {
        return k.warn(`embedded browser catch toolkit ${l} failed`, {
          error: F instanceof Error ? F.message : String(F),
          tabId: String(i || "").trim(),
          url: M.webContents.getURL() || r.get(String(i || "").trim()) || ""
        }), !1;
      }
    }).then((v) => !!v);
  }
  async function rt(i) {
    const d = String(i || "").trim(), l = En(d), v = I(d);
    return v && !v.webContents.isDestroyed() && (v.webContents.getURL() ? v.webContents.reload() : await q(d, v)), l;
  }
  function jt(i, d) {
    const l = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, v = j.fromWebContents(i) ?? e.getMainWindow(), M = v && !v.isDestroyed() ? Math.max(v.webContents.getZoomFactor(), 0.01) : 1;
    if (l.x = Math.max(0, Math.round(d.x * M)), l.y = Math.max(0, Math.round(d.y * M)), l.width = Math.max(0, Math.round(d.width * M)), l.height = Math.max(0, Math.round(d.height * M)), g = l, !y)
      return;
    const F = I(y);
    F && F.setBounds(l);
  }
  function Vt(i, d) {
    const l = j.fromWebContents(i) ?? e.getMainWindow();
    T(l, d);
  }
  async function qt(i) {
    try {
      return await _t(i);
    } catch {
      return !1;
    }
  }
  function Kt(i) {
    const d = j.fromWebContents(i) ?? e.getMainWindow();
    !d || d.isDestroyed() || f(d);
  }
  function Jt(i) {
    const d = j.fromWebContents(i) ?? e.getMainWindow();
    !d || d.isDestroyed() || (Array.from(t.keys()).forEach((l) => {
      T(d, l);
    }), y = null, h({ state: "idle" }));
  }
  function Gt() {
    Hr({
      activateTab: _,
      cleanupDownloadFile: qt,
      clearCapturedResources: (i) => Tn(String(i || "").trim()),
      clearCatchMediaCache: (i) => ie(i, "clearCatchMediaCache", "clear cache"),
      closeAll: Jt,
      closeTab: Vt,
      deactivate: Kt,
      downloadCatchMedia: (i) => ie(i, "downloadCatchMedia", "download"),
      exportResource: Le,
      getCatchToolkitState: ge,
      goBack: Y,
      goForward: ae,
      listCapturedResources: (i) => Sn(String(i || "").trim()),
      mergeMseResources: Z,
      navigate: $,
      openMappedFile: X,
      openResource: ee,
      openTab: x,
      previewResource: fe,
      readResource: We,
      reload: oe,
      resolveFavicon: An,
      restartCatchMediaCapture: (i) => ie(i, "restartCatchMediaCapture", "restart"),
      setBounds: jt,
      startCapturedResources: (i) => vn(String(i || "").trim()),
      startDeepResourceCapture: rt,
      stopCapturedResources: (i) => Cn(String(i || "").trim()),
      updateCatchToolkitState: K
    });
  }
  return {
    configureSession: u,
    initializeBridges: s,
    registerIpcHandlers: Gt
  };
}
const wo = 240;
function So(e) {
  P.on("window-minimize", (t) => {
    const r = j.fromWebContents(t.sender) ?? e.getMainWindow();
    r == null || r.minimize();
  }), P.on("window-maximize", (t) => {
    const r = j.fromWebContents(t.sender) ?? e.getMainWindow();
    !r || r.isDestroyed() || (r.isMaximized() ? r.unmaximize() : r.maximize());
  }), P.on("window-close", (t) => {
    const r = j.fromWebContents(t.sender) ?? e.getMainWindow();
    r == null || r.close();
  }), P.handle("window-activate", (t, r = !1) => {
    const n = j.fromWebContents(t.sender) ?? e.getMainWindow();
    return !n || n.isDestroyed() ? !1 : (n.isMinimized() && n.restore(), n.isVisible() || n.show(), process.platform === "darwin" ? N.focus({ steal: !0 }) : N.focus(), typeof n.moveTop == "function" && n.moveTop(), n.focus(), r && !n.isAlwaysOnTop() && (n.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      n.isDestroyed() || n.setAlwaysOnTop(!1);
    }, wo)), !0);
  });
}
const vo = R.dirname(Qt(import.meta.url));
process.env.APP_ROOT = R.join(vo, "..");
const Ue = process.env.VITE_DEV_SERVER_URL, Eo = R.join(process.env.APP_ROOT, "dist-electron"), Wt = R.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Ue ? R.join(process.env.APP_ROOT, "public") : Wt;
const yt = R.join(process.env.APP_ROOT, "build", "icons", "icon.png"), Co = "Omniflow", To = "omniflow-app", Ro = 1400, Bo = 920, Qe = 600, et = 400, Mo = "window-state.json", Oo = 200, _o = process.env.NODE_ENV === "test" || !!(Ue || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", xo = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
xo || (N.commandLine.appendSwitch("disable-logging"), N.commandLine.appendSwitch("log-level", "3"));
N.setName(Co);
try {
  const e = R.join(N.getPath("appData"), To);
  N.setPath("userData", e);
} catch {
}
function Nt() {
  return Fe(yt) ? yt : null;
}
let H = null, $t = !1, Oe = null;
function Ht() {
  return R.join(N.getPath("userData"), Mo);
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
    const e = Ht();
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
      }, n = Ht();
      Je(R.dirname(n), { recursive: !0 }), rr(n, JSON.stringify(r), "utf-8");
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
  getMainWindow: () => H
});
function zt() {
  if (H && !H.isDestroyed())
    return H.show(), H.focus(), H;
  const e = Nt(), t = Io(), r = (t == null ? void 0 : t.width) ?? Ro, n = (t == null ? void 0 : t.height) ?? Bo, o = new j({
    width: r,
    height: n,
    minWidth: Qe,
    minHeight: et,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...de(t == null ? void 0 : t.x) && de(t == null ? void 0 : t.y) ? { x: t.x, y: t.y } : {},
    webPreferences: {
      preload: R.join(Eo, "preload.mjs"),
      devTools: !0
    },
    autoHideMenuBar: !0,
    ...e ? { icon: e } : {}
  });
  return H = o, t != null && t.maximized && o.maximize(), o.on("move", () => {
    _e(o);
  }), o.on("resize", () => {
    _e(o);
  }), o.on("maximize", () => {
    _e(o);
  }), o.on("unmaximize", () => {
    _e(o);
  }), o.on("close", (a) => {
    tt(o), process.platform === "darwin" && !$t && (a.preventDefault(), o.hide());
  }), o.on("closed", () => {
    H === o && (H = null);
  }), o.webContents.setZoomFactor(1), o.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), o.webContents.on("before-input-event", (a, c) => {
    if (Fo(c)) {
      a.preventDefault();
      return;
    }
    Uo(c) && (a.preventDefault(), o.webContents.toggleDevTools());
  }), o.on("app-command", (a, c) => {
    (c === "browser-backward" || c === "browser-forward") && a.preventDefault();
  }), o.on("swipe", (a, c) => {
    (c === "left" || c === "right") && a.preventDefault();
  }), Ue ? o.loadURL(Ue) : o.loadFile(R.join(Wt, "index.html")), o;
}
N.on("before-quit", () => {
  $t = !0, H && !H.isDestroyed() && tt(H);
});
N.on("window-all-closed", () => {
  process.platform !== "darwin" && N.quit();
});
N.on("activate", () => {
  if (H && !H.isDestroyed()) {
    H.isMinimized() && H.restore(), H.show(), H.focus();
    return;
  }
  j.getAllWindows().length === 0 && zt();
});
N.whenReady().then(() => {
  const e = Nt();
  e && process.platform === "darwin" && N.dock.setIcon(e), ze.configureSession(), ze.initializeBridges(), Fr(), So({
    getMainWindow: () => H
  }), ze.registerIpcHandlers(), zt();
});
export {
  Eo as MAIN_DIST,
  Wt as RENDERER_DIST,
  Ue as VITE_DEV_SERVER_URL
};
