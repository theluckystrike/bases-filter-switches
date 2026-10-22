import { describe, expect, it } from 'vitest';
import {
	activeQuick,
	addQuick,
	clearQuick,
	FREE_QUICK,
	hashText,
	PRO_QUICK,
	propertyRef,
	quickExpression,
	quickProperties,
	quickValues,
	readConfig,
	readDefault,
	readPaused,
	readSelection,
	removeQuick,
	runOp,
	runQuickSteps as run,
	visibleProperties,
	type QuickState,
} from '../src/basefile';

// Quick property filter: one plain item of the top-level "and" list. Chips and undo data are plugin data (QuickState).
const TASKS = `filters:\n  and:\n    - file.inFolder("Tasks")\nviews:\n  - type: table\n    name: All\n`;
const add = (property: string, value: string, pro = false, values: unknown[] = [value]): unknown[] => ['add', property, 'is', value, values, pro];
const remove = (filter: string): unknown[] => ['remove', filter];

describe('quick filter expressions', () => {
	it('criterion 1: status is todo goes to the end of the and list, and the state holds one chip', () => {
		const r = addQuick(TASKS, [], { property: 'status', match: 'is', value: 'todo' }, ['todo', 'done'], FREE_QUICK, null);
		expect(r.text).toBe('filters:\n  and:\n    - file.inFolder("Tasks")\n    - status == "todo"\nviews:\n  - type: table\n    name: All\n');
		expect(r.state?.chips).toEqual([{ id: hashText('status == "todo"'), property: 'status', match: 'is', value: 'todo', filter: 'status == "todo"' }]);
		expect(r.state?.origin).toBe('filters:\n  and:\n    - file.inFolder("Tasks")\n');
	});

	it('criterion 3 and 12: the base file gets only the filter item, no plugin key', () => {
		const out = runOp(TASKS, 'quick', ['my author', 'contains', 'Le', [], false]);
		expect(out).toBe(TASKS.replace('    - file.inFolder("Tasks")\n', '    - file.inFolder("Tasks")\n    - note["my author"].toString().lower().contains("le")\n'));
		expect(out).not.toContain('filterSwitches');
	});

	it('criterion 2: a list property uses list().contains()', () => {
		expect(quickExpression({ property: 'tags', match: 'is', value: 'work' }, [['work', 'home'], ['work']])).toBe('list(tags).contains("work")');
		expect(runOp(TASKS, 'quick', ['tags', 'is', 'work', [['work', 'home']], false])).toContain('    - list(tags).contains("work")\n');
	});

	it('criterion 3: contains text lowercases the text and uses propertyRef', () => {
		const expr = quickExpression({ property: 'my author', match: 'contains', value: 'Le' }, []);
		expect(expr).toBe('note["my author"].toString().lower().contains("le")');
		expect(expr?.startsWith(propertyRef('my author'))).toBe(true);
		expect(quickExpression({ property: 'Autor·in', match: 'contains', value: 'ÉÉ' }, [])).toBe('note["Autor·in"].toString().lower().contains("éé")');
	});

	it('"is" uses the generator of property switches: numbers and booleans stay typed, mixed values use one expression', () => {
		expect(quickExpression({ property: 'year', match: 'is', value: '2024' }, [2024, 2025])).toBe('year == 2024');
		expect(quickExpression({ property: 'done', match: 'is', value: 'true' }, [true, false])).toBe('done == true');
		expect(quickExpression({ property: 'n', match: 'is', value: '42' }, [42, '42'])).toBe('(n == 42 || n == "42")');
		expect(quickExpression({ property: 'status', match: 'is', value: 'new' }, ['todo'])).toBe('status == "new"');
		expect(quickExpression({ property: 'status', match: 'is', value: '  ' }, ['todo'])).toBeNull();
	});

	it('suggests the values that notes have now, with the collector of property switches', () => {
		expect(quickValues('area', ['work', ['home', 'work'], '', null, 3])).toEqual(['3', 'home', 'work']);
	});

	it('file, note, formula and this use note["..."]', () => {
		for (const name of ['file', 'note', 'formula', 'this']) expect(propertyRef(name)).toBe(`note["${name}"]`);
		expect(quickExpression({ property: 'file', match: 'is', value: 'x' }, ['x'])).toBe('note["file"] == "x"');
		expect(propertyRef('files')).toBe('files');
	});
});

