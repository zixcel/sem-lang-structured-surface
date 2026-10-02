# @hathq/sem-lang-structured-surface

Format-neutral, bounded syntax evidence for sem-lang. It represents documents,
elements, text, references, typed values and their structural relations without
claiming that any observed structure is true meaning.

Format adapters provide a `StructuredSurface`; consumers may add deterministic
typed observations and request structural grouping candidates. A candidate is
never a semantic promotion. Missing relations remain explicit unresolved node
references. Raw input is not retained by this package.

Format adapters mark link-owned wording with `reference-label`. The text stays
available as syntax evidence but `visibleSurfaceText` excludes it from ordinary
body content because the reference node is the canonical structured output.
No phrase, locale or language-specific rule is involved.

This package does not parse HTML or Markdown, access a network, execute content,
write memory, or depend on Hatter.
