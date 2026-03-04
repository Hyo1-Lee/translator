// Speaker Page Types

export interface RoomSettings {
  roomTitle: string;
  sessionType: string;
  sourceLanguage: string;
  targetLanguages: string[];
  maxListeners: number;
  enableStreaming: boolean;
  promptTemplate?: string;
  customPrompt?: string;
  enableTranslation?: boolean;
  environmentPreset?: string;
  customEnvironmentDescription?: string;
  customGlossary?: Record<string, string> | null;
  speakerName?: string;
  password?: string;
}

export interface Transcript {
  id?: string;
  type?: string;
  text?: string;
  translations?: Record<string, string>;
  timestamp?: string;
  isFinal?: boolean;
  targetLanguage?: string;
  originalText?: string;
  isPartial?: boolean;
  isHistory?: boolean;
  sourceText?: string;
  korean?: string; // legacy compat
  segmentId?: string;
}

export interface SocketData {
  roomId?: string;
  roomCode?: string;
  roomStatus?: string;
  message?: string;
  count?: number;
  text?: string;
  language?: string;
  translations?: Record<string, string>;
  transcripts?: Transcript[];
  isRejoined?: boolean;
  roomSettings?: {
    roomTitle?: string;
    promptTemplate?: string;
    customPrompt?: string;
    targetLanguagesArray?: string[];
    maxListeners?: number;
    enableTranslation?: boolean;
    sourceLanguage?: string;
    environmentPreset?: string;
    customEnvironmentDescription?: string;
    customGlossary?: Record<string, string> | null;
    enableStreaming?: boolean;
  };
  timestamp?: string;
  isFinal?: boolean;
  targetLanguage?: string;
  originalText?: string;
  isPartial?: boolean;
  isHistory?: boolean;
  sourceText?: string;
  korean?: string; // legacy compat
}

export type RecordingState = "idle" | "recording" | "paused";

// Session presets
export const SESSION_PRESETS = [
  { value: "church", label: "교회/예배", icon: "🛐", description: "예배, 설교, 찬양" },
  { value: "lecture", label: "강의/세미나", icon: "🎓", description: "강연, 교육, 발표" },
  { value: "meeting", label: "회의/비즈니스", icon: "💼", description: "회의, 컨퍼런스" },
  { value: "general", label: "일반 대화", icon: "💬", description: "일상 대화, 기타" },
];

// Target languages (all supported languages)
export const TARGET_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ko", name: "한국어" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文 (简体)" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "ru", name: "Русский" },
  { code: "ar", name: "العربية" },
  { code: "pt", name: "Português" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "hi", name: "हिन्दी" },
  { code: "ur", name: "اردو" },
];

// Source languages (supported for STT + correction pipeline)
export const SOURCE_LANGUAGES = [
  { code: "ko", name: "한국어" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "ja", name: "日本語" },
];

// Constants
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
export const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";
export const STORAGE_KEY = "speaker_room_info";
export const SETTINGS_STORAGE_KEY = "speaker_default_settings";

// Default room settings
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roomTitle: "",
  sessionType: "church",
  sourceLanguage: "ko",
  targetLanguages: ["en"],
  maxListeners: 100,
  enableStreaming: true,
};
