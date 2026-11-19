/** Converts the rendered page to SVG that Figma imports as layers: text stays text, images are embedded. */

/** Figma matches fonts by one family name, so keep the first of a CSS stack ("Inter, Inter Fallback"). */
export const firstFontFamily = (stack: string) => stack.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

interface Size {
  width: number;
  height: number;
}

/**
 * Where an image of `natural` size is drawn inside its `box`, per its computed object-fit and object-position.
 * The result may overflow the box (cover, none); drawing it on a box-sized canvas crops it like the browser does.
 */
export function placeImage(objectFit: string, objectPosition: string, natural: Size, box: Size) {
  let { width, height } = box;
  if (objectFit !== "fill") {
    const fit = Math.min(box.width / natural.width, box.height / natural.height);
    const scale =
      objectFit === "cover"
        ? Math.max(box.width / natural.width, box.height / natural.height)
        : objectFit === "none"
          ? 1
          : objectFit === "scale-down"
            ? Math.min(fit, 1)
            : fit;
    width = natural.width * scale;
    height = natural.height * scale;
  }
  const [x = "50%", y = "50%"] = objectPosition.trim().split(/\s+/);
  // A percentage places that point of the image on the same point of the box; a length is an offset from the edge.
  const offset = (value: string, free: number) => (value.endsWith("%") ? (parseFloat(value) / 100) * free : parseFloat(value) || 0) + 0; // no -0
  return { x: offset(x, box.width - width), y: offset(y, box.height - height), width, height };
}

/** Pixels per CSS pixel in embedded images, so photos stay sharp when the design is viewed or exported at 2×. */
const SCALE = 2;

/** The smallest srcset candidate at least `width` pixels wide (else the largest), or null without w descriptors. */
function sourceFor(image: HTMLImageElement, width: number): string | null {
  const candidates = image.srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/))
    .filter(([url, descriptor]) => url && descriptor?.endsWith("w"))
    .map(([url, descriptor]) => ({ url: new URL(url!, document.baseURI).href, width: parseInt(descriptor!, 10) }))
    .sort((a, b) => a.width - b.width);
  return (candidates.find((candidate) => candidate.width >= width) ?? candidates.at(-1))?.url ?? null;
}

/**
 * The image as it looks on the page: cropped and scaled to its box, so Figma, which ignores preserveAspectRatio and
 * stretches every image to its frame, gets one already in the frame's shape. Throws if the image can't be read.
 */
async function croppedImage(image: HTMLImageElement, box: Size): Promise<string> {
  const styles = getComputedStyle(image);
  const placed = placeImage(styles.objectFit, styles.objectPosition, { width: image.naturalWidth, height: image.naturalHeight }, box);

  let source = image;
  const larger = image.naturalWidth < placed.width * SCALE ? sourceFor(image, placed.width * SCALE) : null;
  if (larger && larger !== image.currentSrc) {
    const candidate = new Image();
    candidate.src = larger;
    await candidate.decode().then(() => (source = candidate), () => undefined);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width * SCALE);
  canvas.height = Math.round(box.height * SCALE);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.scale(SCALE, SCALE);
  context.drawImage(source, placed.x, placed.y, placed.width, placed.height);

  // JPEG keeps photos small, but only when nothing in the box is left transparent.
  const opaque = /\.jpe?g\b/i.test(decodeURIComponent(image.currentSrc)) && (styles.objectFit === "cover" || styles.objectFit === "fill");
  return opaque ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
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

  // dom-to-svg points each <image> at the <img>'s currentSrc; keep the elements to crop from.
  const images = new Map<string, HTMLImageElement>();
  for (const image of document.images) {
    const url = image.currentSrc || image.src;
    if (!images.has(url)) images.set(url, image);
  }

  const svgDocument = elementToSVG(root, {
    keepLinks: false,
    captureArea: new DOMRect(0, 0, root.scrollWidth, root.scrollHeight),
  });
  const svg = svgDocument.documentElement;
  // Figma uses its own copies of fonts; embedded @font-face rules would only bloat the paste.
  for (const style of svg.querySelectorAll("style")) style.remove();

  // dom-to-svg's inlineResources() can't read the un-namespaced xlink:href it writes, so photos stayed links that
  // Figma can't load. Embed images here instead; only SVG images go through it, to become shapes.
  await Promise.all(
    [...svg.querySelectorAll("image")].map(async (element) => {
      const url = element.getAttribute("xlink:href");
      const box = { width: Number(element.getAttribute("width")), height: Number(element.getAttribute("height")) };
      try {
        if (!url) throw new Error("no image URL");
        if (!(box.width > 0 && box.height > 0)) throw new Error("no size");
        const image = images.get(url);
        if (image && !/\.svg\b/i.test(decodeURIComponent(url))) {
          try {
            element.setAttribute("xlink:href", await croppedImage(image, box));
            element.setAttribute("preserveAspectRatio", "none");
            return;
          } catch {
            // Another site's image without CORS taints the canvas; embed the file as it is below.
          }
        }
        const blob = await (await fetch(url)).blob();
        if (blob.type === "image/svg+xml") {
          element.setAttribute("href", url); // the attribute inlineResources() can read
          element.removeAttribute("xlink:href");
          await inlineResources(element);
        } else if (blob.type.startsWith("image/")) {
          element.setAttribute("xlink:href", await toDataUrl(blob));
        } else {
          throw new Error(`not an image: ${blob.type}`);
        }
      } catch (error) {
        console.warn(`Copy for Figma left out an image (${url}):`, error);
        element.remove();
      }
    }),
  );

  for (const element of svg.querySelectorAll("[font-family]")) {
    element.setAttribute("font-family", firstFontFamily(element.getAttribute("font-family")!));
  }
  return new XMLSerializer().serializeToString(svgDocument);
}
