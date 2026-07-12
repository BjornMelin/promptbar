use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use assert_cmd::Command;
use promptops_core::db::sha256;
use serde_json::Value;

#[test]
fn bundled_corpus_has_provenance_and_imports_cleanly() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let corpus = repository
        .join("corpus")
        .canonicalize()
        .expect("corpus root");
    let ledger: Value = serde_json::from_str(
        &std::fs::read_to_string(corpus.join("prompt-atlas-disposition.json"))
            .expect("disposition ledger"),
    )
    .expect("valid disposition JSON");

    assert_eq!(ledger["schema"], "promptbar.prompt-atlas-disposition.v1");
    assert_eq!(ledger["source"]["repository"], "BjornMelin/prompt-atlas");
    assert!(is_git_oid(&ledger["source"]["commit"]));
    assert!(is_git_oid(&ledger["source"]["tree"]));
    assert_eq!(ledger["source"]["license"]["spdx"], "MIT");
    assert!(is_git_oid(&ledger["source"]["license"]["sourceGitBlob"]));

    let notice = &ledger["source"]["license"];
    let notice_path = notice["noticePath"].as_str().expect("notice path");
    let notice_sha256 = notice["noticeSha256"].as_str().expect("notice SHA-256");
    let notice_content = std::fs::read_to_string(repository.join(notice_path)).expect(notice_path);
    assert_eq!(sha256(&notice_content), notice_sha256);

    let entries = ledger["entries"].as_array().expect("entries array");
    assert_eq!(ledger["assetCount"].as_u64(), Some(entries.len() as u64));
    assert!(
        ledger["scope"]["included"]
            .as_array()
            .is_some_and(|paths| !paths.is_empty())
    );

    let allowed = [
        "curated",
        "duplicate",
        "malformed",
        "alternate-format",
        "documentation-only",
        "superseded",
        "out-of-scope",
    ];
    let mut by_source = BTreeMap::new();
    let mut previous = None;
    for entry in entries {
        let source = entry["sourcePath"].as_str().expect("sourcePath string");
        if let Some(previous) = previous {
            assert!(previous < source, "entries are not sorted at {source}");
        }
        previous = Some(source);
        assert!(
            by_source.insert(source, entry).is_none(),
            "duplicate sourcePath {source}"
        );
        assert!(
            allowed.contains(&entry["disposition"].as_str().expect("disposition string")),
            "unsupported disposition for {source}"
        );
        assert!(is_git_oid(&entry["sourceGitBlob"]));
        assert!(entry["sourceBytes"].as_u64().is_some_and(|bytes| bytes > 0));
        assert!(
            entry["reason"]
                .as_str()
                .is_some_and(|reason| !reason.is_empty())
        );
    }

    let duplicate_entries: Vec<_> = entries
        .iter()
        .filter(|entry| entry["disposition"] == "duplicate")
        .collect();
    assert_eq!(duplicate_entries.len(), 2);
    for entry in duplicate_entries {
        let original = entry["duplicateOf"].as_str().expect("duplicateOf string");
        let original = by_source.get(original).expect("duplicate source exists");
        assert_eq!(entry["sourceGitBlob"], original["sourceGitBlob"]);
    }

    let curated: Vec<_> = entries
        .iter()
        .filter(|entry| entry["disposition"] == "curated")
        .collect();
    assert_eq!(curated.len(), 6);
    let mut destinations = BTreeSet::new();
    for entry in &curated {
        let destination = entry["destinationPath"]
            .as_str()
            .expect("curated destinationPath");
        let expected_sha256 = entry["destinationSha256"]
            .as_str()
            .expect("curated destinationSha256");
        assert!(destination.starts_with("corpus/canon/"));
        assert!(destinations.insert(destination.to_string()));
        let content = std::fs::read_to_string(repository.join(destination)).expect(destination);
        assert_eq!(
            sha256(&content),
            expected_sha256,
            "hash drift for {destination}"
        );
    }

    let actual_destinations = std::fs::read_dir(corpus.join("canon"))
        .expect("canon directory")
        .map(|entry| {
            let entry = entry.expect("canon entry");
            assert!(entry.file_type().expect("canon entry type").is_file());
            format!("corpus/canon/{}", entry.file_name().to_string_lossy())
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(actual_destinations, destinations);

    let temp = tempfile::tempdir().expect("tempdir");
    let state_dir = temp.path().join("state");
    let import_output = Command::cargo_bin("promptops")
        .expect("promptops binary")
        .args(["--json", "--state-dir"])
        .arg(&state_dir)
        .arg("import")
        .arg(&corpus)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let import: Value = serde_json::from_slice(&import_output).expect("import JSON");
    assert_eq!(import["schema"], "promptops.output.v1");
    assert_eq!(import["data"]["files"].as_u64(), Some(curated.len() as u64));
    assert_eq!(
        import["data"]["imported"].as_u64(),
        Some(curated.len() as u64)
    );
    assert_eq!(import["data"]["skipped"], 0);
    assert_eq!(import["data"]["raw_records"], 0);

    let search_output = Command::cargo_bin("promptops")
        .expect("promptops binary")
        .args(["--json", "--state-dir"])
        .arg(&state_dir)
        .args([
            "search",
            "termination",
            "--mode",
            "lexical",
            "--kind",
            "canon",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let search: Value = serde_json::from_slice(&search_output).expect("search JSON");
    let results = search["data"]["results"]
        .as_array()
        .expect("search results");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["title"], "Design an agent workflow");
    assert_eq!(
        results[0]["source_path"].as_str().expect("source path"),
        corpus
            .join("canon/agent-architecture-decision.md")
            .to_string_lossy()
    );
}

fn is_git_oid(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|oid| oid.len() == 40 && oid.bytes().all(|byte| byte.is_ascii_hexdigit()))
}
