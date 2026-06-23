#!/usr/bin/env node
// Scaffolds a `site/` docs site (Astro + Starlight, themed by @onury/docs-kit)
// into a project, plus a thin Pages-deploy workflow. Run from the project root:
//
//   node ../docs-kit/bin/init.mjs --local       # local dev (file: dep)
//   npx @onury/docs-kit init                     # once published as a git dep
//
// Flags:
//   --base /name     Pages base path (default: derived from the GitHub repo name)
//   --title "Name"   Site title (default: Title-cased package name)
//   --repo owner/rp  GitHub repo for the social link (default: from package.json)
//   --branch name    Branch the deploy workflow triggers on (default: current git branch)
//   --ref spec       Kit dependency spec (default: github:onury/docs-kit#v1)
//   --local          Use a local file: dep (file:../../docs-kit) for development
//   --force          Overwrite an existing site/ directory
//
// NOTE: the generated astro.config.mjs intentionally does NOT import from
// @onury/docs-kit — the shared theme is pulled in via CSS string paths. Importing
// the (ESM-only) kit into an Astro config makes Vite externalize @astrojs/starlight
// and load its TypeScript entry under Node, which fails on Node >=22.18.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(KIT_DIR, 'templates');

function fail(msg) {
  console.error(`\x1b[31m[docs-kit] ${msg}\x1b[0m`);
  process.exit(1);
}

