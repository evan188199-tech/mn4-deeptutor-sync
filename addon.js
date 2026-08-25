/* DeepTutor Sync - MarginNote 4 add-on
 * Syncs notes, excerpts, cards, and documents to a DeepTutor instance.
 * Depends on AddonLib (runtime.js, mnutils.js, mnnote.js, addon.js).
 */

const SETTINGS_KEY = "deeptutor_sync_settings"

let _syncTimer = null
let _heartbeatTimer = null
const SYNC_INTERVAL_MS = 60 * 1000  // 1 min
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000  // 5 min
const BATCH_SIZE = 500

// -- Persistence ----------------------------------------------------------

function loadSettings() {
  try {
    const raw = MNUtil.readFromFile(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    MNUtil.log({ level: "error", message: "Failed to load settings", detail: String(e) })
  }
  return { serverUrl: "", deviceId: "", token: "", deviceName: "", enabled: false }
}

function saveSettings(s) {
  try {
    MNUtil.writeToFile(SETTINGS_KEY, JSON.stringify(s))
  } catch (e) {
    MNUtil.log({ level: "error", message: "Failed to save settings", detail: String(e) })
  }
}

// -- HTTP helpers ---------------------------------------------------------

async function dtFetch(path, options = {}) {
  const settings = loadSettings()
  if (!settings.serverUrl) throw new Error("Server URL not configured")
  const base = settings.serverUrl.replace(/\/+$/, "")
  const url = base + path
  const headers = { ...options.headers }
  if (settings.deviceId && settings.token) {
    headers["Authorization"] = "MarginNote " + settings.deviceId + ":" + settings.token
  }
  if (headers["Content-Type"] === undefined && options.json) {
    headers["Content-Type"] = "application/json"
  }
  return MNUtil.fetchDev(url, { ...options, headers })
}

// -- Object extraction from MN4 ------------------------------------------

const COLOR_MAP = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"]

function noteColor(note) {
  if (note.colorIndex != null && note.colorIndex < COLOR_MAP.length) {
    return COLOR_MAP[note.colorIndex]
  }
  return null
}

function tagsFor(note) {
  try {
    return note.tags ? note.tags() : []
  } catch (e) {
    return []
  }
}

function linksFor(note) {
  try {
    if (!note.linkedNotes) return []
    return note.linkedNotes.map(function (ln) { return ln.noteid })
  } catch (e) {
    return []
  }
}

function isoDate(d) {
  if (!d) return ""
  try {
    if (d instanceof Date) return d.toISOString()
    return String(d)
  } catch (e) {
    return ""
  }
}

function classifyNote(note) {
  const nbId = note.notebookId
  if (!nbId) return { type: "note" }
  const nb = MNUtil.getNoteBookById(nbId)
  if (!nb) return { type: "note" }
  const flags = nb.flags
  // 3 = FlashCard review group, 2 = MindMap
  if (flags === 3) return { type: "card", documentTitle: nb.title }
  if (flags === 2) return { type: "mindmap_node", documentTitle: nb.title }
  return { type: "note", documentTitle: nb.title }
}

function noteToSyncObject(note) {
  const cls = classifyNote(note)
  const docId = note.docMd5 || null
  const docTitle = cls.documentTitle || null
  const page = note.startPage || null
  const excerpt = note.excerptText || null
  const content = note.notesText || note.excerptText || ""
  const title = note.noteTitle || ""
  const tags = tagsFor(note)
  const links = linksFor(note)
  const color = noteColor(note)
  const createdAt = isoDate(note.createDate)
  const updatedAt = isoDate(note.modifiedDate)
  const comments = (note.comments || []).map(function (c) {
    return c.commentText || ""
  }).filter(Boolean)

  return {
    object_id: note.noteId,
    object_type: cls.type,
    title: title,
    content: content,
    excerpt: excerpt,
    document_id: docId,
    document_title: docTitle,
    page: page,
    tags: tags,
    links: links,
    color: color,
    created_at: createdAt,
    updated_at: updatedAt,
    comments: comments,
    raw: {}
  }
}

function documentToSyncObject(doc) {
  return {
    object_id: doc.docMd5,
    object_type: "document",
    title: doc.title || "(untitled)",
    content: "",
    excerpt: null,
    document_id: doc.docMd5,
    document_title: doc.title || "(untitled)",
    page: null,
    tags: [],
    links: [],
    color: null,
    created_at: "",
    updated_at: "",
    raw: {}
  }
}
}

// -- Collect objects from all notebooks ----------------------------------

