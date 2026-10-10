mod http;
mod media;
mod meter;
mod peer;
mod sdp;

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use webrtc::data_channel::data_channel_state::RTCDataChannelState;
use webrtc::data_channel::RTCDataChannel;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::RTCPeerConnection;

use crate::http::{post_json, request_path, write_json};
use crate::meter::{median, round2, VideoMeter};
use crate::peer::{answer_description, local_sdp, offer_description, prepare};

const DEFAULT_PORT: u16 = 8090;
const ANSWER_TIMEOUT: Duration = Duration::from_secs(40);

#[derive(Serialize)]
struct Metrics {
    rtt_ms: Option<f64>,
    jitter_ms: Option<f64>,
    loss_pct: Option<f64>,
    frames_in: u64,
    frames_out: u64,
    total_ms: f64,
}

impl Metrics {
    fn empty(total_ms: f64) -> Self {
        Self {
            rtt_ms: None,
            jitter_ms: None,
            loss_pct: None,
            frames_in: 0,
            frames_out: 0,
            total_ms,
        }
    }
}

struct Session {
    pc: Arc<RTCPeerConnection>,
    meter: Arc<Mutex<VideoMeter>>,
}

struct App {
    inner: Mutex<AppInner>,
}

struct AppInner {
    sessions: HashMap<String, Session>,
    done: VecDeque<(String, u64)>,
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let outcome = match args.first().map(String::as_str) {
        Some("answer") => serve_answer(&args[1..]).await,
        Some("call") => serve_call(&args[1..]).await,
        _ => {
            eprintln!("usage: webrtc-call answer --bind ip:port [--bind ip:port]");
            eprintln!("       webrtc-call call --host ip --source ip [--port 8090] [--seconds 10]");
            std::process::exit(2);
        }
    };
    if let Err(err) = outcome {
        eprintln!("webrtc-call: {err:#}");
        std::process::exit(1);
    }
}

async fn serve_answer(args: &[String]) -> Result<()> {
    let binds = parse_binds(args)?;
    let app = Arc::new(App {
        inner: Mutex::new(AppInner {
            sessions: HashMap::new(),
            done: VecDeque::new(),
        }),
    });
    for addr in binds {
        let listener = TcpListener::bind(addr)
            .await
            .with_context(|| format!("could not listen on {addr}"))?;
        eprintln!("video call answering on {addr}");
        let app = Arc::clone(&app);
        tokio::spawn(async move {
            loop {
                let Ok((sock, _)) = listener.accept().await else {
                    break;
                };
                let app = Arc::clone(&app);
                let ip = addr.ip();
                tokio::spawn(async move {
                    if let Err(err) = handle_answer(sock, ip, app).await {
                        eprintln!("video call on {ip} failed: {err:#}");
                    }
                });
            }
        });
    }
    std::future::pending::<()>().await;
    Ok(())
}

fn parse_binds(args: &[String]) -> Result<Vec<SocketAddr>> {
    let mut binds = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if args[index] != "--bind" {
            return Err(anyhow!("unknown argument {}", args[index]));
        }
        index += 1;
        let value = args.get(index).context("missing --bind address")?;
        binds.push(value.parse().with_context(|| format!("bad bind {value}"))?);
        index += 1;
    }
    if binds.is_empty() {
        return Err(anyhow!("answer needs at least one --bind ip:port"));
    }
    Ok(binds)
}

async fn handle_answer(mut sock: TcpStream, bind_ip: IpAddr, app: Arc<App>) -> Result<()> {
    let (header, body) = match read_request(&mut sock).await {
        Ok(request) => request,
        Err(err) => {
            write_json(&mut sock, 500, &json!({"error": "The video call could not start"})).await;
            return Err(err);
        }
    };
    let path = request_path(&header).to_owned();
    let payload: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).unwrap_or(Value::Null)
    };
    if path == "/offer" {
        let offer = payload.get("sdp").and_then(Value::as_str).unwrap_or("").to_owned();
        if offer.is_empty() {
            write_json(&mut sock, 500, &json!({"error": "The video call could not start"})).await;
            return Err(anyhow!("missing offer"));
        }
        match tokio::time::timeout(Duration::from_secs(15), accept_offer(offer, bind_ip, Arc::clone(&app))).await {
            Ok(Ok(response)) => write_json(&mut sock, 200, &response).await,
            Ok(Err(err)) => {
                write_json(&mut sock, 500, &json!({"error": "The video call could not start"})).await;
                return Err(err);
            }
            Err(_) => {
                write_json(&mut sock, 500, &json!({"error": "The video call could not start"})).await;
                return Err(anyhow!("offer timed out"));
            }
        }
        return Ok(());
    }
    if path == "/bye" {
        let id = payload.get("id").and_then(Value::as_str).unwrap_or("");
        let frames = finish(&app, id).await;
        write_json(&mut sock, 200, &json!({"frames": frames})).await;
        return Ok(());
    }
    write_json(&mut sock, 404, &json!({"error": "Not found"})).await;
    Ok(())
}