// --- parse args --------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'init') continue; // allow `docs-kit init`
    if (a.startsWith('--')) {
      const [k, inlineV] = a.slice(2).split('=');
      if (inlineV !== undefined) out[k] = inlineV;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const projectRoot = resolve(args._[0] || process.cwd());

// --- read host project -------------------------------------------------------
const pkgPath = join(projectRoot, 'package.json');
if (!existsSync(pkgPath)) fail(`No package.json found in ${projectRoot}`);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

function ghRepoFrom() {
  if (args.repo) return String(args.repo);
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?(?:$|[/#])/);
  return m ? m[1] : `onury/${pkg.name}`;
}

function titleCase(s) {
  return s
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function detectBranch() {
  if (args.branch) return String(args.branch);
  try {
    return (
      execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'ignore']
      })
        .toString()
        .trim() || 'main'
    );
  } catch {
    return 'main';
  }
}

const repo = ghRepoFrom();
const baseName = (args.base ? String(args.base) : basename(repo)).replace(/^\//, '');
const base = `/${baseName}`;
const projectName = pkg.name;
const title = args.title ? String(args.title) : titleCase(pkg.name);
const description = pkg.description || `${title} documentation.`;
const license = typeof pkg.license === 'string' && pkg.license ? pkg.license : 'MIT';
const kitRef = args.local
  ? 'file:../../docs-kit'
  : args.ref
    ? String(args.ref)
    : 'github:onury/docs-kit#v1';
const defaultBranch = detectBranch();
const hasApi =
  existsSync(join(projectRoot, 'src/index.ts')) && existsSync(join(projectRoot, 'tsconfig.build.json'));

// --- sync from repo root -----------------------------------------------------
// Only CHANGELOG.md is synced from the repo root; all other pages are authored
// directly in site/src/content/docs/ (read by Starlight, no sync). See the
// project's site/README.md.
const files = [];
const helpItems = [];
if (existsSync(join(projectRoot, 'CHANGELOG.md'))) {
  files.push({
    src: 'CHANGELOG.md',
    out: 'changelog.md',
    title: 'Changelog',
    description: 'Release history — notable changes across versions.'
  });
  helpItems.push({ label: 'Changelog', slug: 'changelog' });
}

const sidebar = [
  { label: 'Start Here', items: [{ label: 'Getting Started', slug: 'getting-started' }] },
  ...(helpItems.length ? [{ label: 'Help', items: helpItems }] : [])
];

// --- token fill (for non-config templates) -----------------------------------
const filesLiteral = JSON.stringify(files, null, 2).replace(/\n/g, '\n  ');
function fill(str) {
  return str
    .split('__PROJECT__').join(projectName)
    .split('__TITLE__').join(title)
    .split('__DESCRIPTION__').join(description)
    .split('__BASE_NAME__').join(baseName)
    .split('__BASE__').join(base)
    .split('__GH_REPO__').join(repo)
    .split('__KIT_REF__').join(kitRef)
    .split('__DEFAULT_BRANCH__').join(defaultBranch)
    .split('__LICENSE__').join(license)
    .split('__FILES__').join(filesLiteral);
}

// --- generate astro.config.mjs (must NOT import @onury/docs-kit) --------------
function renderAstroConfig() {
  const j = (v) => JSON.stringify(v);
  // Indent the sidebar array under `sidebar:` and, when an API is present,
  // append the `typeDocSidebarGroup` variable reference as the last entry.
  const sidebarItems = JSON.stringify(sidebar, null, 2).replace(/\n/g, '\n      ');
  const sidebarLiteral = hasApi
    ? sidebarItems.replace(/\n( *)\]$/, ',\n        typeDocSidebarGroup\n$1]')
    : sidebarItems;

  const apiImport = hasApi
    ? "import { createStarlightTypeDocPlugin } from 'starlight-typedoc';\n"
    : '';
  const apiSetup = hasApi
    ? '\nconst [starlightTypeDoc, typeDocSidebarGroup] = createStarlightTypeDocPlugin();\n' +
      '\n/**\n' +
      ' * Drops the auto-generated `## Constructors` heading from the TypeDoc API\n' +
      ' * pages (each class has a single constructor, so the title is noise).\n' +
      ' */\n' +
      'function remarkDropConstructorsHeading() {\n' +
      '  return (/** @type {any} */ tree) => {\n' +
      '    tree.children = tree.children.filter(\n' +
      '      (/** @type {any} */ node) =>\n' +
      '        !(\n' +
      "          node.type === 'heading' &&\n" +
      '          node.depth === 2 &&\n' +
      '          node.children?.length === 1 &&\n' +
      "          node.children[0].value === 'Constructors'\n" +
      '        )\n' +
      '    );\n' +
      '  };\n' +
      '}\n'
    : '';
  const markdownLine = hasApi
    ? '  markdown: { remarkPlugins: [remarkDropConstructorsHeading] },\n'
    : '';
  const pluginsBlock = hasApi
    ? '      plugins: [\n' +
      '        starlightTypeDoc({\n' +
      "          entryPoints: ['../src/index.ts'],\n" +
      "          tsconfig: '../tsconfig.build.json',\n" +
      "          output: 'api',\n" +
      "          sidebar: { label: 'API Reference', collapsed: false },\n" +
      "          typeDoc: { githubPages: false, excludeInternal: true, sort: ['source-order'] }\n" +
      '        })\n' +
      '      ],\n'
    : '';

  return (
    '// @ts-check\n' +
    '// Per-project Astro + Starlight config. The shared THEME comes from\n' +
    '// @onury/docs-kit via the CSS string paths in `customCss` below.\n' +
    '//\n' +
    '// NOTE: do NOT `import` from @onury/docs-kit here. It is ESM-only, and importing\n' +
    '// it into the Astro config makes Vite externalize @astrojs/starlight and load its\n' +
    '// TypeScript entry under Node, which fails on Node >=22.18.\n' +
    "import { defineConfig } from 'astro/config';\n" +
    "import starlight from '@astrojs/starlight';\n" +
    apiImport +
    apiSetup +
    '\nexport default defineConfig({\n' +
    "  site: 'https://onury.io',\n" +
    `  base: ${j(base)},\n` +
    markdownLine +
    '  integrations: [\n' +
    '    starlight({\n' +
    `      title: ${j(title)},\n` +
    `      description: ${j(description)},\n` +
    `      social: [{ icon: 'github', label: 'GitHub', href: ${j(`https://github.com/${repo}`)} }],\n` +
    "      // Shared <head> (Cloudflare Web Analytics beacon) — token lives in the kit.\n" +
    "      components: { Head: '@onury/docs-kit/components/Head.astro' },\n" +
    '      customCss: [\n' +
    "        '@onury/docs-kit/styles/custom.css',\n" +
    "        '@onury/docs-kit/styles/theme.css',\n" +
    "        './src/styles/overrides.css',\n" +
    "        './src/styles/hero.css'\n" +
    '      ],\n' +
    pluginsBlock +
    `      sidebar: ${sidebarLiteral}\n` +
    '    })\n' +
    '  ]\n' +
    '});\n'
  );
}

// --- write -------------------------------------------------------------------
const siteDir = join(projectRoot, 'site');
if (existsSync(siteDir) && !args.force) {
  fail(`site/ already exists in ${projectRoot} (use --force to overwrite).`);
}

const written = [];
function writeOut(relPath, content) {
  const dest = join(projectRoot, relPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  written.push(relPath);
}
function copyTpl(tplRel, destRel) {
  writeOut(destRel, readFileSync(join(TPL, tplRel), 'utf8'));
}
function fillTpl(tplRel, destRel) {
  writeOut(destRel, fill(readFileSync(join(TPL, tplRel), 'utf8')));
}

// Manage the host's root package.json docs scripts (docs / docs:dev / docs:host
// → the site dir). Adds them when missing; normalizes a stale docs-kit
// delegation (e.g. an old `--prefix website` left after the website→site
// rename); never overwrites a FOREIGN script (e.g. a TypeDoc `docs`). Edits the
// text in place so the file's existing formatting and key order are preserved.
function ensureDocsScripts() {
  const managed = {
    docs: 'npm --prefix site run build',
    'docs:dev': 'npm --prefix site run dev',
    'docs:host': 'npm --prefix site run dev:host'
  };
  const isDelegation = (v) => typeof v === 'string' && /^npm --prefix \S+ run \S/.test(v);
  const scripts = pkg.scripts || {};
  const added = [];
  const normalized = [];
  const skipped = [];
  const overwrite = {};
  const append = {};
  for (const [k, v] of Object.entries(managed)) {
    if (!(k in scripts)) {
      append[k] = v;
      added.push(k);
    } else if (scripts[k] === v) {
      continue; // already correct
    } else if (isDelegation(scripts[k])) {
      overwrite[k] = v; // stale docs-kit delegation → normalize
      normalized.push(k);
    } else {
      skipped.push(k); // foreign script → leave it alone
    }
  }
  if (!added.length && !normalized.length) return { added, normalized, skipped };

  let raw = readFileSync(pkgPath, 'utf8');

  // Overwrite stale delegations in place (keep their position + indent).
  for (const [k, v] of Object.entries(overwrite)) {
    const keyEsc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(\\n[ \\t]*"${keyEsc}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
    raw = raw.replace(re, `$1${JSON.stringify(v)}`);
  }

  // Append new keys at the end of the "scripts" object.
  const newKeys = Object.entries(append);
  if (newKeys.length) {
    raw = raw.replace(/("scripts"\s*:\s*\{)([\s\S]*?)(\n[ \t]*\})/, (_m, open, inner, close) => {
      const body = inner.replace(/\s*$/, '');
      // Indent of an existing script entry (fallback to 4 spaces for empty scripts).
      const entryIndent = inner.match(/\n([ \t]+)"/)?.[1] || '    ';
      const lines = newKeys
        .map(([k, v]) => `${entryIndent}${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(',\n');
      const joined = body === '' ? `\n${lines}` : `${body},\n${lines}`;
      return `${open}${joined}${close}`;
    });
  }

  writeFileSync(pkgPath, raw);
  return { added, normalized, skipped };
}

// generated / token-filled
writeOut('site/astro.config.mjs', renderAstroConfig());
fillTpl('site-README.md', 'site/README.md');
fillTpl('package.json', 'site/package.json');
fillTpl('scripts/sync-docs.mjs', 'site/scripts/sync-docs.mjs');
fillTpl('src/content/docs/index.mdx', 'site/src/content/docs/index.mdx');
fillTpl('src/content/docs/getting-started.md', 'site/src/content/docs/getting-started.md');

// static copies
copyTpl('tsconfig.json', 'site/tsconfig.json');
copyTpl('src/content.config.ts', 'site/src/content.config.ts');
copyTpl('src/styles/overrides.css', 'site/src/styles/overrides.css');
copyTpl('src/styles/hero.css', 'site/src/styles/hero.css');
for (const c of ['Hero', 'Footer', 'Head', 'SocialIcons']) {
  copyTpl(`src/components/${c}.astro`, `site/src/components/${c}.astro`);
}
fillTpl('public/favicon.svg', 'site/public/favicon.svg');

// .gitignore (+ generated synced files)
const ignore =
  readFileSync(join(TPL, 'gitignore'), 'utf8').trimEnd() +
  '\n' +
  (files.length
    ? '\n# generated by scripts/sync-docs.mjs (do not edit)\n' +
      files.map((f) => `src/content/docs/${f.out}`).join('\n') +
      '\n'
    : '');
writeOut('site/.gitignore', ignore);

// CI workflow
fillTpl('workflows/docs.yml', '.github/workflows/docs.yml');

// root package.json: docs convenience scripts (docs / docs:dev / docs:host)
const docsScripts = ensureDocsScripts();

// --- report ------------------------------------------------------------------
const c = (s) => `\x1b[36m${s}\x1b[0m`;
console.log(`\n\x1b[32m✓ docs-kit scaffolded ${title} → ${base}\x1b[0m\n`);
console.log('  repo:    ', repo);
console.log('  kit dep: ', kitRef);
console.log('  api ref: ', hasApi ? 'yes (TypeDoc from ../src/index.ts)' : 'no');
console.log('  branch:  ', defaultBranch, '(deploy trigger)');
console.log('  synced:  ', files.length ? files.map((f) => f.src).join(', ') : '(none found)');
console.log('\n  files written:');
for (const w of written) console.log('   ', w);
if (docsScripts.added.length || docsScripts.normalized.length) {
  const parts = [];
  if (docsScripts.added.length) parts.push(`added ${docsScripts.added.join(', ')}`);
  if (docsScripts.normalized.length) parts.push(`normalized ${docsScripts.normalized.join(', ')}`);
  console.log(`\n  root scripts (package.json): ${parts.join('; ')} → site`);
}
if (docsScripts.skipped.length) {
  console.log(
    `  note: left existing non-docs-kit script(s) untouched: ${docsScripts.skipped.join(', ')}`
  );
}
console.log(`\n  next:`);
console.log(`    ${c('npm --prefix site install' + (args.local ? ' --install-links' : ''))}`);
console.log(`    ${c('npm --prefix site run dev')}     # preview`);
console.log(`    ${c('npm --prefix site run build')}   # production build → site/dist`);
console.log(
  `\n  then enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and push to ${defaultBranch}.\n`
);
