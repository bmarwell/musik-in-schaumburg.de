# Copilot Instructions – musik-in-schaumburg.de

## Project Overview

This is a static website listing orchestras, brass bands, choirs and other music groups
in the **Landkreis Schaumburg**, Niedersachsen, Germany.

- **Language**: All user-facing content is in **German**. Site name: **„Musik in Schaumburg"**.
- **Maintainer**: Benjamin Marwell — [bmarwell.de](https://bmarwell.de)
- **Licence**: EUPL v. 1.2

---

## Technology Stack

| Layer       | Choice                                              |
|-------------|-----------------------------------------------------|
| Build tool  | Node.js (`scripts/build-pipeline.mjs`, ES modules) |
| Templates   | [Mustache](https://github.com/janl/mustache.js)     |
| Images      | [sharp](https://sharp.pixelplumbing.com/)           |
| Data format | YAML (`orchestras/<slug>/index.yaml`)               |
| CSS         | Vanilla CSS (no framework)                          |
| JS          | Vanilla JS — only the lightbox script               |

No framework, no SSG binary. The build runs with plain `node` and npm dependencies.

---

## Directory Structure

```
musik-in-schaumburg.de/
├── orchestras/                  # One directory per orchestra
│   └── <slug>/
│       └── index.yaml           # Orchestra metadata (see schema below)
├── src/main/
│   ├── html/
│   │   ├── index.html           # Homepage Mustache template
│   │   └── orchestra.html       # Orchestra detail page Mustache template
│   ├── css/
│   │   └── main.css             # Single stylesheet
│   └── js/
│       └── lightbox.js          # Lightbox for hero images
├── scripts/
│   └── build-pipeline.mjs      # Main build script (Node.js ES module)
├── dist/                        # Build output (git-ignored)
├── package.json
├── README.adoc
├── LICENSE                      # EUPL v. 1.2
└── .github/
    └── copilot-instructions.md  # This file
```

---

## YAML Schema (`orchestras/<slug>/index.yaml`)

```yaml
title: "Name des Orchesters"        # Required. Full name.
type: brass-band                    # Required. See type list below.
slug: mein-orchester                # Required. URL-safe identifier (used as path).

logo:
  url: "https://..."               # Remote URL or local path (relative to repo root)

image:
  url: "https://..."               # Main photo. Will be converted to multiple WebP sizes.

description: >                     # Required. German text. Plain prose, no HTML.
  Kurzbeschreibung …

location: "Stadthagen"             # Optional. City or region for rehearsals / base.
website: "https://..."             # Optional. Official website URL.

social:                            # Optional. All sub-keys optional.
  facebook: "https://..."
  instagram: "https://..."
  youtube: "https://..."
  twitter: "https://..."
```

### Supported `type` values

| Value           | German label                  |
|-----------------|-------------------------------|
| `brass-band`    | Brass Band                    |
| `symphony`      | Sinfonisches Blasorchester     |
| `choir`         | Chor                          |
| `school-band`   | Schulkapelle                  |
| `chamber`       | Kammerorchester               |
| `wind-ensemble` | Bläserensemble                |
| `other`         | Sonstiges                     |

---

## Build Pipeline (`scripts/build-pipeline.mjs`)

Run with:

```bash
npm install
npm run build
```

**Steps performed:**
1. Clean `dist/`
2. Read all `orchestras/*/index.yaml` files
3. Download remote images & logos (with redirect and timeout handling)
4. Generate responsive WebP variants at 400 px, 800 px, 1200 px using `sharp`
5. Generate JPEG fallback at 800 px for browsers without WebP support
6. Render `dist/index.html` from `src/main/html/index.html` (Mustache)
7. Render `dist/orchester/<slug>/index.html` for each orchestra
8. Copy CSS, JS, LICENSE to `dist/`

Image paths inside the generated HTML are always **relative** (no hardcoded domain).

---

## JSON-LD Metadata

Both page types carry structured data (`<script type="application/ld+json">`):

- **index.html**: `WebSite` + `ItemList` (one `MusicGroup` per orchestra)
- **orchestra page**: `MusicGroup` with optional `location`, `url`, `sameAs` (social links)

The JSON-LD is built by `buildIndexJsonLd()` and `buildOrchestraJsonLd()` in the build
script and injected via the `{{{jsonld}}}` Mustache triple-stash (unescaped).

---

## Responsive Images & Picture Element

Every orchestra image is converted to three WebP sizes (400 w, 800 w, 1200 w) and a JPEG
fallback. The templates use the HTML `<picture>` element:

```html
<picture>
  <source type="image/webp" srcset="…400w.webp 400w, …800w.webp 800w, …1200w.webp 1200w">
  <img src="…800w.jpg" alt="…" width="800" height="450" loading="lazy">
</picture>
```

---

## Lightbox

`src/main/js/lightbox.js` is a small, dependency-free lightbox.
Any `<img>` or element with `data-lightbox` attribute triggers it on click.
Use `data-lightbox-src` to specify the full-resolution URL.

---

## Adding a New Orchestra

1. Create `orchestras/<slug>/index.yaml` (use the schema above).
2. Run `npm run build`.
3. The orchestra card appears on the homepage and its detail page is generated automatically.

---

## Language & Content Rules

- **All UI text must be in German.**
- Orchestra descriptions should be German prose.
- Type labels are defined in `TYPE_LABELS` in `scripts/build-pipeline.mjs` — add new
  types there as needed (German label required).

---

## Deployment

The `dist/` directory is the deployable artifact. Serve it as a static site
(Apache, Nginx, GitHub Pages, Netlify, etc.).

Optionally add `.htaccess` for pre-compressed Brotli/gzip serving (see jug-h.de reference).
