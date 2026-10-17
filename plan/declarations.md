# Declarations as zodly documents

Status: implemented — declarations are zodly documents (see `docs/service-guide.md` § Declarations); open items below

## Open items

1. **`torchlight-sales` declares its services in the old form** (`services/claude.js`, `services/obsidian.js`): tag lists, `[['type', …]]` outputs and `['object', {shape}]`. Each compiles to a `malformed-declaration` until migrated.
2. **MicroQL imports `zodly`, but depends on `@tlsft/zodly`.** `package.json` names the scoped package, while the code imports `'zodly'`, which resolves only through the local `node_modules/zodly` link. Installed from npm, it won't resolve.
3. **The `reserve` tag is read but used nowhere.** Core accepts it and documents it; nothing acts on it.
4. **A tag-only field is verbose:** `['any', 'optional', {tags: ['target']}]` where it was `['target']` (see zodly's open question on `any`).
