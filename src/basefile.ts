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
import { isMap, isScalar, isSeq, parseDocument, YAMLSeq, type Document, type Node, type YAMLMap } from 'yaml';

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

/** A Bases expression for a note property: bare when it is a plain identifier, else note["name"]. */
export function propertyRef(property: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(property) ? property : `note[${JSON.stringify(property)}]`;
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

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Writes a selection into the top-level filters. Items that are not switch clauses are never touched.
 * A group's clause stays at the place of its old clause; a new clause goes to the end of the "and" list.
 * Returns the text unchanged (same string) when the filters already match the selection.
 */
export function applySelection(text: string, groups: GroupDef[], selection: Selection): string {
	const doc = parseDocument(text);
	const own = owners(groups);
	const wanted = new Map<string, string | { or: string[] }>();
	for (const g of groups) {
		const c = clauseFor(g, selection[g.name] ?? []);
		if (c !== null) wanted.set(g.name, c);
	}
	const raw = doc.get('filters', true) as Node | undefined;
	// An empty "filters:" key is no filter, not a null filter item.
	const node = isScalar(raw) && raw.value === null ? undefined : raw;
	const seq = andSeq(node);
	const oldItems: unknown[] = seq ? seq.items : node === undefined || node === null ? [] : [node];
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
	if (next.length === 0) doc.delete('filters');
	else if (seq) seq.items = next;
	else if (raw === undefined && isMap(doc.contents)) (doc.contents.items as unknown[]).unshift(doc.createPair('filters', andNode(doc, next)));
	else doc.set('filters', andNode(doc, next));
	return render(doc);
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
	if (isSeq(pair.value)) return pair.value;
	// An empty "and:" key is an empty list.
	const empty = pair.value === null || (isScalar(pair.value) && pair.value.value === null);
	if (!empty) return null;
	const seq = new YAMLSeq();
	pair.value = seq;
	return seq;
}

function andNode(doc: Document, items: unknown[]): YAMLMap {
	const map = doc.createNode({ and: [] }) as YAMLMap;
	const seq = map.get('and', true) as unknown as YAMLSeq;
	seq.items = items;
	return map;
}

function render(doc: Document): string {
	return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
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
	const doc = parseDocument(text);
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
	const doc = parseDocument(text);
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
	const doc = parseDocument(applySelection(text, groups, sel));
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
	const doc = parseDocument(text);
	const presets = listIn(doc, ownMap(doc), 'presets');
	const node = doc.createNode({ name: preset.name, on: preset.on });
	const old = findByName(presets, preset.name);
	if (old) presets.items[presets.items.indexOf(old)] = node;
	else presets.items.push(node);
	return render(doc);
}

export function removePreset(text: string, name: string): string {
	const doc = parseDocument(text);
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
	const doc = parseDocument(text);
	const seq = doc.createNode(keys) as YAMLSeq;
	ownMap(doc).set('default', seq);
	return render(doc);
}

/** Removes the saved default. Returns the text unchanged when there is none. */
export function clearDefault(text: string): string {
	const doc = parseDocument(text);
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
	const doc = parseDocument(text);
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
	const doc = parseDocument(applySelection(text, groups, { ...selection, [name]: [] }));
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
	throw new Error(`unknown op ${op}`);
}
