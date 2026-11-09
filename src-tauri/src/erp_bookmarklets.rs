//! Fixed, vendored ERP workflows; renderer input can select a tool, never supply code.
pub fn launch_script(tool: &str) -> anyhow::Result<String> {
    let mode = match tool {
        "m1a" => "m1a",
        "m7k" => "dkkn",
        _ => anyhow::bail!("Công cụ ERP không hợp lệ."),
    };
    let source = include_str!("../erp-tools/m1a-m7k.js");
    anyhow::ensure!(
        source.contains("const START_MODE = 'm1a';"),
        "Lõi ERP không đúng phiên bản."
    );
    let source = source.replace(
        "const START_MODE = 'm1a';",
        &format!("const START_MODE = '{mode}';"),
    );
    Ok(include_str!("../erp-tools/launch.js")
        .replace("'__TOOL__'", &serde_json::to_string(tool)?)
        .replace("/*__SOURCE__*/", &source))
}
