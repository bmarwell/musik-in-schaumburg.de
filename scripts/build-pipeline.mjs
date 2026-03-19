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
 *  9. Pre-compress text assets (.br, .gz, .zst)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { promisify } from 'util';

import fse from 'fs-extra';
import yaml from 'js-yaml';
import Mustache from 'mustache';
import sharp from 'sharp';
import { compress as zstdCompress } from '@mongodb-js/zstd';

const brotliCompress = promisify(zlib.brotliCompress);
const gzipCompress = promisify(zlib.gzip);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC_HTML = path.join(ROOT, 'src', 'main', 'html');
const SRC_CSS = path.join(ROOT, 'src', 'main', 'css');
const SRC_JS = path.join(ROOT, 'src', 'main', 'js');
const ORCHESTRAS_DIR = path.join(ROOT, 'orchestras');
const KEYWORDS_FILE = path.join(ROOT, 'src', 'main', 'keywords.yml');

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
  'posaunenchor': 'Posaunenchor',
  'big-band': 'Big Band',
  'strings-ensemble': 'Streichensemble',
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
    ...(orchestra.tags && orchestra.tags.length > 0 ? { 'keywords': orchestra.tags.join(', ') } : {}),
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
  let allowedKeywords = [];
  if (fs.existsSync(KEYWORDS_FILE)) {
    try {
      const kw = yaml.load(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
      if (Array.isArray(kw)) allowedKeywords = kw.map(k => String(k).trim()).filter(Boolean);
    } catch (e) {
      console.warn('[build] WARN: Could not read keywords.yml:', e.message);
    }
  }
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
    const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
    raw.slug = raw.slug || dirName;
    raw._dir = dirName;
    raw.typeLabel = TYPE_LABELS[raw.type] || raw.type || 'Musikgruppe';
    // Normalize tags/keywords: accept `tags` or `keywords` as array or comma-separated string
    let tags = raw.tags || raw.keywords || [];
    if (typeof tags === 'string') {
      tags = tags.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(tags)) tags = [];
    raw.tags = Array.from(new Set(tags.map(t => String(t).trim()).filter(Boolean)));
    if (allowedKeywords.length > 0) {
      const unknown = raw.tags.filter(t => !allowedKeywords.includes(t));
      if (unknown.length > 0) {
        console.warn(`[build] WARN: Unknown tags for ${raw.slug}: ${unknown.join(', ')}`);
      }
    }
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
    // Prefer local images: `image.local` (path relative to orchestras/<slug>/ or repo root).
    // Fall back to `image.url` for remote images.
    if (orch.image && (orch.image.local || orch.image.url)) {
      let imgReady = false;
      let localImgPath;
      let downloaded = false;

      if (orch.image.local) {
        // Try orch folder first
        const cand1 = path.join(ORCHESTRAS_DIR, orch._dir, orch.image.local);
        const cand2 = path.join(ROOT, orch.image.local);
        if (fs.existsSync(cand1)) {
          localImgPath = cand1;
        } else if (fs.existsSync(cand2)) {
          localImgPath = cand2;
        } else {
          console.warn(`[build] WARN: Local image not found for ${orch.slug}: ${orch.image.local}`);
        }
      }

      if (!localImgPath && orch.image.url) {
        const imgUrl = orch.image.url;
        const isRemote = imgUrl.startsWith('http://') || imgUrl.startsWith('https://');
        if (isRemote) {
          const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
          localImgPath = path.join(orchImgDir, `original${ext}`);
          log(`  Downloading image for ${orch.slug}...`);
          const ok = await downloadFile(imgUrl, localImgPath);
          if (!ok) {
            console.warn(`[build] WARN: Image not available for ${orch.slug}, skipping image.`);
            localImgPath = null;
          } else {
            downloaded = true;
          }
        }
      }

      if (localImgPath) {
        try {
          const variants = await generateImageVariants(localImgPath, orchImgDir, 'photo');
          if (variants) {
            // If the source file was external (not in orchImgDir), copy it into the orchestra images dir
            if (!String(localImgPath).startsWith(orchImgDir)) {
              const fallbackName = `photo-original${path.extname(localImgPath)}`;
              fse.copySync(localImgPath, path.join(orchImgDir, fallbackName));
              orch.image = { ...orch.image, ...variants, fallback: `images/${fallbackName}` };
            } else {
              orch.image = { ...orch.image, ...variants };
            }

            // Clean up downloaded temporary files
            if (downloaded && fs.existsSync(localImgPath)) {
              try { fs.unlinkSync(localImgPath); } catch (e) {}
            }

            imgReady = true;
          } else {
            // generateImageVariants returned null (no WebP variants), but may have written a JPEG fallback
            const jpegFallback = path.join(orchImgDir, 'photo-800w.jpg');
            if (fs.existsSync(jpegFallback)) {
              orch.image = { ...orch.image, fallback: 'images/photo-800w.jpg', hasSrcset: false };
              imgReady = true;
            }
            if (downloaded && fs.existsSync(localImgPath)) {
              try { fs.unlinkSync(localImgPath); } catch (e) {}
            }
          }
        } catch (e) {
          console.warn(`[build] WARN: Could not process image for ${orch.slug}: ${e.message}`);
          if (downloaded && fs.existsSync(localImgPath)) try { fs.unlinkSync(localImgPath); } catch (e) {}
        }
      }

      if (!imgReady) {
        orch.image = null;
      }
    } else {
      orch.image = null;
    }

    // --- Logo ---
    // Prefer local logos: `logo.local` (path relative to orchestras/<slug>/ or repo root).
    // Fall back to `logo.url` for remote logos.
    if (orch.logo && (orch.logo.local || orch.logo.url)) {
      let logoReady = false;
      let localLogoPath;
      let downloadedLogo = false;

      if (orch.logo.local) {
        const cand1 = path.join(ORCHESTRAS_DIR, orch._dir, orch.logo.local);
        const cand2 = path.join(ROOT, orch.logo.local);
        if (fs.existsSync(cand1)) {
          localLogoPath = cand1;
        } else if (fs.existsSync(cand2)) {
          localLogoPath = cand2;
        } else {
          console.warn(`[build] WARN: Local logo not found for ${orch.slug}: ${orch.logo.local}`);
        }
      }

      if (!localLogoPath && orch.logo.url) {
        const logoUrl = orch.logo.url;
        const isRemote = logoUrl.startsWith('http://') || logoUrl.startsWith('https://');
        if (isRemote) {
          const ext = path.extname(new URL(logoUrl).pathname) || '.png';
          localLogoPath = path.join(orchImgDir, `logo-original${ext}`);
          log(`  Downloading logo for ${orch.slug}...`);
          const ok = await downloadFile(logoUrl, localLogoPath);
          if (!ok) {
            console.warn(`[build] WARN: Logo not available for ${orch.slug}, skipping logo.`);
            localLogoPath = null;
          } else {
            downloadedLogo = true;
          }
        }
      }

      if (localLogoPath) {
        try {
          const logoLocal = await generateLogoVariant(localLogoPath, orchImgDir, 'logo');
          if (logoLocal) {
            if (!String(localLogoPath).startsWith(orchImgDir)) {
              // copy original into folder as fallback
              const fallbackName = `logo-original${path.extname(localLogoPath)}`;
              fse.copySync(localLogoPath, path.join(orchImgDir, fallbackName));
            }
            orch.logo = { ...orch.logo, local: logoLocal };
            logoReady = true;
          } else {
            console.warn(`[build] WARN: Logo variant generation returned null for ${orch.slug}.`);
          }

          if (downloadedLogo && fs.existsSync(localLogoPath)) {
            try { fs.unlinkSync(localLogoPath); } catch (e) {}
          }
        } catch (e) {
          console.warn(`[build] WARN: Could not process logo for ${orch.slug}: ${e.message}`);
          if (downloadedLogo && fs.existsSync(localLogoPath)) try { fs.unlinkSync(localLogoPath); } catch (e) {}
        }
      }

      if (!logoReady) orch.logo = null;
    } else {
      orch.logo = null;
    }

    // --- Social helper flag for Mustache ---
    orch.hasSocial = orch.social && Object.values(orch.social).some(Boolean);
  }

  // 5. Render index.html
  log('Rendering index.html...');
  const indexTemplate = fs.readFileSync(path.join(SRC_HTML, 'index.html'), 'utf8');
  const partials = {
    matomo: fs.readFileSync(path.join(SRC_HTML, 'partials', 'matomo.html'), 'utf8'),
  };

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
    tags: o.tags || null,
  }));

  const indexView = {
    orchestras: orchestrasForIndex,
    year: CURRENT_YEAR,
    jsonld: buildIndexJsonLd(orchestras),
    availableKeywords: allowedKeywords,
  };

  const indexHtml = Mustache.render(indexTemplate, indexView, partials);
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

    const orchHtml = Mustache.render(orchTemplate, view, partials);
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

