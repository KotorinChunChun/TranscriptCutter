// TranscriptCutter: contain the dedicated server and every descendant, including
// workers and an admin-requested restart, in one Windows kill-on-close job.
#![windows_subsystem = "console"]
use std::{
    ffi::c_void,
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::ffi::OsStrExt,
    ptr::{null, null_mut},
};
type Handle = *mut c_void;
#[repr(C)]
struct Startup {
    cb: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    x_size: u32,
    y_size: u32,
    x_count: u32,
    y_count: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved2: u16,
    bytes: *mut u8,
    input: Handle,
    output: Handle,
    error: Handle,
}
#[repr(C)]
struct Process {
    process: Handle,
    thread: Handle,
    pid: u32,
    tid: u32,
}
#[repr(C)]
struct BasicLimits {
    process_time: i64,
    job_time: i64,
    flags: u32,
    min: usize,
    max: usize,
    active: u32,
    affinity: usize,
    priority: u32,
    scheduling: u32,
}
#[repr(C)]
struct IoCounters {
    read: u64,
    write: u64,
    other: u64,
    read_bytes: u64,
    write_bytes: u64,
    other_bytes: u64,
}
#[repr(C)]
struct Limits {
    basic: BasicLimits,
    io: IoCounters,
    process_memory: usize,
    job_memory: usize,
    peak_process: usize,
    peak_job: usize,
}
#[repr(C)]
struct Security {
    length: u32,
    descriptor: *mut c_void,
    inherit: i32,
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, class: u32, info: *const c_void, length: u32) -> i32;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    fn CreateProcessW(
        app: *const u16,
        command: *mut u16,
        pa: *const c_void,
        ta: *const c_void,
        inherit: i32,
        flags: u32,
        env: *const c_void,
        cwd: *const u16,
        startup: *const Startup,
        info: *mut Process,
    ) -> i32;
    fn CreateFileW(
        path: *const u16,
        access: u32,
        share: u32,
        security: *const Security,
        creation: u32,
        flags: u32,
        template: Handle,
    ) -> Handle;
    fn ResumeThread(thread: Handle) -> u32;
    fn TerminateProcess(process: Handle, code: u32) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}
struct Owned(Handle);
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}
fn quote(arg: &std::ffi::OsStr) -> Vec<u16> {
    let mut out = vec![34];
    let mut slashes = 0;
    for c in arg.encode_wide() {
        if c == 92 {
            slashes += 1;
            continue;
        }
        if c == 34 {
            out.extend(std::iter::repeat_n(92, slashes * 2 + 1));
            out.push(c);
        } else {
            out.extend(std::iter::repeat_n(92, slashes));
            out.push(c);
        }
        slashes = 0;
    }
    out.extend(std::iter::repeat_n(92, slashes * 2));
    out.push(34);
    out
}
fn main() {
    if let Err(error) = run() {
        eprintln!("専用プロセスを開始できません: {error}");
        std::process::exit(1);
    }
}
fn run() -> std::io::Result<()> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    let executable = args
        .first()
        .ok_or_else(|| std::io::Error::other("プログラム未指定"))?;
    let mut command = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        if i > 0 {
            command.push(32);
        }
        command.extend(quote(arg));
    }
    command.push(0);
    unsafe {
        let job = Owned(CreateJobObjectW(null(), null()));
        if job.0.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut limits: Limits = zeroed();
        limits.basic.flags = 0x2000;
        if SetInformationJobObject(
            job.0,
            9,
            &limits as *const _ as *const c_void,
            size_of::<Limits>() as u32,
        ) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        let security = Security {
            length: size_of::<Security>() as u32,
            descriptor: null_mut(),
            inherit: 1,
        };
        let dev_null = Owned(CreateFileW(
            wide(std::ffi::OsStr::new("NUL")).as_ptr(),
            0xc0000000,
            3,
            &security,
            3,
            0,
            null_mut(),
        ));
        if dev_null.0 as isize == -1 {
            return Err(std::io::Error::last_os_error());
        }
        let mut startup: Startup = zeroed();
        startup.cb = size_of::<Startup>() as u32;
        startup.flags = 0x100;
        startup.input = dev_null.0;
        startup.output = dev_null.0;
        startup.error = dev_null.0;
        let mut info: Process = zeroed();
        if CreateProcessW(
            wide(executable).as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            1,
            0x08000004,
            null(),
            null(),
            &startup,
            &mut info,
        ) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        let process = Owned(info.process);
        let thread = Owned(info.thread);
        if AssignProcessToJobObject(job.0, process.0) == 0 {
            let error = std::io::Error::last_os_error();
            TerminateProcess(process.0, 1);
            return Err(error);
        }
        if ResumeThread(thread.0) == u32::MAX {
            let error = std::io::Error::last_os_error();
            TerminateProcess(process.0, 1);
            return Err(error);
        }
        println!("{{\"pid\":{}}}", info.pid);
        std::io::stdout().flush()?;
        let mut input = [0u8; 256];
        loop {
            match std::io::stdin().read(&mut input) {
                Ok(0) => break,
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        // Dropping this one handle stops every descendant, without inspecting or
        // terminating any PID from a saved file or any unrelated server.
    }
    Ok(())
}
