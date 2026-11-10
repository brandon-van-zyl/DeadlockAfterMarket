// Approximate conversion of Panorama layout/CSS to browser HTML/CSS, used by the preview.
// Panorama CSS is close to web CSS but has its own layout model (alignment + flow-children
// instead of flexbox), so a few properties are translated. The result is close, not exact.

/** Used in the browser when the game fonts aren't in preview/fonts/. */
export const PREVIEW_FONT_FALLBACK = '"Oswald", "Bahnschrift", "Arial Narrow", sans-serif';

/** Valve's gradient( linear, x1 y1, x2 y2, from(c), color-stop(p, c), to(c) ) -> linear-gradient(). */
export function gradientToCss(value) {
  const m = /^gradient\(\s*linear\s*,\s*([-\d.]+)%\s+([-\d.]+)%\s*,\s*([-\d.]+)%\s+([-\d.]+)%\s*,([\s\S]*)\)$/i.exec(value.trim());
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
  const dir = [y2 > y1 ? "bottom" : y2 < y1 ? "top" : "", x2 > x1 ? "right" : x2 < x1 ? "left" : ""].filter(Boolean).join(" ") || "bottom";
  const stops = [];
  for (const s of m[5].matchAll(/(from|to|color-stop)\(\s*([^()]*?(?:\([^()]*\)[^()]*?)*)\s*\)/gi)) {
    const kind = s[1].toLowerCase();
    if (kind === "from") stops.push(`${s[2].trim()} 0%`);
    else if (kind === "to") stops.push(`${s[2].trim()} 100%`);
    else {
      const [pos, ...color] = s[2].split(",");
      const p = Number(pos);
      stops.push(`${color.join(",").trim()} ${p <= 1 ? p * 100 : p}%`);
    }
  }
  return stops.length ? `linear-gradient(to ${dir}, ${stops.join(", ")})` : null;
}

function decls(body) {
  return body
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return i < 0 ? null : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim(), raw: d };
    })
    .filter(Boolean);
}

function convertDecl({ prop, value, raw }, props) {
  const v = value.toLowerCase();
  switch (prop) {
    case "horizontal-align":
      if (v === "right") return ["right: 0", "margin-left: auto"];
      if (v === "left") return ["left: 0"];
      if (v === "center") {
        return ["left: 0", "right: 0", "margin-left: auto", "margin-right: auto", ...(props.has("width") ? [] : ["width: fit-content"])];
      }
      return [];
    case "vertical-align":
      if (v === "top") return ["top: 0"];
      if (v === "bottom") return ["bottom: 0", "margin-top: auto"];
      if (v === "center" || v === "middle") {
        return ["top: 0", "bottom: 0", "margin-top: auto", "margin-bottom: auto", ...(props.has("height") ? [] : ["height: fit-content"])];
      }
      return [];
    case "flow-children": {
      const dir = { down: "column", right: "row", up: "column-reverse", left: "row-reverse" }[v];
      return dir ? ["display: flex", `flex-direction: ${dir}`] : ["display: block"];
    }
    case "visibility":
      return v === "collapse" ? ["display: none"] : [raw];
    case "width":
    case "height": {
      const fill = /^fill-parent-flow\(\s*([\d.]+)\s*\)$/.exec(v);
      if (fill) return [`flex: ${fill[1]} 1 0`, `min-${prop}: 0`];
      if (v === "fit-children") return [`${prop}: fit-content`];
      return [raw];
    }
    case "text-overflow":
      return v === "ellipsis" ? ["text-overflow: ellipsis", "overflow: hidden", "white-space: nowrap"] : [raw];
    case "background-color":
    case "background": {
      const g = gradientToCss(value);
      return g ? [`background: ${g}`] : [raw];
    }
    case "text-shadow": {
      // Panorama: x y blur strength color -> browser: x y blur color
      const parts = value.split(/\s+/);
      if (parts.length === 5 && /^[\d.]+$/.test(parts[3])) parts.splice(3, 1);
      return [`text-shadow: ${parts.join(" ")}`];
    }
    case "font-family":
      return [`font-family: ${value}, ${PREVIEW_FONT_FALLBACK}`];
    default:
      return [raw];
  }
}

/** Panorama type selectors ("Label", "Button") become classes, since the preview turns tags into div.Tag. */
export function panoramaSelectorToBrowser(selector) {
  return selector.replace(/(^|[\s>+~,(])(Panel|Label|Button|Image|TextButton)\b/g, "$1.$2");
}

export function panoramaCssToBrowser(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([^{}]+)\{([^{}]*)\}/g, (_, selector, body) => {
      const list = decls(body);
      const props = new Set(list.map((d) => d.prop));
      const out = list.flatMap((d) => convertDecl(d, props));
      return `${panoramaSelectorToBrowser(selector.trim())} {\n${out.map((d) => `  ${d};`).join("\n")}\n}\n`;
    })
    .trim() + "\n";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrs(text) {
  const out = {};
  const decode = (s) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  for (const m of text.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** Turns Panorama layout XML (<Panel>, <Label>, ...) into <div>s with the same ids and classes. */
export function panoramaXmlToHtml(xml) {
  return xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/([A-Za-z][\w]*)\s*>/g, "</div>")
    .replace(/<([A-Za-z][\w]*)\b([^>]*?)(\/?)>/g, (_, tag, rest, selfClose) => {
      const a = attrs(rest);
      const cls = [tag, a.class].filter(Boolean).join(" ");
      const id = a.id ? ` id="${escapeHtml(a.id)}"` : "";
      const open = `<div class="${escapeHtml(cls)}"${id}>`;
      return selfClose ? `${open}${escapeHtml(a.text ?? "")}</div>` : open;
    })
    .trim();
}
