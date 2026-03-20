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
| Runtime     | [Bun](https://bun.sh/) (`bun run build`)            |
| Build tool  | `scripts/build-pipeline.mjs` (Bun/Node ES module)  |
| Templates   | [Mustache](https://github.com/janl/mustache.js)     |
| Images      | [sharp](https://sharp.pixelplumbing.com/)           |
| Data format | YAML (`ensembles/<slug>/index.yaml`)               |
| CSS         | Vanilla CSS (no framework)                          |
| JS          | Vanilla JS — only the lightbox script               |

No framework, no SSG binary. The build runs with `bun` and its lockfile (`bun.lock`).

---

## Directory Structure

```
musik-in-schaumburg.de/
├── ensembles/                  # One directory per ensemble
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
│   └── build-pipeline.mjs      # Main build script (Bun/Node ES module)
├── dist/                        # Build output (git-ignored)
├── bun.lock
├── package.json
├── README.adoc
├── LICENSE                      # EUPL v. 1.2
└── .github/
    ├── copilot-instructions.md  # This file
    └── ISSUE_TEMPLATE/
        ├── bug_report.md        # Bug report template
        ├── feature_request.md   # Feature request template
        └── new_entry.md         # New orchestra/band/choir entry template
```

---

## YAML Schema (`ensembles/<slug>/index.yaml`)

```yaml
title: "Name des Ensembles"         # Required. Full name.
type: brass-band                    # Required. See type list below.
slug: mein-ensemble                 # Required. URL-safe identifier (used as path).

founded: 1975                       # Optional. Founding year (integer).
active: true                        # Optional. Set to false for inactive/dissolved ensembles.
member_count: 40                    # Optional. Approximate number of active members.

conductors:                         # Optional. List of conductors/directors.
  - name: "Max Mustermann"
    role: "Dirigent"                # Optional role label (Dirigent, Jugenddirigent, etc.)

logo:
  local: "logo.png"                 # PREFERRED. Filename relative to ensembles/<slug>/.
  # url: "https://..."             # Fallback only if no local file available. Warn if missing.

image:
  local: "photo.jpg"               # PREFERRED. Filename relative to ensembles/<slug>/.
  # url: "https://..."             # Fallback only if no local file available. Warn if missing.

description: >                     # Required. German text. Plain prose, no HTML.
  Kurzbeschreibung …

address:                           # Optional. Structured location/address.
  name: "Probenraum XY"            # Venue name (optional).
  street: "Musterstraße 1"         # Street address (optional).
  postcode: "31655"
  city: "Stadthagen"
  maps: "https://maps.app.goo.gl/…" # Google Maps short link (optional).

location: "Stadthagen"             # Optional. Simple city fallback if no address block.
website: "https://..."             # Optional. Official website URL.

rehearsal:                         # Optional. Regular rehearsal info.
  day: "Donnerstag"                # Weekday in German.
  time: "19:30"                    # Start time (HH:MM, optional).
  location: "Probenraum XY"        # Location name (optional).

contact:                           # Optional. Public contact info only.
  email: "info@example.de"
  phone: "+49 5722 …"              # Only if publicly listed.

social:                            # Optional. All sub-keys optional.
  facebook: "https://..."
  instagram: "https://..."
  youtube: "https://..."
  twitter: "https://..."
```

### Asset handling rules (IMPORTANT for Copilot)

**Always prefer `image.local` and `logo.local` over `image.url`/`logo.url`.**

When creating or updating an ensemble entry:
1. **Download** any image or logo from the provided URL into `ensembles/<slug>/` (e.g. `photo.jpg`, `logo.png`) and **commit the file** alongside the YAML.
2. Set `image.local: "photo.jpg"` (or the actual filename) in the YAML — **not** `image.url`.
3. Only use `image.url` / `logo.url` if downloading is impossible (e.g. blocked by firewall). In that case add a comment explaining why.
4. `logo` and `image` are both **optional** — omit the key entirely if no asset is available.
5. Warn in the PR description if a remote asset URL could not be fetched.

### Supported `type` values

| Value             | German label                        |
|-------------------|-------------------------------------|
| `brass-band`      | Brass Band                          |
| `symphony`        | Sinfonisches Blasorchester          |
| `symphony-orchestra` | Sinfonieorchester                |
| `choir`           | Chor                                |
| `posaunenchor`    | Posaunenchor                        |
| `big-band`        | Big Band                            |
| `school-band`     | Schulkapelle / Schülerorchester     |
| `chamber`         | Kammerorchester / Kammerensemble    |
| `wind-ensemble`   | Bläserensemble                      |
| `strings-ensemble`| Streichensemble                     |
| `band`            | Band                                |
| `other`           | Sonstiges                           |

---

## Build Pipeline (`scripts/build-pipeline.mjs`)

Run with:

```bash
bun install
bun run build
```

Preview the built site locally:

```bash
bun run preview
```

**Steps performed:**
1. Clean `dist/`
2. Read all `ensembles/*/index.yaml` files
3. Download remote images & logos (with redirect and timeout handling)
4. Generate responsive WebP variants at 400 px, 800 px, 1200 px using `sharp`
5. Generate JPEG fallback at 800 px for browsers without WebP support
6. Render `dist/index.html` from `src/main/html/index.html` (Mustache)
7. Render `dist/ensemble/<slug>/index.html` for each ensemble
8. Generate `dist/sitemap.xml` (all pages with `lastmod`, `changefreq`, `priority`)
9. Copy CSS, JS, LICENSE, `robots.txt`, and `.htaccess` to `dist/`
10. Pre-compress every text asset (`.html`, `.css`, `.js`, `.xml`, `.txt`, `.svg`) into
    `.br` (Brotli q11), `.gz` (gzip level 9), and `.zst` (zstd level 19) variants

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

## Adding a New Ensemble

1. Create the directory `ensembles/<slug>/`.
2. **Download** any image or logo into `ensembles/<slug>/` (e.g. `photo.jpg`, `logo.png`) and commit the files.
3. Create `ensembles/<slug>/index.yaml` using the schema above, with `image.local` / `logo.local` pointing to the committed files.
4. Run `bun run build`.
5. The ensemble card appears on the homepage and its detail page is generated automatically.

> **Never** use `image.url` / `logo.url` when a local file can be committed. Only fall back to URLs when downloading is impossible (e.g. firewall-blocked CI), and document the reason in the PR.

---

## Reviewing New Entries

These rules apply when reviewing PRs that add or update ensemble entries.

### Fact-checking (highest priority)

Fact-checking is the **most important** review step. Every claim in `index.yaml` must be
verifiable from at least one authoritative source (official website, archived snapshot,
reputable local press).

- **Cross-check all facts**: founding year, conductor/leader name, member count, location,
  awards, and any specific claims in the description.
- Use the Wayback Machine (`web.archive.org`) if the live website is unavailable.
- Search local press (Schaumburger Nachrichten, Schaumburger Wochenblatt, szlz.de) to
  corroborate claims that cannot be verified from the ensemble's own site.
- If a fact cannot be verified, either omit it or flag it explicitly in the review comment.
- If a fact is verifiably wrong, request a correction and cite the source.

### Spam and plausibility checks

Flag an entry as **suspicious** (add a review comment and request changes) if any of the
following are true:

- The ensemble has no verifiable web presence (no archived snapshot, no press coverage,
  no social media, no official directory entry).
- The description reads like marketing copy or SEO text with no concrete local facts.
- The founding year, member count, or award claims are implausibly specific but
  unverifiable.
- The slug, title, or description does not match an ensemble that is plausibly located in
  **Landkreis Schaumburg** (check postcode/city against the Landkreis boundary).
- Contact details or links point to unrelated businesses or generic parking pages.

### Image / asset quality

Check every committed image file:

| Asset | Minimum size | Maximum size | Notes |
|-------|-------------|-------------|-------|
| Logo (`logo.*`) | 5 KB | 500 KB | Must be readable at small display sizes |
| Photo (`photo.*`) | 20 KB | 5 MB | Used as hero image; must show the ensemble, not a stock photo |

- **Too small** (below minimum): likely a thumbnail, placeholder, or corrupt file — request
  a higher-resolution asset.
- **Too large** (above maximum): should be flagged; the build pipeline resizes images, but
  committing very large originals bloats the repository unnecessarily.
- Verify the file is actually the correct format (`file photo.jpg` must report a valid JPEG/PNG/WebP).
- Logo and photo must clearly depict the named ensemble, not a generic image or stock photo.
- Prefer files with a meaningful aspect ratio: logos should be roughly square or
  landscape; photos ideally 4:3 or 16:9.

---

## Language & Content Rules

- **All UI text must be in German.**
- Ensemble descriptions should be German prose.
- Use the generic term **Ensemble** or **Musikgruppe** — not "Orchester" — in UI text and descriptions, since the site covers choirs, brass bands, Posaunenchöre, big bands, etc.
- Type labels are defined in `TYPE_LABELS` in `scripts/build-pipeline.mjs` — add new
  types there as needed (German label required).
- **Quotation marks**: Always use »guillemets« (`»text«`) for quoted names and terms in
  `title` and `description` fields. Do **not** use `"…"`, `„…"`, or `'…'` for quotation
  purposes. Example: `»Liederkranz«`, `»The Attic«`.

---

## Coding Guidelines

These rules apply to **all code changes and code reviews** in this repository.

### Const-first and immutable style

Use `const` as the **default for every declaration**. Only use `let` when reassignment is genuinely necessary. If you reach for `let`, first ask whether the code can be restructured so a `const` suffices.

Prefer deriving new values over mutating existing ones:
- Use spread (`{ ...obj, key: value }`) to produce updated objects rather than assigning into them.
- Prefer the non-mutating ES2023 array methods over their mutating equivalents:
  `toSorted()` · `toReversed()` · `toSpliced()` · `with(index, value)`
- Extract pure functions that **return** computed values instead of receiving an object and writing into it.

`Object.freeze()` (the JS equivalent of TypeScript's `as const`) is useful for top-level constant maps and config tuples (e.g. `TYPE_LABELS`). Avoid it for intermediate objects produced during processing — the overhead and verbosity are not worth it there.

---

### Avoid `else`

Avoid `else` at almost all costs.
Prefer guard clauses, early returns, and `continue` statements to flatten control flow.
If avoiding `else` makes a block too large, extract the logic into a well-named function.

```js
// Bad
if (condition) {
  doSomething();
} else {
  doOther();
}

// Good
if (condition) {
  doSomething();
  return;
}
doOther();
```

### Comments as function names

Before writing a comment, ask yourself: _could this comment be the name of a function?_
If yes, extract the block into a function with that name and remove the comment.

```js
// Bad
// Build conductor list
const conductorItems = conductors.map(...);

// Good
function buildJsonLdConductors(conductors) { ... }
const conductorItems = buildJsonLdConductors(conductors);
```

### Maximum indentation: 4 levels

Code must not exceed **4 levels of indentation**.
Extract deeply nested blocks into separate, named functions.

---

## Deployment

The `dist/` directory is the deployable artifact. Deploy it to an Apache server.
The included `.htaccess` handles HTTPS redirects, www → non-www canonicalisation,
pre-compressed asset serving (zstd > brotli > gzip with on-the-fly fallback),
caching headers, and security headers.

## Pre-compression

Every text-based asset in `dist/` gets three pre-compressed siblings generated at build time:

| Extension | Algorithm | Setting |
|-----------|-----------|---------|
| `.br`     | Brotli    | quality 11 (max) via Node.js `zlib.brotliCompress` |
| `.gz`     | gzip      | level 9 (max) via Node.js `zlib.gzip` |
| `.zst`    | zstd      | level 19 via `@mongodb-js/zstd` |

The `.htaccess` serves pre-compressed files when the client advertises support in
`Accept-Encoding`, in priority order zstd > brotli > gzip. If no pre-compressed file
exists, Apache falls back to on-the-fly compression via `mod_brotli` / `mod_deflate`.
