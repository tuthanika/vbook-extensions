load('baidu.js');
load('prompts.js');
load('safety.js');

var GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
var TRANSLATION_MEMORY_TABLE = "translation_memory";
var MAX_MEMORY_ROWS = 2000;
var MAX_MEMORY_MATCHES = 80;
var MAX_LEARNED_ITEMS = 20;
var MAX_CHINESE_REPAIR_FRAGMENTS = 40;
var CHINESE_FRAGMENT_CONTEXT_LENGTH = 160;

function execute(text, from, to, source, model, style) {
    text = text || "";
    from = from || "auto";
    to = to || "";
    source = source || "";
    model = normalizeModel(model);
    style = style || "natural";

    if (!text) {
        return Response.success("");
    }
    if (!to) {
        return Response.error("Chưa chọn ngôn ngữ đích");
    }

    if (!shouldUseGemini(source)) {
        return translateWithFallback(text, from, to, source);
    }

    var apiKeys = readApiKeys();
    if (apiKeys.length === 0) {
        return Response.error("Vui lòng thêm Gemini API key trong cài đặt extension");
    }

    var temperature = readNumber("temperature", 0.2, 0, 2);
    var maxOutputTokens = Math.round(readNumber("max_output_tokens", 16384, 256, 65536));
    var customInstruction = readBookCustomInstruction();
    var endpoint = GEMINI_API_BASE + encodeURIComponent(model) + ":generateContent";
    var memoryContext = loadTranslationMemory(text, from, to, source);
    var learnMemory = memoryContext.enabled && readBoolean("auto_translation_memory", true);
    var systemInstruction = buildInstruction(
        from,
        to,
        source,
        style,
        customInstruction,
        memoryContext.prompt
    );

    var result = callGemini(endpoint, apiKeys, systemInstruction, text, temperature, maxOutputTokens);
    if (result.error) return Response.error(result.error);
    var apiKey = apiKeys[result.keyIndex];
    var finalText = result.text;

    if (shouldRepairChinese(finalText, text, from, to)) {
        finalText = repairRemainingChinese(endpoint, apiKey, finalText, memoryContext.prompt, maxOutputTokens);
    }

    // The model sometimes hands the chapter back untranslated, typically when the book's
    // memory holds Chinese "translations". Retry once without memory; never return (and so
    // never let the app cache) a mostly-Chinese result as a successful translation.
    if (isMostlyUntranslated(finalText, text, from, to)) {
        var retryInstruction = buildInstruction(from, to, source, style, customInstruction, "") +
            "\n\nBẮT BUỘC: dịch toàn bộ văn bản sang " + to +
            ". Không được chép lại nguyên văn và không giữ lại câu tiếng Trung nào.";
        var retry = callGemini(endpoint, [apiKey], retryInstruction, text, temperature, maxOutputTokens);
        if (retry.error) return Response.error(retry.error);
        finalText = retry.text;
        if (shouldRepairChinese(finalText, text, from, to)) {
            finalText = repairRemainingChinese(endpoint, apiKey, finalText, "", maxOutputTokens);
        }
        if (isMostlyUntranslated(finalText, text, from, to)) {
            return Response.error("Gemini trả về bản dịch vẫn còn nguyên tiếng Trung. Hãy thử lại hoặc đổi model.");
        }
        learnMemory = false;
    }

    if (learnMemory) {
        var learnedItems = extractTranslationMemory(endpoint, apiKey, text, finalText, memoryContext.prompt);
        persistTranslationMemory(memoryContext, text, learnedItems);
    }

    return Response.success(finalText);
}

