// The switch bar: one row of chips under the Bases toolbar, for a .base tab or a ![[x.base]] embed.
import { Menu, setIcon, type TFile } from 'obsidian';
import { activeQuick, limitConfig, readConfig, readDefault, readPaused, readSelection, selectionKeys, switchKey, type GroupDef, type PresetDef, type QuickFilter, type QuickState, type Selection, type SwitchConfig } from './basefile';
import { isPro } from './pro';

export const BAR_CLASS = 'fsw-bar';

/** What the bar needs from the plugin. Kept small so the bar is easy to follow. */
export interface BarHost {
	read(file: TFile): Promise<string>;
	resolve(config: SwitchConfig): SwitchConfig;
	showAdd(): boolean;
	toggle(file: TFile, groups: GroupDef[], group: string, label: string): Promise<void>;
	reset(file: TFile, groups: GroupDef[], group: string | null): Promise<void>;
	pauseGroup(file: TFile, groups: GroupDef[], group: string): Promise<void>;
	applyPreset(file: TFile, preset: PresetDef): Promise<void>;
	savePreset(file: TFile): void;
	deletePreset(file: TFile, name: string): Promise<void>;
	applyDefault(file: TFile, groups: GroupDef[]): Promise<void>;
	saveDefault(file: TFile): Promise<void>;
	clearDefault(file: TFile): Promise<void>;
	addSwitch(file: TFile): void;
	editSwitch(file: TFile, group: string, label: string, filter: string): void;
	removeSwitch(file: TFile, groups: GroupDef[], group: string, label: string): Promise<void>;
	/** Opens the "Filter by property" window. view is the name of the view that the base shows now, when known. */
	quickFilter(file: TFile, view: string | null): void;
	/** The quick filter chips of a base, from the plugin data. */
	quickState(file: TFile): QuickState | null;
	removeQuick(file: TFile, id: string): Promise<void>;
	clearQuick(file: TFile): Promise<void>;
}

/** The chip text of a quick filter, for example "author: Le Guin". */
export function quickLabel(q: QuickFilter): string {
	return q.match === 'contains' ? `${q.property} contains ${q.value}` : `${q.property}: ${q.value}`;
}

export class SwitchBar {
	readonly el: HTMLElement;
	private renderSeq = 0;
	/** True when a group takes its switches from property values (re-render when notes change). */
	hasProperty = false;

	constructor(
		private readonly host: BarHost,
		readonly file: TFile,
	) {
		this.el = createDiv({ cls: BAR_CLASS, attr: { role: 'toolbar', 'aria-label': 'Filter switches' } });
		this.el.addEventListener('keydown', (e) => this.onKey(e));
	}

	destroy(): void {
		this.renderSeq++;
		this.el.remove();
	}

	async render(): Promise<void> {
		const seq = ++this.renderSeq;
		const text = await this.host.read(this.file);
		if (seq !== this.renderSeq) return; // a newer render started while this one read the file
		const raw = readConfig(text);
		this.hasProperty = raw.groups.some((g) => g.property !== undefined);
		const resolved = this.host.resolve(raw);
		const { config, hidden } = limitConfig(resolved, isPro());
		// Reads and writes use every group, so a switch that the free version hides is never cut off from its group.
		const all = resolved.groups;
		const selection = readSelection(text, all);
		const focused = this.el.contains(activeDocument.activeElement) ? activeDocument.activeElement?.getAttribute('data-fsw-key') : null;
		this.el.empty();
		const quick = activeQuick(text, this.host.quickState(this.file));
		const empty = config.groups.every((g) => g.switches.length === 0);
		this.el.toggleClass('fsw-empty', empty);
		const controls = !empty || hidden > 0 || this.host.showAdd();
		// Without controls, the bar still shows active quick filters, so they can be removed.
		if (controls) {
			for (const g of config.groups) if (g.switches.length > 0) this.renderGroup(g, all, selection, readPaused(text, g.name) !== null);
			if (config.presets.length > 0 || isPro()) this.renderPresets(config.presets, selection, empty, all, isPro() ? readDefault(text) : [], quick.length > 0);
			if (hidden > 0) this.el.createSpan({ cls: 'fsw-more', text: `${hidden} more with Pro` });
			this.button('fsw-add', '+', 'add', empty ? 'Add a filter switch' : 'Add another filter switch', () => this.host.addSwitch(this.file)).setText(empty ? '+ Filter switch' : '+');
		}
		for (const q of quick) this.renderQuick(q);
		if (controls) {
			const filter = this.button('fsw-quick', '', 'quick', 'Filter by property', () => this.host.quickFilter(this.file, this.viewName()));
			filter.setAttribute('title', 'Filter by property');
			setIcon(filter, 'filter');
		}
		const again = focused ? this.el.querySelector<HTMLElement>(`[data-fsw-key="${CSS.escape(focused)}"]`) : null;
		again?.focus();
	}

