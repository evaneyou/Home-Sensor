use std::io::Cursor;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;
use webrtc::media::io::ivf_reader::IVFReader;
use webrtc::media::io::ogg_reader::OggReader;
use webrtc::media::Sample;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

const GRAY_IVF: &[u8] = include_bytes!("../media/gray.ivf");
const SILENCE_OGG: &[u8] = include_bytes!("../media/silence.ogg");
const OGG_PAGE: Duration = Duration::from_millis(20);

pub fn spawn_video(track: Arc<TrackLocalStaticSample>, mut started: watch::Receiver<bool>) {
    tokio::spawn(async move {
        if wait_until_started(&mut started).await.is_err() {
            return;
        }
        loop {
            let cursor = Cursor::new(GRAY_IVF);
            let Ok((mut ivf, header)) = IVFReader::new(cursor) else {
                return;
            };
            let frame_time = Duration::from_millis(
                (1000 * u64::from(header.timebase_numerator) / u64::from(header.timebase_denominator).max(1)).max(1),
            );
            let mut ticker = tokio::time::interval(frame_time);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await;
            loop {
                let frame = match ivf.parse_next_frame() {
                    Ok((frame, _)) => frame,
                    Err(_) => break,
                };
                let sample = Sample {
                    data: frame.freeze(),
                    duration: frame_time,
                    ..Default::default()
                };
                if track.write_sample(&sample).await.is_err() {
                    return;
                }
                ticker.tick().await;
            }
        }
    });
}

pub fn spawn_audio(track: Arc<TrackLocalStaticSample>, mut started: watch::Receiver<bool>) {
    tokio::spawn(async move {
        if wait_until_started(&mut started).await.is_err() {
            return;
        }
        loop {
            let cursor = Cursor::new(SILENCE_OGG);
            let Ok((mut ogg, _)) = OggReader::new(cursor, true) else {
                return;
            };
            let mut ticker = tokio::time::interval(OGG_PAGE);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await;
            let mut last_granule: u64 = 0;
            loop {
                let (page, header) = match ogg.parse_next_page() {
                    Ok(page) => page,
                    Err(_) => break,
                };
                let sample_count = header.granule_position.saturating_sub(last_granule);
                last_granule = header.granule_position;
                let duration = if sample_count == 0 {
                    OGG_PAGE
                } else {
                    Duration::from_millis(sample_count * 1000 / 48_000)
                };
                let sample = Sample {
                    data: page.freeze(),
                    duration,
                    ..Default::default()
                };
                if track.write_sample(&sample).await.is_err() {
                    return;
                }
                ticker.tick().await;
            }
        }
    });
}

async fn wait_until_started(started: &mut watch::Receiver<bool>) -> Result<(), watch::error::RecvError> {
    while !*started.borrow() {
        started.changed().await?;
    }
    Ok(())
}
