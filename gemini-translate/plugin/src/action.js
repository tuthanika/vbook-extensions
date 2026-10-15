function execute() {
    var actions = {
        restore_defaults: {
            name: "Khôi phục cài đặt gốc",
            description: "Đặt lại toàn bộ cấu hình Gemini Translate và các prompt đã sửa về mặc định. Bộ nhớ dịch theo truyện không bị xóa.",
            script: "reset-defaults.js"
        }
    };
    try {
        var book = localBook.getInfo();
        if (book && book.id) {
            actions.analyze_translation_memory = {
                name: "Phân tích tên và quan hệ",
                description: "Phân tích từ chương đang đọc và các chương kế sau để cập nhật bộ nhớ dịch của truyện",
                script: "analyze-memory.js"
            };
        }
    } catch (e) {}
    return Response.success(actions);
}