build()
  .then(() => compressAssets())
  .catch(err => {
    console.error('[build] Fatal error:', err);
    process.exit(1);
  });

/**
 * Pre-compress all text-based assets in dist/ with Brotli, gzip, and zstd.
 * Skips binary files (images, fonts). Called after all assets are in place.
 */
async function compressAssets() {
  const COMPRESSIBLE_EXTS = ['.html', '.css', '.js', '.xml', '.txt', '.svg'];

  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        files.push(...walkDir(full));
      } else if (COMPRESSIBLE_EXTS.includes(path.extname(e.name))) {
        files.push(full);
      }
    }
    return files;
  }

  const files = walkDir(DIST);
  log(`Pre-compressing ${files.length} text assets...`);

  await Promise.all(files.map(async (file) => {
    const content = fs.readFileSync(file);

    await Promise.all([
      brotliCompress(content, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY },
      }).then(buf => fs.writeFileSync(`${file}.br`, buf)),

      gzipCompress(content, { level: zlib.constants.Z_BEST_COMPRESSION })
        .then(buf => fs.writeFileSync(`${file}.gz`, buf)),

      zstdCompress(content, 19)
        .then(buf => fs.writeFileSync(`${file}.zst`, buf)),
    ]);
  }));

  log(`Pre-compression complete ✓ (${files.length} files × 3 encodings)`);
}
