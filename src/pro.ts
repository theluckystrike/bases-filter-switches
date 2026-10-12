// Pro through GitHub Sponsors (packages/license, github.ts). product.yaml pro: holds the same values; fx check compares them.
// This file is the one Pro facade: every Pro check in the plugin calls isPro() or onProChange().
import type { SponsorsConfig, SponsorsManager } from './license/index';

export const SPONSORS: SponsorsConfig = {
	// Public client id of the seller's OAuth App (device flow on, no client secret anywhere).
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	// 0 = a one-time sponsorship turns Pro on for life.
	oneTimeMonths: 0,
	// Read-only profile access: the sponsorship tier fields need it. No repository or write access.
	scope: 'read:user',
};

export const PRO_UI = {
	proSummary: 'Pro adds unlimited switches and groups, presets with a command for each, default switches, and switches built from the values of a property.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};

let manager: SponsorsManager | null = null;

/** Connects the facade to the plugin's GitHub Sponsors state (main.ts onload). */
export function bindPro(m: SponsorsManager | null): void {
	manager = m;
}

/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

/** Calls cb after every change of the Pro state. Returns the function that removes cb. */
export function onProChange(cb: () => void): () => void {
	return manager ? manager.onChange(cb) : () => undefined;
}