async fn read_request(sock: &mut TcpStream) -> Result<(String, Vec<u8>)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 2048];
    let header_end = loop {
        if buf.len() > 65_536 {
            return Err(anyhow!("HTTP message is too large"));
        }
        let read = sock.read(&mut tmp).await?;
        if read == 0 {
            return Err(anyhow!("HTTP connection closed"));
        }
        buf.extend_from_slice(&tmp[..read]);
        if let Some(pos) = buf.windows(4).position(|window| window == b"\r\n\r\n") {
            break pos;
        }
    };
    let header = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    if length > 65_536 {
        return Err(anyhow!("HTTP body is too large"));
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < length {
        let read = sock.read(&mut tmp).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..read]);
    }
    body.truncate(length);
    Ok((header, body))
}

async fn accept_offer(offer: String, bind_ip: IpAddr, app: Arc<App>) -> Result<Value> {
    let prepared = prepare(bind_ip).await?;
    let pc = Arc::clone(&prepared.pc);
    pc.on_data_channel(Box::new(|channel: Arc<RTCDataChannel>| {
        let channel_for_echo = Arc::clone(&channel);
        channel.on_message(Box::new(move |message| {
            let channel = Arc::clone(&channel_for_echo);
            Box::pin(async move {
                let _ = channel.send(&message.data).await;
            })
        }));
        Box::pin(async {})
    }));
    let remote = offer_description(&offer)?;
    pc.set_remote_description(remote).await?;
    let answer = pc.create_answer(None).await?;
    let sdp = local_sdp(&pc, answer, &bind_ip.to_string()).await?;
    let id = uuid::Uuid::new_v4().to_string().replace('-', "");
    {
        let mut inner = app.inner.lock().await;
        inner.sessions.insert(
            id.clone(),
            Session {
                pc: Arc::clone(&pc),
                meter: prepared.meter,
            },
        );
    }
    let app_for_close = Arc::clone(&app);
    let id_for_close = id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(ANSWER_TIMEOUT).await;
        let _ = finish(&app_for_close, &id_for_close).await;
    });
    let _ = prepared.started;
    Ok(json!({"sdp": sdp, "type": "answer", "id": id}))
}

async fn finish(app: &App, id: &str) -> u64 {
    if id.is_empty() {
        return 0;
    }
    let session = {
        let mut inner = app.inner.lock().await;
        if let Some((_, frames)) = inner.done.iter().find(|(key, _)| key == id) {
            return *frames;
        }
        inner.sessions.remove(id)
    };
    let Some(session) = session else {
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let inner = app.inner.lock().await;
            if let Some((_, frames)) = inner.done.iter().find(|(key, _)| key == id) {
                return *frames;
            }
        }
        return 0;
    };
    let frames = session.meter.lock().await.frames;
    let _ = session.pc.close().await;
    let mut inner = app.inner.lock().await;
    inner.done.push_back((id.to_owned(), frames));
    while inner.done.len() > 32 {
        inner.done.pop_front();
    }
    eprintln!("video call {id} received {frames} frames");
    frames
}

struct CallArgs {
    host: String,
    source: IpAddr,
    port: u16,
    seconds: u64,
}

async fn serve_call(args: &[String]) -> Result<()> {
    let started = Instant::now();
    let parsed = match parse_call(args) {
        Ok(parsed) => parsed,
        Err(err) => return Err(err),
    };
    match place_call(&parsed).await {
        Ok(metrics) => {
            println!("{}", serde_json::to_string(&metrics)?);
            Ok(())
        }
        Err(err) => {
            eprintln!("webrtc-call: {err:#}");
            let total = round2(started.elapsed().as_secs_f64() * 1000.0);
            println!("{}", serde_json::to_string(&Metrics::empty(total))?);
            Ok(())
        }
    }
}

fn parse_call(args: &[String]) -> Result<CallArgs> {
    let mut host = None;
    let mut source = None;
    let mut port = DEFAULT_PORT;
    let mut seconds = 10u64;
    let mut index = 0;
    while index < args.len() {
        let name = args[index].as_str();
        index += 1;
        let value = args.get(index).with_context(|| format!("missing value for {name}"))?;
        match name {
            "--host" => host = Some(value.clone()),
            "--source" => source = Some(value.parse().context("bad source address")?),
            "--port" => port = value.parse().context("bad port")?,
            "--seconds" => seconds = value.parse().context("bad seconds")?,
            other => return Err(anyhow!("unknown argument {other}")),
        }
        index += 1;
    }
    Ok(CallArgs {
        host: host.context("--host is required")?,
        source: source.context("--source is required")?,
        port,
        seconds,
    })
}

