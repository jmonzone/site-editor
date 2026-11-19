/** Converts the rendered page to SVG that Figma imports as layers: text stays text, images are embedded. */

/** Figma matches fonts by one family name, so keep the first of a CSS stack ("Inter, Inter Fallback"). */
export const firstFontFamily = (stack: string) => stack.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

/** One axis of a computed object-position ("50%", "0px", "100%") as SVG's Min, Mid or Max. */
function align(position: string | undefined): "Min" | "Mid" | "Max" {
  const value = parseFloat(position ?? "50%");
  if (!position?.endsWith("%")) return value === 0 ? "Min" : "Mid";
  return value <= 25 ? "Min" : value >= 75 ? "Max" : "Mid";
}

/** An <img>'s object-fit and object-position as the SVG preserveAspectRatio that draws it the same way. */
export function aspectRatioFor(objectFit: string, objectPosition: string): string {
  if (objectFit === "fill") return "none";
  const [x, y] = objectPosition.trim().split(/\s+/);
  return `x${align(x)}Y${align(y)} ${objectFit === "cover" ? "slice" : "meet"}`;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export async function pageToSvg(): Promise<string> {
  const { elementToSVG, inlineResources } = await import("dom-to-svg");
  const root = document.documentElement;

  // dom-to-svg draws every image as if it were object-fit: contain, so note how each one is really fitted.
  const fits = new Map<string, string>();
  for (const image of document.images) {
    const styles = getComputedStyle(image);
    fits.set(image.currentSrc || image.src, aspectRatioFor(styles.objectFit, styles.objectPosition));
  }

  const svgDocument = elementToSVG(root, {
    keepLinks: false,
    captureArea: new DOMRect(0, 0, root.scrollWidth, root.scrollHeight),
  });
  const svg = svgDocument.documentElement;
  // Figma uses its own copies of fonts; embedded @font-face rules would only bloat the paste.
  for (const style of svg.querySelectorAll("style")) style.remove();

  // dom-to-svg's inlineResources() can't read the un-namespaced xlink:href it writes, so it fetched the page's own
  // HTML in place of each photo. Embed images here instead; only SVG images go through it, to become shapes.
  await Promise.all(
    [...svg.querySelectorAll("image")].map(async (image) => {
      const url = image.getAttribute("xlink:href");
      try {
        if (!url) throw new Error("no image URL");
        const blob = await (await fetch(url)).blob();
        if (blob.type === "image/svg+xml") {
          image.setAttribute("href", url); // the attribute inlineResources() can read
          image.removeAttribute("xlink:href");
          await inlineResources(image);
        } else if (blob.type.startsWith("image/")) {
          image.setAttribute("xlink:href", await toDataUrl(blob));
          image.setAttribute("preserveAspectRatio", fits.get(url) ?? "xMidYMid meet");
        } else {
          throw new Error(`not an image: ${blob.type}`);
        }
      } catch (error) {
        console.warn(`Copy for Figma left out an image (${url}):`, error);
        image.remove();
      }
    }),
  );

  for (const element of svg.querySelectorAll("[font-family]")) {
    element.setAttribute("font-family", firstFontFamily(element.getAttribute("font-family")!));
  }
  return new XMLSerializer().serializeToString(svgDocument);
}