describe('criterion 4: remove gives back the same bytes for every filter shape and file style', () => {
	const shapes: Record<string, string> = {
		'bare string': 'filters: file.inFolder("Tasks")\nviews:\n  - type: table\n    name: All\n',
		'or filter': 'filters:\n  or:\n    - a == 1\n    - a == 2\nviews:\n  - type: table\n    name: All\n',
		'empty filters key': 'filters:\nviews:\n  - type: table\n    name: All\n',
		'empty and key': 'filters:\n  and:\nviews:\n  - type: table\n    name: All\n',
		'no filters': '# board\nviews:\n  - type: table\n    name: All\n',
		'and list': 'filters:\n  and:\n    - file.inFolder("Tasks") # tasks\nviews:\n  - type: table\n    name: All\n',
		'CRLF and 4 spaces': 'filters:\r\n    and:\r\n        - file.inFolder("Tasks")\r\nviews:\r\n    - type: table\r\n      name: All\r\n',
		'CRLF, 4 spaces, sequences not indented': 'filters:\r\n    and:\r\n    - status == "a"\r\nviews:\r\n    - type: table\r\n      name: All\r\n',
		'no final newline': 'views:\n  - type: table\n    name: All\nfilters: a == 1',
		'and list last, no final newline': 'views:\n  - type: table\n    name: All\nfilters:\n  and:\n    - a == 1',
		'flow style and blank lines': 'filters: { and: [ a == 1 ] }\n\n\nviews:\n  - type: table\n    name: All\n# end\n',
		'empty plugin key': 'filters: a == 1\nfilterSwitches: {}\n',
		'base with switches': 'filters:\n  and:\n    - a == 1\nfilterSwitches:\n  groups:\n    - name: S\n      switches:\n        - label: B\n          filter: b == 1\n',
	};
	const A = add('status', 'todo', true);
	const B = add('area', 'w', true);
	for (const [name, base] of Object.entries(shapes)) {
		it(name, () => {
			expect(run(base, [add('status', 'todo'), remove('status == "todo"')])).toBe(base);
			expect(run(base, [A, B, remove('area == "w"'), remove('status == "todo"')])).toBe(base);
			expect(run(base, [A, B, remove('status == "todo"'), remove('area == "w"')])).toBe(base);
			expect(run(base, [A, B, ['clear']])).toBe(base);
			expect(run(base, [add('status', 'todo'), add('area', 'w'), remove('area == "w"')])).toBe(base);
		});
	}

	it('does not re-indent the items of a CRLF, 4-space list while a quick filter is on', () => {
		const base = shapes['CRLF, 4 spaces, sequences not indented']!;
		expect(run(base, [A, B])).toBe('filters:\r\n    and:\r\n    - status == "a"\r\n    - status == "todo"\r\n    - area == "w"\r\nviews:\r\n    - type: table\r\n      name: All\r\n');
		const four = shapes['CRLF and 4 spaces']!;
		expect(run(four, [A])).toBe(four.replace('        - file.inFolder("Tasks")\r\n', '        - file.inFolder("Tasks")\r\n        - status == "todo"\r\n'));
		expect(run(shapes['flow style and blank lines']!, [A])).toContain('\n\n\nviews:\n  - type: table\n    name: All\n# end\n');
		expect(run(shapes['no final newline']!, [A]).endsWith('\n')).toBe(false);
	});

	it('criterion 16: after a hand edit it removes only its own item and never writes the old text back', () => {
		const bare = shapes['bare string']!;
		const extra = run(bare, [add('status', 'todo'), ['edit', '    - status == "todo"\n', '    - status == "todo"\n    - x == 1\n'], remove('status == "todo"')]);
		expect(extra).toBe('filters:\n  and:\n    - file.inFolder("Tasks")\n    - x == 1\nviews:\n  - type: table\n    name: All\n');
		const other = run(bare, [add('status', 'todo'), ['edit', 'file.inFolder("Tasks")', 'file.inFolder("Other")'], remove('status == "todo"')]);
		expect(other).toContain('file.inFolder("Other")');
		expect(other).not.toContain('file.inFolder("Tasks")');
		// The quick item itself edited by hand: the chip goes, the edited text stays.
		const edited = run(TASKS, [add('status', 'todo'), ['edit', 'status == "todo"', 'status == "todo" || status == "doing"'], remove('status == "todo"')]);
		expect(edited).toContain('    - status == "todo" || status == "doing"\n');
		// A switch click between add and remove also changes the filters: only the quick item goes.
		const sw = shapes['base with switches']!;
		expect(run(sw, [A, ['edit', '    - status == "todo"\n', '    - status == "todo"\n    - b == 1\n'], remove('status == "todo"')])).toContain('    - a == 1\n    - b == 1\n');
	});

	it('a hand edit after one of two Pro filters: the last remove keeps the edit', () => {
		const bare = shapes['bare string']!;
		const out = run(bare, [add('a', 'x', true), add('b', 'y', true), remove('a == "x"'), ['edit', '    - b == "y"\n', '    - b == "y"\n    - c == 1\n'], remove('b == "y"')]);
		expect(out).toContain('    - file.inFolder("Tasks")\n    - c == 1\n');
	});
});

