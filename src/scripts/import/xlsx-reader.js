(function (app, root) {
  app.importing = app.importing || {};

  function readWorkbook(arrayBuffer) {
    var JSZip = root.JSZip || (root.window && root.window.JSZip);
    if (!JSZip) return Promise.reject(new Error("The local Excel reader is not available."));
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      return Promise.all([
        readText(zip, "xl/workbook.xml"),
        readText(zip, "xl/_rels/workbook.xml.rels"),
        readOptionalText(zip, "xl/sharedStrings.xml")
      ]).then(function (files) {
        var workbookSheets = parseWorkbook(files[0], files[1]);
        var sharedStrings = parseSharedStrings(files[2] || "");
        return Promise.all(workbookSheets.map(function (sheetInfo) {
          return readSheet(zip, sheetInfo, sharedStrings);
        })).then(function (sheets) {
          return readMediaAssets(zip, sheets).then(function (mediaAssets) {
            var assetsByPath = mediaAssets.reduce(function (result, asset) {
              result[asset.mediaPath] = asset;
              return result;
            }, {});
            sheets.forEach(function (sheet) {
              (sheet.imageAnchors || []).forEach(function (anchor) {
                var asset = assetsByPath[anchor.mediaPath];
                anchor.mimeType = asset && asset.mimeType || "";
                anchor.supported = Boolean(asset && asset.supported);
                anchor.byteLength = asset && asset.byteLength || 0;
              });
            });
            return {
              sheets: sheets,
              sheetNames: sheets.map(function (sheet) { return sheet.name; }),
              mediaAssets: mediaAssets,
              source: "OPEN_XML"
            };
          });
        });
      });
    });
  }

  function readMediaAssets(zip, sheets) {
    var paths = {};
    (sheets || []).forEach(function (sheet) {
      (sheet.imageAnchors || []).forEach(function (anchor) { if (anchor.mediaPath) paths[anchor.mediaPath] = true; });
    });
    return Promise.all(Object.keys(paths).sort().map(function (mediaPath) {
      var entry = zip.file(mediaPath);
      var mimeType = imageMimeType(mediaPath);
      var supported = Boolean(entry && mimeType);
      if (!supported) {
        return Promise.resolve({ mediaPath: mediaPath, mimeType: "", supported: false, byteLength: 0, base64: "" });
      }
      return entry.async("base64").then(function (base64) {
        return {
          mediaPath: mediaPath,
          mimeType: mimeType,
          supported: true,
          byteLength: base64ByteLength(base64),
          base64: base64
        };
      });
    }));
  }

  function imageMimeType(path) {
    var extension = String(path || "").split(".").pop().toLowerCase();
    return {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp"
    }[extension] || "";
  }

  function base64ByteLength(base64) {
    var value = String(base64 || "");
    return Math.max(0, Math.floor(value.length * 3 / 4) - (value.slice(-2) === "==" ? 2 : value.slice(-1) === "=" ? 1 : 0));
  }

  function readSheet(zip, sheetInfo, sharedStrings) {
    return readText(zip, sheetInfo.path).then(function (xml) {
      var sheet = parseWorksheet(xml, sheetInfo, sharedStrings);
      var relationshipsPath = relationshipPath(sheetInfo.path);
      return readOptionalText(zip, relationshipsPath).then(function (relationshipsXml) {
        var relationships = parseRelationships(relationshipsXml || "", dirname(sheetInfo.path));
        var drawingId = matchAttribute(xml, /<(?:\w+:)?drawing\b([^>]*)\/?\s*>/i, "r:id");
        var drawingPath = drawingId && relationships[drawingId];
        if (!drawingPath) return sheet;
        return readOptionalText(zip, drawingPath).then(function (drawingXml) {
          if (!drawingXml) return sheet;
          return readOptionalText(zip, relationshipPath(drawingPath)).then(function (drawingRelationshipsXml) {
            sheet.imageAnchors = parseImageAnchors(
              drawingXml,
              parseRelationships(drawingRelationshipsXml || "", dirname(drawingPath))
            );
            sheet.imageCount = sheet.imageAnchors.length;
            return sheet;
          });
        });
      });
    });
  }

  function parseWorkbook(workbookXml, relationshipsXml) {
    var relationships = parseRelationships(relationshipsXml, "xl");
    var sheets = [];
    var pattern = /<(?:\w+:)?sheet\b([^>]*)\/?\s*>/gi;
    var match;
    while ((match = pattern.exec(workbookXml))) {
      var attrs = parseAttributes(match[1]);
      var relationId = attrs["r:id"] || attrs.id;
      if (!attrs.name || !relationships[relationId]) continue;
      sheets.push({
        name: decodeXml(attrs.name),
        state: attrs.state || "visible",
        path: relationships[relationId]
      });
    }
    return sheets;
  }

  function parseWorksheet(xml, sheetInfo, sharedStrings) {
    var cells = {};
    var rows = {};
    var formulas = [];
    var hiddenRows = [];
    var hiddenColumns = [];
    var maxRow = 0;
    var maxColumn = 0;
    var rowPattern = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi;
    var rowMatch;
    while ((rowMatch = rowPattern.exec(xml))) {
      var rowAttrs = parseAttributes(rowMatch[1]);
      var rowNumber = Number(rowAttrs.r || 0);
      if (rowAttrs.hidden === "1") hiddenRows.push(rowNumber);
      rows[rowNumber] = rows[rowNumber] || {};
      maxRow = Math.max(maxRow, rowNumber);
      var cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi;
      var cellMatch;
      while ((cellMatch = cellPattern.exec(rowMatch[2]))) {
        var cellAttrs = parseAttributes(cellMatch[1]);
        var reference = cellAttrs.r;
        if (!reference) continue;
        var location = splitReference(reference);
        var body = cellMatch[2] || "";
        var formula = extractTag(body, "f");
        var rawValue = extractTag(body, "v");
        var inlineValue = extractInlineString(body);
        var value = resolveCellValue(cellAttrs.t, rawValue, inlineValue, sharedStrings);
        if ((value === "" || value === null) && formula) value = "=" + formula;
        var cell = {
          reference: reference,
          row: location.row,
          column: location.column,
          value: value,
          formula: formula || null,
          type: cellAttrs.t || "n"
        };
        cells[reference] = cell;
        rows[location.row] = rows[location.row] || {};
        rows[location.row][location.column] = cell;
        maxRow = Math.max(maxRow, location.row);
        maxColumn = Math.max(maxColumn, location.column);
        if (formula) formulas.push(reference);
      }
    }

    var columnPattern = /<(?:\w+:)?col\b([^>]*)\/?\s*>/gi;
    var columnMatch;
    while ((columnMatch = columnPattern.exec(xml))) {
      var columnAttrs = parseAttributes(columnMatch[1]);
      if (columnAttrs.hidden !== "1") continue;
      var min = Number(columnAttrs.min || 0);
      var max = Number(columnAttrs.max || min);
      for (var column = min; column <= max; column += 1) hiddenColumns.push(column);
    }

    var merges = [];
    var mergePattern = /<(?:\w+:)?mergeCell\b([^>]*)\/?\s*>/gi;
    var mergeMatch;
    while ((mergeMatch = mergePattern.exec(xml))) {
      var mergeAttrs = parseAttributes(mergeMatch[1]);
      if (mergeAttrs.ref) merges.push(mergeAttrs.ref);
    }

    return {
      name: sheetInfo.name,
      state: sheetInfo.state,
      cells: cells,
      rows: rows,
      maxRow: maxRow,
      maxColumn: maxColumn,
      hiddenRows: hiddenRows,
      hiddenColumns: hiddenColumns,
      merges: merges,
      formulas: formulas,
      formulaCount: formulas.length,
      imageAnchors: [],
      imageCount: 0
    };
  }

  function parseSharedStrings(xml) {
    var values = [];
    var pattern = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi;
    var match;
    while ((match = pattern.exec(xml))) values.push(extractTextRuns(match[1]));
    return values;
  }

  function parseRelationships(xml, basePath) {
    var relationships = {};
    var pattern = /<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi;
    var match;
    while ((match = pattern.exec(xml))) {
      var attrs = parseAttributes(match[1]);
      if (!attrs.Id || !attrs.Target) continue;
      relationships[attrs.Id] = resolvePath(basePath, attrs.Target);
    }
    return relationships;
  }

  function parseImageAnchors(xml, relationships) {
    var anchors = [];
    var seen = {};
    var pattern = /<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/gi;
    var match;
    while ((match = pattern.exec(xml))) {
      var body = match[1];
      var fromMatch = /<(?:xdr:)?from\b[^>]*>([\s\S]*?)<\/(?:xdr:)?from>/i.exec(body);
      var column = fromMatch ? Number(extractTag(fromMatch[1], "col") || 0) + 1 : null;
      var row = fromMatch ? Number(extractTag(fromMatch[1], "row") || 0) + 1 : null;
      var embedMatch = /<(?:a:)?blip\b([^>]*)\/?\s*>/i.exec(body);
      var relationId = embedMatch ? (parseAttributes(embedMatch[1])["r:embed"] || "") : "";
      var mediaPath = relationId && relationships[relationId];
      if (!row || !column || !mediaPath) continue;
      var key = [row, column, mediaPath].join("|");
      if (seen[key]) continue;
      seen[key] = true;
      anchors.push({ row: row, column: column, mediaPath: mediaPath });
    }
    return anchors.sort(function (left, right) {
      return left.row - right.row || left.column - right.column || String(left.mediaPath).localeCompare(String(right.mediaPath));
    });
  }

  function resolveCellValue(type, rawValue, inlineValue, sharedStrings) {
    if (type === "inlineStr") return inlineValue;
    if (type === "s") return sharedStrings[Number(rawValue)] || "";
    if (type === "b") return rawValue === "1";
    if (type === "str" || type === "e") return decodeXml(rawValue || "");
    if (rawValue === undefined || rawValue === null || rawValue === "") return "";
    var numeric = Number(rawValue);
    return isNaN(numeric) ? decodeXml(rawValue) : numeric;
  }

  function extractInlineString(body) {
    var inlineMatch = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/i.exec(body);
    return inlineMatch ? extractTextRuns(inlineMatch[1]) : "";
  }

  function extractTextRuns(body) {
    var text = "";
    var pattern = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi;
    var match;
    while ((match = pattern.exec(body))) text += decodeXml(match[1]);
    return text;
  }

  function extractTag(body, tag) {
    var pattern = new RegExp("<(?:\\w+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?" + tag + ">", "i");
    var match = pattern.exec(body);
    return match ? decodeXml(match[1]) : "";
  }

  function parseAttributes(source) {
    var attributes = {};
    var pattern = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    var match;
    while ((match = pattern.exec(source || ""))) attributes[match[1]] = decodeXml(match[3]);
    return attributes;
  }

  function matchAttribute(xml, pattern, name) {
    var match = pattern.exec(xml || "");
    return match ? parseAttributes(match[1])[name] || null : null;
  }

  function splitReference(reference) {
    var match = /^([A-Z]+)(\d+)$/i.exec(reference || "");
    return { column: match ? columnNumber(match[1]) : 0, row: match ? Number(match[2]) : 0 };
  }

  function columnNumber(letters) {
    return String(letters || "").toUpperCase().split("").reduce(function (number, letter) {
      return number * 26 + letter.charCodeAt(0) - 64;
    }, 0);
  }

  function columnLetters(number) {
    var letters = "";
    while (number > 0) {
      number -= 1;
      letters = String.fromCharCode(65 + (number % 26)) + letters;
      number = Math.floor(number / 26);
    }
    return letters;
  }

  function getCell(sheet, row, column) {
    var cell = sheet && sheet.rows && sheet.rows[row] && sheet.rows[row][column];
    return cell ? cell.value : "";
  }

  function readText(zip, path) {
    var entry = zip.file(path);
    if (!entry) return Promise.reject(new Error("Required workbook entry is missing: " + path));
    return entry.async("string");
  }

  function readOptionalText(zip, path) {
    var entry = zip.file(path);
    return entry ? entry.async("string") : Promise.resolve("");
  }

  function relationshipPath(path) {
    var slash = path.lastIndexOf("/");
    return path.slice(0, slash) + "/_rels/" + path.slice(slash + 1) + ".rels";
  }

  function dirname(path) {
    var slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
  }

  function resolvePath(basePath, target) {
    if (/^\//.test(target)) return target.replace(/^\//, "");
    var parts = (basePath + "/" + target).split("/");
    var resolved = [];
    parts.forEach(function (part) {
      if (!part || part === ".") return;
      if (part === "..") resolved.pop();
      else resolved.push(part);
    });
    return resolved.join("/");
  }

  function decodeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(Number(code)); })
      .replace(/&#x([\da-f]+);/gi, function (_, code) { return String.fromCharCode(parseInt(code, 16)); });
  }

  app.importing.xlsxReader = {
    readWorkbook: readWorkbook,
    parseWorksheet: parseWorksheet,
    parseSharedStrings: parseSharedStrings,
    getCell: getCell,
    columnNumber: columnNumber,
    columnLetters: columnLetters
  };
})(typeof window !== "undefined" ? (window.DEP = window.DEP || {}) : (globalThis.DEP = globalThis.DEP || {}), typeof globalThis !== "undefined" ? globalThis : this);