function collectAllObjects() {
  const objects = []
  const notebooks = MNUtil.allNotebooks()
  for (let i = 0; i < notebooks.length; i++) {
    const nb = notebooks[i]
    if (!nb.notes) continue
    const notes = nb.notes
    for (let j = 0; j < notes.length; j++) {
      try {
        objects.push(noteToSyncObject(notes[j]))
      } catch (e) {
        MNUtil.log({ level: "warning", message: "Skipping note", detail: String(e) })
      }
    }
    // Documents
    if (nb.documents) {
      for (let k = 0; k < nb.documents.length; k++) {
        try {
          objects.push(documentToSyncObject(nb.documents[k]))
        } catch (e) {
          // skip
        }
      }
    }
  }
  return objects
}

// -- Sync engine ----------------------------------------------------------

async function sendHeartbeat() {
  try {
    const res = await dtFetch("/api/v1/marginnote4/heartbeat")
    if (!res || !res.ok) {
      MNUtil.log({ level: "warning", message: "Heartbeat failed", detail: res ? String(res.status) : "no response" })
    }
  } catch (e) {
    MNUtil.log({ level: "warning", message: "Heartbeat error", detail: String(e) })
  }
}

async function syncOnce() {
  const settings = loadSettings()
  if (!settings.enabled || !settings.serverUrl || !settings.deviceId || !settings.token) {
    return
  }

  const objects = collectAllObjects()
  if (objects.length === 0) {
    MNUtil.log({ level: "debug", message: "No objects to sync" })
    return
  }

  // Page through in batches
  let offset = 0
  let totalStored = 0
  let totalUpdated = 0

  while (offset < objects.length) {
    const batch = objects.slice(offset, offset + BATCH_SIZE)
    offset += BATCH_SIZE

    try {
      const res = await dtFetch("/api/v1/marginnote4/sync", {
        method: "POST",
        json: {
          cursor: "",
          objects: batch,
          deleted_ids: []
        }
      })
      if (res && res.ok) {
        const data = res.json()
        totalStored += (data && data.stored) || 0
        totalUpdated += (data && data.updated) || 0
      } else {
        MNUtil.log({
          level: "error",
          message: "Sync request failed",
          detail: res ? ("HTTP " + res.status) : "no response"
        })
        return
      }
    } catch (e) {
      MNUtil.log({ level: "error", message: "Sync error", detail: String(e) })
      return
    }
  }

  MNUtil.log({
    level: "info",
    message: "Sync completed",
    detail: totalStored + " new, " + totalUpdated + " updated (" + objects.length + " total)"
  })
}

// -- Timer management ----------------------------------------------------

function stopTimers() {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null }
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
}

function startTimers() {
  stopTimers()
  const settings = loadSettings()
  if (!settings.enabled) return
  syncOnce()  // immediate first sync
  _syncTimer = setInterval(syncOnce, SYNC_INTERVAL_MS)
  _heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
}

// -- Settings UI ---------------------------------------------------------

function settingsPageHTML(settings) {
  const connected = settings.deviceId && settings.token
  const statusText = settings.enabled
    ? (connected ? "Syncing" : "Not paired")
    : "Disabled"
  const statusColor = settings.enabled && connected ? "#4caf50" : (settings.enabled ? "#ff9800" : "#999")

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + 'body { font-family: -apple-system, sans-serif; padding: 16px; margin: 0; background: #fff; color: #333; }'
    + 'h2 { margin: 0 0 16px; font-size: 17px; font-weight: 600; }'
    + '.field { margin-bottom: 12px; }'
    + 'label { display: block; font-size: 12px; font-weight: 500; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }'
    + 'input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; outline: none; transition: border-color 0.2s; }'
    + 'input:focus { border-color: #4a90d9; }'
    + '.status { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 12px; font-weight: 500; color: #fff; background: ' + statusColor + '; margin-bottom: 16px; }'
    + '.btn { display: inline-block; padding: 8px 20px; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; color: #fff; margin-right: 8px; }'
    + '.btn-primary { background: #4a90d9; }'
    + '.btn-danger { background: #e74c3c; }'
    + '.btn-success { background: #4caf50; }'
    + '.btn-secondary { background: #999; }'
    + '.hint { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.5; }'
    + '.token-row { display: flex; gap: 8px; align-items: flex-end; }'
    + '.token-row input { flex: 1; }'
    + '.footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; }'
    + '</style></head><body>'
    + '<h2>DeepTutor Sync</h2>'
    + '<span class="status">' + statusText + '</span>'
    + '<div class="field"><label>DeepTutor Server URL</label>'
    + '<input id="serverUrl" type="url" placeholder="http://localhost:4173" value="' + (settings.serverUrl || "") + '">'
    + '<div class="hint">Address of your running DeepTutor instance</div></div>'
    + '<div class="field"><label>Device Name</label>'
    + '<input id="deviceName" type="text" placeholder="My MacBook" value="' + (settings.deviceName || "") + '"></div>'
    + '<div class="field"><label>Device ID : Token</label>'
    + '<div class="token-row">'
    + '<input id="credential" type="text" placeholder=" Paste from DeepTutor Devices tab" value="' + (connected ? settings.deviceId + ":" + settings.token : "") + '">'
    + '</div>'
    + '<div class="hint">Pair a device in DeepTutor Knowledge Center, then paste the credential here.</div></div>'
    + '<div style="margin-top: 20px;">'
    + (settings.enabled
      ? '<button class="btn btn-secondary" onclick="toggle(false)">Disable Sync</button> '
        + '<button class="btn btn-primary" onclick="doSync()">Sync Now</button>'
      : (connected
        ? '<button class="btn btn-success" onclick="toggle(true)">Enable Sync</button>'
        : '<button class="btn btn-primary" onclick="doSave()" disabled>Save & Enable</button>'))
    + (connected ? '<button class="btn btn-danger" onclick="doReset()" style="margin-left:8px">Reset</button>' : '')
    + '</div>'
    + '<div class="footer">DeepTutor Sync v0.1.0 &mdash; <a href="https://github.com/evan188199-tech/mn4-deeptutor-sync" style="color:#4a90d9">GitHub</a></div>'
    + '<script>'
    + 'var input = document.getElementById("credential");'
    + 'var saveBtn = document.querySelector(".btn-primary");'
    + 'if(input) input.addEventListener("input", function(){ if(saveBtn) saveBtn.disabled = !this.value.includes(":"); });'
    + 'function toggle(on) { window.postMessage(JSON.stringify({action: on ? "enable" : "disable"})); }'
    + 'function doSync() { window.postMessage(JSON.stringify({action: "sync_now"})); }'
    + 'function doSave() { window.postMessage(JSON.stringify({action: "save", serverUrl: document.getElementById("serverUrl").value, deviceName: document.getElementById("deviceName").value, credential: document.getElementById("credential").value})); }'
    + 'function doReset() { if(confirm("Reset all sync settings?")) window.postMessage(JSON.stringify({action: "reset"})); }'
    + '</script></body></html>'
}