// Returns { text, keyIndex, error }; rotates keys on auth/quota errors.
function callGemini(endpoint, apiKeys, systemInstruction, text, temperature, maxOutputTokens) {
    var request = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: [{
            role: "user",
            parts: [{ text: text }]
        }],
        generationConfig: {
            temperature: temperature,
            maxOutputTokens: maxOutputTokens
        }
    };
    applyGeminiSafetySettings(request);
    var requestBody = JSON.stringify(request);

    var lastError = "";
    for (var keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
        var response = fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKeys[keyIndex]
            },
            body: requestBody,
            timeout: 120000
        });

        if (!response.ok) {
            lastError = readApiError(response);
            if (response.status === 401 || response.status === 403 || response.status === 429) continue;
            return { text: "", keyIndex: keyIndex, error: lastError };
        }

        var data;
        try {
            data = JSON.parse(response.text());
        } catch (e2) {
            return { text: "", keyIndex: keyIndex, error: "Gemini trả về dữ liệu không hợp lệ" };
        }

        var translated = extractText(data);
        if (!translated) {
            var reason = blockedReason(data);
            return {
                text: "",
                keyIndex: keyIndex,
                error: reason ? "Gemini không thể dịch: " + reason : "Gemini không trả về bản dịch"
            };
        }

        var finalText = parseTranslationResult(stripCodeFence(translated), false).translation;
        if (!finalText) {
            return { text: "", keyIndex: keyIndex, error: "Gemini không trả về bản dịch hợp lệ" };
        }
        return { text: finalText, keyIndex: keyIndex, error: "" };
    }

    return { text: "", keyIndex: -1, error: lastError || "Không có Gemini API key khả dụng" };
}

function isMostlyUntranslated(translated, original, from, to) {
    if (String(to || "").toLowerCase().indexOf("zh") === 0) return false;
    if (!isChineseSource(original, from)) return false;
    var originalCount = countChinese(original);
    if (originalCount < 10) return false;
    var remaining = countChinese(translated);
    return remaining >= 10 && remaining >= originalCount * 0.2;
}

function shouldUseGemini(source) {
    if (source === "tableOfContent") return readBoolean("translate_table_of_content", false);
    if (source === "detail") return readBoolean("translate_detail", false);
    if (source === "discovery") return readBoolean("translate_discovery", false);
    return true;
}

function translateWithFallback(text, from, to, source) {
    if (readBoolean("use_qt_fallback", true)) {
        var qtText = translateWithQt(text, from, to, source);
        if (qtText) {
            return Response.success(qtText);
        }
    }

    var baiduResult = baiduTranslateText(text, from, to);
    if (baiduResult.text) {
        return Response.success(baiduResult.text);
    }
    return Response.error(baiduResult.error || "Không thể dịch bằng Baidu");
}

function translateWithQt(text, from, to, source) {
    if (to !== "vi") return "";
    if (!isChineseSource(text, from)) return "";

    try {
        var result = Qt.translate(text, to, {
            source: source,
            chapter_name: source === "tableOfContent",
            first_line_chapter_name: source === "tableOfContent",
            first_capitalize: true
        });
        var translated = result && result.translateText ? String(result.translateText).trim() : "";
        return translated && translated !== String(text).trim() ? translated : "";
    } catch (e) {
        return "";
    }
}

function loadTranslationMemory(text, from, to, source) {
    var context = {
        enabled: false,
        bookId: "",
        prompt: "",
        existing: {},
        included: {},
        lines: []
    };

    if (!readBoolean("use_translation_memory", true)) return context;

    if (source !== "chapterContent" || to !== "vi" || !isChineseSource(text, from)) return context;

    var info;
    try {
        info = localBook.getInfo();
    } catch (e) {
        return context;
    }

    if (!info || !info.id) return context;

    context.enabled = true;
    context.bookId = String(info.id);

    try {
        var totalRows = localDatabase.count(context.bookId, TRANSLATION_MEMORY_TABLE);
        var rows;
        if (totalRows > MAX_MEMORY_ROWS) {
            var half = Math.floor(MAX_MEMORY_ROWS / 2);
            rows = localDatabase.list(context.bookId, TRANSLATION_MEMORY_TABLE, 0, half);
            var recentRows = localDatabase.list(
                context.bookId,
                TRANSLATION_MEMORY_TABLE,
                Math.max(0, totalRows - half),
                half
            );
            for (var recentIndex = 0; recentRows && recentIndex < recentRows.length; recentIndex++) {
                rows.push(recentRows[recentIndex]);
            }
        } else {
            rows = localDatabase.list(context.bookId, TRANSLATION_MEMORY_TABLE, 0, MAX_MEMORY_ROWS);
        }

        for (var i = 0; rows && i < rows.length; i++) {
            var rowKey = String(rows[i].key || "").trim();
            if (!rowKey) continue;
            context.existing[rowKey] = true;
            addStoredMemoryLine(context, rowKey, String(rows[i].value || ""), text);
        }

    } catch (databaseError) {}

    try {
        addBookDictionary(context, text, localBook.getNames(), "name");
        addBookDictionary(context, text, localBook.getQtNames(), "name");
        addBookDictionary(context, text, localBook.getQtVietPhrases(), "term");
    } catch (dictionaryError) {}

    if (context.lines.length > 0) {
        context.prompt = "Dùng chính xác bộ nhớ dịch riêng của truyện dưới đây; không đổi tên hoặc diễn giải lại các mục đã có:\n" +
            context.lines.join("\n");
    }

    return context;
}

