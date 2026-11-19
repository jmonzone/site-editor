"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatPath } from "../../content.js";
import { defaultValue, fieldLabel, isRecord, itemLabel, type Field, type ImageValue, type ListField, type Seg, type Shape } from "../../schema.js";
import { ChevronIcon, CloseIcon, DownIcon, PlusIcon, TrashIcon, UpIcon, UploadIcon } from "../icons.js";

export interface FieldHandlers {
  /** Sets the value at a path relative to the inspected element. */
  change(path: Seg[], value: unknown): void;
  /** Selects a list item inside the inspected element. */
  select(path: Seg[]): void;
  /** Uploads a file and stores its public path at `path`. Resolves to an error message or null. */
  upload(path: Seg[], file: File, kind: "image" | "file"): Promise<string | null>;
  /** Pending uploads have no URL yet; this maps their path to a previewable one. */
  previewUrl(src: string): string;
}

const labelOf = fieldLabel;

function Help({ id, children }: { id: string; children?: ReactNode }) {
  return children ? (
    <p id={id} className="se-help">
      {children}
    </p>
  ) : null;
}

function AutoTextarea({ value, onChange, ...rest }: { value: string; onChange(value: string): void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={2} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />;
}

function UploadButton({ accept, label, onFile }: { accept: string; label: string; onFile(file: File): Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="se-button" disabled={busy} onClick={() => input.current?.click()}>
        <UploadIcon />
        {busy ? "Uploading…" : label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          await onFile(file);
          setBusy(false);
        }}
      />
    </>
  );
}

interface ControlProps {
  field: Field;
  value: unknown;
  path: Seg[];
  handlers: FieldHandlers;
  /** Omit the label, for list rows and the top-level object. */
  bare?: boolean;
  /** Takes an optional field off the page (stores null). Set by the parent for optional fields that are shown. */
  onRemove?: () => void;
}

/** The control to focus for a marked field: an input first, then a button other than "Remove". */
export function controlIn(marked: HTMLElement | null | undefined): HTMLElement | null {
  if (!marked) return null;
  if (marked.matches("input, select, textarea, button")) return marked;
  return marked.querySelector<HTMLElement>("input, select, textarea") ?? marked.querySelector<HTMLElement>("button:not(.se-part-remove)");
}

