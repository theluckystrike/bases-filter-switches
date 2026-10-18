import { describe, expect, it } from 'vitest';
import { SwitchBar, type BarHost } from '../src/bar';
import { applySelection, readConfig, readSelection, reset, toggle, toggleGroupPaused, type GroupDef } from '../src/basefile';

// Free tier: 4 switches in one group, the 4th is hidden and is on in the file (Pro ran out).
const BASE = `filters:\n  and:\n    - a == 4\nfilterSwitches:\n  groups:\n    - name: S\n      switches:\n${[1, 2, 3, 4].map((n) => `        - label: a${n}\n          filter: a == ${n}\n`).join('')}`;

function host(state: { text: string }): BarHost {
	const noop = (): Promise<void> => Promise.resolve();
	return {
		read: () => Promise.resolve(state.text),
		resolve: (c) => c,
		showAdd: () => true,
		toggle: (_f, groups: GroupDef[], group, label) => {
			const g = groups.find((x) => x.name === group);
			if (g) state.text = applySelection(state.text, groups, toggle(readSelection(state.text, groups), g, label));
			return noop();
		},
		reset: (_f, groups: GroupDef[], group) => {
			state.text = applySelection(state.text, groups, reset(readSelection(state.text, groups), group));
			return noop();
		},
		pauseGroup: (_f, groups, group) => {
			state.text = toggleGroupPaused(state.text, groups, group);
			return noop();
		},
		applyPreset: noop,
		savePreset: () => undefined,
		deletePreset: noop,
		applyDefault: noop,
		saveDefault: noop,
		clearDefault: noop,
		addSwitch: () => undefined,
		editSwitch: () => undefined,
		removeSwitch: noop,
	};
}

async function clickChip(state: { text: string }, key: string): Promise<void> {
	const bar = new SwitchBar(host(state), {} as never);
	await bar.render();
	const chip = bar.el.querySelector<HTMLButtonElement>(`[data-fsw-key="${key}"]`);
	if (!chip) throw new Error(`no chip ${key}`);
	chip.click();
}

describe('switch bar, free tier with a hidden switch that is on', () => {
	it('a click on a shown switch joins it with the hidden one in one or item', async () => {
		const state = { text: BASE };
		await clickChip(state, 'S/a1');
		expect(readSelection(state.text, readConfig(state.text).groups).S).toEqual(['a1', 'a4']);
		expect(state.text).toContain('or:');
	});
	it('the All switch removes the filter of the hidden switch too', async () => {
		const state = { text: BASE };
		await clickChip(state, 'all:S');
		expect(readSelection(state.text, readConfig(state.text).groups).S).toEqual([]);
		expect(state.text).not.toContain('a == 4\nfilterSwitches');
	});
});


describe('pause and resume a group without Pro', () => {
	it('keeps the hidden active switch when it pauses and resumes the group', async () => {
		const state = { text: BASE };
		await clickChip(state, 'pause:S');
		expect(readSelection(state.text, readConfig(state.text).groups).S).toEqual([]);
		await clickChip(state, 'pause:S');
		expect(readSelection(state.text, readConfig(state.text).groups).S).toEqual(['a4']);
	});
});
