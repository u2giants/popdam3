# Step 7 visual verification — scoped metadata UI (issue #96)

Captured 2026-08-27T0321Z UTC on `hetz`.

## What was verified, and against what

The real `ScopedTagSections` component was rendered against a **synthetic**
three-file Style Group using the harness at
`verification/ai-tagging-scope/harness/`. No licensed artwork, no production
data, and no database were involved — the harness is offline by construction.

Run it yourself with:

```bash
npx vite --config verification/ai-tagging-scope/harness/vite.config.ts
```

## Evidence

| File | Viewport | Shows |
|---|---|---|
| `scoped-tags-desktop-1440.png` | 1440x1000 | Three sibling files side by side |
| `scoped-tags-narrow-420.png` | 420x1000 | The same content in a narrow panel |
| `scoped-tags-file-scoped-action.png` | 420x1000 | The action produced by removing one file's tag |

## Whose view this is

The screenshots show the **admin** view. Adding, removing, or confirming a shared
Style Group fact — and confirming or restoring any suggestion — requires an admin
role, enforced on the server. A non-admin sees the same sections and the same
chips, minus those controls: the group chips have no remove control, the "Whole
Style Group" scope switch is not rendered, and confirm/restore are hidden. Their
own file tags stay fully editable. That gating is pinned by tests in
`src/test/scoped-tag-sections.test.tsx`, not by these images.

## Observations

1. **The Style Group block is identical on all three files** — drinkware,
   synthetic property, floral, plus the "gift" suggestion. Those facts are stored
   once on the group; nothing is copied onto the members.
2. **The "This file" block differs on every file.** The photograph carries
   professional photography / 3-4 view / blue. The tech pack carries tech pack /
   dimension callouts and **none** of the photograph's facts. This is the exact
   contamination the work removes.
3. **A file with no usable preview** says "Visual analysis unavailable — this file
   has no usable preview. It is still findable through its Style Group." rather
   than appearing untagged.
4. **Business-owned facts have no remove control.** `drinkware` (Master Data) and
   `synthetic property` (manual) render without an X; only AI facts can be
   rejected. The server refuses a Master Data rejection as well.
5. **Suggestions are separated from confirmed facts** at both scopes, with a
   confirm control, and a rejected fact ("pink") is shown struck through with a
   restore control.
6. **Editing defaults to "This file"**; "Whole Style Group" must be chosen
   deliberately.
7. **Narrow layout holds** — chips wrap, sections stack, nothing overflows.
8. **A file-scoped edit stays file-scoped.** Removing "blue" on the photograph
   emitted exactly `remove asset "blue"` for that file and left both siblings
   untouched.

## Not covered here

Live production rendering with real assets. That belongs to the Step 8 bounded
pilot, where evidence is captured against protected internal IDs rather than
committed to this repository.
