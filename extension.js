"use strict";

const markdownItMathjax = require("markdown-it-mathjax");
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");


function getCurrentMarkdownUri(env) {
    if (env && env.currentDocument) {
        return env.currentDocument;
    }

    const editor = vscode.window.activeTextEditor;

    if (
        editor &&
        editor.document &&
        editor.document.languageId === "markdown" &&
        editor.document.uri &&
        editor.document.uri.scheme !== "untitled"
    ) {
        return editor.document.uri;
    }

    return null;
}

function resolvePreamblePath(configuredPath, currentDocument) {
    if (!configuredPath || !String(configuredPath).trim()) {
        return null;
    }

    let value = String(configuredPath).trim();

    const documentUri = currentDocument || null;
    const documentPath = (
        documentUri &&
        documentUri.scheme !== "untitled" &&
        documentUri.fsPath
    ) ? documentUri.fsPath : null;

    const documentDir = documentPath
        ? path.dirname(documentPath)
        : null;

    /*
     * Prefer the workspace folder that actually owns this Markdown file.
     * This fixes multi-root workspaces as well as the no-workspace case.
     */
    const documentWorkspace = documentUri
        ? vscode.workspace.getWorkspaceFolder(documentUri)
        : undefined;

    const folders = vscode.workspace.workspaceFolders || [];
    const workspaceRoot = documentWorkspace
        ? documentWorkspace.uri.fsPath
        : (folders.length > 0 ? folders[0].uri.fsPath : null);

    /*
     * For a loose Markdown file (no workspace), treating its own directory as
     * ${workspaceFolder} mirrors VS Code's own Markdown path behavior and
     * makes a setting such as "math-preambles.tex" portable with the file.
     */
    const effectiveRoot = workspaceRoot || documentDir;

    if (effectiveRoot) {
        value = value.replace(/\$\{workspaceFolder\}/g, effectiveRoot);
    }

    if (documentDir) {
        value = value.replace(/\$\{documentDir\}/g, documentDir);
    }

    if (path.isAbsolute(value)) {
        return path.normalize(value);
    }

    if (workspaceRoot) {
        return path.resolve(workspaceRoot, value);
    }

    if (documentDir) {
        return path.resolve(documentDir, value);
    }

    /*
     * Last-resort behavior for renderers that provide neither a document URI
     * nor a workspace.  This preserves the old behavior instead of failing.
     */
    return path.resolve(value);
}

