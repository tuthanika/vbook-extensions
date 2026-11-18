function execute() {
    return Response.success([
        {
            id: "gemini-3.5-flash-lite",
            name: "Gemini 3.5 Flash-Lite",
            description: "Mặc định; nhanh và tiết kiệm nhất cho khối lượng dịch lớn",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.6-flash",
            name: "Gemini 3.6 Flash",
            description: "Cân bằng chất lượng, tốc độ và chi phí",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.8-flash",
            name: "Gemini 3.8 Flash",
            description: "Flash thông minh nhất, dịch kỹ hơn",
            isNetworkRequired: true
        },
        {
            id: "gemini-4-hydrogen",
            name: "Gemini 4 Hydrogen",
            description: "Gemini 4 nhanh và rẻ nhất; có free tier",
            isNetworkRequired: true
        },
        {
            id: "gemini-4-argon",
            name: "Gemini 4 Argon",
            description: "Gần bằng Carbon nhưng nhanh hơn; cần tài khoản trả phí",
            isNetworkRequired: true
        },
        {
            id: "gemini-4-carbon",
            name: "Gemini 4 Carbon",
            description: "Model mạnh nhất; chậm, đắt và cần tài khoản trả phí",
            isNetworkRequired: true
        },
        {
            id: "gemini-3-flash-preview",
            name: "Gemini 3 Flash Preview",
            description: "Bản preview, chất lượng cao với chi phí thấp",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.1-pro-preview",
            name: "Gemini 3.1 Pro Preview",
            description: "Bản preview, chất lượng cao; cần tài khoản có quota Pro",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.1-flash-lite",
            name: "Gemini 3.1 Flash-Lite",
            description: "Sắp ngừng (7/5/2027); nên chuyển sang 3.5 Flash-Lite",
            isNetworkRequired: true
        },
        {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            description: "Ngừng 1/12/2026, tự chuyển sang 3.5 Flash-Lite",
            isNetworkRequired: true
        },
        {
            id: "gemini-2.5-flash-lite",
            name: "Gemini 2.5 Flash-Lite",
            description: "Chỉ dùng được với tài khoản còn quyền truy cập Gemini 2.5",
            isNetworkRequired: true
        },
        {
            id: "gemini-2.5-pro",
            name: "Gemini 2.5 Pro",
            description: "Ngừng 1/12/2026, tự chuyển sang 3.8 Flash",
            isNetworkRequired: true
        },
        {
            id: "gemma-4-31b-it",
            name: "Gemma 4 31B",
            description: "Model mở của Google; suy nghĩ chỉ bật (high) hoặc tắt",
            isNetworkRequired: true
        },
        {
            id: "gemma-4-26b-a4b-it",
            name: "Gemma 4 26B A4B",
            description: "Gemma 4 MoE, nhanh hơn 31B; suy nghĩ chỉ bật (high) hoặc tắt",
            isNetworkRequired: true
        }
    ]);
}
