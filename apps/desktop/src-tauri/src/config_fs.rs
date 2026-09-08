use std::{
    fs,
    io::{ErrorKind, Write},
    path::Path,
};

fn is_link_like(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(target_os = "windows"))]
    false
}

pub(crate) fn ensure_regular_file(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("无法检查 {label}"))?;
    if is_link_like(&metadata) || !metadata.is_file() {
        return Err(format!("{label}必须是普通文件"));
    }
    Ok(())
}

pub(crate) fn ensure_regular_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("无法检查 {label}"))?;
    if is_link_like(&metadata) || !metadata.is_dir() {
        return Err(format!("{label}必须是普通目录"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn regular_file_identity(path: &Path, label: &str) -> Result<(u64, u64), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        },
    };

    ensure_regular_file(path, &format!("{label} 写入目标"))?;
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            ptr::null(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!("无法检查 {label} 写入目标"));
    }
    let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
    let succeeded = unsafe { GetFileInformationByHandle(handle, &mut info) } != 0;
    unsafe { CloseHandle(handle) };
    if !succeeded {
        return Err(format!("无法检查 {label} 写入目标"));
    }
    Ok((
        info.dwVolumeSerialNumber as u64,
        ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
    ))
}

#[cfg(unix)]
fn regular_file_identity(path: &Path, label: &str) -> Result<(u64, u64), String> {
    use std::os::unix::fs::MetadataExt;
    ensure_regular_file(path, &format!("{label} 写入目标"))?;
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("无法检查 {label} 写入目标"))?;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn regular_file_identity(path: &Path, label: &str) -> Result<(u64, u64), String> {
    use std::time::UNIX_EPOCH;
    ensure_regular_file(path, &format!("{label} 写入目标"))?;
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("无法检查 {label} 写入目标"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos() as u64)
        .unwrap_or_default();
    Ok((metadata.len(), modified))
}

pub(crate) fn restricted_atomic_write(
    target: &Path,
    bytes: &[u8],
    require_existing: bool,
    label: &str,
) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{label} 目标目录无效"))?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|_| format!("无法创建 {label} 目标目录"))?;
    }
    let parent_metadata =
        fs::symlink_metadata(parent).map_err(|_| format!("无法检查 {label} 目标目录"))?;
    if is_link_like(&parent_metadata) || !parent_metadata.is_dir() {
        return Err(format!("{label} 目标目录必须是普通目录"));
    }
    let original_identity = match fs::symlink_metadata(target) {
        Ok(metadata) => {
            if is_link_like(&metadata) || !metadata.is_file() {
                return Err(format!("{label} 写入目标必须是普通文件"));
            }
            Some(regular_file_identity(target, label)?)
        }
        Err(error) if error.kind() == ErrorKind::NotFound && !require_existing => None,
        Err(_) => return Err(format!("无法检查 {label} 写入目标")),
    };
    let mut temporary = tempfile::Builder::new()
        .prefix(".bandi-write.")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|_| format!("无法创建 {label} 临时文件"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| format!("无法完整写入 {label} 临时文件"))?;
    match original_identity {
        Some(identity) if regular_file_identity(target, label)? != identity => {
            return Err(format!("{label} 在写入期间发生变化"));
        }
        None if target.exists() => return Err(format!("{label} 在写入期间被创建")),
        _ => {}
    }
    temporary
        .persist(target)
        .map_err(|_| format!("无法原子替换 {label}"))?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::restricted_atomic_write;

    #[test]
    fn writes_new_and_existing_plain_files() {
        let root = tempfile::tempdir().expect("应创建隔离目录");
        let target = root.path().join("config.yaml");
        restricted_atomic_write(&target, b"first", false, "配置").expect("应创建文件");
        restricted_atomic_write(&target, b"second", true, "配置").expect("应替换文件");
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
    }

    #[test]
    fn rejects_missing_required_target_and_symlink() {
        let root = tempfile::tempdir().expect("应创建隔离目录");
        let missing = root.path().join("missing.yaml");
        assert!(restricted_atomic_write(&missing, b"value", true, "配置").is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let real = root.path().join("real.yaml");
            std::fs::write(&real, b"real").unwrap();
            let link = root.path().join("link.yaml");
            symlink(&real, &link).unwrap();
            assert!(restricted_atomic_write(&link, b"value", true, "配置").is_err());
        }
    }
}
