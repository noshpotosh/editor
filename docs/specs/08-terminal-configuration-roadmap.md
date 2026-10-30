# Spec 8: Terminal Configuration Roadmap

The current foundation is VS Code settings with live terminal appearance updates, upstream VS Code themes by default (plus opt-in VS NOSH Dark/Light), global leader navigation, and Vim scrollback copy mode. The following are roadmap items, not implemented capabilities or compatibility claims.

| Capability | Required design and implementation |
| --- | --- |
| Single config file and live reload | Define schema, precedence over VS Code settings, validation, migration, and reload/error behavior. |
| Key tables | Named modal tables, chords, timeouts, discoverable help, per-surface routing, and conflict diagnostics. |
| Per-profile themes | Bind font, padding, palette, and cursor settings to terminal profiles without changing editor/window themes. |
| Background opacity and blur | Native macOS vibrancy with accessible contrast, per-window controls, and rendering performance checks. |
| Global-hotkey quick terminal | Main-process shortcut registration, focus restoration, multiple displays, and secure-input behavior. |
| Native splits and panes | Session-owned split trees, keyboard navigation, resize, persistence, and process lifecycle rules. |
| Quick-select / hint mode | Recognize links, paths, and arbitrary patterns with keyboard labels and copy/open actions. |
| Font fallback and features | Explicit fallback lists, ligatures and OpenType controls, wide-cell/emoji validation, and font diagnostics. |
| Cursor shaders | Define renderer support, performance budgets, reduced-motion behavior, and safe fallbacks. |
| SSH domains and multiplexer persistence | Connection identity, reconnection, credential boundaries, remote CLI routing, and detached session ownership. |
| Theme import | Ghostty, iTerm2, and base16 parsers with ANSI mapping, validation, previews, and export. |

Existing VS Code terminal settings remain available where they do not violate session ownership. New configuration must preserve local shell input, accessibility, and high-contrast themes. The roadmap does not imply full Ghostty or WezTerm configuration compatibility.
