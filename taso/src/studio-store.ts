import { randomUUID } from 'node:crypto';

/** Bounded, deterministic document grammar. Never store executable HTML or CSS. */
export type StudioNodeKind = 'section' | 'heading' | 'text' | 'button';
export type StudioNodeStyle = {
  color?: string;
  background?: string;
  fontSize?: number;
  padding?: number;
  borderRadius?: number;
  textAlign?: 'left' | 'center' | 'right';
  fontWeight?: number;
};
export type StudioNode = {
  id: string;
  kind: StudioNodeKind;
  text: string;
  style: StudioNodeStyle;
  children: StudioNode[];
};
export type StudioPage = { id: string; name: string; slug: string; nodes: StudioNode[] };
export type StudioLibraryEntry = { id: string; name: string; node: StudioNode };
export type StudioCheckpoint = {
  id: string;
  label: string;
  at: string;
  actorId: string;
  sourceVersion: number;
  pages: StudioPage[];
  library?: StudioLibraryEntry[];
};
export type StudioDocument = {
  id: string;
  projectId: string;
  title: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  pages: StudioPage[];
  library?: StudioLibraryEntry[];
  revisions: StudioCheckpoint[];
};
export type StudioMutation = { title?: unknown; pages?: unknown; library?: unknown; expectedVersion?: unknown };

