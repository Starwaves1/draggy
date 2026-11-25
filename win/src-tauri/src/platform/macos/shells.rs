//! The shells a terminal can open on a Mac, each named by its absolute path. A path never equals a Windows id,
//! so a shell remembered on one system is simply missing on the other and the default opens.

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use crate::terminals::shells::Invocation;

const SHELLS_FILE: &str = "/etc/shells";
const STANDARD: [&str; 3] = ["/bin/zsh", "/bin/bash", "/bin/sh"];
/// In a stock /etc/shells but seldom wanted, so offered only as someone's login shell.
const LEGACY: [&str; 4] = ["/bin/csh", "/bin/dash", "/bin/ksh", "/bin/tcsh"];
const FALLBACK_LANG: &str = "en_US.UTF-8";

/// Every command the agent asks for gets this answer. There is no sandbox on macOS yet, and the renderer
/// approves some commands because it believes they run in one.
pub const AGENT_REFUSAL: &str =
    "Commands for the agent cannot run on macOS yet, so the command was not run.";

/// The cursor question that ConPTY asks at start-up does not exist here; a program's own question goes to xterm.
pub const ANSWERS_CURSOR_QUERY: bool = false;

/// What decides the shell list: the login shell the app was given, /etc/shells, and which candidates can run.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub login: Option<String>,
    pub listed: String,
    pub present: Vec<PathBuf>,
}

impl Env {
    pub fn system() -> Self {
        let login = std::env::var("SHELL").ok();
        let listed = std::fs::read_to_string(SHELLS_FILE).unwrap_or_default();
        let present = login
            .iter()
            .map(String::as_str)
            .chain(STANDARD)
            .chain(listed_paths(&listed))
            .map(PathBuf::from)
            .filter(|path| runnable(path))
            .collect();
        Self {
            login,
            listed,
            present,
        }
    }
}

