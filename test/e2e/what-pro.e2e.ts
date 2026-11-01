import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

// "What Pro adds" in the real app: it never opens by itself, the command opens it, each Try it draws a demo, a free user
// sees the price, "Sponsor $15 once" and "Sign in with GitHub", a Pro user sees "Pro is active" and no buy button, and
// the Pro notice has a link that opens it. Pro is a stubbed GitHub reply; no request leaves the app.
const FEATURES = 5;
const MODAL = '.modal.pf-whatpro';

interface WhatProState {
	features: number;
	demos: number;
	buttons: string[];
	status: string;
}

async function modalState(): Promise<WhatProState> {
	return browser.execute((sel: string) => {
		const m = document.querySelector(sel);
		return {
			features: m?.querySelectorAll('.pf-whatpro-feature').length ?? 0,
			demos: Array.from(m?.querySelectorAll<HTMLElement>('.pf-whatpro-demo') ?? []).filter((d) => (d.textContent ?? '').trim() !== '' || d.querySelector('svg, table') !== null).length,
			buttons: Array.from(m?.querySelectorAll('button') ?? []).map((b) => b.textContent ?? ''),
			status: m?.querySelector('.pf-whatpro-status')?.textContent ?? '',
		};
	}, MODAL);
}

/** Closes the window with Escape, as a user does. The modal scope of Obsidian handles the key. */
async function closeModal(): Promise<void> {
	await browser.keys('Escape');
	const closed = await browser.$(MODAL).waitForExist({ timeout: 3000, reverse: true }).catch(() => false);
	if (closed) return;
	// Log the state for the job log, then click the close button with a real pointer click.
	console.log('What Pro adds still open after Escape:', await browser.execute((sel: string) => document.querySelector(sel)?.outerHTML.slice(0, 300) ?? 'none', MODAL));
	await browser.$(`${MODAL} .modal-close-button`).click();
	await browser.$(MODAL).waitForExist({ timeout: 5000, reverse: true });
}

/** Pro on: a stubbed GitHub Sponsors reply and a fake token, then Refresh. Pro off: sign out. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

/** Runs one blocked Pro action of this plugin as a free user, so the shared Pro notice shows. */
async function showProNotice(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { needPro(what: string): boolean }> } }).plugins.plugins[id]!;
		p.needPro('Presets');
	}, pluginId);
}

describe(`${pluginId}: What Pro adds`, function () {
	before(async function () {
		await setPro(false);
	});

	it('does not open at startup or after a reload', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state.errors).toEqual([]);
		await browser.pause(1500);
		expect(await browser.$(MODAL).isExisting()).toBe(false);
	});

	it('the command opens it with one row per Pro feature, the price, Sponsor $15 once and Sign in with GitHub', async function () {
		await setPro(false);
		await browser.executeObsidianCommand(`${pluginId}:what-pro-adds`);
		await browser.$(MODAL).waitForExist({ timeout: 5000 });
		const s = await modalState();
		expect(s.features).toBe(FEATURES);
		expect(s.demos).toBe(0);
		expect(s.status).toContain('Pro is off');
		expect(s.buttons).toContain('Sponsor $15 once');
		expect(s.buttons).toContain('Sign in with GitHub');
	});

	it('each Try it draws its demo in the window', async function () {
		const tries = await browser.$$(`${MODAL} .pf-whatpro-feature button`);
		for (const b of tries) await b.click();
		await browser.waitUntil(async () => (await modalState()).demos === FEATURES, { timeout: 5000, timeoutMsg: 'not every demo was drawn' });
		const errors = await browser.execute((sel: string) => Array.from(document.querySelectorAll(`${sel} .pf-whatpro-demo`)).filter((d) => (d.textContent ?? '').includes('could not run')).length, MODAL);
		expect(errors).toBe(0);
		await closeModal();
	});

	it('the Pro notice has a What Pro adds link that opens the window', async function () {
		await showProNotice();
		// Older notices can still be on screen. The new notice is the last one.
		await browser.$('.notice .pf-pro-notice-whatpro a').waitForExist({ timeout: 5000 });
		const links = await browser.$$('.notice .pf-pro-notice-whatpro a');
		const link = links[(await links.length) - 1]!;
		await link.waitForClickable({ timeout: 5000 });
		await link.click();
		await browser.$(MODAL).waitForExist({ timeout: 5000 });
		await closeModal();
	});

	it('a Pro user sees Pro is active and no buy button', async function () {
		await setPro(true);
		await browser.executeObsidianCommand(`${pluginId}:what-pro-adds`);
		await browser.$(MODAL).waitForExist({ timeout: 5000 });
		const s = await modalState();
		expect(s.status).toContain('Pro is active');
		expect(s.buttons).not.toContain('Sponsor $15 once');
		expect(s.buttons).not.toContain('Sign in with GitHub');
		expect(s.features).toBe(FEATURES);
		await closeModal();
		await setPro(false);
	});
});