/** Buttons that put removed optional fields back, side by side where the fields would be. */
function AddParts({ parts, handlers }: { parts: { key: string; field: Field; path: Seg[] }[]; handlers: FieldHandlers }) {
  return (
    <div className="se-add-parts">
      {parts.map(({ key, field, path }) => {
        const label = labelOf(field, key);
        return (
          <button
            key={key}
            type="button"
            className="se-add-part"
            title={`Add ${label} back to the page`}
            onClick={(event) => {
              // The button goes away with the change, so find the new control from the panel around it.
              const scope = event.currentTarget.closest(".se-panel-section") ?? document;
              handlers.change(path, defaultValue(field));
              requestAnimationFrame(() => {
                controlIn(scope.querySelector<HTMLElement>(`[data-se-path="${CSS.escape(formatPath(path))}"]`))?.focus();
              });
            }}
          >
            <PlusIcon />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** An input for any field, recursing into objects and lists. */
export function FieldControl({ field, value, path, handlers, bare, onRemove }: ControlProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const key = path[path.length - 1];
  const label = labelOf(field, key);
  const dataPath = { "data-se-path": formatPath(path) };
  const described = field.help ? helpId : undefined;
  const set = (next: unknown) => handlers.change(path, next);

  // An optional field reached directly rather than through its object, e.g. as a list item.
  if (field.optional && !onRemove && !bare) {
    if (value === null) return <AddParts parts={[{ key: String(key ?? ""), field, path }]} handlers={handlers} />;
    return <FieldControl field={field} value={value} path={path} handlers={handlers} onRemove={() => set(null)} />;
  }

  const remove = onRemove ? (
    <button type="button" className="se-icon-button se-part-remove" title={`Remove ${label} from the page`} aria-label={`Remove ${label}`} onClick={onRemove}>
      <TrashIcon />
    </button>
  ) : null;
  const removable = remove ? " se-removable" : "";

  const labelled = (control: ReactNode) =>
    bare ? (
      control
    ) : (
      <div className={`se-field${removable}`}>
        <label className="se-label" htmlFor={id}>
          {label}
        </label>
        {remove}
        <Help id={helpId}>{field.help}</Help>
        {control}
      </div>
    );

  switch (field.kind) {
    case "text":
      return labelled(
        <input id={id} type="text" className="se-input" value={String(value ?? "")} placeholder={field.placeholder} aria-describedby={described} aria-label={bare ? label || undefined : undefined} onChange={(event) => set(event.target.value)} {...dataPath} />,
      );
    case "textarea":
      return labelled(
        <AutoTextarea id={id} className="se-input" value={String(value ?? "")} placeholder={field.placeholder} aria-describedby={described} aria-label={bare ? label || undefined : undefined} onChange={set} {...dataPath} />,
      );
    case "url":
      return labelled(
        <div className="se-inline">
          <input id={id} type="text" inputMode="url" className="se-input" value={String(value ?? "")} placeholder={field.placeholder ?? "https://…"} aria-describedby={described} aria-label={bare ? label || undefined : undefined} onChange={(event) => set(event.target.value)} {...dataPath} />
          {field.accept && (
            <UploadButton
              accept={field.accept}
              label="Upload"
              onFile={async (file) => {
                await handlers.upload(path, file, "file");
              }}
            />
          )}
        </div>,
      );
    case "select":
      return labelled(
        <select id={id} className="se-input" value={String(value ?? "")} aria-describedby={described} onChange={(event) => set(event.target.value)} {...dataPath}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>,
      );
    case "boolean":
      return (
        <div className={`se-field se-check${removable}`}>
          <input id={id} type="checkbox" checked={value === true} aria-describedby={described} onChange={(event) => set(event.target.checked)} {...dataPath} />
          <label htmlFor={id}>{label}</label>
          {remove}
          <Help id={helpId}>{field.help}</Help>
        </div>
      );
    case "image":
      return <ImageControl id={id} label={label} help={field.help} value={value} path={path} handlers={handlers} remove={remove} />;
    case "list":
      return <ListControl field={field} value={value} path={path} handlers={handlers} label={label} remove={remove} />;
    case "object": {
      const object = isRecord(value) ? value : {};
      // Removed optional fields become "+ Label" buttons, grouped where they'd be.
      const children: ReactNode[] = [];
      let removed: { key: string; field: Field; path: Seg[] }[] = [];
      const flush = () => {
        if (removed.length) children.push(<AddParts key={`add-${removed[0]!.key}`} parts={removed} handlers={handlers} />);
        removed = [];
      };
      for (const [childKey, child] of Object.entries(field.shape as Shape)) {
        const childPath = [...path, childKey];
        if (child.optional && object[childKey] === null) {
          removed.push({ key: childKey, field: child, path: childPath });
          continue;
        }
        flush();
        children.push(
          <FieldControl
            key={childKey}
            field={child}
            value={object[childKey]}
            path={childPath}
            handlers={handlers}
            onRemove={child.optional ? () => handlers.change(childPath, null) : undefined}
          />,
        );
      }
      flush();
      if (bare) return <div className="se-fields">{children}</div>;
      return (
        <fieldset className={`se-fieldset${removable}`} {...dataPath}>
          <legend className="se-label">{label}</legend>
          {remove}
          <Help id={helpId}>{field.help}</Help>
          {children}
        </fieldset>
      );
    }
  }
}

function ImageControl({ id, label, help, value, path, handlers, remove }: { id: string; label: string; help?: string; value: unknown; path: Seg[]; handlers: FieldHandlers; remove: ReactNode }) {
  const raw = isRecord(value) ? value : {};
  const image: ImageValue = { src: typeof raw.src === "string" ? raw.src : "", alt: typeof raw.alt === "string" ? raw.alt : "" };
  const [error, setError] = useState<string | null>(null);
  return (
    <fieldset className={`se-fieldset${remove ? " se-removable" : ""}`} data-se-path={formatPath(path)}>
      <legend className="se-label">{label}</legend>
      {remove}
      {help && <p className="se-help">{help}</p>}
      {image.src ? (
        <img className="se-image-preview" src={handlers.previewUrl(image.src)} alt="" />
      ) : (
        <p className="se-help">No image yet.</p>
      )}
      <div className="se-inline">
        <UploadButton
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          label={image.src ? "Replace" : "Upload"}
          onFile={async (file) => setError(await handlers.upload([...path, "src"], file, "image"))}
        />
        {image.src && (
          <button type="button" className="se-button" onClick={() => handlers.change(path, { ...raw, src: "" })}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="se-error" role="alert">
          {error}
        </p>
      )}
      <div className="se-field">
        <label className="se-label" htmlFor={`${id}-alt`}>
          Description (alt text)
        </label>
        <p className="se-help" id={`${id}-alt-help`}>
          What the image shows, for people using screen readers. Leave empty only if it&rsquo;s purely decorative.
        </p>
        <input id={`${id}-alt`} type="text" className="se-input" value={image.alt} aria-describedby={`${id}-alt-help`} onChange={(event) => handlers.change([...path, "alt"], event.target.value)} data-se-path={formatPath([...path, "alt"])} />
        {image.src && !image.alt.trim() && <p className="se-warning">This image has no description yet.</p>}
      </div>
    </fieldset>
  );
}

const SIMPLE_ITEMS = new Set(["text", "textarea", "url"]);

function ListControl({ field, value, path, handlers, label, remove }: { field: ListField; value: unknown; path: Seg[]; handlers: FieldHandlers; label: string; remove: ReactNode }) {
  const items = Array.isArray(value) ? value : [];
  const item = field.item as Field;
  const itemName = field.itemLabel ?? "item";
  const simple = SIMPLE_ITEMS.has(item.kind);
  const setItems = (next: unknown[]) => handlers.change(path, next);
  const move = (index: number, delta: number) => {
    const next = [...items];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setItems(next);
  };

  return (
    <fieldset className={`se-fieldset${remove ? " se-removable" : ""}`} data-se-path={formatPath(path)}>
      <legend className="se-label">{label}</legend>
      {remove}
      {field.help && <p className="se-help">{field.help}</p>}
      {items.length === 0 && <p className="se-help">None yet.</p>}
      <ul className="se-list">
        {items.map((entry, index) => {
          const name = itemLabel(field, entry, index);
          return (
            <li key={index} className="se-list-row">
              {simple ? (
                <div className="se-list-input">
                  <FieldControl field={{ ...item, label: `${itemName} ${index + 1}` }} value={entry} path={[...path, index]} handlers={handlers} bare />
                </div>
              ) : (
                <button type="button" className="se-list-open" onClick={() => handlers.select([...path, index])}>
                  <span>{name}</span>
                  <ChevronIcon />
                </button>
              )}
              <span className="se-list-actions">
                <button type="button" className="se-icon-button" aria-label={`Move ${name} up`} title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <UpIcon />
                </button>
                <button type="button" className="se-icon-button" aria-label={`Move ${name} down`} title="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  <DownIcon />
                </button>
                <button type="button" className="se-icon-button se-danger" aria-label={`Delete ${name}`} title="Delete" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                  <CloseIcon />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="se-button se-add"
        onClick={() => {
          setItems([...items, defaultValue(item)]);
          if (!simple) handlers.select([...path, items.length]);
        }}
      >
        <PlusIcon />
        Add {itemName.toLowerCase()}
      </button>
    </fieldset>
  );
}
