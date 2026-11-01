import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingGates, whatProModel, whatProUrl } from '../src/license/github-obsidian';
import { PRO_FEATURES } from '../src/pro-features';
import { PRO_UI, SPONSORS } from '../src/pro';
import { SAMPLE_BASE, whatProFeatures } from '../src/what-pro';
import manifest from '../manifest.json';

const ROOT = join(import.meta.dirname, '..');
const read = (file: string): string | null => {
	try {
		return readFileSync(join(ROOT, file), 'utf8');
	} catch {
		return null;
	}
};
const demo = (id: string): HTMLElement => {
	const el = document.createElement('div');
	const f = whatProFeatures().find((x) => x.id === id);
	if (!f) throw new Error(`no feature ${id}`);
	f.demo(el);
	return el;
};

describe('What Pro adds: feature list', () => {
	it('lists the 5 Pro features of the plugin, one line each', () => {
		expect(PRO_FEATURES.map((f) => f.id)).toEqual(['unlimited', 'presets', 'default', 'property', 'quick']);
		for (const f of PRO_FEATURES) expect(f.line).toMatch(/^[A-Z].{20,160}\.$/);
		expect(whatProFeatures().map((f) => f.line)).toEqual(PRO_FEATURES.map((f) => f.line));
	});

	it('each listed feature has its Pro gate in src', () => {
		expect(missingGates(PRO_FEATURES, read)).toEqual([]);
	});

	it('negative control: a listed feature without a gate in src fails the gate check', () => {
		const ghost = { id: 'ghost', line: 'Sync switches to other bases.', gate: { file: 'src/main.ts', text: "if (!this.needPro('Sync')) return;" } };
		expect(missingGates([...PRO_FEATURES, ghost], read)).toEqual(['ghost']);
	});

	it('the README Pro section has the same lines and the same price text', () => {
		const readme = read('README.md') ?? '';
		const section = readme.slice(readme.indexOf('\n## Pro\n'));
		expect(section.startsWith('\n## Pro\n')).toBe(true);
		for (const f of PRO_FEATURES) expect(section).toContain(`\n- ${f.line}\n`);
		expect(section).toContain(PRO_UI.priceText);
	});
});

describe('What Pro adds: price and button', () => {
	it('the Sponsor $15 once button opens the one-time tab with metadata_source=<plugin id>-whatpro', () => {
		const m = whatProModel(null, { pluginId: manifest.id, features: PRO_FEATURES, priceText: PRO_UI.priceText }, SPONSORS);
		expect(m.sponsorText).toBe('Sponsor $15 once');
		expect(m.sponsorUrl).toBe('https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=bases-filter-switches-whatpro');
		expect(m.sponsorUrl).toBe(whatProUrl(SPONSORS, manifest.id));
		expect(m.priceText).toBe(PRO_UI.priceText);
	});
});

describe('What Pro adds: demos on a sample base', () => {
	const codes = (el: HTMLElement): string[] => [...el.querySelectorAll('code')].map((c) => c.textContent ?? '');
	it('unlimited: the free limit, every switch with Pro, and the filters after 3 switches', () => {
		expect(codes(demo('unlimited'))).toMatchInlineSnapshot(`
			[
			  "Status: Todo, Doing, Done",
			  "Status: Todo, Doing, Done, Blocked
			Area: Work, Home",
			  "filters:
			  and:
			    - file.inFolder("Tasks")
			    - or:
			        - status == "todo"
			        - status == "blocked"
			    - area == "work"",
			]
		`);
	});
	it('presets: a saved preset turns on its switches', () => {
		expect(codes(demo('presets'))).toMatchInlineSnapshot(`
			[
			  "filters:
			  and:
			    - file.inFolder("Tasks")
			    - or:
			        - status == "todo"
			        - status == "doing"
			    - area == "work"",
			]
		`);
	});
	it('default: the command brings the default switches back', () => {
		expect(codes(demo('default'))).toMatchInlineSnapshot(`
			[
			  "filters:
			  and:
			    - file.inFolder("Tasks")
			    - status == "done"
			    - area == "home"",
			  "filters:
			  and:
			    - file.inFolder("Tasks")
			    - status == "doing"",
			  "Status/Doing",
			]
		`);
	});
	it('property: one switch for each value', () => {
		expect(codes(demo('property'))).toMatchInlineSnapshot(`
			[
			  "Garden: list(area).contains("Garden")
			Home: list(area).contains("Home")
			Work: list(area).contains("Work")",
			]
		`);
	});
	it('quick: the free version keeps one quick filter, Pro joins three', () => {
		expect(codes(demo('quick'))).toMatchInlineSnapshot(`
			[
			  "owner is Ben
			priority is high
			title contains report",
			  "filters:
			  and:
			    - file.inFolder("Tasks")
			    - title.toString().lower().contains("report")",
			  "filters:
			  and:
			    - file.inFolder("Tasks")
			    - owner == "Ben"
			    - priority == "high"
			    - title.toString().lower().contains("report")",
			]
		`);
	});
	it('the demos do not change the sample base', () => {
		const before = SAMPLE_BASE;
		for (const f of whatProFeatures()) f.demo(document.createElement('div'));
		expect(SAMPLE_BASE).toBe(before);
	});
});

describe('What Pro adds: entry points', () => {
	const main = read('src/main.ts') ?? '';
	it('has one command and opens the window only from a user action', () => {
		expect(main).toContain("this.addCommand({ id: 'what-pro-adds', name: WHAT_PRO_TITLE, callback: () => this.openWhatPro() });");
		// onload never opens it: the only calls are inside callbacks.
		const onload = main.slice(main.indexOf('async onload()'), main.indexOf('onunload()'));
		expect(onload.match(/openWhatPro\(\)/g)).toHaveLength(1);
		expect(onload).toContain('bindWhatPro(() => this.openWhatPro());');
	});
	it('has the settings button and the notice link', () => {
		expect(main).toContain('sponsorsSettingItemsWithWhatPro(this.plugin.pro, PRO_UI, () => this.plugin.openWhatPro())');
		expect(read('src/pro.ts')).toContain('showProNoticeWithWhatPro(manager, lead, () => whatPro?.());');
	});
});
