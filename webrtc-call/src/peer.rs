use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tokio::sync::{watch, Mutex};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_OPUS, MIME_TYPE_VP8};
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice::mdns::MulticastDnsMode;
use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTPCodecType};
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_remote::TrackRemote;

use crate::media::{spawn_audio, spawn_video};
use crate::meter::VideoMeter;
use crate::sdp::restrict;

pub struct PreparedCall {
    pub pc: Arc<RTCPeerConnection>,
    pub meter: Arc<Mutex<VideoMeter>>,
    pub started: watch::Sender<bool>,
}

pub async fn prepare(bind_ip: IpAddr) -> Result<PreparedCall> {
    let mut setting = SettingEngine::default();
    setting.set_ice_multicast_dns_mode(MulticastDnsMode::Disabled);
    setting.set_ip_filter(Box::new(move |ip: IpAddr| ip == bind_ip));
    let mut media = MediaEngine::default();
    media.register_default_codecs()?;
    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media)?;
    let api = APIBuilder::new()
        .with_setting_engine(setting)
        .with_media_engine(media)
        .with_interceptor_registry(registry)
        .build();
    let pc = Arc::new(
        api.new_peer_connection(RTCConfiguration {
            ice_servers: vec![],
            ..Default::default()
        })
        .await?,
    );
    let meter = Arc::new(Mutex::new(VideoMeter::default()));
    let inbound = Arc::clone(&meter);
    pc.on_track(Box::new(move |track: Arc<TrackRemote>, _, _| {
        if track.kind() != RTPCodecType::Video {
            tokio::spawn(async move {
                let mut buf = vec![0u8; 1500];
                while track.read(&mut buf).await.is_ok() {}
            });
            return Box::pin(async {});
        }
        let inbound = Arc::clone(&inbound);
        tokio::spawn(async move {
            let mut buf = vec![0u8; 1500];
            while let Ok((packet, _)) = track.read(&mut buf).await {
                let mut meter = inbound.lock().await;
                meter.observe(
                    packet.header.sequence_number,
                    packet.header.timestamp,
                    packet.header.marker,
                );
            }
        });
        Box::pin(async {})
    }));

    let (started, video_rx) = watch::channel(false);
    let audio_rx = started.subscribe();
    let video = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_VP8.to_owned(),
            ..Default::default()
        },
        "video".to_owned(),
        "home-sensor".to_owned(),
    ));
    let video_sender = pc.add_track(Arc::clone(&video) as Arc<dyn TrackLocal + Send + Sync>).await?;
    tokio::spawn(async move {
        let mut buf = vec![0u8; 1500];
        while video_sender.read(&mut buf).await.is_ok() {}
    });
    spawn_video(video, video_rx);

    let audio = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_OPUS.to_owned(),
            ..Default::default()
        },
        "audio".to_owned(),
        "home-sensor".to_owned(),
    ));
    let audio_sender = pc.add_track(Arc::clone(&audio) as Arc<dyn TrackLocal + Send + Sync>).await?;
    tokio::spawn(async move {
        let mut buf = vec![0u8; 1500];
        while audio_sender.read(&mut buf).await.is_ok() {}
    });
    spawn_audio(audio, audio_rx);

    let media_start = started.clone();
    pc.on_ice_connection_state_change(Box::new(move |state: RTCIceConnectionState| {
        if state == RTCIceConnectionState::Connected {
            let _ = media_start.send(true);
        }
        Box::pin(async {})
    }));
    let media_start = started.clone();
    pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
        if state == RTCPeerConnectionState::Connected {
            let _ = media_start.send(true);
        }
        Box::pin(async {})
    }));

    Ok(PreparedCall { pc, meter, started })
}

pub async fn local_sdp(pc: &RTCPeerConnection, description: RTCSessionDescription, ip: &str) -> Result<String> {
    let mut gathered = pc.gathering_complete_promise().await;
    pc.set_local_description(description).await?;
    let _ = tokio::time::timeout(Duration::from_secs(5), gathered.recv()).await;
    let local = pc.local_description().await.context("missing local description")?;
    Ok(restrict(&local.sdp, ip))
}

pub fn answer_description(sdp: &str) -> Result<RTCSessionDescription> {
    RTCSessionDescription::answer(sdp.to_owned()).map_err(|err| anyhow!(err))
}

pub fn offer_description(sdp: &str) -> Result<RTCSessionDescription> {
    RTCSessionDescription::offer(sdp.to_owned()).map_err(|err| anyhow!(err))
}
