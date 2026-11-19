"use client";

import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { blockSummary, pageBlocks } from "../../content.js";
import { BLOCK_ATTR } from "../../markers.js";
import { isShellState, type CanvasMessageBody, type ShellState } from "../../protocol.js";
import type { BlockComponents, LayoutProps } from "../../render.js";
import type { SiteDef } from "../../schema.js";
import { Overlay } from "./Overlay.js";
import { pageToSvg } from "./svg.js";

export interface EditorCanvasProps<D extends SiteDef> {
  site: D;
  components: BlockComponents<D>;
  layout: ComponentType<LayoutProps<D>>;
}

/**
 * The page inside the editor's iframe, for `app/edit/canvas/page.tsx`. It renders the site's own layout and
 * block components from the draft the editor sends, so what you edit is what the site shows.
 */
export function EditorCanvas<D extends SiteDef>({ site, components, layout }: EditorCanvasProps<D>) {
  const [state, setState] = useState<ShellState | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const rendered = useRef<(() => void) | null>(null);

  const post = useCallback((message: CanvasMessageBody) => {
    window.parent.postMessage({ se: "canvas", ...message }, window.location.origin);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("capture")) {
      setCapturing(true);
      window.__siteEditorCapture = {
        render: (content, page) =>
          new Promise((resolve) => {
            rendered.current = resolve;
            setState({ se: "shell", type: "state", content, page, selection: null, mode: "preview", reveal: false });
          }),
        svg: pageToSvg,
      };
      return () => {
        delete window.__siteEditorCapture;
      };
    }
    if (window.parent === window) {
      setStandalone(true);
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (isShellState(event.data)) setState(event.data);
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  usePreviewLinks(state?.mode === "preview" && !capturing, post);

  // A capture's render resolves once the draft is on the page.
  useEffect(() => {
    rendered.current?.();
    rendered.current = null;
  }, [state]);

  if (standalone) {
    return (
      <p className="se-canvas-note">
        This page shows the site inside the editor. <a href=".">Open the editor</a>.
      </p>
    );
  }
  if (!state) return null;

  // The draft is checked against the site's fields by the editor, so it's passed on untyped here.
  type Untyped = { id?: string; data?: unknown; site: unknown; children?: ReactNode };
  const Layout = layout as unknown as ComponentType<Untyped>;
  const blocks = components as unknown as Record<string, ComponentType<Untyped> | undefined>;
  const editing = state.mode === "edit";

  return (
    <>
      <Layout site={state.content.site}>
        {pageBlocks(state.content, state.page).map((entry) => {
          const Block = blocks[entry.type];
          const { label } = blockSummary(site, entry);
          const block = Block ? (
            <BlockBoundary key={entry.id} label={label} resetKey={entry.data}>
              <Block id={entry.id} data={entry.data} site={state.content.site} />
            </BlockBoundary>
          ) : null;
          // Captures get the live site's exact markup, without the editor's wrappers.
          if (capturing) return block;
          return (
            <BlockFrame key={entry.id} id={entry.id} label={label} showEmpty={editing}>
              {block}
            </BlockFrame>
          );
        })}
      </Layout>
      {editing && <Overlay site={site} state={state} post={post} />}
    </>
  );
}

/** Wraps a block without adding a box, so layout matches the live site; shows a note when it renders nothing. */
function BlockFrame({ id, label, showEmpty, children }: { id: string; label: string; showEmpty: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setEmpty(!Array.from(element.children).some((child) => !child.hasAttribute("data-se-placeholder")));
  });

  return (
    <div ref={ref} {...{ [BLOCK_ATTR]: id }} style={{ display: "contents" }}>
      {children}
      {empty && showEmpty && (
        <div data-se-placeholder="" className="se-placeholder">
          <strong>{label}</strong> has nothing to show, so it&rsquo;s hidden on the live site. Select it to add content.
        </div>
      )}
    </div>
  );
}

class BlockBoundary extends Component<{ label: string; resetKey: unknown; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: { resetKey: unknown }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[site-editor] ${this.props.label} failed to render`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="se-placeholder se-placeholder-error">
        <strong>{this.props.label}</strong> couldn&rsquo;t be shown: {this.state.error.message}
      </div>
    );
  }
}

/** In preview, links behave, except that leaving the canvas goes through the editor instead. */
function usePreviewLinks(active: boolean, post: (message: CanvasMessageBody) => void) {
  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || event.defaultPrevented || anchor.getAttribute("href")?.startsWith("#")) return;
      const url = new URL(anchor.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      event.preventDefault();
      event.stopPropagation();
      if (url.origin !== window.location.origin) window.open(url.href, "_blank", "noopener,noreferrer");
      else post({ type: "navigate", path: url.pathname });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, post]);
}
