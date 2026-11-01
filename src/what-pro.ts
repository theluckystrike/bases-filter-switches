// "What Pro adds" for this plugin: the Pro lines of pro-features.ts, each with a demo that runs the real base file code
// on a sample base text in the window. A demo never reads or writes a vault file and never turns Pro on for a real base.
import type { App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { demoText, showWhatProAdds, type WhatProDemoFeature, type WhatProModal } from './license/github-obsidian';
import {
	addQuick,
	applySelection,
	defaultSelection,
	FREE_QUICK,
	limitConfig,
	presetSelection,
	PRO_QUICK,
	readConfig,
	readDefault,
	readSelection,
	saveDefault,
	savePreset,
	selectionKeys,
	switchesFromValues,
	type QuickInput,
	type QuickState,
	type SwitchConfig,
} from './basefile';
import { PRO_FEATURES } from './pro-features';
import { PRO_UI, SPONSORS } from './pro';

/** A sample base file. It lives only in this window. */
export const SAMPLE_BASE = [
	'filters:',
	'  and:',
	'    - file.inFolder("Tasks")',
	'views:',
	'  - type: table',
	'    name: All tasks',
	'filterSwitches:',
	'  groups:',
	'    - name: Status',
	'      switches:',
	'        - label: Todo',
	'          filter: status == "todo"',
	'        - label: Doing',
	'          filter: status == "doing"',
	'        - label: Done',
	'          filter: status == "done"',
	'        - label: Blocked',
	'          filter: status == "blocked"',
	'    - name: Area',
	'      switches:',
	'        - label: Work',
	'          filter: area == "work"',
	'        - label: Home',
	'          filter: area == "home"',
	'',
].join('\n');

/** The top-level filters of a base text: the part that the switches change. */
export function filtersBlock(text: string): string {
	const lines = text.split('\n');
	const start = lines.findIndex((l) => l.startsWith('filters:'));
	if (start < 0) return '';
	let end = start + 1;
	while (end < lines.length && /^\s/.test(lines[end] ?? '')) end++;
	return lines.slice(start, end).join('\n');
}

const describe = (config: SwitchConfig): string => config.groups.map((g) => `${g.name}: ${g.switches.map((s) => s.label).join(', ')}`).join('\n');

const DEMOS: Record<string, (el: HTMLElement) => void> = {
	unlimited: (el) => {
		const config = readConfig(SAMPLE_BASE);
		const free = limitConfig(config, false);
		demoText(el, `The free version shows these switches of the sample base, and "${free.hidden} more with Pro":`, describe(free.config));
		demoText(el, 'Pro shows every switch:', describe(limitConfig(config, true).config));
		const groups = config.groups;
		const on = applySelection(SAMPLE_BASE, groups, { Status: ['Todo', 'Blocked'], Area: ['Work'] });
		demoText(el, 'Turn on Todo, Blocked and Work. The filters of the base become:', filtersBlock(on));
	},
	presets: (el) => {
		const groups = readConfig(SAMPLE_BASE).groups;
		const preset = { name: 'Open work', on: ['Status/Todo', 'Status/Doing', 'Area/Work'] };
		const saved = savePreset(SAMPLE_BASE, preset);
		const stored = readConfig(saved).presets.find((p) => p.name === preset.name);
		if (!stored) throw new Error('the preset was not saved');
		const applied = applySelection(saved, groups, presetSelection(groups, stored));
		demoText(el, `The preset "${stored.name}" gets the command "Apply preset ${stored.name} to Tasks". It turns on Todo, Doing and Work:`, filtersBlock(applied));
	},
	default: (el) => {
		const groups = readConfig(SAMPLE_BASE).groups;
		const withDefault = saveDefault(SAMPLE_BASE, ['Status/Doing']);
		const changed = applySelection(withDefault, groups, { Status: ['Done'], Area: ['Home'] });
		const back = applySelection(changed, groups, defaultSelection(groups, readDefault(changed)));
		demoText(el, 'The default of the sample base is Doing. Someone turns on Done and Home:', filtersBlock(changed));
		demoText(el, 'The command "Apply the default switches of the current base" turns on Doing again:', filtersBlock(back));
		demoText(el, 'Switches on after the command:', selectionKeys(readSelection(back, groups)).join(', '));
	},
	property: (el) => {
		const values: unknown[] = ['Work', 'Home', ['Work', 'Garden'], 'Home'];
		const rows = switchesFromValues('area', values).map((s) => `${s.label}: ${s.filter}`);
		demoText(el, 'The notes have the values Work, Home and Garden in the list property area. One switch for each value:', rows.join('\n'));
	},
	quick: (el) => {
		const groups = readConfig(SAMPLE_BASE).groups;
		const inputs: QuickInput[] = [
			{ property: 'owner', match: 'is', value: 'Ben' },
			{ property: 'priority', match: 'is', value: 'high' },
			{ property: 'title', match: 'contains', value: 'report' },
		];
		const run = (max: number): string => {
			let text = SAMPLE_BASE;
			let state: QuickState | null = null;
			for (const input of inputs) {
				const r = addQuick(text, groups, input, [input.value], max, state);
				if (r.error !== null) throw new Error(r.error);
				text = r.text;
				state = r.state;
			}
			return filtersBlock(text);
		};
		demoText(el, 'Add 3 quick filters, one after the other:', inputs.map((i) => `${i.property} ${i.match === 'is' ? 'is' : 'contains'} ${i.value}`).join('\n'));
		demoText(el, `The free version keeps ${FREE_QUICK}. Each new one replaces the old one:`, run(FREE_QUICK));
		demoText(el, `Pro joins up to ${PRO_QUICK} with "and":`, run(PRO_QUICK));
	},
};

export function whatProFeatures(): WhatProDemoFeature[] {
	return PRO_FEATURES.map((f) => ({ ...f, demo: DEMOS[f.id] ?? ((el: HTMLElement) => void el.createEl('p', { text: f.line })) }));
}

export function openWhatPro(app: App, pro: SponsorsManager | null, pluginId: string, pluginName: string): WhatProModal {
	return showWhatProAdds(app, pro, { pluginId, pluginName, features: whatProFeatures(), priceText: PRO_UI.priceText }, SPONSORS);
}
