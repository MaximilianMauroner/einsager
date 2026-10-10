// Only actual OS differences belong here. Electron supplies the shared host APIs.
interface Platform {
  pasteKey: string;
  helperExecutable: string;
  templateTrayIcon: boolean;
  /** The native Fn and custom-shortcut helper. Elsewhere Electron's global shortcut is the only one. */
  keyboardHelper?: string;
}

const platforms: Record<'darwin' | 'linux' | 'win32', Platform> = {
  darwin: { pasteKey: '⌘V', helperExecutable: 'einsager-transcribe', templateTrayIcon: true, keyboardHelper: 'einsager-keys' },
  linux: { pasteKey: 'Ctrl+V', helperExecutable: 'einsager-transcribe', templateTrayIcon: false },
  win32: { pasteKey: 'Ctrl+V', helperExecutable: 'einsager-transcribe.exe', templateTrayIcon: false },
};

/** Used by the host and packager so bundled helper names agree on each OS. */
export function platformFor(os: NodeJS.Platform) {
  if (os !== 'darwin' && os !== 'linux' && os !== 'win32') {
    throw new Error(`Unsupported desktop platform: ${os}`);
  }
  return platforms[os];
}
