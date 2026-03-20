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
const SRC_IMG = path.join(ROOT, 'src', 'main', 'img');
const ORCHESTRAS_DIR = path.join(ROOT, 'ensembles');
const KEYWORDS_FILE = path.join(ROOT, 'src', 'main', 'keywords.yml');
const LEAFLET_DIST = path.join(ROOT, 'node_modules', 'leaflet', 'dist');

const SITE_URL = 'https://musik-in-schaumburg.de';
const CURRENT_YEAR = new Date().getFullYear();

const IMAGE_WIDTHS = [400, 800, 1200];
const LOGO_SIZE = 128;

const TYPE_LABELS = {
  'blaskapelle': 'Blaskapelle',
  'brass-band': 'Brass Band',
  'symphony': 'Sinfonisches Blasorchester',
  'symphony-orchestra': 'Sinfonieorchester',
  'choir': 'Chor',
  'school-band': 'Schulkapelle',
  'chamber': 'Kammerorchester',
  'wind-ensemble': 'Bläserensemble',
  'posaunenchor': 'Posaunenchor',
  'big-band': 'Big Band',
  'strings-ensemble': 'Streichensemble',
  'band': 'Band',
  'other': 'Sonstiges',
};

// ── Utilities ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[build] ${msg}`);
}

async function downloadFile(url, dest) {
  return new Promise((resolve) => {
    fse.ensureDirSync(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { timeout: 15000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
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

function resolveLocalAssetPath(localFilename, ensembleDir, rootDir) {
  const inEnsembleDir = path.join(ensembleDir, localFilename);
  if (fs.existsSync(inEnsembleDir)) return inEnsembleDir;
  const inRootDir = path.join(rootDir, localFilename);
  if (fs.existsSync(inRootDir)) return inRootDir;
  return null;
}

function cleanupDownloadedTempFile(filePath, downloaded) {
  if (!downloaded || !filePath || !fs.existsSync(filePath)) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

async function downloadRemoteAsset(url, destDir, prefix) {
  const isRemote = url.startsWith('http://') || url.startsWith('https://');
  if (!isRemote) return { localPath: null, downloaded: false };
  const ext = path.extname(new URL(url).pathname) || '.jpg';
  const localPath = path.join(destDir, `${prefix}-original${ext}`);
  const ok = await downloadFile(url, localPath);
  if (!ok) return { localPath: null, downloaded: false };
  return { localPath, downloaded: true };
}

// ── Image Generation ─────────────────────────────────────────────────────────

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

// ── Asset Processing ──────────────────────────────────────────────────────────

async function applyImageVariants(localImgPath, orchImgDir, downloaded) {
  const variants = await generateImageVariants(localImgPath, orchImgDir, 'photo');
  cleanupDownloadedTempFile(localImgPath, downloaded);

  if (!variants) {
    const jpegFallback = path.join(orchImgDir, 'photo-800w.jpg');
    if (fs.existsSync(jpegFallback)) return { fallback: 'images/photo-800w.jpg', hasSrcset: false };
    return null;
  }

  return variants;
}

async function resolveImagePath(imageSpec, slug, ensembleDir, orchImgDir) {
  if (imageSpec.local) {
    const localPath = resolveLocalAssetPath(imageSpec.local, ensembleDir, ROOT);
    if (localPath) return { localPath, downloaded: false };
    console.warn(`[build] WARN: Local image not found for ${slug}: ${imageSpec.local}`);
  }

  if (!imageSpec.url) return { localPath: null, downloaded: false };

  log(`  Downloading image for ${slug}...`);
  const result = await downloadRemoteAsset(imageSpec.url, orchImgDir, 'original');
  if (!result.localPath) console.warn(`[build] WARN: Image not available for ${slug}, skipping image.`);
  return result;
}

async function processImage(imageSpec, slug, ensembleDir, orchImgDir) {
  if (!imageSpec || (!imageSpec.local && !imageSpec.url)) return null;

  const { localPath, downloaded } = await resolveImagePath(imageSpec, slug, ensembleDir, orchImgDir);
  if (!localPath) return null;

  try {
    const imageData = await applyImageVariants(localPath, orchImgDir, downloaded);
    return imageData ? { ...imageSpec, ...imageData } : null;
  } catch (e) {
    console.warn(`[build] WARN: Could not process image for ${slug}: ${e.message}`);
    cleanupDownloadedTempFile(localPath, downloaded);
    return null;
  }
}

async function resolveLogoPath(logoSpec, slug, ensembleDir, orchImgDir) {
  if (logoSpec.local) {
    const localPath = resolveLocalAssetPath(logoSpec.local, ensembleDir, ROOT);
    if (localPath) return { localPath, downloaded: false };
    console.warn(`[build] WARN: Local logo not found for ${slug}: ${logoSpec.local}`);
  }

  if (!logoSpec.url) return { localPath: null, downloaded: false };

  log(`  Downloading logo for ${slug}...`);
  const result = await downloadRemoteAsset(logoSpec.url, orchImgDir, 'logo');
  if (!result.localPath) console.warn(`[build] WARN: Logo not available for ${slug}, skipping logo.`);
  return result;
}

async function processLogo(logoSpec, slug, ensembleDir, orchImgDir) {
  if (!logoSpec || (!logoSpec.local && !logoSpec.url)) return null;

  const { localPath, downloaded } = await resolveLogoPath(logoSpec, slug, ensembleDir, orchImgDir);
  if (!localPath) return null;

  try {
    const logoLocal = await generateLogoVariant(localPath, orchImgDir, 'logo');
    if (!logoLocal) {
      console.warn(`[build] WARN: Logo variant generation returned null for ${slug}.`);
      cleanupDownloadedTempFile(localPath, downloaded);
      return null;
    }
    cleanupDownloadedTempFile(localPath, downloaded);
    return { ...logoSpec, local: logoLocal };
  } catch (e) {
    console.warn(`[build] WARN: Could not process logo for ${slug}: ${e.message}`);
    cleanupDownloadedTempFile(localPath, downloaded);
    return null;
  }
}

// ── JSON-LD Builders ─────────────────────────────────────────────────────────

function buildSameAsLinks(social) {
  if (!social) return [];
  return Object.values(social).filter(Boolean);
}

function buildJsonLdConductors(conductors) {
  return (conductors || []).map(c => ({
    '@type': 'Person',
    'name': c.name,
    ...(c.role ? { 'jobTitle': c.role } : {}),
  }));
}

function buildStructuredLocation(addr, geo) {
  return {
    '@type': 'Place',
    ...(addr.name ? { 'name': addr.name } : {}),
    'address': {
      '@type': 'PostalAddress',
      ...(addr.street ? { 'streetAddress': addr.street } : {}),
      ...(addr.postcode ? { 'postalCode': addr.postcode } : {}),
      ...(addr.city ? { 'addressLocality': addr.city } : {}),
      'addressCountry': 'DE',
      'addressRegion': 'Niedersachsen',
    },
    ...(addr.maps ? { 'hasMap': addr.maps } : {}),
    ...(geo ? { 'geo': { '@type': 'GeoCoordinates', 'latitude': geo.lat, 'longitude': geo.lng } } : {}),
  };
}

function buildFallbackLocation(location, geo) {
  return {
    '@type': 'Place',
    'name': location,
    'address': {
      '@type': 'PostalAddress',
      'addressLocality': location,
      'addressCountry': 'DE',
      'addressRegion': 'Niedersachsen',
    },
    ...(geo ? { 'geo': { '@type': 'GeoCoordinates', 'latitude': geo.lat, 'longitude': geo.lng } } : {}),
  };
}

function buildLocationObject(orchestra) {
  const g = orchestra.geo;
  const geo = g && typeof g.lat === 'number' && typeof g.lng === 'number' ? g : null;
  if (orchestra.address) return buildStructuredLocation(orchestra.address, geo);
  if (orchestra.location) return buildFallbackLocation(orchestra.location, geo);
  if (geo) return { '@type': 'Place', 'geo': { '@type': 'GeoCoordinates', 'latitude': geo.lat, 'longitude': geo.lng } };
  return undefined;
}

function removeUndefinedValues(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildIndexJsonLd(orchestras) {
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    'name': 'Musik in Schaumburg',
    'description': 'Übersicht der Musikensembles, Chöre und Blasorchester im Landkreis Schaumburg, Niedersachsen.',
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
    'name': 'Musikensembles im Landkreis Schaumburg',
    'description': 'Musikensembles, Chöre und Blasorchester im Landkreis Schaumburg.',
    'numberOfItems': orchestras.length,
    'itemListElement': orchestras.map((o, i) => {
      const locationObj = buildLocationObject(o);
      return {
        '@type': 'ListItem',
        'position': i + 1,
        'item': {
          '@type': 'MusicGroup',
          '@id': `${SITE_URL}/ensemble/${o.slug}/`,
          'name': o.title,
          'url': o.website || `${SITE_URL}/ensemble/${o.slug}/`,
          ...(locationObj ? { 'location': locationObj } : {}),
          ...(o.description ? { 'description': o.description.trim() } : {}),
        },
      };
    }),
  };

  return JSON.stringify([website, itemList], null, 2);
}

function buildOrchestraJsonLd(orchestra) {
  const sameAs = buildSameAsLinks(orchestra.social);
  const conductorItems = buildJsonLdConductors(orchestra.conductors);
  const locationObj = buildLocationObject(orchestra);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    '@id': `${SITE_URL}/ensemble/${orchestra.slug}/`,
    'name': orchestra.title,
    'description': orchestra.description ? orchestra.description.trim() : undefined,
    'url': orchestra.website || `${SITE_URL}/ensemble/${orchestra.slug}/`,
    'inLanguage': 'de',
    ...(orchestra.founded ? { 'foundingDate': String(orchestra.founded) } : {}),
    ...(orchestra.member_count ? { 'numberOfEmployees': { '@type': 'QuantitativeValue', 'value': orchestra.member_count } } : {}),
    ...(orchestra.image && orchestra.image.fallback ? {
      'image': `${SITE_URL}/ensemble/${orchestra.slug}/${orchestra.image.fallback}`,
    } : {}),
    ...(orchestra.logo && orchestra.logo.local ? {
      'logo': `${SITE_URL}/ensemble/${orchestra.slug}/${orchestra.logo.local}`,
    } : {}),
    ...(locationObj ? { 'location': locationObj } : {}),
    ...(conductorItems.length > 0 ? { 'member': conductorItems } : {}),
    ...(sameAs.length > 0 ? { 'sameAs': sameAs } : {}),
    ...(orchestra.tags && orchestra.tags.length > 0 ? { 'keywords': orchestra.tags.join(', ') } : {}),
  };

  return JSON.stringify(removeUndefinedValues(schema), null, 2);
}

// ── View Normalizers ──────────────────────────────────────────────────────────

function truncate(str, maxLen = 155) {
  if (!str) return '';
  const s = str.trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1).trimEnd() + '…';
}

function normalizeConductors(conductors) {
  return (conductors || []).map((c, i, arr) => ({
    name: c.name,
    role: c.role || null,
    hasRole: Boolean(c.role),
    isLast: i === arr.length - 1,
  }));
}

function normalizeAddress(address) {
  if (!address) return null;
  return { ...address, hasMaps: Boolean(address.maps), hasStreet: Boolean(address.street) };
}

function normalizeRehearsal(rehearsal) {
  if (!rehearsal) return null;
  return { ...rehearsal, hasTime: Boolean(rehearsal.time), hasLocation: Boolean(rehearsal.location) };
}

function normalizeContact(contact) {
  if (!contact) return null;
  return { ...contact, hasEmail: Boolean(contact.email), hasPhone: Boolean(contact.phone) };
}

function buildIndexImagePaths(o) {
  if (!o.image) return null;
  return {
    ...o.image,
    srcsetWebp: o.image.srcsetWebp
      ? o.image.srcsetWebp.split(', ').map(s => `ensemble/${o.slug}/${s}`).join(', ')
      : null,
    srcset: o.image.srcset
      ? o.image.srcset.split(', ').map(s => `ensemble/${o.slug}/${s}`).join(', ')
      : null,
    fallback: o.image.fallback ? `ensemble/${o.slug}/${o.image.fallback}` : null,
  };
}

// ── YAML Data Helpers ─────────────────────────────────────────────────────────

function readAllowedKeywords() {
  if (!fs.existsSync(KEYWORDS_FILE)) return [];
  try {
    const kw = yaml.load(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
    if (Array.isArray(kw)) return kw.map(k => String(k).trim()).filter(Boolean);
    return [];
  } catch (e) {
    console.warn('[build] WARN: Could not read keywords.yml:', e.message);
    return [];
  }
}

function warnUnknownTags(slug, tags, allowedKeywords) {
  if (allowedKeywords.length === 0) return;
  const unknown = tags.filter(t => !allowedKeywords.includes(t));
  if (unknown.length > 0) console.warn(`[build] WARN: Unknown tags for ${slug}: ${unknown.join(', ')}`);
}

function parseTags(rawValue) {
  if (typeof rawValue === 'string') return rawValue.split(',').map(s => s.trim()).filter(Boolean);
  if (Array.isArray(rawValue)) return rawValue;
  return [];
}

function buildNormalizedTags(slug, rawTagsOrKeywords, allowedKeywords) {
  const tags = Array.from(new Set(
    parseTags(rawTagsOrKeywords).map(t => String(t).trim()).filter(Boolean)
  ));
  warnUnknownTags(slug, tags, allowedKeywords);
  return tags;
}

function loadEnsembleYaml(dirName, allowedKeywords) {
  const yamlPath = path.join(ORCHESTRAS_DIR, dirName, 'index.yaml');
  if (!fs.existsSync(yamlPath)) {
    console.warn(`[build] WARN: No index.yaml in ensembles/${dirName}, skipping.`);
    return null;
  }
  const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
  const slug = raw.slug || dirName;
  const tags = buildNormalizedTags(slug, raw.tags || raw.keywords, allowedKeywords);
  return { ...raw, slug, _dir: dirName, typeLabel: TYPE_LABELS[raw.type] || raw.type || 'Musikgruppe', tags };
}

function loadEnsembles(allowedKeywords) {
  const orchDirs = fs.readdirSync(ORCHESTRAS_DIR).filter(d =>
    fs.statSync(path.join(ORCHESTRAS_DIR, d)).isDirectory()
  );

  const orchestras = orchDirs
    .map(dirName => loadEnsembleYaml(dirName, allowedKeywords))
    .filter(Boolean)
    .toSorted((a, b) => a.title.localeCompare(b.title, 'de'));

  for (const orch of orchestras) log(`  Found: ${orch.title} (${orch.slug})`);
  return orchestras;
}

// ── Build Steps ───────────────────────────────────────────────────────────────

async function processEnsembleAssets(orchestras) {
  const results = [];
  for (const orch of orchestras) {
    const orchDistDir = path.join(DIST, 'ensemble', orch.slug);
    const orchImgDir = path.join(orchDistDir, 'images');
    const ensembleDir = path.join(ORCHESTRAS_DIR, orch._dir);
    fse.ensureDirSync(orchImgDir);

    const image = await processImage(orch.image, orch.slug, ensembleDir, orchImgDir);
    const logo = await processLogo(orch.logo, orch.slug, ensembleDir, orchImgDir);
    const hasSocial = Boolean(orch.social && Object.values(orch.social).some(Boolean));
    results.push({ ...orch, image, logo, hasSocial });
  }
  return results;
}

function renderIndexPage(orchestras, allowedKeywords, partials) {
  const indexTemplate = fs.readFileSync(path.join(SRC_HTML, 'index.html'), 'utf8');

  const orchestrasForIndex = orchestras.map(o => ({
    ...o,
    image: buildIndexImagePaths(o),
    logo: o.logo
      ? { ...o.logo, local: o.logo.local ? `ensemble/${o.slug}/${o.logo.local}` : null }
      : null,
    tags: o.tags || null,
    isInactive: o.active === false,
    founded: o.founded || null,
  }));

  const indexView = {
    orchestras: orchestrasForIndex,
    year: CURRENT_YEAR,
    jsonld: buildIndexJsonLd(orchestras),
    availableKeywords: allowedKeywords,
  };

  const indexHtml = Mustache.render(indexTemplate, indexView, partials);
  fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml, 'utf8');
}

function buildEnsembleView(orch) {
  const conductors = normalizeConductors(orch.conductors);
  const address = normalizeAddress(orch.address);
  const rehearsal = normalizeRehearsal(orch.rehearsal);
  const contact = normalizeContact(orch.contact);
  const hasGeo = !!(orch.geo && orch.geo.lat && orch.geo.lng);
  const geoJson = hasGeo
    ? JSON.stringify({ lat: orch.geo.lat, lng: orch.geo.lng, title: orch.title })
    : null;

  return {
    ...orch,
    year: CURRENT_YEAR,
    canonicalUrl: `${SITE_URL}/ensemble/${orch.slug}/`,
    ogImageUrl: orch.image && orch.image.fallback
      ? `${SITE_URL}/ensemble/${orch.slug}/${orch.image.fallback}`
      : null,
    descriptionShort: truncate(orch.description, 155),
    jsonld: buildOrchestraJsonLd(orch),
    conductors,
    hasConductors: conductors.length > 0,
    address,
    hasAddress: Boolean(address),
    rehearsal,
    hasRehearsal: Boolean(rehearsal),
    contact,
    hasContact: Boolean(contact),
    isInactive: orch.active === false,
    founded: orch.founded || null,
    member_count: orch.member_count || null,
    membership_fee: orch.membership_fee || null,
    hasGeo,
    geoJson,
  };
}

function renderImpressumPage(partials) {
  const template = fs.readFileSync(path.join(SRC_HTML, 'impressum.html'), 'utf8');
  const view = { year: CURRENT_YEAR };
  const html = Mustache.render(template, view, partials);
  const outPath = path.join(DIST, 'impressum', 'index.html');
  fse.ensureDirSync(path.dirname(outPath));
  fs.writeFileSync(outPath, html, 'utf8');
  log('Written: impressum/index.html');
}

function renderMapPage(orchestras, partials) {
  const mapTemplate = fs.readFileSync(path.join(SRC_HTML, 'karte.html'), 'utf8');
  const withGeo = orchestras.filter(o => o.geo && o.geo.lat && o.geo.lng);
  const mapData = withGeo.map(o => ({
    slug: o.slug,
    title: o.title,
    typeLabel: o.typeLabel,
    lat: o.geo.lat,
    lng: o.geo.lng,
    url: `../ensemble/${o.slug}/index.html`,
    logoUrl: o.logo && o.logo.local ? `../ensemble/${o.slug}/${o.logo.local}` : null,
    excerpt: truncate(o.description, 80),
  }));
  const view = {
    year: CURRENT_YEAR,
    mapDataJson: JSON.stringify(mapData),
    ensembleCount: withGeo.length,
  };
  const html = Mustache.render(mapTemplate, view, partials);
  const outPath = path.join(DIST, 'karte', 'index.html');
  fse.ensureDirSync(path.dirname(outPath));
  fs.writeFileSync(outPath, html, 'utf8');
  log('Written: karte/index.html');
}

function renderEnsemblePages(orchestras, orchTemplate, partials) {
  for (const orch of orchestras) {
    const view = buildEnsembleView(orch);
    const orchHtml = Mustache.render(orchTemplate, view, partials);
    const outPath = path.join(DIST, 'ensemble', orch.slug, 'index.html');
    fse.ensureDirSync(path.dirname(outPath));
    fs.writeFileSync(outPath, orchHtml, 'utf8');
    log(`  Written: ensemble/${orch.slug}/index.html`);
  }
}

function generateSitemap(orchestras) {
  const today = new Date().toISOString().slice(0, 10);
  const sitemapUrls = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: '1.0', lastmod: today },
    { loc: `${SITE_URL}/karte/`, changefreq: 'monthly', priority: '0.7', lastmod: today },
    { loc: `${SITE_URL}/impressum/`, changefreq: 'yearly', priority: '0.2', lastmod: today },
    ...orchestras.map(o => ({
      loc: `${SITE_URL}/ensemble/${o.slug}/`,
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
}

function copyLeafletFromNodeModules() {
  fse.copySync(path.join(LEAFLET_DIST, 'leaflet.js'), path.join(DIST, 'js', 'leaflet.js'));
  fse.copySync(path.join(LEAFLET_DIST, 'leaflet.css'), path.join(DIST, 'css', 'leaflet.css'));
  fse.copySync(path.join(LEAFLET_DIST, 'images'), path.join(DIST, 'css', 'images'));
}

function copyStaticAssets() {
  fse.ensureDirSync(path.join(DIST, 'css'));
  fse.ensureDirSync(path.join(DIST, 'js'));
  fse.copySync(SRC_CSS, path.join(DIST, 'css'));
  fse.copySync(SRC_JS, path.join(DIST, 'js'));
  copyLeafletFromNodeModules();
  fse.copySync(path.join(ROOT, 'LICENSE'), path.join(DIST, 'LICENSE'));
  fse.copySync(path.join(ROOT, 'src', 'main', 'robots.txt'), path.join(DIST, 'robots.txt'));
  fse.copySync(path.join(ROOT, 'src', 'main', '.htaccess'), path.join(DIST, '.htaccess'));
}

async function processHeaderImage() {
  const distImgDir = path.join(DIST, 'img');
  fse.ensureDirSync(distImgDir);

  const srcFile = path.join(SRC_IMG, 'header-schaumburg.jpg');
  if (!fs.existsSync(srcFile)) return;

  const webpOut = path.join(distImgDir, 'header-schaumburg.webp');
  const jpgOut = path.join(distImgDir, 'header-schaumburg.jpg');

  await sharp(srcFile).resize(1400, null, { withoutEnlargement: true }).webp({ quality: 82 }).toFile(webpOut);
  await sharp(srcFile).resize(1400, null, { withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(jpgOut);
}

// ── Main Build ────────────────────────────────────────────────────────────────

async function build() {
  log('Cleaning dist/...');
  fse.removeSync(DIST);
  fse.ensureDirSync(DIST);

  log('Reading orchestra data...');
  const allowedKeywords = readAllowedKeywords();
  const loadedEnsembles = loadEnsembles(allowedKeywords);

  const orchestras = await processEnsembleAssets(loadedEnsembles);

  log('Rendering index.html...');
  const partials = {
    matomo: fs.readFileSync(path.join(SRC_HTML, 'partials', 'matomo.html'), 'utf8'),
  };
  renderIndexPage(orchestras, allowedKeywords, partials);

  log('Rendering orchestra pages...');
  const orchTemplate = fs.readFileSync(path.join(SRC_HTML, 'ensemble.html'), 'utf8');
  renderEnsemblePages(orchestras, orchTemplate, partials);

  log('Rendering map page...');
  renderMapPage(orchestras, partials);

  log('Rendering impressum page...');
  renderImpressumPage(partials);

  log('Generating sitemap.xml...');
  generateSitemap(orchestras);

  log('Copying static assets...');
  copyStaticAssets();

  log('Processing header image...');
  await processHeaderImage();

  log('Build complete ✓');
  log(`Output: ${DIST}`);
}

build()
  .then(() => compressAssets())
  .catch(err => {
    console.error('[build] Fatal error:', err);
    process.exit(1);
  });

// ── Compression ───────────────────────────────────────────────────────────────

const COMPRESSIBLE_EXTS = ['.html', '.css', '.js', '.xml', '.txt', '.svg'];

function walkCompressibleFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walkCompressibleFiles(full));
      continue;
    }
    if (COMPRESSIBLE_EXTS.includes(path.extname(e.name))) files.push(full);
  }
  return files;
}

async function compressAssets() {
  const files = walkCompressibleFiles(DIST);
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
