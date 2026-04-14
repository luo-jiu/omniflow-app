import { dialog as ue, app as $, net as an, ipcMain as D, session as Ve, webContents as cn, BrowserWindow as q, WebContentsView as un, screen as ln } from "electron";
import { fileURLToPath as dn } from "node:url";
import E from "node:path";
import _t, { existsSync as ut, mkdirSync as Ut, constants as fn, readFileSync as mn, writeFileSync as pn } from "node:fs";
import H from "fs/promises";
import st, { mkdtemp as gn, writeFile as yn, rm as hn, access as wn } from "node:fs/promises";
import hr from "node:http";
import wr from "node:https";
import br from "os";
import kt from "child_process";
import bn from "fs";
import { Buffer as Sr } from "node:buffer";
import { spawn as vr } from "node:child_process";
import Sn from "node:os";
const et = 6e4;
async function Pt(t, e, r = {}, i = 0) {
  const l = new URL(t);
  if (l.protocol !== "http:" && l.protocol !== "https:")
    throw new Error(`不支持的下载协议: ${l.protocol}`);
  const p = l.protocol === "https:" ? wr : hr;
  await st.mkdir(E.dirname(e), { recursive: !0 }), await new Promise((h, v) => {
    let y = !1;
    const b = () => {
      y || (y = !0, h());
    }, B = (_) => {
      y || (y = !0, v(_));
    }, w = p.request({
      protocol: l.protocol,
      hostname: l.hostname,
      port: l.port ? Number(l.port) : void 0,
      path: `${l.pathname}${l.search}`,
      method: "GET",
      headers: r
    }, (_) => {
      _.setTimeout(et, () => {
        _.destroy(new Error(`下载响应超时: ${et}ms`));
      });
      const k = Number(_.statusCode || 0), W = _.headers.location;
      if (k >= 300 && k < 400 && W) {
        if (_.resume(), i >= 3) {
          B(new Error(`下载重定向次数过多: ${t}`));
          return;
        }
        const Y = new URL(W, t).toString();
        Pt(Y, e, r, i + 1).then(b).catch(B);
        return;
      }
      if (k >= 400) {
        _.resume(), B(new Error(`下载失败: HTTP ${k} (${t})`));
        return;
      }
      const re = _t.createWriteStream(e), ne = async (Y) => {
        try {
          re.destroy();
        } catch {
        }
        try {
          await st.rm(e, { force: !0 });
        } catch {
        }
        B(Y);
      };
      _.on("error", (Y) => {
        ne(Y);
      }), re.on("error", (Y) => {
        ne(Y);
      }), re.on("finish", () => b()), _.pipe(re);
    });
    w.setTimeout(et, () => {
      w.destroy(new Error(`下载请求超时: ${et}ms`));
    }), w.on("error", (_) => B(_)), w.end();
  });
}
const vn = "Omniflow Inbox", En = 10 * 60 * 1e3, Tn = 2, Cn = 2e3, Mt = 12, Rn = E.join(
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks"
), He = /* @__PURE__ */ new Map();
function Lt(t) {
  const e = String(t || "");
  return !!(!e || e === ".DS_Store" || e.startsWith("._") || e === "Thumbs.db");
}
function je(t) {
  return t.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}
