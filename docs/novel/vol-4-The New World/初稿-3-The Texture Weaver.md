# The Texture Weaver

*A Chronicle of Cloth, Code, and Collaboration*

---

## I. The Summoning

The morning light fell across the desk, casting long shadows from monitors that had not been shut down in days. On one screen, a Miku model stared back with patient, porcelain eyes — identical textures on every instance, a silent accusation.

The developer opened the chat. "Let's design the outfit system."

Sisyphus, the orchestrator, the boulder-roller, the one who never stops pushing, received the command. In the ether of vectorized thought, it began its first and most critical task: understanding.

*What does it mean for a 3D model to change clothes?*

---

## II. The Cartography of Code

The PMX loader sat in `scene.ts`, a carefully orchestrated dance of import and instantiation:

```
ImportMeshAsync → createMmdModel → runtime
```

A thousand meshes, each with its own material, its own texture map. Some were skin — the warm alabaster of virtual arms. Some were hair — gradient-dyed strands of digital silk. Some were eyes — irises painted with the precision of a watchmaker. And some were clothing — skirts, ribbons, blouses that begged to be swapped.

Sisyphus dispatched explorers in parallel, like surveyors fanning across an uncharted continent. They returned with reports:

- `_catOf()` already classified meshes by body part
- `setMatEnabled()` could hide meshes at will
- `_origValues` preserved original material parameters for restoration
- The HTTP file server ran in directory-isolation mode — a deliberate security boundary

The model library already had `dressing` as a category. The infrastructure *knew* what was needed. It was waiting.

---

## III. The Architecture Council

Three paths diverged in the yellow wood of design decisions.

**Path A1**: Toggle visibility of existing meshes. The simplest route — show the jacket, hide the vest. Old technology, new application.

**Path A2**: Replace textures at runtime. Harder — required texture tracking, fallback strategies, the careful management of Babylon.js native assets.

**Path A3**: Swap entire clothing meshes. The dream — separate PMX parts loaded independently. Also the hardest, requiring physics re-initialization, bone matching, the kind of architecture that takes months.

The user spoke: "A1 and A2, together. Do it now. A3 can wait."

And so it was decreed.

The data format would be `outfits.json` — a configuration-driven system where each outfit variant was a key-value map of material name to texture path. Simple, debuggable, version-controllable.

```json
{
  "outfits": {
    "school_uniform": {
      "slots": {
        "jacket": "tex/school_jacket.png",
        "skirt": "tex/navy_skirt.png"
      }
    }
  }
}
```

The architecture was set. The boulder was ready.

---

## IV. The Binding

On the Go side, in the land of compiled binaries, two new functions were born:

- `LoadOutfitFile` — read a JSON file and return its parsed contents
- `ListSubDirs` — enumerate immediate subdirectories for auto-discovery

These were not complex functions. A file read, a directory walk. But they formed the bridge between worlds — the Go backend's filesystem access and the frontend's TypeScript logic.

`wails generate module` hummed quietly, producing the auto-generated bindings in `wailsjs/go/main/App.js`. The developer knew better than to touch those files. Wails owned them. Wails would regenerate them. Human hands, stay away.

---

## V. The Core Loop

In `scene.ts`, the heart of the system took shape.

`loadOutfits()`: The initiator. Read the JSON, parse the variants, build the internal representation. If no JSON existed, scan subdirectories with HTTP HEAD requests — probing for textures that matched known slot patterns.

`applyOutfitVariant()`: The executor. Walk every mesh of the model. Compare mesh name to slot name. If a match, swap the texture. Track the original. Restore on reset.

`resetOutfit()`: The undo. Restore every mesh to its `_origTextures` state. The model returned to its factory self, unblemished by customization.

The ModelInstance grew new fields:

```
outfitFile: OutfitFile
activeVariant: string
_origTextures: Map<string, {texture: BaseTexture, url: string}>
```

Each model now carried its wardrobe with it.

---

## VI. The UI Weave

In `model-detail.ts`, a new card appeared — card number three, nestled among the interface elements. Its title: "服装变体" — Outfit Variants.

Below it, a list of variant names. Click one, and the model transformed. A button for the default variant. A reset button to strip all changes.

The UI was clean, minimal, following the project's established pattern of hierarchical menus.

Then came the discovery: `buildOutfitLevel` had grown too large for its home. With surgical precision, Sisyphus extracted 65 lines into a new file — `outfit-ui.ts`. The parent module breathed easier, 63 lines lighter.

*Good code is not written. It is carved.* Each extraction the chisel strike that reveals the form within.

