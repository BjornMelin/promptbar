use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct Redaction {
    pub text: String,
    pub risk_flags: Vec<String>,
}

pub fn redact(content: &str) -> Redaction {
    let mut text = content.to_string();
    let mut flags = Vec::new();

    if contains_openai_key(content) {
        flags.push("openai-key-like".to_string());
        text = replace_token_like(&text, "sk-", "[REDACTED_OPENAI_KEY]");
    }
    if content.contains("-----BEGIN ") && content.contains("PRIVATE KEY-----") {
        flags.push("private-key-marker".to_string());
        text = redact_private_key_blocks(&text);
    }
    if secret_words()
        .iter()
        .any(|word| content.to_lowercase().contains(word))
    {
        flags.push("sensitive-keyword".to_string());
    }
    if env_assignment_like(content) {
        flags.push("env-assignment".to_string());
        text = redact_env_assignments(&text);
    }

    flags.sort();
    flags.dedup();
    Redaction {
        text,
        risk_flags: flags,
    }
}

pub fn merge_risk_flags(content: &str, existing: &[String]) -> Vec<String> {
    let mut flags = existing.to_vec();
    flags.extend(redact(content).risk_flags);
    flags.sort();
    flags.dedup();
    flags
}

fn contains_openai_key(content: &str) -> bool {
    content
        .split_whitespace()
        .any(|token| token.starts_with("sk-") && token.len() >= 24)
}

fn replace_token_like(input: &str, prefix: &str, marker: &str) -> String {
    input
        .split_whitespace()
        .map(|token| {
            if token.starts_with(prefix) && token.len() >= 24 {
                marker
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_private_key_blocks(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_key = false;
    for line in input.lines() {
        if line.starts_with("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
            in_key = true;
            output.push_str("[REDACTED_PRIVATE_KEY]\n");
            continue;
        }
        if in_key && line.starts_with("-----END ") && line.contains("PRIVATE KEY-----") {
            in_key = false;
            continue;
        }
        if !in_key {
            output.push_str(line);
            output.push('\n');
        }
    }
    output
}

fn env_assignment_like(content: &str) -> bool {
    content.lines().any(env_assignment_line_like)
}

fn redact_env_assignments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for segment in input.split_inclusive('\n') {
        let (line, newline) = segment
            .strip_suffix('\n')
            .map(|line| (line, "\n"))
            .unwrap_or((segment, ""));
        if env_assignment_line_like(line) {
            let Some(equals_index) = line.find('=') else {
                output.push_str(line);
                output.push_str(newline);
                continue;
            };
            output.push_str(&line[..=equals_index]);
            output.push_str("[REDACTED_SECRET]");
        } else {
            output.push_str(line);
        }
        output.push_str(newline);
    }
    output
}

fn env_assignment_line_like(line: &str) -> bool {
    let trimmed = line.trim_start();
    let assignment = trimmed.strip_prefix("export ").unwrap_or(trimmed);
    let Some((key, _value)) = assignment.split_once('=') else {
        return false;
    };
    let key = key.trim().to_ascii_uppercase();
    !key.is_empty()
        && key
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '_')
        && ["KEY", "TOKEN", "SECRET", "PASSWORD"]
            .iter()
            .any(|needle| key.contains(needle))
}

fn secret_words() -> &'static Vec<String> {
    static WORDS: OnceLock<Vec<String>> = OnceLock::new();
    WORDS.get_or_init(|| {
        [
            "password",
            "secret",
            "token",
            "api_key",
            "apikey",
            "private key",
        ]
        .iter()
        .map(|item| item.to_string())
        .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_env_assignment_values() {
        let redaction = redact("API_KEY=abc123\nexport DB_PASSWORD=\"secret\"\nNAME=value\n");

        assert!(redaction.risk_flags.contains(&"env-assignment".to_string()));
        assert!(redaction.text.contains("API_KEY=[REDACTED_SECRET]"));
        assert!(
            redaction
                .text
                .contains("export DB_PASSWORD=[REDACTED_SECRET]")
        );
        assert!(redaction.text.contains("NAME=value"));
        assert!(redaction.text.ends_with('\n'));
        assert!(!redaction.text.contains("abc123"));
        assert!(!redaction.text.contains("secret"));
    }

    #[test]
    fn does_not_redact_keyword_values_without_secret_keys() {
        let redaction = redact("TITLE=secret prompt\nbody mentions password policy");

        assert!(!redaction.risk_flags.contains(&"env-assignment".to_string()));
        assert!(
            redaction
                .risk_flags
                .contains(&"sensitive-keyword".to_string())
        );
        assert!(redaction.text.contains("TITLE=secret prompt"));
    }
}
