#!/usr/bin/env bun
/**
 * Reads git history for each ensemble's image and logo files,
 * extracts the source URL from the commit message, and writes
 * image.source + image.copyright (and logo.source + logo.copyright)
 * back into each YAML file.
 *
 * Run once:  bun scripts/enrich-image-metadata.mjs
 * Idempotent: skips files that already have `source:` set.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENSEMBLES_DIR = path.join(ROOT, 'ensembles');

/** Domains where copyright is uncertain / legally risky. Flag them but still add source. */
const RISKY_DOMAINS = ['sn-online.de', 'schaumburger-nachrichten.de'];

function gitLogBody(relPath) {
  try {
    return execSync(
      `git --no-pager log --format="%B" --follow -1 -- "${relPath}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return '';
  }
}

function firstUrl(text) {
  const m = text.match(/https?:\/\/[^\s)>,"'\]]+/);
  return m ? m[0].replace(/[.,;:]+$/, '') : null;
}

function isRisky(url) {
  return url ? RISKY_DOMAINS.some(d => url.includes(d)) : false;
}

/**
 * Insert `source:` and `copyright:` lines directly after a `local:` line
 * inside the given block (image: or logo:).
 *
 * Uses text manipulation to preserve comments and custom formatting.
 */
function insertSourceIntoYamlText(text, blockKey, source, copyright) {
  // Find the block (image: or logo:) and then find `local:` within it.
  // We look for the indented `local:` that immediately follows the block key.
  const blockRe = new RegExp(
    `(^${blockKey}:\\s*\\n(?:[ \\t]+#[^\\n]*\\n)*[ \\t]+local:[^\\n]*)`,
    'm'
  );
  const match = blockRe.exec(text);
  if (!match) return text;

  const indent = match[0].match(/^([ \t]+)local:/m)?.[1] ?? '  ';
  const insertion = `${indent}source: "${source}"\n${indent}copyright: "${copyright}"\n`;

  return text.slice(0, match.index + match[0].length) + '\n' + insertion + text.slice(match.index + match[0].length);
}

function alreadyHasSource(text, blockKey) {
  // Check if there's already a `source:` inside the block
  const blockStart = text.indexOf(`${blockKey}:`);
  if (blockStart === -1) return false;
  const nextBlock = text.indexOf('\n\n', blockStart);
  const slice = nextBlock === -1 ? text.slice(blockStart) : text.slice(blockStart, nextBlock);
  return slice.includes('source:');
}

const slugDirs = fs.readdirSync(ENSEMBLES_DIR).filter(d =>
  fs.statSync(path.join(ENSEMBLES_DIR, d)).isDirectory()
);

let changed = 0;

for (const slug of slugDirs) {
  const yamlPath = path.join(ENSEMBLES_DIR, slug, 'index.yaml');
  if (!fs.existsSync(yamlPath)) continue;

  const data = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
  let text = fs.readFileSync(yamlPath, 'utf8');
  let modified = false;

  const ensembleTitle = data.title ?? slug;

  for (const blockKey of ['image', 'logo']) {
    const block = data[blockKey];
    if (!block?.local) continue;
    if (alreadyHasSource(text, blockKey)) continue;

    const relFile = `ensembles/${slug}/${block.local}`;
    const commitBody = gitLogBody(relFile);

    let source = firstUrl(commitBody);

    // Fall back to ensemble website if no URL found in commit
    if (!source) source = data.website ?? null;

    if (!source) {
      console.warn(`[WARN] ${slug}/${blockKey}: no source found, skipping`);
      continue;
    }

    if (isRisky(source)) {
      console.log(`[WARN] ${slug}/${blockKey}: source from ${source} — adding with note`);
    }

    const copyright = ensembleTitle;
    console.log(`[ADD ] ${slug}/${blockKey}: source=${source}`);
    text = insertSourceIntoYamlText(text, blockKey, source, copyright);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(yamlPath, text, 'utf8');
    changed++;
  }
}

console.log(`\nDone. Updated ${changed} YAML file(s).`);
