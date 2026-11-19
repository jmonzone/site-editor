/**
 * Field definitions describe a site's content. The editor builds its forms and defaults from them, and the site
 * gets its TypeScript types from them, so the two can't drift apart.
 */

export interface ImageValue {
  src: string;
  alt: string;
}

interface FieldBase {
  /** Shown above the input in the editor. */
  label?: string;
  /** A hint shown under the label. */
  help?: string;
  /**
   * The field can be removed from the page entirely, which stores null. Set it with `f.optional()`, so the
   * field's type includes null and the site's component has to handle a removed part.
   */
  optional?: boolean;
}

export interface TextField extends FieldBase {
  kind: "text";
  default?: string;
  placeholder?: string;
}

export interface TextareaField extends FieldBase {
  kind: "textarea";
  default?: string;
  placeholder?: string;
}

export interface UrlField extends FieldBase {
  kind: "url";
  default?: string;
  placeholder?: string;
  /** MIME types that can be uploaded into this field, e.g. "application/pdf". Omit for a plain link. */
  accept?: string;
}

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
}

export interface SelectField<V extends string = string> extends FieldBase {
  kind: "select";
  options: readonly SelectOption<V>[];
  default?: V;
}

export interface BooleanField extends FieldBase {
  kind: "boolean";
  default?: boolean;
}

export interface ImageField extends FieldBase {
  kind: "image";
}

export interface ListField<I extends Field = Field> extends FieldBase {
  kind: "list";
  item: I;
  /** What one item is called, e.g. "Paper". */
  itemLabel?: string;
  /** The item field used as an item's name in the editor, e.g. "title". */
  labelField?: string;
}

export interface ObjectField<S extends Shape = Shape> extends FieldBase {
  kind: "object";
  shape: S;
}

export type Shape = { readonly [key: string]: Field };

export type Field = TextField | TextareaField | UrlField | SelectField | BooleanField | ImageField | ListField<any> | ObjectField<any>;

/** The value type a field holds: null too when the field is optional, which means it was removed. */
export type Infer<F> = F extends { optional: true } ? Present<F> | null : Present<F>;

type Present<F> = F extends { kind: "text" | "textarea" | "url" }
  ? string
  : F extends SelectField<infer V>
    ? V
    : F extends BooleanField
      ? boolean
      : F extends ImageField
        ? ImageValue
        : F extends ListField<infer I>
          ? Infer<I>[]
          : F extends ObjectField<infer S>
            ? InferShape<S>
            : never;

export type InferShape<S> = { -readonly [K in keyof S]: Infer<S[K]> };

type Options<F> = Omit<F, "kind" | "optional">;
type SelectRest<V extends string> = Omit<SelectField<V>, "kind" | "options" | "optional">;

function select<const V extends string>(options: readonly SelectOption<V>[], rest?: SelectRest<V>): SelectField<V>;
function select<const V extends string>(options: readonly V[], rest?: SelectRest<V>): SelectField<V>;
function select(options: readonly (string | SelectOption)[], rest: SelectRest<string> = {}): SelectField {
  const list = options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));
  return { kind: "select", options: list, ...rest };
}

/**
 * Field builders. Every field always holds a value: text defaults to "", lists to [], images to an empty src.
 * Wrap a field in `f.optional()` to let editors remove it from the page and add it back.
 */
export const f = {
  text: (options: Options<TextField> = {}): TextField => ({ kind: "text", ...options }),
  textarea: (options: Options<TextareaField> = {}): TextareaField => ({ kind: "textarea", ...options }),
  url: (options: Options<UrlField> = {}): UrlField => ({ kind: "url", ...options }),
  boolean: (options: Options<BooleanField> = {}): BooleanField => ({ kind: "boolean", ...options }),
  image: (options: Options<ImageField> = {}): ImageField => ({ kind: "image", ...options }),
  select,
  list<I extends Field>(item: I, rest: Omit<ListField<I>, "kind" | "item" | "optional"> = {}): ListField<I> {
    return { kind: "list", item, ...rest };
  },
  object<const S extends Shape>(shape: S, rest: Omit<ObjectField<S>, "kind" | "shape" | "optional"> = {}): ObjectField<S> {
    return { kind: "object", shape, ...rest };
  },
  /**
   * A part editors can remove from the page and add back, such as a badge or a subtitle. A removed part holds
   * null; adding it back starts from the field's default. The component should render nothing for null.
   */
  optional: <F extends Field>(field: F): F & { optional: true } => ({ ...field, optional: true }),
};

// ---------------------------------------------------------------------------
// Blocks, pages and sites
// ---------------------------------------------------------------------------

