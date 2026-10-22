import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { SwitchBar, quickLabel, type BarHost } from '../src/bar';
import { QuickFilterModal } from '../src/quick-modal';
import { addQuick, removeQuick, type QuickInput, type QuickState } from '../src/basefile';

const SWITCHES = `filters:\n  and:\n    - file.inFolder("Tasks")\nfilterSwitches:\n  groups:\n    - name: S\n      switches:\n        - label: A\n          filter: a == 1\n`;
const PLAIN = `filters:\n  and:\n    - file.inFolder("Tasks")\n`;

interface BarData {
	text: string;
	quick?: QuickState | null;
}

/** A base text and its quick state after one quick filter, as the plugin keeps them. */
function withQuick(text: string, input: QuickInput, values: unknown[]): BarData {
	const r = addQuick(text, [], input, values, 1, null);
	return { text: r.text, quick: r.state };
}

function host(state: BarData, showAdd: boolean, calls: string[]): BarHost {
	const noop = (): Promise<void> => Promise.resolve();
	return {
		read: () => Promise.resolve(state.text),
		resolve: (c) => c,
		showAdd: () => showAdd,
		toggle: noop,
		reset: noop,
		pauseGroup: noop,
		applyPreset: noop,
		savePreset: () => undefined,
		deletePreset: noop,
		applyDefault: noop,
		saveDefault: noop,
		clearDefault: noop,
		addSwitch: () => undefined,
		editSwitch: () => undefined,
		removeSwitch: noop,
		quickFilter: (_f, view) => {
			calls.push(`quick:${view ?? ''}`);
		},
		quickState: () => state.quick ?? null,
		removeQuick: (_f, id) => {
			({ text: state.text, state: state.quick } = removeQuick(state.text, state.quick, id));
			return noop();
		},
		clearQuick: noop,
	};
}

async function bar(state: BarData, showAdd = true, calls: string[] = []): Promise<SwitchBar> {
	const b = new SwitchBar(host(state, showAdd, calls), {} as never);
	await b.render();
	return b;
}

const keys = (b: SwitchBar): string[] => Array.from(b.el.querySelectorAll('button')).map((x) => x.getAttribute('data-fsw-key') ?? '');

describe('Filter by property button', () => {
	it('is the last button of a bar with switches, and a click opens the window', async () => {
		const calls: string[] = [];
		const b = await bar({ text: SWITCHES }, false, calls);
		expect(keys(b).at(-1)).toBe('quick');
		const btn = b.el.querySelector<HTMLButtonElement>('[data-fsw-key="quick"]');
		expect(btn?.getAttribute('aria-label')).toBe('Filter by property');
		btn?.click();
		expect(calls).toEqual(['quick:']);
	});

	it('shows on a base without switches only when the add button setting is on', async () => {
		expect(keys(await bar({ text: PLAIN }, true))).toEqual(['add', 'quick']);
		expect(keys(await bar({ text: PLAIN }, false))).toEqual([]);
	});

	it('reads the name of the current view from the Bases toolbar above the bar', async () => {
		const calls: string[] = [];
		const b = await bar({ text: SWITCHES }, true, calls);
		const header = createDiv({ cls: 'bases-header' });
		header.createDiv({ cls: 'bases-toolbar-views-menu' }).createSpan({ cls: 'text-button-label', text: 'Open tasks' });
		const parent = createDiv();
		parent.append(header, b.el);
		b.el.querySelector<HTMLButtonElement>('[data-fsw-key="quick"]')?.click();
		expect(calls).toEqual(['quick:Open tasks']);
	});
});

describe('quick filter chips', () => {
	it('criterion 13 and 14: shows author: Le Guin and its remove button gives back the original text', async () => {
		const state = withQuick(SWITCHES, { property: 'author', match: 'is', value: 'Le Guin' }, ['Le Guin']);
		const b = await bar(state);
		expect(b.el.querySelector('.fsw-quick-chip')?.textContent).toBe('author: Le Guin');
		expect(keys(b).slice(-2)).toEqual(['quick-remove:author == "Le Guin"', 'quick']);
		const remove = b.el.querySelector<HTMLButtonElement>('.fsw-quick-remove');
		expect(remove?.getAttribute('aria-label')).toBe('Remove quick filter author: Le Guin');
		remove?.click();
		expect(state.text).toBe(SWITCHES);
		expect(state.quick).toBeNull();
	});

	it('keeps the chip of an active quick filter on a base without switches when the add button is off', async () => {
		const state = withQuick(PLAIN, { property: 'area', match: 'contains', value: 'Wo' }, []);
		const b = await bar(state, false);
		expect(keys(b)).toEqual(['quick-remove:area.toString().lower().contains("wo")']);
		expect(b.el.textContent).toBe('area contains Wo');
	});

	it('shows no chip for a quick filter that the user edited by hand', async () => {
		const on = withQuick(PLAIN, { property: 'area', match: 'is', value: 'work' }, ['work']);
		const b = await bar({ text: on.text.replace('    - area == "work"\n', '    - area == "home"\n'), quick: on.quick });
		expect(b.el.querySelector('.fsw-quick-chip')).toBeNull();
	});

	it('labels both match kinds', () => {
		expect(quickLabel({ id: '', property: 'author', match: 'is', value: 'Le Guin', filter: '' })).toBe('author: Le Guin');
		expect(quickLabel({ id: '', property: 'author', match: 'contains', value: 'le', filter: '' })).toBe('author contains le');
	});
});