function openSettings() {
  const settings = loadSettings()
  const html = settingsPageHTML(settings)
  const frame = MNUtil.genFrame(20, 80, 400, 520)
  const wv = MNUtil.createWebView(frame)
  wv.loadHTMLString(html)
  MNUtil.studyView().addSubview(wv)

  // Listen for messages from the webview
  const handler = function (notification) {
    try {
      const msg = JSON.parse(notification.userInfo.message)
      handleSettingsAction(msg)
    } catch (e) {
      // not our message
    }
  }
  MNUtil.addObserverForAddonBroadcast(self, "onAddonBroadcast:")
  // Also listen via URL scheme from webview
  Runtime.registerRoute("settings_action", function (parsed) {
    try {
      const action = JSON.parse(decodeURIComponent(parsed.params.data || "{}"))
      handleSettingsAction(action)
    } catch (e) {
      // ignore
    }
  })
}

function handleSettingsAction(msg) {
  const settings = loadSettings()
  switch (msg.action) {
    case "save": {
      settings.serverUrl = (msg.serverUrl || "").replace(/\/+$/, "")
      settings.deviceName = msg.deviceName || ""
      const cred = (msg.credential || "").split(":", 2)
      if (cred.length === 2 && cred[0] && cred[1]) {
        settings.deviceId = cred[0]
        settings.token = cred[1]
      }
      settings.enabled = true
      saveSettings(settings)
      startTimers()
      MNUtil.showHUD("Settings saved, sync started")
      break
    }
    case "enable": {
      settings.enabled = true
      saveSettings(settings)
      startTimers()
      MNUtil.showHUD("Sync enabled")
      break
    }
    case "disable": {
      settings.enabled = false
      saveSettings(settings)
      stopTimers()
      MNUtil.showHUD("Sync disabled")
      break
    }
    case "sync_now": {
      MNUtil.showHUD("Syncing...")
      syncOnce().then(function () {
        MNUtil.showHUD("Sync complete")
      })
      break
    }
    case "reset": {
      saveSettings({ serverUrl: "", deviceId: "", token: "", deviceName: "", enabled: false })
      stopTimers()
      MNUtil.showHUD("Settings reset")
      break
    }
  }
}

// -- Addon lifecycle ------------------------------------------------------

var DeepTutorSync = JSB.defineClass("DeepTutorSync : JSExtension", {
  sceneWillConnect: function () {
    const settings = loadSettings()
    if (settings.enabled && settings.deviceId && settings.token) {
      startTimers()
    }
  },
  sceneDidDisconnect: function () {
    stopTimers()
  },
  queryAddonCommandStatus: function () {
    return [{
      title: "DeepTutor Sync Settings",
      icon: "sync",
      action: "openSettings",
      handler: function () { openSettings() }
    }]
  }
})
