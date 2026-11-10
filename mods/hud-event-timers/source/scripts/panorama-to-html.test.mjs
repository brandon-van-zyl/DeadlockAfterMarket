import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradientToCss, panoramaCssToBrowser, panoramaSelectorToBrowser, panoramaXmlToHtml } from "./panorama-to-html.mjs";

test("type selectors become classes, ids and class names are left alone", () => {
  assert.equal(panoramaSelectorToBrowser(".DAOptBtn Label"), ".DAOptBtn .Label");
  assert.equal(panoramaSelectorToBrowser("#DAOptionsButton Label, Button:hover"), "#DAOptionsButton .Label, .Button:hover");
  assert.equal(panoramaSelectorToBrowser("#DALabelThing .MyLabel"), "#DALabelThing .MyLabel");
});

test("translates Panorama layout properties", () => {
  const css = panoramaCssToBrowser(`
    /* comment */
    #A { horizontal-align: right; vertical-align: top; flow-children: down; margin-top: 10px; }
    .B { width: fill-parent-flow(1.0); text-overflow: ellipsis; }
    .C.Hidden { visibility: collapse; }
    #D { horizontal-align: center; }
    #E { horizontal-align: center; width: 200px; }
  `);
  assert.match(css, /#A \{[^}]*right: 0;[^}]*top: 0;[^}]*display: flex;[^}]*flex-direction: column;[^}]*margin-top: 10px;/);
  assert.match(css, /\.B \{[^}]*flex: 1\.0 1 0;[^}]*min-width: 0;[^}]*white-space: nowrap;/);
  assert.match(css, /\.C\.Hidden \{\s*display: none;\s*\}/);
  assert.match(css, /#D \{[^}]*width: fit-content;/);
  assert.doesNotMatch(css.split("#E")[1], /fit-content/);
  assert.doesNotMatch(css, /comment|horizontal-align|flow-children|fill-parent-flow/);
});

test("translates Panorama gradients, text-shadow and fonts", () => {
  assert.equal(
    gradientToCss("gradient( linear, 0% 0%, 0% 100%, from( #14171cf0 ), color-stop( 0.4, #222 ), to( #0a0c10e6 ) )"),
    "linear-gradient(to bottom, #14171cf0 0%, #222 40%, #0a0c10e6 100%)",
  );
  assert.equal(gradientToCss("gradient( linear, 0% 0%, 100% 0%, from( #000 ), to( #fff ) )"), "linear-gradient(to right, #000 0%, #fff 100%)");
  assert.equal(gradientToCss("#123456"), null);
  const css = panoramaCssToBrowser(`#A { background-color: gradient( linear, 0% 0%, 0% 100%, from( #111 ), to( #222 ) ); text-shadow: 0px 2px 6px 1.0 #000000; font-family: "Valve Pulp"; }`);
  assert.match(css, /background: linear-gradient\(to bottom, #111 0%, #222 100%\);/);
  assert.match(css, /text-shadow: 0px 2px 6px #000000;/);
  assert.match(css, /font-family: "Valve Pulp", "Oswald"/);
});

test("converts layout XML to divs keeping ids, classes and label text", () => {
  const html = panoramaXmlToHtml(`<!-- x --><Panel id="P" class="A B" hittest="false">
    <Label id="L" text="Hi &amp; bye" />
  </Panel>`);
  assert.equal(
    html.replace(/\s+/g, " "),
    `<div class="Panel A B" id="P"> <div class="Label" id="L">Hi &amp; bye</div> </div>`,
  );
});

test("the mod's real snippet and CSS convert cleanly", () => {
  const snippet = readFileSync(new URL("../panorama/layout/hud_snippet.xml", import.meta.url), "utf8");
  const html = panoramaXmlToHtml(snippet);
  assert.equal((html.match(/<div/g) ?? []).length, (html.match(/<\/div>/g) ?? []).length);
  for (const id of ["DATimers", "DATimersRow0Name", "DATimersRow3Time", "DATimersBanner"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  const css = panoramaCssToBrowser(readFileSync(new URL("../panorama/styles/event_timers.css", import.meta.url), "utf8"));
  assert.match(css, /#DATimersBanner\.Visible/);
  assert.doesNotMatch(css, /horizontal-align|vertical-align|flow-children/);
});
