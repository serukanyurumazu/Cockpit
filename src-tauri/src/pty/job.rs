//! Windows Job Object: PTY children are assigned to a kill-on-close job, so they die with the app
//! even on a crash or forced kill (the job handle is closed by the OS when our process ends).

use std::sync::OnceLock;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

static JOB: OnceLock<usize> = OnceLock::new();

fn job() -> Option<HANDLE> {
    let h = *JOB.get_or_init(|| unsafe {
        let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if h.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            h,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(h);
            return 0;
        }
        h as usize // intentionally never closed: process exit closes it and kills the job
    });
    (h != 0).then_some(h as HANDLE)
}

/// shortcut: assigned right after spawn, so a grandchild started in the first microseconds could
/// escape the job; upgrade to CREATE_SUSPENDED spawning if orphans are ever observed.
pub fn assign(pid: u32) {
    let Some(job) = job() else { return };
    unsafe {
        let p = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if !p.is_null() {
            AssignProcessToJobObject(job, p);
            CloseHandle(p);
        }
    }
}