describe('criterion 9: the window works with the keyboard', () => {
	function modal(onSubmit = vi.fn((_i: QuickInput) => Promise.resolve(true))) {
		const app = App.createConfigured__({});
		const values: Record<string, string[]> = { area: ['home', 'learning', 'work'], status: ['todo'] };
		const m = new QuickFilterModal(app as never, ['area', 'status'], (p) => values[p] ?? [], onSubmit);
		m.onOpen();
		return { m, onSubmit };
	}
	const enter = (target: HTMLElement): KeyboardEvent => {
		const evt = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
		Object.defineProperty(evt, 'target', { value: target });
		return evt;
	};

	it('has Property, Match, Value and the add button in Tab order, none taken out of the order', () => {
		const { m } = modal();
		const order = Array.from(m.contentEl.querySelectorAll<HTMLElement>('select, input, button'));
		expect(order.map((e) => e.tagName)).toEqual(['SELECT', 'SELECT', 'INPUT', 'BUTTON']);
		expect(order.every((e) => e.tabIndex >= 0)).toBe(true);
		expect(Array.from(order[1]!.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['is', 'contains text']);
	});

	it('the arrow keys change a dropdown, Enter in the value field adds the filter', async () => {
		const { m, onSubmit } = modal();
		const [property, match] = Array.from(m.contentEl.querySelectorAll('select'));
		// An arrow key on a closed select changes its value and fires change.
		property!.value = 'status';
		property!.dispatchEvent(new Event('change'));
		match!.value = 'contains';
		match!.dispatchEvent(new Event('change'));
		const input = m.valueInput!;
		input.value = ' To ';
		input.dispatchEvent(new Event('input'));
		expect(m.handleEnter(enter(input))).toBe(false);
		await Promise.resolve();
		expect(onSubmit).toHaveBeenCalledWith({ property: 'status', match: 'contains', value: 'To' });
	});

	it('Enter on a button keeps its own click, and Enter with an empty value adds nothing', async () => {
		const { m, onSubmit } = modal();
		const button = m.contentEl.querySelector('button')!;
		expect(m.handleEnter(enter(button))).toBe(true);
		expect(m.handleEnter(enter(m.valueInput!))).toBe(false);
		await Promise.resolve();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('suggests the values of the chosen property for "is" only', () => {
		const { m } = modal();
		const suggest = (m as unknown as { suggest: { getSuggestions(q: string): string[] } }).suggest;
		expect(suggest.getSuggestions('o')).toEqual(['home', 'work']);
		const match = m.contentEl.querySelectorAll('select')[1]!;
		match.value = 'contains';
		match.dispatchEvent(new Event('change'));
		expect(suggest.getSuggestions('')).toEqual([]);
	});

	it('makes the value list once per property, not on each key press, and shows at most 50 values', () => {
		const app = App.createConfigured__({});
		const many = Array.from({ length: 500 }, (_, i) => `v${i}`);
		const valuesOf = vi.fn((p: string) => (p === 'area' ? many : []));
		const m = new QuickFilterModal(app as never, ['area'], valuesOf, () => Promise.resolve(true));
		m.onOpen();
		const suggest = (m as unknown as { suggest: { getSuggestions(q: string): string[] } }).suggest;
		for (const q of ['v', 'v1', 'v12', 'v123']) suggest.getSuggestions(q);
		expect(valuesOf).toHaveBeenCalledTimes(1);
		expect(suggest.getSuggestions('v')).toHaveLength(50);
		expect(suggest.getSuggestions('v123')).toEqual(['v123']);
	});

	it('stays open when the plugin refuses the filter', async () => {
		const { m, onSubmit } = modal(vi.fn(() => Promise.resolve(false)));
		const close = vi.spyOn(m, 'close');
		m.valueInput!.value = 'work';
		await m.submit();
		expect(onSubmit).toHaveBeenCalledWith({ property: 'area', match: 'is', value: 'work' });
		expect(close).not.toHaveBeenCalled();
	});
});