fn runnable(path: &Path) -> bool {
    std::fs::metadata(path)
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

fn listed_paths(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
}

fn file_name(shell: &str) -> &str {
    Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
}

/// The shells a terminal can open, the default first: the login shell when /etc/shells lists it, then zsh, bash
/// and sh, then shells someone added to /etc/shells.
pub fn available(env: &Env) -> Vec<String> {
    let listed: Vec<&str> = listed_paths(&env.listed).collect();
    let present = |shell: &&str| env.present.iter().any(|path| path == Path::new(shell));
    let login = env
        .login
        .as_deref()
        .filter(|shell| listed.contains(shell))
        .filter(present);
    let candidates = login
        .into_iter()
        .chain(STANDARD.into_iter().filter(present))
        .chain(
            listed
                .iter()
                .copied()
                .filter(|shell| !LEGACY.contains(shell))
                .filter(present),
        );
    let mut found: Vec<String> = Vec::new();
    for shell in candidates {
        if !found.iter().any(|known| known == shell) {
            found.push(shell.to_owned());
        }
    }
    found
}

/// The shell the user's terminal opens, as a login shell so the profile builds PATH (an app started from Finder
/// has a minimal one). A name such as `bash` matches the shell of that name; a shell not found opens the default.
pub fn interactive(
    env: &Env,
    requested: Option<&str>,
    default_shell: Option<&str>,
) -> Result<Invocation, String> {
    let shells = available(env);
    let Some(default) = shells.first() else {
        return Err("No shell was found on this Mac.".to_owned());
    };
    let find = |name: &str| {
        shells
            .iter()
            .find(|shell| *shell == name || file_name(shell) == name)
    };
    let mut missing = None;
    let mut chosen = None;
    for name in [requested, default_shell].into_iter().flatten() {
        if let Some(shell) = find(name) {
            chosen = Some(shell);
            break;
        }
        missing.get_or_insert(name);
    }
    let shell = chosen.unwrap_or(default);
    let notice = missing.map(|name| {
        format!(
            "{} is not on this Mac, so the terminal opened {} instead.",
            file_name(name),
            file_name(shell)
        )
    });
    Ok(Invocation {
        shell: shell.clone(),
        file: PathBuf::from(shell),
        args: vec!["-l".to_owned()],
        env: vec![("SHELL".to_owned(), default.clone())],
        verbatim: false,
        notice,
    })
}

/// The environment of the user's terminal: the app's own, as a colour terminal, with UTF-8 text.
pub fn terminal_env(extra: &[(String, String)]) -> BTreeMap<String, String> {
    terminal_env_from(std::env::vars().collect(), extra)
}

/// A person types here, so nothing is quietened as for the agent. An app started from Finder has no locale set.
fn terminal_env_from(
    mut env: BTreeMap<String, String>,
    extra: &[(String, String)],
) -> BTreeMap<String, String> {
    env.remove("ELECTRON_RUN_AS_NODE");
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    let has_locale = ["LANG", "LC_ALL", "LC_CTYPE"]
        .iter()
        .any(|name| env.get(*name).is_some_and(|value| !value.is_empty()));
    if !has_locale {
        env.insert("LANG".into(), FALLBACK_LANG.into());
    }
    for (name, value) in extra {
        env.insert(name.clone(), value.clone());
    }
    env
}

/// Refuses every command the agent asks for, sandboxed or not. See `AGENT_REFUSAL`.
pub fn invocation(
    _env: &Env,
    _command: &str,
    _requested: Option<&str>,
    _default_shell: Option<&str>,
    _sandboxed: bool,
    _sandbox_shells: &[String],
) -> Result<Invocation, String> {
    Err(AGENT_REFUSAL.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../shared/fixtures/platform/shells-macos.json");
        serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).expect("json")
    }

    fn env_of(input: &Value) -> Env {
        Env {
            login: input["login"].as_str().map(str::to_owned),
            listed: input["etcShells"].as_str().unwrap_or_default().to_owned(),
            present: input["present"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(PathBuf::from)
                .collect(),
        }
    }

    #[test]
    fn the_shell_list_and_the_opened_shell_match_the_fixture() {
        let fixture = fixture();
        let cases = fixture["cases"].as_array().expect("cases");
        assert!(cases.len() >= 8, "the fixture lost its cases");
        for case in cases {
            let input = &case["input"];
            let env = env_of(input);
            let actual = match input["op"].as_str().expect("op") {
                "available" => json!(available(&env)),
                "interactive" => {
                    match interactive(
                        &env,
                        input["requested"].as_str(),
                        input["defaultShell"].as_str(),
                    ) {
                        Ok(opened) => json!({
                            "shell": opened.shell,
                            "file": opened.file,
                            "args": opened.args,
                            "env": opened.env,
                            "notice": opened.notice,
                        }),
                        Err(error) => json!({ "error": error }),
                    }
                }
                other => panic!("no runner for {other}"),
            };
            assert_eq!(actual, case["expected"], "{}", case["name"]);
        }
    }

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn the_terminal_is_a_colour_terminal_with_utf8_and_nothing_quietened() {
        let env = terminal_env_from(
            vars(&[("PATH", "/usr/bin:/bin"), ("ELECTRON_RUN_AS_NODE", "1")]),
            &[("SHELL".to_owned(), "/bin/zsh".to_owned())],
        );
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert_eq!(env.get("COLORTERM").map(String::as_str), Some("truecolor"));
        assert_eq!(env.get("LANG").map(String::as_str), Some(FALLBACK_LANG));
        assert_eq!(env.get("SHELL").map(String::as_str), Some("/bin/zsh"));
        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin:/bin"));
        for quiet in [
            "ELECTRON_RUN_AS_NODE",
            "NO_COLOR",
            "PAGER",
            "GIT_PAGER",
            "GIT_TERMINAL_PROMPT",
        ] {
            assert!(!env.contains_key(quiet), "{quiet}");
        }
    }

    #[test]
    fn a_locale_the_user_set_is_kept() {
        let french = terminal_env_from(vars(&[("LANG", "fr_FR.UTF-8")]), &[]);
        assert_eq!(french.get("LANG").map(String::as_str), Some("fr_FR.UTF-8"));
        let ctype = terminal_env_from(vars(&[("LC_CTYPE", "UTF-8")]), &[]);
        assert!(!ctype.contains_key("LANG"));
        let empty = terminal_env_from(vars(&[("LANG", "")]), &[]);
        assert_eq!(empty.get("LANG").map(String::as_str), Some(FALLBACK_LANG));
    }

    #[test]
    fn no_agent_command_finds_a_shell() {
        let env = env_of(&fixture()["cases"][0]["input"]);
        assert!(!available(&env).is_empty());
        for shell in [
            None,
            Some("/bin/zsh"),
            Some("bash"),
            Some("cmd"),
            Some("pwsh"),
        ] {
            for sandboxed in [false, true] {
                let proven = vec!["bash".to_owned(), "/bin/zsh".to_owned()];
                let answer = invocation(&env, "echo hi", shell, shell, sandboxed, &proven);
                assert_eq!(
                    answer,
                    Err(AGENT_REFUSAL.to_owned()),
                    "{shell:?} {sandboxed}"
                );
            }
        }
    }
}

/// The agent's command paths end at `invocation`'s refusal before anything starts.
#[cfg(test)]
mod agent_boundary {
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use serde_json::json;

    use super::AGENT_REFUSAL;
    use crate::terminals::commands::{Request, run};
    use crate::terminals::sandbox::Options;
    use crate::terminals::tasks::{Manager, StartOptions};

    fn manager() -> &'static Manager {
        Box::leak(Box::new(Manager::new(None, |_| {})))
    }

    /// A launcher that exists, so a refusal cannot come from a missing one.
    fn sandbox(project: &Path, data: &Path) -> Options {
        Options {
            project: project.to_path_buf(),
            data_dir: data.to_path_buf(),
            chat_key: "boundary".to_owned(),
            launcher: Some(PathBuf::from("/bin/sh")),
            network: false,
            writable: true,
            extras: Default::default(),
        }
    }

    #[tokio::test]
    async fn run_command_refuses_and_starts_nothing() {
        let project = tempfile::tempdir().expect("project");
        let data = tempfile::tempdir().expect("data");
        let marker = project.path().join("ran");
        let command = format!("touch '{}'", marker.display());
        for shell in [
            None,
            Some("/bin/zsh"),
            Some("bash"),
            Some("sh"),
            Some("cmd"),
        ] {
            for boxed in [false, true] {
                let request = Request {
                    run_id: None,
                    root: project.path().to_path_buf(),
                    command: command.clone(),
                    shell: shell.map(str::to_owned),
                    default_shell: Some("/bin/zsh".to_owned()),
                    timeout: Some(5_000.0),
                    chat_id: "boundary".to_owned(),
                    auto_detach: false,
                    sandbox: boxed.then(|| sandbox(project.path(), data.path())),
                    on_output: Arc::new(|_| {}),
                };
                let answer = run(manager(), request).await;
                assert_eq!(
                    answer,
                    json!({ "success": false, "error": AGENT_REFUSAL }),
                    "{shell:?} sandboxed={boxed}"
                );
            }
        }
        assert!(!marker.exists());
    }

    #[test]
    fn a_background_task_refuses_and_starts_nothing() {
        let project = tempfile::tempdir().expect("project");
        let data = tempfile::tempdir().expect("data");
        let marker = project.path().join("ran");
        let command = format!("touch '{}'", marker.display());
        let manager = manager();
        let options = sandbox(project.path(), data.path());
        for boxed in [None, Some(&options)] {
            let started = manager.start(&StartOptions {
                chat_id: "boundary",
                cwd: project.path(),
                command: &command,
                shell: Some("sh"),
                default_shell: None,
                cols: 80,
                rows: 24,
                sandbox: boxed,
            });
            assert_eq!(started.err().as_deref(), Some(AGENT_REFUSAL));
        }
        assert!(manager.list("boundary").is_empty());
        assert!(!marker.exists());
    }
}

