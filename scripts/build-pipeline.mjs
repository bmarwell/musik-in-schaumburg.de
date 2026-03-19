/**
 * Build Pipeline – musik-in-schaumburg.de
 * Licensed under EUPL v. 1.2
 *
 * Steps:
 *  1. Clean dist/
 *  2. Read orchestra YAML files
 *  3. Download images & logos (if remote URLs)
 *  4. Generate responsive WebP variants with sharp
 *  5. Render index.html from template (with JSON-LD)
 *  6. Render one orchestra page per YAML (with JSON-LD)
 *  7. Generate sitemap.xml
 *  8. Copy CSS, JS, LICENSE, robots.txt, and .htaccess
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

import fse from 'fs-extra';
import yaml from 'js-yaml';
import Mustache from 'mustache';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC_HTML = path.join(ROOT, 'src', 'main', 'html');
const SRC_CSS = path.join(ROOT, 'src', 'main', 'css');
const SRC_JS = path.join(ROOT, 'src', 'main', 'js');
const ORCHESTRAS_DIR = path.join(ROOT, 'orchestras');

const SITE_URL = 'https://musik-in-schaumburg.de';
const CURRENT_YEAR = new Date().getFullYear();

// Responsive image breakpoints for WebP variants
const IMAGE_WIDTHS = [400, 800, 1200];
// Logo size (single square crop)
const LOGO_SIZE = 128;

// Human-readable labels for orchestra types (German)
const TYPE_LABELS = {
  'brass-band': 'Brass Band',
  'symphony': 'Sinfonisches Blasorchester',
  'choir': 'Chor',
  'school-band': 'Schulkapelle',
  'chamber': 'Kammerorchester',
  'wind-ensemble': 'Bläserensemble',
  'other': 'Sonstiges',
};

// ── Utilities ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[build] ${msg}`);
}

/**
 * Download a remote URL to a local file path.
 * Returns true on success, false on failure.
 */
async function downloadFile(url, dest) {
  return new Promise((resolve) => {
    fse.ensureDirSync(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { timeout: 15000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow one redirect
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        console.warn(`[build] WARN: HTTP ${response.statusCode} for ${url}`);
        resolve(false);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      console.warn(`[build] WARN: Download failed for ${url}: ${err.message}`);
      resolve(false);
    });

    request.on('timeout', () => {
      request.destroy();
      file.close();
      fs.unlink(dest, () => {});
      console.warn(`[build] WARN: Download timed out for ${url}`);
      resolve(false);
    });
  });
}

/**
 * Generate responsive WebP variants of an image.
 * Returns an object with srcsetWebp, srcset, and fallback paths (relative to dist/).
 */
async function generateImageVariants(srcPath, outputDir, baseName) {
  fse.ensureDirSync(outputDir);

  const variants = [];

  for (const w of IMAGE_WIDTHS) {
    const webpName = `${baseName}-${w}w.webp`;
    const webpPath = path.join(outputDir, webpName);

    try {
      await sharp(srcPath)
        .resize(w, null, { withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(webpPath);
      variants.push({ w, webp: webpName });
    } catch (err) {
      console.warn(`[build] WARN: Could not create ${w}w variant: ${err.message}`);
    }
  }

  // Fallback JPEG/PNG (largest non-WebP variant)
  const fallbackName = `${baseName}-800w.jpg`;
  const fallbackPath = path.join(outputDir, fallbackName);
  try {
    await sharp(srcPath)
      .resize(800, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(fallbackPath);
  } catch (err) {
    console.warn(`[build] WARN: Could not create fallback image: ${err.message}`);
  }

  if (variants.length === 0) return null;

  const srcsetWebp = variants.map(v => `images/${v.webp} ${v.w}w`).join(', ');
  const srcset = `images/${fallbackName} 800w`;
  const fallback = `images/${fallbackName}`;

  return { srcsetWebp, srcset, fallback, hasSrcset: true };
}

/**
 * Process a logo: resize to square and convert to WebP.
 * Returns the relative path to the processed logo (relative to the orchestra page dir).
 */
async function generateLogoVariant(srcPath, outputDir, baseName) {
  fse.ensureDirSync(outputDir);
  const logoName = `${baseName}-logo.webp`;
  const logoPath = path.join(outputDir, logoName);
  try {
    await sharp(srcPath)
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toFile(logoPath);
    return `images/${logoName}`;
  } catch (err) {
    console.warn(`[build] WARN: Could not process logo: ${err.message}`);
    return null;
  }
}

// ── JSON-LD Builders ─────────────────────────────────────────────────────────

/**
 * Build JSON-LD for the landing page:
 * - WebSite schema
 * - ItemList of all orchestras (MusicGroup)
 */
function buildIndexJsonLd(orchestras) {
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    'name': 'Musik in Schaumburg',
    'description': 'Übersicht der Orchester, Blasorchester und Chöre im Landkreis Schaumburg, Niedersachsen.',
    'url': SITE_URL,
    'inLanguage': 'de',
    'maintainer': {
      '@type': 'Person',
      'name': 'Benjamin Marwell',
      'url': 'https://bmarwell.de',
    },
  };

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': 'Orchester im Landkreis Schaumburg',
    'description': 'Orchester, Blasorchester und Chöre im Landkreis Schaumburg.',
    'numberOfItems': orchestras.length,
    'itemListElement': orchestras.map((o, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'item': {
        '@type': 'MusicGroup',
        '@id': `${SITE_URL}/orchester/${o.slug}/`,
        'name': o.title,
        'url': o.website || `${SITE_URL}/orchester/${o.slug}/`,
        ...(o.location ? { 'location': { '@type': 'Place', 'name': o.location } } : {}),
        ...(o.description ? { 'description': o.description.trim() } : {}),
      },
    })),
  };

  return JSON.stringify([website, itemList], null, 2);
}

