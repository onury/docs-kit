// Syncs a project's root markdown docs (README sections, CHANGELOG, guides…)
// into the Starlight content collection, keeping a single source of truth. Each
// file's leading `# H1` becomes the Starlight frontmatter `title` (and is
// stripped to avoid a duplicate heading). Cross-document relative links between
// the synced files are rewritten to in-site routes under the project `base`.
//
//   import { syncDocs } from '@onury/docs-kit/sync';
//   syncDocs({
//     root: resolve(here, '../..'),
//     outDir: resolve(here, '../src/content/docs'),
//     base: '/mylib',
//     files: [
//       { src: 'CHANGELOG.md', out: 'changelog.md', title: 'Changelog', description: '…' },
//       { src: 'docs/FAQ.md',  out: 'faq.md',       description: '…' },
//     ],
//   });

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** Escapes a value for safe single-line YAML frontmatter. */
function yaml(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

/** Escapes a string for literal use inside a RegExp. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The in-site route a synced file resolves to, under `base`. */
function routeFor(base, out) {
  const slug = out
    .replace(/\.mdx?$/, '')
    .replace(/(^|\/)index$/, '');
  return `${base}/${slug}/`.replace(/\/{2,}/g, '/');
}

/**
 * @param {object} opts
 * @param {string} opts.root    Project root (where the source files live).
 * @param {string} opts.outDir  Starlight content dir, e.g. `src/content/docs`.
 * @param {string} opts.base    GitHub Pages project path, e.g. `/mylib`.
 * @param {{src: string, out: string, title?: string, description?: string}[]} opts.files
 */
export function syncDocs({ root, outDir, base, files }) {
  if (!root || !outDir || !base || !Array.isArray(files)) {
    throw new Error('[docs-kit] syncDocs: { root, outDir, base, files } are all required.');
  }

  // Map each source basename -> its in-site route, so cross-links between synced
  // docs (e.g. `./CHANGELOG.md`, `../docs/FAQ.md`) become real site routes.
  const linkRewrites = files.map(({ src, out }) => ({
    re: new RegExp(
      // a markdown link target: optional ./ or ../ and intermediate dirs, then
      // the basename, then an optional #anchor.
      `(\\]\\()(?:\\.{1,2}/)?(?:[\\w.-]+/)*${escapeRe(basename(src))}(#[^)\\s]*)?(\\))`,
      'g'
    ),
    route: routeFor(base, out)
  }));

  for (const { src, out, title: titleOverride, description } of files) {
    let body = readFileSync(resolve(root, src), 'utf8');

    // Title precedence: explicit `title` > the file's first `# H1` > the output
    // filename. The leading H1 is always stripped (it would otherwise duplicate
    // the title Starlight renders from the frontmatter).
    let title = titleOverride ?? out.replace(/\.mdx?$/, '');
    const m = body.match(/^\s*#\s+(.+?)\s*$/m);
    if (m) {
      if (!titleOverride) title = m[1];
      body = body.slice(0, m.index) + body.slice(m.index + m[0].length);
    }

    // Rewrite cross-doc relative links to in-site routes (under the base path).
    for (const { re, route } of linkRewrites) {
      body = body.replace(re, (_all, open, anchor = '', close) => `${open}${route}${anchor}${close}`);
    }

    const frontmatter =
      `---\ntitle: ${yaml(title)}\n` +
      (description ? `description: ${yaml(description)}\n` : '') +
      `---\n`;
    const target = resolve(outDir, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, frontmatter + body.trimStart() + '\n');
    console.log(`synced ${src} -> ${out}`);
  }
}

export default syncDocs;
