function execute() {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem("dbg_log") || "[]"); } catch (e) {}
    return Response.success(arr.slice(-8).join("\n") || "Chưa có log");
}