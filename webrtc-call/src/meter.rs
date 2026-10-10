use std::time::Instant;

/// Inbound video accounting. Jitter follows RFC 3550 and is stored in 90 kHz units.
#[derive(Debug, Default)]
pub struct VideoMeter {
    pub frames: u64,
    pub received: u64,
    pub lost: u64,
    jitter: f64,
    last_transit: Option<i64>,
    last_seq: Option<u16>,
    origin: Option<Instant>,
}

impl VideoMeter {
    pub fn observe(&mut self, seq: u16, timestamp: u32, marker: bool) {
        let origin = *self.origin.get_or_insert_with(Instant::now);
        let arrival_ms = origin.elapsed().as_millis() as i64;
        self.observe_at(arrival_ms, seq, timestamp, marker);
    }

    pub fn observe_at(&mut self, arrival_ms: i64, seq: u16, timestamp: u32, marker: bool) {
        self.received += 1;
        if marker {
            self.frames += 1;
        }
        if let Some(prev) = self.last_seq {
            let gap = seq.wrapping_sub(prev);
            if gap > 1 && gap < 30_000 {
                self.lost += u64::from(gap - 1);
            }
        }
        self.last_seq = Some(seq);
        // VP8 uses a 90 kHz clock, so one millisecond is 90 timestamp units.
        let arrival_90 = arrival_ms.saturating_mul(90);
        let transit = arrival_90.wrapping_sub(i64::from(timestamp));
        if let Some(prev) = self.last_transit {
            let delta = transit.wrapping_sub(prev) as i32;
            let gap = f64::from(delta.unsigned_abs());
            self.jitter += (gap - self.jitter) / 16.0;
        }
        self.last_transit = Some(transit);
    }

    pub fn jitter_ms(&self) -> Option<f64> {
        if self.received < 2 {
            return None;
        }
        Some(round2(self.jitter / 90.0))
    }

    pub fn loss_pct(&self) -> Option<f64> {
        let total = self.received + self.lost;
        if total == 0 {
            return None;
        }
        Some(round2(self.lost as f64 / total as f64 * 100.0))
    }
}

pub fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    Some(round2(values[values.len() / 2]))
}

#[cfg(test)]
mod tests {
    use super::VideoMeter;

    #[test]
    fn jitter_uses_the_video_clock() {
        let mut meter = VideoMeter::default();
        meter.observe_at(0, 0, 0, false);
        // A 90-unit transit gap is 1 ms of timestamp time. The smoothed jitter is that gap / 16.
        meter.observe_at(2, 1, 90, true);
        let jitter = meter.jitter_ms().expect("jitter");
        assert!(jitter < 1.0, "jitter {jitter} ms should stay under 1 ms, not the raw timestamp");
        assert!((jitter - 0.06).abs() < 0.02, "jitter {jitter}");
    }

    #[test]
    fn sequence_gap_counts_as_loss() {
        let mut meter = VideoMeter::default();
        meter.observe_at(0, 1, 0, true);
        meter.observe_at(30, 4, 2700, true);
        assert_eq!(meter.frames, 2);
        assert_eq!(meter.lost, 2);
        assert_eq!(meter.loss_pct(), Some(50.0));
    }
}
