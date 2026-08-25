# Development Guide

## Architecture

The add-on is a standard MarginNote 4 JSB extension. It runs inside MN4's
JavaScript sandbox and has access to the native app through `JSB` bridge APIs.

### Key files

| File | Role |
|---|---|
| `mnaddon.json` | Add-on manifest (ID, version, min MN version) |
| `main.js` | Entry point: loads AddonLib modules and calls `JSB.newAddon()` |
| `addon.js` | All business logic: settings UI, sync engine, timers |
| `runtime.js` | AddonLib runtime (lifecycle dispatch, route handling) |
| `mnutils.js` | AddonLib MNUtil (HTTP fetch, file I/O, UI helpers, MN4 DB access) |
| `mnnote.js` | AddonLib MNNote (MbBookNote / MbBook wrapper classes) |
| `subfunc.js` | AddonLib sub-function utilities |
| `vendor/` | Third-party libs (marked, pako, CryptoJS, segmentit, jsoneditor, etc.) |
| `data/` | Localization JSON (en.json, zh.json) |

### How the pieces connect

1. MN4 loads `main.js`
2. `main.js` calls `JSB.require("runtime")`, `JSB.require("mnutils")`, etc.
   These resolve the bundled AddonLib files.
3. `JSB.newAddon(__dirname)` triggers AddonLib's `addon.js`, which calls
   `JSB.defineClass("RuntimeAddon : JSExtension", {...})` to create the
   add-on class and register lifecycle hooks.
4. Our `addon.js` defines `DeepTutorSync : JSExtension` with its own
   lifecycle handlers (`sceneWillConnect`, `sceneDidDisconnect`).

## MN4 JSB gotchas

### Helper methods inside JSB.defineClass do not work as expected

Declaring plain JavaScript helper methods inside the object literal passed to
`JSB.defineClass` and then calling them via `this.helper()` or `self.helper()`
from lifecycle callbacks **does not reliably expose them as instance methods**.
Lifecycle callbacks and registered selectors are reachable, but ordinary helpers
may silently fail.

**Workarounds:**

- Keep helpers as top-level functions and pass the add-on instance explicitly:
  ```js
  function doSomething(addon) { ... }
  // In lifecycle:
  doSomething(self);
  ```

- Or assign helpers to the class prototype after `JSB.defineClass` returns:
  ```js
  var Cls = JSB.defineClass("MyAddon : JSExtension", { ... });
  Cls.prototype.myHelper = function() { ... };
  ```

This is an AddonLib / MN4 runtime limitation, not something we can fix here.

## AddonLib HTTP: MNUtil.fetchDev

MN4 does not have a standard `fetch` API. AddonLib provides two wrappers:

- `MNUtil.fetch(url, options)` -- legacy wrapper, returns raw data
- **`MNUtil.fetchDev(url, options)` -- preferred, returns a `Response` object**

Use `fetchDev` always. The `Response` object supports:

```js
var res = await MNUtil.fetchDev(url, {
  method: "POST",
  json: { key: "value" },
  headers: { "Authorization": "Bearer xxx" }
});

if (res && res.ok) {
  var data = res.json();  // parsed JSON object
  var text = res.text();  // raw string
  var status = res.status;  // HTTP status code
}
```

Important: `json()` and `text()` are **synchronous** getters (not async),
returning the value directly. They also cache the result internally.

## Extracting objects from MN4

### Notebooks and their types

```js
var notebooks = MNUtil.allNotebooks();
```

Each notebook has a `flags` field that determines its type:

| flags | Type | Notes |
|---|---|---|
| 1 | Document notebook | Source PDFs/EPUBs, contains `documents` and annotation `notes` |
| 2 | MindMap notebook | Study mindmaps, notes are mindmap nodes |
| 3 | Review group (FlashCard) | Spaced repetition cards |

### Accessing notes

```js
var notebooks = MNUtil.allNotebooks();
for (var i = 0; i < notebooks.length; i++) {
  var nb = notebooks[i];
  var notes = nb.notes;  // array of MbBookNote
  var docs = nb.documents;  // array of MbBook (source documents)
}
```

### MbBookNote key fields

| Field | Type | Description |
|---|---|---|
| `noteId` | string | Stable unique ID (use as `object_id` in sync) |
| `noteTitle` | string | User-visible title |
| `excerptText` | string | Highlighted/selected text from the document |
| `notesText` | string | All text content of the note |
| `docMd5` | string | MD5 of the source document |
| `notebookId` | string | Parent notebook ID |
| `startPage` | number | Page number where the excerpt starts |
| `colorIndex` | number | 0-15, maps to color names via lookup |
| `linkedNotes` | array | `[{noteid, linktext, summary}]` linked note references |
| `comments` | array | `[{commentText, ...}]` attached comments |
| `createDate` | Date | Creation timestamp |
| `modifiedDate` | Date | Last modification timestamp |
| `parentNote` | MbBookNote | Parent in the mindmap hierarchy |
| `childNotes` | MbBookNote[] | Children in the mindmap hierarchy |
| `tags()` | method | Returns `string[]` of tags (without `#` prefix) |
| `flashcard` | number | Whether the note has a flashcard |
| `summary` | number | Whether this is a summary card |

### Classifying a note's sync type

```js
function classifyNote(note) {
  var nbId = note.notebookId;
  if (!nbId) return "note";
  var nb = MNUtil.getNoteBookById(nbId);
  if (!nb) return "note";
  if (nb.flags === 3) return "card";
  if (nb.flags === 2) return "mindmap_node";
  return "note";
}
```

### Tags

`tags` is a **method**, not a property: `note.tags()` returns `string[]`.
Calling `note.tags` without `()` gives the function reference, not the array.

## DeepTutor sync API

The add-on talks to DeepTutor at `/api/v1/marginnote4/`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /sync` | `MarginNote <device_id>:<token>` | Push objects |
| `POST /heartbeat` | `MarginNote <device_id>:<token>` | Liveness ping |

Request body for `/sync`:

```json
{
  "cursor": "",
  "objects": [{ "object_id": "...", "object_type": "note", ... }],
  "deleted_ids": []
}
```

The server deduplicates by `(object_id, device_id)` on every sync, so
re-pushing the same note just updates the row. This means the add-on can
safely do a full re-read every sync cycle without tracking local changes.

## Building the .mnaddon

The `.mnaddon` file is a ZIP archive. Build it with:

```bash
zip -r mn4-deeptutor-sync.mnaddon \
  mnaddon.json main.js addon.js \
  runtime.js mnutils.js mnnote.js subfunc.js \
  vendor/ data/ assets/ pages/
```

AddonLib files must be included -- they are a hard runtime dependency.
Do NOT ship only `mnaddon.json`, `main.js`, and `addon.js`.
