//! Facts about this machine: memory, volume space, the processor and graphics card names.

use std::path::PathBuf;
use std::sync::LazyLock;

use draggy_engine::hardware_probe::{Memory, Space};
use regex::Regex;

pub use crate::platform::sysinfo::{cpu_model, gpu_name, memory, volume_space};

static SOFTWARE_RENDERER: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)basic render|swiftshader|llvmpipe|softpipe|microsoft basic").ok()
});
static TRADEMARK: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?i)\((TM|R)\)").ok());

/// Adapters that draw without a GPU: naming one of them would describe the machine wrongly.
pub fn is_software_renderer(name: &str) -> bool {
    SOFTWARE_RENDERER
        .as_ref()
        .is_some_and(|re| re.is_match(name))
}

/// A card name without trademark marks or doubled spaces.
pub fn tidy_name(name: &str) -> String {
    let stripped = match TRADEMARK.as_ref() {
        Some(re) => re.replace_all(name, "").into_owned(),
        None => name.to_owned(),
    };
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The value of a `reg query` line for `value`, e.g. `DriverDesc    REG_SZ    NVIDIA GeForce`.
pub fn reg_string_values(out: &str, value: &str) -> Vec<String> {
    out.lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix(value)?;
            let (kind, data) = rest.trim_start().split_once(char::is_whitespace)?;
            (kind == "REG_SZ").then(|| data.trim().to_owned())
        })
        .filter(|data| !data.is_empty())
        .collect()
}

/// The first graphics adapter name that is real hardware.
pub fn pick_gpu_name(names: &[String]) -> Option<String> {
    names
        .iter()
        .find(|name| !is_software_renderer(name))
        .map(|name| tidy_name(name))
}

fn system_root() -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
}

pub fn reg_exe() -> PathBuf {
    system_root().join("System32").join("reg.exe")
}

pub fn logical_cpus() -> usize {
    std::thread::available_parallelism().map_or(1, usize::from)
}

/// The value of `key` in `sysctl <key>...` output, whose lines read `hw.memsize: 17179869184`.
pub fn sysctl_value(out: &str, key: &str) -> Option<String> {
    out.lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim() == key)
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Memory from `sysctl hw.memsize kern.memorystatus_level`: the level is the percent macOS counts as available.
pub fn sysctl_memory(out: &str) -> Memory {
    let number = |key: &str| sysctl_value(out, key).and_then(|value| value.parse::<u64>().ok());
    let total_bytes = number("hw.memsize").unwrap_or(0);
    let level = number("kern.memorystatus_level").unwrap_or(0).min(100);
    Memory {
        total_bytes,
        free_bytes: (u128::from(total_bytes) * u128::from(level) / 100) as u64,
    }
}

/// The first real adapter in `system_profiler -json SPDisplaysDataType`, by model name or else entry name.
pub fn display_gpu_name(json: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(json).ok()?;
    let names: Vec<String> = parsed
        .get("SPDisplaysDataType")?
        .as_array()?
        .iter()
        .filter_map(|entry| {
            ["sppci_model", "_name"]
                .iter()
                .filter_map(|key| entry.get(*key).and_then(serde_json::Value::as_str))
                .find(|name| !name.trim().is_empty())
                .map(str::to_owned)
        })
        .collect();
    pick_gpu_name(&names)
}

/// Size and free space from `df -k -P`, in bytes. Found by the capacity column, since names may hold spaces.
pub fn df_space(out: &str) -> Option<Space> {
    let fields: Vec<&str> = out.lines().nth(1)?.split_whitespace().collect();
    let kib = |field: &str| field.parse::<u64>().ok().map(|n| n.saturating_mul(1024));
    fields.windows(4).find_map(|run| {
        let [size, used, free, capacity] = run else {
            return None;
        };
        capacity.ends_with('%').then_some(())?;
        kib(used)?;
        Some(Space {
            size_bytes: kib(size)?,
            free_bytes: kib(free)?,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn software_renderers_are_not_named() {
        assert!(is_software_renderer("Microsoft Basic Render Driver"));
        assert!(is_software_renderer("Google SwiftShader"));
        assert!(!is_software_renderer("NVIDIA GeForce RTX 4070"));
    }

    #[test]
    fn names_lose_marks_and_extra_spaces() {
        assert_eq!(
            tidy_name("Intel(R)  UHD Graphics (TM) 770"),
            "Intel UHD Graphics 770"
        );
    }

    #[test]
    fn picks_the_first_real_adapter_from_registry_output() {
        let out = "HKEY_LOCAL_MACHINE\\x\\0000\r\n    DriverDesc    REG_SZ    Microsoft Basic Render Driver\r\n\r\nHKEY\\0001\r\n    DriverDesc    REG_SZ    AMD Radeon(TM) 780M\r\n";
        let names = reg_string_values(out, "DriverDesc");
        assert_eq!(names.len(), 2);
        assert_eq!(pick_gpu_name(&names).as_deref(), Some("AMD Radeon 780M"));
        assert_eq!(pick_gpu_name(&[]), None);
    }

    #[test]
    fn mac_probe_output_parses_as_the_fixture_expects() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../shared/fixtures/platform/hardware-macos.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(cases.len() >= 8, "the fixture lost its cases");
        for case in cases {
            let text = case["input"]["text"].as_str().unwrap();
            let actual = match case["input"]["op"].as_str().unwrap() {
                "memory" => {
                    let memory = sysctl_memory(text);
                    serde_json::json!({ "totalBytes": memory.total_bytes, "freeBytes": memory.free_bytes })
                }
                "cpu" => serde_json::json!(sysctl_value(text, "machdep.cpu.brand_string")),
                "gpu" => serde_json::json!(display_gpu_name(text)),
                "df" => serde_json::json!(df_space(text).map(|space| serde_json::json!({
                    "sizeBytes": space.size_bytes,
                    "freeBytes": space.free_bytes,
                }))),
                other => panic!("no runner for {other}"),
            };
            assert_eq!(actual, case["expected"], "{}", case["name"]);
        }
    }

    #[test]
    fn free_space_never_exceeds_the_volume() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../shared/fixtures/platform/hardware-macos.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let spaces: Vec<Space> = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|case| case["input"]["op"] == "df")
            .filter_map(|case| df_space(case["input"]["text"].as_str().unwrap()))
            .collect();
        assert!(spaces.iter().any(|space| space.size_bytes > 0));
        assert!(
            spaces
                .iter()
                .all(|space| space.free_bytes <= space.size_bytes)
        );
    }
}
