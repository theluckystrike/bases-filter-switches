import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-filter-switches.json';
import {
	addPropertyGroup,
	applySelection,
	FREE_SWITCHES,
	limitConfig,
	presetSelection,
	propertyRef,
	readConfig,
	readSelection,
	removePreset,
	reset,
	runOp,
	savePreset,
	selectionKeys,
	switchesFromValues,
	toggle,
	type GroupDef,
} from '../src/basefile';

describe('golden vectors (packages/spec/vectors/bases-filter-switches.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [text, op, args] = c.args as [string, string, unknown[]];
			expect(runOp(text, op, args)).toBe(c.expected);
		});
	}
});

const BASE = `# Tasks board
filters:
  and:
    - file.inFolder("Tasks") # only task notes
    - 'priority != "low"'
views:
  - type: table
    name: All
filterSwitches:
  # my switches
  groups:
    - name: Status
      switches:
        - label: Todo
          filter: status == "todo"
        - label: Doing
          filter: status == "doing"
        - label: Done
          filter: status == "done"
    - name: Broken
    - switches: []
  presets:
    - name: Open
      on: [Status/Todo, Status/Doing]
`;

describe('round trip', () => {
	it('on then off gives back the same bytes, comments included', () => {
		const groups = readConfig(BASE).groups;
		let t = BASE;
		for (const label of ['Todo', 'Doing', 'Done']) t = runOp(t, 'toggle', ['Status', label]);
		expect(readSelection(t, groups).Status).toEqual(['Todo', 'Doing', 'Done']);
		for (const label of ['Done', 'Todo', 'Doing']) t = runOp(t, 'toggle', ['Status', label]);
		expect(t).toBe(BASE);
	});

	it('a selection that is already there returns the same string object', () => {
		const groups = readConfig(BASE).groups;
		expect(applySelection(BASE, groups, readSelection(BASE, groups))).toBe(BASE);
	});

	it('reads a file in the layout core writes after a GUI save (plugin key first, no comments)', () => {
		const core = `filterSwitches:\n  groups:\n    - name: S\n      switches:\n        - label: A\n          filter: a == 1\nfilters:\n  and:\n    - a == 1\nviews:\n  - type: table\n    name: T\n`;
		expect(readSelection(core, readConfig(core).groups)).toEqual({ S: ['A'] });
		expect(runOp(core, 'toggle', ['S', 'A'])).toBe(`filterSwitches:\n  groups:\n    - name: S\n      switches:\n        - label: A\n          filter: a == 1\nviews:\n  - type: table\n    name: T\n`);
	});
});

describe('readConfig', () => {
	it('skips malformed groups and keeps presets', () => {
		const c = readConfig(BASE);
		expect(c.groups.map((g) => g.name)).toEqual(['Status', 'Broken']);
		expect(c.groups[1]?.switches).toEqual([]);
		expect(c.presets).toEqual([{ name: 'Open', on: ['Status/Todo', 'Status/Doing'] }]);
	});

	it('returns nothing for a file without the key, an empty file or a list', () => {
		for (const t of ['views: []\n', '', '- a\n- b\n', 'filterSwitches: 3\n']) expect(readConfig(t)).toEqual({ groups: [], presets: [] });
	});

	it('keeps the first of two groups with the same name', () => {
		const t = `filterSwitches:\n  groups:\n    - name: A\n      switches: [{label: x, filter: x == 1}]\n    - name: A\n      switches: []\n`;
		expect(readConfig(t).groups).toEqual([{ name: 'A', switches: [{ label: 'x', filter: 'x == 1' }] }]);
	});
});

describe('free tier', () => {
	const groups: GroupDef[] = [
		{ name: 'A', switches: [1, 2, 3, 4, 5].map((n) => ({ label: `a${n}`, filter: `a == ${n}` })) },
		{ name: 'B', switches: [{ label: 'b', filter: 'b == 1' }] },
		{ name: 'P', property: 'type', switches: [] },
	];
	it(`shows the first group with ${FREE_SWITCHES} switches and counts the rest`, () => {
		const { config, hidden } = limitConfig({ groups, presets: [{ name: 'x', on: [] }] }, false);
		expect(config.groups).toHaveLength(1);
		expect(config.groups[0]?.switches.map((s) => s.label)).toEqual(['a1', 'a2', 'a3']);
		expect(config.presets).toEqual([]);
		expect(hidden).toBe(2 + 1 + 1);
	});
	it('Pro shows everything', () => {
		expect(limitConfig({ groups, presets: [] }, true)).toEqual({ config: { groups, presets: [] }, hidden: 0 });
	});
	it('a free toggle never touches the clause of a hidden group', () => {
		const t = `filters:\n  and:\n    - b == 1\nfilterSwitches:\n  groups:\n    - name: A\n      switches: [{label: a1, filter: a == 1}]\n    - name: B\n      switches: [{label: b, filter: b == 1}]\n`;
		const visible = limitConfig(readConfig(t), false).config.groups;
		const out = applySelection(t, visible, reset(readSelection(t, visible), null));
		expect(out).toBe(t);
	});
});

