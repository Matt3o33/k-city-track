import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { consumeCrashReport } from '@/lib/diagnostics';
import {
  errorMessage,
  getTrackingStatus,
  isTrackingActive,
  startTracking,
  stopTracking,
  type TrackingStatus,
} from '@/lib/tracking';

type SymbolName = SymbolViewProps['name'];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('it-IT');
}

function InfoRow({ icon, label, value }: { icon: SymbolName; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: theme.backgroundSelected }]}>
        <SymbolView tintColor={theme.textSecondary} name={icon} size={16} />
      </View>
      <View style={styles.infoTextBlock}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="smallBold">{value}</ThemedText>
      </View>
    </View>
  );
}

export default function TrackingScreen() {
  const theme = useTheme();
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [showSettingsLink, setShowSettingsLink] = useState(false);
  const [crashReport, setCrashReport] = useState<string | null>(null);

  const pulse = useSharedValue(0);

  useEffect(() => {
    consumeCrashReport().then(setCrashReport);
  }, []);

  useEffect(() => {
    if (active) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [active, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.85 }],
    opacity: (1 - pulse.value) * 0.4,
  }));

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
  const statusColor = active ? theme.success : theme.textSecondary;

  const positionValue = status?.lastFix
    ? `${status.lastFix.lat.toFixed(6)}, ${status.lastFix.lon.toFixed(6)}` +
      (status.lastFix.acc != null ? `  ·  ±${Math.round(status.lastFix.acc)} m` : '') +
      `  ·  ${formatTime(status.lastFix.at)}`
    : '—';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          k-city-track
        </ThemedText>

        {crashReport && (
          <View style={[styles.messageCard, { backgroundColor: theme.dangerTint }]}>
            <ThemedText type="smallBold" style={{ color: theme.danger }}>
              Diagnostica ultimo avvio
            </ThemedText>
            <ThemedText type="small">{crashReport}</ThemedText>
          </View>
        )}

        <View style={styles.hero}>
          <View
            style={[
              styles.heroCircle,
              { backgroundColor: active ? theme.successTint : theme.backgroundElement },
            ]}>
            <Animated.View
              style={[styles.heroRing, { backgroundColor: theme.success }, ringStyle]}
            />
            <View style={[styles.heroDot, { backgroundColor: statusColor }]} />
          </View>
          <ThemedText type="smallBold" style={{ color: statusColor }}>
            {active ? 'Tracciamento attivo' : 'Tracciamento fermo'}
          </ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.statusCard}>
          <InfoRow
            icon={{ ios: 'location.fill', android: 'location_on', web: 'location_on' }}
            label="Ultima posizione"
            value={positionValue}
          />
          <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
          <InfoRow
            icon={{ ios: 'paperplane.fill', android: 'send', web: 'send' }}
            label="Ultimo invio MQTT"
            value={status?.lastPublishAt ? formatTime(status.lastPublishAt) : '—'}
          />
        </ThemedView>

        {lastError && (
          <View style={[styles.messageCard, { backgroundColor: theme.dangerTint }]}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {lastError}
            </ThemedText>
          </View>
        )}
        {uiNotice && !lastError && (
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

        <View style={styles.spacer} />

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
              { backgroundColor: active ? theme.danger : theme.accent },
              (pressed || busy) && styles.pressed,
            ]}>
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <View style={styles.toggleButtonContent}>
                <SymbolView
                  tintColor="#ffffff"
                  name={
                    active
                      ? { ios: 'stop.fill', android: 'stop', web: 'stop' }
                      : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                  }
                  size={18}
                />
                <ThemedText style={styles.toggleButtonText}>
                  {active ? 'Ferma tracciamento' : 'Avvia tracciamento'}
                </ThemedText>
              </View>
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
  hero: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  heroCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  heroDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  statusCard: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTextBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 36 + Spacing.three,
  },
  messageCard: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  spacer: {
    flex: 1,
  },
  toggleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    minHeight: 56,
  },
  toggleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  toggleButtonText: {
    color: '#ffffff',
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.7,
  },
});
