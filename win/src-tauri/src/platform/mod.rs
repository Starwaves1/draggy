//! Code that differs by OS. This is the only place that picks one; each OS folder offers the same functions.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use self::macos::{shells, sysinfo, window};

#[cfg(not(target_os = "macos"))]
mod windows;
#[cfg(not(target_os = "macos"))]
pub use self::windows::{shells, sysinfo, window};
