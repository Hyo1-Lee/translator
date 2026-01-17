"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  getMicrophoneDevices,
  saveMicrophoneSettings,
  loadMicrophoneSettings,
  attemptMicrophoneReconnect,
  onDeviceChange,
  MicrophoneDevice,
} from "@/lib/microphone-manager";

export interface UseMicrophoneReturn {
  micDevices: MicrophoneDevice[];
  selectedMicId: string | null;
  currentMicLabel: string;
  useExternalMicMode: boolean;
  setUseExternalMicMode: (value: boolean) => void;
  loadMicDevices: () => Promise<void>;
  handleMicSelect: (device: MicrophoneDevice) => void;
  handleExternalMicModeChange: (enabled: boolean) => void;
}

export function useMicrophone(): UseMicrophoneReturn {
  const [micDevices, setMicDevices] = useState<MicrophoneDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);
  const [useExternalMicMode, setUseExternalMicMode] = useState(false);
  const [currentMicLabel, setCurrentMicLabel] = useState<string>("기본 마이크");

  // Load microphone devices
  const loadMicDevices = useCallback(async () => {
    try {
      const devices = await getMicrophoneDevices();
      setMicDevices(devices);
      console.log("[Microphone] Devices loaded:", devices.length);

      // Auto-select external mic if available and no previous selection
      if (!selectedMicId && devices.length > 0) {
        const externalMic = devices.find((d) => d.isExternal);
        if (externalMic) {
          setSelectedMicId(externalMic.deviceId);
          setUseExternalMicMode(true);
          setCurrentMicLabel(externalMic.label);
          saveMicrophoneSettings({
            deviceId: externalMic.deviceId,
            deviceLabel: externalMic.label,
            useExternalMicMode: true,
          });
          console.log("[Microphone] Auto-selected external mic:", externalMic.label);
          toast.info(`외부 마이크 감지: ${externalMic.label}`);
        }
      }
    } catch (error) {
      console.error("[Microphone] Error loading devices:", error);
    }
  }, [selectedMicId]);

  // Handle microphone selection
  const handleMicSelect = useCallback((device: MicrophoneDevice) => {
    setSelectedMicId(device.deviceId);
    setCurrentMicLabel(device.label);

    // Auto-enable external mic mode for external devices
    const newExternalMode = device.isExternal;
    setUseExternalMicMode(newExternalMode);

    // Save settings
    saveMicrophoneSettings({
      deviceId: device.deviceId,
      deviceLabel: device.label,
      useExternalMicMode: newExternalMode,
    });

    console.log("[Microphone] Selected:", device.label, "External mode:", newExternalMode);
  }, []);

  // Handle external mic mode change
  const handleExternalMicModeChange = useCallback((enabled: boolean) => {
    setUseExternalMicMode(enabled);
    saveMicrophoneSettings({
      deviceId: selectedMicId,
      deviceLabel: currentMicLabel,
      useExternalMicMode: enabled,
    });
  }, [selectedMicId, currentMicLabel]);

  // Initialize microphone settings on mount
  useEffect(() => {
    // Load saved settings
    const savedSettings = loadMicrophoneSettings();
    if (savedSettings) {
      setSelectedMicId(savedSettings.deviceId);
      setUseExternalMicMode(savedSettings.useExternalMicMode);
    }

    // Load devices
    loadMicDevices();

    // Listen for device changes
    const cleanup = onDeviceChange(() => {
      loadMicDevices();
    });

    return cleanup;
  }, [loadMicDevices]);

  // Validate and reconnect mic on device changes
  useEffect(() => {
    const validateAndReconnectMic = async () => {
      if (micDevices.length === 0) return;

      const savedSettings = loadMicrophoneSettings();
      if (!savedSettings || !savedSettings.deviceId) {
        setCurrentMicLabel("기본 마이크");
        return;
      }

      const selectedDevice = micDevices.find((d) => d.deviceId === savedSettings.deviceId);

      if (selectedDevice) {
        setSelectedMicId(selectedDevice.deviceId);
        setCurrentMicLabel(selectedDevice.label);
        console.log("[Microphone] Saved microphone verified:", selectedDevice.label);
      } else {
        console.warn("[Microphone] Saved deviceId not found, attempting reconnect...");

        const reconnectResult = await attemptMicrophoneReconnect(savedSettings);

        if (reconnectResult.device) {
          setSelectedMicId(reconnectResult.device.deviceId);
          setCurrentMicLabel(reconnectResult.device.label);
          setUseExternalMicMode(reconnectResult.device.isExternal);

          saveMicrophoneSettings({
            deviceId: reconnectResult.device.deviceId,
            deviceLabel: reconnectResult.device.label,
            useExternalMicMode: reconnectResult.device.isExternal,
          });

          if (reconnectResult.reconnected) {
            console.log("[Microphone] Auto-reconnected:", reconnectResult.message);
            toast.info(`${reconnectResult.message}`, { duration: 5000 });
          }
        } else {
          setSelectedMicId(null);
          setCurrentMicLabel("기본 마이크");
          toast.error(`${reconnectResult.message}`, { duration: 5000 });
        }
      }
    };

    validateAndReconnectMic();
  }, [micDevices]);

  return {
    micDevices,
    selectedMicId,
    currentMicLabel,
    useExternalMicMode,
    setUseExternalMicMode,
    loadMicDevices,
    handleMicSelect,
    handleExternalMicModeChange,
  };
}

export default useMicrophone;
