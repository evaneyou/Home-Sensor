use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub async fn post_json(host: &str, port: u16, path: &str, body: &Value, timeout: Duration) -> Result<Value> {
    tokio::time::timeout(timeout, post_json_once(host, port, path, body))
        .await
        .context("video peer timed out")?
}

async fn post_json_once(host: &str, port: u16, path: &str, body: &Value) -> Result<Value> {
    let payload = serde_json::to_vec(body)?;
    let mut stream = TcpStream::connect((host, port)).await.context("could not reach the video peer")?;
    stream.set_nodelay(true).ok();
    let header = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&payload).await?;
    let (status, response_body) = read_http(&mut stream, 65_536).await?;
    if status != 200 {
        return Err(anyhow!("video peer returned HTTP {status}"));
    }
    serde_json::from_slice(&response_body).context("video peer returned unexpected JSON")
}

pub async fn read_http(stream: &mut TcpStream, limit: usize) -> Result<(u16, Vec<u8>)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 2048];
    let header_end = loop {
        if buf.len() > limit {
            return Err(anyhow!("HTTP message is too large"));
        }
        let read = stream.read(&mut tmp).await?;
        if read == 0 {
            return Err(anyhow!("HTTP connection closed"));
        }
        buf.extend_from_slice(&tmp[..read]);
        if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
            break pos;
        }
    };
    let header = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let status = header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let length = content_length(&header).unwrap_or(0);
    if length > limit {
        return Err(anyhow!("HTTP body is too large"));
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut tmp).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..read]);
    }
    body.truncate(length);
    Ok((status, body))
}

pub fn request_path(header: &str) -> &str {
    header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("")
}

fn content_length(header: &str) -> Option<usize> {
    header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

pub async fn write_json(stream: &mut TcpStream, status: u16, body: &Value) {
    let payload = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    let reason = if status == 200 { "OK" } else { "Error" };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    let _ = stream.write_all(header.as_bytes()).await;
    let _ = stream.write_all(&payload).await;
}