async fn place_call(args: &CallArgs) -> Result<Metrics> {
    let started = Instant::now();
    let prepared = prepare(args.source).await?;
    let pc = Arc::clone(&prepared.pc);
    let (connected_tx, connected_rx) = oneshot::channel();
    let connected_tx = Arc::new(Mutex::new(Some(connected_tx)));
    let signal = Arc::clone(&connected_tx);
    pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
        let signal = Arc::clone(&signal);
        Box::pin(async move {
            if matches!(
                state,
                RTCPeerConnectionState::Connected | RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
            ) {
                if let Some(tx) = signal.lock().await.take() {
                    let _ = tx.send(state);
                }
            }
        })
    }));

    let channel = pc.create_data_channel("rtt", None).await?;
    let pending: Arc<Mutex<VecDeque<oneshot::Sender<()>>>> = Arc::new(Mutex::new(VecDeque::new()));
    let pending_for_echo = Arc::clone(&pending);
    channel.on_message(Box::new(move |_message| {
        let pending = Arc::clone(&pending_for_echo);
        Box::pin(async move {
            if let Some(tx) = pending.lock().await.pop_front() {
                let _ = tx.send(());
            }
        })
    }));

    let offer = pc.create_offer(None).await?;
    let sdp = local_sdp(&pc, offer, &args.source.to_string()).await?;
    let answer = post_json(
        &args.host,
        args.port,
        "/offer",
        &json!({"sdp": sdp, "type": "offer"}),
        Duration::from_secs(15),
    )
    .await?;
    let answer_sdp = answer.get("sdp").and_then(Value::as_str).unwrap_or("");
    if answer_sdp.is_empty() {
        return Err(anyhow!("the video peer did not answer"));
    }
    pc.set_remote_description(answer_description(answer_sdp)?).await?;
    let connected = wait_connected(&pc, connected_rx).await;
    let mut samples = Vec::new();
    if connected {
        let _ = prepared.started.send(true);
        let deadline = Instant::now() + Duration::from_secs(args.seconds);
        while Instant::now() < deadline {
            if channel.ready_state() == RTCDataChannelState::Open {
                if let Some(sample) = echo_once(&channel, &pending).await {
                    samples.push(sample);
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    let meter = prepared.meter.lock().await;
    let mut metrics = Metrics {
        rtt_ms: median(samples),
        jitter_ms: meter.jitter_ms(),
        loss_pct: meter.loss_pct(),
        frames_in: meter.frames,
        frames_out: 0,
        total_ms: round2(started.elapsed().as_secs_f64() * 1000.0),
    };
    drop(meter);
    if let Some(id) = answer.get("id").and_then(Value::as_str) {
        if let Ok(bye) = post_json(&args.host, args.port, "/bye", &json!({"id": id}), Duration::from_secs(5)).await {
            metrics.frames_out = bye.get("frames").and_then(Value::as_u64).unwrap_or(0);
        }
    }
    metrics.total_ms = round2(started.elapsed().as_secs_f64() * 1000.0);
    let _ = pc.close().await;
    eprintln!(
        "video call rtt {:?} ms, jitter {:?} ms, loss {:?}%, in {}, out {}",
        metrics.rtt_ms, metrics.jitter_ms, metrics.loss_pct, metrics.frames_in, metrics.frames_out
    );
    Ok(metrics)
}

async fn echo_once(channel: &RTCDataChannel, pending: &Mutex<VecDeque<oneshot::Sender<()>>>) -> Option<f64> {
    let (tx, rx) = oneshot::channel();
    pending.lock().await.push_back(tx);
    let started = Instant::now();
    if channel.send(&Bytes::from_static(b"x")).await.is_err() {
        return None;
    }
    match tokio::time::timeout(Duration::from_secs(1), rx).await {
        Ok(Ok(())) => Some(started.elapsed().as_secs_f64() * 1000.0),
        _ => None,
    }
}

async fn wait_connected(pc: &RTCPeerConnection, rx: oneshot::Receiver<RTCPeerConnectionState>) -> bool {
    if pc.connection_state() == RTCPeerConnectionState::Connected {
        return true;
    }
    match tokio::time::timeout(Duration::from_secs(8), rx).await {
        Ok(Ok(RTCPeerConnectionState::Connected)) => true,
        _ => pc.connection_state() == RTCPeerConnectionState::Connected,
    }
}