function addStoredMemoryLine(context, source, rawValue, text) {
    var target = rawValue;
    var kind = "term";
    var note = "";
    var aliases = [];
    var details = [];

    try {
        var data = JSON.parse(rawValue);
        if (data && data.target) target = String(data.target);
        if (data && data.kind) kind = String(data.kind);
        if (data && data.note) note = String(data.note);
        if (data && Array.isArray(data.aliases)) aliases = data.aliases;
        if (data && data.gender && data.gender !== "unknown") details.push("giới tính: " + oneLine(data.gender));
        if (data && data.role) details.push("vai trò: " + oneLine(data.role));
        if (data && Array.isArray(data.relationships)) {
            for (var relationshipIndex = 0; relationshipIndex < data.relationships.length; relationshipIndex++) {
                var relationship = data.relationships[relationshipIndex];
                if (!relationship || !relationship.with || !relationship.type) continue;
                var relationshipText = oneLine(relationship.with) + ": " + oneLine(relationship.type);
                if (relationship.addressTo) relationshipText += ", gọi họ: " + oneLine(relationship.addressTo);
                if (relationship.addressFrom) relationshipText += ", họ gọi lại: " + oneLine(relationship.addressFrom);
                details.push("quan hệ " + relationshipText);
            }
        }
        if (data && data.autoNote) details.push(oneLine(data.autoNote));
    } catch (e) {}

    var matched = text.indexOf(source) >= 0;
    var validAliases = [];
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
        var alias = oneLine(aliases[aliasIndex]);
        if (!alias || alias === source) continue;
        validAliases.push(alias);
        if (text.indexOf(alias) >= 0) matched = true;
    }
    if (!matched) return;

    if (note) details.unshift(note);
    var displaySource = source;
    if (validAliases.length > 0) displaySource += " (còn gọi: " + validAliases.join(", ") + ")";
    addMemoryLine(context, displaySource, target, kind, details.join("; "));
}

function addBookDictionary(context, text, dictionary, kind) {
    if (!dictionary) return;
    for (var source in dictionary) {
        if (!dictionary.hasOwnProperty(source)) continue;
        source = String(source || "").trim();
        if (!source || text.indexOf(source) < 0) continue;
        addMemoryLine(context, source, String(dictionary[source] || ""), kind, "");
        if (context.lines.length >= MAX_MEMORY_MATCHES) return;
    }
}

function addMemoryLine(context, source, target, kind, note) {
    if (!source || !target || context.included[source]) return;
    // A Chinese "translation" tells the model to keep the source text and snowballs into
    // fully untranslated chapters; ignore such entries, including ones already stored.
    if (containsChinese(target)) return;
    if (context.lines.length >= MAX_MEMORY_MATCHES) return;

    context.included[source] = true;
    var line = "- " + oneLine(source) + " => " + oneLine(target) + " [" + oneLine(kind || "term") + "]";
    if (note) line += " — " + oneLine(note);
    context.lines.push(line);
}

function parseTranslationResult(value, expectsMemory) {
    var raw = stripCodeFence(String(value || "")).trim();
    var data = parseTranslationJson(raw);
    var translation = readTranslationValue(data);

    if (translation) {
        return {
            translation: translation,
            memory: expectsMemory && Array.isArray(data.memory) ? data.memory : []
        };
    }

    var extracted = extractLooseTranslation(raw);
    if (extracted) return { translation: extracted, memory: [] };

    if (!expectsMemory && !looksLikeJsonResult(raw)) {
        return { translation: raw, memory: [] };
    }

    return { translation: "", memory: [] };
}

function parseTranslationJson(value) {
    try {
        return JSON.parse(value);
    } catch (e) {}

    var start = value.indexOf("{");
    var end = value.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
        return JSON.parse(value.substring(start, end + 1));
    } catch (e2) {
        return null;
    }
}

function readTranslationValue(data) {
    if (!data || data.translation === null || data.translation === undefined) return "";
    if (typeof data.translation === "string") return data.translation;
    if (data.translation && typeof data.translation.text === "string") return data.translation.text;
    return "";
}

