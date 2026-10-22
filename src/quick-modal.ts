// The "Filter by property" window: Property, Match and Value. Keyboard: Tab moves between the fields, the arrow keys
// change a choice or move in the value suggestions, Enter picks a suggestion or adds the filter, Escape closes.
import { AbstractInputSuggest, Modal, Notice, Setting, type App, type DropdownComponent } from 'obsidian';
import type { QuickInput, QuickMatch } from './basefile';

export const MATCH_LABELS: Record<QuickMatch, string> = { is: 'is', contains: 'contains text' };

/** Type-ahead for the Value field. It knows when its list is open, so Enter in the window does not add too early. */
class ValueSuggest extends AbstractInputSuggest<string> {
	shown = false;

	constructor(
		app: App,
		input: HTMLInputElement,
		private readonly source: () => string[],
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		// Stop at 50 matches, so a property with many values stays fast on each key press.
		const out: string[] = [];
		for (const v of this.source()) {
			if (!v.toLowerCase().includes(q)) continue;
			out.push(v);
			if (out.length === 50) break;
		}
		return out;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	open(): void {
		super.open();
		this.shown = true;
	}

	close(): void {
		super.close();
		this.shown = false;
	}
}

export class QuickFilterModal extends Modal {
	readonly draft: QuickInput;
	propertyDropdown: DropdownComponent | null = null;
	valueInput: HTMLInputElement | null = null;
	private suggest: ValueSuggest | null = null;
	private busy = false;

	constructor(
		app: App,
		readonly properties: string[],
		private readonly valuesOf: (property: string) => string[],
		private readonly onSubmit: (input: QuickInput) => Promise<boolean>,
	) {
		super(app);
		this.draft = { property: properties[0] ?? '', match: 'is', value: '' };
	}

	/** The value labels of a property, made once per property while the window is open (not on each key press). */
	private readonly labels = new Map<string, string[]>();
	labelsOf(property: string): string[] {
		let list = this.labels.get(property);
		if (!list) {
			list = this.valuesOf(property);
			this.labels.set(property, list);
		}
		return list;
	}

	onOpen(): void {
		this.setTitle('Filter by property');
		this.contentEl.addClass('fsw-quick-modal');
		if (this.properties.length === 0) {
			this.contentEl.createEl('p', { text: 'No note in this vault has properties yet.' });
			return;
		}
		new Setting(this.contentEl).setName('Property').addDropdown((dd) => {
			this.propertyDropdown = dd;
			for (const p of this.properties) dd.addOption(p, p);
			dd.setValue(this.draft.property).onChange((v) => {
				this.draft.property = v;
				this.suggest?.close();
			});
		});
		new Setting(this.contentEl).setName('Match').addDropdown((dd) => {
			for (const m of Object.keys(MATCH_LABELS) as QuickMatch[]) dd.addOption(m, MATCH_LABELS[m]);
			dd.setValue(this.draft.match).onChange((v) => {
				this.draft.match = v === 'contains' ? 'contains' : 'is';
				if (this.draft.match === 'contains') this.suggest?.close();
			});
		});
		new Setting(this.contentEl)
			.setName('Value')
			.setDesc('For "is", the list shows the values that notes have now.')
			.addText((t) => {
				this.valueInput = t.inputEl;
				t.setPlaceholder('Value').onChange((v) => (this.draft.value = v));
				this.suggest = new ValueSuggest(this.app, t.inputEl, () => (this.draft.match === 'is' ? this.labelsOf(this.draft.property) : []));
				const suggest = this.suggest;
				suggest.onSelect((v) => {
					suggest.setValue(v);
					this.draft.value = v;
					suggest.close();
				});
			});
		new Setting(this.contentEl).addButton((b) => b.setButtonText('Add filter').setCta().onClick(() => void this.submit()));
		// The window scope gets Enter only when the value list is closed: an open list has its own scope on top.
		this.scope.register([], 'Enter', (evt) => this.handleEnter(evt));
		window.setTimeout(() => this.propertyDropdown?.selectEl.focus(), 0);
	}

	/** Enter adds the filter. On a button, Enter keeps its normal click. While the value list is open, it picks a value. */
	handleEnter(evt: KeyboardEvent): boolean {
		const target = evt.target instanceof HTMLElement ? evt.target : null;
		if (target?.tagName === 'BUTTON') return true;
		if (this.suggest?.shown) return true;
		evt.preventDefault();
		void this.submit();
		return false;
	}

	async submit(): Promise<void> {
		if (this.busy) return;
		if (this.valueInput) this.draft.value = this.valueInput.value;
		if (!this.draft.property || this.draft.value.trim() === '') {
			new Notice('Choose a property and type a value.');
			this.valueInput?.focus();
			return;
		}
		this.busy = true;
		try {
			if (await this.onSubmit({ ...this.draft, value: this.draft.value.trim() })) this.close();
		} finally {
			this.busy = false;
		}
	}

	onClose(): void {
		this.suggest?.close();
		this.contentEl.empty();
	}
}
