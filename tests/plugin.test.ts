import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesFilterSwitchesPlugin, { DEFAULT_SETTINGS, presetCommandId } from '../src/main';
import { bindPro, isPro } from '../src/pro';
import { hashText, readConfig, readSelection, savePreset } from '../src/basefile';
import manifest from '../manifest.json';

function makePlugin() {
	const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
	return new BasesFilterSwitchesPlugin(app as never, manifest as never);
}

describe('BasesFilterSwitchesPlugin', () => {
	it('loads default settings from an empty data.json', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('is free until a GitHub Sponsors answer says Pro', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		expect(plugin.isPro()).toBe(false);
		expect(isPro()).toBe(false);
	});

	it('gives each preset a stable command id that depends on the base path and the name', () => {
		expect(presetCommandId('Tasks.base', 'Open')).toBe(presetCommandId('Tasks.base', 'Open'));
		expect(presetCommandId('Tasks.base', 'Open')).not.toBe(presetCommandId('Other.base', 'Open'));
		expect(presetCommandId('Tasks.base', 'Open')).toMatch(/^preset-[0-9a-z]+$/);
	});

	it('a preset command applies the preset as it is saved now, not as it was when the command was made', async () => {
		const base = `filterSwitches:\n  groups:\n    - name: S\n      switches:\n        - label: A\n          filter: a == 1\n        - label: B\n          filter: b == 1\n  presets:\n    - name: Open\n      on: [S/A]\n`;
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		try {
			const app = App.createConfigured__({ files: { 'Tasks.base': base } });
			const plugin = new BasesFilterSwitchesPlugin(app as never, manifest as never);
			await plugin.syncPresetCommands();
			const file = app.vault.getFileByPath('Tasks.base');
			if (!file) throw new Error('no file');
			await app.vault.modify(file, savePreset(base, { name: 'Open', on: ['S/B'] }));
			await plugin.syncPresetCommands();
			const commands = [...(plugin as unknown as { commands__: Map<string, { callback?: () => void }> }).commands__.values()];
			expect(commands).toHaveLength(1);
			commands[0]?.callback?.();
			await new Promise((r) => setTimeout(r, 20));
			const text = await app.vault.read(file);
			expect(readSelection(text, readConfig(text).groups).S).toEqual(['B']);
		} finally {
			bindPro(null);
		}
	});

	it('quick filters: the base gets only the items, the chips live in the plugin data, any remove order gives the original back', async () => {
		const base = `filters: file.inFolder("Tasks")\nviews:\n  - type: table\n    name: All\n`;
		const app = App.createConfigured__({ files: { 'Tasks.base': base } });
		const plugin = new BasesFilterSwitchesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('Tasks.base');
		if (!file) throw new Error('no file');
		const chips = () => plugin.settings.quick['Tasks.base']?.chips.map((q) => q.filter) ?? [];
		expect(await plugin.saveQuick(file as never, { property: 'status', match: 'is', value: 'todo' })).toBe(true);
		expect(await plugin.saveQuick(file as never, { property: 'area', match: 'is', value: 'work' })).toBe(true);
		expect(chips()).toEqual(['area == "work"']);
		expect(await app.vault.read(file)).toBe('filters:\n  and:\n    - file.inFolder("Tasks")\n    - area == "work"\nviews:\n  - type: table\n    name: All\n');
		expect(await plugin.saveQuick(file as never, { property: 'area', match: 'is', value: 'work' })).toBe(false);
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		try {
			expect(await plugin.saveQuick(file as never, { property: 'status', match: 'contains', value: 'To' })).toBe(true);
			expect(chips()).toEqual(['area == "work"', 'status.toString().lower().contains("to")']);
		} finally {
			bindPro(null);
		}
		expect(await app.vault.read(file)).not.toContain('filterSwitches');
		// The plugin data survives a reload.
		const saved = (await plugin.loadData()) as { quick: Record<string, unknown> };
		expect(Object.keys(saved.quick)).toEqual(['Tasks.base']);
		await plugin.loadSettings();
		expect(chips()).toEqual(['area == "work"', 'status.toString().lower().contains("to")']);
		// Oldest first, then the newest: the original bytes.
		await plugin.removeQuick(file as never, hashText('area == "work"'));
		await plugin.removeQuick(file as never, hashText('status.toString().lower().contains("to")'));
		expect(await app.vault.read(file)).toBe(base);
		expect(plugin.settings.quick).toEqual({});
	});

	it('quick filters follow a renamed base and go with a deleted one', async () => {
		const base = `filters:\n  and:\n    - a == 1\n`;
		const app = App.createConfigured__({ files: { 'Tasks.base': base } });
		const plugin = new BasesFilterSwitchesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('Tasks.base');
		if (!file) throw new Error('no file');
		await plugin.saveQuick(file as never, { property: 'status', match: 'is', value: 'todo' });
		const move = (plugin as unknown as { moveQuick(o: string, n: string | null): void }).moveQuick.bind(plugin);
		move('Tasks.base', 'Work/Tasks.base');
		expect(Object.keys(plugin.settings.quick)).toEqual(['Work/Tasks.base']);
		await app.vault.rename(file, 'Work/Tasks.base');
		expect(plugin.quickState(file as never)?.chips.map((q) => q.filter)).toEqual(['status == "todo"']);
		await plugin.clearQuick(file as never);
		expect(await app.vault.read(file)).toBe(base);
		await plugin.saveQuick(file as never, { property: 'status', match: 'is', value: 'todo' });
		move('Work/Tasks.base', null);
		expect(plugin.settings.quick).toEqual({});
	});

	it('ignores saved quick data in a wrong form', async () => {
		const plugin = makePlugin();
		await plugin.saveData({ showAdd: false, quick: { 'a.base': { chips: [{ id: 1 }], live: 'x' }, 'b.base': 'no', 'c.base': { chips: [{ id: 'i', property: 'p', match: 'is', value: 'v', filter: 'p == "v"' }], live: 'h', origin: 3 } } });
		await plugin.loadSettings();
		expect(plugin.settings.showAdd).toBe(false);
		expect(plugin.settings.quick).toEqual({ 'c.base': { chips: [{ id: 'i', property: 'p', match: 'is', value: 'v', filter: 'p == "v"' }], live: 'h', origin: null } });
	});
});
