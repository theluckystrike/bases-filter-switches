import { debounce, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type FileView, type SettingDefinitionItem } from 'obsidian';
import {
	addPropertyGroup,
	addSwitch,
	applySelection,
	clearDefault,
	clearPaused,
	defaultSelection,
	editSwitch,
	FREE_GROUPS,
	FREE_SWITCHES,
	hasDefault,
	presetSelection,
	readConfig,
	readDefault,
	readSelection,
	removePreset,
	removeSwitch,
	reset,
	saveDefault,
	savePreset,
	selectionKeys,
	switchesFromValues,
	toggle,
	toggleGroupPaused,
	topFilters,
	type GroupDef,
	type PresetDef,
	type SwitchConfig,
} from './basefile';
import { SwitchBar, type BarHost } from './bar';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors, sponsorsSettingItems } from './license/github-obsidian';
import { bindPro, isPro, onProChange, PRO_UI, SPONSORS } from './pro';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
import { helloSettingItems } from './hello/settings';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export interface FilterSwitchSettings {
	showAdd: boolean;
}
export const DEFAULT_SETTINGS: FilterSwitchSettings = { showAdd: true };

const isBase = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'base';

export default class BasesFilterSwitchesPlugin extends Plugin implements BarHost {
	settings: FilterSwitchSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: FilterSwitchSettingTab | null = null;
	private stopped = false;
	private bars = new Map<HTMLElement, SwitchBar>();
	private presetIds = new Set<string>();
	private values = new Map<string, unknown[]>();
	private observer: MutationObserver | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(onProChange(() => this.onPro()));
		this.settingTab = new FilterSwitchSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommands();
		this.app.workspace.onLayoutReady(() => this.start());
	}

	onunload(): void {
		this.stopped = true;
		bindPro(null);
		this.observer?.disconnect();
		for (const bar of this.bars.values()) bar.destroy();
		this.bars.clear();
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<FilterSwitchSettings>;
		this.settings = { showAdd: data.showAdd !== false };
	}

	/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
	isPro(): boolean {
		return isPro();
	}


	private start(): void {
		const scan = debounce(() => this.scan(), 120, true);
		const presets = debounce(() => void this.syncPresetCommands(), 500, true);
		const values = debounce(() => {
			this.values.clear();
			this.refreshAll(true);
		}, 1000, true);
		this.observer = new MutationObserver(() => scan());
		this.observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
		this.registerEvent(this.app.workspace.on('layout-change', () => scan()));
		this.registerEvent(
			this.app.vault.on('modify', (f) => {
				if (!isBase(f)) return;
				this.refreshFile(f);
				presets();
			}),
		);
		this.registerEvent(this.app.vault.on('rename', () => presets()));
		this.registerEvent(this.app.vault.on('delete', () => presets()));
		this.registerEvent(this.app.metadataCache.on('changed', () => values()));
		// Bars of an earlier instance of the plugin (a reload) are removed before the first scan.
		this.app.workspace.containerEl.querySelectorAll('.fsw-bar').forEach((el) => el.remove());
		this.scan();
		void this.syncPresetCommands();
		void this.pro?.refresh();
		this.registerInterval(window.setInterval(() => void this.pro?.refresh(), PRO_TICK_MS));
	}

	private onPro(): void {
		this.refreshAll();
		this.settingTab?.update();
		void this.syncPresetCommands();
	}

	/** Finds every Bases header in .base tabs and ![[x.base]] embeds and puts a bar under it. */
	scan(): void {
		if (this.stopped) return; // a debounced scan can fire after onunload
		const seen = new Set<HTMLElement>();
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const view = leaf.view as FileView;
			const header = view.containerEl.querySelector<HTMLElement>('.bases-header');
			if (header && !header.closest('.internal-embed')) this.attach(header, view.file, seen);
		}
		for (const embed of Array.from(this.app.workspace.containerEl.querySelectorAll<HTMLElement>('.internal-embed.bases-embed[src]'))) {
			const link = (embed.getAttribute('src') ?? '').split(/[#|]/)[0] ?? '';
			const file = this.app.metadataCache.getFirstLinkpathDest(link, this.sourcePathOf(embed));
			const header = Array.from(embed.querySelectorAll<HTMLElement>('.bases-header')).find((h) => h.closest('.internal-embed') === embed);
			if (header) this.attach(header, file, seen);
		}
		for (const [header, bar] of this.bars) {
			if (seen.has(header)) continue;
			bar.destroy();
			this.bars.delete(header);
		}
	}

	private sourcePathOf(el: HTMLElement): string {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view as FileView;
			if (view.containerEl.contains(el)) return view.file?.path ?? '';
		}
		return '';
	}

	private attach(header: HTMLElement, file: TFile | null, seen: Set<HTMLElement>): void {
		if (!isBase(file)) return;
		seen.add(header);
		const old = this.bars.get(header);
		if (old && old.file === file && old.el.isConnected && header.nextElementSibling === old.el) return;
		old?.destroy();
		const bar = new SwitchBar(this, file);
		header.insertAdjacentElement('afterend', bar.el);
		this.bars.set(header, bar);
		void bar.render();
	}

	refreshFile(file: TFile): void {
		for (const bar of this.bars.values()) if (bar.file === file) void bar.render();
	}

	refreshAll(onlyProperty = false): void {
		for (const bar of this.bars.values()) if (!onlyProperty || bar.hasProperty) void bar.render();
	}

	// ---- BarHost ----

	read(file: TFile): Promise<string> {
		return this.app.vault.cachedRead(file);
	}

	showAdd(): boolean {
		return this.settings.showAdd;
	}

	/** Fills Pro property groups with one switch per existing value of the property in the vault. */
	resolve(config: SwitchConfig): SwitchConfig {
		const groups = config.groups.map((g): GroupDef => (g.property ? { ...g, switches: switchesFromValues(g.property, this.valuesOf(g.property)) } : g));
		return { ...config, groups };
	}

	private valuesOf(property: string): unknown[] {
		const cached = this.values.get(property);
		if (cached) return cached;
		const out: unknown[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (fm && property in fm) out.push(fm[property]);
		}
		this.values.set(property, out);
		return out;
	}

	private async write(file: TFile, change: (text: string) => string): Promise<void> {
		try {
			await this.app.vault.process(file, change);
		} catch (e) {
			new Notice(`Filter switches: could not update ${file.name}. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async toggle(file: TFile, groups: GroupDef[], group: string, label: string): Promise<void> {
		const g = groups.find((x) => x.name === group);
		if (!g) return;
		await this.write(file, (t) => applySelection(clearPaused(t, group), groups, toggle(readSelection(t, groups), g, label)));
	}

	async pauseGroup(file: TFile, groups: GroupDef[], group: string): Promise<void> {
		await this.write(file, (t) => toggleGroupPaused(t, groups, group));
	}

	async reset(file: TFile, groups: GroupDef[], group: string | null): Promise<void> {
		await this.write(file, (t) => applySelection(clearPaused(t, group), groups, reset(readSelection(t, groups), group)));
	}

	async applyPreset(file: TFile, preset: PresetDef): Promise<void> {
		if (!this.needPro('Presets')) return;
		const groups = this.resolve(readConfig(await this.read(file))).groups;
		await this.write(file, (t) => applySelection(clearPaused(t), groups, presetSelection(groups, preset)));
	}

	async applyPresetByName(file: TFile, name: string): Promise<void> {
		const preset = readConfig(await this.read(file)).presets.find((p) => p.name === name);
		if (preset) await this.applyPreset(file, preset);
		else new Notice(`This base has no preset ${name}.`);
	}

	savePreset(file: TFile): void {
		if (!this.needPro('Presets')) return;
		new NameModal(this.app, 'Save switches as preset', 'Preset name', async (name) => {
			const groups = this.resolve(readConfig(await this.read(file))).groups;
			await this.write(file, (t) => savePreset(t, { name, on: selectionKeys(readSelection(t, groups)) }));
			new Notice(`Preset ${name} saved.`);
		}).open();
	}

	async deletePreset(file: TFile, name: string): Promise<void> {
		await this.write(file, (t) => removePreset(t, name));
	}

	async applyDefault(file: TFile, groups: GroupDef[]): Promise<void> {
		if (!this.needPro('Default switches')) return;
		const text = await this.read(file);
		if (!hasDefault(text)) {
			new Notice('This base has no saved default switches.');
			return;
		}
		const resolved = this.resolve(readConfig(text)).groups;
		await this.write(file, (t) => (hasDefault(t) ? applySelection(clearPaused(t), resolved, defaultSelection(resolved, readDefault(t))) : t));
	}

	async saveDefault(file: TFile): Promise<void> {
		if (!this.needPro('Default switches')) return;
		const groups = this.resolve(readConfig(await this.read(file))).groups;
		await this.write(file, (t) => saveDefault(t, selectionKeys(readSelection(t, groups))));
		new Notice('Default switches saved.');
	}

	async clearDefault(file: TFile): Promise<void> {
		if (!this.needPro('Default switches')) return;
		await this.write(file, (t) => clearDefault(t));
		new Notice('Default switches cleared.');
	}

	addSwitch(file: TFile): void {
		void this.openSwitchModal(file, null);
	}

	editSwitch(file: TFile, group: string, label: string, filter: string): void {
		void this.openSwitchModal(file, { group, label, filter });
	}

	async removeSwitch(file: TFile, groups: GroupDef[], group: string, label: string): Promise<void> {
		await this.write(file, (t) => removeSwitch(t, groups, group, label));
	}

	private async openSwitchModal(file: TFile, edit: SwitchDraft | null): Promise<void> {
		const text = await this.read(file);
		const config = readConfig(text);
		const draft: SwitchDraft = edit ?? { group: config.groups.find((g) => !g.property)?.name ?? 'Filters', label: '', filter: '' };
		new SwitchModal(this.app, draft, topFilters(text), (d) => this.saveSwitch(file, d, edit)).open();
	}

	/** Free tier: one group and 3 switches per base. Returns an error text, or null when the switch fits. */
	limitError(config: SwitchConfig, d: SwitchDraft): string | null {
		if (isPro()) return null;
		const others = config.groups.filter((g) => g.name !== d.group);
		if (others.length >= FREE_GROUPS) return `The free version has ${FREE_GROUPS} group per base. Use the group "${others[0]?.name ?? ''}", or get Pro for more groups.`;
		const g = config.groups.find((x) => x.name === d.group);
		const count = (g?.switches.length ?? 0) + (g?.switches.some((s) => s.label === d.label) ? 0 : 1);
		return count > FREE_SWITCHES ? `The free version has ${FREE_SWITCHES} switches per base. Pro has no limit.` : null;
	}

	private async saveSwitch(file: TFile, d: SwitchDraft, edit: SwitchDraft | null): Promise<boolean> {
		const config = readConfig(await this.read(file));
		const error = edit ? null : this.limitError(config, d);
		if (error) {
			new Notice(error);
			return false;
		}
		await this.write(file, (t) => (edit ? editSwitch(t, edit, d) : addSwitch(t, d.group, { label: d.label, filter: d.filter })));
		return true;
	}

	addPropertyGroup(file: TFile): void {
		if (!this.needPro('Switches from a property')) return;
		new PropertyModal(this.app, this.propertyNames(), async (property, single) => {
			await this.write(file, (t) => addPropertyGroup(t, property, property, single));
		}).open();
	}

	private propertyNames(): string[] {
		const names = new Set<string>();
		for (const f of this.app.vault.getMarkdownFiles()) for (const k of Object.keys(this.app.metadataCache.getFileCache(f)?.frontmatter ?? {})) names.add(k);
		return [...names].sort((a, b) => a.localeCompare(b));
	}

	needPro(what: string): boolean {
		if (isPro()) return true;
		new Notice(`${what}: a Pro feature. ${PRO_UI.priceText} See the plugin settings.`);
		return false;
	}

	// ---- commands ----

	private activeBase(): TFile | null {
		const f = this.app.workspace.getActiveFile();
		return isBase(f) ? f : null;
	}

	private addCommands(): void {
		const onBase = (id: string, name: string, run: (f: TFile) => void) =>
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const f = this.activeBase();
					if (!f) return false;
					if (!checking) run(f);
					return true;
				},
			});
		onBase('add-switch', 'Add a filter switch to the current base', (f) => this.addSwitch(f));
		onBase('reset-switches', 'Turn every filter switch off in the current base', (f) => {
			void this.read(f).then((t) => this.reset(f, this.resolve(readConfig(t)).groups, null));
		});
		onBase('save-preset', 'Save the current switches as a preset', (f) => this.savePreset(f));
		onBase('apply-default', 'Apply the default switches of the current base', (f) => {
			void this.read(f).then((t) => this.applyDefault(f, this.resolve(readConfig(t)).groups));
		});
		onBase('save-default', 'Save the current switches as the default of the current base', (f) => void this.saveDefault(f));
		onBase('clear-default', 'Clear the saved default switches of the current base', (f) => void this.clearDefault(f));
		onBase('add-property-group', 'Add switches from the values of a property', (f) => this.addPropertyGroup(f));
	}

	/** One command per preset of every base (Pro). Ids are stable: path + preset name. */
	async syncPresetCommands(): Promise<void> {
		if (this.stopped) return;
		const wanted = new Map<string, { file: TFile; preset: PresetDef }>();
		if (isPro()) {
			for (const file of this.app.vault.getFiles().filter(isBase)) {
				for (const preset of readConfig(await this.read(file)).presets) wanted.set(presetCommandId(file.path, preset.name), { file, preset });
			}
		}
		for (const id of this.presetIds) {
			if (wanted.has(id)) continue;
			this.removeCommand(id);
			this.presetIds.delete(id);
		}
		for (const [id, { file, preset }] of wanted) {
			if (this.presetIds.has(id)) continue;
			// The command reads the preset when it runs: a preset saved again under the same name keeps its id.
			this.addCommand({ id, name: `Apply preset ${preset.name} to ${file.basename}`, callback: () => void this.applyPresetByName(file, preset.name) });
			this.presetIds.add(id);
		}
	}
}

/** Stable command id for a preset: a short hash of the base path and the preset name. */
export function presetCommandId(path: string, name: string): string {
	let h = 5381;
	for (const ch of `${path}\n${name}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
	return `preset-${h.toString(36)}`;
}

interface SwitchDraft {
	group: string;
	label: string;
	filter: string;
}

class SwitchModal extends Modal {
	constructor(
		app: App,
		private readonly draft: SwitchDraft,
		private readonly existing: string[],
		private readonly onSave: (d: SwitchDraft) => Promise<boolean>,
	) {
		super(app);
	}

	onOpen(): void {
		const d = { ...this.draft };
		this.setTitle(this.draft.label ? 'Edit filter switch' : 'Add a filter switch');
		new Setting(this.contentEl).setName('Group').setDesc('Switches of one group are joined with "or". Groups are joined with "and".').addText((t) => t.setValue(d.group).onChange((v) => (d.group = v.trim())));
		new Setting(this.contentEl).setName('Label').setDesc('The text on the switch.').addText((t) => t.setPlaceholder('Todo').setValue(d.label).onChange((v) => (d.label = v.trim())));
		let filterInput: HTMLInputElement | null = null;
		new Setting(this.contentEl)
			.setName('Filter')
			.setDesc('A filter expression in the syntax of the filter editor, for example status == "todo".')
			.addText((t) => {
				filterInput = t.inputEl;
				t.setValue(d.filter).onChange((v) => (d.filter = v.trim()));
			});
		if (this.existing.length > 0) {
			new Setting(this.contentEl).setName('Use a filter of this base').addDropdown((dd) => {
				dd.addOption('', 'Choose a filter');
				for (const f of this.existing) dd.addOption(f, f);
				dd.onChange((v) => {
					if (!v || !filterInput) return;
					filterInput.value = v;
					d.filter = v;
				});
			});
		}
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('Save')
				.setCta()
				.onClick(async () => {
					if (!d.group || !d.label || !d.filter) {
						new Notice('Fill in the group, the label and the filter.');
						return;
					}
					if (await this.onSave(d)) this.close();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class NameModal extends Modal {
	constructor(
		app: App,
		private readonly heading: string,
		private readonly field: string,
		private readonly onSave: (name: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		let name = '';
		this.setTitle(this.heading);
		new Setting(this.contentEl).setName(this.field).addText((t) => t.onChange((v) => (name = v.trim())));
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('Save')
				.setCta()
				.onClick(async () => {
					if (!name) return;
					await this.onSave(name);
					this.close();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class PropertyModal extends Modal {
	constructor(
		app: App,
		private readonly names: string[],
		private readonly onSave: (property: string, single: boolean) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		let property = this.names[0] ?? '';
		let single = false;
		this.setTitle('Add switches from the values of a property');
		new Setting(this.contentEl)
			.setName('Property')
			.setDesc('One switch for each value that notes in the vault have now. New values show up by themselves.')
			.addDropdown((dd) => {
				for (const n of this.names) dd.addOption(n, n);
				dd.setValue(property).onChange((v) => (property = v));
			});
		new Setting(this.contentEl)
			.setName('One at a time')
			.setDesc('Turning on one switch of this group turns the others off.')
			.addToggle((t) => t.setValue(single).onChange((v) => (single = v)));
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('Add')
				.setCta()
				.onClick(async () => {
					if (!property) return;
					await this.onSave(property, single);
					this.close();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class FilterSwitchSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BasesFilterSwitchesPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Show the add button on bases without switches',
				desc: `A small add button under the toolbar of every base that has no switches yet. The free version has ${FREE_SWITCHES} switches in ${FREE_GROUPS} group per base.`,
				control: { type: 'toggle', key: 'showAdd', defaultValue: DEFAULT_SETTINGS.showAdd },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.refreshAll();
	}
}
