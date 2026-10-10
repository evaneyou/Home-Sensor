/// Keep host candidates for one address, matching the Python peer.
pub fn restrict(sdp: &str, ip: &str) -> String {
    let mut kept = Vec::new();
    for line in sdp.replace("\r\n", "\n").split('\n') {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("a=candidate:") && !line.split_whitespace().any(|part| part == ip) {
            continue;
        }
        if line.starts_with("c=IN IP4 ") && !line.contains(ip) {
            kept.push(format!("c=IN IP4 {ip}"));
            continue;
        }
        kept.push(line.to_owned());
    }
    let mut out = kept.join("\r\n");
    out.push_str("\r\n");
    out
}

#[cfg(test)]
mod tests {
    use super::restrict;

    #[test]
    fn drops_other_host_candidates() {
        let sdp = "v=0\r\na=candidate:1 1 udp 1 10.0.0.142 5000 typ host\r\na=candidate:2 1 udp 1 10.0.0.145 5000 typ host\r\nc=IN IP4 0.0.0.0\r\n";
        let narrowed = restrict(sdp, "10.0.0.142");
        assert!(narrowed.contains("10.0.0.142"));
        assert!(!narrowed.contains("10.0.0.145"));
        assert!(narrowed.contains("c=IN IP4 10.0.0.142"));
    }
}
