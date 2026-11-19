/** Converts the rendered page to SVG that Figma imports as layers: text stays text, images are embedded. */

/** Figma matches fonts by one family name, so keep the first of a CSS stack ("Inter, Inter Fallback"). */
export const firstFontFamily = (stack: string) => stack.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

export async function pageToSvg(): Promise<string> {
  const { elementToSVG, inlineResources } = await import("dom-to-svg");
  const root = document.documentElement;
  const svgDocument = elementToSVG(root, {
    keepLinks: false,
    captureArea: new DOMRect(0, 0, root.scrollWidth, root.scrollHeight),
  });
  const svg = svgDocument.documentElement;
  // Figma uses its own copies of fonts; embedded @font-face rules would only bloat the paste.
  for (const style of svg.querySelectorAll("style")) style.remove();
  await inlineResources(svg);
  for (const element of svg.querySelectorAll("[font-family]")) {
    element.setAttribute("font-family", firstFontFamily(element.getAttribute("font-family")!));
  }
  return new XMLSerializer().serializeToString(svgDocument);
}
