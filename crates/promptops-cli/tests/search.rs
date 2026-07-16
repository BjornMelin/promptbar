use assert_cmd::Command;
use serde_json::Value;

#[test]
fn search_accepts_a_leading_hyphen_filter_value() {
    let temp = tempfile::tempdir().expect("tempdir");
    let output = Command::cargo_bin("promptops")
        .expect("binary")
        .args(["--json", "--state-dir"])
        .arg(temp.path().join("state"))
        .args(["search", "--tag=-agent", "--", ""])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let response: Value = serde_json::from_slice(&output).expect("search JSON");

    assert_eq!(response["schema"], "promptops.output.v1");
    assert_eq!(response["data"]["results"], serde_json::json!([]));
}

#[test]
fn blank_embedding_profile_uses_lexical_fallback() {
    let temp = tempfile::tempdir().expect("tempdir");
    let output = Command::cargo_bin("promptops")
        .expect("binary")
        .env("PROMPTOPS_EMBED_BASE_URL", "  ")
        .env("PROMPTOPS_EMBED_API_KEY", "")
        .env("PROMPTOPS_EMBED_MODEL", "")
        .env("PROMPTOPS_EMBED_DIMENSIONS", "")
        .args(["--json", "--state-dir"])
        .arg(temp.path().join("state"))
        .args(["search", "--mode=hybrid", "--", ""])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let response: Value = serde_json::from_slice(&output).expect("search JSON");

    assert_eq!(response["data"]["mode"], "hybrid");
    assert_eq!(response["data"]["hybrid_available"], false);
    assert_eq!(
        response["data"]["hybrid_reason"],
        "Hybrid search needs an explicit OpenAI-compatible embedding profile."
    );
}