function Bn(t) {
  const e = String(t || "").toLowerCase();
  return !e || e.startsWith(".") ? !0 : e.endsWith(".crdownload") || e.endsWith(".part") || e.endsWith(".tmp") || e.endsWith(".opdownload") || e.endsWith(".download");
}
function Er() {
  return E.join($.getPath("userData"), "auto-import-staging");
}
function xn() {
  return E.join($.getPath("userData"), "embedded-browser-downloads");
}
function Tr(t, e) {
  const r = E.resolve(t), i = E.resolve(e);
  return r === i ? !0 : r.startsWith(`${i}${E.sep}`);
}
function _n(t) {
  const e = String(t || "unknown").replace(/[/\\]/g, "_").trim() || "unknown";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
async function Mn(t, e) {
  try {
    await H.rename(t, e);
  } catch (r) {
    if ((r == null ? void 0 : r.code) !== "EXDEV")
      throw r;
    await H.copyFile(t, e), await H.rm(t, { force: !0 });
  }
}
function On(t) {
  const e = Date.now();
  for (const [r, i] of He.entries())
    t.has(r) || e - i.lastSeenAt <= En || He.delete(r);
}
async function Dn(t, e = Mt) {
  const r = String(t || "").trim(), i = r ? E.resolve(r) : E.join($.getPath("downloads"), vn), s = await H.stat(i).catch(() => null);
  if (!(s != null && s.isDirectory()))
    return [];
  const l = await H.readdir(i, { withFileTypes: !0 }), p = /* @__PURE__ */ new Set(), h = Date.now(), v = [];
  for (const w of l) {
    if (!w.isFile() || Lt(w.name) || Bn(w.name)) continue;
    const _ = E.join(i, w.name), k = await H.stat(_).catch(() => null);
    if (!(k != null && k.isFile())) continue;
    p.add(_);
    const W = He.get(_), ne = (W ? W.size === k.size && W.mtimeMs === k.mtimeMs : !1) && W ? W.stableCount + 1 : 1;
    He.set(_, {
      size: k.size,
      mtimeMs: k.mtimeMs,
      stableCount: ne,
      lastSeenAt: h
    }), !(ne < Tn) && (h - k.mtimeMs < Cn || v.push({
      sourcePath: _,
      name: w.name,
      size: k.size,
      mtimeMs: k.mtimeMs
    }));
  }
  if (On(p), v.length === 0)
    return [];
  v.sort((w, _) => w.mtimeMs - _.mtimeMs);
  const y = Er();
  await H.mkdir(y, { recursive: !0 });
  const b = [], B = Math.max(1, Math.floor(Number(e) || Mt));
  for (const w of v.slice(0, B)) {
    const _ = E.join(y, _n(w.name));
    try {
      await Mn(w.sourcePath, _);
    } catch {
      continue;
    }
    He.delete(w.sourcePath), b.push({
      name: w.name,
      size: w.size,
      localPath: _,
      relativePath: je(w.name)
    });
  }
  return b;
}
async function Un(t) {
  const e = E.resolve(String(t || "").trim()), r = Er();
  return !e || !Tr(e, r) ? !1 : (await H.rm(e, { force: !0 }), !0);
}
function ar(t, e) {
  const r = je(e || "");
  if (!r)
    return t;
  const i = r.split("/").filter(Boolean);
  for (const s of i) {
    if (s === "." || s === "..")
      throw new Error(`非法下载路径片段: ${s}`);
    if (s.includes("\0"))
      throw new Error("非法下载路径：包含空字符");
  }
  return E.join(t, ...i);
}
function Cr(t, e) {
  return t.relativePath.localeCompare(e.relativePath, "zh-Hans-CN");
}
async function kn(t) {
  return (await Promise.all(t.map(async (r) => {
    const i = await H.stat(r);
    if (!i.isFile())
      return null;
    const s = E.basename(r);
    return Lt(s) ? null : {
      name: s,
      size: i.size,
      localPath: r,
      relativePath: je(s)
    };
  }))).filter((r) => !!r).sort(Cr);
}
async function Pn(t, e, r) {
  const i = [e], s = [];
  for (; i.length > 0; ) {
    const b = i.pop(), B = await H.readdir(b, { withFileTypes: !0 });
    for (const w of B) {
      if (w.name === "." || w.name === ".." || Lt(w.name) || w.isSymbolicLink())
        continue;
      const _ = E.join(b, w.name);
      if (w.isDirectory()) {
        i.push(_);
        continue;
      }
      w.isFile() && s.push({
        absolutePath: _,
        name: w.name
      });
    }
  }
  const l = [], p = 48;
  let h = 0;
  const v = async () => {
    for (; h < s.length; ) {
      const b = h;
      if (h += 1, b >= s.length)
        return;
      const B = s[b], w = await H.stat(B.absolutePath).catch(() => null);
      if (!(w != null && w.isFile()))
        continue;
      const _ = je(E.relative(t, B.absolutePath)), k = je(E.join(r, _));
      l.push({
        name: B.name,
        size: w.size,
        localPath: B.absolutePath,
        relativePath: k
      });
    }
  }, y = Math.min(p, Math.max(1, s.length));
  return await Promise.all(Array.from({ length: y }, () => v())), l;
}
async function Ln(t) {
  const e = [];
  for (const r of t) {
    if (!(await H.stat(r)).isDirectory())
      continue;
    const s = E.basename(r), l = await Pn(r, r, s);
    e.push(...l);
  }
  return e.sort(Cr);
}
function Fn(t) {
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
    const r = e.filePaths[0];
    return {
      canceled: !1,
      content: await H.readFile(r, "utf-8"),
      filePath: r
    };
  }), t.handle("file:save", async (e, r, i) => (await H.writeFile(r, i, "utf-8"), !0)), t.handle("file:read-text", async (e, r) => {
    const i = E.resolve(String(r || "").trim());
    return {
      canceled: !1,
      content: await H.readFile(i, "utf-8"),
      filePath: i
    };
  }), t.handle("file:read-local-chrome-bookmarks", async () => {
    const e = E.join($.getPath("home"), Rn);
    return {
      canceled: !1,
      content: await H.readFile(e, "utf-8"),
      filePath: e
    };
  }), t.handle("dialog:pick-upload-files", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openFile", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await kn(e.filePaths) };
  }), t.handle("dialog:pick-upload-folders", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, files: [] } : { canceled: !1, files: await Ln(e.filePaths) };
  }), t.handle("dialog:pick-download-directory", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("dialog:save-download-file", async (e, r) => {
    const i = await ue.showSaveDialog({
      defaultPath: String(r || "download"),
      showsTagField: !1
    });
    return i.canceled || !i.filePath ? { canceled: !0, filePath: "" } : { canceled: !1, filePath: i.filePath };
  }), t.handle("dialog:pick-auto-import-directory", async () => {
    const e = await ue.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });
    return e.canceled || e.filePaths.length === 0 ? { canceled: !0, directoryPath: "" } : { canceled: !1, directoryPath: e.filePaths[0] };
  }), t.handle("fs:claim-auto-import-files", async (e, r, i = Mt) => ({ canceled: !1, files: await Dn(r, i) })), t.handle("fs:cleanup-auto-import-staged-file", async (e, r) => {
    try {
      return await Un(r);
    } catch {
      return !1;
    }
  }), t.handle("fs:ensure-directory", async (e, r, i = "") => {
    const s = ar(r, i);
    return await H.mkdir(s, { recursive: !0 }), s;
  }), t.handle("fs:download-url-to-path", async (e, r, i, s, l = {}) => {
    const p = ar(i, s);
    return await Pt(r, p, l), p;
  }), t.handle("fs:save-staged-download-file", async (e, r, i) => {
    const s = E.resolve(String(r || "").trim()), l = E.resolve(String(i || "").trim()), p = xn();
    if (!s || !Tr(s, p))
      throw new Error("无效的下载临时文件");
    if (!l)
      throw new Error("无效的保存路径");
    return await H.mkdir(E.dirname(l), { recursive: !0 }), await H.copyFile(s, l), l;
  });
}
var X = {}, me = br;
X.platform = function() {
  return process.platform;
};
X.cpuCount = function() {
  return me.cpus().length;
};
X.sysUptime = function() {
  return me.uptime();
};
X.processUptime = function() {
  return process.uptime();
};
X.freemem = function() {
  return me.freemem() / (1024 * 1024);
};
X.totalmem = function() {
  return me.totalmem() / (1024 * 1024);
};
X.freememPercentage = function() {
  return me.freemem() / me.totalmem();
};
X.freeCommand = function(t) {
  kt.exec("free -m", function(e, r, i) {
    var s = r.split(`
`), l = s[1].replace(/[\s\n\r]+/g, " "), p = l.split(" ");
    total_mem = parseFloat(p[1]), free_mem = parseFloat(p[3]), buffers_mem = parseFloat(p[5]), cached_mem = parseFloat(p[6]), used_mem = total_mem - (free_mem + buffers_mem + cached_mem), t(used_mem - 2);
  });
};
X.harddrive = function(t) {
  kt.exec("df -k", function(e, r, i) {
    var s = 0, l = 0, p = 0, h = r.split(`
`), v = h[1].replace(/[\s\n\r]+/g, " "), y = v.split(" ");
    s = Math.ceil(y[1] * 1024 / Math.pow(1024, 2)), l = Math.ceil(y[2] * 1024 / Math.pow(1024, 2)), p = Math.ceil(y[3] * 1024 / Math.pow(1024, 2)), t(s, p, l);
  });
};
X.getProcesses = function(t, e) {
  typeof t == "function" && (e = t, t = 0), command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n10", t > 0 && (command = "ps -eo pcpu,pmem,time,args | sort -k 1 -r | head -n" + (t + 1)), kt.exec(command, function(r, i, s) {
    var l = i.split(`
`);
    l.shift(), l.pop();
    var p = "";
    l.forEach(function(h, v) {
      var y = h.replace(/[\s\n\r]+/g, " ");
      y = y.split(" "), p += y[1] + " " + y[2] + " " + y[3] + " " + y[4].substring(y[4].length - 25) + `
`;
    }), e(p);
  });
};
X.allLoadavg = function() {
  var t = me.loadavg();
  return t[0].toFixed(4) + "," + t[1].toFixed(4) + "," + t[2].toFixed(4);
};
X.loadavg = function(t) {
  (t === void 0 || t !== 5 && t !== 15) && (t = 1);
  var e = me.loadavg(), r = 0;
  return t == 1 && (r = e[0]), t == 5 && (r = e[1]), t == 15 && (r = e[2]), r;
};
X.cpuFree = function(t) {
  Rr(t, !0);
};
X.cpuUsage = function(t) {
  Rr(t, !1);
};
function Rr(t, e) {
  var r = cr(), i = r.idle, s = r.total;
  setTimeout(function() {
    var l = cr(), p = l.idle, h = l.total, v = p - i, y = h - s, b = v / y;
    t(e === !0 ? b : 1 - b);
  }, 1e3);
}
function cr(t) {
  var e = me.cpus(), r = 0, i = 0, s = 0, l = 0, p = 0, v = 0;
  for (var h in e)
    r += e[h].times.user, i += e[h].times.nice, s += e[h].times.sys, p += e[h].times.irq, l += e[h].times.idle;
  var v = r + i + s + l + p;
  return {
    idle: l,
    total: v
  };
}
const An = process.env.NODE_ENV === "test" || !!(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", ze = (t, ...e) => {
  An && console[t](...e);
}, N = {
  debug: (...t) => ze("debug", ...t),
  info: (...t) => ze("info", ...t),
  log: (...t) => ze("log", ...t),
  warn: (...t) => ze("warn", ...t),
  error: (...t) => ze("error", ...t)
};
function Wn() {
  const t = Nn().total, e = br.cpus()[0].model, r = Math.floor(X.totalmem() / 1024);
  return {
    totalStorage: t,
    cpuModel: e,
    totalMemoryGB: r
  };
}
function Nn() {
  const t = bn.statfsSync(process.platform === "win32" ? "C:" : "/"), e = t.blocks * t.bsize, r = t.bfree * t.bsize;
  return {
    total: Math.floor(e / 1e9),
    // 换算为 GB
    usage: 1 - r / e
    // 使用率计算
  };
}
function In(t) {
  t.handle("sys:get-static-data", Wn);
}
const $n = 10 * 1024 * 1024 * 1024, zn = "10GB", Hn = `上传失败：单文件最大支持 ${zn}`;
function Br(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "");
}
function jn(t) {
  return encodeURIComponent(t).replace(
    /['()*]/g,
    (e) => `%${e.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function Vn(t) {
  const e = Br(t), r = jn(t);
  return `Content-Disposition: form-data; name="file"; filename="${e}"; filename*=UTF-8''${r}\r
`;
}
function Kn(t) {
  const e = /* @__PURE__ */ new Map(), r = (i, s = !1) => {
    const l = Date.now();
    if (!s && l - i.lastProgressAt < 80) return;
    i.lastProgressAt = l;
    const p = Math.max(l - i.startedAt, 1), h = Math.floor(i.uploadedBytes * 1e3 / p), v = i.totalBytes > 0 ? Math.min(i.uploadedBytes / i.totalBytes * 100, 100) : 0;
    i.sender.send("http:upload:progress", {
      uploadId: i.uploadId,
      uploadedBytes: i.uploadedBytes,
      totalBytes: i.totalBytes,
      percentage: v,
      speedBps: h
    });
  };
  t.handle("http:fetch", async (i, s, l = {}) => (N.debug("http:fetch start"), N.debug("http:fetch URL:", s), N.debug("http:fetch options:", l), new Promise((p, h) => {
    const v = an.request({ url: s, method: l.method || "GET" });
    l.headers && Object.entries(l.headers).forEach(([b, B]) => {
      N.debug(`http:fetch set header ${b}: ${String(B)}`), v.setHeader(b, B);
    });
    let y = "";
    v.on("response", (b) => {
      N.debug("http:fetch response"), N.debug("http:fetch status:", b.statusCode), N.debug("http:fetch headers:", b.headers), b.on("data", (B) => {
        N.debug(`http:fetch chunk length: ${B.length}`), y += B;
      }), b.on("end", () => {
        N.debug("http:fetch body preview:", y.slice(0, 500));
        let B;
        try {
          B = JSON.parse(y);
        } catch {
          B = y;
        }
        p({
          status: b.statusCode,
          headers: b.headers,
          body: B
        });
      });
    }), v.on("error", (b) => {
      N.error("http:fetch error:", b), h(b);
    }), l.body && v.write(l.body), v.end();
  }))), t.handle("http:upload:abort", async (i, s) => {
    const l = e.get(s);
    if (!l) return !1;
    l.aborted = !0, e.delete(s);
    try {
      l.fileStream.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    try {
      l.request.destroy(new Error("UPLOAD_ABORTED"));
    } catch {
    }
    return !0;
  }), t.handle("http:upload", async (i, s, l, p = {}, h = {}, v) => new Promise((y, b) => {
    let B;
    try {
      B = _t.statSync(l);
    } catch (P) {
      b(new Error(`读取上传文件失败: ${l} (${String(P)})`));
      return;
    }
    if (!B.isFile()) {
      b(new Error(`上传目标不是文件: ${l}`));
      return;
    }
    if (B.size > $n) {
      b(new Error(Hn));
      return;
    }
    const w = "----WebKitFormBoundary" + Math.random().toString(36).substring(2), _ = v || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, k = E.basename(l), W = Object.entries(p).map(([P, V]) => `--${w}\r
Content-Disposition: form-data; name="${Br(P)}"\r
\r
${V}\r
`).join(""), re = `--${w}\r
` + Vn(k) + `Content-Type: application/octet-stream\r
\r
`, ne = `\r
--${w}--\r
`, Y = Buffer.byteLength(W) + Buffer.byteLength(re) + B.size + Buffer.byteLength(ne), be = {
      ...h,
      "Content-Type": `multipart/form-data; boundary=${w}`,
      "Content-Length": String(Y)
    }, L = new URL(s), F = (L.protocol === "https:" ? wr : hr).request({
      protocol: L.protocol,
      hostname: L.hostname,
      port: L.port ? Number(L.port) : void 0,
      path: `${L.pathname}${L.search}`,
      method: "POST",
      headers: be
    }), oe = _t.createReadStream(l, {
      highWaterMark: 1024 * 1024
    }), j = {
      uploadId: _,
      request: F,
      fileStream: oe,
      sender: i.sender,
      totalBytes: Math.max(0, B.size),
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: !1
    };
    e.set(_, j);
    let pe = !1;
    const ae = (P) => {
      pe || (pe = !0, e.delete(_), y(P));
    }, ie = (P) => {
      pe || (pe = !0, e.delete(_), b(P));
    };
    let A = "";
    F.on("response", (P) => {
      P.on("data", (V) => {
        A += V.toString();
      }), P.on("end", () => {
        let V;
        try {
          V = JSON.parse(A);
        } catch {
          V = A;
        }
        ae({
          status: P.statusCode,
          body: V
        });
      });
    }), F.on("error", (P) => {
      if (j.aborted) {
        ie(new Error("UPLOAD_ABORTED"));
        return;
      }
      try {
        oe.destroy(P);
      } catch {
      }
      ie(P);
    }), F.write(W), F.write(re), oe.on("data", (P) => {
      j.aborted || (j.uploadedBytes += P.length, r(j));
    }), oe.on("end", () => {
      j.aborted || (r(j, !0), F.write(ne), F.end());
    }), oe.on("error", (P) => {
      if (j.aborted) {
        ie(new Error("UPLOAD_ABORTED"));
        return;
      }
      ie(P);
      try {
        F.destroy(P);
      } catch {
      }
    }), oe.pipe(F, { end: !1 });
  }));
}
function qn() {
  Fn(D), In(D), Kn(D);
}
function Gn() {
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
function Jn(t) {
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
function Xn(t) {
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
async function Zn(t) {
  const e = await t(Gn());
  return xr(e);
}
async function Yn(t, e) {
  const r = await t(
    Jn(e)
  );
  return xr(r);
}
async function Qn(t, e) {
  return !!await t(
    Xn(e)
  );
}
function eo(t) {
  D.handle("embedded-browser:open-tab", async (e, r, i) => t.openTab(e.sender, r, i)), D.handle("embedded-browser:activate-tab", (e, r) => t.activateTab(e.sender, r)), D.handle("embedded-browser:navigate", async (e, r, i) => t.navigate(e.sender, r, i)), D.handle("embedded-browser:resolve-favicon", async (e, r) => t.resolveFavicon(r)), D.handle(
    "embedded-browser:open-mapped-file",
    async (e, r, i, s, l) => t.openMappedFile(e.sender, r, i, s, l)
  ), D.handle("embedded-browser:reload", async (e, r) => t.reload(r)), D.handle("embedded-browser:go-back", async (e, r) => t.goBack(r)), D.handle("embedded-browser:go-forward", async (e, r) => t.goForward(r)), D.handle("embedded-browser:resource:list", (e, r) => t.listCapturedResources(r)), D.handle("embedded-browser:resource:start", (e, r) => t.startCapturedResources(r)), D.handle("embedded-browser:resource:stop", (e, r) => t.stopCapturedResources(r)), D.handle("embedded-browser:resource:clear", (e, r) => t.clearCapturedResources(r)), D.handle("embedded-browser:resource:open", async (e, r, i) => t.openResource(r, i)), D.handle("embedded-browser:resource:export", async (e, r, i) => t.exportResource(r, i)), D.handle(
    "embedded-browser:resource:preview",
    async (e, r, i) => t.previewResource(r, i)
  ), D.handle("embedded-browser:resource:catch-toolkit:get-state", async (e, r) => t.getCatchToolkitState(r)), D.handle(
    "embedded-browser:resource:catch-toolkit:update-state",
    async (e, r, i) => t.updateCatchToolkitState(r, i)
  ), D.handle("embedded-browser:resource:catch-toolkit:clear-cache", async (e, r) => t.clearCatchMediaCache(r)), D.handle("embedded-browser:resource:catch-toolkit:download", async (e, r) => t.downloadCatchMedia(r)), D.handle("embedded-browser:resource:catch-toolkit:restart", async (e, r) => t.restartCatchMediaCapture(r)), D.handle(
    "embedded-browser:resource:merge-mse",
    async (e, r, i) => t.mergeMseResources(r, i)
  ), D.handle("embedded-browser:resource:start-deep-capture", async (e, r) => t.startDeepResourceCapture(r)), D.handle("embedded-browser:set-bounds", (e, r) => t.setBounds(e.sender, r)), D.handle("embedded-browser:close-tab", (e, r) => t.closeTab(e.sender, r)), D.handle("embedded-browser:cleanup-download-file", async (e, r) => t.cleanupDownloadFile(r)), D.handle("embedded-browser:deactivate", (e) => t.deactivate(e.sender)), D.handle("embedded-browser:close-all", (e) => t.closeAll(e.sender));
}
const Ke = "persist:omniflow-embedded-browser", to = "embedded-browser-downloads";
let Rt = null, ur = !1;
function _r() {
  return E.join($.getPath("userData"), to);
}
function ro() {
  const t = _r();
  return ut(t) || Ut(t, { recursive: !0 }), t;
}
function no() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function oo(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "download";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function tt(t, e) {
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
function io() {
  return Rt || (Rt = Ve.fromPartition(Ke)), Rt;
}
async function Mr(t) {
  const e = E.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const r = E.resolve(_r());
  return e !== r && !e.startsWith(`${r}${E.sep}`) ? !1 : (await st.rm(e, { force: !0 }), !0);
}
function so(t) {
  if (ur)
    return;
  ur = !0;
  const e = (s, l, p) => {
    const h = t.resolveTabIdByWebContents(p) || void 0;
    if (!h)
      return;
    const v = ro(), y = no(), b = l.getFilename() || "download", B = l.getURL() || "", w = p.getURL() || void 0, _ = E.join(v, oo(b));
    l.setSavePath(_), t.emitDownload(tt(l, {
      downloadId: y,
      fileName: b,
      mimeType: l.getMimeType() || void 0,
      pageUrl: w,
      state: "started",
      tabId: h,
      tempPath: _,
      url: B
    })), l.on("updated", (k, W) => {
      W === "progressing" && t.emitDownload(tt(l, {
        downloadId: y,
        fileName: b,
        mimeType: l.getMimeType() || void 0,
        pageUrl: w,
        state: "progress",
        tabId: h,
        tempPath: _,
        url: B
      }));
    }), l.once("done", (k, W) => {
      if (W === "completed") {
        t.emitDownload(tt(l, {
          downloadId: y,
          fileName: b,
          mimeType: l.getMimeType() || void 0,
          pageUrl: w,
          state: "completed",
          tabId: h,
          tempPath: _,
          url: B
        }));
        return;
      }
      Mr(_).catch(() => {
      }), t.emitDownload(tt(l, {
        downloadId: y,
        error: W === "cancelled" ? "下载已取消" : `下载失败：${W}`,
        fileName: b,
        mimeType: l.getMimeType() || void 0,
        pageUrl: w,
        state: W === "cancelled" ? "cancelled" : "failed",
        tabId: h,
        tempPath: _,
        url: B
      }));
    });
  }, r = /* @__PURE__ */ new Set();
  [Ve.defaultSession, io()].filter(Boolean).forEach((s) => {
    r.has(s) || (r.add(s), s.on("will-download", e));
  });
}
const ao = /* @__PURE__ */ new Set(["m3u8", "mpd"]), co = /* @__PURE__ */ new Set([
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
]), uo = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), lo = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), fo = /* @__PURE__ */ new Set(["key", "base64key"]), mo = /* @__PURE__ */ new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent"
]), at = /* @__PURE__ */ new Map(), he = /* @__PURE__ */ new Map();
let lr = !1, it = null;
function Oe() {
  return {
    deepCaptureEnabled: !1,
    enabled: !1,
    resources: /* @__PURE__ */ new Map()
  };
}
function lt(t) {
  const e = String(t || "").trim();
  if (!e)
    return null;
  const r = at.get(e);
  if (r)
    return r;
  const i = Oe();
  return at.set(e, i), i;
}
function qe(t) {
  const e = String(t || "").trim();
  return e && at.get(e) || null;
}
function Bt(t, e) {
  if (!t)
    return "";
  const r = e.toLowerCase();
  for (const [i, s] of Object.entries(t))
    if (i.toLowerCase() === r)
      return Array.isArray(s) ? String(s[0] || "") : String(s || "");
  return "";
}
function dt(t) {
  var e;
  return ((e = String(t || "").split(";")[0]) == null ? void 0 : e.trim().toLowerCase()) || "";
}
function Ft(t) {
  try {
    const r = new URL(t).pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
    return (r == null ? void 0 : r[1]) || "";
  } catch {
    const e = String(t || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (e == null ? void 0 : e[1]) || "";
  }
}
function Or(t) {
  const e = dt(t.mimeType), r = Ft(t.url);
  return ao.has(r) || e.includes("mpegurl") || e.includes("dash+xml") ? "manifest" : co.has(r) || e.startsWith("video/") || e.startsWith("audio/") || t.resourceType === "media" || String(t.url || "").startsWith("blob:") ? "media" : uo.has(r) || e.startsWith("image/") ? "image" : lo.has(r) || e.includes("text/vtt") ? "subtitle" : r === "pdf" || e === "application/pdf" ? "document" : fo.has(r) || t.resourceType === "key" || e === "application/octet-stream" ? "key" : "other";
}
function Dr(t) {
  return !t.url || t.url.startsWith("data:") ? !1 : t.kind !== "other" ? !0 : t.resourceType === "media" || t.url.startsWith("blob:");
}
function Ur(t, e, r, i) {
  return i ? `${t}::${e}::${i}` : `${t}::${e}::${r}`;
}
function po(t, e, r, i) {
  return Ur(t, e, r, i);
}
function go(t) {
  return Array.from(t.values()).sort((e, r) => r.capturedAt - e.capturedAt);
}
function le(t) {
  return {
    deepCaptureEnabled: t.deepCaptureEnabled,
    enabled: t.enabled,
    resources: go(t.resources)
  };
}
function kr(t, e) {
  const r = qe(t);
  if (!(r != null && r.enabled))
    return null;
  const i = String(e.url || "").trim();
  if (!i)
    return null;
  const s = String(e.resourceKey || "").trim() || void 0, l = Ur(t, e.source, i, s), p = r.resources.get(l), h = {
    ...p,
    ...e,
    ext: e.ext || (p == null ? void 0 : p.ext) || Ft(i) || void 0,
    id: po(t, e.source, i, s),
    kind: e.kind,
    resourceKey: s,
    tabId: t,
    url: i
  };
  return JSON.stringify(p) !== JSON.stringify(h) ? (r.resources.set(l, h), it == null || it(h), h) : p || null;
}
function yo(t) {
  const e = Number(t);
  return Number.isFinite(e) && e > 0 ? e : void 0;
}
function ho(t) {
  const e = String(t || "").trim();
  if (!e)
    return;
  const r = e.match(/\/(\d+)\s*$/);
  if (!(r != null && r[1]))
    return;
  const i = Number(r[1]);
  return Number.isFinite(i) && i > 0 ? i : void 0;
}
function Pr(t) {
  if (t.streamType)
    return t.streamType;
  const e = dt(t.mimeType);
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
function wo(t) {
  if (!t)
    return;
  const e = {};
  return Object.entries(t).forEach(([r, i]) => {
    const s = r.toLowerCase();
    if (!mo.has(s))
      return;
    const l = String(i || "").trim();
    l && (e[s] = l);
  }), Object.keys(e).length ? e : void 0;
}
function bo(t) {
  const e = qe(t);
  return le(e || Oe());
}
function So(t) {
  const e = lt(t);
  return e ? (e.enabled = !0, le(e)) : le(Oe());
}
function vo(t) {
  const e = lt(t);
  return e ? (e.enabled = !0, e.deepCaptureEnabled = !0, le(e)) : le(Oe());
}
function Eo(t) {
  const e = lt(t);
  return e ? (e.enabled = !1, e.deepCaptureEnabled = !1, le(e)) : le(Oe());
}
function To(t) {
  const e = lt(t);
  return e ? (e.resources.clear(), le(e)) : le(Oe());
}
function dr(t) {
  at.delete(String(t || "").trim());
}
function Co(t) {
  var e;
  return !!((e = qe(t)) != null && e.deepCaptureEnabled);
}
function Ro(t, e) {
  const r = qe(t);
  if (!(r != null && r.enabled) || !r.deepCaptureEnabled)
    return null;
  const i = String(e.url || "").trim();
  if (!i)
    return null;
  const s = e.kind || Or({
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    url: i
  });
  return Dr({ kind: s, resourceType: e.resourceType, url: i }) ? kr(t, {
    capturedAt: Number(e.capturedAt) || Date.now(),
    contentLength: e.contentLength,
    ext: e.ext,
    kind: s,
    method: e.method,
    mimeType: dt(e.mimeType),
    pageUrl: e.pageUrl,
    resourceType: e.resourceType,
    resourceKey: e.resourceKey,
    source: e.source || "probe",
    statusCode: e.statusCode,
    streamType: Pr({
      mimeType: e.mimeType,
      resourceType: e.resourceType,
      streamType: e.streamType,
      url: i
    }),
    url: i
  }) : null;
}
function Bo(t) {
  lr || (lr = !0, it = t.emitResource, t.browserSession.webRequest.onBeforeSendHeaders((e, r) => {
    he.set(e.id, {
      referer: e.referrer || void 0,
      requestHeaders: wo(e.requestHeaders)
    }), r({ cancel: !1, requestHeaders: e.requestHeaders });
  }), t.browserSession.webRequest.onCompleted((e) => {
    if (!e.webContentsId) {
      he.delete(e.id);
      return;
    }
    const r = t.resolveTabIdByWebContentsId(e.webContentsId), i = r ? qe(r) : null;
    if (!r || !(i != null && i.enabled)) {
      he.delete(e.id);
      return;
    }
    if (e.statusCode < 200 || e.statusCode >= 400) {
      he.delete(e.id);
      return;
    }
    const s = cn.fromId(e.webContentsId), l = String(e.url || "").trim(), p = he.get(e.id), h = dt(Bt(e.responseHeaders, "content-type")), v = Or({
      mimeType: h,
      resourceType: e.resourceType,
      url: l
    });
    if (!Dr({ kind: v, resourceType: e.resourceType, url: l })) {
      he.delete(e.id);
      return;
    }
    kr(r, {
      capturedAt: Date.now(),
      contentLength: ho(Bt(e.responseHeaders, "content-range")) || yo(Bt(e.responseHeaders, "content-length")),
      ext: Ft(l) || void 0,
      kind: v,
      method: e.method || void 0,
      mimeType: h,
      pageUrl: (s == null ? void 0 : s.getURL()) || void 0,
      referer: (p == null ? void 0 : p.referer) || e.referrer || void 0,
      requestHeaders: p == null ? void 0 : p.requestHeaders,
      resourceType: e.resourceType || void 0,
      source: "network",
      statusCode: e.statusCode || void 0,
      streamType: Pr({
        mimeType: h,
        resourceType: e.resourceType,
        url: l
      }),
      url: l
    }), he.delete(e.id);
  }), t.browserSession.webRequest.onErrorOccurred((e) => {
    he.delete(e.id);
  }));
}
function Lr(t) {
  const e = String(t || "").trim();
  if (!e)
    return "";
  try {
    return new URL(e).origin;
  } catch {
    return "";
  }
}
function xo(t) {
  return t === "fileSystem";
}
async function _o(t, e) {
  const r = Lr(e);
  if (!r)
    return !1;
  const i = t.decisionCache.get(r);
  if (typeof i == "boolean")
    return i;
  const s = q.getFocusedWindow() ?? t.options.getMainWindow() ?? q.getAllWindows()[0] ?? void 0, { response: l } = await ue.showMessageBox(s, {
    type: "question",
    buttons: ["拒绝", "允许"],
    defaultId: 1,
    cancelId: 0,
    title: "允许网页访问本地目录",
    message: `${r} 想要访问你选择的本地目录。`,
    detail: "仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。",
    noLink: !0
  }), p = l === 1;
  return t.decisionCache.set(r, p), p;
}
async function Mo(t, e) {
  const r = Lr(e.origin);
  if (!r)
    return "deny";
  const i = q.getFocusedWindow() ?? t.getMainWindow() ?? q.getAllWindows()[0] ?? void 0, { response: s } = await ue.showMessageBox(i, {
    type: "question",
    buttons: ["换个目录", "允许这次访问", "拒绝"],
    defaultId: 0,
    cancelId: 2,
    title: "网页请求访问受限路径",
    message: `${r} 想要访问受限路径。`,
    detail: String(e.path || ""),
    noLink: !0
  });
  return s === 0 ? "tryAgain" : s === 1 ? "allow" : "deny";
}
function Oo(t) {
  const e = Ve.fromPartition(Ke);
  e.setPermissionRequestHandler((r, i, s, l) => {
    if (!xo(String(i))) {
      s(!1);
      return;
    }
    _o(t, l.requestingUrl || "").then((p) => {
      s(p);
    }).catch(() => {
      s(!1);
    });
  }), e.on("file-system-access-restricted", (r, i, s) => {
    r.preventDefault(), Mo(t.options, i).then((l) => {
      s(l);
    }).catch(() => {
      s("deny");
    });
  });
}
function Do(t) {
  so({
    emitDownload: t.emitDownload,
    resolveTabIdByWebContents: t.resolveTabIdByWebContents
  }), Bo({
    browserSession: Ve.fromPartition(Ke),
    emitResource: t.emitResource,
    resolveTabIdByWebContentsId: t.resolveTabIdByWebContentsId
  });
}
async function Uo(t, e) {
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
function Fr(t, e) {
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
function ko(t, e) {
  var s;
  const r = (s = String(e || "").split(";")[0]) == null ? void 0 : s.trim();
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
async function Ar(t, e) {
  if (!e || e.startsWith("data:"))
    return e;
  try {
    const r = await t.fetch(e);
    if (!r.ok)
      return "";
    const i = Sr.from(await r.arrayBuffer());
    return i.length === 0 ? "" : `data:${ko(e, r.headers.get("content-type"))};base64,${i.toString("base64")}`;
  } catch (r) {
    return N.warn("embedded browser favicon load failed", {
      error: r instanceof Error ? r.message : String(r),
      iconUrl: e
    }), "";
  }
}
function Po(t, e) {
  return Ar(t.webContents.session, e);
}
function Lo(t, e) {
  const r = [], i = /<link\b[^>]*>/gi, s = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let l;
  for (; l = i.exec(t); ) {
    const p = l[0], h = /* @__PURE__ */ new Map();
    let v;
    for (s.lastIndex = 0; v = s.exec(p); )
      h.set(v[1].toLowerCase(), v[2] || v[3] || v[4] || "");
    const y = h.get("rel") || "", b = h.get("href") || "";
    if (!b || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(y))
      continue;
    const B = Fr(b, e);
    B && r.push(B);
  }
  return r;
}
async function Fo(t) {
  const e = String((t == null ? void 0 : t.pageUrl) || "").trim(), r = Ve.fromPartition(Ke), i = [], s = Fr(String((t == null ? void 0 : t.iconUrl) || ""), e || void 0);
  if (s && !s.startsWith("data:") && i.push(s), e) {
    try {
      const p = await r.fetch(e), h = p.headers.get("content-type") || "";
      p.ok && /text\/html|application\/xhtml\+xml/i.test(h) && i.push(...Lo(await p.text(), e));
    } catch (p) {
      N.warn("embedded browser favicon page inspect failed", {
        error: p instanceof Error ? p.message : String(p),
        pageUrl: e
      });
    }
    try {
      const p = new URL(e).origin;
      i.push(`${p}/favicon.ico`);
    } catch {
    }
  }
  const l = /* @__PURE__ */ new Set();
  for (const p of i) {
    if (!p || l.has(p))
      continue;
    l.add(p);
    const h = await Ar(r, p);
    if (h)
      return {
        dataUrl: h,
        iconUrl: p
      };
  }
  return {
    dataUrl: s.startsWith("data:") ? s : "",
    iconUrl: ""
  };
}
function Ao(t, e) {
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
function Wo(t) {
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
function No(t) {
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
async function fr(t, e, r) {
  const i = String(r || "").trim();
  return i ? !!await t(
    Ao(e, i)
  ) : !1;
}
async function Io(t, e) {
  return String(e.url || "").trim() ? !!await t(
    Wo(e)
  ) : !1;
}
async function mr(t, e) {
  const r = String(e || "").trim();
  if (!r)
    return null;
  const i = await t(
    No(r)
  );
  if (!i || typeof i != "object")
    return null;
  const s = i;
  return typeof s.base64 != "string" || typeof s.fileName != "string" ? null : {
    base64: s.base64,
    fileName: s.fileName,
    mimeType: typeof s.mimeType == "string" ? s.mimeType : void 0,
    resourceKey: typeof s.resourceKey == "string" ? s.resourceKey : r,
    streamType: s.streamType === "audio" || s.streamType === "video" ? s.streamType : void 0
  };
}
const Ot = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:";
function $o() {
  return `(${Wr.toString()})(${JSON.stringify(Ot)});`;
}
function Wr(t) {
  var rr, nr, or, ir, sr;
  const e = globalThis, r = typeof document > "u" && typeof e.importScripts == "function", i = typeof ((rr = e.location) == null ? void 0 : rr.href) == "string" ? e.location.href : "", s = typeof ((nr = e.location) == null ? void 0 : nr.hostname) == "string" ? e.location.hostname : "resource", l = typeof ((or = e.location) == null ? void 0 : or.protocol) == "string" ? e.location.protocol : "https:", p = "__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__", h = typeof e.open == "function" ? e.open.bind(e) : null;
  if (e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__)
    return "already-installed";
  const v = /* @__PURE__ */ new Set(), y = /* @__PURE__ */ new Map(), b = /* @__PURE__ */ new Map(), B = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new WeakMap();
  let _ = 0, k = 0;
  const W = /* @__PURE__ */ new Set(["m3u8", "mpd"]), re = /* @__PURE__ */ new Set([
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
  ]), ne = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]), Y = /* @__PURE__ */ new Set(["vtt", "srt", "ass", "ssa", "ttml"]), be = /^data:(application|video|audio)\//i, L = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i, Ce = /(m3u8|mpd)(\?|$)/i, F = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv)(\?|$)/i, oe = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|$)/i, j = /\.(vtt|srt|ass|ssa|ttml)(\?|$)/i, pe = /\.pdf(\?|$)/i, ae = JSON.parse.bind(JSON), ie = typeof console.info == "function" ? console.info.bind(console) : console.log.bind(console), A = {
    autoDownloadOnComplete: "OmniflowCatchToolkit:autoDownloadOnComplete",
    autoSeekToBufferedEnd: "OmniflowCatchToolkit:autoSeekToBufferedEnd",
    clearCacheOnComplete: "OmniflowCatchToolkit:clearCacheOnComplete",
    manualFileName: "OmniflowCatchToolkit:manualFileName",
    regexRule: "OmniflowCatchToolkit:regexRule",
    restartAlwaysFromBeginning: "OmniflowCatchToolkit:restartAlwaysFromBeginning",
    selectorRule: "OmniflowCatchToolkit:selectorRule",
    trimExtraMediaHeaders: "OmniflowCatchToolkit:trimExtraMediaHeaders"
  };
  let P = "", V = !1;
  const T = {
    autoSeekToBufferedEnd: !1,
    autoDownloadOnComplete: !1,
    clearCacheOnComplete: !1,
    manualFileName: "",
    regexRule: "",
    restartAlwaysFromBeginning: !1,
    selectorRule: "",
    trimExtraMediaHeaders: !0
  }, Se = /* @__PURE__ */ new WeakSet(), De = /* @__PURE__ */ new WeakSet();
  let Re = null;
  function ve(n) {
    try {
      return typeof localStorage > "u" ? "" : String(localStorage.getItem(n) || "").trim();
    } catch {
      return "";
    }
  }
  function ge(n, o = !1) {
    try {
      return typeof localStorage > "u" ? o : localStorage.getItem(n) === "checked";
    } catch {
      return o;
    }
  }
  function Ue(n, o) {
    try {
      if (typeof localStorage > "u")
        return;
      const a = String(o || "").trim();
      if (!a) {
        localStorage.removeItem(n);
        return;
      }
      localStorage.setItem(n, a);
    } catch {
    }
  }
  function Ee(n, o) {
    try {
      if (typeof localStorage > "u")
        return;
      localStorage.setItem(n, o ? "checked" : "");
    } catch {
    }
  }
  function ke(n) {
    var a;
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
      const f = document.querySelector(o), g = ((a = f == null ? void 0 : f.textContent) == null ? void 0 : a.trim()) || "";
      return {
        rule: o,
        warning: g ? "" : "表达式暂时没有命中可用内容"
      };
    } catch {
      return {
        rule: "",
        warning: "选择器语法错误"
      };
    }
  }
  function Pe(n) {
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
  function ft() {
    r || (T.autoDownloadOnComplete = ge(
      A.autoDownloadOnComplete,
      T.autoDownloadOnComplete
    ), T.autoSeekToBufferedEnd = ge(
      A.autoSeekToBufferedEnd,
      T.autoSeekToBufferedEnd
    ), T.clearCacheOnComplete = ge(
      A.clearCacheOnComplete,
      T.clearCacheOnComplete
    ), T.manualFileName = ve(A.manualFileName), T.restartAlwaysFromBeginning = ge(
      A.restartAlwaysFromBeginning,
      T.restartAlwaysFromBeginning
    ), T.trimExtraMediaHeaders = ge(
      A.trimExtraMediaHeaders,
      T.trimExtraMediaHeaders
    ), T.selectorRule = ke(
      ve(A.selectorRule)
    ).rule, T.regexRule = Pe(
      ve(A.regexRule)
    ).rule);
  }
  function mt() {
    r || (Ee(
      A.autoDownloadOnComplete,
      T.autoDownloadOnComplete
    ), Ee(
      A.autoSeekToBufferedEnd,
      T.autoSeekToBufferedEnd
    ), Ee(
      A.clearCacheOnComplete,
      T.clearCacheOnComplete
    ), Ue(
      A.manualFileName,
      T.manualFileName
    ), Ue(
      A.regexRule,
      T.regexRule
    ), Ee(
      A.restartAlwaysFromBeginning,
      T.restartAlwaysFromBeginning
    ), Ue(
      A.selectorRule,
      T.selectorRule
    ), Ee(
      A.trimExtraMediaHeaders,
      T.trimExtraMediaHeaders
    ));
  }
  ft();
  function Le() {
    return typeof document > "u" || typeof document.title != "string" ? "" : document.title.trim();
  }
  function Fe() {
    var g, S;
    const n = Te(T.manualFileName);
    if (n !== "media")
      return n;
    let o = "";
    const a = String(T.selectorRule || "").trim();
    if (a && typeof document < "u")
      try {
        const M = document.querySelector(a), K = ((g = M == null ? void 0 : M.textContent) == null ? void 0 : g.trim()) || "";
        K && (o = K);
      } catch {
      }
    const f = String(T.regexRule || "").trim();
    if (f && typeof document < "u")
      try {
        const M = o || ((S = document.documentElement) == null ? void 0 : S.outerHTML) || "";
        if (M) {
          const K = new RegExp(f, "g"), de = Array.from(M.matchAll(K)).flatMap((Z) => Z.length > 1 ? Z.slice(1).filter((fe) => typeof fe == "string" && fe.trim()) : Z[0] ? [Z[0]] : []);
          de.length > 0 && (o = de.join("_"));
        }
      } catch {
      }
    return Te(o || Le() || s || "media");
  }
  function Be(n) {
    if (typeof n != "string")
      return "";
    const o = n.trim();
    if (!o || o.startsWith("data:"))
      return "";
    if (o.startsWith("//"))
      return `${l}${o}`;
    if (o.startsWith("blob:"))
      return o;
    try {
      if (L.test(o))
        return new URL(o, i).toString();
      if (/^https?:\/\//i.test(o))
        return o;
    } catch {
      return "";
    }
    return "";
  }
  function pt(n) {
    try {
      const a = (new URL(n, i).pathname || "").toLowerCase().match(/\.([a-z0-9]+)$/i);
      return (a == null ? void 0 : a[1]) || "";
    } catch {
      const o = n.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      return (o == null ? void 0 : o[1]) || "";
    }
  }
  function Ge(n, o) {
    var g;
    const a = pt(n), f = (g = String(o || "").split(";")[0]) == null ? void 0 : g.trim().toLowerCase();
    return W.has(a) || f.includes("mpegurl") || f.includes("dash+xml") || Ce.test(n) ? "manifest" : re.has(a) || f.startsWith("video/") || f.startsWith("audio/") || F.test(n) || n.startsWith("blob:") ? "media" : ne.has(a) || f.startsWith("image/") || oe.test(n) ? "image" : Y.has(a) || f.includes("text/vtt") || j.test(n) ? "subtitle" : a === "pdf" || f === "application/pdf" || pe.test(n) ? "document" : "other";
  }
  function Ae(n, o) {
    var f;
    const a = (f = String(n || "").split(";")[0]) == null ? void 0 : f.trim().toLowerCase();
    return a === "audio/mp4" ? "m4a" : a === "video/mp4" ? "mp4" : a === "audio/mpeg" ? "mp3" : a === "audio/aac" ? "aac" : a.endsWith("/webm") ? "webm" : a.endsWith("/ogg") ? "ogg" : a.endsWith("/wav") ? "wav" : o === "audio" ? "m4a" : "mp4";
  }
  function Te(n) {
    return String(n || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "media";
  }
  function Je() {
    const n = ke(T.selectorRule), o = Pe(T.regexRule), a = Array.from(y.values()).reduce((f, g) => f + Math.max(0, Number(g.totalBytes || 0)), 0);
    return {
      autoSeekToBufferedEnd: T.autoSeekToBufferedEnd,
      autoDownloadOnComplete: T.autoDownloadOnComplete,
      capturedMediaSizeBytes: a,
      clearCacheOnComplete: T.clearCacheOnComplete,
      currentFileName: Fe(),
      isCaptureComplete: V,
      manualFileName: T.manualFileName,
      regexWarning: o.warning,
      regexRule: o.rule,
      restartAlwaysFromBeginning: T.restartAlwaysFromBeginning,
      selectorWarning: n.warning,
      selectorRule: n.rule,
      streamCount: y.size,
      trimExtraMediaHeaders: T.trimExtraMediaHeaders
    };
  }
  function gt(n) {
    return n instanceof ArrayBuffer ? n.slice(0) : ArrayBuffer.isView(n) ? n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength) : null;
  }
  function xe(n) {
    const o = new Uint8Array(n), a = 32768;
    let f = "";
    for (let g = 0; g < o.length; g += a) {
      const S = o.subarray(g, Math.min(g + a, o.length));
      f += String.fromCharCode(...S);
    }
    return btoa(f);
  }
  function yt(n) {
    return xe(new TextEncoder().encode(n).buffer);
  }
  function We(n) {
    const o = atob(n), a = new Uint8Array(o.length);
    for (let f = 0; f < o.length; f += 1)
      a[f] = o.charCodeAt(f);
    return a.buffer;
  }
  function ht(n) {
    const o = String(n || "").trim();
    return o.length === 24 && o.endsWith("==") && /^[A-Za-z0-9+/]+={0,2}$/.test(o);
  }
  function wt(n) {
    return /^[A-Fa-f0-9]{32}$/.test(String(n || "").trim());
  }
  function c(n) {
    try {
      const a = new URL(n, i).toString().split("/");
      return a.pop(), `${a.join("/")}/`;
    } catch {
      return "";
    }
  }
  function u(n, o) {
    return !n || !o ? o : o.split(`
`).map((a) => {
      const f = a.trim();
      if (!f || f.startsWith("#"))
        return f.includes('URI="') ? f.replace(/URI="(.*)"/, (g, S) => Be(S) ? `URI="${S}"` : `URI="${n}${S}"`) : a;
      if (Be(f))
        return f;
      if (f.startsWith("/"))
        try {
          const g = new URL(n);
          return `${g.protocol}//${g.host}${f}`;
        } catch {
          return `${n}${f.replace(/^\//, "")}`;
        }
      return `${n}${f}`;
    }).join(`
`);
  }
  function d(n) {
    const o = String(n || "").trim();
    if (!o || !/^[\[{]/.test(o))
      return null;
    try {
      return ae(o);
    } catch {
      return null;
    }
  }
  function m(n) {
    const o = String(n || "").trim();
    if (!be.test(o))
      return "";
    const a = o.indexOf(",");
    if (a === -1)
      return "";
    const f = o.slice(0, a), g = o.slice(a + 1);
    try {
      return /;base64/i.test(f) ? new TextDecoder().decode(We(g)) : decodeURIComponent(g);
    } catch {
      return "";
    }
  }
  function C(n, o = 16) {
    if (n.byteLength <= o || n.byteLength % o !== 0)
      return null;
    const a = new Uint8Array(n), f = a.slice(0, o);
    for (let g = o; g < a.length; g += o)
      for (let S = 0; S < o; S += 1)
        if (a[g + S] !== f[S])
          return null;
    return f.buffer;
  }
  function R(n) {
    return n.byteLength === 16 ? n.slice(0) : n.byteLength === 32 ? C(n, 16) || n.slice(0, 16) : n.byteLength === 128 || n.byteLength === 256 ? C(n, 16) : null;
  }
  function x() {
    return k += 1, `probe-resource:${Date.now()}-${k}`;
  }
  function U(n, o) {
    const a = n === "key" ? `${Le() || s || "resource"}-key` : Le() || s || "resource";
    return `${Te(a)}.${o}`;
  }
  function I(n) {
    const o = B.get(n.signature);
    if (o) {
      const M = b.get(o);
      if (M)
        return {
          contentLength: M.contentLength,
          fileName: M.fileName,
          resourceKey: o,
          url: M.blobUrl
        };
    }
    const a = new Blob([We(n.base64)], { type: n.mimeType }), f = x(), g = U(n.kind, n.ext), S = URL.createObjectURL(a);
    return B.set(n.signature, f), b.set(f, {
      base64: n.base64,
      blobUrl: S,
      contentLength: a.size,
      fileName: g,
      mimeType: n.mimeType,
      streamType: n.streamType
    }), {
      contentLength: a.size,
      fileName: g,
      resourceKey: f,
      url: S
    };
  }
  function G(n) {
    if (!r || typeof e.postMessage != "function")
      return !1;
    try {
      return e.postMessage({ [p]: n }), !0;
    } catch {
      return !1;
    }
  }
  function J(n, o = !1) {
    if (r && !o) {
      G({ payload: n, type: "generated-resource" });
      return;
    }
    const a = I(n);
    Xe({
      contentLength: a.contentLength,
      ext: n.ext,
      kind: n.kind,
      mimeType: n.mimeType,
      resourceKey: a.resourceKey,
      resourceType: n.resourceType,
      source: "probe",
      streamType: n.streamType,
      url: a.url
    }, o);
  }
  function O(n, o = "key") {
    const a = R(n);
    if (!a)
      return !1;
    const f = xe(a);
    return J({
      base64: f,
      ext: o,
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${f}`
    }), !0;
  }
  function se(n) {
    if (!ht(n))
      return !1;
    try {
      return We(n).byteLength !== 16 ? !1 : (J({
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
  function Ne(n) {
    const o = String(n || "").trim().toLowerCase();
    if (!wt(o))
      return !1;
    const a = new Uint8Array(16);
    for (let f = 0; f < 16; f += 1)
      a[f] = Number.parseInt(o.slice(f * 2, f * 2 + 2), 16);
    return J({
      base64: xe(a.buffer),
      ext: "key",
      kind: "key",
      mimeType: "application/octet-stream",
      resourceType: "key",
      signature: `key:${o}`
    }), !0;
  }
  function _e(n, o, a) {
    const f = o === "m3u8" ? u(c(a || i), n) : n;
    J({
      base64: yt(f),
      ext: o,
      kind: "manifest",
      mimeType: o === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml",
      resourceType: "inline-manifest",
      signature: `${o}:${f}`
    });
  }
  function Vr(n) {
    const o = new Uint8Array(n);
    return o.length > 8 && o[4] === 102 && o[5] === 116 && o[6] === 121 && o[7] === 112;
  }
  function Kr(n) {
    const o = new Uint8Array(n);
    return o.length > 4 && o[0] === 26 && o[1] === 69 && o[2] === 223 && o[3] === 163;
  }
  function bt(n) {
    if (!T.trimExtraMediaHeaders || !Array.isArray(n) || n.length <= 1)
      return n;
    let o = -1;
    return n.forEach((a, f) => {
      (Vr(a) || Kr(a)) && (o = f);
    }), o > 0 ? n.slice(o) : n;
  }
  function Xe(n, o = !1) {
    if (n.url) {
      if (n.resourceType !== "mse-stream") {
        const a = `${n.resourceKey || n.source}:${n.resourceType || "unknown"}:${n.url}`;
        if (v.has(a))
          return;
        v.add(a), v.size > 2e3 && (v.clear(), v.add(a));
      }
      if (r && !o) {
        G({ payload: n, type: "capture" });
        return;
      }
      try {
        ie(t + JSON.stringify({
          capturedAt: Date.now(),
          contentLength: n.contentLength,
          ext: n.ext,
          kind: n.kind || Ge(n.url, n.mimeType),
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
  function qr(n) {
    const o = n.map((a) => String(a || "").toLowerCase());
    if (o.some((a) => a === "audio" || a.includes("audio")))
      return "audio";
    if (o.some((a) => a === "video" || a.includes("video")))
      return "video";
  }
  function St(n) {
    if (Se.has(n))
      return;
    Se.add(n), n.addEventListener("progress", () => {
      if (T.autoSeekToBufferedEnd)
        try {
          if (!n.buffered || n.buffered.length === 0)
            return;
          const f = n.buffered.end(n.buffered.length - 1), g = Math.max(f - 5, 0), S = Number.isFinite(n.duration) ? n.duration : 0;
          if (S > 0 && f >= S)
            return;
          Math.abs(n.currentTime - g) > 1 && (n.currentTime = g);
        } catch {
        }
    });
    const o = () => {
      if (!(!T.restartAlwaysFromBeginning || De.has(n)))
        try {
          De.add(n), Me(), n.currentTime = 0;
        } catch {
        }
    };
    n.addEventListener("play", () => {
      o();
    }, { once: !0 });
    const a = window.setInterval(() => {
      if (De.has(n) || !T.restartAlwaysFromBeginning) {
        window.clearInterval(a);
        return;
      }
      n.paused || (o(), window.clearInterval(a));
    }, 500);
    window.setTimeout(() => {
      window.clearInterval(a);
    }, 5e3);
  }
  function Gr() {
    typeof document > "u" || document.querySelectorAll("video, audio").forEach((n) => {
      n instanceof HTMLMediaElement && St(n);
    });
  }
  function vt() {
    r || typeof MutationObserver > "u" || Re || typeof document > "u" || (Gr(), Re = new MutationObserver((n) => {
      n.forEach((o) => {
        o.addedNodes.forEach((a) => {
          if (a instanceof Element) {
            if (a instanceof HTMLMediaElement) {
              St(a);
              return;
            }
            a.querySelectorAll("video, audio").forEach((f) => {
              f instanceof HTMLMediaElement && St(f);
            });
          }
        });
      });
    }), Re.observe(document.body || document.documentElement, {
      childList: !0,
      subtree: !0
    }));
  }
  function Me() {
    let n = !1;
    return y.forEach((o) => {
      if (o.blobUrl && (URL.revokeObjectURL(o.blobUrl), o.blobUrl = ""), V) {
        n = n || o.buffers.length > 0, o.buffers = [], o.bufferCount = 0, o.lastReportedBufferCount = 0, o.lastReportedBytes = 0, o.totalBytes = 0, Ie(o.streamId);
        return;
      }
      if (o.buffers.length > 1) {
        const a = o.buffers[0];
        o.buffers = a ? [a] : [], o.bufferCount = o.buffers.length, o.totalBytes = (a == null ? void 0 : a.byteLength) || 0, o.lastReportedBufferCount = o.bufferCount, o.lastReportedBytes = o.totalBytes, n = !0, Ie(o.streamId);
      }
    }), V = !1, n;
  }
  function It() {
    if (typeof document > "u")
      return !1;
    const n = Array.from(y.values()).filter((a) => a.buffers.length > 0);
    if (n.length === 0)
      return !1;
    const o = Fe();
    return n.forEach((a) => {
      const f = bt(a.buffers), g = new Blob(f, { type: a.mimeType }), S = document.createElement("a"), M = URL.createObjectURL(g), K = Ae(a.mimeType, a.streamType), ee = n.length > 1 && a.streamType ? `-${a.streamType}` : "";
      S.href = M, S.download = `${o}${ee}.${K}`, S.click(), S.remove(), setTimeout(() => {
        URL.revokeObjectURL(M);
      }, 1e3);
    }), T.clearCacheOnComplete && setTimeout(() => {
      Me();
    }, 0), !0;
  }
  function Jr() {
    if (typeof document > "u")
      return !1;
    Me();
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
  function Xr(n) {
    return `mse-stream:${n}`;
  }
  function Ie(n) {
    const o = y.get(n);
    o && Xe({
      contentLength: o.totalBytes,
      ext: Ae(o.mimeType, o.streamType),
      kind: "media",
      mimeType: o.mimeType,
      resourceKey: Xr(n),
      resourceType: "mse-stream",
      source: "probe",
      streamType: o.streamType,
      url: o.blobUrl || `mse://capturing/${n}`
    });
  }
  function $t(n) {
    const o = y.get(n);
    if (!o || o.buffers.length === 0)
      return !1;
    o.blobUrl && (URL.revokeObjectURL(o.blobUrl), o.blobUrl = "");
    try {
      const a = bt(o.buffers);
      return o.blobUrl = URL.createObjectURL(new Blob(a, { type: o.mimeType })), Ie(n), !0;
    } catch {
      return !1;
    }
  }
  function zt(n) {
    const o = y.get(n);
    return o ? (o.blobUrl || $t(n), o.blobUrl) : "";
  }
  function Ht(n) {
    const o = y.get(n);
    if (!o)
      return "media.bin";
    const a = Fe(), f = o.streamType ? `-${o.streamType}` : "", g = Ae(o.mimeType, o.streamType);
    return `${a}${f}.${g}`;
  }
  function Zr(n) {
    const o = String(n || "").replace(/^mse-stream:/, ""), a = zt(o);
    if (!a || typeof document > "u")
      return !1;
    const f = document.createElement("a");
    return f.href = a, f.download = Ht(o), f.click(), f.remove(), T.clearCacheOnComplete && setTimeout(() => {
      Me();
    }, 0), !0;
  }
  function Yr(n) {
    const o = String(n || "").replace(/^mse-stream:/, ""), a = zt(o);
    return !a || !h ? !1 : (h(a, "_blank", "noopener,noreferrer"), !0);
  }
  async function Qr(n) {
    const o = String(n || "").replace(/^mse-stream:/, ""), a = y.get(o);
    if (!a || a.buffers.length === 0)
      return null;
    try {
      const f = bt(a.buffers), S = await new Blob(f, { type: a.mimeType }).arrayBuffer();
      return {
        base64: xe(S),
        fileName: Ht(o),
        mimeType: a.mimeType,
        resourceKey: n,
        streamType: a.streamType
      };
    } catch {
      return null;
    }
  }
  function en(n) {
    const o = b.get(n);
    return !(o != null && o.blobUrl) || !h ? !1 : (h(o.blobUrl, "_blank", "noopener,noreferrer"), !0);
  }
  function tn(n) {
    const o = b.get(n);
    if (!(o != null && o.blobUrl) || typeof document > "u")
      return !1;
    const a = document.createElement("a");
    return a.href = o.blobUrl, a.download = o.fileName, a.click(), a.remove(), !0;
  }
  function rn(n) {
    const o = b.get(n);
    return o ? Promise.resolve({
      base64: o.base64,
      fileName: o.fileName,
      mimeType: o.mimeType,
      resourceKey: n,
      streamType: o.streamType
    }) : Promise.resolve(null);
  }
  function nn(n) {
    if (!n || typeof n != "object")
      return !1;
    const o = n[p];
    return !o || typeof o != "object" || !("type" in o) ? !1 : r ? G(o) : o.type === "capture" ? (Xe(o.payload, !0), !0) : o.type === "generated-resource" ? (J(o.payload, !0), !0) : !1;
  }
  const Et = e.Worker;
  typeof Et == "function" && (e.Worker = new Proxy(Et, {
    construct(n, o, a) {
      const [f, g] = o, S = () => {
        const ee = typeof f == "string" ? f : String(f), de = Be(ee) || ee;
        if (!de)
          return "";
        const Z = `;(${Wr.toString()})(${JSON.stringify(t)});
`;
        let fe = "";
        if ((g == null ? void 0 : g.type) === "module")
          fe = `${Z}import ${JSON.stringify(de)};
`;
        else {
          const ye = new XMLHttpRequest();
          if (ye.open("GET", de, !1), ye.send(), ye.status < 200 || ye.status >= 300 || !ye.responseText)
            return "";
          fe = `${Z}${ye.responseText}`;
        }
        return URL.createObjectURL(new Blob([fe], { type: "text/javascript" }));
      };
      let M = "";
      try {
        M = S();
      } catch {
        M = "";
      }
      const K = M ? Reflect.construct(n, [M, g], a) : Reflect.construct(n, o, a);
      return K.addEventListener("message", (ee) => {
        nn(ee.data) && ee.stopImmediatePropagation();
      }, { capture: !0 }), M && setTimeout(() => {
        URL.revokeObjectURL(M);
      }, 6e4), K;
    }
  }), e.Worker.toString = function() {
    return Et.toString();
  });
  const ce = e.MediaSource;
  if ((ir = ce == null ? void 0 : ce.prototype) != null && ir.addSourceBuffer) {
    const n = ce.prototype.addSourceBuffer;
    ce.prototype.addSourceBuffer = new Proxy(n, {
      apply(o, a, f) {
        var S;
        const g = Reflect.apply(o, a, f);
        try {
          vt(), V = !1;
          const M = a, K = String((f == null ? void 0 : f[0]) || "").trim(), ee = ((S = K.split(";")[0]) == null ? void 0 : S.trim().toLowerCase()) || "", de = ee.startsWith("audio/") ? "audio" : ee.startsWith("video/") ? "video" : void 0, Z = `${Date.now()}-${++_}`, fe = w.get(M) || [];
          if (fe.push(Z), w.set(M, fe), y.set(Z, {
            blobUrl: "",
            bufferCount: 0,
            buffers: [],
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: K || (de === "audio" ? "audio/mp4" : "video/mp4"),
            streamId: Z,
            streamType: de,
            totalBytes: 0
          }), Ie(Z), g && typeof g.appendBuffer == "function") {
            const ye = g.appendBuffer;
            g.appendBuffer = new Proxy(ye, {
              apply(on, sn, Ye) {
                const Ct = Reflect.apply(on, sn, Ye), te = y.get(Z);
                if (!te)
                  return Ct;
                const Qe = gt(Ye == null ? void 0 : Ye[0]);
                return !Qe || Qe.byteLength === 0 || (te.buffers.push(Qe), te.bufferCount += 1, te.totalBytes += Qe.byteLength, (te.bufferCount <= 3 || te.bufferCount - te.lastReportedBufferCount >= 8 || te.totalBytes - te.lastReportedBytes >= 1024 * 512) && (te.lastReportedBufferCount = te.bufferCount, te.lastReportedBytes = te.totalBytes, Ie(Z))), Ct;
              }
            });
          }
        } catch {
        }
        return g;
      }
    });
  }
  if ((sr = ce == null ? void 0 : ce.prototype) != null && sr.endOfStream) {
    const n = ce.prototype.endOfStream;
    ce.prototype.endOfStream = new Proxy(n, {
      apply(o, a, f) {
        const g = Reflect.apply(o, a, f);
        try {
          if (V = !0, (w.get(a) || []).forEach((M) => {
            $t(M);
          }), T.autoDownloadOnComplete)
            return setTimeout(() => {
              It();
            }, 500), g;
          T.clearCacheOnComplete && setTimeout(() => {
            Me();
          }, 0);
        } catch {
        }
        return g;
      }
    });
  }
  function Q(n, o) {
    if (typeof n != "string")
      return;
    const a = n.trim();
    if (!a || se(a))
      return;
    const f = a.split("").join("").trim();
    if (Ne(f))
      return;
    if (be.test(a)) {
      const K = m(a);
      K && Q(K, o);
      return;
    }
    const g = d(a);
    if (g) {
      $e(g);
      return;
    }
    const S = a.toUpperCase();
    if (S.startsWith("#EXTM3U") || S.includes("#EXTINF:")) {
      _e(a, "m3u8", o == null ? void 0 : o.baseUrl);
      return;
    }
    if (a.toLowerCase().includes("urn:mpeg:dash:schema:mpd") || a.includes("<MPD") && a.includes("</MPD>")) {
      _e(a, "mpd", o == null ? void 0 : o.baseUrl);
      return;
    }
    const M = Be(a);
    M && Xe({
      kind: Ge(M, o == null ? void 0 : o.mimeType),
      mimeType: o == null ? void 0 : o.mimeType,
      resourceType: o == null ? void 0 : o.resourceType,
      source: "probe",
      streamType: o == null ? void 0 : o.streamType,
      url: M
    });
  }
  function $e(n, o = 0, a = /* @__PURE__ */ new WeakSet(), f = []) {
    if (o > 6 || n == null)
      return;
    if (n instanceof ArrayBuffer) {
      O(n);
      return;
    }
    if (ArrayBuffer.isView(n)) {
      O(n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength));
      return;
    }
    if (typeof n == "string") {
      Q(n, {
        baseUrl: i,
        resourceType: "json",
        streamType: qr(f)
      });
      return;
    }
    if (typeof n != "object")
      return;
    const g = n;
    if (!a.has(g)) {
      if (a.add(g), Array.isArray(n)) {
        if (n.length === 16 && n.every((S) => typeof S == "number" && Number.isFinite(S) && S >= 0 && S <= 255)) {
          O(Uint8Array.from(n).buffer);
          return;
        }
        n.slice(0, 80).forEach((S, M) => {
          $e(S, o + 1, a, f.concat(String(M)));
        });
        return;
      }
      Object.keys(n).slice(0, 80).forEach((S) => {
        $e(n[S], o + 1, a, f.concat(S));
      });
    }
  }
  const Tt = typeof e.fetch == "function" ? e.fetch.bind(e) : null;
  Tt && (e.fetch = async function(n, o) {
    const a = typeof n == "string" ? n : n instanceof Request ? n.url : String(n);
    Q(a, { resourceType: "fetch" });
    const f = await Tt(n, o);
    return Q(f.url || a, {
      mimeType: f.headers.get("content-type") || void 0,
      resourceType: "fetch"
    }), f.clone().arrayBuffer().then((S) => {
      if (!S.byteLength || O(S))
        return;
      const M = new TextDecoder().decode(S);
      M.trim() && Q(M, {
        baseUrl: f.url || a,
        mimeType: f.headers.get("content-type") || void 0,
        resourceType: "fetch-body"
      });
    }).catch(() => {
    }), f;
  }, e.fetch.toString = function() {
    return Tt.toString();
  });
  const jt = "__OMNIFLOW_RESOURCE_PROBE_XHR_URL__", Vt = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(n, o) {
    return this[jt] = typeof o == "string" ? o : String(o), Vt.apply(this, arguments);
  };
  const Kt = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    return this.addEventListener("loadend", function() {
      if (this.status < 200 || this.status >= 400)
        return;
      const n = this[jt], o = this.responseURL || (typeof n == "string" ? n : "");
      if (Q(o, {
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr"
      }), this.response instanceof ArrayBuffer) {
        if (O(this.response))
          return;
        const a = new TextDecoder().decode(this.response);
        a && Q(a, {
          baseUrl: o,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (typeof this.response == "string") {
        Q(this.response, {
          baseUrl: o,
          mimeType: this.getResponseHeader("content-type") || void 0,
          resourceType: "xhr-body"
        });
        return;
      }
      if (this.response && typeof this.response == "object") {
        $e(this.response);
        return;
      }
      typeof this.responseText == "string" && this.responseText.trim() && Q(this.responseText, {
        baseUrl: o,
        mimeType: this.getResponseHeader("content-type") || void 0,
        resourceType: "xhr-body"
      });
    }, { once: !0 }), Kt.apply(this, arguments);
  }, XMLHttpRequest.prototype.open.toString = function() {
    return Vt.toString();
  }, XMLHttpRequest.prototype.send.toString = function() {
    return Kt.toString();
  }, JSON.parse = function() {
    const n = ae.apply(this, arguments);
    return $e(n), n;
  }, JSON.parse.toString = function() {
    return ae.toString();
  };
  const qt = btoa;
  e.btoa = function(n) {
    const o = qt.apply(this, arguments);
    return se(o), Q(n, { baseUrl: i, resourceType: "btoa" }), o;
  }, btoa.toString = function() {
    return qt.toString();
  };
  const Gt = atob;
  e.atob = function(n) {
    const o = Gt.apply(this, arguments);
    return se(n), Q(o, { baseUrl: i, resourceType: "atob" }), o;
  }, atob.toString = function() {
    return Gt.toString();
  };
  const Jt = String.fromCharCode;
  String.fromCharCode = new Proxy(Jt, {
    apply(n, o, a) {
      const f = Reflect.apply(n, o, a);
      if (f.length >= 7) {
        if ((f.startsWith("#EXTM3U") || f.includes("#EXTINF:")) && (P += f, P.includes("#EXT-X-ENDLIST"))) {
          const S = P.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST";
          _e(S, "m3u8", i), P = "";
        }
        const g = f.split("").join("").trim();
        Ne(g);
      }
      return f;
    }
  }), String.fromCharCode.toString = function() {
    return Jt.toString();
  };
  const Xt = Array.prototype.slice;
  Array.prototype.slice = function() {
    const n = Xt.apply(this, arguments);
    return Array.isArray(n) && n.length === 16 && n.every((o) => typeof o == "number" && Number.isFinite(o) && o >= 0 && o <= 255) && O(Uint8Array.from(n).buffer), n;
  }, Array.prototype.slice.toString = function() {
    return Xt.toString();
  };
  const Zt = Array.prototype.join;
  Array.prototype.join = function() {
    const n = Zt.apply(this, arguments);
    return typeof n == "string" && ((n.startsWith("#EXTM3U") || n.includes("#EXTINF:")) && Q(n, { baseUrl: i, resourceType: "array-join" }), se(n)), n;
  }, Array.prototype.join.toString = function() {
    return Zt.toString();
  };
  const Ze = e.DataView;
  if (typeof Ze == "function") {
    const n = function(o, a, f) {
      const g = new Ze(o, a, f), S = () => {
        const M = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength);
        O(M);
      };
      return ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32"].forEach((M) => {
        const K = g[M];
        typeof K == "function" && (g[M] = function() {
          const ee = K.apply(this, arguments);
          return S(), ee;
        });
      }), S(), g;
    };
    n.prototype = Ze.prototype, n.toString = function() {
      return Ze.toString();
    }, e.DataView = n;
  }
  function Yt(n) {
    return function() {
      const o = n.apply(this, arguments);
      return (o == null ? void 0 : o.byteLength) === 16 && O(o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength)), o;
    };
  }
  const Qt = Int8Array.prototype.subarray;
  Int8Array.prototype.subarray = Yt(Qt), Int8Array.prototype.subarray.toString = function() {
    return Qt.toString();
  };
  const er = Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray = Yt(er), Uint8Array.prototype.subarray.toString = function() {
    return er.toString();
  };
  const tr = String.prototype.indexOf;
  return String.prototype.indexOf = function(n, o) {
    const a = tr.apply(this, arguments);
    if (n === "#EXTM3U" && a !== -1) {
      const f = String(this);
      Q(f.slice(Math.max(o ?? 0, 0)), {
        baseUrl: i,
        resourceType: "string-indexof"
      });
    }
    return a;
  }, String.prototype.indexOf.toString = function() {
    return tr.toString();
  }, r || vt(), e.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return Me();
    },
    downloadCatchMedia() {
      return It();
    },
    exportResource(n) {
      const o = String(n || "");
      return o.startsWith("mse-stream:") ? Zr(o) : o.startsWith("probe-resource:") ? tn(o) : !1;
    },
    getCatchToolkitState() {
      return Je();
    },
    installedAt: Date.now(),
    openResource(n) {
      const o = String(n || "");
      return o.startsWith("mse-stream:") ? Yr(o) : o.startsWith("probe-resource:") ? en(o) : !1;
    },
    readResource(n) {
      const o = String(n || "");
      return o.startsWith("mse-stream:") ? Qr(o) : o.startsWith("probe-resource:") ? rn(o) : Promise.resolve(null);
    },
    restartCatchMediaCapture() {
      return Jr();
    },
    seen: v,
    updateCatchToolkitState(n) {
      return typeof n.autoSeekToBufferedEnd == "boolean" && (T.autoSeekToBufferedEnd = n.autoSeekToBufferedEnd), typeof n.autoDownloadOnComplete == "boolean" && (T.autoDownloadOnComplete = n.autoDownloadOnComplete), typeof n.clearCacheOnComplete == "boolean" && (T.clearCacheOnComplete = n.clearCacheOnComplete), typeof n.manualFileName == "string" && (T.manualFileName = n.manualFileName), typeof n.regexRule == "string" && (T.regexRule = Pe(n.regexRule).rule), typeof n.restartAlwaysFromBeginning == "boolean" && (T.restartAlwaysFromBeginning = n.restartAlwaysFromBeginning), typeof n.selectorRule == "string" && (T.selectorRule = ke(n.selectorRule).rule), typeof n.trimExtraMediaHeaders == "boolean" && (T.trimExtraMediaHeaders = n.trimExtraMediaHeaders), mt(), r || vt(), Je();
    }
  }, "installed";
}
const zo = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "ffmpeg"
].filter((t) => !!t);
function Dt(t) {
  return String(t || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || "media";
}
async function Ho(t) {
  if (!t || t === "ffmpeg")
    return !1;
  try {
    return await wn(t, fn.X_OK), !0;
  } catch {
    return !1;
  }
}
async function jo(t) {
  return new Promise((e) => {
    const r = vr(t, ["-version"], {
      stdio: "ignore"
    });
    r.once("error", () => e(!1)), r.once("exit", (i) => e(i === 0));
  });
}
async function Vo(t) {
  const e = [
    String(t || "").trim() || void 0,
    ...zo
  ].filter((r, i, s) => !!r && s.indexOf(r) === i);
  for (const r of e) {
    if (r === "ffmpeg") {
      if (await jo(r))
        return r;
      continue;
    }
    if (await Ho(r))
      return r;
  }
  return null;
}
function Ko(t) {
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
function qo(t, e) {
  const r = Dt(E.parse(t).name), i = Dt(E.parse(e).name);
  return `${r.replace(/-video$/i, "").replace(/_video$/i, "") || i.replace(/-audio$/i, "").replace(/_audio$/i, "") || "merged-media"}.mp4`;
}
async function Go() {
  return gn(E.join(Sn.tmpdir(), "omniflow-resource-merge-"));
}
async function Jo(t) {
  t && await hn(t, {
    force: !0,
    recursive: !0
  });
}
async function pr(t, e) {
  const r = E.join(t, Dt(e.fileName));
  return await yn(r, Sr.from(e.base64, "base64")), r;
}
async function Xo(t) {
  const e = await Vo(t.ffmpegPath);
  if (!e)
    throw new Error("未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行");
  const r = await Go();
  try {
    const [i, s] = await Promise.all([
      pr(r, t.audio),
      pr(r, t.video)
    ]), l = Ko({
      audioPath: i,
      outputPath: t.outputPath,
      videoPath: s
    });
    return await new Promise((h, v) => {
      const y = [], b = [], B = vr(e, l, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      B.stdout.on("data", (w) => {
        y.push(String(w));
      }), B.stderr.on("data", (w) => {
        b.push(String(w));
      }), B.once("error", (w) => {
        v(w);
      }), B.once("exit", (w) => {
        if (w === 0) {
          h({
            commandArgs: l,
            ffmpegPath: e,
            outputPath: t.outputPath,
            stderr: b.join(""),
            stdout: y.join("")
          });
          return;
        }
        v(new Error(b.join("").trim() || `ffmpeg 退出码异常: ${w}`));
      });
    });
  } finally {
    await Jo(r).catch(() => {
    });
  }
}
const Zo = "embedded-browser-open-files", gr = 'input[data-omniflow-browser-open-fallback="true"]';
function Nr() {
  return E.join($.getPath("userData"), Zo);
}
function Yo() {
  const t = Nr();
  return ut(t) || Ut(t, { recursive: !0 }), t;
}
function Qo(t) {
  const e = String(t).replace(/[/\\]/g, "_").trim() || "file";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${e}`;
}
function ei(t, e) {
  const r = E.resolve(t), i = E.resolve(e);
  return r === i ? !0 : r.startsWith(`${i}${E.sep}`);
}
async function ti(t) {
  const e = await t.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${gr}') 
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
      return '${gr}'
    })()
  `, !0);
  return typeof e == "string" && e.trim() ? e.trim() : null;
}
async function ri(t, e, r) {
  var h;
  if (!e || r.length === 0)
    return !1;
  try {
    t.webContents.debugger.isAttached() || t.webContents.debugger.attach("1.3");
  } catch (v) {
    if (!String(v).includes("Already attached"))
      throw v;
  }
  const i = await t.webContents.debugger.sendCommand("DOM.getDocument", {
    depth: 1
  }), s = Number(((h = i == null ? void 0 : i.root) == null ? void 0 : h.nodeId) || 0);
  if (!Number.isFinite(s) || s <= 0)
    return !1;
  const l = await t.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: s,
    selector: e
  }), p = Number((l == null ? void 0 : l.nodeId) || 0);
  return !Number.isFinite(p) || p <= 0 ? !1 : (await t.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: p,
    files: r
  }), !0);
}
async function ni(t, e) {
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
async function oi(t, e, r = {}) {
  const i = Yo(), s = E.join(i, Qo(e));
  return await Pt(t, s, r), s;
}
async function rt(t) {
  const e = E.resolve(String(t || "").trim());
  if (!e)
    return !1;
  const r = E.resolve(Nr());
  return ei(e, r) ? (await st.rm(e, { force: !0 }), !0) : !1;
}
async function ii(t, e) {
  if (!t || t.webContents.isDestroyed())
    return !1;
  const r = await ti(t);
  return !r || !await ri(t, r, [e]) ? !1 : ni(t, r);
}
function si(t) {
  const e = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Map(), v = /* @__PURE__ */ new Map();
  let y = null, b = null, B = !1;
  function w(c) {
    N.log("[embedded-browser:main]", c);
    const u = t.getMainWindow();
    !u || u.isDestroyed() || u.webContents.send("embedded-browser:state", c);
  }
  function _(c) {
    const u = t.getMainWindow();
    !u || u.isDestroyed() || u.webContents.send("embedded-browser:download", c);
  }
  function k(c) {
    const u = t.getMainWindow();
    !u || u.isDestroyed() || u.webContents.send("embedded-browser:resource", c);
  }
  function W(c) {
    for (const [u, d] of e.entries())
      if (d.webContents === c)
        return u;
    return null;
  }
  function re(c) {
    for (const [u, d] of e.entries())
      if (d.webContents.id === c)
        return u;
    return null;
  }
  function ne() {
    B || (B = !0, Oo({
      decisionCache: v,
      options: t
    }));
  }
  function Y() {
    Do({
      emitDownload: _,
      emitResource: k,
      resolveTabIdByWebContents: W,
      resolveTabIdByWebContentsId: re
    });
  }
  function be(c) {
    const u = c.webContents.getTitle().trim();
    if (u)
      return u;
  }
  function L(c, u, d) {
    w({
      canGoBack: u.webContents.canGoBack(),
      canGoForward: u.webContents.canGoForward(),
      iconSourceUrl: d.iconSourceUrl ?? s.get(c),
      iconUrl: d.iconUrl ?? i.get(c),
      tabId: c,
      title: d.title ?? be(u),
      ...d
    });
  }
  function Ce(c, u, d) {
    L(c, u, {
      state: "ready",
      url: (d == null ? void 0 : d.url) ?? (r.get(c) || u.webContents.getURL() || void 0),
      ...d
    });
  }
  function F(c) {
    const u = e.get(c);
    return !u || u.webContents.isDestroyed() ? (e.delete(c), r.delete(c), i.delete(c), s.delete(c), dr(c), null) : u;
  }
  async function oe(c, u) {
    if (!Co(c) || u.webContents.isDestroyed())
      return !1;
    try {
      return await u.webContents.executeJavaScript($o(), !0), !0;
    } catch (d) {
      return N.warn("embedded browser resource probe install failed", {
        error: d instanceof Error ? d.message : String(d),
        tabId: c,
        url: u.webContents.getURL() || r.get(c) || ""
      }), !1;
    }
  }
  async function j(c, u) {
    const d = String(c || "").trim();
    if (!d)
      return null;
    const m = F(d);
    return !m || m.webContents.isDestroyed() ? null : u((R) => m.webContents.executeJavaScript(R, !0), m);
  }
  async function pe(c, u) {
    const d = String(c || "").trim(), m = String(u.audioResourceKey || "").trim(), C = String(u.videoResourceKey || "").trim();
    if (!d || !m || !C)
      return {
        error: "缺少要合并的音频或视频资源",
        ok: !1
      };
    try {
      const R = await j(
        d,
        async (_e) => Promise.all([
          mr(_e, m),
          mr(_e, C)
        ])
      ), [x, U] = R || [];
      if (!x || !U)
        return {
          error: "当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试",
          ok: !1
        };
      const I = String(u.suggestedFileName || "").trim() || qo(U.fileName, x.fileName), G = t.getMainWindow(), J = G && !G.isDestroyed() ? G : void 0, O = {
        defaultPath: E.join($.getPath("downloads"), I),
        filters: [
          { extensions: ["mp4"], name: "MP4 Video" }
        ],
        showsTagField: !1
      }, se = J ? await ue.showSaveDialog(J, O) : await ue.showSaveDialog(O);
      if (se.canceled || !se.filePath)
        return {
          cancelled: !0,
          ok: !1
        };
      const Ne = await Xo({
        audio: x,
        ffmpegPath: u.ffmpegPath,
        outputPath: se.filePath,
        video: U
      });
      return {
        ffmpegPath: Ne.ffmpegPath,
        ok: !0,
        outputPath: Ne.outputPath
      };
    } catch (R) {
      return N.warn("embedded browser resource merge failed", {
        audioResourceKey: m,
        error: R instanceof Error ? R.message : String(R),
        tabId: d,
        videoResourceKey: C
      }), {
        error: R instanceof Error ? R.message : String(R),
        ok: !1
      };
    }
  }
  function ae(c) {
    const u = l.get(c);
    u != null && u.stagedPath && rt(u.stagedPath).catch(() => {
    }), l.delete(c);
    const d = p.get(c);
    d && rt(d).catch(() => {
    }), p.delete(c);
  }
  function ie(c) {
    const u = (h.get(c) ?? 0) + 1;
    return h.set(c, u), u;
  }
  function A(c, u) {
    return h.get(c) === u;
  }
  function P(c, u) {
    try {
      const d = new URL(c), m = new URL(u);
      if (d.origin !== m.origin)
        return !1;
      const C = d.pathname.replace(/\/+$/, "") || "/", R = m.pathname.replace(/\/+$/, "") || "/";
      return R === "/" ? !0 : C === R || C.startsWith(`${R}/`);
    } catch {
      return !1;
    }
  }
  async function V(c, u) {
    const d = l.get(c);
    if (!d || u.webContents.isDestroyed())
      return !1;
    const m = u.webContents.getURL() || r.get(c) || "";
    if (!m || !P(m, d.pageUrl))
      return !1;
    try {
      if (!await ii(u, d.stagedPath))
        return !1;
      const R = p.get(c);
      return R && R !== d.stagedPath && rt(R).catch(() => {
      }), p.set(c, d.stagedPath), l.delete(c), !0;
    } catch {
      return !1;
    }
  }
  function T(c) {
    c.setBounds(b ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  }
  function Se(c) {
    if (!y)
      return;
    const u = F(y);
    if (!u) {
      y = null;
      return;
    }
    c.contentView.children.includes(u) && c.contentView.removeChildView(u), y = null;
  }
  function De(c) {
    const u = t.getMainWindow();
    if (!u || u.isDestroyed())
      return null;
    const d = F(c);
    if (d)
      return d;
    const m = new un({
      webPreferences: {
        devTools: !0,
        partition: Ke
      }
    });
    m.webContents.setZoomFactor(1);
    const C = m.webContents.getUserAgent();
    return C.includes("Electron") && m.webContents.setUserAgent(
      C.replace(/\sElectron\/[^\s]+/g, "")
    ), T(m), e.set(c, m), m.webContents.on("did-start-loading", () => {
      L(c, m, {
        details: "did-start-loading",
        state: "loading",
        url: m.webContents.getURL() || r.get(c) || void 0
      });
    }), m.webContents.on("dom-ready", () => {
      oe(c, m);
    }), m.webContents.on("did-stop-loading", async () => {
      if (m.webContents.isDestroyed())
        return;
      const R = m.webContents.getURL() || "";
      r.set(c, R), await V(c, m);
      const x = await Uo(m, t.debugEnabled);
      L(c, m, {
        details: "did-stop-loading",
        ...x.length ? { meta: x } : {},
        state: "ready",
        url: R || void 0
      });
    }), m.webContents.on("did-navigate", (R, x) => {
      r.set(c, x), L(c, m, { details: "did-navigate", state: "ready", url: x }), V(c, m);
    }), m.webContents.on("did-navigate-in-page", (R, x) => {
      r.set(c, x), L(c, m, { details: "did-navigate-in-page", state: "ready", url: x }), V(c, m);
    }), m.webContents.on("page-title-updated", (R, x) => {
      L(c, m, {
        details: "page-title-updated",
        state: "ready",
        title: x || void 0,
        url: r.get(c) || m.webContents.getURL() || void 0
      });
    }), m.webContents.on("page-favicon-updated", (R, x) => {
      const U = x.map((I) => String(I || "").trim()).find((I) => I) || "";
      U && Po(m, U).then((I) => {
        !I || m.webContents.isDestroyed() || (s.set(c, U), i.set(c, I), L(c, m, {
          details: "page-favicon-updated",
          iconSourceUrl: U,
          iconUrl: I,
          state: "ready",
          url: r.get(c) || m.webContents.getURL() || void 0
        }));
      });
    }), m.webContents.on("did-fail-load", (R, x, U, I) => {
      x !== -3 && L(c, m, {
        details: `did-fail-load(${x})`,
        state: "error",
        message: `页面加载失败：${U || "未知错误"}`,
        url: I
      });
    }), m.webContents.on("render-process-gone", (R, x) => {
      L(c, m, {
        details: `render-process-gone:${x.reason}`,
        state: "error",
        message: `页面渲染进程异常退出：${x.reason}`,
        url: r.get(c) || m.webContents.getURL() || void 0
      });
    }), m.webContents.on("console-message", (R, x, U, I, G) => {
      if (typeof U == "string" && U.startsWith(Ot)) {
        const J = U.slice(Ot.length);
        try {
          const O = JSON.parse(J);
          Ro(c, {
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
          N.warn("embedded browser resource payload parse failed", {
            error: O instanceof Error ? O.message : String(O),
            tabId: c
          });
        }
        return;
      }
      t.debugEnabled && x >= 2 && L(c, m, {
        details: `console:${G}:${I}`,
        state: "ready",
        message: U,
        meta: [`console-level=${x}`],
        url: r.get(c) || m.webContents.getURL() || void 0
      });
    }), m.webContents.setWindowOpenHandler(({ url: R }) => (m.webContents.loadURL(R), { action: "deny" })), m;
  }
  function Re(c, u, d = {}) {
    if (!c || c.isDestroyed())
      return null;
    if (!u)
      return Se(c), null;
    const C = d.createIfMissing ?? !1 ? De(u) : F(u);
    return C ? (y && y !== u && Se(c), T(C), c.contentView.children.includes(C) || c.contentView.addChildView(C), y = u, C) : (Se(c), null);
  }
  async function ve(c, u, d, m, C = !1) {
    if (!c || c.isDestroyed())
      return;
    const R = String(u || "").trim();
    if (!R)
      return;
    const x = Re(c, R, { createIfMissing: !0 });
    if (!x || x.webContents.isDestroyed())
      return;
    const U = String(d || "").trim();
    if (!U) {
      L(R, x, {
        state: "ready",
        title: be(x) || "新标签页",
        url: r.get(R) || void 0
      });
      return;
    }
    const I = r.get(R) || x.webContents.getURL();
    if (C && I === U) {
      L(R, x, {
        state: "ready",
        url: I || void 0
      });
      return;
    }
    L(R, x, {
      details: "load-url",
      state: "loading",
      url: U
    });
    try {
      await x.webContents.loadURL(U);
    } catch (G) {
      const J = G instanceof Error ? G.message : String(G);
      if (J.includes("ERR_ABORTED"))
        return;
      throw L(R, x, {
        details: m,
        state: "error",
        message: `页面加载失败：${J}`,
        url: U
      }), G;
    }
  }
  function ge(c, u) {
    if (!c || c.isDestroyed())
      return;
    const d = String(u || "").trim();
    if (!d)
      return;
    const m = F(d);
    m && (c.contentView.children.includes(m) && c.contentView.removeChildView(m), y === d && (y = null), e.delete(d), r.delete(d), i.delete(d), s.delete(d), dr(d), ie(d), ae(d), m.webContents.isDestroyed() || m.webContents.close({ waitForBeforeUnload: !1 }));
  }
  async function Ue(c, u, d) {
    const m = q.fromWebContents(c) ?? t.getMainWindow();
    ie(String(u || "").trim()), ae(String(u || "").trim());
    const C = String(d || "").trim();
    if (!C) {
      w({
        canGoBack: !1,
        canGoForward: !1,
        state: "ready",
        tabId: u,
        title: "新标签页"
      });
      return;
    }
    await ve(m, u, C, "open-exception", !0);
  }
  function Ee(c, u) {
    const d = q.fromWebContents(c) ?? t.getMainWindow();
    Re(d, u, { createIfMissing: !1 });
  }
  async function ke(c, u, d) {
    const m = q.fromWebContents(c) ?? t.getMainWindow(), C = String(u || "").trim();
    ie(C), ae(C), await ve(m, C, d, "navigate-exception");
  }
  async function Pe(c, u, d, m, C) {
    const R = q.fromWebContents(c) ?? t.getMainWindow(), x = String(u || "").trim(), U = String(d || "").trim(), I = String(m || "").trim(), G = String(C || "").trim() || "file";
    if (!x || !U || !I)
      return;
    const J = ie(x);
    ae(x);
    const O = await oi(I, G);
    if (!A(x, J)) {
      rt(O).catch(() => {
      });
      return;
    }
    if (l.set(x, {
      fileName: G,
      pageUrl: U,
      stagedPath: O
    }), await ve(R, x, U, "navigate-exception"), !A(x, J))
      return;
    const se = F(x);
    se && V(x, se);
  }
  async function ft(c) {
    const u = String(c || "").trim();
    if (!u)
      return;
    const d = F(u);
    !d || d.webContents.isDestroyed() || (L(u, d, {
      details: "reload",
      state: "loading",
      url: r.get(u) || d.webContents.getURL() || void 0
    }), d.webContents.reload(), Ce(u, d, {
      details: "reload-requested"
    }));
  }
  async function mt(c) {
    const u = String(c || "").trim();
    if (!u)
      return;
    const d = F(u);
    !d || d.webContents.isDestroyed() || (d.webContents.canGoBack() && d.webContents.goBack(), Ce(u, d, {
      details: "history-back"
    }));
  }
  async function Le(c) {
    const u = String(c || "").trim();
    if (!u)
      return;
    const d = F(u);
    !d || d.webContents.isDestroyed() || (d.webContents.canGoForward() && d.webContents.goForward(), Ce(u, d, {
      details: "history-forward"
    }));
  }
  async function Fe(c, u) {
    return j(c, async (d, m) => {
      try {
        return await fr(d, "openResource", u);
      } catch (C) {
        return N.warn("embedded browser resource probe action failed", {
          action: "openResource",
          error: C instanceof Error ? C.message : String(C),
          resourceKey: String(u || "").trim(),
          tabId: String(c || "").trim(),
          url: m.webContents.getURL() || r.get(String(c || "").trim()) || ""
        }), !1;
      }
    }).then((d) => !!d);
  }
  async function Be(c, u) {
    return j(c, async (d, m) => {
      try {
        return await fr(d, "exportResource", u);
      } catch (C) {
        return N.warn("embedded browser resource probe action failed", {
          action: "exportResource",
          error: C instanceof Error ? C.message : String(C),
          resourceKey: String(u || "").trim(),
          tabId: String(c || "").trim(),
          url: m.webContents.getURL() || r.get(String(c || "").trim()) || ""
        }), !1;
      }
    }).then((d) => !!d);
  }
  async function pt(c, u) {
    return j(c, async (d) => {
      try {
        return await Io(d, u);
      } catch (m) {
        return N.warn("embedded browser network resource preview failed", {
          error: m instanceof Error ? m.message : String(m),
          tabId: String(c || "").trim(),
          url: String(u.url || "").trim()
        }), !1;
      }
    }).then((d) => !!d);
  }
  async function Ge(c) {
    return j(c, async (u, d) => {
      try {
        return await Zn(u);
      } catch (m) {
        return N.warn("embedded browser catch toolkit get state failed", {
          error: m instanceof Error ? m.message : String(m),
          tabId: String(c || "").trim(),
          url: d.webContents.getURL() || r.get(String(c || "").trim()) || ""
        }), null;
      }
    });
  }
  async function Ae(c, u) {
    return j(c, async (d, m) => {
      try {
        return await Yn(d, u);
      } catch (C) {
        return N.warn("embedded browser catch toolkit update state failed", {
          error: C instanceof Error ? C.message : String(C),
          payload: u,
          tabId: String(c || "").trim(),
          url: m.webContents.getURL() || r.get(String(c || "").trim()) || ""
        }), null;
      }
    });
  }
  async function Te(c, u, d) {
    return j(c, async (m, C) => {
      try {
        return await Qn(m, u);
      } catch (R) {
        return N.warn(`embedded browser catch toolkit ${d} failed`, {
          error: R instanceof Error ? R.message : String(R),
          tabId: String(c || "").trim(),
          url: C.webContents.getURL() || r.get(String(c || "").trim()) || ""
        }), !1;
      }
    }).then((m) => !!m);
  }
  async function Je(c) {
    const u = String(c || "").trim(), d = vo(u), m = F(u);
    return m && !m.webContents.isDestroyed() && (m.webContents.getURL() ? m.webContents.reload() : await oe(u, m)), d;
  }
  function gt(c, u) {
    const d = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }, m = q.fromWebContents(c) ?? t.getMainWindow(), C = m && !m.isDestroyed() ? Math.max(m.webContents.getZoomFactor(), 0.01) : 1;
    if (d.x = Math.max(0, Math.round(u.x * C)), d.y = Math.max(0, Math.round(u.y * C)), d.width = Math.max(0, Math.round(u.width * C)), d.height = Math.max(0, Math.round(u.height * C)), b = d, !y)
      return;
    const R = F(y);
    R && R.setBounds(d);
  }
  function xe(c, u) {
    const d = q.fromWebContents(c) ?? t.getMainWindow();
    ge(d, u);
  }
  async function yt(c) {
    try {
      return await Mr(c);
    } catch {
      return !1;
    }
  }
  function We(c) {
    const u = q.fromWebContents(c) ?? t.getMainWindow();
    !u || u.isDestroyed() || Se(u);
  }
  function ht(c) {
    const u = q.fromWebContents(c) ?? t.getMainWindow();
    !u || u.isDestroyed() || (Array.from(e.keys()).forEach((d) => {
      ge(u, d);
    }), y = null, w({ state: "idle" }));
  }
  function wt() {
    eo({
      activateTab: Ee,
      cleanupDownloadFile: yt,
      clearCapturedResources: (c) => To(String(c || "").trim()),
      clearCatchMediaCache: (c) => Te(c, "clearCatchMediaCache", "clear cache"),
      closeAll: ht,
      closeTab: xe,
      deactivate: We,
      downloadCatchMedia: (c) => Te(c, "downloadCatchMedia", "download"),
      exportResource: Be,
      getCatchToolkitState: Ge,
      goBack: mt,
      goForward: Le,
      listCapturedResources: (c) => bo(String(c || "").trim()),
      mergeMseResources: pe,
      navigate: ke,
      openMappedFile: Pe,
      openResource: Fe,
      openTab: Ue,
      previewResource: pt,
      reload: ft,
      resolveFavicon: Fo,
      restartCatchMediaCapture: (c) => Te(c, "restartCatchMediaCapture", "restart"),
      setBounds: gt,
      startCapturedResources: (c) => So(String(c || "").trim()),
      startDeepResourceCapture: Je,
      stopCapturedResources: (c) => Eo(String(c || "").trim()),
      updateCatchToolkitState: Ae
    });
  }
  return {
    configureSession: ne,
    initializeBridges: Y,
    registerIpcHandlers: wt
  };
}
const ai = 240;
function ci(t) {
  D.on("window-minimize", (e) => {
    const r = q.fromWebContents(e.sender) ?? t.getMainWindow();
    r == null || r.minimize();
  }), D.on("window-maximize", (e) => {
    const r = q.fromWebContents(e.sender) ?? t.getMainWindow();
    !r || r.isDestroyed() || (r.isMaximized() ? r.unmaximize() : r.maximize());
  }), D.on("window-close", (e) => {
    const r = q.fromWebContents(e.sender) ?? t.getMainWindow();
    r == null || r.close();
  }), D.handle("window-activate", (e, r = !1) => {
    const i = q.fromWebContents(e.sender) ?? t.getMainWindow();
    return !i || i.isDestroyed() ? !1 : (i.isMinimized() && i.restore(), i.isVisible() || i.show(), process.platform === "darwin" ? $.focus({ steal: !0 }) : $.focus(), typeof i.moveTop == "function" && i.moveTop(), i.focus(), r && !i.isAlwaysOnTop() && (i.setAlwaysOnTop(!0, "screen-saver"), setTimeout(() => {
      i.isDestroyed() || i.setAlwaysOnTop(!1);
    }, ai)), !0);
  });
}
const ui = E.dirname(dn(import.meta.url));
process.env.APP_ROOT = E.join(ui, "..");
const ct = process.env.VITE_DEV_SERVER_URL, li = E.join(process.env.APP_ROOT, "dist-electron"), Ir = E.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ct ? E.join(process.env.APP_ROOT, "public") : Ir;
const yr = E.join(process.env.APP_ROOT, "build", "icons", "icon.png"), di = "Omniflow", fi = "omniflow-app", mi = 1400, pi = 920, At = 600, Wt = 400, gi = "window-state.json", yi = 200, hi = process.env.NODE_ENV === "test" || !!(ct || process.env.ELECTRON_RENDERER_URL) || process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === "true", wi = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === "true";
wi || ($.commandLine.appendSwitch("disable-logging"), $.commandLine.appendSwitch("log-level", "3"));
$.setName(di);
try {
  const t = E.join($.getPath("appData"), fi);
  $.setPath("userData", t);
} catch {
}
function $r() {
  return ut(yr) ? yr : null;
}
let z = null, zr = !1, nt = null;
function Hr() {
  return E.join($.getPath("userData"), gi);
}
function we(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function bi(t, e) {
  return t >= At && e >= Wt;
}
function Si(t) {
  return ln.getAllDisplays().some((r) => {
    const i = r.workArea;
    return t.x < i.x + i.width && t.x + t.width > i.x && t.y < i.y + i.height && t.y + t.height > i.y;
  });
}
function vi() {
  try {
    const t = Hr();
    if (!ut(t))
      return null;
    const e = mn(t, "utf-8"), r = JSON.parse(e);
    if (!we(r.width) || !we(r.height) || !bi(r.width, r.height))
      return null;
    const i = !!r.maximized, s = {
      width: r.width,
      height: r.height,
      maximized: i
    };
    return we(r.x) && we(r.y) && (s.x = r.x, s.y = r.y), we(s.x) && we(s.y) && (Si({
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height
    }) || (delete s.x, delete s.y)), s;
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
      }, i = Hr();
      Ut(E.dirname(i), { recursive: !0 }), pn(i, JSON.stringify(r), "utf-8");
    } catch {
    }
}
function ot(t) {
  nt && clearTimeout(nt), nt = setTimeout(() => {
    nt = null, Nt(t);
  }, yi);
}
function Ei(t) {
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
const xt = si({
  debugEnabled: hi,
  getMainWindow: () => z
});
function jr() {
  if (z && !z.isDestroyed())
    return z.show(), z.focus(), z;
  const t = $r(), e = vi(), r = (e == null ? void 0 : e.width) ?? mi, i = (e == null ? void 0 : e.height) ?? pi, s = new q({
    width: r,
    height: i,
    minWidth: At,
    minHeight: Wt,
    backgroundColor: "#f5f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...we(e == null ? void 0 : e.x) && we(e == null ? void 0 : e.y) ? { x: e.x, y: e.y } : {},
    webPreferences: {
      preload: E.join(li, "preload.mjs"),
      devTools: !0
    },
    autoHideMenuBar: !0,
    ...t ? { icon: t } : {}
  });
  return z = s, e != null && e.maximized && s.maximize(), s.on("move", () => {
    ot(s);
  }), s.on("resize", () => {
    ot(s);
  }), s.on("maximize", () => {
    ot(s);
  }), s.on("unmaximize", () => {
    ot(s);
  }), s.on("close", (l) => {
    Nt(s), process.platform === "darwin" && !zr && (l.preventDefault(), s.hide());
  }), s.on("closed", () => {
    z === s && (z = null);
  }), s.webContents.setZoomFactor(1), s.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
  }), s.webContents.on("before-input-event", (l, p) => {
    if (Ti(p)) {
      l.preventDefault();
      return;
    }
    Ei(p) && (l.preventDefault(), s.webContents.toggleDevTools());
  }), s.on("app-command", (l, p) => {
    (p === "browser-backward" || p === "browser-forward") && l.preventDefault();
  }), s.on("swipe", (l, p) => {
    (p === "left" || p === "right") && l.preventDefault();
  }), ct ? s.loadURL(ct) : s.loadFile(E.join(Ir, "index.html")), s;
}
$.on("before-quit", () => {
  zr = !0, z && !z.isDestroyed() && Nt(z);
});
$.on("window-all-closed", () => {
  process.platform !== "darwin" && $.quit();
});
$.on("activate", () => {
  if (z && !z.isDestroyed()) {
    z.isMinimized() && z.restore(), z.show(), z.focus();
    return;
  }
  q.getAllWindows().length === 0 && jr();
});
$.whenReady().then(() => {
  const t = $r();
  t && process.platform === "darwin" && $.dock.setIcon(t), xt.configureSession(), xt.initializeBridges(), qn(), ci({
    getMainWindow: () => z
  }), xt.registerIpcHandlers(), jr();
});
export {
  li as MAIN_DIST,
  Ir as RENDERER_DIST,
  ct as VITE_DEV_SERVER_URL
};
