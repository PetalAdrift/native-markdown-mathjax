# Native Markdown MathJax

MathJax support for **VS Code's native Markdown preview**.

This extension replaces the native KaTeX math-rendering path with MathJax 3 while keeping the standard VS Code Markdown preview. It is intended for mathematical notes that need broader TeX/AMS compatibility than KaTeX provides, while still working with custom CSS and JavaScript used by the native preview.

## Features

- MathJax 3 rendering in the native VS Code Markdown preview
- SVG math output using the bundled local MathJax runtime
- Inline math with `$...$` and `\(...\)`
- Display math with `$$...$$` and `\[...\]`
- True multiline `$$ ... $$` block support, including blank lines
- Support for explicit TeX math environments handled by `markdown-it-mathjax`
- AMS and `newcommand` MathJax packages enabled
- KaTeX-friendly `\gdef` source is transparently translated to MathJax-compatible `\def`
- Incremental live-preview updates:
  - unchanged equations are restored from cache
  - only changed equations are re-typeset in the normal case
  - document-wide numbering/reference-sensitive changes trigger a broader refresh
  - macro-definition changes trigger a fresh preview load so the MathJax macro state is clean
- Optional external TeX preamble file

## Requirements

- VS Code 1.85 or newer
- Node.js/npm is required only when building the extension from source

To avoid having multiple math renderers process the same document, disable the built-in VS Code KaTeX renderer:

```json
{
  "markdown.math.enabled": false
}
```

If **Markdown All in One** is installed, also disable its math renderer:

```json
{
  "markdown.math.enabled": false,
  "markdown.extension.math.enabled": false
}
```

## Installation

### Install from a VSIX

In VS Code, run:

1. `Extensions: Install from VSIX...`
2. Select the generated `.vsix`
3. Run `Developer: Reload Window`

You can also install from a terminal:

```powershell
code --install-extension .\native-markdown-mathjax-0.0.10.vsix --force
```

### Build from source

From the extension directory:

```powershell
npm install
npx vsce package --allow-missing-repository
```

This creates:

```text
native-markdown-mathjax-0.0.10.vsix
```

Then install it:

```powershell
code --install-extension .\native-markdown-mathjax-0.0.10.vsix --force
```

Reload VS Code afterward.

### Rebuilding

First uninstall (if applicable) the currently installed copy

```powershell
code --uninstall-extension roselle.native-markdown-mathjax
```

From the extension directory

```powershell
# Windows
Remove-Item .\node_modules -Recurse -Force
Remove-Item .\package-lock.json -Force -ErrorAction SilentlyContinue
```
or
```bash
# Linux/macOS
rm -rf ./node_modules
rm -f ./package-lock.json
```

Then reinstall with

```powershell
npm install
```

### Reproducible (re)building

With `./package-lock.json` in the extension direction, use

```bash
rm -rf ./node_modules
npm ci
```

## Usage

Open any Markdown file and use the ordinary VS Code commands:

- `Markdown: Open Preview`
- `Markdown: Open Preview to the Side`

For example:

```markdown
Inline math: $e^{i\pi}+1=0$.

$$
\int_0^1 x^2\,\mathrm{d}x = \frac13
$$
```

Multiline display math is also supported:

```markdown
$$
\begin{aligned}
a &= b+c,\\
d &= e+f.
\end{aligned}
$$
```

## Macro definitions

The extension supports persistent TeX definitions in the Markdown source.

For portability with KaTeX-oriented source files, you may write:

```markdown
$$
\gdef\R{\mathbb{R}}
\gdef\vol{\operatorname{vol}}
$$

Let $x\in\R$ and consider $\vol(M)$.
```

The extension keeps the Markdown source unchanged and converts `\gdef` to `\def` only for MathJax rendering.

This is useful because KaTeX supports `\gdef`, while the MathJax 3 `newcommand` extension used here expects `\def`.

## External preamble file

A TeX macro preamble can optionally be stored outside the Markdown document.

Set:

```json
{
  "nativeMarkdownMathJax.preambleFile": "math-preambles.tex"
}
```

Relative paths are resolved against the workspace folder that contains the Markdown document. If the Markdown file is opened without a workspace, the path is resolved against the directory containing that `.md` file. This means a loose file can simply sit beside its preamble:

