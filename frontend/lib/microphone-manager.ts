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
  deviceLabel?: string | null;  // 마이크 이름 저장 (deviceId 변경 시 자동 재연결용)
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
      } catch {
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
  } catch {
    return [];
  }
}

/**
 * Save microphone settings to localStorage
 */
export function saveMicrophoneSettings(settings: MicrophoneSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Silently fail
  }
}

/**
 * Load microphone settings from localStorage
 */
export function loadMicrophoneSettings(): MicrophoneSettings | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as MicrophoneSettings;
    }
  } catch {
    // Silently fail
  }
  return null;
}

/**
 * Clear saved microphone settings
 */
export function clearMicrophoneSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Listen for device changes (connect/disconnect)
 */
export function onDeviceChange(callback: () => void): () => void {
  navigator.mediaDevices.addEventListener("devicechange", callback);

  // Return cleanup function
  return () => {
    navigator.mediaDevices.removeEventListener("devicechange", callback);
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
    return externalMic;
  }

  // Fall back to default or first available
  const defaultMic = devices.find(d => d.isDefault);
  return defaultMic || devices[0];
}

/**
 * Find device by label (for auto-reconnect when deviceId changes)
 * 무선 마이크는 연결할 때마다 deviceId가 변경될 수 있으므로, label로 같은 마이크를 찾습니다.
 */
export async function findDeviceByLabel(label: string): Promise<MicrophoneDevice | null> {
  const devices = await getMicrophoneDevices();

  // 1. 정확히 같은 이름 찾기
  const exactMatch = devices.find(d => d.label === label);
  if (exactMatch) {
    return exactMatch;
  }

  // 2. 부분 일치 찾기 (앞뒤 공백이나 약간의 차이 허용)
  const normalizedLabel = label.toLowerCase().trim();
  const partialMatch = devices.find(d =>
    d.label.toLowerCase().trim() === normalizedLabel ||
    d.label.toLowerCase().includes(normalizedLabel) ||
    normalizedLabel.includes(d.label.toLowerCase())
  );
  if (partialMatch) {
    return partialMatch;
  }

  return null;
}

/**
 * Attempt to reconnect to saved microphone
 * deviceId가 유효하면 그대로 사용, 아니면 label로 같은 마이크를 찾아서 재연결
 */
export async function attemptMicrophoneReconnect(
  savedSettings: MicrophoneSettings
): Promise<{ device: MicrophoneDevice | null; reconnected: boolean; message: string }> {
  const devices = await getMicrophoneDevices();

  if (devices.length === 0) {
    return { device: null, reconnected: false, message: "사용 가능한 마이크가 없습니다" };
  }

  // 1. 저장된 deviceId로 찾기
  if (savedSettings.deviceId) {
    const exactDevice = devices.find(d => d.deviceId === savedSettings.deviceId);
    if (exactDevice) {
      return { device: exactDevice, reconnected: false, message: "" };
    }
  }

  // 2. deviceId가 유효하지 않으면 label로 찾기
  if (savedSettings.deviceLabel) {
    const labelMatch = await findDeviceByLabel(savedSettings.deviceLabel);
    if (labelMatch) {
      console.log(`[MicrophoneManager] 🔄 Auto-reconnected by label: "${savedSettings.deviceLabel}" -> ${labelMatch.deviceId}`);
      return {
        device: labelMatch,
        reconnected: true,
        message: `마이크 자동 재연결: ${labelMatch.label}`,
      };
    }
  }

  // 3. 외부 마이크가 있으면 추천
  const externalMic = devices.find(d => d.isExternal);
  if (externalMic) {
    return {
      device: externalMic,
      reconnected: true,
      message: `외부 마이크 감지: ${externalMic.label}`,
    };
  }

  // 4. 찾지 못함 - 기본 마이크 사용 권유
  const defaultMic = devices.find(d => d.isDefault) || devices[0];
  return {
    device: defaultMic,
    reconnected: true,
    message: `저장된 마이크를 찾을 수 없어 기본 마이크 사용: ${defaultMic.label}`,
  };
}
