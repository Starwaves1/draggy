use draggy_engine::command::{ProcessRunner, run_text};
use draggy_engine::hardware_probe::{Memory, Space};

use crate::engines::sysinfo::{pick_gpu_name, reg_exe, reg_string_values, tidy_name};

const DISPLAY_CLASS: &str =
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const CPU_KEY: &str = "HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0";

/// What `get-system-specs` reports as `platform`, as Node's `process.platform` named it.
pub const NODE_PLATFORM: &str = "win32";

/// Graphics memory here is the card's own, never shared with the system.
pub fn unified_memory() -> bool {
    false
}

/// The home folder, as `os.homedir()` reads it. The hardware probe lists the drive it sits on.
pub fn probe_home() -> String {
    std::env::var("USERPROFILE").unwrap_or_default()
}

/// The processor's marketing name, as `os.cpus()[0].model` reads it.
pub async fn cpu_model() -> String {
    let reg = reg_exe().to_string_lossy().into_owned();
    let out = run_text(
        &ProcessRunner,
        &reg,
        &["query", CPU_KEY, "/v", "ProcessorNameString"],
        5000,
    )
    .await
    .unwrap_or_default();
    reg_string_values(&out, "ProcessorNameString")
        .into_iter()
        .next()
        .unwrap_or_else(|| "Unknown CPU".to_owned())
}

/// The graphics card's name: nvidia-smi first, then the display class in the registry.
pub async fn gpu_name() -> Option<String> {
    let runner = ProcessRunner;
    let nvidia = run_text(
        &runner,
        "nvidia-smi",
        &["--query-gpu=name", "--format=csv,noheader"],
        4000,
    )
    .await;
    if let Some(name) = nvidia
        .as_deref()
        .and_then(|text| text.lines().next())
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return Some(tidy_name(name));
    }
    let reg = reg_exe().to_string_lossy().into_owned();
    let out = run_text(
        &runner,
        &reg,
        &["query", DISPLAY_CLASS, "/s", "/v", "DriverDesc"],
        8000,
    )
    .await
    .unwrap_or_default();
    pick_gpu_name(&reg_string_values(&out, "DriverDesc"))
}

#[cfg(windows)]
pub fn memory() -> Memory {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: the struct is zeroed apart from the length field the API requires, and outlives the call.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) != 0 {
            return Memory {
                total_bytes: status.ullTotalPhys,
                free_bytes: status.ullAvailPhys,
            };
        }
    }
    Memory {
        total_bytes: 0,
        free_bytes: 0,
    }
}

#[cfg(not(windows))]
pub fn memory() -> Memory {
    Memory {
        total_bytes: 0,
        free_bytes: 0,
    }
}

#[cfg(windows)]
pub fn volume_space(root: &str) -> Option<Space> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = std::ffi::OsStr::new(root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
    // SAFETY: `wide` is NUL-terminated and the three out pointers are live locals.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free) };
    (ok != 0).then_some(Space {
        size_bytes: total,
        free_bytes: free,
    })
}

#[cfg(not(windows))]
pub fn volume_space(_root: &str) -> Option<Space> {
    None
}
