/**
 * Microphone Device Manager
 *
 * Handles microphone device enumeration, selection, and persistence
 * Optimized for mobile environments
 */

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
  isExternal: boolean;  // Heuristic: external/bluetooth mic detection
}

export interface MicrophoneSettings {
  deviceId: string | null;
  useExternalMicMode: boolean;
}

const STORAGE_KEY = "microphone_settings";

/**
 * Detect if a device is likely an external microphone based on its label
 */
function detectExternalMic(label: string): boolean {
  const lowerLabel = label.toLowerCase();

  // Common external mic indicators
  const externalIndicators = [
    "bluetooth",
    "bt ",
    "wireless",
    "airpods",
    "galaxy buds",
    "earbuds",
    "headset",
    "headphone",
    "usb",
    "external",
    "lavalier",
    "lapel",
    "lav mic",
    "rode",
    "shure",
    "sennheiser",
    "boya",
    "fifine",
    "saramonic",
    "comica",
    "deity",
    "dji mic",
    "wireless mic",
    "pin mic",
    "핀마이크",
    "무선",
    "블루투스",
    "이어폰",
    "헤드셋",
  ];

  return externalIndicators.some(indicator => lowerLabel.includes(indicator));
}

/**
 * Get list of available microphone devices
 * Note: Labels are only available after getUserMedia permission is granted
 */
export async function getMicrophoneDevices(): Promise<MicrophoneDevice[]> {
  try {
    // First, try to get permission to access device labels
    // This is needed because device labels are hidden until permission is granted
    let hasPermission = false;

    try {
      // Check if we already have permission
      const permissionStatus = await navigator.permissions.query({
        name: "microphone" as PermissionName
      });
      hasPermission = permissionStatus.state === "granted";
    } catch {
      // permissions.query not supported, try getUserMedia
    }

    // If no permission, request it temporarily
    if (!hasPermission) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(track => track.stop());
      } catch (error) {
        console.warn("[MicrophoneManager] Could not get microphone permission:", error);
        // Return empty list if permission denied
        return [];
      }
    }

    // Now enumerate devices (labels will be available)
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === "audioinput");

    // Find default device
    const defaultDevice = audioInputs.find(d => d.deviceId === "default");

    return audioInputs
      .filter(device => device.deviceId !== "default") // Exclude the "default" virtual device
      .map((device, index) => {
        const label = device.label || `마이크 ${index + 1}`;
        const isExternal = detectExternalMic(label);

        return {
          deviceId: device.deviceId,
          label: label,
          isDefault: defaultDevice?.groupId === device.groupId,
          isExternal: isExternal,
        };
      });
  } catch (error) {
    console.error("[MicrophoneManager] Error getting devices:", error);
    return [];
  }
}

/**
 * Save microphone settings to localStorage
 */
export function saveMicrophoneSettings(settings: MicrophoneSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    console.log("[MicrophoneManager] Settings saved:", settings);
  } catch (error) {
    console.warn("[MicrophoneManager] Could not save settings:", error);
  }
}

/**
 * Load microphone settings from localStorage
 */
export function loadMicrophoneSettings(): MicrophoneSettings | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const settings = JSON.parse(saved) as MicrophoneSettings;
      console.log("[MicrophoneManager] Settings loaded:", settings);
      return settings;
    }
  } catch (error) {
    console.warn("[MicrophoneManager] Could not load settings:", error);
  }
  return null;
}

/**
 * Clear saved microphone settings
 */
export function clearMicrophoneSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[MicrophoneManager] Could not clear settings:", error);
  }
}

/**
 * Listen for device changes (connect/disconnect)
 */
export function onDeviceChange(callback: () => void): () => void {
  const handler = () => {
    console.log("[MicrophoneManager] Device change detected");
    callback();
  };

  navigator.mediaDevices.addEventListener("devicechange", handler);

  // Return cleanup function
  return () => {
    navigator.mediaDevices.removeEventListener("devicechange", handler);
  };
}

/**
 * Check if a specific device is still available
 */
export async function isDeviceAvailable(deviceId: string): Promise<boolean> {
  const devices = await getMicrophoneDevices();
  return devices.some(d => d.deviceId === deviceId);
}

/**
 * Get recommended device (prefers external mic if available)
 */
export async function getRecommendedDevice(): Promise<MicrophoneDevice | null> {
  const devices = await getMicrophoneDevices();

  if (devices.length === 0) return null;

  // Prefer external mic
  const externalMic = devices.find(d => d.isExternal);
  if (externalMic) {
    console.log("[MicrophoneManager] Recommended: External mic found:", externalMic.label);
    return externalMic;
  }

  // Fall back to default or first available
  const defaultMic = devices.find(d => d.isDefault);
  return defaultMic || devices[0];
}
