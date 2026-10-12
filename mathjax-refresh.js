"use strict";

(() => {
    const MATH_SELECTOR = ".native-mathjax-math";

    /*
     * Normal edits only need a tiny debounce because unchanged equations are
     * restored from an HTML cache and never sent through MathJax again.
     */
    const UPDATE_DELAY_MS = 80;

    /*
     * On first opening, VS Code can load this preview script before the initial
     * Markdown DOM (and, on some machines, before MathJax has fully finished
     * starting).  In that case there is no later update event until the user
     * edits the document.  Keep a short startup watch so the first real batch of
     * math nodes is rendered as soon as it appears.
     */
    const INITIAL_RETRY_DELAY_MS = 50;
    const INITIAL_RETRY_WINDOW_MS = 5000;

    /*
     * Macro definitions are stateful in MathJax 3.  When their source changes,
     * a fresh webview load is the safest way to discard the previous macro
     * table before processing the new preamble.
     */
    const MACRO_DEFINITION_RE = /(?:\\DeclareMathOperator\*?|\\(?:newcommand|renewcommand|providecommand|def|gdef|edef|xdef|let|newenvironment|renewenvironment)\b)/;

    /*
     * These constructs make the output depend on document-wide ordering.
     * If the sequence of math expressions changes while they are present, we
     * re-render all non-definition expressions so numbering/references remain
     * correct.
     */
    const GLOBAL_ORDER_RE = /(?:\\(?:label|ref|eqref|tag|notag|nonumber)\b|\\begin\s*\{(?:equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|flalign\*?)\})/;

    const renderedCache = new Map();

    let updateTimer = null;
    let initialRetryTimer = null;
    let initialWatchStopTimer = null;
    let initialObserver = null;
    let initialRetryDeadline = 0;

    let running = false;
    let rerunRequested = false;
    let initialized = false;

    let previousMacroSignature = null;
    let previousMathSequence = null;

    function getRoot() {
        return (
            document.querySelector(".markdown-body") ||
            document.querySelector(".markdown-preview") ||
            document.body
        );
    }

    function getMathNodes(root = getRoot()) {
        return Array.from(root.querySelectorAll(MATH_SELECTOR));
    }

    function mathJaxIsReady(MathJax = window.MathJax) {
        return Boolean(
            MathJax &&
            MathJax.startup &&
            MathJax.startup.promise &&
            typeof MathJax.typesetPromise === "function"
        );
    }

    function stopInitialWatch() {
        if (initialRetryTimer !== null) {
            clearTimeout(initialRetryTimer);
            initialRetryTimer = null;
        }

        if (initialWatchStopTimer !== null) {
            clearTimeout(initialWatchStopTimer);
            initialWatchStopTimer = null;
        }

        if (initialObserver) {
            initialObserver.disconnect();
            initialObserver = null;
        }
    }

    function scheduleInitialRetry() {
        if (
            initialized ||
            initialRetryDeadline === 0 ||
            Date.now() >= initialRetryDeadline
        ) {
            return;
        }

        if (initialRetryTimer !== null) {
            return;
        }

        initialRetryTimer = setTimeout(() => {
            initialRetryTimer = null;
            processPreviewUpdate();
        }, INITIAL_RETRY_DELAY_MS);
    }

    function watchForInitialMath() {
        if (initialized || initialObserver || !document.body) {
            return;
        }

        initialObserver = new MutationObserver(() => {
            if (initialized) {
                stopInitialWatch();
                return;
            }

            /*
             * Either MathJax has become ready or VS Code has inserted the first
             * rendered Markdown nodes.  Re-run the normal update path.  The
             * processPreviewUpdate() guard prevents duplicate concurrent work.
             */
            if (mathJaxIsReady() || getMathNodes().length > 0) {
                scheduleInitialRetry();
            }
        });

        initialObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function getTex(node) {
        try {
            return decodeURIComponent(node.dataset.nativeMathjaxTex || "");
        } catch (_) {
            return node.dataset.nativeMathjaxTex || "";
        }
    }

    function getKind(node) {
        return node.dataset.nativeMathjaxKind || "math";
    }

    function getKey(node) {
        return node.dataset.nativeMathjaxKey || "";
    }

    function cacheId(node, index) {
        /*
         * Include the document position.  This prevents two identical formulas
         * from reusing the same SVG markup (and therefore duplicate SVG ids).
         */
        return `${index}:${getKind(node)}:${getKey(node)}`;
    }

    function macroSignature(nodes) {
        return nodes
            .map((node) => getTex(node))
            .filter((tex) => MACRO_DEFINITION_RE.test(tex))
            .join("\u001e");
    }

    function mathSequence(nodes) {
        return nodes
            .map((node) => `${getKind(node)}:${getKey(node)}`)
            .join("\u001f");
    }

    function hasGlobalOrdering(nodes) {
        return nodes.some((node) => GLOBAL_ORDER_RE.test(getTex(node)));
    }

    function isDefinitionNode(node) {
        return MACRO_DEFINITION_RE.test(getTex(node));
    }

    function saveRenderedNodes(nodes) {
        nodes.forEach((node, index) => {
            renderedCache.set(cacheId(node, index), {
                tex: getTex(node),
                kind: getKind(node),
                html: node.innerHTML
            });
        });
    }

    function pruneCache(nodes) {
        const active = new Set(
            nodes.map((node, index) => cacheId(node, index))
        );

        for (const key of renderedCache.keys()) {
            if (!active.has(key)) {
                renderedCache.delete(key);
            }
        }
    }

    function restoreCachedNodes(nodes) {
        const misses = [];

        nodes.forEach((node, index) => {
            const id = cacheId(node, index);
            const entry = renderedCache.get(id);

            if (
                entry &&
                entry.tex === getTex(node) &&
                entry.kind === getKind(node)
            ) {
                node.innerHTML = entry.html;
            } else {
                misses.push(node);
            }
        });

        return misses;
    }

    function saveScrollForReload() {
        try {
            sessionStorage.setItem(
                "native-markdown-mathjax-scroll-y",
                String(window.scrollY)
            );
        } catch (_) {
            /* sessionStorage is optional in a webview. */
        }
    }

    function restoreScrollAfterReload() {
        try {
            const value = sessionStorage.getItem(
                "native-markdown-mathjax-scroll-y"
            );

            if (value !== null) {
                sessionStorage.removeItem(
                    "native-markdown-mathjax-scroll-y"
                );

                requestAnimationFrame(() => {
                    window.scrollTo(0, Number(value) || 0);
                });
            }
        } catch (_) {
            /* sessionStorage is optional in a webview. */
        }
    }

    function reloadForMacroDefinitions() {
        console.info(
            "[native-markdown-mathjax] Macro definitions changed; " +
            "performing a fresh MathJax preview load."
        );

        saveScrollForReload();
        window.location.reload();
    }

    async function initialFullRender(MathJax, root, nodes) {
        if (MathJax.typesetClear) {
            MathJax.typesetClear();
        }

        if (MathJax.texReset) {
            MathJax.texReset();
        }

        await MathJax.typesetPromise([root]);

        saveRenderedNodes(nodes);
        pruneCache(nodes);

        previousMacroSignature = macroSignature(nodes);
        previousMathSequence = mathSequence(nodes);
        initialized = true;

        restoreScrollAfterReload();
    }

    async function fullOrderSensitiveRender(MathJax, nodes) {
        /*
         * Macro definitions have not changed, so their effects are already in
         * MathJax's TeX state.  Re-processing them can cause duplicate-definition
         * errors.  Restore their rendered (usually empty) output from cache and
         * re-render only the other formulas after resetting equation labels.
         */
        if (MathJax.typesetClear) {
            MathJax.typesetClear();
        }

        if (MathJax.texReset) {
            MathJax.texReset();
        }

        const renderTargets = [];

        nodes.forEach((node, index) => {
            if (!isDefinitionNode(node)) {
                renderTargets.push(node);
                return;
            }

            const entry = renderedCache.get(cacheId(node, index));

            if (entry && entry.tex === getTex(node)) {
                node.innerHTML = entry.html;
            } else {
                /*
                 * This should only happen when a definition itself changed,
                 * which is handled by the fresh-load path.  Keep the source in
                 * place rather than risking a duplicate definition here.
                 */
                console.warn(
                    "[native-markdown-mathjax] Missing cache for a macro " +
                    "definition during an order-sensitive refresh."
                );
            }
        });

        if (renderTargets.length > 0) {
            await MathJax.typesetPromise(renderTargets);
        }

        saveRenderedNodes(nodes);
        pruneCache(nodes);
    }

    async function incrementalRender(MathJax, nodes) {
        /*
         * VS Code has already replaced/morphed the Markdown DOM by the time the
         * update event is fired.  Forget MathJax's references to the previous
         * DOM so its MathItem list cannot grow indefinitely.
         *
         * Calling typesetClear() does not remove the already-generated markup;
         * it only makes MathJax forget its bookkeeping for those old nodes.
         */
        if (MathJax.typesetClear) {
            MathJax.typesetClear();
        }

        const misses = restoreCachedNodes(nodes);

        if (misses.length > 0) {
            await MathJax.typesetPromise(misses);

            /*
             * Re-save all wrappers.  Cached wrappers are unchanged; newly
             * rendered wrappers now contribute their SVG/HTML to the cache.
             */
            saveRenderedNodes(nodes);
        }

        pruneCache(nodes);
    }

    async function processPreviewUpdate() {
        const MathJax = window.MathJax;

        /*
         * During the first preview load, the refresh script can run before the
         * MathJax startup promise/typesetter is ready.  Do not give up and wait
         * for a user edit; retry briefly instead.
         */
        if (!mathJaxIsReady(MathJax)) {
            if (!initialized) {
                scheduleInitialRetry();
            }
            return;
        }

        if (running) {
            rerunRequested = true;
            return;
        }

        running = true;

        try {
            await MathJax.startup.promise;

            const root = getRoot();
            const nodes = getMathNodes(root);

            if (!initialized) {
                /*
                 * A zero-node first pass usually means VS Code has not inserted
                 * the initial Markdown DOM yet.  Previously this marked the
                 * preview as initialized, so nothing rendered until the next
                 * keystroke fired vscode.markdown.updateContent.
                 */
                if (nodes.length === 0) {
                    scheduleInitialRetry();
                    return;
                }

                await initialFullRender(MathJax, root, nodes);
                stopInitialWatch();
                return;
            }

            const currentMacroSignature = macroSignature(nodes);
            const currentMathSequence = mathSequence(nodes);

            /*
             * Macro definitions are the exceptional path.  A fresh webview
             * resets MathJax's persistent macro table, then the normal initial
             * render registers the new definitions in document order.
             */
            if (currentMacroSignature !== previousMacroSignature) {
                reloadForMacroDefinitions();
                return;
            }

            const structureChanged =
                currentMathSequence !== previousMathSequence;

            if (structureChanged && hasGlobalOrdering(nodes)) {
                await fullOrderSensitiveRender(MathJax, nodes);
            } else {
                await incrementalRender(MathJax, nodes);
            }

            previousMacroSignature = currentMacroSignature;
            previousMathSequence = currentMathSequence;
        } catch (error) {
            console.error(
                "[native-markdown-mathjax] Preview update failed:",
                error
            );
        } finally {
            running = false;

            if (rerunRequested) {
                rerunRequested = false;
                scheduleUpdate();
            }
        }
    }

    function scheduleUpdate() {
        clearTimeout(updateTimer);

        updateTimer = setTimeout(() => {
            updateTimer = null;
            processPreviewUpdate();
        }, UPDATE_DELAY_MS);
    }

    window.addEventListener(
        "vscode.markdown.updateContent",
        scheduleUpdate
    );

    function initialRender() {
        /*
         * The initial Markdown body is populated asynchronously by VS Code.
         * Start both an immediate attempt and a short-lived observer/retry loop.
         * Normal live updates continue to use vscode.markdown.updateContent.
         */
        initialRetryDeadline = Date.now() + INITIAL_RETRY_WINDOW_MS;
        watchForInitialMath();

        if (initialWatchStopTimer !== null) {
            clearTimeout(initialWatchStopTimer);
        }

        initialWatchStopTimer = setTimeout(() => {
            initialWatchStopTimer = null;

            if (!initialized && initialObserver) {
                initialObserver.disconnect();
                initialObserver = null;
            }
        }, INITIAL_RETRY_WINDOW_MS);

        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
            updateTimer = null;
            processPreviewUpdate();
        }, 0);
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialRender,
            { once: true }
        );
    } else {
        initialRender();
    }
})();