describe('free and Pro limits', () => {
	it(`criterion 5: free has ${FREE_QUICK} quick filter, a second one replaces the first`, () => {
		const two = run(TASKS, [add('status', 'todo'), add('area', 'work')]);
		expect(two).toBe(TASKS.replace('    - file.inFolder("Tasks")\n', '    - file.inFolder("Tasks")\n    - area == "work"\n'));
	});

	it(`criterion 5: Pro joins up to ${PRO_QUICK} with and, and refuses the sixth`, () => {
		const steps = [1, 2, 3, 4, 5].map((i) => add(`p${i}`, 'x', true));
		const five = run(TASKS, steps);
		expect(five).toContain('    - p1 == "x"\n    - p2 == "x"\n    - p3 == "x"\n    - p4 == "x"\n    - p5 == "x"\n');
		expect(run(TASKS, [...steps, add('p6', 'x', true)])).toBe(five);
		let state: QuickState | null = null;
		let t = TASKS;
		for (let i = 1; i <= 5; i++) ({ text: t, state } = addQuick(t, [], { property: `p${i}`, match: 'is', value: 'x' }, ['x'], PRO_QUICK, state));
		const sixth = addQuick(t, [], { property: 'p6', match: 'is', value: 'x' }, ['x'], PRO_QUICK, state);
		expect(sixth.text).toBe(t);
		expect(sixth.error).toMatch(/5 quick filters/);
	});

	it('refuses a filter that the base already has, or that a switch owns', () => {
		const hand = `filters:\n  and:\n    - status == "todo"\n`;
		expect(addQuick(hand, [], { property: 'status', match: 'is', value: 'todo' }, ['todo'], 1, null).error).toMatch(/already/);
		const sw = `filterSwitches:\n  groups:\n    - name: Status\n      switches:\n        - label: Todo\n          filter: status == "todo"\n`;
		const r = addQuick(sw, readConfig(sw).groups, { property: 'status', match: 'is', value: 'todo' }, ['todo'], 1, null);
		expect(r.text).toBe(sw);
		expect(r.error).toMatch(/switch Todo/);
		expect(addQuick(TASKS, [], { property: 'status', match: 'is', value: '' }, [], 1, null).error).toMatch(/type a value/);
	});

	it('remove and clear without a state or with an unknown chip change nothing', () => {
		expect(removeQuick(TASKS, null, 'x').text).toBe(TASKS);
		expect(clearQuick(TASKS, null).text).toBe(TASKS);
	});
});