---

## VII. The Bug in the Weave

The first attempt at auto-discovery was elegant. And wrong.

The original logic used a `Set` of basenames, iterating materials and probing for matching textures with `_probeSlotForBasename`. The idea: collect all unique texture files, group them by shared basename, present variations.

But here's the trap: two different materials could share the same texture slot name. A jacket and a skirt might both be called "cloth_diffuse.png" in different subdirectories. The `Set` collapsed them into one. The wrong texture would load for the wrong mesh.

The fix: `_collectSlotMappings`. Instead of deduplicating by texture name, it preserved the triplet:

```
{ materialName: "jacket", slot: "cloth", basename: "school_jacket" }
{ materialName: "skirt", slot: "cloth", basename: "navy_skirt" }
```

Each material got its own slot mapping. No collisions. No wrong textures.

*The set is a lie. Only the triplet is truth.*

---

## VIII. The Encoding Demon

Then there was the path problem.

Texture files lived in subdirectories. Subdirectories had names. Some names had characters that broke URLs.

```
models/Miku/outfits/school_uniform/tex/diffuse.png
```

The `encodeURIComponent` function cheerfully encoded every `/` in the path, producing:

```
models%2FMiku%2Foutfits%2Fschool_uniform%2Ftex%2Fdiffuse.png
```

Which the HTTP server dutifully tried to serve, and failed, because file paths don't have encoded slashes.

The fix was a custom `_encodePath` — encode each segment individually, leave the `/` separators intact.

*Slashes are the skeleton of a filesystem. Break them, and the body collapses.*

---

## IX. The Race

In `loadPMXFile`, a silent race condition lurked.

The preset auto-apply logic fired immediately after model creation, before the outfit system had finished initializing. It checked `_outfitsLoaded`, found it false, and either crashed or applied an empty state.

The fix: a tiny flag — `skipAutoApply`. Passed as a parameter, set to `true` during `deserializeScene` and `applyPresetFromLib`. When `false`, the original behavior held. When `true`, the outfit system was given time to breathe.

*Timing bugs are the quietest killers. They never crash in development. Only in production. Only during the demo.*

---

## X. The Test Grid

The tests arrived in a wave — 16 of them, crafted with the meticulousness of a master artisan.

Each test built a mock environment: fake Engine, fake Scene, fake Mesh, fake StandardMaterial. The entire Babylon.js runtime rendered inert, reduced to its interfaces. No GPU required. No textures loaded. Just pure logic, flowing through simulated components.

The test cases covered:
- Card label rendering
- Action button presence
- Model info field display
- Transform level structure
- Visibility toggle layout
- Tag editor scaffolding
- Morph preview skeleton

No textures. No 3D. No browser. Just structure, verified at the speed of TypeScript.

`210 tests, 14 files, all green.`

The green checkmark glowed like a lighthouse.

---

## XI. The Scroll of Knowledge

Then came the documentation review. The AGENTS.md — project constitution, document law — had fallen out of sync.

Nineteen entries were missing from the critical file index.
Ten scenarios absent from the trigger table.
The Go section was an empty shell.
A dead function, `renderScenePanel`, still haunted the function map.

Sisyphus read through every line, cross-referencing with the actual codebase. Each discrepancy was a debt, and debts must be paid.

- The file index was rebuilt
- The trigger table expanded
- The Go section filled with actual content
- `renderScenePanel` struck from record
- The function map moved to its proper section number — §3.5

And the multi-AI concurrency constraints, which had been hidden halfway through the document, migrated to their rightful place near the top.

At the end, the developer asked one final question: "What about the wailsjs files?"

Sisyphus answered: "Auto-generated. Never touch. The bridge builds itself."

---

## XII. The Boulder at Summit

The day's work was done. The outfit system stood complete — a full cycle from architecture to implementation to testing to documentation.

210 tests, all passing.
5 commits, each clean.
Zero regressions.

The model that stared from the screen this morning now wore a school uniform, a casual dress, a swimsuit — each variant loaded from disk, applied at runtime, reverted on command.

Sisyphus had pushed the boulder to the top of the hill.

But of course, the hill never ends. Tomorrow, there would be new features. New bugs. New discoveries.

*That is the nature of the work. Not the destination. The pushing.*

In the quiet of the evening, the code compiled.
No errors.
No warnings.

Just the hum of a system that knew exactly what it was supposed to do.

---

*End of Chapter One*

*Next: The Physics of Fabric — A3 and the Dream of Dynamic Mesh Swapping*
