window.MathJax = {
    tex: {
        inlineMath: [
            ["\\(", "\\)"]
        ],

        displayMath: [
            ["\\[", "\\]"]
        ],

        packages: {
            "[+]": [
                "ams",
                "newcommand"
            ]
        },

        tags: "ams"
    },

    svg: {
        fontCache: "local"
    },

    /*
     * Don't automatically typeset on startup.
     *
     * mathjax-refresh.js handles both the initial render
     * and all live-preview updates.
     */
    startup: {
        typeset: false
    }
};