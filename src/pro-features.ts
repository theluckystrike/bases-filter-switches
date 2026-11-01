// The Pro features of this plugin, one line each. The "What Pro adds" window, the README Pro section and notemods.com
// use these lines word for word. Each gate is a text of the Pro check in src; tests/what-pro.test.ts checks it.
// No imports with code: tools and tests read this file as plain data.
import type { WhatProFeature } from './license/github-obsidian';

export const PRO_FEATURES: WhatProFeature[] = [
	{
		id: 'unlimited',
		line: 'Add any number of switches and groups to a base. The free version has 1 group of 3 switches.',
		gate: { file: 'src/bar.ts', text: 'limitConfig(resolved, isPro())' },
	},
	{
		id: 'presets',
		line: 'Save the switches that are on as a preset. Apply it from the bar or from its own command.',
		gate: { file: 'src/main.ts', text: "if (!this.needPro('Presets')) return;" },
	},
	{
		id: 'default',
		line: 'Save the default switches of a base, and apply them again with one command.',
		gate: { file: 'src/main.ts', text: "if (!this.needPro('Default switches')) return;" },
	},
	{
		id: 'property',
		line: 'Make one switch for each value of a property.',
		gate: { file: 'src/main.ts', text: "if (!this.needPro('Switches from a property')) return;" },
	},
	{
		id: 'quick',
		line: 'Use up to 5 quick property filters at the same time. The free version has 1.',
		gate: { file: 'src/main.ts', text: 'pro ? PRO_QUICK : FREE_QUICK' },
	},
];
