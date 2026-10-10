import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesFilterSwitchesPlugin, { DEFAULT_SETTINGS, presetCommandId } from '../src/main';
import { isPro } from '../src/pro';
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
});
