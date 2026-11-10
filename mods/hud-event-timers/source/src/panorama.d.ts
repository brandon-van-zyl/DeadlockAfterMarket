// Minimal type hints for the Panorama APIs this mod uses.
// Panorama is Valve's UI system; these are the calls existing Deadlock HUD mods rely on.

interface Panel {
  id: string;
  visible: boolean;
  IsValid(): boolean;
  GetParent(): Panel | null;
  FindChildTraverse(id: string): Panel | null;
  FindChildrenWithClassTraverse(className: string): Panel[];
  AddClass(name: string): void;
  RemoveClass(name: string): void;
  SetHasClass(name: string, has: boolean): void;
  /** Tree walking, used only by the --debug label dump. */
  paneltype?: string;
  GetChildCount?(): number;
  GetChild?(index: number): Panel | null;
  /** Click handler ("onactivate"). Optional so the script still runs where it's missing. */
  SetPanelEvent?(event: string, handler: () => void): void;
  /** Minimap features: inline style, layout size/offset, child order. All optional. */
  style?: Record<string, string>;
  hittest?: boolean;
  actuallayoutwidth?: number;
  actuallayoutheight?: number;
  actualxoffset?: number;
  actualyoffset?: number;
  actualuiscale_x?: number;
  actualuiscale_y?: number;
  BAscendantHasClass?(name: string): boolean;
  BHasClass?(name: string): boolean;
  /** Panel attributes: a string store that lives as long as the panel. */
  SetAttributeString?(name: string, value: string): void;
  GetAttributeString?(name: string, fallback: string): string;
  MoveChildAfter?(child: Panel, after: Panel): void;
  MoveChildBefore?(child: Panel, before: Panel): void;
}

interface LabelPanel extends Panel {
  text: string;
}

interface PanoramaGlobal {
  GetContextPanel(): Panel;
  Schedule(seconds: number, fn: () => void): number;
  Msg(...args: unknown[]): void;
  /** Key binding on a panel, e.g. "key_F9". May only fire while the HUD has keyboard focus. */
  RegisterKeyBind?(panel: Panel, key: string, handler: () => void): void;
  /** Creates a panel under `parent` (used for the minimap markers). */
  CreatePanel?(type: string, parent: Panel, id: string): Panel;
  /** Saved settings, if Panorama exposes it here. */
  persistentStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

declare const $: PanoramaGlobal;
