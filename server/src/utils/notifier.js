import { exec } from 'child_process';

/**
 * Dispatches a native Windows Popup Alert with Sound and auto-close timer.
 * @param {string} title Notification Title
 * @param {string} message Notification Body Message
 * @param {'info' | 'error' | 'warning'} type Notification Type
 * @param {number} timeoutSeconds Time in seconds before auto-closing (e.g. 4)
 */
export function notifyUser(title, message, type = 'info', timeoutSeconds = 4) {
  let iconCode = 64; // Information
  let soundName = 'Asterisk';

  if (type === 'error') {
    iconCode = 16;
    soundName = 'Hand';
  } else if (type === 'warning') {
    iconCode = 48;
    soundName = 'Exclamation';
  }

  // Escape single quotes for PowerShell
  const safeTitle = title.replace(/'/g, "''");
  const safeMessage = message.replace(/'/g, "''");

  const psCommand = `
    [System.Media.SystemSounds]::${soundName}.Play();
    (New-Object -ComObject Wscript.Shell).Popup('${safeMessage}', ${timeoutSeconds}, '${safeTitle}', ${iconCode})
  `.replace(/\n/g, ' ');

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, () => {
    // Popup completed / auto-dismissed
  });
}
