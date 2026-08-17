(function (app, root) {
  app.domain = app.domain || {};

  var DB_NAME = "engineeringBomLifecyclePortfolio.public.v2.assets";
  var STORE_NAME = "partImages";
  var DB_VERSION = 1;
  var REFERENCE_PREFIX = "eblp-part-image://";
  var memoryStore = {};
  var resolvedUrls = {};
  var databasePromise = null;

  function isManagedReference(reference) {
    return String(reference || "").indexOf(REFERENCE_PREFIX) === 0;
  }

  function createReference(workbookFingerprint, mediaPath) {
    return REFERENCE_PREFIX + encodeURIComponent(String(workbookFingerprint || "WORKBOOK")) + "/" +
      String(mediaPath || "image").split("/").map(encodeURIComponent).join("/");
  }

  function persistAssets(assets) {
    var records = uniqueAssets(assets).filter(function (asset) {
      return asset.reference && asset.base64 && asset.mimeType;
    }).map(normalizeAsset);
    if (!records.length) return Promise.resolve({ stored: 0, references: [] });
    records.forEach(function (record) { memoryStore[record.reference] = record; });
    if (!supportsIndexedDb()) return Promise.resolve(resultFor(records));
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        var store = transaction.objectStore(STORE_NAME);
        records.forEach(function (record) { store.put(record); });
        transaction.oncomplete = function () { resolve(resultFor(records)); };
        transaction.onerror = function () { reject(transaction.error || new Error("Part images could not be stored.")); };
        transaction.onabort = function () { reject(transaction.error || new Error("Part image storage was cancelled.")); };
      });
    });
  }

  function removeAssets(references) {
    references = uniqueValues(references || []);
    references.forEach(function (reference) {
      delete memoryStore[reference];
      revokeResolvedUrl(reference);
    });
    if (!references.length || !supportsIndexedDb()) return Promise.resolve();
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        var store = transaction.objectStore(STORE_NAME);
        references.forEach(function (reference) { store.delete(reference); });
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { reject(transaction.error || new Error("Part images could not be removed.")); };
      });
    });
  }

  function clearAll() {
    Object.keys(resolvedUrls).forEach(revokeResolvedUrl);
    memoryStore = {};
    if (!supportsIndexedDb()) return Promise.resolve();
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { reject(transaction.error || new Error("Part image storage could not be cleared.")); };
      });
    });
  }

  function resolveImageReference(reference) {
    if (!isManagedReference(reference)) return Promise.resolve(reference || "");
    if (resolvedUrls[reference]) return Promise.resolve(resolvedUrls[reference]);
    if (memoryStore[reference]) return Promise.resolve(urlForRecord(memoryStore[reference]));
    if (!supportsIndexedDb()) return Promise.resolve("");
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(reference);
        request.onsuccess = function () { resolve(request.result ? urlForRecord(request.result) : ""); };
        request.onerror = function () { reject(request.error || new Error("Part image could not be read.")); };
      });
    });
  }

  function hydrateImageElements(container) {
    if (!container || !container.querySelectorAll) return Promise.resolve([]);
    var elements = Array.prototype.slice.call(container.querySelectorAll("[data-part-image-reference]"));
    return Promise.all(elements.map(function (element) {
      var reference = element.getAttribute("data-part-image-reference") || "";
      return resolveImageReference(reference).then(function (url) {
        if (!url) return false;
        element.src = url;
        element.removeAttribute("data-part-image-reference");
        element.classList.remove("part-image-loading");
        return true;
      }).catch(function () {
        element.classList.remove("part-image-loading");
        return false;
      });
    }));
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(function (resolve, reject) {
      var request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "reference" });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Part image storage is unavailable.")); };
    });
    return databasePromise;
  }

  function supportsIndexedDb() {
    return Boolean(root && root.indexedDB);
  }

  function normalizeAsset(asset) {
    return {
      reference: String(asset.reference),
      mimeType: String(asset.mimeType),
      base64: String(asset.base64),
      byteLength: Number(asset.byteLength || 0),
      sourceWorkbookFingerprint: String(asset.sourceWorkbookFingerprint || ""),
      sourceMediaPath: String(asset.mediaPath || asset.sourceMediaPath || ""),
      storedAt: new Date().toISOString()
    };
  }

  function urlForRecord(record) {
    if (resolvedUrls[record.reference]) return resolvedUrls[record.reference];
    var url = "data:" + record.mimeType + ";base64," + record.base64;
    if (root.Blob && root.URL && root.URL.createObjectURL) {
      try {
        url = root.URL.createObjectURL(new root.Blob([base64ToBytes(record.base64)], { type: record.mimeType }));
      } catch (error) { /* data URL remains a safe browser fallback */ }
    }
    resolvedUrls[record.reference] = url;
    return url;
  }

  function base64ToBytes(base64) {
    var binary = root.atob ? root.atob(base64) : (typeof Buffer !== "undefined" ? Buffer.from(base64, "base64").toString("binary") : "");
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function revokeResolvedUrl(reference) {
    var url = resolvedUrls[reference];
    if (url && /^blob:/.test(url) && root.URL && root.URL.revokeObjectURL) root.URL.revokeObjectURL(url);
    delete resolvedUrls[reference];
  }

  function uniqueAssets(assets) {
    var byReference = {};
    (assets || []).forEach(function (asset) { if (asset && asset.reference) byReference[asset.reference] = asset; });
    return Object.keys(byReference).sort().map(function (reference) { return byReference[reference]; });
  }

  function uniqueValues(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function resultFor(records) {
    return { stored: records.length, references: records.map(function (record) { return record.reference; }) };
  }

  app.domain.partImageService = {
    REFERENCE_PREFIX: REFERENCE_PREFIX,
    isManagedReference: isManagedReference,
    createReference: createReference,
    persistAssets: persistAssets,
    removeAssets: removeAssets,
    clearAll: clearAll,
    resolveImageReference: resolveImageReference,
    hydrateImageElements: hydrateImageElements
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}), typeof globalThis !== "undefined" ? globalThis : this);
