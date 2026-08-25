# mn4-deeptutor-sync

MarginNote 4 add-on that syncs notes, excerpts, flashcards, mindmap nodes,
and documents to a [DeepTutor](https://github.com/evan188199-tech/DeepTutor) instance.

## How it works

1. DeepTutor acts as the sync server (HTTP bridge at `/api/v1/marginnote4/`).
2. This add-on reads all notebooks in MarginNote 4 and pushes objects to the
   server via incremental sync batches.
3. Once synced, DeepTutor can search, read, and explore your MN4 library
   through its AI-powered study tools.

## Setup

### Prerequisites

- **MarginNote 4** (macOS or iPadOS)
- **[AddonLib](https://github.com/evan188199-tech/AddonLib)** installed (provides
  the runtime, `MNUtil`, `MNNote`, and HTTP fetch capabilities)
- A running **DeepTutor** instance (v1.5.16+)

### Install

1. Download `mnaddon.json`, `main.js`, `addon.js` from the latest
   [release](https://github.com/evan188199-tech/mn4-deeptutor-sync/releases).
2. Select all three files and open them with MarginNote 4 (or drag them into
   the MN4 window). The add-on will install automatically.
3. Restart MarginNote 4 if prompted.

### Configure

1. In DeepTutor, create a new Knowledge Base and choose **Link existing >
   MarginNote 4**.
2. Open the **Devices** tab and click **Pair a device**. Copy the
   `device_id:token` credential.
3. In MarginNote 4, tap the add-on toolbar icon (or find **DeepTutor Sync
   Settings** in the add-on menu).
4. Enter:
   - **Server URL**: your DeepTutor address (e.g. `http://localhost:4173`)
   - **Device Name**: a label like "My MacBook"
   - **Device ID : Token**: paste the credential from step 2
5. Click **Save & Enable**.

### Sync behavior

- **Initial sync**: reads all notebooks and pushes every object.
- **Incremental sync**: re-reads all notebooks every 60 seconds and pushes
  changes (DeepTutor deduplicates by `object_id` on the server side).
- **Heartbeat**: sends a liveness ping every 5 minutes.
- You can also tap **Sync Now** in the settings panel to trigger an immediate
  sync.

## Object types synced

| MN4 Entity | Sync type | Fields |
|---|---|---|
| Highlight / annotation | `note` | title, excerpt, page, document, tags, links, color |
| Flashcard | `card` | title, content (front), tags, links, color |
| Mindmap node | `mindmap_node` | title, content, tags, links, color |
| Source document | `document` | title, document_id |
| Comment | `comment` | text |

## Development

This add-on depends on [AddonLib](https://github.com/evan188199-tech/AddonLib)
for the MN4 runtime, `MNUtil` (HTTP, storage, UI), and `MNNote` (object
wrappers). Make sure AddonLib is installed first.

### Project structure

```
mnaddon.json  - Add-on manifest
main.js       - Entry point: loads AddonLib modules and bootstraps the add-on
addon.js      - Core logic: settings UI, sync engine, timer management
```

### Building a `.mnaddon` bundle

A `.mnaddon` file is a ZIP archive containing the add-on files. To create
one from the source:

```bash
zip -r mn4-deeptutor-sync.mnaddon mnaddon.json main.js addon.js
```

## Contributing

Pull requests are welcome. Please open an issue first to discuss what you
would like to change.

## License

MIT
