<link rel="stylesheet" href="markdown-sticky-notes-style.css">
<script src="markdown-sticky-notes-style.js"></script>

# a sample Markdown file for native-markdown-mathjax

## some simple \$ ... \$ and \$\$ ... \$\$ equations

This is an example of a simple inline math equation, $a^2 + b^2 = c^2$.

This is an example of a simple display math equation,
$$
r_\pm = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}.
$$

## some custom commands

An equation where we use custom-defined operators in `sample-math-preambles.tex`:
\begin{equation*}
    \id\colon A \to A, a \mapsto a.
\end{equation*}

Note that this requires manually setting
```
"nativeMarkdownMathJax.preambleFile": "sample-math-preambles.tex"
```
in user settings.

## equation referencing

Here we write an important equation and a bad version of it,
\begin{equation}
    E = m c^2 \label{eq:einstein}
\end{equation}
and
\begin{equation}
    E = m c^2 + \text{AI}. \tag{bad} \label{eq:bad}
\end{equation}

Then, we may reference them as $\eqref{eq:einstein}$ and $\eqref{eq:bad}$.