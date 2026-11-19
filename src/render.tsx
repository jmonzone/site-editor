import type { ComponentType, ReactNode } from "react";
import type { BlockOf, BlockProps, BlockType, SiteData, SiteDef } from "./schema.js";

/** Each block type's component. */
export type BlockComponents<D extends SiteDef> = { [T in BlockType<D>]: ComponentType<BlockProps<D, T>> };

/** Props of the component that wraps every page: navigation, `<main>`, footer. */
export interface LayoutProps<D extends SiteDef> {
  site: SiteData<D>;
  children: ReactNode;
}

/** Renders a page's blocks with the site's components. Works in server components. */
export function renderBlocks<D extends SiteDef>(
  components: BlockComponents<D>,
  blocks: readonly BlockOf<D>[],
  site: SiteData<D>,
): ReactNode {
  return blocks.map((entry) => {
    const Component = components[entry.type as BlockType<D>] as ComponentType<BlockProps<D, BlockType<D>>> | undefined;
    return Component ? <Component key={entry.id} id={entry.id} data={entry.data} site={site} /> : null;
  });
}
