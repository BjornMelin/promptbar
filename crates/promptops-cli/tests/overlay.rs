use assert_cmd::Command;
use serde_json::Value;

#[test]
fn patch_content_from_stdin_updates_raw_and_redacted_views() {
    let temp = tempfile::tempdir().expect("tempdir");
    let state_dir = temp.path().join("state");
    let corpus = temp.path().join("corpus");
    let canon = corpus.join("canon");
    std::fs::create_dir_all(&canon).expect("canon dir");
    std::fs::write(
        canon.join("capture.md"),
        "# Capture\n\nOriginal prompt body.",
    )
    .expect("fixture");

    Command::cargo_bin("promptops")
        .expect("binary")
        .args(["--json", "--state-dir"])
        .arg(&state_dir)
        .arg("import")
        .arg(&corpus)
        .assert()
        .success();

    let search_output = Command::cargo_bin("promptops")
        .expect("binary")
        .args(["--json", "--state-dir"])
        .arg(&state_dir)
        .args(["search", "Capture", "--limit", "1"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let search: Value = serde_json::from_slice(&search_output).expect("search json");
    let id = search["data"]["results"][0]["id"]
        .as_str()
        .expect("result id");

    let content = "API_KEY=super-secret\nLong edited prompt body.";
    let patch_output = Command::cargo_bin("promptops")
        .expect("binary")
        .args(["--json", "--state-dir"])
        .arg(&state_dir)
        .args(["overlay", "patch", id, "--content-stdin"])
        .write_stdin(content)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let patch: Value = serde_json::from_slice(&patch_output).expect("patch json");

    assert_eq!(patch["data"]["content"], content);
    assert_eq!(
        patch["data"]["redacted_content"],
        "API_KEY=[REDACTED_SECRET]\nLong edited prompt body."
    );
}

#[test]
fn patch_rejects_content_arg_with_content_stdin() {
    Command::cargo_bin("promptops")
        .expect("binary")
        .args([
            "overlay",
            "patch",
            "prompt-id",
            "--content",
            "argv content",
            "--content-stdin",
        ])
        .assert()
        .failure();
}
