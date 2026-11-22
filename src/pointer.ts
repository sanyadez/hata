/**
 * Puts the pointer of the server's own screen away, into its bottom right corner. A compositor draws
 * the pointer in the middle of the screen from its start and keeps it there until a mouse moves; with
 * nobody at the screen that is in the middle of the film. A mouse made for a moment through the
 * kernel's uinput moves it far down and right, then is taken away again. The program on the screen
 * also learns by that move where the pointer is, and can hide it.
 */
import { dlopen, FFIType, ptr } from "bun:ffi";

const UI_SET_EVBIT = 0x40045564;
const UI_SET_KEYBIT = 0x40045565;
const UI_SET_RELBIT = 0x40045566;
const UI_DEV_CREATE = 0x5501;
const UI_DEV_DESTROY = 0x5502;
const [EV_SYN, EV_KEY, EV_REL, BTN_LEFT, REL_X, REL_Y] = [0, 1, 2, 0x110, 0, 1];

/** The device as the kernel's older, single-write way takes it: a name, an id, and room for the ranges of axes it has none of */
export function uinputDevice(name: string): Uint8Array {
  const dev = new Uint8Array(80 + 8 + 4 + 4 * 64 * 4);
  dev.set(new TextEncoder().encode(name).subarray(0, 79));
  const view = new DataView(dev.buffer);
  view.setUint16(80, 0x06, true); // BUS_VIRTUAL
  view.setUint16(82, 0x4861, true);
  view.setUint16(84, 0x7461, true);
  view.setUint16(86, 1, true);
  return dev;
}

/** One event as a 64-bit kernel reads it: a time (left to the kernel), a kind, a code, a value */
export function inputEvent(type: number, code: number, value: number): Uint8Array {
  const event = new Uint8Array(24);
  const view = new DataView(event.buffer);
  view.setUint16(16, type, true);
  view.setUint16(18, code, true);
  view.setInt32(20, value, true);
  return event;
}

let busy = false;

export async function parkPointer(): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const libc = dlopen("libc.so.6", {
      open: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
      ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
      write: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
    }).symbols;
    const fd = libc.open(Buffer.from("/dev/uinput\0"), 1 /* O_WRONLY */);
    if (fd < 0) return false;
    try {
      const send = (bytes: Uint8Array) => libc.write(fd, ptr(bytes), bytes.length);
      if (libc.ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0 || libc.ioctl(fd, UI_SET_KEYBIT, BTN_LEFT) < 0 || libc.ioctl(fd, UI_SET_EVBIT, EV_REL) < 0 || libc.ioctl(fd, UI_SET_RELBIT, REL_X) < 0 || libc.ioctl(fd, UI_SET_RELBIT, REL_Y) < 0) return false;
      send(uinputDevice("Hata pointer parking"));
      if (libc.ioctl(fd, UI_DEV_CREATE, 0) < 0) return false;
      // the compositor needs a moment to take the new mouse in
      await Bun.sleep(1200);
      for (let i = 0; i < 12; i++) {
        send(inputEvent(EV_REL, REL_X, 800));
        send(inputEvent(EV_REL, REL_Y, 800));
        send(inputEvent(EV_SYN, 0, 0));
        await Bun.sleep(25);
      }
      await Bun.sleep(300);
      libc.ioctl(fd, UI_DEV_DESTROY, 0);
      return true;
    } finally {
      libc.close(fd);
    }
  } catch {
    return false;
  } finally {
    busy = false;
  }
}