function loadExternalPreamble(env) {
    const config = vscode.workspace.getConfiguration("nativeMarkdownMathJax");
    const configuredPath = config.get("preambleFile", "");
    const currentDocument = getCurrentMarkdownUri(env);
    const resolved = resolvePreamblePath(configuredPath, currentDocument);

    if (!resolved) {
        return "";
    }

    try {
        return fs.readFileSync(resolved, "utf8");
    } catch (error) {
        const documentLabel = currentDocument
            ? currentDocument.toString()
            : "<unknown document>";

        console.error(
            `[native-markdown-mathjax] Could not read preamble file: ${resolved} ` +
            `(document: ${documentLabel})`,
            error
        );
        return "";
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttribute(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/* Small deterministic cache-key hash. */
function hashString(text) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
}


/*
 * KaTeX supports \gdef and uses it for definitions that persist between
 * separately-rendered expressions. MathJax 3's newcommand extension does
 * not implement \gdef; its persistent page-level definition command is
 * simply \def.
 *
 * Keep the Markdown source KaTeX-friendly, but translate this one command
 * before it reaches MathJax.  The original TeX is retained in data-*
 * attributes for cache keys and change detection.
 */
function mathJaxCompatTex(tex) {
    return String(tex).replace(/\\gdef\b/g, "\\def");
}

function renderMathHtml(kind, tex, open, close, tag = "span") {
    const key = hashString(`${kind}\u0000${tex}`);
    const encodedTex = encodeURIComponent(tex);
    const mathJaxTex = mathJaxCompatTex(tex);

    return (
        `<${tag} class="native-mathjax-math native-mathjax-${kind}" ` +
        `data-native-mathjax-kind="${escapeAttribute(kind)}" ` +
        `data-native-mathjax-key="${escapeAttribute(key)}" ` +
        `data-native-mathjax-tex="${escapeAttribute(encodedTex)}">` +
        `${open}${escapeHtml(mathJaxTex)}${close}` +
        `</${tag}>`
    );
}

function renderMathToken(kind, open, close, tag = "span") {
    return (tokens, idx) => {
        const tex = tokens[idx].content || "";
        return renderMathHtml(kind, tex, open, close, tag);
    };
}

/*
 * markdown-it-mathjax@2 parses $$...$$ as an INLINE rule.  That works for
 * short same-paragraph expressions but is fragile for the normal Markdown
 * block form
 *
 *     $$
 *     ...many lines, including blank lines...
 *     $$
 *
 * because markdown-it splits paragraphs before inline rules run.
 *
 * This real BLOCK rule consumes a delimiter line containing only $$ and the
 * matching closing delimiter line.  Blank lines and TeX comments inside are
 * therefore safe.  The old plugin remains installed for $...$, same-line
 * $$...$$, \\(...\\), \\[...\\], and explicit TeX environments.
 */
function displayMathBlock(state, startLine, endLine, silent) {
    if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
    }

    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const startMax = state.eMarks[startLine];
    const opening = state.src.slice(startPos, startMax).trim();

    if (opening !== "$$") {
        return false;
    }

    let nextLine = startLine + 1;
    let foundClose = false;

    while (nextLine < endLine) {
        const pos = state.bMarks[nextLine] + state.tShift[nextLine];
        const max = state.eMarks[nextLine];
        const line = state.src.slice(pos, max).trim();

        if (line === "$$") {
            foundClose = true;
            break;
        }

        nextLine++;
    }

    if (!foundClose) {
        return false;
    }

    if (silent) {
        return true;
    }

    const contentLines = [];

    for (let line = startLine + 1; line < nextLine; line++) {
        const pos = state.bMarks[line];
        const max = state.eMarks[line];
        contentLines.push(state.src.slice(pos, max));
    }

    const token = state.push("display_math_block", "math", 0);
    token.block = true;
    token.markup = "$$";
    token.map = [startLine, nextLine + 1];
    token.content = contentLines.join("\n");

    state.line = nextLine + 1;
    return true;
}

function activate() {
    console.log("[native-markdown-mathjax] activated");

    return {
        extendMarkdownIt(md) {
            console.log("[native-markdown-mathjax] installing math parser");

            /*
             * Register the block rule BEFORE markdown-it creates paragraphs,
             * then keep markdown-it-mathjax for inline/delimiter handling.
             */
            md.block.ruler.before(
                "paragraph",
                "native_mathjax_display_block",
                displayMathBlock,
                { alt: ["paragraph", "reference", "blockquote", "list"] }
            );

            md.use(markdownItMathjax());

            md.renderer.rules.inline_math = renderMathToken(
                "inline",
                "\\(",
                "\\)"
            );

            md.renderer.rules.display_math = renderMathToken(
                "display",
                "\\[",
                "\\]"
            );

            md.renderer.rules.display_math_block = renderMathToken(
                "display",
                "\\[",
                "\\]",
                "div"
            );

            /* Explicit TeX environments already include their markers. */
            md.renderer.rules.math = renderMathToken(
                "environment",
                "",
                ""
            );

            /*
             * Prepend the configured external preamble as a hidden MathJax
             * expression.  Because it is part of the renderer output, the
             * definitions are processed before all document math without
             * adding any macro block to the Markdown source itself.
             */
            const originalRender = md.renderer.render.bind(md.renderer);

            md.renderer.render = (tokens, options, env) => {
                const body = originalRender(tokens, options, env);
                const preamble = loadExternalPreamble(env);

                if (!preamble.trim()) {
                    return body;
                }

                const preambleHtml = renderMathHtml(
                    "preamble",
                    preamble,
                    "\\[",
                    "\\]",
                    "span"
                );

                return (
                    `<span class="native-mathjax-preamble-container" ` +
                    `style="display:none">${preambleHtml}</span>` +
                    body
                );
            };

            return md;
        }
    };
}

function deactivate() {}

exports.activate = activate;
exports.deactivate = deactivate;
