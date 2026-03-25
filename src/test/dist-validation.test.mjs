/**
 * dist-validation.test.mjs – musik-in-schaumburg.de
 * Licensed under EUPL v. 1.2
 *
 * Validates the built output in dist/:
 *  - All HTML pages pass html-validate
 *  - All source JS files parse without syntax errors (acorn)
 *  - All source CSS files parse without syntax errors (css-tree)
 *  - Every HTML page includes Matomo tracking
 *  - Every HTML page with a JSON-LD script has a matching .json sidecar
 *
 * Requires a prior `bun run build`.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { glob } from "glob";
import { HtmlValidate } from "html-validate";
import * as acorn from "acorn";
import * as csstree from "css-tree";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, "dist");

if (!fs.existsSync(DIST)) {
  throw new Error("dist/ not found – run `bun run build` before `bun run test`.");
}

const htmlFiles = (await glob("**/*.html", { cwd: DIST, absolute: true })).sort();
const srcJsFiles = (await glob("src/main/js/*.js", { cwd: ROOT, absolute: true })).sort();
const srcCssFiles = (await glob("src/main/css/*.css", { cwd: ROOT, absolute: true })).sort();

const htmlvalidate = new HtmlValidate();

// ── HTML validity ─────────────────────────────────────────────────────────────

describe("HTML validity", () => {
  for (const file of htmlFiles) {
    test(path.relative(DIST, file), async () => {
      const report = await htmlvalidate.validateFile(file);
      if (report.valid) return;

      const errors = report.results
        .flatMap(r => r.messages)
        .filter(m => m.severity === 2)
        .map(m => `  [${m.ruleId}] ${m.message} (line ${m.line}:${m.column})`)
        .join("\n");
      throw new Error(`HTML validation errors in ${path.relative(DIST, file)}:\n${errors}`);
    });
  }
});

// ── JavaScript syntax ─────────────────────────────────────────────────────────

describe("JavaScript syntax", () => {
  for (const file of srcJsFiles) {
    test(path.relative(ROOT, file), () => {
      const code = fs.readFileSync(file, "utf-8");
      expect(() => {
        acorn.parse(code, { ecmaVersion: 2022, sourceType: "script" });
      }).not.toThrow();
    });
  }
});

// ── CSS syntax ────────────────────────────────────────────────────────────────

describe("CSS syntax", () => {
  for (const file of srcCssFiles) {
    test(path.relative(ROOT, file), () => {
      const css = fs.readFileSync(file, "utf-8");
      const errors = [];
      csstree.parse(css, {
        onParseError(err) {
          errors.push(err.message);
        },
      });
      expect(errors).toHaveLength(0);
    });
  }
});

// ── Matomo tracking ───────────────────────────────────────────────────────────

describe("Matomo tracking", () => {
  for (const file of htmlFiles) {
    test(path.relative(DIST, file), () => {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).toContain("matomo.php");
    });
  }
});

// ── JSON-LD sidecar files ─────────────────────────────────────────────────────

const JSONLD_SCRIPT_PATTERN = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i;

const htmlFilesWithJsonLd = htmlFiles.filter((file) => {
  const content = fs.readFileSync(file, "utf-8");
  return JSONLD_SCRIPT_PATTERN.test(content);
});

describe("JSON-LD sidecar", () => {
  for (const file of htmlFilesWithJsonLd) {
    test(path.relative(DIST, file), () => {
      const jsonPath = file.replace(/\.html$/, ".json");
      expect(fs.existsSync(jsonPath)).toBe(true);
      const jsonContent = fs.readFileSync(jsonPath, "utf-8");
      expect(() => JSON.parse(jsonContent)).not.toThrow();
      const parsed = JSON.parse(jsonContent);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      expect(first).toHaveProperty("@context", "https://schema.org");
    });
  }
});