describe('property values (Pro)', () => {
	it('builds == switches for single values, sorted, without duplicates or empties', () => {
		expect(switchesFromValues('status', ['todo', 'done', 'todo', '', null, 'doing'])).toEqual([
			{ label: 'doing', filter: 'status == "doing"' },
			{ label: 'done', filter: 'status == "done"' },
			{ label: 'todo', filter: 'status == "todo"' },
		]);
	});
	it('builds contains() switches when any value is a list, and quotes odd names', () => {
		expect(switchesFromValues('my tags', [['a', 'b'], 'c', 2, true])).toEqual([
			{ label: '2', filter: 'note["my tags"].contains(2)' },
			{ label: 'a', filter: 'note["my tags"].contains("a")' },
			{ label: 'b', filter: 'note["my tags"].contains("b")' },
			{ label: 'c', filter: 'note["my tags"].contains("c")' },
			{ label: 'true', filter: 'note["my tags"].contains(true)' },
		]);
	});
	it('propertyRef keeps plain identifiers bare', () => {
		expect(propertyRef('due_date')).toBe('due_date');
		expect(propertyRef('due-date')).toBe('note["due-date"]');
	});
	it('addPropertyGroup replaces a group with the same name', () => {
		const t = addPropertyGroup(BASE, 'Status', 'status', true);
		expect(readConfig(t).groups.find((g) => g.name === 'Status')).toEqual({ name: 'Status', property: 'status', single: true, switches: [] });
		expect(t).toContain('# my switches');
	});
});

describe('selection helpers', () => {
	const g: GroupDef = { name: 'S', switches: [{ label: 'a', filter: 'a' }, { label: 'b', filter: 'b' }] };
	it('toggle adds and removes; a single group keeps one', () => {
		expect(toggle({ S: [] }, g, 'a')).toEqual({ S: ['a'] });
		expect(toggle({ S: ['a'] }, g, 'b')).toEqual({ S: ['a', 'b'] });
		expect(toggle({ S: ['a', 'b'] }, g, 'a')).toEqual({ S: ['b'] });
		expect(toggle({ S: ['a'] }, { ...g, single: true }, 'b')).toEqual({ S: ['b'] });
	});
	it('reset clears one group or all', () => {
		expect(reset({ S: ['a'], T: ['x'] }, 'S')).toEqual({ S: [], T: ['x'] });
		expect(reset({ S: ['a'], T: ['x'] }, null)).toEqual({ S: [], T: [] });
	});
	it('presets ignore unknown keys; selectionKeys is the inverse', () => {
		const sel = presetSelection([g], { name: 'p', on: ['S/b', 'S/zzz', 'X/a'] });
		expect(sel).toEqual({ S: ['b'] });
		expect(selectionKeys(sel)).toEqual(['S/b']);
	});
	it('savePreset replaces by name and removePreset deletes it', () => {
		const t = savePreset(BASE, { name: 'Open', on: ['Status/Done'] });
		expect(readConfig(t).presets).toEqual([{ name: 'Open', on: ['Status/Done'] }]);
		expect(readConfig(removePreset(t, 'Open')).presets).toEqual([]);
		expect(removePreset(t, 'none')).toBe(t);
	});
	it('an or item that mixes two groups is a plain filter, not a switch', () => {
		const t = `filters:\n  and:\n    - or: [a == 1, b == 1]\nfilterSwitches:\n  groups:\n    - name: A\n      switches: [{label: a, filter: a == 1}]\n    - name: B\n      switches: [{label: b, filter: b == 1}]\n`;
		expect(readSelection(t, readConfig(t).groups)).toEqual({ A: [], B: [] });
	});
	it('runOp rejects unknown ops, groups and presets', () => {
		expect(() => runOp(BASE, 'nope', [])).toThrow(/unknown op/);
		expect(() => runOp(BASE, 'toggle', ['Nope', 'x'])).toThrow(/no group/);
		expect(() => runOp(BASE, 'preset', ['Nope'])).toThrow(/no preset/);
	});
});
