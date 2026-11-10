// Browser preview of the HUD: npm run preview
// Serves a local page where the real mod script runs against a fake match clock, over a
// screenshot from mods/hud-event-timers/images. Reloads when CSS, layout, events or code change.
//   npm run preview -- --no-open    don't open the browser
//   npm run preview -- --port 5200  use another port

import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { panoramaCssToBrowser, panoramaXmlToHtml } from "./panorama-to-html.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");
const imagesDir = join(src, "..", "images");
const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
let port = portArg >= 0 ? Number(args[portArg + 1]) : 5178;
const open = !args.includes("--no-open");

const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

async function images() {
  try {
    return (await readdir(imagesDir)).filter((f) => IMAGE_TYPES[extname(f).toLowerCase()]).sort();
  } catch {
    return [];
  }
}

/** Background screenshot: the first image in images/. */
async function firstImage() {
  return (await images())[0] ?? null;
}

/**
 * Optional minimap picture for the fake minimap: preview/minimap.png (kept out of images/,
 * which is for GameBanana screenshots). Returns an absolute path.
 */
async function minimapImage() {
  for (const ext of Object.keys(IMAGE_TYPES)) {
    const p = join(src, "preview", `minimap${ext}`);
    try { await readFile(p); return p; } catch { /* try the next one */ }
  }
  return null;
}

// --- Game fonts (optional): preview/fonts/ValvePulp-Bold.woff2 -> family "Valve Pulp", weight 700
const fontsDir = join(src, "preview", "fonts");
const FONT_TYPES = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf" };
const WEIGHTS = { thin: 100, extralight: 200, light: 300, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, black: 900 };

async function fontFiles() {
  try {
    return (await readdir(fontsDir)).filter((f) => FONT_TYPES[extname(f).toLowerCase()]).sort();
  } catch {
    return [];
  }
}

export function fontFace(file) {
  const base = file.slice(0, -extname(file).length);
  const [name, style = "regular"] = base.split(/[-_]/);
  const family = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  const weight = WEIGHTS[style.toLowerCase()] ?? 400;
  return `@font-face { font-family: "${family}"; src: url("/fonts/${encodeURIComponent(file)}"); font-weight: ${weight}; font-display: block; }`;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function page() {
  const [template, snippet, image, fonts, mapImage] = await Promise.all([
    readFile(join(src, "preview", "index.html"), "utf8"),
    readFile(join(src, "panorama", "layout", "hud_snippet.xml"), "utf8"),
    firstImage(),
    fontFiles(),
    minimapImage(),
  ]);
  const bgInfo = [
    image
      ? `Background: <code>images/${escapeHtml(image)}</code>.`
      : "No screenshot yet: add an in-game screenshot to <code>mods/hud-event-timers/images/</code> to preview over the real HUD.",
    fonts.length
      ? `Fonts: ${fonts.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}.`
      : "Game fonts not added, so a lookalike is shown. See <code>preview/fonts/README.txt</code>.",
    mapImage
      ? "Minimap: <code>preview/minimap.png</code>."
      : "Fake minimap is a drawing: save a minimap screenshot as <code>source/preview/minimap.png</code> to place markers on the real map.",
  ].join(" ");
  return template
    .replace("<!-- SNIPPET -->", panoramaXmlToHtml(snippet))
    .replace("<!-- BGINFO -->", bgInfo)
    .replace("<!-- PLACEHOLDER -->", image ? "" : '<div id="placeholder">Add a screenshot to images/ for a real background</div>')
    .replace("/* BACKGROUND */", image ? `background: #000 url("/bg?v=${Date.now()}") center / cover no-repeat;` : "")
    .replace("/* MINIMAP */", mapImage ? `url("/minimap?v=${Date.now()}") center / 100% 100% no-repeat,` : "");
}

async function bundle() {
  try {
    const result = await build({
      entryPoints: [join(src, "preview", "client.ts")],
      bundle: true,
      write: false,
      format: "iife",
      target: "es2020",
      sourcemap: "inline",
      define: { __DEBUG__: "false" },
      logLevel: "silent",
    });
    return result.outputFiles[0].text;
  } catch (e) {
    const msg = (e.errors ?? [{ text: String(e) }])
      .map((er) => `${er.location ? `${er.location.file}:${er.location.line}: ` : ""}${er.text}`)
      .join("\n");
    console.error(`Build error:\n${msg}`);
    return `const el = document.getElementById("error"); el.hidden = false; el.textContent = ${JSON.stringify(`Build error: ${msg}`)};`;
  }
}

// --- Live reload ---------------------------------------------------------------
const clients = new Set();
let reloadTimer = null;
function reloadAll(reason) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`Changed: ${reason} -> reloading`);
    for (const res of clients) res.write("event: reload\ndata: 1\n\n");
  }, 150);
}
for (const [dir, recursive] of [
  [join(src, "src"), true],
  [join(src, "preview"), true],
  [join(src, "panorama"), true],
  [imagesDir, false],
]) {
  try {
    watch(dir, { recursive }, (_, file) => reloadAll(file ?? dir));
  } catch { /* folder missing: nothing to watch */ }
}
watch(src, (_, file) => { if (file === "events.json") reloadAll("events.json"); });

// --- Server --------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status, type, body) => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };
  try {
    switch (url.pathname) {
      case "/":
        return send(200, "text/html; charset=utf-8", await page());
      case "/app.js":
        return send(200, "text/javascript; charset=utf-8", await bundle());
      case "/panel.css":
        return send(200, "text/css; charset=utf-8",
          panoramaCssToBrowser(await readFile(join(src, "panorama", "styles", "event_timers.css"), "utf8")));
      case "/fonts.css":
        return send(200, "text/css; charset=utf-8", (await fontFiles()).map(fontFace).join("\n"));
      case "/bg": {
        const image = await firstImage();
        if (!image) return send(404, "text/plain", "No image");
        return send(200, IMAGE_TYPES[extname(image).toLowerCase()], await readFile(join(imagesDir, image)));
      }
      case "/minimap": {
        const image = await minimapImage();
        if (!image) return send(404, "text/plain", "No minimap image");
        return send(200, IMAGE_TYPES[extname(image).toLowerCase()], await readFile(image));
      }
      case "/live":
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      default: {
        if (url.pathname.startsWith("/fonts/")) {
          const name = decodeURIComponent(url.pathname.slice("/fonts/".length));
          if ((await fontFiles()).includes(name)) {
            return send(200, FONT_TYPES[extname(name).toLowerCase()], await readFile(join(fontsDir, name)));
          }
        }
        return send(404, "text/plain", "Not found");
      }
    }
  } catch (e) {
    console.error(e);
    send(500, "text/plain", String(e));
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && portArg < 0 && port < 5190) {
    port += 1;
    server.listen(port, "127.0.0.1");
  } else {
    console.error(e.message);
    process.exit(1);
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = `http://localhost:${port}/`;
  console.log(`Event Timers preview: ${address}`);
  console.log("Watching CSS, layout, events.json, code and images. Ctrl+C to stop.");
  if (open && process.platform === "win32") spawn("cmd", ["/c", "start", "", address], { stdio: "ignore", detached: true }).unref();
});
