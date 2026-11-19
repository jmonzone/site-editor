# @jmonzone/site-editor

A visual editor for my Next.js sites. On `/edit` you see the real site and can click anything to select it,
type into text, add, delete, duplicate and reorder sections and list items, swap images, and change links.
**Publish** commits the content file to GitHub and Vercel redeploys. Git stays the only copy of the content.

> **This repo is public.** It holds no site content, keys or client details. Those live in each site's repo and
> Vercel settings.

## How it works

- A site's content is one JSON file. Each page is an ordered list of blocks (`{ id, type, data }`), plus shared
  site fields such as name, contact details and menu.
- The site describes its fields once with `defineSite`. The editor builds its forms from that, and the site gets
  its TypeScript types from it.
- Each block type is rendered by one of the site's own components. They stay plain components. The only editor
  hook is `data-se-*` attributes from `field()`, `item()` and `textItem()`, which do nothing on the live site.
- `/edit` loads the site in an iframe (`/edit/canvas`), so the phone and tablet previews use the site's real
  media queries.
- Drafts stay in the browser, with a localStorage backup, until Publish. Publish sends the content plus any
  uploads, and the server commits them in one commit. It refuses when the file changed since the editor
  loaded it, so nobody silently overwrites anyone.
- Under `next dev` there's no sign-in, and Save writes `content.json` in the working tree.

## Add it to a site

```jsonc
// package.json: pin a tag
"@jmonzone/site-editor": "github:jmonzone/site-editor#v0.1.0"
```

1. **Schema**, e.g. `lib/schema.ts`:

   ```ts
   import { block, defineSite, f, type BlockProps } from "@jmonzone/site-editor";

   export const schema = defineSite({
     name: "Ada Lovelace",
     site: { name: f.text({ label: "Name" }), email: f.text({ label: "Email" }) },
     blocks: {
       papers: block({
         label: "Papers",
         labelField: "heading",
         fields: {
           heading: f.text({ default: "Papers" }),
           items: f.list(f.object({ title: f.text(), url: f.url() }), { itemLabel: "Paper", labelField: "title" }),
         },
       }),
     },
     pages: { home: { label: "Home", path: "/" } },
   });
   export type PapersProps = BlockProps<typeof schema, "papers">;
   ```

   Fields: `text`, `textarea`, `url` (with `accept` it gets an Upload button), `select`, `boolean`, `image`
   (`{ src, alt }`, with alt text prompted), `list`, `object`.

   **Removable parts:** wrap a field in `f.optional()` and editors can take it off the page and add it back,
   instead of only emptying it. A removed part is stored as `null`, and its type includes `null`. Wrap an
   `object` to remove several fields together, such as a badge's colour and text:

   ```ts
   badge: f.optional(f.object({ status: f.select(["Ongoing", "Published"]), label: f.text({ default: "Ongoing" }) }, { label: "Badge" })),
   doi: f.optional(f.text({ label: "DOI" })),
   ```

   In the editor:
   - **To remove a part:** click it inside the selected item, then press **Remove** in the toolbar (or press
     Delete). The side panel also has a remove button on each removable field.
   - **To add it back:** use the toolbar's **Add** menu, which lists what the selection is missing, or the
     "+ Badge" buttons in the panel. A part comes back with its field's default values.

   Emptying an optional text on the page also removes it. A key missing from the file still gets the
   default, so an optional field a site adds later shows up rather than starting out removed.

2. **Components** take `{ id, data, site }` and mark what's editable:

   ```tsx
   <h2 {...field("heading")}>{data.heading}</h2>
   {data.items.map((paper, i) => (
     <article key={i} {...item("items", i)}>
       <h3 {...field("title")}>{paper.title}</h3>
     </article>
   ))}
   <a {...field("site:email")}>{site.email}</a>
   ```

   Put `field()` only on elements whose sole child is the text. Use index keys in lists: items can repeat.
   Render nothing for a removed part (`{paper.badge && …}`). To outline a removable part as a whole, mark its
   box too, e.g. `<span {...field("badge")}>…<span {...field("badge.label")}>…</span></span>`.

3. **Content**: `content.json`, loaded with `parseContent(schema, raw)` and rendered with
   `renderBlocks(blocks, content.pages.home.blocks, content.site)` inside the site's layout.

4. **Routes**:

   ```tsx
   // app/edit/layout.tsx: import "@jmonzone/site-editor/editor.css" and set robots noindex
   // app/edit/page.tsx
   export default createEditorPage(schema);
   // app/edit/canvas/page.tsx ("use client")
   export default () => <EditorCanvas site={schema} components={blocks} layout={SiteLayout} />;
   // app/api/edit/[...action]/route.ts
   const routes = createEditorRoutes(schema);
   export const GET = routes.GET;
   export const POST = routes.POST;
   ```

   `santiago-cardenas` is the reference site.

## Settings (Vercel environment variables)

| Variable | |
|---|---|
| `EDITOR_SECRET` | 32+ random characters (`openssl rand -base64 32`). Signs sign-in links and sessions. |
| `EDITOR_EMAILS` | Comma-separated emails that can sign in. Removing one ends that person's session. |
| `EDITOR_GITHUB_TOKEN` | Fine-grained token for the site's repo only, with **Contents: read and write**. |
| `EDITOR_GITHUB_REPO` | `owner/name`. Optional on Vercel, which provides it through its Git integration. |
| `EDITOR_GITHUB_BRANCH` | Defaults to `main`. |
| `RESEND_API_KEY`, `EDITOR_EMAIL_FROM` | Sends sign-in links. The from address must be on a domain verified in Resend. |
| `NEXT_PUBLIC_SITE_URL` or `EDITOR_SITE_URL` | Base URL for sign-in links. Falls back to Vercel's production URL. |
| `EDITOR_REQUIRE_LOGIN=1` | Tries the sign-in flow under `next dev`. The link prints to the terminal. |

`/edit` lists anything missing. Commits come from the token's owner and name the editor who published in the
message, so Vercel's commit-author checks pass.

## Copy for Figma (local only)

Under `next dev`, the top bar has **Copy for Figma**. It captures the whole page, as the draft stands, at a
fixed width for the previewed device, whatever the window size: **1440px** for Desktop (Figma's Desktop
frame), **820px** for Tablet and **390px** for Phone. Switch the preview's device to change it.

- **As an image**: a full-page PNG at 2×. Paste it into Figma and scale it to 50%.
- **As editable layers**: SVG copied as text, which Figma turns into layers with real text (Inter, Source Serif
  4…) and vector shapes. Fonts, shadows and blur come out approximate.

A headless Chromium renders `/edit/canvas?capture` with the draft. PNGs come from Playwright's full-page
screenshot and SVG from [dom-to-svg](https://github.com/sourcegraph/dom-to-svg). The site needs
`playwright-core` as a dev dependency, pinned to a version whose Chromium is installed (`npx playwright install
chromium` otherwise). If the browser refuses the clipboard, the file downloads instead.

## Limits

- Uploads are images (resized to 2000px and re-encoded as WebP in the browser) or PDFs, each under 3 MB. SVG is
  refused because it can carry script.
- Sign-in links last 20 minutes and sessions 30 days.

## Develop

```sh
npm install
npm test            # schema, content edits, markers, reducer, tokens, GitHub commits, routes
npm run typecheck
npm version patch   # typecheck, test, build, tag and push
```

To try changes in a site before tagging: `npm install ../site-editor --install-links` there (a copy, not a
symlink, which Turbopack won't follow). Reinstall after each build.