export interface BlockDef<S extends Shape = Shape> {
  /** Name shown in the editor, e.g. "Papers". */
  label: string;
  /** One line shown in the Add menu. */
  description?: string;
  fields: S;
  /** Field shown after the label in the page outline, e.g. "heading". */
  labelField?: string;
  /** Starting values for a newly added block, over the fields' defaults. */
  initial?: Partial<InferShape<S>>;
}

export const block = <const S extends Shape>(def: BlockDef<S>): BlockDef<S> => def;

export interface PageDef {
  label: string;
  /** The page's route, e.g. "/" or "/about". */
  path: string;
}

export interface SiteDef<
  SS extends Shape = Shape,
  B extends Record<string, BlockDef<any>> = Record<string, BlockDef<any>>,
  P extends Record<string, PageDef> = Record<string, PageDef>,
> {
  /** Shown in the editor and sign-in email. */
  name: string;
  /** Repo-relative path of the content file. */
  contentFile: string;
  /** Repo-relative folder under public/ that uploads are committed to. */
  uploadsDir: string;
  /** Fields shared by every page: name, contact details, menu links. */
  site: SS;
  blocks: B;
  pages: P;
}

export function defineSite<
  const SS extends Shape,
  const B extends Record<string, BlockDef<any>>,
  const P extends Record<string, PageDef>,
>(
  def: Omit<SiteDef<SS, B, P>, "contentFile" | "uploadsDir"> & { contentFile?: string; uploadsDir?: string },
): SiteDef<SS, B, P> {
  const uploadsDir = (def.uploadsDir ?? "public/uploads").replace(/\/+$/, "");
  if (!uploadsDir.startsWith("public/")) throw new Error(`uploadsDir must be inside public/, got "${uploadsDir}"`);
  return { ...def, contentFile: def.contentFile ?? "content.json", uploadsDir };
}

/** The URL path uploads are served from, e.g. "public/uploads" → "/uploads". */
export const publicUploadsPath = (site: Pick<SiteDef, "uploadsDir">) => site.uploadsDir.replace(/^public/, "");

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

export type SiteData<D extends SiteDef> = InferShape<D["site"]>;
export type BlockType<D extends SiteDef> = keyof D["blocks"] & string;
export type BlockData<D extends SiteDef, T extends BlockType<D>> = InferShape<D["blocks"][T]["fields"]>;
export type BlockOf<D extends SiteDef, T extends BlockType<D> = BlockType<D>> = {
  [K in T]: { id: string; type: K; data: BlockData<D, K> };
}[T];

export interface Content<D extends SiteDef> {
  site: SiteData<D>;
  pages: { [P in keyof D["pages"]]: { blocks: BlockOf<D>[] } };
}

/** Props every block component receives. */
export interface BlockProps<D extends SiteDef, T extends BlockType<D>> {
  /** The block's unique id; handy for element ids. */
  id: string;
  data: BlockData<D, T>;
  site: SiteData<D>;
}

/** Content as the editor handles it, without the site's types. */
export interface RawBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface RawContent {
  site: Record<string, unknown>;
  pages: Record<string, { blocks: RawBlock[] }>;
}

// ---------------------------------------------------------------------------
// Defaults and normalizing
// ---------------------------------------------------------------------------

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const UNSAFE_URL = /^\s*(javascript|vbscript|data):/i;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const newId = () => `b${Math.random().toString(36).slice(2, 10)}`;

export function defaultValue(field: Field): unknown {
  switch (field.kind) {
    case "text":
    case "textarea":
    case "url":
      return field.default ?? "";
    case "select":
      return field.default ?? field.options[0]?.value ?? "";
    case "boolean":
      return field.default ?? false;
    case "image":
      return { src: "", alt: "" };
    case "list":
      return [];
    case "object":
      return Object.fromEntries(Object.entries(field.shape as Shape).map(([key, child]) => [key, defaultValue(child)]));
  }
}

/**
 * Coerces a value to its field's shape: wrong types become the default, missing keys are filled in, and links
 * that could run script are cleared. Optional fields keep null, which means the part was removed. Keys the field doesn't know are kept, so content written for a newer
 * version of the site survives an older editor.
 */