function extractLooseTranslation(value) {
    var memoryDelimited = value.match(/"translation"\s*:\s*"([\s\S]*)"\s*,\s*"memory"\s*:/);
    if (memoryDelimited) return decodeLooseJsonString(memoryDelimited[1]);

    var match = value.match(/"translation"\s*:\s*"((?:\\.|[^"\\])*)"/);
    return match ? decodeLooseJsonString(match[1]) : "";
}

function decodeLooseJsonString(value) {
    try {
        return String(JSON.parse('"' + value + '"'));
    } catch (e) {}

    try {
        var escapedControls = value
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t");
        return String(JSON.parse('"' + escapedControls + '"'));
    } catch (e2) {}

    return String(value)
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
}

function looksLikeJsonResult(value) {
    var trimmed = String(value || "").trim();
    return trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[" || /"translation"\s*:/.test(trimmed);
}

function persistTranslationMemory(context, input, items) {
    if (!context.bookId || !Array.isArray(items) || items.length === 0) return;

    var records = [];
    for (var i = 0; i < items.length && records.length < MAX_LEARNED_ITEMS; i++) {
        var item = items[i];
        if (!item) continue;

        var source = String(item.source || "").trim();
        var target = String(item.target || "").trim();
        if (!source || !target || context.existing[source]) continue;
        if (source.length > 80 || target.length > 160) continue;
        if (!containsChinese(source) || input.indexOf(source) < 0) continue;
        if (containsChinese(target)) continue;

        var kind = normalizeMemoryKind(item.kind);
        var note = oneLine(String(item.note || ""));
        if (note.length > 300) note = note.substring(0, 300);

        records.push({
            key: source,
            value: JSON.stringify({ target: target, kind: kind, note: note })
        });
        context.existing[source] = true;
    }

    if (records.length === 0) return;

    try {
        localDatabase.upsertAll(context.bookId, TRANSLATION_MEMORY_TABLE, records);
    } catch (e) {}
}

function extractTranslationMemory(endpoint, apiKey, original, translated, memoryPrompt) {
    var instruction = "Xác định tối đa 20 tên riêng, địa danh, tổ chức, danh hiệu hoặc thuật ngữ lặp lại có độ tin cậy cao trong nguyên văn tiếng Trung. " +
        "Dùng đúng cách gọi tương ứng đã xuất hiện trong bản dịch tiếng Việt. Không tự đặt tên hoặc diễn giải lại bộ nhớ hiện có. " +
        "Chỉ trả về một đối tượng JSON có mảng memory; mỗi phần tử gồm source, target, kind và note. " +
        "Mỗi source phải là chuỗi con tiếng Trung chính xác trong NGUYÊN VĂN. Nếu không chắc chắn thì bỏ qua mục đó.";
    if (memoryPrompt) instruction += "\n\n" + memoryPrompt;
    var request = {
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: "user", parts: [{ text: "NGUYÊN VĂN:\n" + original + "\n\nBẢN DỊCH TIẾNG VIỆT:\n" + translated }] }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
            responseMimeType: "application/json"
        }
    };
    applyGeminiSafetySettings(request);

    try {
        var response = fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify(request),
            timeout: 30000
        });
        if (!response.ok) return [];
        var data = JSON.parse(response.text());
        var result = parseTranslationJson(stripCodeFence(extractText(data)));
        return result && Array.isArray(result.memory) ? result.memory : [];
    } catch (e) {
        return [];
    }
}

function normalizeMemoryKind(value) {
    var kind = String(value || "term").toLowerCase();
    if (kind === "character" || kind === "place" || kind === "organization" || kind === "term") {
        return kind;
    }
    return "term";
}

function shouldRepairChinese(translated, original, from, to) {
    if (!readBoolean("retry_untranslated_chinese", true)) return false;
    if (to !== "vi" || !isChineseSource(original, from)) return false;
    var count = countChinese(translated);
    if (count === 0) return false;
    return true;
}

