// Inserts this mod's style, script and panels into the game's own hud.xml.
// Running it on an already-patched file replaces the old insertions (idempotent).

// Same form as the game's own includes ("s2r://panorama/styles/hud.vcss", ".../async.vts"):
// the compiled name without the trailing "_c".
export const STYLE_INCLUDE = '<include src="s2r://panorama/styles/event_timers.vcss" />';
export const SCRIPT_INCLUDE = '<include src="s2r://panorama/scripts/event_timers.vjs" />';

const START = "<!-- event-timers:start -->";
const END = "<!-- event-timers:end -->";

function wrap(text, indent) {
  return `${indent}${START}\n${text}\n${indent}${END}\n`;
}

function stripOld(xml) {
  const re = new RegExp(`[ \\t]*${START}[\\s\\S]*?${END}\\r?\\n?`, "g");
  return xml.replace(re, "");
}

function insertBefore(xml, index, text) {
  return xml.slice(0, index) + text + xml.slice(index);
}

/** Index of the start of the line containing `index`, so insertions get their own line. */
function lineStart(xml, index) {
  return xml.lastIndexOf("\n", index - 1) + 1;
}

export function patchHud(vanillaXml, snippetXml) {
  let xml = stripOld(vanillaXml);
  if (!/<root>/.test(xml) || !/<\/root>/.test(xml)) {
    throw new Error("hud.xml doesn't look like a Panorama layout (no <root>...</root>).");
  }

  // 1. Style include
  const stylesEnd = xml.indexOf("</styles>");
  if (stylesEnd >= 0) {
    xml = insertBefore(xml, lineStart(xml, stylesEnd), wrap(`\t\t${STYLE_INCLUDE}`, "\t\t"));
  } else {
    const rootOpen = xml.indexOf("<root>") + "<root>".length;
    xml = insertBefore(xml, rootOpen, `\n\t<styles>\n${wrap(`\t\t${STYLE_INCLUDE}`, "\t\t")}\t</styles>`);
  }

  // 2. Script include
  const scriptsEnd = xml.indexOf("</scripts>");
  if (scriptsEnd >= 0) {
    xml = insertBefore(xml, lineStart(xml, scriptsEnd), wrap(`\t\t${SCRIPT_INCLUDE}`, "\t\t"));
  } else {
    const after = xml.indexOf("</styles>") + "</styles>".length;
    xml = insertBefore(xml, after, `\n\t<scripts>\n${wrap(`\t\t${SCRIPT_INCLUDE}`, "\t\t")}\t</scripts>`);
  }

  // 3. Panels: inside the top-level HUD element, just before its closing tag.
  const rootClose = xml.lastIndexOf("</root>");
  const hudClose = xml.lastIndexOf("</", rootClose - 1);
  if (hudClose < 0 || hudClose <= xml.indexOf("<root>")) {
    throw new Error("Couldn't find the HUD's top-level element inside <root>.");
  }
  const snippet = snippetXml
    .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((l) => `\t\t${l}`)
    .join("\n");
  xml = insertBefore(xml, lineStart(xml, hudClose), wrap(snippet, "\t\t"));

  return xml;
}
