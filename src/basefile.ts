// Pure logic for Bases Filter Switches. No Obsidian imports: unit tests and golden vectors run it in Node.
//
// A .base file keeps its switch definitions under one plugin-owned top-level key (KEY). Core Bases ignores
// unknown keys and keeps them when it saves the file (checked in Obsidian 1.14.4, query.unrecognizedData).
//
//   filterSwitches:
//     groups:
//       - name: Status
//         switches:
//           - label: Todo
//             filter: status == "todo"
//       - name: Type
//         property: type        # Pro: one switch per existing value of the property
//         single: true          # only one switch of this group on at a time
//     presets:                  # Pro
//       - name: Open work
//         on: [Status/Todo]
//     default: [Status/Todo]     # Pro: the switches that "Apply the default switches" turns on
//
// The state of the switches is not stored anywhere. It is read from the top-level filters of the base:
// a switch is on when its filter text is an item of the top-level "and" list (one switch of a group), or when an
// "or" item of that list holds only filters of one group (several switches of a group). Turning switches on and
// off edits only those items, through the YAML document model, so comments, key order and quoting stay.
import { Document, isMap, isScalar, isSeq, parseDocument, YAMLSeq, type Node, type YAMLMap } from 'yaml';

export const KEY = 'filterSwitches';
export const FREE_SWITCHES = 3;
export const FREE_GROUPS = 1;

export interface SwitchDef {
	label: string;
	filter: string;
	/** Earlier generated expressions. Read them as on, then replace or remove them on the next click. */
	legacyFilters?: string[];
}
export interface GroupDef {
	name: string;
	switches: SwitchDef[];
	property?: string;
	single?: boolean;
}
export interface PresetDef {
	name: string;
	on: string[];
}
export interface SwitchConfig {
	groups: GroupDef[];
	presets: PresetDef[];
}
/** Group name -> labels of the switches that are on. */
export type Selection = Record<string, string[]>;

const str = (v: unknown): string | null => {
	// A label or name typed by hand as a number (label: 2024) is still a label.
	const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
	return s !== '' ? s : null;
};
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function switchKey(group: string, label: string): string {
	return `${group}/${label}`;
}

function parseSwitch(v: unknown): SwitchDef | null {
	const r = rec(v);
	const label = str(r?.label);
	const filter = str(r?.filter);
	return label && filter ? { label, filter } : null;
}

function parseGroup(v: unknown): GroupDef | null {
	const r = rec(v);
	const name = str(r?.name);
	if (!r || !name) return null;
	const switches = (Array.isArray(r.switches) ? r.switches : []).map(parseSwitch).filter((s): s is SwitchDef => s !== null);
	const group: GroupDef = { name, switches };
	const property = str(r.property);
	if (property) group.property = property;
	if (r.single === true) group.single = true;
	return group;
}

function parsePreset(v: unknown): PresetDef | null {
	const r = rec(v);
	const name = str(r?.name);
	if (!r || !name) return null;
	const on = (Array.isArray(r.on) ? r.on : []).map(str).filter((s): s is string => s !== null);
	return { name, on };
}

/** The switch definitions of a .base file. Malformed entries are skipped, never thrown. */
export function readConfig(text: string): SwitchConfig {
	const data = rec(parseDocument(text).toJS());
	const own = rec(data?.[KEY]);
	const groups = (Array.isArray(own?.groups) ? own.groups : []).map(parseGroup).filter((g): g is GroupDef => g !== null);
	const presets = (Array.isArray(own?.presets) ? own.presets : []).map(parsePreset).filter((p): p is PresetDef => p !== null);
	return { groups: uniqueBy(groups, (g) => g.name), presets: uniqueBy(presets, (p) => p.name) };
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
}

/** Free tier: the first group and its first 3 switches; property groups and presets need Pro. */
export function limitConfig(config: SwitchConfig, pro: boolean): { config: SwitchConfig; hidden: number } {
	if (pro) return { config, hidden: 0 };
	const total = config.groups.reduce((n, g) => n + (g.property ? 1 : g.switches.length), 0);
	const first = config.groups.find((g) => !g.property);
	const groups = first ? [{ ...first, switches: first.switches.slice(0, FREE_SWITCHES) }] : [];
	const shown = groups[0]?.switches.length ?? 0;
	return { config: { groups, presets: [] }, hidden: total - shown };
}

/** A Bases expression for a note property: bare when it is a plain identifier and not a Bases object, else note["name"]. */
export function propertyRef(property: string): string {
	// file, note, formula and this are Bases objects, so a property with one of these names needs note["..."].
	const reserved = ['file', 'note', 'formula', 'this'].includes(property);
	return !reserved && /^[A-Za-z_][A-Za-z0-9_]*$/.test(property) ? property : `note[${JSON.stringify(property)}]`;
}