function repairRemainingChinese(endpoint, apiKey, draft, memoryPrompt, maxOutputTokens) {
    var previous = String(draft || "");
    var matches = previous.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
    var seen = {};
    var items = [];

    for (var index = 0; index < matches.length; index++) {
        var fragment = String(matches[index] || "");
        if (!fragment || seen[fragment]) continue;
        seen[fragment] = true;
        items.push({
            id: String(items.length),
            fragment: fragment,
            context: chineseFragmentContext(previous, fragment)
        });
        if (items.length > MAX_CHINESE_REPAIR_FRAGMENTS) return previous;
    }

    if (items.length === 0) return previous;

    var replacements = translateChineseFragmentsOnce(
        endpoint,
        apiKey,
        items,
        memoryPrompt,
        maxOutputTokens
    );
    if (!replacements) return previous;

    var repaired = previous;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
        var item = items[itemIndex];
        var replacement = replacements[item.id];
        if (!replacement || countChinese(replacement) > 0) return previous;
        repaired = repaired.split(item.fragment).join(replacement);
    }

    return countChinese(repaired) === 0 ? repaired : previous;
}

function chineseFragmentContext(text, fragment) {
    var value = String(text || "");
    var position = value.indexOf(fragment);
    if (position < 0) return fragment;
    var start = Math.max(0, position - CHINESE_FRAGMENT_CONTEXT_LENGTH);
    var end = Math.min(value.length, position + fragment.length + CHINESE_FRAGMENT_CONTEXT_LENGTH);
    return value.substring(start, end);
}

function translateChineseFragmentsOnce(endpoint, apiKey, items, memoryPrompt, maxOutputTokens) {
    var instruction = "Dịch mọi cụm tiếng Trung được cung cấp sang tiếng Việt tự nhiên để chèn vào bản dịch văn học hiện có. " +
        "Chỉ dùng ngữ cảnh của từng mục để xác định nghĩa, tên riêng và cách xưng hô; không dịch hoặc trả lại phần ngữ cảnh. " +
        "Chỉ trả về một đối tượng JSON hợp lệ, không dùng Markdown, theo đúng cấu trúc: " +
        '{"items":[{"id":"0","translation":"phần tiếng Việt thay thế"}]}. ' +
        "Trả về mỗi id đầu vào đúng một lần. Mỗi translation chỉ được chứa phần thay thế cho cụm tương ứng.";
    if (memoryPrompt) instruction += "\n\n" + memoryPrompt;

    var request = {
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{
            role: "user",
            parts: [{ text: JSON.stringify({ items: items }) }]
        }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: Math.min(maxOutputTokens || 4096, 4096)
        }
    };
    applyGeminiSafetySettings(request);
    var body = JSON.stringify(request);

    try {
        var response = fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: body,
            timeout: 30000
        });
        if (!response.ok) return "";

        var data = JSON.parse(response.text());
        var output = stripCodeFence(extractText(data)).trim();
        if (!output) return null;

        var parsed = JSON.parse(output);
        if (!parsed || !Array.isArray(parsed.items)) return null;

        var replacements = {};
        for (var index = 0; index < parsed.items.length; index++) {
            var translatedItem = parsed.items[index];
            if (!translatedItem || translatedItem.id === undefined) continue;
            var id = String(translatedItem.id);
            var translation = String(translatedItem.translation || "").trim();
            if (translation) replacements[id] = translation;
        }
        return replacements;
    } catch (e) {
        return null;
    }
}

