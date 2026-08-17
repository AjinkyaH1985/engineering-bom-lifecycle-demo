(function (app) {
  app.core = app.core || {};

  var STORAGE_KEY = "engineeringBomLifecyclePortfolio.public.v2.state";
  var STARTUP_MODE_KEY = "engineeringBomLifecyclePortfolio.public.v2.startupMode";
  var STARTUP_MODES = {
    FIRST_INSTALL: "FIRST_INSTALL",
    CLEAN_MANUAL_TEST: "CLEAN_MANUAL_TEST",
    EXISTING_STATE: "EXISTING_STATE"
  };
  var CURRENT_SCHEMA_VERSION = "1.0.0";
  var LEGACY_REVISION_STORAGE_ENCODING = "REVISION_ROWS_V1";
  var REVISION_STORAGE_ENCODING = "STATE_ROWS_V2";
  var COMPRESSION_PREFIX = "EBLP-LZW1:";
  var SEGMENT_PREFIX = "EBLP-SEG1:";
  var DEVELOPER_BACKUP_PREFIX = "engineeringBomLifecyclePortfolio.public.v2.backup.";
  var DEVELOPER_BACKUP_POINTER_KEY = DEVELOPER_BACKUP_PREFIX + "latest";
  var LEGACY_BUSINESS_KEYS = [];
  var segmentCache = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getStorage() {
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    throw new app.core.errors.StatePersistenceError("localStorage is not available.");
  }

  function safeParse(raw) {
    if (!raw) return { ok: true, value: null, error: null };
    try {
      if (raw.indexOf(SEGMENT_PREFIX) === 0) return { ok: true, value: decodeSegmentEnvelope(raw), error: null };
      if (raw.indexOf(COMPRESSION_PREFIX) === 0) raw = decompressLzw(raw.slice(COMPRESSION_PREFIX.length));
      return { ok: true, value: JSON.parse(raw), error: null };
    } catch (error) {
      return { ok: false, value: null, error: error };
    }
  }

  function getSeedState() {
    return clone(app.data.seedState || app.data.initialState);
  }

  function getCleanState() {
    if (app.data.createCleanManualTestState) return clone(app.data.createCleanManualTestState());
    var clean = clone(app.data.initialState);
    clean.metadata.environmentMode = STARTUP_MODES.CLEAN_MANUAL_TEST;
    return clean;
  }

  function getStartupMode() {
    var mode = getStorage().getItem(STARTUP_MODE_KEY);
    return Object.keys(STARTUP_MODES).some(function (key) { return STARTUP_MODES[key] === mode; }) ? mode : null;
  }

  function setStartupMode(mode) {
    if (!Object.keys(STARTUP_MODES).some(function (key) { return STARTUP_MODES[key] === mode; })) {
      throw new app.core.errors.StatePersistenceError("Unsupported application startup mode.");
    }
    getStorage().setItem(STARTUP_MODE_KEY, mode);
    return mode;
  }

  function removeStartupMode() {
    getStorage().removeItem(STARTUP_MODE_KEY);
  }

  function recoveryForConfiguredMode(reason, error) {
    var configuredMode = getStartupMode();
    var startupMode = configuredMode === STARTUP_MODES.CLEAN_MANUAL_TEST
      ? STARTUP_MODES.CLEAN_MANUAL_TEST
      : STARTUP_MODES.FIRST_INSTALL;
    var recovered = startupMode === STARTUP_MODES.CLEAN_MANUAL_TEST ? getCleanState() : getSeedState();
    save(recovered);
    if (startupMode === STARTUP_MODES.FIRST_INSTALL) setStartupMode(STARTUP_MODES.EXISTING_STATE);
    return {
      state: recovered,
      startupMode: startupMode,
      recovered: true,
      recoveryReason: reason,
      error: error || null
    };
  }

  function restoreForConfiguredMode(reason, error) {
    return recoveryForConfiguredMode(reason || "INVALID_PERSISTED_REFERENCES", error || null);
  }

  function ensureSchemaVersion(state) {
    if (!state || !state.metadata || state.metadata.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      return {
        ok: false,
        error: new app.core.errors.StatePersistenceError("Unsupported application-state schema version.")
      };
    }
    return { ok: true, error: null };
  }

  function load() {
    var storage = getStorage();
    var parsed = safeParse(storage.getItem(STORAGE_KEY));
    if (!parsed.ok) {
      return recoveryForConfiguredMode("INVALID_JSON", parsed.error);
    }
    if (!parsed.value) {
      return recoveryForConfiguredMode("MISSING_STATE", null);
    }
    var decoded = decodePersistedState(parsed.value);
    var schema = ensureSchemaVersion(decoded);
    if (!schema.ok) {
      return recoveryForConfiguredMode("UNSUPPORTED_SCHEMA_VERSION", schema.error);
    }
    if (getStartupMode() !== STARTUP_MODES.CLEAN_MANUAL_TEST) {
      setStartupMode(STARTUP_MODES.EXISTING_STATE);
    }
    return {
      state: clone(decoded),
      startupMode: STARTUP_MODES.EXISTING_STATE,
      recovered: false,
      recoveryReason: null,
      error: null
    };
  }

  function save(state) {
    var schema = ensureSchemaVersion(state);
    if (!schema.ok) throw schema.error;
    try {
      var json = JSON.stringify(encodePersistedState(state));
      getStorage().setItem(STORAGE_KEY, encodeSegmentEnvelope(JSON.parse(json)));
    } catch (error) {
      throw new app.core.errors.StatePersistenceError("Unable to save application state.", error);
    }
  }

  function encodeStateForStorage(state) {
    var schema = ensureSchemaVersion(state);
    if (!schema.ok) throw schema.error;
    return encodeSegmentEnvelope(JSON.parse(JSON.stringify(encodePersistedState(state))));
  }

  function replaceWithDeveloperBackup(state, backupName) {
    var storage = getStorage();
    var currentRaw = storage.getItem(STORAGE_KEY);
    var previousPointer = storage.getItem(DEVELOPER_BACKUP_POINTER_KEY);
    var previousBackup = previousPointer ? storage.getItem(previousPointer) : null;
    var previousStartupMode = storage.getItem(STARTUP_MODE_KEY);
    var resolvedName = backupName || DEVELOPER_BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-");
    var cleanRaw = encodeStateForStorage(state);
    var sourceRaw = currentRaw || encodeStateForStorage(getSeedState());

    try {
      // Replacing the large current state first leaves room for an equally large backup.
      // The original raw value remains in memory and is restored on any following failure.
      storage.setItem(STORAGE_KEY, cleanRaw);
      storage.setItem(resolvedName, sourceRaw);
      storage.setItem(DEVELOPER_BACKUP_POINTER_KEY, resolvedName);
      setStartupMode(STARTUP_MODES.CLEAN_MANUAL_TEST);
      if (previousPointer && previousPointer !== resolvedName) storage.removeItem(previousPointer);
      removeLegacyBusinessKeys();
      segmentCache = {};
      return {
        backupName: resolvedName,
        previousRawState: currentRaw,
        previousBackupName: previousPointer,
        previousBackupRaw: previousBackup,
        previousStartupMode: previousStartupMode
      };
    } catch (error) {
      if (currentRaw == null) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, currentRaw);
      storage.removeItem(resolvedName);
      if (previousPointer) {
        storage.setItem(DEVELOPER_BACKUP_POINTER_KEY, previousPointer);
        if (previousBackup != null) storage.setItem(previousPointer, previousBackup);
      } else {
        storage.removeItem(DEVELOPER_BACKUP_POINTER_KEY);
      }
      if (previousStartupMode == null) storage.removeItem(STARTUP_MODE_KEY);
      else storage.setItem(STARTUP_MODE_KEY, previousStartupMode);
      throw new app.core.errors.StatePersistenceError("Unable to create the clean-test backup.", error);
    }
  }

  function restoreRawState(raw) {
    var storage = getStorage();
    if (raw == null) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, raw);
    segmentCache = {};
  }

  function loadLatestDeveloperBackup() {
    var storage = getStorage();
    var backupName = storage.getItem(DEVELOPER_BACKUP_POINTER_KEY);
    var raw = backupName && storage.getItem(backupName);
    if (!raw) throw new app.core.errors.StatePersistenceError("No developer backup is available.");
    var parsed = safeParse(raw);
    if (!parsed.ok) throw new app.core.errors.StatePersistenceError("The developer backup is invalid.", parsed.error);
    var decoded = decodePersistedState(parsed.value);
    var schema = ensureSchemaVersion(decoded);
    if (!schema.ok) throw schema.error;
    return { backupName: backupName, state: clone(decoded), raw: raw };
  }

  function removeLegacyBusinessKeys() {
    var storage = getStorage();
    storageKeys(storage).forEach(function (key) {
      if (LEGACY_BUSINESS_KEYS.indexOf(key) !== -1) {
        storage.removeItem(key);
      }
    });
  }

  function storageKeys(storage) {
    if (storage && storage.values) return Object.keys(storage.values);
    var keys = [];
    for (var index = 0; storage && index < storage.length; index += 1) {
      var key = storage.key(index);
      if (key != null) keys.push(key);
    }
    return keys;
  }

  function clear() {
    getStorage().removeItem(STORAGE_KEY);
    removeStartupMode();
  }

  function restoreSeed() {
    var seed = getSeedState();
    save(seed);
    setStartupMode(STARTUP_MODES.EXISTING_STATE);
    return clone(seed);
  }

  function encodePersistedState(state) {
    var persisted = Object.assign({}, state, {
      metadata: Object.assign({}, state.metadata || {}, { storageEncoding: REVISION_STORAGE_ENCODING }),
      parts: encodeRows(state.parts),
      engineeringBoms: (state.engineeringBoms || []).map(function (bom) {
        return Object.assign({}, bom, { items: encodeRows(bom.items) });
      }),
      engineeringProductStructures: (state.engineeringProductStructures || []).map(function (structure) {
        return Object.assign({}, structure, { items: encodeRows(structure.items) });
      }),
      commercialAssessments: (state.commercialAssessments || []).map(function (assessment) {
        return Object.assign({}, assessment, { lineItems: encodeRows(assessment.lineItems) });
      }),
      auditEvents: encodeRows(state.auditEvents),
      revisions: (state.revisions || []).map(encodeRevision)
    });
    return persisted;
  }

  function decodePersistedState(state) {
    var encoding = state && state.metadata && state.metadata.storageEncoding;
    if (encoding !== REVISION_STORAGE_ENCODING && encoding !== LEGACY_REVISION_STORAGE_ENCODING) return state;
    var decoded = Object.assign({}, state, {
      metadata: Object.assign({}, state.metadata, { storageEncoding: undefined }),
      revisions: (state.revisions || []).map(decodeRevision)
    });
    if (encoding === REVISION_STORAGE_ENCODING) {
      decoded.parts = decodeRows(state.parts);
      decoded.engineeringBoms = (state.engineeringBoms || []).map(function (bom) {
        return Object.assign({}, bom, { items: decodeRows(bom.items) });
      });
      decoded.engineeringProductStructures = (state.engineeringProductStructures || []).map(function (structure) {
        return Object.assign({}, structure, { items: decodeRows(structure.items) });
      });
      decoded.commercialAssessments = (state.commercialAssessments || []).map(function (assessment) {
        return Object.assign({}, assessment, { lineItems: decodeRows(assessment.lineItems) });
      });
      decoded.auditEvents = decodeRows(state.auditEvents);
    }
    return decoded;
  }

  function encodeRevision(revision) {
    if (!revision) return revision;
    var encoded = Object.assign({}, revision);
    encoded.partsSnapshot = encodeRows(revision.partsSnapshot);
    encoded.engineeringBomSnapshots = (revision.engineeringBomSnapshots || []).map(function (bom) {
      return Object.assign({}, bom, { items: encodeRows(bom.items) });
    });
    if (revision.engineeringProductStructureSnapshot) {
      encoded.engineeringProductStructureSnapshot = Object.assign({}, revision.engineeringProductStructureSnapshot, {
        items: encodeRows(revision.engineeringProductStructureSnapshot.items)
      });
    }
    if (revision.commercialAssessmentSnapshot) {
      encoded.commercialAssessmentSnapshot = Object.assign({}, revision.commercialAssessmentSnapshot, {
        lineItems: encodeRows(revision.commercialAssessmentSnapshot.lineItems)
      });
    }
    return encoded;
  }

  function decodeRevision(revision) {
    if (!revision) return revision;
    var decoded = Object.assign({}, revision);
    decoded.partsSnapshot = decodeRows(revision.partsSnapshot);
    decoded.engineeringBomSnapshots = (revision.engineeringBomSnapshots || []).map(function (bom) {
      return Object.assign({}, bom, { items: decodeRows(bom.items) });
    });
    if (revision.engineeringProductStructureSnapshot) {
      decoded.engineeringProductStructureSnapshot = Object.assign({}, revision.engineeringProductStructureSnapshot, {
        items: decodeRows(revision.engineeringProductStructureSnapshot.items)
      });
    }
    if (revision.commercialAssessmentSnapshot) {
      decoded.commercialAssessmentSnapshot = Object.assign({}, revision.commercialAssessmentSnapshot, {
        lineItems: decodeRows(revision.commercialAssessmentSnapshot.lineItems)
      });
    }
    return decoded;
  }

  function encodeRows(records) {
    if (!Array.isArray(records) || !records.length) return { encoding: REVISION_STORAGE_ENCODING, fields: [], rows: [] };
    var fields = [];
    var seen = {};
    var stringCounts = {};
    records.forEach(function (record) {
      Object.keys(record || {}).sort().forEach(function (field) {
        if (!seen[field]) {
          seen[field] = true;
          fields.push(field);
        }
        if (typeof record[field] === "string" && record[field].length > 2) {
          stringCounts[record[field]] = (stringCounts[record[field]] || 0) + 1;
        }
      });
    });
    var dictionary = [];
    var dictionaryIndex = {};
    Object.keys(stringCounts).sort().forEach(function (value) {
      if (stringCounts[value] > 1) {
        dictionaryIndex[value] = dictionary.length;
        dictionary.push(value);
      }
    });
    function encodeCell(value) {
      return typeof value === "string" && dictionaryIndex[value] !== undefined
        ? "\u0001" + dictionaryIndex[value].toString(36)
        : value;
    }
    var chunkCount = Math.ceil(fields.length / 30);
    return {
      encoding: REVISION_STORAGE_ENCODING,
      fields: fields,
      dictionary: dictionary,
      rows: records.map(function (record) {
        return fields.map(function (field) { return record && record[field] !== undefined ? encodeCell(record[field]) : null; });
      }),
      missing: records.map(function (record) {
        var chunks = new Array(chunkCount).fill(0);
        fields.forEach(function (field, index) {
          if (!record || record[field] === undefined) chunks[Math.floor(index / 30)] |= (1 << (index % 30));
        });
        return chunkCount === 1 ? chunks[0] : chunks;
      }),
      missingFormat: "BITSET30"
    };
  }

  function decodeRows(value) {
    if (Array.isArray(value)) return value;
    if (!value || (value.encoding !== REVISION_STORAGE_ENCODING && value.encoding !== LEGACY_REVISION_STORAGE_ENCODING) ||
      !Array.isArray(value.fields) || !Array.isArray(value.rows)) return [];
    return value.rows.map(function (row, rowIndex) {
      var record = {};
      var missing = {};
      if (value.missingFormat === "BITSET30") {
        var masks = value.missing && value.missing[rowIndex];
        masks = Array.isArray(masks) ? masks : [masks || 0];
        value.fields.forEach(function (_, index) {
          if ((masks[Math.floor(index / 30)] || 0) & (1 << (index % 30))) missing[index] = true;
        });
      } else {
        ((value.missing && value.missing[rowIndex]) || []).forEach(function (index) { missing[index] = true; });
      }
      value.fields.forEach(function (field, index) {
        if (!missing[index] && (value.missing || (row[index] !== null && row[index] !== undefined))) {
          var cell = row[index];
          if (typeof cell === "string" && cell.charAt(0) === "\u0001" && Array.isArray(value.dictionary)) {
            cell = value.dictionary[parseInt(cell.slice(1), 36)];
          }
          record[field] = cell;
        }
      });
      return record;
    });
  }

  function compressLzw(input) {
    if (!input) return "";
    var dictionary = Object.create(null);
    var phrase = input.charAt(0);
    var nextCode = 65536;
    var output = [];
    for (var index = 1; index < input.length; index += 1) {
      var character = input.charAt(index);
      var combined = phrase + character;
      if (dictionary[combined] !== undefined) {
        phrase = combined;
      } else {
        output.push(phrase.length === 1 ? phrase.charCodeAt(0) : dictionary[phrase]);
        dictionary[combined] = nextCode++;
        phrase = character;
      }
    }
    output.push(phrase.length === 1 ? phrase.charCodeAt(0) : dictionary[phrase]);
    return output.map(function (code) {
      return String.fromCharCode((code >>> 16) & 65535, code & 65535);
    }).join("");
  }

  function decompressLzw(input) {
    if (!input) return "";
    if (input.length % 2) throw new Error("Compressed application state is invalid.");
    var codes = [];
    for (var index = 0; index < input.length; index += 2) {
      codes.push((input.charCodeAt(index) << 16) | input.charCodeAt(index + 1));
    }
    var dictionary = Object.create(null);
    var nextCode = 65536;
    var previous = String.fromCharCode(codes[0]);
    var output = [previous];
    for (var codeIndex = 1; codeIndex < codes.length; codeIndex += 1) {
      var code = codes[codeIndex];
      var phrase = code < 65536 ? String.fromCharCode(code) : dictionary[code];
      if (phrase === undefined && code === nextCode) phrase = previous + previous.charAt(0);
      if (phrase === undefined) throw new Error("Compressed application state dictionary is invalid.");
      output.push(phrase);
      dictionary[nextCode++] = previous + phrase.charAt(0);
      previous = phrase;
    }
    return output.join("");
  }

  function encodeSegmentEnvelope(persisted) {
    var segmentKeys = [
      "parts", "engineeringBoms", "engineeringProductStructures", "commercialAssessments",
      "revisions", "auditEvents"
    ];
    var root = Object.assign({}, persisted);
    var segments = [];
    segmentKeys.forEach(function (key) {
      var value = persisted[key];
      var json = JSON.stringify(value == null ? null : value);
      var cached = segmentCache[key];
      var compressed = cached && cached.json === json ? cached.compressed : compressLzw(json);
      segmentCache[key] = { json: json, compressed: compressed };
      root[key] = { storageSegment: key };
      segments.push({ key: key, length: compressed.length, data: compressed });
    });
    var header = JSON.stringify({
      root: JSON.stringify(root),
      segments: segments.map(function (segment) { return { key: segment.key, length: segment.length }; })
    });
    return SEGMENT_PREFIX + padHex(header.length) + header + segments.map(function (segment) { return segment.data; }).join("");
  }

  function decodeSegmentEnvelope(raw) {
    var offset = SEGMENT_PREFIX.length;
    var headerLength = parseInt(raw.slice(offset, offset + 8), 16);
    if (!isFinite(headerLength) || headerLength < 1) throw new Error("Application-state storage header is invalid.");
    offset += 8;
    var header = JSON.parse(raw.slice(offset, offset + headerLength));
    offset += headerLength;
    var state = JSON.parse(header.root);
    (header.segments || []).forEach(function (segment) {
      var compressed = raw.slice(offset, offset + segment.length);
      offset += segment.length;
      var json = decompressLzw(compressed);
      state[segment.key] = JSON.parse(json);
      segmentCache[segment.key] = { json: json, compressed: compressed };
    });
    return state;
  }

  function padHex(value) {
    return Number(value).toString(16).toUpperCase().padStart(8, "0");
  }

  app.core.storageService = {
    STORAGE_KEY: STORAGE_KEY,
    STARTUP_MODE_KEY: STARTUP_MODE_KEY,
    STARTUP_MODES: Object.assign({}, STARTUP_MODES),
    CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
    REVISION_STORAGE_ENCODING: REVISION_STORAGE_ENCODING,
    COMPRESSION_PREFIX: COMPRESSION_PREFIX,
    SEGMENT_PREFIX: SEGMENT_PREFIX,
    DEVELOPER_BACKUP_PREFIX: DEVELOPER_BACKUP_PREFIX,
    DEVELOPER_BACKUP_POINTER_KEY: DEVELOPER_BACKUP_POINTER_KEY,
    LEGACY_BUSINESS_KEYS: LEGACY_BUSINESS_KEYS.slice(),
    safeParse: safeParse,
    load: load,
    getStartupMode: getStartupMode,
    setStartupMode: setStartupMode,
    removeStartupMode: removeStartupMode,
    restoreForConfiguredMode: restoreForConfiguredMode,
    save: save,
    encodeStateForStorage: encodeStateForStorage,
    replaceWithDeveloperBackup: replaceWithDeveloperBackup,
    restoreRawState: restoreRawState,
    loadLatestDeveloperBackup: loadLatestDeveloperBackup,
    removeLegacyBusinessKeys: removeLegacyBusinessKeys,
    clear: clear,
    restoreSeed: restoreSeed
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}));