function literal(v: string | number | boolean): string {
	return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/** Switches for every distinct value of a property (Pro). Lists use contains(), single values use ==. */
export function switchesFromValues(property: string, values: unknown[]): SwitchDef[] {
	const ref = propertyRef(property);
	const isList = values.some((v) => Array.isArray(v));
	const flat: unknown[] = values.flatMap((v): unknown[] => (Array.isArray(v) ? (v as unknown[]) : [v]));
	const keep = flat.filter((v): v is string | number | boolean => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean');
	const distinct = uniqueBy(keep, (v) => `${typeof v}:${String(v)}`);
	distinct.sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
	// One visible label has one switch key, including 42 and "42" in a mixed property.
	const byLabel = new Map<string, (string | number | boolean)[]>();
	for (const v of distinct) {
		const label = String(v);
		const group = byLabel.get(label) ?? [];
		group.push(v);
		byLabel.set(label, group);
	}
	return [...byLabel].map(([label, values]) => {
		const filters = values.map((v) => isList ? `list(${ref}).contains(${literal(v)})` : `${ref} == ${literal(v)}`);
		const filter = filters.length === 1 ? filters[0]! : `(${filters.join(' || ')})`;
		const legacyFilters = values.map((v) => isList ? `${ref}.contains(${literal(v)})` : `${ref} == ${literal(v)}`).filter((old) => old !== filter);
		return legacyFilters.length > 0 ? { label, filter, legacyFilters } : { label, filter };
	});
}

interface Owner {
	group: string;
	label: string;
}

function owners(groups: GroupDef[]): Map<string, Owner> {
	const m = new Map<string, Owner>();
	for (const g of groups) for (const s of g.switches) {
		for (const filter of [s.filter, ...(s.legacyFilters ?? [])]) if (!m.has(filter)) m.set(filter, { group: g.name, label: s.label });
	}
	return m;
}

/** If a filter item is a switch clause, the group and labels it holds. */
function clauseOf(item: unknown, own: Map<string, Owner>): { group: string; labels: string[] } | null {
	if (typeof item === 'string') {
		const o = own.get(item.trim());
		return o ? { group: o.group, labels: [o.label] } : null;
	}
	const r = rec(item);
	if (!r || Object.keys(r).length !== 1 || !Array.isArray(r.or) || r.or.length === 0) return null;
	const found = r.or.map((x) => (typeof x === 'string' ? own.get(x.trim()) : undefined));
	const group = found[0]?.group;
	if (!group || found.some((o) => !o || o.group !== group)) return null;
	return { group, labels: found.map((o) => (o as Owner).label) };
}

/** The top-level filter items that act as an "and" list: [] when there is no filter. */
function topItems(filters: unknown): unknown[] {
	if (filters === undefined || filters === null) return [];
	const r = rec(filters);
	if (r && Object.keys(r).length === 1 && Array.isArray(r.and)) return r.and as unknown[];
	return [filters];
}

/** The top-level filter texts of a base: the choices for "Use a filter of this base". */
export function topFilters(text: string): string[] {
	const data = rec(parseDocument(text).toJS());
	return topItems(data?.filters).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

/** Which switches are on, read from the top-level filters. Every group gets an entry. */
export function readSelection(text: string, groups: GroupDef[]): Selection {
	const data = rec(parseDocument(text).toJS());
	const own = owners(groups);
	const sel: Selection = Object.fromEntries(groups.map((g) => [g.name, [] as string[]]));
	for (const item of topItems(data?.filters)) {
		const c = clauseOf(item, own);
		if (!c) continue;
		const list = sel[c.group] ?? [];
		for (const l of c.labels) if (!list.includes(l)) list.push(l);
		sel[c.group] = list;
	}
	return sel;
}

/** The filter item for one group: nothing, one filter, or an "or" of the filters in group order. */
function clauseFor(group: GroupDef, labels: string[]): string | { or: string[] } | null {
	const filters = group.switches.filter((s) => labels.includes(s.label)).map((s) => s.filter);
	if (filters.length === 0) return null;
	return filters.length === 1 ? (filters[0] as string) : { or: filters };
}

/**
 * Writes a selection into the top-level filters. Items that are not switch clauses are never touched.
 * A group's clause stays at the place of its old clause; a new clause goes to the end of the "and" list.
 * Returns the text unchanged (same string) when the filters already match the selection.
 */
export function applySelection(text: string, groups: GroupDef[], selection: Selection): string {
	const doc = openDoc(text);
	const own = owners(groups);
	const wanted = new Map<string, string | { or: string[] }>();
	for (const g of groups) {
		const c = clauseFor(g, selection[g.name] ?? []);
		if (c !== null) wanted.set(g.name, c);
	}
	const { raw, seq, items: oldItems } = topNodes(doc);
	const placed = new Set<string>();
	const next: unknown[] = [];
	for (const item of oldItems) {
		const c = clauseOf(toJS(item), own);
		if (!c) {
			next.push(item);
			continue;
		}
		const w = wanted.get(c.group);
		if (w === undefined || placed.has(c.group)) continue;
		placed.add(c.group);
		next.push(same(toJS(item), w) ? item : doc.createNode(w));
	}
	for (const g of groups) {
		const w = wanted.get(g.name);
		if (w !== undefined && !placed.has(g.name)) next.push(doc.createNode(w));
	}
	if (same(next.map(toJS), oldItems.map(toJS))) return text;
	writeTop(doc, raw, seq, next);
	return render(doc);
}

/** The top-level filter node, its "and" list (null when it is not one) and its items as an "and" list. */
function topNodes(doc: Document): { raw: Node | undefined; seq: YAMLSeq | null; items: unknown[] } {
	const raw = doc.get('filters', true) as Node | undefined;
	// An empty "filters:" key is no filter, not a null filter item.
	const node = isScalar(raw) && raw.value === null ? undefined : raw;
	const seq = andSeq(node);
	return { raw, seq, items: seq ? seq.items : node === undefined || node === null || emptyAnd(node) ? [] : [node] };
}

/**
 * The one writer of the top-level filters, for switches and quick filters. A filter that is not an "and" list becomes
 * the first item of a new "and" list. A base without filters gets the key at the top. No items removes the key.
 */
function writeTop(doc: Document, raw: Node | undefined, seq: YAMLSeq | null, next: unknown[]): void {
	if (next.length === 0) doc.delete('filters');
	else if (seq) seq.items = next;
	else if (raw === undefined && isMap(doc.contents)) (doc.contents.items as unknown[]).unshift(doc.createPair('filters', andNode(doc, next)));
	else doc.set('filters', andNode(doc, next));
}

function toJS(item: unknown): unknown {
	return item !== null && typeof item === 'object' && 'toJSON' in item ? (item as { toJSON(): unknown }).toJSON() : item;
}

/** The YAML sequence under filters.and when filters is exactly {and: [...]}. */
function andSeq(node: Node | undefined): YAMLSeq | null {
	if (!isMap(node) || node.items.length !== 1) return null;
	const pair = node.items[0];
	const key = isScalar(pair?.key) ? pair.key.value : pair?.key;
	if (key !== 'and' || !pair) return null;
	return isSeq(pair.value) ? pair.value : null;
}

/** True for exactly {and: } with an empty value: an empty "and" list. A read never changes the document. */
function emptyAnd(node: Node | undefined): boolean {
	if (!isMap(node) || node.items.length !== 1) return false;
	const pair = node.items[0];
	const key = isScalar(pair?.key) ? pair.key.value : pair?.key;
	return key === 'and' && (pair?.value === null || (isScalar(pair?.value) && pair.value.value === null));
}

function andNode(doc: Document, items: unknown[]): YAMLMap {
	const map = doc.createNode({ and: [] }) as YAMLMap;
	const seq = map.get('and', true) as unknown as YAMLSeq;
	seq.items = items;
	return map;
}

// ---- writing a document back with the least change ----
//
// The yaml Document model keeps comments, quotes and key order. A full re-render still changes the layout of a file
// that core Bases did not write (CRLF, 4-space indents, no final newline, extra blank lines). So a write renders the
// document in the indent style of the file, then copies only the top-level keys whose value changed into the original
// text, as whole lines with the original line ending. Every other byte of the file stays.

const SOURCE = new WeakMap<Document, string>();

/** parseDocument that remembers the text, so render() can keep the bytes that did not change. */
function openDoc(text: string): Document {
	const doc = parseDocument(text);
	SOURCE.set(doc, text);
	return doc;
}

interface Style {
	eol: string;
	indent: number;
	indentSeq: boolean;
}

/** Line ending and indentation of a file. A file without indented lines gets the core Bases style. */
function styleOf(text: string): Style {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	let indent = 2;
	let indentSeq = true;
	let seenIndent = false;
	let seenSeq = false;
	for (let i = 1; i < lines.length && !(seenIndent && seenSeq); i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		let j = i - 1;
		while (j >= 0 && ((lines[j] ?? '').trim() === '' || (lines[j] ?? '').trimStart().startsWith('#'))) j--;
		const parent = lines[j] ?? '';
		// Only a key that opens a block ("name:" at the end of the line) tells the indent of its children.
		if (!/^\s*(?:- )?[^\s#-][^:]*:\s*(?:#.*)?$/.test(parent)) continue;
		const pi = parent.length - parent.trimStart().length + (parent.trimStart().startsWith('- ') ? 2 : 0);
		const ci = line.length - line.trimStart().length;
		if (line.trimStart().startsWith('- ')) {
			if (!seenSeq) indentSeq = ci > pi;
			seenSeq = true;
			if (ci > pi && !seenIndent) {
				indent = ci - pi;
				seenIndent = true;
			}
		} else if (ci > pi && !seenIndent) {
			indent = ci - pi;
			seenIndent = true;
		}
	}
	return { eol, indent: indent >= 1 && indent <= 8 ? indent : 2, indentSeq };
}

interface Region {
	start: number;
	end: number;
}

/**
 * The top-level keys of a block map and their text: whole lines from the key to the next key, without the blank and
 * column-0 comment lines just before the next key. Null when the text is not a block map with plain keys at column 0.
 */
function regionsOf(text: string): Map<string, Region> | null {
	const doc = parseDocument(text);
	if (doc.errors.length > 0 || !isMap(doc.contents) || doc.contents.flow) return null;
	const starts: { key: string; start: number }[] = [];
	for (const pair of doc.contents.items) {
		if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || !pair.key.range) return null;
		const at = pair.key.range[0];
		const start = text.lastIndexOf('\n', at - 1) + 1;
		if (start !== at) return null;
		starts.push({ key: pair.key.value, start });
	}
	const out = new Map<string, Region>();
	starts.forEach(({ key, start }, i) => {
		let end = starts[i + 1]?.start ?? text.length;
		// Give back the blank and column-0 comment lines before the next key (or the end) to the text outside.
		for (;;) {
			const prev = text.lastIndexOf('\n', end - 2) + 1;
			if (prev <= start) break;
			const line = text.slice(prev, end).replace(/\r?\n$/, '');
			if (line.trim() !== '' && !line.startsWith('#') && line !== '...') break;
			end = prev;
		}
		out.set(key, { start, end });
	});
	return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Puts the changed top-level keys of rendered into original. Null when that is not safe; then the caller renders all. */
function splice(original: string, rendered: string, style: Style): string | null {
	const ro = regionsOf(original);
	const rn = regionsOf(rendered);
	if (!ro || !rn) return null;
	const before = rec(parseDocument(original).toJS()) ?? {};
	const after = rec(parseDocument(rendered).toJS()) ?? {};
	const eolText = (t: string): string => (style.eol === '\n' ? t : t.replace(/\r?\n/g, style.eol));
	const first = Math.min(...[...ro.values()].map((r) => r.start));
	const edits: { start: number; end: number; text: string }[] = [];
	const appends: string[] = [];
	for (const [key, r] of rn) {
		if (ro.has(key) && same(before[key], after[key])) continue;
		const text = eolText(rendered.slice(r.start, r.end));
		const old = ro.get(key);
		if (old) edits.push({ ...old, text });
		else if (key === 'filters') edits.push({ start: first, end: first, text });
		else appends.push(text);
	}
	for (const [key, r] of ro) if (!rn.has(key)) edits.push({ ...r, text: '' });
	let out = original;
	for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
	for (const text of appends) out += (out === '' || out.endsWith('\n') ? '' : style.eol) + text;
	out = sameEnding(original, out, style.eol);
	return same(parseDocument(out).toJS(), after) ? out : null;
}

/** Gives out the same final newline (or none) as original. */
function sameEnding(original: string, out: string, eol: string): string {
	if (original.endsWith('\n') || original === '') return out.endsWith('\n') || out === '' ? out : out + eol;
	return out.replace(/(?:\r?\n)+$/, '');
}

function render(doc: Document): string {
	const original = SOURCE.get(doc);
	const style = original === undefined ? { eol: '\n', indent: 2, indentSeq: true } : styleOf(original);
	const rendered = doc.toString({ lineWidth: 0, flowCollectionPadding: false, indent: style.indent, indentSeq: style.indentSeq });
	if (original === undefined) return rendered;
	const spliced = splice(original, rendered, style);
	if (spliced !== null) return spliced;
	const full = style.eol === '\n' ? rendered : rendered.replace(/\r?\n/g, style.eol);
	return original.endsWith('\n') || original === '' ? full : full.replace(/\r?\n$/, '');
}

/** The plugin-owned map, created at the end of the file when it is missing. */
function ownMap(doc: Document): YAMLMap {
	let own = doc.get(KEY, true);
	if (!isMap(own)) {
		own = doc.createNode({ groups: [] });
		doc.set(KEY, own);
	}
	return own as YAMLMap;
}

function listIn(doc: Document, map: YAMLMap, key: string): YAMLSeq {
	const old: unknown = map.get(key, true);
	if (isSeq(old)) return old;
	const seq = doc.createNode([]) as YAMLSeq;
	map.set(key, seq);
	return seq;
}

function findByName(seq: YAMLSeq, name: string): YAMLMap | null {
	for (const item of seq.items) if (isMap(item) && str(item.get('name')) === name) return item;
	return null;
}

/** Adds one switch (and its group when new). An existing switch with the same label gets the new filter. */
export function addSwitch(text: string, group: string, sw: SwitchDef): string {
	const doc = openDoc(text);
	const groups = listIn(doc, ownMap(doc), 'groups');
	let g = findByName(groups, group);
	if (!g) {
		g = doc.createNode({ name: group, switches: [] });
		groups.items.push(g);
	}
	const list = listIn(doc, g, 'switches');
	const old = list.items.find((s) => isMap(s) && str(s.get('label')) === sw.label);
	if (isMap(old)) old.set('filter', sw.filter);
	else list.items.push(doc.createNode({ label: sw.label, filter: sw.filter }));
	return render(doc);
}

/** Adds a group whose switches come from the values of a property (Pro). */
export function addPropertyGroup(text: string, group: string, property: string, single: boolean): string {
	const doc = openDoc(text);
	const groups = listIn(doc, ownMap(doc), 'groups');
	const old = findByName(groups, group);
	if (old) groups.items.splice(groups.items.indexOf(old), 1);
	groups.items.push(doc.createNode(single ? { name: group, property, single: true } : { name: group, property }));
	return render(doc);
}

/** Turns the switch off, then deletes its definition (and the group when it becomes empty). */
export function removeSwitch(text: string, groups: GroupDef[], group: string, label: string): string {
	const sel = readSelection(text, groups);
	sel[group] = (sel[group] ?? []).filter((l) => l !== label);
	const doc = openDoc(applySelection(text, groups, sel));
	const own = doc.get(KEY, true);
	const list = isMap(own) ? own.get('groups', true) : null;
	const g = isSeq(list) ? findByName(list, group) : null;
	if (!g || !isSeq(list)) return render(doc);
	const sws = g.get('switches', true);
	if (isSeq(sws)) sws.items = sws.items.filter((s) => !(isMap(s) && str(s.get('label')) === label));
	if (!isSeq(sws) || sws.items.length === 0) list.items.splice(list.items.indexOf(g), 1);
	return render(doc);
}

/**
 * Changes the group, label or filter of a switch. A switch that is on stays on with its new filter, so the old filter
 * does not stay in the base as a plain filter.
 */
export function editSwitch(text: string, from: { group: string; label: string }, to: { group: string; label: string; filter: string }): string {
	const before = readConfig(text).groups;
	const sel = readSelection(text, before);
	const wasOn = (sel[from.group] ?? []).includes(from.label);
	const moved = from.group !== to.group || from.label !== to.label;
	const off = moved ? removeSwitch(text, before, from.group, from.label) : applySelection(text, before, { ...sel, [from.group]: (sel[from.group] ?? []).filter((l) => l !== from.label) });
	const added = addSwitch(off, to.group, { label: to.label, filter: to.filter });
	if (!wasOn) return added;
	const after = readConfig(added).groups;
	const group = after.find((g) => g.name === to.group);
	const now = readSelection(added, after);
	return group && !(now[to.group] ?? []).includes(to.label) ? applySelection(added, after, toggle(now, group, to.label)) : added;
}

/** Saves a preset (replaces one with the same name). */
export function savePreset(text: string, preset: PresetDef): string {
	const doc = openDoc(text);
	const presets = listIn(doc, ownMap(doc), 'presets');
	const node = doc.createNode({ name: preset.name, on: preset.on });
	const old = findByName(presets, preset.name);
	if (old) presets.items[presets.items.indexOf(old)] = node;
	else presets.items.push(node);
	return render(doc);
}

export function removePreset(text: string, name: string): string {
	const doc = openDoc(text);
	const own = doc.get(KEY, true);
	const presets = isMap(own) ? own.get('presets', true) : null;
	if (!isSeq(presets)) return text;
	const before = presets.items.length;
	presets.items = presets.items.filter((p) => !(isMap(p) && str(p.get('name')) === name));
	return presets.items.length === before ? text : render(doc);
}

/** The selection a preset turns on: every group listed, the others off. Unknown keys are ignored. */
export function presetSelection(groups: GroupDef[], preset: PresetDef): Selection {
	const sel: Selection = Object.fromEntries(groups.map((g) => [g.name, [] as string[]]));
	for (const g of groups) for (const s of g.switches) if (preset.on.includes(switchKey(g.name, s.label))) sel[g.name]?.push(s.label);
	return sel;
}

/** The keys (Group/Label) of the switches that are on. */
export function selectionKeys(selection: Selection): string[] {
	return Object.entries(selection).flatMap(([g, labels]) => labels.map((l) => switchKey(g, l)));
}

/** The saved default keys of a base: [] when there is no default. */
export function readDefault(text: string): string[] {
	const data = rec(parseDocument(text).toJS());
	const own = rec(data?.[KEY]);
	return (Array.isArray(own?.default) ? own.default : []).map(str).filter((s): s is string => s !== null);
}

/** True when the base has a saved default list (an empty list is a default too). */
export function hasDefault(text: string): boolean {
	return Array.isArray(rec(rec(parseDocument(text).toJS())?.[KEY])?.default);
}

/** The selection the saved default turns on: every group listed, the others off. Unknown keys are ignored. */
export function defaultSelection(groups: GroupDef[], keys: string[]): Selection {
	return presetSelection(groups, { name: 'default', on: keys });
}

/** Saves the given keys as the default of the base (replaces the old default). */
export function saveDefault(text: string, keys: string[]): string {
	const doc = openDoc(text);
	const seq = doc.createNode(keys) as YAMLSeq;
	ownMap(doc).set('default', seq);
	return render(doc);
}

/** Removes the saved default. Returns the text unchanged when there is none. */
export function clearDefault(text: string): string {
	const doc = openDoc(text);
	const own = doc.get(KEY, true);
	if (!isMap(own) || !own.has('default')) return text;
	own.delete('default');
	return render(doc);
}

/** Saved labels of a paused group. Null means the group is not paused. */
export function readPaused(text: string, group: string): string[] | null {
	const own = rec(rec(parseDocument(text).toJS())?.[KEY]);
	const paused = rec(own?.paused);
	const value = paused && Object.prototype.hasOwnProperty.call(paused, group) ? paused[group] : null;
	return Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : null;
}

/** A new selection or an explicit reset discards the paused selection it replaces. */
export function clearPaused(text: string, group: string | null = null): string {
	const doc = openDoc(text);
	const own = doc.get(KEY, true);
	const paused = isMap(own) ? own.get('paused', true) : null;
	if (!isMap(own) || !isMap(paused)) return text;
	if (group === null) own.delete('paused');
	else {
		if (!paused.has(group)) return text;
		paused.delete(group);
		if (paused.items.length === 0) own.delete('paused');
	}
	return render(doc);
}

/** Pause the group's filters without losing their labels. A second click restores them. */
export function toggleGroupPaused(text: string, groups: GroupDef[], name: string): string {
	const group = groups.find((g) => g.name === name);
	if (!group) return text;
	const selection = readSelection(text, groups);
	const on = selection[name] ?? [];
	const saved = readPaused(text, name);
	if (saved !== null && on.length === 0) {
		const known = group.switches.filter((s) => saved.includes(s.label)).map((s) => s.label);
		return applySelection(clearPaused(text, name), groups, { ...selection, [name]: group.single ? known.slice(0, 1) : known });
	}
	if (on.length === 0) return text;
	const doc = openDoc(applySelection(text, groups, { ...selection, [name]: [] }));
	const own = ownMap(doc);
	let paused: unknown = own.get('paused', true);
	if (!isMap(paused)) {
		paused = doc.createNode({});
		own.set('paused', paused);
	}
	(paused as YAMLMap).set(name, doc.createNode(on));
	return render(doc);
}

/** One click on a chip: toggles it; in a single group it also turns the others off. */
export function toggle(selection: Selection, group: GroupDef, label: string): Selection {
	const cur = selection[group.name] ?? [];
	const on = cur.includes(label);
	const next = on ? cur.filter((l) => l !== label) : group.single ? [label] : [...cur, label];
	return { ...selection, [group.name]: next };
}

/** The "All" chip: no switch of the group (or of every group when group is null) is on. */
export function reset(selection: Selection, group: string | null): Selection {
	return Object.fromEntries(Object.entries(selection).map(([g, l]) => [g, group === null || g === group ? [] : l]));
}

// ---- quick property filters ----
//
// A quick filter is one plain item of the top-level "and" list. That item (and the "and" list when the filters were not
// one yet) is the only text that the plugin writes into the base file for it. The chips and the undo data live in the
// plugin data, per base file path (QuickState). A quick filter is not a switch: presets, defaults and pauses never read
// or save it. When the user edits its text by hand, the chip goes and the item is a hand-typed filter.

export const FREE_QUICK = 1;
export const PRO_QUICK = 5;
export type QuickMatch = 'is' | 'contains';
export interface QuickInput {
	property: string;
	match: QuickMatch;
	value: string;
}
export interface QuickFilter extends QuickInput {
	/** Stable id of the chip: a hash of the filter text. */
	id: string;
	filter: string;
}
/** The quick filters of one base file, kept in the plugin data (never in the base file). */
export interface QuickState {
	chips: QuickFilter[];
	/** The top-level filters text (LF) from before the first chip, "" for no filters key. Null when it can no longer be used. */
	origin: string | null;
	/** Hash of the top-level filters text just after the last write of the plugin. */
	live: string;
}

/** The distinct values that notes have now, as the labels of the generator. The "is" suggestions. */
export function quickValues(property: string, values: unknown[]): string[] {
	return switchesFromValues(property, values).map((s) => s.label);
}

/**
 * The expression of a quick filter. "is" uses the generator of property switches: list(ref).contains(v) for a list
 * property, ref == v for a scalar one. "contains" matches lowercase text. Null when the value is empty.
 */
export function quickExpression(input: QuickInput, values: unknown[]): string | null {
	const value = input.value.trim();
	if (!input.property.trim() || value === '') return null;
	const ref = propertyRef(input.property);
	if (input.match === 'contains') return `${ref}.toString().lower().contains(${JSON.stringify(value.toLowerCase())})`;
	const known = switchesFromValues(input.property, values).find((s) => s.label === value);
	if (known) return known.filter;
	return values.some((v) => Array.isArray(v)) ? `list(${ref}).contains(${JSON.stringify(value)})` : `${ref} == ${JSON.stringify(value)}`;
}

/** A short stable hash of a text (djb2, base 36). */
export function hashText(text: string): string {
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
	return h.toString(36);
}

/** The text of the top-level filters key with LF line endings, "" when there is none, null when it cannot be found. */
function filtersText(text: string): string | null {
	const regions = regionsOf(text);
	if (!regions) return null;
	const r = regions.get('filters');
	return r ? text.slice(r.start, r.end).replace(/\r\n/g, '\n') : '';
}

const liveHash = (text: string): string => hashText(filtersText(text) ?? `\u0000${text}`);

/** Writes the saved text of the top-level filters back in place. Null when the result is not valid YAML. */
function restoreFilters(text: string, before: string): string | null {
	const r = regionsOf(text)?.get('filters');
	if (!r) return null;
	const eol = styleOf(text).eol;
	let back = before;
	if (back !== '' && !back.endsWith('\n') && r.end < text.length) back += '\n';
	if (eol !== '\n') back = back.replace(/\n/g, eol);
	const out = sameEnding(text, text.slice(0, r.start) + back + text.slice(r.end), eol);
	return parseDocument(out).errors.length === 0 ? out : null;
}

const itemText = (item: unknown): string | null => {
	const v = toJS(item);
	return typeof v === 'string' ? v.trim() : null;
};

const topTexts = (text: string): (string | null)[] => topItems(rec(parseDocument(text).toJS())?.filters).map(itemText);

/** The chips whose filter is still an item of the top-level filters. */
export function activeQuick(text: string, state: QuickState | null | undefined): QuickFilter[] {
	if (!state) return [];
	const items = new Set(topTexts(text));
	return state.chips.filter((q) => items.has(q.filter));
}

/** The top-level items after a write must be the old ones with exactly this change, and nothing else may change. */
function checked(before: string, after: string, items: (string | null)[]): string | null {
	const a = rec(parseDocument(before).toJS()) ?? {};
	const doc = parseDocument(after);
	if (doc.errors.length > 0) return null;
	const b = rec(doc.toJS()) ?? {};
	if (!same(topTexts(after), items)) return null;
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const k of keys) if (k !== 'filters' && !same(a[k], b[k])) return null;
	return after;
}

/** The plain or quoted YAML text of one filter item. */
function itemSource(filter: string): string {
	return String(new Document(filter).toString({ lineWidth: 0 })).replace(/\n$/, '');
}

/**
 * Adds one line "- filter" after the last item of a block "and" list, with the indent and line ending of that list.
 * The other lines stay byte for byte. Null when the filters are not a block "and" list.
 */
function insertLine(text: string, filter: string): string | null {
	const doc = parseDocument(text);
	const seq = andSeq(doc.get('filters', true) as Node | undefined);
	if (!seq || seq.flow || seq.items.length === 0 || !seq.range) return null;
	const first = seq.items[0] as Node;
	if (!first.range) return null;
	const dash = text.lastIndexOf('-', first.range[0]);
	const lineStart = text.lastIndexOf('\n', dash - 1) + 1;
	const indent = text.slice(lineStart, dash);
	if (indent.trim() !== '') return null;
	const eol = styleOf(text).eol;
	const lastEnd = seq.range[1];
	const nl = text.indexOf('\n', Math.max(lastEnd - 1, 0));
	const at = nl < 0 ? text.length : nl + 1;
	const line = `${indent}- ${itemSource(filter)}`;
	const out = at === text.length && !text.endsWith('\n') ? `${text}${eol}${line}` : `${text.slice(0, at)}${line}${eol}${text.slice(at)}`;
	return checked(text, out, [...topTexts(text), filter]);
}

/** Removes the line of the last item with exactly this text from a block "and" list. Null when that is not one line. */
function deleteLine(text: string, filter: string): string | null {
	const doc = parseDocument(text);
	const seq = andSeq(doc.get('filters', true) as Node | undefined);
	if (!seq || seq.flow) return null;
	let index = -1;
	for (let i = seq.items.length - 1; i >= 0; i--) if (itemText(seq.items[i]) === filter) { index = i; break; }
	const node = seq.items[index] as Node | undefined;
	if (!node?.range) return null;
	const dash = text.lastIndexOf('-', node.range[0]);
	const start = text.lastIndexOf('\n', dash - 1) + 1;
	if (text.slice(start, dash).trim() !== '') return null;
	const nl = text.indexOf('\n', Math.max(node.range[1] - 1, 0));
	if (nl >= 0 && text.slice(node.range[1], nl).trim().replace(/^#.*/, '') !== '') return null;
	const end = nl < 0 ? text.length : nl + 1;
	const out = sameEnding(text, text.slice(0, start) + text.slice(end), styleOf(text).eol);
	const items = topTexts(text);
	items.splice(index, 1);
	return items.length > 0 ? checked(text, out, items) : null;
}

/** Fallback writer for any filter shape: the document model, then render() keeps the other keys byte for byte. */
function writeItems(text: string, change: (items: unknown[], doc: Document) => void): string {
	const doc = openDoc(text);
	const top = topNodes(doc);
	const next = [...top.items];
	change(next, doc);
	if (same(next.map(toJS), top.items.map(toJS))) return text;
	writeTop(doc, top.raw, top.seq, next);
	return render(doc);
}

/** Removes the last top-level item with exactly this text. Returns false when there is none (the user edited it). */
function dropItem(items: unknown[], filter: string): boolean {
	for (let i = items.length - 1; i >= 0; i--) {
		if (itemText(items[i]) !== filter) continue;
		items.splice(i, 1);
		return true;
	}
	return false;
}

export interface QuickResult {
	text: string;
	state: QuickState | null;
	/** Why nothing changed, or null. */
	error: string | null;
}

/** The state after a write: the chips that still have their item, and the hash of the new filters text. */
function settle(text: string, chips: QuickFilter[], origin: string | null): QuickState | null {
	const items = new Set(topTexts(text));
	const kept = chips.filter((q) => items.has(q.filter));
	return kept.length === 0 ? null : { chips: kept, origin, live: liveHash(text) };
}

/**
 * Adds a quick filter at the end of the top-level "and" list. Free (max 1): the new filter replaces the old one.
 * Pro (max 5): the filters are joined with "and", and one more is refused. Switch definitions, presets, the default
 * and pauses stay as they are. The file gets only the filter item, and the "and" list when it had none.
 */
export function addQuick(text: string, groups: GroupDef[], input: QuickInput, values: unknown[], max: number, state: QuickState | null | undefined): QuickResult {
	const filter = quickExpression(input, values);
	if (filter === null) return { text, state: state ?? null, error: 'Choose a property and type a value.' };
	const switchOwner = owners(groups).get(filter);
	if (switchOwner) return { text, state: state ?? null, error: `The switch ${switchOwner.label} of the group ${switchOwner.group} has this filter. Turn on that switch.` };
	if (topTexts(text).includes(filter)) return { text, state: state ?? null, error: 'The base already has this filter.' };
	const active = activeQuick(text, state);
	if (max > 1 && active.length >= max) return { text, state: state ?? null, error: `You can use ${max} quick filters at the same time. Remove one first.` };
	let base = text;
	let current: QuickState | null = state ? { ...state, chips: active } : null;
	// Free: the old quick filter goes first, so it can give back its own text.
	if (max <= 1) for (const q of [...active].reverse()) ({ text: base, state: current } = removeQuick(base, current, q.id));
	// The saved original text is good only while the filters are exactly as the plugin left them.
	let origin: string | null;
	if (!current || current.chips.length === 0) origin = filtersText(base);
	else origin = current.live === liveHash(base) ? current.origin : null;
	const out = insertLine(base, filter) ?? writeItems(base, (items, doc) => items.push(doc.createNode(filter)));
	const chip: QuickFilter = { ...input, value: input.value.trim(), filter, id: hashText(filter) };
	return { text: out, state: settle(out, [...(current?.chips ?? []), chip], origin), error: null };
}

/**
 * Removes one quick filter. When it is the last chip and the filters are exactly as the plugin left them, the saved
 * text from before the first chip comes back byte for byte. Else only its own item goes (or nothing, when the user
 * edited it). Text that is not in the plugin data is never written.
 */
export function removeQuick(text: string, state: QuickState | null | undefined, id: string): { text: string; state: QuickState | null } {
	const chip = state?.chips.find((q) => q.id === id);
	if (!state || !chip) return { text, state: state ?? null };
	const rest = state.chips.filter((q) => q !== chip);
	const untouched = state.live === liveHash(text);
	const origin = untouched ? state.origin : null;
	const others = activeQuick(text, { ...state, chips: rest });
	if (others.length === 0 && origin !== null && topTexts(text).includes(chip.filter)) {
		const back = restoreFilters(text, origin);
		if (back !== null) return { text: back, state: null };
	}
	const out = deleteLine(text, chip.filter) ?? writeItems(text, (items) => void dropItem(items, chip.filter));
	return { text: out, state: settle(out, others, origin) };
}

/** Removes every quick filter, newest first. */
export function clearQuick(text: string, state: QuickState | null | undefined): { text: string; state: QuickState | null } {
	let out = { text, state: state ?? null };
	for (const q of [...(state?.chips ?? [])].reverse()) out = removeQuick(out.text, out.state, q.id);
	return { text: out.text, state: null };
}

/**
 * Golden-vector helper: runs quick steps with the state that the plugin keeps between them. Steps:
 * ["add", property, match, value, values, pro], ["remove", filter], ["clear"], ["edit", from, to] (a hand edit).
 */
export function runQuickSteps(text: string, steps: unknown[][]): string {
	let t = text;
	let state: QuickState | null = null;
	for (const [kind, ...a] of steps) {
		if (kind === 'add') ({ text: t, state } = addQuick(t, readConfig(t).groups, { property: String(a[0]), match: a[1] === 'contains' ? 'contains' : 'is', value: String(a[2]) }, (a[3] as unknown[] | undefined) ?? [], a[4] === true ? PRO_QUICK : FREE_QUICK, state));
		else if (kind === 'remove') ({ text: t, state } = removeQuick(t, state, hashText(String(a[0]))));
		else if (kind === 'clear') ({ text: t, state } = clearQuick(t, state));
		else if (kind === 'edit') t = t.replace(String(a[0]), String(a[1]));
		else throw new Error(`unknown quick step ${String(kind)}`);
	}
	return t;
}

/** The note properties that a view shows, in its column order (the "order" list of the view). */
export function visibleProperties(text: string, view: string | null): string[] {
	const views = rec(parseDocument(text).toJS())?.views;
	if (!Array.isArray(views)) return [];
	const chosen = rec(views.find((v) => view !== null && str(rec(v)?.name) === view) ?? views[0]);
	const order = Array.isArray(chosen?.order) ? chosen.order : [];
	const out: string[] = [];
	for (const id of order.map(str)) {
		if (!id || id.startsWith('file.') || id.startsWith('formula.')) continue;
		const name = id.startsWith('note.') ? id.slice(5) : id;
		if (name && !out.includes(name)) out.push(name);
	}
	return out;
}

/** The Property choices of the quick filter: the visible properties of the view first, then the others by name. */
export function quickProperties(visible: string[], known: string[]): string[] {
	const first = visible.filter((p) => known.includes(p));
	return [...first, ...known.filter((p) => !first.includes(p)).sort((a, b) => a.localeCompare(b))];
}

/** Golden-vector entry point: one operation on a .base text. Returns the new text. */
export function runOp(text: string, op: string, args: unknown[]): string {
	const groups = readConfig(text).groups;
	if (op === 'toggle') {
		const group = groups.find((g) => g.name === args[0]);
		if (!group) throw new Error(`no group ${String(args[0])}`);
		return applySelection(text, groups, toggle(readSelection(text, groups), group, String(args[1])));
	}
	if (op === 'reset') return applySelection(text, groups, reset(readSelection(text, groups), typeof args[0] === 'string' ? args[0] : null));
	if (op === 'add') return addSwitch(text, String(args[0]), { label: String(args[1]), filter: String(args[2]) });
	if (op === 'remove') return removeSwitch(text, groups, String(args[0]), String(args[1]));
	if (op === 'preset') {
		const preset = readConfig(text).presets.find((p) => p.name === args[0]);
		if (!preset) throw new Error(`no preset ${String(args[0])}`);
		return applySelection(text, groups, presetSelection(groups, preset));
	}
	if (op === 'save-preset') return savePreset(text, { name: String(args[0]), on: selectionKeys(readSelection(text, groups)) });
	if (op === 'save-default') return saveDefault(text, selectionKeys(readSelection(text, groups)));
	if (op === 'clear-default') return clearDefault(text);
	if (op === 'default') return hasDefault(text) ? applySelection(text, groups, defaultSelection(groups, readDefault(text))) : text;
	if (op === 'quick') return runQuickSteps(text, [['add', ...args]]);
	if (op === 'quick-steps') return runQuickSteps(text, args as unknown[][]);
	throw new Error(`unknown op ${op}`);
}
