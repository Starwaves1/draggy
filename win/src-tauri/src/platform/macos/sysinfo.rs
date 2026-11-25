use draggy_engine::command::{ProcessRunner, run_text};
use draggy_engine::hardware_probe::{Memory, Space};
use draggy_tools::spawn::output_blocking;

use crate::engines::sysinfo::{df_space, display_gpu_name, sysctl_memory, sysctl_value};

const SYSCTL: &str = "/usr/sbin/sysctl";
const SYSTEM_PROFILER: &str = "/usr/sbin/system_profiler";
const DF: &str = "/bin/df";
const BRAND: &str = "machdep.cpu.brand_string";

/// What `get-system-specs` reports as `platform`; the renderer's Apple silicon model rules key on it.
pub const NODE_PLATFORM: &str = "darwin";

/// Apple silicon GPUs share system memory; core's VRAM figure is then the share macOS lets them wire.
pub fn unified_memory() -> bool {
    cfg!(target_arch = "aarch64")
}

/// Empty, so the probe lists no drive: core would take "/" from a home path, and on a Mac that is
/// the read-only system volume.
pub fn probe_home() -> String {
    String::new()
}

/// The chip's name, "Apple M2 Pro" style, as `os.cpus()[0].model` reads it.
pub async fn cpu_model() -> String {
    chip().await.unwrap_or_else(|| "Unknown CPU".to_owned())
}

/// The graphics adapter's name. On Apple silicon the GPU is part of the chip, so it carries the chip's name.
pub async fn gpu_name() -> Option<String> {
    // A headless VM's system_profiler lists no adapter although its paravirtual GPU runs Metal.
    if cfg!(target_arch = "aarch64") {
        return chip().await;
    }
    let out = run_text(
        &ProcessRunner,
        SYSTEM_PROFILER,
        &["-json", "SPDisplaysDataType"],
        8000,
    )
    .await?;
    display_gpu_name(&out)
}

async fn chip() -> Option<String> {
    let out = run_text(&ProcessRunner, SYSCTL, &[BRAND], 4000).await?;
    sysctl_value(&out, BRAND)
}

/// Callers expect this synchronous, as the Win32 call is, so it waits on a quick sysctl.
pub fn memory() -> Memory {
    let args = ["hw.memsize", "kern.memorystatus_level"].map(String::from);
    // sysctl prints the keys it knows and still fails on one it does not, so its output is read either way.
    let text = output_blocking(SYSCTL, &args)
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    sysctl_memory(&text)
}

/// Space of the volume holding `root`. Core's `VolumeSpace` is synchronous, hence the blocking run.
pub fn volume_space(root: &str) -> Option<Space> {
    let args = ["-k", "-P", root].map(String::from);
    df_space(&blocking_text(DF, &args)?)
}

fn blocking_text(program: &str, args: &[String]) -> Option<String> {
    let output = output_blocking(program, args).ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Prints what this Mac reports, so a run with --nocapture doubles as the host probe.
    #[tokio::test]
    async fn this_mac_reports_plausible_hardware() {
        let cpu = cpu_model().await;
        let gpu = gpu_name().await;
        let memory = memory();
        let dir = tempfile::tempdir().unwrap();
        let space =
            volume_space(&dir.path().to_string_lossy()).expect("df answers for a temp folder");
        println!(
            "cpu {cpu:?} | gpu {gpu:?} | memory {} total {} free | volume {} size {} free",
            memory.total_bytes, memory.free_bytes, space.size_bytes, space.free_bytes
        );
        assert_ne!(cpu, "Unknown CPU");
        assert!(gpu.is_some_and(|name| !name.is_empty()));
        assert!(memory.total_bytes >= 1 << 30);
        assert!(memory.free_bytes > 0 && memory.free_bytes <= memory.total_bytes);
        assert!(space.size_bytes > 0 && space.free_bytes <= space.size_bytes);
        assert!(probe_home().is_empty());
    }
}
