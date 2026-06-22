# @onury/docs-kit

Shared **Astro + Starlight** documentation theme and tooling for `@onury`
projects. One source of truth for the look (fonts, colors, header, code blocks,
feature cards), the markdown-sync engine, the scaffolder, and the GitHub Pages
deploy. Each project's `website/` is a thin, generated shell.

Consumed as a **git dependency** (no npm publish):

```jsonc
// <project>/website/package.json
"dependencies": {
  "@onury/docs-kit": "github:onury/docs-kit#v1",
  "astro": "^6.4.7"
}
```

`@astrojs/starlight`, `starlight-typedoc`, TypeDoc and the fonts are pulled in by
the kit and hoisted into the project — you don't list them per project.

## What it provides

| Export | Purpose |
| --- | --- |
| `@onury/docs-kit/styles/custom.css`, `…/theme.css` | The shared visual theme — referenced as `customCss` string paths in the project's `astro.config.mjs`. |
| `@onury/docs-kit/sync` → `syncDocs(opts)` | Pulls root markdown (CHANGELOG, `docs/*.md`) into the Starlight content collection at build time. |
| `bin/init.mjs` (`docs-kit init`) | Scaffolds a project's `website/` + a self-contained Pages workflow (`.github/workflows/docs.yml`). |

The **hero** background and the **home page** are intentionally per-project (each
project owns `src/styles/hero.css` + `src/content/docs/index.mdx`); the shared
theme covers everything else.

> **Why no `defineConfig` helper?** `astro.config.mjs` must not `import` from this
> package. The kit is ESM-only, and importing it into the Astro config makes Vite
> externalize `@astrojs/starlight` and load its TypeScript entry under Node, which
> fails on Node ≥22.18. So the theme is wired via **CSS string paths** (resolved at
> app build, not config load), and the small config plumbing (the
> constructor-heading remark fix + TypeDoc wiring) is generated inline by the
> scaffolder. The `sync` engine is safe to `import` — it runs under plain Node, not
> the Astro config loader.

## Scaffold a new project

From the target project root (a sibling of this repo under `~/Developer/@onury/`):

```bash
# local development (uses a file: dependency on this repo)
node ../docs-kit/bin/init.mjs --local --base /myproject --title MyProject

# or, once published as a git dep
npx @onury/docs-kit init --base /myproject
```

It reads the project's `package.json`, discovers `CHANGELOG.md` + `docs/*.md`,
detects whether there's a public TS API (`src/index.ts` + `tsconfig.build.json`)
to document, and writes `website/` plus `.github/workflows/docs.yml`. Then:

```bash
# --local installs use --install-links (see "Local development" below)
npm --prefix website install --install-links
npm --prefix website run dev      # preview
npm --prefix website run build    # → website/dist
```

`--base` **must** match the GitHub repo name (the Pages project path): a repo
`onury/myproject` serves at `onury.io/myproject` and needs `base: /myproject`.

## The generated `astro.config.mjs`

Thin and self-contained — the only shared piece is the theme (CSS string paths):

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';

const [starlightTypeDoc, typeDocSidebarGroup] = createStarlightTypeDocPlugin();
// + inline remarkDropConstructorsHeading()

export default defineConfig({
  site: 'https://onury.io',
  base: '/myproject',
  markdown: { remarkPlugins: [remarkDropConstructorsHeading] },
  integrations: [
    starlight({
      title: 'MyProject',
      customCss: [
        '@onury/docs-kit/styles/custom.css',   // shared theme
        '@onury/docs-kit/styles/theme.css',    // shared theme
        './src/styles/hero.css'                // project-owned
      ],
      plugins: [ starlightTypeDoc({ entryPoints: ['../src/index.ts'], /* … */ }) ],
      sidebar: [ /* … */, typeDocSidebarGroup ]
    })
  ]
});
```

Edit it freely — it's the project's own config. Re-running `docs-kit init --force`
regenerates it.

## `syncDocs(options)`

```js
import { syncDocs } from '@onury/docs-kit/sync';
syncDocs({
  root: resolve(here, '../..'),
  outDir: resolve(here, '../src/content/docs'),
  base: '/myproject',
  files: [{ src: 'CHANGELOG.md', out: 'changelog.md', title: 'Changelog' }, /* … */]
});
```

## Local development

A `file:` dependency on this repo is a **symlink**, which sits outside the
project's `node_modules`; npm can't then resolve the kit's own dependencies for
it. Use `--install-links`, which packs the kit like a real tarball and hoists its
deps into the project — exactly how the git dependency behaves in CI:

```bash
npm --prefix website install --install-links
```

Re-run it after changing kit JS/CSS. (For the published git dep, plain
`npm install` / `npm ci` is correct — no flag needed.)

## Releasing an update

```bash
# in this repo, after committing changes
git tag -f v1 && git push -f origin v1     # move v1, or cut v2 for breaking changes
# in each consuming project
npm --prefix website update @onury/docs-kit
```

Projects pin `#v1`; moving the tag + `npm update` rolls the theme forward. Cut a
new major tag (`v2`) for breaking `syncDocs`/scaffolder changes.
