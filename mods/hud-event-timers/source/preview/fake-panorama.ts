// A tiny stand-in for Panorama's `$` and panel API, backed by the preview page's DOM.
// It's installed before src/main.ts runs, so the real mod script drives the preview unchanged.
// $.Schedule runs on simulated time so fast-forwarding stays tick-accurate.

type Task = { at: number; fn: () => void };

export const runtime = {
  /** Scheduler time in seconds (advanced by the preview's clock loop). */
  time: 0,
  queue: [] as Task[],
  logs: [] as string[],
};

const hud = document.getElementById("hud") as HTMLElement;
const wrappers = new WeakMap<HTMLElement, LabelPanel>();
const elements = new WeakMap<Panel, HTMLElement>();

function elOf(p: Panel): HTMLElement {
  const e = elements.get(p);
  if (!e) throw new Error("not a preview panel");
  return e;
}

/**
 * Panorama-style `panel.style`. Browsers have no ui-scale, so it's shown with CSS `scale` on the
 * preview minimap frame (the visible map), anchored at its bottom-left corner.
 */
const proxies = new WeakMap<HTMLElement, Record<string, string>>();
function styleProxy(el: HTMLElement): Record<string, string> {
  let p = proxies.get(el);
  if (p) return p;
  p = new Proxy(el.style as unknown as Record<string, string>, {
    set(target, prop, value) {
      if (prop === "uiScale") {
        const target2 = el.closest<HTMLElement>(".PreviewMinimapFrame") ?? el;
        target2.style.scale = String(parseFloat(String(value)) / 100);
        return true;
      }
      target[prop as string] = value;
      return true;
    },
    get(target, prop) {
      const v = target[prop as string];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  proxies.set(el, p);
  return p;
}

function wrap(el: HTMLElement | null): LabelPanel | null {
  if (!el) return null;
  let p = wrappers.get(el);
  if (p) return p;
  p = {
    get id() { return el.id; },
    get style() { return styleProxy(el); },
    BAscendantHasClass: (c: string) => !!el.parentElement?.closest(`.${CSS.escape(c)}`),
    BHasClass: (c: string) => el.classList.contains(c),
    get hittest() { return el.style.pointerEvents !== "none"; },
    set hittest(v: boolean) { el.style.pointerEvents = v ? "" : "none"; },
    // Layout in HUD pixels (the #hud scale transform doesn't affect offset sizes).
    get actuallayoutwidth() { return el.offsetWidth; },
    get actuallayoutheight() { return el.offsetHeight; },
    get actualxoffset() { return el.offsetLeft; },
    get actualyoffset() { return el.offsetTop; },
    actualuiscale_x: 1,
    actualuiscale_y: 1,
    GetChildCount: () => el.children.length,
    GetChild: (i: number) => wrap(el.children[i] as HTMLElement | undefined ?? null),
    MoveChildAfter: (child: Panel, after: Panel) => elOf(after).after(elOf(child)),
    MoveChildBefore: (child: Panel, before: Panel) => elOf(before).before(elOf(child)),
    get visible() { return el.style.display !== "none"; },
    set visible(v: boolean) { el.style.display = v ? "" : "none"; },
    get text() { return el.textContent ?? ""; },
    set text(v: string) { el.textContent = v; },
    IsValid: () => el.isConnected,
    GetParent: () => (el === hud ? null : wrap(el.parentElement)),
    FindChildTraverse: (id: string) => wrap(el.querySelector<HTMLElement>(`#${CSS.escape(id)}`)),
    FindChildrenWithClassTraverse: (cls: string) =>
      Array.from(el.querySelectorAll<HTMLElement>(`.${CSS.escape(cls)}`)).map((c) => wrap(c)!),
    AddClass: (c: string) => el.classList.add(c),
    RemoveClass: (c: string) => el.classList.remove(c),
    SetHasClass: (c: string, on: boolean) => el.classList.toggle(c, on),
    // Like Panorama, setting an event replaces the previous handler.
    SetPanelEvent: (event: string, handler: () => void) => {
      if (event !== "onactivate") return;
      el.style.cursor = "pointer";
      el.style.pointerEvents = "auto";
      el.onclick = () => handler();
    },
  };
  wrappers.set(el, p);
  elements.set(p, el);
  return p;
}

const fake: PanoramaGlobal = {
  // In the game the script's context panel is the HUD layout root (CitadelHud), which holds our panels.
  GetContextPanel: () => wrap(hud)!,
  Schedule(seconds, fn) {
    runtime.queue.push({ at: runtime.time + seconds, fn });
    return runtime.queue.length;
  },
  Msg(...args) {
    const line = args.map(String).join(" ");
    runtime.logs.push(line);
    console.log(line);
  },
  CreatePanel(type, parent, id) {
    const el = document.createElement("div");
    el.className = type;
    if (id) el.id = id;
    elOf(parent).append(el);
    return wrap(el)!;
  },
  persistentStorage: {
    getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  },
  // "key_F9" -> the F9 key. In the game this may only fire while the HUD has focus.
  RegisterKeyBind(_panel, key, handler) {
    const want = key.replace(/^key_/, "").toLowerCase();
    document.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === want) { e.preventDefault(); handler(); }
    });
  },
};

(globalThis as unknown as { $: PanoramaGlobal }).$ = fake;

/** Advances scheduler time by dt seconds, running due callbacks in order. */
export function advance(dt: number): void {
  const target = runtime.time + dt;
  for (;;) {
    let next = -1;
    for (let i = 0; i < runtime.queue.length; i++) {
      if (runtime.queue[i].at <= target && (next < 0 || runtime.queue[i].at < runtime.queue[next].at)) next = i;
    }
    if (next < 0) break;
    const [task] = runtime.queue.splice(next, 1);
    runtime.time = Math.max(runtime.time, task.at);
    task.fn();
  }
  runtime.time = target;
}
