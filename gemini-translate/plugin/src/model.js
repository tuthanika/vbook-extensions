function execute() {
    return Response.success([
        {
            id: "gemini-3.5-flash-lite",
            name: "Gemini 3.5 Flash-Lite",
            description: "Mặc định; nhanh và tiết kiệm cho khối lượng dịch lớn",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.8-flash",
            name: "Gemini 3.8 Flash",
            description: "Flash mới nhất, ưu tiên chất lượng và suy luận",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.7-flash",
            name: "Gemini 3.7 Flash",
            description: "Flash thế hệ trước, chất lượng cao",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.6-flash",
            name: "Gemini 3.6 Flash",
            description: "Cân bằng chất lượng, tốc độ và độ ổn định",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.5-flash",
            name: "Gemini 3.5 Flash",
            description: "Model Flash ổn định",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.1-flash-lite",
            name: "Gemini 3.1 Flash-Lite",
            description: "Flash-Lite đời trước, còn được hỗ trợ",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.1-pro-preview",
            name: "Gemini 3.1 Pro Preview",
            description: "Chất lượng cao; bản preview, cần tài khoản có quota Pro",
            isNetworkRequired: true
        }
    ]);
}
