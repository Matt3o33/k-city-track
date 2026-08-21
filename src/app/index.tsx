import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { consumeCrashReport } from '@/lib/diagnostics';
import {
  errorMessage,
  getTrackingStatus,
  isTrackingActive,
  startTracking,
  stopTracking,
  type TrackingStatus,
} from '@/lib/tracking';

const ERROR_COLOR = '#C42B2B';
const PRIMARY_COLOR = '#208AEF';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('it-IT');
}

export default function TrackingScreen() {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [showSettingsLink, setShowSettingsLink] = useState(false);
  const [crashReport, setCrashReport] = useState<string | null>(null);

  useEffect(() => {
    consumeCrashReport().then(setCrashReport);
  }, []);

  const refresh = useCallback(async () => {
    const [isActive, trackingStatus] = await Promise.all([isTrackingActive(), getTrackingStatus()]);
    setActive(isActive);
    setStatus(trackingStatus);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const onToggle = async () => {
    setBusy(true);
    setUiError(null);
    setUiNotice(null);
    setShowSettingsLink(false);
    try {
      if (active) {
        await stopTracking();
      } else {
        await startTracking();
        setUiNotice('Tracciamento avviato.');
      }
      await refresh();
    } catch (error) {
      const message = errorMessage(error);
      setUiError(`${active ? 'Arresto del tracking' : 'Avvio del tracking'} fallito: ${message}`);
      if (message.includes('Consenti sempre')) {
        setShowSettingsLink(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const lastError = uiError ?? status?.lastError ?? null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          k-city-track
        </ThemedText>

        {crashReport && (
          <ThemedView type="backgroundElement" style={styles.crashCard}>
            <ThemedText type="smallBold" style={styles.errorText}>
              Diagnostica ultimo avvio
            </ThemedText>
            <ThemedText type="small">{crashReport}</ThemedText>
          </ThemedView>
        )}

        <ThemedView type="backgroundElement" style={styles.statusCard}>
          <ThemedView type="backgroundElement" style={styles.statusRow}>
            <ThemedText type="smallBold">Stato</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {active ? 'Tracciamento attivo' : 'Tracciamento fermo'}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.statusRow}>
            <ThemedText type="smallBold">Ultima posizione</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {status?.lastFix
                ? `${status.lastFix.lat.toFixed(6)}, ${status.lastFix.lon.toFixed(6)}` +
                  (status.lastFix.acc != null ? ` (±${Math.round(status.lastFix.acc)} m)` : '') +
                  ` · ${formatTime(status.lastFix.at)}`
                : '—'}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.statusRow}>
            <ThemedText type="smallBold">Ultimo invio MQTT</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {status?.lastPublishAt ? formatTime(status.lastPublishAt) : '—'}
            </ThemedText>
          </ThemedView>
        </ThemedView>

        {lastError && (
          <ThemedText type="small" style={styles.errorText}>
            {lastError}
          </ThemedText>
        )}
        {uiNotice && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {uiNotice}
          </ThemedText>
        )}
        {showSettingsLink && (
          <Pressable onPress={() => Linking.openSettings()}>
            <ThemedText type="linkPrimary" style={styles.centerText}>
              Apri impostazioni app
            </ThemedText>
          </Pressable>
        )}

        {Platform.OS === 'web' ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            Il tracciamento è disponibile solo nell&apos;app Android/iOS.
          </ThemedText>
        ) : (
          <Pressable
            onPress={onToggle}
            disabled={busy}
            style={({ pressed }) => [
              styles.toggleButton,
              { backgroundColor: active ? ERROR_COLOR : PRIMARY_COLOR },
              (pressed || busy) && styles.pressed,
            ]}>
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.toggleButtonText}>
                {active ? 'Ferma tracciamento' : 'Avvia tracciamento'}
              </ThemedText>
            )}
          </Pressable>
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          Configura broker e topic MQTT nella scheda Impostazioni.
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.six,
    alignItems: 'stretch',
    gap: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  title: {
    textAlign: 'center',
  },
  statusCard: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
  crashCard: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  statusRow: {
    gap: Spacing.half,
  },
  errorText: {
    color: '#C42B2B',
    textAlign: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  toggleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    minHeight: 52,
  },
  toggleButtonText: {
    color: '#ffffff',
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.7,
  },
});
