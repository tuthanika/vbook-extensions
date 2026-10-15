function applyGeminiSafetySettings(request) {
    var enabled = false;
    try {
        enabled = String(localConfig.getItem(translationConfigKey("enable_safety_filter")) || "false") === "true";
    } catch (e) {}

    if (!enabled) {
        request.safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ];
    }
    return request;
}
