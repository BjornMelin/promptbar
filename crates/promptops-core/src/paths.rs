use std::env;
use std::fs;
use std::path::PathBuf;

use crate::error::{IoContext, Result};

#[derive(Debug, Clone)]
pub struct StatePaths {
    pub state_root: PathBuf,
    pub config_root: PathBuf,
    pub cache_root: PathBuf,
    pub db_path: PathBuf,
    pub raw_dir: PathBuf,
    pub audit_log: PathBuf,
    pub config_file: PathBuf,
}

impl StatePaths {
    pub fn resolve() -> Result<Self> {
        Self::resolve_with_state_dir(None)
    }

    pub fn resolve_with_state_dir(state_dir: Option<PathBuf>) -> Result<Self> {
        let state_root = state_dir.unwrap_or_else(|| {
            env::var_os("PROMPTOPS_STATE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    env::var_os("XDG_STATE_HOME")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| home_dir_or_current().join(".local/state"))
                        .join("promptops")
                })
        });
        let config_root = env::var_os("PROMPTOPS_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                env::var_os("XDG_CONFIG_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home_dir_or_current().join(".config"))
                    .join("promptops")
            });
        let cache_root = env::var_os("PROMPTOPS_CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                env::var_os("XDG_CACHE_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home_dir_or_current().join(".cache"))
                    .join("promptops")
            });

        Ok(Self {
            db_path: state_root.join("promptops.sqlite"),
            raw_dir: state_root.join("raw"),
            audit_log: state_root.join("audit.jsonl"),
            config_file: config_root.join("config.toml"),
            state_root,
            config_root,
            cache_root,
        })
    }

    pub fn ensure_private_dirs(&self) -> Result<()> {
        for path in [
            &self.state_root,
            &self.config_root,
            &self.cache_root,
            &self.raw_dir,
        ] {
            fs::create_dir_all(path).at_path(path)?;
            set_private_dir(path)?;
        }
        Ok(())
    }
}

fn home_dir_or_current() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(unix)]
fn set_private_dir(path: &PathBuf) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).at_path(path)
}

#[cfg(not(unix))]
fn set_private_dir(_path: &PathBuf) -> Result<()> {
    Ok(())
}