```text
notes/
├── notes.md
└── math-preambles.tex
```

with the same setting:

```json
{
  "nativeMarkdownMathJax.preambleFile": "math-preambles.tex"
}
```

You may also use `${workspaceFolder}` explicitly. When no workspace exists, it falls back to the Markdown document directory:

```json
{
  "nativeMarkdownMathJax.preambleFile": "${workspaceFolder}/math-preambles.tex"
}
```

Or use `${documentDir}` when you always want the path to be relative to the Markdown document itself, even when it is inside a workspace:

```json
{
  "nativeMarkdownMathJax.preambleFile": "${documentDir}/math-preambles.tex"
}
```

The preamble file should contain raw TeX definitions without surrounding `$$` delimiters:

```tex
\gdef\R{\mathbb{R}}
\gdef\C{\mathbb{C}}
\gdef\vol{\operatorname{vol}}
```

The file is read again when the Markdown renderer runs, so edits to the preamble are picked up by subsequent preview updates.

If you prefer the preamble to remain entirely document-folder-local without using this setting, a separate folder-local loader can also be used; that workflow is independent of the extension itself.

## Live-preview behavior

VS Code regenerates Markdown preview HTML whenever the document changes. Re-running MathJax across the whole document on every keystroke can become noticeably slow for math-heavy notes.

This extension therefore uses incremental rendering:

- unchanged formulas reuse cached rendered output
- newly added or edited formulas are re-typeset
- ordinary prose edits generally require no MathJax work
- edits to macro definitions such as `\def`, `\gdef`, `\newcommand`, or `\DeclareMathOperator` force a fresh preview load
- changes involving equation labels, references, tags, or numbered AMS environments can trigger a document-wide math refresh

This is intended to keep normal editing responsive without giving up MathJax's stateful macro behavior.

## Supported syntax

The extension is designed to handle the common Markdown/TeX forms:

```text
$ ... $
$$ ... $$
\( ... \)
\[ ... \]
```

and math environments supported by the underlying MathJax/markdown-it integration.

MathJax is configured with:

- `ams`
- `newcommand`
- AMS equation tags

SVG output uses a local font cache.

## Exporting HTML

The extension's main target is VS Code's native Markdown preview.

Markdown exporters vary in how they handle `markdown.previewScripts`. If an exporter includes the Markdown-it transformation but does not include the MathJax preview scripts, the exported HTML may require a separate bundling step.

For a fully self-contained HTML document, make sure the final export contains:

- the MathJax runtime
- the MathJax configuration
- any preview refresh/runtime code required by your workflow
- custom CSS/JavaScript
- any external macro preamble or folder-local preamble loader

## Troubleshooting

### Math renders twice or looks corrupted

Make sure the other math renderers are disabled:

```json
{
  "markdown.math.enabled": false,
  "markdown.extension.math.enabled": false
}
```

Then run `Developer: Reload Window`.

### Preview does not open

Open:

```text
Developer: Show Logs...
```

and inspect **Extension Host** for entries containing:

```text
native-markdown-mathjax
```

Also verify that the extension is installed:

```powershell
code --list-extensions --show-versions
```

You should see an entry similar to:

```text
local.native-markdown-mathjax@0.0.10
```

### Macro changes do not immediately appear

Macro definitions are stateful. The extension intentionally reloads the preview when it detects a macro-definition change so MathJax starts with a clean TeX state.

### `\DeclareMathOperator` and similar commands

MathJax's AMS support is enabled. For source that should also remain KaTeX-compatible, prefer portable definitions such as:

```tex
\gdef\vol{\operatorname{vol}}
```

when practical.

## Development

The extension consists of three main pieces:

- `extension.js` — integrates with VS Code's `markdown-it` renderer and emits MathJax-ready markup
- `mathjax-config.js` — configures MathJax 3
- `mathjax-refresh.js` — performs incremental live-preview rendering and caching

Runtime dependencies:

```text
markdown-it-mathjax
mathjax
```

Packaging uses:

```text
@vscode/vsce
```

To rebuild after editing the source:

```powershell
npm install
npx vsce package --allow-missing-repository
```

Then reinstall the generated VSIX with `--force` and reload the VS Code window.

## Notes

This is a local extension intended for the native VS Code Markdown preview. It does not modify Markdown files and does not require a network connection for MathJax rendering.
