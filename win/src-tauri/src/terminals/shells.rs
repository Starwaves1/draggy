//! Which shells a terminal can open and how each one starts. The shells differ by OS (`platform::shells`); a command's
//! description and the quiet environment it starts with are shared.

use std::collections::BTreeMap;
use std::path::PathBuf;

pub use crate::platform::shells::{
    ANSWERS_CURSOR_QUERY, Env, available, interactive, invocation, terminal_env,
};

/// A command ready to start. `verbatim` arguments reach the program as written, unquoted (cmd only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub shell: String,
    pub file: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub verbatim: bool,
    pub notice: Option<String>,
}

/// The environment a command starts with: this process's, set so nothing stops to prompt, then `extra`.
pub fn build_env(extra: &[(String, String)]) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = std::env::vars().collect();
    let quiet = [
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GH_PROMPT_DISABLED", "1"),
        ("GIT_PAGER", "cat"),
        ("PAGER", "cat"),
        ("NO_COLOR", "1"),
        ("TERM", "dumb"),
    ];
    for (name, value) in quiet {
        env.insert(name.to_string(), value.to_string());
    }
    for (name, value) in extra {
        env.insert(name.clone(), value.clone());
    }
    env.remove("ELECTRON_RUN_AS_NODE");
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_environment_cannot_prompt_and_extra_wins() {
        let env = build_env(&[("TERM".into(), "xterm-256color".into())]);
        assert_eq!(
            env.get("GIT_TERMINAL_PROMPT").map(String::as_str),
            Some("0")
        );
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
    }
}
