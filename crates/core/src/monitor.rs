//! Machine utilization for the Monitoring tab. One call returns raw counters (CPU time, network
//! bytes) plus current gauges; the window turns two consecutive samples into rates, so the Target
//! never sleeps, samples in the background or keeps state between calls.
use anyhow::{bail, Result};
use serde_json::{json, Value};

pub fn handle(method: &str, _p: &Value) -> Result<Value> {
    match method {
        "sys.stats" => snapshot(),
        _ => bail!("E_ARGUMENT: unknown monitoring method"),
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// `cpu` line of /proc/stat: (total, idle) jiffies, idle including iowait; guest time is already in user.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_stat(text: &str) -> Option<(u64, u64, usize)> {
    let mut lines = text.lines();
    let fields: Vec<u64> = lines.next()?.strip_prefix("cpu ")?.split_whitespace().filter_map(|v| v.parse().ok()).collect();
    if fields.len() < 4 {
        return None;
    }
    let total = fields.iter().take(8).sum();
    let idle = fields[3] + fields.get(4).copied().unwrap_or(0);
    let count = lines.filter(|line| line.starts_with("cpu") && line.as_bytes().get(3).is_some_and(u8::is_ascii_digit)).count();
    Some((total, idle, count.max(1)))
}

/// Value in bytes of a /proc/meminfo field reported in kB.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn meminfo(text: &str, key: &str) -> Option<u64> {
    text.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix(':')?.split_whitespace().next()?.parse::<u64>().ok()).map(|kb| kb * 1024)
}

/// Received and transmitted bytes over all interfaces except loopback.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_netdev(text: &str) -> (u64, u64) {
    text.lines().skip(2).filter_map(|line| line.split_once(':')).filter(|(name, _)| name.trim() != "lo").fold((0, 0), |(rx, tx), (_, values)| {
        let fields: Vec<u64> = values.split_whitespace().filter_map(|v| v.parse().ok()).collect();
        (rx + fields.first().copied().unwrap_or(0), tx + fields.get(8).copied().unwrap_or(0))
    })
}

#[cfg(target_os = "linux")]
fn snapshot() -> Result<Value> {
    use anyhow::Context;
    use std::fs::read_to_string;
    let (total, idle, count) = parse_stat(&read_to_string("/proc/stat")?).context("E_STATS: unreadable /proc/stat")?;
    let memory = read_to_string("/proc/meminfo")?;
    let load: Vec<f64> = read_to_string("/proc/loadavg")?.split_whitespace().take(3).filter_map(|v| v.parse().ok()).collect();
    let uptime = read_to_string("/proc/uptime")?.split_whitespace().next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    let net = read_to_string("/proc/net/dev").ok().map(|text| parse_netdev(&text));
    let mut disk: libc::statvfs = unsafe { std::mem::zeroed() };
    let disk = (unsafe { libc::statvfs(c"/".as_ptr(), &mut disk) } == 0).then(|| {
        let unit = disk.f_frsize as u64;
        json!({"path": "/", "total": disk.f_blocks as u64 * unit, "free": disk.f_bavail as u64 * unit})
    });
    Ok(json!({
        "os": "linux", "at": now_ms(), "uptimeSeconds": uptime as u64,
        "cpu": {"total": total, "idle": idle, "count": count},
        "memory": {"total": meminfo(&memory, "MemTotal"), "available": meminfo(&memory, "MemAvailable")},
        "swap": {"total": meminfo(&memory, "SwapTotal"), "free": meminfo(&memory, "SwapFree")},
        "load": load, "disk": disk,
        "net": net.map(|(rx, tx)| json!({"rx": rx, "tx": tx})),
    }))
}

#[cfg(windows)]
fn snapshot() -> Result<Value> {
    use windows_sys::Win32::{
        Foundation::FILETIME,
        Storage::FileSystem::GetDiskFreeSpaceExW,
        System::{
            SystemInformation::{GetSystemInfo, GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO},
            Threading::GetSystemTimes,
        },
    };
    let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
    let (mut idle, mut kernel, mut user) = unsafe { (std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed()) };
    if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
        bail!("E_STATS: GetSystemTimes failed");
    }
    let mut memory: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    memory.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut memory) };
    let mut info: SYSTEM_INFO = unsafe { std::mem::zeroed() };
    unsafe { GetSystemInfo(&mut info) };
    let drive: Vec<u16> = "C:\\\0".encode_utf16().collect();
    let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
    let disk = (unsafe { GetDiskFreeSpaceExW(drive.as_ptr(), &mut available, &mut total, &mut free) } != 0)
        .then(|| json!({"path": "C:\\", "total": total, "free": available}));
    // Kernel time already includes idle time.
    Ok(json!({
        "os": "windows", "at": now_ms(), "uptimeSeconds": unsafe { GetTickCount64() } / 1000,
        "cpu": {"total": ticks(kernel) + ticks(user), "idle": ticks(idle), "count": info.dwNumberOfProcessors},
        "memory": {"total": memory.ullTotalPhys, "available": memory.ullAvailPhys},
        "swap": {"total": memory.ullTotalPageFile.saturating_sub(memory.ullTotalPhys), "free": memory.ullAvailPageFile.saturating_sub(memory.ullAvailPhys)},
        "load": null, "disk": disk, "net": null,
    }))
}

#[cfg(not(any(target_os = "linux", windows)))]
fn snapshot() -> Result<Value> {
    bail!("E_UNSUPPORTED: monitoring is available on Linux and Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proc_stat_counters() {
        let text = "cpu  100 5 50 800 20 3 2 0 7 0\ncpu0 50 2 25 400 10 1 1 0 0 0\ncpu1 50 3 25 400 10 2 1 0 0 0\nintr 1 2 3\n";
        assert_eq!(parse_stat(text), Some((980, 820, 2)));
        assert_eq!(parse_stat("intr 1\n"), None);
    }

    #[test]
    fn meminfo_values_are_bytes() {
        let text = "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    6000000 kB\nSwapTotal:             0 kB\n";
        assert_eq!(meminfo(text, "MemTotal"), Some(8_192_000_000));
        assert_eq!(meminfo(text, "MemAvailable"), Some(6_144_000_000));
        assert_eq!(meminfo(text, "SwapTotal"), Some(0));
        assert_eq!(meminfo(text, "Mem"), None);
    }

    #[test]
    fn net_dev_skips_loopback() {
        let text = "Inter-|   Receive |  Transmit\n face |bytes packets|bytes\n    lo: 500 5 0 0 0 0 0 0 500 5 0 0 0 0 0 0\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n  eth1: 30 1 0 0 0 0 0 0 40 1 0 0 0 0 0 0\n";
        assert_eq!(parse_netdev(text), (1030, 2040));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn live_snapshot_has_counters() {
        let value = snapshot().unwrap();
        assert!(value["cpu"]["total"].as_u64().unwrap() >= value["cpu"]["idle"].as_u64().unwrap());
        assert!(value["memory"]["total"].as_u64().unwrap() > 0);
    }
}
