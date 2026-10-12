import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-filter-switches.json';
import {
	addPropertyGroup,
	applySelection,
	clearDefault,
	defaultSelection,
	FREE_SWITCHES,
	hasDefault,
	limitConfig,
	presetSelection,
	propertyRef,
	readConfig,
	readDefault,
	readSelection,
	removePreset,
	reset,
	runOp,
	saveDefault,
	savePreset,
	selectionKeys,
	switchesFromValues,
	toggle,
	topFilters,
	editSwitch,
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

describe('default switches (Pro)', () => {
	it('saveDefault replaces the old default and readDefault reads it back', () => {
		expect(readDefault(BASE)).toEqual([]);
		const t = saveDefault(BASE, ['Status/Todo']);
		expect(readDefault(t)).toEqual(['Status/Todo']);
		const t2 = saveDefault(t, ['Status/Done']);
		expect(readDefault(t2)).toEqual(['Status/Done']);
		expect(t2).toContain('# my switches');
	});

	it('clearDefault removes it and leaves a file without one unchanged', () => {
		expect(clearDefault(BASE)).toBe(BASE);
		const t = saveDefault(BASE, ['Status/Todo']);
		expect(clearDefault(t)).toBe(BASE);
	});

	it('defaultSelection turns on the default keys of the known groups and ignores unknown ones', () => {
		const groups = readConfig(BASE).groups;
		expect(defaultSelection(groups, ['Status/Todo', 'Status/zzz', 'X/a'])).toEqual({ ...Object.fromEntries(groups.map((g) => [g.name, []])), Status: ['Todo'] });
		expect(defaultSelection(groups, [])).toEqual(Object.fromEntries(groups.map((g) => [g.name, []])));
	});
	it('the default op does not turn switches off when the base has no saved default', () => {
		const on = runOp(BASE, 'toggle', ['Status', 'Todo']);
		expect(readSelection(on, readConfig(on).groups).Status).toEqual(['Todo']);
		expect(hasDefault(on)).toBe(false);
		expect(runOp(on, 'default', [])).toBe(on);
	});

	it('an empty saved default is a default: it turns every switch off', () => {
		const on = runOp(saveDefault(BASE, []), 'toggle', ['Status', 'Todo']);
		expect(hasDefault(on)).toBe(true);
		expect(readSelection(runOp(on, 'default', []), readConfig(on).groups).Status).toEqual([]);
	});

	it('runOp applies the default with the default op', () => {
		const t = saveDefault(BASE, ['Status/Todo']);
		const out = runOp(t, 'default', []);
		expect(readSelection(out, readConfig(t).groups).Status).toEqual(['Todo']);
	});
});

describe('edge cases of hand-written base files', () => {
	const g: GroupDef[] = [{ name: 'S', switches: [{ label: 'A', filter: 'a == 1' }] }];
	it('an empty filters key gets an and list without an empty item', () => {
		expect(applySelection('filters:\nviews: []\n', g, { S: ['A'] })).toBe('filters:\n  and:\n    - a == 1\nviews: []\n');
	});
	it('an empty and list key gets the switch as its only item', () => {
		expect(applySelection('filters:\n  and:\nviews: []\n', g, { S: ['A'] })).toBe('filters:\n  and:\n    - a == 1\nviews: []\n');
	});
	it('reads number labels and group names typed by hand', () => {
		const t = 'filterSwitches:\n  groups:\n    - name: 2024\n      switches:\n        - label: 1\n          filter: x == 1\n';
		expect(readConfig(t).groups).toEqual([{ name: '2024', switches: [{ label: '1', filter: 'x == 1' }] }]);
	});
});

describe('editSwitch', () => {
	const T = `filters:\n  and:\n    - file.inFolder("Tasks")\n    - status == "todo"\nfilterSwitches:\n  groups:\n    - name: Status\n      single: true\n      switches:\n        - label: Todo\n          filter: status == "todo"\n`;
	it('a new filter for a switch that is on replaces the old filter in the base', () => {
		const out = editSwitch(T, { group: 'Status', label: 'Todo' }, { group: 'Status', label: 'Todo', filter: 'status == "open"' });
		expect(topFilters(out)).toEqual(['file.inFolder("Tasks")', 'status == "open"']);
		expect(readSelection(out, readConfig(out).groups).Status).toEqual(['Todo']);
		expect(readConfig(out).groups).toEqual([{ name: 'Status', single: true, switches: [{ label: 'Todo', filter: 'status == "open"' }] }]);
	});
	it('a new label for a switch that is on keeps it on', () => {
		const out = editSwitch(T, { group: 'Status', label: 'Todo' }, { group: 'Status', label: 'Open', filter: 'status == "todo"' });
		expect(topFilters(out)).toEqual(['file.inFolder("Tasks")', 'status == "todo"']);
		expect(readSelection(out, readConfig(out).groups).Status).toEqual(['Open']);
	});
	it('a switch that is off stays off', () => {
		const off = runOp(T, 'toggle', ['Status', 'Todo']);
		const out = editSwitch(off, { group: 'Status', label: 'Todo' }, { group: 'Status', label: 'Todo', filter: 'status == "open"' });
		expect(topFilters(out)).toEqual(['file.inFolder("Tasks")']);
	});
});