/**
 * Build JSON-LD for an individual orchestra page (MusicGroup).
 */
function buildOrchestraJsonLd(orchestra) {
  const sameAs = [];
  if (orchestra.social) {
    for (const url of Object.values(orchestra.social)) {
      if (url) sameAs.push(url);
    }
  }

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    '@id': `${SITE_URL}/orchester/${orchestra.slug}/`,
    'name': orchestra.title,
    'description': orchestra.description ? orchestra.description.trim() : undefined,
    'url': orchestra.website || `${SITE_URL}/orchester/${orchestra.slug}/`,
    'inLanguage': 'de',
    ...(orchestra.location ? {
      'location': {
        '@type': 'Place',
        'name': orchestra.location,
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': orchestra.location,
          'addressCountry': 'DE',
          'addressRegion': 'Niedersachsen',
        },
      },
    } : {}),
    ...(sameAs.length > 0 ? { 'sameAs': sameAs } : {}),
  };

  // Remove undefined values
  const clean = JSON.parse(JSON.stringify(schema));
  return JSON.stringify(clean, null, 2);
}

// ── Main Build ───────────────────────────────────────────────────────────────

async function build() {
  // 1. Clean dist/
  log('Cleaning dist/...');
  fse.removeSync(DIST);
  fse.ensureDirSync(DIST);

  // 2. Read orchestra YAML files
  log('Reading orchestra data...');
  const orchDirs = fs.readdirSync(ORCHESTRAS_DIR).filter(d =>
    fs.statSync(path.join(ORCHESTRAS_DIR, d)).isDirectory()
  );

  const orchestras = [];

  for (const dirName of orchDirs) {
    const yamlPath = path.join(ORCHESTRAS_DIR, dirName, 'index.yaml');
    if (!fs.existsSync(yamlPath)) {
      console.warn(`[build] WARN: No index.yaml in orchestras/${dirName}, skipping.`);
      continue;
    }
    const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    raw.slug = raw.slug || dirName;
    raw.typeLabel = TYPE_LABELS[raw.type] || raw.type || 'Orchester';
    orchestras.push(raw);
    log(`  Found: ${raw.title} (${raw.slug})`);
  }

  // Sort alphabetically by title
  orchestras.sort((a, b) => a.title.localeCompare(b.title, 'de'));

  // 3–4. Download images & generate variants for each orchestra
  for (const orch of orchestras) {
    const orchDistDir = path.join(DIST, 'orchester', orch.slug);
    const orchImgDir = path.join(orchDistDir, 'images');
    fse.ensureDirSync(orchImgDir);

    // --- Main image ---
    if (orch.image && orch.image.url) {
      const imgUrl = orch.image.url;
      const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
      const localImgPath = path.join(orchImgDir, `original${ext}`);

      log(`  Downloading image for ${orch.slug}...`);
      const ok = await downloadFile(imgUrl, localImgPath);

      if (ok) {
        const variants = await generateImageVariants(localImgPath, orchImgDir, 'photo');
        if (variants) {
          orch.image = { ...orch.image, ...variants };
        } else {
          // Fallback: just copy the original
          const fallbackName = `photo-original${ext}`;
          fse.copySync(localImgPath, path.join(orchImgDir, fallbackName));
          orch.image.fallback = `images/${fallbackName}`;
        }
        // Clean up original
        fs.unlinkSync(localImgPath);
      } else {
        log(`  WARN: Image not available for ${orch.slug}, skipping image.`);
        orch.image = null;
      }
    } else {
      orch.image = null;
    }

    // --- Logo ---
    if (orch.logo && orch.logo.url) {
      const logoUrl = orch.logo.url;
      const ext = path.extname(new URL(logoUrl).pathname) || '.png';
      const localLogoPath = path.join(orchImgDir, `logo-original${ext}`);

      log(`  Downloading logo for ${orch.slug}...`);
      const ok = await downloadFile(logoUrl, localLogoPath);

      if (ok) {
        const logoLocal = await generateLogoVariant(localLogoPath, orchImgDir, 'logo');
        orch.logo = { ...orch.logo, local: logoLocal };
        fs.unlinkSync(localLogoPath);
      } else {
        log(`  WARN: Logo not available for ${orch.slug}, skipping logo.`);
        orch.logo = null;
      }
    } else {
      orch.logo = null;
    }

    // --- Social helper flag for Mustache ---
    orch.hasSocial = orch.social && Object.values(orch.social).some(Boolean);
  }

  // 5. Render index.html
  log('Rendering index.html...');
  const indexTemplate = fs.readFileSync(path.join(SRC_HTML, 'index.html'), 'utf8');

  // Build card image paths relative to index (dist root)
  const orchestrasForIndex = orchestras.map(o => ({
    ...o,
    image: o.image
      ? {
          ...o.image,
          srcsetWebp: o.image.srcsetWebp
            ? o.image.srcsetWebp.split(', ').map(s => `orchester/${o.slug}/${s}`).join(', ')
            : null,
          srcset: o.image.srcset
            ? o.image.srcset.split(', ').map(s => `orchester/${o.slug}/${s}`).join(', ')
            : null,
          fallback: o.image.fallback ? `orchester/${o.slug}/${o.image.fallback}` : null,
        }
      : null,
    logo: o.logo
      ? { ...o.logo, local: o.logo.local ? `orchester/${o.slug}/${o.logo.local}` : null }
      : null,
  }));

  const indexView = {
    orchestras: orchestrasForIndex,
    year: CURRENT_YEAR,
    jsonld: buildIndexJsonLd(orchestras),
  };

  const indexHtml = Mustache.render(indexTemplate, indexView);
  fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml, 'utf8');

  // 6. Render each orchestra page
  log('Rendering orchestra pages...');
  const orchTemplate = fs.readFileSync(path.join(SRC_HTML, 'orchestra.html'), 'utf8');

  for (const orch of orchestras) {
    const view = {
      ...orch,
      year: CURRENT_YEAR,
      jsonld: buildOrchestraJsonLd(orch),
    };

    const orchHtml = Mustache.render(orchTemplate, view);
    const outPath = path.join(DIST, 'orchester', orch.slug, 'index.html');
    fse.ensureDirSync(path.dirname(outPath));
    fs.writeFileSync(outPath, orchHtml, 'utf8');
    log(`  Written: orchester/${orch.slug}/index.html`);
  }

  // 7. Generate sitemap.xml
  log('Generating sitemap.xml...');
  const today = new Date().toISOString().slice(0, 10);
  const sitemapUrls = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: '1.0', lastmod: today },
    ...orchestras.map(o => ({
      loc: `${SITE_URL}/orchester/${o.slug}/`,
      changefreq: 'monthly',
      priority: '0.8',
      lastmod: today,
    })),
  ];

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapUrls.map(u =>
      `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ),
    '</urlset>',
  ].join('\n');

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemapXml, 'utf8');

  // 8. Copy static assets
  log('Copying static assets...');
  fse.ensureDirSync(path.join(DIST, 'css'));
  fse.ensureDirSync(path.join(DIST, 'js'));
  fse.copySync(SRC_CSS, path.join(DIST, 'css'));
  fse.copySync(SRC_JS, path.join(DIST, 'js'));
  fse.copySync(path.join(ROOT, 'LICENSE'), path.join(DIST, 'LICENSE'));
  fse.copySync(path.join(ROOT, 'src', 'main', 'robots.txt'), path.join(DIST, 'robots.txt'));
  fse.copySync(path.join(ROOT, 'src', 'main', '.htaccess'), path.join(DIST, '.htaccess'));

  log('Build complete ✓');
  log(`Output: ${DIST}`);
}

build().catch(err => {
  console.error('[build] Fatal error:', err);
  process.exit(1);
});