export function normalizeValue(field: Field, value: unknown): unknown {
  // A removed part. A missing key still gets the default, so a field a site adds later shows up.
  if (field.optional && value === null) return null;
  switch (field.kind) {
    case "text":
    case "textarea":
      return typeof value === "string" ? value : defaultValue(field);
    case "url":
      return typeof value === "string" ? (UNSAFE_URL.test(value) ? "" : value) : defaultValue(field);
    case "select":
      return field.options.some((option) => option.value === value) ? value : defaultValue(field);
    case "boolean":
      return typeof value === "boolean" ? value : defaultValue(field);
    case "image": {
      const image = isRecord(value) ? value : {};
      return {
        ...image,
        src: typeof image.src === "string" && !UNSAFE_URL.test(image.src) ? image.src : "",
        alt: typeof image.alt === "string" ? image.alt : "",
      };
    }
    case "list":
      return Array.isArray(value) ? value.map((entry) => normalizeValue(field.item as Field, entry)) : [];
    case "object": {
      const object = isRecord(value) ? value : {};
      const out: Record<string, unknown> = { ...object };
      for (const [key, child] of Object.entries(field.shape as Shape)) out[key] = normalizeValue(child, object[key]);
      return out;
    }
  }
}

export const siteField = (def: SiteDef): ObjectField => ({ kind: "object", shape: def.site, label: "Site settings" });

export const blockField = (def: SiteDef, type: string): ObjectField | null => {
  const blockDef = def.blocks[type];
  return blockDef ? { kind: "object", shape: blockDef.fields, label: blockDef.label } : null;
};

export function newBlock(def: SiteDef, type: string): RawBlock {
  const field = blockField(def, type);
  if (!field) throw new Error(`Unknown block type "${type}"`);
  const initial = def.blocks[type]?.initial ?? {};
  const data = normalizeValue(field, { ...(defaultValue(field) as object), ...structuredClone(initial) });
  return { id: newId(), type, data: data as Record<string, unknown> };
}

/** Makes raw JSON safe for the editor and the site: every page and block has the shape its fields describe. */
export function normalizeContent(def: SiteDef, raw: unknown): RawContent {
  const root = isRecord(raw) ? raw : {};
  const pagesIn = isRecord(root.pages) ? root.pages : {};
  const pages: Record<string, { blocks: RawBlock[] }> = {};
  for (const key of Object.keys(def.pages)) {
    const page = isRecord(pagesIn[key]) ? pagesIn[key] : {};
    const blocks = Array.isArray(page.blocks) ? page.blocks.filter(isRecord) : [];
    const seen = new Set<string>();
    pages[key] = {
      ...page,
      blocks: blocks.map((entry) => {
        let id = typeof entry.id === "string" && BLOCK_ID.test(entry.id) ? entry.id : newId();
        while (seen.has(id)) id = newId();
        seen.add(id);
        const type = typeof entry.type === "string" ? entry.type : "unknown";
        const field = blockField(def, type);
        const data = field ? normalizeValue(field, entry.data) : isRecord(entry.data) ? entry.data : {};
        return { ...entry, id, type, data: data as Record<string, unknown> };
      }),
    };
  }
  return { ...root, site: normalizeValue(siteField(def), root.site) as Record<string, unknown>, pages };
}

/** Normalizes raw JSON and types it with the site's fields. Use it where the site loads its content file. */
export function parseContent<D extends SiteDef>(def: D, raw: unknown): Content<D> {
  return normalizeContent(def, raw) as unknown as Content<D>;
}

// ---------------------------------------------------------------------------
// Walking fields
// ---------------------------------------------------------------------------

export type Seg = string | number;

const IMAGE_PARTS: Record<string, Field> = { src: { kind: "url" }, alt: { kind: "text" } };

/** The field at a path inside another field, or null when the path doesn't fit the field. */
export function fieldAtPath(root: Field, path: readonly Seg[]): Field | null {
  let current: Field | undefined = root;
  for (const seg of path) {
    if (!current) return null;
    if (current.kind === "object" && typeof seg === "string") current = (current.shape as Shape)[seg];
    else if (current.kind === "list" && typeof seg === "number") current = current.item as Field;
    else if (current.kind === "image" && typeof seg === "string") current = IMAGE_PARTS[seg];
    else return null;
  }
  return current ?? null;
}

const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A field's name in the editor: its label, else its key in words ("authorNames" → "Author names"). */
export const fieldLabel = (field: Field, key: Seg | undefined) => field.label ?? (typeof key === "string" ? humanize(key) : "Text");

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A list item's name: its label field or its own text, else "Paper 2". */
export function itemLabel(list: ListField, value: unknown, index: number): string {
  let named = "";
  if (typeof value === "string") named = value;
  else if (list.labelField && isRecord(value) && typeof value[list.labelField] === "string") {
    named = value[list.labelField] as string;
  }
  named = named.trim();
  return named ? truncate(named, 48) : `${list.itemLabel ?? "Item"} ${index + 1}`;
}