export class StudioError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}
const id = (p: string) => p + '_' + randomUUID();
const now = () => new Date().toISOString();
const TITLE_LENGTH = 100;
function label(value: unknown, max = TITLE_LENGTH) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new StudioError(400, 'Invalid Studio label.');
  return value.trim();
}
function style(input: unknown): StudioNodeStyle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const obj = input as Record<string, unknown>;
  const out: StudioNodeStyle = {};
  const color = (key: 'color' | 'background') => {
    const v = obj[key];
    if (v !== undefined) {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new StudioError(400, 'Only six-digit HEX colors are allowed.');
      out[key] = v;
    }
  };
  color('color'); color('background');
  for (const key of ['fontSize', 'padding', 'borderRadius', 'fontWeight'] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    const bounds: [number, number] = key === 'fontSize' ? [10, 96] : key === 'padding' ? [0, 100] : key === 'borderRadius' ? [0, 100] : [100, 900];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < bounds[0] || v > bounds[1] || (key === 'fontWeight' && v % 100 !== 0)) throw new StudioError(400, 'Invalid Studio style value: ' + key);
    out[key] = v;
  }
  if (obj.textAlign !== undefined) {
    if (!['left', 'center', 'right'].includes(String(obj.textAlign))) throw new StudioError(400, 'Invalid alignment.');
    out.textAlign = obj.textAlign as StudioNodeStyle['textAlign'];
  }
  return out;
}
function nodes(input: unknown, seen: Set<string>, depth = 0, counter = { value: 0 }): StudioNode[] {
  if (!Array.isArray(input) || depth > 5) throw new StudioError(400, 'Invalid or excessively nested Studio tree.');
  return input.map((value) => {
    if (++counter.value > 160) throw new StudioError(400, 'Studio page exceeds 160 nodes.');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudioError(400, 'Invalid Studio node.');
    const n = value as Record<string, unknown>;
    if (typeof n.id !== 'string' || !/^[A-Za-z0-9_-]{3,90}$/.test(n.id) || seen.has(n.id)) throw new StudioError(400, 'Duplicate or invalid Studio node ID.');
    seen.add(n.id);
    if (!['section','heading','text','button'].includes(String(n.kind))) throw new StudioError(400, 'Unsupported Studio node type.');
    if (typeof n.text !== 'string' || n.text.length > 4000) throw new StudioError(400, 'Studio text too long.');
    const children = nodes(n.children ?? [], seen, depth + 1, counter);
    if (n.kind !== 'section' && children.length) throw new StudioError(400, 'Only sections can have children.');
    return { id:n.id, kind:n.kind as StudioNodeKind, text:n.text, style:style(n.style), children };
  });
}
export function validateStudioPages(input: unknown): StudioPage[] {
  if (!Array.isArray(input) || input.length > 24) throw new StudioError(400, 'Studio supports up to 24 pages.');
  const seen = new Set<string>();
  const slugs = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudioError(400, 'Invalid Studio page.');
    const p = value as Record<string, unknown>;
    if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{3,90}$/.test(p.id) || seen.has(p.id)) throw new StudioError(400, 'Invalid page ID.');
    seen.add(p.id);
    const name = label(p.name);
    const slug = label(p.slug, 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slugs.has(slug)) throw new StudioError(400, 'Invalid or duplicate page slug.');
    slugs.add(slug);
    return { id:p.id, name, slug, nodes:nodes(p.nodes, seen) };
  });
}
/** Validate reusable snippets using the same bounded node grammar as pages. */
export function validateStudioLibrary(value: unknown): StudioLibraryEntry[] {
  if (!Array.isArray(value) || value.length > 24) throw new StudioError(400, 'Studio component library supports up to 24 items.');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new StudioError(400, 'Invalid Studio library item.');
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !/^lib_[a-zA-Z0-9_-]{6,80}$/.test(entry.id) || ids.has(entry.id)) throw new StudioError(400, 'Invalid or duplicate library item ID.');
    ids.add(entry.id);
    const name = label(entry.name, 80);
    const page = validateStudioPages([{id:'page_library',name:'Template',slug:'template',nodes:[entry.node]}])[0];
    const node = page?.nodes[0];
    if (!node) throw new StudioError(400, 'Library component cannot be empty.');
    function size(n:StudioNode):number { return 1+n.children.reduce((sum,child)=>sum+size(child),0); }
    if (size(node)>20) throw new StudioError(400, 'Library component exceeds 20 nested nodes.');
    return {id:entry.id,name,node};
  });
}
function verifyVersion(document: StudioDocument, expectedVersion: unknown) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== document.version) throw new StudioError(409, 'Studio document changed; refresh before applying changes.');
}
export class StudioStore {
  private readonly byProject = new Map<string, StudioDocument>();
  constructor(initial: StudioDocument[] = [], private readonly onChange: () => void = () => {}) {
    for (const item of initial) if (item && typeof item.projectId === 'string') this.byProject.set(item.projectId, {...structuredClone(item),library:Array.isArray(item.library)?structuredClone(item.library):[]});
  }
  list(): StudioDocument[] { return structuredClone([...this.byProject.values()]); }
  get(projectId: string): StudioDocument | undefined {
    const item = this.byProject.get(projectId);
    return item ? structuredClone(item) : undefined;
  }
  create(projectId: string, actorId: string, title = 'Yeni Tasarım') {
    if (this.byProject.has(projectId)) throw new StudioError(409, 'Studio document already exists.');
    const page: StudioPage = { id:id('page'), name:'Ana Sayfa', slug:'ana-sayfa', nodes:[] };
    const doc: StudioDocument = { id:id('studio'), projectId, title:label(title), version:1, updatedAt:now(), updatedBy:actorId, pages:[page], library:[], revisions:[] };
    this.byProject.set(projectId, doc);this.onChange();return this.get(projectId)!;
  }
  replace(projectId: string, actorId: string, mutation: StudioMutation) {
    const current = this.byProject.get(projectId);
    if (!current) throw new StudioError(404, 'Studio document not initialized.');
    verifyVersion(current, mutation.expectedVersion);
    const next: StudioDocument = {
      ...current, title: mutation.title === undefined ? current.title : label(mutation.title),
      pages: validateStudioPages(mutation.pages), library:mutation.library===undefined?structuredClone(current.library||[]):validateStudioLibrary(mutation.library), version:current.version + 1,
      updatedAt:now(), updatedBy:actorId,
    };
    this.byProject.set(projectId, next);this.onChange();return this.get(projectId)!;
  }
  checkpoint(projectId: string, actorId: string, expectedVersion: unknown, name: unknown) {
    const current = this.byProject.get(projectId);
    if (!current) throw new StudioError(404, 'Studio document not initialized.');
    verifyVersion(current, expectedVersion);
    const checkpoint: StudioCheckpoint = {
      id:id('revision'), label:label(name, 120), at:now(), actorId,
      sourceVersion:current.version, pages:structuredClone(current.pages),library:structuredClone(current.library||[]),
    };
    current.revisions = [checkpoint, ...current.revisions].slice(0, 40);
    this.onChange();return this.get(projectId)!;
  }
  restore(projectId: string, actorId: string, expectedVersion: unknown, revisionId: string) {
    const current = this.byProject.get(projectId);
    if (!current) throw new StudioError(404, 'Studio document not initialized.');
    verifyVersion(current, expectedVersion);
    const revision = current.revisions.find(item => item.id === revisionId);
    if (!revision) throw new StudioError(404, 'Studio revision not found.');
    current.pages = structuredClone(revision.pages);
    if (revision.library!==undefined) current.library=structuredClone(revision.library);
    current.version += 1;
    current.updatedAt = now();current.updatedBy = actorId;
    this.onChange();return this.get(projectId)!;
  }
}