function containsChinese(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function countChinese(value) {
    var matches = String(value || "").match(/[\u3400-\u9fff\uf900-\ufaff]/g);
    return matches ? matches.length : 0;
}

function oneLine(value) {
    return String(value || "").replace(/[\r\n\t]+/g, " ").trim();
}

function isChineseSource(text, from) {
    var language = String(from || "auto").toLowerCase();
    if (language === "zh" || language.indexOf("zh-") === 0) return true;
    if (language !== "auto") return false;
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

function readConfig(key, fallback) {
    var value = localConfig.getItem(translationConfigKey(key));
    return value === null || value === undefined || value === "" ? fallback : String(value);
}

function readBookCustomInstruction() {
    try {
        var info = localBook.getInfo();
        if (info && info.id) {
            var key = translationBookPromptConfigKey(String(info.id));
            return readConfig(key, "").trim();
        }
    } catch (e) {}
    return "";
}

function readBoolean(key, fallback) {
    return readConfig(key, fallback ? "true" : "false") === "true";
}

function readApiKeys() {
    var raw = readConfig("api_key", "").trim();
    if (!raw) return [];

    var values;
    try {
        values = JSON.parse(raw);
    } catch (e) {
        values = raw.split("\n");
    }
    if (!Array.isArray(values)) values = [String(values)];

    var keys = [];
    for (var i = 0; i < values.length; i++) {
        var key = String(values[i] || "").trim();
        if (key && keys.indexOf(key) === -1) keys.push(key);
    }
    return keys;
}

function readApiError(response) {
    var errorText = response.text();
    var errorData;
    try {
        errorData = JSON.parse(errorText);
    } catch (e) {
        errorData = null;
    }
    var message = errorData && errorData.error && errorData.error.message ? String(errorData.error.message) : "";
    return "Gemini HTTP " + response.status + (message ? ": " + message : "");
}

function readNumber(key, fallback, min, max) {
    var value = parseFloat(readConfig(key, String(fallback)));
    if (isNaN(value)) value = fallback;
    if (value < min) value = min;
    if (value > max) value = max;
    return value;
}

function normalizeModel(model) {
    var selected = String(model || "").trim();
    var models = {
        "gemini-3.5-flash-lite": true,
        "gemini-3.6-flash": true,
        "gemini-3.8-flash": true,
        "gemini-4-argon": true,
        "gemini-3-flash-preview": true,
        "gemini-3.1-pro-preview": true,
        "gemini-3.1-flash-lite": true,
        "gemini-2.5-flash": true,
        "gemini-2.5-flash-lite": true,
        "gemini-2.5-pro": true
    };
    // Shut-down models keep working for saved settings via Google's own replacements.
    var retired = {
        "gemini-3.7-flash": "gemini-3.8-flash",
        "gemini-3.5-flash": "gemini-3.6-flash"
    };
    if (retired[selected]) return retired[selected];
    return models[selected] ? selected : "gemini-3.5-flash-lite";
}

function buildInstruction(from, to, source, style, customInstruction, memoryPrompt) {
    var sourceLanguage = from === "auto" ? "ngôn ngữ nguồn được tự động nhận diện" : from;
    var stylePrompt = to === "vi" ? loadTranslationStylePrompt(style) : "";
    var sourcePrompt = "";
    if (source === "chapterContent") {
        sourcePrompt = "Viết văn xuôi trôi chảy, phù hợp với một chương truyện.";
    } else if (source === "tableOfContent") {
        sourcePrompt = "Giữ nguyên số thứ tự chương và dịch tiêu đề ngắn gọn.";
    } else if (source === "detail") {
        sourcePrompt = "Giữ nguyên các nhãn thông tin và mọi cấu trúc HTML.";
    } else if (source === "discovery") {
        sourcePrompt = "Dịch tiêu đề, thẻ và mô tả ngắn một cách súc tích.";
    }
    var template = readConfig("system_prompt", translationDefaultSystemPrompt());
    var values = {
        source_language: sourceLanguage,
        target_language: to,
        style_prompt: stylePrompt ? "PHONG CÁCH DỊCH TRUYỆN:\n" + stylePrompt : "",
        source_prompt: sourcePrompt,
        custom_instruction: customInstruction ? "YÊU CẦU RIÊNG:\n" + customInstruction : "",
        memory_prompt: memoryPrompt || ""
    };
    for (var key in values) {
        if (values.hasOwnProperty(key)) {
            template = template.split("{" + key + "}").join(values[key]);
        }
    }
    return String(template).replace(/\n{3,}/g, "\n\n").trim();
}

function loadTranslationStylePrompt(style) {
    var selected = translationNormalizeStyle(style);
    try {
        var stored = localDatabase.get(TRANSLATION_PROMPT_SCOPE, TRANSLATION_PROMPT_TABLE, selected);
        if (stored !== null && stored !== undefined) {
            return String(stored).trim();
        }
    } catch (e) {}
    return translationDefaultPrompt(selected);
}

function extractText(data) {
    if (!data || !data.candidates || data.candidates.length === 0) return "";
    var content = data.candidates[0].content;
    if (!content || !content.parts) return "";

    var result = "";
    var fallback = "";
    for (var i = 0; i < content.parts.length; i++) {
        var part = content.parts[i];
        if (!part || !part.text) continue;
        fallback += String(part.text);
        if (!part.thought) result += String(part.text);
    }
    return result || fallback;
}

function blockedReason(data) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
        return String(data.promptFeedback.blockReason);
    }
    if (data && data.candidates && data.candidates.length > 0 && data.candidates[0].finishReason) {
        return String(data.candidates[0].finishReason);
    }
    return "";
}

function stripCodeFence(text) {
    var value = String(text).trim();
    var match = value.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
    return match ? match[1] : value;
}
