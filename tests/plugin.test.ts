import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesFilterSwitchesPlugin, { DEFAULT_SETTINGS, presetCommandId } from '../src/main';
import { bindPro, isPro } from '../src/pro';
import { readConfig, readSelection, savePreset } from '../src/basefile';
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
});