describe('wrapping and state', () => {
	it('criterion 6: a bare string filter or an or filter gets an and list that keeps the old filter first', () => {
		expect(runOp('filters: file.hasTag("x")\n', 'quick', ['a', 'is', 'b', ['b'], false])).toBe('filters:\n  and:\n    - file.hasTag("x")\n    - a == "b"\n');
		const or = runOp('filters:\n  or:\n    - a == 1\n    - a == 2\n', 'quick', ['b', 'is', 'c', ['c'], false]);
		expect(or).toBe('filters:\n  and:\n    - or:\n        - a == 1\n        - a == 2\n    - b == "c"\n');
	});

	it('criterion 7 and 18: switches, pauses, presets and the default stay as they are', () => {
		const base = `filters:\n  and:\n    - status == "todo"\nviews:\n  - type: table\n    name: All\n    filters:\n      and:\n        - x == 1\nfilterSwitches:\n  groups:\n    - name: Status\n      switches:\n        - label: Todo\n          filter: status == "todo"\n        - label: Done\n          filter: status == "done"\n    - name: P\n      switches:\n        - label: High\n          filter: priority == "high"\n  presets:\n    - name: Open\n      on: [Status/Todo]\n  default: [Status/Todo]\n  paused:\n    P: [High]\n`;
		const groups = readConfig(base).groups;
		const r = addQuick(base, groups, { property: 'area', match: 'is', value: 'work' }, ['work'], PRO_QUICK, null);
		const out = r.text;
		expect(out).toBe(base.replace('    - status == "todo"\nviews', '    - status == "todo"\n    - area == "work"\nviews'));
		expect(readSelection(out, groups)).toEqual(readSelection(base, groups));
		expect(readPaused(out, 'P')).toEqual(['High']);
		expect(readDefault(out)).toEqual(['Status/Todo']);
		const toggled = runOp(out, 'toggle', ['Status', 'Done']);
		expect(activeQuick(toggled, r.state).map((q) => q.filter)).toEqual(['area == "work"']);
		expect(runOp(toggled, 'save-preset', ['Mine'])).toContain('on:\n        - Status/Todo\n        - Status/Done');
		expect(runOp(toggled, 'save-default', [])).not.toMatch(/default:[^\n]*area/);
		expect(activeQuick(runOp(toggled, 'preset', ['Open']), r.state).map((q) => q.filter)).toEqual(['area == "work"']);
	});
});

describe('Property choices', () => {
	const base = `views:\n  - type: table\n    name: All\n    order:\n      - file.name\n      - status\n      - note.area\n      - formula.x\n  - type: table\n    name: Other\n    order:\n      - priority\n`;
	it('lists the visible note properties of the current view in column order', () => {
		expect(visibleProperties(base, 'All')).toEqual(['status', 'area']);
		expect(visibleProperties(base, 'Other')).toEqual(['priority']);
		expect(visibleProperties(base, null)).toEqual(['status', 'area']);
		expect(visibleProperties(base, 'Missing')).toEqual(['status', 'area']);
		expect(visibleProperties('filters: a\n', null)).toEqual([]);
	});
	it('puts the visible properties first, then the others by name', () => {
		expect(quickProperties(['status', 'area', 'gone'], ['zeta', 'area', 'alpha', 'status'])).toEqual(['status', 'area', 'alpha', 'zeta']);
	});
});

describe('switch writes keep the file style', () => {
	it('a switch click on a CRLF file keeps CRLF and the other lines', () => {
		const base = 'filters:\r\n    and:\r\n        - a == 1\r\nviews:\r\n- type: table\r\n  name: All\r\nfilterSwitches:\r\n    groups:\r\n        - name: S\r\n          switches:\r\n              - label: B\r\n                filter: b == 1\r\n';
		const on = runOp(base, 'toggle', ['S', 'B']);
		expect(on).toBe(base.replace('        - a == 1\r\n', '        - a == 1\r\n        - b == 1\r\n'));
		expect(runOp(on, 'toggle', ['S', 'B'])).toBe(base);
	});
});