/// A real pseudo-terminal on /bin/sh: typing, the size, a program's own cursor question, closing.
#[cfg(test)]
mod real_pty {
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::mpsc::{Receiver, channel};
    use std::time::{Duration, Instant};

    use crate::terminals::pty::{Host, Launch};

    const WAIT: Duration = Duration::from_secs(10);

    /// Everything read until `wanted` shows up, or a failure naming what was read.
    fn read_until(data: &Receiver<String>, seen: &mut String, wanted: &str) {
        let deadline = Instant::now() + WAIT;
        while !seen.contains(wanted) {
            let left = deadline.saturating_duration_since(Instant::now());
            match data.recv_timeout(left) {
                Ok(chunk) => seen.push_str(&chunk),
                Err(_) => panic!("{wanted:?} never came; read {seen:?}"),
            }
        }
    }

    fn alive(pid: &str) -> bool {
        let args = ["-0".to_owned(), pid.to_owned()];
        draggy_tools::spawn::output_blocking("/bin/kill", &args)
            .is_ok_and(|out| out.status.success())
    }

    #[test]
    fn a_shell_echoes_resizes_and_its_jobs_end_with_it() {
        let host = Host::default();
        let cwd = tempfile::tempdir().expect("cwd");
        let env: BTreeMap<String, String> = [
            ("PATH", "/usr/bin:/bin"),
            ("TERM", "xterm-256color"),
            ("PS1", "$ "),
        ]
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect();
        let launch = Launch {
            file: Path::new("/bin/sh"),
            args: &[],
            cwd: cwd.path(),
            env: &env,
            cols: 80,
            rows: 24,
            scrub_secrets: true,
        };
        let (data_tx, data) = channel();
        let (exit_tx, exits) = channel();
        let opened = host
            .open(
                &launch,
                move |_, chunk| {
                    let _ = data_tx.send(chunk.to_owned());
                },
                move |_, code| {
                    let _ = exit_tx.send(code);
                },
            )
            .expect("open");
        let mut seen = String::new();

        // No history expansion, so `$!` below reaches the shell.
        assert!(host.write(&opened.id, "set +H\necho dg-$((40+2)); pwd -P\n"));
        let folder = std::fs::canonicalize(cwd.path()).expect("real path");
        read_until(&data, &mut seen, "dg-42");
        read_until(&data, &mut seen, &folder.display().to_string());

        assert!(host.resize(&opened.id, 100, 30));
        assert!(host.write(&opened.id, "stty size\n"));
        read_until(&data, &mut seen, "30 100");

        assert!(host.write(&opened.id, "printf 'q\\033[6nq\\n'\n"));
        read_until(&data, &mut seen, "q\u{1b}[6nq");

        assert!(host.write(&opened.id, "sleep 600 & echo job-$!-end\n"));
        let job = regex::Regex::new(r"job-(\d+)-end").expect("job");
        let deadline = Instant::now() + WAIT;
        let pid = loop {
            if let Some(found) = job.captures(&seen) {
                break found[1].to_owned();
            }
            let left = deadline.saturating_duration_since(Instant::now());
            match data.recv_timeout(left) {
                Ok(chunk) => seen.push_str(&chunk),
                Err(_) => panic!("no job id; read {seen:?}"),
            }
        };
        assert!(alive(&pid));

        assert!(host.close(&opened.id));
        let deadline = Instant::now() + WAIT;
        while alive(&pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(&pid), "the shell's job outlived the closed terminal");
        assert_eq!(host.count(), 0);
        assert!(exits.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn exit_reports_the_code_once() {
        let host = Host::default();
        let cwd = tempfile::tempdir().expect("cwd");
        let env = BTreeMap::from([("PATH".to_owned(), "/usr/bin:/bin".to_owned())]);
        let launch = Launch {
            file: Path::new("/bin/sh"),
            args: &[],
            cwd: cwd.path(),
            env: &env,
            cols: 80,
            rows: 24,
            scrub_secrets: true,
        };
        let (exit_tx, exits) = channel();
        let opened = host
            .open(
                &launch,
                |_, _| {},
                move |_, code| {
                    let _ = exit_tx.send(code);
                },
            )
            .expect("open");
        assert!(host.write(&opened.id, "exit 7\n"));
        assert_eq!(exits.recv_timeout(WAIT), Ok(7));
        assert!(exits.recv_timeout(Duration::from_millis(300)).is_err());
        assert_eq!(host.count(), 0);
    }
}
