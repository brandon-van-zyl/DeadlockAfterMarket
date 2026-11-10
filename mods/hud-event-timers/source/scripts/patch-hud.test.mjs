import { test } from "node:test";
import assert from "node:assert/strict";
import { patchHud, SCRIPT_INCLUDE, STYLE_INCLUDE } from "./patch-hud.mjs";

const snippet = `<!-- comment -->\n<Panel id="DATimers" />\n<Label id="DATimersBanner" />\n`;

const withBlocks = `<root>
	<styles>
		<include src="s2r://panorama/styles/hud.vcss_c" />
	</styles>
	<scripts>
		<include src="s2r://panorama/scripts/hud.vjs_c" />
	</scripts>
	<CitadelHud class="WindowRoot" hittest="false">
		<Panel id="Existing" />
	</CitadelHud>
</root>
`;

const noScripts = `<root>
	<styles>
		<include src="s2r://panorama/styles/hud.vcss_c" />
	</styles>
	<CitadelHud class="WindowRoot">
		<Panel id="Existing" />
	</CitadelHud>
</root>
`;

const count = (s, sub) => s.split(sub).length - 1;

test("adds includes inside existing blocks and panels inside the HUD element", () => {
  const out = patchHud(withBlocks, snippet);
  assert.ok(out.indexOf(STYLE_INCLUDE) < out.indexOf("</styles>"));
  assert.ok(out.indexOf(SCRIPT_INCLUDE) > out.indexOf("<scripts>"));
  assert.ok(out.indexOf(SCRIPT_INCLUDE) < out.indexOf("</scripts>"));
  assert.ok(out.indexOf('id="DATimers"') > out.indexOf('id="Existing"'));
  assert.ok(out.indexOf('id="DATimers"') < out.indexOf("</CitadelHud>"));
  assert.ok(out.includes('<include src="s2r://panorama/scripts/hud.vjs_c" />'), "keeps the game's own includes");
  assert.equal(count(out, "<!-- comment -->"), 0);
});

test("creates a <scripts> block when the game has none", () => {
  const out = patchHud(noScripts, snippet);
  assert.equal(count(out, "<scripts>"), 1);
  assert.ok(out.indexOf("<scripts>") > out.indexOf("</styles>"));
  assert.ok(out.indexOf("<scripts>") < out.indexOf("<CitadelHud"));
});

test("is idempotent", () => {
  const once = patchHud(withBlocks, snippet);
  const twice = patchHud(once, snippet);
  assert.equal(twice, once);
  assert.equal(count(twice, SCRIPT_INCLUDE), 1);
});

test("rejects files that aren't Panorama layouts", () => {
  assert.throws(() => patchHud("<html></html>", snippet), /Panorama layout/);
});