	private renderGroup(g: GroupDef, groups: GroupDef[], selection: Selection, savedPause: boolean): void {
		const on = selection[g.name] ?? [];
		const paused = savedPause && on.length === 0;
		const box = this.el.createDiv({ cls: 'fsw-group', attr: { role: 'group', 'aria-label': g.name } });
		box.createSpan({ cls: 'fsw-group-name', text: g.name });
		const pause = this.chip(box, paused ? 'Resume' : 'Pause', paused, `pause:${g.name}`, () => void this.host.pauseGroup(this.file, groups, g.name));
		pause.addClass('fsw-pause');
		pause.setAttribute('aria-label', `${paused ? 'Resume' : 'Pause'} ${g.name} filters`);
		pause.disabled = !paused && on.length === 0;
		if (g.switches.length > 1) {
			const all = this.chip(box, 'All', on.length === 0, `all:${g.name}`, () => void this.host.reset(this.file, groups, g.name));
			all.addClass('fsw-all');
			all.setAttribute('aria-label', `${g.name}: all, no filter`);
		}
		for (const s of g.switches) {
			const chip = this.chip(box, s.label, on.includes(s.label), switchKey(g.name, s.label), () => void this.host.toggle(this.file, groups, g.name, s.label));
			chip.setAttribute('title', s.filter);
			if (g.property) continue; // generated switches have no definition to edit
			chip.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((i) => i.setTitle('Edit switch').setIcon('pencil').onClick(() => this.host.editSwitch(this.file, g.name, s.label, s.filter)));
				menu.addItem((i) => i.setTitle('Remove switch').setIcon('trash').onClick(() => void this.host.removeSwitch(this.file, groups, g.name, s.label)));
				menu.showAtMouseEvent(e);
			});
		}
	}

	/** One active quick filter: its text and a remove button. */
	private renderQuick(q: QuickFilter): void {
		const label = quickLabel(q);
		const chip = this.el.createSpan({ cls: 'fsw-quick-chip', attr: { title: q.filter } });
		chip.createSpan({ cls: 'fsw-quick-text', text: label });
		const remove = chip.createEl('button', { cls: 'fsw-quick-remove', attr: { type: 'button', 'aria-label': `Remove quick filter ${label}`, 'data-fsw-key': `quick-remove:${q.filter}` } });
		setIcon(remove, 'x');
		remove.addEventListener('click', () => void this.host.removeQuick(this.file, q.id));
	}

	/** The name of the view that the Bases toolbar above the bar shows, or null. */
	private viewName(): string | null {
		const header = this.el.previousElementSibling;
		const name = header?.querySelector('.bases-toolbar-views-menu .text-button-label')?.textContent?.trim();
		return name ? name : null;
	}

	private renderPresets(presets: PresetDef[], selection: Selection, empty: boolean, groups: GroupDef[], defaultKeys: string[], hasQuick: boolean): void {
		if (empty) return;
		const current = selectionKeys(selection).sort().join('\n');
		const isDefault = defaultKeys.length > 0 && [...defaultKeys].sort().join('\n') === current;
		const btn = this.button('fsw-presets', isDefault ? 'Presets •' : 'Presets', 'presets', isDefault ? 'Presets. The default switches are on' : 'Presets', () => {
			const menu = new Menu();
			for (const p of presets) {
				const active = [...p.on].sort().join('\n') === current;
				menu.addItem((i) => i.setTitle(p.name).setChecked(active).onClick(() => void this.host.applyPreset(this.file, p)));
			}
			if (presets.length > 0) menu.addSeparator();
			menu.addItem((i) => i.setTitle('Save switches as preset').setIcon('save').onClick(() => this.host.savePreset(this.file)));
			menu.addItem((i) => i.setTitle('Apply the default switches').setIcon('undo-2').onClick(() => void this.host.applyDefault(this.file, groups)));
			menu.addItem((i) => i.setTitle('Save switches as the default').setIcon('bookmark').onClick(() => void this.host.saveDefault(this.file)));
			menu.addItem((i) => i.setTitle('Clear the saved default').setIcon('x').onClick(() => void this.host.clearDefault(this.file)));
			for (const p of presets) menu.addItem((i) => i.setTitle(`Delete preset ${p.name}`).setIcon('trash').onClick(() => void this.host.deletePreset(this.file, p.name)));
			if (hasQuick) menu.addItem((i) => i.setTitle('Clear quick filters').setIcon('filter-x').onClick(() => void this.host.clearQuick(this.file)));
			// Under the button, so the menu also opens in the right place from the keyboard.
			const r = btn.getBoundingClientRect();
			menu.showAtPosition({ x: r.left, y: r.bottom }, btn.doc);
		});
	}

	private chip(parent: HTMLElement, text: string, pressed: boolean, key: string, onClick: () => void): HTMLButtonElement {
		const b = parent.createEl('button', { cls: 'fsw-chip', text, attr: { type: 'button', 'aria-pressed': String(pressed), 'data-fsw-key': key } });
		b.toggleClass('is-active', pressed);
		b.addEventListener('click', onClick);
		return b;
	}

	private button(cls: string, text: string, key: string, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
		const b = this.el.createEl('button', { cls: `fsw-button ${cls}`, text, attr: { type: 'button', 'aria-label': label, 'data-fsw-key': key } });
		b.addEventListener('click', onClick);
		return b;
	}

	/** Arrow keys, Home and End move between the buttons of the bar (toolbar pattern). */
	private onKey(e: KeyboardEvent): void {
		const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
		if (!keys.includes(e.key)) return;
		const buttons = Array.from(this.el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
		const i = buttons.indexOf(activeDocument.activeElement as HTMLButtonElement);
		if (i < 0 || buttons.length === 0) return;
		const last = buttons.length - 1;
		const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(last, i + 1);
		e.preventDefault();
		buttons[next]?.focus();
	}
}
